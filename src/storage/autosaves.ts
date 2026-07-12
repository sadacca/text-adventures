import { toArrayBuffer } from './bytes.js';
import { getDb } from './db.js';

const KEEP_GENERATIONS = 3;

async function generationsForGame(gameId: string) {
  const db = await getDb();
  const range = IDBKeyRange.bound([gameId, -Infinity], [gameId, Infinity]);
  return db.getAll('autosaves', range);
}

/** Writes a new autosave generation for a game, pruning older generations beyond the newest 3. */
export async function writeAutosaveGeneration(
  gameId: string,
  snapshot: Uint8Array,
  turn: number,
): Promise<void> {
  const db = await getDb();
  const existing = await generationsForGame(gameId);
  const nextGeneration = existing.reduce((max, r) => Math.max(max, r.generation), 0) + 1;

  await db.put('autosaves', {
    gameId,
    generation: nextGeneration,
    snapshot: toArrayBuffer(snapshot),
    turn,
    savedAt: Date.now(),
  });

  const stale = [...existing, { generation: nextGeneration }]
    .sort((a, b) => b.generation - a.generation)
    .slice(KEEP_GENERATIONS);
  await Promise.all(stale.map((r) => db.delete('autosaves', [gameId, r.generation])));
}

export interface LatestAutosave {
  snapshot: Uint8Array;
  turn: number;
  generation: number;
  savedAt: number;
}

/** Returns the newest autosave generation for a game, or null if it has none. */
export async function getLatestAutosave(gameId: string): Promise<LatestAutosave | null> {
  const existing = await generationsForGame(gameId);
  if (existing.length === 0) return null;
  const latest = existing.reduce((best, r) => (r.generation > best.generation ? r : best));
  return {
    snapshot: new Uint8Array(latest.snapshot),
    turn: latest.turn,
    generation: latest.generation,
    savedAt: latest.savedAt,
  };
}
