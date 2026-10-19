import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { fileURLToPath, URL } from 'node:url';

export default defineConfig({
  base: './',
  // Stamped into the bundle so Settings can show which build the device is
  // actually running — otherwise there is no way to tell a stale install apart
  // from a current one.
  define: {
    __BUILD_ID__: JSON.stringify(new Date().toISOString().replace('T', ' ').slice(0, 16) + ' UTC'),
  },
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  plugins: [
    react(),
    VitePWA({
      registerType: 'prompt',
      injectRegister: null,
      includeAssets: ['favicon.svg', 'icons/apple-touch-icon.png'],
      manifest: {
        name: 'Ironpath',
        short_name: 'Ironpath',
        description:
          'Multi-program strength training tracker — hypertrophy and joint resilience blocks, fully offline.',
        theme_color: '#0f766e',
        background_color: '#0b1220',
        display: 'standalone',
        orientation: 'portrait',
        scope: './',
        start_url: './',
        categories: ['health', 'fitness'],
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          {
            src: 'icons/icon-maskable-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        importScripts: ['notification-events.js'],
        globPatterns: ['**/*.{js,css,html,svg,png,ico,woff2}'],
        maximumFileSizeToCacheInBytes: 6 * 1024 * 1024,
        navigateFallback: 'index.html',
        cleanupOutdatedCaches: true,
        runtimeCaching: [
          {
            urlPattern: ({ request }) => request.destination === 'image',
            handler: 'CacheFirst',
            options: {
              cacheName: 'images',
              expiration: { maxEntries: 60, maxAgeSeconds: 2592000 },
            },
          },
        ],
      },
      devOptions: { enabled: false },
    }),
  ],
  build: { target: 'es2020', chunkSizeWarningLimit: 1200 },
  // Vite rejects unknown Host headers. The app is reached from the phone through
  // `tailscale serve`, which forwards with the tailnet hostname as Host.
  preview: {
    allowedHosts: ['fedora.taild6580d.ts.net', 'localhost', '127.0.0.1'],
  },
});
