import type { GameEvent } from '../engine/types.js';
import { UNKNOWN_ROOM_ID, type Direction, type MapGraph } from './graph.js';

/**
 * Prospective mapping (2026-07-17): with the setting on, after the player's turn
 * settles the app quietly probes each still-unexplored compass direction from the
 * current room — send the move, let the automapper record what happens (a confirmed
 * edge + the destination room on success, a blockedDirections entry on failure), then
 * immediately rewind with Bocfel's interpreter-level `/undo` meta-command (which works
 * even for games with no in-game UNDO, like Zork 1 — the interpreter snapshots every
 * turn itself). Net effect: the map and compass fill in every openable direction of a
 * room the moment it's first visited, without the player spending real moves — the
 * final /undo restores the exact pre-probe world state.
 *
 * The Automapper's own undo handling (`isUndoCommand` / `handleUndo` in graph.ts)
 * guarantees the rewind never mints an edge and lands back on the exact origin node.
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

export const UNDO_COMMAND = '/undo';

/** The minimal engine surface probing needs — satisfied by EngineHandle, and by the
 *  live tests' raw engine, without dragging store wiring in here. */
export interface ProspectEngine {
  sendCommand(text: string): void;
  on(listener: (event: GameEvent) => void): () => void;
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
 * prompt (can't be answered blindly), a quit, or an /undo that does not return to the
 * origin room. The caller is responsible for gating UI input for the duration and for
 * keeping probe turns out of the transcript/autosave stream.
 *
 * `shouldContinue` is polled between complete move+undo pairs — the player typing a
 * command mid-burst cancels further probing so their command runs promptly, but an
 * already-sent probe move ALWAYS gets its /undo first (the world must never be left
 * one probe-step away from where the player thinks they are).
 */
export async function probeUnexploredDirections(
  engine: ProspectEngine,
  getGraph: () => MapGraph,
  shouldContinue: () => boolean = () => true,
): Promise<ProspectResult> {
  const originId = getGraph().currentRoomId;
  if (!originId || originId === UNKNOWN_ROOM_ID) return 'skipped';
  const dirs = unexploredDirections(getGraph(), originId);
  if (dirs.length === 0) return 'skipped';

  for (const dir of dirs) {
    if (!shouldContinue()) return 'aborted';
    if ((await runTurn(engine, dir)) !== 'line') return 'aborted';
    if (getGraph().currentRoomId !== originId) {
      if ((await runTurn(engine, UNDO_COMMAND)) !== 'line') return 'aborted';
      if (getGraph().currentRoomId !== originId) return 'aborted';
    }
  }
  return 'completed';
}

/** Sends one command and resolves with the type of the next REAL input request. */
function runTurn(engine: ProspectEngine, cmd: string): Promise<'line' | 'char' | 'quit'> {
  return new Promise((resolve) => {
    const unsubscribe = engine.on((event) => {
      if ('silent' in event && event.silent) return;
      if (event.kind === 'input_requested') {
        unsubscribe();
        resolve(event.type);
      } else if (event.kind === 'quit') {
        unsubscribe();
        resolve('quit');
      }
    });
    engine.sendCommand(cmd);
  });
}
