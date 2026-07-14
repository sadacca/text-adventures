import { useEngineStore } from '../state/engineStore';
import type { Direction } from '../map/graph';
import { useKnownExits } from './useKnownExits';

const ORDER: Direction[] = ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw', 'up', 'down', 'in', 'out'];

/** UX-6: surfaces the compass's confirmed exits as a row of tappable chips below the
 *  status line, so the player doesn't have to open the FAB to see what's available. */
export function ExitsRow() {
  const sendCommand = useEngineStore((s) => s.sendCommand);
  const inputType = useEngineStore((s) => s.inputType);
  const knownExits = useKnownExits();

  if (knownExits.size === 0) return null;

  return (
    <div className="exits-row" role="toolbar" aria-label="Known exits">
      <span className="exits-row-label">Exits:</span>
      {ORDER.filter((dir) => knownExits.has(dir)).map((dir) => (
        <button
          key={dir}
          type="button"
          className="chip tap-target"
          aria-label={`Go ${dir}`}
          disabled={inputType !== 'line'}
          onClick={() => sendCommand(dir)}
        >
          {dir.toUpperCase()}
        </button>
      ))}
    </div>
  );
}
