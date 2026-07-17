import { useMemo } from 'react';
import { useMapStore } from '../state/mapStore';
import { useDialogStore } from '../state/dialogStore';
import { UNKNOWN_ROOM_ID } from '../map/graph';
import { computePath, type TravelStep } from '../map/travel';
import { confirmAndTravel } from '../map/travelConfirm';
import { haptic } from '../haptics';

/** UX-31: Story-tab travel sheet — the map's tap-to-travel BFS, surfaced as a list so a
 *  trip doesn't cost a tab switch + spatial re-orientation + room hunt + tab switch back.
 *  No visit-recency tracking exists in the graph, so rooms are sorted alphabetically
 *  (falls back exactly as the task's own note anticipates). */
export function GoToSheet({ onClose }: { onClose: () => void }) {
  const graph = useMapStore((s) => s.graph);

  const rows = useMemo(() => {
    const currentId = graph.currentRoomId;
    return Object.values(graph.rooms)
      .filter((r) => r.id !== UNKNOWN_ROOM_ID && r.id !== currentId)
      .map((room) => ({
        room,
        path: currentId ? computePath(graph, currentId, room.id) : null,
      }))
      .sort((a, b) => a.room.name.localeCompare(b.room.name));
  }, [graph]);

  async function handleTap(path: TravelStep[]) {
    haptic();
    onClose();
    const message = await confirmAndTravel(path);
    if (message) await useDialogStore.getState().ask({ kind: 'alert', title: message });
  }

  return (
    <div className="room-edit-backdrop" onClick={onClose}>
      <div className="room-edit-sheet" onClick={(e) => e.stopPropagation()}>
        <h2>Go to…</h2>
        <ul className="go-to-list">
          {rows.map(({ room, path }) => (
            <li key={room.id}>
              <button
                type="button"
                className="tap-target go-to-row"
                disabled={path === null}
                onClick={() => path && void handleTap(path)}
              >
                <span>
                  {room.name}
                  {room.floor !== undefined && room.floor !== 0 && ` · Floor ${room.floor}`}
                </span>
                {path === null && <span className="go-to-hint">no known path</span>}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
