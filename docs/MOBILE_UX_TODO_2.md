# Mobile UX TODO, round 2 — implementation handoff

Source: owner-reviewed follow-up to `ANDROID_UX_TODO.md` (2026-07-14). All 13 tasks in
that document are done and merged. This document specs the next three batches. It is
written for a smaller implementing model: every task pins down the exact files, the
exact behavior, and an acceptance check. **Do not improvise beyond what a task says.**
If something is ambiguous or a task's instructions conflict with what you find in the
code, STOP that task, leave a `TODO(owner):` comment describing the conflict, and move
to the next task — do not guess.

## Global working agreements (read first, apply to every task)

Identical to `ANDROID_UX_TODO.md`'s agreements; restated so this file stands alone:

1. **Work task-by-task, one commit per task**, in the order listed. Each task must leave
   the app fully working. Commit message format: `UX-<n>: <task title>`.
2. After each task run all four: `npm run lint`, `npm test`, `npm run format`,
   `npm run build`. All must pass before committing. If a task breaks an existing test,
   update the test to match the new specified behavior — the specs below say which
   tests are expected to change; do not delete tests.
3. Verify visually at a 390×844 viewport (Playwright or browser devtools mobile
   emulation) for any task marked **[visual check]**.
4. **Do not touch** anything under `src/engine/` or `src/map/` except where a task
   explicitly names a file there (UX-14 names `src/engine/` files; UX-18 names
   `src/map/graph.ts`, `src/map/mentions.ts` — `src/map/MapScreen.tsx` and the rest of
   the automapper/travel logic stay untouched). Never modify the protocol tap, autosave,
   or tap-to-travel logic beyond what a task explicitly says.
5. All colors/spacing must use the existing CSS custom properties in `src/index.css`
   (`--bg`, `--text`, `--accent`, `--space-*`, `--radius-*`, etc.). Never hard-code a
   hex color in component CSS.
6. All four themes must work: check light, dark, and retro (`data-theme` attribute on
   `<html>`) for every visual change.
7. New UI text is sentence case ("Add sample game", not "Add Sample Game").
8. When a task changes behavior described in `docs/SPECS.md`, add a short dated note to
   the relevant SPECS.md section in the same commit (follow the existing note style).

---

## Batch 1 — never strand the player, never forget them

### UX-14: Char input — "Tap to continue"

