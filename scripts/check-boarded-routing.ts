/**
 * Testy planowania trasy z pokładu jadącego pojazdu (`boardedTrip`).
 *
 * Uruchomienie: `npx tsx --require ./scripts/stub-expo.cjs scripts/check-boarded-routing.ts`
 */

import type { GtfsTrip } from '../src/gtfs/types';
import { DayIndex, LocalGtfsStore } from '../src/services/routing/store';
import { applyLiveDelays, planConnections } from '../src/services/routing/engine';

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
const STEP_LAT = 0.0036; // ~400 m na północ przy 51°
const STEP_LON_200 = 0.00286; // ~200 m na wschód przy 51°

interface StoreInternals {
  loaded: boolean;
  buildFootpaths(): void;
  buildPatterns(byRoute: Map<string, GtfsTrip[]>): DayIndex;
}

function internals(store: LocalGtfsStore): StoreInternals {
  return store as unknown as StoreInternals;
}

interface LineDef {
  id: string;
  type: number;
  headsign?: string;
  trips: Array<{ id: string; times: Array<[stopId: string, sec: number]> }>;
}

function makeNet(stops: Array<[id: string, lat: number, lon: number]>, lines: LineDef[]) {
  const store = new LocalGtfsStore();
  internals(store).loaded = true;
  for (const [id, lat, lon] of stops) {
    store.stops.set(id, {
      stop_id: id,
      stop_code: '',
      stop_name: id,
      stop_lat: lat,
      stop_lon: lon,
      normalized_name: id,
    });
  }
  internals(store).buildFootpaths();
  const byRoute = new Map<string, GtfsTrip[]>();
  for (const line of lines) {
    store.routes.set(line.id, {
      route_id: line.id,
      route_short_name: line.id,
      route_long_name: '',
      route_type: line.type,
    });
    const trips: GtfsTrip[] = [];
    for (const t of line.trips) {
      const trip: GtfsTrip = {
        trip_id: t.id,
        route_id: line.id,
        service_id: 'wd',
        trip_headsign: line.headsign ?? `${line.id} Kierunek`,
        direction_id: 0,
        shape_id: '',
      };
      store.trips.set(t.id, trip);
      store.stopTimes.set(
        t.id,
        t.times.map(([stop_id, sec], i) => ({
          trip_id: t.id,
          stop_id,
          arrival_sec: sec,
          departure_sec: sec,
          stop_sequence: i,
        })),
      );
      trips.push(trip);
    }
    byRoute.set(line.id, trips);
  }
  return { store, dayIndex: internals(store).buildPatterns(byRoute) };
}

