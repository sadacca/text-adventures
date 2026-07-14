import { useRef, useState } from 'react';
import { useEngineStore } from '../state/engineStore';
import { useUiStore } from '../state/uiStore';
import { useKeyboardInset } from './useKeyboardInset';
import { haptic } from '../haptics';

const SWIPE_UP_THRESHOLD = 40; // px
/** UX-13: same 500ms long-press pattern as UX-12's tap-word examine. */
const SEND_LONG_PRESS_MS = 500;
const SEND_LONG_PRESS_CANCEL_PX = 10;

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
  const sendChar = useEngineStore((s) => s.sendChar);
  const draft = useUiStore((s) => s.commandDraft);
  const setDraft = useUiStore((s) => s.setCommandDraft);
  const commandHistory = useUiStore((s) => s.commandHistory);
  const pushCommandHistory = useUiStore((s) => s.pushCommandHistory);

  const [historyOpen, setHistoryOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const touchStartY = useRef<number | null>(null);
  const inset = useKeyboardInset();

  // UX-13: long-pressing Send with an empty draft repeats the last command. Short-press
  // behavior is untouched — submit() already no-ops on an empty draft, so no suppression
  // flag is needed here the way UX-12 needs one for the tap-word click that follows.
  const sendPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sendPressStart = useRef<{ x: number; y: number } | null>(null);

  function clearSendLongPress() {
    if (sendPressTimer.current !== null) {
      clearTimeout(sendPressTimer.current);
      sendPressTimer.current = null;
    }
    sendPressStart.current = null;
  }

  function submit() {
    const text = draft.trim();
    if (!text || inputType !== 'line') return;
    haptic();
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

  // UX-14: a `char` input request ("press any key" prompts, menus) needs a different
  // affordance entirely — the history popover, draft input, and delete-last-word button
  // are all line-input concepts that don't apply. The shared draft itself is left
  // untouched in the store so the player's in-progress line survives past the prompt.
  if (inputType === 'char') {
    return (
      <div className="command-bar" style={{ paddingBottom: inset }}>
        <form
          className="command-form"
          onSubmit={(e) => {
            e.preventDefault();
            haptic();
            sendChar(' ');
          }}
        >
          <input
            type="text"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            value=""
            aria-label="Type a single key"
            placeholder="Type a key…"
            onChange={(e) => {
              const ch = e.target.value.slice(-1);
              if (!ch) return;
              haptic();
              sendChar(ch);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                haptic();
                sendChar('return');
              }
            }}
          />
          <button type="submit" className="tap-target btn-primary continue-button">
            Tap to continue
          </button>
        </form>
      </div>
    );
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
        <button
          type="submit"
          className="tap-target"
          disabled={inputType !== 'line'}
          aria-label="Send. Long press to repeat last command"
          onPointerDown={(e) => {
            if (draft.trim() !== '' || commandHistory.length === 0) return;
            sendPressStart.current = { x: e.clientX, y: e.clientY };
            sendPressTimer.current = setTimeout(() => {
              sendPressTimer.current = null;
              haptic(20);
              sendCommand(commandHistory[0]);
            }, SEND_LONG_PRESS_MS);
          }}
          onPointerUp={clearSendLongPress}
          onPointerLeave={clearSendLongPress}
          onPointerCancel={clearSendLongPress}
          onPointerMove={(e) => {
            const start = sendPressStart.current;
            if (!start) return;
            if (Math.hypot(e.clientX - start.x, e.clientY - start.y) > SEND_LONG_PRESS_CANCEL_PX) {
              clearSendLongPress();
            }
          }}
        >
          Send
        </button>
      </form>
    </div>
  );
}
