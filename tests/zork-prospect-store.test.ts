/**
 * Repro harness: prospective mapping driven through the REAL engineStore + real engine
 * + real Zork 1, the way the app actually runs it (probe trigger off input_requested,
 * transcript/autosave suppression, input gating) — the earlier live test drove
 * prospect.ts directly and could not see store-level interface lockups.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useEngineStore } from '../src/state/engineStore';
import { useUiStore } from '../src/state/uiStore';
import { useMapStore } from '../src/state/mapStore';
import { addOrTouchGame, restartPlaythrough } from '../src/storage/games';

const uiInitial = useUiStore.getState();

afterEach(() => {
  useEngineStore.getState().closeGame();
  useUiStore.setState(uiInitial, true);
  vi.restoreAllMocks();
});

async function openZork() {
  const bytes = readFileSync(resolve(__dirname, '../public/zork1.z3'));
  // gameId is a content hash, so every test in this worker shares one game record —
  // wipe the playthrough (autosaves, map, transcript) so each test boots FRESH instead
  // of silently auto-resuming wherever the previous test left the world.
  const game = await addOrTouchGame(new Uint8Array(bytes), 'zork1.z3');
  await restartPlaythrough(game.gameId);
  await useEngineStore.getState().openGame(game.gameId);
  return game.gameId;
}

/** Waits until the store is idle at a line prompt with no probe burst running. */
async function settled(timeout = 30_000) {
  await vi.waitFor(
    () => {
      const s = useEngineStore.getState();
      expect(s.inputType).toBe('line');
      expect(s.probing).toBe(false);
      expect(s.traveling).toBe(false);
    },
    { timeout, interval: 25 },
  );
}

/** Sends a player command and waits for its turn to commit AND the store to go idle.
 *  A bare settled() right after sendCommand can win the race against the turn's own
 *  response (idle state is stale until the engine's update arrives), so anchor on the
 *  transcript entry the command must produce. */
async function sendAndSettle(text: string, timeout = 30_000) {
  const before = useEngineStore.getState().transcript.length;
  useEngineStore.getState().sendCommand(text);
  await vi.waitFor(
    () => {
      const s = useEngineStore.getState();
      expect(s.transcript.length).toBeGreaterThan(before);
      expect(s.inputType).toBe('line');
      expect(s.probing).toBe(false);
      expect(s.traveling).toBe(false);
    },
    { timeout, interval: 25 },
  );
}

describe('prospective mapping through the real engineStore', () => {
  it(
    'keeps the interface usable: every player command still lands and settles',
    { timeout: 120_000 },
    async () => {
      useUiStore.setState({ prospectiveMapping: true });
      await openZork();
      await settled();

      const transcriptLenBefore = useEngineStore.getState().transcript.length;
      await sendAndSettle('n');

      // The player's own move must be in the transcript (probe turns must not be),
      // and the map must be at North of House with West of House fully scouted.
      expect(useEngineStore.getState().transcript.length).toBe(transcriptLenBefore + 1);
      expect(useMapStore.getState().graph.currentRoomId).toBe('north-of-house');

      await sendAndSettle('open mailbox');
      // Wrong-room regression guard: the command must have executed at North of House
      // (no mailbox there) — if probing swallowed or displaced it, this text differs.
      const lastResponse = useEngineStore.getState().transcript.at(-1) ?? '';
      expect(lastResponse.toLowerCase()).toContain("can't see any mailbox");

      await sendAndSettle('w');
      expect(useMapStore.getState().graph.currentRoomId).toBe('west-of-house');
    },
  );

  it(
    'survives a long walk (far past the ~20-rewind /undo ceiling) without wedging',
    { timeout: 240_000 },
    async () => {
      useUiStore.setState({ prospectiveMapping: true });
      await openZork();
      await settled();

      // Regression for the "froze after ~80 turns" report: the original probe rewind
      // used Bocfel's /undo meta-command, which corrupts the emglken WASM interpreter
      // after roughly twenty uses — the VM permanently stops answering input. This
      // wander spawns a probe burst in nearly every room (several rewinds each), far
      // exceeding that ceiling; every player command must still land and settle.
      const walk = [
        'n', 'e', 'e', 'e', 'w', 'w', 'n', 'w', 'n', 'e',
        's', 'w', 's', 'e', 'e', 'n', 'n', 's', 'w', 's',
        'e', 'e', 'e', 'd', 'u', 'w', 'w', 'w', 'n', 'w',
      ];
      for (const cmd of walk) {
        await sendAndSettle(cmd, 60_000);
      }
      const s = useEngineStore.getState();
      expect(s.inputType).toBe('line');
      expect(s.probing).toBe(false);
      expect(s.traveling).toBe(false);
      // The map grew substantially and never minted an undo/restore junk edge.
      const graph = useMapStore.getState().graph;
      expect(Object.keys(graph.rooms).length).toBeGreaterThan(10);
      expect(
        graph.edges.some(
          (e) => e.dir.toLowerCase().includes('undo') || e.dir.toLowerCase().includes('restore'),
        ),
      ).toBe(false);
    },
  );

  it(
    'a command typed during a probe burst is not lost or rewound',
    { timeout: 120_000 },
    async () => {
      useUiStore.setState({ prospectiveMapping: true });
      await openZork();
      await settled();

      const store = useEngineStore.getState();
      // Trigger a burst (new room = unexplored directions), then submit a player
      // command the moment probing flips on — exactly what CommandBar lets a fast
      // typist do. Subscribe rather than poll: a WASM probe burst can finish in less
      // than a polling interval.
      const transcriptLenBefore = useEngineStore.getState().transcript.length;
      const probingSeen = new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('probing never started')), 20_000);
        const unsubscribe = useEngineStore.subscribe((s) => {
          if (s.probing) {
            clearTimeout(timer);
            unsubscribe();
            resolve();
          }
        });
      });
      store.sendCommand('n');
      await probingSeen;
      store.sendCommand('e');
      // Both player turns must commit ('e' replays after the cancelled burst unwinds).
      await vi.waitFor(
        () => {
          const s = useEngineStore.getState();
          expect(s.transcript.length).toBe(transcriptLenBefore + 2);
        },
        { timeout: 30_000, interval: 25 },
      );
      await settled();

      // The player must end up where their commands said: n then e = Behind House.
      expect(useMapStore.getState().graph.currentRoomId).toBe('behind-house');
      const transcript = useEngineStore.getState().transcript;
      expect(transcript.at(-1) ?? '').toContain('Behind House');
    },
  );
});
