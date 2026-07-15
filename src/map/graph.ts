import type { GameEvent } from '../engine/types.js';
import { ALL_DIRECTIONS, isCompassDirection, normalizeDirection, opposite } from './directions.js';
import { detectMentionedDirections } from './mentions.js';

export type Direction =
  'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw' | 'up' | 'down' | 'in' | 'out';

export interface RoomNode {
  id: string; // slug of normalized name + optional '#2' disambiguator
  name: string; // display name as seen in status line
  pos: { x: number; y: number }; // grid coords, assigned by layout (Task 1.8)
  posLocked: boolean; // true once user drags the room (layout must not move it)
  note?: string;
  flags: { unknown?: boolean; teleportTarget?: boolean; userCreated?: boolean };
  firstDescription?: string; // first buffer_text on first arrival (feeds phase 3 art)
  /** UX-18 / Task 1.10: compass directions seen mentioned in this room's prose that have
   *  no confirmed edge (yet). A soft suggestion, never map-affecting — see mentions.ts. */
  mentionedDirections?: Direction[];
  /**
   * Compass directions where a move was attempted from this room and blocked (rule 2:
   * no edge is created). Never affects edges/routing — a passive-only fingerprint,
   * exactly like `mentionedDirections` — but rule 6's disambiguation uses it to widen a
   * candidate's known signature beyond just its recorded edges: a room can't be BOTH
   * "confirmed to move east" and "blocked going east", so either signal contradicting
   * the other is evidence of a text-ambiguous merge (see resolveRoomOnArrival).
   */
  blockedDirections?: Direction[];
}

export interface RoomEdge {
  from: string; // RoomNode.id
  to: string;
  // One of the 12 compass words, OR (rule 4, revised) the exact raw command text used
  // for a non-compass move that still changed rooms (e.g. "climb ladder", "go around
  // house", "enter window") — `isCompassDirection()` tells the two apart. Custom edges
  // have no `opposite`, so no inferred reverse is auto-added for them (see rule 4 notes
  // in SPECS.md): a link back only appears once actually traversed the other way.
  dir: Direction | string;
  status: 'confirmed' | 'inferred'; // inferred = auto-added reverse edge
  userDeleted?: boolean; // tombstone: automapper must never re-add this edge
}

export interface MapGraph {
  rooms: Record<string, RoomNode>;
  edges: RoomEdge[]; // uniqueness key: (from, dir) among non-tombstoned edges
  currentRoomId: string | null;
  /**
   * nameKey -> canonical room id. Populated by mergeRooms() (rule 7: user merges are
   * sticky) so future arrivals under either name resolve to the surviving room.
   * Not in the original SPECS.md MapGraph sketch; added here because rule 7 requires it.
   */
  aliases: Record<string, string>;
}

export const UNKNOWN_ROOM_ID = 'unknown';
const UNKNOWN_ROOM_NAME = '(unknown)';

export function createEmptyGraph(): MapGraph {
  return { rooms: {}, edges: [], currentRoomId: null, aliases: {} };
}

/** Case-insensitive matching key (SPECS.md §3 rule 8: case-preserving storage). */
function nameKey(name: string): string {
  return name.toLowerCase();
}

/**
 * Trim, collapse whitespace, and strip trailing score/moves fragments that some games'
 * custom status lines leave stuck to the room name (SPECS.md §3 rule 8).
 */
export function normalizeRoomName(raw: string): string {
  let s = raw.trim();
  s = s.replace(/\s{2,}(score|moves|turns|time)\s*:.*$/i, '');
  s = s.replace(/\s*(\[[^[\]]*\]|\([^()]*\))\s*$/, '');
  s = s.replace(/\s+/g, ' ').trim();
  return s;
}

function slugify(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || 'room';
}

function findRoomsByName(graph: MapGraph, name: string): RoomNode[] {
  const key = nameKey(name);
  return Object.values(graph.rooms).filter(
    (r) => r.id !== UNKNOWN_ROOM_ID && nameKey(r.name) === key,
  );
}

