import { useState } from 'react';
import { useEngineStore } from '../state/engineStore';
import type { Direction } from '../map/graph';
import { useKnownExits, useSuggestedExits } from './useKnownExits';
import { haptic } from '../haptics';

/** Grid layout of the expanded compass; `null` cells are just spacers. */
const LAYOUT: (Direction | null)[][] = [
  ['nw', 'n', 'ne'],
  ['w', null, 'e'],
  ['sw', 's', 'se'],
];
const VERTICAL: Direction[] = ['up', 'down', 'in', 'out'];

const SYMBOLS: Record<Direction, string> = {
  n: '↑',
  s: '↓',
  e: '→',
  w: '←',
  ne: '↗',
  nw: '↖',
  se: '↘',
  sw: '↙',
  up: 'U',
  down: 'D',
  in: 'IN',
  out: 'OUT',
};

/**
 * Task 1.7: persistent compact control (a 48px fab), expandable to the full N/S/E/W/
 * NE/NW/SE/SW/U/D/IN/OUT set. One tap sends the move. Directions the map already knows
 * to be exits from the current room are visually emphasized (subscribes to MapGraph).
 */
export function CompassRose() {
  const [expanded, setExpanded] = useState(false);
  const sendCommand = useEngineStore((s) => s.sendCommand);
  const inputType = useEngineStore((s) => s.inputType);
  const knownExits = useKnownExits();
  const suggestedExits = useSuggestedExits();

  function go(dir: Direction) {
    haptic();
    sendCommand(dir);
  }

  if (!expanded) {
    return (
      <button
        type="button"
        className="compass-fab tap-target"
        aria-label="Expand compass"
        onClick={() => setExpanded(true)}
      >
        🧭
      </button>
    );
  }

  return (
    <div className="compass-rose" role="group" aria-label="Compass">
      <button
        type="button"
        className="compass-collapse tap-target"
        aria-label="Collapse compass"
        onClick={() => setExpanded(false)}
      >
        ✕
      </button>
      <div className="compass-grid">
        {LAYOUT.flat().map((dir, i) =>
          dir === null ? (
            <span key={`spacer-${i}`} />
          ) : (
            <button
              key={dir}
              type="button"
              aria-label={`Go ${dir}`}
              className={`compass-button tap-target${knownExits.has(dir) ? ' compass-known' : suggestedExits.has(dir) ? ' compass-suggested' : ''}`}
              disabled={inputType !== 'line'}
              onClick={() => go(dir)}
            >
              {SYMBOLS[dir]}
            </button>
          ),
        )}
      </div>
      <div className="compass-vertical">
        {VERTICAL.map((dir) => (
          <button
            key={dir}
            type="button"
            aria-label={`Go ${dir}`}
            className={`compass-button tap-target${knownExits.has(dir) ? ' compass-known' : ''}`}
            disabled={inputType !== 'line'}
            onClick={() => go(dir)}
          >
            {SYMBOLS[dir]}
          </button>
        ))}
      </div>
    </div>
  );
}
