import { useEffect, useState } from 'react';
import { useUiStore } from '../state/uiStore';
import { useEngineStore } from '../state/engineStore';
import {
  addOrTouchGame,
  deleteGame,
  listGames,
  restartPlaythrough as restartPlaythroughInStorage,
  type GameRecord,
} from '../storage/games';

const ACCEPTED_EXTENSIONS = '.z1,.z2,.z3,.z4,.z5,.z6,.z7,.z8,.dat,.zblorb,.blb,.blorb,.gblorb';

function formatDate(ms: number): string {
  return new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export function LibraryScreen() {
  const [games, setGames] = useState<GameRecord[]>([]);
  const [uploading, setUploading] = useState(false);
  const setTab = useUiStore((s) => s.setTab);
  const openGame = useEngineStore((s) => s.openGame);
  const restartPlaythrough = useEngineStore((s) => s.restartPlaythrough);
  const activeGameId = useEngineStore((s) => s.gameId);

  async function refresh() {
    setGames(await listGames());
  }

  useEffect(() => {
    let cancelled = false;
    listGames().then((g) => {
      if (!cancelled) setGames(g);
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

  async function onDelete(game: GameRecord) {
    if (!window.confirm(`Delete "${game.title}"? This removes its saves and map too.`)) return;
    if (activeGameId === game.gameId) useEngineStore.getState().closeGame();
    await deleteGame(game.gameId);
    await refresh();
  }

  async function onRestart(game: GameRecord) {
    if (
      !window.confirm(
        `Restart "${game.title}"? This wipes the current autosave, map, and transcript. Named saves are kept.`,
      )
    )
      return;
    if (activeGameId === game.gameId) {
      await restartPlaythrough();
      setTab('story');
    } else {
      await restartPlaythroughInStorage(game.gameId);
    }
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

      {games.length === 0 && <p>No games yet — upload a story file to get started.</p>}

      <ul className="game-list">
        {games.map((game) => (
          <li key={game.gameId} className="game-list-item">
            <div className="game-list-info">
              <strong>{game.title}</strong>
              <span className="game-list-meta">
                {game.format.toUpperCase()} · last played {formatDate(game.lastPlayedAt)}
              </span>
            </div>
            <div className="game-list-actions">
              <button type="button" className="tap-target" onClick={() => void resume(game.gameId)}>
                Resume
              </button>
              <button type="button" className="tap-target" onClick={() => void onRestart(game)}>
                Restart
              </button>
              <button type="button" className="tap-target" onClick={() => void onDelete(game)}>
                Delete
              </button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
