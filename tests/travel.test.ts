import { describe, expect, it } from 'vitest';
import { createEmptyGraph, type MapGraph, type RoomNode } from '../src/map/graph';
import {
  bufferTextEndsInQuestion,
  computePath,
  isLongTrip,
  LONG_TRIP_THRESHOLD,
} from '../src/map/travel';

function mkRoom(id: string): RoomNode {
  return { id, name: id, pos: { x: 0, y: 0 }, posLocked: false, flags: {} };
}

function chainGraph(ids: string[]): MapGraph {
  const graph = createEmptyGraph();
  for (const id of ids) graph.rooms[id] = mkRoom(id);
  for (let i = 0; i < ids.length - 1; i++) {
    graph.edges.push({ from: ids[i], to: ids[i + 1], dir: 'n', status: 'confirmed' });
    graph.edges.push({ from: ids[i + 1], to: ids[i], dir: 's', status: 'confirmed' });
  }
  return graph;
}

describe('computePath', () => {
  it('returns [] for the current room', () => {
    const graph = chainGraph(['a', 'b']);
    expect(computePath(graph, 'a', 'a')).toEqual([]);
  });

  it('finds the shortest route over confirmed edges', () => {
    const graph = chainGraph(['a', 'b', 'c', 'd']);
    expect(computePath(graph, 'a', 'd')).toEqual([
      { dir: 'n', roomId: 'b' },
      { dir: 'n', roomId: 'c' },
      { dir: 'n', roomId: 'd' },
    ]);
  });

  it('ignores inferred edges', () => {
    const graph = createEmptyGraph();
    graph.rooms['a'] = mkRoom('a');
    graph.rooms['b'] = mkRoom('b');
    graph.edges.push({ from: 'a', to: 'b', dir: 'n', status: 'inferred' });
    expect(computePath(graph, 'a', 'b')).toBeNull();
  });

  it('ignores userDeleted edges', () => {
    const graph = chainGraph(['a', 'b']);
    graph.edges[0].userDeleted = true;
    expect(computePath(graph, 'a', 'b')).toBeNull();
  });

  it('returns null when no path exists', () => {
    const graph = createEmptyGraph();
    graph.rooms['a'] = mkRoom('a');
    graph.rooms['b'] = mkRoom('b');
    expect(computePath(graph, 'a', 'b')).toBeNull();
  });

  it('returns null for an unknown room id', () => {
    const graph = chainGraph(['a', 'b']);
    expect(computePath(graph, 'a', 'nope')).toBeNull();
  });
});

describe('bufferTextEndsInQuestion', () => {
  it('flags a line ending in "?" as an abort-worthy prompt', () => {
    expect(bufferTextEndsInQuestion('Which one do you mean, the red key or the blue key?')).toBe(
      true,
    );
    expect(bufferTextEndsInQuestion('You open the door.\nA voice asks: Continue?')).toBe(true);
  });

  it('leaves ordinary narration alone', () => {
    expect(bufferTextEndsInQuestion('You are standing in an open field.')).toBe(false);
  });
});

describe('isLongTrip', () => {
  it('warns only past the SPECS.md threshold of 8 moves', () => {
    const short = Array.from({ length: LONG_TRIP_THRESHOLD }, () => ({
      dir: 'n' as const,
      roomId: 'x',
    }));
    const long = Array.from({ length: LONG_TRIP_THRESHOLD + 1 }, () => ({
      dir: 'n' as const,
      roomId: 'x',
    }));
    expect(isLongTrip(short)).toBe(false);
    expect(isLongTrip(long)).toBe(true);
  });
});
