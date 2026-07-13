import { afterEach, describe, expect, it, vi } from 'vitest';
import type { EngineHandle, GameEvent } from '../src/engine/types';
import { addOrTouchGame } from '../src/storage/games';
import { computePath } from '../src/map/travel';

const { createEngine } = vi.hoisted(() => ({ createEngine: vi.fn() }));
vi.mock('../src/engine/engine.js', () => ({ createEngine }));

// Imported *after* the mock is registered, per vitest's hoisting contract.
const { useEngineStore } = await import('../src/state/engineStore');
const { useMapStore } = await import('../src/state/mapStore');

interface ScriptedResponse {
  left: string;
  buffer?: string;
  inputType?: 'line' | 'char';
}

/**
 * A fake EngineHandle whose `sendCommand` synchronously emits a scripted response
 * (queued up front by the test) instead of running a real interpreter — this is what
 * makes `engineStore.travelTo`'s step-by-step control flow (SPECS.md §3's tap-to-travel
 * abort conditions) testable deterministically, without depending on any real game's
 * idiosyncratic geography (a live-engine Playwright pass already exercises the real
 * wiring end-to-end; see the outcome notes for Task 1.8).
 */
function createFakeEngine(bootStatus: string) {
  const listeners = new Set<(e: GameEvent) => void>();
  const sentCommands: string[] = [];
  const queue: ScriptedResponse[] = [];
  let turn = 0;

  function emit(event: GameEvent) {
    for (const listener of listeners) listener(event);
  }

  const engine: EngineHandle = {
    async start() {
      emit({ kind: 'status_line', left: bootStatus, right: '', raw: [], turn: 0 });
      emit({ kind: 'input_requested', type: 'line', turn: 0 });
    },
    sendCommand(text) {
      sentCommands.push(text);
      turn += 1;
      emit({ kind: 'command', text, turn });
      const response = queue.shift() ?? { left: bootStatus };
      if (response.buffer) emit({ kind: 'buffer_text', text: response.buffer, turn });
      emit({ kind: 'status_line', left: response.left, right: '', raw: [], turn });
      emit({ kind: 'input_requested', type: response.inputType ?? 'line', turn });
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

  return { engine, sentCommands, queue: (r: ScriptedResponse) => queue.push(r) };
}

async function setUpGame(bootStatus: string) {
  const { engine, sentCommands, queue } = createFakeEngine(bootStatus);
  createEngine.mockReturnValue(engine);
  const bytes = new Uint8Array([1, 2, 3, Math.random() * 255]);
  const game = await addOrTouchGame(bytes, 'fixture.z5');
  await useEngineStore.getState().openGame(game.gameId);
  return { sentCommands, queue };
}

afterEach(() => {
  useEngineStore.getState().closeGame();
  vi.clearAllMocks();
});

describe('engineStore.travelTo', () => {
  it('sends each step in order and completes when every room matches', async () => {
    const { sentCommands, queue } = await setUpGame('Room A');

    // Build a real, bidirectionally-confirmed A<->B edge via actual play (same mechanism
    // Task 1.6's automapper rules use), so the path fed to travelTo is exactly what
    // computePath would really produce, not a hand-guessed room id.
    queue({ left: 'Room B' });
    useEngineStore.getState().sendCommand('n'); // A -n-> B (confirmed), B -s-> A (inferred)
    queue({ left: 'Room A' });
    useEngineStore.getState().sendCommand('s'); // traverses inferred B-s->A -> promotes
    queue({ left: 'Room B' });
    useEngineStore.getState().sendCommand('n'); // back at B, via now-confirmed A-n->B

    const graph = useMapStore.getState().graph;
    const bId = graph.currentRoomId!;
    const aId = Object.keys(graph.rooms).find((id) => id !== bId)!;
    const path = computePath(graph, bId, aId);
    expect(path).toEqual([{ dir: 's', roomId: aId }]);

    queue({ left: 'Room A' });
    const result = await useEngineStore.getState().travelTo(path!);

    expect(result).toBe('completed');
    expect(sentCommands.at(-1)).toBe('s');
    expect(useMapStore.getState().graph.currentRoomId).toBe(aId);
    expect(useEngineStore.getState().traveling).toBe(false);
  });

  it('aborts with "blocked" when a step lands somewhere other than expected', async () => {
    const { queue } = await setUpGame('Room A');
    queue({ left: 'Room B' });
    useEngineStore.getState().sendCommand('n');
    queue({ left: 'Room A' });
    useEngineStore.getState().sendCommand('s');

    const graph = useMapStore.getState().graph;
    const aId = graph.currentRoomId!;
    const bId = Object.keys(graph.rooms).find((id) => id !== aId)!;
    const path = computePath(graph, aId, bId)!;

    // Something unexpected happens mid-trip (combat, locked door): the room actually
    // reached isn't the one the map predicted.
    queue({ left: 'Somewhere Else' });
    const result = await useEngineStore.getState().travelTo(path);

    expect(result).toBe('blocked');
    expect(useEngineStore.getState().traveling).toBe(false);
  });

  it('aborts with "question" when the response contains a line ending in "?"', async () => {
    const { queue } = await setUpGame('Room A');
    queue({ left: 'Room B' });
    useEngineStore.getState().sendCommand('n');
    queue({ left: 'Room A' });
    useEngineStore.getState().sendCommand('s');

    const graph = useMapStore.getState().graph;
    const aId = graph.currentRoomId!;
    const bId = Object.keys(graph.rooms).find((id) => id !== aId)!;
    const path = computePath(graph, aId, bId)!;

    queue({ left: 'Room B', buffer: 'Are you sure you want to proceed?' });
    const result = await useEngineStore.getState().travelTo(path);

    expect(result).toBe('question');
  });

  it('aborts with "char_input" when the next prompt wants a keypress, not a line', async () => {
    const { queue } = await setUpGame('Room A');
    queue({ left: 'Room B' });
    useEngineStore.getState().sendCommand('n');
    queue({ left: 'Room A' });
    useEngineStore.getState().sendCommand('s');

    const graph = useMapStore.getState().graph;
    const aId = graph.currentRoomId!;
    const bId = Object.keys(graph.rooms).find((id) => id !== aId)!;
    const path = computePath(graph, aId, bId)!;

    queue({ left: 'Room B', inputType: 'char' });
    const result = await useEngineStore.getState().travelTo(path);

    expect(result).toBe('char_input');
  });

  it('completes immediately without sending anything for an empty path', async () => {
    await setUpGame('Room A');
    const result = await useEngineStore.getState().travelTo([]);
    expect(result).toBe('completed');
    expect(useEngineStore.getState().traveling).toBe(false);
  });
});
