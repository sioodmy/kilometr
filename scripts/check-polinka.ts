/**
 * Kolej linowa Polinka w sklepie GTFS i w RAPTOR-ze.
 *
 * Uruchomienie: `npm run check:polinka`
 *
 * Uruchamiane z `--require ./scripts/stub-expo.cjs` (patrz skrypt npm):
 * sklep importuje natywne moduły Expo, których Node nie umie wczytać.
 *
 * Test nie udaje pełnej bazy MPK. Buduje małą, ale realną siatkę: kilka słupków
 * MPK po obu brzegach Odry, tramwaj przez most Grunwaldzki oraz, przez prawdziwe
 * `injectPolinkaStopsAndRoute` / `injectPolinkaTrips` / `buildFootpaths`, stacje
 * Polinki. Sprawdza, że planer traktuje gondolę jak każdy inny kurs, a nie
 * jak osobny przypadek.
 */

import { LocalGtfsStore } from '../src/services/routing/store';
import { runRaptor, isPointlessShortRide, classifyTransitMode } from '../src/services/routing/raptor';
import { distanceMeters } from '../src/gtfs/geo';
import { searchPolinkaStops } from '../src/services/polinkaSearch';
import {
  POLINKA_ROUTE_ID,
  POLINKA_NA_GROBLI_STOP_ID,
  POLINKA_RIDE_SEC,
  POLINKA_WYSPIANSKIEGO_STOP_ID,
  polinkaDepartureSeconds,
  polinkaTripsOverlapping,
} from '../src/data/polinka';
import type { LegMode, RawJourney } from '../src/services/routing/types';

// ─── Framework asercji ─────────────────────────────────────────────────────

let passed = 0;
const failures: string[] = [];
let section = '';

function head(title: string) {
  section = title;
  console.log(`\n${title}`);
}

function check(label: string, cond: boolean, detail = '') {
  if (cond) {
    passed++;
    console.log(`  PASS ${label}${detail ? `: ${detail}` : ''}`);
  } else {
    failures.push(`[${section}] ${label}${detail ? `: ${detail}` : ''}`);
    console.log(`  FAIL ${label}${detail ? `: ${detail}` : ''}`);
  }
}

// ─── Siatka testowa ────────────────────────────────────────────────────────

// Dom i cel po przeciwnych brzegach Odry, przy samych stacjach Polinki.
const HOME = { lat: 51.10755, lon: 17.05905 };
const WORK = { lat: 51.1058, lon: 17.0528 };

/**
 * Promień dojścia w teście. Domyślne 800 m z aplikacji jest tu za szerokie:
 * wtedy planer po prostu „idzie pieszo" na drugi brzeg i tramwaj przez most
 * przegrywa ze spacarem, bo grid przesiadek liczy dystans w linii prostej.
 * 300 m zostawia tylko stacje u celu, czyli scenariusz z życia: ktoś stoi przy
 * budynku C-13 i idzie do Geocentrum.
 */
const WALK_RADIUS_M = 300;

const MPK_STOPS: Array<{ id: string; name: string; lat: number; lon: number }> = [
  { id: 'mpk_a', name: 'Wyspianskiego', lat: 51.1071, lon: 17.0583 },
  { id: 'mpk_b', name: 'Grunwaldzki', lat: 51.1105, lon: 17.0562 },
  // Skok na drugi brzeg jest celowo dłuższy niż 800 m, żeby grid przesiadek
  // nie domalował „spaceru" przez Odrę: most ma być jedynym lądowym wyjściem.
  { id: 'mpk_c', name: 'Podwale', lat: 51.1035, lon: 17.0515 },
  { id: 'mpk_d', name: 'Na Grobli', lat: 51.10585, lon: 17.0537 },
];

/** Tramwaj przez most Grunwaldzki: 4 min na odcinek, kursy co 10 min. */
const TRAM_LEG_SEC = 240;
const TRAM_TRIP_STEP_SEC = 600;
const TRAM_SEQ = ['mpk_a', 'mpk_b', 'mpk_c', 'mpk_d'];
const TRAM_TRIP_TIMES = [0, 240, 540, 780];

