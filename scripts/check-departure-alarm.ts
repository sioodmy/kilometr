import assert from 'node:assert/strict';
import type { Connection } from '../src/types/models';
import { departureAlarmTiming } from '../src/services/departureAlarmPlan';

const day = new Date(2026, 9, 19, 12, 0);
const at = (h: number, m: number, offset = 0) => new Date(2026, 9, 19 + offset, h, m).getTime();
const connection: Connection = {
  id: 'alarm-trip', fromTitle: 'Dom', toTitle: 'Dworzec',
  departInMin: 25, departureSec: 12 * 3600 + 25 * 60, departAt: '12:25', arriveAt: '13:00',
  durationMin: 35, transfers: 0, delayMin: 0, live: false,
  legs: [
    { id: 'walk', mode: 'walk', fromStop: 'Dom', toStop: 'Przystanek', departAt: '12:25', arriveAt: '12:30', walkM: 300, stopsCount: 0, live: false },
    { id: 'tram', mode: 'tram', line: '4', fromStop: 'Przystanek', toStop: 'Dworzec', departAt: '12:30', arriveAt: '13:00', stopsCount: 8, live: false },
  ],
};
const timing = departureAlarmTiming(connection, 10, day)!;
assert.equal(timing.at, at(12, 15), 'budzik uwzględnia dojście na przystanek');
assert.equal(timing.journeyAt, at(12, 25));
assert.equal(timing.boardAt, at(12, 30));
assert.equal(timing.leg.line, '4');
assert.equal(departureAlarmTiming({ ...connection, departureSec: 12 * 3600 + 30 * 60, legs: connection.legs.slice(1) }, 5, day)?.at, at(12, 25));
assert.equal(departureAlarmTiming({ ...connection, legs: connection.legs.slice(0, 1) }, 5, day), null);
assert.equal(departureAlarmTiming({ ...connection, legs: [] }, 5, day), null);
for (const invalid of [0, -1, 61, 1.5, NaN, Infinity]) {
  assert.equal(departureAlarmTiming(connection, invalid, day), null);
}
const tomorrow = {
  ...connection, departureSec: 86400 + 5 * 60,
  legs: [
    { ...connection.legs[0], departAt: '00:05', arriveAt: '00:10' },
    { ...connection.legs[1], departAt: '00:10', arriveAt: '00:40' },
  ],
};
assert.equal(departureAlarmTiming(tomorrow, 10, new Date(at(23, 30)))?.at, at(23, 55));
assert.equal(departureAlarmTiming(tomorrow, 1, new Date(at(23, 30)))?.at, at(0, 4, 1));
const evening = { ...connection, departureSec: 23 * 3600 + 25 * 60 };
assert.equal(departureAlarmTiming(evening, 10, new Date(at(7, 0)))?.at, at(23, 15), 'godzina ponad 12 h do przodu nie cofa alarmu na wczoraj');
console.log('PASS: budzik, dojście, odjazd, północ, jutrzejszy rozkład i walidacja wyprzedzenia');
