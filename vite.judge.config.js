import { defineConfig } from 'vite';

// A second dev server for the screenshot tooling. Hot reload is off so a frame
// sheet captured while other work is landing does not get yanked out from under
// the capture by a mid-run page reload.
export default defineConfig({
  base: './',
  server: {
    host: '127.0.0.1',
    port: 5175,
    hmr: false,
    watch: { ignored: ['**/*'] },
  },
});
