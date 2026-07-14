# Android UX TODO — implementation handoff

Source: hard UX assessment of the app on Android phones (2026-07-14). This document is
written for a smaller implementing model: every task pins down the exact files, the
exact behavior, and an acceptance check. **Do not improvise beyond what a task says.**
If something is ambiguous or a task's instructions conflict with what you find in the
code, STOP that task, leave a `TODO(owner):` comment describing the conflict, and move
to the next task — do not guess.

## Global working agreements (read first, apply to every task)

1. **Work task-by-task, one commit per task**, in the order listed. Each task must leave
   the app fully working. Commit message format: `UX-<n>: <task title>`.
2. After each task run all four: `npm run lint`, `npm test`, `npm run format`,
   `npm run build`. All must pass before committing. If a task breaks an existing test,
   update the test to match the new specified behavior — the specs below say which
   tests are expected to change; do not delete tests.
3. Verify visually at a 390×844 viewport (Playwright or browser devtools mobile
   emulation) for any task marked **[visual check]**.
4. **Do not touch** anything under `src/engine/` or `src/map/` (except where a task
   explicitly names a file there), and never modify the protocol tap, autosave, or
   automapper logic. These are verified subsystems.
5. All colors/spacing must use the existing CSS custom properties in `src/index.css`
   (`--bg`, `--text`, `--accent`, `--space-*`, `--radius-*`, etc.). Never hard-code a
   hex color in component CSS; if a new token is needed, the task says so.
6. Both themes must work: check light and dark (`data-theme` attribute on `<html>`)
   for every visual change.
7. New UI text is sentence case ("Clear draft", not "Clear Draft").
8. When a task changes behavior described in `docs/SPECS.md`, add a short dated note to
   the relevant SPECS.md section in the same commit (follow the existing note style).

---

## Tier 1 — highest impact

### UX-1: Quick wins bundle [visual check]

Four tiny independent fixes, one commit.

**(a) Theme-color follows the theme.** `index.html` hard-codes
`<meta name="theme-color" content="#14161a">`, so the Android status bar stays dark in
light theme. In `src/App.tsx`, inside the existing `useEffect` that applies `theme`
(the one that sets/removes `data-theme`), also update the meta tag:

```ts
const isDark =
  theme === 'dark' ||
  (theme === 'system' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-color-scheme: dark)').matches);
document
  .querySelector('meta[name="theme-color"]')
  ?.setAttribute('content', isDark ? '#14161a' : '#f5f5f7');
```

Guard `matchMedia` exactly as shown — `App.test.tsx` runs under jsdom where it may be
absent (this exact crash happened before; see SPECS.md §8 Task 1.9 notes).

**(b) Allow pinch zoom.** In `index.html`, change the viewport meta to
`width=device-width, initial-scale=1.0, viewport-fit=cover` (remove `maximum-scale=1.0`
and `user-scalable=no`). This is an accessibility fix.

**(c) Drop the `<h1>` on the story screen during play.** In
`src/story/StoryScreen.tsx`, the loaded-game branch renders `<h1>{gameTitle}</h1>` —
remove it (the room name is already in the status line, the title is in the Library).
Keep the `<h1>Story</h1>` in the no-game empty-state branch. Reclaims a text line on
small phones.

**(d) Transcript readability.** In `src/App.css` on `.story-transcript`: add
`line-height: 1.7;` (words are tap targets; taller lines = bigger targets and easier
reading). Also add `padding: 1px 2px;` to `.tap-word`.

Acceptance: build passes; at 390×844 the story screen shows no game-title heading and
the transcript line spacing is visibly looser; toggling theme in More updates the
`theme-color` meta content (assert via devtools).

### UX-2: Tapping words/chips must NOT open the keyboard

The flagship no-typing flow currently pops the soft keyboard on every word/chip tap,
covering the text being tapped. Fix: composition happens silently in the draft; the
keyboard opens only when the player taps the input field themselves.

