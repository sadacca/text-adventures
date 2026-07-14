import { useRef, useState } from 'react';
import { useEngineStore } from '../state/engineStore';
import { useUiStore } from '../state/uiStore';
import { useKeyboardInset } from './useKeyboardInset';

const SWIPE_UP_THRESHOLD = 40; // px

/**
 * Task 1.7: the soft-keyboard-correct text field, plus history access. Input attributes
 * turn off autocapitalize/autocorrect/spellcheck (mangled commands and "xyzzy" surviving
 * uncorrected is an explicit acceptance check) and set `enterkeyhint="send"`. The input
 * is never `disabled` — only the send button is — so focus (and the keyboard) never
 * drops across a submit, per the "keep focus after submitting" requirement; the
 * `visualViewport`-derived inset keeps the bar pinned above the keyboard instead of
 * hidden beneath it.
 */
export function CommandBar() {
  const inputType = useEngineStore((s) => s.inputType);
  const sendCommand = useEngineStore((s) => s.sendCommand);
  const draft = useUiStore((s) => s.commandDraft);
  const setDraft = useUiStore((s) => s.setCommandDraft);
  const commandHistory = useUiStore((s) => s.commandHistory);
  const pushCommandHistory = useUiStore((s) => s.pushCommandHistory);

  const [historyOpen, setHistoryOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const touchStartY = useRef<number | null>(null);
  const inset = useKeyboardInset();

  function submit() {
    const text = draft.trim();
    if (!text || inputType !== 'line') return;
    sendCommand(text);
    pushCommandHistory(text);
    setDraft('');
    setHistoryOpen(false);
  }

  function chooseHistory(text: string) {
    setDraft(text);
    setHistoryOpen(false);
    inputRef.current?.focus();
  }

  return (
    <div className="command-bar" style={{ paddingBottom: inset }}>
      {historyOpen && (
        <div className="command-history" role="listbox" aria-label="Command history">
          {commandHistory.length === 0 && <p>No commands yet.</p>}
          {commandHistory.map((text, i) => (
            <button
              key={`${text}-${i}`}
              type="button"
              className="chip tap-target"
              onClick={() => chooseHistory(text)}
            >
              {text}
            </button>
          ))}
        </div>
      )}
      <form
        className="command-form"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <button
          type="button"
          className="tap-target"
          aria-expanded={historyOpen}
          aria-label="Command history"
          onClick={() => setHistoryOpen((open) => !open)}
        >
          ▲
        </button>
        <input
          ref={inputRef}
          type="text"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          enterKeyHint="send"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onTouchStart={(e) => {
            touchStartY.current = e.touches[0]?.clientY ?? null;
          }}
          onTouchEnd={(e) => {
            const startY = touchStartY.current;
            touchStartY.current = null;
            if (startY == null) return;
            const endY = e.changedTouches[0]?.clientY ?? startY;
            if (startY - endY > SWIPE_UP_THRESHOLD) setHistoryOpen(true);
          }}
          placeholder={inputType === 'line' ? 'Enter a command…' : 'Waiting…'}
        />
        {draft.trim() !== '' && (
          <button
            type="button"
            className="tap-target"
            aria-label="Delete last word"
            onClick={() => setDraft(draft.trimEnd().replace(/\S+$/, '').trimEnd())}
          >
            ⌫
          </button>
        )}
        <button type="submit" className="tap-target" disabled={inputType !== 'line'}>
          Send
        </button>
      </form>
    </div>
  );
}
