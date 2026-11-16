/**
 * Testy wykrywania pojazdu na podstawie ruchu GPS i pozycji live pojazdów.
 *
 * Uruchomienie: `npx tsx --require ./scripts/stub-expo.cjs scripts/check-onboard-detector.ts`
 */

import { LocalGtfsStore } from '../src/services/routing/store';
import type { CurrentLocation } from '../src/services/currentLocation';
import type { TrackedVehicle } from '../src/services/liveTracker';
import {
  buildBoardedOriginFromVehicle,
  detectBoardedVehicles,
  findNearbyLiveVehicles,
} from '../src/services/onboardDetector';

let passed = 0;
const failures: string[] = [];

function check(label: string, cond: boolean, detail = '') {
  if (cond) {
    passed++;
    console.log(`  PASS ${label}${detail ? `: ${detail}` : ''}`);
  } else {
    failures.push(`${label}${detail ? `: ${detail}` : ''}`);
    console.log(`  FAIL ${label}${detail ? `: ${detail}` : ''}`);
  }
}

const lat0 = 51.1;
const lon0 = 17.0;
const STEP_LAT = 0.0036; // ~400 m północ

function buildStore(): LocalGtfsStore {
  const store = new LocalGtfsStore();
  (store as unknown as { isLoaded: boolean }).isLoaded = true;
  const stops: Array<[string, number, number]> = [
    ['S0', lat0, lon0],
    ['S1', lat0 + STEP_LAT, lon0],
    ['S2', lat0 + 2 * STEP_LAT, lon0],
    ['S3', lat0 + 3 * STEP_LAT, lon0],
  ];
  for (const [id, lat, lon] of stops) {
    store.stops.set(id, {
      stop_id: id,
      stop_code: '',
      stop_name: `Przystanek ${id}`,
      stop_lat: lat,
      stop_lon: lon,
      normalized_name: id,
    });
  }
  store.routes.set('4', { route_id: '4', route_short_name: '4', route_long_name: '', route_type: 0 });
  store.routes.set('10', { route_id: '10', route_short_name: '10', route_long_name: '', route_type: 0 });
  store.routes.set('4_rev', { route_id: '4_rev', route_short_name: '4', route_long_name: '', route_type: 0 });

  store.trips.set('trip_4_north', { trip_id: 'trip_4_north', route_id: '4', service_id: 'wd', trip_headsign: 'Oporów', direction_id: 0, shape_id: '' });
  store.trips.set('trip_10_north', { trip_id: 'trip_10_north', route_id: '10', service_id: 'wd', trip_headsign: 'Leśnica', direction_id: 0, shape_id: '' });
  store.trips.set('trip_4_south', { trip_id: 'trip_4_south', route_id: '4_rev', service_id: 'wd', trip_headsign: 'Biskupin', direction_id: 1, shape_id: '' });

  const seq = (tripId: string, order: string[]) =>
    order.map((stop_id, i) => ({ trip_id: tripId, stop_id, arrival_sec: 36000 + i * 120, departure_sec: 36000 + i * 120, stop_sequence: i }));

  store.stopTimes.set('trip_4_north', seq('trip_4_north', ['S0', 'S1', 'S2', 'S3']));
  store.stopTimes.set('trip_10_north', seq('trip_10_north', ['S0', 'S1', 'S2', 'S3']));
  store.stopTimes.set('trip_4_south', seq('trip_4_south', ['S3', 'S2', 'S1', 'S0']));
  return store;
}

const store = buildStore();

const vehicles: TrackedVehicle[] = [
  {
    vehicleId: 'v4n',
    line: '4',
    type: 'tram',
    lat: lat0 + 1.0 * STEP_LAT,
    lon: lon0,
    delaySec: 60,
    nextStopName: 'Przystanek S2',
    updatedAt: Date.now(),
    matchedTripId: 'trip_4_north',
  },
  {
    vehicleId: 'v10n',
    line: '10',
    type: 'tram',
    lat: lat0 + 0.85 * STEP_LAT,
    lon: lon0,
    delaySec: 0,
    nextStopName: 'Przystanek S1',
    updatedAt: Date.now(),
    matchedTripId: 'trip_10_north',
  },
  {
    vehicleId: 'v4s',
    line: '4',
    type: 'tram',
    lat: lat0 + 1.5 * STEP_LAT,
    lon: lon0,
    delaySec: 0,
    nextStopName: 'Przystanek S1',
    updatedAt: Date.now(),
    matchedTripId: 'trip_4_south',
  },
];

// 1. Pasażer idzie pieszo / stoi (speed < 4 m/s) -> brak sugestii
const walking: CurrentLocation = {
  lat: lat0 + 1.45 * STEP_LAT,
  lon: lon0,
  accuracy: 10,
  speed: 1.5,
  heading: 0,
  timestamp: Date.now(),
};
check('brak detekcji przy niskiej prędkości (pieszo)', detectBoardedVehicles(walking, vehicles, store).length === 0);

// 2. Pasażer jedzie na północ (~200 m przed opóźnionym odczytem feedu) -> łapie oba północne, wygrywa bliższy v4n, odrzuca przeciwny v4s
const ridingNorth: CurrentLocation = {
  lat: lat0 + 1.5 * STEP_LAT, // ~200 m przed S1 (v4n)
  lon: lon0 + 0.0001,
  accuracy: 12,
  speed: 9.5,
  heading: 2, // północ
  timestamp: Date.now(),
};
const matches = detectBoardedVehicles(ridingNorth, vehicles, store);
check('wykrywa obu kandydatów na wspólnym korytarzu na północ', matches.length === 2, matches.map((m) => `${m.line}:${m.direction}`).join(', '));
check('odrzuca pojazd jadący w przeciwnym kierunku', !matches.some((m) => m.tripId === 'trip_4_south'));
check('pierwszy kandydat to najbliższy pojazd na linii 4', matches[0]?.line === '4' && matches[0]?.tripId === 'trip_4_north');
check('origin ma poprawne pola do routingu', matches[0]?.origin.boardStopId === 'S1' && matches[0]?.origin.delaySec === 60);

// 3. Zbyt duże odchylenie boczne (> 90 m) -> odrzucone
const offCorridor: CurrentLocation = { ...ridingNorth, lon: lon0 + 0.003 };
check('odrzuca użytkownika jadącego inną ulicą', detectBoardedVehicles(offCorridor, vehicles, store).length === 0);

// 4. Ręczna lista pobliskich pojazdów (niezależnie od prędkości)
const nearby = findNearbyLiveVehicles(lat0 + 1.45 * STEP_LAT, lon0, vehicles, store, 1000, 5);
check('findNearbyLiveVehicles zwraca pobliskie pojazdy posortowane po dystansie', nearby.length === 3 && nearby[0].tripId === 'trip_4_south');

// 5. buildBoardedOriginFromVehicle
const built = buildBoardedOriginFromVehicle(vehicles[0], store);
check('buildBoardedOriginFromVehicle buduje origin', built?.tripId === 'trip_4_north' && built?.line === '4');

console.log(`\nPodsumowanie: ${passed} PASS, ${failures.length} FAIL`);
if (failures.length > 0) {
  for (const f of failures) console.error(' -', f);
  process.exit(1);
}
