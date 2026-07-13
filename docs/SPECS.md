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
}

export interface RoomEdge {
  from: string;            // RoomNode.id
  to: string;
  dir: Direction;
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
2. **Movement + room unchanged** → no edge (blocked). Do not create anything.
3. **Inferred edge later traversed** → promote to `confirmed`; if traversal lands in a
   DIFFERENT room than the inferred edge claimed (one-way passage), delete the inferred
   edge and create a confirmed edge to the actual destination.
4. **Non-movement command + room changed** → teleport rule: room created/found with no
   edge, flagged `teleportTarget`; `currentRoomId` updated.
5. **Status line has no recognizable room name** (dark room, custom status) → current
   room becomes the shared `(unknown)` node (id `unknown`), no edges recorded until a
   real room name reappears.
6. **Same name, contradictory geography** (arriving via a direction that already maps
   elsewhere from the same origin — e.g. "Maze" rooms) → create `name#2`, `#3`, ….
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

## 4. IndexedDB schema (`src/storage/db.ts`, via `idb`)

Database `text-adventures`, version 1. One playthrough per game ⇒ `gameId` is the key
almost everywhere.

| Store | Key | Value | Notes |
|---|---|---|---|
| `games` | `gameId` (string = sha256 of story bytes, hex, first 16 chars) | `{ gameId, title, fileName, bytes: ArrayBuffer, format: 'zcode'\|'blorb', addedAt, lastPlayedAt }` | title editable by user |
| `autosaves` | `[gameId, generation]` | `{ gameId, generation: number, snapshot: ArrayBuffer, turn, savedAt }` | keep newest 3 generations; prune on write |
| `saves` | `[gameId, name]` | `{ gameId, name, quetzal: ArrayBuffer, turn, savedAt }` | named in-game saves; export = download this blob |
| `maps` | `gameId` | `MapGraph` (JSON-serializable) | whole graph as one record; write-behind, debounced 500 ms |
| `transcripts` | `gameId` | `{ gameId, entries: { turn, command, response }[] }` | ring-buffer capped at 2000 entries |
| `settings` | fixed key `'app'` | `{ theme, fontSize, llm?: { provider, model }, art?: {...} }` | **API keys live in `localStorage`, NOT here** |

Restart flow: confirm dialog → delete `autosaves`, `maps`, `transcripts` rows for
`gameId` (keep `games` and named `saves`) → start fresh.

## 5. Component inventory (React, `src/`)

| Component | File | Responsibility |
|---|---|---|
| `App` | `App.tsx` | Router-less tab shell: Library ⇄ (Story / Map / More) |
| `LibraryScreen` | `library/LibraryScreen.tsx` | upload, list, resume, delete, restart |
| `StoryScreen` | `story/StoryScreen.tsx` | GlkOte mount point + scroll management |
| `CommandBar` | `story/CommandBar.tsx` | input field (soft-keyboard attrs per Task 1.7), send button, history swipe |
| `VerbChips` | `story/VerbChips.tsx` | one scrollable row; config in `story/verbs.ts` |
| `CompassRose` | `story/CompassRose.tsx` | collapsed 48px fab → expanded 3×3 + U/D/IN/OUT; known exits highlighted (subscribes to MapGraph) |
| `TapWords` | `story/TapWords.tsx` | wraps buffer text; word-tap appends to CommandBar draft |
| `MapScreen` | `map/MapScreen.tsx` | SVG canvas, pan/pinch (Pointer Events), selection |
| `RoomEditSheet` | `map/RoomEditSheet.tsx` | long-press bottom sheet: rename/note/merge/delete |
| `MoreScreen` | `more/MoreScreen.tsx` | saves list + export/import, settings, about/licenses |
| `DebugConsole` | `debug/DebugConsole.tsx` | live GameEvent stream; hidden behind settings toggle |

State: use **zustand** (tiny, no boilerplate) with three stores: `engineStore`
(status, current game), `mapStore` (MapGraph + actions), `uiStore` (tab, drafts,
sheets). No Redux, no context pyramids.

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

**1.4 Protocol tap** ☐ all messages observed unmodified ☐ GameEvent stream matches
fixture expectations ☐ DebugConsole shows live events ☐ fixture recording works.
(`glkote-bridge.ts` is a working first-cut tap per Task 1.3's note; still needs the
fixture-based test suite and DebugConsole this task calls for.)

**1.5 Autosave/saves** ☑ snapshot every turn + visibilitychange/pagehide ☑ kill-tab →
reopen resumes with scrollback ☑ 3-generation pruning ☑ in-game SAVE/RESTORE
round-trip ☑ Quetzal export/import ☑ transcript ring-buffer persists.

**1.6 Graph** ☑ vitest case per rule in §3 (8 rules; `tests/graph.test.ts`) + BFS
pathfinding and the two pure travel-abort checks — question-line detection and the
long-trip threshold — in `tests/travel.test.ts` (the room-mismatch and char-input abort
conditions need a live engine to observe and are deferred to whenever tap-to-travel gets
wired into the UI, see 1.8 note) ☑ serialization round-trip ☑ debounced (500 ms)
persistence (`src/state/mapStore.ts`).
(2026-07-13: implemented directly, skipping ahead of 1.4/1.7 per owner request — see
IMPLEMENTATION_PLAN.md outcome notes. `src/map/graph.ts`, `directions.ts`, `travel.ts`;
storage in `src/storage/maps.ts`.)

**1.7 Command input** ☐ no-typing traversal test passes ☐ keyboard stays open across
sends ☐ input visible above keyboard (visualViewport) ☐ "xyzzy" survives uncorrected
☐ tap-a-word appends ☐ history accessible.

**1.8 Map UI** ☑ minimal SVG rendering only (2026-07-13): rooms as boxes (current room
highlighted), edges as lines (dashed only when *no* direction between a pair is
confirmed yet), simple deterministic grid layout (`src/map/layout.ts`) wired live to
real gameplay through `mapStore`/`engineStore`. Verified end-to-end against `advent.z5`
(Playwright, 390×844) — see run notes; screenshot showed 3 rooms/2 edges after a few
moves including a correctly-ignored blocked move.
☐ pan/pinch/tap/long-press/drag (no touch-editing yet — `posLocked`/`userDeleted`/merge
are implemented and tested at the graph level in 1.6, just not wired to any gesture)
☐ tap-to-travel (BFS + the two pure abort checks exist in `travel.ts`; sending the
commands, catching the room-mismatch/char-input abort conditions live, and the toast/
long-trip-confirm UI are not wired up) ☐ user edits sticky across reload (untested end-
to-end without an editing UI to create edits with, though the underlying persistence
round-trips per 1.6's tests).

**1.9 Polish/offline** ☐ install prompt on Android Chrome via Pages URL ☐ airplane-mode
reload works ☐ font-size control ☐ dark/light ☐ licenses screen (incl. Bocfel GPL-2.0
attribution) ☐ full on-device session verified.

## 9. Known judgment calls already made (do not re-litigate)

- React + zustand + Vite + `idb` + `vite-plugin-pwa`; no router, no CSS framework
  (plain CSS modules); SVG map hand-rolled, no diagram library.
- Status-line room detection over memory peeking (interpreter-agnostic).
- One playthrough per game; restart wipes bundle after confirm.
- GitHub Pages primary hosting; LAN serving is best-effort undocumented.
- Turn counter increments on `command` events only.
- `(unknown)` is a single shared node, not one per dark encounter.