function createRoom(graph: MapGraph, name: string, suffixIndex: number): RoomNode {
  const base = slugify(name);
  let index = suffixIndex;
  let id = index === 0 ? base : `${base}#${index + 1}`;
  // deleteRoom() can leave holes in the numbering, so the count-derived id may be taken
  while (graph.rooms[id]) {
    index += 1;
    id = `${base}#${index + 1}`;
  }
  const room: RoomNode = { id, name, pos: { x: 0, y: 0 }, posLocked: false, flags: {} };
  graph.rooms[id] = room;
  return room;
}

/**
 * What the turn's prose says about the arrival: whether the destination room's title
 * line was printed (games echo the room name on every successful move — including moves
 * between two same-named rooms, which the status line alone can't distinguish from a
 * blocked move), and the description paragraph that follows it (printed on first visits
 * even in brief mode; the only signal that tells Zork's several "Forest" rooms apart).
 */
interface ArrivalText {
  announced: boolean;
  description: string | null;
}

function extractArrival(turnText: string, roomName: string): ArrivalText {
  const lines = turnText.split('\n').map((line) => line.trim());
  const key = nameKey(roomName);
  const titleIndex = lines.findIndex(
    (line) => line.length > 0 && nameKey(normalizeRoomName(line)) === key,
  );
  if (titleIndex === -1) return { announced: false, description: null };
  for (let i = titleIndex + 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line || line === '>') continue;
    return { announced: true, description: line };
  }
  return { announced: true, description: null };
}

/**
 * Matching key for room descriptions: the first sentence, whitespace-collapsed,
 * case-insensitive. Only the first sentence, because later ones often carry mutable
 * state ("...a small window which is slightly ajar/open") that would make the same room
 * look like a different one after the world changes.
 */
function descriptionKey(description: string): string {
  const match = description.match(/^.*?[.!?]/);
  return (match ? match[0] : description).toLowerCase().replace(/\s+/g, ' ').trim();
}

/** First captured description wins (it names the room's identity); later ones are state. */
function rememberDescription(room: RoomNode, description: string | null): RoomNode {
  if (description && !room.firstDescription) room.firstDescription = description;
  return room;
}

/**
 * A traversal just contradicted an already-CONFIRMED edge's target — e.g. `original`'s
 * `w` was confirmed to lead to room A, but this turn it led to room B instead. That's
 * strong evidence `original` was a text-ambiguous merge (two physically distinct rooms
 * sharing one name+description, like Zork's several indistinguishable "dimly lit
 * forest" rooms) rather than a genuinely rerouted exit: silently overwriting the
 * confirmed edge would destroy a previously-good observation to make room for this new
 * one, which is exactly the "the map gets overwritten" failure mode. Instead, split off
 * a fresh sibling room for THIS turn's real origin and attach the new edge there,
 * leaving `original`'s confirmed edges untouched. The clone inherits `original`'s name
 * and `firstDescription` — they're known to share identical text (that's *why* the
 * contradiction happened), so a later arrival with that same description can still
 * land on either sibling via rule 6's reverse-edge tie-break, rather than only ever
 * re-matching the original.
 */
function splitRoomForContradiction(graph: MapGraph, originalId: string): RoomNode {
  const original = graph.rooms[originalId];
  const existing = findRoomsByName(graph, original.name);
  const clone = createRoom(graph, original.name, existing.length);
  clone.firstDescription = original.firstDescription;
  return clone;
}

/**
 * Used whenever `room`'s own recorded signature (a CONFIRMED edge, or a recorded
 * blocked direction) contradicts a fresh observation in `dir` — the destination is
 * `expectedTo`, or `null` for "this direction just turned out to be blocked". Rather
 * than always minting a brand-new sibling via `splitRoomForContradiction` (which would
 * mint a FRESH duplicate every single time the same real physical room gets revisited
 * and re-contradicts `room` the same way — e.g. bouncing off the same wall from the
 * same merged node repeatedly used to produce a new `#N` on every bounce), first look
 * for an EXISTING same-named, same-description sibling (typically one split off by an
 * earlier contradiction) that isn't itself contradicted by this same observation.
 * Reusing that sibling is what lets repeated visits to one real physical room converge
 * onto a single node instead of scattering across an ever-growing set of duplicates.
 */
