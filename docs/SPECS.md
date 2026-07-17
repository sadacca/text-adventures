# Implementation Specs

Companion to [`IMPLEMENTATION_PLAN.md`](IMPLEMENTATION_PLAN.md). That document says *what*
to build and why; this one pins down the *exact* contracts — types, schemas, tables,
component inventory, and per-task checklists — so the implementing model makes as few
judgment calls as possible. When code and this doc disagree mid-implementation, update
this doc in the same commit.

Two decisions made by the owner (2026-07-12), reflected throughout:

1. **Hosting: GitHub Pages** is the primary way the phone reaches the app (HTTPS, so
   PWA install/offline/service-worker all work). Local dev server remains for development.
2. **One playthrough per game.** Each game has exactly one live bundle
   (autosave + map + transcript). "Restart" wipes the bundle after a confirm dialog.
   Named in-game saves are restore points within that single playthrough.

---

## 1. Core TypeScript types (`src/engine/types.ts`, `src/map/graph.ts`)

```ts
// ---- engine/types.ts ----

/** Events emitted by the protocol tap. All features consume ONLY these. */
export type GameEvent =
  | { kind: 'command';      text: string; turn: number }          // player line input as sent
  | { kind: 'status_line';  left: string; right: string; raw: string[][]; turn: number }
      // left: usually room name; right: usually score/moves or time.
      // raw: full grid-window rows (array of rows of strings) for games with custom status.
  | { kind: 'buffer_text';  text: string; turn: number }          // main-window text since last input
  | { kind: 'input_requested'; type: 'line' | 'char'; turn: number }
  | { kind: 'quit';         turn: number };

/** turn: monotonically increasing counter, incremented on each 'command'. Starts at 0. */

export interface EngineHandle {
  start(story: Uint8Array, opts: { autorestore: boolean }): Promise<void>;
  sendCommand(text: string): void;      // programmatic input (compass rose, travel)
  on(listener: (e: GameEvent) => void): () => void;   // returns unsubscribe
  saveAutosave(): Promise<Uint8Array>;  // opaque snapshot blob
  stop(): Promise<void>;

  // Added in Task 1.5. `start()`'s `opts.autorestore` only works if `preloadAutosave`
  // was called first — the engine has no IndexedDB access of its own (see Task 1.3's
  // decision-gate note): the caller fetches bytes via storage/autosaves.ts and hands
  // them in. Likewise, `saveAutosave()` returns bytes for the *caller* to persist as a
  // new generation; the engine itself never touches IndexedDB.
  preloadAutosave(bytes: Uint8Array): void;
  // Player-typed SAVE/RESTORE (distinct from our silent autosave) round-trip through
  // these two hooks instead of a raw file-picker: 'save' resolves to a chosen name (or
  // null to cancel), 'restore' resolves to a chosen name *plus* that save's previously
  // written bytes (the caller reads them from storage/saves.ts and hands them back so
  // the engine can preload them before the interpreter's RESTORE reads the file).
  onNamedSavePrompt(handler: (kind: 'save' | 'restore') => Promise<{ name: string; bytes?: Uint8Array } | null>): void;
  onNamedSaveWritten(listener: (name: string, bytes: Uint8Array) => void): () => void;

  // Added in Task 1.4. Every raw RemGlk/GlkOte wire message, tagged with direction,
  // exactly as observed — what DebugConsole's "record fixture" toggle buffers and
  // downloads as `.jsonl` (see engine/protocol-tap.ts's `RawMessage` and §6 below).
  onRaw(listener: (raw: RawMessage) => void): () => void;
}
```

```ts
// ---- map/graph.ts ----

export type Direction =
  | 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw'
  | 'up' | 'down' | 'in' | 'out';

export interface RoomNode {
  id: string;              // slug of normalized name + optional '#2' disambiguator
  name: string;            // display name as seen in status line
  pos: { x: number; y: number };  // grid coords, assigned by layout
  posLocked: boolean;      // true once user drags the room (layout must not move it)
  note?: string;
  flags: { unknown?: boolean; teleportTarget?: boolean; userCreated?: boolean };
  firstDescription?: string;  // first buffer_text on first arrival (feeds phase 3 art)
  floor?: number;           // Batch 4 / UX-20 — see note below; undefined reads as 0
  floorLocked?: boolean;    // Batch 4 / UX-20 — true once a user sets floor directly
}

export interface RoomEdge {
  from: string;            // RoomNode.id
  to: string;
  dir: Direction | string; // compass word, OR (rule 4, revised 2026-07-13) the raw
                           // command text for a non-compass move that still changed
                           // rooms — see rule 4 below.
  status: 'confirmed' | 'inferred';  // inferred = auto-added reverse edge
  userDeleted?: boolean;   // tombstone: automapper must never re-add this edge
}

export interface MapGraph {
  rooms: Record<string, RoomNode>;
  edges: RoomEdge[];       // uniqueness key: (from, dir)
  currentRoomId: string | null;
  aliases: Record<string, string>;  // added in Task 1.6, see note below
}
```

