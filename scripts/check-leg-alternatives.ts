process.env.TZ = 'Europe/Warsaw';
import assert from 'node:assert/strict';
import { pl } from '../src/i18n/pl';
import { en } from '../src/i18n/en';
import { de } from '../src/i18n/de';
import { uk } from '../src/i18n/uk';
import type { GtfsRoute, GtfsStop, GtfsStopTime, GtfsTrip } from '../src/gtfs/types';
import type { DayIndex } from '../src/services/routing/store';

type Pattern = DayIndex['patterns'] extends Map<string, infer P> ? P : never;
import {
  applyLegSwapToConnection,
  extractLegSwapConstraints,
  findLegAlternativesInIndex,
  isSwappableUrbanLeg,
  type LegAlternativeStoreView,
} from '../src/services/routing/legAlternatives';
import type { Connection, Leg } from '../src/types/models';

const t = (h: number, m: number) => h * 3600 + m * 60;

function makeStop(id: string, name: string, lat: number, lon: number, code?: string): GtfsStop {
  return {
    stop_id: id,
    stop_name: name,
    normalized_name: name.toLowerCase(),
    stop_lat: lat,
    stop_lon: lon,
    stop_code: code ?? '',
  };
}

function makePattern(
  id: string,
  routeId: string,
  stopSeq: string[],
  trips: Array<{ tripId: string; headsign: string; times: number[] }>,
  stopTimesOut: Map<string, GtfsStopTime[]>,
): Pattern {
  const gtfsTrips: GtfsTrip[] = trips.map((tr) => ({
    trip_id: tr.tripId,
    route_id: routeId,
    service_id: 'svc',
    trip_headsign: tr.headsign,
    direction_id: 0,
    shape_id: '',
  }));
  const departures: number[][] = stopSeq.map((_, sIdx) => trips.map((tr) => tr.times[sIdx]));
  for (const tr of trips) {
    stopTimesOut.set(
      tr.tripId,
      stopSeq.map((stopId, idx) => ({
        trip_id: tr.tripId,
        stop_id: stopId,
        stop_sequence: idx + 1,
        arrival_sec: tr.times[idx],
        departure_sec: tr.times[idx],
      })),
    );
  }
  const tripIndices = stopSeq.map(() => trips.map((_, idx) => idx));
  return {
    patternId: id,
    routeId,
    stopSequence: stopSeq,
    trips: gtfsTrips,
    departures,
    tripIndices,
  };
}

function buildDayIndex(patterns: Pattern[]): DayIndex {
  const patMap = new Map<string, Pattern>();
  const stopRoutes = new Map<string, Set<string>>();
  const routeStops = new Map<string, string[]>();
  const routeTrips = new Map<string, GtfsTrip[]>();
  for (const p of patterns) {
    patMap.set(p.patternId, p);
    routeStops.set(p.patternId, p.stopSequence);
    routeTrips.set(p.patternId, p.trips);
    for (const s of p.stopSequence) {
      const set = stopRoutes.get(s) ?? new Set<string>();
      set.add(p.patternId);
      stopRoutes.set(s, set);
    }
  }
  return { patterns: patMap, stopRoutes, routeStops, routeTrips };
}

