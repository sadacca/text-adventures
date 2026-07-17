import { describe, expect, it } from 'vitest';
import { createEmptyGraph, setRoomFloor, type MapGraph, type RoomNode } from '../src/map/graph';
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

    // Floor 0 is laid out from its first-discovered room.
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

describe('layout stability (2026-07-17 rework)', () => {
  it('is anchored independently of the current room: moving the player never reshuffles', () => {
    const graph = chainGraph(['a', 'b', 'c']);
    computeLayout(graph);
    const before = Object.fromEntries(Object.values(graph.rooms).map((r) => [r.id, { ...r.pos }]));

    // Re-entering the floor "from the other side" used to re-anchor the BFS at the
    // current room and re-derive every position from there.
    graph.currentRoomId = 'c';
    computeLayout(graph);
    for (const room of Object.values(graph.rooms)) {
      expect(room.pos, `room ${room.id} moved when only the player moved`).toEqual(before[room.id]);
    }
  });

  it('adding a new room never moves already-placed rooms', () => {
    const graph = chainGraph(['a', 'b', 'c']);
    computeLayout(graph);
    const before = Object.fromEntries(Object.values(graph.rooms).map((r) => [r.id, { ...r.pos }]));

    graph.rooms['d'] = mkRoom('d');
    graph.edges.push(
      { from: 'c', to: 'd', dir: 'e', status: 'confirmed' },
      { from: 'd', to: 'c', dir: 'w', status: 'inferred' },
    );
    graph.currentRoomId = 'd';
    computeLayout(graph);

    for (const id of ['a', 'b', 'c']) {
      expect(graph.rooms[id].pos, `existing room ${id} moved`).toEqual(before[id]);
    }
    expect(graph.rooms['d'].pos).toEqual({ x: 1, y: -2 }); // east of c
  });

  it('never lets a fractional-offset room overlap an integer-cell room box', () => {
    // Room boxes are ~0.84x0.44 cells. A same-floor `up` edge places its target at a
    // fractional offset (0.5, -1.35) — the old exact-cell-key collision check thought
    // that cell was distinct from the integer cell (1, -1), letting two boxes (and
    // their labels) sit 0.5 x 0.35 cells apart, visibly overlapping.
    const graph = createEmptyGraph();
    graph.rooms['a'] = mkRoom('a');
    graph.rooms['b'] = mkRoom('b');
    graph.rooms['c'] = mkRoom('c');
    graph.edges.push(
      { from: 'a', to: 'b', dir: 'up', status: 'confirmed' }, // b -> (0.5, -1.35)
      { from: 'a', to: 'c', dir: 'ne', status: 'confirmed' }, // c wants (1, -1): overlaps b
    );
    graph.currentRoomId = 'a';
    computeLayout(graph);

    const rooms = Object.values(graph.rooms);
    for (let i = 0; i < rooms.length; i++) {
      for (let j = i + 1; j < rooms.length; j++) {
        const dx = Math.abs(rooms[i].pos.x - rooms[j].pos.x);
        const dy = Math.abs(rooms[i].pos.y - rooms[j].pos.y);
        expect(
          dx >= 0.9 || dy >= 0.6,
          `rooms ${rooms[i].id} and ${rooms[j].id} overlap at dx=${dx}, dy=${dy}`,
        ).toBe(true);
      }
    }
  });

  it('setRoomFloor clears posAssigned so the room is re-placed on its new floor', () => {
    const graph = chainGraph(['a', 'b']);
    computeLayout(graph);
    expect(graph.rooms['b'].posAssigned).toBe(true);

    setRoomFloor(graph, 'b', 1);
    expect(graph.rooms['b'].posAssigned).toBe(false);
    computeLayout(graph);
    expect(graph.rooms['b'].posAssigned).toBe(true);
    expect(graph.rooms['b'].floor).toBe(1);
  });
});
