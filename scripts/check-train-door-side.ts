import assert from 'node:assert/strict';
import {
  BOTH_SIDES_BEARING,
  computeApproachBearing,
  normalizePlatformKey,
  normalizeTrackKey,
  pickPlatformBearing,
  resolveDoorSide,
} from '../src/services/trainDoorSide';
import { buildTrainTrack } from '../src/services/trainTrack';
import type { LegStop } from '../src/types/models';
import {
  computeStationPlatformSides,
  extractPlatformRef,
} from '../cloudflare/scripts/build-platform-sides.mjs';

let passed = 0;
function check(name: string, fn: () => void) {
  fn();
  passed++;
}

// 1. Normalizacja numerów peronów i torów
check('normalizePlatformKey: rzymskie i prefiksy', () => {
  assert.equal(normalizePlatformKey('Peron III'), '3');
  assert.equal(normalizePlatformKey('IIa'), '2a');
  assert.equal(normalizePlatformKey('02'), '2');
  assert.equal(normalizePlatformKey('IV'), '4');
  assert.equal(normalizePlatformKey('per. 1b'), '1b');
  assert.equal(normalizePlatformKey(''), '');
});

check('normalizeTrackKey: polskie oznaczenia torów', () => {
  assert.equal(normalizeTrackKey('tor 04'), '4');
  assert.equal(normalizeTrackKey('4ŚR'), '4śr');
  assert.equal(normalizeTrackKey('11p'), '11p');
  assert.equal(normalizeTrackKey('track 12'), '12');
  assert.equal(normalizeTrackKey(null), '');
});

// 2. Priorytet dopasowania kluczy: tor > peron > domyślny stacji
check('pickPlatformBearing: priorytet t: > p: > *', () => {
  const entries = { 't:5': 194, 'p:1': 11, '*': 90 };
  assert.equal(pickPlatformBearing(entries, 'Peron I', '5'), 194);
  assert.equal(pickPlatformBearing(entries, 'Peron I', '99'), 11);
  assert.equal(pickPlatformBearing(entries, 'Peron III', null), 90);
  assert.equal(pickPlatformBearing({ 't:3śr': BOTH_SIDES_BEARING }, '1', '3ŚR'), BOTH_SIDES_BEARING);
  assert.equal(pickPlatformBearing(null, '1', '1'), null);
});

// 3. Kierunek wjazdu i klasyfikacja strony drzwi we wszystkich 4 ćwiartkach
check('resolveDoorSide: 4 kierunki świata', () => {
  // Jazda na północ (0°): wschód (90°) po prawej, zachód (270°) po lewej
  assert.equal(resolveDoorSide({ bearing: 0, exact: true }, 90), 'right');
  assert.equal(resolveDoorSide({ bearing: 0, exact: true }, 270), 'left');
  // Jazda na wschód (90°): południe (180°) po prawej, północ (0°) po lewej
  assert.equal(resolveDoorSide({ bearing: 90, exact: true }, 180), 'right');
  assert.equal(resolveDoorSide({ bearing: 90, exact: true }, 0), 'left');
  // Jazda na południe (180°): zachód (270°) po prawej, wschód (90°) po lewej
  assert.equal(resolveDoorSide({ bearing: 180, exact: true }, 270), 'right');
  assert.equal(resolveDoorSide({ bearing: 180, exact: true }, 90), 'left');
  // Jazda na zachód (270°): północ (0°) po prawej, południe (180°) po lewej
  assert.equal(resolveDoorSide({ bearing: 270, exact: true }, 0), 'right');
  assert.equal(resolveDoorSide({ bearing: 270, exact: true }, 180), 'left');
});

