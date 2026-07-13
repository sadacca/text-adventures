import { useEngineStore } from '../state/engineStore';
import type { GameEvent } from '../engine/types';

function summarize(event: GameEvent): string {
  const silent = 'silent' in event && event.silent ? ' [silent]' : '';
  switch (event.kind) {
    case 'command':
      return `> ${event.text}${silent}`;
    case 'status_line':
      return `status: "${event.left}" | "${event.right}"${silent}`;
    case 'buffer_text':
      return `text: ${JSON.stringify(event.text.slice(0, 140))}${silent}`;
    case 'input_requested':
      return `input_requested (${event.type})${silent}`;
    case 'quit':
      return 'quit';
  }
}

function downloadFixture(jsonl: string): void {
  const blob = new Blob([jsonl], { type: 'application/jsonl' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `fixture-${Date.now()}.jsonl`;
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * Task 1.4 acceptance: "a debug console pane shows the live event stream." Hidden
 * behind a settings toggle (see MoreScreen); mounted by StoryScreen only while a game
 * is open, since the event stream only makes sense tied to an active session.
 *
 * Also hosts the "record fixture" control (SPECS.md §6): while recording, every raw
 * RemGlk message observed by the protocol tap is buffered (see engineStore's
 * `recordingFixture`/`onRaw` wiring); stopping downloads the buffer as `.jsonl`, ready
 * to commit under `tests/fixtures/`.
 */
export function DebugConsole() {
  const debugEvents = useEngineStore((s) => s.debugEvents);
  const recordingFixture = useEngineStore((s) => s.recordingFixture);
  const startRecordingFixture = useEngineStore((s) => s.startRecordingFixture);
  const stopRecordingFixture = useEngineStore((s) => s.stopRecordingFixture);

  return (
    <div className="debug-console">
      <div className="debug-console-toolbar">
        <strong>Debug console</strong>
        <button
          type="button"
          className="tap-target"
          onClick={() => {
            if (recordingFixture) downloadFixture(stopRecordingFixture());
            else startRecordingFixture();
          }}
        >
          {recordingFixture ? '■ Stop & download fixture' : '● Record fixture'}
        </button>
      </div>
      <ol className="debug-console-log">
        {debugEvents.map((event, i) => (
          <li key={i}>
            <span className="debug-console-turn">[{event.turn}]</span> {summarize(event)}
          </li>
        ))}
      </ol>
    </div>
  );
}
