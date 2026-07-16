# Z-machine / interpreter capability research — delight opportunities not yet in this repo

Research pass (2026-07-16), owner-requested: survey what Z-machine story files and the
Bocfel/Glk interpreter stack this app already runs are *capable of*, versus what the app
currently surfaces, and list gaps worth an owner decision. Written the way
`MOBILE_UX_TODO_2.md`'s appendix is written: **sketches for review, nothing here is
approved for implementation.** Method: read the actual wiring
(`src/engine/glkote-bridge.ts`, `protocol-tap.ts`, `types.ts`, `emglken.d.ts`,
`src/storage/autosaves.ts`) rather than assuming from docs alone, cross-checked against
`SPECS.md`/`IMPLEMENTATION_PLAN.md`/`MOBILE_UX_TODO_2.md` so nothing below duplicates an
idea already tracked there (the existing appendix already covers: object-table short
names, Blorb bibliographic metadata + cover art, header release/serial/checksum,
recent-objects chips, "where haven't I been" nudge, walkthrough/hint reader, stuck
detection — none of those are repeated here).

Grounding fact about current wiring: `BridgeGlkOte` (`glkote-bridge.ts`) only ever
dispatches `type: 'line'` and `type: 'char'` Glk events, and `EngineHandle`
(`types.ts`) exposes exactly `sendCommand`/`sendChar`. The interpreter, dictionary
parser, and protocol tap are otherwise solid and format-agnostic (v1–v8, per the
README's "entire Infocom catalog" claim) — but *input* is line/char only, and the tap
only extracts plain text plus left/right status. Everything below is a gap relative to
what the underlying Z-machine/Glk stack can actually do, not a limitation of Bocfel
itself.

---

## Tier 1 — concrete gap, grounded in code already in the repo, worth doing first

### 1. Step-back "Undo last move"

**The infrastructure for this already exists and is unused.** `writeAutosaveGeneration`
(`src/storage/autosaves.ts:13`) keeps the **3 most recent** autosave generations per
game (`KEEP_GENERATIONS = 3`), each tagged with its turn number — but `getLatestAutosave`
(`autosaves.ts:44`) is the only reader anywhere in the app, and it always returns just
the newest one. There is no UI path to the two generations sitting right behind it.

This is the single most commonly requested feature in any parser-IF client: a fatal
death (Zork's grue, Trinity's countdown, a thoughtless `xyzzy`) currently means either
losing progress back to whenever the player last happened to reach a fresh autosave
boundary, or replaying moves from memory. Z-machine games *can* implement their own
in-game UNDO (`save_undo`/`restore_undo` opcodes, v5+), but plenty don't (Zork I is v3
and has no UNDO verb at all — see the note in `SPECS.md`'s automapper research log,
`docs/SPECS.md` around the 2026-07-15 forest-maze entry, where the researcher had to
reboot-and-replay because "this z-machine release has no `undo`"). An interpreter-level
undo sidesteps the game entirely by restoring a prior autosave snapshot — exactly what
Frotz-family interpreters have always done as a terp feature independent of game
support.

Sketch: a "Undo last move" action (Story tab overflow, or a swipe/long-press on the
transcript) that restores the second-newest autosave generation via the existing
`preloadAutosave`/`start({autorestore:true})` path already used for normal resume, then
re-derives the map/transcript state to match. Open questions for the owner: how many
steps back to expose (the 3-generation cap may need raising, or generations may need to
be per-turn rather than throttled to autosave boundaries — check how often
`writeAutosaveGeneration` actually fires relative to turns first); whether undoing should
also roll back automapper graph state (it should, to stay consistent, but the graph
currently only ever grows — rolling it back is new territory, not just a storage read);
and how this interacts with the "One playthrough per game" decision in `SPECS.md` §9 (an
undo is not a new playthrough, so it should feel like free, cheap, non-committal review —
much lower friction than the existing Restart confirm-dialog).

### 2. OOPS-aware typo correction chip

Many Infocom/Inform games implement an `OOPS <word>` convention: after a parser error
like "sinbad" in "You can't see any sinbad here", typing `oops sinbad` (or, in v5+
games with `INFIX`/newer libraries, just the corrected word alone) substitutes the one
misheard word into the previous command and re-parses it, without retyping the whole
line. This is a game-library convention layered on ordinary line input, not a special
opcode, so it works today with zero engine changes — but the app's own design pillar is
"typical play needs little or no typing" (tap-a-word, verb chips, compass rose), and a
mistyped tap-composed command currently has no tap-friendly fix: the player has to
retype the entire line.

