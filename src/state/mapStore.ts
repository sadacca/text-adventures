import { create } from 'zustand';
import type { GameEvent } from '../engine/types.js';
import { Automapper, createEmptyGraph, type MapGraph } from '../map/graph.js';
import { computeLayout } from '../map/layout.js';
import { getMap, saveMap } from '../storage/maps.js';

const SAVE_DEBOUNCE_MS = 500;

interface MapState {
  graph: MapGraph;
  loadForGame: (gameId: string) => Promise<void>;
  handleEvent: (event: GameEvent) => void;
  reset: () => void;
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
    set({ graph: { ...automapper.graph } }); // new top-level ref so subscribers re-render
    scheduleSave();
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