Changes:

1. `src/story/TapWords.tsx`: in the word `onClick`, delete the `requestInputFocus()`
   call. Keep `appendToDraft(...)`.
2. `src/story/VerbChips.tsx`: in the `needsObject` branch, delete the
   `requestInputFocus()` call. Keep `appendToDraft(...)`.
3. `src/state/uiStore.ts`: `focusRequestId` / `requestInputFocus` now have no callers
   outside `CommandBar`'s consuming effect. Remove the field, the action, and the
   effect in `src/story/CommandBar.tsx` that watches it. (Search the whole `src/` tree
   for `requestInputFocus` and `focusRequestId` first; if you find another caller,
   STOP per the global rules.)
4. Update `tests/story-ui.test.tsx`: the two assertions
   `expect(useUiStore.getState().focusRequestId).toBe(1)` must be removed (test names
   should also drop "and requests focus"). Everything else in those tests stays.
5. Update the JSDoc comment on `TapWords` and on `verbs.ts` (they currently describe
   the focus behavior).

Acceptance: `npm test` passes; in mobile emulation, tapping "Take" then a word fills
the input with `take <word>` and the input never receives focus (assert
`document.activeElement` is not the input).

### UX-3: Draft editing buttons on the command bar [visual check]

With UX-2 the keyboard stays closed, so the player needs a way to fix a mis-tap
without opening it.

In `src/story/CommandBar.tsx`, between the input and the Send button, render one
button, visible only when `draft.trim() !== ''`:

- `⌫` with `aria-label="Delete last word"`: removes the last whitespace-separated
  word from the draft — `setDraft(draft.trimEnd().replace(/\S+$/, '').trimEnd())`.
  When the draft is a single word this yields `''` and the button disappears (that IS
  the clear behavior; no separate clear button).

Give it `className="tap-target"` and style consistently with the existing history `▲`
button (no new CSS should be needed beyond what `button` + `.tap-target` provide).

Add a test in `tests/story-ui.test.tsx` (CommandBar describe block): set draft to
`take brass lamp`, click "Delete last word", expect draft `take brass`; click twice
more, expect `''`, and the button is no longer in the document.

Acceptance: tests pass; visually the button appears/disappears with the draft.

### UX-4: Turn-structured transcript

The transcript is one growing string rendered as a single `<pre>`; player commands are
visually indistinguishable from game prose, and every turn re-renders the whole
session. Restructure to per-turn blocks. **This is the largest task — read all of it
before starting.**

**Store change** (`src/state/engineStore.ts`):

- Replace `transcript: string` with `transcript: string[]` (one entry per turn's
  response chunk, in order). All places that build or reset it:
  - `openGame`'s initial `set(...)`: `transcript: []`.
  - The turn-commit branch (`input_requested && type === 'line'`, non-resuming):
    `set((s) => ({ transcript: [...s.transcript, response] }))`. The `isFirstChunk`
    argument to `normalizeResponse` becomes `get().transcript.length === 0` (unchanged
    logic, now array length).
  - The resume-rebuild block: instead of joining prior entries into one string, map
    them: `set({ transcript: priorEntries.map((e) => e.response) })` (drop empty
    strings with a `.filter(Boolean)`).
  - `closeGame`: `transcript: []`.
- Do NOT change what gets written to IndexedDB (`appendTranscriptEntry` payload is
  untouched).

**Rendering** (`src/story/TapWords.tsx`, `src/story/StoryScreen.tsx`):

- `TapWords` becomes a memoized single-block renderer:
  `export const TapWords = memo(function TapWords({ text }: { text: string }) { ... })`
  rendering a `<div className="story-block">` (not `<pre>`) containing the existing
  token-span logic. Remove the scroll effect from it entirely (moves to the parent).
  Preserve whitespace via CSS (`white-space: pre-wrap` on `.story-block`).
