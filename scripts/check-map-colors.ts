// Test kolorów trasy na ciemnej mapie: żadna linia z palety nie może ginąć
// na tle #101413 (bug: tramwaj 19 rysował się brązem o kontraście 2:1).
// Na końcu walidacja całego stylu wg MapLibre: zepsute wyrażenie w paint
// wywala cały styl, czyli mapę bez kafelków.
//
//   npm run check:map-colors

import { latest, validateStyleMin } from '@maplibre/maplibre-gl-style-spec';
import { buildMapStyle } from '../src/map/mapStyle';
import {
  getLineColors,
  mapLineColor,
  TRANSIT_PALETTE,
  TRAIN_BADGE_BG,
  CABLE_BADGE_BG,
  TROLLEY_BADGE_BG,
  SUBWAY_BADGE_BG,
  SUBWAY_BADGE_FALLBACK_BG,
} from '../src/services/lineIdentity';

const MAP_BG = '#101413';
const MIN_RATIO = 4.5;

function luminance(hex: string): number {
  const clean = hex.replace('#', '');
  const linear = [0, 2, 4].map((i) => {
    const c = parseInt(clean.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
}

function contrastOnMap(hex: string): number {
  const a = luminance(hex);
  const b = luminance(MAP_BG);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

let failures = 0;
function check(label: string, cond: boolean, detail = '') {
  console.log(`  ${cond ? 'PASS' : 'FAIL'} ${label}${detail ? `: ${detail}` : ''}`);
  if (!cond) failures++;
}

console.log('=== Kolory trasy na ciemnej mapie ===');

// 1. Każdy kolor palety po korekcie jest czytelny na tle mapy.
{
  const bad = TRANSIT_PALETTE.filter((c) => contrastOnMap(mapLineColor(c)) < MIN_RATIO);
  check('cała paleta czytelna na mapie', bad.length === 0, bad.join(', ') || 'wszystkie >= 4.5:1');
}

// 2. Stałe kolory trybów (pociąg, kolejka, trolejbus, metro) też.
{
  const fixed = [
    TRAIN_BADGE_BG,
    CABLE_BADGE_BG,
    TROLLEY_BADGE_BG,
    SUBWAY_BADGE_FALLBACK_BG,
    ...Object.values(SUBWAY_BADGE_BG),
  ];
  const bad = fixed.filter((c) => contrastOnMap(mapLineColor(c)) < MIN_RATIO);
  check('stałe kolory trybów czytelne', bad.length === 0, bad.join(', ') || 'wszystkie >= 4.5:1');
}

// 3. Regression test zgłoszenia: ciemny kolor (np. dawny brąz #5D4037 z feedu zewnętrznego)
// jest automatycznie rozjaśniany pod ciemną mapę, a nowa paleta M3 dla linii 19
// jest czytelna od razu.
{
  const oldDark = '#5D4037';
  const fixed = mapLineColor(oldDark);
  check('ciemny kolor trasy rozjaśniony', fixed !== oldDark, `${oldDark} -> ${fixed}`);
  check('ciemny kolor trasy po rozjaśnieniu czytelny', contrastOnMap(fixed) >= MIN_RATIO, `${contrastOnMap(fixed).toFixed(2)}:1`);

  const { bg } = getLineColors('19', 'tram');
  check('tramwaj 19 z palety M3 czytelny', contrastOnMap(bg) >= MIN_RATIO, `${contrastOnMap(bg).toFixed(2)}:1`);
}

// 4. Jasne kolory zostają bez zmian, więc tożsamość linii się nie rozjeżdża.
{
  check('bursztyn pociągu bez zmian', mapLineColor(TRAIN_BADGE_BG) === TRAIN_BADGE_BG);
  check('błękit kolejki bez zmian', mapLineColor(CABLE_BADGE_BG) === CABLE_BADGE_BG);
  check('spacer bez zmian', mapLineColor('#BFC9C5') === '#BFC9C5');
}

// 5. Wejście niebędące HEX-em wraca nietknięte.
{
  check('nieprawidłowy kolor bez zmian', mapLineColor('red') === 'red');
}

// 6. Cały styl mapy przechodzi walidację MapLibre. Niepoprawne wyrażenie
// (np. `zoom` użyty poza interpolate) wywala cały styl, czyli mapę bez kafelków.
{
  const style = buildMapStyle(null, { poi: true });
  const errors = validateStyleMin(style as never, latest);
  check(
    'styl mapy poprawny wg MapLibre',
    errors.length === 0,
    errors.map((e) => e.message).join('; ') || '0 błędów',
  );
}

console.log(`\n${failures === 0 ? 'OK: kolory mapy czytelne' : `BLEDY: ${failures}`}`);
process.exit(failures === 0 ? 0 : 1);
