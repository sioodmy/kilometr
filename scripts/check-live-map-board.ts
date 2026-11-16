/**
 * Testy jednostkowe logiki mapy live: kolory WCAG AA, budowa przystankow z kierunkiem,
 * tablica odjazdow przystanku (w tym kursy nocne z offsetem) oraz lista przystankow i trasa pojazdu.
 *
 * Uruchomienie: `npx tsx --require ./scripts/stub-expo.cjs scripts/check-live-map-board.ts`
 */

import type { GtfsTrip } from '../src/gtfs/types';
import {
  buildLiveMapStops,
  buildSelectedVehicleRoute,
  getLiveMapModeColors,
  getStopDepartureBoard,
  getVehicleUpcomingBoard,
} from '../src/services/liveMapBoard';
import type { TrackedVehicle } from '../src/services/liveTracker';
import { resolveVehicleBearing } from '../src/services/onboardDetector';
import { projectRouteTangent } from '../src/services/routeGeometry';
import { mergeDayIndexes } from '../src/services/routing/raptor';
import { DayIndex, LocalGtfsStore } from '../src/services/routing/store';

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

function luminance(hex: string): number {
  const clean = hex.replace('#', '');
  const r = parseInt(clean.slice(0, 2), 16) / 255;
  const g = parseInt(clean.slice(2, 4), 16) / 255;
  const b = parseInt(clean.slice(4, 6), 16) / 255;
  const ch = (c: number) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
  return 0.2126 * ch(r) + 0.7152 * ch(g) + 0.0722 * ch(b);
}

