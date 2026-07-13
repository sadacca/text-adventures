import type { protocol } from '../upstream/asyncglk-dist/index-common.js';
import type { GameEvent } from './types.js';

type WindowKind = 'buffer' | 'graphics' | 'grid';

/**
 * One captured RemGlk/GlkOte wire message, tagged with direction:
 * `'out'` = interpreter -> UI (a `protocol.Update`), `'in'` = UI -> interpreter (a
 * `protocol.Event`). This is exactly the fixture line shape from SPECS.md §6 (JSON
 * Lines, one message per line): `{"dir":"out"|"in","msg":{...}}`.
 */
export interface RawMessage {
  dir: 'out' | 'in';
  msg: protocol.Update | protocol.Event;
}

function run_text(content: protocol.LineData[] | undefined): string {
  if (!content) return '';
  return content
    .map((run) => (typeof run === 'string' ? run : 'text' in run ? run.text : ''))
    .join('');
}

/**
 * Task 1.4: the protocol tap. Observes every RemGlk JSON message flowing in both
 * directions (without modifying any of it — callers still forward the same objects on
 * to GlkOte/the interpreter) and emits the typed `GameEvent` stream that every feature
 * (automapper, transcript, debug console) consumes.
 *
 * Pure and engine-agnostic: no GlkOteBase, no WASM, no DOM. `glkote-bridge.ts` wires
 * this into a live interpreter session; fixture-based tests (`tests/protocol-tap.test.ts`)
 * drive it directly from recorded JSON Lines files with no interpreter involved.
 *
 * Turn/silent bookkeeping lives here (not in the caller) because both are properties of
 * the message stream itself: `turn` increments on every non-silent `line` event sent to
 * the VM, and `silent` (Task 1.5's background-autosave concept — never present in the
 * wire JSON; supplied by the caller alongside the outgoing event) taints every event
 * emitted until the next `line` event arrives.
 */
export class ProtocolTap {
  private windowKinds = new Map<number, WindowKind>();
  private bufferWindowId: number | null = null;
  private inputWindowId: number | null = null;
  private inputType: 'line' | 'char' | null = null;
  private gridRows = new Map<number, Map<number, string>>();
  private turn = 0;
  private silent = false;
  private readonly emit: (event: GameEvent) => void;
  private readonly onRaw?: (raw: RawMessage) => void;

  constructor(emit: (event: GameEvent) => void, onRaw?: (raw: RawMessage) => void) {
    this.emit = emit;
    this.onRaw = onRaw;
  }

  getTurn(): number {
    return this.turn;
  }

  getBufferWindowId(): number | null {
    return this.bufferWindowId;
  }

  getInputWindowId(): number | null {
    return this.inputWindowId;
  }

  getInputType(): 'line' | 'char' | null {
    return this.inputType;
  }

  /**
   * Call with every outgoing (UI -> interpreter) event, just before it's actually sent.
   * `silent` marks the engine's own background SAVE/RESTORE (Task 1.5) rather than
   * something the player typed or tapped; only meaningful for `line` events.
   */
  handleEvent(ev: protocol.Event, opts: { silent?: boolean } = {}): void {
    this.onRaw?.({ dir: 'in', msg: ev });
    if (ev.type === 'line') {
      this.silent = opts.silent ?? false;
      if (!this.silent) {
        this.turn += 1;
        this.emit({ kind: 'command', text: ev.value, turn: this.turn });
      }
    }
  }

  /** Call with every incoming (interpreter -> UI) update, unmodified. */
  handleUpdate(data: protocol.Update): void {
    this.onRaw?.({ dir: 'out', msg: data });
    if (data.type !== 'update') return; // error/pass/retry: no GameEvent, caller still acts on them
    if (data.windows) this.updateWindows(data.windows);
    if (data.content) this.updateContent(data.content);
    if (data.input) this.updateInputs(data.input);
    if (data.disable) this.emit({ kind: 'quit', turn: this.turn });
  }

  private updateWindows(windows: protocol.WindowUpdate[]): void {
    for (const win of windows) {
      this.windowKinds.set(win.id, win.type);
      if (win.type === 'buffer' && this.bufferWindowId === null) {
        this.bufferWindowId = win.id;
      }
    }
  }

  private updateContent(content: protocol.ContentUpdate[]): void {
    for (const update of content) {
      const kind = this.windowKinds.get(update.id);
      if (kind === 'grid' && 'lines' in update) {
        this.applyGridUpdate(update);
      } else if (kind === 'buffer' && 'text' in update && update.text) {
        const text = update.text.map((para) => run_text(para.content)).join('\n');
        if (text) this.emit({ kind: 'buffer_text', text, turn: this.turn, silent: this.silent });
      }
    }
  }

  private applyGridUpdate(update: protocol.GridWindowContentUpdate): void {
    let rows = this.gridRows.get(update.id);
    if (!rows || update.clear) {
      rows = new Map();
      this.gridRows.set(update.id, rows);
    }
    for (const line of update.lines) {
      rows.set(line.line, run_text(line.content));
    }
    const raw = [...rows.entries()].sort(([a], [b]) => a - b).map(([, text]) => [text]);
    const first = raw[0]?.[0] ?? '';
    // Classic Infocom status line: room name left-aligned, score/moves right-aligned,
    // separated by a run of spaces.
    const split = first.match(/^(.*?\S)? {2,}(\S.*)?$/);
    const left = (split?.[1] ?? first).trim();
    const right = (split?.[2] ?? '').trim();
    this.emit({ kind: 'status_line', left, right, raw, turn: this.turn, silent: this.silent });
  }

  private updateInputs(windows: protocol.InputUpdate[]): void {
    const active = windows.find((w) => w.type === 'line' || w.type === 'char');
    if (!active) {
      this.inputWindowId = null;
      this.inputType = null;
      return;
    }
    this.inputWindowId = active.id;
    this.inputType = active.type as 'line' | 'char';
    this.emit({
      kind: 'input_requested',
      type: this.inputType,
      turn: this.turn,
      silent: this.silent,
    });
    // `silent` is not reset here: a listener reacting to this very event may
    // synchronously send a silent command of its own (e.g. an autosave-after-every-turn
    // hook), which must not have it clobbered by this call still unwinding.
    // `handleEvent` clears/sets it instead, since every `line` event determines silence
    // for everything emitted until the next one.
  }
}

/** Parses one fixture line (`{"dir":"out"|"in","msg":{...}}`), per SPECS.md §6. */
export function parseFixtureLine(line: string): RawMessage {
  return JSON.parse(line) as RawMessage;
}

/**
 * Replays a captured fixture (JSON Lines text, one RawMessage per line — blank lines
 * ignored) through a fresh ProtocolTap and returns the resulting GameEvent sequence.
 * No interpreter/WASM involved — this is what makes protocol-tap parsing testable in CI.
 */
export function replayFixture(jsonl: string): GameEvent[] {
  const events: GameEvent[] = [];
  const tap = new ProtocolTap((event) => events.push(event));
  for (const line of jsonl.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const raw = parseFixtureLine(trimmed);
    if (raw.dir === 'in') tap.handleEvent(raw.msg as protocol.Event);
    else tap.handleUpdate(raw.msg as protocol.Update);
  }
  return events;
}
