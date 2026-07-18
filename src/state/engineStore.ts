import { create } from 'zustand';
import { createEngine } from '../engine/engine.js';
import { parseVocabulary, isVocabWord, type Vocabulary } from '../engine/dictionary.js';
import type { RawMessage } from '../engine/protocol-tap.js';
import type { EngineHandle, GameEvent } from '../engine/types.js';
import {
  getGame,
  restartPlaythrough as storageRestartPlaythrough,
  touchLastPlayed,
} from '../storage/games.js';
import {
  getLatestAutosave,
  stepBackAutosaveGeneration,
  writeAutosaveGeneration,
} from '../storage/autosaves.js';
import { listSaves, readSave, writeSave, type SaveSummary } from '../storage/saves.js';
import {
  appendTranscriptEntry,
  getTranscript,
  trimTranscriptAfterTurn,
} from '../storage/transcripts.js';
import type { TranscriptEntry } from '../storage/db.js';
import { bufferTextEndsInQuestion, type TravelStep } from '../map/travel.js';
import { probeUnexploredDirections } from '../map/prospect.js';
import { normalizeDirection } from '../map/directions.js';
import { useMapStore } from './mapStore.js';
import { useUiStore } from './uiStore.js';
import { useDialogStore } from './dialogStore.js';
import { detectUnknownWord } from '../story/oops.js';
import { detectDeath } from '../story/death.js';
import { appendScoreEntry } from '../storage/scoreLog.js';
import { bumpVerb, getVerbCounts } from '../storage/verbStats.js';
import { VERBS } from '../story/verbs.js';

/** UX-32: recompute learnedVerbs after this many newly-counted commands, not per
 *  keystroke/command. */
const LEARNED_VERBS_REFRESH_INTERVAL = 10;
/** UX-32: only surface a learned verb once it's been used at least this many times. */
const LEARNED_VERB_MIN_COUNT = 3;
/** UX-32: at most this many learned chips render, appended to the built-in row. */
const LEARNED_VERBS_LIMIT = 3;

const BUILTIN_VERB_COMMANDS = new Set(VERBS.map((v) => v.command));

/** UX-32: top learnedVerbs by count (ties broken alphabetically for determinism). */
function topLearnedVerbs(counts: Record<string, number>): string[] {
  return Object.entries(counts)
    .filter(([, count]) => count >= LEARNED_VERB_MIN_COUNT)
    .sort(([verbA, countA], [verbB, countB]) => countB - countA || verbA.localeCompare(verbB))
    .slice(0, LEARNED_VERBS_LIMIT)
    .map(([verb]) => verb);
}

/** DebugConsole's live event feed (Task 1.4): capped so a long session can't leak memory. */
const DEBUG_EVENT_LIMIT = 300;

/** Task 1.8 tap-to-travel outcome, per SPECS.md §3's abort conditions. */
export type TravelResult = 'completed' | 'blocked' | 'question' | 'char_input';

/** UX-25: how long since `lastPlayedAt` counts as a real away-gap worth recapping,
 *  rather than e.g. a quick tab switch. */
