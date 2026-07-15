import { describe, expect, it } from 'vitest';
import type { GameEvent } from '../src/engine/types';
import {
  Automapper,
  createEmptyGraph,
  deleteRoom,
  mergeRooms,
  moveRoom,
  normalizeRoomName,
  renameRoom,
  setRoomNote,
  UNKNOWN_ROOM_ID,
  type MapGraph,
  type RoomNode,
} from '../src/map/graph';

function cmd(text: string, turn: number): GameEvent {
  return { kind: 'command', text, turn };
}

function status(left: string, turn: number, right = ''): GameEvent {
  return { kind: 'status_line', left, right, raw: [], turn };
}

function bufferText(text: string, turn: number): GameEvent {
  return { kind: 'buffer_text', text, turn };
}

function mkRoom(id: string, name: string): RoomNode {
  return { id, name, pos: { x: 0, y: 0 }, posLocked: false, flags: {} };
}

describe('rule 1: movement into a new room', () => {
  it('creates a confirmed edge and an inferred reverse', () => {
    const am = new Automapper();
    am.handleEvent(status('Kitchen', 0));
    am.handleEvent(cmd('north', 1));
    am.handleEvent(status('Pantry', 1));

    const g = am.graph;
    expect(g.currentRoomId).toBe('pantry');
    expect(g.edges).toContainEqual({
      from: 'kitchen',
      to: 'pantry',
      dir: 'n',
      status: 'confirmed',
    });
    expect(g.edges).toContainEqual({
      from: 'pantry',
      to: 'kitchen',
      dir: 's',
      status: 'inferred',
    });
  });

  it('does not clobber an existing edge when auto-adding the inferred reverse', () => {
    const graph = createEmptyGraph();
    graph.rooms['kitchen'] = mkRoom('kitchen', 'Kitchen');
    graph.rooms['pantry'] = mkRoom('pantry', 'Pantry');
    graph.rooms['cellar'] = mkRoom('cellar', 'Cellar');
    // Pantry's south exit was already independently mapped, leading to Cellar.
    graph.edges.push({ from: 'pantry', to: 'cellar', dir: 's', status: 'confirmed' });
    graph.currentRoomId = 'kitchen';

    const am = new Automapper(graph);
    am.handleEvent(cmd('north', 1));
    am.handleEvent(status('Pantry', 1)); // kitchen -n-> pantry; reverse slot (pantry,s) is taken

    const southEdges = am.graph.edges.filter((e) => e.from === 'pantry' && e.dir === 's');
    expect(southEdges).toHaveLength(1);
    expect(southEdges[0]).toMatchObject({ to: 'cellar', status: 'confirmed' });
  });
});

describe('rule 2: blocked movement', () => {
  it('creates no edge when the room is unchanged', () => {
    const am = new Automapper();
    am.handleEvent(status('Kitchen', 0));
    am.handleEvent(cmd('north', 1));
    am.handleEvent(status('Kitchen', 1)); // wall blocks the move

    expect(am.graph.edges).toHaveLength(0);
    expect(am.graph.currentRoomId).toBe('kitchen');
    expect(Object.keys(am.graph.rooms)).toEqual(['kitchen']);
  });

  it('stays a no-op when the failure prose does not announce an arrival', () => {
    const am = new Automapper();
    am.handleEvent(status('Kitchen', 0));
    am.handleEvent(cmd('north', 1));
    am.handleEvent(bufferText("You can't go that way.", 1));
    am.handleEvent(status('Kitchen', 1));

    expect(am.graph.edges).toHaveLength(0);
    expect(Object.keys(am.graph.rooms)).toEqual(['kitchen']);
  });

  it('treats a same-named status line as a real move when the prose re-prints the room title', () => {
    // Zork: "Forest" -east-> a different room also named "Forest". The status line
    // alone looks like a blocked move; the printed title line is what says otherwise.
    const am = new Automapper();
    am.handleEvent(bufferText('Forest\nThis is a dimly lit forest.', 0));
    am.handleEvent(status('Forest', 0));
    am.handleEvent(cmd('east', 1));
    am.handleEvent(bufferText('Forest\nThe forest thins out, revealing mountains.', 1));
    am.handleEvent(status('Forest', 1));

    expect(am.graph.currentRoomId).toBe('forest#2');
    expect(am.graph.edges).toContainEqual({
      from: 'forest',
      to: 'forest#2',
      dir: 'e',
      status: 'confirmed',
    });
  });

  it('records a genuine self-loop exit (announced arrival, same description) without inferring a reverse', () => {
    const am = new Automapper();
    am.handleEvent(bufferText('Winding Path\nThe path twists back on itself.', 0));
    am.handleEvent(status('Winding Path', 0));
    am.handleEvent(cmd('north', 1));
    am.handleEvent(bufferText('Winding Path\nThe path twists back on itself.', 1));
    am.handleEvent(status('Winding Path', 1));

    expect(am.graph.currentRoomId).toBe('winding-path');
    expect(am.graph.edges).toEqual([
      { from: 'winding-path', to: 'winding-path', dir: 'n', status: 'confirmed' },
    ]);
  });
});

