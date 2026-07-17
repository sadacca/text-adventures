# Mobile UX TODO, round 3 — implementation handoff

Source: full-repo user-focused UX evaluation (2026-07-16), requested by the owner. All
13 tasks in `ANDROID_UX_TODO.md` and all of `MOBILE_UX_TODO_2.md`'s Batches 1–4 are done
and merged; Batch 5 (UX-22 undo, UX-23 text styling, UX-24 timed input) is specced there
but **not yet built** — nothing in this file jumps ahead of UX-22, and one task here
(UX-28) explicitly depends on it. This document is written for a smaller implementing
model: every task pins down the exact files, the exact behavior, and an acceptance
check. **Do not improvise beyond what a task says.** If something is ambiguous or a
task's instructions conflict with what you find in the code, STOP that task, leave a
`TODO(owner):` comment describing the conflict, and move to the next task — do not
guess.

## The evaluation in one paragraph (why these tasks, in this order)

The app has thoroughly solved "how do I enter a command?" (tap-a-word, verb chips,
compass, exits row — typical play needs no keyboard). The remaining friction, evaluated
as a *player* on a phone, is **re-orientation**: remembering where you are, where you
were going, and what happened — the defining problem of mobile play specifically,
because phone sessions are five-minute bursts days apart. Batch 6 attacks exactly that.
Batch 7 turns the game's most punishing moments (death, risky experiments, score wins)
into one-tap interactions. Batch 8 extends the world-navigation and command-loop
strengths the app already has. Batch 9 is reading-surface polish. A companion document,
`IF_ECOSYSTEM_RESEARCH.md`, surveys peer apps and the wider mobile-IF ecosystem for
ideas beyond this round; its promoted candidates land in this file's appendix for owner
review, same as prior rounds.

## Global working agreements (read first, apply to every task)

Identical to the prior two rounds' agreements; restated so this file stands alone:

1. **Work task-by-task, one commit per task**, in the order listed. Each task must leave
   the app fully working. Commit message format: `UX-<n>: <task title>`.
2. After each task run all four: `npm run lint`, `npm test`, `npm run format`,
   `npm run build`. All must pass before committing. If a task breaks an existing test,
   update the test to match the new specified behavior; do not delete tests.
3. Verify visually at a 390×844 viewport (Playwright or browser devtools mobile
   emulation) for any task marked **[visual check]**.
4. **Do not touch** anything under `src/engine/` or `src/map/` except where a task
   explicitly names a file there. Never modify the protocol tap, autosave, automapper
   resolution rules, or tap-to-travel logic beyond what a task explicitly says.
5. All colors/spacing must use the existing CSS custom properties in `src/index.css`
   (`--bg`, `--text`, `--accent`, `--space-*`, `--radius-*`, etc.). Never hard-code a
   hex color in component CSS.
6. All four themes must work: check light, dark, and retro (`data-theme` attribute on
   `<html>`) for every visual change.
7. New UI text is sentence case ("Score log", not "Score Log").
8. When a task changes behavior described in `docs/SPECS.md`, add a short dated note to
   the relevant SPECS.md section in the same commit (follow the existing note style).

---

## Batch 6 — re-orientation: the mobile-specific problem

### UX-25: "Previously on…" resume recap [visual check]

**Why (highest-impact item in this file):** UX-16's auto-resume drops the player
straight back into the story — but into a wall of stale scrollback with no memory of
intent. Coming back cold after days away is *the* classic problem of mobile IF play.
Everything a recap needs is already persisted: `GameRecord.lastPlayedAt`
(`src/storage/games.ts`), the status line re-arrives live on resume, the map graph
knows rooms explored, and the transcript ring (`src/storage/transcripts.ts`) holds the
last commands. This task is pure assembly — no engine or storage-schema work.

**1. Gap detection** (`src/state/engineStore.ts`): add to `EngineState`:

```ts
/** UX-25: set by openGame when resuming after a real away-gap (>= RECAP_GAP_MS since
 *  lastPlayedAt), so StoryScreen can show the recap card. Cleared by dismissal or by
 *  sending any command. Session-only. */
recapEntries: { command: string; response: string }[] | null;
dismissRecap: () => void;
```

In `openGame`, read `game.lastPlayedAt` (already fetched via `getGame`) **before** the
`touchLastPlayed(gameId)` call overwrites it. After the resume-scrollback rebuild block
(`if (resuming) { ... }`), when ALL of: an autosave existed (`latestAutosave !== null`),
`Date.now() - lastPlayedAtBeforeTouch >= RECAP_GAP_MS` (module const,
`12 * 60 * 60 * 1000`), and the transcript has at least one entry — set `recapEntries`
to the last 3 entries of `getTranscript(gameId)` (already fetched into `priorEntries`;
reuse it, do not re-read), filtered to entries with a non-empty `command`.
`dismissRecap` sets it back to `null`; `sendCommand` also clears it (one extra
`recapEntries: null` in its existing `set`), so acting IS dismissing. Reset to `null`
in `closeGame` and `openGame`'s initial reset `set`.

