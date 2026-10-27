import assert from 'node:assert/strict';
import {
  boardingDepartureMs,
  boardingDepartureSec,
  refreshConnectionTimes,
} from '../src/services/routing/connectionTimes';
import type { Connection } from '../src/types/models';

const now = new Date(2026, 9, 27, 11);
const connection: Connection = {
  id: 'timing',
  fromTitle: 'Start',
  toTitle: 'Cel',
  departureSec: 35700,
  arrivalSec: 37500,
  departAt: '09:55',
  arriveAt: '10:25',
  departInMin: 0,
  durationMin: 30,
  live: false,
  delayMin: 0,
  transfers: 0,
  legs: [
    {
      id: 'walk-in',
      mode: 'walk',
      fromStop: 'Start',
      toStop: 'A',
      departAt: '09:55',
      arriveAt: '10:00',
      stopsCount: 0,
      live: false,
    },
    {
      id: 'tram',
      mode: 'tram',
      tripId: 'tram',
      fromStop: 'A',
      toStop: 'B',
      departAt: '10:00',
      arriveAt: '10:20',
      stopsCount: 5,
      live: false,
      scheduledDepartureSec: 36000,
      scheduledArrivalSec: 37200,
      delaySec: 0,
      arrivalDelaySec: 0,
    },
    {
      id: 'walk-out',
      mode: 'walk',
      fromStop: 'B',
      toStop: 'Cel',
      departAt: '10:20',
      arriveAt: '10:25',
      stopsCount: 0,
      live: false,
    },
  ],
};
const delayed = refreshConnectionTimes(connection, new Map([['tram', 300]]), now);
assert.equal(delayed.legs[1].departAt, '10:05');
assert.equal(delayed.legs[1].scheduledDepartureSec, 36000);
assert.equal(delayed.departAt, '10:00');
assert.equal(delayed.arriveAt, '10:30');
assert.equal(delayed.legs[0].arriveAt, '10:05');
assert.equal(delayed.legs[2].departAt, '10:25');
assert.equal(boardingDepartureSec(delayed), 36300);
assert.strictEqual(refreshConnectionTimes(delayed, new Map([['tram', 300]]), now), delayed);
const later = refreshConnectionTimes(delayed, new Map([['tram', 600]]), now);
assert.equal(later.legs[1].departAt, '10:10');
assert.equal(later.arriveAt, '10:35');
const earlier = refreshConnectionTimes(later, new Map([['tram', 60]]), now);
assert.equal(earlier.legs[1].departAt, '10:01');
assert.equal(earlier.legs[1].scheduledDepartureSec, 36000);
const schedule = refreshConnectionTimes(earlier, new Map(), now);
assert.equal(schedule.legs[1].departAt, '10:00');
assert.equal(schedule.departAt, '09:55');
assert.equal(schedule.arriveAt, '10:25');
assert.equal(schedule.live, false);
const early = refreshConnectionTimes(delayed, new Map([['tram', -60]]), now);
assert.equal(early.legs[1].departAt, '09:59');
assert.equal(early.legs[1].scheduledDepartureSec, 36000);
assert.equal(early.delayMin, -1);
const missing = refreshConnectionTimes(delayed, new Map([['other-trip', 600]]), now);
assert.equal(missing.legs[1].departAt, '10:00');
assert.equal(missing.live, false);
let fractional = connection;
for (const seconds of [91, 137, 22, 0]) {
  fractional = refreshConnectionTimes(fractional, new Map([['tram', seconds]]), now);
  assert.equal(fractional.legs[0].departAt, fractional.departAt);
  assert.equal(fractional.legs[0].arriveAt, fractional.legs[1].departAt);
  assert.equal(fractional.legs[2].departAt, fractional.legs[1].arriveAt);
  assert.equal(fractional.legs[2].arriveAt, fractional.arriveAt);
}

const before = new Date(2026, 9, 27, 9, 55);
assert.equal((boardingDepartureMs(connection, before) - before.getTime()) / 60000, 5);
assert.equal((boardingDepartureMs(delayed, before) - before.getTime()) / 60000, 10);
assert.equal(connection.legs[1].departAt, '10:00');

const transfer: Connection = {
  ...connection,
  transfers: 1,
  legs: [
    ...connection.legs,
    {
      ...connection.legs[1],
      id: 'bus',
      tripId: 'bus',
      mode: 'bus',
      departAt: '10:30',
      arriveAt: '10:45',
      scheduledDepartureSec: 37800,
      scheduledArrivalSec: 38700,
    },
  ],
  arrivalSec: 38700,
  arriveAt: '10:45',
  durationMin: 50,
};
const transferDelayed = refreshConnectionTimes(
  transfer,
  new Map([
    ['tram', 600],
    ['bus', 60],
  ]),
  now,
);
assert.equal(transferDelayed.legs[1].departAt, '10:10');
assert.equal(transferDelayed.legs[3].departAt, '10:31');
assert.equal(transferDelayed.arriveAt, '10:46');
assert.equal(boardingDepartureSec(transferDelayed), 36600);

const overnight: Connection = {
  ...connection,
  departureSec: 86100,
  arrivalSec: 87600,
  departAt: '23:55',
  arriveAt: '00:20',
  legs: [
    { ...connection.legs[0], departAt: '23:55', arriveAt: '00:05' },
    {
      ...connection.legs[1],
      departAt: '00:05',
      arriveAt: '00:20',
      scheduledDepartureSec: 86700,
      scheduledArrivalSec: 87600,
    },
  ],
};
const night = new Date(2026, 9, 27, 23, 58);
assert.equal((boardingDepartureMs(overnight, night) - night.getTime()) / 60000, 7);
const midnight = new Date(2026, 9, 28, 0, 2);
assert.equal((boardingDepartureMs(overnight, midnight) - midnight.getTime()) / 60000, 3);
const nightDelayed = refreshConnectionTimes(overnight, new Map([['tram', 1200]]), night);
assert.ok(nightDelayed.departureSec >= 86400);
assert.strictEqual(
  refreshConnectionTimes(nightDelayed, new Map([['tram', 1200]]), night),
  nightDelayed,
);
assert.ok((boardingDepartureMs(nightDelayed, midnight) - midnight.getTime()) / 60000 < 15);
const tomorrow = { ...connection, departureSec: connection.departureSec + 86400 };
assert.strictEqual(refreshConnectionTimes(tomorrow, new Map([['tram', 600]]), now), tomorrow);

const legacy: Connection = {
  ...connection,
  legs: [
    {
      ...connection.legs[1],
      scheduledDepartureSec: undefined,
      scheduledArrivalSec: undefined,
      delaySec: undefined,
      arrivalDelaySec: undefined,
      fromStopId: 'a',
      toStopId: 'b',
      intermediateStops: [
        { stopId: 'a', name: 'A', seq: 1, departSec: 36000, arriveSec: 36000 },
        { stopId: 'b', name: 'B', seq: 2, departSec: 37200, arriveSec: 37200 },
      ],
    },
  ],
};
assert.equal(
  refreshConnectionTimes(legacy, new Map([['tram', 300]]), now).legs[0].departAt,
  '10:05',
);
const unknown = {
  ...legacy,
  legs: legacy.legs.map((leg) => ({ ...leg, intermediateStops: undefined })),
};
assert.equal(
  refreshConnectionTimes(unknown, new Map([['tram', 300]]), now).legs[0].scheduledDepartureSec,
  undefined,
);
console.log(
  'PASS: godziny live, wzrost i spadek opóźnienia, brak kumulacji, rozkład offline, przesiadki, odjazd bez dojścia, północ i starsze plany',
);
