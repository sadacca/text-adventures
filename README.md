# Text Adventures

A locally-hostable web app for playing Infocom-era text adventures (Z-machine games) in the browser, with:

- **Play in browser, mobile-first** — Z-machine interpreter (Bocfel via WebAssembly) supporting v1–v8 story files, covering the entire Infocom catalog and modern Inform games; designed for phone browsers (desktop is not a target), with a compass rose, verb chips, and tap-a-word input so typical play needs little or no typing
- **Autosave** — state persists automatically every turn; killing the tab and reopening resumes exactly where you left off. In-game SAVE/RESTORE and Quetzal export/import also supported
- **Auto-mapping** — a live map that builds itself as you explore, touch-editable, with tap-a-room auto-travel as the primary way to get around
- **LLM assistance** (phase 2) — bring-your-own-API-token hints, graduated from gentle nudge to full spoiler
- **Generated graphics** (phase 3) — AI-generated room illustrations, cached per room, offline or via API
- **Android** (phase 4) — PWA first, then a Capacitor-wrapped native app

## Status

Phase 1 (mobile-first playable web app with autosave and auto-map) is under active implementation. Playable end-to-end with autosave, kill-tab-and-resume, and named SAVE/RESTORE with Quetzal export/import (Tasks 1.1–1.3, 1.5, and a minimal Task 1.2 library); the protocol tap still needs Task 1.4's fixture-based hardening, and the mobile command UI (compass rose, tap-a-word) and auto-map are not built yet. See [`docs/IMPLEMENTATION_PLAN.md`](docs/IMPLEMENTATION_PLAN.md) for the researched architecture and the phased, task-by-task implementation plan (including outcome notes recording where reality diverged from the original plan), and [`docs/SPECS.md`](docs/SPECS.md) for the exact contracts and per-task checklists.

## Development

This repo vendors [asyncglk](https://github.com/curiousdannii/asyncglk) as a git
submodule (it isn't published to npm — see `docs/IMPLEMENTATION_PLAN.md` Task 1.3),
so clone with `--recurse-submodules` or run `git submodule update --init` afterwards.

```sh
git submodule update --init
npm install
npm run dev       # dev server, http://localhost:5173
npm test          # vitest
npm run lint       # eslint
npm run format     # prettier --write
npm run build      # tsc -b && vite build
```

Verify at a mobile viewport (390×844) during development; a real Android Chrome check
closes out each phase-1 task per the plan.

Deployment is automatic via `.github/workflows/deploy.yml` on push to `main` or
`claude/infocom-text-adventure-emulator-32pzp3` (the latter is the branch actually
serving as trunk — see IMPLEMENTATION_PLAN.md), publishing to GitHub Pages. This
requires two one-time manual steps in repo settings: enable Pages (Settings → Pages →
Source → GitHub Actions), and make sure the `github-pages` deployment environment
(Settings → Environments → github-pages → "Deployment branches and tags") allows
deploys from whichever of those branches you push to.

## Story files

This repo does not and must not contain Infocom story files (they are still under copyright). You supply your own `.z3`/`.z5`/`.z8`/`.dat` files via the app's file picker. Development and tests use freely redistributable games (see the plan).

## License

Application code: MIT. Third-party interpreter components retain their own licenses (Parchment/AsyncGlk/emglken are MIT; Bocfel is GPL-2.0 — consumed as an unmodified prebuilt WASM component).