function findCompatibleSiblingOrSplit(
  graph: MapGraph,
  room: RoomNode,
  dir: Direction | string,
  expectedTo: string | null,
): RoomNode {
  const sameFamily = findRoomsByName(graph, room.name).filter(
    (r) => r.id !== room.id && r.firstDescription === room.firstDescription,
  );
  const compatible = sameFamily.find((sibling) => {
    const edge = liveEdgeAt(graph, sibling.id, dir);
    if (edge?.status === 'confirmed') return edge.to === expectedTo;
    if (expectedTo != null && isCompassDirection(dir) && sibling.blockedDirections?.includes(dir)) {
      return false; // sibling is known-blocked here; a successful move contradicts that
    }
    return true;
  });
  return compatible ?? splitRoomForContradiction(graph, room.id);
}

/**
 * Resolves the room a player has just arrived at, applying rule 6's disambiguation for
 * duplicate display names (e.g. Zork's several "Forest" rooms), strongest signal first:
 *
 * 1. Alias table (rule 7: user merges/renames are sticky).
 * 2. Forward edge: if `(fromId, rawDir)` was already traversed and its target has this
 *    name, that's the room — retracing a known exit must never re-open disambiguation
 *    (reusing a same-named sibling here is what used to reroute confirmed edges).
 * 3. Description fingerprint (first sentence of the arrival paragraph, captured on first
 *    visits even in brief mode): if the description matches exactly ONE existing
 *    candidate's stored `firstDescription`, that candidate IS the room — full stop,
 *    skipping step 4 entirely. Positive content identity beats a topological guess: Zork
 *    has rooms reachable from several unrelated directions that don't correspond to each
 *    other (mountains -n/-s/-w-> the same "dimly lit forest" room — the map's "passageway
 *    returning to room of origin" symbol), so a *different* edge on the matched candidate
 *    pointing elsewhere is not a contradiction, just an unrelated edge; treating it as one
 *    used to split that single real room into spurious `#2`/`#3`/`#4` duplicates. If
 *    several candidates share the identical description (genuinely indistinguishable
 *    prose — Zork's own mini-maze), or none has a stored description yet, identity is
 *    ambiguous and step 4 breaks the tie.
 * 4. Hub preference (only reached when step 3 left >1 candidate, or none): if `fromId`
 *    already has SOME confirmed edge to a candidate via a DIFFERENT direction, that
 *    candidate is the room — checked BEFORE, and independent of, step 5's reverse-edge
 *    check below, because that check assumes single-entrance reciprocity and is
 *    actively wrong for a multi-entrance hub room (Zork: mountains' n/s/w all converge
 *    on the one "dimly lit forest" room regardless of that room's own reverse-direction
 *    state — which may well be blocked, as it genuinely is here — so gating hub
 *    preference behind the reverse-edge check would let it veto the very candidates hub
 *    preference exists to catch). A room `fromId` already confirms it connects to is far
 *    more likely to be where a fresh, different direction from `fromId` also leads than
 *    an as-yet-unconnected sibling is.
 * 5. Reverse-edge compatibility: prefer a candidate whose own reverse edge already
 *    points back to `fromId`; a candidate whose CONFIRMED reverse edge points elsewhere,
 *    OR whose recorded `blockedDirections` contains the reverse direction (a room can't
 *    simultaneously be "confirmed passable" and "confirmed blocked" the same way),
 *    contradicts the geography and is excluded. An *inferred* reverse edge pointing
 *    elsewhere is no contradiction — it's an automapper guess, and asymmetric passages
 *    (Zork: Behind House -s-> South of House, whose own n is a boarded wall) make such
 *    guesses routinely wrong; vetoing on them used to split unique rooms into `#2`s.
 * 6. Nothing survives -> numbered duplicate (`name#2`, `#3`, ...).
 *
 * `fromId`/`compassDir` are null for teleports and the very first room of a game, where
 * there's no directional edge to check compatibility against.
 */
