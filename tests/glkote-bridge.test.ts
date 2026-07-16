import { describe, expect, it } from 'vitest';
import { BridgeGlkOte } from '../src/engine/glkote-bridge';
import type { GameEvent } from '../src/engine/types';

const bufferWindow = {
  id: 1,
  type: 'buffer' as const,
  height: 0,
  left: 0,
  rock: 0,
  top: 0,
  width: 0,
};

/**
 * UX-24: `BridgeGlkOte.ontimer()` overrides asyncglk's `GlkOteBase.ontimer()` (the real
 * timer loop backing timed `read`/`read_char`, e.g. Border Zone's real-time scenes) to
 * un-silence the protocol tap before a genuinely idle-fired timer event reaches the
 * interpreter — see the dated comment in protocol-tap.test.ts for the live-capture
 * finding this fixes (a timer interrupt firing during the window after the per-turn
 * background autosave, but before the player's next real command, would otherwise
 * inherit `silent: true` forever and be dropped). The critical safety property is the
 * `!waiting_for_update` guard: it must NOT fire while a request (e.g. that same silent
 * autosave) is still in flight, or it would incorrectly unmask that request's own
 * response as if it were visible player-facing content.
 */
describe('BridgeGlkOte.ontimer (UX-24)', () => {
  it('skips the un-silence while a request is already in flight, applies it once idle', () => {
    const events: GameEvent[] = [];
    const bridge = new BridgeGlkOte((e) => events.push(e));

    // Simulate the per-turn background autosave: a silent command in flight.
    bridge.sendSilentCommand('save');

    // A timer tick landing here must NOT un-silence — the autosave's own response
    // hasn't arrived yet (waiting_for_update is still true).
    (bridge as unknown as { ontimer(): void }).ontimer();
    bridge.update({
      type: 'update',
      gen: 1,
      windows: [bufferWindow],
      content: [{ id: 1, text: [{ content: ['Ok.'] }] }],
      input: [{ id: 1, type: 'line' }],
    });
    expect(events).toEqual([
      { kind: 'buffer_text', text: 'Ok.', turn: 0, silent: true },
      { kind: 'input_requested', type: 'line', turn: 0, silent: true },
    ]);

    events.length = 0;

    // Now genuinely idle (the previous update cleared waiting_for_update) — a real
    // timer tick here must un-silence.
    (bridge as unknown as { ontimer(): void }).ontimer();
    bridge.update({
      type: 'update',
      gen: 2,
      content: [{ id: 1, text: [{ content: ['The phone rings.'] }] }],
      input: [{ id: 1, type: 'line' }],
    });
    expect(events).toEqual([
      { kind: 'buffer_text', text: 'The phone rings.', turn: 0, silent: false },
      { kind: 'input_requested', type: 'line', turn: 0, silent: false },
    ]);
  });
});
