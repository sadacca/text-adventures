import { memo, type ReactNode } from 'react';
import { useUiStore } from '../state/uiStore';
import { haptic } from '../haptics';

/** Strips leading/trailing punctuation so tapping "lantern." appends "lantern". */
function cleanWord(token: string): string {
  return token.replace(/^[^a-z0-9']+|[^a-z0-9']+$/gi, '');
}

function renderLineTokens(
  line: string,
  keyPrefix: string,
  appendToDraft: (word: string) => void,
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
        onClick={() => {
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
 * dimmed/bold to stand out from game prose.
 */
export const TapWords = memo(function TapWords({ text }: { text: string }) {
  const appendToDraft = useUiStore((s) => s.appendToDraft);
  const lines = text.split('\n');
  const nodes: ReactNode[] = [];

  lines.forEach((line, lineIndex) => {
    const tokens = renderLineTokens(line, `l${lineIndex}`, appendToDraft);
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
