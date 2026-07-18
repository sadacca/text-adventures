import type { GameEvent } from '../engine/types.js';
import { UNKNOWN_ROOM_ID, type Direction, type MapGraph } from './graph.js';

/**
 * Prospective mapping (2026-07-17): with the setting on, after the player's turn
 * settles the app quietly probes each still-unexplored compass direction from the
 * current room — send the move, let the automapper record what happens (a confirmed
 * edge + the destination room on success, a blockedDirections entry on failure), then
 * rewind the world to a snapshot taken before the probing began. Net effect: the map
 * and compass fill in every openable direction of a room the moment it's first
 * visited, without the player spending real moves.
 *
 * REWIND MECHANISM (revised 2026-07-18): one silent `engine.saveAutosave()` snapshot
 * per room, then `engine.restoreSnapshot(bytes)` after each successful probe move —
 * the same interpreter-driven SAVE/RESTORE round-trip the per-turn autosave and boot
 * auto-resume already use. The original implementation rewound with Bocfel's
 * interpreter-level `/undo` meta-command, which corrupts the emglken/asyncify WASM
 * interpreter after roughly twenty uses — the VM permanently stops answering input,
 * which surfaced as "the interface froze after ~80 turns". SAVE/RESTORE has no such
 * limit (hammer-tested for hundreds of cycles).
 *
 * The restore's response cycle is SILENT, so the automapper never sees it — the
 * `onRewound` callback re-aligns it to the origin room after each rewind.
 */

/** Probe order: cheap horizontal sweep first, verticals last. `in`/`out` are
 *  deliberately excluded — they're context commands more than directions ("out" of a
 *  vehicle, "in" with nothing to enter often just asks "enter what?"), so probing them
 *  yields noise, and the compass emphasizes them only via real traversals. */
export const PROBE_DIRECTIONS: Direction[] = [
  'n',
  'e',
  's',
  'w',
  'ne',
  'se',
  'sw',
  'nw',
  'up',
  'down',
];

/** Belt-and-braces: if the interpreter ever stops responding mid-burst, the burst
 *  aborts and releases the UI instead of holding `probing`/`traveling` forever. */
export const PROBE_STEP_TIMEOUT_MS = 15_000;

/** The engine surface probing needs — satisfied structurally by EngineHandle. */
export interface ProspectEngine {
  sendCommand(text: string): void;
  on(listener: (event: GameEvent) => void): () => void;
  saveAutosave(): Promise<Uint8Array>;
  restoreSnapshot?(bytes: Uint8Array): Promise<void>;
}

export type ProspectResult = 'completed' | 'aborted' | 'skipped';

/**
 * Directions from `roomId` that probing would still teach us something about: no edge
 * ever recorded there (live OR tombstoned — a user deletion is a "leave this alone"),
 * and not already known to be blocked. Because a failed probe records the blockage and
 * a successful one records the edge, each room converges after a single probing pass
 * and later visits are free.
 */
export function unexploredDirections(graph: MapGraph, roomId: string): Direction[] {
  const room = graph.rooms[roomId];
  if (!room || roomId === UNKNOWN_ROOM_ID) return [];
  const taken = new Set<string>();
  for (const edge of graph.edges) {
    if (edge.from === roomId) taken.add(edge.dir);
  }
  const blocked = new Set(room.blockedDirections ?? []);
  return PROBE_DIRECTIONS.filter((dir) => !taken.has(dir) && !blocked.has(dir));
}

/**
 * Runs the probe loop from the current room. Aborts (leaving the player wherever the
 * game put them — never guess further) the moment anything unexpected happens: a char
 * prompt (can't be answered blindly), a quit, a step timeout, or a rewind that does
 * not land back on the origin room. The caller is responsible for gating UI input for
 * the duration and for keeping probe turns out of the transcript/autosave stream.
 *
 * `shouldContinue` is polled between complete probe steps — the player typing a
 * command mid-burst cancels further probing so their command runs promptly, but an
 * already-sent probe move ALWAYS gets its rewind first (the world must never be left
 * one probe-step away from where the player thinks they are).
 */
export async function probeUnexploredDirections(
  engine: ProspectEngine,
  getGraph: () => MapGraph,
  onRewound: (roomId: string) => void,
  shouldContinue: () => boolean = () => true,
): Promise<ProspectResult> {
  if (!engine.restoreSnapshot) return 'skipped'; // no rewind mechanism, no probing
  const originId = getGraph().currentRoomId;
  if (!originId || originId === UNKNOWN_ROOM_ID) return 'skipped';
  const dirs = unexploredDirections(getGraph(), originId);
  if (dirs.length === 0) return 'skipped';

  const snapshot = await withTimeout(engine.saveAutosave());
  if (snapshot === 'timeout') return 'aborted';

  for (const dir of dirs) {
    if (!shouldContinue()) return 'aborted';
    if ((await runTurn(engine, dir)) !== 'line') return 'aborted';
    if (getGraph().currentRoomId !== originId) {
      if ((await withTimeout(engine.restoreSnapshot(snapshot))) === 'timeout') return 'aborted';
      onRewound(originId);
      if (getGraph().currentRoomId !== originId) return 'aborted';
    }
  }
  return 'completed';
}

function withTimeout<T>(promise: Promise<T>): Promise<T | 'timeout'> {
  return Promise.race([
    promise,
    new Promise<'timeout'>((r) => setTimeout(() => r('timeout'), PROBE_STEP_TIMEOUT_MS)),
  ]);
}

/** Sends one command and resolves with the type of the next REAL input request. */
function runTurn(
  engine: ProspectEngine,
  cmd: string,
): Promise<'line' | 'char' | 'quit' | 'timeout'> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      unsubscribe();
      resolve('timeout');
    }, PROBE_STEP_TIMEOUT_MS);
    const unsubscribe = engine.on((event) => {
      if ('silent' in event && event.silent) return;
      if (event.kind === 'input_requested') {
        clearTimeout(timer);
        unsubscribe();
        resolve(event.type);
      } else if (event.kind === 'quit') {
        clearTimeout(timer);
        unsubscribe();
        resolve('quit');
      }
    });
    engine.sendCommand(cmd);
  });
}
