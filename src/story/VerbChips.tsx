import { useEngineStore } from '../state/engineStore';
import { useUiStore } from '../state/uiStore';
import { haptic } from '../haptics';
import { VERBS } from './verbs';

/** UX-32: total chip count cap (built-in + learned) so the row stays one scrollable line. */
const MAX_CHIPS = 11;

/** Task 1.7: one scrollable row of common commands. UX-32: learned verbs (this game's
 *  own vocabulary, picked up from the player's successful usage) are appended after the
 *  built-ins, visually distinct (`.chip-learned`) but with the same needsObject: true
 *  tap behavior — insert into the draft, don't send. */
export function VerbChips() {
  const sendCommand = useEngineStore((s) => s.sendCommand);
  const inputType = useEngineStore((s) => s.inputType);
  const learnedVerbs = useEngineStore((s) => s.learnedVerbs);
  const appendToDraft = useUiStore((s) => s.appendToDraft);

  const learnedSlots = Math.max(0, MAX_CHIPS - VERBS.length);

  return (
    <div className="verb-chips" role="toolbar" aria-label="Common commands">
      {VERBS.map((verb) => (
        <button
          key={verb.command}
          type="button"
          className="chip tap-target"
          disabled={inputType !== 'line'}
          onClick={() => {
            haptic();
            if (verb.needsObject) {
              appendToDraft(verb.command);
            } else {
              sendCommand(verb.command);
            }
          }}
        >
          {verb.label}
        </button>
      ))}
      {learnedVerbs.slice(0, learnedSlots).map((verb) => (
        <button
          key={verb}
          type="button"
          className="chip chip-learned tap-target"
          disabled={inputType !== 'line'}
          onClick={() => {
            haptic();
            appendToDraft(verb);
          }}
        >
          {verb}
        </button>
      ))}
    </div>
  );
}