const RECAP_GAP_MS = 12 * 60 * 60 * 1000;

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
   *  manual command mid-trip. Prospective mapping (probeExits) also raises this for
   *  the duration of a probe burst, for the same reason: a player command interleaved
   *  between a probe move and its /undo would run in a room the player isn't "really"
   *  in, then get rewound. */
  traveling: boolean;

  /** 2026-07-17, prospective mapping: true while probeExits is quietly scouting the
   *  current room (move + /undo per unexplored direction). Probe turns are kept out of
   *  the transcript, autosaves, and score tracking — see the probing checks in the
   *  event handler. */
  probing: boolean;
  /** Probes the current room's unexplored compass directions (see map/prospect.ts).
   *  No-ops unless idle at a line prompt. Triggered automatically after each settled
   *  turn while the prospectiveMapping setting is on. */
  probeExits: () => Promise<void>;

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

  /** UX-19: the current game's parser dictionary, parsed once on open; null if parsing
   *  failed (corrupt/unsupported file) or no game is open. */
  vocabulary: Vocabulary | null;

  /** UX-25: set by openGame when resuming after a real away-gap (>= RECAP_GAP_MS since
   *  lastPlayedAt), so StoryScreen can show the recap card. Cleared by dismissal or by
   *  sending any command. Session-only. */
  recapEntries: { command: string; response: string }[] | null;
  dismissRecap: () => void;

  /** UX-27: the word a parser error said it didn't understand (quoted, narrowly
   *  detected — see story/oops.ts), so CommandBar/TapWords can offer an `oops <word>`
   *  fix-up. Cleared by any subsequent command. Session-only. */
  oopsWord: string | null;

  /** UX-28: true when the most recently committed response contained a classic
   *  death/ending banner (see story/death.ts), so StoryScreen can offer an inline Undo
   *  shortcut. Cleared by any subsequent command. Session-only. */
  deathDetected: boolean;

  /** UX-30: bumped by saveCheckpoint() so StoryScreen can show a "⚑ Saved" toast (same
   *  retrigger-on-repeat pattern as scoreDelta's id counter). Session-only. */
  checkpointSaved: { id: number } | null;

  /** UX-32: top learned verbs (count >= LEARNED_VERB_MIN_COUNT) for this game, loaded
   *  once on openGame and refreshed lazily every LEARNED_VERBS_REFRESH_INTERVALth
   *  counted command — see the module-level counting logic. Session-only (the durable
   *  data lives in storage/verbStats.ts). */
  learnedVerbs: string[];

  openGame: (gameId: string) => Promise<void>;
  closeGame: () => void;
  sendCommand: (text: string) => void;
  /** UX-14: answers a `char`-type input_requested ("press any key" prompts, menus). */
  sendChar: (value: string) => void;
  restoreNamed: (name: string) => void;
  refreshSaves: () => Promise<void>;
  restartPlaythrough: () => Promise<void>;
  /** UX-22: rewinds to the autosave generation one move before the current one (see
   *  storage/autosaves.ts's stepBackAutosaveGeneration) and reboots the engine against
   *  it — the same teardown-and-reopen path restartPlaythrough uses, just without
   *  wiping the playthrough. No-ops with an alert if there's nothing to step back to. */
  undoLastMove: () => Promise<void>;
  /** UX-30: snapshots the current state under an auto-generated name via the same
   *  Quetzal-producing engine.saveAutosave() the per-turn autosave uses (NOT the
   *  in-game SAVE command, which would round-trip through the game's own prompt) —
   *  written as a named save, so it survives in More's saves list and restores through
   *  the existing restoreNamed flow. No-ops if no game is open. */
  saveCheckpoint: () => Promise<void>;
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
let checkpointSavedCounter = 0;
/** UX-32: newly-counted (bumped) commands since the last learnedVerbs refresh. */
let countedVerbsSinceRefresh = 0;
/** Prospective mapping: module-level twin of the `probing` state, readable inside the
 *  engine event handler without a store round-trip. While true, events still feed the
 *  automapper (that's the whole point) but never the transcript/autosave/score paths. */
let probeActive = false;
/** Commands the player typed while a probe burst was running. Sending them straight to
 *  the engine would interleave them between a probe move and its /undo — they'd execute
 *  in a room the player isn't really in, then get rewound. Instead they cancel the
 *  burst (probeCancelRequested) and replay, in order, once it has fully unwound. */
let stashedDuringProbe: string[] = [];
let probeCancelRequested = false;

