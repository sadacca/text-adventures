import { useEffect, useState } from 'react';
import { useUiStore } from '../state/uiStore';
import { useEngineStore } from '../state/engineStore';
import { useDialogStore } from '../state/dialogStore';
import {
  addOrTouchGame,
  deleteGame,
  listGames,
  restartPlaythrough as restartPlaythroughInStorage,
  type GameRecord,
} from '../storage/games';
import { getLatestAutosave } from '../storage/autosaves';
import { getMap } from '../storage/maps';
import { UNKNOWN_ROOM_ID } from '../map/graph';

const ACCEPTED_EXTENSIONS = '.z1,.z2,.z3,.z4,.z5,.z6,.z7,.z8,.dat,.zblorb,.blb,.blorb,.gblorb';

function formatDate(ms: number): string {
  return new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

/** UX-34: per-game stats shown as a card's second meta line, only once a playthrough
 *  actually exists (no autosave = never played = no "0 rooms" noise). */
interface GameStats {
  turns: number;
  rooms: number;
}

export function LibraryScreen() {
  const [games, setGames] = useState<GameRecord[]>([]);
  const [savedGameIds, setSavedGameIds] = useState<Set<string>>(new Set());
  const [gameStats, setGameStats] = useState<Map<string, GameStats>>(new Map());
  const [uploading, setUploading] = useState(false);
  const setTab = useUiStore((s) => s.setTab);
  const openGame = useEngineStore((s) => s.openGame);
  const restartPlaythrough = useEngineStore((s) => s.restartPlaythrough);
  const activeGameId = useEngineStore((s) => s.gameId);

  async function refreshSavedGameIds(list: GameRecord[]) {
    const results = await Promise.all(
      list.map(async (g) => {
        const autosave = await getLatestAutosave(g.gameId);
        if (!autosave) return { gameId: g.gameId, stats: null };
        const map = await getMap(g.gameId);
        const rooms = Object.keys(map.rooms).filter((id) => id !== UNKNOWN_ROOM_ID).length;
        return { gameId: g.gameId, stats: { turns: autosave.turn, rooms } };
      }),
    );
    setSavedGameIds(new Set(results.filter((r) => r.stats !== null).map((r) => r.gameId)));
    setGameStats(
      new Map(
        results
          .filter((r): r is { gameId: string; stats: GameStats } => r.stats !== null)
          .map((r) => [r.gameId, r.stats]),
      ),
    );
  }

  async function refresh() {
    const list = await listGames();
    setGames(list);
    await refreshSavedGameIds(list);
  }

  useEffect(() => {
    let cancelled = false;
    listGames().then(async (g) => {
      if (cancelled) return;
      setGames(g);
      await refreshSavedGameIds(g);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  async function onFileChosen(file: File) {
    setUploading(true);
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      await addOrTouchGame(bytes, file.name);
      await refresh();
    } finally {
      setUploading(false);
    }
  }

  async function resume(gameId: string) {
    setTab('story');
    await openGame(gameId);
    await refresh();
  }

  async function addSampleGame() {
    try {
      const res = await fetch(`${import.meta.env.BASE_URL}zork1.z3`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const bytes = new Uint8Array(await res.arrayBuffer());
      const record = await addOrTouchGame(bytes, 'Zork I.z3');
      await resume(record.gameId);
    } catch {
      await useDialogStore
        .getState()
        .ask({ kind: 'alert', title: 'Could not load the sample game' });
    }
  }

  async function onDelete(game: GameRecord) {
    const confirmed = await useDialogStore.getState().ask({
      kind: 'confirm',
      title: `Delete "${game.title}"?`,
      body: 'This removes its saves and map too.',
      confirmLabel: 'Delete',
      danger: true,
    });
    if (!confirmed) return;
    if (activeGameId === game.gameId) useEngineStore.getState().closeGame();
    await deleteGame(game.gameId);
    await refresh();
  }

  async function onRestart(game: GameRecord) {
    const confirmed = await useDialogStore.getState().ask({
      kind: 'confirm',
      title: `Restart "${game.title}"?`,
      body: 'This wipes the current autosave, map, and transcript. Named saves are kept.',
      confirmLabel: 'Restart',
      danger: true,
    });
    if (!confirmed) return;
    if (activeGameId === game.gameId) {
      await restartPlaythrough();
    } else {
      await restartPlaythroughInStorage(game.gameId);
      await openGame(game.gameId);
    }
    setTab('story');
    await refresh();
  }

  return (
    <div className="screen">
      <h1>Library</h1>
      <label className="tap-target upload-button">
        {uploading ? 'Uploading…' : 'Upload a story file'}
        <input
          type="file"
          accept={ACCEPTED_EXTENSIONS}
          disabled={uploading}
          style={{ display: 'none' }}
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = '';
            if (file) void onFileChosen(file);
          }}
        />
      </label>

      {games.length === 0 && (
        <div className="empty-state">
          <span className="empty-state-icon" aria-hidden="true">
            📚
          </span>
          <p>No games yet — upload a story file to get started.</p>
          <button
            type="button"
            className="tap-target btn-primary"
            onClick={() => void addSampleGame()}
          >
            Add sample game
          </button>
        </div>
      )}

      <ul className="game-list">
        {games.map((game) => (
          <li key={game.gameId} className="game-list-item">
            <div className="game-list-info">
              <strong>{game.title}</strong>
              <span className="game-list-meta">
                {game.format.toUpperCase()} · last played {formatDate(game.lastPlayedAt)}
              </span>
              {gameStats.has(game.gameId) && (
                <span className="game-list-meta">
                  {gameStats.get(game.gameId)!.rooms} rooms explored ·{' '}
                  {gameStats.get(game.gameId)!.turns} turns
                </span>
              )}
            </div>
            <div className="game-list-actions">
              <button
                type="button"
                className="tap-target btn-primary"
                onClick={() => void resume(game.gameId)}
              >
                {savedGameIds.has(game.gameId) ? 'Resume' : 'Play'}
              </button>
              <button type="button" className="tap-target" onClick={() => void onRestart(game)}>
                Restart
              </button>
              <button
                type="button"
                className="tap-target btn-danger"
                onClick={() => void onDelete(game)}
              >
                Delete
              </button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
