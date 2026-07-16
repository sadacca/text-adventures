# Mobile IF ecosystem survey — ideas worth borrowing (2026-07-16)

Companion to `MOBILE_UX_TODO_3.md` (its Appendix A points here). Scope: this extends
the 2026-07-16 peer-interpreter addendum in `ZMACHINE_CAPABILITIES_RESEARCH.md` — that
pass surveyed desktop-lineage peers (Gargoyle, Spatterlight, Lectrote) plus TextFiction;
this pass covers what it didn't: the mobile-native interpreters (iOS Frotz, Android MUD
clients), commercial mobile IF (inkle's Sorcery!/80 Days, Lifeline), and platform
infrastructure (the IFDB API). Everything here is a **candidate for owner review**, not
a specced task — same rule as every prior appendix. Ranked by expected delight-per-cost
for this app specifically.

## Recommended candidates, ranked

### A. In-app game discovery — an IFDB-backed "Find games" screen

**Borrowed from:** iOS Frotz, whose built-in IFDB browser (search, story details with
author/description/artwork, bookmarking, one-tap install, a bundled top-255 catalog) is
the single biggest delight gap between it and this app. Frotz turned "supply your own
story file" into "browse and tap".

**Why it matters here:** UX-17's bundled Zork I fixed the *empty-library dead end*, but
one game isn't a library. The current answer for game #2 — find a `.z5` on a desktop
site, download it on a phone, navigate the file picker — is exactly the flow this app
exists to eliminate. Discovery is the last non-tap step in the whole player journey.

**Feasibility (checked this pass):** IFDB has public JSON APIs — `search`
(`https://ifdb.org/search?json&...`) and `viewgame` (JSON or iFiction XML, including
download links and cover art). Full quarterly SQL exports also exist on the IF Archive
for building a static curated index instead of live queries.

**Caveats, all real:**
- **CORS is unverified.** A browser PWA can only call IFDB directly if IFDB sends CORS
  headers; if it doesn't, the fallback is a *curated static catalog* (a JSON file of
  ~10–20 classic, freely-redistributable Z-code games with descriptions and direct
  IF Archive URLs, shipped with the app and refreshed at build time from the IFDB
  export). The curated version is honestly most of the value at a fraction of the
  cost, and has no runtime dependency on a third-party server.
- **Format filter must be hard.** Much of IFDB's top-rated catalog is Glulx
  (`.ulx`/`.gblorb`), which this app does not run (and multi-format support was
  explicitly rejected in the prior survey). Only surface `format=zcode` entries.
- **Licensing:** only list games whose files are freely redistributable (IF Archive's
  policies mark this); never link commercial Infocom files. The existing
  no-story-files-in-repo rule is untouched — downloads go straight to the player's
  IndexedDB, same as an upload.
- **Offline-first stays intact:** discovery is inherently online; the screen just needs
  an honest offline empty state. (Downloaded games are precached-equivalent — they live
  in IndexedDB like uploads.)

**Recommendation:** the strongest candidate in this document. Start with the curated
static catalog (no CORS risk, no live dependency), designed so an IFDB-live search can
be added behind it later.

### B. Per-game notebook

**Borrowed from:** iOS Frotz's note-taking area (swipe left during gameplay).

**Why it matters here:** classic parser IF was designed to be played with paper next to
the keyboard — codes, recipes, "the leaflet mentioned a trapdoor", murder-suspect
timetables (Deadline is almost unplayable without notes). The app has per-*room* notes
(RoomEditSheet) but nowhere to write anything that isn't a room. On a phone there is no
paper next to the keyboard.

**Sketch:** one plain-text note per game in IndexedDB, opened from a Story-tab affordance
(the status-line icon row is at its 3-icon cap after UX-30/UX-33 — More-tab entry plus
a long-press somewhere is the likely answer; owner call). Autosaved as-you-type, kept on
restart-playthrough (notes outlive deaths), deleted with the game. Natural synergy: the
walkthrough/hint-sheet reader idea (TODO_2 appendix) could later be a second tab of the
same sheet, and tap-a-word could offer "add to notes" alongside examine.

**Recommendation:** high value, low cost, zero risk. Second-strongest candidate.

### C. Typed-input word completion, powered by the UX-19 dictionary

**Borrowed from:** iOS Frotz's word auto-completion, which completes against the
current game's own vocabulary — exactly the dictionary this app already parses
(`src/engine/dictionary.ts`, UX-19).

**Why it matters here:** `MOBILE_UX_TODO_3.md` Appendix B deprioritized an autocomplete
strip on "typing is the fallback path" grounds. Frotz's precedent is the counter-
argument: when the player *does* have to type (proper nouns, games with sparse prose to
tap, the OOPS flow), completing against the parser's actual word list makes typed
commands near-typo-proof — and the data source is already built and stopword-filtered.
A 2–3 candidate strip above the keyboard, prefix-matched, tap to complete; hidden
whenever the draft is empty or focus is elsewhere.

**Recommendation:** genuinely contested (two prior owner-adjacent decisions lean
opposite ways); presenting both sides is the point of this entry. Medium cost, fully
offline, no new data.

### D. Custom pinned-command chips

**Borrowed from:** BlowTorch (Android MUD client): long-press anywhere to create a
custom button; buttons grouped into swappable sets. MUD players build their own decks
because *they* know what they repeat.

