import { afterEach, describe, expect, it, vi } from 'vitest';
import type { EngineHandle, GameEvent } from '../src/engine/types';
import { addOrTouchGame } from '../src/storage/games';
import { listSaves, readSave } from '../src/storage/saves';

const { createEngine } = vi.hoisted(() => ({ createEngine: vi.fn() }));
vi.mock('../src/engine/engine.js', () => ({ createEngine }));

// Imported *after* the mock is registered, per vitest's hoisting contract.
const { useEngineStore } = await import('../src/state/engineStore');

const CHECKPOINT_BYTES = new Uint8Array([9, 9, 9]);

/** Minimal fake EngineHandle — same style as tests/undoLastMove.test.ts's, with
 *  saveAutosave returning fixed bytes so the checkpoint's Quetzal snapshot is
 *  deterministic. */
function createFakeEngine(): EngineHandle {
  const listeners = new Set<(e: GameEvent) => void>();
  return {
    async start() {
      for (const listener of listeners) {
        listener({ kind: 'status_line', left: 'West of House', right: '', raw: [], turn: 0 });
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
      return CHECKPOINT_BYTES;
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

describe('UX-30: saveCheckpoint', () => {
  it('writes a named save starting with "Checkpoint" and shows it via listSaves', async () => {
    createEngine.mockReturnValue(createFakeEngine());
    const game = await addOrTouchGame(new Uint8Array([1, 2, 3]), 'fixture.z5');
    await useEngineStore.getState().openGame(game.gameId);

    await useEngineStore.getState().saveCheckpoint();

    const saves = await listSaves(game.gameId);
    expect(saves).toHaveLength(1);
    expect(saves[0].name).toMatch(/^Checkpoint — West of House — turn 0$/);
    expect(await readSave(game.gameId, saves[0].name)).toEqual(CHECKPOINT_BYTES);
    expect(useEngineStore.getState().saves.map((s) => s.name)).toEqual([saves[0].name]);
  });

  it('dedupes a repeat checkpoint at the same turn with a " (2)" suffix', async () => {
    createEngine.mockReturnValue(createFakeEngine());
    const game = await addOrTouchGame(new Uint8Array([4, 5, 6]), 'fixture2.z5');
    await useEngineStore.getState().openGame(game.gameId);

    await useEngineStore.getState().saveCheckpoint();
    await useEngineStore.getState().saveCheckpoint();

    const names = (await listSaves(game.gameId)).map((s) => s.name).sort();
    expect(names).toEqual([
      'Checkpoint — West of House — turn 0',
      'Checkpoint — West of House — turn 0 (2)',
    ]);
  });

  it('bumps checkpointSaved so StoryScreen can toast, retriggering on repeat', async () => {
    createEngine.mockReturnValue(createFakeEngine());
    const game = await addOrTouchGame(new Uint8Array([7, 8, 9]), 'fixture3.z5');
    await useEngineStore.getState().openGame(game.gameId);

    await useEngineStore.getState().saveCheckpoint();
    const first = useEngineStore.getState().checkpointSaved;
    expect(first).not.toBeNull();

    await useEngineStore.getState().saveCheckpoint();
    expect(useEngineStore.getState().checkpointSaved?.id).not.toBe(first?.id);
  });

  it('no-ops when no game is open', async () => {
    await useEngineStore.getState().saveCheckpoint();
    expect(useEngineStore.getState().checkpointSaved).toBeNull();
  });
});