// ---------------------------------------------------------------------------
// 1. Reguły dopuszczalności wymiany: nigdy pociągi, nigdy walk, nigdy zajęty 1. etap
// ---------------------------------------------------------------------------
{
  const mixedConn: Connection = {
    id: 'mixed-1',
    fromTitle: 'Dom',
    toTitle: 'Kraków Główny',
    departureSec: t(8, 0),
    arrivalSec: t(10, 0),
    departAt: '08:00',
    arriveAt: '10:00',
    departInMin: 15,
    durationMin: 120,
    live: false,
    delayMin: 0,
    transfers: 2,
    legs: [
      {
        id: 'w0',
        mode: 'walk',
        fromStop: 'Dom',
        toStop: 'Rynek',
        departAt: '08:00',
        arriveAt: '08:03',
        stopsCount: 0,
        live: false,
      },
      {
        id: 'l1',
        mode: 'tram',
        line: '10',
        tripId: 'tram-1',
        fromStop: 'Rynek',
        toStop: 'Dworzec Główny',
        fromStopId: 'S_RYNEK',
        toStopId: 'S_DWORZEC',
        departAt: '08:03',
        arriveAt: '08:15',
        scheduledDepartureSec: t(8, 3),
        scheduledArrivalSec: t(8, 15),
        stopsCount: 4,
        live: false,
      },
      {
        id: 'l2',
        mode: 'train',
        line: 'IC 3510',
        tripId: 'pl:ic-1',
        fromStop: 'Wrocław Główny',
        toStop: 'Kraków Główny',
        fromStopId: 'pl:5100069',
        toStopId: 'pl:5100028',
        departAt: '08:30',
        arriveAt: '09:50',
        scheduledDepartureSec: t(8, 30),
        scheduledArrivalSec: t(9, 50),
        stopsCount: 3,
        live: false,
      },
      {
        id: 'l3',
        mode: 'bus',
        line: '125',
        tripId: 'pl:urban-pretender',
        fromStop: 'Dworzec',
        toStop: 'Cel',
        fromStopId: 'S_A',
        toStopId: 'S_B',
        departAt: '09:52',
        arriveAt: '10:00',
        scheduledDepartureSec: t(9, 52),
        scheduledArrivalSec: t(10, 0),
        stopsCount: 2,
        live: false,
      },
    ],
  };

  assert.equal(isSwappableUrbanLeg(mixedConn, 0), false, 'walk leg must not be swappable');
  assert.equal(isSwappableUrbanLeg(mixedConn, 1), true, 'urban tram leg must be swappable');
  assert.equal(isSwappableUrbanLeg(mixedConn, 2), false, 'train leg must NEVER be swappable');
  assert.equal(isSwappableUrbanLeg(mixedConn, 3), false, 'pl: tripId leg must NEVER be swappable');

  // Połączenie "już w pojeździe": pierwsza noga zablokowana, ale druga miejska nadal wymienialna.
  const boardedConn: Connection = {
    ...mixedConn,
    boarded: true,
    legs: [
      mixedConn.legs[1],
      {
        id: 'l2-urban',
        mode: 'bus',
        line: 'K',
        tripId: 'bus-k-1',
        fromStop: 'Dworzec Główny',
        toStop: 'Krzyki',
        fromStopId: 'S_DWORZEC',
        toStopId: 'S_KRZYKI',
        departAt: '08:25',
        arriveAt: '08:40',
        scheduledDepartureSec: t(8, 25),
        scheduledArrivalSec: t(8, 40),
        stopsCount: 5,
        live: false,
      },
    ],
  };
  assert.equal(isSwappableUrbanLeg(boardedConn, 0), false, 'boarded first transit leg is locked');
  assert.equal(isSwappableUrbanLeg(boardedConn, 1), true, 'second urban leg stays swappable');
}

