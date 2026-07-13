import { useState } from 'react';
import { useEngineStore } from '../state/engineStore';

export function StoryScreen() {
  const gameId = useEngineStore((s) => s.gameId);
  const gameTitle = useEngineStore((s) => s.gameTitle);
  const loading = useEngineStore((s) => s.loading);
  const error = useEngineStore((s) => s.error);
  const transcript = useEngineStore((s) => s.transcript);
  const status = useEngineStore((s) => s.status);
  const inputType = useEngineStore((s) => s.inputType);
  const sendCommand = useEngineStore((s) => s.sendCommand);
  const [draft, setDraft] = useState('');

  if (!gameId) {
    return (
      <div className="screen">
        <h1>Story</h1>
        <p>No game loaded. Pick one from the Library tab.</p>
      </div>
    );
  }

  function submit() {
    if (!draft.trim() || inputType !== 'line') return;
    sendCommand(draft);
    setDraft('');
  }

  return (
    <div className="screen story-screen">
      <h1>{gameTitle}</h1>
      {error && <p role="alert">{error}</p>}
      {loading && <p>Loading…</p>}
      {status && (
        <div className="status-line">
          <span>{status.left}</span>
          <span>{status.right}</span>
        </div>
      )}
      <pre className="story-transcript">{transcript}</pre>
      <form
        className="command-form"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <input
          type="text"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          enterKeyHint="send"
          disabled={inputType !== 'line'}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={inputType === 'line' ? 'Enter a command…' : 'Waiting…'}
        />
        <button type="submit" className="tap-target" disabled={inputType !== 'line'}>
          Send
        </button>
      </form>
    </div>
  );
}
