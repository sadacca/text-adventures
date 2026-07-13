import { GlkOteBase } from '../upstream/asyncglk-dist/index-common.js';
import type { protocol } from '../upstream/asyncglk-dist/index-common.js';
import { ProtocolTap, type RawMessage } from './protocol-tap.js';
import type { GameEvent } from './types.js';

/**
 * Subclasses asyncglk's GlkOteBase (plain TS, no jQuery/Svelte) to drive our own React
 * UI instead of AsyncGlk's own DOM renderer. This is the live-engine wiring for the
 * "protocol tap" (Task 1.4): all RemGlk-JSON-to-GameEvent parsing lives in the pure,
 * fixture-testable `ProtocolTap`; this class's job is just plumbing — handing every
 * incoming `update()` and outgoing `send_event()` call to the tap unmodified, and
 * picking which window id to address for programmatic input (compass rose, travel).
 */
export class BridgeGlkOte extends GlkOteBase {
  private readonly tap: ProtocolTap;

  constructor(emit: (event: GameEvent) => void, onRaw?: (raw: RawMessage) => void) {
    super();
    this.tap = new ProtocolTap(emit, onRaw);
  }

  getTurn(): number {
    return this.tap.getTurn();
  }

  /** Send a line-input command to the VM; this is what advances the turn counter. */
  sendCommand(text: string): void {
    this.dispatchLine(text, false);
  }

  /**
   * Send a line-input command that does NOT advance the turn counter and is not
   * reported as a 'command' event — used for the engine's own background SAVE/RESTORE
   * (Task 1.5's autosave substitute). Its resulting buffer_text/status_line/
   * input_requested events are still emitted (so callers like `saveAutosave()` can see
   * them complete) but tagged `silent: true` so UI transcripts can skip them.
   */
  sendSilentCommand(text: string): void {
    this.dispatchLine(text, true);
  }

  private dispatchLine(text: string, silent: boolean): void {
    const window = this.tap.getInputWindowId() ?? this.tap.getBufferWindowId() ?? 0;
    const event = { type: 'line', value: text, window } as protocol.Event;
    this.tap.handleEvent(event, { silent });
    this.send_event(event);
  }

  /** Send a single-character response (e.g. a "hit any key" prompt); does not advance turn. */
  sendChar(value: string): void {
    const window = this.tap.getInputWindowId() ?? this.tap.getBufferWindowId() ?? 0;
    const event = { type: 'char', value, window } as protocol.Event;
    this.tap.handleEvent(event);
    this.send_event(event);
  }

  update(data: protocol.Update): void {
    this.tap.handleUpdate(data);
    super.update(data);
  }

  protected update_windows(_windows: protocol.WindowUpdate[]): void {
    // Parsed by ProtocolTap directly from the raw update in `update()` above.
  }

  protected update_content(_content: protocol.ContentUpdate[]): void {
    // Parsed by ProtocolTap directly from the raw update in `update()` above.
  }

  protected update_inputs(_windows: protocol.InputUpdate[]): void {
    // Parsed by ProtocolTap directly from the raw update in `update()` above.
  }

  protected cancel_inputs(_windows: protocol.InputUpdate[]): void {
    // No UI-side input widgets to cancel; the React layer reads input state via events.
  }

  protected disable(_disable: boolean): void {
    // Handled via input_requested/quit events; no DOM to enable/disable.
  }

  protected exit(): void {
    // ProtocolTap already emits 'quit' from `update()`'s `data.disable` branch, which is
    // exactly when GlkOteBase calls exit() — nothing further to do here.
  }
}
