import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { EngineHandle, GameEvent } from '../src/engine/types';
import { addOrTouchGame } from '../src/storage/games';
import { writeAutosaveGeneration } from '../src/storage/autosaves';
import { appendTranscriptEntry } from '../src/storage/transcripts';
import { getDb } from '../src/storage/db';

const { createEngine } = vi.hoisted(() => ({ createEngine: vi.fn() }));
vi.mock('../src/engine/engine.js', () => ({ createEngine }));

// Imported *after* the mock is registered, per vitest's hoisting contract.
const { useEngineStore } = await import('../src/state/engineStore');
const { useUiStore } = await import('../src/state/uiStore');
const { autoResumeLastGame, resetAutoResumeForTests } = await import('../src/state/autoResume');

/** Minimal fake EngineHandle — same style as tests/travelTo.test.ts's createFakeEngine,
 *  trimmed to what a boot-time openGame() actually touches. */
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

beforeEach(() => {
  resetAutoResumeForTests();
});

afterEach(() => {
  useEngineStore.getState().closeGame();
  vi.clearAllMocks();
});

describe('autoResumeLastGame', () => {
  it('stays on the Library with no games at all', async () => {
    await autoResumeLastGame();
    expect(useUiStore.getState().tab).toBe('library');
    expect(useEngineStore.getState().gameId).toBeNull();
  });

  it('stays on the Library when the most recent game has no autosave', async () => {
    await addOrTouchGame(new Uint8Array([1, 2, 3]), 'fixture.z5');
    await autoResumeLastGame();
    expect(useUiStore.getState().tab).toBe('library');
    expect(useEngineStore.getState().gameId).toBeNull();
  });

  it('opens the Story tab on the most recent game when it has a live autosave', async () => {
    createEngine.mockReturnValue(createFakeEngine());
    const game = await addOrTouchGame(new Uint8Array([1, 2, 3]), 'fixture.z5');
    await writeAutosaveGeneration(game.gameId, new Uint8Array([1]), 1);

    await autoResumeLastGame();
    expect(useUiStore.getState().tab).toBe('story');
    expect(useEngineStore.getState().gameId).toBe(game.gameId);
  });

  it('only ever opens once per boot, even if called again without the test reset', async () => {
    createEngine.mockReturnValue(createFakeEngine());
    const game = await addOrTouchGame(new Uint8Array([1, 2, 3]), 'fixture.z5');
    await writeAutosaveGeneration(game.gameId, new Uint8Array([1]), 1);

    await autoResumeLastGame();
    await autoResumeLastGame();
    expect(createEngine).toHaveBeenCalledTimes(1);
  });
});

describe('UX-25: away-gap resume recap', () => {
  async function setLastPlayedAt(gameId: string, timestamp: number) {
    const db = await getDb();
    const record = await db.get('games', gameId);
    if (!record) throw new Error('game not found');
    await db.put('games', { ...record, lastPlayedAt: timestamp });
  }

  it('sets recapEntries to the last 3 commands after a real away-gap', async () => {
    createEngine.mockReturnValue(createFakeEngine());
    const game = await addOrTouchGame(new Uint8Array([1, 2, 3]), 'fixture.z5');
    await writeAutosaveGeneration(game.gameId, new Uint8Array([1]), 4);
    await appendTranscriptEntry(game.gameId, { turn: 1, command: 'n', response: 'North' });
    await appendTranscriptEntry(game.gameId, { turn: 2, command: 'e', response: 'East' });
    await appendTranscriptEntry(game.gameId, { turn: 3, command: 's', response: 'South' });
    await appendTranscriptEntry(game.gameId, { turn: 4, command: 'w', response: 'West' });
    await setLastPlayedAt(game.gameId, Date.now() - 2 * 24 * 60 * 60 * 1000);

    await useEngineStore.getState().openGame(game.gameId);

    expect(useEngineStore.getState().recapEntries).toEqual([
      { command: 'e', response: 'East' },
      { command: 's', response: 'South' },
      { command: 'w', response: 'West' },
    ]);
  });

  it('stays null when lastPlayedAt is recent', async () => {
    createEngine.mockReturnValue(createFakeEngine());
    const game = await addOrTouchGame(new Uint8Array([1, 2, 3]), 'fixture.z5');
    await writeAutosaveGeneration(game.gameId, new Uint8Array([1]), 1);
    await appendTranscriptEntry(game.gameId, { turn: 1, command: 'n', response: 'North' });
    await setLastPlayedAt(game.gameId, Date.now() - 5 * 60 * 1000);

    await useEngineStore.getState().openGame(game.gameId);

    expect(useEngineStore.getState().recapEntries).toBeNull();
  });

  it('sendCommand clears an active recap', async () => {
    createEngine.mockReturnValue(createFakeEngine());
    const game = await addOrTouchGame(new Uint8Array([1, 2, 3]), 'fixture.z5');
    await writeAutosaveGeneration(game.gameId, new Uint8Array([1]), 1);
    await appendTranscriptEntry(game.gameId, { turn: 1, command: 'n', response: 'North' });
    await setLastPlayedAt(game.gameId, Date.now() - 2 * 24 * 60 * 60 * 1000);

    await useEngineStore.getState().openGame(game.gameId);
    expect(useEngineStore.getState().recapEntries).not.toBeNull();

    useEngineStore.getState().sendCommand('look');
    expect(useEngineStore.getState().recapEntries).toBeNull();
  });
});
