# Text Adventures

A locally-hostable web app for playing Infocom-era text adventures (Z-machine games) in the browser, with:

- **Play in browser, mobile-first** — Z-machine interpreter (Bocfel via WebAssembly) supporting v1–v8 story files, covering the entire Infocom catalog and modern Inform games; designed for phone browsers (desktop is not a target), with a compass rose, verb chips, and tap-a-word input so typical play needs little or no typing
- **Autosave** — state persists automatically every turn; killing the tab and reopening resumes exactly where you left off. In-game SAVE/RESTORE and Quetzal export/import also supported
- **Auto-mapping** — a live map that builds itself as you explore, touch-editable, with tap-a-room auto-travel as the primary way to get around
- **LLM assistance** (phase 2) — bring-your-own-API-token hints, graduated from gentle nudge to full spoiler
- **Generated graphics** (phase 3) — AI-generated room illustrations, cached per room, offline or via API
- **Android** (phase 4) — PWA first, then a Capacitor-wrapped native app

## Status

Phase 1 (mobile-first playable web app with autosave and auto-map) is under active implementation. See [`docs/IMPLEMENTATION_PLAN.md`](docs/IMPLEMENTATION_PLAN.md) for the researched architecture and the phased, task-by-task implementation plan, and [`docs/SPECS.md`](docs/SPECS.md) for the exact contracts.

## Development

```sh
npm install
npm run dev       # dev server, http://localhost:5173
npm test          # vitest
npm run lint       # eslint
npm run format     # prettier --write
npm run build      # tsc -b && vite build
```

Verify at a mobile viewport (390×844) during development; a real Android Chrome check
closes out each phase-1 task per the plan.

Deployment is automatic via `.github/workflows/deploy.yml` on push to `main`, publishing
to GitHub Pages (must be enabled once in repo settings: Settings → Pages → Source →
GitHub Actions).

## Story files

This repo does not and must not contain Infocom story files (they are still under copyright). You supply your own `.z3`/`.z5`/`.z8`/`.dat` files via the app's file picker. Development and tests use freely redistributable games (see the plan).

## License

Application code: MIT. Third-party interpreter components retain their own licenses (Parchment/AsyncGlk/emglken are MIT; Bocfel is GPL-2.0 — consumed as an unmodified prebuilt WASM component).
