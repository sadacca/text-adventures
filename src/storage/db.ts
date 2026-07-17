import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { MapGraph } from '../map/graph.js';

export interface GameRecord {
  gameId: string;
  title: string;
  fileName: string;
  bytes: ArrayBuffer;
  format: 'zcode' | 'blorb';
  addedAt: number;
  lastPlayedAt: number;
}

export interface AutosaveRecord {
  gameId: string;
  generation: number;
  snapshot: ArrayBuffer;
  turn: number;
  savedAt: number;
}

export interface SaveRecord {
  gameId: string;
  name: string;
  quetzal: ArrayBuffer;
  turn: number;
  savedAt: number;
}

export interface TranscriptEntry {
  turn: number;
  command: string;
  response: string;
}

export interface TranscriptRecord {
  gameId: string;
  entries: TranscriptEntry[];
}

export interface SettingsRecord {
  theme: 'light' | 'dark' | 'system';
  fontSize: number;
  llm?: { provider: string; model: string };
  art?: Record<string, unknown>;
}

/** UX-29: one entry per score-increasing turn (UX-11's scoreDelta detection). */
export interface ScoreLogEntry {
  turn: number;
  amount: number;
  command: string;
  room: string;
}

export interface ScoreLogRecord {
  gameId: string;
  entries: ScoreLogEntry[];
}

/** UX-32: per-game learned-verb usage counts, keyed by the lowercased first word of
 *  each counted command. */
export interface VerbStatsRecord {
  gameId: string;
  counts: Record<string, number>;
}

interface TextAdventuresDb extends DBSchema {
  games: { key: string; value: GameRecord };
  autosaves: { key: [string, number]; value: AutosaveRecord };
  saves: { key: [string, string]; value: SaveRecord };
  maps: { key: string; value: MapGraph & { gameId: string } };
  transcripts: { key: string; value: TranscriptRecord };
  settings: { key: string; value: SettingsRecord };
  scoreLog: { key: string; value: ScoreLogRecord };
  verbStats: { key: string; value: VerbStatsRecord };
}

const DB_NAME = 'text-adventures';
const DB_VERSION = 3;

let dbPromise: Promise<IDBPDatabase<TextAdventuresDb>> | null = null;

export function getDb(): Promise<IDBPDatabase<TextAdventuresDb>> {
  if (!dbPromise) {
    dbPromise = openDB<TextAdventuresDb>(DB_NAME, DB_VERSION, {
      upgrade(db, oldVersion) {
        if (oldVersion < 1) {
          db.createObjectStore('games', { keyPath: 'gameId' });
          db.createObjectStore('autosaves', { keyPath: ['gameId', 'generation'] });
          db.createObjectStore('saves', { keyPath: ['gameId', 'name'] });
          db.createObjectStore('maps', { keyPath: 'gameId' });
          db.createObjectStore('transcripts', { keyPath: 'gameId' });
          db.createObjectStore('settings');
        }
        if (oldVersion < 2) {
          db.createObjectStore('scoreLog', { keyPath: 'gameId' });
        }
        if (oldVersion < 3) {
          db.createObjectStore('verbStats', { keyPath: 'gameId' });
        }
      },
    });
  }
  return dbPromise;
}
