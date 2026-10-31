/**
 * Stan feedu live i odporność trackera pojazdów.
 *
 * Uruchomienie: `npm run check:live`
 *
 * Uruchomienie z `--require ./scripts/stub-expo.cjs` (patrz npm skrypt):
 * tracker live importuje natywne moduły Expo, których Node nie umie wczytać.
 *
 * Każdy przypadek poniżej to regression guard na realny błąd, przez który
 * aplikacja pokazywała „brak danych live”, mimo że dane były:
 *
 * - okno świeżości stało równe interwałowi pollingu (30 s = 30 s), więc stan
 *   przeskakiwał w „stale” tuż przed każdym kolejnym sukcesem,
 * - `getTripDelays()` oddawał żywą mapę, którą konsument mógł zepsuć,
 * - pusta odpowiedź MPK była traktowana tak samo jak awaria, przez co noc
 *   wyglądała jak padnięty feed,
 * - brak połączenia z kodem grada za linię, której nie ma w rozkładzie.
 */

import { liveTracker, snapshotIsUsable } from '../src/services/liveTracker';
import { AppState } from 'react-native';
import { fetchZbKd, fetchZbWroclawRows, matchZbKd, type ZbKdVehicle } from '../src/services/zbiorkom';
import { gtfsStore } from '../src/services/routing/store';
import {
  locateLiveStopPosition,
  findNearestStopOnRoute,
  positionToRank,
} from '../src/services/vehiclePosition';
import type { Leg, LegStop } from '../src/types/models';

// ─── Framework asercji ─────────────────────────────────────────────────────

let passed = 0;
const failures: string[] = [];
let section = '';

function describe(name: string): void {
  section = name;
  console.log(`\n== ${name}`);
}

function expect<T>(label: string, got: T, want: T): void {
  if (JSON.stringify(got) === JSON.stringify(want)) {
    passed++;
    console.log(`   ok    ${label} = ${JSON.stringify(got)}`);
    return;
  }
  failures.push(`${section} → ${label}: ${JSON.stringify(got)} (oczekiwano ${JSON.stringify(want)})`);
  console.log(`   FAIL  ${label} = ${JSON.stringify(got)} (oczekiwano ${JSON.stringify(want)})`);
}

/** Prywatne helpery trackera: sprawdzamy je wprost, bez całego ticka. */
const internals = liveTracker as unknown as {
  parseRows(text: string): unknown;
  lastOk: number;
};

// ─── Stan przed pierwszym odpowiedzią ─────────────────────────────────────

describe('Stan live zanim cokolwiek przyszło');
expect('start = unknown', liveTracker.getLiveState(), 'unknown');

// ─── Cykl życia tickera w tle i w foregroundzie ─────────────────────────────

describe('Cykl życia tickera w tle i w foregroundzie');
const liveInternals = liveTracker as unknown as {
  timer: unknown;
  wantPoll: boolean;
  pinned: number;
};
const appState = AppState as unknown as {
  currentState: string;
  emit?: (s: string) => void;
};

liveTracker.stop();
expect('początkowo wantPoll = false', liveInternals.wantPoll, false);
expect('początkowo timer = null', liveInternals.timer === null, true);

liveTracker.start();
expect('po start() wantPoll = true', liveInternals.wantPoll, true);
expect('po start() w foreground timer aktywny', liveInternals.timer !== null, true);

if (typeof appState.emit === 'function') {
  appState.emit('background');
  expect('w tle bez pinu timer jest pauzowany', liveInternals.timer === null, true);
  expect('w tle wantPoll pozostaje true', liveInternals.wantPoll, true);

  appState.emit('active');
  expect('po powrocie do foreground timer wraca', liveInternals.timer !== null, true);

  appState.emit('background');
  expect('ponownie w tle timer pauzowany', liveInternals.timer === null, true);

  liveTracker.pin(true);
  expect('pin w tle uruchamia timer', liveInternals.timer !== null, true);
  expect('pinned = 1', liveInternals.pinned, 1);

  liveTracker.pin(false);
  expect('odpięcie pinu w tle zatrzymuje timer', liveInternals.timer === null, true);
  expect('pinned = 0', liveInternals.pinned, 0);

  appState.emit('active');
  expect('powrót do foreground po pinach wznawia timer', liveInternals.timer !== null, true);
}