describe('rule 3: inferred edges', () => {
  it('promotes an inferred edge to confirmed once independently traversed', () => {
    const am = new Automapper();
    am.handleEvent(status('Kitchen', 0));
    am.handleEvent(cmd('north', 1));
    am.handleEvent(status('Pantry', 1));

    am.handleEvent(cmd('south', 2));
    am.handleEvent(status('Kitchen', 2));

    const edge = am.graph.edges.find((e) => e.from === 'pantry' && e.dir === 's');
    expect(edge).toMatchObject({ to: 'kitchen', status: 'confirmed' });
  });

  it('corrects a one-way passage: traversal lands somewhere other than the inferred target', () => {
    const am = new Automapper();
    am.handleEvent(status('Kitchen', 0));
    am.handleEvent(cmd('north', 1));
    am.handleEvent(status('Pantry', 1)); // creates inferred pantry -s-> kitchen

    am.handleEvent(cmd('south', 2));
    am.handleEvent(status('Cellar', 2)); // one-way chute: south from Pantry actually goes to Cellar

    const southEdges = am.graph.edges.filter((e) => e.from === 'pantry' && e.dir === 's');
    expect(southEdges).toHaveLength(1);
    expect(southEdges[0]).toMatchObject({ to: 'cellar', status: 'confirmed' });
    expect(am.graph.currentRoomId).toBe('cellar');
  });
});

describe('rule 4: non-compass commands that change the room', () => {
  it('links a known origin to the destination using the raw command text as the edge label', () => {
    const am = new Automapper();
    am.handleEvent(status('Garden', 0));
    am.handleEvent(cmd('climb ladder', 1));
    am.handleEvent(status('Tower Roof', 1));

    const g = am.graph;
    expect(g.currentRoomId).toBe('tower-roof');
    expect(g.rooms['tower-roof'].flags.teleportTarget).toBeUndefined();
    expect(g.edges).toContainEqual({
      from: 'garden',
      to: 'tower-roof',
      dir: 'climb ladder',
      status: 'confirmed',
    });
    // No opposite is known for a custom edge, so no reverse is guessed (unlike rule 1).
    expect(g.edges).toHaveLength(1);
  });

  it('records a link back once the reverse command is actually traversed', () => {
    const am = new Automapper();
    am.handleEvent(status('Garden', 0));
    am.handleEvent(cmd('climb ladder', 1));
    am.handleEvent(status('Tower Roof', 1));

    am.handleEvent(cmd('climb down ladder', 2));
    am.handleEvent(status('Garden', 2));

    expect(am.graph.edges).toContainEqual({
      from: 'tower-roof',
      to: 'garden',
      dir: 'climb down ladder',
      status: 'confirmed',
    });
    expect(am.graph.edges).toHaveLength(2);
  });

  it('places a genuine teleport (no known origin room yet) unconnected and flagged', () => {
    const am = new Automapper();
    am.handleEvent(cmd('wave wand', 0)); // no room known yet -> nothing to link from
    am.handleEvent(status('Wizard Tower', 0));

    const g = am.graph;
    expect(g.currentRoomId).toBe('wizard-tower');
    expect(g.rooms['wizard-tower'].flags.teleportTarget).toBe(true);
    expect(g.edges).toHaveLength(0);
  });
});

