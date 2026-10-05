import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Build prosto do docs/ (GitHub Pages bierze docs jako artifact).
// emptyOutDir: false — w docs/ leżą też screenshots/ i generowany
// w CI app-release.apk, których nie wolno kasować.
export default defineConfig({
  plugins: [react()],
  base: './',
  build: {
    outDir: '../docs',
    emptyOutDir: false,
    assetsInlineLimit: 0,
  },
});
