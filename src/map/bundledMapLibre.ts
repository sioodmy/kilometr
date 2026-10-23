import { MAPLIBRE_CSS, MAPLIBRE_JS } from './maplibreAssets.generated';

/** Wstawia silnik z paczki aplikacji, bez pobierania kodu z sieci. */
export function bundledMapLibreHead(): string {
  return (
    `<style data-maplibre>${MAPLIBRE_CSS.replace(/<\/style/gi, '<\\/style')}</style>` +
    `<script data-maplibre>${MAPLIBRE_JS.replace(/<\/script/gi, '<\\/script')}</script>`
  );
}
