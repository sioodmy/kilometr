import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { pl } from '../src/i18n/landing/pl';
import { appLinkFiles } from './appLinks';

export default defineConfig({
  plugins: [
    react(),
    {
      name: 'app-links',
      generateBundle() {
        for (const asset of appLinkFiles(
          process.env.ANDROID_APP_LINK_FINGERPRINTS ?? '',
          process.env.APPLE_TEAM_ID ?? '',
        ))
          this.emitFile({ type: 'asset', ...asset });
      },
    },
    {
      name: 'landing-metadata',
      transformIndexHtml: (html) =>
        html
          .replaceAll('%PAGE_TITLE%', pl.meta.title)
          .replaceAll('%PAGE_DESCRIPTION%', pl.meta.description)
          .replaceAll('%PAGE_IMAGE_ALT%', pl.meta.imageAlt)
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