**Why it matters here:** UX-32 (adaptive verb chips) learns automatically but caps at
top-3 single verbs. The manual complement: long-press an entry in the command-history
popover → "Pin as chip" — pins the *whole command* ("put coffin in altar", "turn bolt
with wrench"), per-game, removable the same way. Explicit control for the player the
heuristic underserves, reusing the existing chip row and history UI.

**Recommendation:** cheap once UX-32 exists; do it as UX-32's follow-up, not before.

### E. Map as a time machine (long-horizon direction, not a task)

**Borrowed from:** inkle's Sorcery! — their postmortem calls the map the series' best
design decision, serving simultaneously as progress display, branching-consequence
display, and the **checkpoint/rewind UI** (players rewind along their journey line).

**Why it matters here:** this app is independently converging on the same shape: the
auto-map is already the progress display; UX-22 adds step-back undo; UX-30 adds
checkpoints named by room; UX-29 logs score moments with rooms. The composed endgame —
tap a room on the map, see "you were here at turn 42, +5 for the trophy case", restore
a checkpoint from there — would be a rewind UI no parser interpreter has ever shipped.

**Blockers, already known:** `KEEP_GENERATIONS = 3` supports only single-step undo;
"roll the map back" was explicitly scoped out of UX-22 as a separate project; retention
policy for checkpoint density is an open design question.

**Recommendation:** record as the north star that makes Batches 5–7's pieces cohere;
do not spec until UX-22/29/30 have shipped and taught us their real usage patterns.

### F. Idle re-engagement notification (speculative, owner-taste call)

**Borrowed from:** Lifeline, whose push-notification storytelling ("the original
texting adventure") demonstrated that IF on a phone can live in the notification tray.

**What translates (and what doesn't):** Lifeline's *authored* real-time delays are a
writing technique, not an interpreter feature — nothing to borrow mechanically (our
timed-input support is UX-24's territory). What translates is the weaker form: an
opt-in, strictly local notification after N days idle — "Zork I is waiting — you were
in the Loud Room with 45 points" — assembled from the same data as UX-25's recap card.
PWA-feasible (Notification API + service worker; no push server needed for
locally-scheduled reminders — needs a feasibility check on what Android Chrome
currently allows for scheduled/deferred local notifications from a PWA).

**Recommendation:** only if the owner *wants* the app to ever notify; default-off,
buried in settings if built. Listed because the resume-gap data (UX-25) makes it nearly
free, not because it's clearly right.

## Validation points (no action needed)

- **inkle: "text is a visual medium."** Their core precept — own the typesetting,
  present text beautifully, and people will read on phones. Validates the investments
  already made (UX-8 fonts/retro theme, UX-19's deliberately subtle bolding, UX-23's
  styling passthrough) and argues for continuing to treat transcript typography as a
  first-class feature, not chrome.
- **Frotz: double-tap a word copies it to the command line.** The tap-a-word flow here
  is strictly better (single tap, no keyboard); confirms the core input design against
  the longest-lived mobile interpreter.
- **Frotz: recently-played row + search in the story list.** The Library sorts by
  `lastPlayedAt` already; search matters only past ~a dozen games — revisit if
  candidate A ships and libraries actually grow.
- **Frotz: Dropbox save sync.** Cross-device sync is real user value but drags in
  accounts/conflict resolution; the existing Quetzal export/import is the honest manual
  version. Far-future at most.

## Surveyed and explicitly not recommended

- **Choice-based platform UIs (Episode, Choice of Games, 80 Days's own choice
  presentation).** Different genre: choice UIs replace the parser rather than assist
  it. 80 Days's lessons are for *authors*; the interpreter-side borrowables are already
  captured in E above.
- **BlowTorch-style triggers/aliases/regex automation.** Power-user scripting fights
  this app's whole thesis (the game's own parser is the interface, assisted by taps).
  Anyone who wants trigger automation has real MUD clients.
- **Frotz's FTP server / iTunes file sharing.** Solved problems on the modern web
  platform (file picker, share targets, export blobs); nothing to borrow.
- **Lifeline's authored real-time pacing as an interpreter feature.** Belongs to
  authors/runtimes designed for it; grafting artificial delays onto Infocom games would
  be vandalism. UX-24 covers the genuine Z-machine real-time cases.

## Sources consulted this pass

- iOS Frotz feature wiki: https://github.com/ifrotz/iosfrotz/blob/wiki/FrotzMain.md
- Frotz App Store listing: https://apps.apple.com/us/app/frotz/id287653015
- inkle Sorcery! postmortem (Game Developer):
  https://www.gamedeveloper.com/business/postmortem-i-steve-jackson-s-sorcery-i-series-by-inkle
- 80 Days design retrospectives: https://www.gamedeveloper.com/design/road-to-the-igf-inkle-s-i-80-days-i-
  and https://if50.substack.com/p/2014-80-days
- Lifeline notification-narrative design (Game Developer):
  https://www.gamedeveloper.com/design/building-a-narrative-out-of-push-notifications-in-i-lifeline-i-
- BlowTorch MUD client: https://bt.happygoatstudios.com/
- IFDB public APIs: https://ifdb.org/api/ (search: https://ifdb.org/api/search,
  viewgame: https://ifdb.org/api/viewgame)
