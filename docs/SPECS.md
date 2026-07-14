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
| `ExitsRow` | `story/ExitsRow.tsx` | (2026-07-14, UX-6) row of confirmed-exit chips below the status line, sharing `useKnownExits()` with `CompassRose` |
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
  text and showing it before the player tries it) is a deliberately deferred idea, not
  an oversight — design sketch in `IMPLEMENTATION_PLAN.md` Task 1.10. Not built because
  the detection heuristic needs validating against real games' prose first.
