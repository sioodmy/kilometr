/**
 * Jakość tras RAPTOR-a na małych, ręcznie zbudowanych sieciach.
 *
 * Uruchomienie: `npm run check:routing`
 *
 * Każdy scenariusz to pułapka, w którą wpadał planer liczący sam
 * najwcześniejszy przyjazd: wysiadanie przystanek przed celem, przejście
 * pieszo przy przesiadce, choć pierwszy kurs tam dojeżdża, i opóźnienie
 * doklejane na stałe do całej trasy.
 */

import { LocalGtfsStore, gtfsStore } from '../src/services/routing/store';
import { resolveCandidateOrigins } from '../src/services/routing/engine';
import { runRaptor, costParamsFor } from '../src/services/routing/raptor';
import { predictDelaySec } from '../src/services/routing/delays';
import type { RawJourney, RouteStyle } from '../src/services/routing/types';

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

const hms = (h: number, m: number, s = 0) => h * 3600 + m * 60 + s;
const fmt = (sec: number) =>
  `${String(Math.floor(sec / 3600)).padStart(2, '0')}:${String(Math.floor((sec % 3600) / 60)).padStart(2, '0')}:${String(sec % 60).padStart(2, '0')}`;

/** 400 m na północ przy 51° szerokości. */
const STEP_LAT = 0.0036;
/** 200 m na wschód przy 51° szerokości. */
const STEP_LON_200 = 0.00286;

interface TestStore {
  stops: Map<string, any>;
  routes: Map<string, any>;
  trips: Map<string, any>;
  stopTimes: Map<string, any[]>;
  buildPatterns(byRoute: Map<string, any[]>): any;
  buildFootpaths(): void;
  findNearestStops(lat: number, lon: number, maxDistanceMeters?: number, limit?: number): any[];
}

interface Line {
  id: string;
  type: number;
  trips: Array<{ id: string; times: Array<[stopId: string, sec: number]> }>;
}

function makeNet(stops: Array<[id: string, lat: number, lon: number]>, lines: Line[]) {
  const store = new LocalGtfsStore() as unknown as TestStore;
  for (const [id, lat, lon] of stops) {
    store.stops.set(id, { stop_id: id, stop_code: '', stop_name: id, stop_lat: lat, stop_lon: lon, normalized_name: id });
  }
  store.buildFootpaths();
  const byRoute = new Map<string, any[]>();
  for (const line of lines) {
    store.routes.set(line.id, { route_id: line.id, route_short_name: line.id, route_long_name: '', route_type: line.type });
    const trips: any[] = [];
    for (const t of line.trips) {
      const trip = { trip_id: t.id, route_id: line.id, service_id: 'wd', trip_headsign: '', direction_id: 0 };
      store.trips.set(t.id, trip);
      store.stopTimes.set(
        t.id,
        t.times.map(([stop_id, sec], i) => ({ trip_id: t.id, stop_id, arrival_sec: sec, departure_sec: sec, stop_sequence: i })),
      );
      trips.push(trip);
    }
    byRoute.set(line.id, trips);
  }
  return { store, index: store.buildPatterns(byRoute) };
}

function near(store: TestStore, lat: number, lon: number) {
  return store.findNearestStops(lat, lon, 800, 80).map((n: any) => ({
    stopId: n.stop.stop_id,
    walkM: n.distanceM,
    walkSec: Math.max(30, Math.round((n.distanceM * 1.15) / 1.34)),
  }));
}

const transit = (j: RawJourney) => j.segments.filter((s) => s.type === 'transit');
const describe = (j: RawJourney | undefined) =>
  j
    ? j.segments
        .map((s) => (s.type === 'walk' ? `pieszo ${s.walkMeters ?? 0} m` : `${s.line} ${s.fromStopId}>${s.toStopId}`))
        .join(', ')
    : 'brak';

function best(journeys: RawJourney[]): RawJourney | undefined {
  return [...journeys].sort((a, b) => a.arrivalSec - b.arrivalSec || b.departureSec - a.departureSec)[0];
}

// ─── Zostań w tramwaju zamiast wysiadać przystanek wcześniej ───────────────

