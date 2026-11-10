import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveStopHint } from '../src/services/stopHints';
import { isTrainLeg } from '../src/services/railIdentity';
import { suggestCityForCoords } from '../src/cities';
import { STOP_HINTS_WROCLAW } from '../src/data/stopHintsWroclaw';
import { STOP_HINTS_POZNAN } from '../src/data/stopHintsPoznan';
import { STOP_HINTS_WARSZAWA } from '../src/data/stopHintsWarszawa';
import { STOP_HINTS_KRAKOW } from '../src/data/stopHintsKrakow';
import { STOP_HINTS_GZM } from '../src/data/stopHintsGzm';
import type { StopHintsDataset } from '../src/types/stopHints';

test('resolveStopHint: Wroclaw direct stopId and stopCode matching', () => {
  // Przystanek Rondo Reagana / Dworzec Główny
  const hintById = resolveStopHint(STOP_HINTS_WROCLAW, undefined, '10101', 'Dworzec Główny', 'tram');
  assert.ok(hintById);
  assert.match(hintById, /Peron 1/i);

  const hintByCode = resolveStopHint(STOP_HINTS_WROCLAW, '20820', undefined, 'Rondo Reagana', 'bus');
  assert.ok(hintByCode);
  assert.match(hintByCode, /Ronda Reagana/i);
});

test('resolveStopHint: Poznan slugified stopName + stopCode matching and geohash handling for transit', () => {
  // Most Dworcowy / Poznań Główny peron 73 (tramwaj)
  const hint73 = resolveStopHint(STOP_HINTS_POZNAN, '73', 'poznan-glowny73', 'Poznań Główny', 'tram');
  assert.ok(hint73);
  assert.match(hint73, /Moście Dworcowym/i);

  // Plac Dworcowy / Poznań Główny słupek 01 z kodem '1' (dopełnienie zerem, autobus)
  const hint01 = resolveStopHint(STOP_HINTS_POZNAN, '1', 'poznan-glowny01', 'Poznań Główny', 'bus');
  assert.ok(hint01);
  assert.match(hint01, /placu Dworcowym/i);

  // Dworzec Zachodni peron 71
  const hintZachodni = resolveStopHint(STOP_HINTS_POZNAN, '71', undefined, 'Dworzec Zachodni', 'tram');
  assert.ok(hintZachodni);
  assert.match(hintZachodni, /Głogowskiej/i);

  // PST Poznań Główny 41
  const hintPst = resolveStopHint(STOP_HINTS_POZNAN, '41', undefined, 'Poznań Główny', 'tram');
  assert.ok(hintPst);
  assert.match(hintPst, /PST/i);
});

test('resolveStopHint: returns null for train mode and PKP rail stations', () => {
  // 1. Z feedu krajowego z prefiksem pl: lub stop-pl:
  const railHintPl = resolveStopHint(STOP_HINTS_POZNAN, '73', 'pl:5100028', 'Poznań Główny');
  assert.equal(railHintPl, null, 'Stacje PKP z id pl: nie powinny zwracać wskazówek miejskich');

  const railHintStopPl = resolveStopHint(STOP_HINTS_POZNAN, '1', 'stop-pl:5100028', 'Poznań Główny');
  assert.equal(railHintStopPl, null, 'Stacje PKP z id stop-pl: nie powinny zwracać wskazówek miejskich');

  // 2. Połączenia kolejowe (mode === "train")
  const trainWroclawHint = resolveStopHint(
    STOP_HINTS_WROCLAW,
    '1',
    '10101',
    'Dworzec Główny',
    'train',
  );
  assert.equal(trainWroclawHint, null, 'Połączenia pociągowe we Wrocławiu nie powinny mieć wskazówek');

  const trainPoznanHint = resolveStopHint(
    STOP_HINTS_POZNAN,
    '73',
    'poznan-glowny73',
    'Poznań Główny',
    'train',
  );
  assert.equal(trainPoznanHint, null, 'Pociąg z Poznania Głównego nie powinien mieć wskazówek');

  const trainKrkHint = resolveStopHint(
    STOP_HINTS_KRAKOW,
    '901-01',
    'stop_322_117319',
    'Kraków Główny',
    'train',
  );
  assert.equal(trainKrkHint, null, 'Pociąg z Krakowa Głównego nie powinien mieć wskazówek');
});

test('isTrainLeg correctly identifies train legs', () => {
  assert.equal(isTrainLeg({ mode: 'train' }), true);
  assert.equal(isTrainLeg({ mode: 'train', fromStopId: 'pl:5100028' }), true);
  assert.equal(isTrainLeg({ mode: 'bus', fromStopId: 'pl:5100028' }), true);
  assert.equal(isTrainLeg({ mode: 'bus', tripId: 'pl:trip_123' }), true);
  assert.equal(isTrainLeg({ mode: 'tram', fromStopId: '10101' }), false);
  assert.equal(isTrainLeg({ mode: 'bus', fromStopId: '20820' }), false);
});