- Inside a block, a line whose trimmed form starts with `>` is a command echo. Split
  `text` on `\n` first; render echo lines wrapped in
  `<span className="story-echo">` (their words still go through the tap-word logic);
  join lines back with `'\n'` text nodes so whitespace is preserved.
- `StoryScreen` renders the scroll container itself:

  ```tsx
  <div className="story-transcript" ref={scrollRef}>
    {transcript.map((chunk, i) => (
      <TapWords key={i} text={chunk} />
    ))}
  </div>
  ```

  (`key={i}` is correct here: entries are append-only and never reorder.)

**Smart scroll pinning** (in `StoryScreen`): replace the old always-pin effect with:

- Track `pinnedRef = useRef(true)`. On the container's `onScroll`, set
  `pinnedRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 100`.
- An effect on `[transcript]`: if `pinnedRef.current`, `el.scrollTop = el.scrollHeight`;
  otherwise set state `newBelow = true`.
- When `newBelow` is true render a floating pill button over the transcript's bottom
  edge: label `↓ New text`, `className="new-text-pill tap-target"`; clicking scrolls to
  bottom and clears `newBelow`. Also clear `newBelow` whenever the user scrolls back to
  within 100px of the bottom.

**CSS** (`src/App.css`):

- `.story-transcript` keeps its current flex/overflow rules but is now a `div`; remove
  the `<pre>`-specific `font-family: inherit` (no longer needed) and add
  `position: relative;` is NOT needed — instead put the pill inside `.story-body` with
  `position: absolute; bottom: var(--space-2); left: 50%; transform: translateX(-50%);`
  and give `.story-body` `position: relative;`. Pill styling: reuse the look of
  `.map-toast` (elevated bg, border, radius 999px, `box-shadow: var(--shadow-md)`).
- `.story-echo { color: var(--text-dim); font-weight: 600; }`
- `.story-block { white-space: pre-wrap; word-wrap: break-word; }`

**Tests**: `tests/story-ui.test.tsx` TapWords tests pass unchanged (they render
`<TapWords text=...>` directly and tap words). Add one test: render
`<TapWords text={'> take lamp\nTaken.'} />` and assert the element containing
`> take lamp` has class `story-echo` and that `Taken.` does not.
`engineStore` is exercised via `tests/travelTo.test.ts` — run it; it does not touch
`transcript`, so it should pass unchanged. If anything else references
`state.transcript` (search `src/` and `tests/` for `transcript`), update it for the
array type — `MoreScreen`/`DebugConsole` are the likely candidates; the storage layer
(`src/storage/transcripts.ts`) must NOT change.

Acceptance: tests pass; in emulation, command echoes render dimmed/bold; scrolling up
mid-session and sending a command shows the "↓ New text" pill instead of yanking the
view down; tapping the pill jumps to the newest text.

### UX-5: Replace window.prompt/confirm/alert with in-app sheets [visual check]

