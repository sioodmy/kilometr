import assert from 'node:assert/strict';
import type { GtfsTrip } from '../src/gtfs/types';
import {
  buildSearchSlices,
  planConnections,
  sortConnectionsByCost,
} from '../src/services/routing/engine';
import { liveTracker } from '../src/services/liveTracker';
import {
  costParamsFor,
  mergeDayIndexes,
  runRaptor,
  selectJourneys,
  type RaptorOptions,
} from '../src/services/routing/raptor';
import { gtfsStore, LocalGtfsStore, type DayIndex } from '../src/services/routing/store';
import type { Connection, RawJourney } from '../src/services/routing/types';

const at = (h: number, m: number, s = 0) => h * 3600 + m * 60 + s;
const transit = (j: RawJourney) => j.segments.filter((s) => s.type === 'transit');
const emptyIndex = (): DayIndex => ({
  stopRoutes: new Map(),
  routeStops: new Map(),
  routeTrips: new Map(),
  patterns: new Map(),
});

interface Line {
  id: string;
  kind?: number;
  stops: string[];
  times: number[][];
}

function network(lines: Line[], paths: Array<[string, string, number]> = []) {
  const store = new LocalGtfsStore();
  const index = emptyIndex();
  const stopIds = [...new Set(lines.flatMap((l) => l.stops))];
  stopIds.forEach((id, i) =>
    store.stops.set(id, {
      stop_id: id,
      stop_name: id,
      stop_code: '',
      normalized_name: id,
      stop_lat: 51 + i * 0.02,
      stop_lon: 17,
    }),
  );
  for (const line of lines) {
    store.routes.set(line.id, {
      route_id: line.id,
      route_short_name: line.id,
      route_type: line.kind ?? 3,
    });
    const trips: GtfsTrip[] = line.times.map((times, i) => {
      const trip = {
        trip_id: `${line.id}_${i}`,
        route_id: line.id,
        service_id: 'test',
        trip_headsign: '',
        direction_id: 0,
        shape_id: '',
      };
      store.trips.set(trip.trip_id, trip);
      store.stopTimes.set(
        trip.trip_id,
        times.map((sec, j) => ({
          stop_id: line.stops[j],
          stop_sequence: j,
          arrival_sec: sec,
          departure_sec: sec,
        })),
      );
      return trip;
    });
    index.patterns.set(line.id, { routeId: line.id, stopSequence: line.stops, trips });
  }
  for (const [from, to, duration] of paths) {
    const list = store.footpaths.get(from) ?? [];
    list.push({ to_stop_id: to, duration_sec: duration, distance_m: 100, fixed: true });
    store.footpaths.set(from, list);
  }
  return { store, index };
}

function arrive(
  net: ReturnType<typeof network>,
  deadline: number,
  options: RaptorOptions = {},
  access = 0,
  egress = 0,
) {
  const journeys = runRaptor(
    net.store,
    [{ stopId: 'A', walkSec: access, walkM: access ? 20 : 0 }],
    [{ stopId: 'D', walkSec: egress, walkM: egress ? 20 : 0 }],
    deadline,
    { dayIndex: net.index, windowSec: 3600, arriveBy: true, ...options },
  );
  assert(journeys.every((j) => j.arrivalSec <= deadline));
  return selectJourneys(journeys, deadline - 10800, { arriveBySec: deadline, cost: options.cost });
}

