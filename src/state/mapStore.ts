import { create } from 'zustand';
import type { GameEvent } from '../engine/types.js';
import {
  Automapper,
  createEmptyGraph,
  deleteRoom,
  mergeRooms,
  moveRoom,
  renameRoom,
  setRoomNote,
  type MapGraph,
} from '../map/graph.js';
import { computeLayout } from '../map/layout.js';
import { getMap, saveMap } from '../storage/maps.js';

const SAVE_DEBOUNCE_MS = 500;

interface MapState {
  graph: MapGraph;
  loadForGame: (gameId: string) => Promise<void>;
  handleEvent: (event: GameEvent) => void;
  reset: () => void;

  // --- Task 1.8: touch-editing actions (long-press sheet, drag-to-move) ---
  renameRoom: (id: string, name: string) => void;
  setRoomNote: (id: string, note: string) => void;
  deleteRoom: (id: string) => void;
  mergeRooms: (keepId: string, mergeId: string) => void;
  /** Drag-to-move: does NOT re-run `computeLayout` (that would fight the very drag
   *  that just happened) — `moveRoom` itself sets `posLocked`, which is the only thing
   *  that has to happen for the room to stick exactly where it was dropped. */
  moveRoom: (id: string, pos: { x: number; y: number }) => void;
}

let automapper: Automapper | null = null;
let activeGameId: string | null = null;
let saveTimer: ReturnType<typeof setTimeout> | null = null;

function flushPendingSave() {
  if (!saveTimer) return;
  clearTimeout(saveTimer);
  saveTimer = null;
  if (activeGameId && automapper) void saveMap(activeGameId, automapper.graph);
}

function scheduleSave() {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = null;
    if (activeGameId && automapper) void saveMap(activeGameId, automapper.graph);
  }, SAVE_DEBOUNCE_MS);
}

/** Re-reads `automapper.graph` into a new top-level ref (for subscriber re-render) and
 *  schedules the debounced persist — the common tail of every graph-mutating action. */
function commit(set: (partial: Partial<MapState>) => void) {
  if (!automapper) return;
  set({ graph: { ...automapper.graph } });
  scheduleSave();
}

export const useMapStore = create<MapState>((set) => ({
  graph: createEmptyGraph(),

  async loadForGame(gameId) {
    flushPendingSave();
    const graph = await getMap(gameId);
    automapper = new Automapper(graph);
    activeGameId = gameId;
    set({ graph: automapper.graph });
  },

  handleEvent(event) {
    if (!automapper || !activeGameId) return;
    automapper.handleEvent(event);
    computeLayout(automapper.graph);
    commit(set);
  },

  renameRoom(id, name) {
    if (!automapper) return;
    renameRoom(automapper.graph, id, name);
    commit(set);
  },

  setRoomNote(id, note) {
    if (!automapper) return;
    setRoomNote(automapper.graph, id, note);
    commit(set);
  },

  deleteRoom(id) {
    if (!automapper) return;
    deleteRoom(automapper.graph, id);
    computeLayout(automapper.graph);
    commit(set);
  },

  mergeRooms(keepId, mergeId) {
    if (!automapper) return;
    mergeRooms(automapper.graph, keepId, mergeId);
    computeLayout(automapper.graph);
    commit(set);
  },

  moveRoom(id, pos) {
    if (!automapper) return;
    moveRoom(automapper.graph, id, pos);
    commit(set);
  },

  reset() {
    flushPendingSave();
    automapper = null;
    activeGameId = null;
    set({ graph: createEmptyGraph() });
  },
}));

if (typeof document !== 'undefined') {
  const flush = () => {
    if (document.visibilityState === 'hidden') flushPendingSave();
  };
  document.addEventListener('visibilitychange', flush);
  window.addEventListener('pagehide', flushPendingSave);
}
