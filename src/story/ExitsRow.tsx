import { useEngineStore } from '../state/engineStore';
import type { Direction } from '../map/graph';
import { useKnownExits, useSuggestedExits } from './useKnownExits';
import { haptic } from '../haptics';

const ORDER: Direction[] = ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw', 'up', 'down', 'in', 'out'];

/** UX-6: surfaces the compass's confirmed exits as a row of tappable chips below the
 *  status line, so the player doesn't have to open the FAB to see what's available.
 *  UX-18: also surfaces directions merely mentioned in the room's prose (dashed "?"
 *  chips) — soft suggestions, never map-affecting. */
export function ExitsRow() {
  const sendCommand = useEngineStore((s) => s.sendCommand);
  const inputType = useEngineStore((s) => s.inputType);
  const knownExits = useKnownExits();
  const suggestedExits = useSuggestedExits();

  if (knownExits.size === 0 && suggestedExits.size === 0) return null;

  return (
    <div className="exits-row" role="toolbar" aria-label="Known exits">
      <span className="exits-row-label">Exits:</span>
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
    </div>
  );
}
