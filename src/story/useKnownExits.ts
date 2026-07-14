import { useMemo } from 'react';
import { useMapStore } from '../state/mapStore';
import type { Direction } from '../map/graph';
import { isCompassDirection } from '../map/directions';

/** Shared by CompassRose and ExitsRow (UX-6): confirmed compass exits from the current room. */
export function useKnownExits(): Set<Direction> {
  const graph = useMapStore((s) => s.graph);
  return useMemo(() => {
    const exits = new Set<Direction>();
    if (!graph.currentRoomId) return exits;
    for (const edge of graph.edges) {
      if (
        edge.from === graph.currentRoomId &&
        !edge.userDeleted &&
        edge.status === 'confirmed' &&
        isCompassDirection(edge.dir)
      ) {
        exits.add(edge.dir);
      }
    }
    return exits;
  }, [graph]);
}

/** UX-18: directions mentioned in the current room's prose that have no live edge yet
 *  (any status) — soft suggestions, never map-affecting. */
export function useSuggestedExits(): Set<Direction> {
  const graph = useMapStore((s) => s.graph);
  return useMemo(() => {
    const out = new Set<Direction>();
    const id = graph.currentRoomId;
    const room = id ? graph.rooms[id] : undefined;
    if (!id || !room?.mentionedDirections) return out;
    const edged = new Set(
      graph.edges.filter((e) => e.from === id && !e.userDeleted).map((e) => e.dir),
    );
    for (const dir of room.mentionedDirections) {
      if (!edged.has(dir)) out.add(dir);
    }
    return out;
  }, [graph]);
}
