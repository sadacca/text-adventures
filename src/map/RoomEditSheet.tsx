import { useState } from 'react';
import { useMapStore } from '../state/mapStore';
import type { RoomNode } from './graph';

/**
 * Task 1.8: the long-press bottom sheet — rename / note / merge / delete. All of these
 * call straight through to mapStore's sticky graph-editing actions (graph.ts's
 * renameRoom/setRoomNote/mergeRooms/deleteRoom), so edits survive reload and the
 * automapper never undoes them (rule 7).
 */
export function RoomEditSheet({
  room,
  allRooms,
  onClose,
}: {
  room: RoomNode;
  allRooms: RoomNode[];
  onClose: () => void;
}) {
  const renameRoom = useMapStore((s) => s.renameRoom);
  const setRoomNote = useMapStore((s) => s.setRoomNote);
  const deleteRoomAction = useMapStore((s) => s.deleteRoom);
  const mergeRoomsAction = useMapStore((s) => s.mergeRooms);
  const [name, setName] = useState(room.name);
  const [note, setNote] = useState(room.note ?? '');
  const [mergeTarget, setMergeTarget] = useState('');

  const mergeCandidates = allRooms.filter((r) => r.id !== room.id);

  return (
    <div className="room-edit-backdrop" onClick={onClose}>
      <div className="room-edit-sheet" onClick={(e) => e.stopPropagation()}>
        <h2>Edit room</h2>

        <label className="room-edit-field">
          Name
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onBlur={() => {
              if (name.trim() && name.trim() !== room.name) renameRoom(room.id, name);
            }}
          />
        </label>

        <label className="room-edit-field">
          Note
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            onBlur={() => setRoomNote(room.id, note)}
            rows={2}
          />
        </label>

        {mergeCandidates.length > 0 && (
          <label className="room-edit-field">
            Merge into
            <div className="room-edit-merge-row">
              <select value={mergeTarget} onChange={(e) => setMergeTarget(e.target.value)}>
                <option value="">Choose a room…</option>
                {mergeCandidates.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </select>
              <button
                type="button"
                className="tap-target"
                disabled={!mergeTarget}
                onClick={() => {
                  if (!mergeTarget) return;
                  mergeRoomsAction(mergeTarget, room.id);
                  onClose();
                }}
              >
                Merge
              </button>
            </div>
          </label>
        )}

        <div className="room-edit-actions">
          <button
            type="button"
            className="tap-target danger"
            onClick={() => {
              if (window.confirm(`Delete "${room.name}" from the map?`)) {
                deleteRoomAction(room.id);
                onClose();
              }
            }}
          >
            Delete room
          </button>
          <button type="button" className="tap-target" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