test('resolveStopHint: Cluster fallback for major municipal transfer hubs', () => {
  const dummyDatasetWithClusters: StopHintsDataset = {
    schemaVersion: 1,
    city: 'test',
    generatedAt: '2026-11-01T00:00:00Z',
    stops: {},
    clusters: {
      pl_grunwaldzki: 'Wyspa centralna z peronami 1–4 w środku ronda (zejście podziemne).',
      poznan_glowny:
        'Główny węzeł: wejście na dworzec PKP od strony placu Dworcowego i galerii Avenida.',
    },
  };

  assert.equal(
    resolveStopHint(dummyDatasetWithClusters, undefined, undefined, 'Pl. Grunwaldzki', 'tram'),
    'Wyspa centralna z peronami 1–4 w środku ronda (zejście podziemne).',
  );
  assert.equal(
    resolveStopHint(dummyDatasetWithClusters, undefined, undefined, 'Poznań Główny', 'tram'),
    'Główny węzeł: wejście na dworzec PKP od strony placu Dworcowego i galerii Avenida.',
  );
  // Ale dla pociągu (train) cluster fallback NIE może się wywołać:
  assert.equal(
    resolveStopHint(dummyDatasetWithClusters, undefined, undefined, 'Poznań Główny', 'train'),
    null,
  );
});

test('resolveStopHint: Krakow and Warszawa matching for municipal transit', () => {
  const hintKrk = resolveStopHint(
    STOP_HINTS_KRAKOW,
    '901-01',
    'stop_322_117319',
    'Dworzec Główny Tunel',
    'tram',
  );
  assert.ok(hintKrk);
  assert.match(hintKrk, /tunelu pod Dworcem Głównym/i);

  const hintWaw = resolveStopHint(STOP_HINTS_WARSZAWA, '10', '700101', 'Centrum', 'tram');
  assert.ok(hintWaw);
  assert.match(hintWaw, /Marszałkowskiej/i);
});

test('resolveStopHint: GZM station matching for municipal transit', () => {
  const hintGzm = resolveStopHint(STOP_HINTS_GZM, '2469011-00103', '3220', 'Katowice Dworzec', 'bus');
  assert.ok(hintGzm);
  assert.match(hintGzm, /Katowicką/i);
});

test('Multi-transfer rail & transit journey differentiates train legs from transit legs', () => {
  const cityDatasets: Record<string, StopHintsDataset> = {
    wroclaw: STOP_HINTS_WROCLAW,
    poznan: STOP_HINTS_POZNAN,
    warszawa: STOP_HINTS_WARSZAWA,
    krakow: STOP_HINTS_KRAKOW,
    gzm: STOP_HINTS_GZM,
  };

  // Trasa wieloetapowa:
  // 1. Wrocław: Tramwaj na Dworzec Główny -> ma wskazówkę
  // 2. PKP: Pociąg Wrocław Główny -> Poznań Główny -> BRAK wskazówki (null)
  // 3. Poznań: Tramwaj z Mostu Dworcowego (Poznań Główny 73) -> ma wskazówkę
  // 4. PKP: Pociąg Poznań Główny -> Kraków Główny -> BRAK wskazówki (null)
  // 5. Kraków: Tramwaj KST pod dworcem (Dworzec Główny Tunel) -> ma wskazówkę
  const journeyLegs = [
    {
      mode: 'tram' as const,
      fromStop: 'Rondo Reagana',
      fromStopId: '20820',
      platformCode: '20820',
      fromLat: 51.1118,
      fromLon: 17.0601,
      expectedHint: true,
    },
    {
      mode: 'train' as const,
      fromStop: 'Wrocław Główny',
      fromStopId: 'pl:5100069',
      platformCode: '4',
      fromLat: 51.0989,
      fromLon: 17.0366,
      expectedHint: false,
    },
    {
      mode: 'tram' as const,
      fromStop: 'Poznań Główny',
      fromStopId: 'poznan-glowny73',
      platformCode: '73',
      fromLat: 52.4026,
      fromLon: 16.9126,
      expectedHint: true,
    },
    {
      mode: 'train' as const,
      fromStop: 'Poznań Główny',
      fromStopId: 'pl:5100028',
      platformCode: '1',
      fromLat: 52.4026,
      fromLon: 16.9126,
      expectedHint: false,
    },
    {
      mode: 'tram' as const,
      fromStop: 'Dworzec Główny Tunel',
      fromStopId: 'stop_322_117319',
      platformCode: '901-01',
      fromLat: 50.0686,
      fromLon: 19.948,
      expectedHint: true,
    },
  ];

  for (const leg of journeyLegs) {
    const isTrain = isTrainLeg(leg);
    if (leg.expectedHint) {
      assert.equal(isTrain, false);
      const matchedCity = suggestCityForCoords(leg.fromLat, leg.fromLon);
      assert.ok(matchedCity, `Nie znaleziono miasta dla ${leg.fromStop}`);
      const dataset = cityDatasets[matchedCity.id];
      assert.ok(dataset, `Brak bazy dla miasta ${matchedCity.id}`);

      const hint = resolveStopHint(dataset, leg.platformCode, leg.fromStopId, leg.fromStop, leg.mode);
      assert.ok(hint, `Wskazówka powinna zostać znaleziona dla ${leg.fromStop} (${leg.mode})`);
    } else {
      assert.equal(isTrain, true);
      // Dla połączeń kolejowych wskazówka musi być null niezależnie od bazy miejskiej
      const matchedCity = suggestCityForCoords(leg.fromLat, leg.fromLon);
      const dataset = matchedCity ? cityDatasets[matchedCity.id] : null;
      const hint = resolveStopHint(dataset, leg.platformCode, leg.fromStopId, leg.fromStop, leg.mode);
      assert.equal(hint, null, `Wskazówka NIE powinna być pokazywana dla pociągu ${leg.fromStop}`);
    }
  }
});
