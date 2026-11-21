import '../scripts/stub-expo.cjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  findNextDeparture,
  findTripSegment,
  formatTimetableDate,
  formatTimetableDateCompact,
  getUpcomingDepartures,
  groupDeparturesByHour,
  parseClockToSeconds,
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

test('formatTimetableDateCompact zwraca zwięzłą datę z bezpiecznym fallbackiem', () => {
  const compact = formatTimetableDateCompact('20261023', 'pl');
  assert.match(compact, /23/);
  assert.doesNotThrow(() => formatTimetableDateCompact('invalid', 'invalid-locale-xyz'));
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

test('findTripSegment wyznacza odcinek wsiadania i wysiadania oraz odrzuca odwróconą kolejność', () => {
  const seg = findTripSegment(SAMPLE_PATTERNS[0].stops, {
    fromStopId: 's1',
    toStopId: 's3',
  });
  assert.deepEqual(seg, { fromIndex: 0, toIndex: 2 });

  const reversed = findTripSegment(SAMPLE_PATTERNS[0].stops, {
    fromStopId: 's3',
    toStopId: 's1',
  });
  assert.deepEqual(reversed, { fromIndex: 2, toIndex: -1 });

  assert.equal(
    findTripSegment(SAMPLE_PATTERNS[0].stops, { fromStop: 'Brak', toStop: 'Inny' }),
    null,
  );
});

test('groupDeparturesByHour grupuje odjazdy po godzinie, usuwa duplikaty minut i obsługuje kursy po północy', () => {
  const groups = groupDeparturesByHour([
    8 * 3600 + 5 * 60,
    8 * 3600 + 5 * 60 + 20,
    8 * 3600 + 25 * 60,
    24 * 3600 + 15 * 60,
  ]);
  assert.equal(groups.length, 2);
  assert.equal(groups[0].hour, 8);
  assert.equal(groups[0].displayHour, 8);
  assert.equal(groups[0].dayOffset, 0);
  assert.deepEqual(
    groups[0].minutes.map((m) => m.minute),
    ['05', '25'],
  );
  assert.equal(groups[1].hour, 24);
  assert.equal(groups[1].displayHour, 0);
  assert.equal(groups[1].dayOffset, 1);
  assert.deepEqual(
    groups[1].minutes.map((m) => m.minute),
    ['15'],
  );
});

test('findNextDeparture i getUpcomingDepartures działają tylko dla dzisiejszej daty', () => {
  const deps = [10 * 3600, 10 * 3600 + 15 * 60, 10 * 3600 + 30 * 60, 10 * 3600 + 45 * 60];
  const now = 10 * 3600 + 10 * 60;
  assert.deepEqual(findNextDeparture(deps, now, true), {
    seconds: 10 * 3600 + 15 * 60,
    minutesUntil: 5,
  });
  assert.equal(findNextDeparture(deps, now, false), null);
  assert.deepEqual(getUpcomingDepartures(deps, now, true, 2), [
    10 * 3600 + 15 * 60,
    10 * 3600 + 30 * 60,
  ]);
  assert.deepEqual(getUpcomingDepartures(deps, now, false, 2), []);
});

test('parseClockToSeconds parsuje poprawne godziny i odrzuca błędne formaty', () => {
  assert.equal(parseClockToSeconds('07:35'), 7 * 3600 + 35 * 60);
  assert.equal(parseClockToSeconds('25:10'), 25 * 3600 + 10 * 60);
  assert.equal(parseClockToSeconds(''), null);
  assert.equal(parseClockToSeconds('99:00'), null);
  assert.equal(parseClockToSeconds('12:75'), null);
});