head('Wysiadanie przy celu');
{
  // S3 -> S4 to objazd (400 s), a pieszo 400 m to ~343 s: pieszo wychodzi 57 s szybciej.
  const lat0 = 51.0;
  const lon = 17.0;
  const stops: Array<[string, number, number]> = [0, 1, 2, 3, 4].map((k) => [`S${k}`, lat0 + k * STEP_LAT, lon]);
  const trips: Line['trips'] = [];
  for (let start = hms(8, 0); start <= hms(9, 0); start += 600) {
    trips.push({
      id: `t_${start}`,
      times: [['S0', start], ['S1', start + 120], ['S2', start + 240], ['S3', start + 360], ['S4', start + 760]],
    });
  }
  const { store, index } = makeNet(stops, [{ id: '1', type: 0, trips }]);
  const origins = near(store, lat0, lon);
  const dests = near(store, lat0 + 4 * STEP_LAT, lon);
  for (const style of ['balanced', 'lessWalking', 'fewerTransfers'] as RouteStyle[]) {
    const js = runRaptor(store as any, origins, dests, hms(7, 59), {
      maxTransfers: 2,
      minTransferSec: 120,
      dayIndex: index,
      cost: costParamsFor(style),
    });
    const j = best(js.filter((x) => transit(x)[0]?.tripId === `t_${hms(8, 0)}`));
    check(`${style}: jedzie do S4`, transit(j!)?.[0]?.toStopId === 'S4', describe(j));
  }
}

// ─── Przesiadka bez zbędnego spaceru ───────────────────────────────────────

head('Przesiadka na przystanku, do którego dojeżdża pierwszy kurs');
{
  // A1 -> A2 to 300 s jazdy, a pieszo 200 m (+ zapas) to ~232 s. Oba warianty
  // łapią ten sam autobus B, więc wygrać ma jazda do A2 bez spaceru.
  const lat0 = 51.0;
  const lon0 = 17.1;
  const stops: Array<[string, number, number]> = [
    ['A0', lat0 - 0.009, lon0],
    ['A1', lat0, lon0],
    ['A2', lat0, lon0 + STEP_LON_200],
    ['B1', lat0 + 0.009, lon0 + STEP_LON_200],
  ];
  const { store, index } = makeNet(stops, [
    { id: '2', type: 0, trips: [{ id: 'a', times: [['A0', hms(8, 0)], ['A1', hms(8, 3)], ['A2', hms(8, 8)]] }] },
    { id: '140', type: 3, trips: [{ id: 'b', times: [['A2', hms(8, 11)], ['B1', hms(8, 16)]] }] },
  ]);
  const js = runRaptor(store as any, near(store, lat0 - 0.009, lon0), near(store, lat0 + 0.009, lon0 + STEP_LON_200), hms(7, 59), {
    maxTransfers: 2,
    minTransferSec: 120,
    dayIndex: index,
  });
  const j = best(js);
  const legs = j ? transit(j) : [];
  check('dwie nogi: tramwaj 2 i autobus 140', legs.length === 2 && legs[0].tripId === 'a' && legs[1].tripId === 'b', describe(j));
  check('tramwaj dowozi do A2', legs[0]?.toStopId === 'A2', describe(j));
  const between = j ? j.segments.slice(j.segments.indexOf(legs[0]) + 1, j.segments.indexOf(legs[1])) : [];
  check('brak spaceru między nogami', between.every((s) => s.type !== 'walk'), describe(j));
}

// ─── Prognoza nadrabiania opóźnień ─────────────────────────────────────────

head('Model opóźnień');
{
  check('pomiar na przystanku, który pojazd już minął', predictDelaySec(300, 0, 'board') === 300);
  check('wsiadanie: połowa po 15 min jazdy', predictDelaySec(300, 15 * 60, 'board') === 150);
  check('przyjazd maleje wolniej niż wsiadanie', predictDelaySec(300, 15 * 60, 'arrive') > predictDelaySec(300, 15 * 60, 'board'));
  check('przed czasem przy wsiadaniu: najwyżej 2 min', predictDelaySec(-400, 600, 'board') === -120);
  check('przed czasem przy wysiadaniu znika', Math.abs(predictDelaySec(-120, 30 * 60, 'arrive')) <= 2);
  check('zero to zero', predictDelaySec(0, 600, 'board') === 0);
}