function resolveRoomOnArrival(
  graph: MapGraph,
  fromId: string | null,
  rawDir: Direction | string | null,
  compassDir: Direction | null,
  name: string,
  description: string | null,
): RoomNode {
  const aliasId = graph.aliases[nameKey(name)];
  if (aliasId && graph.rooms[aliasId]) {
    return rememberDescription(graph.rooms[aliasId], description);
  }

  if (fromId != null && rawDir != null) {
    const forward = liveEdgeAt(graph, fromId, rawDir);
    const forwardRoom = forward ? graph.rooms[forward.to] : undefined;
    if (forwardRoom && nameKey(forwardRoom.name) === nameKey(name)) {
      return rememberDescription(forwardRoom, description);
    }
  }

  const allByName = findRoomsByName(graph, name);
  let candidates = allByName;
  if (description != null) {
    const key = descriptionKey(description);
    const matching = candidates.filter(
      (c) => c.firstDescription && descriptionKey(c.firstDescription) === key,
    );
    if (matching.length === 1) return rememberDescription(matching[0], description);
    candidates = matching.length > 0 ? matching : candidates.filter((c) => !c.firstDescription);
  }

  if (fromId != null && compassDir != null) {
    const oppDir = opposite(compassDir);
    // Hub preference (checked first, independent of reverse-edge contradiction below):
    // if `fromId` already has SOME confirmed edge to a candidate via a DIFFERENT
    // direction, that beats the reverse-edge heuristic entirely — that heuristic
    // assumes single-entrance reciprocity and is actively wrong for a multi-entrance
    // hub room (Zork: mountains' n/s/w all converge on the one "dimly lit forest" room
    // regardless of ITS reverse-direction state, which may well be blocked, as it
    // genuinely is here). A room `fromId` already confirms it connects to is far more
    // likely to be where a fresh, different direction from `fromId` also leads.
    const hubMatch = candidates.find((c) =>
      graph.edges.some(
        (e) => e.from === fromId && e.to === c.id && e.status === 'confirmed' && !e.userDeleted,
      ),
    );
    if (hubMatch) return rememberDescription(hubMatch, description);

    let uncontradicted: RoomNode | null = null;
    for (const candidate of candidates) {
      const reverseEdge = graph.edges.find(
        (e) => e.from === candidate.id && e.dir === oppDir && !e.userDeleted,
      );
      if (reverseEdge && reverseEdge.to === fromId) {
        return rememberDescription(candidate, description);
      }
      const edgeContradicted = reverseEdge?.status === 'confirmed' && reverseEdge.to !== fromId;
      const blockedContradicted = candidate.blockedDirections?.includes(oppDir) ?? false;
      if (!edgeContradicted && !blockedContradicted && !uncontradicted) uncontradicted = candidate;
    }
    if (uncontradicted) return rememberDescription(uncontradicted, description);
  } else if (candidates.length > 0) {
    return rememberDescription(candidates[0], description);
  }
  return rememberDescription(createRoom(graph, name, allByName.length), description);
}

function liveEdgeAt(graph: MapGraph, from: string, dir: Direction | string): RoomEdge | undefined {
  return graph.edges.find((e) => e.from === from && e.dir === dir && !e.userDeleted);
}

function isTombstoned(graph: MapGraph, from: string, dir: Direction | string): boolean {
  return graph.edges.some((e) => e.from === from && e.dir === dir && e.userDeleted);
}

/** Creates or overwrites the live edge at (from, dir), unless that key is tombstoned. */
function upsertEdge(
  graph: MapGraph,
  from: string,
  dir: Direction | string,
  to: string,
  status: RoomEdge['status'],
): void {
  if (isTombstoned(graph, from, dir)) return;
  const existing = liveEdgeAt(graph, from, dir);
  if (existing) {
    existing.to = to;
    existing.status = status;
  } else {
    graph.edges.push({ from, to, dir, status });
  }
}

/** Auto-adds the inferred reverse edge for a newly confirmed traversal (rule 1). */
function maybeAddInferredReverse(graph: MapGraph, from: string, to: string, dir: Direction): void {
  if (isTombstoned(graph, from, dir)) return;
  if (liveEdgeAt(graph, from, dir)) return; // already exists (any status)
  graph.edges.push({ from, to, dir, status: 'inferred' });
}