System dialogs look broken inside an installed PWA and the restore flow ("type a save
name") is unusable on a phone. Replace all nine call sites with one shared mechanism.

**New store** `src/state/dialogStore.ts` (zustand, same style as uiStore):

```ts
export interface DialogRequest {
  kind: 'confirm' | 'prompt' | 'pick' | 'alert';
  title: string;
  body?: string;
  confirmLabel?: string; // default 'OK'; pass 'Delete' etc. for destructive actions
  danger?: boolean; // styles confirm button with .btn-danger
  placeholder?: string; // prompt only
  initialValue?: string; // prompt only
  options?: string[]; // pick only: tappable list
}
// state: { active: DialogRequest | null; resolve: ((v: string | boolean | null) => void) | null }
// action: ask(req: DialogRequest): Promise<string | boolean | null>
//   - stores req + its promise resolver; if a dialog is already active, immediately
//     resolve(null) the new request (do not queue).
// action: settle(value: string | boolean | null): resolves and clears.
```

Resolution semantics: `confirm` → `true`/`false` (backdrop tap = `false`); `prompt` →
entered string or `null` (cancel/backdrop); `pick` → chosen option string or `null`;
`alert` → `true` on dismiss.

**New component** `src/more/…` is the wrong home — put it at
`src/dialog/DialogHost.tsx`. Rendered once in `App.tsx` (after `</nav>`). When
`active` is set, render a bottom sheet reusing the existing pattern and classes from
`src/map/RoomEditSheet.tsx` (`.room-edit-backdrop` / `.room-edit-sheet` — rename
nothing; reuse the classes as-is). Contents: `<h2>{title}</h2>`, optional body `<p>`,
then per kind: a text input (prompt, `autoFocus`, submits on Enter), a column of
option buttons (pick), and a Cancel / confirm-label button row (confirm+prompt; alert
gets a single OK). Confirm button uses `.btn-primary`, or `.btn-danger` when
`danger: true`.

**Call-site conversions** (make every enclosing function `async` as needed):

| Site | Replace with |
| --- | --- |
| `src/library/LibraryScreen.tsx:71` delete game | `confirm`, danger, confirmLabel 'Delete' |
| `src/library/LibraryScreen.tsx:79` restart | `confirm`, danger, confirmLabel 'Restart' |
| `src/more/MoreScreen.tsx:158` delete save | `confirm`, danger, confirmLabel 'Delete' |
| `src/map/RoomEditSheet.tsx:90` delete room | `confirm`, danger, confirmLabel 'Delete' |
| `src/map/MapScreen.tsx:270` long-trip warning | `confirm`, confirmLabel 'Travel' |
| `src/state/engineStore.ts:252` save name | `prompt`, title 'Save game', placeholder 'Save name' |
| `src/state/engineStore.ts:262` no saves | `alert`, title 'No saved games yet' |
| `src/state/engineStore.ts:265` restore picker | `pick`, title 'Restore which save?', options = save names |
| `src/state/engineStore.ts:270` missing save | `alert` |

`engineStore` is not a React component — call
`useDialogStore.getState().ask({...})` directly (zustand allows this; same pattern the
store already uses for `useMapStore.getState()`).

**Tests**: existing tests don't exercise these dialogs. Add
`tests/dialog.test.tsx`: render `DialogHost`, call `ask({kind:'confirm',...})`, click
the confirm button, await the promise, expect `true`; and a second case where backdrop
click resolves `false`.

Acceptance: `grep -rn "window.confirm\|window.prompt\|window.alert" src/` returns
nothing; all flows above work in emulation (delete a game, save, restore from two
saves, delete a save).

---

## Tier 2 — polish that makes it fun

### UX-6: Exits row under the status line [visual check]

The compass already computes confirmed exits but hides them behind a FAB. Surface
them.

- Extract the `knownExits` computation from `src/story/CompassRose.tsx` into a shared
  hook `useKnownExits()` in a new file `src/story/useKnownExits.ts` (same logic,
  returns the `Set<Direction>`); CompassRose imports it.
- New component `src/story/ExitsRow.tsx`: renders nothing when the set is empty;
  otherwise a row `Exits:` followed by one chip per direction in fixed order
  n, s, e, w, ne, nw, se, sw, up, down, in, out — label is the direction uppercased
  (`N`, `NE`, `UP`…), `aria-label="Go <dir>"`, `className="chip tap-target"`, disabled
  unless `inputType === 'line'`, tap calls `sendCommand(dir)`.
- Mount it in `StoryScreen` directly below the status line. CSS: reuse `.verb-chips`
  row styling via a shared class or duplicate the 3-line rule as `.exits-row`; the
  `Exits:` label is `font-size: 12px; color: var(--text-dim);` and vertically
  centered.
- Test (add to `tests/story-ui.test.tsx`, mirroring the CompassRose known-exits test
  setup): with a graph where `a --n--> b` confirmed and current room `a`, `ExitsRow`
  renders a button labeled `Go n` and clicking it calls `sendCommand('n')`; with an
  empty graph it renders nothing (`container.firstChild` is null).

### UX-7: Compass docks as a row, not a side column [visual check]

The expanded compass currently sits BESIDE the transcript (`.story-body` is a flex
row), stealing ~180px of a 390px-wide screen from the text. Keep it in normal flow
(the pointer-interception rationale in the `App.css` comment still applies — do NOT
make it `position: absolute`) but move it below the transcript:

- `src/story/StoryScreen.tsx`: move `<CompassRose />` out of `.story-body` to a
  sibling directly after it (before `<VerbChips />`).
- `src/App.css`: `.story-body` loses `display:flex/gap/align-items` (it's now just the
  scroll wrapper; keep `flex: 1; min-height: 0;` and the `position: relative` added in
  UX-4). Collapsed state: the FAB would now occupy a full-width row — instead style
  `.compass-fab` with `align-self: flex-end; margin: var(--space-1) 0;` inside the
  story screen's column flex. Expanded: `.compass-rose` gets
  `align-self: flex-end; margin: var(--space-1) 0;` and keeps its internal layout;
  update the `App.css` comment block to describe the new docking.
- The expanded compass now covers vertical space instead of horizontal — that is the
  intended trade (reading width wins).

Acceptance: at 390×844 with the compass expanded, the transcript still spans the full
width; compass buttons still send moves; no element overlaps the transcript text
(tap a word directly above the compass to verify).

### UX-8: Typography options — reading font + retro theme [visual check]

- `src/state/uiStore.ts`: add `storyFont: 'system' | 'serif' | 'mono'` (default
  `'system'`) with setter, and extend `theme` union with `'retro'`.
- `src/index.css`: add
  `:root[data-theme='retro'] { --bg:#0d0d0d; --bg-elevated:#161616; --text:#33ff66; --text-dim:#1d9944; --border:#1d9944; --accent:#ffbf00; --accent-contrast:#0d0d0d; }`
  (green-phosphor terminal with amber accent). Retro implies dark: in `App.tsx`'s
  theme-color effect (UX-1a), treat `retro` as dark and set the meta to `#0d0d0d`.
- Font application: in `App.tsx`, an effect sets
  `document.documentElement.style.setProperty('--story-font', value)` where value is
  `'inherit'` (system), `'Georgia, "Times New Roman", serif'` (serif — system fonts
  only, nothing bundled/fetched; the app must stay fully offline), or
  `'ui-monospace, Menlo, Consolas, monospace'` (mono). `.story-transcript` gets
  `font-family: var(--story-font, inherit);`.
- `src/more/MoreScreen.tsx`: extend the existing theme segmented control with a
  `Retro` option, and add a `Story font` settings row (segmented: System / Serif /
  Mono) following the exact pattern of the theme row.
- `App.tsx`'s theme effect currently only knows light/dark/system — `retro` must set
  `data-theme='retro'`. Verify the existing effect's logic handles the new value (it
  sets the attribute verbatim for non-system, so it should).

