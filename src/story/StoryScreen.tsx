import { useEffect, useRef, useState } from 'react';
import { useEngineStore } from '../state/engineStore';
import { useUiStore } from '../state/uiStore';
import { CommandBar } from './CommandBar';
import { CompassRose } from './CompassRose';
import { ExitsRow } from './ExitsRow';
import { VerbChips } from './VerbChips';
import { TapWords } from './TapWords';
import { DebugConsole } from '../debug/DebugConsole';
import { haptic } from '../haptics';

/** UX-11: how long the score toast stays up before it auto-dismisses. Must stay in sync
 *  with .score-toast's CSS exit-animation delay (App.css) — see the comment there. */
const SCORE_TOAST_MS = 2500;

/** Player is considered "pinned" to the bottom within this many px of scrollHeight. */
const PIN_THRESHOLD = 100;

export function StoryScreen() {
  const gameId = useEngineStore((s) => s.gameId);
  const loading = useEngineStore((s) => s.loading);
  const error = useEngineStore((s) => s.error);
  const transcript = useEngineStore((s) => s.transcript);
  const status = useEngineStore((s) => s.status);
  const pinRequestId = useEngineStore((s) => s.pinRequestId);
  const scoreDelta = useEngineStore((s) => s.scoreDelta);
  const debugConsoleEnabled = useUiStore((s) => s.debugConsoleEnabled);
  const hasSeenTapHint = useUiStore((s) => s.hasSeenTapHint);
  const dismissTapHint = useUiStore((s) => s.dismissTapHint);

  const scrollRef = useRef<HTMLDivElement>(null);
  const pinnedRef = useRef(true);
  const [newBelow, setNewBelow] = useState(false);

  // UX-11: toast a score increase, then auto-dismiss. Keyed on the whole scoreDelta
  // object, so a new delta (even an equal amount) cancels any pending dismiss and
  // restarts the timer/haptic instead of being swallowed by the old one. A more
  // deliberately "reward"-shaped haptic pattern (longer, three pulses) than the 10ms
  // tap-acknowledgment buzz used everywhere else in the app — user testing found the
  // original [20, 40, 20] pattern felt indistinguishable from an ordinary tap. The
  // entrance/exit fade is pure CSS (.score-toast's animation, App.css) rather than a
  // second timer/state flag here, so its exit-animation delay must stay in sync with
  // SCORE_TOAST_MS — see the comment alongside that rule.
  useEffect(() => {
    if (!scoreDelta) return;
    haptic([30, 40, 30, 40, 60]);
    const timer = setTimeout(() => {
      useEngineStore.setState({ scoreDelta: null });
    }, SCORE_TOAST_MS);
    return () => clearTimeout(timer);
  }, [scoreDelta]);

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
      {!hasSeenTapHint && (
        <div className="tap-hint-banner">
          <span>Tap a word to add it to your command · hold a word to examine it</span>
          <button type="button" className="tap-target" onClick={dismissTapHint}>
            Got it
          </button>
        </div>
      )}
      <ExitsRow />
      <div className="story-body">
        <div className="story-transcript" ref={scrollRef} onScroll={handleScroll}>
          {transcript.map((chunk, i) => (
            <TapWords key={i} text={chunk} />
          ))}
        </div>
        {scoreDelta && (
          <div key={scoreDelta.id} className="score-toast" aria-live="polite">
            <span aria-hidden="true">★</span> +{scoreDelta.amount}
          </div>
        )}
        {newBelow && (
          <button type="button" className="new-text-pill tap-target" onClick={scrollToBottom}>
            ↓ New text
          </button>
        )}
      </div>
      <CompassRose />
      <VerbChips />
      <CommandBar />
      {debugConsoleEnabled && <DebugConsole />}
    </div>
  );
}
