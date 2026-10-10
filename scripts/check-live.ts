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

import { liveTracker } from '../src/services/liveTracker';
import { fetchZbKd, fetchZbWroclawRows, matchZbKd, type ZbKdVehicle } from '../src/services/zbiorkom';
import { gtfsStore } from '../src/services/routing/store';

// ─── Framework asercji ─────────────────────────────────────────────────────

let passed = 0;
const failures: string[] = [];
let section = '';

function describe(name: string): void {
  section = name;
  console.log(`\n— ${name}`);
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

// ─── getTripDelays nie oddaje żywej mapy ──────────────────────────────────

describe('Opóźnienia dla RAPTOR-a');
const first = liveTracker.getTripDelays();
first.set('trip-hack', 999);
expect('zapis poza trackerem nie przecieka', liveTracker.getTripDelays().has('trip-hack'), false);
expect('każde wywołanie to nowa kopia', liveTracker.getTripDelays() === first, false);
expect('pusty tracker = pusta mapa', liveTracker.getTripDelays().size, 0);

// ─── Pusta odpowiedź to nie awaria ────────────────────────────────────────

describe('Rozróżnienie pustej odpowiedzi od awarii');
expect('pusty body = pusta lista', internals.parseRows(''), []);
expect('sam whitespace = pusta lista', internals.parseRows('   \n '), []);
expect('HTML zamiast JSON = null', internals.parseRows('<html>502</html>'), null);
expect('obiekt zamiast tablicy = null', internals.parseRows('{"error":1}'), null);
expect('poprawna tablica przechodzi', internals.parseRows('[{"name":"1","type":"tram","x":51.1,"y":17.0,"k":7}]'), [
  { name: '1', type: 'tram', x: 51.1, y: 17.0, k: 7 },
]);

// ─── Odpytywanie nieznanych linii nie wywraca się ─────────────────────────

describe('Linie spoza rozkładu');
expect('nieznana linia = pusta lista', liveTracker.snapshot('ZZZ'), []);
expect('snapshot bez argumentu to tablica', Array.isArray(liveTracker.snapshot()), true);
expect('lookup nieznanego id = undefined', liveTracker.lookup('nope'), undefined);
expect('mała litera linii = wielka', liveTracker.snapshot('a'), liveTracker.snapshot('A'));

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

// ─── Podsumowanie ─────────────────────────────────────────────────────────

console.log(`\n${'='.repeat(52)}`);
if (failures.length === 0) {
  console.log(`WSZYSTKO OK — ${passed} asercji`);
} else {
  console.log(`NIEPOWODZENIA (${failures.length} z ${passed + failures.length}):`);
  for (const f of failures) console.log(`  - ${f}`);
}
process.exit(failures.length === 0 ? 0 : 1);
}

void main();
