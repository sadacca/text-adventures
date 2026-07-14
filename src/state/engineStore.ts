import { create } from 'zustand';
import { createEngine } from '../engine/engine.js';
import type { RawMessage } from '../engine/protocol-tap.js';
import type { EngineHandle, GameEvent } from '../engine/types.js';
import {
  getGame,
  restartPlaythrough as storageRestartPlaythrough,
  touchLastPlayed,
} from '../storage/games.js';
import { getLatestAutosave, writeAutosaveGeneration } from '../storage/autosaves.js';
import { listSaves, readSave, writeSave, type SaveSummary } from '../storage/saves.js';
import { appendTranscriptEntry, getTranscript } from '../storage/transcripts.js';
import { bufferTextEndsInQuestion, type TravelStep } from '../map/travel.js';
import { useMapStore } from './mapStore.js';
import { useDialogStore } from './dialogStore.js';

/** DebugConsole's live event feed (Task 1.4): capped so a long session can't leak memory. */
const DEBUG_EVENT_LIMIT = 300;

/** Task 1.8 tap-to-travel outcome, per SPECS.md §3's abort conditions. */
export type TravelResult = 'completed' | 'blocked' | 'question' | 'char_input';

/**
 * Bocfel prints its own "[Starting/End of history playback]" scrollback replay as part
 * of a RESTORE's ordinary output — regardless of whether *we* consider that restore
 * silent — and that replay includes every command Bocfel ever saw, including our own
 * background per-turn autosaves ("save" spam). It's always noise for our purposes (we
 * rebuild scrollback from our own transcript log instead — see `openGame`), so strip it
 * out of any turn's response before it reaches the transcript, live or stored.
 */
function stripHistoryReplay(text: string): string {
  const startMarker = '[Starting history playback]';
  const endMarker = '[End of history playback]';
  const startIdx = text.indexOf(startMarker);
  const endIdx = text.indexOf(endMarker);
  if (startIdx === -1 || endIdx === -1 || endIdx < startIdx) return text;
  return text.slice(0, startIdx) + text.slice(endIdx + endMarker.length);
}

/**
 * Collapses runs of 3+ blank lines to a single blank line (some games separate
 * sections with several, meant to fill a full-height terminal — dead space in our
 * scrolling view), and — only for the transcript's very first chunk — trims leading
 * blank lines entirely (Adventure's own banner opens with six of them).
 */
function normalizeResponse(text: string, isFirstChunk: boolean): string {
  const collapsed = text.replace(/\n{3,}/g, '\n\n');
  return isFirstChunk ? collapsed.replace(/^\n+/, '') : collapsed;
}

interface StatusLine {
  left: string;
  right: string;
}

interface EngineState {
  gameId: string | null;
  gameTitle: string;
  transcript: string[];
  status: StatusLine | null;
  inputType: 'line' | 'char' | null;
  saves: SaveSummary[];
  loading: boolean;
  error: string | null;
  /** Set by the saves UI just before triggering an in-game RESTORE, so the resulting
   *  fileref prompt resolves to that save instead of asking the player to pick one. */
  pendingRestoreName: string | null;

  /** Task 1.4: DebugConsole's live GameEvent feed, newest last, capped at DEBUG_EVENT_LIMIT. */
  debugEvents: GameEvent[];
  /** Task 1.4: recording toggle — while true, every raw RemGlk message is buffered for
   *  "record fixture" download; false the rest of the time so idle play doesn't grow
   *  an unbounded buffer. */
  recordingFixture: boolean;
  startRecordingFixture: () => void;
  /** Stops recording and returns the buffered messages as fixture JSON Lines text
   *  (SPECS.md §6 format), ready to save/download. */
  stopRecordingFixture: () => string;

  /** Task 1.8: true while tap-to-travel is driving the engine turn-by-turn — gates the
   *  rest of the input UI (compass/chips/command bar) so the player can't stack a
   *  manual command mid-trip. */
  traveling: boolean;

  /** Bumped on every player-initiated command (sendCommand/travelTo) so StoryScreen can
   *  force the transcript back to pinned-at-bottom even if the player had scrolled up to
   *  read back — sending a command is an explicit request to see its response, so it
   *  should never be missed behind a "new text" pill. */
  pinRequestId: number;

