import assert from 'node:assert/strict';
import { liveTracker, type RawVehicleRow, type TrackedVehicle } from '../src/services/liveTracker';
import { sampleTime, fusedDelay } from '../src/services/liveQuality';
import { buildRoutingSnapshot } from '../src/services/routing/reliability';
import { gtfsStore, LocalGtfsStore, type DayIndex } from '../src/services/routing/store';
import { runRaptor, selectJourneys } from '../src/services/routing/raptor';
import { refreshConnectionTimes } from '../src/services/routing/connectionTimes';
import { reliabilityNotice } from '../src/components/reliabilityNotice';
import { pl } from '../src/i18n/pl';
import type { Connection } from '../src/types/models';

function network(lines: { id: string; stops: string[]; times: number[][]; kind?: number }[]) {
  const store = new LocalGtfsStore();
  const index: DayIndex = {
    stopRoutes: new Map(),
    routeStops: new Map(),
    routeTrips: new Map(),
    patterns: new Map(),
  };
  [...new Set(lines.flatMap((l) => l.stops))].forEach((id, i) =>
    store.stops.set(id, {
      stop_id: id,
      stop_name: id,
      stop_lat: 51 + i * 0.01,
      stop_lon: 17,
      stop_code: '',
      normalized_name: id,
    }),
  );
  for (const line of lines) {
    store.routes.set(line.id, {
      route_id: line.id,
      route_short_name: line.id,
      route_type: line.kind ?? 3,
    });
    const trips = line.times.map((times, i) => {
      const trip = {
        trip_id: `${line.id}_${i}`,
        route_id: line.id,
        service_id: 'test',
        trip_headsign: line.stops.at(-1)!,
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
  return { store, index };
}

const now = new Date(2026, 9, 28, 10, 30);
const ms = now.getTime();
const sec = 10 * 3600 + 30 * 60;
const vehicle = (id: string, trip: string, delay: number): TrackedVehicle => ({
  vehicleId: id,
  matchedTripId: trip,
  delaySec: delay,
  updatedAt: ms,
  line: '145',
  type: 'bus',
  lat: 51.005,
  lon: 17,
});
const row: RawVehicleRow = {
  name: '145',
  type: 'bus',
  x: 51.005,
  y: 17,
  k: 'v',
  timestamp: ms,
  delaySec: 2400,
  headsign: 'B',
};
assert.equal(sampleTime({ ...row, timestamp: ms - 120001 }, ms), null);
assert.equal(sampleTime({ ...row, timestamp: ms + 60000 }, ms), null);
assert.equal(sampleTime(row, ms), ms);
assert.equal(fusedDelay({ ...row, delaySec: 0 }, 2400), 2400);
assert.equal(fusedDelay(row, 2300), 2400);
const old = vehicle('145-v', '145_0', 1200);
assert.equal(fusedDelay(row, 2400, old), 1200);
const smooth = fusedDelay({ ...row, timestamp: ms + 5000 }, 2400, old);
assert(smooth > 1200 && smooth < 2400);

const matchedNet = network([
  {
    id: '145',
    stops: ['A', 'B'],
    times: [
      [sec - 2700, sec - 2100],
      [sec - 1800, sec - 1200],
    ],
  },
]);
gtfsStore.routes = matchedNet.store.routes;
gtfsStore.stops = matchedNet.store.stops;
gtfsStore.trips = matchedNet.store.trips;
gtfsStore.stopTimes = matchedNet.store.stopTimes;
const matcher = liveTracker as unknown as {
  matchRowsRust(
    rows: RawVehicleRow[],
    index: DayIndex,
    nowSec: number,
  ): Map<string, { tracked: TrackedVehicle }> | null;
  matchRow(
    row: RawVehicleRow,
    index: DayIndex,
    nowSec: number,
    cache: Map<string, unknown>,
  ): { tracked: TrackedVehicle };
  byId: Map<string, TrackedVehicle>;
};
const realNow = Date.now;
Date.now = () => ms;
try {
  const rust = matcher.matchRowsRust([row], matchedNet.index, sec);
  assert(rust, 'Nowy matcher WASM musi być dostępny');
  const js = matcher.matchRow(row, matchedNet.index, sec, new Map());
  assert.equal(rust.get('145-v')?.tracked.matchedTripId, '145_0');
  assert.equal(js.tracked.matchedTripId, '145_0');
  assert.equal(rust.get('145-v')?.tracked.delaySec, 2400);
  assert.equal(js.tracked.delaySec, 2400);
  const wrong = { ...row, headsign: 'C' };
  assert.equal(
    matcher.matchRowsRust([wrong], matchedNet.index, sec)?.get('145-v')?.tracked.matchedTripId,
    undefined,
  );
  assert.equal(
    matcher.matchRow(wrong, matchedNet.index, sec, new Map()).tracked.matchedTripId,
    undefined,
  );
  matcher.byId.set('145-v', { ...js.tracked, delaySec: 2400, updatedAt: ms - 5000 });
  const jump = { ...row, delaySec: 0 };
  assert.equal(
    matcher.matchRowsRust([jump], matchedNet.index, sec)?.get('145-v')?.tracked.matchedTripId,
    '145_0',
  );
  assert.equal(
    matcher.matchRow(jump, matchedNet.index, sec, new Map()).tracked.matchedTripId,
    '145_0',
  );
  const noApi = { ...row, delaySec: undefined };
  assert.equal(
    matcher.matchRowsRust([noApi], matchedNet.index, sec)?.get('145-v')?.tracked.matchedTripId,
    '145_0',
  );
  assert.equal(
    matcher.matchRow(noApi, matchedNet.index, sec, new Map()).tracked.matchedTripId,
    '145_0',
  );
  matcher.byId.clear();
  const timetable = {
    ...row,
    delaySec: undefined,
    headsign: undefined,
    upcomingStops: [{ name: 'B', schedSec: sec - 2100 }],
  };
  assert.equal(
    matcher.matchRowsRust([timetable], matchedNet.index, sec)?.get('145-v')?.tracked.matchedTripId,
    '145_0',
  );
  assert.equal(
    matcher.matchRow(timetable, matchedNet.index, sec, new Map()).tracked.matchedTripId,
    '145_0',
  );
  const sampled = { ...timetable, timestamp: ms - 60000 };
  assert.equal(
    matcher.matchRowsRust([sampled], matchedNet.index, sec)?.get('145-v')?.tracked.delaySec,
    2340,
  );
  assert.equal(matcher.matchRow(sampled, matchedNet.index, sec, new Map()).tracked.delaySec, 2340);
  matcher.byId.set('old', { ...old, updatedAt: ms - 120001 });
  assert.equal(liveTracker.snapshot().length, 0);
  assert.equal(liveTracker.getTripDelays().size, 0);
  const long = network([
    { id: '145', stops: ['A', 'B'], times: [[sec - 5700, sec - 5100]] },
  ]);
  gtfsStore.trips = long.store.trips;
  gtfsStore.stopTimes = long.store.stopTimes;
  const veryLate = { ...row, delaySec: 5400 };
  assert.equal(
    matcher.matchRowsRust([veryLate], long.index, sec)?.get('145-v')?.tracked.delaySec,
    5400,
  );
  assert.equal(matcher.matchRow(veryLate, long.index, sec, new Map()).tracked.delaySec, 5400);
  const terminal = network([
    { id: '145', stops: ['A'], times: [[sec - 2400], [sec - 1500]] },
  ]);
  gtfsStore.trips = terminal.store.trips;
  gtfsStore.stopTimes = terminal.store.stopTimes;
  const atStop = { ...row, x: 51, delaySec: undefined, headsign: undefined, upcomingStops: [{ name: 'A', schedSec: sec - 2400 }] };
  assert.equal(matcher.matchRowsRust([atStop], terminal.index, sec)?.get('145-v')?.tracked.matchedTripId, '145_0');
  assert.equal(matcher.matchRow(atStop, terminal.index, sec, new Map()).tracked.matchedTripId, '145_0');
} finally {
  Date.now = realNow;
  liveTracker.reset();
}
console.log('PASS: timestamp, fuzja, skok API, duże opóźnienie, zgodność JS i WASM');

const net = network([
  {
    id: '145',
    stops: ['A', 'B', 'D'],
    times: [
      [sec - 1800, sec - 600, sec + 600],
      [sec - 1500, sec - 300, sec + 900],
      [sec - 600, sec + 600, sec + 1800],
    ],
  },
  { id: '146', stops: ['A', 'B', 'D'], times: [[sec - 500, sec + 700, sec + 1900]] },
  { id: '147', stops: ['D', 'B', 'A'], times: [[sec - 500, sec + 700, sec + 1900]] },
  { id: '148', stops: ['A', 'B', 'D'], times: [[sec + 300, sec + 900, sec + 1500]], kind: 0 },
]);
const observed = [vehicle('145-1', '145_0', 1200), vehicle('145-2', '145_1', 900)];
const snapshot = buildRoutingSnapshot(net.index, net.store, observed, true, ms);
assert.equal(snapshot.confidence.get('145_0'), 'live');
assert.equal(snapshot.confidence.get('145_2'), 'estimated');
assert.equal(snapshot.delays.get('145_2'), 840);
assert.equal(snapshot.confidence.get('146_0'), 'estimated');
assert.equal(snapshot.confidence.get('147_0'), 'untracked');
assert.equal(snapshot.delays.has('147_0'), false);
assert.equal(snapshot.confidence.has('148_0'), false);
assert.equal(
  buildRoutingSnapshot(net.index, net.store, observed.slice(0, 1), true, ms).confidence.get(
    '145_2',
  ),
  'untracked',
);
assert.equal(buildRoutingSnapshot(net.index, net.store, observed, false, ms).delays.size, 0);
assert.equal(
  buildRoutingSnapshot(net.index, net.store, observed, true, ms + 120001).delays.size,
  0,
);
assert.equal(
  buildRoutingSnapshot(
    net.index,
    net.store,
    observed,
    true,
    ms,
    new Map([['145', 86400]]),
  ).confidence.has('145_2'),
  false,
);
console.log(
  'PASS: estymacja linii i korytarza, kierunek, minimalna próba, wygasanie, offline i inny dzień',
);

const connection: Connection = {
  id: 'estimate',
  fromTitle: 'A',
  toTitle: 'D',
  departureSec: sec - 600,
  arrivalSec: sec + 1800,
  departAt: '10:20',
  arriveAt: '11:00',
  departInMin: 0,
  durationMin: 40,
  transfers: 0,
  delayMin: 0,
  live: false,
  legs: [
    {
      id: 'bus',
      mode: 'bus',
      tripId: '145_2',
      fromStop: 'A',
      toStop: 'D',
      departAt: '10:20',
      arriveAt: '11:00',
      scheduledDepartureSec: sec - 600,
      scheduledArrivalSec: sec + 1800,
      stopsCount: 2,
      live: false,
    },
  ],
};
const refreshed = refreshConnectionTimes(connection, snapshot.delays, now, snapshot.confidence);
assert.equal(refreshed.live, false);
assert.equal(refreshed.legs[0].delayConfidence, 'estimated');
assert.equal(refreshed.legs[0].delaySec, 840);
assert.equal(refreshed.legs[0].arrivalDelaySec, 840);
assert.equal(refreshed.legs[0].departAt, '10:34');
assert.equal(reliabilityNotice(refreshed.legs, pl), pl.routeDetails.estimatedDelay(14));
assert.strictEqual(
  refreshConnectionTimes(refreshed, snapshot.delays, now, snapshot.confidence),
  refreshed,
);
const cleared = refreshConnectionTimes(refreshed, new Map(), now);
assert.equal(cleared.legs[0].delayConfidence, 'scheduled');
assert.equal(cleared.legs[0].departAt, '10:20');
console.log(
  'PASS: szacunek zmienia godziny bez flagi live, brak podwójnego dodawania, powrót do rozkładu',
);

const transferNet = network([
  { id: '145', stops: ['A', 'X'], times: [[28800, 29400]] },
  {
    id: '146',
    stops: ['X', 'D'],
    times: [
      [29520, 30000],
      [29820, 30300],
    ],
  },
]);
const origins = [{ stopId: 'A', walkSec: 0, walkM: 0 }];
const destinations = [{ stopId: 'D', walkSec: 0, walkM: 0 }];
const options = {
  dayIndex: transferNet.index,
  minTransferSec: 120,
  maxTransfers: 1,
  windowSec: 3600,
};
const found = runRaptor(transferNet.store, origins, destinations, 28800, options);
assert(found.some((j) => j.arrivalSec === 30000));
const safeOptions = { ...options, transferBuffers: new Map([['145_0', 180]]) };
const safe = runRaptor(transferNet.store, origins, destinations, 28800, safeOptions);
assert(safe.length > 0);
assert(safe.every((j) => j.arrivalSec >= 30300));
assert(safe.every((j) => j.segments.find((s) => s.tripId === '145_0')?.arriveSec === 29400));
const reverse = runRaptor(transferNet.store, origins, destinations, 30000, {
  ...safeOptions,
  arriveBy: true,
});
assert.equal(reverse.length, 0);
const reverseLater = runRaptor(transferNet.store, origins, destinations, 30300, {
  ...safeOptions,
  arriveBy: true,
});
assert(reverseLater.length > 0);
assert(reverseLater.every((j) => j.segments.find((s) => s.tripId === '146_1')));
const direct = runRaptor(
  transferNet.store,
  origins,
  [{ stopId: 'X', walkSec: 0, walkM: 0 }],
  28800,
  safeOptions,
);
assert(direct.some((j) => j.arrivalSec === 29400));
const ranked = selectJourneys(
  [
    { ...safe[0], arrivalSec: 30000 },
    {
      ...safe[0],
      segments: safe[0].segments.map((s) => ({
        ...s,
        tripId: s.tripId ? `confirmed-${s.tripId}` : undefined,
      })),
      arrivalSec: 30060,
    },
  ],
  28800,
  { uncertaintyPenalty: new Map([['145_0', 120]]) },
);
assert(ranked[0].segments.some((s) => s.tripId === 'confirmed-145_0'));
const alternatives = network([
  { id: '145', stops: ['A', 'D'], times: [[28800, 29400]] },
  { id: '146', stops: ['A', 'D'], times: [[28800, 29460]] },
]);
const actualAlternatives = runRaptor(alternatives.store, origins, destinations, 28800, {
  dayIndex: alternatives.index,
  transferBuffers: new Map([['145_0', 180]]),
});
assert(actualAlternatives.some((j) => j.segments.some((s) => s.tripId === '146_0')));
assert.equal(
  selectJourneys(actualAlternatives, 28800, { uncertaintyPenalty: new Map([['145_0', 120]]) })[0]
    .arrivalSec,
  29460,
);

for (const train of [false, true]) {
  const walking = network([
    { id: '145', stops: ['A', 'X'], times: [[28800, 29400]] },
    { id: '146', stops: ['Y', 'D'], times: [[train ? 29700 : 29760, 30300]], kind: train ? 2 : 3 },
  ]);
  walking.store.footpaths.set('X', [
    { to_stop_id: 'Y', duration_sec: 180, distance_m: 100, fixed: true },
  ]);
  const walkOptions = {
    dayIndex: walking.index,
    windowSec: 3600,
    minTransferSec: 120,
    trainMinTransferSec: 300,
  };
  assert(runRaptor(walking.store, origins, destinations, 28800, walkOptions).length > 0);
  const guarded = { ...walkOptions, transferBuffers: new Map([['145_0', 180]]) };
  assert.equal(runRaptor(walking.store, origins, destinations, 28800, guarded).length, 0);
  assert.equal(
    runRaptor(walking.store, origins, destinations, 30300, { ...guarded, arriveBy: true }).length,
    0,
  );
}
console.log(
  'PASS: bufory przesiadki w obu kierunkach, wybór późniejszego kursu, rzeczywiste godziny, ranking',
);
