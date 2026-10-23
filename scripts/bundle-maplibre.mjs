import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const root = dirname(require.resolve('maplibre-gl/package.json'));
const license = readFileSync(join(root, 'LICENSE.txt'), 'utf8');
const js = readFileSync(join(root, 'dist/maplibre-gl.js'), 'utf8');
const css = readFileSync(join(root, 'dist/maplibre-gl.css'), 'utf8');
writeFileSync(
  new URL('../src/map/maplibreAssets.generated.ts', import.meta.url),
  [
    '// Generowane przez npm postinstall z przypiętej paczki maplibre-gl.\n',
    `export const MAPLIBRE_JS = ${JSON.stringify(`/*\n${license}\n*/\n${js}`)};\n`,
    `export const MAPLIBRE_CSS = ${JSON.stringify(css)};\n`,
  ].join(''),
);