  /** UX-11: set when a status_line's score increases turn-over-turn, so StoryScreen can
   *  toast it. `id` is an incrementing counter (not just `amount`) so two equal-amount
   *  increases in a row still retrigger the toast. Only score *increases* toast — a drop,
   *  or a `right` field that's actually a clock, would be a false positive worse than a
   *  missed toast. */
  scoreDelta: { amount: number; id: number } | null;

  openGame: (gameId: string) => Promise<void>;
  closeGame: () => void;
  sendCommand: (text: string) => void;
  /** UX-14: answers a `char`-type input_requested ("press any key" prompts, menus). */
  sendChar: (value: string) => void;
  restoreNamed: (name: string) => void;
  refreshSaves: () => Promise<void>;
  restartPlaythrough: () => Promise<void>;
  /** Task 1.8 tap-to-travel: sends `path`'s moves one at a time, waiting for each
   *  resulting turn to fully settle before sending the next, and aborts immediately if
   *  a response deviates from what the map expects (SPECS.md §3): the room reached
   *  isn't the step's expected room, any buffer_text line ends in '?' (a prompt/
   *  question), or the next input request is `char` (not `line`). */
  travelTo: (path: TravelStep[]) => Promise<TravelResult>;
}

let activeEngine: EngineHandle | null = null;
let activeCleanup: (() => void) | null = null;
let activeGameId: string | null = null;
let lastKnownTurn = 0;
let recordedRaw: RawMessage[] = [];
/** UX-11: previous turn's parsed score, so status_line handling can detect an increase. */
let previousScore: number | null = null;
let scoreDeltaCounter = 0;

function teardownActiveSession() {
  activeCleanup?.();
  activeCleanup = null;
  void activeEngine?.stop();
  activeEngine = null;
  activeGameId = null;
  lastKnownTurn = 0;
  previousScore = null;
}

