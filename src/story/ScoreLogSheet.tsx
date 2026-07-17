import { useEffect, useState } from 'react';
import { getScoreLog } from '../storage/scoreLog';
import type { ScoreLogEntry } from '../storage/db';

/** UX-29: bottom sheet listing every score-increasing turn this playthrough, newest
 *  first — a re-readable "trophy log" for UX-11's scoreDelta moments, which otherwise
 *  vanish once their toast dismisses. Same bottom-sheet chrome as RoomEditSheet. */
export function ScoreLogSheet({ gameId, onClose }: { gameId: string; onClose: () => void }) {
  const [entries, setEntries] = useState<ScoreLogEntry[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    void getScoreLog(gameId).then((loaded) => {
      if (!cancelled) setEntries(loaded);
    });
    return () => {
      cancelled = true;
    };
  }, [gameId]);

  const newestFirst = entries ? [...entries].reverse() : [];

  return (
    <div className="room-edit-backdrop" onClick={onClose}>
      <div className="room-edit-sheet" onClick={(e) => e.stopPropagation()}>
        <h2>Score log</h2>
        {entries && entries.length === 0 && (
          <p className="score-log-empty">No points yet — they'll be logged here.</p>
        )}
        {newestFirst.length > 0 && (
          <ul className="score-log-list">
            {newestFirst.map((entry, i) => (
              <li key={i} className="score-log-entry">
                <span className="score-log-amount">+{entry.amount}</span>
                {entry.command && <span> · {entry.command}</span>}
                <span> · {entry.room}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
