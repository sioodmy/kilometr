const escapeScript = (source: string) => source.replace(/<\/script/gi, '<\\/script');

let cachedHead: string | null = null;
let headPromise: Promise<string> | null = null;

/** Buduje nagłówek HTML z silnikiem MapLibre i jego workerem bez wstrzykiwania 1.5 MB do startowego bundla. */
export function getCachedBundledMapLibreHead(): string | null {
  return cachedHead;
}

/** Leniwie ładuje silnik MapLibre oraz worker i zwraca gotowy fragment `<head>`. */
export async function loadBundledMapLibreHead(): Promise<string> {
  if (cachedHead !== null) return cachedHead;
  if (!headPromise) {
    headPromise = import('./maplibreAssets.generated')
      .then(({ MAPLIBRE_CSS, MAPLIBRE_JS, MAPLIBRE_WORKER }) => {
        const worker = escapeScript(JSON.stringify(MAPLIBRE_WORKER));
        cachedHead =
          `<style data-maplibre>${MAPLIBRE_CSS.replace(/<\/style/gi, '<\\/style')}</style>` +
          `<script data-maplibre>${escapeScript(MAPLIBRE_JS)}</script>` +
          `<script data-maplibre>(function(){` +
          `var url=URL.createObjectURL(new Blob([${worker}],{type:'text/javascript'}));` +
          // MapLibre 6 wybiera klasyczny Worker po końcówce .cjs, również we fragmencie URL.
          `maplibregl.setWorkerUrl(url+'#maplibre-worker.cjs');` +
          `})();</script>`;
        return cachedHead;
      })
      .catch((err) => {
        headPromise = null;
        throw err;
      });
  }
  return headPromise;
}

export function mapDocumentSource(html: string, offlineBase: string | null) {
  return { html, baseUrl: offlineBase ? `${offlineBase}/` : 'https://kilometr.app/' };
}
