import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { buildSync } from 'esbuild';

const require = createRequire(import.meta.url);
const root = dirname(require.resolve('maplibre-gl/package.json'));
const license = readFileSync(join(root, 'LICENSE.txt'), 'utf8');
const css = readFileSync(join(root, 'dist/maplibre-gl.css'), 'utf8');

// Oba skrypty są samodzielne, także w WebView bez obsługi workerów modułowych.
function bundle(entry, format, globalName) {
  return buildSync({
    entryPoints: [join(root, entry)],
    bundle: true,
    format,
    globalName,
    minify: true,
    write: false,
    target: 'es2020',
    logLevel: 'warning',
  }).outputFiles[0].text;
}

const js = bundle('dist/maplibre-gl.mjs', 'iife', 'maplibregl');
const worker = bundle('dist/maplibre-gl-worker.mjs', 'iife');

writeFileSync(
  new URL('../src/map/maplibreAssets.generated.ts', import.meta.url),
  [
    '// Generowane przez npm postinstall z przypiętej paczki maplibre-gl.\n',
    `export const MAPLIBRE_JS = ${JSON.stringify(`/*\n${license}\n*/\n${js}`)};\n`,
    `export const MAPLIBRE_WORKER = ${JSON.stringify(worker)};\n`,
    `export const MAPLIBRE_CSS = ${JSON.stringify(css)};\n`,
  ].join(''),
);
