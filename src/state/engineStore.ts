import { create } from 'zustand';
import { createEngine } from '../engine/engine.js';
import type { EngineHandle } from '../engine/types.js';
import {
  getGame,
  restartPlaythrough as storageRestartPlaythrough,
  touchLastPlayed,
} from '../storage/games.js';
import { getLatestAutosave, writeAutosaveGeneration } from '../storage/autosaves.js';
import { listSaves, readSave, writeSave, type SaveSummary } from '../storage/saves.js';
import { appendTranscriptEntry, getTranscript } from '../storage/transcripts.js';

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
  return (text.slice(0, startIdx) + text.slice(endIdx + endMarker.length)).replace(
    /\n{3,}/g,
    '\n\n',
  );
}

interface StatusLine {
  left: string;
  right: string;
}

interface EngineState {
  gameId: string | null;
  gameTitle: string;
  transcript: string;
  status: StatusLine | null;
  inputType: 'line' | 'char' | null;
  saves: SaveSummary[];
  loading: boolean;
  error: string | null;
  /** Set by the saves UI just before triggering an in-game RESTORE, so the resulting
   *  fileref prompt resolves to that save instead of asking the player to pick one. */
  pendingRestoreName: string | null;

  openGame: (gameId: string) => Promise<void>;
  closeGame: () => void;
  sendCommand: (text: string) => void;
  restoreNamed: (name: string) => void;
  refreshSaves: () => Promise<void>;
  restartPlaythrough: () => Promise<void>;
}

let activeEngine: EngineHandle | null = null;
let activeCleanup: (() => void) | null = null;
let activeGameId: string | null = null;
let lastKnownTurn = 0;

function teardownActiveSession() {
  activeCleanup?.();
  activeCleanup = null;
  void activeEngine?.stop();
  activeEngine = null;
  activeGameId = null;
  lastKnownTurn = 0;
}

export const useEngineStore = create<EngineState>((set, get) => ({
  gameId: null,
  gameTitle: '',
  transcript: '',
  status: null,
  inputType: null,
  saves: [],
  loading: false,
  error: null,
  pendingRestoreName: null,

  async openGame(gameId) {
    teardownActiveSession();
    set({
      gameId,
      loading: true,
      error: null,
      transcript: '',
      status: null,
      inputType: null,
      saves: [],
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

    const unsubscribeEvents = engine.on((event) => {
      if (event.kind === 'command') {
        pendingCommand = event.text;
        pendingResponseChunks = [];
        return;
      }

      const isSilent = 'silent' in event && event.silent;
      if (isSilent && !resuming) return; // background autosave noise, not for display

      if (event.kind === 'buffer_text') {
        if (!resuming) {
          pendingResponseChunks.push(event.text);
        }
      } else if (event.kind === 'status_line') {
        set({ status: { left: event.left, right: event.right } });
      } else if (isSilent) {
        // resuming, but not text/status (e.g. the resume's own input_requested): ignore.
      } else if (event.kind === 'input_requested' && event.type === 'line') {
        if (!resuming) {
          const response = stripHistoryReplay(pendingResponseChunks.join(''));
          set((s) => ({ transcript: s.transcript + response }));
          void appendTranscriptEntry(gameId, {
            turn: event.turn,
            command: pendingCommand ?? '',
            response,
          });
          pendingCommand = null;
          lastKnownTurn = event.turn;
          if (event.turn > lastAutosaveTurn) {
            lastAutosaveTurn = event.turn;
            void engine
              .saveAutosave()
              .then((bytes) => writeAutosaveGeneration(gameId, bytes, event.turn))
              .catch((err: unknown) => console.error('autosave failed', err));
          }
        }
        set({ inputType: 'line' });
      } else if (event.kind === 'input_requested') {
        set({ inputType: event.type });
      } else if (event.kind === 'quit') {
        set({ inputType: null });
      }
    });

    engine.onNamedSavePrompt(async (kind) => {
      if (kind === 'save') {
        const name = window.prompt('Save as:');
        return name ? { name } : null;
      }
      const preselected = get().pendingRestoreName;
      set({ pendingRestoreName: null });
      const chosen =
        preselected ??
        (() => {
          const names = get().saves.map((s) => s.name);
          if (names.length === 0) {
            window.alert('No saved games yet.');
            return null;
          }
          return window.prompt(`Restore which save?\n${names.join(', ')}`, names[0]);
        })();
      if (!chosen) return null;
      const bytes = await readSave(gameId, chosen);
      if (!bytes) {
        window.alert(`No save named "${chosen}"`);
        return null;
      }
      return { name: chosen, bytes };
    });

    const unsubscribeNamedSave = engine.onNamedSaveWritten((name, bytes) => {
      void writeSave(gameId, name, bytes, lastAutosaveTurn).then(() => get().refreshSaves());
    });

    activeCleanup = () => {
      unsubscribeEvents();
      unsubscribeNamedSave();
    };

    const latestAutosave = await getLatestAutosave(gameId);
    if (latestAutosave) engine.preloadAutosave(latestAutosave.snapshot);
    resuming = latestAutosave !== null;

    await engine.start(new Uint8Array(game.bytes), { autorestore: latestAutosave !== null });
    // By now the whole restore has fully settled — engine.ts's busy/ready queue
    // guarantees start() doesn't resolve early. Rebuild the visible scrollback from our
    // own transcript log (not Bocfel's "history playback", which replays every command
    // it ever saw, autosave noise included).
    if (resuming) {
      const priorEntries = await getTranscript(gameId);
      // No separator/prefix: each stored response already includes its own leading
      // command echo and trailing input prompt (that's how Bocfel formats buffer
      // output), so concatenating them bare reproduces live play exactly.
      const rendered = priorEntries.map((e) => e.response).join('');
      if (rendered) set({ transcript: rendered });
      resuming = false;
    }

    await touchLastPlayed(gameId);
    await get().refreshSaves();
    set({ loading: false });
  },

  closeGame() {
    teardownActiveSession();
    set({
      gameId: null,
      gameTitle: '',
      transcript: '',
      status: null,
      inputType: null,
      saves: [],
    });
  },

  sendCommand(text) {
    activeEngine?.sendCommand(text);
  },

  restoreNamed(name) {
    set({ pendingRestoreName: name });
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