check('resolveDoorSide: perony po obu stronach i odrzucanie niejednoznacznych kątów', () => {
  assert.equal(resolveDoorSide({ bearing: 90, exact: true }, BOTH_SIDES_BEARING), null);
  // Równoległy lub przeciwny kąt -> nie zgadujemy
  assert.equal(resolveDoorSide({ bearing: 90, exact: true }, 95), null);
  assert.equal(resolveDoorSide({ bearing: 90, exact: true }, 265), null);
  // Fallback bez shape'u ma ostrzejszą tolerancję (±25° od prostopadłej)
  assert.equal(resolveDoorSide({ bearing: 90, exact: false }, 140), null);
  assert.equal(resolveDoorSide({ bearing: 90, exact: false }, 175), 'right');
  assert.equal(resolveDoorSide({ bearing: 90, exact: true }, 140), 'right');
});

// 4. Wyznaczanie kierunku wjazdu z zakotwiczonego TrainTrack (łuk przed stacją!)
check('computeApproachBearing: łuk przed prostym peronem (Wrocław Główny)', () => {
  // Pociąg jedzie z południa na północ, ale ostatnie 250 m przed stacją skręca na wschód (90°)
  const lat0 = 51.0989;
  const lon0 = 17.0365;
  const shape = [
    { lat: lat0 - 0.01, lon: lon0 - 0.004 },
    { lat: lat0, lon: lon0 - 0.004 }, // ~280 m na zachód od stacji
    { lat: lat0, lon: lon0 - 0.002 },
    { lat: lat0, lon: lon0 }, // stacja docelowa
  ];
  const stops: LegStop[] = [
    { stopId: 'pl:1', seq: 0, name: 'Start', lat: shape[0].lat, lon: shape[0].lon },
    { stopId: 'pl:2', seq: 1, name: 'Wrocław Główny', lat: lat0, lon: lon0, platform: '1', track: '1' },
  ];
  const track = buildTrainTrack(shape, stops, { start: 0, end: 1 });
  const approach = computeApproachBearing(track, stops, { start: 0, end: 1 });
  assert.ok(approach);
  assert.equal(approach.exact, true);
  assert.ok(Math.abs(approach.bearing - 90) < 2, `oczekiwano ~90°, otrzymano ${approach.bearing}`);
  // Tor 1 ma peron 1 na południe (~191°) -> jadąc na wschód drzwi po prawej
  assert.equal(resolveDoorSide(approach, 191), 'right');
});

check('computeApproachBearing: ostrożny fallback bez TrainTrack', () => {
  const stopsShort: LegStop[] = [
    { stopId: 'pl:1', seq: 0, name: 'A', lat: 51.1, lon: 17.0 },
    { stopId: 'pl:2', seq: 1, name: 'B', lat: 51.1, lon: 17.01 }, // ~700 m na wschód
  ];
  const fallback = computeApproachBearing(null, stopsShort, { start: 0, end: 1 });
  assert.ok(fallback);
  assert.equal(fallback.exact, false);
  assert.ok(Math.abs(fallback.bearing - 90) < 2);

  // Dystans > 2.5 km bez shape'u -> null (nie zgadujemy po cięciwie między dalekimi stacjami)
  const stopsFar: LegStop[] = [
    { stopId: 'pl:1', seq: 0, name: 'A', lat: 51.1, lon: 17.0 },
    { stopId: 'pl:2', seq: 1, name: 'B', lat: 51.1, lon: 17.15 },
  ];
  assert.equal(computeApproachBearing(null, stopsFar, { start: 0, end: 1 }), null);
});

// 5. Ekstrakcja numeru peronu z OSM
check('extractPlatformRef: rozróżnia peron od krawędzi i listy torów', () => {
  assert.equal(extractPlatformRef({ railway: 'platform', name: 'peron 3', ref: '5;6' }), '3');
  assert.equal(extractPlatformRef({ railway: 'platform', name: 'Peron II' }), '2');
  assert.equal(extractPlatformRef({ railway: 'platform', local_ref: '1' }), '1');
  assert.equal(extractPlatformRef({ railway: 'platform', ref: '5;6' }), '');
  assert.equal(extractPlatformRef({ railway: 'platform_edge', ref: '1' }), '');
});

