import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveStopHint } from '../src/services/stopHints';
import { suggestCityForCoords } from '../src/cities';
import { STOP_HINTS_WROCLAW } from '../src/data/stopHintsWroclaw';
import { STOP_HINTS_POZNAN } from '../src/data/stopHintsPoznan';
import { STOP_HINTS_WARSZAWA } from '../src/data/stopHintsWarszawa';
import { STOP_HINTS_KRAKOW } from '../src/data/stopHintsKrakow';
import { STOP_HINTS_GZM } from '../src/data/stopHintsGzm';
import type { StopHintsDataset } from '../src/types/stopHints';

test('resolveStopHint: Wroclaw direct stopId and stopCode matching', () => {
  // Przystanek Rondo Reagana / Dworzec Główny
  const hintById = resolveStopHint(STOP_HINTS_WROCLAW, undefined, '10101', 'Dworzec Główny');
  assert.ok(hintById);
  assert.match(hintById, /Peron 1/i);

  const hintByCode = resolveStopHint(STOP_HINTS_WROCLAW, '20820', undefined, 'Rondo Reagana');
  assert.ok(hintByCode);
  assert.match(hintByCode, /Ronda Reagana/i);
});

test('resolveStopHint: Poznan slugified stopName + stopCode matching and geohash handling', () => {
  // Most Dworcowy / Poznań Główny peron 73
  const hint73 = resolveStopHint(STOP_HINTS_POZNAN, '73', 'pl:5100028', 'Poznań Główny');
  assert.ok(hint73);
  assert.match(hint73, /Moście Dworcowym/i);

  // Plac Dworcowy / Poznań Główny słupek 01 z kodem '1' (dopełnienie zerem)
  const hint01 = resolveStopHint(STOP_HINTS_POZNAN, '1', 'pl:5100028', 'Poznań Główny');
  assert.ok(hint01);
  assert.match(hint01, /placu Dworcowym/i);

  // Dworzec Zachodni peron 71
  const hintZachodni = resolveStopHint(STOP_HINTS_POZNAN, '71', undefined, 'Dworzec Zachodni');
  assert.ok(hintZachodni);
  assert.match(hintZachodni, /Głogowskiej/i);

  // PST Poznań Główny 41
  const hintPst = resolveStopHint(STOP_HINTS_POZNAN, '41', undefined, 'Poznań Główny');
  assert.ok(hintPst);
  assert.match(hintPst, /PST/i);
});

test('resolveStopHint: Rail stopId stripping (pl: and stop-pl:)', () => {
  const dummyDataset: StopHintsDataset = {
    schemaVersion: 1,
    city: 'test',
    generatedAt: '2026-11-01T00:00:00Z',
    clusters: {},
    stops: {
      '5100028': 'Hala peronowa dworca kolejowego, zejście tunelem wschodnim.',
    },
  };

  assert.equal(
    resolveStopHint(dummyDataset, '1', 'pl:5100028', 'Poznań Główny'),
    'Hala peronowa dworca kolejowego, zejście tunelem wschodnim.',
  );
  assert.equal(
    resolveStopHint(dummyDataset, '1', 'stop-pl:5100028', 'Poznań Główny'),
    'Hala peronowa dworca kolejowego, zejście tunelem wschodnim.',
  );
});

test('resolveStopHint: Cluster fallback for major transfer hubs', () => {
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
    resolveStopHint(dummyDatasetWithClusters, undefined, undefined, 'Pl. Grunwaldzki'),
    'Wyspa centralna z peronami 1–4 w środku ronda (zejście podziemne).',
  );
  assert.equal(
    resolveStopHint(dummyDatasetWithClusters, undefined, undefined, 'Poznań Główny'),
    'Główny węzeł: wejście na dworzec PKP od strony placu Dworcowego i galerii Avenida.',
  );
});

test('resolveStopHint: Krakow and Warszawa matching', () => {
  const hintKrk = resolveStopHint(
    STOP_HINTS_KRAKOW,
    '901-01',
    'stop_322_117319',
    'Dworzec Główny Tunel',
  );
  assert.ok(hintKrk);
  assert.match(hintKrk, /tunelu pod Dworcem Głównym/i);

  const hintWaw = resolveStopHint(STOP_HINTS_WARSZAWA, '10', '700101', 'Centrum');
  assert.ok(hintWaw);
  assert.match(hintWaw, /Marszałkowskiej/i);
});

test('resolveStopHint: GZM station matching', () => {
  const hintGzm = resolveStopHint(STOP_HINTS_GZM, '2469011-00103', '3220', 'Katowice Dworzec');
  assert.ok(hintGzm);
  assert.match(hintGzm, /Katowicką/i);
});

test('Multi-transfer rail & transit journey across cities resolves stop hints for all transfers', () => {
  const cityDatasets: Record<string, StopHintsDataset> = {
    wroclaw: STOP_HINTS_WROCLAW,
    poznan: STOP_HINTS_POZNAN,
    warszawa: STOP_HINTS_WARSZAWA,
    krakow: STOP_HINTS_KRAKOW,
    gzm: STOP_HINTS_GZM,
  };

  // Trasa wieloetapowa z przesiadkami między miastami:
  // Leg 1: Wrocław (tramwaj na Dworzec Główny)
  // Leg 2: Pociąg do Poznania
  // Leg 3: Poznań (tramwaj na Moście Dworcowym, słupek 73)
  // Leg 4: Kraków (tramwaj KST pod dworcem, słupek 901-01)
  const journeyLegs = [
    {
      fromStop: 'Rondo Reagana',
      fromStopId: '20820',
      platformCode: '20820',
      fromLat: 51.1118,
      fromLon: 17.0601,
    },
    {
      fromStop: 'Poznań Główny',
      fromStopId: 'poznan-glowny73',
      platformCode: '73',
      fromLat: 52.4026,
      fromLon: 16.9126,
    },
    {
      fromStop: 'Dworzec Główny Tunel',
      fromStopId: 'stop_322_117319',
      platformCode: '901-01',
      fromLat: 50.0686,
      fromLon: 19.948,
    },
  ];

  for (const leg of journeyLegs) {
    const matchedCity = suggestCityForCoords(leg.fromLat, leg.fromLon);
    assert.ok(
      matchedCity,
      `Nie znaleziono miasta dla współrzędnych ${leg.fromLat}, ${leg.fromLon}`,
    );
    const dataset = cityDatasets[matchedCity.id];
    assert.ok(dataset, `Brak bazy dla miasta ${matchedCity.id}`);

    const hint = resolveStopHint(dataset, leg.platformCode, leg.fromStopId, leg.fromStop);
    assert.ok(
      hint,
      `Wskazówka powinna zostać znaleziona dla ${leg.fromStop} w ${matchedCity.name}`,
    );
  }
});
