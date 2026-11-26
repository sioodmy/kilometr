import assert from 'node:assert/strict';
import Module, { createRequire } from 'node:module';
import test, { mock } from 'node:test';
import type { TransferThresholds } from '../src/components/connectionInsights';
import type { CurrentLocation } from '../src/services/currentLocation';
import {
  boardingTripKey,
  getConnectionGroup,
  groupConnections,
  refreshConnectionGroupOptions,
  rememberConnectionGroup,
} from '../src/services/routing/connectionGroups';
import type { Connection, Leg, LegStop } from '../src/types/models';

const THRESHOLDS: TransferThresholds = {
  minTransferSec: 120,
  trainMinTransferSec: 300,
};
const WALK_MPS = 1.34;
const BASE_SEC = 12 * 3600;

function hm(sec: number): string {
  const h = Math.floor(sec / 3600) % 24;
  const m = Math.floor((sec % 3600) / 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function makeLeg(opts: {
  id: string;
  mode?: Leg['mode'];
  line?: string;
  tripId?: string;
  fromStop: string;
  fromStopId?: string;
  toStop: string;
  toStopId?: string;
  depSec: number;
  arrSec: number;
  walkM?: number;
  intermediateStops?: LegStop[];
}): Leg {
  return {
    id: opts.id,
    mode: opts.mode ?? 'tram',
    line: opts.line,
    fromStop: opts.fromStop,
    toStop: opts.toStop,
    fromStopId: opts.fromStopId ?? opts.fromStop,
    toStopId: opts.toStopId ?? opts.toStop,
    departAt: hm(opts.depSec),
    arriveAt: hm(opts.arrSec),
    scheduledDepartureSec: opts.depSec,
    scheduledArrivalSec: opts.arrSec,
    delaySec: 0,
    arrivalDelaySec: 0,
    stopsCount: opts.mode === 'walk' ? 0 : 4,
    walkM: opts.walkM,
    live: false,
    tripId: opts.tripId,
    intermediateStops: opts.intermediateStops,
  };
}

function makeConnection(id: string, legs: Leg[]): Connection {
  const first = legs[0];
  const last = legs[legs.length - 1];
  const transitCount = legs.filter((l) => l.mode !== 'walk').length;
  const depSec = first.scheduledDepartureSec ?? BASE_SEC;
  const arrSec = last.scheduledArrivalSec ?? depSec + 600;
  return {
    id,
    fromTitle: first.fromStop,
    toTitle: last.toStop,
    departInMin: 5,
    departureSec: depSec,
    arrivalSec: arrSec,
    departAt: hm(depSec),
    arriveAt: hm(arrSec),
    durationMin: Math.max(1, Math.round((arrSec - depSec) / 60)),
    transfers: Math.max(0, transitCount - 1),
    delayMin: 0,
    live: false,
    legs,
  };
}

test('grupuje bezpośredni kurs z szybszą przesiadką tego samego pojazdu', () => {
  const dep = BASE_SEC + 20 * 60;
  const direct = makeConnection('direct-10', [
    makeLeg({
      id: 'l1',
      line: '10',
      tripId: 'trip-10-1220',
      fromStop: 'Leśnica',
      toStop: 'Galeria',
      depSec: dep,
      arrSec: dep + 30 * 60,
    }),
  ]);
  const transferFast = makeConnection('xfer-10-33', [
    makeLeg({
      id: 'l1',
      line: '10',
      tripId: 'trip-10-1220',
      fromStop: 'Leśnica',
      toStop: 'Pilczyce',
      depSec: dep,
      arrSec: dep + 12 * 60,
    }),
    makeLeg({
      id: 'l2',
      line: '33',
      tripId: 'trip-33-1235',
      fromStop: 'Pilczyce',
      toStop: 'Galeria',
      depSec: dep + 15 * 60,
      arrSec: dep + 25 * 60,
    }),
  ]);

  const groups = groupConnections([transferFast, direct], WALK_MPS, THRESHOLDS);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].primary.id, direct.id);
  assert.equal(groups[0].alternatives.length, 1);
  assert.equal(groups[0].alternatives[0].connection.id, transferFast.id);
  assert.equal(groups[0].alternatives[0].savedMin, 5);
  assert.equal(groups[0].alternatives[0].continuationLegs.length, 1);
  assert.equal(groups[0].alternatives[0].continuationLegs[0].line, '33');
  assert.deepEqual(
    groups[0].alternatives[0].transitSteps.map((st) => st.leg.line),
    ['10', '33'],
  );
});

