import assert from 'node:assert/strict';
import test from 'node:test';
import {
  EARLIER_PULL_ARM,
  EARLIER_PULL_DISARM,
  EARLIER_PULL_EDGE_MAX,
  EARLIER_PULL_MAX,
  earlierRubberBand,
  nextEarlierPullArmed,
} from '../src/services/earlierPull';
import { computeReorderShifts } from '../src/services/routing/listReorder';

test('earlierRubberBand rośnie monotonicznie i nie przekracza limitu', () => {
  assert.equal(earlierRubberBand(0), 0);
  assert.equal(earlierRubberBand(-20), 0);

  const small = earlierRubberBand(20);
  const mid = earlierRubberBand(90);
  const huge = earlierRubberBand(10000);

  assert.ok(small > 0 && small < mid && mid < huge);
  assert.ok(huge <= EARLIER_PULL_MAX);
  assert.ok(earlierRubberBand(10000, EARLIER_PULL_EDGE_MAX) <= EARLIER_PULL_EDGE_MAX);
});

test('nextEarlierPullArmed pilnuje progu uzbrojenia i histerezy', () => {
  assert.equal(nextEarlierPullArmed(false, EARLIER_PULL_ARM - 1), false);
  assert.equal(nextEarlierPullArmed(false, EARLIER_PULL_ARM), true);
  assert.equal(nextEarlierPullArmed(true, EARLIER_PULL_DISARM), true);
  assert.equal(nextEarlierPullArmed(true, EARLIER_PULL_DISARM - 1), false);
});

test('computeReorderShifts ignoruje prepend, append i filtrowanie', () => {
  const heights = new Map([
    ['a', 150],
    ['b', 160],
    ['c', 170],
  ]);

  // Prepend wcześniejszych połączeń z góry
  assert.equal(
    computeReorderShifts(['a', 'b', 'c'], ['p1', 'p2', 'a', 'b', 'c'], heights, 160, 12).size,
    0,
  );

  // Append późniejszych połączeń na dole
  assert.equal(
    computeReorderShifts(['a', 'b'], ['a', 'b', 'c', 'd'], heights, 160, 12).size,
    0,
  );

  // Filtrowanie usuwa elementy, ale nie zmienia kolejności pozostałych
  assert.equal(
    computeReorderShifts(['a', 'b', 'c'], ['a', 'c'], heights, 160, 12).size,
    0,
  );
});

test('computeReorderShifts dokładnie liczy przesunięcia FLIP przy opóźnieniu kart', () => {
  const heights = new Map([
    ['delayed', 150],
    ['fast', 180],
    ['steady', 140],
  ]);

  // Karta 'delayed' spada za 'fast', a 'steady' zostaje na 3. miejscu.
  const shifts = computeReorderShifts(
    ['delayed', 'fast', 'steady'],
    ['fast', 'delayed', 'steady'],
    heights,
    160,
    12,
  );

  assert.equal(shifts.size, 2);
  assert.deepEqual(shifts.get('fast'), { deltaY: 162, direction: 'up' });
  assert.deepEqual(shifts.get('delayed'), { deltaY: -192, direction: 'down' });
  assert.equal(shifts.has('steady'), false);
});
