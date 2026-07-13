import { useMemo } from 'react';
import { useEngineStore } from '../state/engineStore';
import { useMapStore } from '../state/mapStore';
import type { MapGraph, RoomEdge } from './graph';

const UNIT = 110; // px per grid cell
const ROOM_W = 92;
const ROOM_H = 48;
const PADDING = 60;

interface Segment {
  key: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  dashed: boolean;
}

/** One line per room pair: solid if either direction is confirmed, dashed otherwise. */
function buildSegments(graph: MapGraph): Segment[] {
  const byPair = new Map<string, RoomEdge>();
  for (const edge of graph.edges) {
    if (edge.userDeleted) continue;
    const a = graph.rooms[edge.from];
    const b = graph.rooms[edge.to];
    if (!a || !b) continue;
    const key = [edge.from, edge.to].sort().join('|');
    const existing = byPair.get(key);
    if (!existing || (existing.status === 'inferred' && edge.status === 'confirmed')) {
      byPair.set(key, edge);
    }
  }
  return [...byPair.entries()].map(([key, edge]) => {
    const a = graph.rooms[edge.from];
    const b = graph.rooms[edge.to];
    return {
      key,
      x1: a.pos.x * UNIT,
      y1: a.pos.y * UNIT,
      x2: b.pos.x * UNIT,
      y2: b.pos.y * UNIT,
      dashed: edge.status === 'inferred',
    };
  });
}

export function MapScreen() {
  const gameId = useEngineStore((s) => s.gameId);
  const graph = useMapStore((s) => s.graph);

  const rooms = useMemo(() => Object.values(graph.rooms), [graph]);
  const segments = useMemo(() => buildSegments(graph), [graph]);

  if (!gameId) {
    return (
      <div className="screen">
        <h1>Map</h1>
        <p>No game loaded. Pick one from the Library tab.</p>
      </div>
    );
  }

  if (rooms.length === 0) {
    return (
      <div className="screen">
        <h1>Map</h1>
        <p>The map fills in automatically as you explore.</p>
      </div>
    );
  }

  const xs = rooms.map((r) => r.pos.x * UNIT);
  const ys = rooms.map((r) => r.pos.y * UNIT);
  const minX = Math.min(...xs) - ROOM_W / 2 - PADDING;
  const minY = Math.min(...ys) - ROOM_H / 2 - PADDING;
  const maxX = Math.max(...xs) + ROOM_W / 2 + PADDING;
  const maxY = Math.max(...ys) + ROOM_H / 2 + PADDING;

  return (
    <div className="screen map-screen">
      <h1>Map</h1>
      <svg
        className="map-svg"
        viewBox={`${minX} ${minY} ${maxX - minX} ${maxY - minY}`}
        role="img"
        aria-label="Map of rooms explored so far"
      >
        {segments.map((seg) => (
          <line
            key={seg.key}
            className="map-edge"
            x1={seg.x1}
            y1={seg.y1}
            x2={seg.x2}
            y2={seg.y2}
            strokeDasharray={seg.dashed ? '6 5' : undefined}
          />
        ))}
        {rooms.map((room) => (
          <g
            key={room.id}
            transform={`translate(${room.pos.x * UNIT}, ${room.pos.y * UNIT})`}
            className={room.id === graph.currentRoomId ? 'map-room map-room-current' : 'map-room'}
          >
            <rect x={-ROOM_W / 2} y={-ROOM_H / 2} width={ROOM_W} height={ROOM_H} rx={8} />
            <text x={0} y={0} textAnchor="middle" dominantBaseline="middle">
              {room.name}
            </text>
          </g>
        ))}
      </svg>
    </div>
  );
}
