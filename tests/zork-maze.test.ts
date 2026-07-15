/**
 * Live regression test for Zork 1's forest maze — the area behind the original bug
 * report ("navigating in the forest and End of Rainbow... the map gets overwritten in
 * ways that are not quite right"). Ground truth here was independently derived by
 * exhaustively DFS-probing the real interpreter (rebooting + replaying each path prefix
 * from true game start, since this z-machine release has no 'undo'), confirmed against
 * the game's own official hand-drawn map:
 *
 *   forest-path: N->clearing-leaves, S->north-of-house, W->forest-sun, E->forest2, U->up-a-tree
 *   clearing-leaves: S->forest-path, E->forest2
 *   up-a-tree: D->forest-path
 *   forest-sun ("Forest 1" on the map): E->forest-path, N->clearing-leaves, S->forest3
 *   forest2 (dark, "Forest 2"/"4" on the map): W->forest-path, E->mountains, S->clearing-wellmarked
 *   mountains: W/N/S ALL loop back to forest2 (the map's "returning to origin" symbol)
 *   clearing-wellmarked: E->canyon-view, W->behind-house, N->forest2, S->forest3
 *   forest3 (dark, "Forest 3" on the map): N->clearing-wellmarked, NW->south-of-house, W->forest-sun
 *
 * forest2 and forest3 are textually IDENTICAL (same status-line name "Forest", same
 * verbose-mode description "This is a dimly lit forest, with large trees all around.")
 * — confirmed by their divergent live behavior when probed directly, not assumed. No
 * automapper can disambiguate these from prose alone; that's Zork's own design (the
 * hand-drawn map's inconsistent Forest-box count suggests even its human cartographer
 * hit the same wall). The one thing that MUST hold regardless is the actual bug report:
 * a confirmed edge must never be silently overwritten by a later, contradicting
 * traversal — see src/map/graph.ts's splitRoomForContradiction.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createEngine } from '../src/engine/engine';
import { Automapper } from '../src/map/graph';
import type { RoomEdge } from '../src/map/graph';

async function bootZork() {
  const story = new Uint8Array(readFileSync(resolve(__dirname, '../public/zork1.z3')));
  const engine = createEngine();
  const am = new Automapper();
  let ready: (() => void) | null = null;

  engine.on((e) => {
    am.handleEvent(e);
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
  }
  await send('verbose');
  await send('n');
  await send('n'); // Forest Path
  return { am, send };
}

function confirmed(am: Automapper): RoomEdge[] {
  return am.graph.edges.filter((e) => e.status === 'confirmed' && !e.userDeleted);
}

describe('zork1 forest maze (live, real interpreter)', () => {
  it(
    'never silently overwrites a confirmed edge, even when text-ambiguous rooms merge',
    {
      timeout: 60_000,
    },
    async () => {
      const { am, send } = await bootZork();

      // Adversarial walk: visits forest2 and forest3 (indistinguishable siblings) via
      // several different routes, bounces off mountains' triple self-loop back to
      // forest2, and retraces through both Clearings and Forest Path repeatedly.
      const walk = [
        'e',
        's',
        'w',
        'e',
        'n',
        'w', // forest2 -> clearingB -> behind-house -> back -> forest2 -> forest-path
        'w',
        'e',
        'n',
        's', // forest-sun round trip, clearing-leaves round trip
        'e',
        'e',
        'n',
        's',
        's', // forest2 -> mountains -> forest2(loop) -> clearingB -> forest3
        'n',
        's',
        'w',
        's',
        'nw', // clearingB round trip, forest3 -> forest-sun -> forest3 -> south-of-house
      ];

      // Snapshot every confirmed edge's target after every step; a target must never
      // change once set (the exact symptom from the bug report).
      const seenTarget = new Map<string, string>();
      for (const cmd of walk) {
        await send(cmd);
        for (const e of confirmed(am)) {
          const key = `${e.from}|${e.dir}`;
          const prev = seenTarget.get(key);
          if (prev) expect(prev, `confirmed edge ${key} was silently rerouted`).toBe(e.to);
          seenTarget.set(key, e.to);
        }
      }

      // The maze's unambiguous rooms must each resolve to exactly one node — no spurious
      // #2/#3 duplicates from misidentification.
      const byName = new Map<string, string[]>();
      for (const r of Object.values(am.graph.rooms)) {
        byName.set(r.name, [...(byName.get(r.name) ?? []), r.id]);
      }
      expect(byName.get('Forest Path')).toEqual(['forest-path']);
      expect(byName.get('Behind House')).toEqual(['behind-house']);
      expect(byName.get('South of House')).toEqual(['south-of-house']);
      // Exactly 2 distinct Clearings (leaves-clearing and the well-marked one) — real,
      // unique geography, not an artifact of merge/split.
      expect(byName.get('Clearing')).toHaveLength(2);

      // The two Clearings' own confirmed edges must stay internally consistent even
      // though both sides of the maze route through them.
      const clearingIds = byName.get('Clearing')!;
      for (const id of clearingIds) {
        const outgoing = confirmed(am).filter((e) => e.from === id);
        const byDir = new Map(outgoing.map((e) => [e.dir, e.to]));
        expect(byDir.size).toBe(outgoing.length); // no duplicate (from,dir) keys
      }
    },
  );

  it(
    'reuses the same "Forest" node across mountains’ triple self-loop',
    {
      timeout: 60_000,
    },
    async () => {
      const { am, send } = await bootZork();
      await send('e'); // forest-path -> forest2
      const forest2Id = am.graph.currentRoomId!;
      await send('e'); // forest2 -> mountains
      const mountainsId = am.graph.currentRoomId!;
      expect(mountainsId).not.toBe(forest2Id);

      for (const dir of ['n', 's', 'w']) {
        await send(dir);
        expect(am.graph.currentRoomId, `mountains --${dir}--> should loop back to forest2`).toBe(
          forest2Id,
        );
        await send('e'); // back to mountains for the next probe
        expect(am.graph.currentRoomId).toBe(mountainsId);
      }
    },
  );
});
