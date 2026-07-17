import type { TranscriptEntry } from '../storage/db.js';

export interface RecallResult {
  turn: number;
  field: 'command' | 'response';
  line: string;
  matchStart: number;
  matchEnd: number;
  context: string | null;
}

/** UX-33: require at least this many characters before searching at all. */
const MIN_QUERY_LENGTH = 2;
/** UX-33: cap total displayed results across the whole transcript. */
const MAX_RESULTS = 50;

/**
 * Case-insensitive search across a transcript's command/response text, newest turn
 * first. Matches are reported at line granularity (a multi-line response is split so
 * each result is just the matching line, plus one line of surrounding context), with
 * `[matchStart, matchEnd)` offsets into `line` so the caller can bold the match with a
 * plain `<strong>` element — never by touching innerHTML. Returns `[]` for a query
 * shorter than `MIN_QUERY_LENGTH` (the debounce/keystroke timing is the caller's job).
 */
export function filterTranscript(entries: TranscriptEntry[], query: string): RecallResult[] {
  const trimmed = query.trim();
  if (trimmed.length < MIN_QUERY_LENGTH) return [];
  const needle = trimmed.toLowerCase();
  const results: RecallResult[] = [];

  for (let i = entries.length - 1; i >= 0 && results.length < MAX_RESULTS; i--) {
    const entry = entries[i];

    // The player's own command is always a single line.
    const commandIdx = entry.command.toLowerCase().indexOf(needle);
    if (commandIdx !== -1) {
      results.push({
        turn: entry.turn,
        field: 'command',
        line: entry.command,
        matchStart: commandIdx,
        matchEnd: commandIdx + needle.length,
        context: null,
      });
    }

    const lines = entry.response.split('\n');
    for (let li = 0; li < lines.length && results.length < MAX_RESULTS; li++) {
      const idx = lines[li].toLowerCase().indexOf(needle);
      if (idx === -1) continue;
      results.push({
        turn: entry.turn,
        field: 'response',
        line: lines[li],
        matchStart: idx,
        matchEnd: idx + needle.length,
        context: lines[li + 1]?.trim() || lines[li - 1]?.trim() || null,
      });
    }
  }

  return results;
}
