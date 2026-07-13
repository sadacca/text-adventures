import { useUiStore } from '../state/uiStore';

/** Strips leading/trailing punctuation so tapping "lantern." appends "lantern". */
function cleanWord(token: string): string {
  return token.replace(/^[^a-z0-9']+|[^a-z0-9']+$/gi, '');
}

/**
 * Task 1.7 "tap-a-word": wraps the story transcript and makes every word tappable —
 * tapping appends the cleaned word to the command draft (e.g. tap "examine" chip, tap
 * "lantern" in the text, send). Whitespace runs are preserved verbatim so the visible
 * text is unchanged.
 */
export function TapWords({ text }: { text: string }) {
  const appendToDraft = useUiStore((s) => s.appendToDraft);
  const requestInputFocus = useUiStore((s) => s.requestInputFocus);

  const tokens = text.split(/(\s+)/);

  return (
    <pre className="story-transcript">
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
              requestInputFocus();
            }}
          >
            {token}
          </span>
        );
      })}
    </pre>
  );
}
