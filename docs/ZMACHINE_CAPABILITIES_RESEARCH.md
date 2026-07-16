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

**Promoted 2026-07-16 (owner-approved) → `MOBILE_UX_TODO_2.md` Batch 5, UX-22.** Scoped
and specced there at full implementation precision; this section stays as the research
rationale.

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

(These open questions were resolved during scoping, not left for the implementer:
UX-22 is single-step only, and explicitly does not roll back the automapper graph — see
that task's scope-decision note.)

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

**Promoted 2026-07-16 (owner-approved) → `MOBILE_UX_TODO_2.md` Batch 5, UX-23**, scoped
down to reverse-video + emphasized/italic only (bold and fixed-pitch deferred — see that
task). Confirmed during scoping that the wire protocol already carries per-run
`style`/`css_styles` data (asyncglk's `TextRun` type) that `protocol-tap.ts` currently
discards — this is a real, actionable gap, not speculative.

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

**Promoted 2026-07-16 (owner-approved) → `MOBILE_UX_TODO_2.md` Batch 5, UX-24.**
**Correction from this section's original write-up, found during scoping:** the claim
below that idle time "just stays idle" was wrong. Checked against asyncglk's actual
`GlkOteBase` source (the vendored submodule) while scoping the task: the low-level Glk
timer loop — reading a `timer` interval off `StateUpdate`, running `setInterval`, and
firing `send_event({type:'timer'})` — is already fully implemented there and runs
unmodified through `BridgeGlkOte.update()`'s `super.update(data)` call today. The real
open question, deferred to UX-24's own investigation phase, is narrower: whether text an
interrupt prints while input is still outstanding reaches the transcript promptly, not
whether timers fire at all. Border Zone (1987, the first Z-machine v5 release) is the
documented flagship case — the original ZIP interpreter needed dedicated support for its
timeouts.

`@read`/`@read_char` support an optional timeout + interrupt routine (v4+): the game
gets to run code (and print text) while waiting for input, then re-prompt. This drives
Border Zone's real-time spy sequences, and reportedly similar tension mechanics in a
handful of other titles (Deadline/Trinity's exact mechanisms weren't independently
confirmed to use this specific opcode path — treat those as unverified until checked,
Border Zone is the solid case). Lower priority than items above (a small number of
titles depend on it), but worth a line item since — per the correction above — this is
narrower and more tractable than it first looked, and any actual gap here is a
correctness bug (a countdown appearing late/misattributed) for the games it affects, not
just a missing nicety.

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

**Update (2026-07-16): resolved.** Owner reviewed this doc plus its addendum below and
promoted three items to specced tasks in `MOBILE_UX_TODO_2.md`'s new Batch 5: item 1
(Undo → UX-22), item 3 (text styling → UX-23), and item 5 (timed input → UX-24). Item 2
(OOPS typo fix) and item 4 (V6 mouse/graphics) were not promoted this round — still open
for a future pass, item 4 explicitly flagged as needing its own scoping session rather
than a normal task. Addendum items G (TTS) and H (transcript export) were reviewed and
explicitly NOT promoted (owner: TTS is "a potential reach," transcript export "seems
less useful") — both remain recorded below for a possible later look, not scheduled.

---

## Addendum (2026-07-16, same day) — features borrowed from peer IF-client projects

Follow-up pass, owner-requested: rather than reasoning only from the Z-machine/Glk spec
(above), survey what *other* interpreter projects actually ship, and check which of
those ideas this app is missing. Sourced live from each project's own README/docs
(links in each item), not from memory alone.

### G. Read-aloud / text-to-speech — inspired by TextFiction and Spatterlight

Two independent peer projects converge on this. **TextFiction**
([onyxbits/TextFiction](https://github.com/onyxbits/TextFiction), Android) is built with
"stories can optionally be read out aloud via Text To Speech synthesis... easy to handle
for blind and visually impaired users" as a headline feature.
**Spatterlight** ([angstsmurf/spatterlight](https://github.com/angstsmurf/spatterlight),
Mac) goes further with dedicated VoiceOver integration: a "Speak commands" toggle, custom
VoiceOver rotors for navigating output, and detection of old-style char-driven menus
(explicitly including "the Bureaucracy intro form") to make them screen-reader
navigable, per its [AppleVis testing thread](https://www.applevis.com/forum/macos-mac-apps/looking-voiceover-testers-my-text-adventure-interpreter).

This app currently has only generic `aria-live="polite"` on `.app-content`
(`src/App.tsx:76`) and the score toast (`src/story/StoryScreen.tsx:131`) — nothing reads
text aloud. The Web Speech API (`SpeechSynthesis`) is available in mobile browsers with
no new dependency, and the payoff isn't purely accessibility: reading new room text aloud
hands-free is also just convenient for playing while walking, which fits this app's
mobile-first framing directly. Sketch: a "Read aloud" toggle in More (same checkbox
pattern as UX-19's vocab-highlight/UX-15's persisted settings), speaking each new
`buffer_text` chunk as it lands; a "speak my own commands too" sub-option mirrors
Spatterlight's exact toggle. Menu-detection for genuinely non-linear char menus (Journey,
Trinity, Bureaucracy) is a much bigger lift — flag as a stretch goal, not part of a first
pass, and note it's a different problem from UX-14's "Tap to continue" (which only
handles single-key-then-resume prompts, not multi-option menus).

### H. Exportable/shareable transcripts — inspired by Lectrote

**Lectrote** ([erkyrath/lectrote](https://github.com/erkyrath/lectrote)) ships
"Universal transcript mode: a transcript is saved for every game you play... select
'Browse Transcripts' to see a list." This app already stores the equivalent data —
`storage/transcripts.ts`'s per-game ring buffer, capped at 2000 entries
(`SPECS.md` §4) — purely to rebuild scrollback on resume. It's never exposed to the
player. Sharing a transcript (a fun death, a full playthrough, a puzzle solution to ask
a friend about) is a long-standing IF-community habit, and the exact UI pattern already
exists in this app for a different feature: named-save Quetzal export via
`navigator.share`/download (`IMPLEMENTATION_PLAN.md`'s saves.ts description, ~line 403).
Reusing that pattern for a "Share transcript" action (plain text, not Quetzal bytes) in
More or the Story overflow menu is a small, self-contained addition given the storage
already exists — no engine changes needed at all.

### I. Per-game settings override — inspired by Gargoyle (speculative, lower confidence)

**Gargoyle** ([garglk/garglk](https://github.com/garglk/garglk)) layers config at
system/user/**per-game** priority, so a player can tweak font or margins for one
particular game without changing the global default. This app's `uiStore` settings
(theme, story font, text size — UX-15) are global across every game. A text-dense game
(Trinity, A Mind Forever Voyaging) might warrant a different text size than a
puzzle-light one. Flagged as genuinely lower-confidence than G/H: global settings are
simpler, this is a single-device mobile context (less need for per-project tuning than
Gargoyle's desktop multi-format use case), and it adds a real UI surface (where would a
per-game override live?) for a want that hasn't been observed from actual users of this
app. Listed for completeness, not recommended for near-term scoping.

### Surveyed and explicitly not recommended

- **Gargoyle's typography polish** (subpixel rendering, kerning, smart-quote/ligature
  substitution, floating-point layout). Real and well-executed in Gargoyle, but tuned for
  desktop reading; a 390px mobile viewport with a handful of story-font choices already
  (UX-15) gets proportionally less benefit for the CSS/rendering complexity involved.
  Skip unless a specific legibility complaint surfaces.
- **TextFiction's SMS/chat-bubble transcript styling.** A validation point, not a gap:
  this app already leans mobile-native (compass rose, chips, tap-a-word) rather than
  porting a desktop terminal metaphor, which is the same instinct TextFiction's
  chat-bubble UI represents. A full switch from the current flat/terminal-style
  transcript to chat bubbles would be a large visual redesign with real trade-offs (long
  room descriptions don't bubble well) — not something to take on just because a peer
  project does it differently. No action recommended.
- **Multi-format support (Glulx/TADS/Hugo/Adrift), the headline feature of Lectrote,
  Gargoyle, and Spatterlight alike.** Explicitly out of scope: this app's whole premise
  (per the README) is the Z-machine/Infocom catalog specifically, and Bocfel is a
  Z-machine-only interpreter — broadening formats would mean bundling additional WASM
  interpreters (Git/Glulxe for Glulx, etc.), a scope change big enough it should be its
  own product decision, not a UX-task-sized addition.

### Sources consulted this pass

- [onyxbits/TextFiction](https://github.com/onyxbits/TextFiction) (Android, TTS-first design)
- [erkyrath/lectrote](https://github.com/erkyrath/lectrote) (universal transcripts, autosave/resume, per-appearance theming)
- [garglk/garglk](https://github.com/garglk/garglk) (typography, multi-format, per-game config tiers)
- [angstsmurf/spatterlight](https://github.com/angstsmurf/spatterlight) fork, and its [AppleVis VoiceOver-testing thread](https://www.applevis.com/forum/macos-mac-apps/looking-voiceover-testers-my-text-adventure-interpreter) (deep screen-reader integration, menu detection)
