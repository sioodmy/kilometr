import '../scripts/stub-expo.cjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  formatTimetableDate,
  shiftTimetableDate,
  timetableToday,
} from '../src/services/lineTimetable';

test('formatTimetableDate zwraca poprawny sformatowany string dla poprawnej daty', () => {
  const result = formatTimetableDate('20261023', 'pl');
  assert.equal(typeof result, 'string');
  assert.ok(result.length > 0);
  assert.match(result, /23/);
  assert.match(result, /2026/);
});

test('formatTimetableDate nie rzuca wyjątku dla niepoprawnych danych i zwraca sformatowany dzisiejszy dzień', () => {
  const todayFormatted = formatTimetableDate(timetableToday(), 'pl');
  const invalidDates = [
    '',
    '2026',
    '20261',
    '2026102',
    'not-a-date',
    '2026-10-23',
    'abcdefgh',
    '20261399',
    '99999999',
    '   ',
    '202610231',
  ];

  for (const invalidDate of invalidDates) {
    assert.doesNotThrow(() => {
      const output = formatTimetableDate(invalidDate, 'pl');
      assert.equal(typeof output, 'string');
      assert.ok(output.length > 0);
      assert.equal(output, todayFormatted);
    });
  }
});

test('formatTimetableDate radzi sobie z nietypowym locale bez rzucania błędu', () => {
  assert.doesNotThrow(() => {
    const output = formatTimetableDate('20261023', 'invalid-locale-xyz');
    assert.equal(typeof output, 'string');
    assert.ok(output.length > 0);
  });
});

test('shiftTimetableDate bezpiecznie obsługuje niepoprawny format daty', () => {
  const invalidDates = ['', '2026', 'niepoprawna-data', 'abcdefgh', '2026-10-23'];
  for (const invalidDate of invalidDates) {
    assert.doesNotThrow(() => {
      const result = shiftTimetableDate(invalidDate, 0);
      assert.equal(result, timetableToday());
    });
  }
});
