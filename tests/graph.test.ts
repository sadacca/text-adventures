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
  setRoomFloor,
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

  it('records a blocked compass direction on the current room as a passive fingerprint', () => {
    const am = new Automapper();
    am.handleEvent(status('Kitchen', 0));
    am.handleEvent(cmd('north', 1));
    am.handleEvent(bufferText("You can't go that way.", 1));
    am.handleEvent(status('Kitchen', 1));

    expect(am.graph.rooms['kitchen'].blockedDirections).toEqual(['n']);
    expect(am.graph.edges).toHaveLength(0); // still no edge — rule 2 stands
  });

  it('splits off a sibling when a blocked move contradicts an already-CONFIRMED edge', () => {
    // A merged same-named room (see rule 6) already confirms 'e' works; a later visit
    // to the OTHER real physical room finds 'e' blocked instead — direct contradiction.
    const graph = createEmptyGraph();
    graph.rooms['forest'] = mkRoom('forest', 'Forest');
    graph.rooms['forest'].firstDescription = 'This is a dimly lit forest.';
    graph.rooms['mountains'] = mkRoom('mountains', 'Mountains');
    graph.edges.push({ from: 'forest', to: 'mountains', dir: 'e', status: 'confirmed' });
    graph.currentRoomId = 'forest';

    const am = new Automapper(graph);
    am.handleEvent(cmd('east', 1));
    am.handleEvent(bufferText("You can't go that way.", 1));
    am.handleEvent(status('Forest', 1));

    expect(am.graph.currentRoomId).not.toBe('forest');
    const split = am.graph.rooms[am.graph.currentRoomId!];
    expect(split).toMatchObject({ name: 'Forest', blockedDirections: ['e'] });
    // The original's confirmed edge is untouched.
    expect(am.graph.edges).toContainEqual({
      from: 'forest',
      to: 'mountains',
      dir: 'e',
      status: 'confirmed',
    });
  });

  it('reuses the same split sibling on repeated visits instead of minting a new one each time', () => {
    // The exact bug this guards: revisiting the SAME real physical room and
    // re-triggering the SAME blocked-move contradiction used to mint a brand new `#N`
    // duplicate every single time instead of converging on the sibling already split
    // off for this situation.
    const graph = createEmptyGraph();
    graph.rooms['forest'] = mkRoom('forest', 'Forest');
    graph.rooms['forest'].firstDescription = 'This is a dimly lit forest.';
    graph.rooms['mountains'] = mkRoom('mountains', 'Mountains');
    graph.edges.push({ from: 'forest', to: 'mountains', dir: 'e', status: 'confirmed' });
    graph.currentRoomId = 'forest';

    const am = new Automapper(graph);
    am.handleEvent(cmd('east', 1));
    am.handleEvent(bufferText("You can't go that way.", 1));
    am.handleEvent(status('Forest', 1));
    const firstSplitId = am.graph.currentRoomId;

    // Leave and come back via a fresh, ambiguous arrival (no forward edge to stick to),
    // then trigger the identical contradiction again.
    am.graph.currentRoomId = 'forest';
    am.handleEvent(cmd('east', 2));
    am.handleEvent(bufferText("You can't go that way.", 2));
    am.handleEvent(status('Forest', 2));

    expect(am.graph.currentRoomId).toBe(firstSplitId);
    expect(Object.keys(am.graph.rooms).filter((id) => id.startsWith('forest'))).toHaveLength(2);
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

  it('reuses a room reached via a convergent third direction that contradicts an unrelated reverse edge', () => {
    // Zork: from "Mountains", n/s/w ALL loop back to the same "dimly lit forest" room
    // (the map's "passageway returning to room of origin" symbol) — but that room's own
    // 's' edge already confirms elsewhere (to a Clearing), from a totally unrelated
    // entrance. A confirmed reverse edge on an UNRELATED direction must not veto an
    // exact description match: the room's identity is settled by content, not topology.
    const graph = createEmptyGraph();
    graph.rooms['mountains'] = mkRoom('mountains', 'Forest');
    graph.rooms['mountains'].firstDescription = 'The forest thins out, revealing mountains.';
    graph.rooms['forest'] = mkRoom('forest', 'Forest');
    graph.rooms['forest'].firstDescription = 'This is a dimly lit forest.';
    graph.rooms['clearing'] = mkRoom('clearing', 'Clearing');
    graph.edges.push(
      { from: 'forest', to: 'mountains', dir: 'e', status: 'confirmed' },
      { from: 'mountains', to: 'forest', dir: 'w', status: 'inferred' },
      // forest's 's' is unrelated: a normal, previously-confirmed exit to Clearing.
      { from: 'forest', to: 'clearing', dir: 's', status: 'confirmed' },
    );
    graph.currentRoomId = 'mountains';

    const am = new Automapper(graph);
    am.handleEvent(cmd('north', 1));
    am.handleEvent(bufferText('Forest\nThis is a dimly lit forest.', 1));
    am.handleEvent(status('Forest', 1));

    expect(am.graph.currentRoomId).toBe('forest');
    expect(Object.keys(am.graph.rooms)).not.toContain('forest#2');
    expect(am.graph.edges).toContainEqual({
      from: 'mountains',
      to: 'forest',
      dir: 'n',
      status: 'confirmed',
    });
    // The unrelated, previously-confirmed edge is untouched.
    expect(am.graph.edges).toContainEqual({
      from: 'forest',
      to: 'clearing',
      dir: 's',
      status: 'confirmed',
    });
  });

  it('splits off a fresh room instead of overwriting a CONFIRMED edge that a merge contradicts', () => {
    // Two physically distinct, textually-IDENTICAL "Forest" rooms (Zork's actual
    // situation) get merged into one node the first time only one of them has been
    // seen. That's unavoidable from text alone. But once the merged node's already-
    // confirmed 'w' edge (established while really in physical instance A) gets
    // contradicted by a later traversal from physical instance B, silently overwriting
    // it would destroy correct data — instead a sibling room must be split off.
    const am = new Automapper();
    am.handleEvent(status('Path', 0));
    am.handleEvent(cmd('east', 1));
    am.handleEvent(bufferText('Forest\nThis is a dimly lit forest.', 1));
    am.handleEvent(status('Forest', 1)); // physical instance A, merged into 'forest'
    am.handleEvent(cmd('west', 2));
    am.handleEvent(status('Path', 2)); // forest.w -> path, CONFIRMED

    am.handleEvent(cmd('north', 3));
    am.handleEvent(status('Clearing', 3));
    am.handleEvent(cmd('south', 4));
    // Arriving at physical instance B via an unrelated entrance — same text, so it
    // merges into the same 'forest' node (unavoidable, no contradicting evidence yet).
    am.handleEvent(bufferText('Forest\nThis is a dimly lit forest.', 4));
    am.handleEvent(status('Forest', 4));

    am.handleEvent(cmd('west', 5));
    am.handleEvent(status('Sunny Glade', 5)); // instance B's real 'w' differs from instance A's

    expect(am.graph.currentRoomId).toBe('sunny-glade');
    // The original confirmed edge survives untouched.
    expect(am.graph.edges).toContainEqual({
      from: 'forest',
      to: 'path',
      dir: 'w',
      status: 'confirmed',
    });
    // A sibling room was split off and carries the new, real edge instead.
    const split = am.graph.edges.find(
      (e) => e.dir === 'w' && e.to === 'sunny-glade' && e.from !== 'forest',
    );
    expect(split).toBeDefined();
    expect(am.graph.rooms[split!.from]).toMatchObject({ name: 'Forest' });
  });

  it('hub preference: a room already confirmed-connected wins even when the reverse-edge check would exclude it', () => {
    // Zork: mountains' n/s/w all converge on the SAME "dimly lit forest" room. By the
    // time a second entrance direction is tried, several same-described siblings often
    // already exist (from earlier, unrelated splits) — the reverse-edge heuristic alone
    // would exclude the genuinely-correct one here, because ITS own reverse-in-that-
    // direction is unrelated/blocked (a fact that's true and irrelevant, not a
    // contradiction). A sibling `fromId` is already confirmed-connected to (via a
    // DIFFERENT direction) must win regardless.
    const graph = createEmptyGraph();
    graph.rooms['mountains'] = mkRoom('mountains', 'Forest');
    graph.rooms['mountains'].firstDescription = 'The forest thins out, revealing mountains.';
    graph.rooms['forest'] = mkRoom('forest', 'Forest'); // the room mountains already connects to
    graph.rooms['forest'].firstDescription = 'This is a dimly lit forest.';
    graph.rooms['forest-2'] = mkRoom('forest-2', 'Forest'); // an unrelated same-described sibling
    graph.rooms['forest-2'].firstDescription = 'This is a dimly lit forest.';
    graph.edges.push({ from: 'mountains', to: 'forest', dir: 'w', status: 'confirmed' });
    // forest's own 'n' is genuinely blocked in reality — recorded, but irrelevant to
    // whether mountains' 's' ALSO leads to forest.
    graph.rooms['forest'].blockedDirections = ['n'];
    graph.currentRoomId = 'mountains';

    const am = new Automapper(graph);
    am.handleEvent(cmd('south', 1));
    // Title reprinted but no description follows — a brief-mode revisit, so
    // resolution must fall back past the (unavailable) description fingerprint to hub
    // preference rather than the reverse-edge check.
    am.handleEvent(bufferText('Forest\n>', 1));
    am.handleEvent(status('Forest', 1));

    expect(am.graph.currentRoomId).toBe('forest');
    expect(am.graph.edges).toContainEqual({
      from: 'mountains',
      to: 'forest',
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
    setRoomFloor(am.graph, 'pantry', 3);

    const restored: MapGraph = JSON.parse(JSON.stringify(am.graph));
    expect(restored).toEqual(am.graph);
    expect(restored.rooms['pantry'].floor).toBe(3);
    expect(restored.rooms['pantry'].floorLocked).toBe(true);

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

describe('undo turns (undo / Bocfel "/undo")', () => {
  it('returns to the departed room without minting any edge', () => {
    const am = new Automapper();
    am.handleEvent(status('Hall', 0));
    am.handleEvent(cmd('n', 1));
    am.handleEvent(status('Kitchen', 1));

    am.handleEvent(cmd('/undo', 2));
    am.handleEvent(bufferText('[Undone]', 2));
    am.handleEvent(status('Hall', 2));

    expect(am.graph.currentRoomId).toBe('hall');
    // Only the original move's edge pair — no "/undo" custom edge, no new confirmed s.
    expect(am.graph.edges).toEqual([
      { from: 'hall', to: 'kitchen', dir: 'n', status: 'confirmed' },
      { from: 'kitchen', to: 'hall', dir: 's', status: 'inferred' },
    ]);
  });

  it('plain "undo" (v5+ games) is treated the same as "/undo"', () => {
    const am = new Automapper();
    am.handleEvent(status('Hall', 0));
    am.handleEvent(cmd('n', 1));
    am.handleEvent(status('Kitchen', 1));
    am.handleEvent(cmd('undo', 2));
    am.handleEvent(status('Hall', 2));

    expect(am.graph.currentRoomId).toBe('hall');
    expect(am.graph.edges.some((e) => e.dir.includes('undo'))).toBe(false);
  });

  it('undoing a move between two same-named rooms returns to the correct twin', () => {
    const am = new Automapper();
    am.handleEvent(bufferText('Forest\nThis is a dark forest.', 0));
    am.handleEvent(status('Forest', 0));
    // A same-name move needs the arrival title in the prose to register (rule 2).
    am.handleEvent(cmd('e', 1));
    am.handleEvent(bufferText('Forest\nThe trees thin out here.', 1));
    am.handleEvent(status('Forest', 1));
    expect(am.graph.currentRoomId).toBe('forest#2');

    // The undo's status line is IDENTICAL and prints no arrival title — only the
    // departed-room memory can know this went back to the first Forest.
    am.handleEvent(cmd('/undo', 2));
    am.handleEvent(bufferText('[Undone]', 2));
    am.handleEvent(status('Forest', 2));

    expect(am.graph.currentRoomId).toBe('forest');
    expect(am.graph.edges).toEqual([
      { from: 'forest', to: 'forest#2', dir: 'e', status: 'confirmed' },
      { from: 'forest#2', to: 'forest', dir: 'w', status: 'inferred' },
    ]);
  });

  it('undoing a non-move stays put and records nothing', () => {
    const am = new Automapper();
    am.handleEvent(status('Hall', 0));
    am.handleEvent(cmd('n', 1));
    am.handleEvent(status('Kitchen', 1));
    am.handleEvent(cmd('take lamp', 2));
    am.handleEvent(status('Kitchen', 2));

    am.handleEvent(cmd('/undo', 3));
    am.handleEvent(bufferText('[Undone]', 3));
    am.handleEvent(status('Kitchen', 3));

    expect(am.graph.currentRoomId).toBe('kitchen');
    expect(am.graph.rooms['kitchen'].blockedDirections).toBeUndefined();
    expect(am.graph.edges).toHaveLength(2); // just the n move's confirmed + inferred pair
  });
});

describe('rule 2 refinement: a later successful move clears a stale blockage', () => {
  it('drops the direction from blockedDirections once traversal succeeds (door opened)', () => {
    const am = new Automapper();
    am.handleEvent(status('Behind House', 0));
    am.handleEvent(cmd('w', 1));
    am.handleEvent(status('Behind House', 1)); // window shut: blocked, recorded
    expect(am.graph.rooms['behind-house'].blockedDirections).toEqual(['w']);

    am.handleEvent(cmd('open window', 2));
    am.handleEvent(status('Behind House', 2));
    am.handleEvent(cmd('w', 3));
    am.handleEvent(status('Kitchen', 3));

    expect(am.graph.currentRoomId).toBe('kitchen');
    expect(am.graph.rooms['behind-house'].blockedDirections).toBeUndefined();
    expect(am.graph.edges).toContainEqual({
      from: 'behind-house',
      to: 'kitchen',
      dir: 'w',
      status: 'confirmed',
    });
  });
});

describe('Batch 4: room floors', () => {
  it('gives the first room of a fresh game floor 0', () => {
    const am = new Automapper();
    am.handleEvent(status('Kitchen', 0));
    expect(am.graph.rooms['kitchen'].floor).toBe(0);
  });

  it('infers floor +1 on up, floor -1 on down, and stacks further moves', () => {
    const am = new Automapper();
    am.handleEvent(status('Cellar Stairs', 0));
    am.handleEvent(cmd('up', 1));
    am.handleEvent(status('Kitchen', 1));
    expect(am.graph.rooms['kitchen'].floor).toBe(1);

    am.handleEvent(cmd('up', 2));
    am.handleEvent(status('Attic', 2));
    expect(am.graph.rooms['attic'].floor).toBe(2);

    const am2 = new Automapper();
    am2.handleEvent(status('Kitchen', 0));
    am2.handleEvent(cmd('down', 1));
    am2.handleEvent(status('Cellar', 1));
    expect(am2.graph.rooms['cellar'].floor).toBe(-1);
  });

  it('carries the origin floor over unchanged on in/out moves', () => {
    const am = new Automapper();
    am.handleEvent(status('Behind House', 0));
    am.handleEvent(cmd('in', 1));
    am.handleEvent(status('Kitchen', 1));
    expect(am.graph.rooms['kitchen'].floor).toBe(0); // in/out = same level, per IF convention

    am.handleEvent(cmd('out', 2));
    am.handleEvent(status('Behind House', 2));
    expect(am.graph.rooms['behind-house'].floor).toBe(0);
  });

  it('keeps horizontal moves on the origin floor, above and below ground', () => {
    const am = new Automapper();
    am.handleEvent(status('Living Room', 0));
    am.handleEvent(cmd('down', 1));
    am.handleEvent(status('Cellar', 1));
    // Walking around the cellar must stay at -1 — this is the "rooms fall back onto the
    // ground-floor map" bug: horizontally-reached rooms used to stay floor-undefined.
    am.handleEvent(cmd('e', 2));
    am.handleEvent(status('Troll Room', 2));
    expect(am.graph.rooms['troll-room'].floor).toBe(-1);

    // ...and a later "up" computes from the REAL floor (-1), not a defaulted 0.
    am.handleEvent(cmd('up', 3));
    am.handleEvent(status('Ledge', 3));
    expect(am.graph.rooms['ledge'].floor).toBe(0);
  });

  it('carries the origin floor across rule-4 custom edges', () => {
    const am = new Automapper();
    am.handleEvent(status('Attic Landing', 0));
    am.handleEvent(cmd('up', 1));
    am.handleEvent(status('Attic', 1));
    am.handleEvent(cmd('climb through hatch', 2));
    am.handleEvent(bufferText('Crawlspace\nA cramped space under the eaves.', 2));
    am.handleEvent(status('Crawlspace', 2));
    expect(am.graph.rooms['crawlspace'].floor).toBe(1);
  });

  it('never overwrites an already floor-assigned room, even on a conflicting up/down arrival', () => {
    const am = new Automapper();
    am.handleEvent(status('Landing', 0));
    am.handleEvent(cmd('up', 1));
    am.handleEvent(status('Loft', 1)); // Loft -> floor 1 via this staircase

    // A second, convergent staircase also leads to Loft, but from a room two floors up —
    // a naive relative computation would say floor 3; the already-assigned floor 1 wins.
    am.handleEvent(cmd('up', 2));
    am.handleEvent(status('High Tower', 2));
    am.handleEvent(cmd('up', 3));
    am.handleEvent(status('Higher Tower', 3));
    am.handleEvent(cmd('down', 4));
    am.handleEvent(status('Loft', 4));

    expect(am.graph.rooms['loft'].floor).toBe(1);
  });

  it('setRoomFloor locks the floor so a later auto-inference leaves it untouched', () => {
    const am = new Automapper();
    am.handleEvent(status('Landing', 0));
    am.handleEvent(cmd('up', 1));
    am.handleEvent(status('Loft', 1));

    setRoomFloor(am.graph, 'loft', 9);
    expect(am.graph.rooms['loft'].floor).toBe(9);
    expect(am.graph.rooms['loft'].floorLocked).toBe(true);

    // Revisit via a fresh up-move from a different, floor-0 room: inference must not fire.
    const am2 = new Automapper(am.graph);
    am2.handleEvent(cmd('down', 2)); // leave Loft
    am2.handleEvent(status('Landing', 2));
    am2.handleEvent(cmd('up', 3));
    am2.handleEvent(status('Loft', 3));

    expect(am2.graph.rooms['loft'].floor).toBe(9);
    expect(am2.graph.rooms['loft'].floorLocked).toBe(true);
  });
});