// ---------------------------------------------------------------------------
// 2. Ograniczenia przesiadkowe z obu stron, wykluczenie pociągów w mieście,
//    alternatywna linia miejska, opóźnienia live i pobliski słupek
// ---------------------------------------------------------------------------
{
  const stops = new Map<string, GtfsStop>([
    ['S_PREV', makeStop('S_PREV', 'Plac Grunwaldzki', 51.111, 17.061)],
    ['S_A1', makeStop('S_A1', 'Plac Grunwaldzki', 51.111, 17.061, '01')],
    // Drugi słupek w tym samym węźle (~95 m obok).
    ['S_A2', makeStop('S_A2', 'Plac Grunwaldzki', 51.1118, 17.0615, '02')],
    ['S_B1', makeStop('S_B1', 'Dworzec Główny', 51.0989, 17.0365, '11')],
    ['S_TRAIN', makeStop('S_TRAIN', 'Wrocław Główny', 51.0989, 17.0365)],
  ]);

  const routes = new Map<string, GtfsRoute>([
    ['R_125', { route_id: 'R_125', route_short_name: '125', route_long_name: 'Bus 125', route_type: 3 }],
    ['R_145', { route_id: 'R_145', route_short_name: '145', route_long_name: 'Bus 145', route_type: 3 }],
    ['R_TRAIN', { route_id: 'R_TRAIN', route_short_name: 'KD', route_long_name: 'Koleje Dolnośląskie', route_type: 2 }],
  ]);

  const stopTimes = new Map<string, GtfsStopTime[]>();
  const pat125 = makePattern(
    'P_125',
    'R_125',
    ['S_A1', 'S_B1'],
    [
      // Za wcześnie (08:16 przy przesiadce od 08:15 + minTransfer 2 min = 08:17).
      { tripId: 't_too_early', headsign: 'Dworzec', times: [t(8, 16), t(8, 30)] },
      // Wcześniejszy kurs pasujący (08:20 -> 08:34).
      { tripId: 't_earlier', headsign: 'Dworzec', times: [t(8, 20), t(8, 34)] },
      // Aktualny kurs (08:25 -> 08:39).
      { tripId: 't_current', headsign: 'Dworzec', times: [t(8, 25), t(8, 39)] },
      // Późniejszy kurs pasujący (08:33 -> 08:48, pociąg o 08:55, bufor 5 min => max 08:50).
      { tripId: 't_later_ok', headsign: 'Dworzec', times: [t(8, 33), t(8, 48)] },
      // Późniejszy kurs za późno (08:37 -> 08:52, narusza 5-min bufor na pociąg o 08:55).
      { tripId: 't_too_late', headsign: 'Dworzec', times: [t(8, 37), t(8, 52)] },
      // Kurs z opóźnieniem live +8 min (rozkładowo 08:30 -> 08:45, ale live 08:38 -> 08:53 => odpada!).
      { tripId: 't_delayed_out', headsign: 'Dworzec', times: [t(8, 30), t(8, 45)] },
    ],
    stopTimes,
  );

  // Alternatywna linia 145 z pobliskiego słupka S_A2 (odjazd 08:22 -> 08:36).
  const pat145 = makePattern(
    'P_145',
    'R_145',
    ['S_A2', 'S_B1'],
    [{ tripId: 't_145_pole2', headsign: 'Dworzec', times: [t(8, 22), t(8, 36)] }],
    stopTimes,
  );

  // Pociąg (route_type = 2) na tej samej relacji: musi zostać odfiltrowany!
  const patTrain = makePattern(
    'P_TRAIN',
    'R_TRAIN',
    ['S_A1', 'S_B1'],
    [{ tripId: 't_city_train', headsign: 'Dworzec', times: [t(8, 28), t(8, 35)] }],
    stopTimes,
  );

  const dayIndex = buildDayIndex([pat125, pat145, patTrain]);
  const storeView: LegAlternativeStoreView = {
    stops,
    routes,
    stopTimes,
    footpaths: new Map([
      ['S_PREV', [{ from_stop_id: 'S_PREV', to_stop_id: 'S_A2', duration_sec: 80, distance_m: 95 }]],
      ['S_A1', [{ from_stop_id: 'S_A1', to_stop_id: 'S_A2', duration_sec: 80, distance_m: 95 }]],
    ]),
  };

  const conn: Connection = {
    id: 'conn-mid',
    fromTitle: 'Start',
    toTitle: 'Legnica',
    departureSec: t(8, 0),
    arrivalSec: t(9, 40),
    departAt: '08:00',
    arriveAt: '09:40',
    departInMin: 20,
    durationMin: 100,
    live: false,
    delayMin: 0,
    transfers: 2,
    legs: [
      {
        id: 'leg-0',
        mode: 'tram',
        line: '4',
        tripId: 't_tram4',
        fromStop: 'Start',
        toStop: 'Plac Grunwaldzki',
        fromStopId: 'S_START',
        toStopId: 'S_PREV',
        departAt: '08:00',
        arriveAt: '08:15',
        scheduledDepartureSec: t(8, 0),
        scheduledArrivalSec: t(8, 15),
        stopsCount: 4,
        live: false,
      },
      {
        id: 'leg-1',
        mode: 'bus',
        line: '125',
        tripId: 't_current',
        fromStop: 'Plac Grunwaldzki',
        toStop: 'Dworzec Główny',
        fromStopId: 'S_A1',
        toStopId: 'S_B1',
        fromLat: 51.111,
        fromLon: 17.061,
        toLat: 51.0989,
        toLon: 17.0365,
        departAt: '08:25',
        arriveAt: '08:39',
        scheduledDepartureSec: t(8, 25),
        scheduledArrivalSec: t(8, 39),
        stopsCount: 3,
        live: false,
      },
      {
        id: 'leg-2',
        mode: 'train',
        line: 'KD',
        tripId: 'pl:kd-1',
        fromStop: 'Wrocław Główny',
        toStop: 'Legnica',
        fromStopId: 'S_TRAIN',
        toStopId: 'S_LEGNICA',
        departAt: '08:55',
        arriveAt: '09:40',
        scheduledDepartureSec: t(8, 55),
        scheduledArrivalSec: t(9, 40),
        stopsCount: 2,
        live: false,
      },
    ],
  };

  const constraints = extractLegSwapConstraints(conn, 1, {
    minTransferSec: 120,
    trainMinTransferSec: 300,
    walkPace: 'normal',
  });
  assert.equal(constraints.minTransferBeforeSec, 120);
  assert.equal(constraints.minTransferAfterSec, 300, 'must enforce trainMinTransferSec before train');

  const res = findLegAlternativesInIndex({
    leg: conn.legs[1],
    constraints,
    anchorFromStopId: 'S_A1',
    anchorToStopId: 'S_B1',
    dayIndex,
    store: storeView,
    windowStartSec: t(8, 15),
    windowEndSec: t(8, 55),
    tripDelays: new Map([['t_delayed_out', 480]]),
  });

  const ids = res.alternatives.map((a) => a.tripId);
  assert.deepEqual(ids, ['t_earlier', 't_145_pole2', 't_current', 't_later_ok']);
  assert.equal(res.currentIndex, 2);
  assert.equal(ids.includes('t_city_train'), false, 'train route_type=2 must be excluded');
  assert.equal(ids.includes('t_too_early'), false, 'missed transfer must be excluded');
  assert.equal(ids.includes('t_too_late'), false, 'late arrival before train must be excluded');
  assert.equal(ids.includes('t_delayed_out'), false, 'live-delayed trip missing train must be excluded');

  // Podmiana na linię 145 z innego słupka (S_A2) powinna dodać odcinek pieszy przed nogą.
  const alt145 = res.alternatives[1];
  const swappedLeg: Leg = {
    ...conn.legs[1],
    line: alt145.line,
    tripId: alt145.tripId,
    fromStopId: alt145.fromStopId,
    fromStop: alt145.fromStop,
    fromLat: alt145.fromLat,
    fromLon: alt145.fromLon,
    departAt: '08:22',
    arriveAt: '08:36',
    scheduledDepartureSec: alt145.scheduledDepartureSec,
    scheduledArrivalSec: alt145.scheduledArrivalSec,
  };
  const updated = applyLegSwapToConnection(conn, 1, swappedLeg, {
    boardWalkM: alt145.boardWalkM,
    boardWalkSec: alt145.boardWalkSec,
    alightWalkM: alt145.alightWalkM,
    alightWalkSec: alt145.alightWalkSec,
    nowSec: t(7, 45),
  });
  assert.equal(updated.legs.length, 4, 'switching to nearby pole must insert transfer walk leg');
  assert.equal(updated.legs[1].mode, 'walk');
  assert.equal(updated.legs[1].walkM, 95);
  assert.equal(updated.legs[2].id, 'leg-1', 'swapped leg must keep its slot id');
  assert.equal(updated.legs[2].line, '145');
  assert.notEqual(updated.id, conn.id, 'stableConnectionId must reflect swapped trip');
}