**2026-07-13 addition (Task 1.6):** `MapGraph.aliases` maps a lowercased room name to the
canonical room id it was merged into (rule 7: "user-merged rooms keep a merge alias
table"). Populated by `mergeRooms()` in `src/map/graph.ts`; not in the original sketch
above but required to make rule 7's third clause actually testable/implementable. Every
room-name lookup checks `aliases` first, before the normal name-matching/disambiguation
path.

**2026-07-16 addition (Batch 4 / UX-20, multi-level maps — data model half):**
`RoomNode.floor`/`floorLocked` (undefined `floor` reads as 0 everywhere). Auto-inferred
by `Automapper.applyFloor`, called right after a destination room is resolved in both
`handleMovement` and the true-teleport bootstrap path: `up`/`down` moves set the
destination's floor to the origin's `floor ?? 0` plus/minus one; every other case
(a teleport/bootstrap with no origin) defaults to floor 0; `in`/`out` moves never touch
floor at all — deliberate, since entering/leaving a structure doesn't imply a level
change in IF convention (Zork's own house interior/exterior share a floor). Once a
room's `floor` is set — by inference OR by `setRoomFloor` (the `RoomEditSheet` "Floor"
field, UX-21, which also sets `floorLocked`) — it is never overwritten again, the same
"never destroy established data" policy `posLocked`/rule 7 already use. `computeLayout`
(`src/map/layout.ts`) groups rooms by floor and lays out each independently; `MapScreen`
renders one floor at a time with a floor switcher, rendering cross-floor `up`/`down`
edges as tappable stubs rather than lines to an undrawn room. See §5's component
inventory note and `docs/MOBILE_UX_TODO_2.md`'s UX-20/UX-21 entries for the full design.

## 2. Direction normalization table (`src/map/directions.ts`)

| Input (case-insensitive, also with "go " prefix) | Canonical | Opposite | Grid offset (dx, dy) |
|---|---|---|---|
| n, north | `n` | `s` | (0, -1) |
| s, south | `s` | `n` | (0, 1) |
| e, east | `e` | `w` | (1, 0) |
| w, west | `w` | `e` | (-1, 0) |
| ne, northeast | `ne` | `sw` | (1, -1) |
| nw, northwest | `nw` | `se` | (-1, -1) |
| se, southeast | `se` | `nw` | (1, 1) |
| sw, southwest | `sw` | `ne` | (-1, 1) |
| u, up | `up` | `down` | (0.5, -1.35) rendered as short raised stub |
| d, down | `down` | `up` | (-0.5, 1.35) rendered as short lowered stub |
| in, enter | `in` | `out` | no offset — place at nearest free cell, edge drawn curved |
| out, exit, leave | `out` | `in` | no offset — same rule as `in` |

Commands that are movement but NOT mappable as a direction (`climb tree`, `enter house`
with object, vehicle verbs): treat as non-movement; if the room changes anyway, apply
the teleport rule (unconnected room, `teleportTarget` flag).

## 3. Automapper rules (normative — each is a vitest case, Task 1.6)

Given the `GameEvent` stream, on each `status_line` following a `command`:

1. **Movement + room changed** → ensure destination room exists; upsert edge
   `(from, dir) → to` as `confirmed`; add reverse edge `(to, opposite) → from` as
   `inferred` unless an edge with that key already exists or is tombstoned.
   (refined 2026-07-15 — see rule 6's second note below) "Upsert" no longer means
   blindly overwriting an existing CONFIRMED edge's target on contradiction — that
   almost always means `from` was a text-ambiguous merge of two distinct rooms, not a
   real change in geography, so it splits off a fresh sibling room instead
   (`splitRoomForContradiction`) rather than destroying the earlier, correct data.
2. **Movement + room unchanged** → no edge (blocked). Do not create anything.
   (revised 2026-07-15 — see note below): "unchanged" means the status-line name is the
   same AND the turn's prose did not announce an arrival. Games re-print the destination
   room's title line on every successful move, so a compass move whose prose contains a
   line equal to the (unchanged) status-line name is a REAL move between two same-named
   rooms (Zork: "Forest" -east-> "Forest") — treat it as rule 1/6 movement, including
   the possibility of a genuine self-loop (no inferred reverse is added for a
   self-loop). Non-compass commands ("look") also re-print the title and stay no-ops.
   (revised 2026-07-16 — see note below) "Do not create anything" still means no edge,
   but the blocked compass direction IS recorded on the current room's
   `blockedDirections` (passive fingerprint only, exactly like `mentionedDirections` —
   see rule 6). If the room already has a CONFIRMED edge in that exact direction, the
   two observations directly contradict each other — the same text-ambiguous-merge
   signal as rule 6's split-on-contradiction, handled the same way (`currentRoomId` is
   corrected to a compatible sibling, or a fresh one; no edge is created either way).
3. **Inferred edge later traversed** → promote to `confirmed`; if traversal lands in a
   DIFFERENT room than the inferred edge claimed (one-way passage), delete the inferred
   edge and create a confirmed edge to the actual destination.
4. **Non-compass command + room changed** (revised 2026-07-13 — see note below):
   if there's a known origin room (`currentRoomId` is a real, non-`unknown` room), this
   is a real, repeatable connection — "climb ladder", "go around house", "enter
   window" — not a one-off teleport, so link it: upsert edge `(from, dir) → to` as
   `confirmed`, where `dir` is the exact raw command text (not a compass word). Unlike
   rule 1, **no inferred reverse edge is added** — a custom edge label has no known
   opposite, so a link back only appears once the reverse command is actually traversed
   (at which point it's just a fresh rule-1-style upsert with its own label). True
   teleport rule (unchanged): if there's *no* known origin room (the very first room of
   the game, or leaving the shared `(unknown)` singleton) → room created/found with no
   edge, flagged `teleportTarget`; `currentRoomId` updated.
   **2026-07-13 note:** originally this rule always dropped the edge and only flagged
   `teleportTarget` — real non-cardinal exits (ladders, windows, "go around the house")
   were indistinguishable from genuine one-off teleports (a spell, being dragged
   somewhere) by command text alone, so they were losing connectivity on the map. Owner
   decision: prefer linking (the common case) over correctly excluding the rare true
   teleport; a spuriously-linked one-off can still be removed via the existing
   long-press "delete" edge action.
5. **Status line has no recognizable room name** (dark room, custom status) → current
   room becomes the shared `(unknown)` node (id `unknown`), no edges recorded until a
   real room name reappears.
6. **Same name, contradictory geography** (arriving via a direction that already maps
   elsewhere from the same origin — e.g. "Maze" rooms) → create `name#2`, `#3`, ….
   (revised 2026-07-15 twice, 2026-07-16 — see notes below) Disambiguation order,
   strongest signal first: merge/rename aliases (rule 7); the already-traversed forward
   edge `(from, dir)` when its target has the arriving name (retracing a known exit
   never re-opens disambiguation); the room-description fingerprint (first sentence of
   the arrival paragraph, captured into `firstDescription` on first visit — printed even
   in brief mode) — if it matches exactly ONE existing candidate, that candidate IS the
   room, full stop, skipping straight past every check below (a confirmed content match
   outranks a topological guess); **hub preference** — if `fromId` already has SOME
   CONFIRMED edge to a candidate via a DIFFERENT direction, that candidate wins, checked
   BEFORE and independent of reverse-edge compatibility below (a room reachable from
   several unrelated directions, like Zork's Mountains whose n/s/w all converge on one
   "dimly lit forest" room — the map's own "passageway returning to room of origin"
   symbol — has no reason its *other*, unrelated edges should agree with this arrival's
   direction, so gating hub preference behind that check would let it veto the very
   candidate it exists to catch); only once both of those are exhausted does
   reverse-edge compatibility break a remaining tie, where a candidate is excluded if
   its CONFIRMED reverse edge points elsewhere, OR its recorded `blockedDirections`
   contains the reverse direction (rule 2) — a room can't simultaneously be "confirmed
   passable" and "confirmed blocked" the same way — while an *inferred* reverse edge
   pointing elsewhere is no contradiction (it's the automapper's own guess, and
   asymmetric exits routinely falsify it). Whenever resolving an arrival to an existing
   room would require silently overwriting an already-CONFIRMED, unrelated edge on that
   room (evidence of a text-ambiguous merge of two distinct physical rooms, not a real
   change of geography — see rule 1's note), split off a sibling instead of clobbering
   it — reusing an existing COMPATIBLE sibling (one whose own confirmed edges and
   `blockedDirections` don't ALSO contradict this observation) if one already exists,
   rather than always minting a brand new one (which used to spawn a fresh duplicate
   every time the same real room re-triggered the same contradiction).
7. **User edits win, forever**: `posLocked` positions never re-laid-out; `userDeleted`
   edges never re-added; user-merged rooms keep a merge alias table so future arrivals
   at either name resolve to the merged node.
8. **Room-name normalization**: trim; strip trailing score/moves fragments; collapse
   whitespace; case-preserving but case-insensitive matching.

Tap-to-travel (Task 1.8): BFS over `confirmed`, non-tombstoned edges only. Send one
movement command, wait for the resulting `status_line`; abort (with a toast) if the
room reached ≠ expected next room, if any `buffer_text` contains a line ending in `?`
(prompt/question), or if `input_requested.type === 'char'`. **Warn before long trips**:
paths > 8 moves show a confirm ("uses N turns — lamp/hunger timers burn down"), because
turns are a resource in many Infocom games.

**2026-07-15 note (Zork 1 forest mapping — rules 2 & 6 revised, status_line
turn-aligned):** real play in Zork 1's above-ground area (three rooms named "Forest",
two named "Clearing", asymmetric exits around the house) exposed three automapper bugs:
(a) same-named distinct rooms were conflated because rule 6's reverse-edge check treats
"no reverse edge yet" as compatibility — the map ended up with one "Forest" node on
BOTH sides of Forest Path, and every retrace then rerouted confirmed edges back and
forth; (b) moves between two same-named rooms were dropped as rule-2 blocked moves;
(c) unique rooms were split into spurious `#2`s because an *inferred* reverse edge
pointing elsewhere was treated as contradicting geography (Behind House -s-> South of
House, whose real `n` is a boarded wall). Fixes: rules 2 and 6 as revised above —
arrival-announcement detection, `firstDescription` fingerprints (now actually populated
by the Automapper from each turn's prose), forward-edge stickiness, and
inferred-doesn't-veto. Alongside, `ProtocolTap` now emits `status_line` once per turn
(from the input-request flush) instead of once per grid repaint: Bocfel can split
mid-turn repaints across protocol updates non-deterministically, and a mid-turn repaint
may still show the previous room, which corrupted the graph; deferring to end-of-turn
also guarantees `buffer_text` always precedes its turn's `status_line`, which the
description capture relies on. Live end-to-end regression: `tests/zork-automap.test.ts`
boots the real bundled zork1.z3 on the real engine and checks both a deterministic
forest/End-of-Rainbow walk against the game's true geography and a seeded 150-move
random walk against description-fingerprint ground truth. Known accepted limitation:
in brief mode a *revisit* to one of several same-named rooms arriving from a
never-before-used direction prints no description, so disambiguation falls back to
geometry and can still pick the wrong sibling (first visits are always fingerprinted —
Infocom's brief mode prints full descriptions for never-visited rooms); Zork's Forest 2
and Forest 3 also share an identical description and are only separable by geometry,
like maze rooms. A possible future improvement is issuing a silent `verbose` at game
start so every arrival is fingerprinted — deliberately NOT done, since it changes the
player-visible transcript (an owner/product call).

**2026-07-16 note (Zork 1 forest maze, round 3 — blocked-direction fingerprinting, sibling
reuse, hub preference):** owner asked for research into further-reducing occasional
duplicate rooms on adversarial walks. Verified empirically first: even `look` in the
game's two textually-identical "dimly lit forest" rooms produces byte-identical output —
there is no passive signal left to exploit; this is an information-theoretic wall, not a
heuristic-tuning gap (active exit-probing or item-drop fingerprinting, both a real
behavioral/product change since the automapper would start sending commands the player
didn't type, are the only ways to fully close it — not implemented, deliberately, pending
a product decision). Chose to still implement the best available *passive* improvement:

1. `RoomNode.blockedDirections?: Direction[]` — mirrors `mentionedDirections`, populated
   whenever a compass move is genuinely blocked (rule 2). Never creates/touches edges.
   Used to widen rule 6 step 5's contradiction check: a candidate whose recorded
   `blockedDirections` contains the reverse direction is excluded exactly like a
   contradicting CONFIRMED edge.
2. A blocked move that contradicts an already-CONFIRMED edge in that exact direction
   (rare but real: "confirmed passable going X" and "just blocked going X" can't both be
   true of one room) now triggers the same identity-split machinery as a contradicted
   successful move, correcting `currentRoomId` without creating any edge.
3. **Found via stress-testing** (40 seeded 400-move random walks through the maze,
   `Object.values(rooms).filter(name==='Forest').length` tracked as a duplicate-count
   proxy): the split-on-contradiction logic from the previous round always minted a
   BRAND NEW sibling on every contradiction, so the SAME real physical room bouncing off
   the SAME wall repeatedly (or contradicting the SAME edge repeatedly) kept spawning a
   fresh `#N` every time instead of converging — up to 8 spurious "Forest" nodes in one
   400-move run. Fixed with `findCompatibleSiblingOrSplit`: before minting a new sibling,
   search existing same-name/same-description siblings for one whose own recorded
   signature (confirmed edges + blockedDirections) doesn't ALSO contradict this
   observation; reuse it if found. Both `handleMovement`'s and the new blocked-move
   contradiction path now go through this.
4. **Found via the same stress-testing, then isolated with temporary trace
   instrumentation**: even after (3), node count kept slowly climbing (up to 7 in 400
   moves) because mountains' 3 independent entrances to the SAME room (n/s/w — the map's
   "returning to origin" symbol) could each resolve to a DIFFERENT existing same-
   described sibling, since step 5's reverse-edge/blocked-direction check has no reason
   any two of those three unrelated entrances should agree, and (2)'s own widening
   actively made this WORSE by excluding the genuinely-correct sibling (whose real
   reverse direction happens to be blocked — true, but irrelevant to a convergent
   entrance). Fixed by adding step 4, hub preference, checked BEFORE and independent of
   the reverse-edge/blocked-direction contradiction check: if the origin already has some
   OTHER confirmed edge to a candidate, prefer it outright.

Net effect, same 40×400-move stress harness: worst-case spurious "Forest" nodes dropped
from 8 to 6 (typically 4-6 against a true minimum of 4 real "Forest"-named physical
rooms, one pair of which — forest2/forest3 — is genuinely text-indistinguishable and
unavoidably produces at least one extra node). **The invariant that actually matters held
perfectly across all 16,000 stress-tested moves: not one already-confirmed edge was ever
silently rerouted.** Residual slow growth beyond the true minimum is the passive-
observation ceiling described above, not a bug; closing it further needs option 1 (active
exit-probing) or 2 (item-drop fingerprinting) from the research discussion, both deferred
pending a product call on whether the automapper may act, not just observe. New unit
tests in `tests/graph.test.ts` (rule 2 and rule 6 sections) cover blocked-direction
recording, split-then-reuse (not re-split) on a repeated identical contradiction, and hub
preference specifically overriding a blocked-direction exclusion.

**2026-07-15 note, later same day (Zork 1 forest maze — rule 6 refined again, split-on-
contradiction):** the note above undersold the problem — owner testing with the game's
own official map (a hand-drawn reference showing four "Forest" boxes and a "passageway
returning to room of origin" symbol) surfaced two more bugs, found by exhaustively
DFS-probing the real interpreter (reboot + replay each path prefix from true game start,
since this z-machine release has no `undo`) to build an independent, deterministic
ground-truth transition table rather than trusting the hand-drawn map's exact routing:
(a) a room reachable from **several unrelated directions that don't correspond to each
other** (Zork: Mountains' `n`, `s`, AND `w` all loop back to the very same "dimly lit
forest" room — confirmed live, not assumed, by cross-probing that every one of those
three arrivals has an identical further-exit map) was still being split into spurious
`#2`/`#3`/`#4` duplicates, because the previous "reverse-edge compatibility" step could
still veto an exact `firstDescription` match: the matched room's reverse edge at
`opposite(compassDir)` belonged to a *different, unrelated* entrance and pointed
elsewhere, which was wrongly read as contradicting geography. Fixed: when the
description fingerprint narrows candidates to exactly ONE, that candidate is the room,
full stop — step 4 (reverse-edge tie-break) is skipped entirely, not just soft-preferred.
Step 4 still runs when text is genuinely ambiguous (>1 candidate share the identical
description, or none has one yet). (b) Once text-genuinely-indistinguishable rooms
merge (Zork's two "dimly lit forest" rooms, confirmed via divergent live behavior to be
physically distinct — no automapper can avoid this merge from prose alone), the merged
node's own already-CONFIRMED edges would get silently overwritten the moment the
*other* physical instance's real geography contradicted them — this is precisely the
original bug report's "map gets overwritten in ways that are not quite right" on
retracing. Fixed: `handleMovement` no longer clobbers a confirmed edge's target on
contradiction (`splitRoomForContradiction`); instead it splits off a fresh sibling room
(inheriting the shared name/description, so future arrivals can still land on either
sibling via step 4's tie-break) and attaches the new edge there, leaving the original's
confirmed data untouched. This trades perfect disambiguation (impossible here — even
Zork's own official map's inconsistent Forest-box count suggests its human cartographer
hit the same wall) for the one invariant that actually matters: previously-confirmed
data is never silently destroyed. Live regression: `tests/zork-maze.test.ts` walks this
exact maze adversarially and asserts no confirmed edge's target ever changes once set,
plus that every genuinely-unique room (Forest Path, both Clearings, Behind House, South
of House) resolves to exactly one node throughout. Synthetic unit coverage for both
fixes lives in `tests/graph.test.ts` (rule 6 section).

**2026-07-14 note (UX-18, Task 1.10's detection/diffing half):** `RoomNode` gained
`mentionedDirections?: Direction[]` — the 8 unambiguous full compass words
(n/s/e/w/ne/nw/se/sw only; word-boundary matched, so "northern"/"westward" don't count)
found in a room's `buffer_text` since arrival, via `src/map/mentions.ts`'s
`detectMentionedDirections`. `Automapper` accumulates `buffer_text` into a per-turn
`pendingText` and attaches it to whichever room the turn's `status_line` resolves to
*after* `handleStatusLine` runs (so movement text attributes to the arrival room, not the
origin). Accepted limitations: negations ("no exit to the south") still match, and exits
described without a direction word are missed — this is why the UI treats these as
dashed, distinctly-styled *suggestions* (`ExitsRow`'s `?`-suffixed chips,
`CompassRose`'s `.compass-suggested`), never real edges: they never enter `edges`, never
participate in tap-to-travel's BFS, and detection never un-records a mention once a
confirmed edge later exists in the same direction (that's the UI-level diffing hook's
job, `useSuggestedExits` in `src/story/useKnownExits.ts`, not the graph's). Map rendering
of suggestions (Task 1.10's other half) is still not built.

**2026-07-17 note (UX-26, retrace chip):** `mapStore` gained `lastMoveDir: Direction |
null`, tracking the compass direction of the last *successful* movement so `ExitsRow`
can offer a one-tap "retrace" chip (`opposite(lastMoveDir)`). This is purely UI-derived
session state, computed in `mapStore.handleEvent` by comparing `currentRoomId` before
and after each `status_line`'s automapper call against a pending direction stashed off
the preceding `command` event — it is **not** part of `MapGraph`, is never persisted,
and never affects edge resolution or any of the rules above. Cleared on a blocked move,
a teleport, boot, and game switch.

## 4. IndexedDB schema (`src/storage/db.ts`, via `idb`)

Database `text-adventures`, version 3 (see the dated notes below for the migration
history). One playthrough per game ⇒ `gameId` is the key almost everywhere.

| Store | Key | Value | Notes |
|---|---|---|---|
| `games` | `gameId` (string = sha256 of story bytes, hex, first 16 chars) | `{ gameId, title, fileName, bytes: ArrayBuffer, format: 'zcode'\|'blorb', addedAt, lastPlayedAt }` | title editable by user |
| `autosaves` | `[gameId, generation]` | `{ gameId, generation: number, snapshot: ArrayBuffer, turn, savedAt }` | keep newest 3 generations; prune on write |
| `saves` | `[gameId, name]` | `{ gameId, name, quetzal: ArrayBuffer, turn, savedAt }` | named in-game saves; export = download this blob |
| `maps` | `gameId` | `MapGraph` (JSON-serializable) | whole graph as one record; write-behind, debounced 500 ms |
| `transcripts` | `gameId` | `{ gameId, entries: { turn, command, response }[] }` | ring-buffer capped at 2000 entries |
| `scoreLog` | `gameId` | `{ gameId, entries: { turn, amount, command, room }[] }` | ring-buffer capped at 500 entries (UX-29) |
| `verbStats` | `gameId` | `{ gameId, counts: Record<string, number> }` | per-verb usage counts (UX-32) |
| `settings` | fixed key `'app'` | `{ theme, fontSize, llm?: { provider, model }, art?: {...} }` | **API keys live in `localStorage`, NOT here** |

Restart flow: confirm dialog → delete `autosaves`, `maps`, `transcripts`, `scoreLog`,
`verbStats` rows for `gameId` (keep `games` and named `saves`) → start fresh.

**2026-07-14 note (UX-15):** the `settings` IndexedDB row sketched above was never built.
`src/state/uiStore.ts` instead persists `theme`/`fontScale`/`storyFont` via zustand's
`persist` middleware to a single `localStorage` key, `text-adventures-settings` — this is
what actually achieves "no light-theme flash," since it rehydrates synchronously before
first paint, which an async IndexedDB read cannot. All other `uiStore` fields (`tab`,
`commandDraft`, `commandHistory`, `debugConsoleEnabled`, `roomEditTarget`) are session
state and are explicitly excluded via `partialize`.

**2026-07-14 note (UX-19):** the persisted slice above gained a fourth field,
`highlightVocab` (default `true`) — the "Highlight known words" settings toggle.

**2026-07-16 note (UX-22):** `autosaves.ts` gained `stepBackAutosaveGeneration`, which
deletes the newest generation and returns the one before it — i.e. "game state one move
ago" — and `transcripts.ts` gained `trimTranscriptAfterTurn`, which drops any transcript
entry past a given turn. Together these power `engineStore.undoLastMove()`: a single-step
Undo that rewinds storage then reopens the game through the normal `openGame` resume
path. Scope decision: single-step only (the existing `KEEP_GENERATIONS = 3` pruning window
doesn't reliably support more), and the automapper's map graph is deliberately NOT rolled
back — a stray room/edge from the undone move stays in the graph, same as any other
mis-inference the player would otherwise fix by hand (§3's "the automapper never undoes a
manual change").

**2026-07-16 note (UX-24):** confirmed via a real Border Zone (historicalsource, Release
9/871008) capture that asyncglk's Glk timer loop (`GlkOteBase`'s own `setInterval`/
`ontimer`) genuinely fires end-to-end already, with zero code from this repo involved —
but found a real bug in the interaction with this app's own per-turn background
autosave: `ProtocolTap.silent` stays `true` from the autosave's own silent SAVE command
until the player's NEXT real command, so any timer-triggered `input_requested`/
`buffer_text` arriving in that (normally-idle) window inherited `silent: true` and would
be dropped by every consumer's `isSilent` gate — not delayed, permanently lost.
`BridgeGlkOte.ontimer()` (`src/engine/glkote-bridge.ts`) now overrides asyncglk's
`ontimer()` to call the new `ProtocolTap.handleTimerTick()`, which resets `silent` to
`false`, but only when `!this.waiting_for_update` (a real request, e.g. that same
autosave, still in flight) — guarding against incorrectly unmasking an in-flight silent
round-trip's own response. Live-verified via DebugConsole's `[silent]` tags against the
real game: before the fix, every timer tick after the per-turn autosave showed
`input_requested (line) [silent]`; after, they show plain `input_requested (line)`.

**2026-07-17 note (UX-29): first real schema migration, DB bumped to version 2.** New
`scoreLog` store, keyed by `gameId`, holding `{ gameId, entries: { turn, amount, command,
room }[] }` — same single-record-per-game shape as `transcripts`, capped at 500 entries.
Every prior store was created unconditionally in version 1's `upgrade` callback (no
migration had ever actually run), so this is the first use of `idb`'s `oldVersion` gate:
`upgrade(db, oldVersion)` now wraps the original version-1 stores in `if (oldVersion <
1)` and adds `scoreLog` in `if (oldVersion < 2)` — existing rows in every other store are
untouched. Future stores should extend this same ladder rather than re-creating the
whole callback. Wired into `deleteGame`/`restartPlaythrough` alongside the other
per-playthrough stores.

**2026-07-17 note (UX-32): DB bumped to version 3.** New `verbStats` store, keyed by
`gameId`, holding `{ gameId, counts: Record<string, number> }` — per-verb usage counts
for `VerbChips`' learned-verb chips. Added via `if (oldVersion < 3)`, following UX-29's
ladder pattern exactly. Wired into `deleteGame`/`restartPlaythrough`.

## 5. Component inventory (React, `src/`)

| Component | File | Responsibility |
|---|---|---|
| `App` | `App.tsx` | Router-less tab shell: Library ⇄ (Story / Map / More) |
| `LibraryScreen` | `library/LibraryScreen.tsx` | upload, list, resume, delete, restart |
| `StoryScreen` | `story/StoryScreen.tsx` | GlkOte mount point + scroll management |
| `CommandBar` | `story/CommandBar.tsx` | input field (soft-keyboard attrs per Task 1.7), send button, history swipe |
| `VerbChips` | `story/VerbChips.tsx` | one scrollable row; config in `story/verbs.ts` |
| `CompassRose` | `story/CompassRose.tsx` | collapsed 48px fab → expanded 3×3 + U/D/IN/OUT; known exits highlighted (subscribes to MapGraph) |
| `ExitsRow` | `story/ExitsRow.tsx` | (2026-07-14, UX-6) row of confirmed-exit chips below the status line, sharing `useKnownExits()` with `CompassRose` |
| `TapWords` | `story/TapWords.tsx` | wraps buffer text; word-tap appends to CommandBar draft |
| `MapScreen` | `map/MapScreen.tsx` | SVG canvas, pan/pinch (Pointer Events), selection; Batch 4 / UX-21 floor switcher (renders one floor at a time, cross-floor up/down edges as tappable stubs) |
| `RoomEditSheet` | `map/RoomEditSheet.tsx` | long-press bottom sheet: rename/note/merge/delete |
| `MoreScreen` | `more/MoreScreen.tsx` | saves list + export/import, settings, about/licenses |
| `DebugConsole` | `debug/DebugConsole.tsx` | live GameEvent stream; hidden behind settings toggle |

State: use **zustand** (tiny, no boilerplate) with three stores: `engineStore`
(status, current game), `mapStore` (MapGraph + actions), `uiStore` (tab, drafts,
sheets). No Redux, no context pyramids.

**2026-07-14 note (UX-19):** `src/engine/dictionary.ts` is a pure story-file parsing
module (no WASM, no DOM) that reads the Z-machine parser dictionary directly out of the
uploaded story bytes, so `TapWords` can bold words the game's parser actually
understands ("you can type this") — fully offline, no LLM. Toggled off via the "Highlight
known words" row in `MoreScreen` (`uiStore.highlightVocab`, default on).

## 6. Protocol fixtures (`tests/fixtures/`)

Format: JSON Lines, one RemGlk/GlkOte message per line, direction-tagged:

```json
{"dir":"out","msg":{...glkote update json...}}
{"dir":"in","msg":{"type":"line","gen":3,"window":1,"value":"north"}}
```

Capture: DebugConsole gets a "record fixture" toggle that buffers tapped messages and
downloads the `.jsonl`. Commit at least: (a) a 15-turn walk in a free z5 game,
(b) a v3 game session including one blocked exit and one dark room, (c) a save/restore
round-trip. Unit tests replay fixtures through the protocol tap and assert the emitted
`GameEvent` sequence — no WASM in CI.

## 7. Hosting & deploy (GitHub Pages)

- `vite.config.ts`: `base: '/text-adventures/'` (repo name); service worker + manifest
  paths must respect the base (use `vite-plugin-pwa`, `scope`/`start_url` under the base).
- GitHub Actions workflow `.github/workflows/deploy.yml`: on push to the default
  branch → build → upload artifact → `actions/deploy-pages`. Enable Pages
  (source: GitHub Actions) in repo settings — flag this to the owner at first deploy,
  it's a manual step.
- Story files, saves, maps stay in the browser (IndexedDB) — nothing user-specific is
  ever committed or uploaded; the Pages site is a static shell. State is **per
  browser+device**; cross-device sync is out of scope (Quetzal export/import is the
  manual bridge).
- WASM must be served from the site itself with correct `application/wasm` type
  (GitHub Pages does this) and precached by the service worker.
- **Gotcha (found 2026-07-13):** emglken's `bocfel.js` has an internal fallback that
  requests its own `.wasm` by an unhashed literal filename, which the production build
  never emits (Vite only emits the content-hashed name). Left unhandled, that request
  404s and GitHub Pages' SPA-style fallback serves back `index.html`, permanently
  stuck-on-loading. `vite.config.ts`'s `emglkenWasmFallback` plugin copies an unhashed
  `bocfel.wasm` alongside the hashed one at build time so both URLs resolve. If emglken
  is ever upgraded and this plugin is removed, re-verify with an actual `npm run build
  && npm run preview` — `npm run dev` cannot catch this class of bug (see
  IMPLEMENTATION_PLAN.md Task 1.3 outcome notes).
- Local dev on desktop: `npm run dev`. On-phone testing before Pages is set up:
  `npm run dev -- --host` works for layout checks, but PWA/offline features only
  fully function on the HTTPS deployment (documented limitation, don't chase it).

**2026-07-14 note (UX-17):** `public/zork1.z3` is committed as the bundled sample game —
the one exception to the "never commit story files" rule (`.gitignore` carves it out
explicitly). It's Microsoft's 2025 MIT-licensed historical-preservation release of Zork I
(`historicalsource/zork1`'s `COMPILED/zork1.z3`), not the originally-planned
`advent.z5`/ifarchive.org — that source was unreachable from this environment's network
policy, while `raw.githubusercontent.com` was. Precached by the service worker
(`vite.config.ts`'s `globPatterns` gained `z3`) so "Add sample game" works fully offline
after first load, same as the rest of the app shell.

## 8. Per-task done-checklists (phase 1)

**1.1 Scaffold** ☑ Vite+React+TS builds ☑ vitest runs an example test ☑ ESLint+Prettier
scripts ☑ `vite-plugin-pwa` with base-aware manifest ☑ tab shell renders at 390×844
☑ `.gitignore` blocks `*.z?/ *.dat/ *.zblorb/ *.blb` ☑ deploy.yml pushes to Pages.

**1.2 Library** ☑ file picker accepts z3/z5/z8/dat/zblorb ☑ sha256 gameId dedupes
re-uploads ☑ list sorted by lastPlayedAt ☑ delete confirms ☑ persists across reload.
(Minimal implementation built alongside Task 1.5, which needed it as a substrate —
no manual "mark room"/rename UI yet, no touch-target audit beyond the 44px CSS rule.
2026-07-13: the "Resume"-label-on-unplayed-game and dead-"Restart" bugs found in
real-device verification are fixed — see PLAN outcome notes.)

**1.3 Engine** ☑ emglken+asyncglk render a z5 AND a z3 game ☑ WASM served locally
(in dev *and* production — see 2026-07-13 outcome note in PLAN and the deploy gotcha
in §7) ☑ autosave snapshot+restore spike proven ☑ decision-gate outcome recorded in
PLAN ☑ engine fully behind `EngineHandle`.

**1.4 Protocol tap** ☑ all messages observed unmodified (`ProtocolTap.onRaw`, both
directions) ☑ GameEvent stream matches fixture expectations (`tests/protocol-tap.test.ts`
against `tests/fixtures/*.jsonl`) ☑ DebugConsole shows live events ☑ fixture recording
works (record toggle -> `.jsonl` download).
(2026-07-13: the RemGlk-parsing logic that lived directly in `glkote-bridge.ts` since
Task 1.3 was extracted into a pure `src/engine/protocol-tap.ts`; see PLAN outcome notes
for the fixture set and its one deviation — no v3 game file was reachable this session,
so all three fixtures are `advent.z5` (v5) rather than the suggested v3 sample.)

**1.5 Autosave/saves** ☑ snapshot every turn + visibilitychange/pagehide ☑ kill-tab →
reopen resumes with scrollback ☑ 3-generation pruning ☑ in-game SAVE/RESTORE
round-trip ☑ Quetzal export/import ☑ transcript ring-buffer persists.

**1.6 Graph** ☑ vitest case per rule in §3 (8 rules; `tests/graph.test.ts`) + BFS
pathfinding and the two pure travel-abort checks — question-line detection and the
long-trip threshold — in `tests/travel.test.ts` (the room-mismatch and char-input abort
conditions need a live engine to observe; covered once tap-to-travel was wired into the
UI in Task 1.8 — see `tests/travelTo.test.ts` and the 1.8 note below) ☑ serialization
round-trip ☑ debounced (500 ms) persistence (`src/state/mapStore.ts`).
(2026-07-13: implemented directly, skipping ahead of 1.4/1.7 per owner request — see
IMPLEMENTATION_PLAN.md outcome notes. `src/map/graph.ts`, `directions.ts`, `travel.ts`;
storage in `src/storage/maps.ts`.)
(2026-07-13, later same day: rule 4 revised per owner feedback from real play — see the
rule 4 note in §3 above. `RoomEdge.dir` widened to `Direction | string`;
`directions.ts` grew `isCompassDirection()` so `layout.ts`/`travel.ts`/`CompassRose.tsx`/
`MapScreen.tsx` can tell a compass edge from a custom one. `MapScreen.tsx` draws custom
edges with a distinct dotted style and a text label (the command used); `CompassRose`'s
"known exits" highlight only ever considers compass edges, since there's no compass
button for a custom command.)

**1.7 Command input** ☑ no-typing traversal test passes (verb chip + tap-word compose
"take lamp" and it's actually taken — Playwright, 390×844) ☑ keyboard stays open across
sends (input is never `disabled`, only its Send button) ☑ input visible above keyboard
(visualViewport-derived inset in `useKeyboardInset.ts`; not verified on a real device —
see PLAN outcome notes) ☑ "xyzzy" survives uncorrected (autocapitalize/autocorrect/
spellcheck confirmed `off`/`off`/`false` on the live input) ☑ tap-a-word appends
☑ history accessible (popover + swipe-up gesture on the input).

**1.8 Map UI** ☑ minimal SVG rendering only (2026-07-13): rooms as boxes (current room
highlighted), edges as lines (dashed only when *no* direction between a pair is
confirmed yet), simple deterministic grid layout (`src/map/layout.ts`) wired live to
real gameplay through `mapStore`/`engineStore`. Verified end-to-end against `advent.z5`
(Playwright, 390×844) — see run notes; screenshot showed 3 rooms/2 edges after a few
moves including a correctly-ignored blocked move.
☑ pan/pinch/tap/long-press/drag (Pointer Events on the SVG root for pan/pinch, per-room
handlers backed by a single `roomGestureRef` — not per-render closures, see PLAN outcome
notes for why that mattered — for tap/long-press/drag; `RoomEditSheet.tsx` is the
long-press rename/note/merge/delete UI) ☑ tap-to-travel (`engineStore.travelTo` sends
the BFS path turn-by-turn and implements all three abort conditions — room mismatch,
`?`-ending buffer text, char-type prompt — verified deterministically against a fake
engine in `tests/travelTo.test.ts`, plus a live Playwright pass confirming the
"no known path over an unconfirmed edge" refusal against a real graph) ☑ user edits
sticky across reload (rename/delete/merge/moveRoom all go through the same
`mapStore`/`saveMap` debounced-persistence path already covered by 1.6's tests; the
live rename was also confirmed to update the on-screen map immediately in the
Playwright pass).
Not verified this session (needs a real device / multi-touch harness — see PLAN outcome
notes): two-finger pinch-zoom and the >8-move long-trip confirm dialog.

**1.9 Polish/offline** ☑ font-size control ☑ dark/light ☑ install prompt ☑ airplane-mode
reload works (simulated) ☑ licenses screen ☐ full on-device session verified (the one
item that genuinely needs real hardware — see note below).
(2026-07-13: first slice only — a "beautification" pass, owner-scoped to exclude
install-prompt/licenses/offline-device-verification for now. Theme (`uiStore.theme`)
and `fontScale` already had store plumbing and a `data-theme`/root-`font-size` effect in
`App.tsx` from scaffolding, but no UI exposed either — added a settings card in
`MoreScreen.tsx` (segmented Light/Dark/System control + an A−/A+ stepper, 85%-140% in
10% steps) and verified both live via Playwright, including that "Dark"/"Light"
correctly override the OS color-scheme rather than just following it. Also added a
shared design-token layer (`index.css`: spacing/radius/shadow custom properties) and a
global `button` reset (native chrome was fighting the existing per-component CSS),
`.btn-primary`/`.btn-danger` variants, and a shared `.empty-state` treatment (icon +
centered text, `flex:1` within the now-flex-column `.screen`) applied across
Library/Story/Map/More's "nothing here yet" states.
**Two real bugs found and fixed along the way, not just cosmetics:** (1) the story
transcript never auto-scrolled — `TapWords.tsx`'s `<pre>` had no ref/effect at all, so a
long session left the player looking at whatever text was on screen when they last
manually scrolled, unaware there was new output below; fixed with a `scrollTop =
scrollHeight` effect keyed on the transcript text. (2) `engineStore.ts`'s
`stripHistoryReplay`'s blank-line collapse (`\n{3,} -> \n\n`) only ever ran on the
branch that found Bocfel's history-playback markers — ordinary turns, including
Adventure's own opening banner (which pads itself with six leading blank lines for a
full-height terminal), passed through untouched, showing as a large dead gap above the
first real text in our scrolling view. Replaced with a `normalizeResponse()` helper
applied to every turn's response: same 3+-blank-line collapse, plus a leading-blank-line
trim gated on `get().transcript.length === 0` (only the transcript's very first chunk,
so normal inter-turn spacing elsewhere is untouched).
Verified via Playwright against a real `advent.z5` session (light + dark + forced
theme override + increased font scale), plus `npm run lint`/`npm test`/`npm run build`.)
(2026-07-13, second slice: licenses screen, install prompt, and offline verification.)
(2026-07-14, UX-4: `engineStore.transcript` changed from a single accumulated `string`
to `string[]` — one entry per turn's response chunk. `TapWords.tsx` is now a memoized
per-chunk block renderer (a `<div className="story-block">`, not a `<pre>`); the scroll
container and its scrollTop-pinning effect moved up to `StoryScreen.tsx`, which now also
does smart scroll pinning (only auto-scrolls to the newest text if the player was
already near the bottom; otherwise shows a "↓ New text" pill). Command-echo lines
(trimmed text starting with `>`) render via `.story-echo` to stand out from game prose.
The `get().transcript.length === 0` "first chunk" check noted above is unchanged in
meaning (array length instead of string length).
(2026-07-14, follow-up: smart pinning alone could hide the reply to the player's own
command behind the pill if they'd scrolled up first. `engineStore` gained
`pinRequestId` (bumped in `sendCommand`, `restoreNamed`, and at the start of
`travelTo` — every player-initiated action, not background/silent events), and
`StoryScreen` re-pins to the bottom and forces `scrollTop` immediately whenever it
changes, so sending a command always surfaces its response regardless of scroll
position.)

- **Licenses/about screen** (`src/more/AboutSection.tsx`, `src/more/licenses.ts`):
  rendered in `MoreScreen` below Saves, one native `<details>` per dependency (name,
  license badge, role, full license text) — no extra JS/state needed for the
  expand/collapse. **Correction to this doc's own prior wording**: SPECS.md and
  IMPLEMENTATION_PLAN.md both said "Bocfel GPL-2.0" — checked the actual upstream
  license (`garglk/garglk`'s `terps/bocfel/LICENSE`, the fork emglken vendors) and it's
  **MIT** (Chris Spiegel), not GPL-2.0. GPL-2.0 code does exist inside emglken's own npm
  bundle (Scare, TADS) — which is why the *package's* `license` field says GPL-2.0 — but
  those interpreters aren't the one this app ships (`bocfel.wasm` only). The licenses
  screen states the correct MIT attribution; treat any earlier "GPL-2.0" mention in
  these docs as superseded by this note.
- **Install prompt** (`src/state/installStore.ts`, wired from `App.tsx`, UI in
  `MoreScreen.tsx`): captures and defers `beforeinstallprompt` (Chrome only fires it
  once per load) behind a settings-card row with an "Install" button; `appinstalled`
  and an initial `display-mode: standalone` check hide the row once actually installed.
  **Verified against the production build** (`vite preview`) with Playwright + a
  *non-incognito* persistent Chrome profile (an ephemeral/incognito context — Playwright's
  default — makes Chrome refuse to fire the event at all, which cost some time to
  diagnose): Chrome's own `Page.getInstallabilityErrors` CDP check returns zero errors,
  `beforeinstallprompt` genuinely fires, our button appears and calls `.prompt()`
  without error. **Lighthouse's PWA category no longer exists** (removed entirely by
  Lighthouse 13, the version available here) — `Page.getInstallabilityErrors` is the
  modern equivalent and is what was actually used to satisfy this acceptance check.
- **Offline verification**: `context.setOffline(true)` in Playwright against the
  production build (not a real device — the honest substitute available here) —
  confirmed (a) a full reload with zero network serves the app shell from the
  workbox precache (12 entries, both the hashed and unhashed `bocfel.wasm` among them)
  rather than a browser offline error page, (b) tab navigation works fully offline, and
  (c) — the acceptance bar that actually matters — uploading and **playing `advent.z5`
  start-to-finish while fully offline works**, proving the WASM interpreter itself
  loads from cache correctly, not just the shell (this is exactly the class of bug
  Task 1.3's deploy gotcha in §7 was about, so it was worth re-checking specifically,
  not just assuming the earlier fix still holds).
- **One real bug caught by this pass's own test run**: `installStore.ts`'s module-level
  `runningStandalone()` called `window.matchMedia` unconditionally, which crashed
  `src/App.test.tsx` under jsdom (no `matchMedia` there) the moment anything imported
  `App.tsx` — guarded behind a `typeof window.matchMedia === 'function'` check.
- **Still open, and genuinely needs real hardware** (not simulable here): the actual
  on-device install banner/home-screen icon on Android Chrome, a real airplane-mode
  reload on a phone, and Task 1.7/1.8's own still-open real-device items (soft-keyboard
  inset, two-finger pinch-zoom, long-trip confirm dialog).

## 9. Known judgment calls already made (do not re-litigate)

- React + zustand + Vite + `idb` + `vite-plugin-pwa`; no router, no CSS framework
  (plain CSS modules); SVG map hand-rolled, no diagram library.
- Status-line room detection over memory peeking (interpreter-agnostic).
- One playthrough per game; restart wipes bundle after confirm.
- GitHub Pages primary hosting; LAN serving is best-effort undocumented.
- Turn counter increments on `command` events only.
- `(unknown)` is a single shared node, not one per dark encounter.
- Suggested-but-unconfirmed exits (parsing "there is a passage to the west" out of room
  text and showing it before the player tries it): the detection/diffing/chips half
  shipped as UX-18 (2026-07-14, §3's note above) — map-rendering of suggestions (the
  other half of `IMPLEMENTATION_PLAN.md` Task 1.10) is still not built.