head('Opóźnienie w RAPTOR-ze');
{
  // T1 ma teraz 5 min opóźnienia, ale do D1 jedzie jeszcze ~33 min, więc
  // większość nadrobi. Stałe +5 min obiecywało kurs, który odjedzie bez nas.
  const lat0 = 51.0;
  const lon = 17.2;
  const stops: Array<[string, number, number]> = [
    ['D0', lat0, lon],
    ['D1', lat0 + 4 * STEP_LAT, lon],
    ['D2', lat0 + 8 * STEP_LAT, lon],
  ];
  const { store, index } = makeNet(stops, [
    {
      id: '9',
      type: 0,
      trips: [
        { id: 'T1', times: [['D0', hms(8, 0)], ['D1', hms(8, 30)], ['D2', hms(8, 40)]] },
        { id: 'T2', times: [['D0', hms(8, 10)], ['D1', hms(8, 40)], ['D2', hms(8, 50)]] },
      ],
    },
  ]);
  const origins = near(store, lat0 + 4 * STEP_LAT, lon);
  const dests = near(store, lat0 + 8 * STEP_LAT, lon);
  const delays = new Map([['T1', 300]]);
  const base = { maxTransfers: 0, minTransferSec: 120, dayIndex: index, tripDelays: delays };
  const flat = best(runRaptor(store as any, origins, dests, hms(8, 33), base));
  check('bez prognozy: stałe +5 min daje T1', transit(flat!)[0]?.tripId === 'T1', describe(flat));
  const decayed = best(runRaptor(store as any, origins, dests, hms(8, 33), { ...base, nowSec: hms(8, 2) }));
  check('z prognozą: T1 nadrabia, planer wybiera T2', transit(decayed!)[0]?.tripId === 'T2', describe(decayed));
  const fresh = best(runRaptor(store as any, origins, dests, hms(8, 33), { ...base, nowSec: hms(8, 33), tripDelays: new Map([['T1', 300]]) }));
  check('pojazd tuż przed przystankiem: opóźnienie zostaje', transit(fresh!)[0]?.tripId === 'T1', describe(fresh));
  if (fresh) {
    const dep = transit(fresh)[0].departSec;
    check('odjazd z D1 po prognozie', dep > hms(8, 33) && dep <= hms(8, 35), fmt(dep));
  }
}

// ─── Okno odjazdów ─────────────────────────────────────────────────────────


head('Kotwica przystanku w planowaniu: limit dystansu spaceru');
{
  const lat0 = 51.0;
  const lon = 17.0;
  // Przystanek bliski (200 m)
  gtfsStore.stops.set('STOP_NEAR', { stop_id: 'STOP_NEAR', stop_lat: lat0 + STEP_LAT * 0.5, stop_lon: lon });
  // Przystanek w granicy +20% (np. ~540 m <= 600 m przy maxWalkM=500m)
  gtfsStore.stops.set('STOP_BORDER', { stop_id: 'STOP_BORDER', stop_lat: lat0 + STEP_LAT * 1.35, stop_lon: lon });
  // Przystanek daleko poza limitem (np. ~2000 m > 600 m)
  gtfsStore.stops.set('STOP_FAR', { stop_id: 'STOP_FAR', stop_lat: lat0 + STEP_LAT * 5.0, stop_lon: lon });

  // 1. Kotwica w granicach 120% limitu (STOP_BORDER z maxWalkM=500m)
  const originsWithBorder = resolveCandidateOrigins(lat0, lon, 500, 1.34, { stopId: 'STOP_BORDER' });
  const hasBorder = originsWithBorder.some((o) => o.stopId === 'STOP_BORDER');
  check('kotwica w granicach 120% limitu spaceru trafia do kandydatów', hasBorder);

  // 2. Kotwica daleko poza limitem 120% (STOP_FAR z maxWalkM=500m)
  const originsWithFar = resolveCandidateOrigins(lat0, lon, 500, 1.34, { stopId: 'STOP_FAR' });
  const hasFar = originsWithFar.some((o) => o.stopId === 'STOP_FAR');
  check('kotwica > 120% limitu spaceru NIE trafia do kandydatów', !hasFar);

  gtfsStore.stops.delete('STOP_NEAR');
  gtfsStore.stops.delete('STOP_BORDER');
  gtfsStore.stops.delete('STOP_FAR');
}

head('Range RAPTOR: wszystkie odjazdy w oknie');
{
  const lat0 = 51.0;
  const lon = 17.3;
  const stops: Array<[string, number, number]> = [
    ['E0', lat0, lon],
    ['E1', lat0 + 6 * STEP_LAT, lon],
  ];
  const trips: Line['trips'] = [];
  for (let start = hms(8, 0); start <= hms(9, 0); start += 300) {
    trips.push({ id: `e_${start}`, times: [['E0', start], ['E1', start + 600]] });
  }
  const { store, index } = makeNet(stops, [{ id: '33', type: 0, trips }]);
  const js = runRaptor(store as any, near(store, lat0, lon), near(store, lat0 + 6 * STEP_LAT, lon), hms(8, 0), {
    maxTransfers: 1,
    minTransferSec: 120,
    dayIndex: index,
    windowSec: 1800,
  });
  const tripIds = new Set(js.map((j) => transit(j)[0]?.tripId));
  check('każdy kurs z okna 30 min osobno', tripIds.size >= 6, `${tripIds.size} kursów`);
  const deps = js.map((j) => j.departureSec).sort((a, b) => a - b);
  check('najwcześniejszy odjazd na starcie okna', deps[0] <= hms(8, 0), fmt(deps[0] ?? 0));
}

console.log(`\n${'─'.repeat(60)}`);
if (failures.length) {
  console.log(`FAIL: ${failures.length} z ${passed + failures.length}`);
  for (const f of failures) console.log(`  ${f}`);
  process.exit(1);
}
console.log(`PASS: ${passed} asercji`);
