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

/** UX-22: drops every transcript entry for a turn after `turn` (kept: turn <= keepTurn).
 *  Used when Undo rewinds the engine to an earlier autosave generation, so the
 *  rebuilt-on-resume scrollback (engineStore.openGame) matches the rewound state instead
 *  of still showing the undone move's response. */
export async function trimTranscriptAfterTurn(gameId: string, keepTurn: number): Promise<void> {
  const db = await getDb();
  const existing = await db.get('transcripts', gameId);
  if (!existing) return;
  const trimmed = existing.entries.filter((e) => e.turn <= keepTurn);
  if (trimmed.length === existing.entries.length) return;
  await db.put('transcripts', { gameId, entries: trimmed });
}
