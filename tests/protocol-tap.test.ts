import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { ProtocolTap, replayFixture, type RawMessage } from '../src/engine/protocol-tap';
import type { GameEvent } from '../src/engine/types';

function loadFixture(name: string): string {
  return readFileSync(path.join(__dirname, 'fixtures', name), 'utf8');
}

/**
 * SPECS.md §6: fixture-based tests replay recorded RemGlk/GlkOte JSON Lines sessions
 * through the protocol tap and assert the emitted GameEvent sequence — no WASM/engine
 * involved. Fixtures were captured from a real Bocfel session against `advent.z5`
 * (curiousdannii/asyncglk's own test fixture, public-domain Adventure) via a one-off
 * Node harness driving `createEngine()` and dumping every `onRaw` message; see the
 * commit that added `tests/fixtures/*.jsonl` for exact commands.
 */
describe('protocol tap fixtures', () => {
  it('parses a 15-turn walk into the expected command/status_line sequence', () => {
    const events = replayFixture(loadFixture('walk15.jsonl'));
    const commands = events.filter((e) => e.kind === 'command');
    const statuses = events.filter((e) => e.kind === 'status_line');

    expect(commands.map((c) => c.text)).toEqual([
      'look',
      'north',
      'south',
      'east',
      'west',
      'north',
      'inventory',
      'take lamp',
      'turn on lamp',
      'down',
      'south',
      'north',
      'up',
      'west',
      'east',
    ]);
    // Turn increments once per command, monotonically, starting at 1 for the first.
    expect(commands.map((c) => c.turn)).toEqual(commands.map((_, i) => i + 1));

    expect(statuses[0]).toMatchObject({ left: 'At End Of Road', turn: 0 });
    expect(statuses.at(-1)).toMatchObject({ left: 'In Forest' });
    // "take lamp" / "turn on lamp" are parser errors with no room change (turns 8, 9) —
    // the room name is unchanged from the prior status update, same as a blocked move.
    const byTurn = new Map(statuses.map((s) => [s.turn, s]));
    expect(byTurn.get(7)?.left).toBe('At End Of Road');
    expect(byTurn.get(8)?.left).toBe('At End Of Road');
    expect(byTurn.get(9)?.left).toBe('At End Of Road');
  });

  it('parses a blocked exit as a status update with the room name unchanged', () => {
    const events = replayFixture(loadFixture('blocked-and-dark.jsonl'));
    const statuses = events.filter((e) => e.kind === 'status_line');
    const byTurn = new Map(statuses.map((s) => [s.turn, s]));

    // Turn 6: arrive "At Slit In Streambed". Turn 7: blocked "down" ("You don't fit
    // through a two-inch slit!") — room name unchanged.
    expect(byTurn.get(6)?.left).toBe('At Slit In Streambed');
    expect(byTurn.get(7)?.left).toBe('At Slit In Streambed');
    const blockedText = events.find((e) => e.kind === 'buffer_text' && e.turn === 7);
    expect(blockedText).toMatchObject({ kind: 'buffer_text' });
    if (blockedText?.kind === 'buffer_text') {
      expect(blockedText.text).toContain("You don't fit through a two-inch slit!");
    }
  });

  it('parses a dark room as a distinctly-named status line', () => {
    const events = replayFixture(loadFixture('blocked-and-dark.jsonl'));
    const statuses = events.filter((e) => e.kind === 'status_line');
    const dark = statuses.at(-1);
    expect(dark).toMatchObject({ left: 'Darkness', turn: 13 });
    const darkText = events.find((e) => e.kind === 'buffer_text' && e.turn === 13);
    if (darkText?.kind === 'buffer_text') {
      expect(darkText.text).toContain("It is pitch dark, and you can't see a thing.");
    }
  });

  it('parses a named save/restore round-trip, including the history-playback replay text', () => {
    const events = replayFixture(loadFixture('save-restore.jsonl'));
    const commands = events.filter((e) => e.kind === 'command');
    expect(commands.map((c) => c.text)).toEqual([
      'north',
      'south',
      'save',
      'east',
      'west',
      'restore',
    ]);

    const saveResponse = events.find(
      (e) => e.kind === 'buffer_text' && e.turn === 3 && e.text.includes('Ok.'),
    );
    expect(saveResponse).toBeDefined();

    // RESTORE lands back on the room as of the save point ("In Forest", turn 2's room),
    // even though the reported turn number is the restore command's own (6) — Bocfel's
    // own history-playback text comes along for the ride here; engineStore.ts strips it
    // for the UI-visible transcript (see stripHistoryReplay), but the protocol tap
    // itself passes it through unmodified, which is exactly what this fixture pins down.
    const statuses = events.filter((e) => e.kind === 'status_line');
    expect(statuses.at(-1)).toMatchObject({ left: 'In Forest', turn: 6 });
    const restoreText = events.find(
      (e) =>
        e.kind === 'buffer_text' && e.turn === 6 && e.text.includes('Starting history playback'),
    );
    expect(restoreText).toBeDefined();
  });
});

