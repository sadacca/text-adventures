# Implementation Plan: Infocom Text Adventure Player

This document is written to be executed by a coding agent. It contains the research
conclusions, the chosen architecture, and a phased task list with acceptance criteria.
Where an external API must be confirmed, the task says "verify in source" and names the
exact repo/file to read — do that before writing code against it.

**Read [`SPECS.md`](SPECS.md) alongside this plan** — it pins down the exact contracts
(types, IndexedDB schema, direction table, automapper rules as numbered test cases,
component inventory, GitHub Pages deploy, per-task done-checklists) and records
owner decisions: **GitHub Pages hosting** and **one playthrough per game**.

---

## 1. Research summary and key decisions

### 1.1 Interpreter: Bocfel compiled to WASM (via emglken), NOT a pure-JS VM

- Most Infocom games are Z-machine **version 3** (Zork I–III, Planetfall, Enchanter, ...).
- The main pure-JS Z-machine, **ZVM from `ifvms.js`**, supports only v5/v8 — it cannot
  run most of the Infocom catalog. Do not use it as the primary engine.
- **Bocfel** supports Z-machine v1–5, 7, 8 and partial v6, and is the default Z-machine
  engine in both Gargoyle and (since 2025) **Parchment**. Parchment ships it as
  WebAssembly through the **emglken** project.
- Therefore: consume the prebuilt WASM interpreter rather than writing/porting a VM.

### 1.2 UI/IO layer: the GlkOte JSON protocol is our interception point

The modern IF web stack (all MIT, all by Dannii Willis / Andrew Plotkin, all maintained):

| Component | Repo | Role |
|---|---|---|
| Parchment | `curiousdannii/parchment` | Full web player app (reference implementation) |
| AsyncGlk | `curiousdannii/asyncglk` (vendored git submodule — see §3, Task 1.3) | TypeScript GlkOte implementation + `Dialog` storage layer |
| emglken | `curiousdannii/emglken` (npm: `emglken`) | Prebuilt WASM interpreters (Bocfel, Glulxe, Hugo, TADS) speaking the RemGlk JSON protocol |
| Lectrote | `erkyrath/lectrote` | Electron player — a second working example of wiring emglken + GlkOte |

The interpreter communicates with the UI via **structured JSON** (the RemGlk/GlkOte
protocol): window layout, per-window text content updates (status line = "grid" window,
main text = "buffer" window), and input requests. This is the single clean hook point
that powers every custom feature in this plan:

- **Auto-map**: read the user's command on input, read the status-line room name and
  buffer text on update.
- **LLM hints**: the transcript is assembled from the same stream.
- **Graphics**: room descriptions come from the same stream.

No interpreter patching is needed for any phase.

### 1.3 Auto-mapping approach: protocol-based, with prior art

Two working prior-art automappers were found:

- **`dschwen/jszip`** — emscripten jzip with automap. Technique: intercept movement
  commands before the VM; identify current room via Z-machine memory (global variable 0
  in v3; parent of the player object in v5+).
- **Parchmap** — a Parchment expansion with automap, navigation, and notes
  (discussed on intfiction.org).

Because our interpreter is a WASM black box, we use the **protocol/transcript approach**
instead of memory peeking: room identity comes from the status line (all Infocom v3
games and nearly all v4/v5 games print the current room name in the grid window), and
edges come from the movement commands the user typed. This is interpreter-agnostic and
robust. Memory-based room detection can be added later as an enhancement if needed.

### 1.4 App shell: our own app consuming npm packages, not a Parchment fork

Parchment's build is heavy (git submodules, emscripten). We instead build a small
Vite + TypeScript + React app that depends on the published `asyncglk` and `emglken`
npm packages. Parchment and Lectrote source serve as wiring references.

**Fallback** (if the npm packages prove hard to wire — decide by end of Phase 1, Task 1.3):
embed the Parchment **single-file release** (from its GitHub releases page) in an iframe
and hook GlkOte from outside. Less clean, but guaranteed to run games on day one.

### 1.5 Platform path: local web app → PWA → Capacitor Android

- Phase 1 ships a static web app; **primary hosting is GitHub Pages** (owner decision —
  free HTTPS, which service workers/PWA install require; a plain-HTTP LAN address would
  silently lose offline + install). `npm run dev` remains the development loop; see
  SPECS §7 for the deploy workflow and base-path rules.
- Everything persistent lives in **IndexedDB** from day one (works identically in
  Android WebView), making the later Capacitor wrap a packaging exercise, not a rewrite.
- PWA manifest + service worker make it installable on Android immediately;
  the Capacitor native wrapper comes in Phase 4 for Play-Store distribution and
  native file access.

### 1.6 Mobile-first is the design baseline (OWNER REQUIREMENT)

**Desktop is not a consideration.** The primary target from day one is a phone browser
(Android Chrome). This has three non-negotiable consequences:

1. **Text entry must be effortless on a soft keyboard.** A bare parser prompt is
   hostile on mobile (autocorrect mangles commands, keyboard covers the prompt,
   typing "northwest" is tedious). Phase 1 therefore includes a dedicated
   **command-assist layer** (Task 1.7): compass rose, tappable verb/noun chips,
   command history, and correct soft-keyboard behavior (autocapitalize/autocorrect
   off, input pinned above the keyboard via `visualViewport`, no focus loss after
   submit).
2. **Navigation must work by touch alone.** It must be possible to play typical
   exploration (movement, look, take, inventory, save) without typing at all:
   tap the compass rose, tap a mapped room to auto-travel, tap words in the story
   text to build a command.
