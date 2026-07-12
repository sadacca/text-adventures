import { GlkOteBase } from '../upstream/asyncglk-dist/index-common.js';
import type { protocol } from '../upstream/asyncglk-dist/index-common.js';
import type { GameEvent } from './types.js';

type WindowKind = 'buffer' | 'graphics' | 'grid';

function run_text(content: protocol.LineData[] | undefined): string {
  if (!content) return '';
  return content
    .map((run) => (typeof run === 'string' ? run : 'text' in run ? run.text : ''))
    .join('');
}

/**
 * Subclasses asyncglk's GlkOteBase (plain TS, no jQuery/Svelte) to drive our own React
 * UI instead of AsyncGlk's own DOM renderer. Translates RemGlk protocol updates into the
 * typed GameEvent stream from `types.ts` and owns the turn counter (increments on every
 * command actually sent to the VM). This doubles as the "protocol tap" for now; Task 1.4
 * hardens/extracts it with fixtures and dedicated tests.
 */
export class BridgeGlkOte extends GlkOteBase {
  private windowKinds = new Map<number, WindowKind>();
  private bufferWindowId: number | null = null;
  private inputWindowId: number | null = null;
  private inputType: 'line' | 'char' | null = null;
  private gridRows = new Map<number, Map<number, string>>();
  private turn = 0;
  private readonly emit: (event: GameEvent) => void;

  constructor(emit: (event: GameEvent) => void) {
    super();
    this.emit = emit;
  }

  getTurn(): number {
    return this.turn;
  }

  /** Send a line-input command to the VM; this is what advances the turn counter. */
  sendCommand(text: string): void {
    this.turn += 1;
    this.emit({ kind: 'command', text, turn: this.turn });
    const window = this.inputWindowId ?? this.bufferWindowId ?? 0;
    this.send_event({ type: 'line', value: text, window });
  }

  /** Send a single-character response (e.g. a "hit any key" prompt); does not advance turn. */
  sendChar(value: string): void {
    const window = this.inputWindowId ?? this.bufferWindowId ?? 0;
    this.send_event({ type: 'char', value, window });
  }

  protected update_windows(windows: protocol.WindowUpdate[]): void {
    for (const win of windows) {
      this.windowKinds.set(win.id, win.type);
      if (win.type === 'buffer' && this.bufferWindowId === null) {
        this.bufferWindowId = win.id;
      }
    }
  }

  protected update_content(content: protocol.ContentUpdate[]): void {
    for (const update of content) {
      const kind = this.windowKinds.get(update.id);
      if (kind === 'grid' && 'lines' in update) {
        this.apply_grid_update(update);
      } else if (kind === 'buffer' && 'text' in update && update.text) {
        const text = update.text.map((para) => run_text(para.content)).join('\n');
        if (text) this.emit({ kind: 'buffer_text', text, turn: this.turn });
      }
    }
  }

  private apply_grid_update(update: protocol.GridWindowContentUpdate): void {
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
    // separated by a run of spaces. Fixture-based hardening is Task 1.4's job.
    const split = first.match(/^(.*?\S)? {2,}(\S.*)?$/);
    const left = (split?.[1] ?? first).trim();
    const right = (split?.[2] ?? '').trim();
    this.emit({ kind: 'status_line', left, right, raw, turn: this.turn });
  }

  protected update_inputs(windows: protocol.InputUpdate[]): void {
    const active = windows.find((w) => w.type === 'line' || w.type === 'char');
    if (!active) {
      this.inputWindowId = null;
      this.inputType = null;
      return;
    }
    this.inputWindowId = active.id;
    this.inputType = active.type as 'line' | 'char';
    this.emit({ kind: 'input_requested', type: this.inputType, turn: this.turn });
  }

  protected cancel_inputs(_windows: protocol.InputUpdate[]): void {
    // No UI-side input widgets to cancel; the React layer reads `inputType` via events.
  }

  protected disable(_disable: boolean): void {
    // Handled via input_requested/quit events; no DOM to enable/disable.
  }

  protected exit(): void {
    this.emit({ kind: 'quit', turn: this.turn });
  }
}
