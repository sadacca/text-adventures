import { afterEach, describe, expect, it, vi } from 'vitest';
import type { EngineHandle, GameEvent } from '../src/engine/types';
import { addOrTouchGame } from '../src/storage/games';
import { getVerbCounts } from '../src/storage/verbStats';

const { createEngine } = vi.hoisted(() => ({ createEngine: vi.fn() }));
vi.mock('../src/engine/engine.js', () => ({ createEngine }));

// Imported *after* the mock is registered, per vitest's hoisting contract.
const { useEngineStore } = await import('../src/state/engineStore');

/** Minimal fake EngineHandle whose sendCommand emits a real 'command' GameEvent, the
 *  only event engineStore's UX-32 counting logic reacts to — no full response/turn
 *  machinery needed (mirrors tests/scoreDelta.test.ts's harness). */
function createFakeEngine() {
  const listeners = new Set<(e: GameEvent) => void>();
  function emit(event: GameEvent) {
    for (const listener of listeners) listener(event);
  }
  const engine: EngineHandle = {
    async start() {
      emit({ kind: 'status_line', left: 'Room', right: '', raw: [], turn: 0 });
      emit({ kind: 'input_requested', type: 'line', turn: 0 });
    },
    sendCommand(text) {
      emit({ kind: 'command', text, turn: 1 });
    },
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
  return { engine, emit };
}

async function setUpGame() {
  const { engine, emit } = createFakeEngine();
  createEngine.mockReturnValue(engine);
  const bytes = new Uint8Array([1, 2, 3, Math.random() * 255]);
  const game = await addOrTouchGame(bytes, 'fixture.z5');
  await useEngineStore.getState().openGame(game.gameId);
  return { gameId: game.gameId, emit };
}

afterEach(() => {
  useEngineStore.getState().closeGame();
  vi.clearAllMocks();
});

describe('UX-32: learned-verb counting', () => {
  it('counts a plausible new verb', async () => {
    const { gameId, emit } = await setUpGame();
    emit({ kind: 'command', text: 'unlock door', turn: 1 });
    await vi.waitFor(async () => {
      expect(await getVerbCounts(gameId)).toEqual({ unlock: 1 });
    });
  });

  it('does not count a direction', async () => {
    const { gameId, emit } = await setUpGame();
    emit({ kind: 'command', text: 'north', turn: 1 });
    await new Promise((r) => setTimeout(r, 10));
    expect(await getVerbCounts(gameId)).toEqual({});
  });

  it('does not count a built-in verb-chip command', async () => {
    const { gameId, emit } = await setUpGame();
    emit({ kind: 'command', text: 'take lamp', turn: 1 });
    await new Promise((r) => setTimeout(r, 10));
    expect(await getVerbCounts(gameId)).toEqual({});
  });

  it('does not count a word outside the loaded vocabulary', async () => {
    const { gameId, emit } = await setUpGame();
    useEngineStore.setState({
      vocabulary: { words: new Set(['unlock']), truncationLength: 6 },
    });
    emit({ kind: 'command', text: 'frobnicate door', turn: 1 });
    await new Promise((r) => setTimeout(r, 10));
    expect(await getVerbCounts(gameId)).toEqual({});
  });

  it('counts a word confirmed in the loaded vocabulary', async () => {
    const { gameId, emit } = await setUpGame();
    useEngineStore.setState({
      vocabulary: { words: new Set(['unlock']), truncationLength: 6 },
    });
    emit({ kind: 'command', text: 'unlock door', turn: 1 });
    await vi.waitFor(async () => {
      expect(await getVerbCounts(gameId)).toEqual({ unlock: 1 });
    });
  });

  it('reveals a learned chip the moment its verb crosses the reveal threshold (3 uses)', async () => {
    const { gameId, emit } = await setUpGame();
    // Real command events can never fire back-to-back without a full turn round-trip in
    // between (the interpreter only accepts one in-flight line at a time — engine.ts's
    // own documented invariant), so each bumpVerb's read-modify-write naturally settles
    // before the next fires. Mirror that here rather than firing all synchronously.
    for (let i = 0; i < 2; i++) {
      emit({ kind: 'command', text: 'unlock door', turn: 1 });
      await vi.waitFor(async () => {
        expect((await getVerbCounts(gameId)).unlock).toBe(i + 1);
      });
    }
    expect(useEngineStore.getState().learnedVerbs).toEqual([]);

    emit({ kind: 'command', text: 'unlock door', turn: 1 });
    await vi.waitFor(() => {
      expect(useEngineStore.getState().learnedVerbs).toEqual(['unlock']);
    });
  });

  it('periodic refresh (every 10th counted command) picks up a verb seeded outside the bump flow', async () => {
    const { gameId, emit } = await setUpGame();
    // Seeded directly (not via bumpVerb, which would itself trigger the threshold-cross
    // refresh) — simulates a verb whose count already cleared the threshold before this
    // session's engineStore ever looked, so only the periodic sweep will surface it.
    const { getDb } = await import('../src/storage/db');
    const db = await getDb();
    await db.put('verbStats', { gameId, counts: { unlock: 5 } });

    // 10 distinct single-use verbs: none crosses the threshold on its own, so only the
    // 10th-command periodic refresh should re-read storage and reveal 'unlock'.
    const verbs = [
      'push',
      'pull',
      'shake',
      'climb',
      'untie',
      'burn',
      'melt',
      'carve',
      'polish',
      'grease',
    ];
    for (const verb of verbs) {
      emit({ kind: 'command', text: `${verb} object`, turn: 1 });
      await vi.waitFor(async () => {
        expect((await getVerbCounts(gameId))[verb]).toBe(1);
      });
    }

    await vi.waitFor(() => {
      expect(useEngineStore.getState().learnedVerbs).toEqual(['unlock']);
    });
  });
});