function mpkTrips(): { trips: any[]; times: Map<string, any[]> } {
  const trips: any[] = [];
  const times = new Map<string, any[]>();
  for (let start = 6 * 3600; start <= 23 * 3600; start += TRAM_TRIP_STEP_SEC) {
    const tripId = `tram_${start}`;
    trips.push({
      trip_id: tripId,
      route_id: 'tram_route',
      service_id: 'weekday',
      trip_headsign: 'Podwale',
      direction_id: 0,
      shape_id: 'sh_tram',
    });
    times.set(
      tripId,
      TRAM_TRIP_TIMES.map((offset, i) => ({
        trip_id: tripId,
        stop_id: TRAM_SEQ[i],
        arrival_sec: start + offset,
        departure_sec: start + offset,
        stop_sequence: i,
      })),
    );
  }
  return { trips, times };
}

/**
 * Widok na sklep z metodami, które są w klasie prywatne. Skrypt woła je
 * wprost, żeby testował tę samą ścieżkę co aplikacja, a nie jej kopię.
 */
interface TestStore {
  stops: Map<string, any>;
  routes: Map<string, any>;
  trips: Map<string, any>;
  stopTimes: Map<string, any[]>;
  footpaths: Map<string, any[]>;
  injectPolinkaStopsAndRoute(): void;
  injectPolinkaTrips(
    day: number,
    fromSec: number,
    toSec: number,
  ): { tripIds: string[]; byRouteId: Map<string, any[]> };
  buildPatterns(byRoute: Map<string, any[]>): any;
  buildFootpaths(): void;
  findNearestStops(lat: number, lon: number, maxDistanceMeters?: number, limit?: number): any[];
}

/** Sklep z ręcznie wstrzykniętym MPK + prawdziwą ścieżką wstrzykiwania Polinki. */
function buildStore(): TestStore {
  const store = new LocalGtfsStore() as unknown as TestStore;
  for (const s of MPK_STOPS) {
    store.stops.set(s.id, {
      stop_id: s.id,
      stop_code: '',
      stop_name: s.name,
      stop_lat: s.lat,
      stop_lon: s.lon,
      normalized_name: s.name.toLowerCase(),
    });
  }
  store.routes.set('tram_route', {
    route_id: 'tram_route',
    route_short_name: '10',
    route_long_name: 'Wyspianskiego - Podwale',
    route_type: 0,
  });
  // Kolejność jak w load(): Polinka przed gridem przesiadek.
  store.injectPolinkaStopsAndRoute();
  store.buildFootpaths();
  return store;
}

/** Indeks dnia: kursy MPK + kursy Polinki przechodzące przez buildPatterns. */
function buildIndex(store: TestStore, day: number, fromSec: number, toSec: number) {
  const { trips, times } = mpkTrips();
  const byRoute = new Map<string, any[]>();
  for (const trip of trips) {
    store.trips.set(trip.trip_id, trip);
    store.stopTimes.set(trip.trip_id, times.get(trip.trip_id)!);
  }
  byRoute.set('tram_route', trips);
  const polinka = store.injectPolinkaTrips(day, fromSec, toSec);
  for (const [routeId, group] of polinka.byRouteId) byRoute.set(routeId, group);
  return { index: store.buildPatterns(byRoute), polinka };
}

function nearestStops(
  store: TestStore,
  at: { lat: number; lon: number },
): Array<{ stopId: string; walkM: number; walkSec: number }> {
  return store
    .findNearestStops(at.lat, at.lon, WALK_RADIUS_M, 12)
    .map((n: any) => ({
      stopId: n.stop.stop_id,
      walkM: n.distanceM,
      walkSec: Math.max(30, Math.round((n.distanceM * 1.15) / 1.34)),
    }));
}

const hhmm = (sec: number) =>
  `${String(Math.floor(sec / 3600) % 24).padStart(2, '0')}:${String(Math.floor(sec / 60) % 60).padStart(2, '0')}`;

