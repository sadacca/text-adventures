/**
 * Live end-to-end automapper test against the real, bundled Zork 1 (public/zork1.z3)
 * running on the real engine (Bocfel WASM + BridgeGlkOte + ProtocolTap) — no fixtures,
 * no fakes. Zork's above-ground area is the acid test for room disambiguation: three
 * rooms named "Forest" and two named "Clearing", several one-way-ish asymmetric
 * connections, and moves *between* two same-named rooms ("Forest" -east-> "Forest").
 *
 * The walks run in verbose mode so every arrival re-prints its room description; the
 * random-walk test uses those descriptions as ground-truth fingerprints of which
 * physical room the player is actually in, independent of the automapper's own opinion.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createEngine } from '../src/engine/engine';
import { Automapper } from '../src/map/graph';

interface Step {
  cmd: string;
  status: string; // status-line room name after the command
  buffer: string; // prose printed for the command
}

async function bootZork() {
  const story = new Uint8Array(readFileSync(resolve(__dirname, '../public/zork1.z3')));
  const engine = createEngine();
  const am = new Automapper();
  let status = '';
  let buffer = '';
  let ready: (() => void) | null = null;

  engine.on((e) => {
    am.handleEvent(e);
    if (e.kind === 'status_line') status = e.left;
    if (e.kind === 'buffer_text') buffer += e.text + '\n';
    if (e.kind === 'input_requested' && e.type === 'line') {
      const r = ready;
      ready = null;
      r?.();
    }
  });

  await engine.start(story, { autorestore: false });

  async function send(cmd: string): Promise<Step> {
    buffer = '';
    const done = new Promise<void>((r) => (ready = r));
    engine.sendCommand(cmd);
    await done;
    return { cmd, status, buffer };
  }

  await send('verbose');
  return { am, send };
}

function edgeSet(am: Automapper): string[] {
  return am.graph.edges
    .filter((e) => !e.userDeleted)
    .map((e) => `${e.from} --${e.dir}--> ${e.to} [${e.status}]`)
    .sort();
}

describe('zork1 live automapping', () => {
  it(
    'maps the forest and End of Rainbow area to the real geography',
    {
      timeout: 60_000,
    },
    async () => {
      const { am, send } = await bootZork();

      // A wander with retraced steps: house -> forest (both same-named Forest rooms and
      // both same-named Clearings) -> Canyon View -> down to End of Rainbow.
      const walk = [
        'n',
        'n',
        'w',
        'e',
        'e',
        'e',
        'w',
        'w',
        'n',
        's',
        'e',
        's',
        'n',
        'w',
        's',
        'e',
        'e',
        'e',
        'd',
        'd',
        'n',
      ];
      for (const cmd of walk) await send(cmd);

      expect(am.graph.currentRoomId).toBe('end-of-rainbow');
      expect(edgeSet(am)).toEqual(
        [
          'west-of-house --n--> north-of-house [confirmed]',
          'north-of-house --s--> west-of-house [inferred]',
          'north-of-house --n--> forest-path [confirmed]',
          'forest-path --s--> north-of-house [confirmed]',
          // Forest 1 (west of the path) and Forest 2 (east of it) are distinct rooms that
          // share the display name "Forest" — the old resolver conflated them into one
          // node that sat on both sides of Forest Path at once.
          'forest-path --w--> forest [confirmed]',
          'forest --e--> forest-path [confirmed]',
          'forest-path --e--> forest#2 [confirmed]',
          'forest#2 --w--> forest-path [confirmed]',
          // "Forest" -east-> "Forest" (the impassable-mountains room): a real move whose
          // status line doesn't change — the old rule 2 dropped it as a blocked move.
          'forest#2 --e--> forest#3 [confirmed]',
          'forest#3 --w--> forest#2 [confirmed]',
          // The grating clearing and the east clearing also share a name ("Clearing").
          'forest-path --n--> clearing [confirmed]',
          'clearing --s--> forest-path [confirmed]',
          'forest#2 --s--> clearing#2 [confirmed]',
          'clearing#2 --n--> forest#2 [confirmed]',
          'north-of-house --e--> behind-house [confirmed]',
          'behind-house --w--> north-of-house [inferred]',
          'behind-house --e--> clearing#2 [confirmed]',
          'clearing#2 --w--> behind-house [inferred]',
          'clearing#2 --e--> canyon-view [confirmed]',
          'canyon-view --w--> clearing#2 [inferred]',
          'canyon-view --down--> rocky-ledge [confirmed]',
          'rocky-ledge --up--> canyon-view [inferred]',
          'rocky-ledge --down--> canyon-bottom [confirmed]',
          'canyon-bottom --up--> rocky-ledge [inferred]',
          'canyon-bottom --n--> end-of-rainbow [confirmed]',
          'end-of-rainbow --s--> canyon-bottom [inferred]',
        ].sort(),
      );
    },
  );

  it(
    'survives a stochastic walk with retraced steps without corrupting the map',
    {
      timeout: 60_000,
    },
    async () => {
      const { am, send } = await bootZork();

      // Deterministic LCG so the "random" walk is reproducible.
      let seed = 0xc0ffee;
      const rand = (n: number) => {
        seed = (seed * 1664525 + 1013904223) >>> 0;
        return seed % n;
      };
      const dirs = ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw', 'u', 'd'];

      // Ground truth: in verbose mode every successful move re-prints the room title and
      // its description, which identifies the physical room — with one known exception:
      // Zork's Forest 2 and Forest 3 are distinct rooms sharing the exact same
      // description ("This is a dimly lit forest..."), indistinguishable by any text the
      // game prints (maze-style), so that fingerprint is allowed two map nodes.
      const nodeByFingerprint = new Map<string, Set<string>>();
      const fingerprintByNode = new Map<string, string>();
      const allowedNodes = (fingerprint: string) =>
        fingerprint.includes('This is a dimly lit forest') ? 2 : 1;
      // A confirmed edge's destination must never change (no such thing as a rerouted
      // exit in this part of Zork) — flip-flopping destinations was the reported bug.
      const confirmedTargets = new Map<string, string>();

      for (let i = 0; i < 150; i++) {
        const step = await send(dirs[rand(dirs.length)]);
        const lines = step.buffer.split('\n').map((l) => l.trim());
        const titleIndex = lines.findIndex((l) => l === step.status.trim());
        const moved = titleIndex !== -1;
        if (moved) {
          const description = lines.slice(titleIndex + 1).find((l) => l && l !== '>') ?? '';
          const fingerprint = `${step.status} :: ${description}`;
          const node = am.graph.currentRoomId!;
          const nodes = nodeByFingerprint.get(fingerprint) ?? new Set<string>();
          nodes.add(node);
          nodeByFingerprint.set(fingerprint, nodes);
          expect(
            nodes.size,
            `room "${fingerprint}" is spread across map nodes ${[...nodes].join(', ')}`,
          ).toBeLessThanOrEqual(allowedNodes(fingerprint));
          const knownFingerprint = fingerprintByNode.get(node);
          if (knownFingerprint) {
            expect(knownFingerprint, `map node ${node} absorbed a second physical room`).toBe(
              fingerprint,
            );
          }
          fingerprintByNode.set(node, fingerprint);
        }
        for (const e of am.graph.edges) {
          if (e.status !== 'confirmed' || e.userDeleted) continue;
          const key = `${e.from}|${e.dir}`;
          const prev = confirmedTargets.get(key);
          if (prev) {
            expect(prev, `confirmed edge ${key} was rerouted`).toBe(e.to);
          }
          confirmedTargets.set(key, e.to);
        }
      }

      // The walk must have actually covered the ambiguous rooms for this test to mean
      // anything: at least two "Forest" nodes and both "Clearing"s.
      const names = Object.values(am.graph.rooms).map((r) => r.name);
      expect(names.filter((n) => n === 'Forest').length).toBeGreaterThanOrEqual(2);
      expect(names.filter((n) => n === 'Clearing').length).toBe(2);
    },
  );
});
