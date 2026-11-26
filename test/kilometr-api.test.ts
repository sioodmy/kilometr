import '../scripts/stub-expo.cjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  fetchBackendAnomalies,
  fetchBackendDelayHubs,
  fetchBackendRouteInsights,
  fetchBackendVehicles,
  isKilometrApiAvailable,
  resetKilometrApiCircuit,
  type BackendDelayIntel,
} from '../src/services/kilometrApi';
import { buildRoutingSnapshot } from '../src/services/routing/reliability';
import { LocalGtfsStore, type DayIndex } from '../src/services/routing/store';

// Domyślnie backend jest odcięty (baseUrl = ''), więc testy sieci podają host jawnie.
const TEST_BASE_URL = 'https://api.kilometr.app';

test('fetchBackendVehicles filtruje po bbox i konwertuje pojazdy miejskie oraz kolej', async () => {
  resetKilometrApiCircuit();
  const originalFetch = globalThis.fetch;
  let capturedUrl = '';
  try {
    globalThis.fetch = async (input: RequestInfo | URL) => {
      capturedUrl = String(input);
      return new Response(
        JSON.stringify({
          city: 'wroclaw',
          updated_at: Date.now(),
          boosted: true,
          total_in_city: 140,
          vehicles: [
            {
              vehicle_id: '401',
              line: '4',
              mode: 'tram',
              lat: 51.111,
              lon: 17.061,
              bearing: 120,
              delay_sec: 240,
              timestamp_ms: Date.now(),
              headsign: 'Biskupin',
              upcoming_stops: [{ name: 'Rondo Reagana', sched_sec: 43200 }],
            },
          ],
          rail_vehicles: [
            {
              vehicle_id: 'kd-1',
              line: 'D1',
              brigade: '69558',
              agency: 'KD',
              mode: 'train',
              lat: 51.099,
              lon: 17.036,
              delay_sec: 180,
              timestamp_ms: Date.now(),
              is_rail: true,
            },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    };

    const batch = await fetchBackendVehicles('wroclaw', {
      bbox: [17.0, 51.08, 17.1, 51.14],
      includeRail: true,
      baseUrl: TEST_BASE_URL,
    });
    assert.ok(batch);
    assert.ok(capturedUrl.includes('bbox=17.00000%2C51.08000%2C17.10000%2C51.14000'));
    assert.equal(batch.boosted, true);
    assert.equal(batch.urban.length, 1);
    assert.equal(batch.urban[0].name, '4');
    assert.equal(batch.urban[0].delaySec, 240);
    assert.equal(batch.rails.length, 1);
    assert.equal(batch.rails[0].prefix, 'KD:');
    assert.equal(batch.rails[0].vehicles[0].trainNumber, '69558');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('domyslny backend jest odciety, a circuit breaker chroni przed kolejnymi timeoutami', async () => {
  resetKilometrApiCircuit();
  const originalFetch = globalThis.fetch;
  let calls = 0;
  try {
    globalThis.fetch = async () => {
      calls += 1;
      throw new Error('ECONNREFUSED');
    };
    // Bez EXPO_PUBLIC_BACKEND_URL nie wychodzi żadne żądanie.
    assert.equal(isKilometrApiAvailable(), false);
    assert.equal(await fetchBackendVehicles('wroclaw'), null);
    assert.equal(calls, 0);
    assert.equal(await fetchBackendVehicles('wroclaw', { baseUrl: TEST_BASE_URL }), null);
    assert.equal(await fetchBackendVehicles('wroclaw', { baseUrl: TEST_BASE_URL }), null);
    assert.equal(await fetchBackendVehicles('wroclaw', { baseUrl: TEST_BASE_URL }), null);
    assert.equal(calls, 3);
    assert.equal(isKilometrApiAvailable(), false);
    // Kolejne wywolanie nie dotyka sieci dopoki circuit breaker jest otwarty.
    assert.equal(await fetchBackendVehicles('wroclaw', { baseUrl: TEST_BASE_URL }), null);
    assert.equal(calls, 3);
  } finally {
    globalThis.fetch = originalFetch;
    resetKilometrApiCircuit();
  }
});

test('fetchBackendDelayHubs pobiera normy wezlow bez stref heatmapy', async () => {
  resetKilometrApiCircuit();
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () =>
      new Response(
        JSON.stringify({
          city: 'wroclaw',
          updated_at: Date.now(),
          hubs: [
            {
              id: 'hub:rondo',
              name: 'Rondo Reagana',
              lat: 51.111,
              lon: 17.061,
              avg_delay_sec: 420,
              p90_delay_sec: 540,
              max_delay_sec: 600,
              vehicle_count: 3,
              delayed_count: 2,
              severity: 'severe',
              top_lines: ['4', '10'],
              typical_delay_sec: 120,
              delta_vs_typical_sec: 300,
            },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );

    const hubs = await fetchBackendDelayHubs('wroclaw', null, undefined, TEST_BASE_URL);
    assert.ok(hubs);
    assert.equal(hubs.length, 1);
    assert.equal(hubs[0].name, 'Rondo Reagana');
    assert.equal(hubs[0].typicalDelaySec, 120);
  } finally {
    globalThis.fetch = originalFetch;
    resetKilometrApiCircuit();
  }
});

test('buildRoutingSnapshot uzywa estymacji Data Science z backendu dla tramwajow bez GPS', () => {
  const store = new LocalGtfsStore();
  store.routes.set('r4', {
    route_id: 'r4',
    route_short_name: '4',
    route_long_name: '',
    route_type: 0,
  });
  const now = new Date(2026, 10, 24, 12, 0, 0);
  const sec = 12 * 3600;
  store.stopTimes.set('trip_no_gps', [
    { trip_id: 'trip_no_gps', stop_id: 's1', stop_sequence: 1, arrival_sec: sec, departure_sec: sec },
    { trip_id: 'trip_no_gps', stop_id: 's2', stop_sequence: 2, arrival_sec: sec + 900, departure_sec: sec + 900 },
  ]);
  const index: DayIndex = {
    stopRoutes: new Map(),
    routeStops: new Map(),
    routeTrips: new Map(),
    patterns: new Map([
      [
        'p4',
        {
          patternId: 'p4',
          routeId: 'r4',
          stopSequence: ['s1', 's2'],
          trips: [
            {
              trip_id: 'trip_no_gps',
              route_id: 'r4',
              service_id: 'svc',
              trip_headsign: 'Biskupin',
              direction_id: 0,
              shape_id: '',
            },
          ],
          departures: [],
          tripIndices: [],
        },
      ],
    ]),
  };

  const intel: BackendDelayIntel = {
    city: 'wroclaw',
    updatedAt: now.getTime(),
    byLine: new Map([
      [
        '4',
        {
          line: '4',
          mode: 'tram',
          activeVehicles: 3,
          avgDelaySec: 360,
          medianDelaySec: 340,
          p90DelaySec: 540,
          delayedRatio: 0.8,
          trend: 'rising',
          estimatedUntrackedDelaySec: 300,
          estimateConfidence: 0.78,
          recommendedTransferBufferSec: 300,
        },
      ],
    ]),
  };

  const snap = buildRoutingSnapshot(index, store, [], false, now.getTime(), new Map(), intel);
  assert.equal(snap.delays.get('trip_no_gps'), 300);
  assert.equal(snap.confidence.get('trip_no_gps'), 'estimated');
  assert.equal(snap.transferBuffers.get('trip_no_gps'), 300);
});

test('fetchBackendRouteInsights zwraca null przy ready=false oraz pelne dane przy ready=true', async () => {
  resetKilometrApiCircuit();
  const originalFetch = globalThis.fetch;
  const conn = {
    id: 'c1',
    fromTitle: 'Rynek',
    toTitle: 'Krzyki',
    departInMin: 5,
    departureSec: 13 * 3600,
    departAt: '13:00',
    arriveAt: '13:25',
    durationMin: 25,
    transfers: 1,
    delayMin: 0,
    live: false,
    legs: [
      {
        id: 'l1',
        mode: 'tram' as const,
        line: '4',
        fromStop: 'Rynek',
        toStop: 'Rondo Reagana',
        departAt: '13:00',
        arriveAt: '13:10',
        stopsCount: 4,
        live: false,
      },
    ],
  };

  try {
    globalThis.fetch = async () =>
      new Response(JSON.stringify({ ready: false }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    assert.equal(await fetchBackendRouteInsights('wroclaw', conn, undefined, TEST_BASE_URL), null);

    globalThis.fetch = async () =>
      new Response(
        JSON.stringify({
          city: 'wroclaw',
          updated_at: Date.now(),
          ready: true,
          risk_level: 'high',
          day_type: 'weekday',
          focus_hour: 13,
          focus_line: '4',
          focus_mode: 'tram',
          expected_delay_sec: 300,
          p90_delay_sec: 540,
          late_probability: 0.65,
          sample_count: 142,
          hourly_profile: [
            { hour: 11, avg_delay_sec: 120, p90_delay_sec: 240, sample_count: 30, is_departure_hour: false },
            { hour: 12, avg_delay_sec: 180, p90_delay_sec: 300, sample_count: 35, is_departure_hour: false },
            { hour: 13, avg_delay_sec: 300, p90_delay_sec: 540, sample_count: 42, is_departure_hour: true },
            { hour: 14, avg_delay_sec: 420, p90_delay_sec: 660, sample_count: 35, is_departure_hour: false },
            { hour: 15, avg_delay_sec: 240, p90_delay_sec: 420, sample_count: 28, is_departure_hour: false },
          ],
          transfer_risks: [
            {
              stop_name: 'Rondo Reagana',
              from_line: '4',
              to_line: 'D',
              margin_sec: 240,
              feeder_p90_delay_sec: 420,
              risk: 'risky',
            },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );

    const res = await fetchBackendRouteInsights('wroclaw', conn, undefined, TEST_BASE_URL);
    assert.ok(res);
    assert.equal(res.ready, true);
    assert.equal(res.focusLine, '4');
    assert.equal(res.hourlyProfile.length, 5);
    assert.equal(res.transferRisks[0]?.risk, 'risky');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('fetchBackendAnomalies mapuje automatyczne zatory GPS', async () => {
  resetKilometrApiCircuit();
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () =>
      new Response(
        JSON.stringify({
          city: 'wroclaw',
          updated_at: Date.now(),
          anomalies: [
            {
              id: 'jam:wroclaw:tram_stall:16225:3412',
              city: 'wroclaw',
              kind: 'tram_stall',
              severity: 'blocking',
              mode: 'tram',
              location_name: 'Rondo Reagana',
              lat: 51.1112,
              lon: 17.0615,
              lines: ['4', '10', '33'],
              stalled_vehicles: 3,
              affected_vehicles: 3,
              avg_delay_sec: 480,
              max_delay_sec: 600,
              typical_delay_sec: 150,
              delta_vs_normal_sec: 330,
              detected_at_ms: Date.now() - 360000,
              updated_at_ms: Date.now(),
              duration_sec: 360,
            },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );

    const list = await fetchBackendAnomalies('wroclaw', undefined, TEST_BASE_URL);
    assert.ok(list);
    assert.equal(list.length, 1);
    assert.equal(list[0].kind, 'tram_stall');
    assert.equal(list[0].stalledVehicles, 3);
    assert.deepEqual(list[0].lines, ['4', '10', '33']);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
