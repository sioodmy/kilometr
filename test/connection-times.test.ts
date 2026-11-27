import assert from 'node:assert/strict';
import test from 'node:test';
import type { Connection, Leg } from '../src/types/models';
import {
  boardingDepartureSec,
  scheduledBoardingDepartureSec,
} from '../src/services/routing/connectionTimes';

const BASE = 8 * 3600;

function hhmm(sec: number): string {
  const h = Math.floor(sec / 3600) % 24;
  const m = Math.floor((sec % 3600) / 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function transitLeg(depSec: number, delaySec: number): Leg {
  return {
    id: 'l1',
    mode: 'tram',
    line: '10',
    fromStop: 'A',
    toStop: 'B',
    departAt: hhmm(depSec + delaySec),
    arriveAt: hhmm(depSec + delaySec + 600),
    scheduledDepartureSec: depSec,
    scheduledArrivalSec: depSec + 600,
    delaySec,
    arrivalDelaySec: delaySec,
    stopsCount: 4,
    live: delaySec !== 0,
    tripId: 't1',
  };
}

function connection(delaySec: number): Connection {
  const depSec = BASE + 120;
  const leg = transitLeg(depSec, delaySec);
  return {
    id: 'c1',
    fromTitle: 'A',
    toTitle: 'B',
    departInMin: 2,
    departureSec: depSec + delaySec,
    arrivalSec: depSec + 600 + delaySec,
    departAt: leg.departAt,
    arriveAt: leg.arriveAt,
    durationMin: 10,
    transfers: 0,
    delayMin: Math.round(delaySec / 60),
    live: delaySec !== 0,
    legs: [leg],
  };
}

test('scheduledBoardingDepartureSec ignoruje opóźnienie live', () => {
  const onTime = connection(0);
  const delayed = connection(300);

  assert.equal(scheduledBoardingDepartureSec(onTime), BASE + 120);
  assert.equal(scheduledBoardingDepartureSec(delayed), BASE + 120);
  assert.equal(boardingDepartureSec(delayed), BASE + 120 + 300);
});

test('scheduledBoardingDepartureSec bierze plan pierwszego pojazdu za spacerem', () => {
  const walk: Leg = {
    id: 'w1',
    mode: 'walk',
    fromStop: 'Home',
    toStop: 'A',
    departAt: hhmm(BASE - 60),
    arriveAt: hhmm(BASE + 240),
    scheduledDepartureSec: BASE - 300,
    scheduledArrivalSec: BASE,
    delaySec: 240,
    arrivalDelaySec: 240,
    stopsCount: 0,
    walkM: 300,
    live: false,
  };
  const transit = transitLeg(BASE + 600, 180);
  const c: Connection = {
    ...connection(180),
    id: 'c2',
    departureSec: BASE + 240,
    arrivalSec: BASE + 600 + 180 + 600,
    departAt: walk.departAt,
    arriveAt: transit.arriveAt,
    durationMin: 20,
    legs: [walk, transit],
  };

  assert.equal(scheduledBoardingDepartureSec(c), BASE + 600);
});
