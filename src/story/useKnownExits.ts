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
