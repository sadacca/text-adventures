import { afterEach, describe, expect, it, vi } from 'vitest';
import type { EngineHandle, GameEvent } from '../src/engine/types';
import { addOrTouchGame } from '../src/storage/games';
import { getLatestAutosave, writeAutosaveGeneration } from '../src/storage/autosaves';
import { appendTranscriptEntry, getTranscript } from '../src/storage/transcripts';

const { createEngine } = vi.hoisted(() => ({ createEngine: vi.fn() }));
vi.mock('../src/engine/engine.js', () => ({ createEngine }));

// Imported *after* the mock is registered, per vitest's hoisting contract.
const { useEngineStore } = await import('../src/state/engineStore');
const { useDialogStore } = await import('../src/state/dialogStore');

/** Minimal fake EngineHandle — same style as tests/autoResume.test.ts's createFakeEngine,
 *  trimmed to what undoLastMove's reboot-via-openGame() actually touches. */
function createFakeEngine(): EngineHandle {
  const listeners = new Set<(e: GameEvent) => void>();
  return {
    async start() {
      for (const listener of listeners) {
        listener({ kind: 'status_line', left: 'Room', right: '', raw: [], turn: 0 });
        listener({ kind: 'input_requested', type: 'line', turn: 0 });
      }
    },
    sendCommand() {},
    sendChar() {},
    on(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    onRaw() {
      return () => {};
    },
    async saveAutosave() {
      return new Uint8Array();
    },
    async stop() {
      listeners.clear();
    },
    preloadAutosave() {},
    onNamedSavePrompt() {},
    onNamedSaveWritten() {
      return () => {};
    },
  };
}

afterEach(() => {
  useEngineStore.getState().closeGame();
  vi.clearAllMocks();
});

describe('UX-22: undoLastMove', () => {
  it('rewinds storage to the prior generation and reopens the game', async () => {
    createEngine.mockReturnValue(createFakeEngine());
    const game = await addOrTouchGame(new Uint8Array([1, 2, 3]), 'fixture.z5');
    await writeAutosaveGeneration(game.gameId, new Uint8Array([1]), 1);
    await writeAutosaveGeneration(game.gameId, new Uint8Array([2]), 2);
    await appendTranscriptEntry(game.gameId, { turn: 1, command: 'n', response: 'Room 1' });
    await appendTranscriptEntry(game.gameId, { turn: 2, command: 's', response: 'Room 2' });

    useEngineStore.setState({ gameId: game.gameId });
    await useEngineStore.getState().undoLastMove();

    const latest = await getLatestAutosave(game.gameId);
    expect(latest?.turn).toBe(1);
    expect(latest?.snapshot).toEqual(new Uint8Array([1]));

    const transcript = await getTranscript(game.gameId);
    expect(transcript.map((e) => e.turn)).toEqual([1]);

    expect(createEngine).toHaveBeenCalledTimes(1);
    expect(useEngineStore.getState().gameId).toBe(game.gameId);
  });

  it('alerts and does nothing when there is nothing to undo yet', async () => {
    const game = await addOrTouchGame(new Uint8Array([4, 5, 6]), 'fixture2.z5');
    await writeAutosaveGeneration(game.gameId, new Uint8Array([1]), 1);

    useEngineStore.setState({ gameId: game.gameId });
    const undoPromise = useEngineStore.getState().undoLastMove();

    await vi.waitFor(() => {
      expect(useDialogStore.getState().active).toMatchObject({ title: 'Nothing to undo yet.' });
    });
    useDialogStore.getState().settle(true);
    await undoPromise;

    expect(createEngine).not.toHaveBeenCalled();
    const latest = await getLatestAutosave(game.gameId);
    expect(latest?.turn).toBe(1);
  });
});