function contrastRatio(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

interface StoreInternals {
  isLoaded: boolean;
  buildPatterns(byRoute: Map<string, GtfsTrip[]>): DayIndex;
}

function makeFixture(): { store: LocalGtfsStore; dayIndex: DayIndex; overnightMerged: { index: DayIndex; offsets: Map<string, number> } } {
  const store = new LocalGtfsStore();
  (store as unknown as StoreInternals).isLoaded = true;

  store.stops.set('S1', {
    stop_id: 'S1',
    stop_name: 'Dworzec Autobusowy',
    stop_code: '11321', normalized_name: 'dworzec autobusowy',
    stop_lat: 51.099,
    stop_lon: 17.036,
  });
  store.stops.set('S2', {
    stop_id: 'S2',
    stop_name: 'Galeria',
    stop_code: '11322', normalized_name: 'galeria',
    stop_lat: 51.099,
    stop_lon: 17.046,
  });
  store.stops.set('S3', {
    stop_id: 'S3',
    stop_name: 'Vivaldiego',
    stop_code: '11323', normalized_name: 'vivaldiego',
    stop_lat: 51.099,
    stop_lon: 17.056,
  });
  store.stops.set('S_REV', {
    stop_id: 'S_REV',
    stop_name: 'West',
    stop_code: '11324', normalized_name: 'west',
    stop_lat: 51.099,
    stop_lon: 17.026,
  });
  store.stops.set('S_BOUND', {
    stop_id: 'S_BOUND',
    stop_name: 'GRANICA A-B', stop_code: '', normalized_name: 'granica a-b',
    stop_lat: 51.1,
    stop_lon: 17.06,
  });

  store.routes.set('R145', {
    route_id: 'R145',
    route_short_name: '145',
    route_long_name: 'Dworzec - Vivaldiego',
    route_type: 3,
  });
  store.routes.set('R4', {
    route_id: 'R4',
    route_short_name: '4',
    route_long_name: 'Tramwaj 4',
    route_type: 0,
  });

  const t1: GtfsTrip = { trip_id: 'T1', route_id: 'R145', service_id: 'W', trip_headsign: 'Vivaldiego', direction_id: 0, shape_id: '' };
  const t2: GtfsTrip = { trip_id: 'T2', route_id: 'R4', service_id: 'W', trip_headsign: 'Oporow', direction_id: 0, shape_id: '' };
  const tRev: GtfsTrip = { trip_id: 'TREV', route_id: 'R145', service_id: 'W', trip_headsign: 'West', direction_id: 1, shape_id: '' };
  const tNight: GtfsTrip = { trip_id: 'TNIGHT', route_id: 'R145', service_id: 'W', trip_headsign: 'Nocny', direction_id: 0, shape_id: '' };

  store.trips.set('T1', t1);
  store.trips.set('T2', t2);
  store.trips.set('TREV', tRev);
  store.trips.set('TNIGHT', tNight);

  store.stopTimes.set('T1', [
    { trip_id: 'T1', stop_id: 'S1', stop_sequence: 1, arrival_sec: 36600, departure_sec: 36600 },
    { trip_id: 'T1', stop_id: 'S2', stop_sequence: 2, arrival_sec: 36900, departure_sec: 36900 },
    { trip_id: 'T1', stop_id: 'S3', stop_sequence: 3, arrival_sec: 37200, departure_sec: 37200 },
  ]);
  store.stopTimes.set('T2', [
    { trip_id: 'T2', stop_id: 'S1', stop_sequence: 1, arrival_sec: 36780, departure_sec: 36780 },
    { trip_id: 'T2', stop_id: 'S2', stop_sequence: 2, arrival_sec: 37080, departure_sec: 37080 },
  ]);
  store.stopTimes.set('TREV', [
    { trip_id: 'TREV', stop_id: 'S2', stop_sequence: 1, arrival_sec: 36700, departure_sec: 36700 },
    { trip_id: 'TREV', stop_id: 'S1', stop_sequence: 2, arrival_sec: 37000, departure_sec: 37000 },
    { trip_id: 'TREV', stop_id: 'S_REV', stop_sequence: 3, arrival_sec: 37300, departure_sec: 37300 },
  ]);
  // Nocny kurs z wczoraj: 24:15 (= 87300 s)
  store.stopTimes.set('TNIGHT', [
    { trip_id: 'TNIGHT', stop_id: 'S1', stop_sequence: 1, arrival_sec: 87300, departure_sec: 87300 },
    { trip_id: 'TNIGHT', stop_id: 'S2', stop_sequence: 2, arrival_sec: 87600, departure_sec: 87600 },
  ]);

  const byRoute = new Map<string, GtfsTrip[]>([
    ['R145', [t1]],
    ['R4', [t2]],
  ]);
  const dayIndex = (store as unknown as StoreInternals).buildPatterns(byRoute);

  const byRouteNight = new Map<string, GtfsTrip[]>([['R145', [tNight]]]);
  const overnightIdx = (store as unknown as StoreInternals).buildPatterns(byRouteNight);
  const emptyDay = (store as unknown as StoreInternals).buildPatterns(new Map());
  const overnightMerged = mergeDayIndexes(emptyDay, overnightIdx, 'y_', -86400);

  return { store, dayIndex, overnightMerged };
}

head('1. Kolory mapy live i kontrast WCAG AA');
for (const [mode, line, city] of [
  ['tram', '4', 'wroclaw'],
  ['bus', '145', 'wroclaw'],
  ['trolleybus', 'T1', 'gdynia'],
  ['train', 'D3', 'wroclaw'],
  ['train', 'IC', 'warszawa'],
  ['subway', 'M1', 'warszawa'],
  ['subway', 'M2', 'warszawa'],
  ['cable', 'P1', 'wroclaw'],
] as const) {
  const c = getLiveMapModeColors(mode, line, city);
  const ratio = contrastRatio(c.bg, c.fg);
  check(`${mode} ${line} kontrast >= 4.5`, ratio >= 4.5, `${c.bg}/${c.fg} = ${ratio.toFixed(2)}:1`);
}

head('2. Przystanki na mapie i kierunek odjazdu');
{
  const { store, dayIndex } = makeFixture();
  const stops = buildLiveMapStops(store, dayIndex, 'wroclaw');
  const s1 = stops.find((x) => x.id === 'S1');
  const sBound = stops.find((x) => x.id === 'S_BOUND');
  check('S1 zbudowany z trybem tram (wyzszy priorytet niz bus)', s1?.mode === 'tram', s1?.mode);
  check('S1 ma kierunek ~90 stopni na wschod', s1?.bearing != null && Math.abs(s1.bearing - 90) <= 5, String(s1?.bearing));
  check('granica taryfowa odfiltrowana', sBound === undefined);

  // Przeciwne kierunki na tym samym slupku nie rysuja mylacej strzalki
  const biRoute = new Map<string, GtfsTrip[]>([
    ['R145', [store.trips.get('T1')!, store.trips.get('TREV')!]],
  ]);
  const biIdx = (store as unknown as StoreInternals).buildPatterns(biRoute);
  const biStops = buildLiveMapStops(store, biIdx, 'wroclaw');
  const biS1 = biStops.find((x) => x.id === 'S1');
  check('przeciwne kierunki -> brak strzalki na przystanku', biS1?.bearing === undefined, String(biS1?.bearing));
}

head('3. Tablica odjazdow przystanku z opoznieniami i nocnym offsetem');
{
  const { store, dayIndex, overnightMerged } = makeFixture();
  const vehicles: TrackedVehicle[] = [
    {
      vehicleId: 'V_145',
      line: '145',
      type: 'bus',
      lat: 51.099,
      lon: 17.035,
      matchedTripId: 'T1',
      delaySec: 180,
      updatedAt: Date.now(),
    },
  ];
  const delays = new Map<string, number>([['T2', 0]]);
  const board = getStopDepartureBoard('S1', store, dayIndex, undefined, vehicles, delays, 36540, 'wroclaw');
  check('zwraca 2 odjazdy', board.length === 2, String(board.length));
  // T2 o 10:13 (+0 min) jest wczesniej niz T1 o 10:10 + 3 min (10:13 -> stabilnie lub po kolejnosci)
  const item145 = board.find((b) => b.line === '145');
  const item4 = board.find((b) => b.line === '4');
  check('145 ma +3 min opoznienia i vehicleId', item145?.delayMin === 3 && item145.vehicleId === 'V_145');
  check('4 ma 0 min (na czas) i live=true', item4?.delayMin === 0 && item4.live === true);

  // Nocny kurs 24:15 w oknie 00:10 (nowSec = 600)
  const nightBoard = getStopDepartureBoard(
    'S1',
    store,
    overnightMerged.index,
    overnightMerged.offsets,
    [],
    undefined,
    600,
    'wroclaw',
  );
  check('nocny kurs 24:15 z wczoraj mapowany na 00:15 (900s)', nightBoard.length === 1 && nightBoard[0].scheduledSec === 900);
}

head('4. Nastepne przystanki i trasa wybranego pojazdu');
{
  const { store } = makeFixture();
  const veh: TrackedVehicle = {
    vehicleId: 'V_145',
    line: '145',
    type: 'bus',
    lat: 51.099,
    lon: 17.041, // w polowie miedzy S1 (17.036) a S2 (17.046)
    matchedTripId: 'T1',
    delaySec: 120,
    updatedAt: Date.now(),
  };
  const upcoming = getVehicleUpcomingBoard(veh, store, 36700);
  check('pojazd miedzy S1 i S2 zaczyna od S2', upcoming.length === 2 && upcoming[0].stopId === 'S2', upcoming.map((u) => u.stopId).join(','));
  check('S2 oznaczony jako isNext i ma +2 min', upcoming[0].isNext && upcoming[0].expectedSec === 36900 + 120);

  const route = buildSelectedVehicleRoute(veh, store, null, 'wroclaw');
  check(
    'trasa wybranego kursu zawiera 3 przystanki i oznacza S1 passed, S2 isNext',
    route !== null &&
      route.stops.length === 3 &&
      route.stops[0].passed === true &&
      route.stops[1].isNext === true &&
      route.coords.length === 3,
  );

  // Fallback po wzorcu bez matchedTripId z rozroznieniem kierunku przez bearing
  const biRoute = new Map<string, GtfsTrip[]>([
    ['R145', [store.trips.get('T1')!, store.trips.get('TREV')!]],
  ]);
  const biIdx = (store as unknown as StoreInternals).buildPatterns(biRoute);
  const vehNoTrip: TrackedVehicle = {
    vehicleId: 'V_145_NOTRIP',
    line: '145',
    type: 'bus',
    lat: 51.099,
    lon: 17.041,
    delaySec: null,
    updatedAt: Date.now(),
  };
  const eastRoute = buildSelectedVehicleRoute(vehNoTrip, store, biIdx, 'wroclaw', 90);
  const westRoute = buildSelectedVehicleRoute(vehNoTrip, store, biIdx, 'wroclaw', 270);
  check(
    'fallback wzorca bez tripId wybiera kierunek zgodny z bearing',
    eastRoute?.tripId === 'T1' && westRoute?.tripId === 'TREV',
    `east=${eastRoute?.tripId}, west=${westRoute?.tripId}`,
  );
}

head('5. Styczna geometrii (PLK Float32) i kierunek kursow dwukierunkowych');
{
  // Symulacja 1.5 m punktow PLK na wschod (~90 deg) z szumem kwantyzacji Float32 +/-0.4 m
  const noisyEast: [number, number][] = [];
  for (let i = 0; i <= 120; i++) {
    const lon = 17.03 + i * 0.000021; // ~1.5 m na wschod
    const jitterLat = ((i % 2 === 0 ? 1 : -1) * 0.0000036); // +/-0.4 m szumu
    noisyEast.push([51.1 + jitterLat, lon]);
  }
  const tan = projectRouteTangent(noisyEast, 51.1, 17.0312, 500, 40);
  check(
    'projectRouteTangent wygładza szum kwantyzacji torow PLK do ~90 deg',
    tan !== null && Math.abs(tan.heading - 90) <= 2,
    tan ? `heading=${tan.heading.toFixed(2)}` : 'null',
  );

  // Dwukierunkowy/petlowy kurs S1 -> S2 -> S1: nextStopName rozstrzyga kierunek
  const { store } = makeFixture();
  store.trips.set('TLOOP', {
    trip_id: 'TLOOP',
    route_id: 'R145',
    service_id: 'W',
    trip_headsign: 'Petla',
    direction_id: 0,
    shape_id: '',
  });
  store.stopTimes.set('TLOOP', [
    { trip_id: 'TLOOP', stop_id: 'S1', stop_sequence: 1, arrival_sec: 36000, departure_sec: 36000 },
    { trip_id: 'TLOOP', stop_id: 'S2', stop_sequence: 2, arrival_sec: 36300, departure_sec: 36300 },
    { trip_id: 'TLOOP', stop_id: 'S1', stop_sequence: 3, arrival_sec: 36600, departure_sec: 36600 },
  ]);
  const outVeh: TrackedVehicle = {
    vehicleId: 'LOOP_OUT',
    line: '145',
    type: 'bus',
    lat: 51.099,
    lon: 17.041,
    matchedTripId: 'TLOOP',
    nextStopName: 'Galeria',
    delaySec: 0,
    updatedAt: Date.now(),
  };
  const backVeh: TrackedVehicle = {
    ...outVeh,
    vehicleId: 'LOOP_BACK',
    nextStopName: 'Dworzec Autobusowy',
  };
  const outB = resolveVehicleBearing(outVeh, store);
  const backB = resolveVehicleBearing(backVeh, store);
  check(
    'resolveVehicleBearing odroznia wyjazd (90 deg) od powrotu (270 deg) po nextStopName',
    outB != null && Math.abs(outB - 90) <= 3 && backB != null && Math.abs(backB - 270) <= 3,
    `out=${outB}, back=${backB}`,
  );
}

console.log(`\nWynik: ${passed} PASS, ${failures.length} FAIL`);
if (failures.length > 0) {
  for (const f of failures) console.error(' -', f);
  process.exit(1);
}
