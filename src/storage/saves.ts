import { toArrayBuffer } from './bytes.js';
import { getDb } from './db.js';

export async function writeSave(
  gameId: string,
  name: string,
  quetzal: Uint8Array,
  turn: number,
): Promise<void> {
  const db = await getDb();
  await db.put('saves', {
    gameId,
    name,
    quetzal: toArrayBuffer(quetzal),
    turn,
    savedAt: Date.now(),
  });
}

export interface SaveSummary {
  name: string;
  turn: number;
  savedAt: number;
}

export async function listSaves(gameId: string): Promise<SaveSummary[]> {
  const db = await getDb();
  const range = IDBKeyRange.bound([gameId, ''], [gameId, '￿']);
  const all = await db.getAll('saves', range);
  return all
    .map(({ name, turn, savedAt }) => ({ name, turn, savedAt }))
    .sort((a, b) => b.savedAt - a.savedAt);
}

export async function readSave(gameId: string, name: string): Promise<Uint8Array | null> {
  const db = await getDb();
  const record = await db.get('saves', [gameId, name]);
  return record ? new Uint8Array(record.quetzal) : null;
}

export async function deleteSave(gameId: string, name: string): Promise<void> {
  const db = await getDb();
  await db.delete('saves', [gameId, name]);
}

/** Downloads (or, where supported, shares) a save's Quetzal bytes as a standalone file. */
export async function exportSave(gameId: string, name: string, gameTitle: string): Promise<void> {
  const bytes = await readSave(gameId, name);
  if (!bytes) throw new Error(`No save named "${name}" for this game`);
  const fileName = `${gameTitle} - ${name}.qzl`.replace(/[/\\]/g, '-');
  const file = new File([toArrayBuffer(bytes)], fileName, { type: 'application/octet-stream' });

  if (navigator.canShare?.({ files: [file] })) {
    await navigator.share({ files: [file], title: fileName });
    return;
  }

  const url = URL.createObjectURL(file);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(url);
}

/** Imports a Quetzal file (from export, or from another interpreter) as a named save. */
export async function importSave(gameId: string, file: File, name?: string): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const saveName = name ?? file.name.replace(/\.[^./]+$/, '') ?? `imported-${Date.now()}`;
  await writeSave(gameId, saveName, bytes, 0);
  return saveName;
}