/**
 * Merges `mergeId` into `keepId`: repoints all edges, records both names as aliases so
 * future arrivals under either resolve to `keepId`, and deletes the merged room.
 * (SPECS.md §3 rule 7 — the long-press "merge" UI action itself is Task 1.8 polish and
 * out of scope here; this is the pure-logic primitive it will call.)
 */
export function mergeRooms(graph: MapGraph, keepId: string, mergeId: string): void {
  if (keepId === mergeId) return;
  const keep = graph.rooms[keepId];
  const merged = graph.rooms[mergeId];
  if (!keep || !merged) return;

  for (const edge of graph.edges) {
    if (edge.from === mergeId) edge.from = keepId;
    if (edge.to === mergeId) edge.to = keepId;
  }
  const seen = new Set<string>();
  graph.edges = graph.edges.filter((e) => {
    if (e.from === e.to) return false; // merge created a self-loop; drop it
    const key = `${e.from}|${e.dir}`;
    if (seen.has(key)) return false; // merge created a duplicate edge key; keep first
    seen.add(key);
    return true;
  });

  graph.aliases[nameKey(keep.name)] = keepId;
  graph.aliases[nameKey(merged.name)] = keepId;
  delete graph.rooms[mergeId];
  if (graph.currentRoomId === mergeId) graph.currentRoomId = keepId;
}

/**
 * Renames a room (Task 1.8's long-press "rename" action). Since arrival matching is
 * purely name-based (rule 8), a bare rename would strand future arrivals under the
 * room's *original* status-line name — they'd find no existing room by that name and
 * create a stray duplicate. So this also records the old name as an alias to this room's
 * id (the same mechanism `mergeRooms` uses for rule 7's "user edits win, forever"),
 * meaning arrivals under either the old or new name resolve here from now on.
 */
export function renameRoom(graph: MapGraph, id: string, name: string): void {
  const room = graph.rooms[id];
  if (!room || !name.trim()) return;
  graph.aliases[nameKey(room.name)] = id;
  room.name = name.trim();
  graph.aliases[nameKey(room.name)] = id;
}

/** Sets a room's free-text note (Task 1.8). Automapper never touches `note`, so this is
 *  sticky by construction — no tombstone bookkeeping needed. */
export function setRoomNote(graph: MapGraph, id: string, note: string): void {
  const room = graph.rooms[id];
  if (!room) return;
  room.note = note || undefined;
}

/**
 * Deletes a room and tombstones every edge touching it (Task 1.8's long-press "delete"
 * action) — cleanup for mis-mapped/junk nodes (stray teleport targets, a wrongly-split
 * Maze duplicate). Unlike `mergeRooms`/rule 7, this is deliberately NOT permanently
 * sticky by name: there's no "this name is deleted forever" concept in the rules, so if
 * the player revisits the same status-line room later, the automapper will simply
 * re-discover it as a fresh node, same as if it had never been mapped. Refuses to
 * delete the current room (there would be nothing left to anchor the map to).
 */
export function deleteRoom(graph: MapGraph, id: string): void {
  if (!graph.rooms[id] || graph.currentRoomId === id) return;
  for (const edge of graph.edges) {
    if (edge.from === id || edge.to === id) edge.userDeleted = true;
  }
  delete graph.rooms[id];
}

/**
 * Records a user drag (Task 1.8): sets the room's position and locks it so `computeLayout`
 * treats it as a fixed anchor forever after (rule 7 — "posLocked positions never
 * re-laid-out").
 */
export function moveRoom(graph: MapGraph, id: string, pos: { x: number; y: number }): void {
  const room = graph.rooms[id];
  if (!room) return;
  room.pos = pos;
  room.posLocked = true;
}

type Pending =
  { kind: 'move'; dir: Direction } | { kind: 'other'; label: string } | { kind: 'initial' };

/**
 * Consumes a GameEvent stream and maintains a MapGraph, per SPECS.md §3's 8 rules.
 * Feed it every event (silent autosave-driven events included — see engine/types.ts's
 * note that state-tracking consumers can ignore the `silent` flag).
 */
