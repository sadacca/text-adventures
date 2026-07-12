/** Events emitted by the protocol tap. All features consume ONLY these. */
export type GameEvent =
  | { kind: 'command'; text: string; turn: number } // player line input as sent
  | { kind: 'status_line'; left: string; right: string; raw: string[][]; turn: number }
  // left: usually room name; right: usually score/moves or time.
  // raw: full grid-window rows (array of rows of strings) for games with custom status.
  | { kind: 'buffer_text'; text: string; turn: number } // main-window text since last input
  | { kind: 'input_requested'; type: 'line' | 'char'; turn: number }
  | { kind: 'quit'; turn: number };

/** turn: monotonically increasing counter, incremented on each 'command'. Starts at 0. */

export interface EngineHandle {
  start(story: Uint8Array, opts: { autorestore: boolean }): Promise<void>;
  sendCommand(text: string): void; // programmatic input (compass rose, travel)
  on(listener: (e: GameEvent) => void): () => void; // returns unsubscribe
  saveAutosave(): Promise<Uint8Array>; // opaque snapshot blob
  stop(): Promise<void>;
}
