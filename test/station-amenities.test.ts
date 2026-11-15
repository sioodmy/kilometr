import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { DatabaseSync } from 'node:sqlite';

import {
  STATION_AMENITY_ORDER,
  decodeStationAmenities,
  loadStationAmenities,
  resetStationAmenitiesCache,
} from '../src/services/stationAmenities';
import { closeNationalDb } from '../src/services/gtfsDatabase';
import { shouldShowStationAmenities } from '../src/components/stationAmenitiesGate';
import type { Leg } from '../src/types/models';

function makeLeg(overrides: Partial<Leg> = {}): Leg {
  return {
    id: 'leg-1',
    mode: 'train',
    line: 'IC',
    fromStop: 'Poznań Główny',
    toStop: 'Wrocław Główny',
    departAt: '10:00',
    arriveAt: '12:00',
    stopsCount: 4,
    live: false,
    ...overrides,
  };
}

test('decodeStationAmenities decodes bitmask in STATION_AMENITY_ORDER', () => {
  assert.deepEqual(decodeStationAmenities(0), []);
  assert.deepEqual(decodeStationAmenities(1 | (1 << 2) | (1 << 7)), [
    'toilets',
    'shop',
    'luggage',
  ]);
  assert.equal(STATION_AMENITY_ORDER.length, 8);
});

test('loadStationAmenities queries stop_id, stop- prefix, and nearest-station spatial fallback', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'kilometr-sa-'));
  const dbPath = join(dir, 'polska.db');
  const db = new DatabaseSync(dbPath);
  db.exec(`
    CREATE TABLE stops (
      stop_id TEXT PRIMARY KEY NOT NULL,
      code TEXT NOT NULL DEFAULT '',
      name TEXT NOT NULL,
      lat REAL NOT NULL,
      lon REAL NOT NULL,
      norm TEXT NOT NULL,
      weight INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE station_amenities (
      stop_id TEXT PRIMARY KEY NOT NULL,
      bits INTEGER NOT NULL
    );
  `);
  db.prepare(
    'INSERT INTO stops (stop_id, code, name, lat, lon, norm, weight) VALUES (?, ?, ?, ?, ?, ?, ?)',
  ).run('pl:60103', '', 'Wrocław Główny', 51.097918, 17.037434, 'wroclaw glowny', 100);
  db.prepare(
    'INSERT INTO stops (stop_id, code, name, lat, lon, norm, weight) VALUES (?, ?, ?, ?, ?, ?, ?)',
  ).run('pl:99999', '', 'Mała Stacja', 51.15, 17.1, 'mala stacja', 2);
  // toilets (bit 0) + gastronomy (bit 1) + shop (bit 2) = 7
  db.prepare('INSERT INTO station_amenities (stop_id, bits) VALUES (?, ?)').run('pl:60103', 7);
  db.close();

  const prevEnv = process.env.POLSKA_DB;
  process.env.POLSKA_DB = dbPath;
  await closeNationalDb();
  resetStationAmenitiesCache();

  try {
    assert.deepEqual(await loadStationAmenities('pl:60103', 51.097918, 17.037434), [
      'toilets',
      'gastronomy',
      'shop',
    ]);
    assert.deepEqual(await loadStationAmenities('stop-pl:60103', 51.097918, 17.037434), [
      'toilets',
      'gastronomy',
      'shop',
    ]);
    // Kolej miejska (nie-pl stopId) w pobliżu Wrocławia Głównego: trafia przez fallback przestrzenny
    assert.deepEqual(await loadStationAmenities('wro:12345', 51.0981, 17.0375), [
      'toilets',
      'gastronomy',
      'shop',
    ]);
    // Mała stacja w bazie bez udogodnień -> null
    assert.equal(await loadStationAmenities('pl:99999', 51.15, 17.1), null);
    // Punkt daleko od stacji -> null
    assert.equal(await loadStationAmenities('wro:999', 52.0, 19.0), null);
  } finally {
    await closeNationalDb();
    resetStationAmenitiesCache();
    if (prevEnv === undefined) delete process.env.POLSKA_DB;
    else process.env.POLSKA_DB = prevEnv;
    rmSync(dir, { recursive: true, force: true });
  }
});

test('shouldShowStationAmenities gates non-rail legs and <15 min transfers', () => {
  // Nie-pociąg -> nigdy
  assert.equal(
    shouldShowStationAmenities([makeLeg({ mode: 'tram', line: '4' })], 0),
    false,
  );

  // Ostatni odcinek kolejowy (bez przesiadki) -> zawsze
  assert.equal(shouldShowStationAmenities([makeLeg()], 0), true);

  // Pociąg z końcowym dojściem pieszo do celu (to nie przesiadka) -> zawsze
  assert.equal(
    shouldShowStationAmenities(
      [
        makeLeg({ arriveAt: '12:00' }),
        makeLeg({
          id: 'walk-end',
          mode: 'walk',
          line: undefined,
          departAt: '12:00',
          arriveAt: '12:08',
          walkM: 500,
        }),
      ],
      0,
    ),
    true,
  );

  // Przesiadka na inny pociąg: równo 15 minut -> pokazuje
  assert.equal(
    shouldShowStationAmenities(
      [
        makeLeg({ arriveAt: '12:00' }),
        makeLeg({ id: 'leg-2', departAt: '12:15', arriveAt: '13:00' }),
      ],
      0,
    ),
    true,
  );

  // Przesiadka 14 minut -> ukrywa
  assert.equal(
    shouldShowStationAmenities(
      [
        makeLeg({ arriveAt: '12:00' }),
        makeLeg({ id: 'leg-2', departAt: '12:14', arriveAt: '13:00' }),
      ],
      0,
    ),
    false,
  );

  // Przesiadka 16 minut, ale 250 m spaceru (~221 s przy 1.3 m/s) -> zapas ~12 min < 15 min -> ukrywa
  assert.equal(
    shouldShowStationAmenities(
      [
        makeLeg({ arriveAt: '12:00' }),
        makeLeg({ id: 'walk-xfer', mode: 'walk', line: undefined, walkM: 250 }),
        makeLeg({ id: 'leg-2', mode: 'tram', line: '2', departAt: '12:16', arriveAt: '12:30' }),
      ],
      0,
      1.3,
    ),
    false,
  );

  // Opóźnienie przyjazdu live zjada bufor z 18 min do 12 min -> ukrywa
  assert.equal(
    shouldShowStationAmenities(
      [
        makeLeg({
          arriveAt: '12:24',
          scheduledArrivalSec: 12 * 3600 + 18 * 60,
          arrivalDelaySec: 6 * 60,
        }),
        makeLeg({
          id: 'leg-2',
          departAt: '12:36',
          scheduledDepartureSec: 12 * 3600 + 36 * 60,
          delaySec: 0,
        }),
      ],
      0,
    ),
    false,
  );

  // Przejście przez północ (23:50 -> 00:10 = 20 min) -> pokazuje
  assert.equal(
    shouldShowStationAmenities(
      [
        makeLeg({ departAt: '22:00', arriveAt: '23:50' }),
        makeLeg({ id: 'leg-2', departAt: '00:10', arriveAt: '01:00' }),
      ],
      0,
    ),
    true,
  );
});