export class Automapper {
  readonly graph: MapGraph;
  private pending: Pending;
  /** UX-18: accumulates buffer_text seen since the last status_line, so mentions can be
   *  attributed to whichever room the turn resolves to (see applyMentions). */
  private pendingText = '';

  constructor(graph: MapGraph = createEmptyGraph()) {
    this.graph = graph;
    this.pending = graph.currentRoomId ? { kind: 'other', label: '' } : { kind: 'initial' };
  }

  handleEvent(event: GameEvent): void {
    if (event.kind === 'command') {
      const dir = normalizeDirection(event.text);
      this.pending = dir ? { kind: 'move', dir } : { kind: 'other', label: event.text.trim() };
      return;
    }
    if (event.kind === 'buffer_text') {
      this.pendingText += '\n' + event.text;
      return;
    }
    if (event.kind === 'status_line') {
      const text = this.pendingText;
      this.pendingText = '';
      this.handleStatusLine(event.left, text);
      this.applyMentions(text);
    }
  }

  /** UX-18: attach direction words seen in this turn's prose to the room the turn
   *  resolved to. Runs AFTER handleStatusLine so movement text ("You walk north…
   *  Kitchen") attributes to the arrival room, not the origin. */
  private applyMentions(text: string): void {
    const id = this.graph.currentRoomId;
    if (!id || id === UNKNOWN_ROOM_ID) return;
    const room = this.graph.rooms[id];
    if (!room) return;
    const found = detectMentionedDirections(text);
    if (found.length === 0) return;
    const merged = new Set([...(room.mentionedDirections ?? []), ...found]);
    room.mentionedDirections = ALL_DIRECTIONS.filter((d) => merged.has(d));
  }

  /**
   * Rule 2 (widened): a blocked move creates no edge, but is still free, passive
   * evidence for rule 6's fingerprint — record the direction on the current room's
   * `blockedDirections`. If that room already has a CONFIRMED edge in this exact
   * direction, the two observations directly contradict each other (a room can't be
   * both "confirmed passable going X" and "just blocked going X"), which is the same
   * text-ambiguous-merge signal `findCompatibleSiblingOrSplit` already handles for
   * successful moves — reattach `currentRoomId` to a compatible sibling (or split off a
   * fresh one) rather than recording a self-contradictory blockage on the wrongly-merged
   * node.
   */
  private handleBlockedMove(dir: Direction): void {
    const id = this.graph.currentRoomId;
    if (!id || id === UNKNOWN_ROOM_ID) return;
    let room = this.graph.rooms[id];
    if (!room) return;

    if (liveEdgeAt(this.graph, id, dir)?.status === 'confirmed') {
      room = findCompatibleSiblingOrSplit(this.graph, room, dir, null);
      this.graph.currentRoomId = room.id;
    }

    const merged = new Set([...(room.blockedDirections ?? []), dir]);
    room.blockedDirections = ALL_DIRECTIONS.filter((d) => merged.has(d));
  }

