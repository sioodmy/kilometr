import '../scripts/stub-expo.cjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildLiveMapDelayCorridors,
  polylineMidpointLonLat,
  validateRoadGeometry,
} from '../src/services/liveMapDelays';
import type { TrackedVehicle } from '../src/services/liveTracker';
import { LocalGtfsStore, type DayIndex } from '../src/services/routing/store';

function makeTransitStore(): { store: LocalGtfsStore; dayIndex: DayIndex } {
  const store = new LocalGtfsStore();
  store.isLoaded = true;
  store.stops.set('s1', {
    stop_id: 's1',
    stop_name: 'Galeria Dominikańska',
    stop_lat: 51.1082,
    stop_lon: 17.0394,
    stop_code: '101',
    normalized_name: 'galeria dominikanska',
  });
  store.stops.set('s2', {
    stop_id: 's2',
    stop_name: 'Urząd Wojewódzki',
    stop_lat: 51.1098,
    stop_lon: 17.0492,
    stop_code: '102',
    normalized_name: 'urzad wojewodzki',
  });
  store.stops.set('s3', {
    stop_id: 's3',
    stop_name: 'Plac Grunwaldzki',
    stop_lat: 51.1114,
    stop_lon: 17.0604,
    stop_code: '103',
    normalized_name: 'plac grunwaldzki',
  });
  store.stops.set('s2_rev', {
    stop_id: 's2_rev',
    stop_name: 'Urząd Wojewódzki',
    stop_lat: 51.1096,
    stop_lon: 17.0490,
    stop_code: '104',
    normalized_name: 'urzad wojewodzki',
  });
  store.stops.set('s1_rev', {
    stop_id: 's1_rev',
    stop_name: 'Galeria Dominikańska',
    stop_lat: 51.1080,
    stop_lon: 17.0392,
    stop_code: '105',
    normalized_name: 'galeria dominikanska',
  });

  store.routes.set('r4', {
    route_id: 'r4',
    route_short_name: '4',
    route_long_name: 'Biskupin',
    route_type: 0,
  });
  store.routes.set('r10', {
    route_id: 'r10',
    route_short_name: '10',
    route_long_name: 'Biskupin',
    route_type: 0,
  });

  store.trips.set('t4_fwd', {
    trip_id: 't4_fwd',
    route_id: 'r4',
    service_id: 'svc',
    trip_headsign: 'Biskupin',
    direction_id: 0,
    shape_id: '',
  });
  store.trips.set('t10_rev', {
    trip_id: 't10_rev',
    route_id: 'r10',
    service_id: 'svc',
    trip_headsign: 'Leśnica',
    direction_id: 1,
    shape_id: '',
  });

  store.stopTimes.set('t4_fwd', [
    { trip_id: 't4_fwd', stop_id: 's1', stop_sequence: 1, arrival_sec: 36000, departure_sec: 36000 },
    { trip_id: 't4_fwd', stop_id: 's2', stop_sequence: 2, arrival_sec: 36180, departure_sec: 36180 },
    { trip_id: 't4_fwd', stop_id: 's3', stop_sequence: 3, arrival_sec: 36360, departure_sec: 36360 },
  ]);
  store.stopTimes.set('t10_rev', [
    { trip_id: 't10_rev', stop_id: 's2_rev', stop_sequence: 1, arrival_sec: 36000, departure_sec: 36000 },
    { trip_id: 't10_rev', stop_id: 's1_rev', stop_sequence: 2, arrival_sec: 36180, departure_sec: 36180 },
  ]);

  const dayIndex: DayIndex = {
    stopRoutes: new Map(),
    routeStops: new Map(),
    routeTrips: new Map(),
    patterns: new Map([
      [
        'p4',
        {
          patternId: 'p4',
          routeId: 'r4',
          stopSequence: ['s1', 's2', 's3'],
          trips: [store.trips.get('t4_fwd')!],
          departures: [],
          tripIndices: [],
        },
      ],
    ]),
  };

  return { store, dayIndex };
}

