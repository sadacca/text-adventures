import { getDb } from './db.js';

/** UX-32: bumps a learned verb's usage count for this game, returning the new count so
 *  the caller can react the moment a verb first crosses its reveal threshold (see
 *  engineStore's command handling) without waiting for the next periodic refresh. */
export async function bumpVerb(gameId: string, verb: string): Promise<number> {
  const db = await getDb();
  const existing = await db.get('verbStats', gameId);
  const counts = { ...existing?.counts };
  const newCount = (counts[verb] ?? 0) + 1;
  counts[verb] = newCount;
  await db.put('verbStats', { gameId, counts });
  return newCount;
}

export async function getVerbCounts(gameId: string): Promise<Record<string, number>> {
  const db = await getDb();
  const record = await db.get('verbStats', gameId);
  return record?.counts ?? {};
}