test('odrzuca przesiadkę bez realnego benefitu czasowego względem bezpośredniego', () => {
  const dep = BASE_SEC + 20 * 60;
  const direct = makeConnection('direct-10', [
    makeLeg({
      id: 'l1',
      line: '10',
      tripId: 'trip-10-1220',
      fromStop: 'A',
      toStop: 'C',
      depSec: dep,
      arrSec: dep + 25 * 60,
    }),
  ]);
  const sameArrival = makeConnection('xfer-same', [
    makeLeg({
      id: 'l1',
      line: '10',
      tripId: 'trip-10-1220',
      fromStop: 'A',
      toStop: 'B',
      depSec: dep,
      arrSec: dep + 10 * 60,
    }),
    makeLeg({
      id: 'l2',
      line: '12',
      tripId: 'trip-12',
      fromStop: 'B',
      toStop: 'C',
      depSec: dep + 14 * 60,
      arrSec: dep + 25 * 60,
    }),
  ]);
  const slowerArrival = makeConnection('xfer-slower', [
    makeLeg({
      id: 'l1',
      line: '10',
      tripId: 'trip-10-1220',
      fromStop: 'A',
      toStop: 'B',
      depSec: dep,
      arrSec: dep + 10 * 60,
    }),
    makeLeg({
      id: 'l2',
      line: '20',
      tripId: 'trip-20',
      fromStop: 'B',
      toStop: 'C',
      depSec: dep + 14 * 60,
      arrSec: dep + 28 * 60,
    }),
  ]);

  const groups = groupConnections([sameArrival, slowerArrival, direct], WALK_MPS, THRESHOLDS);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].primary.id, direct.id);
  assert.equal(groups[0].alternatives.length, 0);
});

test('wybiera najbezpieczniejszą przesiadkę jako główną i odrzuca ciasną bez zysku', () => {
  const dep = 16 * 3600 + 30 * 60;
  const safeTransfer = makeConnection('safe-2-19', [
    makeLeg({
      id: 'l1',
      line: '2',
      tripId: 'trip-2-1630',
      fromStop: 'Krzyki',
      toStop: 'Arkady',
      depSec: dep,
      arrSec: dep + 10 * 60,
    }),
    makeLeg({
      id: 'l2',
      line: '19',
      tripId: 'trip-19',
      fromStop: 'Arkady',
      toStop: 'Biskupin',
      depSec: dep + 15 * 60,
      arrSec: dep + 30 * 60,
    }),
  ]);
  const tightFaster = makeConnection('tight-2-4', [
    makeLeg({
      id: 'l1',
      line: '2',
      tripId: 'trip-2-1630',
      fromStop: 'Krzyki',
      toStop: 'Arkady',
      depSec: dep,
      arrSec: dep + 10 * 60,
    }),
    makeLeg({
      id: 'l2',
      line: '4',
      tripId: 'trip-4-fast',
      fromStop: 'Arkady',
      toStop: 'Biskupin',
      depSec: dep + 11 * 60 + 30,
      arrSec: dep + 26 * 60,
    }),
  ]);
  const tightNoGain = makeConnection('tight-2-1', [
    makeLeg({
      id: 'l1',
      line: '2',
      tripId: 'trip-2-1630',
      fromStop: 'Krzyki',
      toStop: 'Arkady',
      depSec: dep,
      arrSec: dep + 10 * 60,
    }),
    makeLeg({
      id: 'l2',
      line: '1',
      tripId: 'trip-1-slow',
      fromStop: 'Arkady',
      toStop: 'Biskupin',
      depSec: dep + 11 * 60 + 30,
      arrSec: dep + 31 * 60,
    }),
  ]);

  const groups = groupConnections([tightFaster, tightNoGain, safeTransfer], WALK_MPS, THRESHOLDS);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].primary.id, safeTransfer.id);
  assert.equal(groups[0].primaryOption.safety, 'safe');
  assert.equal(groups[0].alternatives.length, 1);
  assert.equal(groups[0].alternatives[0].connection.id, tightFaster.id);
  assert.equal(groups[0].alternatives[0].safety, 'tight');
  assert.equal(groups[0].alternatives[0].savedMin, 4);
  assert.deepEqual(
    groups[0].alternatives[0].transitSteps.map((st) => st.leg.line),
    ['2', '4'],
  );
  assert.equal(groups[0].alternatives[0].transitSteps[0].transferRiskAfter?.level, 'tight');
  assert.equal(groups[0].alternatives[0].transitSteps[1].transferRiskAfter, undefined);
});

