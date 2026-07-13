import { useEffect, useMemo, useRef, useState } from 'react';
import { useEngineStore } from '../state/engineStore';
import { useMapStore } from '../state/mapStore';
import { computePath, isLongTrip } from './travel';
import type { MapGraph, RoomEdge, RoomNode } from './graph';
import { isCompassDirection, isStubDirection } from './directions';
import { RoomEditSheet } from './RoomEditSheet';

const UNIT = 110; // px per grid cell
const ROOM_W = 92;
const ROOM_H = 48;
const PADDING = 60;
const LONG_PRESS_MS = 500;
const DRAG_THRESHOLD_PX = 10; // client px before a press becomes a drag, not a tap
const MIN_SCALE = 0.4;
const MAX_SCALE = 3;

interface Segment {
  key: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  dashed: boolean;
  // True only for a rule-4 custom edge (e.g. "climb ladder") — no compass glyph
  // applies, so the map draws it distinctly (dotted, accent-colored).
  custom: boolean;
  // Shown for custom edges (the command text) and for up/down/in/out (real compass
  // edges, but rendered as short stubs whose direction isn't obvious from geometry
  // alone — see isStubDirection).
  label?: string;
}

interface ViewBox {
  minX: number;
  minY: number;
  width: number;
  height: number;
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
    const custom = !isCompassDirection(edge.dir);
    return {
      key,
      x1: a.pos.x * UNIT,
      y1: a.pos.y * UNIT,
      x2: b.pos.x * UNIT,
      y2: b.pos.y * UNIT,
      dashed: edge.status === 'inferred',
      custom,
      label: custom || isStubDirection(edge.dir) ? edge.dir : undefined,
    };
  });
}

function fitViewBox(rooms: RoomNode[]): ViewBox {
  const xs = rooms.map((r) => r.pos.x * UNIT);
  const ys = rooms.map((r) => r.pos.y * UNIT);
  const minX = Math.min(...xs) - ROOM_W / 2 - PADDING;
  const minY = Math.min(...ys) - ROOM_H / 2 - PADDING;
  const maxX = Math.max(...xs) + ROOM_W / 2 + PADDING;
  const maxY = Math.max(...ys) + ROOM_H / 2 + PADDING;
  return { minX, minY, width: maxX - minX, height: maxY - minY };
}

