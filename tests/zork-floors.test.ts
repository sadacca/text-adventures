/**
 * Live end-to-end multi-floor automapping test against the real, bundled Zork 1
 * (public/zork1.z3) on the real engine — no fixtures, no fakes. Companion to
 * zork-automap.test.ts (which covers same-name disambiguation above ground); this one
 * covers the vertical dimension: a walk that goes above ground (house → attic via the
 * kitchen stairs) and below ground (living room → cellar → gallery → studio → back up
 * the chimney), exercising every floor-inference path — up/down deltas, horizontal
 * propagation, custom edges, in/out — plus layout stability while the player bounces
 * between floors.
 *
 * Mirrors mapStore.handleEvent's real behavior by running computeLayout after every
 * event, exactly as the app does, so the stability assertions test what the user sees.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createEngine } from '../src/engine/engine';
import { Automapper } from '../src/map/graph';
import { computeLayout } from '../src/map/layout';

interface Step {
  cmd: string;
  status: string;
}

async function bootZork() {
  const story = new Uint8Array(readFileSync(resolve(__dirname, '../public/zork1.z3')));
  const engine = createEngine();
  const am = new Automapper();
  let status = '';
  let ready: (() => void) | null = null;

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

  async function send(cmd: string): Promise<Step> {
    const done = new Promise<void>((r) => (ready = r));
    engine.sendCommand(cmd);
    await done;
    return { cmd, status };
  }

  await send('verbose');
  return { am, send };
}

function positionSnapshot(am: Automapper): Map<string, { x: number; y: number; floor: number }> {
  const snap = new Map<string, { x: number; y: number; floor: number }>();
  for (const room of Object.values(am.graph.rooms)) {
    snap.set(room.id, { x: room.pos.x, y: room.pos.y, floor: room.floor ?? 0 });
  }
  return snap;
}

/** Room boxes are ~0.84x0.44 grid cells (92x48 px at 110 px/cell): two rooms on the
 *  same floor overlap iff BOTH separations are under the box size. */
function assertNoOverlaps(am: Automapper) {
  const rooms = Object.values(am.graph.rooms);
  for (let i = 0; i < rooms.length; i++) {
    for (let j = i + 1; j < rooms.length; j++) {
      const a = rooms[i];
      const b = rooms[j];
      if ((a.floor ?? 0) !== (b.floor ?? 0)) continue;
      const dx = Math.abs(a.pos.x - b.pos.x);
      const dy = Math.abs(a.pos.y - b.pos.y);
      expect(
        dx >= 0.85 || dy >= 0.45,
        `rooms "${a.id}" and "${b.id}" overlap on floor ${a.floor ?? 0} (dx=${dx}, dy=${dy})`,
      ).toBe(true);
    }
  }
}

describe('zork1 live multi-floor automapping', () => {
  it(
    'assigns correct floors above and below ground and keeps the layout stable across floor changes',
    { timeout: 120_000 },
    async () => {
      const { am, send } = await bootZork();

      // Above ground and into the house: West of House -> North of House -> Behind
      // House -> (open window) -> Kitchen [in] -> Attic [up] -> Kitchen [down] ->
      // Living Room [w]. Then below ground: take + light the lamp, open the trap door,
      // Cellar [down] -> East of Chasm [s] -> Gallery [e] -> Studio [n] -> up the
      // chimney back to the Kitchen (carrying only the lamp, so the climb succeeds).
      const walk: [string, string][] = [
        ['n', 'North of House'],
        ['e', 'Behind House'],
        ['open window', 'Behind House'],
        ['in', 'Kitchen'],
        ['u', 'Attic'],
        ['d', 'Kitchen'],
        ['w', 'Living Room'],
        ['take lamp', 'Living Room'],
        ['turn on lamp', 'Living Room'],
        ['move rug', 'Living Room'],
        ['open trap door', 'Living Room'],
        ['d', 'Cellar'],
        ['s', 'East of Chasm'],
        ['e', 'Gallery'],
        ['n', 'Studio'],
        ['u', 'Kitchen'],
      ];
      for (const [cmd, expectedStatus] of walk) {
        const step = await send(cmd);
        expect(step.status.trim(), `after "${cmd}"`).toBe(expectedStatus);
      }

      // Every room on the floor the geography says it's on. Before the floor-propagation
      // fix, everything horizontally-reached below ground (East of Chasm, Gallery,
      // Studio) fell back onto floor 0 — the "rooms scatter onto the ground floor" bug.
      const expectedFloors: Record<string, number> = {
        'west-of-house': 0,
        'north-of-house': 0,
        'behind-house': 0,
        kitchen: 0, // reached via `in`: same level as Behind House
        attic: 1, // up from Kitchen
        'living-room': 0, // horizontal from Kitchen
        cellar: -1, // down through the trap door
        'east-of-chasm': -1, // horizontal moves keep the cellar level
        gallery: -1,
        studio: -1,
      };
      for (const [id, floor] of Object.entries(expectedFloors)) {
        expect(am.graph.rooms[id], `room ${id} exists`).toBeDefined();
        expect(am.graph.rooms[id].floor, `floor of ${id}`).toBe(floor);
      }
      // The chimney climb arrives at the already-known Kitchen: sticky floors must NOT
      // let the up-move drag it to 0 + 1... it stays exactly where it was assigned.
      expect(am.graph.rooms['kitchen'].floor).toBe(0);
      expect(am.graph.currentRoomId).toBe('kitchen');

      assertNoOverlaps(am);

      // --- Stability phase: keep playing, crossing floors repeatedly. No room that is
      // already on the map may move (that reshuffling-on-floor-change was the bug).
      const before = positionSnapshot(am);

      const stabilityWalk = [
        'w', // Living Room (floor 0)
        'open trap door',
        'd', // Cellar (floor -1) — the trap door slams shut behind us
        's', // East of Chasm
        'n', // back to Cellar
        'u', // blocked: the trap door is shut — a blocked move, not an arrival
        's', // East of Chasm again
        'e', // Gallery
        'n', // Studio
        'u', // chimney back to Kitchen (floor 0)
      ];
      for (const cmd of stabilityWalk) {
        await send(cmd);
        for (const [id, prev] of before) {
          const room = am.graph.rooms[id];
          expect(room, `room ${id} still exists after "${cmd}"`).toBeDefined();
          expect(
            { x: room.pos.x, y: room.pos.y, floor: room.floor ?? 0 },
            `room ${id} moved or changed floor after "${cmd}"`,
          ).toEqual(prev);
        }
      }

      expect(am.graph.currentRoomId).toBe('kitchen');
      assertNoOverlaps(am);

      // The map must actually span three floors for this test to mean anything.
      const floors = new Set(Object.values(am.graph.rooms).map((r) => r.floor ?? 0));
      expect([...floors].sort((a, b) => a - b)).toEqual([-1, 0, 1]);
    },
  );
});