**The bug this fixes (highest-impact item in this file):** the engine can request
single-character input (`input_requested` with `type: 'char'` — "press any key to
continue" screens, menus in many Infocom-era games), but nothing in the app can answer
it. `BridgeGlkOte.sendChar` exists (`src/engine/glkote-bridge.ts:50`) but is not exposed
through `EngineHandle`, and the UI just shows "Waiting…" with Send and every chip
disabled. Worse, `engine.ts`'s internal busy/ready queue only clears `busy` on a *line*
input request, so once a game asks for a char, every queued command waits forever — the
app is soft-locked until the tab is killed.

**1. Engine surface** (`src/engine/types.ts`, `src/engine/engine.ts`):

- `types.ts`: add to `EngineHandle`, directly under `sendCommand`:

  ```ts
  /** Answers a `char` input request ("press any key" prompts, menus). Only valid while
   *  the last input_requested event was type 'char'. Does not advance the turn counter
   *  and bypasses the line-command queue — a char prompt IS the ready state. */
  sendChar(value: string): void;
  ```

- `engine.ts`: in the returned object, directly under `sendCommand`:

  ```ts
  sendChar(value) {
    // Deliberately does NOT touch busy/queuedCommands: `busy` stays true across a char
    // prompt (queued *line* commands must not fire into it), and the line request that
    // follows the game's response to this keypress is what clears it and drains the
    // queue, via the existing internal listener.
    glkote.sendChar(value);
  },
  ```

  Do not change the internal listener or `dispatch` — the comment above describes why
  the existing behavior is already correct once `sendChar` exists.

- No change to `protocol-tap.ts`: its `handleEvent` already records char events via
  `onRaw` and correctly emits no `command` event / no turn increment for them.

**2. Store** (`src/state/engineStore.ts`):

- Add to `EngineState` (interface + implementation), under `sendCommand`:

  ```ts
  sendChar(value) {
    activeEngine?.sendChar(value);
    set((s) => ({ pinRequestId: s.pinRequestId + 1 }));
  },
  ```

- **Flush pending text when a char prompt arrives.** Today the transcript only commits
  on a *line* request, so the very text saying "press any key" is invisible while the
  game waits for the key. In `openGame`'s event listener, replace the two branches

  ```ts
  } else if (event.kind === 'input_requested' && event.type === 'line') {
    ...existing commit + autosave...
    set({ inputType: 'line' });
  } else if (event.kind === 'input_requested') {
    set({ inputType: event.type });
  }
  ```

  with one branch:

  ```ts
  } else if (event.kind === 'input_requested') {
    if (!resuming) {
      const response = normalizeResponse(
        stripHistoryReplay(pendingResponseChunks.join('')),
        get().transcript.length === 0,
      );
      // A line request always commits (existing behavior, unchanged). A char request
      // commits only when there is actual text to show — it must never autosave
      // (saveAutosave dispatches a line command, which a char prompt can't accept).
      if (event.type === 'line' || response.trim() !== '') {
        set((s) => ({ transcript: [...s.transcript, response] }));
        void appendTranscriptEntry(gameId, {
          turn: event.turn,
          command: pendingCommand ?? '',
          response,
        });
        pendingCommand = null;
        pendingResponseChunks = [];
      }
      if (event.type === 'line') {
        lastKnownTurn = event.turn;
        if (event.turn > lastAutosaveTurn) {
          lastAutosaveTurn = event.turn;
          void engine
            .saveAutosave()
            .then((bytes) => writeAutosaveGeneration(gameId, bytes, event.turn))
            .catch((err: unknown) => console.error('autosave failed', err));
        }
      }
    }
    set({ inputType: event.type });
  }
  ```

  Note: after a char-prompt commit, the following line-request commit for the same turn
  produces a second (possibly empty) transcript entry with `command: ''` — that is fine
  (the resume rebuild already `.filter(Boolean)`s empty responses; the ring buffer
  doesn't key on turn). Do NOT change `src/storage/transcripts.ts`.

**3. Command bar UI** (`src/story/CommandBar.tsx`) **[visual check]**:

Select `sendChar` from the store (`const sendChar = useEngineStore((s) => s.sendChar);`).
When `inputType === 'char'`, render a replacement form instead of the normal one (the
history `▲`, draft input, `⌫`, and Send are all line-input concepts — none of them
render in char mode; the draft itself is left untouched in the store):

```tsx
if (inputType === 'char') {
  return (
    <div className="command-bar" style={{ paddingBottom: inset }}>
      <form
        className="command-form"
        onSubmit={(e) => {
          e.preventDefault();
          haptic();
          sendChar(' ');
        }}
      >
        <input
          type="text"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          value=""
          aria-label="Type a single key"
          placeholder="Type a key…"
          onChange={(e) => {
            const ch = e.target.value.slice(-1);
            if (!ch) return;
            haptic();
            sendChar(ch);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              haptic();
              sendChar('return');
            }
          }}
        />
        <button type="submit" className="tap-target btn-primary continue-button">
          Tap to continue
        </button>
      </form>
    </div>
  );
}
```

Key semantics (GlkOte char-event values): a literal character for ordinary keys — the
continue button sends a literal space `' '` — and the special name `'return'` for Enter.
Do not invent other special names.

CSS (`src/App.css`): `.continue-button { flex: 1; }` — everything else comes from the
existing `button` reset, `.btn-primary`, and `.command-form` layout.

**4. Tests**:

- `tests/travelTo.test.ts`: the fake `EngineHandle` object no longer satisfies the
  interface — add a `sendChar() {}` stub to it. Nothing else in that file changes.
- `tests/story-ui.test.tsx`, CommandBar describe block, two new tests using the existing
  `useEngineStore.setState({ inputType: ..., sendChar: mock })` pattern:
  1. With `inputType: 'char'` and a mocked `sendChar`: the "Tap to continue" button is
     in the document, the Send button and history `▲` are NOT; clicking the button calls
     `sendChar(' ')`.
  2. Same setup: typing `n` into the key input (`fireEvent.change` with value `'n'`)
     calls `sendChar('n')` and the input stays empty.
- The existing CommandBar tests all run with `inputType: 'line'` and must pass
  unchanged.

Acceptance: lint/tests/build pass. Manual note: no readily-available test game boots
into a char prompt, so live verification is the fake-engine tests plus a devtools poke —
set `useEngineStore.setState({ inputType: 'char' })` in a running session at 390×844 and
confirm the command bar swaps to the continue button in all themes. Record what you did
as a dated note in this task's entry.

**Outcome (2026-07-14): done.** Implemented exactly as specced —
`EngineHandle.sendChar`/`engine.ts`/`engineStore.sendChar` unchanged from the spec above;
the `input_requested` branches in `engineStore.ts` were merged into one, gated on
`event.type === 'line' || response.trim() !== ''` for the commit and `event.type ===
'line'` for the autosave, so a char prompt's own text (e.g. "press any key") reaches the
transcript without ever triggering a silent autosave. `CommandBar.tsx` renders the
continue-button form verbatim from the spec, gated on `inputType === 'char'`.
`npm run lint`/`npm test`/`npm run format`/`npm run build` all pass; `tests/travelTo.test.ts`
got the `sendChar() {}` stub, and the two specified `tests/story-ui.test.tsx` cases were
added (continue button present/Send+history absent/click sends `' '`; typing `n` sends
`'n'` and the key input stays empty). No story file was bundled in the repo yet at the
point this task was done (UX-17, later in this same batch, adds one) and no game is
known to boot straight into a char prompt in ordinary play, so — per this task's own
acceptance note — verification is the fake-engine unit tests above; a live devtools-poke/
real-device pass is still open.

### UX-15: Settings persist across reloads

`uiStore` has no persistence: theme, story font, and text size all reset to defaults on
every launch. (SPECS.md §4 sketches a `settings` row in IndexedDB — it was never built;
this task supersedes it with localStorage, which rehydrates synchronously before first
paint. Add a dated note to SPECS.md §4 saying exactly that.)

**Change** (`src/state/uiStore.ts`): wrap the store in zustand's `persist` middleware
(already available — `zustand/middleware`, no new dependency):

```ts
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export const useUiStore = create<UiState>()(
  persist(
    (set) => ({
      /* ...existing state and actions, completely unchanged... */
    }),
    {
      name: 'text-adventures-settings',
      version: 1,
      partialize: (s) => ({ theme: s.theme, fontScale: s.fontScale, storyFont: s.storyFont }),
    },
  ),
);
```

Persist ONLY those three fields — `tab`, `commandDraft`, `commandHistory`,
`debugConsoleEnabled`, and `roomEditTarget` are session state and must NOT be included
in `partialize`. If TypeScript complains about the partialize return type, annotate the
options object as `PersistOptions<UiState, Pick<UiState, 'theme' | 'fontScale' | 'storyFont'>>`
(imported from `zustand/middleware`) rather than loosening any types.

**Tests** (`tests/setup.ts`): add, after the existing imports:

```ts
import { afterEach } from 'vitest';

afterEach(() => {
  localStorage.clear();
});
```

(jsdom provides `localStorage`; this stops persisted settings from one test leaking into
the next. The existing `useUiStore.setState(initial, true)` reset pattern in
`tests/story-ui.test.tsx` keeps working — `persist` only wraps `set`.)

Add one test, new file `tests/settingsPersist.test.ts`:
`useUiStore.getState().setTheme('retro')`, then assert
`JSON.parse(localStorage.getItem('text-adventures-settings')!).state.theme === 'retro'`,
and that the same JSON does NOT contain a `commandDraft` key.

Acceptance: tests pass; manually (or via Playwright against `npm run dev`): set theme
Retro, story font Serif, text size 120% in More, reload the page — all three survive;
the theme is applied before first paint (no light-theme flash).

**Outcome (2026-07-14): done.** Implemented exactly as specced —
`uiStore.ts` wrapped in `persist()` with `partialize` limited to
`theme`/`fontScale`/`storyFont`; `tests/setup.ts` clears `localStorage` after every test;
`tests/settingsPersist.test.ts` added. `npm run lint`/`npm test`/`npm run format`/
`npm run build` all pass. **Live-verified with Playwright** (390×844,
`npm run build && npm run preview`, real Chromium, not jsdom): set theme Retro, story
font Serif, and text size to 110% via More, then reloaded the page —
`localStorage['text-adventures-settings']` held exactly
`{theme:"retro",fontScale:1.1,storyFont:"serif"}` (no `commandDraft`/`tab`/other session
keys); after reload, `data-theme="retro"` and `--bg: #0d0d0d` were already applied (no
flash), and re-opening More showed Retro/Serif still selected and text size still 110%.
The `tab` correctly reset to Library on reload, confirming it's excluded from
persistence as intended.

### UX-16: Launch straight back into the game

Every launch lands on the Library and costs two taps to get back into the game being
played. Auto-resume instead: if the most recently played game has an autosave, open it
on boot and land on the Story tab. All the resume plumbing (autosave preload, scrollback
rebuild) already exists in `openGame` — this task only adds the boot path.

**New file** `src/state/autoResume.ts` (plain module, no React — same style as
`backButton.ts`):

```ts
import { listGames } from '../storage/games.js';
import { getLatestAutosave } from '../storage/autosaves.js';
import { useEngineStore } from './engineStore.js';
import { useUiStore } from './uiStore.js';

let attempted = false;

/** Test hook only — resets the once-per-boot guard. */
export function resetAutoResumeForTests() {
  attempted = false;
}

/**
 * Boot path: reopen the most recently played game, if it has a live autosave. Runs at
 * most once per page load (React StrictMode double-invokes effects in dev; the guard
 * makes the second call a no-op). A game with no autosave has never actually been
 * played — stay on the Library so "Play" remains an explicit choice.
 */
export async function autoResumeLastGame(): Promise<void> {
  if (attempted) return;
  attempted = true;
  const games = await listGames(); // already sorted by lastPlayedAt, newest first
  const latest = games[0];
  if (!latest) return;
  if (!(await getLatestAutosave(latest.gameId))) return;
  useUiStore.getState().setTab('story');
  await useEngineStore.getState().openGame(latest.gameId);
}
```

Only the single most-recent game is considered — do NOT fall back to older games (a
player who just deleted their current game should land on the Library, not get thrown
into a stale one).

**Wire-up** (`src/App.tsx`): directly after the `attachBackHandler` effect:

```tsx
// Boot path (UX-16): reopen the last-played game so an installed-PWA launch lands
// back in the story, not on the Library.
useEffect(() => {
  void autoResumeLastGame();
}, []);
```

**Tests**: new file `tests/autoResume.test.ts`, modeled on `tests/travelTo.test.ts`
(same `vi.hoisted` + `vi.mock('../src/engine/engine.js')` pattern, same minimal fake
`EngineHandle` — copy it, including the UX-14 `sendChar() {}` stub; import the stores
*after* the mock per vitest's hoisting contract). Call `resetAutoResumeForTests()` in
`beforeEach`. Three cases:

1. No games at all → after `autoResumeLastGame()`, `useUiStore.getState().tab` is still
   `'library'` and `useEngineStore.getState().gameId` is null.
2. A game seeded via `addOrTouchGame` but with no autosave → same expectations as (1).
3. A game seeded via `addOrTouchGame` plus
   `writeAutosaveGeneration(gameId, new Uint8Array([1]), 1)` → tab becomes `'story'`
   and `engineStore.gameId` equals that gameId.
4. Guard: calling `autoResumeLastGame()` twice (without the test reset) only opens once
   (assert the mocked `createEngine` was called exactly once).

Acceptance: tests pass. Manual (Playwright at 390×844): play a couple of turns of any
game, reload the page → the Story tab is active with scrollback restored, no taps
needed; Android Back from there still walks Story → Library → exit (the existing
`backButton.ts` chain — verify the Library step actually happens). Note the verification
in this task's entry, dated.

**Outcome (2026-07-14): done.** Implemented exactly as specced — `src/state/autoResume.ts`
verbatim, wired into `App.tsx` alongside the existing `attachInstallListeners`/
`attachBackHandler` boot effects. `tests/autoResume.test.ts` covers all four cases from
this task's spec (no games; a game with no autosave; a game with a live autosave opens
Story; the once-per-boot guard). `npm run lint`/`npm test`/`npm run format`/
`npm run build` all pass. No story file was bundled in the repo yet at this point in the
batch, so the live Playwright pass (play turns → reload → lands on Story) was deferred to
right after UX-17 landed the sample game — **done, see UX-17's outcome note below**:
reloading after playing a turn of `zork1.z3` lands back on the Story tab with scrollback
intact, no taps needed.

---

## Batch 2 — first-run delight and exit discovery

### UX-17: Bundled sample game [visual check]

An empty Library asks a phone user to produce a `.z5` file — most can't, and the app
dead-ends. Bundle the freely-redistributable Colossal Cave Adventure and offer it from
the empty state, one tap from install to playing.

**1. Obtain the file.** Download `advent.z5` (Graham Nelson's Inform port of Crowther &
Woods' public-domain Adventure — freely redistributable) into `public/advent.z5`:

```
curl -L -o public/advent.z5 https://ifarchive.org/if-archive/games/zcode/advent.z5
```

If that URL 404s, try `Advent.z5` (capital A), or the mirror
`https://mirror.ifarchive.org/if-archive/games/zcode/advent.z5`. Sanity-check the
download: the first byte must be `0x05` (Z-machine version 5 — check with
`od -An -tu1 -N1 public/advent.z5`) and the size should be roughly 100–260 KB. If you
cannot obtain the file, STOP this task per the global rules — do not substitute a
different game or fabricate bytes. **Known blocker (2026-07-14):** `ifarchive.org` is
denied by the remote sandbox's network policy (proxy 403), so this step may have to be
done by the owner locally, or the domain allowed in the environment's network settings,
before this task can proceed.

**2. `.gitignore`**: the story-file block deliberately ignores `*.z5`. Add an exception
line directly after that block, keeping the existing comment intact:

```
# Exception: the bundled sample game is public-domain/freely-redistributable
# (Colossal Cave Adventure, Inform port), so it may be committed.
!public/advent.z5
```

Confirm `git status` shows `public/advent.z5` as addable before committing.

**3. Service worker** (`vite.config.ts`): add `z5` to the workbox glob so the sample
game works offline:
`globPatterns: ['**/*.{js,css,html,wasm,png,svg,ico,z5}']`.

**4. Library UI** (`src/library/LibraryScreen.tsx`): inside the existing
`games.length === 0` empty-state block, after the `<p>`, add:

```tsx
<button
  type="button"
  className="tap-target btn-primary"
  onClick={() => void addSampleGame()}
>
  Add sample game
</button>
```

with, alongside the other handlers:

```tsx
async function addSampleGame() {
  try {
    const res = await fetch(`${import.meta.env.BASE_URL}advent.z5`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const bytes = new Uint8Array(await res.arrayBuffer());
    const record = await addOrTouchGame(bytes, 'Colossal Cave Adventure.z5');
    await resume(record.gameId);
  } catch {
    await useDialogStore.getState().ask({ kind: 'alert', title: 'Could not load the sample game' });
  }
}
```

(`addOrTouchGame` derives the display title by stripping the extension, so the fileName
above yields the title "Colossal Cave Adventure". `resume` is the existing handler —
it sets the Story tab and opens the game, so the tap lands the player directly in the
game's opening text.)

**5. Attribution** (`src/more/licenses.ts`): append one `LicenseEntry`:
name `Colossal Cave Adventure (advent.z5)`, role
`Bundled sample game`, license `Public domain`, text a short paragraph: original game by
Will Crowther and Don Woods (public domain); Inform port by Graham Nelson, distributed
freely via the IF Archive. No license body to reproduce — the paragraph is the text.

**6. SPECS.md**: dated note in §7 (hosting) that `public/advent.z5` is committed as the
bundled sample game, is precached by the service worker, and is the one exception to the
no-story-files rule.

**Tests** (`tests/story-ui.test.tsx` is the wrong home — add to a new
`tests/library.test.tsx`): render `LibraryScreen` (no games in fake-indexeddb), assert
the "Add sample game" button is present. Stub fetch with
`vi.stubGlobal('fetch', ...)` returning `new Response(new Uint8Array([5, 0, 0]).buffer)`
(or an equivalent object with `ok: true` and an `arrayBuffer()` method), and override
`openGame` with `useEngineStore.setState({ openGame: vi.fn() })` so no real engine
starts. Click the button; assert `listGames()` now returns one game titled
`Colossal Cave Adventure` and `useUiStore.getState().tab === 'story'`. Restore the
fetch stub (`vi.unstubAllGlobals`) in `afterEach`.

Acceptance: lint/tests/build pass; at 390×844 with an empty library, tapping
"Add sample game" lands in Adventure's opening text within a second or two; after
`npm run build && npm run preview`, the flow also works with the network offline
(precache) — verify with devtools offline mode, and check the button renders correctly
in all themes.

**Outcome (2026-07-14): done, using `zork1.z3` instead of the originally-specced
`advent.z5`.** `ifarchive.org`/`mirror.ifarchive.org` both 403 through this environment's
proxy (confirmed live) — but the owner pointed at `historicalsource/zork1`, Microsoft's
2025 MIT-licensed historical-preservation release of Zork I, and
`raw.githubusercontent.com` (unlike `github.com`/`api.github.com`) is reachable. Verified
before committing: 86,838 bytes, first byte `0x03` (a real Z-machine v3 header), and
`file` identifies it as "Infocom (Z-machine 3, Release 119, Serial 880429)" — the genuine
commercial Zork I release. `public/zork1.z3` committed with a `.gitignore` exception,
`vite.config.ts`'s `globPatterns` gained `z3`, `LibraryScreen.tsx`'s empty state got the
button + `addSampleGame()` handler (fileName `"Zork I.z3"` → title "Zork I"),
`licenses.ts` got a full MIT attribution entry (plus a one-line trademark disclaimer,
since MIT doesn't grant trademark rights and Zork's original publisher may still hold
one), and `tests/library.test.tsx` covers the empty-state button + stubbed-fetch load
per the spec. `npm run lint`/`npm test`/`npm run format`/`npm run build` all pass.

**Live-verified with real Playwright** (390×844, `npm run build && npm run preview`,
real Chromium): tapping "Add sample game" on a fresh library actually boots real Zork I —
the transcript shows the genuine copyright banner and "West of House" — within about a
second; sending `look` gets the correct room description back; reloading the page lands
back on the Story tab with scrollback intact (this is also UX-16's own acceptance check,
verified together here since both needed a real game to test against). Separately,
with the service worker precache warmed and the browser context set fully offline
(`context.setOffline(true)`), a **fresh reload and a first-ever tap of "Add sample
game"** still booted the real game and printed its opening text — confirming the
precached `.z3` actually serves with zero network, not just the app shell. Button
legibility checked across all three themes (light/dark/retro) via computed text color
against each theme's background — all pass.

**Bonus, not scope creep:** this also gives the repo its first real v3 story file — Task
1.4/1.7's own outcome notes in IMPLEMENTATION_PLAN.md record that no v3 game was
reachable at the time, so all protocol fixtures are v5-only (`advent.z5`). Not acted on
here; noting it for whoever next records a v3 fixture.

### UX-18: Suggested exits from room text [visual check]

Implements the detection/diffing/chips part of IMPLEMENTATION_PLAN.md Task 1.10 (design
sketch already approved there — read it first). Room prose often names exits the player
hasn't tried ("There is a passage to the west"); surface those as soft suggestions on
the exits row and compass. **Scope guard:** map rendering is NOT part of this task —
`src/map/MapScreen.tsx`, `layout.ts`, `travel.ts` stay untouched; suggestions never
create edges and never participate in tap-to-travel's BFS. The only `src/map/` files
this task may touch are `graph.ts` and the new `mentions.ts`.

**1. Detection** — new file `src/map/mentions.ts`, pure functions only:

```ts
import type { Direction } from './graph.js';

/**
 * Task 1.10 detection heuristic, deliberately narrow: only the 8 unambiguous full
 * compass words. Single letters (n/e/s/w), "up"/"down"/"in"/"out", and synonyms are
 * excluded on purpose — ordinary prose is full of them ("pick up", "sit down", "in the
 * corner") and a false suggestion is worse than a missed one. Word-boundary matching
 * means "northern", "westward", and "northeast" do NOT match "north"/"west"/"east".
 */
const MENTION_WORDS: [RegExp, Direction][] = [
  [/\bnortheast\b/, 'ne'],
  [/\bnorthwest\b/, 'nw'],
  [/\bsoutheast\b/, 'se'],
  [/\bsouthwest\b/, 'sw'],
  [/\bnorth\b/, 'n'],
  [/\bsouth\b/, 's'],
  [/\beast\b/, 'e'],
  [/\bwest\b/, 'w'],
];

/** Directions mentioned in a chunk of game prose, deduped, in MENTION_WORDS order. */
export function detectMentionedDirections(text: string): Direction[] {
  const lower = text.toLowerCase();
  return MENTION_WORDS.filter(([re]) => re.test(lower)).map(([, dir]) => dir);
}
```

Known, accepted limitations (do not try to fix them): negations ("no exit to the
south") still match, and exits described without a direction word are missed. That is
why these render as *suggestions*, visually distinct and never map-affecting.

**2. Storage + automapper hook** (`src/map/graph.ts`):

- `RoomNode` gains `mentionedDirections?: Direction[];` (with a one-line comment
  pointing at Task 1.10 / this task). It serializes with the graph for free — no
  storage-layer change.
- `Automapper` gains a private `pendingText = '';`. In `handleEvent`:
  - on `buffer_text`: `this.pendingText += '\n' + event.text; return;`
  - on `status_line`, wrap the existing call:

    ```ts
    if (event.kind === 'status_line') {
      const text = this.pendingText;
      this.pendingText = '';
      this.handleStatusLine(event.left);
      this.applyMentions(text);
    }
    ```

- New private method:

  ```ts
  /** Task 1.10: attach direction words seen in this turn's prose to the room the turn
   *  resolved to. Runs AFTER handleStatusLine so movement text ("You walk north…
   *  Kitchen") attributes to the arrival room, not the origin. */
  private applyMentions(text: string): void {
    const id = this.graph.currentRoomId;
    if (!id || id === UNKNOWN_ROOM_ID) return;
    const room = this.graph.rooms[id];
    if (!room) return;
    const found = detectMentionedDirections(text);
    if (found.length === 0) return;
    const merged = new Set([...(room.mentionedDirections ?? []), ...found]);
    room.mentionedDirections = ALL_DIRECTIONS.filter((d) => merged.has(d));
  }
  ```

  (`ALL_DIRECTIONS` comes from `./directions.js` — import it; it gives a stable
  serialization order.) `handleStatusLine`/`handleMovement` themselves are NOT modified.

**3. UI hook** (`src/story/useKnownExits.ts`): add alongside `useKnownExits`:

```ts
/** UX-18: directions mentioned in the current room's prose that have no live edge yet
 *  (any status) — soft suggestions, never map-affecting. */
export function useSuggestedExits(): Set<Direction> {
  const graph = useMapStore((s) => s.graph);
  return useMemo(() => {
    const out = new Set<Direction>();
    const id = graph.currentRoomId;
    const room = id ? graph.rooms[id] : undefined;
    if (!id || !room?.mentionedDirections) return out;
    const edged = new Set(
      graph.edges.filter((e) => e.from === id && !e.userDeleted).map((e) => e.dir),
    );
    for (const dir of room.mentionedDirections) {
      if (!edged.has(dir)) out.add(dir);
    }
    return out;
  }, [graph]);
}
```

**4. Exits row** (`src/story/ExitsRow.tsx`): consume both hooks. Render `null` only when
BOTH sets are empty. Iterate `ORDER` once; for each dir render a known chip (exactly as
today) if `knownExits.has(dir)`, else a suggested chip if `suggestedExits.has(dir)`:

```tsx
<button
  key={dir}
  type="button"
  className="chip tap-target chip-suggested"
  aria-label={`Try ${dir} (mentioned in the text)`}
  disabled={inputType !== 'line'}
  onClick={() => {
    haptic();
    sendCommand(dir);
  }}
>
  {dir.toUpperCase()}?
</button>
```

**5. Compass** (`src/story/CompassRose.tsx`): consume `useSuggestedExits()`. Extend the
existing className ternaries: `compass-known` when known (unchanged), else
` compass-suggested` when suggested. Apply in both the grid and the vertical strip.

**6. CSS** (`src/App.css`), tokens only:

```css
.chip-suggested {
  border-style: dashed;
  color: var(--text-dim);
}
.compass-suggested {
  border: 1px dashed var(--accent);
}
```

**7. Docs**: dated note in SPECS.md §3 (automapper rules) describing
`mentionedDirections` + the 8-word heuristic and its accepted limitations, and a dated
"partially implemented (detection + chips; map stubs still deferred)" note on
IMPLEMENTATION_PLAN.md Task 1.10.

**8. Tests**:

- New `tests/mentions.test.ts`: `"There is a passage to the west."` → `['w']`;
  `"A chilly northern wind blows westward."` → `[]`; `"Passages lead northeast and
  south."` → `['ne', 's']` (order per MENTION_WORDS/dedup rules); `"No exit to the
  south."` → `['s']` (documents the accepted negation limitation).
- In `tests/graph.test.ts` (new describe block, same fixture style as the existing rule
  tests): feed an `Automapper` the sequence command(`n`) → buffer_text(`"You walk
  north.\n\nKitchen\nThere is a door to the west."`) → status_line(`Kitchen`); assert
  the room named Kitchen has `mentionedDirections` `['w']` and the origin room has none.
  Second case: a subsequent confirmed `w` edge from Kitchen (drive it with command(`w`) →
  status_line(`Pantry`)) — `mentionedDirections` still contains `'w'` (detection never
  un-records), but that's now the hook's problem, not the graph's.
- In `tests/story-ui.test.tsx` (ExitsRow block, mirroring the existing known-exits test
  setup): a graph whose current room has `mentionedDirections: ['w']` and no edges →
  ExitsRow renders a button labeled `Try w (mentioned in the text)`; clicking it calls
  `sendCommand('w')`. Same graph plus a confirmed `w` edge → the `W?` suggested chip is
  gone and the normal `Go w` chip renders instead.

Acceptance: lint/tests/build pass; live at 390×844 (sample game from UX-17 works —
Adventure's opening room mentions a road and a gully; `look` around until a compass word
appears in prose): a dashed `?` chip appears for a mentioned-but-untried direction,
tapping it sends the move, and after the move lands the suggestion is replaced by a
normal exit chip. Check dashed borders are legible in light, dark, and retro themes.

**Outcome (2026-07-14): done.** Implemented exactly as specced — `src/map/mentions.ts`'s
`detectMentionedDirections` verbatim; `graph.ts` gained `RoomNode.mentionedDirections`,
`Automapper.pendingText`/`applyMentions`, and the `buffer_text`-accumulation branch in
`handleEvent`; `useKnownExits.ts` gained `useSuggestedExits`; `ExitsRow`/`CompassRose`
render the dashed suggested state; `.chip-suggested`/`.compass-suggested` CSS added.
`tests/mentions.test.ts` (4 cases), a new `graph.test.ts` describe block (2 cases:
attribution to the arrival room, and that a mention survives a later confirmed edge —
filtering that out is the UI hook's job), and 2 new `ExitsRow` cases in
`story-ui.test.tsx` all added per the spec. `npm run lint`/`npm test`/`npm run format`/
`npm run build` all pass.

**Live-verified with real Playwright** (390×844, `npm run build && npm run preview`)
against the UX-17 sample game — **Zork I, not Adventure** (UX-17 bundled `zork1.z3`
instead of the originally-planned `advent.z5`; this task's acceptance text above wasn't
updated for that swap, noting it here instead): West of House's own arrival text ("You
are standing in an open field **west** of a white house...") produces a dashed "W?" chip
immediately on boot — a real, live example of exactly the false-positive-prone flavor
text this heuristic accepts by design. Tapping it sends `w`, and the game responds by
moving to Forest ("trees in all directions. To the **east**, there appears to be
sunlight."); the exits row then correctly shows *nothing* for Forest, because the
automapper's own reverse-edge rule already created an inferred `e` edge back to West of
House the moment the `w` move confirmed — a live demonstration of `useSuggestedExits`
correctly excluding directions that already have a live edge of any status, not just
confirmed. Checked chip legibility (color + border, plus screenshots) in light, dark,
and retro — dashed border reads clearly against all three.

---

## Batch 3 — story-file smarts

### UX-19: Vocabulary highlighting from the game's own dictionary [visual check]

**Owner-approved (2026-07-14), promoted from this file's appendix.** Every Z-machine
story file embeds its parser dictionary: the complete list of words the game
understands. Parsing it lets the transcript subtly emphasize words the player can
actually interact with — real nouns light up, filler prose doesn't — fully offline,
pure byte-reading, no LLM. The emphasis must be **subtle** (owner decision: plain bold,
no color change) and **toggleable in settings** (default ON).

**Scope decision (2026-07-14, owner-reviewed): dictionary ONLY — object-table short
names are deliberately excluded from this task.** The highlight is a promise that "you
can use this word in a command", and the dictionary is the exact set of typable words
(the parser tokenizes against it; everything else gets "I don't know the word"). Object
short names are what the game *prints*, not what it accepts: using them would highlight
printed-only words the parser rejects (a "Ming vase" you can only call "vase" — tap →
failed command, a false affordance) while missing typable synonyms that appear in no
object name ("lamp" for the object printed as "brass lantern"). Every referenceable
object-name word is in the dictionary anyway, so merging the sets adds ~nothing. Object
names have real value for *other* features (noun-phrase composition, object chips —
see the appendix), as a later extension of this task's decoder. Do not add object-table
parsing to this task.

**Ordering dependency:** do this task after UX-15 (its settings toggle joins the
persisted fields). It does not depend on UX-14/16/17/18.

Format references below are the Z-Machine Standards Document 1.1, §13 (dictionary) and
§3 (text encoding). All offsets are big-endian. **Note (2026-07-14):** the standard's
website and a live `advent.z5` were both unreachable from the authoring environment
(network policy), so the byte layout below is from the standard as known — the
encoder/decoder round-trip tests in this task are the authoritative check, and the
acceptance step includes a real-file sanity check. If a real story file disagrees with
this spec, STOP and leave a `TODO(owner):` note rather than improvising.

**1. Parser** — new file `src/engine/dictionary.ts` (this task's named exception to the
`src/engine/` rule; a pure module — no WASM, no DOM, no imports from the rest of
`src/engine/`):

```ts
export interface Vocabulary {
  /** Lowercased dictionary words, already stopword-/direction-filtered. */
  words: Set<string>;
  /** Stored dictionary words are truncated to this many Z-characters: 6 in v1–3
   *  files, 9 in v4+. Used for prefix matching ("lantern" -> stored "lanter"). */
  truncationLength: 6 | 9;
}

/** Parses the parser dictionary out of Z-machine story bytes (bare z-code or a blorb
 *  wrapper). Returns null — never throws — on anything unparseable: wrong version,
 *  truncated file, out-of-range addresses. Callers treat null as "feature off". */
export function parseVocabulary(bytes: Uint8Array): Vocabulary | null;
```

Implementation, in order (wrap the whole body in `try { ... } catch { return null; }`
AND bounds-check every read — a corrupt upload must never crash `openGame`):

1. **Blorb unwrap.** If bytes 0–3 are `FORM` and bytes 8–11 are `IFRS` (a blorb —
   compare with `src/storage/gameId.ts`'s `detectFormat`), walk the IFF chunks starting
   at offset 12: each chunk is a 4-byte id, a 4-byte big-endian length, `length` data
   bytes, plus one pad byte when `length` is odd. Take the contents of the first `ZCOD`
   chunk as the story bytes; if there is none, return null.
2. **Version gate.** Byte 0 of the story is the Z-machine version. Accept 3–8 only;
   return null for 1, 2, or anything else (v1/v2 use different shift semantics and are
   effectively extinct — not worth the code).
3. **Dictionary address**: the 16-bit word at offset `0x08` (byte address into the
   story bytes).
4. **Dictionary layout** (Standard §13.2), starting at that address:
   - 1 byte: number of word separators `n`; skip the next `n` bytes (separator ZSCII
     codes, e.g. `.` and `,` — not needed).
   - 1 byte: `entryLength` (bytes per entry). Must be ≥ 4 for v3, ≥ 6 for v4+;
     otherwise return null.
   - 2 bytes: entry count, read as a signed 16-bit value and `Math.abs`'d (a negative
     count means "unsorted" and is legal). If the count is 0, > 20000, or
     `address + count * entryLength` runs past the end of the bytes, return null.
   - Then `count` entries of `entryLength` bytes each. Only the encoded text at the
     start of each entry matters: 4 bytes (= 6 Z-characters) in v3, 6 bytes (= 9
     Z-characters) in v4+. The remaining data bytes per entry are game-specific flags —
     ignore them (they are NOT reliable part-of-speech data across compilers).
5. **Z-text decoding** (Standard §3) for each entry, producing a lowercase string or
   null (skip the entry) if anything unexpected appears:
   - Each 16-bit word holds three 5-bit Z-characters (bits 14–10, 9–5, 4–0). The top
     bit of the word marks the end of the string; for fixed-length dictionary text just
     decode all 6/9 Z-characters.
   - Alphabets (v3+ defaults):
     - A0 (codes 6–31): `abcdefghijklmnopqrstuvwxyz`
     - A1 (codes 6–31): `ABCDEFGHIJKLMNOPQRSTUVWXYZ`
     - A2 (codes 6–31): code 6 = ZSCII escape, code 7 = newline, codes 8–31 =
       `0123456789.,!?_#'"/\-:()`
   - Z-char 0 = space; Z-chars 1–3 = abbreviation escapes (never legitimately used in
     dictionary words — treat as "skip this entry"); Z-char 4 = shift the NEXT char to
     A1; Z-char 5 = shift the NEXT char to A2 (one-shot shifts, current alphabet
     returns to A0 after); trailing padding is by convention Z-char 5s — bare trailing
     5s (a shift with nothing after it) simply end the word.
   - A2 code 6 (ZSCII escape): the next TWO Z-characters form a 10-bit ZSCII code
     (first is the top 5 bits). Map codes 32–126 to ASCII; anything else, skip the
     entry.
   - **Custom alphabet (v5+):** if the 16-bit word at story offset `0x34` is nonzero,
     it is the byte address of a 78-byte alphabet table — 26 ZSCII bytes each for
     A0, A1, A2 (in that order), replacing the defaults for codes 6–31. Regardless of
     the table's contents, A2 code 6 stays the ZSCII escape and A2 code 7 stays newline
     (Standard §3.5.5).
6. **Filtering**, applied to each decoded word before it enters the set:
   - keep only words matching `/^[a-z][a-z'-]+$/` (dictionaries contain bare
     punctuation entries like `,` and `"` as separators, plus digit strings — drop
     them; minimum length 2);
   - drop words in `VOCAB_STOPWORDS` (below).

   Define in the same file (exact list — copy verbatim):

   ```ts
   /** Function words, parser verbs already covered by chips, and direction words
    *  already covered by the exits row/compass — highlighting these would make the
    *  whole transcript bold. (Direction aliases duplicated from src/map/directions.ts
    *  rather than imported: that module is a verified subsystem this task must not
    *  modify, and its ALIASES table is deliberately not exported.) */
   const VOCAB_STOPWORDS = new Set([
     // articles, determiners, pronouns
     'a', 'an', 'the', 'all', 'some', 'any', 'this', 'that', 'these', 'those', 'each',
     'every', 'both', 'other', 'it', 'its', 'me', 'my', 'you', 'your', 'he', 'him',
     'his', 'she', 'her', 'they', 'them', 'their', 'we', 'us', 'our', 'itself',
     'myself', 'yourself', 'one', 'ones',
     // prepositions, conjunctions, adverbs
     'at', 'of', 'to', 'for', 'from', 'with', 'without', 'into', 'onto', 'under',
     'over', 'behind', 'above', 'below', 'across', 'through', 'about', 'around',
     'between', 'beside', 'near', 'and', 'or', 'but', 'not', 'if', 'then', 'when',
     'while', 'as', 'so', 'than', 'too', 'very', 'here', 'there', 'now', 'again',
     'off', 'on', 'yes', 'no', 'oh', 'please',
     // auxiliaries and parser verbs the chips already cover
     'is', 'are', 'was', 'were', 'be', 'been', 'am', 'do', 'does', 'did', 'have',
     'has', 'had', 'can', 'could', 'will', 'would', 'shall', 'should', 'may', 'might',
     'must', 'go', 'get', 'put', 'look', 'take', 'drop', 'open', 'close', 'examine',
     'inventory', 'wait', 'say', 'tell', 'ask', 'give', 'read', 'search', 'quit',
     'save', 'restore', 'restart', 'verbose', 'brief', 'score',
     // directions (mirror of directions.ts ALIASES, plus bare abbreviations)
     'n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw', 'u', 'd', 'north', 'south', 'east',
     'west', 'northeast', 'northwest', 'southeast', 'southwest', 'up', 'down', 'in',
     'out', 'enter', 'exit', 'leave',
   ]);
   ```

   Export a matching helper (this is what the UI calls per token):

   ```ts
   /** True when `word` (any case) is in the game's vocabulary, including the
    *  truncated-storage case: "lantern" matches a stored "lanter" in a v3 game.
    *  Approximation: truncation is measured in Z-characters, not letters, so words
    *  with non-a-z characters can be truncated earlier than `truncationLength` —
    *  those rare cases just miss the highlight, which is fine. */
   export function isVocabWord(word: string, vocab: Vocabulary): boolean {
     const lower = word.toLowerCase();
     return (
       vocab.words.has(lower) ||
       (lower.length > vocab.truncationLength &&
         vocab.words.has(lower.slice(0, vocab.truncationLength)))
     );
   }
   ```

**2. Store plumbing**:

- `src/state/engineStore.ts`: add `vocabulary: Vocabulary | null` to `EngineState`
  (initial `null`). In `openGame`, right after the `set({ gameTitle: game.title })`
  line: `set({ vocabulary: parseVocabulary(new Uint8Array(game.bytes)) });` (the
  function already returns null on failure — no extra guard). Reset to `null` in
  `closeGame` and in `openGame`'s initial reset `set`.
- `src/state/uiStore.ts`: add `highlightVocab: boolean` (default `true`) with setter
  `setHighlightVocab`, and add `highlightVocab` to the UX-15 `partialize` so it
  persists.

**3. Rendering** (`src/story/TapWords.tsx`): inside the component, select
`const vocabulary = useEngineStore((s) => s.vocabulary);` and
`const highlightVocab = useUiStore((s) => s.highlightVocab);`; compute
`const vocab = highlightVocab ? vocabulary : null;` and pass `vocab` through to
`renderLineTokens` as a new parameter. In the word-span render, the className becomes:

```ts
const isVocab = vocab !== null && isVocabWord(word, vocab);
// ...
className={`tap-word${isVocab ? ' tap-word-vocab' : ''}`}
```

(zustand hooks inside a `memo` component still resubscribe correctly — toggling the
setting or the vocabulary loading re-renders every block even though the `text` prop is
unchanged. Command-echo lines get the same treatment; `.story-echo` is already
bold+dim, so the highlight is visually inert there — that's fine, do not special-case
it.)

**4. CSS** (`src/App.css`) — the whole point is subtlety; this is the entire rule:

```css
/* UX-19: words the game's parser knows. Bold only — no color, no underline. */
.tap-word-vocab {
  font-weight: 600;
}
```

**5. Settings UI** (`src/more/MoreScreen.tsx`): add a settings row "Highlight known
words" with hint "Bold the words this game understands", following the exact pattern of
the existing Debug console toggle row (label + checkbox), wired to
`highlightVocab`/`setHighlightVocab`.

**6. Docs**: dated notes in SPECS.md — §4 (the UX-15 note gains `highlightVocab` as a
persisted field) and §5 (list `src/engine/dictionary.ts` as a pure story-file parsing
module, alongside a one-line description of the feature and its off-switch).

**7. Tests** — new `tests/dictionary.test.ts`. Build story bytes in the test with two
small helpers (put them in the test file, not `src/`):

```ts
/** Packs lowercase-only words into dictionary z-text (A0 chars 6-31, padded with
 *  z-char 5, top bit set on the final word). zchars per entry: 6 (v3) or 9 (v4+). */
function encodeWord(word: string, zchars: 6 | 9): number[]; // returns 4 or 6 bytes

/** Assembles a minimal story: 64-byte header (version byte at 0, dictionary address
 *  word at 0x08, alphabet-table word at 0x34 left 0), then the dictionary table
 *  (0 separators, given entryLength, count, entries with zero data bytes). */
function buildStory(version: number, words: string[]): Uint8Array;
```

Cases:

1. v3 story with `['lamp', 'grate', 'xyzzy', 'lantern']` → set contains `lamp`,
   `grate`, `xyzzy`, and `lanter` (truncated at 6); `truncationLength === 6`;
   `isVocabWord('lantern', v)` and `isVocabWord('Lamp', v)` are true;
   `isVocabWord('lantic', v)` is false.
2. v5 story with `['lantern']` → set contains the full `lantern`;
   `truncationLength === 9`.
3. Stopword/direction filtering: v3 story with `['the', 'north', 'sword']` → set is
   exactly `{'sword'}`.
4. Shifted characters: hand-pack one v3 entry whose z-chars are
   `[4, 11, 20, 12, 5, 5]` (shift-A1, `f`→`F`, `o`, `g`, pad, pad — decodes to `Fog`)
   and assert the set contains `fog` (lowercased) — this pins the one-shot shift and
   the lowercasing.
5. Corruption safety: version byte 1 → null; a dictionary address pointing past the end
   of the bytes → null; an entry count of 30000 → null. None of them throw.
6. Blorb unwrap: wrap case 1's story in `FORM` + `IFRS` with one junk chunk before the
   `ZCOD` chunk (odd-length, to exercise the pad byte) → same result as case 1.

Plus, in `tests/story-ui.test.tsx` (TapWords block): with
`useEngineStore.setState({ vocabulary: { words: new Set(['lamp']), truncationLength: 6 } })`
and `highlightVocab: true`, render `<TapWords text="A brass lamp sits here." />` →
the span containing `lamp` has class `tap-word-vocab` and the one containing `brass`
does not; with `highlightVocab: false`, no element has the class. (Both spans keep
`tap-word` and stay tappable — assert the `lamp` tap still appends to the draft.)

Acceptance: lint/tests/build pass. Live check at 390×844 against a real game (the UX-17
sample if available): nouns like "lamp"/"building"/"keys" render bold; "the"/"you"/
"and" do not; the More-screen toggle removes and restores the bolding live and survives
a reload (UX-15); check the effect stays subtle in all four themes AND all three story
fonts (serif bold in particular). If no real story file is available in the
environment, note that the live check is pending real-device/owner verification, dated,
in this task's entry.

**Outcome (2026-07-14): done.** Implemented exactly as specced — `src/engine/dictionary.ts`
(blorb unwrap, version gate, dictionary-table parsing, Z-text decoding with one-shot
A1/A2 shifts and the ZSCII escape, custom v5+ alphabet-table support, the verbatim
stopword list, and `isVocabWord`'s truncation-aware matching); `engineStore.vocabulary`
set right after `gameTitle` in `openGame`, reset to `null` in `closeGame` and the
initial reset; `uiStore.highlightVocab` (default on) joins the UX-15 persisted slice;
`TapWords` computes `vocab = highlightVocab ? vocabulary : null` and adds
`tap-word-vocab` conditionally without touching the UX-12 long-press logic; the
"Highlight known words" row in `MoreScreen` follows the Debug-console checkbox pattern
exactly. `tests/dictionary.test.ts` covers all 6 spec cases (v3 truncation, v5 no
truncation, stopword/direction filtering, one-shot A1 shift, corruption safety
including a version-1 file/an out-of-range dictionary address/a 30000 entry count all
returning null without throwing, and blorb unwrap through a junk chunk exercising the
odd-length pad byte) plus the two `TapWords` cases in `story-ui.test.tsx`. `npm run
lint`/`npm test`/`npm run format`/`npm run build` all pass (118 tests total).

**Live-verified with real Playwright** (390×844, `npm run build && npm run preview`)
against the real Zork I dictionary bundled by UX-17 — genuinely reading the actual
parser dictionary Microsoft's compiler embedded in `zork1.z3`, not a stub: at West of
House, "House", "white", "boarded", "front", "door.", "small", and "mailbox" render
bold, while "You", "are", "standing", "in", "an", "open", "field", "west", "of", "a",
"with", and "There"/"is"/"here." do not — a real, correct split between the game's
actual nouns/adjectives and function words/stopwords. Toggling "Highlight known words"
off in More removed all bolding live (0 bold words); toggling back on and reloading the
page restored it (11 bold words, matching pre-toggle) — confirming both the live toggle
and its UX-15 persistence. Checked font-weight (600 bold vs. 400 normal) across all 9
theme × story-font combinations (light/dark/retro × system/serif/mono) — all pass, and
serif screenshots specifically confirm the bold reads clearly without any color change
in every theme, exactly the "subtle" design intent.

---

## Batch 4 — multi-level maps

Source: owner design discussion 2026-07-16, following the forest-maze automapper fixes
(SPECS.md §3's 2026-07-15/07-16 notes). Currently every room lands on one flat 2D plane;
`up`/`down` edges just get a diagonal grid nudge (`directions.ts`'s `up`/`down` offsets,
`layout.ts:34`) that visually tangles a basement's own geography with the ground floor's
the moment either gets non-trivial. Split into two tasks: UX-20 is data-model-only (no
visual change, safe to ship alone), UX-21 is the rendering/UI half that depends on it.

### UX-20: Room floor field + auto-inference

**Scope guard:** this task touches `src/map/graph.ts`, `src/state/mapStore.ts`, and
`tests/graph.test.ts` only. No `layout.ts`/`MapScreen.tsx`/`RoomEditSheet.tsx` changes —
that's UX-21. Floor assignment must NOT participate in `resolveRoomOnArrival`'s identity
resolution (rule 6) — it's orthogonal metadata, written after a room's identity is
already settled, same "small, additive, doesn't touch existing logic" discipline UX-18's
`applyMentions` used for `mentionedDirections`.

**1. Data model** (`graph.ts`'s `RoomNode` interface, alongside `mentionedDirections`):

```ts
/** Batch 4 / UX-20: which level this room is on, relative to the game's first room
 *  (floor 0). undefined means "never assigned" — treat as 0 everywhere it's read.
 *  Auto-inferred from up/down moves (see Automapper.applyFloor); sticky once set,
 *  whether by inference or by the user (floorLocked), same as posLocked/rule 7. */
floor?: number;
/** True once a user edits floor directly (RoomEditSheet, UX-21) — the automapper must
 *  never overwrite a floorLocked room's floor afterward. */
floorLocked?: boolean;
```

**2. Auto-inference** (`Automapper.handleMovement`, after `destRoom` is resolved): if
`compassDir` is exactly `'up'` or `'down'` (**not** `'in'`/`'out'` — deliberate scope
decision: entering/leaving a structure doesn't reliably imply a level change in IF
convention — Zork's own `in`/`out` of the house stay on the same floor; only `up`/`down`
do), and `destRoom.floor === undefined` (never overwrite an already-assigned floor —
whether it came from an earlier inference or a user edit; two staircases between the
same two floors might disagree with a naive relative computation, and sticky-once-set is
the same "never destroy established data" policy the contradiction-split logic already
uses elsewhere in this file):

```ts
private applyFloor(fromId: string | null, compassDir: Direction | null, destRoom: RoomNode): void {
  if (destRoom.floor !== undefined) return;
  if (fromId == null) {
    destRoom.floor = 0; // first room of the game, or a teleport with no origin
    return;
  }
  if (compassDir !== 'up' && compassDir !== 'down') return;
  const fromFloor = this.graph.rooms[fromId]?.floor ?? 0;
  destRoom.floor = fromFloor + (compassDir === 'up' ? 1 : -1);
}
```

Call it from `handleMovement` right after `destRoom` is resolved (before the
edge-bookkeeping `if (from != null)` block, so it also runs for the true-teleport
bootstrap path in `handleStatusLine` — call it there too, with `fromId=null`, so every
room in the graph ends up with SOME floor value, never leaving a "hole" a later reader
has to `?? 0`-guard against forever). Decide the exact call sites at implementation
time; the acceptance tests below pin down the required behavior regardless of exactly
where the call lives.

**3. User override** (`graph.ts`, mirroring `moveRoom`'s exact shape):

```ts
/** Batch 4 / UX-21's RoomEditSheet field calls this. Locks the floor so the automapper
 *  never re-infers over it (rule 7 — same contract as moveRoom/posLocked). */
export function setRoomFloor(graph: MapGraph, id: string, floor: number): void {
  const room = graph.rooms[id];
  if (!room) return;
  room.floor = floor;
  room.floorLocked = true;
}
```

`mapStore.ts` gains a `setRoomFloor(id, floor)` action calling this then `commit(set)`
(no `computeLayout` call needed from this task — UX-21 decides if/when layout re-runs on
a floor edit), mirroring the existing `moveRoom` action's exact shape.

**4. Tests** (`tests/graph.test.ts`, new `describe('Batch 4: room floors', ...)`):
- Fresh game: the first room gets `floor: 0`.
- `up` from a floor-0 room → new room gets `floor: 1`; `down` from floor 0 → new room
  gets `floor: -1`; a further `up` from THAT room gets `floor: 2`.
- `in`/`out` never assign/change floor (explicit test — documents the scope decision).
- An `up`/`down` arrival at an ALREADY floor-assigned room (existing room, matched via
  rule 6) does NOT overwrite its floor, even when the naive relative computation would
  disagree (simulate two convergent staircases giving conflicting answers).
- `setRoomFloor` sets `floorLocked: true`; a subsequent auto-inference attempt on that
  same room (another up/down arrival landing there) leaves both `floor` and
  `floorLocked` untouched.
- The "round-trips a graph through JSON" serialization test (existing, near the bottom
  of the file) gains a room with `floor`/`floorLocked` set and asserts they survive.

**Acceptance:** lint/tests/build pass. No behavioral or visual change to the map screen
— `tests/layout.test.ts`, `tests/travelTo.test.ts`, and every MapScreen-adjacent test
must pass completely unmodified, since nothing reads `RoomNode.floor` until UX-21.

**5. Docs:** dated SPECS.md note under §1 (RoomNode shape) describing `floor`/
`floorLocked` and the up/down-only, sticky-once-set inference rule.

**Outcome (2026-07-16): done, implemented exactly as specced.** `RoomNode` gained
`floor`/`floorLocked`; `Automapper.applyFloor` (`src/map/graph.ts`) is called from both
`handleMovement` and the true-teleport bootstrap path in `handleStatusLine`, exactly per
the sketch above — up/down-only inference, sticky-once-set (guarded by
`destRoom.floor !== undefined`, which covers both the auto-inferred and user-locked
cases without needing a separate `floorLocked` check). `setRoomFloor` added to
`graph.ts` and wired through as a `mapStore.setRoomFloor(id, floor)` action, mirroring
`moveRoom`'s shape. New `describe('Batch 4: room floors', ...)` in `tests/graph.test.ts`
covers every case in the test list above, plus the JSON round-trip test was extended
with a `floor`/`floorLocked` room. `npm run lint`, `npm test` (all pre-existing suites,
including `tests/layout.test.ts`/`tests/travelTo.test.ts`, unmodified and passing), and
`npm run build` all pass.

---

### UX-21: Floor-aware map rendering + switcher UI [visual check]

Depends on UX-20 shipping first. This is the rendering half — floors become visible and
editable. **Scope guard:** do not change `graph.ts`'s floor *inference* logic here; this
task only reads `RoomNode.floor`/`floorLocked`, plus adds the `RoomEditSheet` field that
calls UX-20's `setRoomFloor`.

**1. `layout.ts`:** `computeLayout(graph)` keeps its existing signature and every
existing call site in `mapStore.ts` unchanged. Internally, refactor its current body
into a private `layoutFloor(graph, roomsOnFloor, startId)` (same BFS/collision-avoidance
algorithm as today, verbatim) and have the public `computeLayout` group
`Object.values(graph.rooms)` by `room.floor ?? 0` first, then call `layoutFloor` once per
distinct floor. Each floor's BFS start: `graph.currentRoomId`'s room if it belongs to
that floor, else that floor's first `posLocked` room, else that floor's first room by
insertion order (deterministic — matches the existing single-floor fallback's spirit).
In `layoutFloor`'s neighbor walk (today's `neighborsOf`), only follow an edge if both
endpoints are on the same floor (`(graph.rooms[edge.to].floor ?? 0) === (graph.rooms[edge.from].floor ?? 0)`)
— a crossing edge is simply skipped during layout, never removed from `graph.edges`.
Different floors reuse the same x/y coordinate space (e.g. floor 0 and floor 1 can both
have a room at `{x:2,y:3}`) — harmless, since MapScreen (below) only ever renders one
floor's rooms at a time, so two floors' positions are never compared or drawn together.

**2. `uiStore.ts`:** add session-only state (NOT in `persistOptions` — same as
`roomEditTarget`):
```ts
/** Batch 4 / UX-21: which floor MapScreen shows. null = auto-follow the current room's
 *  floor; a number = the player manually switched and stays there until they tap back
 *  to auto-follow or load a different game. */
activeFloor: number | null;
setActiveFloor: (floor: number | null) => void;
```

**3. `MapScreen.tsx`:**
- `const floors = useMemo(() => [...new Set(rooms.map((r) => r.floor ?? 0))].sort((a, b) => a - b), [rooms]);`
- `const currentFloor = roomsById.get(graph.currentRoomId ?? '')?.floor ?? 0;`
- `const displayFloor = activeFloor ?? currentFloor;` (auto-follow falls out of this for
  free — no extra effect needed: when the player moves to a new floor and `activeFloor`
  is still `null`, `displayFloor` just recomputes on the next render.)
- Filter `rooms` to `(r.floor ?? 0) === displayFloor` before computing `viewBox`/segments
  — `fitViewBox`/`buildSegments` both already take a room/graph list, so this is a
  filter at the call site, not a change to either function's signature.
- Floor switcher: only rendered when `floors.length > 1`, placed in `.map-header`
  alongside the existing "⤢ Fit" button. One tap-target chip per floor, sorted, labeled
  "Ground" for floor 0, "+N" for positive floors, and the plain negative number (e.g.
  "-1") for floors below ground; `aria-pressed` on the active one, `onClick={() =>
  setActiveFloor(floor)}`.
- A small "return to current floor" indicator/button, shown only when
  `activeFloor !== null && activeFloor !== currentFloor`, calling
  `setActiveFloor(null)` — same header row, mirrors the Fit button's placement/style.
- Reset `activeFloor` to `null` whenever `gameId` changes (alongside the existing
  re-fit-once-per-game effect at `MapScreen.tsx:136-142`) so switching games doesn't
  strand the view on a stale floor number.

**4. `buildSegments`:** split its output into the existing same-floor line segments
(now naturally floor-scoped, since it only ever receives the pre-filtered room list) and
a new list of cross-floor stubs: for each non-`userDeleted` edge whose `dir` is `up` or
`down` (use `isStubDirection` plus a floor-mismatch check — `in`/`out` never cross floors
per UX-20, so this reduces to up/down in practice) where `graph.rooms[edge.from].floor`
differs from `graph.rooms[edge.to].floor`, and `edge.from` is on `displayFloor`: emit one
stub per `(from-room, direction)` — if both a confirmed and inferred edge exist for the
same room+direction, prefer confirmed (same tie-break `buildSegments` already applies to
normal segments). Render each stub as a small pill/button at the source room's position
(not a line stretching off toward an undrawn room), labeled `↑ +1`/`↓ −1` style (sign
relative to `displayFloor`), `onClick` calls `setActiveFloor(otherFloor)`. Centering the
view on the destination room after the switch is a nice-to-have, not required for
acceptance.

**5. `RoomEditSheet.tsx`:** add a "Floor" field below Note, same `<label
className="room-edit-field">` pattern as Name/Note — a `<input type="number">` seeded
from `room.floor ?? 0`, `onBlur` parses with `Number.parseInt` (ignore non-numeric input,
same defensive style as Name's `.trim()` guard) and calls the new `setRoomFloor` action.

**6. CSS (`App.css`):** new classes for the floor switcher chips and the edge stub pill
— reuse existing `--space-*`/`--radius-*`/`--accent`/`--text-dim` tokens, no hard-coded
colors (global working agreement #5). Check light/dark/retro (#6).

**7. Docs:** dated SPECS.md note describing the floor-aware layout/rendering, and a
"component inventory" line update for `MapScreen` mentioning the floor switcher.

**8. Tests:**
- `tests/layout.test.ts`: add a case with an `up` edge to a `floor: 1` room and assert
  each floor's rooms independently satisfy whatever positioning invariants the existing
  tests already check for a single floor (read the current test bodies first and mirror
  their exact assertion style — don't invent a new style).
- A `MapScreen`-rendering test (check first whether one already exists to extend, e.g.
  in `tests/story-ui.test.tsx` or a dedicated file, and follow its existing rendering/
  interaction-test setup): floor switcher absent with 1 floor, present with 2+; tapping
  a floor chip changes which rooms render; the "return to current floor" control
  appears/disappears correctly as `activeFloor` changes.

**Acceptance:** lint/tests/build pass; live at 390×844 with the UX-17 sample game (Zork
I) — going `u` from Forest Path (Up a Tree) is the easiest reachable up/down edge to
verify against: confirm a floor switcher appears with 2 entries once both floors are
explored, confirm the edge renders as a labeled stub/button rather than a line stretching
off-canvas, confirm tapping it switches floors, confirm the RoomEditSheet's new Floor
field edits persist across reload (IndexedDB round-trip via the existing `saveMap`
debounce). Check chip/pill legibility in light, dark, and retro themes.

**Outcome (2026-07-16): done, implemented exactly as specced.** `layout.ts`'s
`computeLayout` now groups rooms by `floor ?? 0` and calls a private `layoutFloor`
(the original BFS/collision algorithm, unchanged) once per floor; `neighborsOf` gained a
`floor` parameter and skips any edge whose destination isn't on that floor (a crossing
edge is only skipped for layout purposes — never removed from `graph.edges`).
`uiStore.activeFloor`/`setActiveFloor` added as session-only state (not persisted, same
as `roomEditTarget`). `MapScreen.tsx` derives `floors`/`currentFloor`/`displayFloor`,
filters rendered rooms to `displayFloor`, and `buildSegments` now returns both
same-floor `segments` and cross-floor `stubs` (small tappable pills at the source
room's position, labeled e.g. "↑ +1"/"↓ −1", `onClick` calls `setActiveFloor`). The
floor switcher (one chip per floor, "Ground" for 0) only renders once `floors.length >
1`; a "↩ Current floor" button appears whenever the player has manually browsed away
from their actual current floor; both live in the existing `.map-header`.
`RoomEditSheet.tsx` gained a numeric Floor field calling the new `mapStore.setRoomFloor`
action. `activeFloor` resets to `null` (auto-follow) whenever `gameId` changes, folded
into the existing once-per-game re-fit effect.

New coverage: `tests/layout.test.ts` gained a two-floor case asserting each floor lays
out independently and can freely reuse the other floor's coordinates; a new
`tests/mapScreen.test.tsx` (no prior `MapScreen` render test existed) covers the floor
switcher's absence/presence, floor-chip tap changing which rooms render, the
current-floor return control's appear/disappear, and the cross-floor stub's presence and
click. `npm run lint`, `npm test` (145 tests, all green), `tsc -b`, and `npm run build`
all pass.

**Live verification** (390×844, real Bocfel + the bundled `zork1.z3`, driven via
Playwright): West of House → n → n (Forest Path) → `up` (climbs the tree, arrives "Up a
Tree" — confirmed by the egg/nest description) → Map tab: floor switcher shows exactly
`Ground`/`+1`, auto-following to floor +1 (the player's actual floor); the ground-floor
`down` edge from "Up a Tree" renders as a "↓ -1" stub, not a line to an undrawn room;
dispatching a click on the stub correctly flips `activeFloor` to 0, re-renders the Ground
floor's rooms, and shows the "↩ Current floor" button (screenshotted); the RoomEditSheet
Floor field read the correct initial value and, after being set and blurred, persisted
across a full page reload (IndexedDB round-trip via `saveMap`'s debounce) — confirmed by
the floor switcher still showing 2 floors post-reload. One environment-specific wrinkle
found and **not** a product bug: Playwright's synthetic `.click()`/`{force:true}` on the
stub's SVG `<g>` intercepted `elementFromPoint` correctly but didn't reliably fire
React's `onClick` in this headless run; a raw `dispatchEvent(new MouseEvent('click',
{bubbles:true}))` at the same coordinates fired it every time with the exact expected
state transition, and the jsdom-based `fireEvent.click` in `tests/mapScreen.test.tsx`
(same dispatch mechanism) passes reliably — real touch/mouse input goes through the
normal browser event path this exercises, not Playwright's synthetic one, so this is
scoped to the verification harness, not the shipped code.

---

## Batch 5 — undo, text styling, timed input

Source: `docs/ZMACHINE_CAPABILITIES_RESEARCH.md` (2026-07-16 research pass + its
2026-07-16 peer-interpreter addendum), owner-reviewed same day. Promotes that doc's
Tier 1 item 1 (Undo), Tier 2 item 3 (text styling passthrough), and Tier 2 item 5
(timed input) to specced tasks. **Explicitly NOT promoted** by the same owner review:
addendum item G (read-aloud/TTS — owner called it "a potential reach") and addendum
item H (exportable transcripts — owner called it "less useful"). Both stay recorded in
the research doc for a later look; do not build them as part of this batch.

Same global working agreements as every prior batch (top of this file) apply: one
commit per task, `npm run lint`/`npm test`/`npm run format`/`npm run build` all green
before each commit, visual checks at 390×844 across all three themes, CSS tokens only,
sentence-case UI text, dated SPECS.md notes for any behavior change.

### UX-22: Step-back "Undo last move"

**The storage already does the hard part.** `writeAutosaveGeneration`
(`src/storage/autosaves.ts:13`) keeps the newest `KEEP_GENERATIONS = 3` autosave
generations per game, each stamped with the turn it was taken after — one new
generation is written after literally every player turn (`src/state/engineStore.ts`'s
`input_requested`/`'line'` branch, `if (event.turn > lastAutosaveTurn)`). `getLatestAutosave`
is the only reader anywhere in the app; the second-newest generation — i.e. exactly
"game state one move ago" — sits unused. This task wires a single-step Undo to it. No
`src/engine/` changes are needed at all: undoing reuses the exact boot/resume path
`openGame` already has, just pointed at an older snapshot.

**Scope decision (do not expand without a separate owner call): single-step undo only,
map graph NOT rolled back.** `KEEP_GENERATIONS = 3` only reliably supports stepping back
one move before the pruning window and normal post-undo play both erode further
history — this task does not change that constant or attempt a multi-level undo
stack/browser. The automapper graph is also left exactly as it was: per `SPECS.md` §3,
the map only ever grows and "the automapper never undoes a manual change" — a
stray room/edge recorded from the undone move staying in the graph is harmless
clutter, consistent with how the automapper already behaves when it mis-infers
something a player has to fix by hand. Building a "roll the map back to turn N" primitive
is a materially bigger, separate project; do not attempt it here.

**1. Storage** (`src/storage/autosaves.ts`): add, after `getLatestAutosave`:

```ts
/** UX-22: deletes the single newest autosave generation and returns the generation that
 *  is now newest — i.e. the game state one move earlier — or null if there weren't at
 *  least two generations to step back through (nothing to undo yet). */
export async function stepBackAutosaveGeneration(gameId: string): Promise<LatestAutosave | null> {
  const db = await getDb();
  const existing = await generationsForGame(gameId);
  if (existing.length < 2) return null;
  const sorted = [...existing].sort((a, b) => b.generation - a.generation);
  const newest = sorted[0];
  const previous = sorted[1];
  await db.delete('autosaves', [gameId, newest.generation]);
  return {
    snapshot: new Uint8Array(previous.snapshot),
    turn: previous.turn,
    generation: previous.generation,
    savedAt: previous.savedAt,
  };
}
```

**2. Storage** (`src/storage/transcripts.ts`): add, after `getTranscript` — the undone
move's transcript entry (and any later ones, though there shouldn't be any) must not
linger in the rebuilt scrollback:

```ts
/** UX-22: drops every transcript entry for a turn after `turn` (kept: turn <= keepTurn).
 *  Used when Undo rewinds the engine to an earlier autosave generation, so the
 *  rebuilt-on-resume scrollback (engineStore.openGame) matches the rewound state instead
 *  of still showing the undone move's response. */
export async function trimTranscriptAfterTurn(gameId: string, keepTurn: number): Promise<void> {
  const db = await getDb();
  const existing = await db.get('transcripts', gameId);
  if (!existing) return;
  const trimmed = existing.entries.filter((e) => e.turn <= keepTurn);
  if (trimmed.length === existing.entries.length) return;
  await db.put('transcripts', { gameId, entries: trimmed });
}
```

**3. Store** (`src/state/engineStore.ts`): import `stepBackAutosaveGeneration` and
`trimTranscriptAfterTurn` alongside the existing `autosaves.js`/`transcripts.js`
imports. Add to `EngineState` (interface, directly under `restartPlaythrough`, and
implementation, directly after it):

```ts
/** UX-22: rewinds to the autosave generation one move before the current one (see
 *  storage/autosaves.ts's stepBackAutosaveGeneration) and reboots the engine against
 *  it — the same teardown-and-reopen path restartPlaythrough uses, just without
 *  wiping the playthrough. No-ops with an alert if there's nothing to step back to. */
undoLastMove: () => Promise<void>;
```

```ts
async undoLastMove() {
  const { gameId } = get();
  if (!gameId) return;
  const previous = await stepBackAutosaveGeneration(gameId);
  if (!previous) {
    await useDialogStore.getState().ask({ kind: 'alert', title: 'Nothing to undo yet.' });
    return;
  }
  await trimTranscriptAfterTurn(gameId, previous.turn);
  await get().openGame(gameId);
},
```

(`openGame` already tears down the active session, calls `getLatestAutosave` — which
now returns what Undo just made newest — preloads it, boots with `autorestore: true`,
and rebuilds scrollback from the just-trimmed transcript. Nothing else about `openGame`
changes.)

**4. UI** (`src/story/StoryScreen.tsx`, `src/App.css`) **[visual check]**: the existing
`.status-line` CSS keys its two spans off `:first-child`/`:last-child`
(`src/App.css:130,134`) — adding a third element breaks that. Convert to explicit
classes first, then add the button as the third flex child:

- `StoryScreen.tsx`'s status-line block:
  ```tsx
  {status && (
    <div className="status-line">
      <span className="status-line-room">{status.left}</span>
      <span className="status-line-score">{status.right}</span>
      <button
        type="button"
        className="status-line-undo tap-target"
        aria-label="Undo last move"
        onClick={() => {
          haptic();
          void undoLastMove();
        }}
      >
        ↶
      </button>
    </div>
  )}
  ```
  (`const undoLastMove = useEngineStore((s) => s.undoLastMove);` alongside the block's
  other store selectors.) Always rendered when `status` is present — do not add extra
  reactive "can I undo" state; the store action's own "Nothing to undo yet" alert is the
  existing app-wide pattern for this (mirrors `restoreNamed`'s "No saved games yet."
  alert in `engineStore.ts`).
- `App.css`: rename the two selectors
  ```css
  .status-line-room { font-weight: 600; }
  .status-line-score { color: var(--text-dim); }
  ```
  replacing the old `.status-line span:first-child`/`span:last-child` rules verbatim
  (same declarations, just keyed off the new classes), and add:
  ```css
  .status-line-undo {
    margin-left: auto;
    font-size: 1.1em;
    line-height: 1;
  }
  ```
  (`.status-line` is already `display:flex; justify-content: space-between` —
  `margin-left: auto` on the button keeps the existing room/score spacing intact and
  docks the button to the right edge without touching the flex container's own rules.)

**5. Docs**: dated `SPECS.md` note near §4 (autosave generations) describing
`stepBackAutosaveGeneration`/`trimTranscriptAfterTurn` and the single-step,
map-not-rolled-back scope decision above.

**6. Tests**:
- `tests/storage.test.ts`: new cases for `stepBackAutosaveGeneration` (0 or 1
  generation → null, no delete; 2+ generations → deletes the newest, returns what was
  second-newest, and a follow-up `getLatestAutosave` reflects the deletion) and for
  `trimTranscriptAfterTurn` (entries beyond `keepTurn` are dropped; entries at or before
  `keepTurn` survive untouched; a gameId with no transcript record is a no-op, not a
  throw).
- A new `engineStore` test (extend whichever existing file mocks `createEngine` the way
  `tests/autoResume.test.ts`/`tests/travelTo.test.ts` do — same `vi.hoisted` fake
  `EngineHandle` pattern): seed two autosave generations plus a transcript entry for
  each turn, call `undoLastMove()`, assert `getLatestAutosave` now returns the older
  generation's bytes/turn and `getTranscript` no longer includes the newer entry. A
  second case: only one (or zero) generations seeded — `undoLastMove()` triggers the
  dialog-store alert path (assert via the existing `useDialogStore` test pattern) and
  does not call `openGame` again / does not touch storage.
- `tests/story-ui.test.tsx`: the status-line block renders a button labeled "Undo last
  move" whenever `status` is set; clicking it calls the mocked `undoLastMove`.

**Acceptance:** lint/tests/build pass. Live at 390×844 with the bundled Zork I: play a
few turns, tap Undo — the transcript and status line roll back to the prior room/turn,
and a subsequent `look` behaves as if the undone move never happened (Bocfel's own state
is genuinely rewound, not just the display). Reload the page after an undo — the resumed
scrollback matches the rewound state, not the pre-undo one. Tap Undo twice in a row from
a fresh game boot (only one generation exists) — the "Nothing to undo yet." alert
appears and nothing else changes. Check the ↶ button's legibility/tap-target size in
light, dark, and retro themes.

**Outcome (2026-07-16): done, implemented exactly as specced.** `stepBackAutosaveGeneration`
added to `src/storage/autosaves.ts` and `trimTranscriptAfterTurn` to
`src/storage/transcripts.ts`, both verbatim. `engineStore.undoLastMove` calls them, then
reboots through the existing `openGame` resume path — no `src/engine/` changes needed.
`StoryScreen.tsx`'s status line converted from positional `:first-child`/`:last-child` CSS
selectors to explicit `.status-line-room`/`.status-line-score` classes (verbatim rename,
same declarations) so the new `.status-line-undo` button could be added as a third flex
child without breaking the existing two. `npm run lint`/`npm test` (152 tests, up from
145)/`npm run format`/`npm run build` all pass. New coverage: `tests/storage.test.ts`
gained cases for both new storage functions (0/1/2+ generations; trim drops/keeps by turn;
no-record no-op); a new `tests/undoLastMove.test.ts` (same `vi.hoisted` fake-`EngineHandle`
pattern as `tests/autoResume.test.ts`) covers the full `undoLastMove()` flow (storage
rewound, transcript trimmed, engine rebooted) and the "nothing to undo" alert path (via
`useDialogStore`, asserting `createEngine` is never called); `tests/story-ui.test.tsx`
gained a `StoryScreen` render case for the Undo button.

**Live-verified with real Playwright** (390×844, `npm run build && npm run preview`, real
Chromium, against the bundled `zork1.z3`): from West of House, sent `north` twice (→
Forest Path, Moves: 2), tapped ↶ — the status line and transcript rolled back in one step
to North of House, Moves: 1, with the Forest Path move's transcript entry gone entirely
(not just hidden). Reloaded the page: the resumed scrollback still showed North of
House/Moves 1 — confirming `trimTranscriptAfterTurn` genuinely persisted, not just an
in-memory rollback. Tapped ↶ twice more (down to a single remaining generation): the
"Nothing to undo yet." alert appeared via the shared `DialogHost` (not `window.alert`) and
nothing else changed. Screenshotted the ↶ button in light, dark, and retro themes — legible
in all three (retro's green-on-black in particular).

### UX-23: Text styling passthrough (reverse video + emphasized)

Z-machine games use `set_text_style` narratively, not just cosmetically (Trinity's
dream-countdown sequences, Bureaucracy's reverse-video forms, Sherlock's/Border Zone's
italicized remembered text). The wire protocol already carries this — `TextRun`
(asyncglk's `src/common/protocol.ts`) is `{ style: string; text: string; css_styles?:
Record<string, string | number>; hyperlink?: number }` per run — but
`protocol-tap.ts`'s `run_text()` (`src/engine/protocol-tap.ts:17`) discards `style`/
`css_styles` entirely and joins only `.text`, so every consumer downstream already sees
flattened plain text with zero style information. This task recovers two of the
narratively-meaningful categories: reverse video and emphasized/italic. Bold and
fixed-pitch/monospace are explicitly OUT of scope for this task (bold's visual weight is
already claimed by UX-19's vocabulary highlighting; fixed-pitch needs transcript
layout changes this task doesn't touch) — note both as future extensions, don't build
them here.

**Scope decision: session-only, not persisted.** Style data is attached to the live
`transcript` state only. `storage/transcripts.ts`'s `TranscriptEntry.response` stays a
plain `string` — do NOT change the IndexedDB schema. This means a reload's rebuilt
scrollback (`engineStore.openGame`'s resume path) reverts styled text to plain,
un-styled text. That's an accepted, documented limitation, not a bug to fix in this
task — persisting styled runs would mean redesigning `transcript`'s whole shape and the
resume path together, a materially bigger task than recovering the live-play case.

**0. Required first step — capture real style data before writing any decoder.** The
exact `style` names and `css_styles` keys Bocfel/remglk-rs actually emit for reverse
video vs. italic are NOT reliably known without a live sample (the two style-name
candidates worth checking first are the canonical Glk style hints — `Style_alert`,
`Style_emphasized`, `Style_note`, etc. — and, per `css_styles`, literal keys like
`"reverse"`/`"monospace"` that a backend can send as finer-grained CSS-ish overrides;
neither is confirmed against Bocfel's actual output). Use the app's own already-shipped
DebugConsole "record fixture" toggle (Task 1.4, `SPECS.md` §6) against a game known to
use styled text — Trinity, Bureaucracy, or Wishbringer's bell — idle-testing until a
styled passage prints, then inspect the downloaded `.jsonl` fixture's raw `content`
updates for the actual `style`/`css_styles` values on those runs. **Do not guess the
mapping and do not write the classifier in step 2 until this capture is done.** If no
such game is reachable in the working environment (the known network-policy blockers
from UX-17/UX-19's outcome notes may recur), STOP this task and leave a
`TODO(owner):` note with exactly what was tried, same as those tasks did — do not ship
a classifier built on guessed style names.

**1. Protocol tap** (`src/engine/protocol-tap.ts`): add a run-preserving counterpart to
`run_text()` that returns `{ text: string; style: string; css_styles?: Record<string,
string | number> }[]` instead of a flattened string (`run_text()` itself stays, used
wherever only flattened text is needed). In `updateContent`'s buffer branch, build both
the existing flattened `text` (unchanged — every existing consumer: automapper
`mentions.ts`, `dictionary.ts`-driven highlighting, `pendingResponseChunks` joins — must
keep working off the same flattened string as today) and a new paragraph-and-run
structure, and pass the latter through as a new field on the emitted event (step 2).

**2. Types** (`src/engine/types.ts`): add a narrow, decoded (not raw-wire) shape — per
the file's own stated contract ("All features consume ONLY these"), do not leak Glk
style-hint strings or `css_styles` keys past this module. Add:

```ts
/** UX-23: one styled span of a buffer_text chunk. `emphasis` is a closed, decoded set —
 *  classification of the raw Glk style/css_styles data happens once, in protocol-tap.ts,
 *  against values confirmed by a live capture (see this task's step 0). null = no
 *  special styling (the common case). */
export interface StyledRun {
  text: string;
  emphasis: 'reverse' | 'emphasized' | null;
}
```

and extend `GameEvent`'s `buffer_text` variant with `runs?: StyledRun[]` (optional —
absent/empty means "nothing styled in this chunk," so existing tests/fixtures that don't
exercise styled text need no changes). The existing `text` field on `buffer_text` is
unchanged and remains authoritative for every non-styling consumer.

**3. Rendering** (`src/story/TapWords.tsx`): today `TapWords` tokenizes a flat string
into tap-target word spans. Extend it to accept the new `runs` (when present, alongside
the existing `text` prop — both describe the same chunk) and wrap each tap-word span in
an outer styled wrapper based on which run's character range it falls in: walk `runs` in
order, accumulating a running character offset per run (`runs.map(r => r.text).join('')
=== text`, so offsets line up exactly), and when tokenizing words from `text` as today,
look up which run each word's start offset belongs to. Apply `story-reverse` when that
run's `emphasis === 'reverse'`, `story-emphasized` when `'emphasized'`, neither when
`null` — as an additional wrapper class alongside (not replacing) the existing
`tap-word`/`tap-word-vocab` classes, so vocabulary bolding (UX-19) and word-tap targets
keep working unchanged inside a styled run. Command-echo lines (`.story-echo`) and any
`TapWords` call site that doesn't pass `runs` render exactly as today — this is a purely
additive prop.

**4. CSS** (`src/App.css`), token-only, reversible in all three themes:

```css
/* UX-23: reverse video — literal swap of the theme's own text/background tokens, so it
 * auto-adapts across light/dark/retro instead of hard-coding colors. */
.story-reverse {
  background: var(--text);
  color: var(--bg);
}
.story-emphasized {
  font-style: italic;
}
```

**5. Docs**: dated `SPECS.md` note under §1 (`GameEvent` shape) describing `StyledRun`/
`runs`, the reverse-video/emphasized-only scope, the session-only (not persisted)
decision, and a pointer to whatever `style`/`css_styles` values step 0's capture
actually found (record them verbatim — this is the reference future extensions, e.g.
fixed-pitch, will need).

**6. Tests**:
- `tests/protocol-tap.test.ts`: extend (or add) a fixture exercising a buffer-window
  content update with multiple runs of differing `style`/`css_styles` (built directly
  from step 0's captured values, not invented ones) — assert the emitted `buffer_text`
  event's `runs` array has the right text/emphasis split, and that a chunk with only
  plain runs has `runs` either absent or all-`null`-emphasis (implementer's choice,
  document whichever in `SPECS.md`).
- A new `TapWords` test in `tests/story-ui.test.tsx`: given `text="The room is dark."`
  and `runs` marking "dark." as `'reverse'`, the rendered spans covering "dark." carry
  `story-reverse` and the rest don't; tapping a word inside the reverse-video run still
  appends it to the draft (styling must never break tap targets). A second case combines
  a `runs`-marked emphasized word with `vocabulary` set so it's also vocab-bold —
  assert both classes land on the same span.

**Acceptance:** lint/tests/build pass. Live at 390×844 against whichever game step 0
used: a reverse-video or italicized passage actually renders visually distinct (screenshot
in all three themes — reverse video in particular must stay legible against retro's
CRT-green background, not just light/dark), tapping a word inside a styled run still
works exactly like an unstyled one, and reloading the page after such a passage has
scrolled by shows it reverted to plain text (documented limitation, not a bug — confirm
it doesn't crash or render mojibake, just plain text).

**Outcome (2026-07-16): step 0 partially done — STOPPED before step 1, per this task's
own rule not to ship a classifier built on guessed style names.** `ifarchive.org`/
`mirror.ifarchive.org` repeat the same network-policy 403 UX-17/19 hit, exactly as this
task's own notes anticipated — but unlike those tasks, a real, playable, reachable source
WAS found this round: `historicalsource`'s Microsoft 2025 releases include a `COMPILED/`
directory with a genuine Infocom-compiled story file per game (discovered via WebSearch,
fetched over `raw.githubusercontent.com`, which — like `github.com`/`api.github.com`
being blocked but the raw-content host working — matches UX-17's own precedent exactly).
Verified real, byte-confirmed builds: Trinity (`historicalsource/trinity`,
`COMPILED/tr.z4`, "Infocom (Z-machine 4, Release 15, Serial 870628)") and Bureaucracy
(`historicalsource/bureaucracy`, `COMPILED/b.z4`, "Release 160, Serial 880521"). **Note
for whoever picks this up: neither repo carries zork1's MIT `LICENSE` file — Trinity's own
README states "It is not considered to be under an open license" — so unlike
`public/advent.z5`/`public/zork1.z3`, these are NOT candidates for bundling/committing
into this repo; they're fine to use as a local, uncommitted testing fixture only (not even
as a `tests/fixtures/*.jsonl` capture that quotes long verbatim game text).**

Used the app's own DebugConsole fixture recorder (real Playwright, 390×844,
`npm run build && npm run preview`, uploaded via the ordinary Library file input) against
Trinity's opening (Kensington Gardens) across ~20 turns (`look`, `wait`, `inventory`, and
a spread of `examine`/`read` commands against the watch, umbrella, bench, gate, fence,
statue, guidebook). Confirmed real, non-guessed facts: `TextRun.style` values actually
emitted by this Bocfel/remglk-rs build are lowercase Glk style names — `'normal'`,
`'subheader'` (room names, e.g. `"Palace Gate"`), and `'input'` (echoed commands) — and
`css_styles` was an empty object on every single run captured, across both games. Did
**not** observe `'emphasized'` or any reverse-video signal (`css_styles.reverse` or
otherwise) — Trinity's dream-countdown sequences (the game's own flagship example of this
feature) are deep in the plot and not reachable via generic exploration without walkthrough
knowledge, and Bureaucracy's opening questionnaire didn't respond usefully to ordinary
parser commands in the two-attempt budget spent here (its custom name/address entry flow
needs its own investigation, not just `look`/`wait`).

This is a materially stronger starting point than a blocked-network stop (two confirmed
real style values, `css_styles`'s wire shape confirmed empty rather than assumed, and the
naming convention — lowercase, `Style_` prefix stripped — solidly established from two
independent examples), but it is still short of the two specific categories this task
needs. Per the task's own instruction, the classifier in step 2 is **not written** —
`'emphasized'` and reverse video's exact signal remain unconfirmed, and guessing them
(even a well-motivated guess, like assuming `Style_Emphasized` → `'emphasized'` by pattern,
or that `css_styles: {reverse: 1}` per `protocol.ts`'s own `CSSProperties` doc comment is
how reverse video actually surfaces) is exactly what step 0 forbids. `TODO(owner):` next
session should either (a) fetch a walkthrough for Trinity's early countdown-dream trigger
or Bureaucracy's form-filling opening and drive the capture through it, or (b) source
Sherlock or another italic-using game the same way (search `historicalsource/<slug>/tree/
master/COMPILED` via WebFetch, then `raw.githubusercontent.com/<slug>/master/COMPILED/
<file>` — the pattern that worked twice this round) and capture from its very opening if
the italic text appears early there instead.

### UX-24: Timed input — surface interrupt/countdown text correctly

The Z-machine's `read`/`read_char` opcodes support an optional timeout + interrupt
routine (v4+): the game gets to run code — typically printing something — while still
waiting for input, then re-prompts. Infocom's Border Zone (1987, the first Z-machine
version 5 release) is the documented flagship case, built specifically around real-time
keyboard interaction; the reference ZIP interpreter needed dedicated timeout support for
it. This is a narrower, more concrete task than "add timer support" sounds like, because
**the low-level Glk timer mechanic is already fully implemented and running today, in
this app, with zero code from this repo involved:** `GlkOteBase` (asyncglk,
`src/glkote/common/glkote.ts` in the vendored submodule) already reads a `timer`
interval off every `StateUpdate` and manages it directly —

```ts
if (data.timer !== undefined) {
  if (this.timer) { clearInterval(this.timer); this.timer = null; }
  if (data.timer) { this.timer = setInterval(() => this.ontimer(), data.timer); }
}
// ...
protected ontimer() {
  if (!this.disabled && this.timer) this.send_event({type: 'timer'});
}
```

`BridgeGlkOte.update()` (`src/engine/glkote-bridge.ts:57`) calls `super.update(data)`,
so this runs unmodified today. **What this task actually needs to determine and fix (if
anything) is narrower: whether the text an interrupt routine prints while the original
input request is still outstanding reaches the player's transcript promptly, or gets
silently swallowed into `pendingResponseChunks` until the player's next real command
commits it** (`engineStore.ts`'s `input_requested` handler is the only place anything
gets pushed onto `transcript` today, per the code at `engineStore.ts:260-291`) — which,
if true, means a countdown or "the phone rings" message would appear late and
misattributed to the wrong turn, a real (if narrow) correctness bug, not a missing
feature.

**This cannot be resolved by reading code alone — it depends on whether RemGlk-rs/Bocfel
resends the `input` array on every update (in which case the existing
`input_requested`-triggered commit path may already handle it fine) or only when input
state actually changes (in which case interrupt text needs a new flush path). Do not
guess; investigate first.**

**Phase 1 — investigation (required before any code change):**
1. Source a real timed-input game. Border Zone is the known case; if it can't be sourced
   (the same `ifarchive.org`/network-policy blockers UX-17's outcome notes hit may
   recur — check `raw.githubusercontent.com`-reachable mirrors the way UX-17 eventually
   found `historicalsource/zork1` before giving up), any other v4+ game confirmed to use
   a `read`/`read_char` timeout works equally well for this investigation.
2. Use DebugConsole's fixture recording (same tool UX-23 step 0 needs) to capture a
   session that idles through at least one interrupt firing, without the player typing
   anything.
3. Inspect the captured `.jsonl`: does the interrupt-triggered content update arrive
   inside a `StateUpdate` that also re-sends `data.input` (a fresh `InputUpdate` for the
   same window/type), or does it arrive as a content-only update with no `input` field?
4. Cross-check against live behavior in the running app at the same moment: does the
   interrupt's text appear in the transcript immediately, appear only after the next
   real command, or not appear at all?

**Phase 2 — implementation, contingent on Phase 1's finding:**
- If step 3 shows `input` IS resent on the interrupt-triggered update: `ProtocolTap`'s
  existing `updateInputs`/`flushStatusLines` path already fires a fresh
  `input_requested`, which already drives `engineStore`'s existing commit logic — in
  which case this task is mostly about confirming that's really what step 4 showed, and
  about polish: e.g. deciding whether `pinRequestId`/auto-scroll should re-pin for an
  interrupt-originated commit the same way a player command does (probably yes — the
  player didn't ask for it, but they should still see it), and making sure `engine.ts`'s
  `busy`/`queuedCommands` gate doesn't misfire if a queued player command was in flight
  when the interrupt landed.
- If step 3 shows `input` is NOT resent (content-only update, no accompanying
  `input_requested`): `engineStore.ts` needs a new idle-flush path — after a
  `buffer_text` event, if no further event (especially no `input_requested`) arrives
  within a short window (~150–250ms; tune against the real capture, not a guess), commit
  `pendingResponseChunks` to `transcript` as an interim update (mirroring UX-14's
  char-prompt precedent: commit text without treating it as a full turn boundary — no
  turn-counter bump, no autosave). The pending command/turn bookkeeping must stay intact
  for whatever real `input_requested` eventually does arrive.
- Either way: the countdown-y or "something is happening" text must end up
  distinguishable from an ordinary turn's response in the transcript at least by not
  being silently merged into unrelated later text — exact visual treatment (a subtle
  marker, or none beyond correct ordering) is an implementation call, not pinned down
  here.
- If Phase 1 can't source a test game at all: STOP, same as UX-17/UX-23 step 0 — leave a
  dated `TODO(owner):` note in this task's entry recording exactly what was tried, and do
  not ship speculative Phase 2 code against an untested assumption.

**Tests:** depend entirely on Phase 1's finding — write them once the real behavior is
known, using a `protocol-tap.test.ts` fixture built from the real capture (same
discipline as UX-23). Do not write tests against a hypothetical/guessed event sequence.

**Acceptance:** lint/tests/build pass. Live at 390×844 against the sourced game: idle
through a real timed interrupt without typing anything — its text appears in the
transcript at the correct point (not merged into a later unrelated turn, not missing),
and ordinary (non-timed) play in the same session is unaffected. If Phase 1 concluded
the existing path already handles this correctly, the acceptance check is a live
confirmation of that plus the fixture test, with no other code change needed.

**Outcome (2026-07-16): done — Phase 1 found a real bug, not anticipated by either of
this task's two sketched branches, and Phase 2 fixed it.** Sourced Border Zone the same
way UX-23 sourced Trinity/Bureaucracy this round: `historicalsource/borderzone`'s
`COMPILED/spy.z5` (its working title) over `raw.githubusercontent.com`, byte-confirmed
"Infocom (Z-machine 5, Release 9, Serial 871008)" — the genuine commercial release
(same not-under-an-open-license caveat as UX-23's finds: used locally for investigation
only, never committed).

Phase 1 (real Playwright, DebugConsole fixture recorder, chose Chapter 1 "The Train"):
confirmed the low-level Glk timer mechanic genuinely fires end-to-end exactly as this
task's own text predicted — `data.timer: 3000` arrives on the update following the
scene's first `input_requested`, and once armed, the interpreter spontaneously pushes a
fresh `input`-bearing update roughly every 3 seconds with zero player input, for as long
as idled (5 consecutive ticks over 15s observed). This confirms the task's premise that
"the low-level Glk timer mechanic is already fully implemented and running today... with
zero code from this repo involved."

But Phase 1 also found the actual bug, via the raw fixture, not a guess: `ProtocolTap`'s
`silent` flag is set `true` by this app's own per-turn background autosave (dispatched
right after every real turn) and is only ever cleared by the player's *next real* command
— so every one of those spontaneously-arriving timer-tick updates inherited `silent: true`
the entire time the player was idling (i.e. always, since the autosave fires every turn).
Chapter 1's compartment scene didn't happen to print anything on those particular ticks
(no `content` field on any of them in this capture), so nothing was visibly lost in this
exact scene — but had it printed something (a countdown, "the phone rings", per this
task's own examples), `engineStore`'s `isSilent` early-return would have dropped it
**before it even reached `pendingResponseChunks`** — not delayed until the next turn as
this task's Phase 2 sketch anticipated, genuinely and permanently lost.

Phase 2 fix: `src/engine/protocol-tap.ts` gained `ProtocolTap.handleTimerTick()`, which
resets `silent` to `false`; `src/engine/glkote-bridge.ts`'s `BridgeGlkOte` overrides
asyncglk's `protected ontimer()` to call it — but only when `!this.waiting_for_update`
(inherited `protected` from `GlkOteBase`), i.e. only when genuinely idle. That guard is
the one subtlety: without it, a timer tick landing while a real request is still in
flight (e.g. that same silent autosave's own SAVE round-trip, mid-transit) would
incorrectly unmask its response as if it were visible content — traced through
`GlkOteBase.send_event`'s own `waiting_for_update` no-op guard to confirm this is safe
(a timer tick during an in-flight request just logs and no-ops on the base class's side,
so skipping our reset in that case costs nothing). No `engineStore.ts` change was needed
at all: a genuinely un-silenced timer-triggered `input_requested`/`buffer_text` now flows
through the exact same commit path as any ordinary turn (mirroring UX-14's own char-input
precedent for a non-`command`-triggered commit). `pinRequestId` re-pinning for an
interrupt-originated commit and the `engine.ts` busy/queue interaction were both
considered per this task's Phase 2 notes and found to need no change: `busy` is already
false while genuinely idle, and the interpreter (synchronous WASM execution) can't
process a real dispatched line and a timer tick concurrently, so no real queuing race is
possible — left as an accepted, low-risk simplification rather than added complexity.

`npm run lint`/`npm test` (155 tests, up from 152)/`npm run format`/`npm run build` all
pass. New coverage: `tests/protocol-tap.test.ts` gained a `ProtocolTap.handleTimerTick`
describe block (un-silences the next update; regression guard showing the same update
stays silent without the tick) with a comment recording the live-capture finding above;
new `tests/glkote-bridge.test.ts` covers the `!waiting_for_update` guard specifically
(skips the reset with a request in flight, applies it once idle) since that's the one
property that isn't visible at the `ProtocolTap` level alone.

**Live-verified with real Playwright** (390×844, `npm run build && npm run preview`,
real Chromium, against the real Border Zone build): entered Chapter 1, sent `wait` once
to arm the timer, then idled 15s and read DebugConsole's own `[silent]` tags directly.
Before the fix (an earlier capture during Phase 1's investigation, same scene): every
timer-triggered `input_requested (line)` in the idle window showed the `[silent]` suffix.
After the fix, the identical scenario shows six consecutive timer-triggered
`input_requested (line)` lines with **no** `[silent]` tag, immediately following the one
legitimately-silent autosave entry that still correctly shows `[silent]` — confirming the
fix un-silences exactly the intended events and nothing else.

---

## Appendix — candidates reviewed but NOT approved for implementation

Sketches for the owner's next review. **Do NOT implement anything below** — listed so
the ideas aren't lost, with their open questions.

Story-file elements evaluated 2026-07-14 (alongside promoting the dictionary parser to
UX-19). Ranked by value; the first two are recommended for the next review round:

- **Object-table short names.** The Z-machine object table (header word `0x0A`) holds
  every in-game object's display name ("brass lantern", "small mailbox") — un-truncated
  and multi-word. **Evaluated against UX-19 (2026-07-14) and kept OUT of it:** object
  names are what the game prints, not what the parser accepts, so they are the wrong
  source for the "you can type this" highlight — they'd add printed-only words the
  parser rejects and miss typable synonyms, while contributing no highlightable word
  the dictionary doesn't already have (see the scope decision in UX-19). Their real
  uses are different features: tapping "brass" or "lantern" in prose could compose the
  full noun phrase into the draft (safety rule if built: only compose phrases whose
  every word is dictionary-valid, so a tap never produces a rejected command); object
  chips with real names; later, LLM grounding ("things that exist in this game").
  Cost is nontrivial: the object count isn't stored (the table ends by convention at
  the lowest property-table address), short names need abbreviation-table decoding
  (header word `0x18`), and v3/v4+ entry layouts differ — a natural *extension* of
  UX-19's `dictionary.ts` decoder, roughly doubling it. **Spoiler constraint (the
  reason this needs an owner decision):** static extraction sees every object in the
  game, including late-game ones, so names may only ever be used to *match against text
  already displayed*, never listed or suggested proactively. Runtime "which objects are
  here" would need interpreter memory peeking — already rejected by SPECS.md §9's
  status-line-over-memory-peeking decision; static matching does not violate that.
- **Blorb metadata: cover art + bibliographic data.** `.zblorb`/`.gblorb` uploads carry
  an `IFmd` chunk (iFiction XML: real title, author, description, IFID) and often cover
  art (`Fspc` pointing at a `PNG `/`JPEG` resource chunk). The Library currently titles
  games by filename; this would give real titles, author bylines, and cover thumbnails
  for blorb uploads, fully offline. UX-19's IFF chunk walker is the needed
  substrate. Open questions: none technical — just whether Library cards should grow
  imagery.
- **Header identity fields.** Release number (word at `0x02`) and serial (6 ASCII bytes
  at `0x12`) — the classic "Release 88 / Serial 840726" line. Trivial to read alongside
  UX-19's parsing; worth showing in the Library meta line and, combined with the
  checksum (word at `0x1C`), forms the Treaty-of-Babel-style ID that would key IFDB
  metadata lookups if a network feature is ever wanted. Could also verify the checksum
  on upload to catch corrupt/truncated files.
- **Rejected — do not revisit without new information:** runtime memory peeking (room
  contents, score internals — conflicts with SPECS.md §9's interpreter-agnostic
  decision, and the status line already provides score); Inform grammar tables
  (compiler-specific, undocumented, break across the very games this app targets);
  dictionary data-byte part-of-speech flags (same reason — not standardized).
- **Recent-objects chips.** Track nouns from the player's own successful commands
  ("take lamp" → "lamp" becomes a chip pairing with Take/Drop/Examine/Open). Zero
  false positives by construction; open question is eviction (per-room? last N?).
- **"Where haven't I been?" native nudge.** Pure map-graph query: rooms with
  mentioned-but-untried directions (UX-18's data) or inferred-only edges, surfaced as a
  list ("Kitchen — west untried") with tap-to-travel. A genuinely spoiler-free hint
  engine: it only ever reveals the player's own observations. Natural home: a button on
  the Map screen. Blocked on: UX-18 shipping first, and a decision about surfacing
  travelTo from a list UI.
- **Walkthrough/hint-sheet reader.** Per-game pasted text (walkthrough, InvisiClues
  dump) stored in IndexedDB, shown in a sheet with progressive line-by-line reveal
  (tap to unblur the next line). This is IMPLEMENTATION_PLAN Phase 2.2's "hint source"
  minus the LLM — and becomes the LLM's grounding context later for free. Open
  questions: reveal granularity (line vs section), and whether to fuzzy-match sections
  against the current room name.
- **Stuck detection.** No new rooms/score in N turns → an unobtrusive chip offering the
  two hint surfaces above (not an LLM call). Cheap once either exists; pointless before.