  private handleStatusLine(rawLeft: string, turnText: string): void {
    const pending = this.pending;
    this.pending = { kind: 'other', label: '' };

    const normalized = normalizeRoomName(rawLeft);
    const isUnknown = normalized.length === 0;
    const currentId = this.graph.currentRoomId;
    const currentRoom = currentId ? this.graph.rooms[currentId] : null;
    const arrival = isUnknown
      ? { announced: false, description: null }
      : extractArrival(turnText, normalized);

    const sameAsCurrent =
      currentRoom != null &&
      (isUnknown
        ? currentId === UNKNOWN_ROOM_ID
        : currentId !== UNKNOWN_ROOM_ID && nameKey(currentRoom.name) === nameKey(normalized));

    // rule 2, refined: an unchanged status line is only a blocked move if the prose
    // didn't announce an arrival. A successful move re-prints the destination's title
    // line ("Forest" -> east -> "Forest"), which is the one signal that separates
    // moving between two same-named rooms from bouncing off a wall. Compass moves only:
    // non-move commands ("look", "examine") also re-print the title.
    const sameNameMove = sameAsCurrent && pending.kind === 'move' && arrival.announced;
    if (sameAsCurrent && !sameNameMove) {
      if (pending.kind === 'move') this.handleBlockedMove(pending.dir);
      return; // blocked move (or repeated teleport/unknown)
    }

    if (isUnknown) {
      // rule 5: dark room / unrecognized status -> shared singleton, no edges recorded
      if (!this.graph.rooms[UNKNOWN_ROOM_ID]) {
        this.graph.rooms[UNKNOWN_ROOM_ID] = {
          id: UNKNOWN_ROOM_ID,
          name: UNKNOWN_ROOM_NAME,
          pos: { x: 0, y: 0 },
          posLocked: false,
          flags: { unknown: true },
        };
      }
      this.graph.currentRoomId = UNKNOWN_ROOM_ID;
      return;
    }

    if (pending.kind === 'move') {
      this.handleMovement(currentId, pending.dir, normalized, arrival.description);
      return;
    }

    if (pending.kind === 'other' && currentId != null && currentId !== UNKNOWN_ROOM_ID) {
      // rule 4 (revised): a non-compass command that still changed the room is a real,
      // repeatable connection — "climb ladder", "go around house", "enter window" — so
      // link it using the actual command text as the edge label, rather than dropping
      // it as an unconnected teleport. Only a command with nothing to link *from* (the
      // very first room of the game, or leaving the shared unknown/dark singleton,
      // handled below) has no edge to record.
      this.handleMovement(currentId, pending.label, normalized, arrival.description);
      return;
    }

    // true teleport bootstrap: no origin at all to hang an edge off of
    const room = resolveRoomOnArrival(
      this.graph,
      null,
      null,
      null,
      normalized,
      arrival.description,
    );
    if (pending.kind === 'other') room.flags.teleportTarget = true;
    this.graph.currentRoomId = room.id;
  }

  private handleMovement(
    fromId: string | null,
    dir: Direction | string,
    destName: string,
    description: string | null,
  ): void {
    // No origin to hang an edge off of (unknown room, or move before any room is known).
    const from = fromId === UNKNOWN_ROOM_ID ? null : fromId;
    const compassDir = isCompassDirection(dir) ? dir : null;
    const destRoom = resolveRoomOnArrival(this.graph, from, dir, compassDir, destName, description);
    // A real self-loop exit ("north leads back here") says nothing about the opposite
    // direction, so no reverse is inferred for it.
    const inferReverse = compassDir != null && destRoom.id !== from;

    if (from != null) {
      const live = liveEdgeAt(this.graph, from, dir);
      if (!live) {
        // rule 1: new confirmed edge + inferred reverse (compass moves only — a custom
        // edge label has no known opposite, so no reverse is guessed for it; see rule 4)
        upsertEdge(this.graph, from, dir, destRoom.id, 'confirmed');
        if (inferReverse)
          maybeAddInferredReverse(this.graph, destRoom.id, from, opposite(compassDir!));
      } else if (live.status === 'inferred') {
        // rule 3: inferred edge traversed -> promote, or correct a one-way passage
        if (live.to === destRoom.id) {
          live.status = 'confirmed';
        } else {
          upsertEdge(this.graph, from, dir, destRoom.id, 'confirmed');
          if (inferReverse)
            maybeAddInferredReverse(this.graph, destRoom.id, from, opposite(compassDir!));
        }
      } else if (live.to !== destRoom.id) {
        // A CONFIRMED edge contradicted by fresh traversal: treat `from` as having been
        // a text-ambiguous merge (see findCompatibleSiblingOrSplit) rather than
        // clobbering previously-confirmed data with this turn's differing destination.
        const clone = findCompatibleSiblingOrSplit(
          this.graph,
          this.graph.rooms[from],
          dir,
          destRoom.id,
        );
        upsertEdge(this.graph, clone.id, dir, destRoom.id, 'confirmed');
        if (compassDir != null && destRoom.id !== clone.id)
          maybeAddInferredReverse(this.graph, destRoom.id, clone.id, opposite(compassDir));
      }
    }

    this.graph.currentRoomId = destRoom.id;
  }
}
