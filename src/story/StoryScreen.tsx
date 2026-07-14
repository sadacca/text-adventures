import { useEngineStore } from '../state/engineStore';
import { useUiStore } from '../state/uiStore';
import { CommandBar } from './CommandBar';
import { CompassRose } from './CompassRose';
import { VerbChips } from './VerbChips';
import { TapWords } from './TapWords';
import { DebugConsole } from '../debug/DebugConsole';

export function StoryScreen() {
  const gameId = useEngineStore((s) => s.gameId);
  const gameTitle = useEngineStore((s) => s.gameTitle);
  const loading = useEngineStore((s) => s.loading);
  const error = useEngineStore((s) => s.error);
  const transcript = useEngineStore((s) => s.transcript);
  const status = useEngineStore((s) => s.status);
  const debugConsoleEnabled = useUiStore((s) => s.debugConsoleEnabled);

  if (!gameId) {
    return (
      <div className="screen">
        <h1>Story</h1>
        <div className="empty-state">
          <span className="empty-state-icon" aria-hidden="true">
            📖
          </span>
          <p>No game loaded. Pick one from the Library tab.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="screen story-screen">
      <h1>{gameTitle}</h1>
      {error && (
        <p className="error-text" role="alert">
          {error}
        </p>
      )}
      {loading && <p className="loading-hint">Loading…</p>}
      {status && (
        <div className="status-line">
          <span>{status.left}</span>
          <span>{status.right}</span>
        </div>
      )}
      <div className="story-body">
        <TapWords text={transcript} />
        <CompassRose />
      </div>
      <VerbChips />
      <CommandBar />
      {debugConsoleEnabled && <DebugConsole />}
    </div>
  );
}
