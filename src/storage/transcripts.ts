import { getDb, type TranscriptEntry } from './db.js';

const MAX_ENTRIES = 2000;

export async function appendTranscriptEntry(gameId: string, entry: TranscriptEntry): Promise<void> {
  const db = await getDb();
  const existing = await db.get('transcripts', gameId);
  const entries = [...(existing?.entries ?? []), entry];
  const trimmed =
    entries.length > MAX_ENTRIES ? entries.slice(entries.length - MAX_ENTRIES) : entries;
  await db.put('transcripts', { gameId, entries: trimmed });
}

export async function getTranscript(gameId: string): Promise<TranscriptEntry[]> {
  const db = await getDb();
  const record = await db.get('transcripts', gameId);
  return record?.entries ?? [];
}
