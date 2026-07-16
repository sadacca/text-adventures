import { gridOffset } from './directions.js';
import type { Direction, MapGraph, RoomNode } from './graph.js';

/**
 * Assigns grid positions to every non-`posLocked` room, BFS-ing outward from the
 * current room along edges and offsetting each hop by its direction's grid vector
 * (SPECS.md §2). Collisions (two rooms wanting the same cell) are resolved by shifting
 * to the nearest free cell — simple and deterministic, no force-directed layout
 * (IMPLEMENTATION_PLAN.md Task 1.8). `posLocked` rooms (set once a user drags a room —
 * Task 1.8 polish, not implemented yet) are never moved, only treated as fixed anchors.
 *
 * Batch 4 / UX-21: rooms are grouped by `floor` (`?? 0`) first, and each floor is laid
 * out independently by `layoutFloor` (same BFS below, scoped to just that floor's rooms
 * and edges). Different floors freely reuse the same x/y coordinates — harmless, since
 * `MapScreen` only ever renders one floor's rooms at a time.
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

  const currentRoom = graph.currentRoomId !== null ? graph.rooms[graph.currentRoomId] : undefined;

  for (const [floor, floorRooms] of byFloor) {
    const start =
      (currentRoom && (currentRoom.floor ?? 0) === floor ? currentRoom : undefined) ??
      floorRooms.find((r) => r.posLocked) ??
      floorRooms[0];
    layoutFloor(graph, floorRooms, start);
  }
}

/** The single-floor BFS + collision-resolution pass, scoped to `floorRooms`/`start`
 *  (all on the same floor) — verbatim the algorithm `computeLayout` used to run once
 *  over the whole graph, before Batch 4 / UX-21 split it per floor. */
function layoutFloor(graph: MapGraph, floorRooms: RoomNode[], start: RoomNode): void {
  const occupied = new Map<string, string>();
  for (const room of floorRooms) {
    if (room.posLocked) occupied.set(cellKey(room.pos), room.id);
  }

  const visited = new Set<string>([start.id]);
  const queue: RoomNode[] = [start];
  if (!start.posLocked) place(start, start.pos ?? { x: 0, y: 0 }, occupied);

  while (queue.length > 0) {
    const room = queue.shift()!;
    for (const { dir, roomId } of neighborsOf(graph, room.id, room.floor ?? 0)) {
      const neighbor = graph.rooms[roomId];
      if (!neighbor || visited.has(neighbor.id)) continue;
      visited.add(neighbor.id);
      if (!neighbor.posLocked) {
        const offset = gridOffset(dir) ?? { dx: 1.5, dy: 0 }; // in/out: nudge sideways
        const desired = { x: room.pos.x + offset.dx, y: room.pos.y + offset.dy };
        place(neighbor, findFreeCell(desired, occupied), occupied);
      } else if (!occupied.has(cellKey(neighbor.pos))) {
        occupied.set(cellKey(neighbor.pos), neighbor.id);
      }
      queue.push(neighbor);
    }
  }

  // Rooms the BFS never reached (teleport targets, the unknown singleton, disconnected
  // Maze duplicates) still need to be visible: line them up off to the side.
  let floatIndex = 0;
  for (const room of floorRooms) {
    if (visited.has(room.id) || room.posLocked) continue;
    place(room, findFreeCell({ x: -3, y: floatIndex * 1.5 }, occupied), occupied);
    floatIndex++;
  }
}

function place(room: RoomNode, pos: { x: number; y: number }, occupied: Map<string, string>) {
  room.pos = pos;
  occupied.set(cellKey(pos), room.id);
}

function cellKey(pos: { x: number; y: number }): string {
  return `${Math.round(pos.x * 10)},${Math.round(pos.y * 10)}`;
}

function findFreeCell(
  desired: { x: number; y: number },
  occupied: Map<string, string>,
): { x: number; y: number } {
  if (!occupied.has(cellKey(desired))) return desired;
  const cx = Math.round(desired.x);
  const cy = Math.round(desired.y);
  for (let radius = 1; radius <= 8; radius++) {
    for (let dx = -radius; dx <= radius; dx++) {
      for (let dy = -radius; dy <= radius; dy++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== radius) continue;
        const candidate = { x: cx + dx, y: cy + dy };
        if (!occupied.has(cellKey(candidate))) return candidate;
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
