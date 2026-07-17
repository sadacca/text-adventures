import { describe, expect, it } from 'vitest';
import { createEmptyGraph, type RoomNode } from '../src/map/graph';
import {
  PROBE_DIRECTIONS,
  probeUnexploredDirections,
  unexploredDirections,
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
  it('skips immediately when the room is fully explored', async () => {
    const graph = createEmptyGraph();
    graph.rooms['cell'] = mkRoom('cell', 'Cell');
    graph.rooms['cell'].blockedDirections = [...PROBE_DIRECTIONS];
    graph.currentRoomId = 'cell';

    const sent: string[] = [];
    const result = await probeUnexploredDirections(
      {
        sendCommand: (t) => sent.push(t),
        on: () => () => {},
      },
      () => graph,
    );
    expect(result).toBe('skipped');
    expect(sent).toEqual([]);
  });

  it('aborts (without further commands) when /undo fails to return to the origin', async () => {
    const graph = createEmptyGraph();
    graph.rooms['a'] = mkRoom('a', 'A');
    graph.rooms['a'].blockedDirections = PROBE_DIRECTIONS.filter((d) => d !== 'n');
    graph.rooms['b'] = mkRoom('b', 'B');
    graph.currentRoomId = 'a';

    const sent: string[] = [];
    let listener: ((e: GameEvent) => void) | null = null;
    const result = await probeUnexploredDirections(
      {
        sendCommand: (t) => {
          sent.push(t);
          // Simulate: the n move works (room becomes b), but /undo strands us in b.
          graph.currentRoomId = 'b';
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
      },
      () => graph,
    );
    expect(result).toBe('aborted');
    expect(sent).toEqual(['n', '/undo']); // stopped immediately, no further probes
  });
});
