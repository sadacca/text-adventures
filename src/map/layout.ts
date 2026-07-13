import { gridOffset } from './directions.js';
import type { Direction, MapGraph, RoomNode } from './graph.js';

/**
 * Assigns grid positions to every non-`posLocked` room, BFS-ing outward from the
 * current room along edges and offsetting each hop by its direction's grid vector
 * (SPECS.md §2). Collisions (two rooms wanting the same cell) are resolved by shifting
 * to the nearest free cell — simple and deterministic, no force-directed layout
 * (IMPLEMENTATION_PLAN.md Task 1.8). `posLocked` rooms (set once a user drags a room —
 * Task 1.8 polish, not implemented yet) are never moved, only treated as fixed anchors.
 */
export function computeLayout(graph: MapGraph): void {
  const rooms = Object.values(graph.rooms);
  if (rooms.length === 0) return;

  const occupied = new Map<string, string>();
  for (const room of rooms) {
    if (room.posLocked) occupied.set(cellKey(room.pos), room.id);
  }

  const start =
    (graph.currentRoomId !== null ? graph.rooms[graph.currentRoomId] : undefined) ?? rooms[0];
  const visited = new Set<string>([start.id]);
  const queue: RoomNode[] = [start];
  if (!start.posLocked) place(start, start.pos ?? { x: 0, y: 0 }, occupied);

  while (queue.length > 0) {
    const room = queue.shift()!;
    for (const { dir, roomId } of neighborsOf(graph, room.id)) {
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
  for (const room of rooms) {
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

function neighborsOf(
  graph: MapGraph,
  roomId: string,
): { dir: Direction | string; roomId: string }[] {
  const result: { dir: Direction | string; roomId: string }[] = [];
  for (const edge of graph.edges) {
    if (edge.userDeleted || edge.from !== roomId) continue;
    result.push({ dir: edge.dir, roomId: edge.to });
  }
  return result;
}