// 6. Budowanie azymutów OSM: peron wyspowy, boczny, rozwiązanie hiszpańskie i filtracja tramwaju
const LAT0 = 51.1;
const LON0 = 17.0;
const M_LAT = 1 / 110574;
const M_LON = 1 / (111320 * Math.cos((LAT0 * Math.PI) / 180));
const pt = (xM: number, yM: number) => ({ lat: LAT0 + yM * M_LAT, lon: LON0 + xM * M_LON });

check('computeStationPlatformSides: peron wyspowy (tory po obu stronach)', () => {
  const stations = [{ stopId: '100', name: 'Wyspa', lat: LAT0, lon: LON0 }];
  const elements = [
    // Peron wyspowy wzdłuż osi W-E (y = -3..+3 m)
    {
      type: 'way',
      tags: { railway: 'platform', name: 'peron 1', ref: '1;2' },
      geometry: [pt(-80, -3), pt(80, -3), pt(80, 3), pt(-80, 3), pt(-80, -3)],
    },
    // Tor 1 na północ od peronu (y = +5 m) -> peron na południe (180°)
    {
      type: 'way',
      tags: { railway: 'rail', 'railway:track_ref': '1' },
      geometry: [pt(-80, 5), pt(80, 5)],
    },
    // Tor 2 na południe od peronu (y = -5 m) -> peron na północ (0°)
    {
      type: 'way',
      tags: { railway: 'rail', 'railway:track_ref': '2' },
      geometry: [pt(-80, -5), pt(80, -5)],
    },
  ];
  const res = computeStationPlatformSides(stations, elements) as Record<
    string,
    Record<string, number>
  >;
  assert.ok(res['100']);
  assert.equal(res['100']['t:1'], 180);
  assert.equal(res['100']['t:2'], 0);
  // Peron wyspowy bez numeru toru jest niejednoznaczny -> nie może mieć wpisu p:1 ani *
  assert.equal(res['100']['p:1'], undefined);
  assert.equal(res['100']['*'], undefined);
});

check('computeStationPlatformSides: przystanek z 1 torem i peronem bocznym', () => {
  const stations = [{ stopId: '101', name: 'Przystanek', lat: LAT0, lon: LON0 }];
  const elements = [
    {
      type: 'way',
      tags: { railway: 'platform', name: 'Peron 1' },
      geometry: [pt(-60, 2), pt(60, 2), pt(60, 5), pt(-60, 5), pt(-60, 2)],
    },
    {
      type: 'way',
      tags: { railway: 'rail' },
      geometry: [pt(-80, 0), pt(80, 0)],
    },
  ];
  const res = computeStationPlatformSides(stations, elements) as Record<
    string,
    Record<string, number>
  >;
  assert.deepEqual(res['101'], { 'p:1': 0, '*': 0 });
});

check('computeStationPlatformSides: rozwiązanie hiszpańskie i ignorowanie tramwaju nad tunelem', () => {
  const stations = [{ stopId: '102', name: 'Śródmieście', lat: LAT0, lon: LON0 }];
  const elements = [
    // Tor w tunelu (layer=-1) z peronami po obu stronach (y = +2 m i y = -2 m)
    {
      type: 'way',
      tags: { railway: 'rail', 'railway:track_ref': '3ŚR', layer: '-1' },
      geometry: [pt(-70, 0), pt(70, 0)],
    },
    {
      type: 'way',
      tags: { railway: 'platform', layer: '-1' },
      geometry: [pt(-70, 2), pt(70, 2)],
    },
    {
      type: 'way',
      tags: { railway: 'platform', layer: '-1' },
      geometry: [pt(-70, -2), pt(70, -2)],
    },
    // Peron tramwajowy na powierzchni: musi zostać zignorowany
    {
      type: 'way',
      tags: { railway: 'platform', tram: 'yes', name: 'Centrum 10', layer: '0' },
      geometry: [pt(-40, 1), pt(40, 1)],
    },
  ];
  const res = computeStationPlatformSides(stations, elements) as Record<
    string,
    Record<string, number>
  >;
  assert.equal(res['102']?.['t:3śr'], BOTH_SIDES_BEARING);
  assert.equal(res['102']?.['*'], undefined);
});

console.log(`check-train-door-side: ${passed}/${passed} PASS`);