test('zachowuje schodki Pareto bezpieczeństwa i czasu oraz odrzuca zdominowane opcje', () => {
  const dep = BASE_SEC;
  const direct = makeConnection('p-direct', [
    makeLeg({
      id: 'l1',
      line: '10',
      tripId: 'trip-10',
      fromStop: 'A',
      toStop: 'D',
      depSec: dep,
      arrSec: dep + 30 * 60,
    }),
  ]);
  const safeFaster = makeConnection('p-safe', [
    makeLeg({
      id: 'l1',
      line: '10',
      tripId: 'trip-10',
      fromStop: 'A',
      toStop: 'B',
      depSec: dep,
      arrSec: dep + 10 * 60,
    }),
    makeLeg({
      id: 'l2',
      line: '33',
      tripId: 'trip-33',
      fromStop: 'B',
      toStop: 'D',
      depSec: dep + 15 * 60,
      arrSec: dep + 26 * 60,
    }),
  ]);
  const tightFastest = makeConnection('p-tight-best', [
    makeLeg({
      id: 'l1',
      line: '10',
      tripId: 'trip-10',
      fromStop: 'A',
      toStop: 'B',
      depSec: dep,
      arrSec: dep + 10 * 60,
    }),
    makeLeg({
      id: 'l2',
      line: '3',
      tripId: 'trip-3',
      fromStop: 'B',
      toStop: 'D',
      depSec: dep + 11 * 60 + 30,
      arrSec: dep + 22 * 60,
    }),
  ]);
  const tightSlowerThanSafe = makeConnection('p-tight-dominated', [
    makeLeg({
      id: 'l1',
      line: '10',
      tripId: 'trip-10',
      fromStop: 'A',
      toStop: 'B',
      depSec: dep,
      arrSec: dep + 10 * 60,
    }),
    makeLeg({
      id: 'l2',
      line: '6',
      tripId: 'trip-6',
      fromStop: 'B',
      toStop: 'D',
      depSec: dep + 11 * 60 + 30,
      arrSec: dep + 27 * 60,
    }),
  ]);

  const groups = groupConnections(
    [tightSlowerThanSafe, tightFastest, safeFaster, direct],
    WALK_MPS,
    THRESHOLDS,
  );
  assert.equal(groups.length, 1);
  assert.deepEqual(
    groups[0].options.map((o) => o.connection.id),
    [direct.id, safeFaster.id, tightFastest.id],
  );
  assert.equal(groups[0].alternatives[0].savedMin, 4);
  assert.equal(groups[0].alternatives[1].savedMin, 8);
});

test('odrzuca wariant z już zerwaną przesiadką (ujemny zapas)', () => {
  const dep = BASE_SEC;
  const direct = makeConnection('direct-10', [
    makeLeg({
      id: 'l1',
      line: '10',
      tripId: 'trip-10',
      fromStop: 'A',
      toStop: 'C',
      depSec: dep,
      arrSec: dep + 28 * 60,
    }),
  ]);
  const brokenLeg1 = makeLeg({
    id: 'l1',
    line: '10',
    tripId: 'trip-10',
    fromStop: 'A',
    toStop: 'B',
    depSec: dep,
    arrSec: dep + 14 * 60,
  });
  brokenLeg1.delaySec = 240;
  brokenLeg1.arrivalDelaySec = 240;
  const broken = makeConnection('broken-xfer', [
    brokenLeg1,
    makeLeg({
      id: 'l2',
      line: '33',
      tripId: 'trip-33',
      fromStop: 'B',
      toStop: 'C',
      depSec: dep + 15 * 60,
      arrSec: dep + 22 * 60,
    }),
  ]);

  const groups = groupConnections([broken, direct], WALK_MPS, THRESHOLDS);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].primary.id, direct.id);
  assert.equal(groups[0].alternatives.length, 0);
});

