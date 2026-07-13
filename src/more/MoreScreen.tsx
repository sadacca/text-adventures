import { useEngineStore } from '../state/engineStore';
import { useUiStore } from '../state/uiStore';
import { deleteSave, exportSave, importSave } from '../storage/saves';

function formatDate(ms: number): string {
  return new Date(ms).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export function MoreScreen() {
  const gameId = useEngineStore((s) => s.gameId);
  const gameTitle = useEngineStore((s) => s.gameTitle);
  const saves = useEngineStore((s) => s.saves);
  const sendCommand = useEngineStore((s) => s.sendCommand);
  const restoreNamed = useEngineStore((s) => s.restoreNamed);
  const refreshSaves = useEngineStore((s) => s.refreshSaves);
  const debugConsoleEnabled = useUiStore((s) => s.debugConsoleEnabled);
  const setDebugConsoleEnabled = useUiStore((s) => s.setDebugConsoleEnabled);

  const settingsSection = (
    <section>
      <h2>Settings</h2>
      <label className="settings-row">
        <span>Debug console (Story tab)</span>
        <input
          type="checkbox"
          checked={debugConsoleEnabled}
          onChange={(e) => setDebugConsoleEnabled(e.target.checked)}
        />
      </label>
    </section>
  );

  if (!gameId) {
    return (
      <div className="screen">
        <h1>More</h1>
        {settingsSection}
        <p>Open a game from the Library to see its saves.</p>
      </div>
    );
  }

  async function onDelete(name: string) {
    if (!window.confirm(`Delete save "${name}"?`)) return;
    await deleteSave(gameId!, name);
    await refreshSaves();
  }

  async function onImport(file: File) {
    await importSave(gameId!, file);
    await refreshSaves();
  }

  return (
    <div className="screen">
      <h1>More</h1>
      {settingsSection}

      <section>
        <h2>Saves — {gameTitle}</h2>
        <div className="game-list-actions" style={{ marginBottom: 12 }}>
          <button type="button" className="tap-target" onClick={() => sendCommand('save')}>
            Save now
          </button>
          <label className="tap-target" style={{ display: 'inline-flex', alignItems: 'center' }}>
            Import save
            <input
              type="file"
              style={{ display: 'none' }}
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = '';
                if (file) void onImport(file);
              }}
            />
          </label>
        </div>

        {saves.length === 0 && <p>No named saves yet.</p>}
        <ul className="game-list">
          {saves.map((save) => (
            <li key={save.name} className="game-list-item">
              <div className="game-list-info">
                <strong>{save.name}</strong>
                <span className="game-list-meta">
                  turn {save.turn} · {formatDate(save.savedAt)}
                </span>
              </div>
              <div className="game-list-actions">
                <button
                  type="button"
                  className="tap-target"
                  onClick={() => restoreNamed(save.name)}
                >
                  Restore
                </button>
                <button
                  type="button"
                  className="tap-target"
                  onClick={() => void exportSave(gameId, save.name, gameTitle)}
                >
                  Export
                </button>
                <button
                  type="button"
                  className="tap-target"
                  onClick={() => void onDelete(save.name)}
                >
                  Delete
                </button>
              </div>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