export const useEngineStore = create<EngineState>((set, get) => ({
  gameId: null,
  gameTitle: '',
  transcript: [],
  status: null,
  inputType: null,
  saves: [],
  loading: false,
  error: null,
  pendingRestoreName: null,
  debugEvents: [],
  recordingFixture: false,
  traveling: false,
  pinRequestId: 0,
  scoreDelta: null,

  startRecordingFixture() {
    recordedRaw = [];
    set({ recordingFixture: true });
  },

  stopRecordingFixture() {
    set({ recordingFixture: false });
    const jsonl = recordedRaw.map((raw) => JSON.stringify(raw)).join('\n') + '\n';
    recordedRaw = [];
    return jsonl;
  },

  async openGame(gameId) {
    teardownActiveSession();
    set({
      gameId,
      loading: true,
      error: null,
      transcript: [],
      status: null,
      inputType: null,
      saves: [],
      debugEvents: [],
      scoreDelta: null,
    });

    const game = await getGame(gameId);
    if (!game) {
      set({ loading: false, error: 'Game not found' });
      return;
    }
    set({ gameTitle: game.title });

    const engine = createEngine();
    activeEngine = engine;
    activeGameId = gameId;
    lastKnownTurn = 0;

    let pendingCommand: string | null = null;
    let pendingResponseChunks: string[] = [];
    let lastAutosaveTurn = -1;

    // The very first cycle is either a fresh boot (nothing to resume) or a silent
    // engine-driven RESTORE against a prior autosave (Task 1.5). `resuming` is set
    // before `start()` is called and cleared once it resolves (by which point the whole
    // restore has fully settled — see engine.ts's busy/ready queue). While resuming,
    // Bocfel's own "history playback" text is NOT used for the transcript: it replays
    // every command *Bocfel* ever saw, including our own silent per-turn autosaves, so
    // it comes back full of spurious "save / Ok." noise. The visible scrollback is
    // reconstructed from our own `transcripts` store instead, right after `start()`
    // resolves (see below) — only the live status line is trusted from the replay.
    let resuming = false;

    const unsubscribeDebugEvents = engine.on((event) => {
      set((s) => ({
        debugEvents:
          s.debugEvents.length >= DEBUG_EVENT_LIMIT
            ? [...s.debugEvents.slice(1), event]
            : [...s.debugEvents, event],
      }));
    });

    const unsubscribeRaw = engine.onRaw((raw) => {
      if (get().recordingFixture) recordedRaw.push(raw);
    });

    const unsubscribeEvents = engine.on((event) => {
      const isSilent = 'silent' in event && event.silent;

      // Automapper (Task 1.6) wants every *real* event, but never a silent one: a
      // resuming session's Bocfel "history playback" actually re-sends every historical
      // command (autosave noise included, per Task 1.5's outcome notes below) as a burst
      // of silent status_lines, and replaying that against a graph already loaded at its
      // final state would scramble it (spurious teleport flags, wrong current-room
      // hops). The per-turn silent autosave's own save/restore round-trip is harmless to
      // skip too — it never actually moves the player.
      if (!isSilent) useMapStore.getState().handleEvent(event);

      if (event.kind === 'command') {
        pendingCommand = event.text;
        pendingResponseChunks = [];
        return;
      }

      if (isSilent && !resuming) return; // background autosave noise, not for display

      if (event.kind === 'buffer_text') {
        if (!resuming) {
          pendingResponseChunks.push(event.text);
        }
      } else if (event.kind === 'status_line') {
        set({ status: { left: event.left, right: event.right } });
        const scoreMatch = /(-?\d+)/.exec(event.right);
        if (scoreMatch) {
          const score = Number(scoreMatch[1]);
          if (!resuming && previousScore !== null && score > previousScore) {
            scoreDeltaCounter += 1;
            set({ scoreDelta: { amount: score - previousScore, id: scoreDeltaCounter } });
          }
          previousScore = score;
        }
      } else if (isSilent) {
        // resuming, but not text/status (e.g. the resume's own input_requested): ignore.
      } else if (event.kind === 'input_requested') {
        if (!resuming) {
          const response = normalizeResponse(
            stripHistoryReplay(pendingResponseChunks.join('')),
            get().transcript.length === 0,
          );
          // A line request always commits (existing behavior, unchanged). A char request
          // (UX-14) commits only when there is actual text to show — it must never
          // autosave (saveAutosave dispatches a line command, which a char prompt can't
          // accept).
          if (event.type === 'line' || response.trim() !== '') {
            set((s) => ({ transcript: [...s.transcript, response] }));
            void appendTranscriptEntry(gameId, {
              turn: event.turn,
              command: pendingCommand ?? '',
              response,
            });
            pendingCommand = null;
            pendingResponseChunks = [];
          }
          if (event.type === 'line') {
            lastKnownTurn = event.turn;
            if (event.turn > lastAutosaveTurn) {
              lastAutosaveTurn = event.turn;
              void engine
                .saveAutosave()
                .then((bytes) => writeAutosaveGeneration(gameId, bytes, event.turn))
                .catch((err: unknown) => console.error('autosave failed', err));
            }
          }
        }
        set({ inputType: event.type });
      } else if (event.kind === 'quit') {
        set({ inputType: null });
      }
    });

    engine.onNamedSavePrompt(async (kind) => {
      if (kind === 'save') {
        const name = await useDialogStore.getState().ask({
          kind: 'prompt',
          title: 'Save game',
          placeholder: 'Save name',
        });
        return name ? { name: name as string } : null;
      }
      const preselected = get().pendingRestoreName;
      set({ pendingRestoreName: null });
      let chosen: string | null = preselected;
      if (!chosen) {
        const names = get().saves.map((s) => s.name);
        if (names.length === 0) {
          await useDialogStore.getState().ask({ kind: 'alert', title: 'No saved games yet.' });
          chosen = null;
        } else {
          chosen = (await useDialogStore
            .getState()
            .ask({ kind: 'pick', title: 'Restore which save?', options: names })) as string | null;
        }
      }
      if (!chosen) return null;
      const bytes = await readSave(gameId, chosen);
      if (!bytes) {
        await useDialogStore.getState().ask({ kind: 'alert', title: `No save named "${chosen}"` });
        return null;
      }
      return { name: chosen, bytes };
    });

    const unsubscribeNamedSave = engine.onNamedSaveWritten((name, bytes) => {
      void writeSave(gameId, name, bytes, lastAutosaveTurn).then(() => get().refreshSaves());
    });

    activeCleanup = () => {
      unsubscribeEvents();
      unsubscribeDebugEvents();
      unsubscribeRaw();
      unsubscribeNamedSave();
    };

    const latestAutosave = await getLatestAutosave(gameId);
    if (latestAutosave) engine.preloadAutosave(latestAutosave.snapshot);
    resuming = latestAutosave !== null;

    // Load (or create) this game's map before any events can arrive, so the automapper
    // is ready the instant engine.start() begins producing them.
    await useMapStore.getState().loadForGame(gameId);

    await engine.start(new Uint8Array(game.bytes), { autorestore: latestAutosave !== null });
    // By now the whole restore has fully settled — engine.ts's busy/ready queue
    // guarantees start() doesn't resolve early. Rebuild the visible scrollback from our
    // own transcript log (not Bocfel's "history playback", which replays every command
    // it ever saw, autosave noise included).
    if (resuming) {
      const priorEntries = await getTranscript(gameId);
      const rendered = priorEntries.map((e) => e.response).filter(Boolean);
      if (rendered.length > 0) set({ transcript: rendered });
      resuming = false;
    }

    await touchLastPlayed(gameId);
    await get().refreshSaves();
    set({ loading: false });
  },

  closeGame() {
    teardownActiveSession();
    useMapStore.getState().reset();
    recordedRaw = [];
    set({
      gameId: null,
      gameTitle: '',
      transcript: [],
      status: null,
      inputType: null,
      saves: [],
      debugEvents: [],
      recordingFixture: false,
      scoreDelta: null,
    });
  },

  sendCommand(text) {
    activeEngine?.sendCommand(text);
    set((s) => ({ pinRequestId: s.pinRequestId + 1 }));
  },

  sendChar(value) {
    activeEngine?.sendChar(value);
    set((s) => ({ pinRequestId: s.pinRequestId + 1 }));
  },

  restoreNamed(name) {
    set((s) => ({ pendingRestoreName: name, pinRequestId: s.pinRequestId + 1 }));
    activeEngine?.sendCommand('restore');
  },

  async refreshSaves() {
    const { gameId } = get();
    if (!gameId) return;
    const saves = await listSaves(gameId);
    set({ saves });
  },

  async restartPlaythrough() {
    const { gameId } = get();
    if (!gameId) return;
    teardownActiveSession();
    await storageRestartPlaythrough(gameId);
    await get().openGame(gameId);
  },

  async travelTo(path) {
    if (!activeEngine || path.length === 0) return 'completed';
    const engine = activeEngine;
    set((s) => ({ traveling: true, pinRequestId: s.pinRequestId + 1 }));
    try {
      for (const step of path) {
        let bufferedText = '';
        // Each step must fully settle (see engine.ts's own busy/ready queue note)
        // before the next one is sent, so this loop is deliberately sequential.
        const stepResult = await new Promise<'ok' | 'question' | 'char_input'>((resolve) => {
          const unsubscribe = engine.on((event) => {
            const isSilent = 'silent' in event && event.silent;
            if (isSilent) return; // shouldn't happen mid-travel, but never act on it
            if (event.kind === 'buffer_text') {
              bufferedText += event.text;
            } else if (event.kind === 'input_requested') {
              unsubscribe();
              if (event.type === 'char') resolve('char_input');
              else resolve(bufferTextEndsInQuestion(bufferedText) ? 'question' : 'ok');
            }
          });
          engine.sendCommand(step.dir);
        });

        if (stepResult !== 'ok') return stepResult;
        if (useMapStore.getState().graph.currentRoomId !== step.roomId) return 'blocked';
      }
      return 'completed';
    } finally {
      set({ traveling: false });
    }
  },
}));

if (typeof document !== 'undefined') {
  const flush = () => {
    // Best-effort safety net on top of the after-every-turn autosave: only meaningful
    // when the interpreter is actually idle awaiting a line of input.
    if (activeEngine && activeGameId && useEngineStore.getState().inputType === 'line') {
      const gameId = activeGameId;
      const turn = lastKnownTurn;
      void activeEngine
        .saveAutosave()
        .then((bytes) => writeAutosaveGeneration(gameId, bytes, turn))
        .catch(() => {});
    }
  };
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flush();
  });
  window.addEventListener('pagehide', flush);
}
