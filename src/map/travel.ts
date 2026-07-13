import type { Direction, MapGraph } from './graph.js';

export interface TravelStep {
  dir: Direction;
  roomId: string; // room reached after taking this step
}

/**
 * BFS over confirmed, non-tombstoned edges only (SPECS.md §3, Task 1.8 tap-to-travel).
 * Returns the move sequence from `fromId` to `toId`, `[]` if already there, or null if
 * no such path exists.
 */
export function computePath(graph: MapGraph, fromId: string, toId: string): TravelStep[] | null {
  if (fromId === toId) return [];
  if (!graph.rooms[fromId] || !graph.rooms[toId]) return null;

  const cameFrom = new Map<string, { via: Direction; from: string }>();
  const visited = new Set<string>([fromId]);
  const queue: string[] = [fromId];

  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const edge of graph.edges) {
      if (edge.from !== current || edge.status !== 'confirmed' || edge.userDeleted) continue;
      if (visited.has(edge.to)) continue;
      visited.add(edge.to);
      cameFrom.set(edge.to, { via: edge.dir, from: current });
      if (edge.to === toId) return reconstructPath(cameFrom, toId);
      queue.push(edge.to);
    }
  }
  return null;
}

function reconstructPath(
  cameFrom: Map<string, { via: Direction; from: string }>,
  toId: string,
): TravelStep[] {
  const steps: TravelStep[] = [];
  let cursor = toId;
  while (cameFrom.has(cursor)) {
    const { via, from } = cameFrom.get(cursor)!;
    steps.unshift({ dir: via, roomId: cursor });
    cursor = from;
  }
  return steps;
}

/** SPECS.md §3: abort a trip if buffer text contains a line ending in '?' (a prompt/question). */
export function bufferTextEndsInQuestion(text: string): boolean {
  return text.split('\n').some((line) => line.trim().endsWith('?'));
}

/** SPECS.md §3: warn before trips over 8 moves (turns are a burnable resource). */
export const LONG_TRIP_THRESHOLD = 8;

export function isLongTrip(path: TravelStep[]): boolean {
  return path.length > LONG_TRIP_THRESHOLD;
}