test('nie grupuje kursów o innych godzinach, innych tripId ani tras pieszych', () => {
  const c1 = makeConnection('t1', [
    makeLeg({
      id: 'l1',
      line: '10',
      tripId: 'trip-10-1220',
      fromStop: 'A',
      toStop: 'C',
      depSec: BASE_SEC + 20 * 60,
      arrSec: BASE_SEC + 45 * 60,
    }),
  ]);
  const c2 = makeConnection('t2', [
    makeLeg({
      id: 'l1',
      line: '10',
      tripId: 'trip-10-1235',
      fromStop: 'A',
      toStop: 'C',
      depSec: BASE_SEC + 35 * 60,
      arrSec: BASE_SEC + 60 * 60,
    }),
  ]);
  const walkOnly = makeConnection('walk-only-1', [
    makeLeg({
      id: 'w1',
      mode: 'walk',
      fromStop: 'A',
      toStop: 'C',
      depSec: BASE_SEC + 20 * 60,
      arrSec: BASE_SEC + 35 * 60,
      walkM: 900,
    }),
  ]);

  assert.equal(boardingTripKey(walkOnly), null);
  const groups = groupConnections([c2, walkOnly, c1], WALK_MPS, THRESHOLDS);
  assert.equal(groups.length, 3);
  assert.ok(groups.every((g) => g.alternatives.length === 0));
});

test('rememberConnectionGroup, getConnectionGroup i refreshConnectionGroupOptions zachowują warianty', () => {
  const dep = BASE_SEC;
  const direct = makeConnection('cache-direct', [
    makeLeg({
      id: 'l1',
      line: '10',
      tripId: 'trip-cache-10',
      fromStop: 'A',
      toStop: 'C',
      depSec: dep,
      arrSec: dep + 30 * 60,
    }),
  ]);
  const xfer = makeConnection('cache-xfer', [
    makeLeg({
      id: 'l1',
      line: '10',
      tripId: 'trip-cache-10',
      fromStop: 'A',
      toStop: 'B',
      depSec: dep,
      arrSec: dep + 10 * 60,
    }),
    makeLeg({
      id: 'l2',
      line: '33',
      tripId: 'trip-33',
      fromStop: 'B',
      toStop: 'C',
      depSec: dep + 14 * 60,
      arrSec: dep + 24 * 60,
    }),
  ]);

  const groups = groupConnections([xfer, direct], WALK_MPS, THRESHOLDS);
  rememberConnectionGroup(groups[0]);

  assert.equal(getConnectionGroup(direct.id)?.key, groups[0].key);
  assert.equal(getConnectionGroup(xfer.id)?.key, groups[0].key);

  const refreshed = refreshConnectionGroupOptions([direct, xfer], WALK_MPS, THRESHOLDS);
  assert.equal(refreshed.length, 2);
  assert.equal(refreshed[0].savedMin, 0);
  assert.equal(refreshed[1].savedMin, 6);
  assert.equal(refreshed[1].firstTransferStop, 'B');
});