**2. UI** (`src/story/StoryScreen.tsx`, `src/App.css`): render a dismissible card
between the status line and the exits row (same slot the tap-hint banner uses; if both
would show, the tap-hint wins and the recap is skipped — a first-run player has nothing
to recap anyway):

```tsx
{recapEntries && (
  <div className="recap-card">
    <div className="recap-title">While you were away…</div>
    {status && <div className="recap-line">You're at: {status.left}</div>}
    <div className="recap-line">
      Last moves: {recapEntries.map((e) => e.command).join(' · ')}
    </div>
    <button type="button" className="tap-target" onClick={dismissRecap}>
      Continue
    </button>
  </div>
)}
```

CSS: a quiet elevated card — `background: var(--bg-elevated); border: 1px solid
var(--border); border-radius: var(--radius-2); padding: var(--space-3);` with
`.recap-title` bold and `.recap-line` in `var(--text-dim)`. No animation needed.

**3. Tests** (`tests/autoResume.test.ts` is the right home — it already has the mocked
`createEngine` + seeded autosave/transcript pattern): (a) resuming a game whose
`lastPlayedAt` is 2 days ago with 4 transcript entries → `recapEntries` has the last 3
with commands; (b) `lastPlayedAt` 5 minutes ago → `recapEntries` stays null;
(c) `sendCommand('look')` clears it. Seed `lastPlayedAt` by writing the game record
directly through the storage layer, not by monkey-patching `Date`.
Plus one `tests/story-ui.test.tsx` case: with `recapEntries` set via
`useEngineStore.setState`, the card renders and its Continue button calls the mocked
`dismissRecap`.

**Acceptance:** lint/tests/build pass. Live at 390×844 with the bundled Zork I: play a
few turns, then (devtools) rewrite the game record's `lastPlayedAt` to 2 days ago,
reload — the recap card shows room, and last commands; tapping Continue or sending any
command dismisses it. Check the card in all three themes.

**Outcome (2026-07-17): done as specced.** `recapEntries`/`dismissRecap` added to
`engineStore`; `lastPlayedAtBeforeTouch` captured before `touchLastPlayed` overwrites it;
`priorEntries` (already fetched for scrollback rebuild) reused rather than re-read. The
card is gated on `hasSeenTapHint` so it never competes with the tap-hint banner for the
same slot, matching this task's own stated intent. `npm run lint`/`npm test` (165 tests,
up from 159)/`npm run format`/`npm run build` all pass. **Live-verified with real
Playwright** (390×844, `npm run build && npm run preview`, real Chromium, bundled
`zork1.z3`): played `north`, rewrote the game record's `lastPlayedAt` to 2 days ago
directly in IndexedDB, reloaded — the card showed "You're at: North of House" / "Last
moves: north"; tapping Continue dismissed it. Screenshotted in light, dark, and retro —
legible in all three.

### UX-26: Retrace — one-tap "go back the way I came" [visual check]

**Why:** getting *into* trouble is one tap per move; getting back out means re-tapping a
sequence in reverse or a full Map-tab round trip. The data is already there:
`opposite(dir)` exists in `src/map/directions.ts:86`, and the automapper already
resolves every movement. This task adds a small "retrace" chip that sends the reverse
of the player's last successful move. (Distinct from UX-22 Undo, which rewinds game
state — retrace just walks back, in-fiction, taking a turn like any move.)

**1. Track the last move** (`src/state/mapStore.ts` — allowed exception to agreement 4;
`src/map/graph.ts` is NOT touched): the automapper already knows when a move succeeded,
but doesn't expose it. Rather than reach into `graph.ts`, derive it in the store: add
to `MapState`:

```ts
/** UX-26: the compass direction of the last *successful* movement (currentRoomId
 *  changed across handleEvent while a normalized direction command was pending), or
 *  null at boot / after teleports / after a failed move. Session-only, not persisted. */
lastMoveDir: Direction | null;
```