function teardownActiveSession() {
  activeCleanup?.();
  activeCleanup = null;
  void activeEngine?.stop();
  activeEngine = null;
  activeGameId = null;
  lastKnownTurn = 0;
  previousScore = null;
  countedVerbsSinceRefresh = 0;
  probeActive = false;
  stashedDuringProbe = [];
  probeCancelRequested = false;
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
  vocabulary: null,
  recapEntries: null,
  dismissRecap() {
    set({ recapEntries: null });
  },
  oopsWord: null,
  deathDetected: false,
  checkpointSaved: null,
  learnedVerbs: [],

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
      vocabulary: null,
      recapEntries: null,
      oopsWord: null,
      deathDetected: false,
      checkpointSaved: null,
      learnedVerbs: [],
      traveling: false,
      probing: false,
    });

    const game = await getGame(gameId);
    if (!game) {
      set({ loading: false, error: 'Game not found' });
      return;
    }
    // UX-25: captured before touchLastPlayed (below) overwrites it.
    const lastPlayedAtBeforeTouch = game.lastPlayedAt;
    set({ gameTitle: game.title });
    set({ vocabulary: parseVocabulary(new Uint8Array(game.bytes)) });
    void getVerbCounts(gameId).then((counts) => set({ learnedVerbs: topLearnedVerbs(counts) }));

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

      // Prospective mapping: a probe turn feeds the automapper (above) and nothing
      // else — its prose, status flicker, score changes, and autosaves must never
      // reach the player or storage, because the closing /undo restores the exact
      // pre-probe world state. Only input_requested's TYPE passes through, so an
      // unexpected char prompt (which aborts the probe loop) is reflected in the UI.
      if (probeActive) {
        if (event.kind === 'input_requested') set({ inputType: event.type });
        return;
      }

      if (event.kind === 'command') {
        pendingCommand = event.text;
        pendingResponseChunks = [];
        set({ oopsWord: null, deathDetected: false });

        // UX-32: learn verbs from the player's own successful usage — never a direction,
        // never a built-in chip verb, never a non-vocab typo (when a vocabulary is
        // loaded at all).
        const firstWord = event.text.trim().split(/\s+/)[0]?.toLowerCase();
        const vocab = get().vocabulary;
        if (
          firstWord &&
          firstWord.length >= 3 &&
          !BUILTIN_VERB_COMMANDS.has(firstWord) &&
          normalizeDirection(firstWord) === null &&
          (vocab === null || isVocabWord(firstWord, vocab))
        ) {
          countedVerbsSinceRefresh += 1;
          const dueForPeriodicRefresh = countedVerbsSinceRefresh >= LEARNED_VERBS_REFRESH_INTERVAL;
          if (dueForPeriodicRefresh) countedVerbsSinceRefresh = 0;
          void bumpVerb(gameId, firstWord).then((newCount) => {
            // Refresh immediately the moment a verb first crosses the reveal threshold
            // (the common case a player actually notices), not just on the periodic
            // every-Nth-command cadence, which exists to avoid a DB read on every single
            // command once the list has already settled.
            if (dueForPeriodicRefresh || newCount === LEARNED_VERB_MIN_COUNT) {
              void getVerbCounts(gameId).then((counts) =>
                set({ learnedVerbs: topLearnedVerbs(counts) }),
              );
            }
          });
        }
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
            const amount = score - previousScore;
            set({ scoreDelta: { amount, id: scoreDeltaCounter } });
            // UX-29: pendingCommand is still the command that led to this status_line
            // (input_requested, which clears it, hasn't run yet for this turn).
            void appendScoreEntry(gameId, {
              turn: event.turn,
              amount,
              command: pendingCommand ?? '',
              room: event.left,
            });
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
            // UX-27: a char prompt can't accept an `oops` line, so only line requests
            // are worth detecting against.
            if (event.type === 'line') {
              set({ oopsWord: detectUnknownWord(response), deathDetected: detectDeath(response) });
            }
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
        // Prospective mapping: the player's turn has fully settled — quietly scout the
        // current room's unexplored directions. Called synchronously (probeExits CLAIMS
        // the engine — probing/traveling — before this dispatch ends) so no player
        // command can slip in between the turn settling and the burst starting; the
        // burst's first actual engine command is deferred internally. No-ops when the
        // room is already fully scouted, so this is free on revisits.
        if (
          !resuming &&
          event.type === 'line' &&
          useUiStore.getState().prospectiveMapping &&
          !get().traveling
        ) {
          void get().probeExits();
        }
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
    let priorEntries: TranscriptEntry[] = [];
    if (resuming) {
      priorEntries = await getTranscript(gameId);
      const rendered = priorEntries.map((e) => e.response).filter(Boolean);
      if (rendered.length > 0) set({ transcript: rendered });
      resuming = false;
    }

    // UX-25: an away-gap recap, assembled from data already fetched above — no extra
    // reads. Only when there was a real autosave to resume from, the gap was long enough
    // to be worth recapping, and there's at least one transcript entry to show.
    if (
      latestAutosave !== null &&
      Date.now() - lastPlayedAtBeforeTouch >= RECAP_GAP_MS &&
      priorEntries.length > 0
    ) {
      const recap = priorEntries
        .slice(-3)
        .filter((e) => e.command.trim() !== '')
        .map((e) => ({ command: e.command, response: e.response }));
      if (recap.length > 0) set({ recapEntries: recap });
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
      vocabulary: null,
      recapEntries: null,
      oopsWord: null,
      deathDetected: false,
      checkpointSaved: null,
      learnedVerbs: [],
      traveling: false,
      probing: false,
    });
  },

  sendCommand(text) {
    if (probeActive) {
      // Mid-probe-burst: don't hand this to the engine yet (it would run between a
      // probe move and its /undo). Cancel the burst and replay once it unwinds.
      stashedDuringProbe.push(text);
      probeCancelRequested = true;
      set((s) => ({ pinRequestId: s.pinRequestId + 1, recapEntries: null }));
      return;
    }
    activeEngine?.sendCommand(text);
    set((s) => ({ pinRequestId: s.pinRequestId + 1, recapEntries: null }));
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

  async undoLastMove() {
    const { gameId } = get();
    if (!gameId) return;
    const previous = await stepBackAutosaveGeneration(gameId);
    if (!previous) {
      await useDialogStore.getState().ask({ kind: 'alert', title: 'Nothing to undo yet.' });
      return;
    }
    await trimTranscriptAfterTurn(gameId, previous.turn);
    await get().openGame(gameId);
  },

  async saveCheckpoint() {
    const { gameId, status } = get();
    if (!gameId || !activeEngine) return;
    const baseName = `Checkpoint — ${status?.left ?? 'Unknown'} — turn ${lastKnownTurn}`;
    const existingNames = new Set((await listSaves(gameId)).map((s) => s.name));
    let name = baseName;
    for (let n = 2; existingNames.has(name); n++) name = `${baseName} (${n})`;
    const bytes = await activeEngine.saveAutosave();
    await writeSave(gameId, name, bytes, lastKnownTurn);
    await get().refreshSaves();
    checkpointSavedCounter += 1;
    set({ checkpointSaved: { id: checkpointSavedCounter } });
  },

  probing: false,

  async probeExits() {
    const engine = activeEngine;
    if (!engine || probeActive) return;
    if (get().traveling || get().inputType !== 'line' || !get().gameId) return;
    // A command already in flight or queued (fast typist, engine mid-drain) means the
    // world is about to change — probing now would scout a stale origin and swallow
    // that command's turn. Skip; the trigger fires again when that turn settles.
    if (engine.isBusy?.()) return;
    // Probe commands churn mapStore's lastMoveDir (UX-26) as they flow through the
    // automapper; snapshot the player's own last move and restore it after.
    const savedLastMoveDir = useMapStore.getState().lastMoveDir;
    // Everything above and including this claim is SYNCHRONOUS from the caller's
    // perspective — when triggered from the settled turn's own event dispatch, the
    // engine is reserved before any other code (or keystroke) can act on that turn.
    probeActive = true;
    probeCancelRequested = false;
    set({ probing: true, traveling: true });
    try {
      // Escape the event-dispatch stack before the first engine command: a dispatch
      // issued from inside a GlkOte update cycle is dropped by its waiting_for_update
      // guard. A microtask runs only once the current stack has fully unwound.
      await Promise.resolve();
      await probeUnexploredDirections(
        engine,
        () => useMapStore.getState().graph,
        (roomId) => useMapStore.getState().resetCurrentRoom(roomId),
        () => !probeCancelRequested,
      );
    } finally {
      probeActive = false;
      probeCancelRequested = false;
      set({ probing: false, traveling: false });
      useMapStore.setState({ lastMoveDir: savedLastMoveDir });
      // Replay anything the player typed during the burst, now that the world is back
      // in the room they thought they were in. Engine-level queueing keeps the order.
      const stashed = stashedDuringProbe;
      stashedDuringProbe = [];
      for (const text of stashed) engine.sendCommand(text);
    }
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
      // Travel steps suppress the per-turn probe trigger (traveling gate), so scout
      // the destination once the trip is over. probeExits claims synchronously and
      // defers its own first engine command, so no extra deferral here.
      if (useUiStore.getState().prospectiveMapping) {
        void get().probeExits();
      }
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