3. **Autosave is a hard, gating phase-1 requirement** — mobile browsers kill
   background tabs constantly, so losing state on tab-kill makes the app unusable.
   State must persist automatically every turn and on `visibilitychange`, and
   reopening the app must resume exactly where the player left off, with no manual
   step. An engine wiring that cannot support autosave fails the Task 1.3 decision
   gate. (Parchment/iplayif.com added Z-machine autosave with the Bocfel/RemGlk-rs
   switch — verify in source how it hooks it, and reuse that mechanism.)

Every acceptance criterion in this plan is evaluated **in a mobile viewport with
touch input** (Chrome DevTools device emulation during development; real Android
Chrome before calling a phase done). Layout is designed for portrait phone screens
first; anything wider just gets more breathing room.

### 1.7 Licensing and content rules

- App code MIT. AsyncGlk/emglken/Parchment MIT; **Bocfel is GPL-2.0** — we use it as an
  unmodified prebuilt binary component; do not copy its source into this repo.
- **Never commit Infocom story files.** Add `*.z1`–`*.z8`, `*.dat`, `*.zblorb` to
  `.gitignore`. Users load their own files. For dev/tests, download freely
  redistributable games at build/test time (e.g. `advent.z5` — public-domain Adventure;
  plus any if-archive game whose license permits redistribution) or keep tiny
  purpose-built test story files compiled from Inform 6 source we write ourselves.

---

## 2. Architecture

```
+--------------------------------------------------------------+
|            React app shell (portrait phone layout)            |
|  +----------------------------------------------------------+ |
|  | Tab bar: [Story] [Map] [More: saves/hints/art/settings]  | |
|  |  Story tab: GlkOte text + command-assist bar + compass   | |
|  |  Map tab: SVG map, pan/zoom/edit, tap-to-travel          | |
|  +----------------------------------------------------------+ |
|          ^                    ^                   ^            |
|          |             +------+-------------------+            |
|          |             |   Event bus (typed events)            |
|          |             |   command / room / text / save        |
|  +-------+-------------+--------+                              |
|  |  Protocol tap (wraps GlkOte  |                              |
|  |  send/receive of RemGlk JSON)|                              |
|  +-------+----------------------+                              |
|          |                                                     |
|  +-------v--------+   +-----------------+   +---------------+  |
|  | AsyncGlk GlkOte|   | emglken Bocfel  |   | Dialog storage|  |
|  | (UI <-> JSON)  |<->| (WASM, RemGlk)  |<->| -> IndexedDB  |  |
|  +----------------+   +-----------------+   +---------------+  |
|                                                                |
|  IndexedDB: story files | saves | maps | transcripts |         |
|             settings | room-art cache                          |
+--------------------------------------------------------------+
```

Core principle: **the interpreter stack is behind one module** (`src/engine/`), and all
features consume a typed event stream, so the engine can be swapped (e.g. for the
Parchment-iframe fallback) without touching features.

### Proposed file structure

```
/
├── index.html
├── package.json, vite.config.ts, tsconfig.json
├── public/            # PWA manifest, icons, service worker
├── src/
│   ├── main.tsx, App.tsx
│   ├── engine/        # interpreter wiring (asyncglk + emglken), protocol tap
│   │   ├── engine.ts          # start/stop game, expose EventBus
│   │   ├── protocol-tap.ts    # RemGlk JSON interception -> typed events
│   │   └── types.ts           # GameEvent: {command|room_seen|text|input_request|save}
│   ├── storage/       # IndexedDB wrappers (idb library): stories, saves, maps, art, settings
│   ├── map/           # graph model, layout, SVG renderer, editor
│   │   ├── graph.ts           # rooms, edges, direction normalization, inference rules
│   │   ├── layout.ts          # grid placement + collision resolution
│   │   └── MapPanel.tsx
│   ├── library/       # game library UI (upload, list, resume)
│   ├── hints/         # phase 2: LLM client, hint UI
│   ├── art/           # phase 3: image generation + cache
│   └── settings/
├── tests/             # vitest: graph logic, layout, protocol-tap parsing
└── docs/
```

---

## 3. Phase 1 — Mobile-first playable web app with autosave and auto-map

All phase-1 tasks are built and verified in a **portrait mobile viewport with touch
emulation**; a real Android Chrome check closes the phase.

### Task 1.1 — Scaffold
Vite + React + TypeScript + Vitest + ESLint/Prettier. `idb` for IndexedDB. PWA manifest
and minimal service worker (cache app shell). `.gitignore` includes story-file
extensions. Mobile viewport meta (`viewport-fit=cover`, no user-scaling surprises),
safe-area insets, and a portrait tab-bar app skeleton (Story / Map / More).
Acceptance: `npm run dev` serves the skeleton; renders correctly at 390×844.

### Task 1.2 — Game library
Upload `.z3/.z5/.z8/.dat/.zblorb` via file picker (works with Android Chrome's file
sheet); store bytes in IndexedDB with metadata (name, added date, last played). List +
delete + "resume". Touch targets ≥ 44px. Acceptance: reload the page and the library
persists; add/delete/resume all workable one-handed in the emulated viewport.

### Task 1.3 — Interpreter integration (the risky task — do it early)
Wire `emglken` (Bocfel) + `asyncglk` (GlkOte) to run a story file from the library in
the Story tab. **Before coding, read**: Parchment `src/common/launcher.ts` (or nearest
equivalent — verify in source) and Lectrote's emglken wiring, to see the expected
GlkOte options, Dialog instance, and WASM loading. Serve WASM assets locally
(no CDN — the app must work fully offline). Also locate **how Parchment implements
Z-machine autosave** (added with the Bocfel/RemGlk-rs switch) — the wiring chosen here
must expose it.
Acceptance: a public-domain z5 game and a v3 story file both play end-to-end on the
mobile viewport, and the autosave hook point is identified and proven (a spike that
snapshots and restores mid-game is enough at this stage).
**Decision gate**: if wiring OR autosave can't be made to work in reasonable time,
switch to the Parchment single-file iframe fallback (§1.4) — Parchment's own autosave
then comes along for free — and adapt the protocol tap accordingly.

