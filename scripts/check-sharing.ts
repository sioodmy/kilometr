import assert from 'node:assert/strict';
import { deflateSync, strToU8 } from 'fflate';
import {
  buildShareUrl,
  createSharedConnection,
  decodeSharedConnection,
  encodeSharedConnection,
  formatShareTime,
  shareMessage,
  transferCount,
} from '../src/sharing/connection';
import { selectLegStops, tripShard, type TimetableShard } from '../src/sharing/timetable';
import {
  scheduledVehiclePosition,
  sharedJourneySeconds,
  sharedLegStops,
} from '../src/sharing/progress';
import { pl } from '../src/i18n/share/pl';
import { en } from '../src/i18n/share/en';
import { de } from '../src/i18n/share/de';
import { uk } from '../src/i18n/share/uk';
import type { Connection } from '../src/types/models';

const connection: Connection = {
  id: 'test',
  fromTitle: 'Żółkiewskiego',
  toTitle: 'Dworzec Główny',
  departureSec: 86100,
  departInMin: 0,
  departAt: '23:55',
  arriveAt: '00:20',
  durationMin: 25,
  transfers: 0,
  delayMin: 0,
  live: false,
  legs: [
    {
      id: 'test-leg',
      mode: 'tram',
      line: '4',
      direction: 'Biskupin',
      fromStop: 'Żółkiewskiego',
      toStop: 'Dworzec Główny',
      fromStopId: 'a',
      toStopId: 'c',
      tripId: 'tram-4',
      departAt: '23:55',
      arriveAt: '00:20',
      stopsCount: 3,
      live: false,
    },
  ],
};
const journey = createSharedConnection(connection, 'wroclaw', new Date('2026-10-19T21:00:00Z'));
assert.equal(journey.date, '2026-10-19');
assert.equal(journey.arrival, 1460);
assert.equal(formatShareTime(journey.arrival), '00:20');
assert.deepEqual(
  decodeSharedConnection(encodeSharedConnection(journey)),
  JSON.parse(JSON.stringify(journey)),
);
assert.equal(transferCount(journey), 0);
assert.equal(
  createSharedConnection(
    { ...connection, departureSec: 86400 + 86100 },
    'wroclaw',
    new Date('2026-10-19T21:00:00Z'),
  ).date,
  '2026-10-20',
);
assert.equal(
  createSharedConnection(connection, 'wroclaw', new Date('2026-10-19T22:30:00Z')).date,
  '2026-10-20',
);
const url = new URL(buildShareUrl(journey, 'uk'));
assert.equal(url.origin, 'https://kilometr.app');
assert.equal(url.search, '');
assert.equal(new URLSearchParams(url.hash.slice(1)).get('lang'), 'uk');
assert.ok(url.href.length < 1000);
for (const s of [pl, en, de, uk]) {
  assert.ok(shareMessage(journey, s).includes('4'));
  assert.ok(shareMessage(journey, s).includes('00:20'));
}
for (const bad of ['', 'not+a+link', '%ZZ', 'a'.repeat(9000), 'abc', 'e30']) {
  assert.equal(decodeSharedConnection(bad), null);
}
const pack = (value: unknown) =>
  Buffer.from(deflateSync(strToU8(JSON.stringify(value)))).toString('base64url');
for (const bad of [
  { ...journey, v: 2 },
  { ...journey, city: '../other' },
  { ...journey, legs: [] },
  { ...journey, date: '2026-02-30' },
  { ...journey, departure: -1 },
  { ...journey, legs: [{ ...journey.legs[0], mode: 'boat' }] },
  { ...journey, legs: [{ ...journey.legs[0], arrival: 1300 }] },
  { ...journey, from: 'x'.repeat(40000) },
])
  assert.equal(decodeSharedConnection(pack(bad)), null);
