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

test('resolveStopHint: prevents bare 2-digit stop_code collisions (Dolna 02 / Pl. Na Rozdrożu 06 regression)', () => {
  // 1. Zgłoszony przez użytkownika przypadek: Dolna słupek 02 (stop_id 302702, Mokotów)
  const dolna02 = resolveStopHint(STOP_HINTS_WARSZAWA, '02', '302702', 'Dolna', 'bus');
  assert.ok(dolna02);
  assert.match(dolna02, /Sobieskiego/i);
  assert.doesNotMatch(dolna02, /Andersa|Skwer Sportów/i);

  // 2. Zgłoszony przez użytkownika przypadek: Pl. Na Rozdrożu słupek 06 (stop_id 703706)
  const rozdroze06 = resolveStopHint(STOP_HINTS_WARSZAWA, '06', '703706', 'Pl. Na Rozdrożu', 'bus');
  assert.ok(rozdroze06);
  assert.match(rozdroze06, /Armii Ludowej|Trasy Łazienkowskiej/i);
  assert.doesNotMatch(rozdroze06, /Solidarności|Starbucks/i);

  // 3. Nieznany słupek 02 lub 06 w Warszawie NIE może trafić w opis z innej dzielnicy
  assert.equal(resolveStopHint(STOP_HINTS_WARSZAWA, '02', '999902', 'Nieistniejący', 'bus'), null);
  assert.equal(resolveStopHint(STOP_HINTS_WARSZAWA, '06', '999906', 'Nieistniejący', 'bus'), null);

  // 4. Nawet gdyby zdalny/stary dataset miał gołe klucze "02" lub "06", resolver musi je odrzucić
  const poisonedDataset: StopHintsDataset = {
    schemaVersion: 1,
    city: 'warszawa',
    generatedAt: '2026-01-01T00:00:00Z',
    stops: {
      '02': 'Zatoka autobusowa na ul. Andersa po stronie parku „Skwer Sportów Miejskich”.',
      '06': 'Zatoka autobusowa przy al. „Solidarności” obok kawiarni „Starbucks”.',
    },
    clusters: {},
  };
  assert.equal(resolveStopHint(poisonedDataset, '02', '302702', 'Dolna', 'bus'), null);
  assert.equal(resolveStopHint(poisonedDataset, '06', '703706', 'Pl. Na Rozdrożu', 'bus'), null);
});

test('resolveStopHint: Wroclaw real GTFS stop_code matching (Dworzec Główny & Pl. Grunwaldzki)', () => {
  const dworzecTram = resolveStopHint(STOP_HINTS_WROCLAW, '10268', '10268', 'DWORZEC GŁÓWNY', 'tram');
  assert.ok(dworzecTram);
  assert.match(dworzecTram, /Piłsudskiego|Dworca Głównego/i);

  const reaganBus = resolveStopHint(STOP_HINTS_WROCLAW, '20820', undefined, 'PL. GRUNWALDZKI', 'tram');
  assert.ok(reaganBus);
  assert.match(reaganBus, /Ronda Reagana/i);

  const reaganBus6Digit = resolveStopHint(STOP_HINTS_WROCLAW, '120820', undefined, 'PL. GRUNWALDZKI', 'bus');
  assert.ok(reaganBus6Digit);
  assert.match(reaganBus6Digit, /Ronda Reagana/i);
});

test('resolveStopHint: Poznan slugified stopName + stopCode matching and geohash handling', () => {
  // Poznań Główny 73 (ul. Matyi / Avenida) z i bez geohasha
  const hint73 = resolveStopHint(STOP_HINTS_POZNAN, '73', 'poznan-glowny73-wqjhw', 'Poznań Główny', 'tram');
  assert.ok(hint73);
  assert.match(hint73, /Matyi|Avenida/i);

  // Dopasowanie z nazwy kończącej się 2-cyfrowym słupkiem bez stopId
  const hint73ByName = resolveStopHint(STOP_HINTS_POZNAN, undefined, undefined, 'Poznań Główny 73', 'tram');
  assert.equal(hint73ByName, hint73);

  // Plac Dworcowy / Poznań Główny 01
  const hint01 = resolveStopHint(STOP_HINTS_POZNAN, '1', 'poznan-glowny01-abcde', 'Poznań Główny', 'bus');
  assert.ok(hint01);
  assert.match(hint01, /Dworcowej|Dworca/i);

  // Dworzec Zachodni peron 71
  const hintZachodni = resolveStopHint(STOP_HINTS_POZNAN, '71', undefined, 'Dworzec Zachodni', 'tram');
  assert.ok(hintZachodni);
  assert.match(hintZachodni, /Głogowskiej/i);

  // Poznań Główny 41 (Avenida / PKP) oraz PST na Rondzie Kaponiera 45
  const hint41 = resolveStopHint(STOP_HINTS_POZNAN, '41', undefined, 'Poznań Główny', 'tram');
  assert.ok(hint41);
  assert.match(hint41, /Avenida/i);

  const hintPst = resolveStopHint(STOP_HINTS_POZNAN, '45', undefined, 'Rondo Kaponiera', 'tram');
  assert.ok(hintPst);
  assert.match(hintPst, /PST/i);
});

