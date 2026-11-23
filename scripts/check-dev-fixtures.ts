import assert from 'node:assert/strict';
import { transferFixture } from '../src/dev/transferFixture';
import { homeFixture, type HomeDevScenario } from '../src/dev/homeFixture';
import {
  searchFixture,
  filterMockSearch,
  type SearchDevScenario,
} from '../src/dev/searchFixture';
import { hasTransfer } from '../src/services/notifications/transferTypes';

console.log('--- Testowanie fixturek deweloperskich ---');

// 1. Transfer Fixture
console.log('1. transferFixture');
const transferStatuses = [
  'waiting',
  'safe',
  'risk',
  'alternative',
  'noAlternative',
  'unavailable',
] as const;

for (const status of transferStatuses) {
  const f = transferFixture(status);
  assert.ok(f.connection, `Brak connection dla statusu ${status}`);
  assert.equal(f.state.status, status);
  assert.ok(f.connection.legs.length >= 2, `Za mało etapów dla transferFixture (${status})`);
  assert.ok(hasTransfer(f.connection), `hasTransfer powienien być true (${status})`);
}

const direct = transferFixture('safe', false, true);
assert.equal(direct.connection.legs.length, 1, 'Połączenie bezpośrednie powinno mieć 1 etap');
assert.ok(!hasTransfer(direct.connection), 'Połączenie bezpośrednie nie powinno mieć przesiadki');

const expired = transferFixture('alternative', true);
assert.ok(expired.state.alternative, 'Powinna istnieć alternatywa');
assert.ok(
  expired.state.alternative!.validUntil < Date.now(),
  'Wygasła alternatywa powinna mieć validUntil w przeszłości',
);

// 2. Home Fixture
console.log('2. homeFixture');
const homeScenarios: HomeDevScenario[] = [
  'standard',
  'empty',
  'updateAvailable',
  'downloading',
  'importing',
  'error',
  'outsideGps',
  'customStart',
];

for (const sc of homeScenarios) {
  const h = homeFixture(sc);
  assert.ok(h.cityId, `Brak cityId w scenariuszu home: ${sc}`);
  assert.ok(h.locTitle, `Brak locTitle w scenariuszu home: ${sc}`);

  if (sc === 'standard') {
    assert.ok(h.saved.length > 0, 'Standard powinien mieć zapisane miejsca');
    assert.ok(h.smart.length > 0, 'Standard powinien mieć smart miejsca');
    assert.ok(h.lastTrip !== null, 'Standard powinien mieć lastTrip');
    assert.equal(h.dataStatus.state, 'ready');
  } else if (sc === 'empty') {
    assert.equal(h.saved.length, 0, 'Empty nie powinno mieć zapisanych miejsc');
    assert.equal(h.smart.length, 0, 'Empty nie powinno mieć smart miejsc');
    assert.equal(h.lastTrip, null, 'Empty nie powinno mieć lastTrip');
  } else if (sc === 'updateAvailable') {
    assert.ok(h.timetableUpdate !== null, 'Scenariusz updateAvailable powinien mieć timetableUpdate');
  } else if (sc === 'downloading') {
    assert.equal(h.dataStatus.state, 'downloading');
    assert.ok(h.dataStatus.progress > 0);
  } else if (sc === 'importing') {
    assert.equal(h.dataStatus.state, 'importing');
    assert.ok(h.dataStatus.step.length > 0);
  } else if (sc === 'error') {
    assert.equal(h.dataStatus.state, 'error');
    assert.ok(h.dataStatus.message.length > 0);
  } else if (sc === 'outsideGps') {
    assert.equal(h.gpsUnsupported, true);
    assert.equal(h.gpsCity, 'Warszawa');
  } else if (sc === 'customStart') {
    assert.equal(h.isCustomStart, true);
  }
}

// 3. Search Fixture
console.log('3. searchFixture');
const searchScenarios: SearchDevScenario[] = [
  'initial',
  'results',
  'lines',
  'loading',
  'noResults',
  'error',
  'startMode',
  'gpsNotice',
];

for (const sc of searchScenarios) {
  const s = searchFixture(sc);
  assert.ok(s.recent.length > 0, `Scenariusz search ${sc} powinien mieć historię recent`);
  assert.ok(s.savedQuick.length > 0, `Scenariusz search ${sc} powinien mieć savedQuick`);

  if (sc === 'initial') {
    assert.equal(s.query, '');
    assert.equal(s.loading, false);
    assert.equal(s.error, false);
  } else if (sc === 'results') {
    assert.ok(s.query.length > 0);
    assert.ok(s.results.length > 0);
  } else if (sc === 'lines') {
    assert.ok(s.lineMatches.length > 0);
  } else if (sc === 'loading') {
    assert.equal(s.loading, true);
  } else if (sc === 'error') {
    assert.equal(s.error, true);
  } else if (sc === 'startMode') {
    assert.equal(s.originTitle, undefined);
    assert.ok(s.placeholder?.includes('startowy'));
  } else if (sc === 'gpsNotice') {
    assert.ok(s.notice !== undefined && s.notice.length > 0);
  }
}

// 4. In-memory filterMockSearch
console.log('4. filterMockSearch');
const rynekSearch = filterMockSearch('Rynek');
assert.ok(rynekSearch.results.length > 0, 'filterMockSearch("Rynek") powinien zwrócić wyniki');
assert.ok(
  rynekSearch.results.some((r) => r.title.includes('Rynek')),
  'Wyniki powinny zawierać "Rynek"',
);

const lineSearch = filterMockSearch('4');
assert.ok(lineSearch.lineMatches.length > 0, 'filterMockSearch("4") powinien zwrócić pasujące linie');
assert.ok(
  lineSearch.lineMatches.some((l) => l.shortName === '4'),
  'Wyniki linii powinny zawierać linię 4',
);

const errorSearch = filterMockSearch('error');
assert.equal(errorSearch.error, true, 'filterMockSearch("error") powinien zwrócić flagę błędu');

const emptySearch = filterMockSearch('');
assert.equal(emptySearch.results.length, 0);
assert.equal(emptySearch.lineMatches.length, 0);

console.log('✅ Wszystkie testy fixturek deweloperskich przeszły pomyślnie!');