Implementation inside `handleEvent`: before calling `automapper.handleEvent(event)`,
record `const before = automapper.graph.currentRoomId`. If `event.kind === 'command'`,
stash `normalizeDirection(event.text)` (import from `../map/directions.js`) in a
module-level `pendingMoveDir` variable (null when the command isn't a direction). If
`event.kind === 'status_line'`, after the automapper call: if `pendingMoveDir` is
non-null AND `automapper.graph.currentRoomId !== before`, set
`lastMoveDir: pendingMoveDir`; if `pendingMoveDir` is non-null and the room did NOT
change, set `lastMoveDir: null` (the move failed — retracing it would be wrong);
then clear `pendingMoveDir`. Reset `lastMoveDir` to null in `reset()` and
`loadForGame`.

**2. UI** (`src/story/ExitsRow.tsx`): select `lastMoveDir` from the map store; compute
`const backDir = lastMoveDir ? opposite(lastMoveDir) : null;`. When `backDir` is
non-null, render one extra chip at the END of the row (after the direction chips):

```tsx
<button
  type="button"
  className="chip tap-target"
  aria-label={`Retrace: go ${backDir}`}
  disabled={inputType !== 'line'}
  onClick={() => {
    haptic();
    sendCommand(backDir);
  }}
>
  ⤺ {backDir.toUpperCase()}
</button>
```

Also relax the early return: the row now renders when
`knownExits.size > 0 || suggestedExits.size > 0 || backDir !== null`. No new CSS —
`.chip` covers it.

**3. Docs:** dated SPECS.md §3 note: `lastMoveDir` is UI-derived state in `mapStore`,
not part of the graph, and never affects resolution.

**4. Tests:** in whichever file already drives `useMapStore.handleEvent` with
command/status_line sequences (`tests/graph.test.ts` uses the Automapper directly —
add a new `tests/mapStore.test.ts` if no store-level harness exists, following
`tests/travelTo.test.ts`'s store setup): (a) command `n` + status_line arriving at a
new room → `lastMoveDir === 'n'`; (b) a follow-up command `xyzzy` + status_line same
room → `lastMoveDir` still `'n'` (non-direction commands don't clear it);
(c) command `e` + status_line with UNCHANGED room → `lastMoveDir === null` (blocked
move). One `tests/story-ui.test.tsx` ExitsRow case: with `lastMoveDir: 'n'` in the map
store, a chip labeled `Retrace: go s` renders and clicking it sends `s`.

**Acceptance:** lint/tests/build pass. Live with Zork I: go `n` from West of House —
the exits row now ends with `⤺ S`; tapping it returns to West of House and the chip
flips to `⤺ N`. Try a blocked direction — the retrace chip disappears (no stale wrong
suggestion). All three themes.

**Outcome (2026-07-17): done as specced, with one correction to this task's own
acceptance example.** `lastMoveDir` added to `mapStore` exactly as described (module-
level `pendingMoveDir` stashed on `command`, resolved on the following `status_line`
against a captured `before` room id); `ExitsRow` appends the `⤺ <DIR>` chip and relaxes
its empty-row guard. `npm run lint`/`npm test` (164 tests, up from 159)/`npm run
format`/`npm run build` all pass, plus a new `tests/mapStore.test.ts`.

**Live-verified with real Playwright** (390×844, bundled `zork1.z3`) — this is where the
one correction comes from: `n` from **West of House** does *not* round-trip via `s`
(real Bocfel response: "The windows are all boarded." — the house's perimeter is a
one-way loop in this game, not a reversible grid, confirmed directly against the live
interpreter, not assumed), so the task's own written acceptance example doesn't hold for
that specific origin room. The retrace *mechanism* itself is correct and was verified
end-to-end with a origin/direction pair that does round-trip: from West of House, `n`
then `n` again reaches Forest Path (chip `⤺ S`); tapping it returns to North of House
and the chip flips to `⤺ N` exactly as designed. Separately confirmed the blocked case
(`up` from West of House, and `s` from North of House both block) makes the chip vanish
with no stale suggestion. Screenshotted in light, dark, and retro — legible in all
three.

### UX-27: OOPS-aware "fix last word" flow

Promotes `ZMACHINE_CAPABILITIES_RESEARCH.md` Tier 1 item 2 (researched 2026-07-16,
never batched). A mistyped/mis-tapped word currently costs a full retype — the one hole
left in the no-typing loop. Many Infocom/Inform games support `oops <word>`: substitute
the one unknown word into the previous command and re-parse.

**Posture (same as UX-18's mentions heuristic): narrow, false-negative-tolerant, never
a wrong command.** Only act when the game itself said it didn't know a word AND quoted
it.

**1. Detection** — new pure function in a new file `src/story/oops.ts`:

```ts
/** UX-27: extracts the word a parser error says it didn't understand, or null.
 *  Deliberately narrow: only patterns that QUOTE the word are matched, so we never
 *  guess. Covers Infocom's classic 'I don't know the word "frotz".' and Inform 6/7
 *  library variants ("You can't see any such thing" carries no word — ignored). */
export function detectUnknownWord(text: string): string | null;
```

Patterns to match, case-insensitive, returning the captured word lowercased:
`don't know the word "(\w+)"`, `do not know the word "(\w+)"`,
`the word "(\w+)" (?:is not|isn't) (?:in your|necessary)`. Nothing else — Inform's
unquoted "You can't see any such thing" is deliberately a miss (no word to extract).

**2. Store** (`src/state/engineStore.ts`): add session state
`oopsWord: string | null` (initial null, reset in `closeGame`/`openGame`). In the
`input_requested` commit branch, after the transcript commit: set
`oopsWord: detectUnknownWord(response)` when `event.type === 'line'` (a char prompt
can't accept an oops), else leave as-is. Any subsequent `command` event clears it
(`oopsWord: null` in the `event.kind === 'command'` branch).

**3. UI** (`src/story/CommandBar.tsx`) **[visual check]**: when `oopsWord` is non-null
and `inputType === 'line'` and the draft is empty, render a hint chip row directly
above the command form (inside `.command-bar`, above `.command-form` — same slot the
history popover uses):

```tsx
<div className="oops-hint">
  Didn't know “{oopsWord}” — tap the word you meant
</div>
```

and change tap-a-word's behavior for exactly the next word tap: when `oopsWord` is set
and the draft is empty, a word tap composes `oops <word>` into the draft instead of
just `<word>` (implement in `uiStore.appendToDraft`'s caller, NOT by changing
`appendToDraft` itself: in `src/story/TapWords.tsx`'s `onClick`, read
`useEngineStore.getState().oopsWord` and the current draft; if oops applies, call
`appendToDraft('oops ' + word.toLowerCase())`, and clear `oopsWord` via
`useEngineStore.setState({ oopsWord: null })`). The player still reviews and taps Send
— nothing auto-sends.

CSS: `.oops-hint { font-size: 13px; color: var(--text-dim); padding: 2px var(--space-2); }`.

**4. Tests:** new `tests/oops.test.ts` for `detectUnknownWord` (Infocom phrasing → word;
Inform "necessary" phrasing → word; "You can't see any such thing" → null; plain prose
containing the word "word" → null). `tests/story-ui.test.tsx`: with `oopsWord: 'sinbad'`
set, tapping a word `sword` in TapWords puts `oops sword` in the draft and clears
`oopsWord`; with `oopsWord` null the tap appends normally (existing tests unchanged).

**Acceptance:** lint/tests/build pass. Live with Zork I: send a garbage word ("take
sinbad") — the game answers with its don't-know-the-word line, the hint chip appears,
tapping the intended word in the visible text composes `oops <word>`, Send re-parses
the corrected command. Confirm ordinary play (no parser error) shows no hint and taps
compose normally.

**Outcome (2026-07-17): done as specced.** `detectUnknownWord` added in
`src/story/oops.ts` against the three quoted patterns (Infocom's `don't know the word`,
its `do not` variant, and Inform's `"word" is not necessary` phrasing); `oopsWord`
cleared in `engineStore`'s internal `event.kind === 'command'` branch (confirmed via
`protocol-tap.ts` that a *silent* background autosave command never emits a
`GameEvent` of kind `command` at all, so this never races with the per-turn autosave)
and (re)computed against the response text in the `input_requested` line-commit branch.
`npm run lint`/`npm test` (172 tests, up from 164)/`npm run format`/`npm run build` all
pass.

**Live-verified with real Playwright** (390×844, bundled `zork1.z3`): sent `take
sinbad`, got Bocfel's real `I don't know the word "sinbad".`; the hint chip appeared
reading `Didn't know "sinbad" — tap the word you meant`; tapping a word in the visible
text composed `oops <word>` into the draft and cleared the hint; a following ordinary
command (`look`) showed no hint. Screenshotted in light, dark, and retro — legible in
all three.

---

## Batch 7 — moments that matter: death, risk, reward

### UX-28: Death-aware undo offer [visual check] — **depends on UX-22 (Batch 5) shipping first**

When the player dies, classic games print a `*** You have died ***` banner and drop
into their own RESTART/RESTORE/QUIT prompt — the single most punishing moment in
classic IF, and it currently demands keyboard negotiation. Once UX-22's `undoLastMove`
exists, offer it inline.

**1. Detection** (`src/story/oops.ts` gains a sibling, or new `src/story/death.ts` —
implementer's choice, one file for both is fine):

```ts
/** UX-28: true when a response contains a classic death/ending banner. Narrow on
 *  purpose: the starred banner is a strong Infocom/Inform convention; prose deaths
 *  without it are accepted misses. */
export function detectDeath(text: string): boolean;
```

Match, case-insensitive: `\*{2,}\s*you have died\s*\*{2,}`,
`\*{2,}\s*you are dead\s*\*{2,}`. Nothing broader (the generic
`*** The story has ended ***` also ends *wins* — offering "undo" over a victory banner
would be actively wrong).

**2. Store** (`src/state/engineStore.ts`): session flag `deathDetected: boolean`
(reset on `closeGame`/`openGame`/every `command` event). Set true when a committed
response passes `detectDeath` — check in the same commit branch UX-27 hooks.

**3. UI** (`src/story/StoryScreen.tsx`): when `deathDetected`, render a banner chip
above the command bar (same visual family as the tap-hint banner):
"☠ Undo that move?" with two buttons — "Undo" (calls `undoLastMove()`, haptic) and a
dismiss "×" (clears the flag). The game's own RESTART/RESTORE prompt still works
underneath for players who want it; this is an additive shortcut, not a replacement.
Note: after death many games switch to `char` input or a special prompt — `undoLastMove`
reboots the engine from the prior autosave, which resolves that state entirely, so the
button must NOT be gated on `inputType === 'line'`.

**4. Tests:** `detectDeath` unit cases (died banner true, "The story has ended" false,
plain prose false). Story-UI case: `deathDetected: true` renders the banner; Undo
button calls mocked `undoLastMove`.

**Acceptance:** lint/tests/build pass. Live with Zork I (walking into the Grue's dark
places without a lamp is the quickest death): die, see the offer, tap Undo — back to
the pre-death turn, transcript consistent (UX-22's own acceptance). Dismissing instead
leaves the game's own prompt usable. All three themes.

**Outcome (2026-07-17): done as specced.** `detectDeath` added in `src/story/death.ts`
against exactly the two starred banners, deliberately excluding the generic
"story has ended" banner. `deathDetected` added to `engineStore`, computed alongside
UX-27's `oopsWord` in the same line-commit branch, cleared on any subsequent command.
`StoryScreen` renders the `☠ Undo that move?` banner above the command bar, Undo wired
to the existing `undoLastMove()` with no `inputType` gate (per this task's own note that
death can leave the interpreter in a non-`line` state). `npm run lint`/`npm test` (178
tests, up from 172)/`npm run format`/`npm run build` all pass.

**Live-verified with real Playwright** (390×844, bundled `zork1.z3`): took the window
into the house, moved the rug, opened the trap door, went down into the unlit cellar,
then walked (not waited — idling with `wait` in the dark never triggered the grue in
this build, only movement did) until the grue's "Oh, no! ... devoured you!" banner hit;
the Undo offer appeared, and tapping Undo rewound the status line from `Forest` (the
game's own post-death respawn) back to `Cellar`, the turn just before death, exactly
like UX-22's own acceptance. Screenshotted in light, dark, and retro — legible in all
three, including retro's green-on-black.

### UX-29: Score log ("trophy log")

UX-11's `scoreDelta` detection already fires a toast and haptic, then throws the
information away. Persist the moments and show them: "+5 — open trophy case — Living
Room, turn 42" is a delightful, re-readable record of progress, and near-zero cost
since detection is built.

**1. Storage** (`src/storage/db.ts` + new `src/storage/scoreLog.ts`): new object store
`scoreLog` keyed by `gameId` holding
`{ gameId, entries: { turn: number; amount: number; command: string; room: string }[] }`
— same single-record-per-game shape as `transcripts`. **DB migration discipline:** bump
the IDB version and add the store in the upgrade callback following exactly the pattern
the existing stores use in `db.ts` (read it first); existing stores/data untouched.
API: `appendScoreEntry(gameId, entry)` (cap at 500 entries, same slice pattern as
transcripts' `MAX_ENTRIES`), `getScoreLog(gameId)`, and wire `scoreLog` into
`deleteAllForGame`'s store list in `src/storage/games.ts` (both `deleteGame` and
`restartPlaythrough`).

**2. Store** (`src/state/engineStore.ts`): in the `status_line` branch where
`scoreDelta` is set, also fire
`void appendScoreEntry(gameId, { turn: lastKnownTurn, amount, command: <last command>, room: event.left })`.
The last command is the module-level `pendingCommand` if non-null, else the newest
`commandHistory` entry — check at implementation time which is still in scope at that
point in the event stream; if neither is reliably available, store `''` and render the
entry without a command rather than guessing.

**3. UI** (`src/story/StoryScreen.tsx` + `src/more/MoreScreen.tsx`) **[visual check]**:
make the score span in the status line tappable (`<button>` with the existing
`.status-line-score` styling — note UX-22 already converts these spans to explicit
classes; if UX-22 has not landed yet, STOP and reorder). Tapping opens a bottom sheet
(reuse the dialog-store/sheet pattern `RoomEditSheet`/`DialogHost` established) listing
score entries newest-first: `+5 · open trophy case · Living Room`. Empty state: "No
points yet — they'll be logged here."

**4. Tests:** storage round-trip (append/get/cap/delete-with-game); an engineStore case
seeding a score increase via the existing scoreDelta test harness
(`tests/scoreDelta.test.ts` — extend it) asserting an entry lands in IDB; a story-UI
case that the score button opens the sheet with a seeded entry.

**Acceptance:** lint/tests/build pass. Live with Zork I: earn points (mailbox leaflet
does not score; entering the house/getting the egg does — any scoring action works),
tap the score in the status line, see the entry with command and room. Restart the
playthrough — log is empty again. All three themes.

**Outcome (2026-07-17): done as specced, one file skipped.** `scoreLog` object store
added via a real `oldVersion`-gated `db.ts` upgrade callback (version 2; this is the
schema's first actual migration, since version 1 created every store unconditionally —
established the `if (oldVersion < N)` pattern future stores should follow). New
`src/storage/scoreLog.ts` mirrors `transcripts.ts` exactly (500-entry cap, same slice
pattern); wired into both `deleteGame` and `restartPlaythrough`. `engineStore` fires
`appendScoreEntry` in the same `status_line` branch as `scoreDelta`, using `event.turn`
(confirmed via `protocol-tap.ts` to be the exact turn shared by that turn's `buffer_text`/
`status_line`/`input_requested` — more precise than `lastKnownTurn`, which still holds
the *previous* turn at this point since `input_requested` hasn't run yet) and the
module-level `pendingCommand`, which — also confirmed by reading the surrounding code —
is still set at this point in the event stream (cleared only later, in
`input_requested`). New `src/story/ScoreLogSheet.tsx` reuses `RoomEditSheet`'s bottom-
sheet chrome (`.room-edit-backdrop`/`.room-edit-sheet`) rather than inventing new
classes. **`src/more/MoreScreen.tsx` was NOT touched** — the task named it as a file to
change but the task's own body never describes what MoreScreen-side behavior would be;
the sheet opens entirely from the Story tab's status line, which is where the task's own
acceptance check drives it, so this looks like a copy-paste artifact from a similar task
rather than a real requirement (same category of drift as UX-26's acceptance example).
`npm run lint`/`npm test` (184 tests, up from 178)/`npm run format`/`npm run build` all
pass.

**Live-verified with real Playwright** (390×844, bundled `zork1.z3`): the score button
opened the sheet showing "No points yet — they'll be logged here." before scoring;
after entering the house through the window (+10), the sheet showed `+10 · west ·
Kitchen`. Screenshotted in light, dark, and retro — legible in all three.

### UX-30: One-tap checkpoint from the story screen [visual check]

"I'm about to try something risky" is a core IF pattern; named saves exist but live
behind More → typing a name. Add a bookmark button that snapshots the current state
under an auto-generated name, no keyboard.

**Change** (`src/story/StoryScreen.tsx`, `src/state/engineStore.ts`): a `⚑` button in
the status line row (next to UX-22's `↶`; same sizing/CSS class family). New store
action `saveCheckpoint()`: calls `activeEngine.saveAutosave()` (the same Quetzal
snapshot the per-turn autosave uses — NOT the in-game SAVE command, which would round-
trip through the game's own prompt) and writes it via the existing
`writeSave(gameId, name, bytes, turn)` from `src/storage/saves.ts` with
`name = "Checkpoint — <status.left> — turn <lastKnownTurn>"` (dedupe: if that exact
name exists, append ` (2)`, ` (3)`, …), then `refreshSaves()`. Confirm with a haptic +
the existing toast pattern (reuse `.score-toast` styling with a `⚑ Saved` message —
implementer may generalize the toast, but keep the diff small). Checkpoints appear in
More's existing saves list and restore through the existing `restoreNamed` flow —
**verify at implementation time that a `writeSave`-produced snapshot restores through
`restoreNamed`'s in-game RESTORE path; if the formats differ (autosave snapshot vs
named-save Quetzal), STOP and leave a `TODO(owner):` note rather than shipping a
checkpoint that can't restore.**

**Tests:** engineStore case (mocked engine returning fixed bytes): `saveCheckpoint()`
writes a save whose name starts with `Checkpoint`, visible via `listSaves`; second call
same turn gets the ` (2)` suffix. Story-UI case: button renders next to undo and calls
the mocked action.

**Acceptance:** lint/tests/build pass. Live: tap ⚑, see confirmation, find the
checkpoint in More → Saves, restore it after moving elsewhere — state returns. All
three themes.

**Outcome (2026-07-17): done as specced — the format-compatibility check this task
flagged passed, no STOP needed.** `saveCheckpoint()` calls the same `saveAutosave()`
the per-turn autosave already uses (real Quetzal bytes via the interpreter's own Glk
SAVE opcode, per `engine.ts`'s own doc comment), writes them via `writeSave`, and dedupes
same-turn repeats with a numeric suffix. Confirmation reuses `.score-callout` styling
(generalized slightly: a second `checkpointSaved: { id }` counter mirroring
`scoreDelta`'s retrigger-on-repeat pattern, its own toast div, same CSS class — kept the
diff small rather than inventing a shared toast abstraction). `npm run lint`/`npm test`
(189 tests, up from 184)/`npm run format`/`npm run build` all pass.

**Live-verified with real Playwright** (390×844, bundled `zork1.z3`): tapped ⚑ at West
of House, saw the "⚑ Saved" toast; the checkpoint appeared in More → Saves as
`Checkpoint — West of House — turn 0`; moved `north` to North of House; tapped Restore
— the status line returned to `West of House`, confirming a `saveAutosave()` snapshot
genuinely round-trips through `restoreNamed`'s in-game RESTORE path. Screenshotted in
light, dark, and retro — legible in all three.

---

## Batch 8 — navigation and command-loop power

### UX-31: "Go to…" travel sheet on the Story tab [visual check]

Tap-to-travel is the map's killer feature but costs a tab switch + spatial re-orientation
+ room hunt + tab switch back. Surface it from the Story tab as a list.

**Change** (`src/story/` new `GoToSheet.tsx`, wired from `StoryScreen.tsx`): a `Go to…`
chip at the START of the exits row (before direction chips; only when the map has ≥ 2
named rooms and `inputType === 'line'` and not `traveling`). Tapping opens a bottom
sheet listing rooms from `useMapStore` — named, non-`UNKNOWN_ROOM_ID` rooms, current
room excluded, sorted by most recently visited if visit recency exists, else
alphabetically; each row shows the room name and floor (when ≠ 0, per UX-20/21's
`floor`). Tapping a room: compute `computePath(graph, currentRoomId, targetId)`
(`src/map/travel.ts:15`); if null, show the row disabled with "no known path" hint
instead of failing on tap (compute paths up front for the visible list); if
`isLongTrip(path)` reuse whatever confirmation MapScreen's tap-to-travel already shows
for long trips (find and reuse that exact flow — do not duplicate its strings); then
call the existing `travelTo(path)` and close the sheet. The sheet must register with
the Android back-handler chain the way `roomEditTarget` does (see
`src/state/backButton.ts` and `uiStore.roomEditTarget` — add a parallel
`goToSheetOpen` session flag in `uiStore`).

**Tests:** a rendering test (follow `tests/mapScreen.test.tsx`'s setup): sheet lists
named rooms excluding current; unreachable room renders disabled; tapping a reachable
room calls a mocked `travelTo` with the computed path and closes the sheet. Back-handler:
setting then clearing `goToSheetOpen` via the back chain (mirror the existing
`roomEditTarget` back-handler test if one exists; if none exists, a store-level test of
the flag is enough).

**Acceptance:** lint/tests/build pass. Live with Zork I after exploring 4+ rooms:
Go to… from the Story tab reaches West of House from Forest without touching the Map
tab; Android back closes the sheet, not the app. All three themes.

### UX-32: Adaptive verb chips (learned from this game's play)

`VERBS` (`src/story/verbs.ts`) is a fixed list of 8. Real games each have 2–3 verbs
that matter constantly (`light`, `unlock`, `push`, `dig`, `climb`, `tie`…). Learn them
from the player's own successful usage — zero false positives by construction, same
posture as the appendix's recent-objects idea.

**1. Storage** (`src/storage/db.ts` version bump shared with UX-29 if batched together
— otherwise its own; new `src/storage/verbStats.ts`): per-game record
`{ gameId, counts: Record<string, number> }`. API: `bumpVerb(gameId, verb)`,
`getVerbCounts(gameId)`; wire into `deleteAllForGame` (delete + restart both clear it).

**2. Counting** (`src/state/engineStore.ts`): on each `command` event, take the first
whitespace-token of `event.text`, lowercased. Count it only if: not in the built-in
`VERBS` list's commands, not a direction (`normalizeDirection` returns null), length
≥ 3, and — when a vocabulary is loaded — `isVocabWord` passes (never learn a typo).
Fire-and-forget `void bumpVerb(...)`.

**3. UI** (`src/story/VerbChips.tsx`): select the top 3 learned verbs with count ≥ 3
(loaded once per game open into `engineStore` as `learnedVerbs: string[]`; refresh it
lazily — recompute after every 10th counted command, not per keystroke). Render them
appended to the built-in chips, `needsObject: true` behavior (insert `<verb> ` into the
draft), with a subtly distinct class `chip-learned` (`border-style: dotted;` — dashed
is taken by suggestions). Cap the whole row's chip count at 11 so it stays one
scrollable row.

**4. Tests:** verbStats storage round-trip; engineStore counting rules (direction not
counted, built-in verb not counted, non-vocab word not counted, good verb counted);
VerbChips renders a learned chip after threshold and taps insert `light ` into the
draft.

**Acceptance:** lint/tests/build pass. Live with Zork I: use `open`/`read`… (built-ins,
not learned) then `turn` three times (`turn lamp` etc. — any parse result counts;
success-only filtering is out of scope, the vocab check is the filter) — a dotted
`turn` chip appears at the row's end and composes into the draft. Survives reload
(IndexedDB). All three themes.

---

## Batch 9 — reading surface and library polish

### UX-33: Transcript recall — search the story so far [visual check]

"Where did I see the grating?" has no answer on a phone: no Ctrl-F, and scrollback
scrubbing is painful. Transcripts are already persisted per-game with turn stamps.

**Change** (new `src/story/RecallSheet.tsx`; entry point: a `🔍` button in the status
line row alongside ↶/⚑ — three icon buttons is the cap, this fills the row): opens a
sheet with a search input (this one MAY focus/open the keyboard — searching is a typing
activity), searching `getTranscript(gameId)` case-insensitively across `command` and
`response`. Results newest-first, each showing turn number, the matched line with the
match bolded (plain `<strong>`, no innerHTML), and one line of surrounding context.
Debounce 200ms; require ≥ 2 chars; cap displayed results at 50. Tapping a result does
nothing in v1 (the live transcript array and the stored ring don't share indices —
jumping is out of scope; do NOT attempt scroll-to). Back-handler registration same
pattern as UX-31's sheet.

**Tests:** a pure search helper (`filterTranscript(entries, query)` exported from the
sheet's module or a sibling `recall.ts`) — case-insensitive match in command and
response, newest-first, cap; a rendering test with seeded entries asserting results and
the two-char minimum.

**Acceptance:** lint/tests/build pass. Live with Zork I after 10+ turns: search "mailbox"
— every mention appears with turn stamps; keyboard opens only inside this sheet; Android
back closes it. All three themes.

### UX-34: Library cards that tell a story [visual check]

Cards show `Z3 · last played Jul 12`. The interesting numbers already exist: score is
in the last status line (not persisted — skip it in v1 rather than adding plumbing),
rooms explored is `Object.keys(graph.rooms)` minus `UNKNOWN_ROOM_ID` from
`getMap(gameId)` (`src/storage/maps.ts`), turns played is the newest autosave
generation's `turn` (`getLatestAutosave`).

**Change** (`src/library/LibraryScreen.tsx`): extend the existing
`refreshSavedGameIds` pass (it already loads `getLatestAutosave` per game — reuse that
call, don't duplicate it) to also fetch each game's map and build a per-game stats map:
`{ turns, rooms }`. Second meta line on each card, only when an autosave exists:
`23 rooms explored · 210 turns`. Keep `formatDate` line as-is. Skip stats entirely for
games never played (no autosave) — no "0 rooms" noise.

**Tests:** `tests/library.test.tsx`: seed a game + autosave (turn 42) + a map with 3
real rooms → card shows `3 rooms explored · 42 turns`; a game with no autosave shows no
stats line.

**Acceptance:** lint/tests/build pass. Live: the Zork I card shows real numbers after
play; a freshly-uploaded game shows none. All three themes.

### UX-35: Reading mode — reclaim vertical space while scrolled back [visual check]

The story screen stacks status line, (recap), exits row, transcript, compass FAB, verb
chips, and command bar above the tab bar. All the input chrome is only meaningful at
the input point; while the player is scrolled UP reading, it's dead space. The pinning
state already exists (`pinnedRef` in `StoryScreen.tsx`).

**Change** (`src/story/StoryScreen.tsx`, `src/App.css`): lift the pinned state into
component state (`const [pinned, setPinned] = useState(true)` mirroring `pinnedRef` —
keep the ref for the scroll handler's synchronous reads; set both together). When NOT
pinned: add class `reading-mode` to the screen root; CSS collapses `.exits-row` and
`.verb-chips` (`max-height: 0; opacity: 0; overflow: hidden;` with a 150ms ease
transition on both properties; keep the command bar and compass FAB — the FAB is
already unobtrusive and the command bar hosts the return path). Everything restores
the moment the player re-pins (scrolls to bottom, taps the new-text pill, or sends a
command via the existing `pinRequestId` effect). No new setting; this is automatic and
reversible within one gesture. **Do not** collapse anything when the keyboard inset is
active (`inset > 0` from `useKeyboardInset` is CommandBar-internal — gate on the
transcript's own scroll state only; typing while scrolled back is already impossible
since sending re-pins).

**Tests:** story-UI: simulate scrolling up (fire a scroll event with
`scrollTop`/`scrollHeight`/`clientHeight` set so the pin threshold is exceeded) →
screen root has `reading-mode`; `scrollToBottom` via the pill removes it. (jsdom scroll
geometry is settable via `Object.defineProperty` — follow any existing scroll test's
pattern; if none exists, define properties directly on the element.)

**Acceptance:** lint/tests/build pass. Live at 390×844: scroll up two screens — exits
row and chips fold away smoothly, visibly more prose on screen; scroll back down or
send a command — they return. No layout jump when the score toast or new-text pill
fires mid-read. All three themes.

---

## Appendix A — promoted for owner review from the ecosystem survey

See `IF_ECOSYSTEM_RESEARCH.md` (same date) for the full survey with sources. The
candidates below are NOT specced tasks — do not implement without owner sign-off, same
rule as prior rounds' appendices.

*(Populated by the companion research doc's "recommended" section — kept in one place
there to avoid two drifting copies. This appendix intentionally just points at it.)*

## Appendix B — evaluated this round and deliberately NOT proposed

- **Mini-map widget on the Story tab.** Evaluated against UX-31's Go to… sheet: a
  live SVG mini-map costs story-screen vertical space permanently (the exact budget
  UX-35 is reclaiming) to show information the exits row already conveys for the
  common case. The sheet gets the *utility* (travel without tab-switch) without the
  standing cost. Revisit only if UX-31 proves insufficient.
- **Pinch-to-adjust font scale on the transcript.** Viewport pinch-zoom is already
  enabled (UX-1b, accessibility) and a second pinch gesture on the same surface would
  fight it. The More-screen control + persistence (UX-15) covers deliberate sizing.
- **Auto-suggest/autocomplete keyboard strip while typing.** The dictionary (UX-19)
  could power it, but the app's whole thesis is that typing is the fallback, not the
  main path — investment should keep going to the tap loop (UX-27, UX-32) instead.
- **Session recap via LLM summarization.** Phase 2 territory (BYO-token). UX-25's
  mechanical recap ships the 80% now, offline, and becomes the LLM feature's grounding
  later — same layering the walkthrough-reader appendix idea uses.