liveTracker.stop();
expect('po stop() timer = null', liveInternals.timer === null, true);
expect('po stop() wantPoll = false', liveInternals.wantPoll, false);


// ─── Okno świeżości nie gryzie się z pollingiem ───────────────────────────

describe('Świeżość danych');
internals.lastOk = Date.now();
expect('zaraz po sukcesie = fresh', liveTracker.getLiveState(), 'fresh');
// Dawniej granica stała na 30 s, czyli dokładnie tyle, ile trwa interwał
// pollingu. Dane starsze o 45 s to wciąż normalna sytuacja, nie awaria.
internals.lastOk = Date.now() - 45_000;
expect('45 s po sukcesie = fresh', liveTracker.getLiveState(), 'fresh');
internals.lastOk = Date.now() - 90_000;
expect('90 s po sukcesie = fresh', liveTracker.getLiveState(), 'fresh');
// Dopiero naprawdę pora przyznać, że feed zniknął.
internals.lastOk = Date.now() - 200_000;
expect('200 s bez odpowiedzi = stale', liveTracker.getLiveState(), 'stale');
internals.lastOk = 0;
expect('z powrotem zero = unknown', liveTracker.getLiveState(), 'unknown');

// ─── Snapshot z dysku tylko w oknie świeżości ─────────────────────────────

describe('Snapshot z dysku: okno świeżości');
const nowMs = Date.now();
expect('świeży snapshot użyteczny', snapshotIsUsable(nowMs - 60_000, nowMs), true);
expect('na granicy 15 min użyteczny', snapshotIsUsable(nowMs - 15 * 60 * 1000, nowMs), true);
expect('starszy niż 15 min odrzucony', snapshotIsUsable(nowMs - 15 * 60 * 1000 - 1, nowMs), false);
expect('brak znacznika odrzucony', snapshotIsUsable(undefined, nowMs), false);
expect('NaN odrzucony', snapshotIsUsable(NaN, nowMs), false);
expect('znacznik z przyszłości odrzucony', snapshotIsUsable(nowMs + 60_000, nowMs), false);

// ─── getTripDelays nie oddaje żywej mapy ──────────────────────────────────

describe('Opóźnienia dla RAPTOR-a');
const first = liveTracker.getTripDelays();
first.set('trip-hack', 999);
expect('zapis poza trackerem nie przecieka', liveTracker.getTripDelays().has('trip-hack'), false);
expect('każde wywołanie to nowa kopia', liveTracker.getTripDelays() === first, false);
expect('pusty tracker = pusta mapa', liveTracker.getTripDelays().size, 0);

// ─── getSourceHealth nie oddaje żywej mapy ────────────────────────────────

describe('Zdrowie źródeł live');
const health = liveTracker.getSourceHealth();
health.mpk = { attempts: 1, failures: 1, lastSuccessAt: null, lastError: 'x' };
expect('zapis poza trackerem nie przecieka', 'mpk' in liveTracker.getSourceHealth(), false);
expect('brak źródeł przed odpytaniem = pusty obiekt', Object.keys(liveTracker.getSourceHealth()).length, 0);

// ─── Pusta odpowiedź to nie awaria ────────────────────────────────────────

