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

describe('Batch 4 / UX-21: floor-scoped layout', () => {
  it('lays out each floor independently, starting each from its own room', () => {
    const graph = createEmptyGraph();
    graph.rooms['landing'] = { ...mkRoom('landing'), floor: 0 };
    graph.rooms['hall'] = { ...mkRoom('hall'), floor: 0 };
    graph.rooms['loft'] = { ...mkRoom('loft'), floor: 1 };
    graph.rooms['attic'] = { ...mkRoom('attic'), floor: 1 };
    graph.edges.push(
      { from: 'landing', to: 'hall', dir: 'n', status: 'confirmed' },
      { from: 'hall', to: 'landing', dir: 's', status: 'confirmed' },
      { from: 'landing', to: 'loft', dir: 'up', status: 'confirmed' },
      { from: 'loft', to: 'landing', dir: 'down', status: 'inferred' },
      { from: 'loft', to: 'attic', dir: 'n', status: 'confirmed' },
      { from: 'attic', to: 'loft', dir: 's', status: 'confirmed' },
    );
    graph.currentRoomId = 'landing';
    computeLayout(graph);

    // Floor 0 is laid out from the current room, same as the single-floor algorithm.
    expect(graph.rooms['landing'].pos).toEqual({ x: 0, y: 0 });
    expect(graph.rooms['hall'].pos).toEqual({ x: 0, y: -1 });

    // Floor 1's BFS never crosses the up/down edge (that's a stub, not a layout link),
    // so it starts fresh from its own first room and lays out independently — landing
    // and hall's positions are not consulted, and floor-1 rooms may freely reuse
    // floor-0 coordinates (only one floor renders at a time).
    expect(graph.rooms['loft'].pos).toEqual({ x: 0, y: 0 });
    expect(graph.rooms['attic'].pos).toEqual({ x: 0, y: -1 });
  });
});
