# Implementation Plan: Infocom Text Adventure Player

This document is written to be executed by a coding agent. It contains the research
conclusions, the chosen architecture, and a phased task list with acceptance criteria.
Where an external API must be confirmed, the task says "verify in source" and names the
exact repo/file to read — do that before writing code against it.

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
| AsyncGlk | `curiousdannii/asyncglk` (npm: `asyncglk`) | TypeScript GlkOte implementation + `Dialog` storage layer |
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

- Phase 1 ships a static web app served locally (`npm run dev` / any static server).
- Everything persistent lives in **IndexedDB** from day one (works identically in
  Android WebView), making the later Capacitor wrap a packaging exercise, not a rewrite.
- PWA manifest + service worker make it installable on Android immediately;
  the Capacitor native wrapper comes in Phase 4 for Play-Store distribution and
  native file access.

### 1.6 Licensing and content rules

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
|                        React app shell                        |
|  +----------------+  +-----------------+  +----------------+  |
|  | Game panel     |  | Map panel (SVG) |  | Side panel     |  |
|  | (GlkOte UI)    |  |  pan/zoom/edit  |  | saves/hints/   |  |
|  |                |  |                 |  | art/settings   |  |
|  +----------------+  +-----------------+  +----------------+  |
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

## 3. Phase 1 — Playable web app with saves and auto-map

### Task 1.1 — Scaffold
Vite + React + TypeScript + Vitest + ESLint/Prettier. `idb` for IndexedDB. PWA manifest
and minimal service worker (cache app shell). `.gitignore` includes story-file
extensions. Acceptance: `npm run dev` serves a page; `npm test` runs.

### Task 1.2 — Game library
Upload `.z3/.z5/.z8/.dat/.zblorb` via file picker; store bytes in IndexedDB with
metadata (name, added date, last played). List + delete + "play". Acceptance: reload
the page and the library persists.

### Task 1.3 — Interpreter integration (the risky task — do it early)
Wire `emglken` (Bocfel) + `asyncglk` (GlkOte) to run a story file from the library in
a game panel. **Before coding, read**: Parchment `src/common/launcher.ts` (or nearest
equivalent — verify in source) and Lectrote's emglken wiring, to see the expected
GlkOte options, Dialog instance, and WASM loading. Serve WASM assets locally
(no CDN — the app must work fully offline).
Acceptance: a public-domain z5 game and a v3 story file both play end-to-end with
keyboard input, status line rendering, and correct text styling.
**Decision gate**: if this can't be made to work in reasonable time, switch to the
Parchment single-file iframe fallback (§1.4) and adapt the protocol tap accordingly.

### Task 1.4 — Protocol tap + event bus
Wrap the GlkOte send/receive path so every RemGlk JSON message is observed (not
modified). Emit typed events: `command` (user line input), `status_line` (grid window
contents), `buffer_text` (main window text runs), `input_requested`. Unit-test the
parsing against captured protocol fixtures (record a short play session to JSON and
commit it as a fixture). Acceptance: a debug console pane shows the live event stream.

### Task 1.5 — Saves
- Native saves: ensure the in-game SAVE/RESTORE commands work via AsyncGlk's `Dialog`
  backed by IndexedDB (verify in asyncglk source which Dialog class does browser
  storage; Parchment shows how to instantiate it).
- Export/import: download any stored save as a standard **Quetzal** file; import one back.
- Autosave/resume: investigate AsyncGlk/Parchment autosave support for Z-machine
  (Parchment gained autosave around the RemGlk-rs/Bocfel switch — verify in source).
  If available, wire it so closing the tab and reopening resumes in place. If not,
  fall back to: on resume, offer "restore your most recent save".
- Per-game transcript log persisted to IndexedDB (also feeds phases 2–3).
Acceptance: save in Zork-like game, close tab, reopen, restore, state matches.

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
- Persist the whole graph per game+playthrough in IndexedDB.
Acceptance: vitest suite covering all the rules above using synthetic event sequences.

### Task 1.7 — Auto-map: layout + rendering + editing
- Layout: compass directions map to grid offsets (up/down/in/out get diagonal or
  stacked-level treatment — pick one, document it); collision resolution by shifting;
  simple and deterministic beats fancy force-directed.
- Render as SVG in the map panel: rooms as boxes (current room highlighted), edges as
  lines with direction, dashed for inferred, pan/zoom (pointer events, no heavy deps).
- Editing: drag rooms, delete/merge rooms, delete edges, rename rooms, add notes.
  Edits are sticky (stored flags) so the automapper never undoes a manual change.
- Click a room → optional "travel" (emit the command sequence via BFS over confirmed
  edges) — nice-to-have; skip if time-constrained.
Acceptance: play 10+ rooms of a v3 game; map matches actual geography; manual fixes
survive reload.

### Task 1.8 — Polish & offline
Responsive layout (map collapses to a tab on narrow screens — this is the future
Android UI), dark/light theme, keyboard focus management, service worker caches
everything including WASM (fully offline after first load). Acceptance: Lighthouse PWA
installable check passes; airplane-mode reload works.

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

1. Confirm the PWA already installs and runs well on Android Chrome (it should, from
   Task 1.8).
2. Add **Capacitor**: wrap the built web app; use Capacitor Filesystem/SAF plugin for
   importing story files and exporting Quetzal saves on Android; keep IndexedDB as the
   store (it persists in Capacitor's WebView).
3. Android-specific UX: tabbed game/map layout, on-screen compass rose for movement,
   larger touch targets on the map editor.
4. Optional Play-Store packaging; otherwise distribute the APK directly.
Acceptance: sideloaded APK plays a game, saves, maps, and restores fully offline.

---

## 7. Risks and mitigations

| Risk | Mitigation |
|---|---|
| `emglken`/`asyncglk` npm APIs undocumented or awkward | Read Parchment + Lectrote wiring first; decision gate in Task 1.3 with Parchment-iframe fallback |
| Status-line room name unreliable in some games (v5+ custom status, v6) | Manual "mark room" button; disambiguation rules in Task 1.6; memory-peeking enhancement later |
| Autosave not supported for our stack | Fall back to prompting restore of latest save on resume |
| Bocfel GPL-2.0 | Consume unmodified prebuilt WASM; keep app code separate; attribute in About screen |
| Copyright of Infocom games | Never bundle; user-supplied files only; test with free games |
| LLM hints hallucinate puzzle solutions | Honesty instructions + optional user-supplied walkthrough grounding |

## 8. Suggested execution order & test discipline

Tasks 1.1 → 1.3 (risky integration first) → 1.4 → 1.6 (pure logic, TDD) → 1.5 → 1.7 →
1.8, then phases 2–4 in order. Every pure-logic module (graph, layout, protocol
parsing, prompt assembly) gets vitest coverage from fixtures; UI gets a smoke test.
Record real protocol sessions as fixtures early — they make everything downstream
testable without running the WASM interpreter in CI.
