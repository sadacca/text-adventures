import { useEngineStore } from '../state/engineStore';
import { useUiStore, type UiState } from '../state/uiStore';
import { useDialogStore } from '../state/dialogStore';
import { useInstallStore } from '../state/installStore';
import { deleteSave, exportSave, importSave } from '../storage/saves';
import { AboutSection } from './AboutSection';

const THEME_OPTIONS: { value: UiState['theme']; label: string }[] = [
  { value: 'system', label: 'System' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
  { value: 'retro', label: 'Retro' },
];

const STORY_FONT_OPTIONS: { value: UiState['storyFont']; label: string }[] = [
  { value: 'system', label: 'System' },
  { value: 'serif', label: 'Serif' },
  { value: 'mono', label: 'Mono' },
];

const FONT_SCALE_MIN = 0.85;
const FONT_SCALE_MAX = 1.4;
const FONT_SCALE_STEP = 0.1;

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
  const theme = useUiStore((s) => s.theme);
  const setTheme = useUiStore((s) => s.setTheme);
  const fontScale = useUiStore((s) => s.fontScale);
  const setFontScale = useUiStore((s) => s.setFontScale);
  const storyFont = useUiStore((s) => s.storyFont);
  const setStoryFont = useUiStore((s) => s.setStoryFont);
  const highlightVocab = useUiStore((s) => s.highlightVocab);
  const setHighlightVocab = useUiStore((s) => s.setHighlightVocab);
  const installPromptEvent = useInstallStore((s) => s.promptEvent);
  const installed = useInstallStore((s) => s.installed);
  const markInstalled = useInstallStore((s) => s.markInstalled);
  const clearInstallPrompt = useInstallStore((s) => s.setPromptEvent);

  function nudgeFontScale(delta: number) {
    const next = Math.round((fontScale + delta) * 100) / 100;
    setFontScale(Math.min(FONT_SCALE_MAX, Math.max(FONT_SCALE_MIN, next)));
  }

  async function onInstall() {
    if (!installPromptEvent) return;
    await installPromptEvent.prompt();
    const choice = await installPromptEvent.userChoice;
    // Chrome invalidates the event after one use either way — accepted or dismissed.
    if (choice.outcome === 'accepted') markInstalled();
    else clearInstallPrompt(null);
  }

  const settingsSection = (
    <section>
      <h2>Settings</h2>
      <div className="settings-card">
        {installPromptEvent && !installed && (
          <div className="settings-row">
            <span className="settings-row-label">
              Install app
              <span className="settings-row-hint">Add to your home screen, works offline</span>
            </span>
            <button
              type="button"
              className="tap-target btn-primary"
              onClick={() => void onInstall()}
            >
              Install
            </button>
          </div>
        )}
        {installed && (
          <div className="settings-row">
            <span className="settings-row-label">
              Install app
              <span className="settings-row-hint">Already installed on this device</span>
            </span>
          </div>
        )}
        <div className="settings-row">
          <span className="settings-row-label">Theme</span>
          <div className="segmented" role="group" aria-label="Theme">
            {THEME_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                type="button"
                className={theme === opt.value ? 'active' : ''}
                aria-pressed={theme === opt.value}
                onClick={() => setTheme(opt.value)}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>
        <div className="settings-row">
          <span className="settings-row-label">Story font</span>
          <div className="segmented" role="group" aria-label="Story font">
            {STORY_FONT_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                type="button"
                className={storyFont === opt.value ? 'active' : ''}
                aria-pressed={storyFont === opt.value}
                onClick={() => setStoryFont(opt.value)}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>
        <div className="settings-row">
          <span className="settings-row-label">Text size</span>
          <div className="stepper">
            <button
              type="button"
              className="tap-target"
              aria-label="Decrease text size"
              disabled={fontScale <= FONT_SCALE_MIN}
              onClick={() => nudgeFontScale(-FONT_SCALE_STEP)}
            >
              A−
            </button>
            <span className="stepper-value">{Math.round(fontScale * 100)}%</span>
            <button
              type="button"
              className="tap-target"
              aria-label="Increase text size"
              disabled={fontScale >= FONT_SCALE_MAX}
              onClick={() => nudgeFontScale(FONT_SCALE_STEP)}
            >
              A+
            </button>
          </div>
        </div>
        <label className="settings-row">
          <span className="settings-row-label">
            Highlight known words
            <span className="settings-row-hint">Bold the words this game understands</span>
          </span>
          <input
            type="checkbox"
            checked={highlightVocab}
            onChange={(e) => setHighlightVocab(e.target.checked)}
          />
        </label>
        <label className="settings-row">
          <span className="settings-row-label">
            Debug console
            <span className="settings-row-hint">Live event stream on the Story tab</span>
          </span>
          <input
            type="checkbox"
            checked={debugConsoleEnabled}
            onChange={(e) => setDebugConsoleEnabled(e.target.checked)}
          />
        </label>
      </div>
    </section>
  );

  if (!gameId) {
    return (
      <div className="screen">
        <h1>More</h1>
        {settingsSection}
        <h2>Saves</h2>
        <div className="empty-state empty-state-inline">
          <span className="empty-state-icon" aria-hidden="true">
            💾
          </span>
          <p>Open a game from the Library to see its saves.</p>
        </div>
        <AboutSection />
      </div>
    );
  }

  async function onDelete(name: string) {
    const confirmed = await useDialogStore.getState().ask({
      kind: 'confirm',
      title: `Delete save "${name}"?`,
      confirmLabel: 'Delete',
      danger: true,
    });
    if (!confirmed) return;
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
          <button
            type="button"
            className="tap-target btn-primary"
            onClick={() => sendCommand('save')}
          >
            Save now
          </button>
          <label className="tap-target file-label-button">
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

        {saves.length === 0 && (
          <div className="empty-state empty-state-inline">
            <span className="empty-state-icon" aria-hidden="true">
              💾
            </span>
            <p>No named saves yet.</p>
          </div>
        )}
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
                  className="tap-target btn-danger"
                  onClick={() => void onDelete(save.name)}
                >
                  Delete
                </button>
              </div>
            </li>
          ))}
        </ul>
      </section>

      <AboutSection />
    </div>
  );
}
