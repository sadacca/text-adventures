import { toArrayBuffer } from './bytes.js';
import { getDb, type GameRecord } from './db.js';
import { computeGameId, detectFormat } from './gameId.js';

export type { GameRecord } from './db.js';

function titleFromFileName(fileName: string): string {
  return fileName.replace(/\.[^./]+$/, '') || fileName;
}

/** Adds a new game, or (re-upload dedupe) just touches lastPlayedAt if it already exists. */
export async function addOrTouchGame(bytes: Uint8Array, fileName: string): Promise<GameRecord> {
  const gameId = await computeGameId(bytes);
  const db = await getDb();
  const existing = await db.get('games', gameId);
  const now = Date.now();
  if (existing) {
    const touched: GameRecord = { ...existing, lastPlayedAt: now };
    await db.put('games', touched);
    return touched;
  }
  const record: GameRecord = {
    gameId,
    title: titleFromFileName(fileName),
    fileName,
    bytes: toArrayBuffer(bytes),
    format: detectFormat(bytes),
    addedAt: now,
    lastPlayedAt: now,
  };
  await db.put('games', record);
  return record;
}

export async function listGames(): Promise<GameRecord[]> {
  const db = await getDb();
  const all = await db.getAll('games');
  return all.sort((a, b) => b.lastPlayedAt - a.lastPlayedAt);
}

export async function getGame(gameId: string): Promise<GameRecord | undefined> {
  const db = await getDb();
  return db.get('games', gameId);
}

export async function touchLastPlayed(gameId: string): Promise<void> {
  const db = await getDb();
  const record = await db.get('games', gameId);
  if (!record) return;
  await db.put('games', { ...record, lastPlayedAt: Date.now() });
}

export async function renameGame(gameId: string, title: string): Promise<void> {
  const db = await getDb();
  const record = await db.get('games', gameId);
  if (!record) return;
  await db.put('games', { ...record, title });
}

async function deleteAllForGame(
  storeName: 'autosaves' | 'saves' | 'maps' | 'transcripts' | 'scoreLog' | 'verbStats',
  gameId: string,
) {
  const db = await getDb();
  const tx = db.transaction(storeName, 'readwrite');
  let cursor = await tx.store.openCursor();
  while (cursor) {
    if ((cursor.value as { gameId: string }).gameId === gameId) {
      await cursor.delete();
    }
    cursor = await cursor.continue();
  }
  await tx.done;
}

/** Deletes a game entirely, including its autosaves, named saves, map, transcript,
 *  score log, and learned-verb stats. */
export async function deleteGame(gameId: string): Promise<void> {
  const db = await getDb();
  await Promise.all([
    deleteAllForGame('autosaves', gameId),
    deleteAllForGame('saves', gameId),
    deleteAllForGame('maps', gameId),
    deleteAllForGame('transcripts', gameId),
    deleteAllForGame('scoreLog', gameId),
    deleteAllForGame('verbStats', gameId),
  ]);
  await db.delete('games', gameId);
}

/**
 * "Restart" (SPECS.md §4): wipes the live playthrough bundle (autosaves, map,
 * transcript, score log, learned-verb stats) but keeps the game itself and any
 * deliberately-named saves.
 */
export async function restartPlaythrough(gameId: string): Promise<void> {
  await Promise.all([
    deleteAllForGame('autosaves', gameId),
    deleteAllForGame('maps', gameId),
    deleteAllForGame('transcripts', gameId),
    deleteAllForGame('scoreLog', gameId),
    deleteAllForGame('verbStats', gameId),
  ]);
}
