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
          .replaceAll('%BETA_LABEL%', pl.android.testing.action)
          .replaceAll('%GROUP_LABEL%', pl.android.group.action)
          .replaceAll('%BETA_INTRO%', pl.android.intro)
          .replaceAll('%BETA_ACCOUNT%', pl.android.noteBody),
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
