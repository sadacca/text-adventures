import { memo, useRef, type MutableRefObject, type ReactNode } from 'react';
import { useUiStore } from '../state/uiStore';
import { useEngineStore } from '../state/engineStore';
import { haptic } from '../haptics';

/** UX-12: hold time before a word tap counts as a long-press ("examine"). */
const LONG_PRESS_MS = 500;
/** UX-12: pointer travel past this many px cancels a pending long-press — it's a scroll. */
const LONG_PRESS_CANCEL_PX = 10;

/** Shared across every word span in one TapWords render: only one press can be in flight
 *  at a time, so per-word refs would be needless bookkeeping. */
interface LongPressRefs {
  timer: MutableRefObject<ReturnType<typeof setTimeout> | null>;
  /** Set once the hold fires; the click that follows the pointerup checks-and-clears it
   *  so a completed long-press doesn't also append the word to the draft. */
  longPressed: MutableRefObject<boolean>;
  start: MutableRefObject<{ x: number; y: number } | null>;
}

function clearLongPressTimer(refs: LongPressRefs) {
  if (refs.timer.current !== null) {
    clearTimeout(refs.timer.current);
    refs.timer.current = null;
  }
  refs.start.current = null;
}

/** Strips leading/trailing punctuation so tapping "lantern." appends "lantern". */
function cleanWord(token: string): string {
  return token.replace(/^[^a-z0-9']+|[^a-z0-9']+$/gi, '');
}

function renderLineTokens(
  line: string,
  keyPrefix: string,
  appendToDraft: (word: string) => void,
  refs: LongPressRefs,
): ReactNode[] {
  const tokens = line.split(/(\s+)/);
  return tokens.map((token, i) => {
    if (/^\s*$/.test(token)) return token;
    const word = cleanWord(token);
    if (!word) return token;
    return (
      <span
        key={`${keyPrefix}-${i}`}
        className="tap-word"
        onPointerDown={(e) => {
          refs.start.current = { x: e.clientX, y: e.clientY };
          refs.timer.current = setTimeout(() => {
            refs.timer.current = null;
            refs.longPressed.current = true;
            haptic(20);
            if (useEngineStore.getState().inputType === 'line') {
              useEngineStore.getState().sendCommand(`examine ${word.toLowerCase()}`);
            }
          }, LONG_PRESS_MS);
        }}
        onPointerUp={() => clearLongPressTimer(refs)}
        onPointerLeave={() => clearLongPressTimer(refs)}
        onPointerCancel={() => clearLongPressTimer(refs)}
        onPointerMove={(e) => {
          const start = refs.start.current;
          if (!start) return;
          if (Math.hypot(e.clientX - start.x, e.clientY - start.y) > LONG_PRESS_CANCEL_PX) {
            clearLongPressTimer(refs);
          }
        }}
        onClick={() => {
          if (refs.longPressed.current) {
            refs.longPressed.current = false;
            return;
          }
          haptic();
          appendToDraft(word.toLowerCase());
        }}
      >
        {token}
      </span>
    );
  });
}

/**
 * Task 1.7 "tap-a-word": renders one turn's response text and makes every word tappable —
 * tapping appends the cleaned word to the command draft (e.g. tap "examine" chip, tap
 * "lantern" in the text, send) without opening the keyboard. Whitespace runs are
 * preserved verbatim (via CSS `white-space: pre-wrap`) so the visible text is unchanged.
 * A line whose trimmed form starts with `>` is the player's own command echo, rendered
 * dimmed/bold to stand out from game prose. UX-12: holding a word for 500ms instead sends
 * `examine <word>` directly (only while awaiting line input) and suppresses the tap.
 */
export const TapWords = memo(function TapWords({ text }: { text: string }) {
  const appendToDraft = useUiStore((s) => s.appendToDraft);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressed = useRef(false);
  const start = useRef<{ x: number; y: number } | null>(null);
  const refs: LongPressRefs = { timer, longPressed, start };
  const lines = text.split('\n');
  const nodes: ReactNode[] = [];

  lines.forEach((line, lineIndex) => {
    const tokens = renderLineTokens(line, `l${lineIndex}`, appendToDraft, refs);
    if (line.trim().startsWith('>')) {
      nodes.push(
        <span className="story-echo" key={`echo-${lineIndex}`}>
          {tokens}
        </span>,
      );
    } else {
      nodes.push(...tokens);
    }
    if (lineIndex < lines.length - 1) nodes.push('\n');
  });

  return <div className="story-block">{nodes}</div>;
});