describe('Rozróżnienie pustej odpowiedzi od awarii');
expect('pusty body = pusta lista', internals.parseRows(''), []);
expect('sam whitespace = pusta lista', internals.parseRows('   \n '), []);
expect('HTML zamiast JSON = null', internals.parseRows('<html>502</html>'), null);
expect('obiekt zamiast tablicy = null', internals.parseRows('{"error":1}'), null);
expect('poprawna tablica przechodzi', internals.parseRows('[{"name":"1","type":"tram","x":51.1,"y":17.0,"k":7}]'), [
  { name: '1', type: 'tram', x: 51.1, y: 17.0, k: 7 },
]);
expect('tablica bez ani jednego poprawnego wiersza = null', internals.parseRows('[{"foo":1},{"name":"","x":0,"y":0,"k":1}]'), null);
expect('śmieci wśród poprawnych odsiane', internals.parseRows('[{"foo":1},{"name":"9","type":"bus","x":51.1,"y":17.0,"k":3}]'), [
  { name: '9', type: 'bus', x: 51.1, y: 17.0, k: 3 },
]);
expect('brak k = wiersz odsiany', internals.parseRows('[{"name":"9","x":51.1,"y":17.0}]'), null);
expect('nie-liczba w x = wiersz odsiany', internals.parseRows('[{"name":"9","x":"a","y":17.0,"k":1}]'), null);

// ─── Odpytywanie nieznanych linii nie wywraca się ─────────────────────────

describe('Linie spoza rozkładu');
expect('nieznana linia = pusta lista', liveTracker.snapshot('ZZZ'), []);
expect('snapshot bez argumentu to tablica', Array.isArray(liveTracker.snapshot()), true);
expect('lookup nieznanego id = undefined', liveTracker.lookup('nope'), undefined);
expect('mała litera linii = wielka', liveTracker.snapshot('a'), liveTracker.snapshot('A'));