async function run() {
  // ─── 1. Dojazd bezpośredni tym samym tramwajem + krótki spacer do celu ───
  head('Bezpośrednio tym samym tramwajem (0 przesiadek)');
  {
    const lat0 = 51.1;
    const lon = 17.0;
    const stops: Array<[string, number, number]> = [
      ['S0', lat0, lon],
      ['S1', lat0 + STEP_LAT, lon],
      ['S2', lat0 + 2 * STEP_LAT, lon],
      ['S3', lat0 + 3 * STEP_LAT, lon],
    ];
    const { store, dayIndex } = makeNet(stops, [
      {
        id: '4',
        type: 0,
        headsign: 'Oporów',
        trips: [
          {
            id: 'trip_4',
            times: [
              ['S0', hms(10, 0)],
              ['S1', hms(10, 3)],
              ['S2', hms(10, 6)],
              ['S3', hms(10, 9)],
            ],
          },
        ],
      },
    ]);

    // Użytkownik jest między S1 a S2 (o 10:04:30), jedzie do punktu 280 m za S3.
    const conns = await planConnections(
      {
        fromTitle: 'Tramwaj 4',
        fromLat: lat0 + 1.5 * STEP_LAT,
        fromLon: lon,
        toId: 'dest',
        toTitle: 'Cel',
        toLat: lat0 + 3 * STEP_LAT + 0.0025,
        toLon: lon,
        departureTimeSec: hms(10, 4, 30),
        dayIndex,
        boardedTrip: {
          tripId: 'trip_4',
          line: '4',
          mode: 'tram',
          currentLat: lat0 + 1.5 * STEP_LAT,
          currentLon: lon,
        },
      },
      store,
    );

    check('zwrócono połączenie bezpośrednie', conns.length >= 1 && conns[0].transfers === 0, `${conns.length} wyników`);
    check('oznaczone jako boarded=true', conns[0]?.boarded === true);
    check('departInMin = 0 i departureSec = 10:04:30', conns[0]?.departInMin === 0 && conns[0]?.departureSec === hms(10, 4, 30));
    check('wysiadka na S3 mimo końcowego spaceru ~280 m (bez odrzucenia isPointlessShortRide)', conns[0]?.legs[0]?.toStopId === 'S3');
    check('odcinek tramwajowy ma przystanki od S1 do S3', conns[0]?.legs[0]?.fromStopId === 'S1');
  }

  // ─── 2. Wykluczenie miniętych i zbyt bliskich przystanków na trasie ─────────
  head('Wykluczenie miniętych i zbyt bliskich przystanków');
  {
    const lat0 = 51.1;
    const lon = 17.0;
    const stops: Array<[string, number, number]> = [
      ['P0', lat0, lon],
      ['P1', lat0 + STEP_LAT, lon],
      ['P2', lat0 + 2 * STEP_LAT, lon],
      ['P3', lat0 + 3 * STEP_LAT, lon],
    ];
    // Przesiadka na linię B dostępna i z P1 (minięty!), i z P2 (tuż przed pojazdem = 30 m!), i z P3 (400 m dalej)
    const { store } = makeNet(stops, [
      {
        id: '10',
        type: 0,
        trips: [
          {
            id: 'trip_10',
            times: [
              ['P0', hms(10, 0)],
              ['P1', hms(10, 3)],
              ['P2', hms(10, 6)],
              ['P3', hms(10, 9)],
            ],
          },
        ],
      },
      {
        id: 'B',
        type: 3,
        trips: [
          {
            id: 'trip_B_p1',
            times: [
              ['P1', hms(10, 7)],
              ['P3', hms(10, 8)],
            ],
          },
          {
            id: 'trip_B_p2',
            times: [
              ['P2', hms(10, 9)],
              ['P3', hms(10, 10)],
            ],
          },
        ],
      },
    ]);

    store.stops.set('D', { stop_id: 'D', stop_code: '', stop_name: 'D', stop_lat: lat0 + 3 * STEP_LAT, stop_lon: lon + STEP_LON_200 * 5, normalized_name: 'D' });
    internals(store).buildFootpaths();
    store.routes.set('C', { route_id: 'C', route_short_name: 'C', route_long_name: '', route_type: 3 });
    const tripC: GtfsTrip = { trip_id: 'trip_C', route_id: 'C', service_id: 'wd', trip_headsign: 'D', direction_id: 0, shape_id: '' };
    store.trips.set('trip_C', tripC);
    store.stopTimes.set('trip_C', [
      { trip_id: 'trip_C', stop_id: 'P3', arrival_sec: hms(10, 12), departure_sec: hms(10, 12), stop_sequence: 0 },
      { trip_id: 'trip_C', stop_id: 'D', arrival_sec: hms(10, 15), departure_sec: hms(10, 15), stop_sequence: 1 },
    ]);

    const tripB_fast: GtfsTrip = { trip_id: 'trip_B_fast', route_id: 'B', service_id: 'wd', trip_headsign: 'D', direction_id: 0, shape_id: '' };
    store.trips.set('trip_B_fast', tripB_fast);
    store.stopTimes.set('trip_B_fast', [
      { trip_id: 'trip_B_fast', stop_id: 'P1', arrival_sec: hms(10, 8), departure_sec: hms(10, 8), stop_sequence: 0 },
      { trip_id: 'trip_B_fast', stop_id: 'P2', arrival_sec: hms(10, 9), departure_sec: hms(10, 9), stop_sequence: 1 },
      { trip_id: 'trip_B_fast', stop_id: 'D', arrival_sec: hms(10, 11), departure_sec: hms(10, 11), stop_sequence: 2 },
    ]);
    const trip10 = store.trips.get('trip_10');
    const idx3 = internals(store).buildPatterns(
      new Map<string, GtfsTrip[]>([
        ['10', trip10 ? [trip10] : []],
        ['B', [tripB_fast]],
        ['C', [tripC]],
      ]),
    );

    const conns = await planConnections(
      {
        fromTitle: 'Tramwaj 10',
        fromLat: lat0 + 2 * STEP_LAT - 0.00027, // 30 m przed P2
        fromLon: lon,
        toId: 'D',
        toTitle: 'D',
        toLat: lat0 + 3 * STEP_LAT,
        toLon: lon + STEP_LON_200 * 5,
        departureTimeSec: hms(10, 5, 45),
        dayIndex: idx3,
        boardedTrip: {
          tripId: 'trip_10',
          line: '10',
          mode: 'tram',
          currentLat: lat0 + 2 * STEP_LAT - 0.00027,
          currentLon: lon,
        },
      },
      store,
    );

    check('nie używa miniętego P1 ani zbyt bliskiego P2 (przesiadka dopiero na P3)', conns.length === 1 && conns[0].legs[0]?.toStopId === 'P3', conns[0]?.legs.map((l) => `${l.fromStopId}>${l.toStopId}`).join(', '));
  }

  // ─── 3. Przesiadka między sąsiednimi słupkami (footpath) + opóźnienie live ─
  head('Przesiadka przez footpath między przystankami oraz live delay');
  {
    const lat0 = 51.1;
    const lon = 17.0;
    const stops: Array<[string, number, number]> = [
      ['A0', lat0, lon],
      ['A1', lat0 + STEP_LAT, lon],
      ['A2', lat0 + 2 * STEP_LAT, lon],
      ['X_BUS', lat0 + 2 * STEP_LAT, lon + STEP_LON_200], // 200 m na wschód od A2
      ['DEST', lat0 + 2 * STEP_LAT, lon + STEP_LON_200 * 8],
    ];
    const { store } = makeNet(stops, [
      {
        id: '11',
        type: 0,
        trips: [
          {
            id: 'trip_11',
            times: [
              ['A0', hms(10, 0)],
              ['A1', hms(10, 3)],
              ['A2', hms(10, 6)],
            ],
          },
        ],
      },
      {
        id: '145',
        type: 3,
        trips: [
          // Ten kurs odjeżdża 10:08, za wcześnie przy 200 m spaceru + 180 s opóźnienia tramwaju (A2 o 10:09)
          {
            id: 'trip_145_early',
            times: [
              ['X_BUS', hms(10, 8)],
              ['DEST', hms(10, 15)],
            ],
          },
          // Ten kurs odjeżdża 10:14, osiągalny po A2 (10:09) + spacer (~266 s)
          {
            id: 'trip_145_ok',
            times: [
              ['X_BUS', hms(10, 14)],
              ['DEST', hms(10, 21)],
            ],
          },
        ],
      },
    ]);
    const t11 = store.trips.get('trip_11');
    const t145Early = store.trips.get('trip_145_early');
    const t145Ok = store.trips.get('trip_145_ok');
    const dayIndex = internals(store).buildPatterns(
      new Map<string, GtfsTrip[]>([
        ['11', t11 ? [t11] : []],
        ['145', [t145Early, t145Ok].filter((t): t is GtfsTrip => Boolean(t))],
      ]),
    );

    // Tramwaj 11 ma +180 s opóźnienia -> dojeżdża na A2 o 10:09, więc na X_BUS jest dopiero ~10:13!
    const conns = await planConnections(
      {
        fromTitle: 'Tramwaj 11',
        fromLat: lat0 + 0.5 * STEP_LAT,
        fromLon: lon,
        toId: 'DEST',
        toTitle: 'DEST',
        toLat: lat0 + 2 * STEP_LAT,
        toLon: lon + STEP_LON_200 * 8,
        departureTimeSec: hms(10, 4),
        dayIndex,
        boardedTrip: {
          tripId: 'trip_11',
          line: '11',
          mode: 'tram',
          currentLat: lat0 + 0.5 * STEP_LAT,
          currentLon: lon,
          delaySec: 180,
        },
      },
      store,
    );

    const transitLegs = conns[0]?.legs.filter((l) => l.mode !== 'walk') ?? [];
    const walkMid = conns[0]?.legs.find((l) => l.mode === 'walk' && l.fromStopId === 'A2' && l.toStopId === 'X_BUS');
    check('łapie bezpiecznie kurs 10:14 zamiast nieosiągalnego 10:08 przez +180s delay', transitLegs[1]?.tripId === 'trip_145_ok', transitLegs.map((l) => `${l.line}@${l.departAt}`).join(' -> '));
    check('zawiera odcinek pieszy A2 -> X_BUS', Boolean(walkMid));

    // Sprawdź że applyLiveDelays nie cofa departureSec dla connection.boarded=true
    const refreshed = applyLiveDelays(conns, new Map([['trip_11', 240]]));
    check('applyLiveDelays zachowuje departureSec=now dla boarded=true', refreshed[0]?.departureSec === hms(10, 4) && refreshed[0]?.boarded === true);
  }

  console.log(`\nPodsumowanie: ${passed} PASS, ${failures.length} FAIL`);
  if (failures.length > 0) {
    for (const f of failures) console.error(' -', f);
    process.exit(1);
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