test('resolveStopHint: returns null for train/subway modes and PKP rail stations', () => {
  assert.equal(
    resolveStopHint(STOP_HINTS_POZNAN, '73', 'pl:5100028', 'Poznań Główny'),
    null,
    'Stacje PKP z id pl: nie powinny zwracać wskazówek miejskich',
  );
  assert.equal(
    resolveStopHint(STOP_HINTS_POZNAN, '1', 'stop-pl:5100028', 'Poznań Główny'),
    null,
  );
  assert.equal(
    resolveStopHint(STOP_HINTS_WROCLAW, '10268', '10268', 'Dworzec Główny', 'train'),
    null,
  );
  assert.equal(
    resolveStopHint(STOP_HINTS_POZNAN, '73', 'poznan-glowny73', 'Poznań Główny', 'train'),
    null,
  );
  assert.equal(
    resolveStopHint(STOP_HINTS_KRAKOW, '901-01', 'stop_322_117319', 'Kraków Główny', 'train'),
    null,
  );
  assert.equal(
    resolveStopHint(STOP_HINTS_WARSZAWA, 'C15', '1003M:P2', 'Dworzec Wileński', 'subway'),
    null,
  );
});

test('isTrainLeg correctly identifies train legs', () => {
  assert.equal(isTrainLeg({ mode: 'train' }), true);
  assert.equal(isTrainLeg({ mode: 'train', fromStopId: 'pl:5100028' }), true);
  assert.equal(isTrainLeg({ mode: 'bus', fromStopId: 'pl:5100028' }), true);
  assert.equal(isTrainLeg({ mode: 'bus', tripId: 'pl:trip_123' }), true);
  assert.equal(isTrainLeg({ mode: 'tram', fromStopId: '10268' }), false);
  assert.equal(isTrainLeg({ mode: 'bus', fromStopId: '20820' }), false);
});

