import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { pl } from '../src/i18n/landing/pl';

export default defineConfig({
  plugins: [
    react(),
    {
      name: 'landing-metadata',
      transformIndexHtml: (html) =>
        html
          .replaceAll('%PAGE_TITLE%', pl.meta.title)
          .replaceAll('%PAGE_DESCRIPTION%', pl.meta.description)
          .replaceAll('%PLAY_LABEL%', pl.hero.play)
          .replaceAll('%NO_SCRIPT%', pl.meta.description),
    },
  ],
  base: './',
  build: {
    outDir: '../docs',
    // docs/screenshots zawiera archiwalne zrzuty z review.
    emptyOutDir: false,
    assetsInlineLimit: 0,
  },
});
