import { getDb, type ScoreLogEntry } from './db.js';

const MAX_ENTRIES = 500;

/** UX-29: persists one entry per score-increasing turn (UX-11's scoreDelta detection),
 *  so StoryScreen can show a re-readable "trophy log" of progress. */
export async function appendScoreEntry(gameId: string, entry: ScoreLogEntry): Promise<void> {
  const db = await getDb();
  const existing = await db.get('scoreLog', gameId);
  const entries = [...(existing?.entries ?? []), entry];
  const trimmed =
    entries.length > MAX_ENTRIES ? entries.slice(entries.length - MAX_ENTRIES) : entries;
  await db.put('scoreLog', { gameId, entries: trimmed });
}

export async function getScoreLog(gameId: string): Promise<ScoreLogEntry[]> {
  const db = await getDb();
  const record = await db.get('scoreLog', gameId);
  return record?.entries ?? [];
}
