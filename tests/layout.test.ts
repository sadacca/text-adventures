import { describe, expect, it } from 'vitest';
import { createEmptyGraph, type MapGraph, type RoomNode } from '../src/map/graph';
import { computeLayout } from '../src/map/layout';

function mkRoom(id: string, pos = { x: 0, y: 0 }): RoomNode {
  return { id, name: id, pos, posLocked: false, flags: {} };
}

function chainGraph(ids: string[]): MapGraph {
  const graph = createEmptyGraph();
  for (const id of ids) graph.rooms[id] = mkRoom(id);
  for (let i = 0; i < ids.length - 1; i++) {
    graph.edges.push({ from: ids[i], to: ids[i + 1], dir: 'n', status: 'confirmed' });
    graph.edges.push({ from: ids[i + 1], to: ids[i], dir: 's', status: 'confirmed' });
  }
  graph.currentRoomId = ids[0];
  return graph;
}

describe('computeLayout', () => {
  it('places connected rooms along their direction offsets from the start room', () => {
    const graph = chainGraph(['a', 'b', 'c']);
    computeLayout(graph);
    expect(graph.rooms['a'].pos).toEqual({ x: 0, y: 0 });
    expect(graph.rooms['b'].pos).toEqual({ x: 0, y: -1 });
    expect(graph.rooms['c'].pos).toEqual({ x: 0, y: -2 });
  });

  it('never moves a posLocked room', () => {
    const graph = chainGraph(['a', 'b']);
    graph.rooms['b'].pos = { x: 99, y: 99 };
    graph.rooms['b'].posLocked = true;
    computeLayout(graph);
    expect(graph.rooms['b'].pos).toEqual({ x: 99, y: 99 });
  });

  it('shifts a colliding room to a nearby free cell', () => {
    const graph = createEmptyGraph();
    graph.rooms['a'] = mkRoom('a');
    graph.rooms['b'] = mkRoom('b');
    graph.rooms['c'] = mkRoom('c');
    // Both b and c sit one step north of a (e.g. an ambiguous/duplicated room case).
    graph.edges.push(
      { from: 'a', to: 'b', dir: 'n', status: 'confirmed' },
      { from: 'a', to: 'c', dir: 'n', status: 'confirmed' },
    );
    graph.currentRoomId = 'a';
    computeLayout(graph);

    expect(graph.rooms['a'].pos).toEqual({ x: 0, y: 0 });
    const positions = [graph.rooms['b'].pos, graph.rooms['c'].pos];
    expect(positions[0]).not.toEqual(positions[1]); // no overlap
    for (const pos of positions) {
      expect(pos.y).toBeLessThanOrEqual(0); // still roughly "north" of a
    }
  });

  it('gives disconnected rooms (teleport targets, unknown) a visible fallback slot', () => {
    const graph = chainGraph(['a', 'b']);
    graph.rooms['floating'] = mkRoom('floating');
    computeLayout(graph);
    expect(graph.rooms['floating'].pos).not.toEqual({ x: 0, y: 0 });
  });

  it('does nothing for an empty graph', () => {
    const graph = createEmptyGraph();
    expect(() => computeLayout(graph)).not.toThrow();
  });
});
