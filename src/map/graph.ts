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
  const id = suffixIndex === 0 ? base : `${base}#${suffixIndex + 1}`;
  const room: RoomNode = { id, name, pos: { x: 0, y: 0 }, posLocked: false, flags: {} };
  graph.rooms[id] = room;
  return room;
}

/**
 * Resolves the room a player has just arrived at, applying rule 6's disambiguation:
 * given several existing rooms with the same display name (e.g. Zork's "Maze"), reuse
 * one only if its own reverse edge is either absent or already points back to `fromId` —
 * otherwise the geography contradicts reusing it, so a numbered duplicate is created.
 * `fromId`/`dir` are null for teleports and the very first room of a game, where there's
 * no directional edge to check compatibility against.
 */
function resolveRoomOnArrival(
  graph: MapGraph,
  fromId: string | null,
  dir: Direction | null,
  name: string,
): RoomNode {
  const aliasId = graph.aliases[nameKey(name)];
  if (aliasId && graph.rooms[aliasId]) return graph.rooms[aliasId];

  const candidates = findRoomsByName(graph, name);
  if (fromId != null && dir != null) {
    const oppDir = opposite(dir);
    for (const candidate of candidates) {
      const reverseEdge = graph.edges.find(
        (e) => e.from === candidate.id && e.dir === oppDir && !e.userDeleted,
      );
      if (!reverseEdge || reverseEdge.to === fromId) return candidate;
    }
  } else if (candidates.length > 0) {
    return candidates[0];
  }
  return createRoom(graph, name, candidates.length);
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
      this.handleStatusLine(event.left);
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

  private handleStatusLine(rawLeft: string): void {
    const pending = this.pending;
    this.pending = { kind: 'other', label: '' };

    const normalized = normalizeRoomName(rawLeft);
    const isUnknown = normalized.length === 0;
    const currentId = this.graph.currentRoomId;
    const currentRoom = currentId ? this.graph.rooms[currentId] : null;

    const sameAsCurrent =
      currentRoom != null &&
      (isUnknown
        ? currentId === UNKNOWN_ROOM_ID
        : currentId !== UNKNOWN_ROOM_ID && nameKey(currentRoom.name) === nameKey(normalized));

    if (sameAsCurrent) return; // rule 2: blocked move (or repeated teleport/unknown), no-op

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
      this.handleMovement(currentId, pending.dir, normalized);
      return;
    }

    if (pending.kind === 'other' && currentId != null && currentId !== UNKNOWN_ROOM_ID) {
      // rule 4 (revised): a non-compass command that still changed the room is a real,
      // repeatable connection — "climb ladder", "go around house", "enter window" — so
      // link it using the actual command text as the edge label, rather than dropping
      // it as an unconnected teleport. Only a command with nothing to link *from* (the
      // very first room of the game, or leaving the shared unknown/dark singleton,
      // handled below) has no edge to record.
      this.handleMovement(currentId, pending.label, normalized);
      return;
    }

    // true teleport bootstrap: no origin at all to hang an edge off of
    const room = resolveRoomOnArrival(this.graph, null, null, normalized);
    if (pending.kind === 'other') room.flags.teleportTarget = true;
    this.graph.currentRoomId = room.id;
  }

  private handleMovement(fromId: string | null, dir: Direction | string, destName: string): void {
    // No origin to hang an edge off of (unknown room, or move before any room is known).
    const from = fromId === UNKNOWN_ROOM_ID ? null : fromId;
    const compassDir = isCompassDirection(dir) ? dir : null;
    const destRoom = resolveRoomOnArrival(this.graph, from, compassDir, destName);

    if (from != null) {
      const live = liveEdgeAt(this.graph, from, dir);
      if (!live) {
        // rule 1: new confirmed edge + inferred reverse (compass moves only — a custom
        // edge label has no known opposite, so no reverse is guessed for it; see rule 4)
        upsertEdge(this.graph, from, dir, destRoom.id, 'confirmed');
        if (compassDir)
          maybeAddInferredReverse(this.graph, destRoom.id, from, opposite(compassDir));
      } else if (live.status === 'inferred') {
        // rule 3: inferred edge traversed -> promote, or correct a one-way passage
        if (live.to === destRoom.id) {
          live.status = 'confirmed';
        } else {
          upsertEdge(this.graph, from, dir, destRoom.id, 'confirmed');
          if (compassDir)
            maybeAddInferredReverse(this.graph, destRoom.id, from, opposite(compassDir));
        }
      } else if (live.to !== destRoom.id) {
        // rule 1's "upsert": a confirmed edge now leads somewhere else (rerouted exit)
        live.to = destRoom.id;
      }
    }

    this.graph.currentRoomId = destRoom.id;
  }
}
