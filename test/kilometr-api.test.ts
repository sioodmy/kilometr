import '../scripts/stub-expo.cjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildLocalDelayHeatmap,
  fetchBackendVehicles,
  isKilometrApiAvailable,
  resetKilometrApiCircuit,
  type BackendDelayIntel,
} from '../src/services/kilometrApi';
import { buildRoutingSnapshot } from '../src/services/routing/reliability';
import { LocalGtfsStore, type DayIndex } from '../src/services/routing/store';
import type { TrackedVehicle } from '../src/services/liveTracker';

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
      baseUrl: 'https://api.kilometr.app',
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

test('circuit breaker otwiera obwod po 3 awariach i chroni przed kolejnymi timeoutami', async () => {
  resetKilometrApiCircuit();
  const originalFetch = globalThis.fetch;
  let calls = 0;
  try {
    globalThis.fetch = async () => {
      calls += 1;
      throw new Error('ECONNREFUSED');
    };
    assert.equal(isKilometrApiAvailable(), true);
    assert.equal(await fetchBackendVehicles('wroclaw'), null);
    assert.equal(await fetchBackendVehicles('wroclaw'), null);
    assert.equal(await fetchBackendVehicles('wroclaw'), null);
    assert.equal(calls, 3);
    assert.equal(isKilometrApiAvailable(), false);
    // Kolejne wywolanie nie dotyka sieci dopoki circuit breaker jest otwarty.
    assert.equal(await fetchBackendVehicles('wroclaw'), null);
    assert.equal(calls, 3);
  } finally {
    globalThis.fetch = originalFetch;
    resetKilometrApiCircuit();
  }
});

test('buildLocalDelayHeatmap wylicza strefy i wezly bez backendu', () => {
  const now = Date.now();
  const vehicles: TrackedVehicle[] = [
    {
      vehicleId: '4-1',
      line: '4',
      type: 'tram',
      lat: 51.111,
      lon: 17.061,
      delaySec: 420,
      updatedAt: now,
      currentStopName: 'Rondo Reagana',
    },
    {
      vehicleId: '10-2',
      line: '10',
      type: 'tram',
      lat: 51.1111,
      lon: 17.0612,
      delaySec: 480,
      updatedAt: now,
      currentStopName: 'Rondo Reagana',
    },
    {
      vehicleId: 'D-3',
      line: 'D',
      type: 'bus',
      lat: 51.18,
      lon: 17.18,
      delaySec: 20,
      updatedAt: now,
      currentStopName: 'Psie Pole',
    },
  ];
  const hm = buildLocalDelayHeatmap(vehicles, 'wroclaw');
  assert.equal(hm.source, 'local');
  assert.equal(hm.zones.length, 1);
  assert.equal(hm.zones[0].severity, 'severe');
  assert.equal(hm.hubs.length, 1);
  assert.equal(hm.hubs[0].name, 'Rondo Reagana');
  assert.equal(hm.summary.delayedVehicles, 2);
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