Acceptance: all four theme options render correctly (check every screen for unreadable
combinations — especially `.map-room-current`, `.btn-primary`, chips); story font
switches live; settings survive reload IF settings persistence exists — check how
`theme`/`fontScale` persist today and do exactly the same for the two new fields (if
they do not persist today, do not add persistence; match existing behavior).

### UX-9: Haptic feedback

New file `src/haptics.ts`:

```ts
/** Best-effort haptic tick; silently a no-op where unsupported (iOS Safari, desktop). */
export function haptic(pattern: number | number[] = 10) {
  try {
    navigator.vibrate?.(pattern);
  } catch {
    /* ignore */
  }
}
```

Call sites (exactly these, nothing else): tap-word tap (`TapWords`), verb chip tap
(`VerbChips`, both branches), compass direction tap (`CompassRose.go`), command submit
(`CommandBar.submit`, only when it actually sends), exits-row chip (UX-6), and in
`MapScreen` where `travelTo`'s result is handled — `haptic(30)` on `'completed'`,
`haptic([30, 60, 30])` on any abort result.

Acceptance: lint/tests/build pass (jsdom lacks `vibrate`; the optional-chain handles
it). No settings toggle — vibration only fires on explicit taps.

### UX-10: Android back button / history integration

In an installed PWA, system Back exits the app even when a sheet or non-story tab is
open. Implement a single-entry history trap:

