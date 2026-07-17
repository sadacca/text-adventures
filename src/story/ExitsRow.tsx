import { useMemo } from 'react';
import { useEngineStore } from '../state/engineStore';
import { useMapStore } from '../state/mapStore';
import { useUiStore } from '../state/uiStore';
import { UNKNOWN_ROOM_ID, type Direction } from '../map/graph';
import { opposite } from '../map/directions';
import { useKnownExits, useSuggestedExits } from './useKnownExits';
import { haptic } from '../haptics';

const ORDER: Direction[] = ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw', 'up', 'down', 'in', 'out'];

/** UX-6: surfaces the compass's confirmed exits as a row of tappable chips below the
 *  status line, so the player doesn't have to open the FAB to see what's available.
 *  UX-18: also surfaces directions merely mentioned in the room's prose (dashed "?"
 *  chips) — soft suggestions, never map-affecting. UX-26: appends a "retrace" chip that
 *  sends the reverse of the player's last successful move — a one-tap way back out of
 *  trouble, distinct from Undo (which rewinds game state; retrace just walks back,
 *  in-fiction, taking a turn like any move). UX-31: a leading "Go to…" chip opens a
 *  travel sheet once the map knows at least 2 named rooms. */
export function ExitsRow() {
  const sendCommand = useEngineStore((s) => s.sendCommand);
  const inputType = useEngineStore((s) => s.inputType);
  const traveling = useEngineStore((s) => s.traveling);
  const graph = useMapStore((s) => s.graph);
  const lastMoveDir = useMapStore((s) => s.lastMoveDir);
  const setGoToSheetOpen = useUiStore((s) => s.setGoToSheetOpen);
  const knownExits = useKnownExits();
  const suggestedExits = useSuggestedExits();
  const backDir = lastMoveDir ? opposite(lastMoveDir) : null;
  const namedRoomCount = useMemo(
    () => Object.keys(graph.rooms).filter((id) => id !== UNKNOWN_ROOM_ID).length,
    [graph],
  );
  const showGoTo = namedRoomCount >= 2 && inputType === 'line' && !traveling;

  if (knownExits.size === 0 && suggestedExits.size === 0 && backDir === null && !showGoTo) {
    return null;
  }

  return (
    <div className="exits-row" role="toolbar" aria-label="Known exits">
      <span className="exits-row-label">Exits:</span>
      {showGoTo && (
        <button
          type="button"
          className="chip tap-target"
          onClick={() => {
            haptic();
            setGoToSheetOpen(true);
          }}
        >
          Go to…
        </button>
      )}
      {ORDER.filter((dir) => knownExits.has(dir) || suggestedExits.has(dir)).map((dir) =>
        knownExits.has(dir) ? (
          <button
            key={dir}
            type="button"
            className="chip tap-target"
            aria-label={`Go ${dir}`}
            disabled={inputType !== 'line'}
            onClick={() => {
              haptic();
              sendCommand(dir);
            }}
          >
            {dir.toUpperCase()}
          </button>
        ) : (
          <button
            key={dir}
            type="button"
            className="chip tap-target chip-suggested"
            aria-label={`Try ${dir} (mentioned in the text)`}
            disabled={inputType !== 'line'}
            onClick={() => {
              haptic();
              sendCommand(dir);
            }}
          >
            {dir.toUpperCase()}?
          </button>
        ),
      )}
      {backDir !== null && (
        <button
          type="button"
          className="chip tap-target"
          aria-label={`Retrace: go ${backDir}`}
          disabled={inputType !== 'line'}
          onClick={() => {
            haptic();
            sendCommand(backDir);
          }}
        >
          ⤺ {backDir.toUpperCase()}
        </button>
      )}
    </div>
  );
}