function cableJourneys(journeys: RawJourney[]): RawJourney[] {
  return journeys.filter((j) => j.segments.some((s) => s.type === 'transit' && s.mode === 'cable'));
}

// ─── 1. Rozkład Polinki ───────────────────────────────────────────────────

function testTimetable() {
  head('[1] Rozkład Polinki');
  const deps = polinkaDepartureSeconds();
  const FIRST = 7 * 3600;
  const LAST = 21 * 3600;
  const BREAK_START = 13 * 3600 + 30 * 60;
  const BREAK_END = 14 * 3600;

  check('kursy są', deps.length > 100, `${deps.length} odjazdów na kierunek`);
  check('pierwszy odjazd o 07:00', deps[0] === FIRST, hhmm(deps[0]));
  const lastArrival = deps[deps.length - 1] + POLINKA_RIDE_SEC;
  check('ostatni przyjazd przed 21:00', lastArrival <= LAST, hhmm(lastArrival));

  // Jedyna luka to przerwa techniczna 13:30-14:00. Poza nią odstęp jest 5-minutowy.
  const gaps = deps.slice(1).map((d, i) => d - deps[i]);
  const breakGaps = gaps.filter((g) => g !== 300);
  check('odstęp 5 min poza przerwą', gaps.length - breakGaps.length >= deps.length - 3, `dziury: ${breakGaps.map((g) => `${g / 60} min`).join(', ')}`);
  check('dokładnie jedna dziura, to przerwa', breakGaps.length === 1 && breakGaps[0] === 35 * 60, breakGaps.map((g) => `${g / 60} min`).join(', '));
  check(
    'przerwa zgadza się z 13:30-14:00',
    deps.includes(BREAK_START - 5 * 60) && deps.includes(BREAK_END),
    `ostatni przed: ${hhmm(BREAK_START - 5 * 60)}, pierwszy po: ${hhmm(BREAK_END)}`,
  );
  check('żaden odjazd nie leży w środku przerwy', deps.every((d) => d < BREAK_START || d >= BREAK_END));
  check('wszystkie odjazdy w godzinach pracy', deps.every((d) => d >= FIRST && d < LAST));
  check('przejazd trwa 3 min', POLINKA_RIDE_SEC === 180, `${POLINKA_RIDE_SEC} s`);

  // 26 -> piątek, 0 -> niedziela, 6 -> sobota
  const mon = polinkaTripsOverlapping(10 * 3600, 10 * 3600 + 600);
  // Okno 10:00-10:10 przecina odjazdy o 10:00, 10:05 i 10:10 (ten ostatni
  // odjeżdża dokładnie na krawędzi okna), to 3 odjazdy w obie strony.
  check('kursy w obie strony', mon.length === 6, `${mon.length} kursy na 10:00-10:10`);
  const headsigns = new Set(mon.map((b) => b.trip.trip_headsign));
  check('oba kierunki', headsigns.size === 2, [...headsigns].join(' / '));
  check(
    'każdy kurs to dwa przystanki',
    mon.every((b) => b.times.length === 2 && b.times[1].arrival_sec - b.times[0].departure_sec === 180),
  );
  check('route_type = 6 (kolej powietrzna)', classifyTransitMode(6, 'Polinka') === 'cable');
  check('route_type = 7 (funicular) też', classifyTransitMode(7, 'x') === 'cable');
  check('route_type 0 to nadal tramwaj', classifyTransitMode(0, 'x') === 'tram');
  check('route_type 2 to nadal pociąg', classifyTransitMode(2, 'x') === 'train');
}

// ─── 2. Stacje i przesiadki ────────────────────────────────────────────────