describe('rule 5: unrecognized status line', () => {
  it('routes to the shared (unknown) node with no edges recorded', () => {
    const am = new Automapper();
    am.handleEvent(status('Kitchen', 0));
    am.handleEvent(cmd('north', 1));
    am.handleEvent(status('', 1));

    expect(am.graph.currentRoomId).toBe(UNKNOWN_ROOM_ID);
    expect(am.graph.rooms[UNKNOWN_ROOM_ID].name).toBe('(unknown)');
    expect(am.graph.edges).toHaveLength(0);
  });

  it('reuses the same singleton across multiple dark encounters', () => {
    const am = new Automapper();
    am.handleEvent(status('Kitchen', 0));
    am.handleEvent(cmd('north', 1));
    am.handleEvent(status('', 1));
    am.handleEvent(cmd('south', 2));
    am.handleEvent(status('', 2));

    const unknownRooms = Object.values(am.graph.rooms).filter((r) => r.name === '(unknown)');
    expect(unknownRooms).toHaveLength(1);
  });

  it('records no edge touching "unknown" once a real room reappears', () => {
    const am = new Automapper();
    am.handleEvent(status('Kitchen', 0));
    am.handleEvent(cmd('north', 1));
    am.handleEvent(status('', 1));
    am.handleEvent(cmd('east', 2));
    am.handleEvent(status('Broom Closet', 2));

    expect(am.graph.currentRoomId).toBe('broom-closet');
    expect(am.graph.edges.some((e) => e.from === UNKNOWN_ROOM_ID || e.to === UNKNOWN_ROOM_ID)).toBe(
      false,
    );
  });
});

