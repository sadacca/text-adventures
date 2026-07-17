/**
 * Live end-to-end prospective-mapping test against the real, bundled Zork 1 on the
 * real engine. Probing sends each unexplored compass direction from the current room
 * and rewinds successful moves with Bocfel's interpreter-level "/undo" (Zork 1 itself,
 * a v3 game, has no in-game UNDO — the interpreter provides it). The automapper's undo
 * handling must bring currentRoomId back to the origin without minting any edge.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createEngine } from '../src/engine/engine';
import { Automapper } from '../src/map/graph';
import { computeLayout } from '../src/map/layout';
import { probeUnexploredDirections } from '../src/map/prospect';

async function bootZork() {
  const story = new Uint8Array(readFileSync(resolve(__dirname, '../public/zork1.z3')));
  const engine = createEngine();
  const am = new Automapper();
  let ready: (() => void) | null = null;
  let status = '';

  engine.on((e) => {
    am.handleEvent(e);
    computeLayout(am.graph); // what mapStore does on every event
    if (e.kind === 'status_line') status = e.left;
    if (e.kind === 'input_requested' && e.type === 'line') {
      const r = ready;
      ready = null;
      r?.();
    }
  });

  await engine.start(story, { autorestore: false });

  async function send(cmd: string) {
    const done = new Promise<void>((r) => (ready = r));
    engine.sendCommand(cmd);
    await done;
    return status;
  }

  await send('verbose');
  return { am, engine, send };
}

function confirmedExits(am: Automapper, roomId: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const e of am.graph.edges) {
    if (e.from === roomId && e.status === 'confirmed' && !e.userDeleted) out.set(e.dir, e.to);
  }
  return out;
}

describe('zork1 live prospective mapping', () => {
  it(
    'probes a room without moving the player, disturbing the game, or corrupting the map',
    { timeout: 120_000 },
    async () => {
      const { am, engine, send } = await bootZork();
      expect(am.graph.currentRoomId).toBe('west-of-house');

      const result = await probeUnexploredDirections(engine, () => am.graph);
      expect(result).toBe('completed');

      // The player never actually went anywhere.
      expect(am.graph.currentRoomId).toBe('west-of-house');

      // Real West of House geography, learned without spending a move: confirmed exits
      // north, south, and west...
      const exits = confirmedExits(am, 'west-of-house');
      expect(exits.get('n')).toBe('north-of-house');
      expect(exits.get('s')).toBe('south-of-house');
      expect(exits.get('w')).toBe('forest');
      // ...and the boarded front door registered as blocked going east.
      expect(am.graph.rooms['west-of-house'].blockedDirections).toContain('e');

      // The rewinds left no trace: no undo-labeled edges, no unknown rooms, and every
      // discovered room stayed on the ground floor.
      expect(am.graph.edges.some((e) => e.dir.toLowerCase().includes('undo'))).toBe(false);
      expect(am.graph.rooms['unknown']).toBeUndefined();
      for (const room of Object.values(am.graph.rooms)) {
        expect(room.floor ?? 0, `floor of ${room.id}`).toBe(0);
      }

      // A second pass has nothing left to learn — zero commands sent.
      expect(await probeUnexploredDirections(engine, () => am.graph)).toBe('skipped');

      // The game itself is undisturbed: still at West of House, and the mailbox is
      // still closed (a probe that leaked state would be a real bug — /undo must have
      // restored the world each time).
      await send('open mailbox');
      const after = await send('read leaflet');
      expect(after.trim()).toBe('West of House');

      // Probing a second room after really moving there also works, and retracing the
      // player's own confirmed edge keeps the map intact.
      await send('close mailbox');
      await send('n');
      expect(am.graph.currentRoomId).toBe('north-of-house');
      expect(await probeUnexploredDirections(engine, () => am.graph)).toBe('completed');
      expect(am.graph.currentRoomId).toBe('north-of-house');
      const northExits = confirmedExits(am, 'north-of-house');
      expect(northExits.get('n')).toBe('forest-path');
      expect(northExits.get('e')).toBe('behind-house');
      expect(northExits.get('w')).toBe('west-of-house');
    },
  );
});