async function checkArrivalRouting() {
  const direct = network([
    {
      id: 'DIRECT',
      stops: ['A', 'D'],
      times: [
        [at(8, 0), at(8, 20)],
        [at(8, 10), at(8, 30)],
        [at(8, 20), at(8, 40)],
      ],
    },
  ]);
  const onTime = arrive(direct, at(8, 31), {}, 90, 60);
  assert.equal(transit(onTime[0])[0].tripId, 'DIRECT_1');
  assert.equal(onTime[0].departureSec, at(8, 8, 30));
  assert.equal(onTime[0].arrivalSec, at(8, 31));
  assert.equal(onTime[0].segments[0].arriveSec - onTime[0].segments[0].departSec, 90);
  assert.equal(transit(arrive(direct, at(8, 30, 59), {}, 90, 60)[0])[0].tripId, 'DIRECT_0');
  assert.equal(arrive(direct, at(7, 59)).length, 0);
  assert.equal(
    transit(arrive(direct, at(8, 31), { windowSec: 0 }, 90, 60)[0])[0].tripId,
    'DIRECT_1',
  );
  console.log(
    'PASS: termin co do sekundy, pełne dojście i odejście, brak kursu, pojedynczy przebieg',
  );

  const alternatives = network([
    { id: 'SLOW', stops: ['A', 'D'], times: [[at(8, 0), at(9, 0)]] },
    { id: 'FAST', stops: ['A', 'D'], times: [[at(8, 30), at(8, 55)]] },
  ]);
  assert.equal(transit(arrive(alternatives, at(9, 0))[0])[0].line, 'FAST');
  console.log('PASS: późniejsze wyjście wygrywa z późniejszym przyjazdem');

  for (const trainFirst of [false, true]) {
    const net = network(
      [
        {
          id: 'FIRST',
          kind: trainFirst ? 2 : 3,
          stops: ['A', 'X'],
          times: [[at(8, 0), at(8, 10)]],
        },
        {
          id: 'SECOND',
          kind: trainFirst ? 3 : 2,
          stops: ['Y', 'D'],
          times: [[at(8, 14), at(8, 30)]],
        },
      ],
      [['X', 'Y', 60]],
    );
    const found = arrive(net, at(8, 31));
    assert.equal(found.length > 0, trainFirst);
    if (found[0]) {
      const legs = transit(found[0]);
      assert.deepEqual(
        legs.map((s) => s.line),
        ['FIRST', 'SECOND'],
      );
      const walk = found[0].segments.find((s) => s.type === 'walk');
      assert.equal(walk?.fromStopId, 'X');
      assert.equal(walk?.toStopId, 'Y');
      assert.equal(walk?.arriveSec, at(8, 11));
      assert.equal(found[0].transfers, 1);
    }
    assert.equal(arrive(net, at(8, 31), { maxTransfers: 0 }).length, 0);
  }
  console.log(
    'PASS: kierunkowe przejście, kolejność nóg, limit przesiadek, zapas na pociąg po właściwej stronie',
  );

  const tight = network([
    { id: 'BUS_A', stops: ['A', 'X'], times: [[at(8, 0), at(8, 10)]] },
    { id: 'BUS_B', stops: ['X', 'D'], times: [[at(8, 11), at(8, 30)]] },
  ]);
  assert.equal(arrive(tight, at(8, 30)).length, 0);
  assert(arrive(tight, at(8, 30), { minTransferSec: 60 }).length > 0);
  assert.equal(arrive(tight, at(8, 30), { allowedModes: 'tram' }).length, 0);
  console.log('PASS: domyślny zapas 120 s, ustawienie użytkownika i filtr pojazdów');

  const delayed = arrive(direct, at(8, 31), { tripDelays: new Map([['DIRECT_1', 120]]) }, 0, 60);
  assert.equal(transit(delayed[0])[0].tripId, 'DIRECT_0');
  const liveOptions = { tripDelays: new Map([['DIRECT_1', 300]]), nowSec: at(8, 0) };
  const forwardLive = runRaptor(
    direct.store,
    [{ stopId: 'A', walkSec: 0, walkM: 0 }],
    [{ stopId: 'D', walkSec: 0, walkM: 0 }],
    at(8, 9),
    { dayIndex: direct.index, ...liveOptions },
  );
  const liveTrip = forwardLive.find((j) => transit(j)[0].tripId === 'DIRECT_1');
  assert(liveTrip);
  const reverseLive = arrive(direct, liveTrip.arrivalSec, liveOptions).find(
    (j) => transit(j)[0].tripId === 'DIRECT_1',
  );
  assert(reverseLive);
  assert.deepEqual(transit(reverseLive), transit(liveTrip));
  console.log('PASS: opóźnienia i prognoza per przystanek są zgodne w obu kierunkach');

  const night = network([{ id: 'NIGHT', stops: ['A', 'D'], times: [[at(23, 50), at(24, 10)]] }]);
  const merged = mergeDayIndexes(emptyIndex(), night.index, 'y_', -86400);
  const overnight = arrive({ store: night.store, index: merged.index }, at(0, 15), {
    patternTimeOffsets: merged.offsets,
  });
  assert.equal(overnight[0].departureSec, -600);
  assert.equal(overnight[0].arrivalSec, 600);
  console.log('PASS: kurs poprzedniego dnia serwisowego, wyjście przed północą');

  const rankNet = network([
    { id: 'DIRECT', stops: ['A', 'D'], times: [[at(8, 0), at(8, 40)]] },
    { id: 'FIRST', stops: ['A', 'X'], times: [[at(8, 0), at(8, 10)]] },
    { id: 'SECOND', stops: ['X', 'D'], times: [[at(8, 12), at(8, 32)]] },
  ]);
  const ranked = runRaptor(
    rankNet.store,
    [{ stopId: 'A', walkSec: 0, walkM: 0 }],
    [{ stopId: 'D', walkSec: 0, walkM: 0 }],
    at(8, 0),
    { dayIndex: rankNet.index },
  );
  assert.equal(selectJourneys(ranked, at(8, 0))[0].transfers, 1);
  assert.equal(
    selectJourneys(ranked, at(8, 0), { cost: costParamsFor('fewerTransfers') })[0].transfers,
    0,
  );
  const connections: Connection[] = ranked.map((j, i) => ({
    id: String(i),
    fromTitle: 'A',
    toTitle: 'D',
    departureSec: j.departureSec,
    arrivalSec: j.arrivalSec,
    durationMin: Math.round((j.arrivalSec - j.departureSec) / 60),
    transfers: j.transfers,
    departInMin: 0,
    departAt: '',
    arriveAt: '',
    delayMin: 0,
    live: false,
    legs: [],
  }));
  assert.equal(
    sortConnectionsByCost([...connections], costParamsFor('balanced'), 1.34)[0].transfers,
    1,
  );
  assert.equal(
    sortConnectionsByCost([...connections], costParamsFor('fewerTransfers'), 1.34)[0].transfers,
    0,
  );
  console.log(
    'PASS: 8 minut zysku uzasadnia przesiadkę; preferencja mniejszej liczby przesiadek nadal działa',
  );

  const getSlice = gtfsStore.getDayIndexSlice;
  const requests: Array<{ date?: string; from: number; to: number }> = [];
  gtfsStore.getDayIndexSlice = async (_weekday, date, from, to) => {
    requests.push({ date, from, to });
    return emptyIndex();
  };
  try {
    const slices = await buildSearchSlices(86400 + at(0, 15), true);
    assert.equal(slices.dayOffsetSec, 86400);
    assert.equal(slices.searchStartSec, at(0, 15) - 10800);
    assert.equal(requests.length, 2);
    assert(requests[1].from < at(22, 0));
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const stamp = `${tomorrow.getFullYear()}${String(tomorrow.getMonth() + 1).padStart(2, '0')}${String(tomorrow.getDate()).padStart(2, '0')}`;
    assert.equal(requests[0].date, stamp);
  } finally {
    gtfsStore.getDayIndexSlice = getSlice;
  }
  console.log('PASS: jutrzejszy przyjazd po północy ładuje oba dni i wieczorne odjazdy');

  const savedStore = {
    stops: gtfsStore.stops,
    routes: gtfsStore.routes,
    trips: gtfsStore.trips,
    stopTimes: gtfsStore.stopTimes,
    footpaths: gtfsStore.footpaths,
    isLoaded: gtfsStore.isLoaded,
    getDayIndexSlice: gtfsStore.getDayIndexSlice,
  };
  const ensureFresh = liveTracker.ensureFresh;
  liveTracker.ensureFresh = async () => {};
  try {
    Object.assign(gtfsStore, {
      stops: direct.store.stops,
      routes: direct.store.routes,
      trips: direct.store.trips,
      stopTimes: direct.store.stopTimes,
      footpaths: direct.store.footpaths,
      isLoaded: true,
      getDayIndexSlice: async () => direct.index,
    });
    const target = 86400 + at(8, 31);
    const query = {
      fromTitle: 'A',
      fromLat: 51,
      fromLon: 17,
      toTitle: 'D',
      toLat: 51.02,
      toLon: 17,
      maxWalkM: 200,
    };
    const partials: Connection[][] = [];
    const planned = await planConnections({
      ...query,
      arriveBySec: target,
      onProgress: (c) => partials.push(c),
    });
    assert(planned.length > 0);
    assert(planned.every((c) => c.arrivalSec !== undefined && c.arrivalSec <= target));
    assert(partials.flat().every((c) => c.arrivalSec !== undefined && c.arrivalSec <= target));
    assert(planned.every((c) => c.departureSec >= 86400));
    const now = new Date();
    const nowSec = now.getHours() * 3600 + now.getMinutes() * 60 + now.getSeconds();
    const missed = network([
      { id: 'MISSED', stops: ['A', 'D'], times: [[nowSec - 120, nowSec + 30]] },
    ]);
    Object.assign(gtfsStore, {
      trips: missed.store.trips,
      stopTimes: missed.store.stopTimes,
      getDayIndexSlice: async () => missed.index,
    });
    assert.equal((await planConnections({ ...query, arriveBySec: nowSec + 90 })).length, 0);
  } finally {
    Object.assign(gtfsStore, savedStore);
    liveTracker.ensureFresh = ensureFresh;
  }
  console.log(
    'PASS: planer i progres zachowują termin oraz offset jutra; przyszły termin nie zwraca odjechanego kursu',
  );
}

void checkArrivalRouting();
