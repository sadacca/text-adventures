import { useEngineStore } from '../state/engineStore';
import { useUiStore } from '../state/uiStore';
import { VERBS } from './verbs';

/** Task 1.7: one scrollable row of common commands. */
export function VerbChips() {
  const sendCommand = useEngineStore((s) => s.sendCommand);
  const inputType = useEngineStore((s) => s.inputType);
  const appendToDraft = useUiStore((s) => s.appendToDraft);
  const requestInputFocus = useUiStore((s) => s.requestInputFocus);

  return (
    <div className="verb-chips" role="toolbar" aria-label="Common commands">
      {VERBS.map((verb) => (
        <button
          key={verb.command}
          type="button"
          className="chip tap-target"
          disabled={inputType !== 'line'}
          onClick={() => {
            if (verb.needsObject) {
              appendToDraft(verb.command);
              requestInputFocus();
            } else {
              sendCommand(verb.command);
            }
          }}
        >
          {verb.label}
        </button>
      ))}
    </div>
  );
}
