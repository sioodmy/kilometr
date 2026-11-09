import test from 'node:test';
import assert from 'node:assert/strict';
import {
  COMPENSATION_MAX_UPDATE_AGE_MS,
  COMPENSATION_MIN_ADVANCE_MS,
  COMPENSATION_WINDOW_AFTER_MS,
  COMPENSATION_WINDOW_BEFORE_MS,
  cancelledTrainLeg,
  compensationLevelForDelay,
  compensationThresholdMinutes,
  connectionDelayAtAttachSec,
  isCompensationCandidate,
  measuredCompensationDelay,
} from '../src/services/notifications/compensation';
import type { NationalRailLegUpdate } from '../src/services/nationalRailUpdates';
import type { Connection, Leg } from '../src/types/models';

function trainLeg(overrides: Partial<Leg> = {}): Leg {
  return {
    id: 'leg',
    mode: 'train',
    line: 'IC',
    trainNumber: '1234',
    tripId: 'pl:PLK_IC_TEST',
    fromStop: 'Wrocław Główny',
    toStop: 'Warszawa Centralna',
    departAt: '10:00',
    arriveAt: '12:00',
    stopsCount: 5,
    live: false,
    ...overrides,
  };
}

function connection(legs: Leg[], overrides: Partial<Connection> = {}): Connection {
  return {
    id: 'conn-1',
    fromTitle: 'Wrocław Główny',
    toTitle: 'Warszawa Centralna',
    departInMin: 60,
    departureSec: 10 * 3600,
    arrivalSec: 12 * 3600,
    departAt: '10:00',
    arriveAt: '12:00',
    durationMin: 120,
    transfers: 0,
    delayMin: 0,
    live: false,
    legs,
    ...overrides,
  };
}

function update(overrides: Partial<NationalRailLegUpdate> = {}): NationalRailLegUpdate {
  return {
    tripId: 'pl:PLK_IC_TEST',
    delaySec: 0,
    cancelled: false,
    detour: false,
    fetchedAt: Date.now(),
    ...overrides,
  };
}

test('compensation thresholds include the data margin', () => {
  assert.equal(compensationLevelForDelay(69 * 60), null);
  assert.equal(compensationLevelForDelay(70 * 60), 25);
  assert.equal(compensationLevelForDelay(129 * 60), 25);
  assert.equal(compensationLevelForDelay(130 * 60), 50);
  assert.equal(compensationThresholdMinutes(25), 60);
  assert.equal(compensationThresholdMinutes(50), 120);
});

test('candidate needs advance purchase, clean baseline and a trip in the window', () => {
  const departure = 1_800_000_000_000;
  const base = {
    addedAt: departure - COMPENSATION_MIN_ADVANCE_MS - 1,
    scheduledDepartureMs: departure,
    boardingDepartureMs: departure,
    arrivalMs: departure + 2 * 3600_000,
    delayAtAttachSec: 0,
    now: departure - 3600_000,
  };

  assert.equal(isCompensationCandidate(base), true);
  assert.equal(
    isCompensationCandidate({ ...base, addedAt: departure - COMPENSATION_MIN_ADVANCE_MS + 1 }),
    false,
  );
  assert.equal(isCompensationCandidate({ ...base, delayAtAttachSec: 60 * 60 }), false);
  assert.equal(isCompensationCandidate({ ...base, delayAtAttachSec: undefined }), false);
  assert.equal(
    isCompensationCandidate({ ...base, now: departure - COMPENSATION_WINDOW_BEFORE_MS - 1 }),
    false,
  );
  assert.equal(
    isCompensationCandidate({
      ...base,
      now: base.arrivalMs + COMPENSATION_WINDOW_AFTER_MS + 1,
    }),
    false,
  );
});

test('measured delay prefers the last train, then an earlier delayed train', () => {
  const first = trainLeg({ id: 'first', tripId: 'pl:PLK_FIRST' });
  const last = trainLeg({ id: 'last', tripId: 'pl:PLK_LAST' });
  const conn = connection([first, last]);

  const direct = measuredCompensationDelay(
    conn,
    new Map([
      ['pl:PLK_FIRST', update({ tripId: 'pl:PLK_FIRST', delaySec: 600, hasRealtimeDelay: true })],
      [
        'pl:PLK_LAST',
        update({ tripId: 'pl:PLK_LAST', arrivalDelaySec: 7800, hasRealtimeDelay: true }),
      ],
    ]),
  );
  assert.equal(direct?.leg.id, 'last');
  assert.equal(direct?.delaySec, 7800);

  const fallback = measuredCompensationDelay(
    conn,
    new Map([
      [
        'pl:PLK_FIRST',
        update({ tripId: 'pl:PLK_FIRST', arrivalDelaySec: 4200, hasRealtimeDelay: true }),
      ],
      ['pl:PLK_LAST', update({ tripId: 'pl:PLK_LAST', delaySec: 0, hasRealtimeDelay: false })],
    ]),
  );
  assert.equal(fallback?.leg.id, 'first');
  assert.equal(fallback?.delaySec, 4200);

  assert.equal(measuredCompensationDelay(conn, new Map()), null);
});

test('stale feed data cannot trigger a compensation alert', () => {
  const conn = connection([trainLeg()]);
  const stale = update({
    arrivalDelaySec: 7800,
    hasRealtimeDelay: true,
    fetchedAt: Date.now() - COMPENSATION_MAX_UPDATE_AGE_MS - 1,
  });
  assert.equal(measuredCompensationDelay(conn, new Map([['pl:PLK_IC_TEST', stale]])), null);

  const fresh = update({ arrivalDelaySec: 7800, hasRealtimeDelay: true });
  assert.equal(
    measuredCompensationDelay(conn, new Map([['pl:PLK_IC_TEST', fresh]]))?.delaySec,
    7800,
  );
});

test('cancelled train blocks the whole ticket', () => {
  const conn = connection([
    trainLeg({ id: 'first', tripId: 'pl:PLK_FIRST' }),
    trainLeg({ id: 'last', tripId: 'pl:PLK_LAST' }),
  ]);
  const cancelled = cancelledTrainLeg(
    conn,
    new Map([
      ['pl:PLK_FIRST', update({ tripId: 'pl:PLK_FIRST', cancelled: false })],
      ['pl:PLK_LAST', update({ tripId: 'pl:PLK_LAST', cancelled: true })],
    ]),
  );
  assert.equal(cancelled?.id, 'last');
  assert.equal(cancelledTrainLeg(conn, new Map()), null);
});

test('attach baseline uses the last leg when it has live data', () => {
  const last = trainLeg({ live: true, arrivalDelaySec: 3900 });
  assert.equal(connectionDelayAtAttachSec(connection([last], { delayMin: 120 })), 3900);
  assert.equal(connectionDelayAtAttachSec(connection([last], { delayMin: 3 })), 3900);

  const scheduled = trainLeg({ live: false, delayConfidence: 'scheduled' });
  assert.equal(connectionDelayAtAttachSec(connection([scheduled], { delayMin: 45 })), 2700);
  assert.equal(connectionDelayAtAttachSec(connection([scheduled], { delayMin: -3 })), 0);
});