describe('ProtocolTap.handleUpdate', () => {
  it('emits a quit event when the update disables the interpreter', () => {
    const events: GameEvent[] = [];
    const tap = new ProtocolTap((e) => events.push(e));
    tap.handleUpdate({ type: 'update', gen: 1, disable: true });
    expect(events).toEqual([{ kind: 'quit', turn: 0 }]);
  });

  it('ignores error/pass/retry update types (no GameEvent emitted)', () => {
    const events: GameEvent[] = [];
    const tap = new ProtocolTap((e) => events.push(e));
    tap.handleUpdate({ type: 'pass' });
    tap.handleUpdate({ type: 'retry' });
    expect(events).toEqual([]);
  });

  it('observes every raw message via onRaw without altering command/emit behavior', () => {
    const raw: RawMessage[] = [];
    const events: GameEvent[] = [];
    const tap = new ProtocolTap(
      (e) => events.push(e),
      (r) => raw.push(r),
    );
    tap.handleEvent({ type: 'line', value: 'look', window: 1, gen: 0 });
    tap.handleUpdate({ type: 'update', gen: 1 });
    expect(raw).toEqual([
      { dir: 'in', msg: { type: 'line', value: 'look', window: 1, gen: 0 } },
      { dir: 'out', msg: { type: 'update', gen: 1 } },
    ]);
    expect(events).toEqual([{ kind: 'command', text: 'look', turn: 1 }]);
  });

  it('does not emit a command event, and does not advance turn, for silent line events', () => {
    const events: GameEvent[] = [];
    const tap = new ProtocolTap((e) => events.push(e));
    tap.handleEvent({ type: 'line', value: 'save', window: 1, gen: 0 }, { silent: true });
    expect(events).toEqual([]);
    expect(tap.getTurn()).toBe(0);
  });
});

/**
 * UX-24: real-capture-informed test. Sourced two genuine, reachable historicalsource
 * (Microsoft, 2025) Z-machine builds — Trinity (Release 15/870628) and Border Zone
 * (Release 9/871008, working title "spy") — via raw.githubusercontent.com, since
 * ifarchive.org/mirror.ifarchive.org repeat the network-policy 403 UX-17/19 already hit.
 * Playing Border Zone's Chapter 1 with DebugConsole's fixture recorder (idle after
 * arming the interpreter's real-time timer with one turn) showed the interpreter DOES
 * spontaneously push a fresh `input`-bearing update roughly once per `data.timer`
 * interval with no command from the player — asyncglk's GlkOteBase timer loop genuinely
 * fires end-to-end. But every one of those spontaneous updates inherited `silent: true`
 * from the app's own per-turn background autosave (which runs right after the arming
 * turn and leaves `silent` stuck true until the player's next real command) — so had
 * that scene's timer interrupt printed anything, engineStore's `isSilent` gate would
 * have dropped it permanently, not merely late. `handleTimerTick()` (called from
 * `glkote-bridge.ts`'s `ontimer()` override, guarded on `!waiting_for_update`) is the
 * fix: it un-silences the tap right before a genuinely idle-fired timer event reaches
 * the interpreter, so the resulting update is treated like any ordinary turn.
 */
describe('ProtocolTap.handleTimerTick (UX-24)', () => {
  const bufferWindow = {
    id: 1,
    type: 'buffer' as const,
    height: 0,
    left: 0,
    rock: 0,
    top: 0,
    width: 0,
  };

  it('un-silences the next update, even though the last command sent was silent', () => {
    const events: GameEvent[] = [];
    const tap = new ProtocolTap((e) => events.push(e));
    tap.handleEvent({ type: 'line', value: 'save', window: 1, gen: 0 }, { silent: true });

    tap.handleTimerTick();
    tap.handleUpdate({
      type: 'update',
      gen: 1,
      windows: [bufferWindow],
      content: [{ id: 1, text: [{ content: ['The phone rings.'] }] }],
      input: [{ id: 1, type: 'line' }],
    });

    expect(events).toEqual([
      { kind: 'buffer_text', text: 'The phone rings.', turn: 0, silent: false },
      { kind: 'input_requested', type: 'line', turn: 0, silent: false },
    ]);
  });

  it('regression guard: without a timer tick, the same update stays silent and would be dropped', () => {
    const events: GameEvent[] = [];
    const tap = new ProtocolTap((e) => events.push(e));
    tap.handleEvent({ type: 'line', value: 'save', window: 1, gen: 0 }, { silent: true });

    tap.handleUpdate({
      type: 'update',
      gen: 1,
      windows: [bufferWindow],
      content: [{ id: 1, text: [{ content: ['The phone rings.'] }] }],
      input: [{ id: 1, type: 'line' }],
    });

    expect(events).toEqual([
      { kind: 'buffer_text', text: 'The phone rings.', turn: 0, silent: true },
      { kind: 'input_requested', type: 'line', turn: 0, silent: true },
    ]);
  });
});
