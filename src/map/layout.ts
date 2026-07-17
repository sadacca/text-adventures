import { gridOffset } from './directions.js';
import type { Direction, MapGraph, RoomNode } from './graph.js';

/**
 * Assigns grid positions to rooms, floor by floor (SPECS.md §2; Batch 4 / UX-21 groups
 * rooms by `floor ?? 0` and lays each floor out independently — different floors freely
 * reuse the same x/y coordinates, harmless since `MapScreen` renders one floor at a
 * time).
 *
 * 2026-07-17 rework, map stability: layout is now INCREMENTAL. A room that has ever
 * been placed (`posAssigned`, or `posLocked` from a user drag) keeps its position on
 * every later run; only never-placed rooms are positioned, BFS-ing outward from the
 * already-placed part of the floor and offsetting each hop by its direction's grid
 * vector. The previous design re-derived the whole floor from scratch on every event,
 * anchored at the CURRENT room — so re-entering a floor from a different room (the
 * normal thing to do after going up/down stairs) re-anchored the BFS somewhere new and
 * reshuffled the entire floor. Now the anchor for a floor's very first layout is that
 * floor's first-discovered room, and everything after that only ever adds to a stable
 * picture.
 *
 * Collision resolution is footprint-aware: a candidate cell is free only if no placed
 * room sits within a room-box-plus-margin of it (the old exact-cell-key check let
 * fractional positions — up/down's 0.5/1.35 offsets — land half a cell from an integer
 * cell and overlap its label).
 */
export function computeLayout(graph: MapGraph): void {
  const rooms = Object.values(graph.rooms);
  if (rooms.length === 0) return;

  const byFloor = new Map<number, RoomNode[]>();
  for (const room of rooms) {
    const floor = room.floor ?? 0;
    const bucket = byFloor.get(floor);
    if (bucket) bucket.push(room);
    else byFloor.set(floor, [room]);
  }

  for (const floorRooms of byFloor.values()) {
    layoutFloor(graph, floorRooms);
  }
}

/** Minimum center-to-center separation (in grid cells) below which two rooms' boxes
 *  (92x48 px at 110 px/cell, so 0.84x0.44 cells) are considered overlapping. Slightly
 *  larger than the box itself so labels keep breathing room. */
const MIN_SEP_X = 0.9;
const MIN_SEP_Y = 0.6;

/** Places every not-yet-placed room on this floor, BFS-ing outward from the rooms that
 *  already have positions (multi-source), in stable insertion order. */
function layoutFloor(graph: MapGraph, floorRooms: RoomNode[]): void {
  const occupied: { x: number; y: number }[] = [];
  const visited = new Set<string>();
  const queue: RoomNode[] = [];

  for (const room of floorRooms) {
    if (room.posLocked || room.posAssigned) {
      occupied.push(room.pos);
      visited.add(room.id);
      queue.push(room);
    }
  }

  // First layout of this floor: anchor at its first-discovered room, at wherever it
  // already sits (persisted maps keep old coordinates; fresh rooms default to 0,0).
  // Deliberately NOT the current room — the anchor must not depend on where the player
  // happens to stand, or the floor re-anchors every time it's re-entered elsewhere.
  if (queue.length === 0) {
    const anchor = floorRooms[0];
    place(anchor, findFreePos(anchor.pos, occupied), occupied);
    visited.add(anchor.id);
    queue.push(anchor);
  }

  while (queue.length > 0) {
    const room = queue.shift()!;
    for (const { dir, roomId } of neighborsOf(graph, room.id, room.floor ?? 0)) {
      const neighbor = graph.rooms[roomId];
      if (!neighbor || visited.has(neighbor.id)) continue;
      visited.add(neighbor.id);
      const offset = gridOffset(dir) ?? { dx: 1.5, dy: 0 }; // custom edges: nudge sideways
      const desired = { x: room.pos.x + offset.dx, y: room.pos.y + offset.dy };
      place(neighbor, findFreePos(desired, occupied), occupied);
      queue.push(neighbor);
    }
  }

  // Rooms the BFS never reached (teleport targets, the unknown singleton, disconnected
  // Maze duplicates) still need to be visible: line them up off to the side.
  let floatIndex = 0;
  for (const room of floorRooms) {
    if (visited.has(room.id)) continue;
    place(room, findFreePos({ x: -3, y: floatIndex * 1.5 }, occupied), occupied);
    floatIndex++;
  }
}

function place(
  room: RoomNode,
  pos: { x: number; y: number },
  occupied: { x: number; y: number }[],
) {
  room.pos = pos;
  room.posAssigned = true;
  occupied.push(pos);
}

function collides(pos: { x: number; y: number }, occupied: { x: number; y: number }[]): boolean {
  return occupied.some(
    (o) => Math.abs(o.x - pos.x) < MIN_SEP_X && Math.abs(o.y - pos.y) < MIN_SEP_Y,
  );
}

function findFreePos(
  desired: { x: number; y: number },
  occupied: { x: number; y: number }[],
): { x: number; y: number } {
  if (!collides(desired, occupied)) return desired;
  const cx = Math.round(desired.x);
  const cy = Math.round(desired.y);
  for (let radius = 1; radius <= 8; radius++) {
    for (let dx = -radius; dx <= radius; dx++) {
      for (let dy = -radius; dy <= radius; dy++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== radius) continue;
        const candidate = { x: cx + dx, y: cy + dy };
        if (!collides(candidate, occupied)) return candidate;
      }
    }
  }
  return desired; // give up rather than loop forever; overlap is a rare, cosmetic fallback
}

/** Batch 4 / UX-21: only follows an edge whose destination is on the SAME floor as
 *  `roomId` — a crossing (up/down) edge is skipped during layout, never removed from
 *  `graph.edges`; it renders as a stub instead (see `MapScreen`'s `buildSegments`). */
function neighborsOf(
  graph: MapGraph,
  roomId: string,
  floor: number,
): { dir: Direction | string; roomId: string }[] {
  const result: { dir: Direction | string; roomId: string }[] = [];
  for (const edge of graph.edges) {
    if (edge.userDeleted || edge.from !== roomId) continue;
    const dest = graph.rooms[edge.to];
    if (!dest || (dest.floor ?? 0) !== floor) continue;
    result.push({ dir: edge.dir, roomId: edge.to });
  }
  return result;
}
