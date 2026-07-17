import { useEffect, useState } from 'react';
import { getTranscript } from '../storage/transcripts';
import type { TranscriptEntry } from '../storage/db';
import { filterTranscript } from './recall';

/** UX-33: how long to wait after the last keystroke before re-searching. */
const DEBOUNCE_MS = 200;

/** UX-33: Story-tab transcript search — "Where did I see the grating?" has no answer
 *  on a phone otherwise (no Ctrl-F, and scrollback scrubbing is painful). Search input
 *  MAY focus/open the keyboard — searching is a typing activity, unlike every other
 *  sheet in this app. Tapping a result does nothing in v1: the live transcript array
 *  and the stored ring don't share indices, so jump-to-result is out of scope. */
export function RecallSheet({ gameId, onClose }: { gameId: string; onClose: () => void }) {
  const [entries, setEntries] = useState<TranscriptEntry[]>([]);
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');

  useEffect(() => {
    let cancelled = false;
    void getTranscript(gameId).then((loaded) => {
      if (!cancelled) setEntries(loaded);
    });
    return () => {
      cancelled = true;
    };
  }, [gameId]);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(query), DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [query]);

  const results = filterTranscript(entries, debouncedQuery);

  return (
    <div className="room-edit-backdrop" onClick={onClose}>
      <div className="room-edit-sheet" onClick={(e) => e.stopPropagation()}>
        <h2>Search this story</h2>
        <input
          type="text"
          className="recall-input"
          autoFocus
          placeholder="Search commands and text…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        {debouncedQuery.trim().length >= 2 && results.length === 0 && (
          <p className="recall-empty">No matches yet.</p>
        )}
        <ul className="recall-list">
          {results.map((result, i) => (
            <li key={i} className="recall-entry">
              <span className="recall-turn">Turn {result.turn}</span>
              <div className="recall-line">
                {result.line.slice(0, result.matchStart)}
                <strong>{result.line.slice(result.matchStart, result.matchEnd)}</strong>
                {result.line.slice(result.matchEnd)}
              </div>
              {result.context && <div className="recall-context">{result.context}</div>}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
