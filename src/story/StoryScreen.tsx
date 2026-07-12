import { useEffect, useRef, useState } from 'react';
import { createEngine } from '../engine/engine';
import type { GameEvent } from '../engine/types';

export function StoryScreen() {
  const engineRef = useRef(createEngine());
  const [loaded, setLoaded] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [status, setStatus] = useState<{ left: string; right: string } | null>(null);
  const [inputType, setInputType] = useState<'line' | 'char' | null>(null);
  const [draft, setDraft] = useState('');

  useEffect(() => {
    const engine = engineRef.current;
    return engine.on((event: GameEvent) => {
      if (event.kind === 'buffer_text') {
        setTranscript((prev) => prev + event.text);
      } else if (event.kind === 'status_line') {
        setStatus({ left: event.left, right: event.right });
      } else if (event.kind === 'input_requested') {
        setInputType(event.type);
      } else if (event.kind === 'quit') {
        setInputType(null);
      }
    });
  }, []);

  async function onFileChosen(file: File) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    setTranscript('');
    await engineRef.current.start(bytes, { autorestore: false });
    setLoaded(true);
  }

  function submit() {
    if (!draft.trim()) return;
    engineRef.current.sendCommand(draft);
    setDraft('');
  }

  return (
    <div className="screen story-screen">
      <h1>Story</h1>
      {!loaded && (
        <p>
          <label className="tap-target">
            Load a story file
            <input
              type="file"
              accept=".z1,.z2,.z3,.z4,.z5,.z6,.z7,.z8,.dat,.zblorb,.blb,.blorb,.gblorb"
              style={{ display: 'block' }}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void onFileChosen(file);
              }}
            />
          </label>
        </p>
      )}
      {loaded && (
        <>
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
        </>
      )}
    </div>
  );
}