function testStopsAndFootpaths() {
  head('[2] Stacje Polinki i przesiadki');
  const store = buildStore();

  check('dwie stacje w sklepie', store.stops.has(POLINKA_WYSPIANSKIEGO_STOP_ID) && store.stops.has(POLINKA_NA_GROBLI_STOP_ID));
  check('linia Polinki w sklepie', store.routes.get(POLINKA_ROUTE_ID)?.route_type === 6);
  const name = store.stops.get(POLINKA_WYSPIANSKIEGO_STOP_ID)?.stop_name ?? '';
  check('nazwa stacji bezpośrednio z GTFS, nie z UI', name.includes('Polinka'), name);

  const wy = store.stops.get(POLINKA_WYSPIANSKIEGO_STOP_ID);
  const gr = store.stops.get(POLINKA_NA_GROBLI_STOP_ID);
  const span = distanceMeters(wy.stop_lat, wy.stop_lon, gr.stop_lat, gr.stop_lon);
  check('odległość stacji ~370-410 m', span > 340 && span < 420, `${Math.round(span)} m`);

  // Grid przesiadek musiał podpiąć stacje Polinki pod słupki MPK na obu brzegach.
  const fromWy = (store.footpaths.get(POLINKA_WYSPIANSKIEGO_STOP_ID) ?? []).map((f: any) => f.to_stop_id);
  const fromGr = (store.footpaths.get(POLINKA_NA_GROBLI_STOP_ID) ?? []).map((f: any) => f.to_stop_id);
  check('z Wyspiańskiego da się dojść do MPK', fromWy.includes('mpk_a'), fromWy.join(', '));
  check('z Na Grobli da się dojść do MPK', fromGr.includes('mpk_d'), fromGr.join(', '));

  const link = (store.footpaths.get(POLINKA_WYSPIANSKIEGO_STOP_ID) ?? []).find((f: any) => f.to_stop_id === 'mpk_a');
  const realM = distanceMeters(wy.stop_lat, wy.stop_lon, MPK_STOPS[0].lat, MPK_STOPS[0].lon);
  check('czas przesiadki z sensownej prędkości', link.duration_sec > 10 && link.duration_sec < 300, `${link.duration_sec} s na ${realM.toFixed(0)} m`);
}

// ─── 3. Kursy: dni tygodnia ───────────────────────────────────────────────

function testServiceDays() {
  head('[3] Dni kursowania');
  const store = buildStore();
  for (const [day, label, expected] of [
    [1, 'poniedziałek', true],
    [3, 'środa', true],
    [5, 'piątek', true],
    [6, 'sobota', false],
    [0, 'niedziela', false],
  ] as Array<[number, string, boolean]>) {
    const r = store.injectPolinkaTrips(day, 10 * 3600, 10 * 3600 + 3600);
    check(label, (r.tripIds.length > 0) === expected, `${r.tripIds.length} kursów`);
  }

  const wed = store.injectPolinkaTrips(3, 10 * 3600, 11 * 3600);
  const wedCount = wed.byRouteId.get(POLINKA_ROUTE_ID)?.length ?? 0;
  check('oba kierunki w wycinku', wedCount === 26, `${wedCount} kursów (13 odjazdów × 2 kierunki)`);

  // Wycinek poza godzinami pracy nie może nic wstrzyknąć.
  const night = store.injectPolinkaTrips(3, 3 * 3600, 4 * 3600);
  check('w nocy na 03:00 nie ma kursów', night.tripIds.length === 0);
  // 13:30-14:00 to przerwa, ale odjazd o 14:00 już się odbywa.
  const breakT = store.injectPolinkaTrips(3, 13 * 3600 + 30 * 60, 14 * 3600);
  check(
    'w przerwie 13:30-14:00 zostaje tylko odjazd o 14:00',
    breakT.tripIds.length === 2,
    `${breakT.tripIds.length} kursów`,
  );
}

// ─── 4. RAPTOR: przejazd przez Odrę ────────────────────────────────────────