describe('rule 6: same name, contradictory geography', () => {
  it('disambiguates into a numbered duplicate (e.g. Zork-style Maze rooms)', () => {
    const graph = createEmptyGraph();
    graph.rooms['start'] = mkRoom('start', 'Start');
    graph.rooms['maze'] = mkRoom('maze', 'Maze');
    graph.rooms['passage'] = mkRoom('passage', 'Passage');
    graph.rooms['basement'] = mkRoom('basement', 'Basement');
    graph.edges.push(
      { from: 'start', to: 'maze', dir: 'n', status: 'confirmed' },
      { from: 'maze', to: 'start', dir: 's', status: 'inferred' },
      // Maze's east exit is already confirmed to lead to Passage, not Basement.
      { from: 'maze', to: 'passage', dir: 'e', status: 'confirmed' },
      { from: 'passage', to: 'maze', dir: 'w', status: 'inferred' },
      { from: 'start', to: 'basement', dir: 's', status: 'confirmed' },
      { from: 'basement', to: 'start', dir: 'n', status: 'inferred' },
    );
    graph.currentRoomId = 'basement';

    const am = new Automapper(graph);
    // Walking west from Basement into a room also named "Maze" can't be the same room
    // as `maze`, because `maze`'s confirmed east edge already proves it leads to
    // Passage, not back to Basement.
    am.handleEvent(cmd('west', 10));
    am.handleEvent(status('Maze', 10));

    expect(am.graph.currentRoomId).toBe('maze#2');
    expect(am.graph.rooms['maze#2']).toBeDefined();
    expect(am.graph.edges).toContainEqual({
      from: 'basement',
      to: 'maze#2',
      dir: 'w',
      status: 'confirmed',
    });
    // the original `maze` room and its edges are untouched
    expect(am.graph.edges).toContainEqual({
      from: 'maze',
      to: 'passage',
      dir: 'e',
      status: 'confirmed',
    });
  });

  it('splits same-named rooms apart on first arrival when their descriptions differ', () => {
    // Zork's Forest 1 (west of Forest Path) vs Forest 2 (east of it): same status-line
    // name, different first-visit descriptions. The reverse-edge check alone can't tell
    // them apart (Forest 1 has no 'w' edge yet), so the description has to.
    const am = new Automapper();
    am.handleEvent(bufferText('Forest Path\nA path winding through a dimly lit forest.', 0));
    am.handleEvent(status('Forest Path', 0));
    am.handleEvent(cmd('west', 1));
    am.handleEvent(bufferText('Forest\nThis is a forest, with trees in all directions.', 1));
    am.handleEvent(status('Forest', 1));
    am.handleEvent(cmd('east', 2));
    am.handleEvent(bufferText('Forest Path\nA path winding through a dimly lit forest.', 2));
    am.handleEvent(status('Forest Path', 2));

    am.handleEvent(cmd('east', 3));
    am.handleEvent(bufferText('Forest\nThis is a dimly lit forest, with large trees.', 3));
    am.handleEvent(status('Forest', 3));

    expect(am.graph.currentRoomId).toBe('forest#2');
    expect(am.graph.edges).toContainEqual({
      from: 'forest-path',
      to: 'forest#2',
      dir: 'e',
      status: 'confirmed',
    });
    // Forest 1 keeps its own geography untouched.
    expect(am.graph.edges).toContainEqual({
      from: 'forest-path',
      to: 'forest',
      dir: 'w',
      status: 'confirmed',
    });
  });

  it('reuses the same-named sibling whose description matches on a later arrival', () => {
    const am = new Automapper();
    am.handleEvent(bufferText('Hall\nA long hall.', 0));
    am.handleEvent(status('Hall', 0));
    am.handleEvent(cmd('west', 1));
    am.handleEvent(bufferText('Forest\nA sunlit forest.', 1));
    am.handleEvent(status('Forest', 1));
    am.handleEvent(cmd('east', 2));
    am.handleEvent(bufferText('Hall\nA long hall.', 2));
    am.handleEvent(status('Hall', 2));
    am.handleEvent(cmd('north', 3));
    am.handleEvent(bufferText('Forest\nA gloomy forest.', 3)); // -> forest#2
    am.handleEvent(status('Forest', 3));
    am.handleEvent(cmd('south', 4));
    am.handleEvent(bufferText('Hall\nA long hall.', 4));
    am.handleEvent(status('Hall', 4));

    // New approach from a fresh direction, but the description identifies forest#2.
    am.handleEvent(cmd('northeast', 5));
    am.handleEvent(bufferText('Forest\nA gloomy forest.', 5));
    am.handleEvent(status('Forest', 5));

    expect(am.graph.currentRoomId).toBe('forest#2');
    expect(Object.keys(am.graph.rooms).filter((id) => id.startsWith('forest'))).toHaveLength(2);
  });

  it('sticks to the forward edge when retracing a known exit into a same-named room', () => {
    const graph = createEmptyGraph();
    graph.rooms['path'] = mkRoom('path', 'Path');
    graph.rooms['forest'] = mkRoom('forest', 'Forest');
    graph.rooms['forest#2'] = mkRoom('forest#2', 'Forest');
    graph.edges.push(
      { from: 'path', to: 'forest#2', dir: 'e', status: 'confirmed' },
      { from: 'forest#2', to: 'path', dir: 'w', status: 'inferred' },
    );
    graph.currentRoomId = 'path';

    const am = new Automapper(graph);
    // 'forest' (no 'w' edge, so "compatible" by the reverse-edge check) must NOT steal
    // this arrival: (path, e) is already confirmed to lead to forest#2.
    am.handleEvent(cmd('east', 1));
    am.handleEvent(status('Forest', 1));

    expect(am.graph.currentRoomId).toBe('forest#2');
    expect(am.graph.edges).toContainEqual({
      from: 'path',
      to: 'forest#2',
      dir: 'e',
      status: 'confirmed',
    });
  });

  it('does not treat a contradicting INFERRED reverse edge as disqualifying (asymmetric exits)', () => {
    // Zork: West of House -s-> South of House auto-infers "South of House -n-> West of
    // House", but South of House's real north exit is a boarded wall. Arriving later
    // via Behind House -s-> "South of House" must reuse the room, not mint a #2 —
    // the inferred edge is a guess, not evidence.
    const am = new Automapper();
    am.handleEvent(status('West of House', 0));
    am.handleEvent(cmd('south', 1));
    am.handleEvent(status('South of House', 1));
    am.handleEvent(cmd('east', 2));
    am.handleEvent(status('Behind House', 2));

    am.handleEvent(cmd('south', 3));
    am.handleEvent(status('South of House', 3));

    expect(am.graph.currentRoomId).toBe('south-of-house');
    expect(Object.keys(am.graph.rooms)).not.toContain('south-of-house#2');
    expect(am.graph.edges).toContainEqual({
      from: 'behind-house',
      to: 'south-of-house',
      dir: 's',
      status: 'confirmed',
    });
  });

  it('reuses the existing room when geography is still consistent', () => {
    const graph = createEmptyGraph();
    graph.rooms['start'] = mkRoom('start', 'Start');
    graph.rooms['maze'] = mkRoom('maze', 'Maze');
    graph.rooms['basement'] = mkRoom('basement', 'Basement');
    graph.edges.push(
      { from: 'start', to: 'maze', dir: 'n', status: 'confirmed' },
      { from: 'maze', to: 'start', dir: 's', status: 'inferred' },
      { from: 'start', to: 'basement', dir: 's', status: 'confirmed' },
      { from: 'basement', to: 'start', dir: 'n', status: 'inferred' },
    );
    graph.currentRoomId = 'basement';

    const am = new Automapper(graph);
    // Maze has no confirmed edge yet contradicting this arrival, so it's compatible.
    am.handleEvent(cmd('west', 10));
    am.handleEvent(status('Maze', 10));

    expect(am.graph.currentRoomId).toBe('maze');
    expect(Object.keys(am.graph.rooms).filter((id) => id.startsWith('maze'))).toEqual(['maze']);
  });
});

