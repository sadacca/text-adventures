# Text Adventures

A locally-hostable web app for playing Infocom-era text adventures (Z-machine games) in the browser, with:

- **Play in browser** — Z-machine interpreter (Bocfel via WebAssembly) supporting v1–v8 story files, covering the entire Infocom catalog and modern Inform games
- **Save progress** — native in-game saves persisted to browser storage, plus export/import of standard Quetzal save files
- **Auto-mapping** — a live map that builds itself as you explore, with manual correction tools
- **LLM assistance** (phase 2) — bring-your-own-API-token hints, graduated from gentle nudge to full spoiler
- **Generated graphics** (phase 3) — AI-generated room illustrations, cached per room, offline or via API
- **Android** (phase 4) — PWA first, then a Capacitor-wrapped native app

## Status

Planning. See [`docs/IMPLEMENTATION_PLAN.md`](docs/IMPLEMENTATION_PLAN.md) for the researched architecture and the phased, task-by-task implementation plan.

## Story files

This repo does not and must not contain Infocom story files (they are still under copyright). You supply your own `.z3`/`.z5`/`.z8`/`.dat` files via the app's file picker. Development and tests use freely redistributable games (see the plan).

## License

Application code: MIT. Third-party interpreter components retain their own licenses (Parchment/AsyncGlk/emglken are MIT; Bocfel is GPL-2.0 — consumed as an unmodified prebuilt WASM component).