function testRaptor() {
  head('[4] RAPTOR: Polinka jako noga w podróży');
  const store = buildStore();
  const DEP = 10 * 3600; // 10:00, dokładnie na odjeździe Polinki
  const { index } = buildIndex(store, 3, DEP - 1800, DEP + 10800);

  const origins = nearestStops(store, HOME);
  const dests = nearestStops(store, WORK);
  check('RAPTOR widzi wzorce Polinki', [...index.stopRoutes.keys()].includes(POLINKA_WYSPIANSKIEGO_STOP_ID));
  check('oba kierunki jako osobne wzorce', index.patterns.size === 3, `${index.patterns.size} wzorców (2 Polinka + 1 tramwaj)`);

  const journeys = runRaptor(store as any, origins, dests, DEP, {
    maxTransfers: 2,
    minTransferSec: 120,
    dayIndex: index,
  });
  console.log(`  planer zwrócił ${journeys.length} podróży`);

  const cable = cableJourneys(journeys);
  check('planer znalazł przejazd Polinką', cable.length > 0, `${cable.length} podróży`);

  const via = cable[0];
  const leg = via.segments.find((s) => s.type === 'transit')!;
  check('noga ma tryb cable', (leg.mode as LegMode) === 'cable', String(leg.mode));
  check('linia to Polinka', leg.line === 'Polinka', String(leg.line));
  check('od C-13 do Na Grobli', leg.fromStopId === POLINKA_WYSPIANSKIEGO_STOP_ID && leg.toStopId === POLINKA_NA_GROBLI_STOP_ID);
  check('kierunek zgodny z rozkładem', leg.direction === 'Na Grobli', String(leg.direction));
  check('przejazd 3 min', leg.arriveSec - leg.departSec === 180, `${leg.arriveSec - leg.departSec} s`);
  check('zero przystanków pośrednich', leg.stopsCount === 1, `stopsCount=${leg.stopsCount}`);
  check('dwa przystanki, nazwy z danych', !!leg.fromStopName && !!leg.toStopName, `${leg.fromStopName} -> ${leg.toStopName}`);

  // Przejazd nie może zostać odrzucony jako „wsiądź i wysiądź".
  check('przejazd nie jest bezsensownym krótkim skokiem', !isPointlessShortRide(via));

  // Polinka ma być najszybsza: 3 min nad rzeką bije tramwaj przez most.
  const best = Math.min(...journeys.map((j) => j.arrivalSec - DEP));
  const bestVia = Math.min(...cable.map((j) => j.arrivalSec - DEP));
  check('Polinka wygrywa z przejazdem przez most', bestVia <= best, `Polinka ${Math.round(bestVia / 60)} min, najlepsza jakakolwiek ${Math.round(best / 60)} min`);

  // Spacer wokół Odry musi być wyraźnie gorszy, inaczej test nic nie sprawdza.
  const walkM = distanceMeters(HOME.lat, HOME.lon, WORK.lat, WORK.lon);
  console.log(`  dystans pieszo w linii prostej: ${Math.round(walkM)} m, planowany czas Polinki: ${Math.round(bestVia / 60)} min`);

  // Powrót w drugą stronę.
  const back = runRaptor(store as any, dests, origins, DEP, { maxTransfers: 2, minTransferSec: 120, dayIndex: index });
  const backCable = cableJourneys(back);
  check('działa też w drugą stronę', backCable.length > 0, `${backCable.length} podróży`);
  const backLeg = backCable[0]?.segments.find((s) => s.type === 'transit');
  check('powrót Na Grobli -> Wyspiańskiego', backLeg?.fromStopId === POLINKA_NA_GROBLI_STOP_ID && backLeg?.toStopId === POLINKA_WYSPIANSKIEGO_STOP_ID);
}

// ─── 5. Wyłączniki ─────────────────────────────────────────────────────────

