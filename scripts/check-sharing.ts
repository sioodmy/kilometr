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
import { selectLegStops, tripShard } from '../src/sharing/timetable';
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
console.log(
  'Udostępnianie: format URL, daty, północ, walidacja, słowniki i dopasowanie przystanków OK.',
);
