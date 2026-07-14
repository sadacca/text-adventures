import { listGames } from '../storage/games.js';
import { getLatestAutosave } from '../storage/autosaves.js';
import { useEngineStore } from './engineStore.js';
import { useUiStore } from './uiStore.js';

let attempted = false;

/** Test hook only — resets the once-per-boot guard. */
export function resetAutoResumeForTests() {
  attempted = false;
}

/**
 * Boot path: reopen the most recently played game, if it has a live autosave. Runs at
 * most once per page load (React StrictMode double-invokes effects in dev; the guard
 * makes the second call a no-op). A game with no autosave has never actually been
 * played — stay on the Library so "Play" remains an explicit choice.
 */
export async function autoResumeLastGame(): Promise<void> {
  if (attempted) return;
  attempted = true;
  const games = await listGames(); // already sorted by lastPlayedAt, newest first
  const latest = games[0];
  if (!latest) return;
  if (!(await getLatestAutosave(latest.gameId))) return;
  useUiStore.getState().setTab('story');
  await useEngineStore.getState().openGame(latest.gameId);
}
