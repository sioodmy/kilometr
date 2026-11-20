import assert from 'node:assert/strict';
import test from 'node:test';
import { getCity } from '../src/cities';
import type { GtfsStop, GtfsStopTime, GtfsTrip } from '../src/gtfs/types';
import {
  clearKpStopsCacheForTests,
  encodeKpTripExecId,
  fetchKpCityRows,
  selectKpHubStops,
  type GtfsStopCoverageSource,
  type KpStopEntry,
} from '../src/services/kpLive';

test('encodeKpTripExecId encodes ASCII and UTF-8 Polish characters to standard Base64', () => {
  const samples = [
    '1021:20260417:394021',
    'Łódź/Żółć:12:345',
    'Świętochłowice#99',
    'a',
    'ab',
    'abc',
  ];
  for (const s of samples) {
    assert.equal(encodeKpTripExecId(s), Buffer.from(s, 'utf8').toString('base64'));
  }
});

test('selectKpHubStops excludes onlyDisembarking and caps at 35 while covering GTFS routes', () => {
  const kpStops: KpStopEntry[] = Array.from({ length: 60 }, (_, idx) => ({
    placeId: `P${idx}`,
    name: `Przystanek ${idx}`,
    lat: 53.48 + idx * 0.001,
    lon: 18.75 + idx * 0.001,
    onlyDisembarking: idx === 0,
    isStation: idx % 15 === 0,
  }));

  const trips = new Map<string, GtfsTrip>();
  const stopTimes = new Map<string, GtfsStopTime[]>();
  const stops = new Map<string, GtfsStop>();

  // 8 routes, each visiting a distinct pair of stops beyond P35 (like P45, P52).
  for (let r = 0; r < 8; r++) {
    const tripId = `T${r}`;
    const sA = `P${40 + r}`;
    const sB = `P${50 + r}`;
    trips.set(tripId, {
      trip_id: tripId,
      route_id: `R${r}`,
      service_id: 'S1',
      trip_headsign: `Kierunek ${r}`,
      direction_id: 0,
      shape_id: `SH_${r}`,
    });
    stopTimes.set(tripId, [
      { trip_id: tripId, stop_id: sA, stop_sequence: 1, arrival_sec: 3600, departure_sec: 3600 },
      { trip_id: tripId, stop_id: `P${1 + r}`, stop_sequence: 2, arrival_sec: 3720, departure_sec: 3720 },
      { trip_id: tripId, stop_id: sB, stop_sequence: 3, arrival_sec: 3900, departure_sec: 3900 },
    ]);
  }

  const store: GtfsStopCoverageSource = { isLoaded: true, stops, trips, stopTimes };
  const selected = selectKpHubStops(kpStops, store);

  assert.equal(selected.includes('P0'), false);
  assert.ok(selected.length <= 35);
  for (let r = 0; r < 8; r++) {
    assert.ok(
      selected.includes(`P${40 + r}`) || selected.includes(`P${50 + r}`),
      `route R${r} should have a selected covering stop`,
    );
  }
});

test('selectKpHubStops falls back to <=120m coordinate matching when GTFS stop_ids differ', () => {
  const kpStops: KpStopEntry[] = Array.from({ length: 50 }, (_, idx) => ({
    placeId: `KP_${idx}`,
    name: `Stop ${idx}`,
    lat: 49.82 + idx * 0.003,
    lon: 19.04 + idx * 0.003,
    onlyDisembarking: false,
    isStation: false,
  }));

  const targetKp = kpStops[44]!;
  const stops = new Map<string, GtfsStop>([
    [
      'ZB_999',
      {
        stop_id: 'ZB_999',
        stop_name: 'Bielsko Hub',
        stop_code: '999',
        stop_lat: targetKp.lat + 0.0003,
        stop_lon: targetKp.lon + 0.0003,
        normalized_name: 'bielsko hub',
      },
    ],
  ]);
  const trips = new Map<string, GtfsTrip>([
    ['TR1', { trip_id: 'TR1', route_id: 'LINE_1', service_id: 'S1', trip_headsign: 'Centrum', direction_id: 0, shape_id: 'SH_1' }],
  ]);
  const stopTimes = new Map<string, GtfsStopTime[]>([
    [
      'TR1',
      [{ trip_id: 'TR1', stop_id: 'ZB_999', stop_sequence: 1, arrival_sec: 3600, departure_sec: 3600 }],
    ],
  ]);

  const selected = selectKpHubStops(kpStops, { isLoaded: true, stops, trips, stopTimes });
  assert.ok(selected.includes('KP_44'));
});

