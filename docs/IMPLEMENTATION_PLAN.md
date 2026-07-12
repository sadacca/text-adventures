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

### Task 1.4 — Protocol tap + event bus
Wrap the GlkOte send/receive path so every RemGlk JSON message is observed (not
modified). Emit typed events: `command` (user line input), `status_line` (grid window
contents), `buffer_text` (main window text runs), `input_requested`. Unit-test the
parsing against captured protocol fixtures (record a short play session to JSON and
commit it as a fixture). Acceptance: a debug console pane shows the live event stream.

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
