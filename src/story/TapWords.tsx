import { useEffect, useRef } from 'react';
import { useUiStore } from '../state/uiStore';

/** Strips leading/trailing punctuation so tapping "lantern." appends "lantern". */
function cleanWord(token: string): string {
  return token.replace(/^[^a-z0-9']+|[^a-z0-9']+$/gi, '');
}

/**
 * Task 1.7 "tap-a-word": wraps the story transcript and makes every word tappable —
 * tapping appends the cleaned word to the command draft (e.g. tap "examine" chip, tap
 * "lantern" in the text, send) without opening the keyboard. Whitespace runs are
 * preserved verbatim so the visible text is unchanged.
 */
export function TapWords({ text }: { text: string }) {
  const appendToDraft = useUiStore((s) => s.appendToDraft);
  const ref = useRef<HTMLPreElement>(null);

  // Pin scroll to the newest text on every update — otherwise a long session leaves the
  // player staring at whatever text happened to be on screen when they last scrolled,
  // with nothing indicating there's new output below.
  useEffect(() => {
    const el = ref.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [text]);

  const tokens = text.split(/(\s+)/);

  return (
    <pre className="story-transcript" ref={ref}>
      {tokens.map((token, i) => {
        if (/^\s*$/.test(token)) return token;
        const word = cleanWord(token);
        if (!word) return token;
        return (
          <span
            key={i}
            className="tap-word"
            onClick={() => {
              appendToDraft(word.toLowerCase());
            }}
          >
            {token}
          </span>
        );
      })}
    </pre>
  );
}
