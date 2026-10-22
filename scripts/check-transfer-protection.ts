import assert from 'node:assert/strict';
import Module, { createRequire } from 'node:module';
import { mock } from 'node:test';
import type { CurrentLocation } from '../src/services/currentLocation';
import type { Connection, LegStop } from '../src/types/models';
import {
  TransferRideEstimator,
  TransferRiskDecision,
} from '../src/services/notifications/transferAssessment';
import { getSettingsSync } from '../src/services/settings';
import { hasTransfer } from '../src/services/notifications/transferTypes';

const base = new Date(2026, 9, 22).getTime();
const settings = getSettingsSync();
const at = (sec: number) => base + sec * 1000;
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
const fix = (position: number, sec: number): CurrentLocation => ({
  lat: 51,
  lon: 17 + position * 0.005,
  accuracy: 5,
  timestamp: at(offset + sec),
  speed: 6,
  heading: 90,
});
const estimator = new TransferRideEstimator();
assert.equal(estimator.observe(stops, 0, base, fix(0.95, 530), at(offset + 530)), null);
const estimate = estimator.observe(stops, 0, base, fix(1.05, 540), at(offset + 540));
assert.ok(estimate);
assert.ok(Math.abs(estimate.delaySec - 288) <= 1);
assert.equal(
  estimator.observe(stops, 0, base, fix(0.5, 550), at(offset + 550)),
  null,
  'GPS nie cofa podróży',
);
assert.equal(
  estimator.observe(stops, 0, base, fix(1.1, 550), at(offset + 600)),
  null,
  'stary GPS nie daje decyzji',
);
assert.equal(
  estimator.observe(stops, 0, base, { ...fix(1.1, 550), accuracy: 80 }, at(offset + 550)),
  null,
);
const stationary = new TransferRideEstimator();
stationary.observe(stops, 0, base, fix(1, 540), at(offset + 540));
assert.equal(
  stationary.observe(stops, 0, base, fix(1, 550), at(offset + 550)),
  null,
  'stanie na przystanku nie potwierdza jazdy',
);
const midnight = new TransferRideEstimator();
const nightStops = stops.map((stop) => ({
  ...stop,
  departSec: stop.departSec! + 36000,
  arriveSec: stop.arriveSec! + 36000,
}));
midnight.observe(
  nightStops,
  0,
  base,
  { ...fix(0.95, 530), timestamp: at(offset + 36530) },
  at(offset + 36530),
);
assert.ok(
  midnight.observe(
    nightStops,
    0,
    base,
    { ...fix(1.05, 540), timestamp: at(offset + 36540) },
    at(offset + 36540),
  ),
  'GTFS 24:00 zachowuje dzień',
);
const decision = new TransferRiskDecision();
assert.equal(decision.assess(-120, 90, 100_000), 'risk');
assert.equal(decision.assess(-120, 90, 110_000), 'risk');
assert.equal(decision.assess(-120, 90, 120_000), 'missed');
assert.equal(decision.assess(200, 90, 125_000), 'safe');
assert.equal(decision.assess(-120, 90, 130_000), 'risk');

