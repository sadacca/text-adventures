import { useEffect } from 'react';
import { useUiStore, type Tab } from './state/uiStore';
import { attachInstallListeners } from './state/installStore';
import { LibraryScreen } from './library/LibraryScreen';
import { StoryScreen } from './story/StoryScreen';
import { MapScreen } from './map/MapScreen';
import { MoreScreen } from './more/MoreScreen';
import { DialogHost } from './dialog/DialogHost';
import './App.css';

const TABS: { id: Tab; label: string; icon: string }[] = [
  { id: 'library', label: 'Library', icon: '📚' },
  { id: 'story', label: 'Story', icon: '📖' },
  { id: 'map', label: 'Map', icon: '🗺️' },
  { id: 'more', label: 'More', icon: '⋯' },
];

function App() {
  const tab = useUiStore((s) => s.tab);
  const setTab = useUiStore((s) => s.setTab);
  const theme = useUiStore((s) => s.theme);
  const fontScale = useUiStore((s) => s.fontScale);

  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'system') root.removeAttribute('data-theme');
    else root.setAttribute('data-theme', theme);

    const isDark =
      theme === 'dark' ||
      (theme === 'system' &&
        typeof window.matchMedia === 'function' &&
        window.matchMedia('(prefers-color-scheme: dark)').matches);
    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute('content', isDark ? '#14161a' : '#f5f5f7');
  }, [theme]);

  useEffect(() => {
    document.documentElement.style.fontSize = `${16 * fontScale}px`;
  }, [fontScale]);

  // Registered once at the top level: beforeinstallprompt can fire before any
  // particular tab is mounted, and Chrome only ever dispatches it once per load.
  useEffect(() => attachInstallListeners(), []);

  return (
    <div className="app-shell">
      <main className="app-content" aria-live="polite">
        {tab === 'library' && <LibraryScreen />}
        {tab === 'story' && <StoryScreen />}
        {tab === 'map' && <MapScreen />}
        {tab === 'more' && <MoreScreen />}
      </main>
      <nav className="tab-bar" aria-label="Main navigation">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            className={`tab-bar-button tap-target${tab === t.id ? ' active' : ''}`}
            aria-current={tab === t.id ? 'page' : undefined}
            onClick={() => setTab(t.id)}
          >
            <span className="tab-bar-icon" aria-hidden="true">
              {t.icon}
            </span>
            <span className="tab-bar-label">{t.label}</span>
          </button>
        ))}
      </nav>
      <DialogHost />
    </div>
  );
}

export default App;
