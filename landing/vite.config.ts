import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { pl } from '../src/i18n/landing/pl';
import { PLAY_STORE_URL } from './src/data';
import { appLinkFiles } from './appLinks';
import { buildLlmsTxt } from './llmsTxt';

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
      name: 'llms-txt',
      generateBundle() {
        this.emitFile({
          type: 'asset',
          fileName: 'llms.txt',
          source: buildLlmsTxt(),
        });
      },
    },
    {
      name: 'landing-metadata',
      transformIndexHtml: (html) =>
        html
          .replaceAll('%PAGE_TITLE%', pl.meta.title)
          .replaceAll('%PAGE_DESCRIPTION%', pl.meta.description)
          .replaceAll('%PAGE_IMAGE_ALT%', pl.meta.imageAlt)
          .replaceAll('%PLAY_LABEL%', pl.install.play)
          .replaceAll('%PLAY_URL%', PLAY_STORE_URL),
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
