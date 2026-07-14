/// <reference types="vitest/config" />
import { copyFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

const base = process.env.VITE_BASE_PATH ?? '/text-adventures/';

/**
 * emglken's bocfel.js sets its own `Module.locateFile` unconditionally (for its
 * "single-file mode" fallback), which shadows the `new URL('bocfel.wasm', import.meta.url)`
 * call Vite *does* statically rewrite to the correctly-hashed build output. At runtime this
 * default resolves to an *unhashed* `bocfel.wasm` next to the built JS chunk, which the
 * production build never emits under that literal name — the request 404s, the static
 * host's SPA fallback serves back `index.html`, and WebAssembly.instantiate chokes on HTML
 * bytes. Since nothing catches that failure in engine.ts, the Story screen is stuck on
 * "Loading…" forever. Ship an unhashed copy alongside the hashed one so that request 200s.
 */
function emglkenWasmFallback(): Plugin {
  return {
    name: 'emglken-wasm-fallback',
    apply: 'build',
    async writeBundle(options) {
      const require = createRequire(import.meta.url);
      const src = require.resolve('emglken/build/bocfel.wasm');
      const outDir = options.dir ?? 'dist';
      await copyFile(src, path.join(outDir, 'assets', 'bocfel.wasm'));
    },
  };
}

// https://vite.dev/config/
export default defineConfig({
  base,
  optimizeDeps: {
    // emglken's Emscripten glue locates its .wasm via `new URL(..., import.meta.url)`
    // relative to its own file; Vite's dep pre-bundler copies the JS elsewhere and
    // breaks that resolution, so leave it unbundled.
    exclude: ['emglken'],
  },
  plugins: [
    react(),
    emglkenWasmFallback(),
    VitePWA({
      registerType: 'autoUpdate',
      scope: base,
      base,
      includeAssets: ['favicon.png', 'apple-touch-icon.png'],
      manifest: {
        id: base,
        name: 'Text Adventures',
        short_name: 'Adventures',
        description: 'Play Z-machine text adventures in the browser, mobile-first.',
        start_url: base,
        scope: base,
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#14161a',
        theme_color: '#14161a',
        icons: [
          { src: 'pwa-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'pwa-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,wasm,png,svg,ico,z3}'],
        maximumFileSizeToCacheInBytes: 25 * 1024 * 1024,
        navigateFallback: `${base}index.html`,
      },
    }),
  ],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./tests/setup.ts'],
  },
});
