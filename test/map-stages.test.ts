import '../scripts/stub-expo.cjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import { buildMapStages, resolveStageSelection } from '../src/map/stages';
import type { MapLeg, MapRoute } from '../src/map/types';

function createMockLeg(overrides: Partial<MapLeg> = {}): MapLeg {
  const legId = overrides.id ?? 'leg-1';
  return {
    id: legId,
    mode: 'train',
    color: '#0055ff',
    fromStop: 'Warszawa Centralna',
    toStop: 'Kraków Główny',
    departAt: '06:00',
    arriveAt: '08:30',
    stopsCount: 8,
    walkM: undefined,
    live: false,
    approx: false,
    stops: [
      { id: 's1', legId, seq: 1, name: 'Warszawa Centralna', lat: 52.2288, lon: 21.0032, role: 'board' },
      { id: 's2', legId, seq: 2, name: 'Warszawa Zachodnia', lat: 52.2195, lon: 20.9657, role: 'intermediate' },
      { id: 's3', legId, seq: 3, name: 'Opoczno Południe', lat: 51.3500, lon: 20.2500, role: 'intermediate' },
      { id: 's4', legId, seq: 4, name: 'Włoszczowa Północ', lat: 50.8600, lon: 19.9800, role: 'intermediate' },
      { id: 's5', legId, seq: 5, name: 'Miechów', lat: 50.3600, lon: 20.0300, role: 'intermediate' },
      { id: 's6', legId, seq: 6, name: 'Kraków Główny', lat: 50.0684, lon: 19.9479, role: 'alight' },
    ],
    ...overrides,
  };
}

function createMockRoute(legs: MapLeg[]): MapRoute {
  return {
    id: 'conn-1',
    fromTitle: legs[0]?.fromStop ?? '',
    toTitle: legs[legs.length - 1]?.toStop ?? '',
    departAt: legs[0]?.departAt ?? '',
    arriveAt: legs[legs.length - 1]?.arriveAt ?? '',
    durationMin: 150,
    legs,
    geometry: 'approx',
  };
}

test('buildMapStages: zwraca pustą tablicę dla pustej trasy lub braku nóg', () => {
  assert.deepEqual(buildMapStages(null), []);
  assert.deepEqual(buildMapStages(createMockRoute([])), []);
});

test('buildMapStages: długa trasa kolejowa (single-leg) NIE jest dzielona na części', () => {
  const trainLeg = createMockLeg({
    id: 'train-long',
    mode: 'train',
    fromStop: 'Gdańsk Główny',
    toStop: 'Zakopane',
    departAt: '05:00',
    arriveAt: '15:30',
    stopsCount: 15,
  });

  const stages = buildMapStages(createMockRoute([trainLeg]));
  assert.equal(stages.length, 1, 'Pojedyncza noga kolejowa powinna dać dokładnie 1 etap');
  assert.equal(stages[0].id, 'train-long');
  assert.equal(stages[0].legId, 'train-long');
  assert.equal(stages[0].stageNumber, 1);
  assert.equal(stages[0].totalStages, 1);
  assert.equal(stages[0].fromStop, 'Gdańsk Główny');
  assert.equal(stages[0].toStop, 'Zakopane');
  assert.equal(stages[0].segmentIndex, undefined);
  assert.equal(stages[0].segmentCount, undefined);
  assert.equal(stages[0].endpointRole, undefined);
});

test('buildMapStages: trasa z przesiadką (pieszo + pociąg dalekobieżny + pieszo) ma dokładnie 3 etapy bez segmentów', () => {
  const walk1 = createMockLeg({
    id: 'walk-1',
    mode: 'walk',
    fromStop: 'Dom',
    toStop: 'Warszawa Centralna',
    departAt: '05:40',
    arriveAt: '05:55',
    stopsCount: 0,
    walkM: 500,
  });
  const train = createMockLeg({
    id: 'train-ic',
    mode: 'train',
    fromStop: 'Warszawa Centralna',
    toStop: 'Wrocław Główny',
    departAt: '06:05',
    arriveAt: '09:50',
    stopsCount: 10,
  });
  const walk2 = createMockLeg({
    id: 'walk-2',
    mode: 'walk',
    fromStop: 'Wrocław Główny',
    toStop: 'Hotel',
    departAt: '09:55',
    arriveAt: '10:05',
    stopsCount: 0,
    walkM: 300,
  });

  const stages = buildMapStages(createMockRoute([walk1, train, walk2]));
  assert.equal(stages.length, 3, 'Trasa o 3 nogach powinna mieć dokładnie 3 etapy');
  assert.deepEqual(
    stages.map((s) => s.id),
    ['walk-1', 'train-ic', 'walk-2'],
  );
  assert.deepEqual(
    stages.map((s) => s.stageNumber),
    [1, 2, 3],
  );
  assert.deepEqual(
    stages.map((s) => s.totalStages),
    [3, 3, 3],
  );

  for (const s of stages) {
    assert.ok(!s.id.includes('@seg'), `Etap ${s.id} nie powinien mieć @seg`);
    assert.ok(!s.id.includes('@start'), `Etap ${s.id} nie powinien mieć @start`);
    assert.ok(!s.id.includes('@end'), `Etap ${s.id} nie powinien mieć @end`);
  }
});

test('resolveStageSelection: poprawnie wybiera etap po stage.id lub leg.id', () => {
  const stages = buildMapStages(
    createMockRoute([createMockLeg({ id: 'leg-a' }), createMockLeg({ id: 'leg-b' })]),
  );

  assert.equal(resolveStageSelection(stages, null), null);
  assert.equal(resolveStageSelection(stages, 'non-existent'), null);
  assert.equal(resolveStageSelection(stages, 'leg-a')?.id, 'leg-a');
  assert.equal(resolveStageSelection(stages, 'leg-b')?.id, 'leg-b');
});

test('buildMapStages: odrzuca pusty spacer 0m na początku lub końcu trasy z innymi nogami', () => {
  const zeroWalkStart = createMockLeg({
    id: 'walk-zero-start',
    mode: 'walk',
    fromStop: 'Katowice',
    toStop: 'Katowice',
    departAt: '10:00',
    arriveAt: '10:00',
    walkM: 0,
    stopsCount: 0,
  });
  const train = createMockLeg({
    id: 'train-ic',
    mode: 'train',
    fromStop: 'Katowice',
    toStop: 'Warszawa Centralna',
    departAt: '10:00',
    arriveAt: '12:30',
    stopsCount: 5,
  });
  const zeroWalkEnd = createMockLeg({
    id: 'walk-zero-end',
    mode: 'walk',
    fromStop: 'Warszawa Centralna',
    toStop: 'Warszawa Centralna',
    departAt: '12:30',
    arriveAt: '12:30',
    walkM: 0,
    stopsCount: 0,
  });

  const stages = buildMapStages(createMockRoute([zeroWalkStart, train, zeroWalkEnd]));
  assert.equal(stages.length, 1, 'Puste spacery powinny zostać odrzucone, zostaje tylko pociąg');
  assert.equal(stages[0].id, 'train-ic');
  assert.equal(stages[0].stageNumber, 1);
  assert.equal(stages[0].totalStages, 1);
});