// ---------------------------------------------------------------------------
// 3. Pierwsza i ostatnia noga: aktualizacja godzin podróży, czasu trwania i spaceru
// ---------------------------------------------------------------------------
{
  const firstLastConn: Connection = {
    id: 'conn-fl',
    fromTitle: 'Dom',
    toTitle: 'Praca',
    departureSec: t(14, 0),
    arrivalSec: t(14, 30),
    departAt: '14:00',
    arriveAt: '14:30',
    departInMin: 10,
    durationMin: 30,
    live: false,
    delayMin: 0,
    transfers: 0,
    legs: [
      {
        id: 'w-in',
        mode: 'walk',
        fromStop: 'Dom',
        toStop: 'Przystanek A',
        departAt: '14:00',
        arriveAt: '14:05',
        scheduledDepartureSec: t(14, 0),
        scheduledArrivalSec: t(14, 5),
        walkM: 400,
        stopsCount: 0,
        live: false,
      },
      {
        id: 't-main',
        mode: 'tram',
        line: '6',
        tripId: 'tram-6-1405',
        fromStop: 'Przystanek A',
        toStop: 'Przystanek B',
        fromStopId: 'SA',
        toStopId: 'SB',
        departAt: '14:05',
        arriveAt: '14:25',
        scheduledDepartureSec: t(14, 5),
        scheduledArrivalSec: t(14, 25),
        stopsCount: 6,
        live: false,
      },
      {
        id: 'w-out',
        mode: 'walk',
        fromStop: 'Przystanek B',
        toStop: 'Praca',
        departAt: '14:25',
        arriveAt: '14:30',
        scheduledDepartureSec: t(14, 25),
        scheduledArrivalSec: t(14, 30),
        walkM: 400,
        stopsCount: 0,
        live: false,
      },
    ],
  };

  const laterTram: Leg = {
    ...firstLastConn.legs[1],
    tripId: 'tram-6-1415',
    departAt: '14:15',
    arriveAt: '14:37',
    scheduledDepartureSec: t(14, 15),
    scheduledArrivalSec: t(14, 37),
  };

  const shifted = applyLegSwapToConnection(firstLastConn, 1, laterTram, {
    nowSec: t(13, 50),
  });
  assert.equal(shifted.departAt, '14:10', 'initial walk and connection departure must shift +10m');
  assert.equal(shifted.arriveAt, '14:42', 'final walk and connection arrival must shift to 14:42');
  assert.equal(shifted.durationMin, 32);
  assert.equal(shifted.departInMin, 20);
  assert.equal(shifted.legs[0].departAt, '14:10');
  assert.equal(shifted.legs[0].arriveAt, '14:15');
  assert.equal(shifted.legs[2].departAt, '14:37');
  assert.equal(shifted.legs[2].arriveAt, '14:42');
}

