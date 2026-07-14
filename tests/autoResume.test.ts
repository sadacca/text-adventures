import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { EngineHandle, GameEvent } from '../src/engine/types';
import { addOrTouchGame } from '../src/storage/games';
import { writeAutosaveGeneration } from '../src/storage/autosaves';

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
