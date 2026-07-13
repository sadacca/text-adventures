import { openDB, type DBSchema, type IDBPDatabase } from 'idb';

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

interface TextAdventuresDb extends DBSchema {
  games: { key: string; value: GameRecord };
  autosaves: { key: [string, number]; value: AutosaveRecord };
  saves: { key: [string, string]; value: SaveRecord };
  // MapGraph shape lands with Task 1.6; stored as an opaque JSON-serializable value until then.
  maps: { key: string; value: unknown };
  transcripts: { key: string; value: TranscriptRecord };
  settings: { key: string; value: SettingsRecord };
}

const DB_NAME = 'text-adventures';
const DB_VERSION = 1;

let dbPromise: Promise<IDBPDatabase<TextAdventuresDb>> | null = null;

export function getDb(): Promise<IDBPDatabase<TextAdventuresDb>> {
  if (!dbPromise) {
    dbPromise = openDB<TextAdventuresDb>(DB_NAME, DB_VERSION, {
      upgrade(db) {
        db.createObjectStore('games', { keyPath: 'gameId' });
        db.createObjectStore('autosaves', { keyPath: ['gameId', 'generation'] });
        db.createObjectStore('saves', { keyPath: ['gameId', 'name'] });
        db.createObjectStore('maps', { keyPath: 'gameId' });
        db.createObjectStore('transcripts', { keyPath: 'gameId' });
        db.createObjectStore('settings');
      },
    });
  }
  return dbPromise;
}
