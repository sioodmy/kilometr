process.env.TZ = 'Europe/Warsaw';
import { pl } from '../src/i18n/pl';
import { en } from '../src/i18n/en';
import { de } from '../src/i18n/de';
import { uk } from '../src/i18n/uk';
import assert from 'node:assert/strict';
import {
  boardingDepartureMs,
  boardingDepartureSec,
  legDurationMin,
  refreshConnectionTimes,
} from '../src/services/routing/connectionTimes';
import { predictDelaySec } from '../src/services/routing/delays';
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

const directNight: Connection = {
  ...overnight,
  departureSec: 86700,
  arrivalSec: 87600,
  legs: [overnight.legs[1]],
};
const directNightDelayed = refreshConnectionTimes(directNight, new Map([['tram', 300]]), midnight);
assert.equal(directNightDelayed.live, true);
assert.equal(directNightDelayed.legs[0].departAt, '00:08');

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

// Czas trwania odcinka (np. pociąg Wrocław - Katowice 6 stacji ~133 min, a nie stopsCount*2 = 12 min)
assert.equal(
  legDurationMin({ departAt: '08:15', arriveAt: '10:28', stopsCount: 6 }),
  133,
);
assert.equal(
  legDurationMin({ departAt: '23:45', arriveAt: '01:15', stopsCount: 4 }),
  90,
);
assert.equal(
  legDurationMin({ departAt: '', arriveAt: '', scheduledDepartureSec: 36000, scheduledArrivalSec: 39600 }),
  60,
);
assert.equal(
  legDurationMin({ departAt: '', arriveAt: '', stopsCount: 5 }),
  10,
);

// Opóźnienie pociągu nie może wygasać do 0 dla odjazdów za kilkadziesiąt minut (w przeciwieństwie do tramwajów miejskich)
assert.equal(predictDelaySec(2580, 2700, 'board', 'train'), 2580);
assert.equal(predictDelaySec(2580, 7200, 'arrive', 'train'), 2580);
const futureTrainNow = new Date(2026, 9, 27, 9, 15); // 45 min przed odjazdem o 10:00 (36000)
const trainConnection: Connection = {
  ...connection,
  legs: [
    connection.legs[0],
    {
      ...connection.legs[1],
      id: 'train-ic',
      mode: 'train',
      tripId: 'pl:PLK_IC_2026_107625',
      line: 'IC 8308/9',
    },
    connection.legs[2],
  ],
};
const delayedTrain = refreshConnectionTimes(
  trainConnection,
  new Map([['pl:PLK_IC_2026_107625', 2580]]),
  futureTrainNow,
);
assert.equal(delayedTrain.live, true);
assert.equal(delayedTrain.delayMin, 43);
assert.equal(delayedTrain.legs[1].delaySec, 2580);
assert.equal(delayedTrain.legs[1].departAt, '10:43');

// Opoznienie rosnie po drodze: odjazd +3 min, przyjazd +26 min. Godzina
// przyjazdu i wskaznik opoznienia musza brac prognoze z konca trasy.
const arrivalDelayedTrain = refreshConnectionTimes(
  trainConnection,
  new Map([['pl:PLK_IC_2026_107625', 180]]),
  futureTrainNow,
  new Map(),
  new Map([['pl:PLK_IC_2026_107625', 1560]]),
);
assert.equal(arrivalDelayedTrain.legs[1].delaySec, 180);
assert.equal(arrivalDelayedTrain.legs[1].departAt, '10:03');
assert.equal(arrivalDelayedTrain.legs[1].arrivalDelaySec, 1560);
assert.equal(arrivalDelayedTrain.legs[1].arriveAt, '10:46');
assert.equal(arrivalDelayedTrain.arriveAt, '10:51');
assert.equal(arrivalDelayedTrain.delayMin, 26);

// Formatowanie czasu podróży (human readable dla >= 60 min)
assert.equal(pl.common.durMin(25), "25 min");
assert.equal(pl.common.durMin(59), "59 min");
assert.equal(pl.common.durMin(60), "1h");
assert.equal(pl.common.durMin(90), "1h 30m");
assert.equal(pl.common.durMin(120), "2h");
assert.equal(pl.common.durMin(125), "2h 5m");
assert.equal(pl.common.durMin(133), "2h 13m");

assert.equal(en.common.durMin(125), "2h 5m");
assert.equal(de.common.durMin(125), "2h 5m");
assert.equal(uk.common.durMin(125), "2 год 5 хв");
assert.equal(uk.common.durMin(60), "1 год");

assert.equal(pl.share.duration(125), "2h 5m");
assert.equal(en.share.duration(125), "2h 5m");
assert.equal(de.share.duration(125), "2h 5m");
assert.equal(uk.share.duration(125), "2 год 5 хв");

assert.equal(pl.landing.journeyDemo.duration(125), "2h 5m");

console.log(
  'PASS: godziny live, wzrost i spadek opóźnienia, brak kumulacji, rozkład offline, przesiadki, odjazd bez dojścia, północ, pociągi i starsze plany',
);