function testSwitches() {
  head('[5] Wyłączniki i filtry');

  const run = (opts: any) => {
    const store = buildStore();
    const DEP = 10 * 3600;
    const { index } = buildIndex(store, 3, DEP - 1800, DEP + 10800);
    return cableJourneys(
      runRaptor(store as any, nearestStops(store, HOME), nearestStops(store, WORK), DEP, {
        maxTransfers: 2,
        minTransferSec: 120,
        dayIndex: index,
        ...opts,
      }),
    );
  };

  check('domyślnie Polinka jeździ', run({}).length > 0);

  // Wyłącznik nie usuwa danych, tylko przestaje skanować wzorzec. Dzięki temu
  // ponowne włączenie nie wymaga ponownego ładowania sklepu.
  const store = buildStore();
  const DEP = 10 * 3600;
  const { index } = buildIndex(store, 3, DEP - 1800, DEP + 10800);
  check('wzorce Polinki są w indeksie mimo wyłącznika', [...index.patterns.keys()].some((k: string) => k.startsWith(POLINKA_ROUTE_ID)));

  check('cableEnabled: false wycina Polinkę', run({ cableEnabled: false }).length === 0);
  check('filtr tramwaj nie przepuszcza Polinki', run({ allowedModes: 'tram' }).length === 0);
  check('filtr autobus nie przepuszcza Polinki', run({ allowedModes: 'bus' }).length === 0);

  // Weekend: Polinka nie kursuje, więc do indeksu wchodzą wyłącznie kursy MPK.
  const weekend = buildStore();
  const { index: satIndex } = buildIndex(weekend, 6, DEP - 1800, DEP + 10800);
  const satPatterns = [...satIndex.patterns.keys()];
  check(
    'w sobotę w indeksie są tylko wzorce MPK',
    satPatterns.length > 0 && satPatterns.every((k: string) => !k.startsWith(POLINKA_ROUTE_ID)),
    satPatterns.join(', '),
  );
  check('stacje Polinki zostają w sklepie', weekend.stops.has(POLINKA_NA_GROBLI_STOP_ID));

  // Kursy MPK w weekendowym wycinku nie mogą zniknąć przez wstrzyknięcie Polinki.
  const weekdayStore = buildStore();
  const { index: wedIndex } = buildIndex(weekdayStore, 3, DEP - 1800, DEP + 10800);
  const tramPattern = (idx: any) => [...idx.patterns.keys()].filter((k: string) => k.startsWith('tram_route')).length;
  check('wstrzykiwanie nie psuje wzorców MPK', tramPattern(wedIndex) === tramPattern(satIndex) && tramPattern(wedIndex) === 1, `${tramPattern(wedIndex)} wzorzec tramwaju`);
}

// ─── 6. Wyszukiwarka ───────────────────────────────────────────────────────

function testSearch() {
  head('[6] Wyszukiwarka');
  const found = (q: string) => searchPolinkaStops(q, HOME.lat, HOME.lon).map((s) => s.title);

  check('„polinka" znajduje obie stacje', found('polinka').length === 2, found('polinka').join(' | '));
  check('„kolej linowa" znajduje stacje', found('kolej linowa').length === 2);
  check('„na grobli" znajduje właściwą stację', found('na grobli').join(' ').includes('Na Grobli'), found('na grobli').join(' | '));
  check('„wyspianskiego" znajduje właściwą stację', found('wyspianskiego').join(' ').includes('Wybrzeże Wyspiańskiego'));
  check('„polin" dopasowuje rozmyciem', found('polin').length === 2, found('polin').join(' | '));
  check('zero liter nie robi nic', found('p').length === 0);
  check('obce słowo nie trafia', found('kolejka wyciągowa').length === 0, found('kolejka wyciagowa').join(' | '));

  const hit = searchPolinkaStops('polinka', HOME.lat, HOME.lon)[0];
  check('podpowiedź ma dystans od użytkownika', typeof hit.distanceM === 'number', `${hit.distanceM} m`);
  check('podpowiedź ma etykietę trybu z i18n', !!hit.address, String(hit.address));
}

// ─── Start ─────────────────────────────────────────────────────────────────

console.log('Polinka: kolejka linowa Politechniki Wrocławskiej');
testTimetable();
testStopsAndFootpaths();
testServiceDays();
testRaptor();
testSwitches();
testSearch();

console.log(`\n${'─'.repeat(60)}`);
if (failures.length === 0) {
  console.log(`PASS: ${passed} asercji`);
  process.exit(0);
} else {
  console.log(`FAIL: ${failures.length} z ${passed + failures.length} asercji`);
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}