// ---------------------------------------------------------------------------
// 4. Przejście przez północ (23:50 -> 00:15)
// ---------------------------------------------------------------------------
{
  const nightConn: Connection = {
    id: 'night-1',
    fromTitle: 'A',
    toTitle: 'B',
    departureSec: t(23, 50),
    arrivalSec: t(24, 15),
    departAt: '23:50',
    arriveAt: '00:15',
    departInMin: 5,
    durationMin: 25,
    live: false,
    delayMin: 0,
    transfers: 0,
    legs: [
      {
        id: 'n-leg',
        mode: 'bus',
        line: '241',
        tripId: 'night-2350',
        fromStop: 'A',
        toStop: 'B',
        fromStopId: 'SA',
        toStopId: 'SB',
        departAt: '23:50',
        arriveAt: '00:15',
        scheduledDepartureSec: t(23, 50),
        scheduledArrivalSec: t(24, 15),
        stopsCount: 8,
        live: false,
      },
    ],
  };

  const nextNight: Leg = {
    ...nightConn.legs[0],
    tripId: 'night-0020',
    departAt: '00:20',
    arriveAt: '00:45',
    scheduledDepartureSec: t(24, 20),
    scheduledArrivalSec: t(24, 45),
  };

  const swappedNight = applyLegSwapToConnection(nightConn, 0, nextNight, { nowSec: t(23, 45) });
  assert.equal(swappedNight.departAt, '00:20');
  assert.equal(swappedNight.arriveAt, '00:45');
  assert.equal(swappedNight.durationMin, 25);
  assert.ok((swappedNight.arrivalSec ?? 0) > swappedNight.departureSec);
}

// ---------------------------------------------------------------------------
// 5. Spójność i18n (4 języki, brak pauz U+2014)
// ---------------------------------------------------------------------------
{
  const locales = { pl, en, de, uk };
  for (const [code, dict] of Object.entries(locales)) {
    const samples = [
      dict.leg.swapEarlier,
      dict.leg.swapLater,
      dict.leg.swapLoading,
      dict.leg.swapNoEarlier,
      dict.leg.swapNoLater,
      dict.leg.swapError,
      dict.leg.swapRetry,
      dict.leg.swapEarlierA11y('10', '08:20'),
      dict.leg.swapLaterA11y('10', '08:40'),
      dict.leg.swapLoadMoreEarlierA11y,
      dict.leg.swapLoadMoreLaterA11y,
      dict.leg.swapCounterA11y(2, 5),
    ];
    for (const s of samples) {
      assert.ok(s.trim().length > 0, `${code}: empty swap i18n string`);
      assert.equal(s.includes('\u2014'), false, `${code}: em dash forbidden in "${s}"`);
    }
  }
}

console.log('check-leg-alternatives: all assertions passed');
