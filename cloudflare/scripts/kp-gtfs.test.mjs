import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { getKpFingerprint, getWarsawDates, isPolishHoliday, scrapeKpToGtfsDir } from './kp-gtfs.mjs';

function jsonRes(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

test('isPolishHoliday detects fixed and Easter-based holidays', () => {
  assert.equal(isPolishHoliday('2026-01-01'), true);
  assert.equal(isPolishHoliday('2026-04-06'), true); // Easter Monday 2026
  assert.equal(isPolishHoliday('2026-06-04'), true); // Corpus Christi 2026
  assert.equal(isPolishHoliday('2026-11-11'), true);
  assert.equal(isPolishHoliday('2026-04-07'), false);
});

test('getWarsawDates returns N sequential YYYY-MM-DD strings', () => {
  const dates = getWarsawDates(7);
  assert.equal(dates.length, 7);
  for (let i = 0; i < dates.length; i++) {
    assert.match(dates[i], /^\d{4}-\d{2}-\d{2}$/);
    if (i > 0) {
      const prev = Date.parse(`${dates[i - 1]}T12:00:00Z`);
      const curr = Date.parse(`${dates[i]}T12:00:00Z`);
      assert.equal(curr - prev, 86_400_000);
    }
  }
});

test('scrapeKpToGtfsDir synthesizes GTFS files with tram route_type and midnight rollover', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'kp-gtfs-test-'));
  const dates = getWarsawDates(7);

  const mockFetch = async (url) => {
    if (url.endsWith('/stops')) {
      return jsonRes({
        revision: 42,
        stops: [
          // Valid tram/bus boarding stop
          ['10', 'DWG', 'Dworzec, Główny', 18753400, 53484200, 0, 1, 1],
          // Only disembarking -> included in stops.txt, skipped for timetable polling
          ['11', 'PET', 'Pętla Końcowa', 18763400, 53494200, 1, 0, 0],
          // Invalid (outside Poland) -> filtered out
          ['99', 'BAD', 'Nowhere', 0, 0, 0, 0, 0],
        ],
      });
    }

    if (url.includes('/api/timetables/10?date=')) {
      const date = url.split('?date=')[1];
      // Simulate weekday/all-week trips: tram T_TRAM runs every scraped day; night bus T_NIGHT runs on first 2 dates.
      const departures = [{ trip_id: 'T_TRAM', index: 0, departure: '12:00' }];
      if (date === dates[0] || date === dates[1]) {
        departures.push({ trip_id: 'T_NIGHT', index: 0, departure: '23:55' });
      }
      return jsonRes({ departures });
    }

    if (url.includes('/api/trip/T_TRAM/')) {
      return jsonRes({
        line: { name: '2', type: 'tram' },
        direction: 'Tarpno',
        times: [
          { index: 0, place_id: '10', departure_time: '12:00' },
          { index: 1, place_id: '11', departure_time: '12:12' },
        ],
      });
    }

    if (url.includes('/api/trip/T_NIGHT/')) {
      return jsonRes({
        line: { name: 'N1', type: 'bus' },
        direction: 'Pętla Końcowa',
        times: [
          { index: 0, place_id: '10', departure_time: '23:55' },
          { index: 1, place_id: '11', departure_time: '00:05' },
        ],
      });
    }

    return jsonRes({}, 404);
  };

  try {
    const fp1 = await getKpFingerprint('grudziadz', mockFetch);
    const fp2 = await getKpFingerprint('grudziadz', mockFetch);
    assert.ok(fp1 && fp1.length === 16);
    assert.equal(fp1, fp2);

    const stats = await scrapeKpToGtfsDir('grudziadz', dir, {
      fetchImpl: mockFetch,
      concurrency: 4,
      log: () => {},
    });

    assert.equal(stats.stops, 2);
    assert.equal(stats.routes, 2);
    assert.equal(stats.trips, 2);

    const stopsTxt = readFileSync(join(dir, 'stops.txt'), 'utf8');
    assert.match(stopsTxt, /^10,DWG,"Dworzec, Główny",53\.484200,18\.753400$/m);
    assert.equal(stopsTxt.includes('Nowhere'), false);

    const routesTxt = readFileSync(join(dir, 'routes.txt'), 'utf8');
    assert.match(routesTxt, /^R_1,2,,0$/m);
    assert.match(routesTxt, /^R_2,N1,,3$/m);

    const stopTimesTxt = readFileSync(join(dir, 'stop_times.txt'), 'utf8');
    assert.match(stopTimesTxt, /^T_NIGHT,23:55:00,23:55:00,10,1$/m);
    assert.match(stopTimesTxt, /^T_NIGHT,24:05:00,24:05:00,11,2$/m);

    const calendarTxt = readFileSync(join(dir, 'calendar.txt'), 'utf8');
    assert.match(calendarTxt, /^S_1111111,1,1,1,1,1,1,1,/m);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
