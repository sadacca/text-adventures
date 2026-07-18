import { describe, expect, it } from 'vitest';
import { createEmptyGraph, type RoomNode } from '../src/map/graph';
import {
  PROBE_DIRECTIONS,
  probeUnexploredDirections,
  unexploredDirections,
  type ProspectEngine,
} from '../src/map/prospect';
import type { GameEvent } from '../src/engine/types';

function mkRoom(id: string, name = id): RoomNode {
  return { id, name, pos: { x: 0, y: 0 }, posLocked: false, flags: {} };
}

describe('prospective mapping: unexploredDirections', () => {
  it('excludes live edges, tombstoned edges, and recorded blockages', () => {
    const graph = createEmptyGraph();
    graph.rooms['hall'] = mkRoom('hall', 'Hall');
    graph.rooms['kitchen'] = mkRoom('kitchen', 'Kitchen');
    graph.edges.push(
      { from: 'hall', to: 'kitchen', dir: 'n', status: 'confirmed' },
      { from: 'hall', to: 'kitchen', dir: 'e', status: 'inferred' },
      { from: 'hall', to: 'kitchen', dir: 'w', status: 'confirmed', userDeleted: true },
    );
    graph.rooms['hall'].blockedDirections = ['s', 'up'];
    graph.currentRoomId = 'hall';

    const dirs = unexploredDirections(graph, 'hall');
    expect(dirs).not.toContain('n'); // confirmed edge
    expect(dirs).not.toContain('e'); // inferred edge still counts as known
    expect(dirs).not.toContain('w'); // tombstoned: user said leave this alone
    expect(dirs).not.toContain('s'); // known blocked
    expect(dirs).not.toContain('up'); // known blocked
    expect(dirs).toEqual(['ne', 'se', 'sw', 'nw', 'down']);
  });

  it('returns nothing for the unknown singleton or a missing room', () => {
    const graph = createEmptyGraph();
    expect(unexploredDirections(graph, 'unknown')).toEqual([]);
    expect(unexploredDirections(graph, 'nope')).toEqual([]);
  });

  it('never proposes in/out', () => {
    expect(PROBE_DIRECTIONS).not.toContain('in');
    expect(PROBE_DIRECTIONS).not.toContain('out');
  });
});

describe('prospective mapping: probeUnexploredDirections', () => {
  it('skips immediately when the room is fully explored (no snapshot taken)', async () => {
    const graph = createEmptyGraph();
    graph.rooms['cell'] = mkRoom('cell', 'Cell');
    graph.rooms['cell'].blockedDirections = [...PROBE_DIRECTIONS];
    graph.currentRoomId = 'cell';

    const sent: string[] = [];
    let snapshots = 0;
    const engine: ProspectEngine = {
      sendCommand: (t) => sent.push(t),
      on: () => () => {},
      saveAutosave: async () => {
        snapshots++;
        return new Uint8Array();
      },
      restoreSnapshot: async () => {},
    };
    const result = await probeUnexploredDirections(
      engine,
      () => graph,
      () => {},
    );
    expect(result).toBe('skipped');
    expect(sent).toEqual([]);
    expect(snapshots).toBe(0);
  });

  it('skips when the engine offers no restoreSnapshot (no rewind, no probing)', async () => {
    const graph = createEmptyGraph();
    graph.rooms['a'] = mkRoom('a', 'A');
    graph.currentRoomId = 'a';
    const sent: string[] = [];
    const engine: ProspectEngine = {
      sendCommand: (t) => sent.push(t),
      on: () => () => {},
      saveAutosave: async () => new Uint8Array(),
    };
    expect(
      await probeUnexploredDirections(
        engine,
        () => graph,
        () => {},
      ),
    ).toBe('skipped');
    expect(sent).toEqual([]);
  });

  it('rewinds a successful probe move and aborts if the rewind does not land on the origin', async () => {
    const graph = createEmptyGraph();
    graph.rooms['a'] = mkRoom('a', 'A');
    graph.rooms['a'].blockedDirections = PROBE_DIRECTIONS.filter((d) => d !== 'n');
    graph.rooms['b'] = mkRoom('b', 'B');
    graph.currentRoomId = 'a';

    const sent: string[] = [];
    let restores = 0;
    let listener: ((e: GameEvent) => void) | null = null;
    const engine: ProspectEngine = {
      sendCommand: (t) => {
        sent.push(t);
        graph.currentRoomId = 'b'; // the probe move lands in b
        queueMicrotask(() =>
          listener?.({ kind: 'input_requested', type: 'line', turn: sent.length }),
        );
      },
      on: (l) => {
        listener = l;
        return () => {
          listener = null;
        };
      },
      saveAutosave: async () => new Uint8Array([1]),
      restoreSnapshot: async () => {
        restores++;
      },
    };
    // onRewound deliberately does NOT reset the graph — simulating a rewind that
    // failed to land back at the origin. The loop must abort, not keep probing.
    const result = await probeUnexploredDirections(
      engine,
      () => graph,
      () => {},
    );
    expect(result).toBe('aborted');
    expect(sent).toEqual(['n']); // stopped immediately after the failed rewind
    expect(restores).toBe(1);
  });

  it('probes all directions when the rewind works, restoring only after real moves', async () => {
    const graph = createEmptyGraph();
    graph.rooms['a'] = mkRoom('a', 'A');
    graph.rooms['a'].blockedDirections = PROBE_DIRECTIONS.filter((d) => d !== 'n' && d !== 'e');
    graph.rooms['b'] = mkRoom('b', 'B');
    graph.currentRoomId = 'a';

    const sent: string[] = [];
    let restores = 0;
    let listener: ((e: GameEvent) => void) | null = null;
    const engine: ProspectEngine = {
      sendCommand: (t) => {
        sent.push(t);
        if (t === 'n') graph.currentRoomId = 'b'; // n moves; e is blocked (no change)
        queueMicrotask(() =>
          listener?.({ kind: 'input_requested', type: 'line', turn: sent.length }),
        );
      },
      on: (l) => {
        listener = l;
        return () => {
          listener = null;
        };
      },
      saveAutosave: async () => new Uint8Array([1]),
      // The real restore rewinds the WORLD silently — the mapper's graph only moves
      // when onRewound re-aligns it, which is exactly what this test verifies.
      restoreSnapshot: async () => {
        restores++;
      },
    };
    const result = await probeUnexploredDirections(
      engine,
      () => graph,
      (roomId) => {
        graph.currentRoomId = roomId;
      },
    );
    expect(result).toBe('completed');
    expect(sent).toEqual(['n', 'e']);
    expect(restores).toBe(1); // only the successful move needed a rewind
  });
});
