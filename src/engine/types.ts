import type { RawMessage } from './protocol-tap.js';

/**
 * Events emitted by the protocol tap. All features consume ONLY these.
 *
 * `silent`: true on events produced by an engine-internal SAVE/RESTORE (the autosave
 * mechanism from Task 1.5) rather than something the player typed or tapped. Consumers
 * that build user-visible transcript/scrollback should skip these; consumers that just
 * track state (e.g. the automapper) can ignore the flag.
 */
export type GameEvent =
  | { kind: 'command'; text: string; turn: number } // player line input as sent
  | {
      kind: 'status_line';
      left: string;
      right: string;
      raw: string[][];
      turn: number;
      silent?: boolean;
    }
  // left: usually room name; right: usually score/moves or time.
  // raw: full grid-window rows (array of rows of strings) for games with custom status.
  | { kind: 'buffer_text'; text: string; turn: number; silent?: boolean } // main-window text since last input
  | { kind: 'input_requested'; type: 'line' | 'char'; turn: number; silent?: boolean }
  | { kind: 'quit'; turn: number };

/** turn: monotonically increasing counter, incremented on each 'command'. Starts at 0. */

export interface EngineHandle {
  start(story: Uint8Array, opts: { autorestore: boolean }): Promise<void>;
  sendCommand(text: string): void; // programmatic input (compass rose, travel)
  on(listener: (e: GameEvent) => void): () => void; // returns unsubscribe
  saveAutosave(): Promise<Uint8Array>; // opaque snapshot blob
  stop(): Promise<void>;

  // --- Added in Task 1.4 (protocol tap fixture recording — not in the original
  // SPECS.md draft, which didn't anticipate needing raw wire access from the UI) ---

  /** Every raw RemGlk/GlkOte wire message, tagged with direction, exactly as observed —
   *  what DebugConsole's "record fixture" toggle buffers and downloads as `.jsonl`
   *  (see `protocol-tap.ts`'s `RawMessage` and SPECS.md §6's fixture format). */
  onRaw(listener: (raw: RawMessage) => void): () => void;

  // --- Added in Task 1.5 (not part of the original SPECS.md draft) ---

  /** Preloads a previously-captured autosave snapshot so `start({autorestore: true})` has
   *  something to restore. Must be called before `start()`. */
  preloadAutosave(bytes: Uint8Array): void;
  /** Handles a player-typed SAVE/RESTORE (as opposed to our silent autosave): 'save' should
   *  resolve to a chosen name (or null to cancel); 'restore' should resolve to a chosen
   *  name plus its previously-saved bytes (or null to cancel). */
  onNamedSavePrompt(
    handler: (kind: 'save' | 'restore') => Promise<{ name: string; bytes?: Uint8Array } | null>,
  ): void;
  /** Fired once a player-typed named SAVE actually completes, with the Quetzal bytes. */
  onNamedSaveWritten(listener: (name: string, bytes: Uint8Array) => void): () => void;
}
