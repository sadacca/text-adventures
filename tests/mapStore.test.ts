import { afterEach, describe, expect, it } from 'vitest';
import type { GameEvent } from '../src/engine/types';
import { useMapStore } from '../src/state/mapStore';

function cmd(text: string, turn: number): GameEvent {
  return { kind: 'command', text, turn };
}

function status(left: string, turn: number): GameEvent {
  return { kind: 'status_line', left, right: '', raw: [], turn };
}

const initial = useMapStore.getState();

afterEach(() => {
  useMapStore.setState(initial, true);
});

/** UX-26: `lastMoveDir` is UI-derived state in `mapStore`, tracked alongside (but
 *  independent of) the automapper's own graph mutations — see graph.test.ts for the
 *  latter. */
describe('mapStore lastMoveDir (UX-26)', () => {
  it('sets lastMoveDir to the direction of a successful move', async () => {
    await useMapStore.getState().loadForGame('g1');
    useMapStore.getState().handleEvent(status('Kitchen', 0));
    useMapStore.getState().handleEvent(cmd('north', 1));
    useMapStore.getState().handleEvent(status('Pantry', 1));

    expect(useMapStore.getState().lastMoveDir).toBe('n');
  });

  it('leaves lastMoveDir unchanged after a non-direction command', async () => {
    await useMapStore.getState().loadForGame('g2');
    useMapStore.getState().handleEvent(status('Kitchen', 0));
    useMapStore.getState().handleEvent(cmd('north', 1));
    useMapStore.getState().handleEvent(status('Pantry', 1));

    useMapStore.getState().handleEvent(cmd('xyzzy', 2));
    useMapStore.getState().handleEvent(status('Pantry', 2));

    expect(useMapStore.getState().lastMoveDir).toBe('n');
  });

  it('clears lastMoveDir when the move is blocked (room unchanged)', async () => {
    await useMapStore.getState().loadForGame('g3');
    useMapStore.getState().handleEvent(status('Kitchen', 0));
    useMapStore.getState().handleEvent(cmd('north', 1));
    useMapStore.getState().handleEvent(status('Pantry', 1));

    useMapStore.getState().handleEvent(cmd('east', 2));
    useMapStore.getState().handleEvent(status('Pantry', 2)); // wall blocks the move

    expect(useMapStore.getState().lastMoveDir).toBeNull();
  });
});