describe('rule 7: user edits win, forever', () => {
  it('never re-adds a userDeleted edge', () => {
    const am = new Automapper();
    am.handleEvent(status('Kitchen', 0));
    am.handleEvent(cmd('north', 1));
    am.handleEvent(status('Pantry', 1));

    const edge = am.graph.edges.find((e) => e.from === 'kitchen' && e.dir === 'n')!;
    edge.userDeleted = true;

    am.handleEvent(cmd('north', 2));
    am.handleEvent(status('Pantry', 2));

    const liveEdges = am.graph.edges.filter(
      (e) => e.from === 'kitchen' && e.dir === 'n' && !e.userDeleted,
    );
    expect(liveEdges).toHaveLength(0);
  });

  it('never repositions a posLocked room', () => {
    const am = new Automapper();
    am.handleEvent(status('Kitchen', 0));
    am.graph.rooms['kitchen'].pos = { x: 5, y: 5 };
    am.graph.rooms['kitchen'].posLocked = true;

    am.handleEvent(cmd('north', 1));
    am.handleEvent(status('Pantry', 1));
    am.handleEvent(cmd('south', 2));
    am.handleEvent(status('Kitchen', 2));

    expect(am.graph.rooms['kitchen'].pos).toEqual({ x: 5, y: 5 });
  });

  it('mergeRooms keeps a sticky alias so future arrivals resolve to the survivor', () => {
    const am = new Automapper();
    am.handleEvent(status('Kitchen', 0));
    am.handleEvent(cmd('north', 1));
    am.handleEvent(status('Pantry', 1));
    am.handleEvent(cmd('north', 2));
    am.handleEvent(status('Larder', 2)); // discovered separately, but it's actually Pantry

    mergeRooms(am.graph, 'pantry', 'larder');
    expect(am.graph.rooms['larder']).toBeUndefined();
    expect(am.graph.currentRoomId).toBe('pantry');

    am.handleEvent(cmd('wave wand', 3));
    am.handleEvent(status('Larder', 3)); // arrival under the old, merged-away name
    expect(am.graph.currentRoomId).toBe('pantry');
  });

  it('renameRoom keeps a sticky alias so arrivals under the old name still resolve here', () => {
    const am = new Automapper();
    am.handleEvent(status('Kitchen', 0));
    renameRoom(am.graph, 'kitchen', 'Scullery');
    expect(am.graph.rooms['kitchen'].name).toBe('Scullery');

    am.handleEvent(cmd('north', 1));
    am.handleEvent(status('Pantry', 1));
    am.handleEvent(cmd('south', 2));
    am.handleEvent(status('Kitchen', 2)); // game still calls it "Kitchen"; must land back here

    expect(am.graph.currentRoomId).toBe('kitchen');
    expect(am.graph.rooms['kitchen'].name).toBe('Scullery');
  });

  it('setRoomNote sets a free-text note the automapper never overwrites', () => {
    const am = new Automapper();
    am.handleEvent(status('Kitchen', 0));
    setRoomNote(am.graph, 'kitchen', 'has the knife');
    am.handleEvent(cmd('north', 1));
    am.handleEvent(status('Pantry', 1));
    am.handleEvent(cmd('south', 2));
    am.handleEvent(status('Kitchen', 2));
    expect(am.graph.rooms['kitchen'].note).toBe('has the knife');
  });

  it('moveRoom locks the room so layout never repositions it (via computeLayout)', () => {
    const am = new Automapper();
    am.handleEvent(status('Kitchen', 0));
    moveRoom(am.graph, 'kitchen', { x: 9, y: 9 });
    expect(am.graph.rooms['kitchen']).toMatchObject({
      pos: { x: 9, y: 9 },
      posLocked: true,
    });
  });

  it('deleteRoom tombstones edges touching it and lets a later revisit re-discover it fresh', () => {
    const am = new Automapper();
    am.handleEvent(status('Kitchen', 0));
    am.handleEvent(cmd('north', 1));
    am.handleEvent(status('Pantry', 1));
    am.handleEvent(cmd('south', 2));
    am.handleEvent(status('Kitchen', 2));

    deleteRoom(am.graph, 'pantry');
    expect(am.graph.rooms['pantry']).toBeUndefined();
    expect(
      am.graph.edges
        .filter((e) => e.from === 'pantry' || e.to === 'pantry')
        .every((e) => e.userDeleted),
    ).toBe(true);

    am.handleEvent(cmd('north', 3));
    am.handleEvent(status('Pantry', 3)); // revisited: rediscovered as a fresh node
    expect(am.graph.rooms['pantry']).toBeDefined();
  });

  it('deleteRoom refuses to delete the current room', () => {
    const am = new Automapper();
    am.handleEvent(status('Kitchen', 0));
    deleteRoom(am.graph, 'kitchen');
    expect(am.graph.rooms['kitchen']).toBeDefined();
  });
});

