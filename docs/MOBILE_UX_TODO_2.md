# Mobile UX TODO, round 2 — implementation handoff

Source: owner-reviewed follow-up to `ANDROID_UX_TODO.md` (2026-07-14). All 13 tasks in
that document are done and merged. This document specs the next two batches. It is
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

If that URL 404s, try `Advent.z5` (capital A). Sanity-check the download: the first byte
must be `0x05` (Z-machine version 5 — check with `od -An -tu1 -N1 public/advent.z5`)
and the size should be roughly 100–260 KB. If you cannot obtain the file (no network),
STOP this task per the global rules — do not substitute a different game or fabricate
bytes.

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

---

## Appendix — candidates reviewed but NOT approved for implementation

Sketches for the owner's next review. **Do NOT implement anything below** — listed so
the ideas aren't lost, with their open questions.

- **Z-machine dictionary noun-awareness.** The story file header (bytes 0x08–0x09)
  points to the game's parser dictionary; parsing it (ZSCII, words truncated to 6 chars
  in v1–3 / 9 in v4+) yields the complete set of words the game understands, fully
  offline, pure-bytes, vitest-able. Uses: style tap-words that are in the dictionary as
  visibly interactive (and mute filler prose), gate long-press-examine to dictionary
  words, and build object chips from recent prose ∩ dictionary. Open questions:
  truncation forces prefix-matching ("lantern" → "lanter"); the dictionary mixes
  verbs/adjectives/nouns with no part-of-speech flags usable across all games; needs a
  spike against 2–3 real story files before speccing.
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