describe('Pozycja na rozwijanej liście przystanków');
const routeStops: LegStop[] = [
  { stopId: 'a', name: 'Start', lat: 51.1, lon: 17, seq: 1 },
  { stopId: 'b', name: 'Środek', lat: 51.105, lon: 17, seq: 2 },
  { stopId: 'c', name: 'Koniec', lat: 51.11, lon: 17, seq: 3 },
];
const routeLeg: Leg = {
  id: 'route-test',
  mode: 'tram',
  line: '4',
  fromStop: 'Start',
  toStop: 'Koniec',
  departAt: '09:55',
  arriveAt: '10:15',
  stopsCount: 2,
  live: true,
  fromStopId: 'a',
  toStopId: 'c',
};
const routeNow = new Date(2026, 9, 10, 10, 0).getTime();
expect(
  'świeży pojazd po nazwach przystanków wskazuje właściwą przerwę',
  locateLiveStopPosition(routeStops, routeLeg, {
    vehicleId: '4-1',
    line: '4',
    lat: 51.1075,
    lon: 17,
    delaySec: 0,
    currentStopName: 'Środek',
    nextStopName: 'Koniec',
    matchedTripId: 'trip-4',
    updatedAt: routeNow,
  }, null, routeNow),
  { gap: 1, source: 'vehicle', atStopIndex: null, passedStopIndex: 1, marker: { index: 1, placement: 'between' } },
);
expect(
  'dokładny, poruszający się GPS na trasie koryguje brak pozycji API',
  locateLiveStopPosition(routeStops, routeLeg, null, {
    lat: 51.1075,
    lon: 17,
    accuracy: 8,
    speed: 6,
    heading: 0,
    timestamp: routeNow,
  }, routeNow),
  { gap: 1, source: 'device', atStopIndex: null, passedStopIndex: 1, marker: { index: 1, placement: 'between' } },
);
expect(
  'GPS daleko od trasy zostaje odrzucony i spada na szacunek z rozkładu',
  locateLiveStopPosition(routeStops, routeLeg, null, {
    lat: 51.1075,
    lon: 17.003,
    accuracy: 8,
    speed: 6,
    heading: 0,
    timestamp: routeNow,
  }, routeNow),
  { gap: 0, source: 'estimate', atStopIndex: null, passedStopIndex: 0, marker: { index: 0, placement: 'between' } },
);
expect(
  'pasażer w jadącym tramwaju wygrywa z feedem twierdzącym co innego',
  locateLiveStopPosition(
    routeStops,
    routeLeg,
    {
      vehicleId: '4-2',
      line: '4',
      lat: 51.1025,
      lon: 17,
      delaySec: 0,
      currentStopName: 'Start',
      nextStopName: 'Środek',
      matchedTripId: 'trip-4',
      updatedAt: routeNow,
    },
    {
      // Łuk torowiska: ~70 m od prostej między słupkami, wciąż w korytarzu.
      lat: 51.1075,
      lon: 17.001,
      accuracy: 8,
      speed: 6,
      heading: 0,
      timestamp: routeNow,
    },
    routeNow,
  ),
  { gap: 1, source: 'device', atStopIndex: null, passedStopIndex: 1, marker: { index: 1, placement: 'between' } },
);
const lateNow = new Date(2026, 9, 10, 10, 24).getTime();
expect(
  'opóźniony pasażer nie wypada z okna własnej nogi',
  locateLiveStopPosition(
    routeStops,
    routeLeg,
    null,
    {
      lat: 51.1075,
      lon: 17,
      accuracy: 8,
      speed: 6,
      heading: 0,
      timestamp: lateNow,
    },
    lateNow,
  ),
  { gap: 1, source: 'device', atStopIndex: null, passedStopIndex: 1, marker: { index: 1, placement: 'between' } },
);
expect(
  'wolny GPS nie udaje pozycji jadącego pojazdu (leci szacunek z rozkładu)',
  locateLiveStopPosition(routeStops, routeLeg, null, {
    lat: 51.1075,
    lon: 17,
    accuracy: 8,
    speed: 0.5,
    heading: 0,
    timestamp: routeNow,
  }, routeNow),
  { gap: 0, source: 'estimate', atStopIndex: null, passedStopIndex: 0, marker: { index: 0, placement: 'between' } },
);
expect(
  'bez API i bez GPS zostaje szacunek z rozkładu (1/4 kursu = gap 0)',
  locateLiveStopPosition(routeStops, routeLeg, null, null, routeNow),
  { gap: 0, source: 'estimate', atStopIndex: null, passedStopIndex: 0, marker: { index: 0, placement: 'between' } },
);
expect(
  'szacunek w połowie kursu wskazuje środkową przerwę',
  locateLiveStopPosition(
    routeStops,
    routeLeg,
    null,
    null,
    new Date(2026, 9, 10, 10, 5).getTime(),
  ),
  { gap: 1, source: 'estimate', atStopIndex: null, passedStopIndex: 1, marker: { index: 1, placement: 'between' } },
);
expect(
  'szacunek przed odjazdem stawia ikonę przed przystankiem startowym (gap -1)',
  locateLiveStopPosition(
    routeStops,
    routeLeg,
    null,
    null,
    new Date(2026, 9, 10, 9, 50).getTime(),
  ),
  { gap: -1, source: 'estimate', atStopIndex: null, passedStopIndex: -1, marker: null },
);
expect(
  'szacunek dawno po odjeździe nie udaje pozycji (kurs za 3 godziny)',
  locateLiveStopPosition(
    routeStops,
    routeLeg,
    null,
    null,
    new Date(2026, 9, 10, 7, 0).getTime(),
  ),
  null,
);

describe('Szacunek z rozkładu pełnego kursu');
const H = (h: number, m: number) => h * 3600 + m * 60;
const tripStops = (prefix: string, startMin: number): LegStop[] =>
  Array.from({ length: 8 }, (_, i) => ({
    stopId: `${prefix}${i}`,
    name: `${prefix} ${i}`,
    lat: 51.1 + i * 0.003,
    lon: 17,
    seq: i + 1,
    arriveSec: H(9, startMin + i * 2),
    departSec: H(9, startMin + i * 2),
  }));
