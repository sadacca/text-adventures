import { useEffect, useRef, useState } from 'react';
import { useEngineStore } from '../state/engineStore';
import { useUiStore } from '../state/uiStore';
import { CommandBar } from './CommandBar';
import { CompassRose } from './CompassRose';
import { VerbChips } from './VerbChips';
import { TapWords } from './TapWords';
import { DebugConsole } from '../debug/DebugConsole';

/** Player is considered "pinned" to the bottom within this many px of scrollHeight. */
const PIN_THRESHOLD = 100;

export function StoryScreen() {
  const gameId = useEngineStore((s) => s.gameId);
  const loading = useEngineStore((s) => s.loading);
  const error = useEngineStore((s) => s.error);
  const transcript = useEngineStore((s) => s.transcript);
  const status = useEngineStore((s) => s.status);
  const pinRequestId = useEngineStore((s) => s.pinRequestId);
  const debugConsoleEnabled = useUiStore((s) => s.debugConsoleEnabled);

  const scrollRef = useRef<HTMLDivElement>(null);
  const pinnedRef = useRef(true);
  const [newBelow, setNewBelow] = useState(false);

  // Smart scroll pinning: only auto-scroll to the newest text when the player was
  // already at (or near) the bottom. Otherwise they're reading back, so surface a pill
  // instead of yanking the view down out from under them.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (pinnedRef.current) {
      el.scrollTop = el.scrollHeight;
    } else {
      setNewBelow(true);
    }
  }, [transcript]);

  // Sending a command is an explicit request to see its response — re-pin to the
  // bottom even if the player had scrolled up to read back, so the reply to what they
  // just typed/tapped is never hidden behind the "new text" pill. Only the DOM scroll
  // position is touched here (not React state): forcing scrollTop to scrollHeight fires
  // a native scroll event, and the existing onScroll handler clears `newBelow` once it
  // sees we're back at the bottom.
  useEffect(() => {
    if (pinRequestId === 0) return;
    pinnedRef.current = true;
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [pinRequestId]);

  function handleScroll() {
    const el = scrollRef.current;
    if (!el) return;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < PIN_THRESHOLD;
    pinnedRef.current = nearBottom;
    if (nearBottom) setNewBelow(false);
  }

  function scrollToBottom() {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
    pinnedRef.current = true;
    setNewBelow(false);
  }

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
        <div className="story-transcript" ref={scrollRef} onScroll={handleScroll}>
          {transcript.map((chunk, i) => (
            <TapWords key={i} text={chunk} />
          ))}
        </div>
        {newBelow && (
          <button type="button" className="new-text-pill tap-target" onClick={scrollToBottom}>
            ↓ New text
          </button>
        )}
        <CompassRose />
      </div>
      <VerbChips />
      <CommandBar />
      {debugConsoleEnabled && <DebugConsole />}
    </div>
  );
}