test('buildLiveMapDelayCorridors scala przeciwne kierunki i laczy sasiednie odcinki o tym samym severity', () => {
  const { store, dayIndex } = makeTransitStore();
  const now = Date.now();
  const vehicles: TrackedVehicle[] = [
    {
      vehicleId: 'v1',
      line: '4',
      type: 'tram',
      lat: 51.1090,
      lon: 17.0443,
      delaySec: 520,
      updatedAt: now,
      matchedTripId: 't4_fwd',
    },
    {
      vehicleId: 'v2',
      line: '10',
      type: 'tram',
      lat: 51.1088,
      lon: 17.0441,
      delaySec: 460,
      updatedAt: now,
      matchedTripId: 't10_rev',
    },
    {
      vehicleId: 'v3',
      line: '4',
      type: 'tram',
      lat: 51.1106,
      lon: 17.0548,
      delaySec: 560,
      updatedAt: now,
      matchedTripId: 't4_fwd',
    },
  ];

  const corridors = buildLiveMapDelayCorridors(vehicles, store, dayIndex, 'wroclaw', [
    {
      id: 'hub:plac-grunwaldzki',
      name: 'Plac Grunwaldzki',
      lat: 51.1114,
      lon: 17.0604,
      avgDelaySec: 420,
      p90DelaySec: 540,
      maxDelaySec: 600,
      vehicleCount: 3,
      delayedCount: 3,
      severity: 'severe',
      topLines: ['4', '10'],
      typicalDelaySec: 120,
      deltaVsTypicalSec: 300,
    },
  ]);

  assert.equal(corridors.length, 1);
  assert.equal(corridors[0].mode, 'tram');
  assert.equal(corridors[0].severity, 'severe');
  assert.equal(corridors[0].waypoints.length, 3);
  assert.equal(corridors[0].title, 'Galeria Dominikańska → Plac Grunwaldzki');
  assert.equal(corridors[0].vehicleCount, 3);
  assert.equal(corridors[0].delayedCount, 3);
  assert.equal(corridors[0].typicalDelaySec, 120);
  assert.ok((corridors[0].deltaVsTypicalSec ?? 0) > 300);
});

test('buildLiveMapDelayCorridors nie oznacza korka gdy wiekszosc pojazdow na odcinku jedzie punktualnie', () => {
  const { store, dayIndex } = makeTransitStore();
  const now = Date.now();
  const vehicles: TrackedVehicle[] = [
    {
      vehicleId: 'late-1',
      line: '4',
      type: 'tram',
      lat: 51.1090,
      lon: 17.0443,
      delaySec: 210,
      updatedAt: now,
      matchedTripId: 't4_fwd',
    },
    {
      vehicleId: 'ok-1',
      line: '4',
      type: 'tram',
      lat: 51.1091,
      lon: 17.0445,
      delaySec: 10,
      updatedAt: now,
      matchedTripId: 't4_fwd',
    },
    {
      vehicleId: 'ok-2',
      line: '4',
      type: 'tram',
      lat: 51.1089,
      lon: 17.0440,
      delaySec: 0,
      updatedAt: now,
      matchedTripId: 't4_fwd',
    },
  ];

  const corridors = buildLiveMapDelayCorridors(vehicles, store, dayIndex, 'wroclaw');
  assert.equal(corridors.length, 0);
});

test('validateRoadGeometry odrzuca petle, objazdy i odlegle kotwice, a akceptuje naturalna droge', () => {
  const waypoints: [number, number][] = [
    [51.1082, 17.0394],
    [51.1098, 17.0492],
  ];
  const naturalRoad: [number, number][] = [
    [51.1082, 17.0394],
    [51.1089, 17.0425],
    [51.1094, 17.0461],
    [51.1098, 17.0492],
  ];
  const absurdDetour: [number, number][] = [
    [51.1082, 17.0394],
    [51.1250, 17.0440],
    [51.1098, 17.0492],
  ];
  const detachedStart: [number, number][] = [
    [51.1120, 17.0394],
    [51.1098, 17.0492],
  ];

  assert.equal(validateRoadGeometry(naturalRoad, waypoints), true);
  assert.equal(validateRoadGeometry(absurdDetour, waypoints), false);
  assert.equal(validateRoadGeometry(detachedStart, waypoints), false);
});

test('polylineMidpointLonLat wylicza punkt w polowie dlugosci trasy', () => {
  const mid = polylineMidpointLonLat([
    [17.04, 51.10],
    [17.05, 51.10],
    [17.06, 51.10],
  ]);
  assert.ok(Math.abs(mid.lon - 17.05) < 1e-4);
  assert.ok(Math.abs(mid.lat - 51.10) < 1e-4);
});