const firstTrip = tripStops('A', 40);
const secondTrip = tripStops('B', 50);
const firstLeg: Leg = {
  ...routeLeg,
  id: 'transfer-1',
  fromStop: 'A 2',
  toStop: 'A 6',
  fromStopId: 'A2',
  toStopId: 'A6',
  departAt: '09:44',
  arriveAt: '09:52',
};
const secondLeg: Leg = {
  ...routeLeg,
  id: 'transfer-2',
  fromStop: 'B 4',
  toStop: 'B 7',
  fromStopId: 'B4',
  toStopId: 'B7',
  departAt: '09:58',
  arriveAt: '10:04',
};
const transferNow = new Date(2026, 9, 10, 9, 47).getTime();
expect(
  'pierwsza noga w trakcie jazdy: pojazd za przystankiem A 3',
  locateLiveStopPosition(firstTrip, firstLeg, null, null, transferNow),
  { gap: 3, source: 'estimate', atStopIndex: null, passedStopIndex: 3, marker: { index: 3, placement: 'between' } },
);
expect(
  'druga noga przed odjazdem: kurs jeszcze nie ruszył',
  locateLiveStopPosition(secondTrip, secondLeg, null, null, transferNow),
  { gap: -1, source: 'estimate', atStopIndex: null, passedStopIndex: -1, marker: null },
);
expect(
  'druga noga: pojazd dwa przystanki przed wsiadaniem',
  locateLiveStopPosition(secondTrip, secondLeg, null, null, new Date(2026, 9, 10, 9, 55).getTime()),
  { gap: 2, source: 'estimate', atStopIndex: null, passedStopIndex: 2, marker: null },
);
expect(
  'opóźnienie z efektywnego odjazdu przesuwa szacunek',
  locateLiveStopPosition(secondTrip, { ...secondLeg, departAt: '10:02' }, null, null, new Date(2026, 9, 10, 9, 55).getTime()),
  { gap: 0, source: 'estimate', atStopIndex: null, passedStopIndex: 0, marker: null },
);

describe('Monotoniczność i zaliczanie przystanków dopiero po przejechaniu dalej');
// 1. Pojazd stoi na przystanku Środek (index 1) - przystanek NIE może być zaliczony
const atStopPos = locateLiveStopPosition(routeStops, routeLeg, {
  vehicleId: '4-1',
  line: '4',
  lat: 51.105, // dokładnie na przystanku Środek
  lon: 17,
  delaySec: 0,
  currentStopName: 'Środek',
  nextStopName: 'Koniec',
  matchedTripId: 'trip-4',
  updatedAt: routeNow,
}, null, routeNow);

expect(
  'pojazd na przystanku: atStopIndex wskazuje ten przystanek',
  atStopPos?.atStopIndex,
  1,
);
expect(
  'pojazd na przystanku: przystanek nie jest jeszcze zaliczony (passedStopIndex = 0)',
  atStopPos?.passedStopIndex,
  0,
);
expect(
  'pojazd na przystanku: marker jest wycentrowany na przystanku (placement: at_stop)',
  atStopPos?.marker,
  { index: 1, placement: 'at_stop' },
);

// 2. Pojazd rusza i odjeżdża w trasę (index 1 -> index 2)
const departedPos = locateLiveStopPosition(routeStops, routeLeg, {
  vehicleId: '4-1',
  line: '4',
  lat: 51.108, // 300m za przystankiem Środek w stronę Końca
  lon: 17,
  delaySec: 0,
  currentStopName: 'Środek',
  nextStopName: 'Koniec',
  matchedTripId: 'trip-4',
  updatedAt: routeNow,
}, null, routeNow);

