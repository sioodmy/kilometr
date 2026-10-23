import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';

const require = createRequire(import.meta.url);
const sqlite: typeof import('expo-sqlite') = require('expo-sqlite');
const db = new DatabaseSync(':memory:');
Object.assign(sqlite, {
  openDatabaseAsync: async () => ({
    execAsync: async (sql: string) => {
      db.exec(sql);
    },
    getAllAsync: async (sql: string, ...params: SQLInputValue[]) => db.prepare(sql).all(...params),
    getFirstAsync: async (sql: string, ...params: SQLInputValue[]) =>
      db.prepare(sql).get(...params) ?? null,
  }),
});

async function main() {
  const { searchTransitLines, loadLineTimetable, shiftTimetableDate, timetableClock } =
    await import('../src/services/lineTimetable');
  await searchTransitLines('4');
  db.exec(`
    INSERT INTO routes VALUES ('tram4', '4', 'A → C', 0), ('bus4', '4', 'D → E', 3), ('tram14', '14', '', 0), ('n1', 'N1', '', 3);
    INSERT INTO stops (stop_id, code, name, lat, lon, norm) VALUES
      ('a', '01', 'A', 0, 0, 'a'), ('b', '02', 'B', 0, 0, 'b'), ('c', '03', 'C', 0, 0, 'c'), ('d', '04', 'D', 0, 0, 'd');
    INSERT INTO calendar (service_id, mon, tue, wed, thu, fri, start_date, end_date) VALUES
      ('weekday', 1, 1, 1, 1, 1, '20261001', '20261031'), ('expired', 1, 1, 1, 1, 1, '20260901', '20260930');
    INSERT INTO calendar (service_id, sat, sun, start_date, end_date) VALUES ('weekend', 1, 1, '20261001', '20261031');
    INSERT INTO trips (trip_id, route_id, service_id, headsign, direction) VALUES
      ('out1', 'tram4', 'weekday', 'C', 0), ('out2', 'tram4', 'weekday', 'C', 0),
      ('back', 'tram4', 'weekday', '', 1), ('detour', 'tram4', 'weekday', 'C', 0),
      ('night', 'tram4', 'weekday', 'C', 0), ('old', 'tram4', 'expired', 'C', 0),
      ('sat', 'tram4', 'weekend', 'C', 0), ('extra', 'tram4', 'special', 'C', 0);
  `);
  const addTimes = (trip: string, stops: string[], start: number) => {
    stops.forEach((stop, index) =>
      db
        .prepare('INSERT INTO stop_times VALUES (?, ?, ?, ?, ?)')
        .run(trip, stop, start + index * 60, start + index * 60, index + 1),
    );
  };
  addTimes('out1', ['a', 'b', 'c'], 3600);
  addTimes('out2', ['a', 'b', 'c'], 7200);
  addTimes('night', ['a', 'b', 'c'], 90000);
  addTimes('back', ['c', 'b', 'a'], 4000);
  addTimes('detour', ['a', 'd', 'c'], 5000);
  addTimes('old', ['a', 'b', 'c'], 100);
  addTimes('sat', ['a', 'b', 'c'], 6000);
  addTimes('extra', ['a', 'b', 'c'], 7000);

  assert.deepEqual(
    (await searchTransitLines(' 4 ')).map((line) => line.routeId),
    ['tram4', 'bus4'],
  );
  assert.equal((await searchTransitLines('n1'))[0].shortName, 'N1');
  assert.deepEqual(await searchTransitLines("4' OR 1=1"), []);
  assert.deepEqual(await searchTransitLines(''), []);
  const friday = await loadLineTimetable('tram4', '20261023');
  assert.equal(friday.patterns.length, 3);
  assert.deepEqual(
    friday.patterns[0].stops.map((stop) => stop.id),
    ['a', 'b', 'c'],
  );
  assert.deepEqual(friday.patterns[0].stops[0].departures, [3600, 7200, 90000]);
  assert.equal(friday.patterns.find((pattern) => pattern.stops[0].id === 'c')?.headsign, 'A');
  assert.deepEqual(
    friday.patterns.find((pattern) => pattern.stops[1].id === 'd')?.stops[0].departures,
    [5000],
  );
  assert.deepEqual(
    (await loadLineTimetable('tram4', '20261024')).patterns[0].stops[0].departures,
    [6000],
  );
  assert.deepEqual((await loadLineTimetable('tram4', '20261102')).patterns, []);
  assert.equal((await loadLineTimetable('missing', '20261023')).line, null);

  db.exec(
    "INSERT INTO calendar_dates VALUES ('weekday', '20261023', 2), ('special', '20261023', 1)",
  );
  assert.deepEqual(
    (await loadLineTimetable('tram4', '20261023')).patterns[0].stops[0].departures,
    [7000],
  );
  db.exec('DELETE FROM calendar');
  assert.deepEqual((await loadLineTimetable('tram4', '20261024')).patterns, []);
  assert.deepEqual(
    (await loadLineTimetable('tram4', '20261023')).patterns[0].stops[0].departures,
    [7000],
  );
  assert.equal(shiftTimetableDate('20261025', 1), '20261026');
  assert.equal(shiftTimetableDate('20261231', 1), '20270101');
  assert.equal(shiftTimetableDate('20260301', -1), '20260228');
  assert.equal(timetableClock(90000), '01:00');
  console.log('PASS: wyszukiwanie, kierunki, objazdy, dni, wyjątki, zakres dat, kursy po północy.');
  db.close();
}

void main();
