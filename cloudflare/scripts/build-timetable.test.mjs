import assert from 'node:assert/strict';
import { test } from 'node:test';
import { eachStopTime, parseStopTimesByTrip } from './build-timetable.mjs';

// Szczecin cytuje pola i wrzuca przecinek do trip_id, więc split(',')
// rozjeżdżał kolumny i wywalał UNIQUE constraint failed.
const SZCZECIN_STOP_TIMES = [
  'trip_id,arrival_time,departure_time,stop_id,stop_sequence',
  '"12,345",08:00:00,08:00:00,101,1',
  '"12,345",08:05:00,08:06:00,102,2',
  '"12,345",08:05:00,08:06:00,102,2',
].join('\n');

test('Cytowany trip_id z przecinkiem nie rozjeżdża kolumn stop_times', () => {
  const byTrip = parseStopTimesByTrip(SZCZECIN_STOP_TIMES);
  assert.deepEqual([...byTrip.keys()], ['12,345']);
  assert.deepEqual(byTrip.get('12,345'), [
    ['101', 28800, 28800, 1],
    ['102', 29100, 29160, 2],
  ]);
});

test('stop_times deduplikuje (trip_id, stop_sequence) i waliduje kolumny', () => {
  const rows = [];
  eachStopTime(SZCZECIN_STOP_TIMES, 'fixture', (row) => rows.push(row));
  assert.equal(rows.length, 2);
  assert.throws(
    () => parseStopTimesByTrip('trip_id,stop_id,stop_sequence\nT1,101,1\n'),
    /wymaganej kolumny arrival_time/,
  );
});