expect(
  'po odjeździe: atStopIndex jest null',
  departedPos?.atStopIndex,
  null,
);
expect(
  'po odjeździe: przystanek zostaje zaliczony (passedStopIndex = 1)',
  departedPos?.passedStopIndex,
  1,
);
expect(
  'po odjeździe: marker przeskakuje na linię między przystankami (placement: between)',
  departedPos?.marker,
  { index: 1, placement: 'between' },
);

// 3. Monotoniczność: GPS skacze z powrotem na przystanek (szum pomiarowy)
const rankAfterDeparture = positionToRank(departedPos); // rank = 3
const jitterPos = locateLiveStopPosition(routeStops, routeLeg, {
  vehicleId: '4-1',
  line: '4',
  lat: 51.105, // GPS znowu zaraportował współrzędne przystanku Środek
  lon: 17,
  delaySec: 0,
  currentStopName: 'Środek',
  nextStopName: 'Koniec',
  matchedTripId: 'trip-4',
  updatedAt: routeNow + 2000,
}, null, routeNow + 2000, rankAfterDeparture);

expect(
  'monotoniczność zapobiega cofaniu: ranking nie spada',
  positionToRank(jitterPos),
  rankAfterDeparture,
);
expect(
  'monotoniczność zapobiega cofaniu: przystanek nadal pozostaje zaliczony',
  jitterPos?.passedStopIndex,
  1,
);
expect(
  'monotoniczność zapobiega cofaniu: marker nie wraca do tyłu',
  jitterPos?.marker,
  { index: 1, placement: 'between' },
);

// 4. Monotoniczność zapobiega znikaniu: brak pozycji w API utrzymuje ostatni stan
const droppedPos = locateLiveStopPosition(
  routeStops,
  routeLeg,
  null, // chwilowy brak odpowiedzi z API
  null,
  routeNow + 5000,
  rankAfterDeparture,
);
expect(
  'chwilowy drop z feedu nie powoduje znikania markera',
  droppedPos?.marker,
  { index: 1, placement: 'between' },
);

// ─── zbiorkom.live: mapowanie odpowiedzi ─────────────────────────────────