function dist(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function midpoint(a: { x: number; y: number }, b: { x: number; y: number }) {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

/**
 * Task 1.8: SVG map with touch-first pan/pinch (Pointer Events, no hover-dependent UI),
 * tap-to-travel, long-press editing, and drag-to-move. Pan/zoom is a `<g transform>`
 * layered on top of a "home" viewBox that auto-fits explored rooms once per game and is
 * otherwise frozen (recomputing it on every new room would fight the player's own pan) —
 * the fit button snaps back to it on demand.
 */
export function MapScreen() {
  const gameId = useEngineStore((s) => s.gameId);
  const inputType = useEngineStore((s) => s.inputType);
  const traveling = useEngineStore((s) => s.traveling);
  const travelTo = useEngineStore((s) => s.travelTo);
  const graph = useMapStore((s) => s.graph);
  const moveRoom = useMapStore((s) => s.moveRoom);

  const rooms = useMemo(() => Object.values(graph.rooms), [graph]);
  const segments = useMemo(() => buildSegments(graph), [graph]);
  const roomsById = useMemo(() => new Map(rooms.map((r) => [r.id, r])), [rooms]);

  const [viewBox, setViewBox] = useState<ViewBox | null>(null);
  const [transform, setTransform] = useState({ x: 0, y: 0, scale: 1 });
  const [editingRoomId, setEditingRoomId] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [dragPreview, setDragPreview] = useState<{ id: string; x: number; y: number } | null>(null);

  const lastFitGameId = useRef<string | null>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinchStartDist = useRef<number | null>(null);

  // Transient per-gesture state for whichever room is currently being pressed/dragged.
  // Deliberately a ref, not local closure variables recreated each render: a drag's own
  // `setDragPreview` call triggers a re-render mid-gesture, which would otherwise hand
  // the next pointer event a brand-new closure with `dragging` reset to false.
  const roomGestureRef = useRef<{
    roomId: string;
    startClient: { x: number; y: number };
    dragging: boolean;
    longPressed: boolean;
    timer: ReturnType<typeof setTimeout> | null;
  } | null>(null);

  // Re-fit once per game (fresh load), not on every graph mutation — see doc comment.
  useEffect(() => {
    if (rooms.length === 0 || lastFitGameId.current === gameId) return;
    lastFitGameId.current = gameId;
    setViewBox(fitViewBox(rooms));
    setTransform({ x: 0, y: 0, scale: 1 });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentionally once per gameId
  }, [gameId, rooms.length]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3500);
    return () => clearTimeout(t);
  }, [toast]);

  function fitToContent() {
    setViewBox(fitViewBox(rooms));
    setTransform({ x: 0, y: 0, scale: 1 });
  }

  // --- Canvas pan / pinch-zoom (Pointer Events) ---

  function onCanvasPointerDown(e: React.PointerEvent<SVGSVGElement>) {
    (e.currentTarget as unknown as Element).setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      pinchStartDist.current = dist(a, b);
    }
  }

  function onCanvasPointerMove(e: React.PointerEvent<SVGSVGElement>) {
    const prev = pointers.current.get(e.pointerId);
    if (!prev) return;
    const next = { x: e.clientX, y: e.clientY };

    if (pointers.current.size === 2) {
      pointers.current.set(e.pointerId, next);
      const [a, b] = [...pointers.current.values()];
      const newDist = dist(a, b);
      const mid = midpoint(a, b);
      const prevMid = midpoint(prev, next); // approx: good enough without per-finger history
      if (pinchStartDist.current) {
        const factor = newDist / pinchStartDist.current;
        pinchStartDist.current = newDist;
        setTransform((t) => ({
          x: t.x + (mid.x - prevMid.x),
          y: t.y + (mid.y - prevMid.y),
          scale: Math.min(MAX_SCALE, Math.max(MIN_SCALE, t.scale * factor)),
        }));
      }
      return;
    }

    if (pointers.current.size === 1) {
      pointers.current.set(e.pointerId, next);
      setTransform((t) => ({ ...t, x: t.x + (next.x - prev.x), y: t.y + (next.y - prev.y) }));
    }
  }

  function onCanvasPointerUp(e: React.PointerEvent<SVGSVGElement>) {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) pinchStartDist.current = null;
  }

  // --- Per-room tap / long-press / drag ---
  // Handlers read/write `roomGestureRef` (see its declaration above for why) rather than
  // closing over local state, so they stay correct across the re-renders a drag itself
  // triggers via `setDragPreview`.

  function onRoomPointerDown(room: RoomNode, e: React.PointerEvent<SVGGElement>) {
    e.stopPropagation();
    (e.currentTarget as unknown as Element).setPointerCapture(e.pointerId);
    roomGestureRef.current = {
      roomId: room.id,
      startClient: { x: e.clientX, y: e.clientY },
      dragging: false,
      longPressed: false,
      timer: setTimeout(() => {
        const g = roomGestureRef.current;
        if (!g || g.roomId !== room.id) return;
        g.longPressed = true;
        setEditingRoomId(room.id);
      }, LONG_PRESS_MS),
    };
  }

  function onRoomPointerMove(room: RoomNode, e: React.PointerEvent<SVGGElement>) {
    e.stopPropagation();
    const g = roomGestureRef.current;
    if (!g || g.roomId !== room.id || g.longPressed) return;
    const d = dist(g.startClient, { x: e.clientX, y: e.clientY });
    if (!g.dragging && d > DRAG_THRESHOLD_PX) {
      g.dragging = true;
      if (g.timer) clearTimeout(g.timer);
      g.timer = null;
    }
    if (g.dragging) {
      const dx = (e.clientX - g.startClient.x) / (UNIT * transform.scale);
      const dy = (e.clientY - g.startClient.y) / (UNIT * transform.scale);
      setDragPreview({ id: room.id, x: room.pos.x + dx, y: room.pos.y + dy });
    }
  }

  function onRoomPointerUp(room: RoomNode, e: React.PointerEvent<SVGGElement>) {
    e.stopPropagation();
    const g = roomGestureRef.current;
    if (!g || g.roomId !== room.id) return;
    if (g.timer) clearTimeout(g.timer);
    roomGestureRef.current = null;
    if (g.dragging) {
      const dx = (e.clientX - g.startClient.x) / (UNIT * transform.scale);
      const dy = (e.clientY - g.startClient.y) / (UNIT * transform.scale);
      moveRoom(room.id, { x: room.pos.x + dx, y: room.pos.y + dy });
      setDragPreview(null);
      return;
    }
    if (!g.longPressed) void handleRoomTap(room.id);
  }

  function onRoomPointerCancel(room: RoomNode, e: React.PointerEvent<SVGGElement>) {
    e.stopPropagation();
    const g = roomGestureRef.current;
    if (!g || g.roomId !== room.id) return;
    if (g.timer) clearTimeout(g.timer);
    roomGestureRef.current = null;
    setDragPreview(null);
  }

  async function handleRoomTap(roomId: string) {
    if (traveling || inputType !== 'line') return;
    if (!graph.currentRoomId || roomId === graph.currentRoomId) return;
    const path = computePath(graph, graph.currentRoomId, roomId);
    if (!path) {
      setToast('No known path to that room yet.');
      return;
    }
    if (path.length === 0) return;
    if (isLongTrip(path)) {
      const proceed = window.confirm(
        `This trip is ${path.length} turns — lamp/hunger timers burn down. Continue?`,
      );
      if (!proceed) return;
    }
    const result = await travelTo(path);
    if (result === 'blocked') setToast('Travel stopped — something unexpected happened.');
    else if (result === 'question') setToast('Travel stopped — the game is asking a question.');
    else if (result === 'char_input') setToast('Travel stopped — the game wants a keypress.');
  }

  if (!gameId) {
    return (
      <div className="screen">
        <h1>Map</h1>
        <div className="empty-state">
          <span className="empty-state-icon" aria-hidden="true">
            🗺️
          </span>
          <p>No game loaded. Pick one from the Library tab.</p>
        </div>
      </div>
    );
  }

  if (rooms.length === 0 || !viewBox) {
    return (
      <div className="screen">
        <h1>Map</h1>
        <div className="empty-state">
          <span className="empty-state-icon" aria-hidden="true">
            🧭
          </span>
          <p>The map fills in automatically as you explore.</p>
        </div>
      </div>
    );
  }

  const editingRoom = editingRoomId ? roomsById.get(editingRoomId) : undefined;

  return (
    <div className="screen map-screen">
      <div className="map-header">
        <h1>Map</h1>
        <button type="button" className="tap-target" onClick={fitToContent}>
          ⤢ Fit
        </button>
      </div>
      {toast && <div className="map-toast">{toast}</div>}
      <svg
        className="map-svg"
        viewBox={`${viewBox.minX} ${viewBox.minY} ${viewBox.width} ${viewBox.height}`}
        role="img"
        aria-label="Map of rooms explored so far"
        onPointerDown={onCanvasPointerDown}
        onPointerMove={onCanvasPointerMove}
        onPointerUp={onCanvasPointerUp}
        onPointerCancel={onCanvasPointerUp}
        style={{ touchAction: 'none' }}
      >
        <g transform={`translate(${transform.x}, ${transform.y}) scale(${transform.scale})`}>
          {segments.map((seg) => (
            <g key={seg.key}>
              <line
                className={seg.custom ? 'map-edge map-edge-custom' : 'map-edge'}
                x1={seg.x1}
                y1={seg.y1}
                x2={seg.x2}
                y2={seg.y2}
                strokeDasharray={seg.custom ? '2 4' : seg.dashed ? '6 5' : undefined}
              />
              {seg.label && (
                <text
                  className="map-edge-label"
                  x={(seg.x1 + seg.x2) / 2}
                  y={(seg.y1 + seg.y2) / 2}
                  textAnchor="middle"
                  dominantBaseline="middle"
                >
                  {seg.label}
                </text>
              )}
            </g>
          ))}
          {rooms.map((room) => {
            const pos =
              dragPreview?.id === room.id ? dragPreview : { x: room.pos.x, y: room.pos.y };
            return (
              <g
                key={room.id}
                transform={`translate(${pos.x * UNIT}, ${pos.y * UNIT})`}
                className={
                  room.id === graph.currentRoomId ? 'map-room map-room-current' : 'map-room'
                }
                style={{ touchAction: 'none' }}
                onPointerDown={(e) => onRoomPointerDown(room, e)}
                onPointerMove={(e) => onRoomPointerMove(room, e)}
                onPointerUp={(e) => onRoomPointerUp(room, e)}
                onPointerCancel={(e) => onRoomPointerCancel(room, e)}
              >
                <rect x={-ROOM_W / 2} y={-ROOM_H / 2} width={ROOM_W} height={ROOM_H} rx={8} />
                <text x={0} y={0} textAnchor="middle" dominantBaseline="middle">
                  {room.name}
                </text>
              </g>
            );
          })}
        </g>
      </svg>
      {editingRoom && (
        <RoomEditSheet room={editingRoom} allRooms={rooms} onClose={() => setEditingRoomId(null)} />
      )}
    </div>
  );
}
