import { defineConfig } from 'vite';

// One-file build for sharing a playable copy: everything (three.js included)
// is rolled into a single game.js next to index.html, so the pair can be
// served from any dumb static host — raw.githack, GitHub Pages, a USB stick.
export default defineConfig({
  base: './',
  build: {
    outDir: 'play',
    emptyOutDir: true,
    chunkSizeWarningLimit: 4096,
    rollupOptions: {
      output: {
        inlineDynamicImports: true,
        entryFileNames: 'game.js',
        assetFileNames: '[name][extname]',
      },
    },
  },
});