test('fetchKpCityRows filters departures, deduplicates brigades & coords, maps trams and delays', async () => {
  clearKpStopsCacheForTests();
  const originalFetch = globalThis.fetch;
  const grudziadz = getCity('grudziadz');
  const requestedUrls: string[] = [];

  globalThis.fetch = (async (input: string | URL | Request): Promise<Response> => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    requestedUrls.push(url);

    if (url.endsWith('/stops')) {
      return new Response(
        JSON.stringify({
          stops: [
            ['101', 'DWG', 'Dworzec Główny', 18753400, 53484200, 0, 1, 1],
            ['102', 'WY', 'Wysiadkowy', 18754000, 53485000, 1, 0, 0],
          ],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }

    if (url.includes('/api/departures?places=')) {
      return new Response(
        JSON.stringify({
          departures: [
            {
              designator: 'DWG',
              rows: [
                // Static-only trip -> must be skipped
                {
                  time: '3 min',
                  is_estimated: false,
                  canceled: false,
                  line_name: '3',
                  trip_execution_id: '301:20260417:1',
                  trip_index: 2,
                },
                // Canceled trip -> must be skipped
                {
                  time: '4 min',
                  is_estimated: true,
                  canceled: true,
                  line_name: '4',
                  trip_execution_id: '401:20260417:2',
                  trip_index: 1,
                },
                // Too far in the future (>55 min) -> must be skipped
                {
                  time: '72 min',
                  is_estimated: true,
                  canceled: false,
                  line_name: '5',
                  trip_execution_id: '501:20260417:3',
                  trip_index: 1,
                },
                // Same brigade (102:20260417) later future trip -> replaced by < 1 min trip
                {
                  time: '25 min',
                  time_diff: 0,
                  is_estimated: true,
                  canceled: false,
                  line_name: '2',
                  trip_execution_id: '102:20260417:999',
                  trip_index: 1,
                },
                // Same brigade active tram trip
                {
                  time: '< 1 min',
                  time_diff: 2.5,
                  is_estimated: true,
                  canceled: false,
                  line_name: '2',
                  trip_execution_id: '102:20260417:888',
                  trip_index: 4,
                },
                // Duplicate coordinate candidate on same line (different brigade) -> filtered out
                {
                  time: '2 min',
                  time_diff: 1,
                  is_estimated: true,
                  canceled: false,
                  line_name: '2',
                  trip_execution_id: '103:20260417:777',
                  trip_index: 3,
                },
                // Distinct bus trip
                {
                  time: '8 min',
                  time_diff: -1,
                  is_estimated: true,
                  canceled: false,
                  line_name: '14',
                  trip_execution_id: '140:20260417:555',
                  trip_index: 2,
                },
              ],
            },
          ],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }

    if (url.includes('/api/trip_execution/')) {
      if (url.includes(encodeURIComponent(encodeKpTripExecId('102:20260417:888')))) {
        return new Response(
          JSON.stringify({
            vehicle: { lat: 53.48421, lon: 18.75341 },
            estimates: [{ to_go: null }, { to_go: 40 }, { to_go: 190 }],
            trip: {
              direction: 'Tarpno',
              line: { name: '2', type: 'tram' },
              times: [
                { stop_name: 'Poprzedni', departure_time: '12:00:00' },
                { stop_name: 'Dworzec Główny', departure_time: '12:04:00' },
                { stop_name: 'Tarpno', departure_time: '12:09:00' },
              ],
            },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }
      if (url.includes(encodeURIComponent(encodeKpTripExecId('103:20260417:777')))) {
        return new Response(
          JSON.stringify({
            vehicle: { lat: 53.48421, lon: 18.75341 },
            trip: { direction: 'Rządz', line: { name: '2', type: 'tram' }, times: [] },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }
      return new Response(
        JSON.stringify({
          vehicle: { lat: 53.461, lon: 18.771 },
          trip: { direction: 'Lotnisko', line: { name: '14', type: 'bus' }, times: [] },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }

    return new Response('not found', { status: 404 });
  }) as typeof fetch;

  try {
    const store: GtfsStopCoverageSource = {
      isLoaded: false,
      stops: new Map(),
      trips: new Map(),
      stopTimes: new Map(),
    };
    const rows = await fetchKpCityRows(grudziadz, store);
    assert.ok(rows !== null);
    assert.equal(rows.length, 2);

    const tram = rows.find((r) => r.name === '2');
    assert.ok(tram);
    assert.equal(tram.type, 'tram');
    assert.equal(tram.delaySec, 150);
    assert.equal(tram.headsign, 'Tarpno');
    assert.equal(tram.brigade, '102');
    assert.deepEqual(tram.upcomingStops, [
      { name: 'Dworzec Główny', schedSec: 12 * 3600 + 4 * 60 },
      { name: 'Tarpno', schedSec: 12 * 3600 + 9 * 60 },
    ]);

    const bus = rows.find((r) => r.name === '14');
    assert.ok(bus);
    assert.equal(bus.type, 'bus');
    assert.equal(bus.delaySec, -60);
    assert.equal(bus.headsign, 'Lotnisko');

    // Ensured future brigade trip (999) was not fetched once active (< 1 min) won.
    const fetched999 = requestedUrls.some((u) =>
      u.includes(encodeURIComponent(encodeKpTripExecId('102:20260417:999'))),
    );
    assert.equal(fetched999, false);

    // City without kpPrefix cleanly returns null.
    const wro = await fetchKpCityRows(getCity('wroclaw'), store);
    assert.equal(wro, null);
  } finally {
    globalThis.fetch = originalFetch;
    clearKpStopsCacheForTests();
  }
});