let location: CurrentLocation | null = null;
let queries = 0;
const connection: Connection = {
  id: 'guard-test',
  fromTitle: 'A',
  toTitle: 'E',
  departAt: '14:00',
  arriveAt: '14:25',
  departureSec: offset,
  departInMin: 0,
  durationMin: 25,
  transfers: 1,
  delayMin: 0,
  live: false,
  legs: [
    {
      id: 'ride-4',
      tripId: '4-0',
      line: '4',
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
      id: 'ride-10',
      tripId: '10-0',
      line: '10',
      mode: 'tram',
      fromStop: 'C',
      toStop: 'E',
      fromStopId: 'C',
      toStopId: 'E',
      departAt: '14:10',
      arriveAt: '14:25',
      stopsCount: 1,
      live: false,
      intermediateStops: [
        { ...stops[2], arriveSec: offset + 600, departSec: offset + 600 },
        {
          ...stops[3],
          stopId: 'E',
          lon: 17.04,
          arriveSec: offset + 1500,
          departSec: offset + 1500,
        },
      ],
    },
  ],
};
const original = JSON.stringify(connection);
assert.equal(hasTransfer(connection), true);
assert.equal(
  hasTransfer({ legs: [connection.legs[0]] }),
  false,
  'trasa bezpośrednia nie ma ochrony',
);
assert.equal(
  hasTransfer({ legs: [{ ...connection.legs[0], mode: 'walk' }, connection.legs[1]] }),
  false,
  'dojście piesze nie jest przesiadką',
);
assert.equal(hasTransfer({ legs: [] }), false);
const require = createRequire(import.meta.url);
const loader = Module as unknown as {
  _load: (request: string, parent: { filename?: string }, ...rest: unknown[]) => unknown;
};
const load = loader._load;
loader._load = function (request, parent, ...rest) {
  if (parent?.filename?.includes('/notifications/transferForeground')) {
    if (request === '../currentLocation')
      return { getCurrentLocationSnapshot: () => ({ location }) };
    if (request === '../settings')
      return { getSettingsSync: () => settings, profileWalkSpeedMps: () => 1.34 };
    if (request === '../liveTracker') return { liveTracker: { snapshot: () => [] } };
    if (request === '../api')
      return {
        RoutingService: {
          getConnections: async (query: { fromTitle: string }) => {
            queries++;
            const from = query.fromTitle;
            if (from !== 'C' && from !== 'D') return [];
            const tail: Connection = {
              ...connection,
              departureSec: offset + (from === 'C' ? 1500 : 1320),
              departAt: from === 'C' ? '14:25' : '14:22',
              arriveAt: from === 'C' ? '14:40' : '14:32',
              transfers: 0,
              legs: [
                {
                  ...connection.legs[1],
                  id: `tail-${from}`,
                  tripId: `${from}-next`,
                  line: from === 'C' ? '10' : '12',
                  fromStop: from,
                  fromStopId: from,
                  departAt: from === 'C' ? '14:25' : '14:22',
                  arriveAt: from === 'C' ? '14:40' : '14:32',
                },
              ],
            };
            return [tail];
          },
        },
      };
  }
  return load.call(this, request, parent, ...rest);
};
const {
  ForegroundTransferProtection,
}: typeof import('../src/services/notifications/transferForeground') = require('../src/services/notifications/transferForeground');

async function main() {
  mock.timers.enable({ apis: ['Date'], now: at(offset + 530) });
  const guard = new ForegroundTransferProtection({
    id: connection.id,
    connection,
    fromTitle: 'A',
    fromLat: 51,
    fromLon: 17,
    toId: 'E',
    toTitle: 'E',
    toLat: 51,
    toLon: 17.04,
    startedAt: at(offset),
  });
  location = fix(0.95, 530);
  assert.equal(
    (await guard.refresh()).status,
    'unavailable',
    'bez potwierdzenia jazdy nie oceniamy przesiadki',
  );
  mock.timers.setTime(at(offset + 540));
  location = fix(1.05, 540);
  assert.equal((await guard.refresh()).status, 'risk');
  mock.timers.setTime(at(offset + 560));
  location = fix(1.13, 560);
  const state = await guard.refresh();
  assert.equal(state.status, 'alternative');
  assert.equal(state.alternative?.nextLine, '12');
  assert.equal(state.alternative?.kind, 'stayOn');
  assert.ok(state.alternative!.validUntil > Date.now());
  assert.equal(JSON.stringify(connection), original, 'propozycja nie zmienia aktywnego planu');
  const count = queries;
  mock.timers.setTime(at(offset + 565));
  location = fix(1.15, 565);
  await guard.refresh();
  assert.equal(queries, count, 'brak ponownego liczenia tras co tick');
  mock.timers.setTime(at(offset + 600));
  assert.equal((await guard.refresh()).alternative, undefined, 'stara pozycja usuwa propozycję');
  console.log(
    'PASS: GPS, potwierdzenie jazdy, północ, histereza ryzyka, trasa offline, brak autopodmiany, ważność i limit zapytań',
  );
}
void main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => mock.timers.reset());