test('resolveStopHint: Cluster fallback for major municipal transfer hubs', () => {
  const dummyDatasetWithClusters: StopHintsDataset = {
    schemaVersion: 2,
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
  assert.equal(
    resolveStopHint(dummyDatasetWithClusters, undefined, undefined, 'Poznań Główny', 'train'),
    null,
  );
});

test('resolveStopHint: Krakow, Warszawa and GZM matching for municipal transit', () => {
  const hintKrk = resolveStopHint(
    STOP_HINTS_KRAKOW,
    '901-01',
    'KRK:T:stop_322_117319',
    'Dworzec Główny Tunel',
    'tram',
  );
  assert.ok(hintKrk);
  assert.match(hintKrk, /tunelu pod Dworcem Głównym/i);

  const hintWaw = resolveStopHint(STOP_HINTS_WARSZAWA, '07', '701307', 'Centrum', 'tram');
  assert.ok(hintWaw);
  assert.match(hintWaw, /Marszałkowskiej/i);

  const hintGzm = resolveStopHint(STOP_HINTS_GZM, '2469011-00103', '3220', 'Katowice Dworzec', 'bus');
  assert.ok(hintGzm);
  assert.match(hintGzm, /Katowicką/i);
});

test('All 5 bundled datasets obey schemaVersion 2, zero collision keys, zero duplicated pole prefix', () => {
  const allDatasets = [
    STOP_HINTS_WARSZAWA,
    STOP_HINTS_WROCLAW,
    STOP_HINTS_KRAKOW,
    STOP_HINTS_POZNAN,
    STOP_HINTS_GZM,
  ];
  for (const ds of allDatasets) {
    const expectedSchema = ds.city === 'warszawa' ? 3 : 2;
    assert.equal(ds.schemaVersion, expectedSchema, `${ds.city}: schemaVersion powinno być ${expectedSchema}`);
    const entries = Object.entries(ds.stops);
    assert.ok(entries.length >= 100, `${ds.city}: powinno mieć >= 100 wskazówek`);
    for (const [key, rawHint] of entries) {
      const hint = typeof rawHint === 'string' ? rawHint : rawHint.hint;
      assert.doesNotMatch(
        key,
        /^\d{1,3}$/,
        `${ds.city}: niedozwolony krótki klucz mogący powodować kolizje: "${key}"`,
      );
      assert.doesNotMatch(
        hint,
        /^Słupek\s+\d+\s*[•·-]/i,
        `${ds.city}[${key}]: wskazówka nie może dublować prefiksu "Słupek XX •"`,
      );
      assert.doesNotMatch(
        hint,
        /budynku usługowego|punktu usługowego|zakładu pogrzebowego|\?”/i,
        `${ds.city}[${key}]: zawiera zakazany slop: "${hint}"`,
      );
    }
  }
});

test('Multi-transfer rail & transit journey differentiates train legs from transit legs', () => {
  const cityDatasets: Record<string, StopHintsDataset> = {
    wroclaw: STOP_HINTS_WROCLAW,
    poznan: STOP_HINTS_POZNAN,
    warszawa: STOP_HINTS_WARSZAWA,
    krakow: STOP_HINTS_KRAKOW,
    gzm: STOP_HINTS_GZM,
  };

  const journeyLegs = [
    {
      mode: 'tram' as const,
      fromStop: 'PL. GRUNWALDZKI',
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
      fromStopId: 'poznan-glowny73-wqjhw',
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
      const matchedCity = suggestCityForCoords(leg.fromLat, leg.fromLon);
      const dataset = matchedCity ? cityDatasets[matchedCity.id] : null;
      const hint = resolveStopHint(dataset, leg.platformCode, leg.fromStopId, leg.fromStop, leg.mode);
      assert.equal(hint, null, `Wskazówka NIE powinna być pokazywana dla pociągu ${leg.fromStop}`);
    }
  }
});

test('Warsaw metroEntrances covers all 253 GTFS entrances with unique per-station descriptions', () => {
  const entrances = STOP_HINTS_WARSZAWA.metroEntrances ?? [];
  assert.equal(entrances.length, 253);
  const byStation = new Map<string, Set<string>>();
  for (const ent of entrances) {
    assert.ok(ent.id.includes(':E'));
    assert.ok(ent.num.length > 0);
    assert.ok(Number.isFinite(ent.lat) && Number.isFinite(ent.lon));
    assert.ok(ent.hint.length >= 12);
    assert.doesNotMatch(ent.hint, /\u2014|przy wejścia do metra|przy centrum handlowego/i);
    let set = byStation.get(ent.stationId);
    if (!set) {
      set = new Set();
      byStation.set(ent.stationId, set);
    }
    assert.equal(set.has(ent.hint), false, `Duplikat opisu na stacji ${ent.stationId}: ${ent.hint}`);
    set.add(ent.hint);
  }
  assert.equal(byStation.size, 38);
  const directHint = resolveStopHint(STOP_HINTS_WARSZAWA, undefined, '1003M:E11', 'Dworzec Wileński', 'walk');
  assert.ok(directHint && directHint.length > 10);
});

test('resolveStopHint: Wroclaw 5/6-digit pole code mapping and GZM case-insensitive suffix', () => {
  // Klucz 110023 istnieje w dataset bez 5-cyfrowego odpowiednika 10023
  const halaTargowa = resolveStopHint(STOP_HINTS_WROCLAW, '10023', '9999', 'Hala Targowa', 'bus');
  assert.ok(halaTargowa);
  assert.match(halaTargowa, /Hali Targowej/i);

  // Odwrotne mapowanie: 6-cyfrowy kod 1xxxxx gdy dataset ma tylko 5-cyfrowy xxxxx
  const domFrom6 = resolveStopHint(STOP_HINTS_WROCLAW, '110022', '9999', 'Pl. Dominikański', 'tram');
  assert.ok(domFrom6);
  assert.match(domFrom6, /Dominikańskiej/i);

  // GZM: wielka litera T w kodzie słupka dopasowana do klucza z małym t
  const gzmUpper = resolveStopHint(STOP_HINTS_GZM, '2401011-02901T', '9999', 'Przystanek', 'tram');
  assert.ok(gzmUpper);
});