**Decision-gate outcome (resolved 2026-07-12):** wiring worked; iframe fallback was not
needed. Two premises in this plan turned out to be wrong, corrected as follows:

1. **`asyncglk` is not an npm package.** Only `emglken` is published to the npm
   registry; `asyncglk` (curiousdannii/asyncglk) has no npm release and no git tags
   (pre-1.0, `master`/`first-concept` branches only). Owner decision: vendor it as a
   git submodule at `src/upstream/asyncglk`, pinned to a commit SHA (currently
   `67ff50261a8fa917e25141d79a9da4449ec64903`, re-pin manually as upstream evolves).
   It's built separately (`npm run build:asyncglk`, wired as `predev`/`prebuild`/
   `pretest`) via `asyncglk.build.tsconfig.json`, whose single entry point
   (`src/index-common.ts`) pulls in only plain-TypeScript modules — its Svelte file
   picker UI and jQuery-dependent `WebGlkOte`/browser `Dialog` live behind different
   entry points (`index-browser.ts`) and are never imported, so neither Svelte nor
   jQuery enters the build. Output goes to the gitignored `src/upstream/asyncglk-dist/`
   (excluded from our own strict tsconfig/eslint, like a normal dependency's `dist`).
   CI/deploy workflows now check out submodules (`actions/checkout@v4` with
   `submodules: true`).
2. **Z-machine "autosave" (full VM heap snapshot) isn't actually implemented
   upstream.** `do_vm_autosave` exists as a Parchment option and `AutosaveData`/
   `autosave_read`/`autosave_write` exist as types, but they're either dead code
   (unreachable via the `AsyncDialog` interface emglken requires) or, on the
   remglk-rs side, literally commented out with a `// TODO: Autorestore state`.
   What *does* work end-to-end is ordinary Glk file I/O — the same mechanism behind
   in-game SAVE/RESTORE (Quetzal). `EngineHandle.saveAutosave()` therefore drives a
   silent, programmatic SAVE: it sets a deterministic fileref path (bypassing the
   real file-picker prompt entirely, since our own `Dialog` implementation controls
   `prompt()`) and sends the `save` command, capturing the Quetzal bytes as they're
   written. `start(story, {autorestore: true})` is the RESTORE-side mirror. This was
   proven with a same-session spike (`src/engine/`): play, move, save, move further,
   restore, and confirm the room reverts — see the engine architecture note below for
   what's built vs. deferred to Task 1.5.

**Engine architecture actually built (`src/engine/`):**
- `types.ts` — `GameEvent`/`EngineHandle`, verbatim from SPECS §1.
- `emglken.d.ts` — hand-written ambient types (emglken ships none). Imports
  `emglken/build/bocfel.js` directly rather than the `emglken` package barrel, which
  re-exports all seven interpreters (Bocfel, Glulxe, Git, Hugo, Scare, TADS, plus a
  no-Z6 Bocfel variant) from one file — importing the barrel pulled all ~9MB of wasm
  into the production bundle, since a bundler can't tree-shake away another export's
  module-level side effects. Importing the direct subpath keeps the bundle to just
  `bocfel.wasm` (~1.3MB / ~445KB gzip).
- `memory-dialog.ts` — `MemoryDialog`, an in-memory-only `AsyncDialog` implementation.
  Note: `write()` copies bytes defensively (`.slice()`) — the buffer emglken hands to
  `Dialog.write()` is a view into WASM linear memory, which later interpreter
  execution can and does overwrite in place; storing the reference directly silently
  corrupted every captured save until this was caught by the spike test.
- `glkote-bridge.ts` — `BridgeGlkOte extends GlkOteBase` (asyncglk's plain-TS base
  class — no jQuery/Svelte, unlike its `WebGlkOte`). Translates RemGlk protocol
  updates into `GameEvent`s and owns the turn counter. Doubles as a first-cut protocol
  tap; Task 1.4 hardens/extracts this with fixtures and dedicated tests.
- `engine.ts` — `createEngine()` wires the above plus `emglken/build/bocfel.js`
  behind `EngineHandle`.
- Vite needs `optimizeDeps: { exclude: ['emglken'] }` (see `vite.config.ts`) — the
  dependency pre-bundler otherwise copies emglken's JS into its cache dir, which
  breaks the `new URL('bocfel.wasm', import.meta.url)` resolution Emscripten's glue
  relies on (the dev server then 404s and SPA-fallback-serves `index.html`, which
  trips the WASM MIME-type check in the browser).

**Deferred to Task 1.5 (by design, not an oversight):** `MemoryDialog` doesn't persist
anything to IndexedDB, so a fresh page load has no autosave to restore — the Task 1.3
acceptance bar was a same-session "snapshot and restore mid-game" spike, which is what
was built and verified. Task 1.5 needs a durable Dialog (e.g. persisting `/saves/*`
paths to the `saves`/`autosaves` IndexedDB stores per SPECS §4) so `autorestore: true`
has something to find after a real reload.

**Verification performed:** `advent.z5` (v5) and `advent.z3` (v3, fetched from
`curiousdannii/ifvms.js` test fixtures) both played end-to-end — movement, object
interaction, status line, SAVE/RESTORE — through a Playwright session at a 390×844
mobile viewport against the real `StoryScreen` UI (a minimal file-picker + transcript +
command form; the full mobile command UI is Task 1.7). `npm run lint`, `npm test`,
`npm run build`, and `tsc -b` all pass.

**Post-launch outcome (2026-07-13): two production bugs found and fixed during a real-device
verification pass, neither caught by `npm test`/`npm run build` alone.**

1. **Library screen: "Resume" shown for never-played games; "Restart" a no-op for
   non-active games.** `LibraryScreen.tsx`'s play button was unconditionally labeled
   "Resume" regardless of whether an autosave existed, and `onRestart`'s branch for a
   game that wasn't the currently-open one only wiped its IndexedDB rows — it never
   called `openGame`/`setTab('story')`, so clicking it appeared to do nothing. Fixed by
   checking `getLatestAutosave` per game for the label ("Play" vs "Resume") and by
   reopening the game after the wipe in both branches.
2. **Story never loads in production — stuck on "Loading…" forever, dev server unaffected.**
   emglken's bundled `bocfel.js` unconditionally sets its own `Module.locateFile`
   (meant as a "single-file mode" fallback) *before* the bundler-friendly
   `new URL('bocfel.wasm', import.meta.url)` call that Vite's production build
   correctly rewrites to the content-hashed output filename. That default resolves to
   an *unhashed* `bocfel.wasm` next to the built JS chunk — a filename the production
   build never emits — so the request 404s, the static host's SPA fallback serves back
   `index.html`, and `WebAssembly.instantiate` throws trying to parse HTML as wasm.
   Nothing catches that throw inside `engine.ts`'s `start()`, so `openGame()` never
   reaches `set({ loading: false })`. Invisible in `npm run dev` (which serves
   `node_modules/emglken/build/bocfel.wasm` directly, unhashed, so the broken code path
   still resolves correctly by accident) — only reproduces in a built-and-served
   production bundle, which is why this needed an actual `npm run build && npm run
   preview` repro, not just dev-server testing. Fixed with a build-time Vite plugin
   (`emglkenWasmFallback` in `vite.config.ts`) that copies the real `bocfel.wasm`
   alongside the hashed one so the unhashed request also 200s. See SPECS.md §7 for the
   deploy-time note this leaves behind.

**Verification:** reproduced and fixed against a real ~113KB commercial Infocom v3 file
(header-verified, sanity-checked against `dfrotz` first), driven through both the dev
server and a `vite build && vite preview` production build via Playwright, including a
fresh/incognito-equivalent browser context so no stale service-worker cache could mask
the result. Full play → autosave → reopen (silent restore) cycle confirmed working in
~1s end-to-end on the fixed production build.

### Task 1.4 — Protocol tap + event bus
Wrap the GlkOte send/receive path so every RemGlk JSON message is observed (not
modified). Emit typed events: `command` (user line input), `status_line` (grid window
contents), `buffer_text` (main window text runs), `input_requested`. Unit-test the
parsing against captured protocol fixtures (record a short play session to JSON and
commit it as a fixture). Acceptance: a debug console pane shows the live event stream.

**Outcome (2026-07-13): done.** The RemGlk-JSON-to-`GameEvent` parsing that used to live
directly inside `glkote-bridge.ts` (Task 1.3's first-cut tap) was extracted into a pure,
engine-agnostic `src/engine/protocol-tap.ts` (`ProtocolTap`): `handleUpdate(data)` for
every interpreter->UI message, `handleEvent(ev, {silent})` for every UI->interpreter
message, both taking an optional `onRaw` callback that observes the message unmodified
(SPECS.md §6's `{"dir":"out"|"in","msg":{...}}` shape) before anything else happens to
it. `glkote-bridge.ts` is now just the GlkOteBase-specific plumbing (choosing which
window id to address); `update()`/`send_event()` hand every message to the tap first.
`EngineHandle` grew an `onRaw` method (documented in SPECS.md's own copy) so the UI layer
can observe the wire-level stream without reaching into engine internals.

- **Fixtures**: real Bocfel sessions against `advent.z5` (public-domain Adventure,
  `curiousdannii/asyncglk`'s own test fixture), captured via a one-off Node harness
  driving `createEngine()` directly (same "no browser needed" trick Task 1.3's
  race-condition spike used) and dumping every `onRaw` message. Committed under
  `tests/fixtures/`: `walk15.jsonl` (15-turn walk, movement + inventory + two parser
  errors), `blocked-and-dark.jsonl` (a real blocked exit — "You don't fit through a
  two-inch slit!", room unchanged — and a real dark room, whose status line literally
  reads "Darkness"), `save-restore.jsonl` (named SAVE / move / move back / RESTORE,
  including Bocfel's own history-playback replay text passing through unmodified).
  **Deviation from §6's suggested fixture set**: a v3 game file wasn't available under
  this session's network policy (only `advent.z5`, a v5 game, was reachable); since the
  wire protocol shape doesn't depend on Z-machine version, all three fixtures use
  `advent.z5` — still real blocked-exit/dark-room/save-restore behavior, just not from a
  v3 binary specifically.
- **Tests**: `tests/protocol-tap.test.ts` replays the three fixtures with `replayFixture()`
  (no WASM/interpreter involved) and asserts the exact `GameEvent` sequence, plus direct
  `ProtocolTap` unit cases (quit-on-disable, error/pass/retry are inert, raw-message
  observation, silent commands don't advance the turn counter or emit `command`).
- **DebugConsole** (`src/debug/DebugConsole.tsx`): live event stream (subscribes to a new
  capped ring buffer, `engineStore.debugEvents`), plus the "record fixture" toggle
  (`engineStore.recordingFixture`/`startRecordingFixture`/`stopRecordingFixture`, buffering
  `onRaw` messages only while armed) that downloads a `.jsonl` via a Blob URL. Hidden
  behind a settings toggle in MoreScreen ("Debug console (Story tab)"); rendered at the
  bottom of the Story tab when enabled.

### Task 1.5 — Autosave and saves (gating requirement — see §1.6)
- **Autosave (the priority)**: using the hook proven in Task 1.3, snapshot interpreter
  state to IndexedDB after **every turn** and on `visibilitychange`/`pagehide` (the
  reliable mobile lifecycle signals — `beforeunload` is not dependable on Android).
  Opening a game from the library resumes the autosave automatically — no prompt, no
  restore step. Keep the last few autosave generations in case one is corrupt.
- Native saves: in-game SAVE/RESTORE commands work via AsyncGlk's `Dialog` backed by
  IndexedDB (verify in asyncglk source which Dialog class does browser storage;
  Parchment shows how to instantiate it). These are the player's deliberate,
  named snapshots; autosave is the safety net.
- Export/import: share/download a save as a standard **Quetzal** file; import one back
  (uses the Web Share API where available, falls back to download).
- Per-game transcript log persisted to IndexedDB (also feeds phases 2–3).
Acceptance (on mobile emulation): play 10 turns, background the tab, kill it, reopen
the app — the game resumes at turn 10 with scrollback intact, zero taps beyond opening
the game. In-game SAVE/RESTORE also round-trips.

**Outcome (2026-07-12): done, with one real bug found and fixed along the way and one
design deviation from what this section originally implied.**

- **`storage/` (new):** `db.ts` (the full §4 IndexedDB schema, one `openDB` call, all six
  stores), `gameId.ts` (sha256-based id + blorb/zcode sniffing), `games.ts` (CRUD +
  cascade delete + `restartPlaythrough`), `autosaves.ts` (generation write + prune-to-3 +
  latest lookup), `saves.ts` (named-save CRUD + Quetzal export via `navigator.share`/
  download-link fallback + import), `transcripts.ts` (2000-entry ring buffer). All have
  direct vitest coverage (`tests/storage.test.ts`) using `fake-indexeddb` (added as a
  dev dependency and wired into `tests/setup.ts` — jsdom has no native IndexedDB).
- **`EngineHandle` grew three methods** not in the original SPECS.md draft:
  `preloadAutosave`, `onNamedSavePrompt`, `onNamedSaveWritten` (see SPECS.md's own copy
  for the exact contract). The engine still never touches IndexedDB itself — the new
  session-orchestration layer, `src/state/engineStore.ts` (zustand), owns all storage
  calls, autosave-after-every-turn, the `visibilitychange`/`pagehide` flush, and the
  player-facing SAVE/RESTORE naming prompts (currently plain `window.prompt`/`confirm` —
  functional, not the polished bottom-sheet UI Task 1.7/1.8 will eventually want).
- **Real bug found via the mobile-viewport Playwright check, not by inspection: a race
  condition in `engine.ts` dropped commands.** GlkOte's `waiting_for_update` guard
  silently discards any command sent while the interpreter hasn't yet reached its next
  input-request (just a console warning, no error, no event) — and the original
  `start()`/`saveAutosave()` resolved as soon as the command was *sent*, not once its
  response cycle (which for RESTORE can be multi-step) fully settled. A caller acting
  immediately on that resolved promise — exactly what `engineStore` does — could have
  its next real command dropped. Fixed with an explicit busy/ready queue in `engine.ts`
  (`dispatch`/`whenReady`, plus an always-on internal listener that drains anything
  queued once the VM signals it's ready for more input); `sendCommand` now queues rather
  than firing-and-dropping when busy. Caught by first reproducing it in a Node spike
  (`createEngine()` directly, no browser), which made it fast to isolate.
- **Bocfel's own "history playback" on RESTORE turned out to be unusable as a scrollback
  source, so we don't use it.** Bocfel embeds a rolling window of recent commands in
  every Quetzal file and replays them (by re-*sending* them, not just reprinting cached
  text) when a save is restored — including our own silent per-turn background
  autosaves, since Bocfel has no concept of "silent." A resumed session's replay is
  therefore full of spurious `save` / `Ok.` noise, and — before the race-condition fix
  above — could even corrupt the resulting state (a nested `restore` in the replayed
  history failing against a fresh process's dialog, mid-replay). Given this, scrollback
  on resume is reconstructed from **our own `transcripts` store** instead
  (`engineStore.openGame`: on a resuming session, skip Bocfel's replay text entirely —
  only trust its `status_line` — and rebuild the transcript from the structured
  `{turn, command, response}` entries already being written on every real turn). Each
  turn's stored `response` also has any embedded history-playback span stripped
  (`stripHistoryReplay`) so it can't contaminate a *later* resume's reconstruction
  either. This is a clean split in practice: Bocfel's replay is good enough to prove the
  VM's internal state restores correctly (which is what Task 1.3's spike used it for,
  same-session), but not to drive the UI.
- **Verification:** Playwright at 390×844 — upload → resume → 10 turns → named SAVE →
  more turns → named RESTORE (state correctly reverts) → simulated kill-tab (full page
  navigation, same browser profile so IndexedDB persists) → reopen → resumes at the
  correct room/turn with accurate, non-duplicated scrollback and a live, playable
  session. Also verified: 3-generation autosave pruning (both via a direct vitest case
  and via the live IndexedDB dump during the Playwright run), Restart (wipes
  autosave/map/transcript, keeps the game and named saves), and Quetzal export → delete
  → re-import round-trip (downloaded file starts with the Quetzal `FORM` magic bytes).

### Task 1.6 — Auto-map: graph model (pure logic, no UI; heavy unit tests)
- Rooms keyed by normalized status-line room name; track "current room".
- On `command` matching a movement verb (n/s/e/w/ne/nw/se/sw/up/down/in/out/enter/exit
  and full words), remember the pending direction.
- On next `status_line` room change: create/lookup destination room, add directed edge
  labeled with the direction; auto-add the reverse edge for compass opposites (mark it
  "inferred" so it renders dashed until independently confirmed).
- Rules: room unchanged → no edge (blocked move). Room changed with no movement
  command (teleport, cutscene) → new room placed unconnected, flagged. Dark rooms /
  missing status line → node named "(unknown)". Duplicate room names → disambiguate
  with a numeric suffix when the arrival direction contradicts known edges.
- Persist the whole graph per game in IndexedDB (**one playthrough per game** — owner
  decision; autosave + map + transcript form one bundle, wiped together on restart).
Acceptance: vitest suite covering all the rules above using synthetic event sequences.

### Task 1.7 — Mobile command input (core UX, not polish)
The goal: common play requires little or no typing, and typing, when needed, is
painless.
- **Soft-keyboard-correct text field**: `autocapitalize="off" autocorrect="off"
  spellcheck="false" enterkeyhint="send"`; keep the input visible above the keyboard
  using the `visualViewport` API; keep focus after submitting so the keyboard doesn't
  bounce; scroll new story text into view above the input.
- **Compass rose**: persistent compact control (expandable) with N/S/E/W/NE/NW/SE/SW/
  U/D/IN/OUT — one tap sends the move. Directions the map knows to be exits are
  visually emphasized.
- **Verb chips**: one row of common commands (look, take, drop, open, examine,
  inventory, wait, again) — tapping either sends immediately (no-object verbs) or
  inserts the verb and focuses the input.
- **Tap-a-word**: tapping a word in the story text appends it to the command being
  built (e.g. tap "examine" chip, tap "lantern" in the text, send).
- **History & repeat**: swipe up on input (or a chip) for recent commands; big
  "again" affordance.
Acceptance (mobile emulation + real device): traverse 10 rooms, pick up two objects,
and check inventory **without typing a single character**; when typing "xyzzy", no
autocorrect interference and the input stays visible.

**Outcome (2026-07-13): done, with one real cross-feature bug found and fixed via a
mobile-viewport Playwright pass against a live game (`advent.z5`).**

- **New components**: `story/CommandBar.tsx` (soft-keyboard-correct input — never
  `disabled`, only its Send button is, so focus/keyboard never drops across a submit;
  `useKeyboardInset.ts`'s `visualViewport` hook keeps it pinned above the keyboard; a
  history popover plus a swipe-up gesture on the input, backed by `uiStore.commandHistory`),
  `story/VerbChips.tsx` (look/take/drop/open/examine/inventory/wait/again — no-object
  verbs send immediately, object verbs insert the verb + request focus via a new
  `uiStore.focusRequestId` signal), `story/CompassRose.tsx` (48px collapsed fab -> 3×3 +
  U/D/IN/OUT grid; known exits from the current room, read live from `mapStore`, get a
  `.compass-known` highlight), `story/TapWords.tsx` (wraps the transcript, makes every
  word tappable -> appends to the shared draft).
- **Shared draft state moved to `uiStore`** (`commandDraft`/`setCommandDraft`/
  `appendToDraft` already existed from the Task 1.1 scaffold but were unused until now)
  so CommandBar/VerbChips/TapWords/CompassRose can all read and write the same
  in-progress command without prop-drilling.
- **Real bug found via Playwright, not by inspection**: the expanded CompassRose was
  originally `position: absolute` over the bottom-right corner of the transcript (a
  common FAB pattern) — but an absolutely-positioned element's full rectangular box
  intercepts pointer events even where it's visually just background, which silently ate
  taps on any tap-word text that scrolled underneath its corner. Confirmed by driving
  "expand compass, then tap a word directly under it" in a real browser and watching
  Playwright's own click-retry log report `<div class="compass-rose">... intercepts
  pointer events`. Fixed by docking the compass as a real flex column (`.story-body`
  became `display:flex` with the transcript as a stretched, flexible item and the
  compass as a `flex-shrink:0` sibling) instead of an overlay — this reserves genuine
  layout space, so it can structurally never sit on top of tappable text again, rather
  than relying on padding/z-index tricks that would only reduce the odds.
- **Verification**: Playwright at 390×844 driving the real `StoryScreen`/`MapScreen`
  against `advent.z5` — verb chip "Look" sends immediately; compass expand + "Go n"
  moves and updates the status line; a tap-word directly under the still-expanded
  compass is clickable (regression check for the bug above); "Take" chip + tapping
  "lamp" in the room description composes the draft to exactly `"take lamp"` and sends
  it, and the object is actually taken (confirmed via the map/transcript in the same
  pass — see Task 1.8's outcome notes); autocapitalize/autocorrect/spellcheck read
  `off`/`off`/`false` on the live input.
- Not automated in Playwright (would need a real Android device per §1.6): the
  `visualViewport` keyboard-inset behavior and swipe-up history gesture are implemented
  per the same technique documented in this section, but only unit-tested (the popover
  opens and refills the draft — `tests/story-ui.test.tsx`), not verified against a real
  soft keyboard.

### Task 1.8 — Auto-map: layout + rendering + touch editing
- Layout: compass directions map to grid offsets (up/down/in/out get diagonal or
  stacked-level treatment — pick one, document it); collision resolution by shifting;
  simple and deterministic beats fancy force-directed.
- Render as SVG in the Map tab: rooms as boxes (current room highlighted), edges as
  lines with direction, dashed for inferred. **Touch-first interactions**: one-finger
  pan, pinch zoom, tap to select, long-press for the edit menu (rename/delete/merge/
  note), drag to move a room. No hover-dependent UI anywhere.
- **Tap-to-travel is core on mobile** (this is primary navigation, per §1.6): tap a
  visited room → the app computes the path over confirmed edges (BFS) and sends the
  movement commands turn by turn, stopping immediately if any response deviates from
  the expected room (combat, locked door, darkness).
- Edits are sticky (stored flags) so the automapper never undoes a manual change.
Acceptance: on mobile emulation, play 10+ rooms; map matches geography; pinch/pan/
long-press editing works; tap-to-travel crosses 3+ rooms and stops correctly when
blocked; manual fixes survive reload.

**Outcome (2026-07-13): the rest of 1.8 (pan/zoom, long-press editing, tap-to-travel
wiring, sticky-edit UI) done, on top of the minimal SVG rendering already built alongside
Task 1.6.**

- **Pan/pinch (Pointer Events)**: `MapScreen.tsx`'s SVG root tracks active pointers in a
  ref-backed `Map`; one pointer pans, two pointers pinch-zoom (scale clamped to
  0.4–3×, midpoint-tracked so the zoom roughly follows the pinch center). Implemented as
  a `<g transform="translate(...) scale(...)">` layered *underneath* a separate, frozen
  "home" viewBox that auto-fits explored rooms once per game (via a `lastFitGameId` ref)
  rather than on every graph mutation — recomputing the fit viewBox on every new room
  would otherwise fight the player's own pan/zoom mid-gesture. A "⤢ Fit" button
  recomputes the fit and resets pan/zoom on demand.
- **Tap / long-press / drag, per room**: a single `roomGestureRef` (not per-render
  closures) tracks whichever room is currently being pressed, because a drag's own
  `setDragPreview` call triggers a React re-render mid-gesture — closures capturing local
  `let dragging`/`longPressed` variables would silently reset on that re-render and the
  *next* native pointer event would see stale state. A tap (short press, <10px of
  movement) fires tap-to-travel; holding past 500ms without moving opens
  `RoomEditSheet`; moving past the drag threshold before the long-press timer fires
  drags the room (visually previewed locally, committed to `mapStore.moveRoom` — which
  sets `posLocked` — only on release, so mid-drag pointermove events don't spam the
  debounced IndexedDB save).
- **`RoomEditSheet.tsx`** (long-press bottom sheet): rename / note / merge-into another
  room / delete, all backed by four new pure `map/graph.ts` primitives —
  `renameRoom`, `setRoomNote`, `deleteRoom`, `moveRoom` — added alongside the existing
  `mergeRooms`, each with a `tests/graph.test.ts` case. **Renaming reuses the alias
  mechanism** `mergeRooms` already established for rule 7: since room *matching* is
  purely name-based (rule 8), a bare rename would strand future arrivals under the
  room's original status-line name (no existing room to find by that name -> a stray
  duplicate). `renameRoom` therefore also records the pre-rename name as an alias to the
  same room id. **Deletion is deliberately not permanently sticky by name** (unlike
  `userDeleted` edges / `posLocked` positions / merge aliases): it tombstones every edge
  touching the room and removes the node, but if the player revisits that same
  status-line room later, the automapper just rediscovers it fresh — there's no rule
  requiring "this name can never be mapped again," and permanently blacklisting a name
  would make deleting a wrongly-split Maze duplicate (the actual expected use case)
  behave surprisingly on a later, legitimate revisit.
- **Tap-to-travel wiring**: `engineStore.ts` grew a `travelTo(path)` action (plus a
  `traveling` boolean gating the rest of the input UI mid-trip) that sends each
  `TravelStep`'s direction and waits for that turn to fully settle before sending the
  next — implemented as its own temporary `engine.on` listener per step, resolved on
  `input_requested` — then checks, in order: was the next input a `char` prompt (abort
  `'char_input'`); did any buffered `buffer_text` line end in `?` (abort `'question'`,
  via Task 1.8's already-existing `bufferTextEndsInQuestion` from `travel.ts`); does
  `mapStore`'s (already-updated, by the time `input_requested` fires — the automapper's
  listener runs first since it was subscribed earlier in `engine.on`'s insertion-ordered
  listener set) `currentRoomId` match the step's expected room (abort `'blocked'`
  otherwise). `MapScreen.handleRoomTap` computes the BFS path via the existing
  `computePath`, shows the existing `isLongTrip` confirm dialog for trips over 8 moves,
  calls `travelTo`, and surfaces the result (or "no known path yet" if `computePath`
  returns null) as a short-lived toast.
- **Verification — two complementary passes**, because this game's own geography turned
  out to be a poor deterministic fixture for scripting a guaranteed-success travel (see
  below):
  1. **Live Playwright pass** (390×844, real Bocfel + `advent.z5`): pan gesture runs
     without error; long-pressing a room opens the edit sheet, and renaming it updates
     the map immediately (persistence-across-reload is Task 1.6's own debounced-save
     test, not re-verified here); tapping a room reachable only via a still-*inferred* edge
     correctly refuses with "No known path to that room yet." — which is exactly
     correct per the BFS's confirmed-edges-only contract, not a bug (discovered while
     trying to script a happy-path demo: `advent`'s "Forest" rooms turned out to have
     non-deterministic exits turn-to-turn in the underlying game, making them a poor
     fixture for scripting *any* guaranteed outcome, success or failure, without
     controlling the interpreter directly).
  2. **Deterministic `engineStore.travelTo` unit tests** (`tests/travelTo.test.ts`), which
     is what actually pins down the happy-path and every abort condition: a fake
     `EngineHandle` (mocked in for `createEngine`) whose `sendCommand` synchronously
     emits a pre-scripted response, driven through the real `openGame`/automapper/
     `mapStore` stack (so room ids and edge confirmation come from real rule 1/3 logic,
     not hand-guessed) and then a real `computePath`. Covers: completes and sends the
     expected command for a real confirmed A<->B edge; aborts `'blocked'` on a
     room-mismatch; aborts `'question'` on a `?`-ending buffer line; aborts
     `'char_input'` on a char-type prompt; a no-op for an already-there (empty) path.
- Not verified end-to-end on a real device (would need Task 1.9's on-device pass):
  pinch-zoom's two-finger gesture (Playwright's `mouse` API only drives one pointer at a
  time; a full multi-touch pinch would need `page.touchscreen` or CDP-level dispatch),
  and the 8-move long-trip confirm dialog (logically wired to the same `window.confirm`
  pattern already used elsewhere, but not exercised in this pass).

### Task 1.9 — Polish & offline
Dark/light theme, font-size control (reading comfort on phones), service worker caches
everything including WASM (fully offline after first load), install prompt flow.
Acceptance: Lighthouse PWA installable check passes; airplane-mode reload on a real
Android phone works; full session (play, map, autosave-resume) verified on the device.

---

## 4. Phase 2 — LLM assistance (bring-your-own-token)

### Task 2.1 — Provider client + settings
Settings panel: provider (Anthropic first; OpenAI-compatible second), API key stored in
localStorage with a clear "your key stays on this device and is sent only to the
provider" notice. Direct browser calls to the Anthropic Messages API work with CORS
when the request includes the `anthropic-dangerous-direct-browser-access: true` header
(verify current header/name against Anthropic docs at implementation time). Include a
"test key" button.

### Task 2.2 — Hint engine
Context assembly: game title + last N transcript exchanges (from Task 1.5's log) +
serialized map graph + current room. Three graduated actions, each a separate button so
spoiler exposure is user-controlled:
1. **Nudge** — "point me in a direction, no spoilers"
2. **Hint** — "what should I try in this situation"
3. **Spoil it** — exact commands
System prompt must instruct the model to admit uncertainty rather than invent puzzle
solutions (classic-game knowledge is good for Infocom titles, weak for obscure games).
Optional grounding: user can paste a walkthrough/InvisiClues text into a per-game
"hint source" field that gets included in context.

### Task 2.3 — Quality-of-life LLM features
- Parser helper: on repeated parser errors, offer "rephrase my last command".
- "Story so far" recap generated from the transcript (great for resuming a save).
- Stuck detection (no new rooms/score in M turns) → unobtrusive "want a nudge?" chip.
Acceptance for phase: with a key configured, all three hint levels return responses
using real transcript context; with no key, the UI degrades gracefully.

---

## 5. Phase 3 — Generated room graphics

### Task 3.1 — Art pipeline abstraction
`ArtProvider` interface: `generate(prompt, style) -> image blob`. Implementations:
1. **API provider** (reuses phase-2 key management; pick providers at implementation
   time — e.g. an OpenAI-compatible images endpoint and/or Google/Stability APIs).
2. **Local HTTP provider** — point at a user-run local generator (ComfyUI or
   AUTOMATIC1111's API at `http://localhost:PORT`), which satisfies "offline"
   without shipping a model in the browser. (In-browser diffusion via WebGPU is
   experimental/heavy; note it as future work, don't build it now.)

### Task 3.2 — Room illustration flow
On entering a room not in the art cache: build an image prompt from the room's first
full description (use the phase-2 LLM to compress the description into a visual prompt
when a key is available; else use the raw text truncated). Apply a per-game **style
preset** (pen-and-ink, gouache, pixel-art, 80s box art). Cache by
(game, room, style) in IndexedDB. Display in the side panel with regenerate/pin
controls; a global toggle disables generation entirely.
Acceptance: walking through rooms populates a persistent illustrated gallery; no
duplicate generation for revisited rooms; app remains fully functional with art off.

---

## 6. Phase 4 — Android

Because phase 1 is mobile-first (tabbed layout, compass rose, touch map editing,
autosave all already built and verified on Android Chrome), this phase is packaging,
not UX work:

1. Add **Capacitor**: wrap the built web app; use Capacitor Filesystem/SAF plugin for
   importing story files and exporting Quetzal saves on Android; keep IndexedDB as the
   store (it persists in Capacitor's WebView).
2. Native niceties: back-button handling (map tab → story tab → home), keep-screen-on
   toggle, share-sheet integration for save export.
3. Optional Play-Store packaging; otherwise distribute the APK directly.
Acceptance: sideloaded APK plays a game, saves, maps, and restores fully offline.

---

## 7. Risks and mitigations

| Risk | Mitigation |
|---|---|
| `emglken`/`asyncglk` npm APIs undocumented or awkward | Read Parchment + Lectrote wiring first; decision gate in Task 1.3 with Parchment-iframe fallback |
| Status-line room name unreliable in some games (v5+ custom status, v6) | Manual "mark room" button; disambiguation rules in Task 1.6; memory-peeking enhancement later |
| Autosave unachievable in our own wiring (gating — §1.6) | Task 1.3 proves it in a spike before further engine work; Parchment-iframe fallback inherits Parchment's own autosave |
| Mobile soft-keyboard quirks (viewport jumps, autocorrect, focus loss) | Task 1.7 addresses directly (`visualViewport`, input attributes); command-assist UI reduces typing to near zero; test on real Android Chrome each phase |
| Bocfel GPL-2.0 | Consume unmodified prebuilt WASM; keep app code separate; attribute in About screen |
| Copyright of Infocom games | Never bundle; user-supplied files only; test with free games |
| LLM hints hallucinate puzzle solutions | Honesty instructions + optional user-supplied walkthrough grounding |

## 8. Suggested execution order & test discipline

Tasks 1.1 → 1.3 (risky integration + autosave spike first) → 1.5 (autosave complete —
it gates everything) → 1.4 → 1.7 (mobile input) → 1.6 (pure logic, TDD) → 1.8 → 1.9,
then phases 2–4 in order. Every pure-logic module (graph, layout, protocol parsing,
prompt assembly) gets vitest coverage from fixtures; UI gets a smoke test. Record real
protocol sessions as fixtures early — they make everything downstream testable without
running the WASM interpreter in CI. Develop with Chrome DevTools mobile emulation as
the default viewport; verify each phase on a real Android phone before declaring it
done.