test('ForegroundTransferProtection podpowiada pozostanie w bezpośrednim wariancie z grupy', async () => {
  process.env.TZ = 'Europe/Warsaw';
  const baseMs = new Date(2026, 9, 22).getTime();
  const at = (sec: number) => baseMs + sec * 1000;
  const offset = 14 * 3600;
  const stops: LegStop[] = ['A', 'B', 'C', 'D'].map((stopId, i) => ({
    stopId,
    name: stopId,
    lat: 51,
    lon: 17 + i * 0.005,
    seq: i,
    departSec: offset + i * 240,
    arriveSec: offset + i * 240,
  }));
  const makeFix = (position: number, sec: number): CurrentLocation => ({
    lat: 51,
    lon: 17 + position * 0.005,
    accuracy: 5,
    timestamp: at(offset + sec),
    speed: 6,
    heading: 90,
  });
  let currentFix: CurrentLocation = makeFix(0.95, 530);

  const transferPlan: Connection = {
    id: 'group-xfer-plan',
    fromTitle: 'A',
    toTitle: 'D',
    departAt: '14:00',
    arriveAt: '14:15',
    departureSec: offset,
    arrivalSec: offset + 900,
    departInMin: 0,
    durationMin: 15,
    transfers: 1,
    delayMin: 0,
    live: false,
    legs: [
      {
        id: 'ride-10-seg',
        tripId: 'trip-10-shared',
        line: '10',
        mode: 'tram',
        fromStop: 'A',
        toStop: 'C',
        fromStopId: 'A',
        toStopId: 'C',
        departAt: '14:00',
        arriveAt: '14:08',
        stopsCount: 2,
        live: false,
        intermediateStops: stops,
      },
      {
        id: 'ride-33-seg',
        tripId: 'trip-33-next',
        line: '33',
        mode: 'tram',
        fromStop: 'C',
        toStop: 'D',
        fromStopId: 'C',
        toStopId: 'D',
        departAt: '14:10',
        arriveAt: '14:15',
        stopsCount: 1,
        live: false,
        intermediateStops: [
          { ...stops[2], arriveSec: offset + 600, departSec: offset + 600 },
          { ...stops[3], arriveSec: offset + 900, departSec: offset + 900 },
        ],
      },
    ],
  };

  const directSibling: Connection = {
    id: 'group-direct-sibling',
    fromTitle: 'A',
    toTitle: 'D',
    departAt: '14:00',
    arriveAt: '14:20',
    departureSec: offset,
    arrivalSec: offset + 1200,
    departInMin: 0,
    durationMin: 20,
    transfers: 0,
    delayMin: 0,
    live: false,
    legs: [
      {
        id: 'ride-10-direct',
        tripId: 'trip-10-shared',
        line: '10',
        mode: 'tram',
        fromStop: 'A',
        toStop: 'D',
        fromStopId: 'A',
        toStopId: 'D',
        departAt: '14:00',
        arriveAt: '14:20',
        stopsCount: 3,
        live: false,
        intermediateStops: [
          ...stops.slice(0, 3),
          { ...stops[3], arriveSec: offset + 1200, departSec: offset + 1200 },
        ],
      },
    ],
  };

  const require = createRequire(import.meta.url);
  const loader = Module as unknown as {
    _load: (request: string, parent: { filename?: string }, ...rest: unknown[]) => unknown;
  };
  const prevLoad = loader._load;
  const fgPath = require.resolve('../src/services/notifications/transferForeground');
  delete require.cache[fgPath];

  loader._load = function (request, parent, ...rest) {
    if (parent?.filename?.includes('/notifications/transferForeground')) {
      if (request === '../currentLocation')
        return { getCurrentLocationSnapshot: () => ({ location: currentFix }) };
      if (request === '../liveTracker') return { liveTracker: { snapshot: () => [] } };
      if (request === '../api') {
        return { RoutingService: { getConnections: async () => [] } };
      }
    }
    return prevLoad.call(this, request, parent, ...rest);
  };

  try {
    const {
      ForegroundTransferProtection,
    }: typeof import('../src/services/notifications/transferForeground') = require('../src/services/notifications/transferForeground');
    mock.timers.enable({ apis: ['Date'], now: at(offset + 530) });
    const guard = new ForegroundTransferProtection({
      id: transferPlan.id,
      connection: transferPlan,
      groupAlternatives: [directSibling],
      fromTitle: 'A',
      fromLat: 51,
      fromLon: 17,
      toId: 'D',
      toTitle: 'D',
      toLat: 51,
      toLon: 17.015,
      startedAt: at(offset),
    });

    currentFix = makeFix(0.95, 530);
    await guard.refresh();
    mock.timers.setTime(at(offset + 540));
    currentFix = makeFix(1.05, 540);
    await guard.refresh();
    mock.timers.setTime(at(offset + 560));
    currentFix = makeFix(1.13, 560);
    const state = await guard.refresh();
    assert.equal(state.status, 'alternative');
    const groupDirectAlt = state.alternatives?.find((alt) => alt.source === 'group');
    assert.ok(groupDirectAlt, 'powinna pojawić się alternatywa bezpośrednia z grupy');
    assert.equal(groupDirectAlt.connection.transfers, 0);
    assert.equal(groupDirectAlt.kind, 'stayOn');
  } finally {
    loader._load = prevLoad;
    delete require.cache[fgPath];
    mock.timers.reset();
  }
});