async function main(): Promise<void> {
describe('zbiorkom.live: parsowanie pozycji');
const realFetch = globalThis.fetch;
function stubFetchOnce(body: unknown, ok = true): void {
  globalThis.fetch = (async () => ({ ok, json: async () => body })) as unknown as typeof fetch;
}
const wroclawBody = {
  positions: [
    {
      vehicle: { id: '9247', type: '3', agency: 'default' },
      routeName: '612',
      brigade: '32',
      location: [16.98, 51.03],
      timestamp: 1791643596000,
      delay: 847000,
      headsign: 'Krzyki',
      upcomingStops: [],
    },
    {
      vehicle: { id: 'T123', type: '0', agency: 'default' },
      routeName: '1',
      brigade: '7',
      location: [17.0, 51.1],
      timestamp: 1791643596000,
      delay: 0,
      headsign: 'Biskupin',
      upcomingStops: [],
    },
    // Śmieci nie przechodzą: brak linii, brak id, zerowa pozycja.
    { vehicle: { id: 'x', type: '3' }, routeName: '', brigade: '', location: [17, 51] },
    { vehicle: { id: '', type: '3' }, routeName: '100', brigade: '', location: [17, 51] },
    { vehicle: { id: 'y', type: '3' }, routeName: '100', brigade: '', location: [0, 0] },
  ],
};
stubFetchOnce(wroclawBody);
const zbRows = await fetchZbWroclawRows();
expect('fallback zwraca 2 wiersze (śmieci odcięte)', zbRows?.length, 2);
expect('bus: nazwa linii', zbRows?.[0].name, '612');
expect('bus: typ', zbRows?.[0].type, 'bus');
expect('bus: x to szerokość', zbRows?.[0].x, 51.03);
expect('bus: y to długość', zbRows?.[0].y, 16.98);
expect('tram z type 0', zbRows?.[1].type, 'tram');
expect('k to string fleet number', zbRows?.[0].k, '9247');
expect('czas próbki trafia do matchera', zbRows?.[0].timestamp, 1791643596000);
expect('kierunek trafia do matchera', zbRows?.[0].headsign, 'Krzyki');
expect('brygada trafia do matchera', zbRows?.[0].brigade, '32');
expect('opóźnienie trafia do matchera w sekundach', zbRows?.[0].delaySec, 847);
stubFetchOnce({}, false);
expect('HTTP nie-OK = null (sygnał do dalszego fallbacku)', await fetchZbWroclawRows(), null);

const kdBody = {
  positions: [
    {
      vehicle: { id: '48WEc-040', type: '2', agency: 'KD' },
      routeName: 'D30',
      brigade: '67604',
      location: [17.038129, 51.097549],
      timestamp: 1791643584000,
      delay: 17000,
      headsign: 'Leszno',
      upcomingStops: [
        { sequence: 0, name: 'Wrocław Główny', scheduledArrival: 1791643800000, scheduledDeparture: 1791643800000 },
        { sequence: 1, name: 'Wrocław Mikołajów', scheduledArrival: 1791644050000, scheduledDeparture: 1791644110000 },
      ],
    },
  ],
};
stubFetchOnce(kdBody);
const kd = await fetchZbKd();
expect('KD: jeden pojazd', kd?.length, 1);
expect('KD: numer pociągu z brygady', kd?.[0].trainNumber, '67604');
expect('KD: linia D informacyjnie', kd?.[0].line, 'D30');
expect('KD: delay ms → s', kd?.[0].delaySec, 17);
expect('KD: lat z location[1]', kd?.[0].lat, 51.097549);
expect('KD: current stop', kd?.[0].currentStopName, 'Wrocław Główny');
expect('KD: next stop', kd?.[0].nextStopName, 'Wrocław Mikołajów');
expect('KD: dwa postoje do matchowania', kd?.[0].stops.length, 2);
globalThis.fetch = realFetch;

// ─── zbiorkom.live: spinanie KD z lokalnym rozkładem ────────────────────────

describe('zbiorkom.live: matchowanie KD');
gtfsStore.routes.set('KD:R:1:2', { route_short_name: '67604' });
gtfsStore.stops.set('KD:S:1', { stop_name: 'Wrocław Główny' });
gtfsStore.stops.set('KD:S:2', { stop_name: 'Wrocław Mikołajów' });
gtfsStore.stopTimes.set('KD:T:1:2:20261010', [
  { stop_id: 'KD:S:1', departure_sec: 36000, arrival_sec: 36000 },
  { stop_id: 'KD:S:2', departure_sec: 36300, arrival_sec: 36300 },
]);
const kdIndex = {
  stopRoutes: new Map(),
  routeStops: new Map(),
  routeTrips: new Map(),
  patterns: new Map([
    ['KD:P:1', { routeId: 'KD:R:1:2', trips: [{ trip_id: 'KD:T:1:2:20261010' }] }],
  ]),
};
const mkVeh = (over: Partial<ZbKdVehicle>): ZbKdVehicle => ({
  id: '48WEc-040',
  trainNumber: '67604',
  line: 'D30',
  lat: 51.09,
  lon: 17.03,
  delaySec: 60,
  updatedAt: Date.now(),
  currentStopName: 'Wrocław Główny',
  nextStopName: 'Wrocław Mikołajów',
  stops: [
    { name: 'Wrocław Główny', schedSec: 36000 },
    { name: 'Wrocław Mikołajów', schedSec: 36300 },
  ],
  ...over,
});
expect('znany numer + zgodne postoje = trip', matchZbKd(mkVeh({}), kdIndex)?.tripId, 'KD:T:1:2:20261010');
expect('nieznany numer = null', matchZbKd(mkVeh({ trainNumber: '99999' }), kdIndex), null);
expect('brak postojów = null', matchZbKd(mkVeh({ stops: [] }), kdIndex), null);
expect(
  'dryf czasu >10 min = null (inny kurs tego składu)',
  matchZbKd(mkVeh({ stops: [{ name: 'Wrocław Główny', schedSec: 36000 + 3600 }] }), kdIndex),
  null,
);
expect(
  'obca nazwa postoju = null',
  matchZbKd(mkVeh({ stops: [{ name: 'Poznań Główny', schedSec: 36000 }] }), kdIndex),
  null,
);
gtfsStore.routes.delete('KD:R:1:2');
gtfsStore.stops.delete('KD:S:1');
gtfsStore.stops.delete('KD:S:2');
gtfsStore.stopTimes.delete('KD:T:1:2:20261010');

// ─── LiveTracker.subscribe ──────────────────────────────────────────────
describe('LiveTracker: subskrypcje zdarzeń');
let notified = 0;
const unsub = liveTracker.subscribe(() => {
  notified++;
});
liveTracker.reset();
expect('reset wywołuje listener', notified, 1);
unsub();
liveTracker.reset();
expect('po unsub listener nie jest wywoływany', notified, 1);

// ─── findNearestStopOnRoute ─────────────────────────────────────────────
describe('findNearestStopOnRoute: wyszukiwanie najbliższego przystanku');
const testStops: LegStop[] = [
  { stopId: 's1', name: 'Rynek', lat: 51.11, lon: 17.03, seq: 1 },
  { stopId: 's2', name: 'granica Wrocław - Długołęka', lat: 51.115, lon: 17.035, seq: 2 },
  { stopId: 's3', name: 'Plac Bema', lat: 51.12, lon: 17.04, seq: 3 },
  { stopId: 's4', name: 'Kromera', lat: 51.13, lon: 17.06, seq: 4 },
];

expect('brak pojazdu = null', findNearestStopOnRoute(testStops, null), null);
expect('pusta lista przystanków = null', findNearestStopOnRoute([], { lat: 51.11, lon: 17.03 } as any), null);

// GPS blisko Rynku (~100m)
expect(
  'GPS blisko przystanku wskazuje ten przystanek',
  findNearestStopOnRoute(testStops, { lat: 51.1105, lon: 17.0305 } as any)?.name,
  'Rynek',
);

// GPS najbliżej granicy stref biletowych (ale granica jest odfiltrowywana)
expect(
  'granica stref biletowych jest pomijana przy wyliczaniu najbliższego przystanku',
  findNearestStopOnRoute(testStops, { lat: 51.1152, lon: 17.0351 } as any)?.name,
  'Plac Bema',
);

// GPS > 3km z matchingiem po currentStopName
expect(
  'GPS daleko ale znany currentStopName = właściwy przystanek',
  findNearestStopOnRoute(testStops, { lat: 52.0, lon: 18.0, currentStopName: 'Plac Bema' } as any)?.name,
  'Plac Bema',
);

// GPS null ale znany nextStopName
expect(
  'brak GPS ale znany nextStopName = właściwy przystanek',
  findNearestStopOnRoute(testStops, { nextStopName: 'Kromera' } as any)?.name,
  'Kromera',
);

// GPS > 3km bez dopasowania po nazwie = null
expect(
  'GPS > 3km i obca nazwa = null',
  findNearestStopOnRoute(testStops, { lat: 52.0, lon: 18.0, currentStopName: 'Warszawa Centralna' } as any),
  null,
);

// ─── Podsumowanie ─────────────────────────────────────────────────────────

console.log(`\n${'='.repeat(52)}`);
if (failures.length === 0) {
  console.log(`WSZYSTKO OK - ${passed} asercji`);
} else {
  console.log(`NIEPOWODZENIA (${failures.length} z ${passed + failures.length}):`);
  for (const f of failures) console.log(`  - ${f}`);
}
process.exit(failures.length === 0 ? 0 : 1);
}

void main();
