import { describe, expect, it } from 'vitest';
import { computeGameId, detectFormat } from '../src/storage/gameId';
import { addOrTouchGame, deleteGame, getGame, listGames } from '../src/storage/games';
import { getLatestAutosave, writeAutosaveGeneration } from '../src/storage/autosaves';
import { deleteSave, listSaves, readSave, writeSave } from '../src/storage/saves';
import { appendTranscriptEntry, getTranscript } from '../src/storage/transcripts';

function bytes(seed: number, length = 32): Uint8Array {
  const arr = new Uint8Array(length);
  for (let i = 0; i < length; i++) arr[i] = (seed + i) % 256;
  return arr;
}

describe('gameId', () => {
  it('is deterministic and 16 hex chars', async () => {
    const a = await computeGameId(bytes(1));
    const b = await computeGameId(bytes(1));
    const c = await computeGameId(bytes(2));
    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(a).toMatch(/^[0-9a-f]{16}$/);
  });

  it('detects blorb vs zcode by magic bytes', () => {
    const zcode = new Uint8Array([5, 0, 0, 9]);
    const blorb = new Uint8Array([0x46, 0x4f, 0x52, 0x4d, 0, 0, 0, 0]);
    expect(detectFormat(zcode)).toBe('zcode');
    expect(detectFormat(blorb)).toBe('blorb');
  });
});

describe('games store', () => {
  it('dedupes re-uploads of the same bytes and touches lastPlayedAt', async () => {
    const data = bytes(10);
    const first = await addOrTouchGame(data, 'advent.z5');
    await new Promise((r) => setTimeout(r, 5));
    const second = await addOrTouchGame(data, 'advent.z5');
    expect(second.gameId).toBe(first.gameId);
    expect(second.lastPlayedAt).toBeGreaterThanOrEqual(first.lastPlayedAt);
    const all = await listGames();
    expect(all.filter((g) => g.gameId === first.gameId)).toHaveLength(1);
  });

  it('deleteGame removes the game and its associated rows', async () => {
    const data = bytes(20);
    const game = await addOrTouchGame(data, 'zork.z3');
    await writeAutosaveGeneration(game.gameId, bytes(1), 1);
    await writeSave(game.gameId, 'my save', bytes(2), 1);
    await deleteGame(game.gameId);
    expect(await getGame(game.gameId)).toBeUndefined();
    expect(await getLatestAutosave(game.gameId)).toBeNull();
    expect(await listSaves(game.gameId)).toHaveLength(0);
  });
});

describe('autosaves', () => {
  it('keeps only the newest 3 generations', async () => {
    const gameId = 'game-autosave-prune';
    for (let turn = 1; turn <= 5; turn++) {
      await writeAutosaveGeneration(gameId, bytes(turn), turn);
    }
    const latest = await getLatestAutosave(gameId);
    expect(latest?.generation).toBe(5);
    expect(latest?.turn).toBe(5);

    // Reach into storage to confirm exactly 3 generations remain.
    const { getDb } = await import('../src/storage/db');
    const db = await getDb();
    const range = IDBKeyRange.bound([gameId, -Infinity], [gameId, Infinity]);
    const remaining = await db.getAll('autosaves', range);
    expect(remaining.map((r) => r.generation).sort((a, b) => a - b)).toEqual([3, 4, 5]);
  });

  it('returns null when a game has no autosave', async () => {
    expect(await getLatestAutosave('never-saved')).toBeNull();
  });
});

describe('saves', () => {
  it('round-trips named saves', async () => {
    const gameId = 'game-saves-roundtrip';
    await writeSave(gameId, 'before the maze', bytes(3), 12);
    const read = await readSave(gameId, 'before the maze');
    expect(read).toEqual(bytes(3));

    const list = await listSaves(gameId);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ name: 'before the maze', turn: 12 });

    await deleteSave(gameId, 'before the maze');
    expect(await readSave(gameId, 'before the maze')).toBeNull();
  });
});

describe('transcripts', () => {
  it('caps the ring buffer at 2000 entries', async () => {
    const gameId = 'game-transcript-ring';
    const { getDb } = await import('../src/storage/db');
    const db = await getDb();
    // Seed 1999 entries directly (bypassing 1999 slow round-trips through the public
    // API) so this test exercises appendTranscriptEntry's trimming, not raw IndexedDB
    // throughput.
    const seeded = Array.from({ length: 1999 }, (_, i) => ({
      turn: i + 1,
      command: `go ${i + 1}`,
      response: 'ok',
    }));
    await db.put('transcripts', { gameId, entries: seeded });

    await appendTranscriptEntry(gameId, { turn: 2000, command: 'go 2000', response: 'ok' });
    expect(await getTranscript(gameId)).toHaveLength(2000);

    await appendTranscriptEntry(gameId, { turn: 2001, command: 'go 2001', response: 'ok' });
    const entries = await getTranscript(gameId);
    expect(entries).toHaveLength(2000);
    expect(entries[0].turn).toBe(2);
    expect(entries[entries.length - 1].turn).toBe(2001);
  });
});
