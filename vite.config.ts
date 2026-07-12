/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

const base = process.env.VITE_BASE_PATH ?? '/text-adventures/';

// https://vite.dev/config/
export default defineConfig({
  base,
  plugins: [
    react(),
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
        globPatterns: ['**/*.{js,css,html,wasm,png,svg,ico}'],
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
