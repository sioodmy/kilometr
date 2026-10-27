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
  sharedTimeMs,
} from '../src/sharing/progress';
import { sharedTripPath } from '../src/sharing/links';
import { sharedToConnection, sharedLiveConnection, sharedVehicle } from '../src/sharing/native';
import { computeTripProgress } from '../src/services/notifications/tripProgress';
import { buildLivePlan, tripNotificationData } from '../src/services/notifications/content';
import { pl as strings } from '../src/i18n/pl';
import { appLinkFiles } from '../landing/appLinks';
import { clipPath, decodePath, encodePath } from '../src/sharing/geometry';
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
assert.equal(formatShareTime(-1), '23:59');
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
assert.equal(url.pathname, '/trip/');
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

const encoded = encodeSharedConnection(journey);
for (const link of [
  url.href,
  `https://kilometr.app/#trip=${encoded}`,
  `kilometr://shared?trip=${encoded}`,
  `kilometr://trip/#trip=${encoded}`,
  `/shared?trip=${encoded}`,
])
  assert.equal(sharedTripPath(link), `/shared?trip=${encoded}`);
assert.equal(sharedTripPath('https://kilometr.app/trip/#trip=broken'), '/shared');
assert.equal(sharedTripPath('https://kilometr.app/'), null);
assert.equal(sharedTripPath(`https://evil.example/trip/#trip=${encoded}`), null);
assert.equal(sharedTripPath(`https://kilometr.app.evil.example/trip/#trip=${encoded}`), null);
assert.equal(sharedTripPath('kilometr://routes?open=other'), null);
for (const coords of [{ fromLat: 91, fromLon: 17 }, { fromLat: 51 }, { toLat: 51, toLon: 181 }])
  assert.equal(
    decodeSharedConnection(pack({ ...journey, legs: [{ ...journey.legs[0], ...coords }] })),
    null,
  );
const midnight = new Date('2026-10-19T22:05:00Z');
const nativeConnection = sharedToConnection(journey, encoded);
const nativeProgress = computeTripProgress(nativeConnection, { now: midnight });
assert.equal(nativeProgress.phase, 'riding');
assert.equal(nativeProgress.etaMin, 15);
assert.equal(
  computeTripProgress(nativeConnection, { now: new Date('2026-10-20T22:05:00Z') }).phase,
  'arrived',
);
assert.equal(sharedTimeMs('2026-10-19', 87600), Date.parse('2026-10-19T22:20:00Z'));
assert.equal(sharedTimeMs('2026-10-25', 4 * 3600), Date.parse('2026-10-25T03:00:00Z'));
const live = sharedLiveConnection(nativeConnection, journey, new Map([['tram-4', 300]]), midnight);
assert.equal(live.arriveAt, '00:25');
assert.equal(live.delayMin, 5);
assert.equal(
  sharedLiveConnection(live, journey, new Map([['tram-4', 300]]), midnight).arriveAt,
  '00:25',
);
assert.equal(sharedLiveConnection(live, journey, new Map(), midnight).arriveAt, '00:20');
assert.equal(
  sharedLiveConnection(
    nativeConnection,
    journey,
    new Map([['tram-4', 300]]),
    new Date('2026-10-20T22:05:00Z'),
  ).live,
  false,
);
const gps = {
  vehicleId: '4-1',
  matchedTripId: 'tram-4',
  line: '4',
  lat: 51.1,
  lon: 17.03,
  delaySec: 0,
  updatedAt: midnight.getTime(),
};
assert.equal(sharedVehicle(live, [{ ...gps, matchedTripId: 'other' }], midnight), null);
assert.equal(
  sharedVehicle(live, [{ ...gps, updatedAt: midnight.getTime() - 90_001 }], midnight),
  null,
);
assert.equal(sharedVehicle(live, [gps], midnight)?.vehicle.vehicleId, '4-1');
assert.equal(sharedVehicle(live, [gps], new Date('2026-10-20T22:05:00Z')), null);
const observed = {
  id: nativeConnection.id,
  connection: nativeConnection,
  sharedJourney: encoded,
  fromTitle: journey.from,
  fromLat: 51.1,
  fromLon: 17.03,
  toId: journey.to,
  toTitle: journey.to,
  toLat: 51.2,
  toLon: 17.05,
  startedAt: midnight.getTime(),
};
const plan = buildLivePlan(nativeProgress, nativeConnection, observed, strings);
assert.equal(plan.deepLink, `kilometr://shared?trip=${encoded}`);
assert.equal(plan.alightAlertsEnabled, false);
assert.equal(plan.transferAlertsEnabled, false);
assert.equal(plan.transferProtectionEnabled, false);
assert.equal(plan.copy.arrived.title, strings.share.notificationArrived);
assert.equal(tripNotificationData(observed).sharedTrip, encoded);
assert.deepEqual(appLinkFiles('', ''), []);
assert.throws(() => appLinkFiles('invalid', ''));
assert.throws(() => appLinkFiles('', 'invalid'));
const associations = appLinkFiles('', 'ABCDE12345');
assert.equal(
  JSON.parse(associations[0].source).applinks.details[0].appIDs[0],
  'ABCDE12345.app.kilometr',
);
console.log(
  'Udostępnianie natywne: linki, walidacja, daty, GPS, opóźnienia i plan Live Update OK.',
);

const shape: [number, number][] = [
  [51.1, 17.01],
  [51.1, 17.02],
  [51.11, 17.02],
  [51.11, 17.03],
];
assert.deepEqual(decodePath(encodePath(shape)), shape);
assert.deepEqual(clipPath(shape, shape[1], shape[3]), shape.slice(1));
assert.equal(clipPath(shape, [52, 18], shape[3]), null);
assert.equal(clipPath(shape, shape[3], shape[0]), null);
assert.equal(decodePath('_'.repeat(30)), null);
const withGeometry = { ...journey, legs: [{ ...journey.legs[0], path: encodePath(shape) }] };
assert.deepEqual(
  sharedToConnection(withGeometry, encodeSharedConnection(withGeometry)).legs[0].geometry,
  shape,
);
assert.equal(
  decodeSharedConnection(
    pack({ ...journey, legs: [{ ...journey.legs[0], path: 'invalid-path' }] }),
  ),
  null,
);
console.log(
  'Geometria: kodowanie, wycinanie kierunkowe, walidacja i odtworzenie z linku offline OK.',
);
