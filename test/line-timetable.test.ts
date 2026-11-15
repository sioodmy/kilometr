import '../scripts/stub-expo.cjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  formatTimetableDate,
  selectInitialPattern,
  shiftTimetableDate,
  timetableToday,
  type LinePattern,
} from '../src/services/lineTimetable';

const SAMPLE_PATTERNS: LinePattern[] = [
  {
    id: 'p1',
    headsign: 'Krzyki',
    stops: [
      { id: 's1', name: 'Osobowice', code: '1', departures: [3600] },
      { id: 's2', name: 'Dworzec Nadodrze', code: '2', departures: [3900] },
      { id: 's3', name: 'Krzyki', code: '3', departures: [4200] },
    ],
  },
  {
    id: 'p2',
    headsign: 'Osobowice',
    stops: [
      { id: 's3', name: 'Krzyki', code: '3', departures: [3700] },
      { id: 's2', name: 'Dworzec Nadodrze', code: '2', departures: [4000] },
      { id: 's1', name: 'Osobowice', code: '1', departures: [4300] },
    ],
  },
  {
    id: 'p3',
    headsign: 'Osobowice',
    stops: [
      { id: 's2', name: 'Dworzec Nadodrze', code: '2', departures: [3800] },
      { id: 's4', name: 'Łużycka', code: '4', departures: [4100] },
      { id: 's1', name: 'Osobowice', code: '1', departures: [4400] },
    ],
  },
];

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

test('selectInitialPattern dopasowuje kierunek niezależnie od wielkości liter i polskich znaków', () => {
  const picked = selectInitialPattern(SAMPLE_PATTERNS, { direction: 'OSOBOWICE' });
  assert.equal(picked?.id, 'p2');
});

test('selectInitialPattern rozstrzyga warianty o tym samym headsign po odcinku przystanków', () => {
  const picked = selectInitialPattern(SAMPLE_PATTERNS, {
    direction: 'OSOBOWICE',
    fromStopId: 's4',
    toStopId: 's1',
  });
  assert.equal(picked?.id, 'p3');

  const pickedPolish = selectInitialPattern(SAMPLE_PATTERNS, {
    direction: 'Osobowice',
    fromStop: 'Luzycka',
    toStop: 'Osobowice',
  });
  assert.equal(pickedPolish?.id, 'p3');
});

test('selectInitialPattern zwraca pierwszy wariant gdy brak dopasowania', () => {
  assert.equal(selectInitialPattern(SAMPLE_PATTERNS, { direction: 'Nieznany' })?.id, 'p1');
  assert.equal(selectInitialPattern([], { direction: 'Osobowice' }), undefined);
});
