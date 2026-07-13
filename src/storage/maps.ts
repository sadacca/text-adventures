import { getDb } from './db.js';
import { createEmptyGraph, type MapGraph } from '../map/graph.js';

export async function getMap(gameId: string): Promise<MapGraph> {
  const db = await getDb();
  const record = await db.get('maps', gameId);
  if (!record) return createEmptyGraph();
  return {
    rooms: record.rooms,
    edges: record.edges,
    currentRoomId: record.currentRoomId,
    aliases: record.aliases,
  };
}

export async function saveMap(gameId: string, graph: MapGraph): Promise<void> {
  const db = await getDb();
  await db.put('maps', { ...graph, gameId });
}

export async function deleteMap(gameId: string): Promise<void> {
  const db = await getDb();
  await db.delete('maps', gameId);
}
