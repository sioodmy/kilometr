import { MAPLIBRE_CSS, MAPLIBRE_JS, MAPLIBRE_WORKER } from './maplibreAssets.generated';

const escapeScript = (source: string) => source.replace(/<\/script/gi, '<\\/script');

/** Wstawia silnik i jego worker z paczki aplikacji, bez pobierania kodu z sieci. */
export function bundledMapLibreHead(): string {
  const worker = escapeScript(JSON.stringify(MAPLIBRE_WORKER));
  return (
    `<style data-maplibre>${MAPLIBRE_CSS.replace(/<\/style/gi, '<\\/style')}</style>` +
    `<script data-maplibre>${escapeScript(MAPLIBRE_JS)}</script>` +
    `<script data-maplibre>(function(){` +
    `var url=URL.createObjectURL(new Blob([${worker}],{type:'text/javascript'}));` +
    `maplibregl.setWorkerUrl(url);` +
    `})();</script>`
  );
}