describe('rule 8: room-name normalization', () => {
  it('trims, collapses whitespace, and strips trailing score/moves fragments', () => {
    expect(normalizeRoomName('  Kitchen   ')).toBe('Kitchen');
    expect(normalizeRoomName('Kitchen    Score: 5   Moves: 12')).toBe('Kitchen');
    expect(normalizeRoomName('Twisty Little   Passages')).toBe('Twisty Little Passages');
    expect(normalizeRoomName('Foyer [12/34]')).toBe('Foyer');
  });

  it('matches case-insensitively while preserving the first-seen case for display', () => {
    const am = new Automapper();
    am.handleEvent(status('  Kitchen  ', 0));
    am.handleEvent(cmd('north', 1));
    am.handleEvent(status('KITCHEN', 1)); // same room, shouted differently -> blocked, no new node

    expect(Object.keys(am.graph.rooms)).toEqual(['kitchen']);
    expect(am.graph.rooms['kitchen'].name).toBe('Kitchen');
  });
});

describe('serialization', () => {
  it('round-trips a graph through JSON and keeps working', () => {
    const am = new Automapper();
    am.handleEvent(status('Kitchen', 0));
    am.handleEvent(cmd('north', 1));
    am.handleEvent(status('Pantry', 1));

    const restored: MapGraph = JSON.parse(JSON.stringify(am.graph));
    expect(restored).toEqual(am.graph);

    const am2 = new Automapper(restored);
    am2.handleEvent(cmd('south', 2));
    am2.handleEvent(status('Kitchen', 2));
    expect(am2.graph.currentRoomId).toBe('kitchen');
  });
});

describe('UX-18: mentioned directions', () => {
  it('attaches a mentioned direction to the arrival room, not the origin', () => {
    const am = new Automapper();
    am.handleEvent(status('Hall', 0));
    am.handleEvent(cmd('n', 1));
    // Deliberately avoids the word "north" in the movement narration itself (e.g. "You
    // walk north") — that would also match the heuristic (a known, accepted limitation:
    // incidental direction words in flavor/movement text, not just exit descriptions,
    // are indistinguishable from real mentions by design) and muddy this specific
    // assertion, which is about attribution (arrival room, not origin), not filtering.
    am.handleEvent(bufferText('You head off.\n\nKitchen\nThere is a door to the west.', 1));
    am.handleEvent(status('Kitchen', 1));

    expect(am.graph.rooms['kitchen'].mentionedDirections).toEqual(['w']);
    expect(am.graph.rooms['hall'].mentionedDirections).toBeUndefined();
  });

  it('keeps a recorded mention even after that direction becomes a confirmed edge', () => {
    const am = new Automapper();
    am.handleEvent(status('Hall', 0));
    am.handleEvent(cmd('n', 1));
    am.handleEvent(bufferText('There is a door to the west.', 1));
    am.handleEvent(status('Kitchen', 1));

    am.handleEvent(cmd('w', 2));
    am.handleEvent(status('Pantry', 2));

    // Detection never un-records a mention — filtering it once a real edge exists is
    // the UI hook's job (useSuggestedExits), not the graph's.
    expect(am.graph.rooms['kitchen'].mentionedDirections).toEqual(['w']);
  });
});