- New file `src/state/backButton.ts` exporting `attachBackHandler()` called once from
  `App.tsx` (like `attachInstallListeners`). On attach:
  `history.pushState({ trap: true }, '')` once.
- On `popstate`: check closers in priority order — if the dialog sheet (UX-5) is open,
  settle it with null/false; else if `RoomEditSheet` is open (inspect how MapScreen
  tracks it and expose a `closeRoomEditSheet`-style check/action via the store that
  owns that state — if it's local component state, lift it to `uiStore` as
  `roomEditTarget: string | null`); else if current tab ≠ `'story'` and a game is
  loaded, `setTab('story')`; else if tab ≠ `'library'`, `setTab('library')`; else
  allow exit (do nothing). In every handled case immediately re-arm with
  `history.pushState({ trap: true }, '')`.
- Keep this file free of React — plain store access via `getState()`.

Acceptance: manual — in mobile emulation, browser Back from the Map tab returns to
Story, Back again to Library, Back again leaves the app; Back with the room-edit sheet
open closes only the sheet. Add no automated test (jsdom history semantics differ);
instead leave a short manual-verification note in this file's task entry when done.

---

## Tier 3 — delight (do these only after all of Tier 1–2 are merged)

### UX-11: Score change toast [visual check]

`engineStore` already sets `status: { left, right }` per status_line, where `right` is
usually `Score: X  Moves: Y` or similar. In `engineStore`'s status_line handling,
parse `right` with `/(-?\d+)/` (first integer); keep the previous value in a
module-level variable; when both old and new parse and new > old, set a new store
field `scoreDelta: { amount: number; id: number } | null` (id = incrementing counter
so equal deltas retrigger). `StoryScreen` renders a toast pill (reuse the UX-4 pill
styling, positioned top-center of `.story-body`) showing `+{amount}` with
`haptic([20, 40, 20])`, auto-dismissing after 2.5s via `setTimeout` keyed on `id`.
Only positive deltas toast (score can drop or the number can be a clock — false
positives on decrease are worse than missing them). Reset the module-level previous
value in `openGame`/`closeGame`.

### UX-12: Long-press a word to examine it

In `TapWords`, add pointer handlers per word span: on `pointerdown` start a 500ms
timer; on `pointerup`/`pointerleave`/`pointercancel` clear it; if it fires, set a
`longPressedRef` flag, `haptic(20)`, and `sendCommand('examine ' + word)` (via
`useEngineStore.getState().sendCommand`) — but only when
`useEngineStore.getState().inputType === 'line'`. The subsequent `click` must be
suppressed when the flag is set (check-and-clear in the existing onClick). Scrolling
must not trigger it: also clear the timer on `pointermove` beyond 10px from the start
point. Add a test simulating the click path still working (existing tests) — long-press
timing paths may be covered with `vi.useFakeTimers` if straightforward; otherwise note
manual verification.

### UX-13: Long-press Send repeats the last command

In `CommandBar`, when the draft is empty and `commandHistory[0]` exists, long-press
(same 500ms pointer pattern as UX-12) on the Send button sends `commandHistory[0]`
with `haptic(20)`. Short-press behavior unchanged (submit does nothing on empty
draft). Add `aria-label="Send. Long press to repeat last command"` to the button.

### Explicitly deferred — do NOT attempt

- Context-aware verb chips (noun extraction from prose) — needs owner design review.
- Mini-map peek on the story screen — needs owner design review.
- Typewriter text reveal animation — needs owner sign-off on motion.
- Any sound effects.