Sketch: detect the game's own "I don't know the word/verb ... " class of parser error in
`buffer_text` (heuristic, per-game-library text matching — similar in spirit to UX-18's
`detectMentionedDirections`, same "narrow, false-negative-tolerant, never a wrong
command" posture) and, when detected, surface a lightweight "Fix last word" affordance
that composes `oops <tapped-word>` from the existing tap-a-word vocabulary UI instead of
requiring a full retype. Needs an owner decision on how broad the error-text matching
should be across different games' libraries (Inform's default library text differs from
Infocom's own parser text), and note this only works for single mistyped-word errors
that the *game* recognized as unknown — not for logically-wrong commands.

---

## Tier 2 — real gaps in interaction model, bigger lift, high payoff for specific games

### 3. Text styling passthrough (bold / italic / reverse video / fixed-pitch)

The Z-machine has a `set_text_style` opcode (roman, reverse, bold, italic, fixed-pitch)
and a `set_font` opcode, and games use them *narratively*, not just cosmetically:
Trinity styles its dream-countdown sequences, Bureaucracy uses reverse video for
department-of-motor-vehicles forms, Sherlock and Border Zone use italics for
telegraphed/remembered text, and most games reverse-video their banner/status text.
`ProtocolTap` (per `SPECS.md` §1's `GameEvent` shape) currently extracts only plain
`buffer_text`/`status_line` strings — RemGlk's content updates carry per-run style
tags, but nothing downstream reads them, so all of this collapses to plain text today.
Cross-reference: this is a different, narrower thing than UX-19's vocabulary bolding
(which is a highlight the *app* adds; this is styling the *game* is already asking for)
— the two could coexist (`tap-word-vocab`'s `font-weight: 600` would need to compose
with a game-requested bold run, which is a CSS detail, not a conflict).

Sketch: extend `GameEvent`'s `buffer_text` to carry style runs (RemGlk already tags them
per Glk's `stylehint`/`run` content format) and render a small style set in the
transcript — reverse video and italic are the two with the most narrative payoff and the
least mobile-legibility risk; fixed-pitch matters for the (rare) game that draws
ASCII-art maps or tables in the main window and currently gets proportional-font mush.
Bold already has visual real estate claimed by UX-19 — decide whether game-requested
bold should be visually distinct from vocabulary-bold, or intentionally the same weight.

### 4. V6 "graphical" Infocom games are likely unplayable as designed today

The README claims v1–v8 coverage, "covering the entire Infocom catalog." Six Infocom
titles (Zork Zero, Journey, Shogun, Arthur, and the V6 releases of the Zork Legacy
line) are Z-machine version 6 — the version with a genuinely different interaction
model: a graphics window (`@erase_picture`/`@draw_picture`, images drawn from Blorb
picture resources) and, in several of them, **mouse-driven menu selection**
(`@read_mouse`/`@mouse_window`) as the *primary* interface for large parts of the game
(Zork Zero's puzzles and Journey's entire party-command system are menu/click-driven,
not typed). With only line/char input wired and no image window rendering, these games
will boot and technically report v6, but sizeable chunks of them cannot actually be
played through this app's UI. This is worth flagging distinctly from "would delight
users" — it's closer to "the catalog claim has an asterisk" — but the fix (image window
+ tap-as-mouse-click) is also squarely in this app's wheelhouse (already
touch/tap-first) and would be a genuine differentiator, since most mobile Z-machine
players today are stuck with text-only terps for these titles.

Sketch, if pursued: scope as its own multi-task project, not a single UX task — needs
Blorb picture-resource extraction (shares a chunk-walker with the already-tracked cover
art idea), an image `<canvas>`/`<img>` surface in the Story view, and a mapping from Glk
mouse events to tap coordinates. Recommend a separate research/design pass before
scoping, not folded into an existing batch.

### 5. Timed input (real-time games)

`@read`/`@read_char` support an optional timeout + interrupt routine (v4+): the game
gets to run code (and print text) while waiting for input, then re-prompt. This drives
Deadline's ringing phone, Border Zone's real-time spy sequences, and Trinity's
countdown-while-idle text. Today `BridgeGlkOte` only ever issues plain (untimed)
line/char requests, so on the games that rely on this, idle time simply... stays idle —
no missed phone call, no countdown pressure, arguably a *worse* experience than intended
on those specific titles since the tension mechanic silently doesn't fire. Lower
priority than items above (a small number of titles depend on it, and Bocfel's WASM
build support for the timer callback would need to be confirmed before scoping), but
worth a line item since it's a correctness gap, not just a missing nicety, for the games
it affects.

### 6. Hyperlink-driven choices

Glk defines hyperlink events (`@hyperlink_event`) that some post-1993 Inform games use
for menu-style selection (choose-a-response prompts rendered as clickable text runs
rather than a lettered menu). Rare in the classic Infocom catalog this app centers on,
more common in modern Inform 7 works players might upload themselves. Worth noting as a
gap but genuinely low priority relative to items above given this app's target catalog;
listed for completeness in case the "modern Inform games" part of the README's claim
gets emphasized later.

---

## Explicitly deprioritized (researched, not worth pursuing without new information)

- **Blorb sound resources / `@sound_effect`.** True multimedia sound in the Z-machine
  catalog is thin — a handful of tone-beep effects in a few Infocom titles (Wishbringer's
  bell, Sherlock), not the AIFF/OGG channel-mixing Glk sound spec was designed for
  Glulx-era games. Payoff is low relative to the plumbing (Glk sound channels,
  `glk_schannel_*`) it would need, and it's unclear Bocfel's WASM build even exposes the
  sound API. Revisit only if a specific requested game needs it.
- **Full v6 support as a Tier-1 item.** Real (see #4 above) but large enough that it
  should get its own scoping pass rather than being sized as a normal UX-task-sized
  sketch.

---

## Suggested next step

Owner review, same as the existing appendix: pick which of the above (if any) gets
promoted to a scoped batch task, `UX-`-numbered and specced at the same
file-and-line precision as `MOBILE_UX_TODO_2.md`'s existing tasks, before any
implementation starts. Item 1 (Undo) is the strongest "small effort, high delight"
candidate — the storage layer already does the hard part.