const stops = [
  { id: 'a', name: 'A', arrival: 86100, departure: 86100 },
  { id: 'b', name: 'B', arrival: 86400, departure: 86400 },
  { id: 'c', name: 'C', arrival: 87600, departure: 87600 },
];
assert.equal(selectLegStops(journey.legs[0], stops).length, 3);
const delayed = createSharedConnection(
  {
    ...connection,
    departAt: '23:58',
    arriveAt: '00:25',
    legs: [
      {
        ...connection.legs[0],
        departAt: '23:58',
        arriveAt: '00:25',
        live: true,
        intermediateStops: [
          { stopId: 'a', name: 'A', seq: 1, departSec: 86100 },
          { stopId: 'c', name: 'C', seq: 3, arriveSec: 87600 },
        ],
      },
    ],
  },
  'wroclaw',
  new Date('2026-10-19T21:00:00Z'),
);
assert.equal(delayed.legs[0].departure, 1438);
assert.equal(delayed.legs[0].scheduledDeparture, 1435);
assert.equal(selectLegStops(delayed.legs[0], stops).length, 3);
assert.equal(decodeSharedConnection(encodeSharedConnection(delayed))?.legs[0].scheduledArrival, 20);
assert.equal(selectLegStops({ ...journey.legs[0], departure: 1200 }, stops).length, 0);
assert.equal(selectLegStops({ ...journey.legs[0], alight: 'a' }, stops).length, 0);
assert.match(tripShard('tram-4'), /^[a-f0-9]{2}$/);
const shardContract: TimetableShard = { v: 1, trips: { 'tram-4': stops } };
assert.equal(shardContract.v, 1);
const midnightStops = sharedLegStops(journey.legs[0], stops);
assert.equal(sharedJourneySeconds('2026-10-19', new Date('2026-10-19T22:05:30Z')), 86730);
assert.equal(sharedJourneySeconds('2026-10-19', new Date('2026-10-18T21:55:00Z')), -300);
assert.equal(sharedJourneySeconds('2026-01-19', new Date('2026-01-19T23:05:00Z')), 86700);
assert.equal(scheduledVehiclePosition(midnightStops, 86099), null);
assert.deepEqual(scheduledVehiclePosition(midnightStops, 86250), { index: 0, fraction: 0.5 });
assert.deepEqual(scheduledVehiclePosition(midnightStops, 86400), { index: 1, fraction: 0 });
assert.deepEqual(scheduledVehiclePosition(midnightStops, 87000), { index: 1, fraction: 0.5 });
assert.deepEqual(scheduledVehiclePosition(midnightStops, 87600), { index: 2, fraction: 0 });
assert.equal(scheduledVehiclePosition(midnightStops, 87601), null);
assert.equal(
  scheduledVehiclePosition(
    midnightStops,
    sharedJourneySeconds('2026-10-18', new Date('2026-10-19T21:57:00Z')),
  ),
  null,
);
const dwellStops = midnightStops.map((stop, index) =>
  index === 1 ? { ...stop, departure: stop.arrival + 60 } : stop,
);
assert.deepEqual(scheduledVehiclePosition(dwellStops, 86430), { index: 1, fraction: 0 });
assert.deepEqual(scheduledVehiclePosition(dwellStops, 87030), { index: 1, fraction: 0.5 });
assert.deepEqual(sharedLegStops(delayed.legs[0], stops), midnightStops);
assert.deepEqual(
  sharedLegStops(delayed.legs[0]).map((stop) => stop.departure),
  [86100, 87600],
);
assert.deepEqual(
  sharedLegStops({ ...journey.legs[0], departure: 5, arrival: 20 }, [
    { id: 'a', name: 'A', arrival: 86700, departure: 86700 },
    { id: 'b', name: 'B', arrival: 87600, departure: 87600 },
  ]).map((stop) => stop.departure),
  [300, 1200],
);
assert.deepEqual(
  sharedLegStops(journey.legs[0]).map((stop) => stop.departure),
  [86100, 87600],
);
assert.equal(scheduledVehiclePosition([], 0), null);
assert.deepEqual(
  scheduledVehiclePosition(
    [
      { id: 'a', name: 'A', arrival: 0, departure: 0 },
      { id: 'b', name: 'B', arrival: 0, departure: 0 },
      { id: 'c', name: 'C', arrival: 60, departure: 60 },
    ],
    30,
  ),
  { index: 1, fraction: 0.5 },
);
console.log('Udostępnianie: URL, daty, północ, słowniki, przystanki i pozycja według rozkładu OK.');
