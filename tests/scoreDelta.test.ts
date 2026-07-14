import { afterEach, describe, expect, it, vi } from 'vitest';
import type { EngineHandle, GameEvent } from '../src/engine/types';
import { addOrTouchGame } from '../src/storage/games';

const { createEngine } = vi.hoisted(() => ({ createEngine: vi.fn() }));
vi.mock('../src/engine/engine.js', () => ({ createEngine }));

// Imported *after* the mock is registered, per vitest's hoisting contract.
const { useEngineStore } = await import('../src/state/engineStore');

/**
 * UX-11: a minimal fake EngineHandle whose only job is letting the test fire
 * `status_line` events directly and observe `scoreDelta` — no travel/transcript
 * machinery needed (see `tests/travelTo.test.ts` for that fuller harness).
 */
function createFakeEngine(bootRight = 'Score: 0  Moves: 0') {
  const listeners = new Set<(e: GameEvent) => void>();
  function emit(event: GameEvent) {
    for (const listener of listeners) listener(event);
  }
  const engine: EngineHandle = {
    async start() {
      emit({ kind: 'status_line', left: 'Room A', right: bootRight, raw: [], turn: 0 });
      emit({ kind: 'input_requested', type: 'line', turn: 0 });
    },
    sendCommand(text) {
      emit({ kind: 'command', text, turn: 1 });
    },
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
  return { engine, emit };
}

async function setUpGame(bootRight?: string) {
  const { engine, emit } = createFakeEngine(bootRight);
  createEngine.mockReturnValue(engine);
  const bytes = new Uint8Array([1, 2, 3, Math.random() * 255]);
  const game = await addOrTouchGame(bytes, 'fixture.z5');
  await useEngineStore.getState().openGame(game.gameId);
  return emit;
}

afterEach(() => {
  useEngineStore.getState().closeGame();
  vi.clearAllMocks();
});

describe('engineStore scoreDelta', () => {
  it('sets scoreDelta with the increase amount when the score goes up, retriggering on each rise', async () => {
    const emit = await setUpGame();

    emit({ kind: 'status_line', left: 'Room A', right: 'Score: 10  Moves: 3', raw: [], turn: 1 });
    expect(useEngineStore.getState().scoreDelta?.amount).toBe(10);
    const firstId = useEngineStore.getState().scoreDelta!.id;

    emit({ kind: 'status_line', left: 'Room A', right: 'Score: 15  Moves: 4', raw: [], turn: 2 });
    expect(useEngineStore.getState().scoreDelta?.amount).toBe(5);
    expect(useEngineStore.getState().scoreDelta!.id).not.toBe(firstId);
  });

  it('does not toast when the score is unchanged or drops', async () => {
    const emit = await setUpGame();

    emit({ kind: 'status_line', left: 'Room A', right: 'Score: 10  Moves: 3', raw: [], turn: 1 });
    useEngineStore.setState({ scoreDelta: null });

    emit({ kind: 'status_line', left: 'Room A', right: 'Score: 10  Moves: 4', raw: [], turn: 2 });
    expect(useEngineStore.getState().scoreDelta).toBeNull();

    emit({ kind: 'status_line', left: 'Room A', right: 'Score: 5  Moves: 5', raw: [], turn: 3 });
    expect(useEngineStore.getState().scoreDelta).toBeNull();
  });

  it('resets the score baseline on a fresh openGame, so a new game never compares against the last one', async () => {
    const emitA = await setUpGame();
    emitA({ kind: 'status_line', left: 'Room A', right: 'Score: 2  Moves: 1', raw: [], turn: 1 });
    expect(useEngineStore.getState().scoreDelta?.amount).toBe(2);

    // Game B's boot status has no digits (simulates a "Loading…" style left/right before
    // the first real score is known) — without the reset, this first real score reading
    // would wrongly diff against game A's leftover baseline of 2 instead of being treated
    // as the new game's first sighting.
    const emitB = await setUpGame('Loading…');
    emitB({ kind: 'status_line', left: 'Room A', right: 'Score: 5  Moves: 1', raw: [], turn: 1 });
    expect(useEngineStore.getState().scoreDelta).toBeNull();
  });
});
