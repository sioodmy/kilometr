process.env.TZ = 'Europe/Warsaw';
import assert from 'node:assert/strict';
import Module, { createRequire } from 'node:module';
import { mock } from 'node:test';
import type { Connection, LegStop } from '../src/types/models';
import { getSettingsSync } from '../src/services/settings';
import { isProtectedTrainLeg } from '../src/services/notifications/transferTypes';

const base = new Date(2026, 9, 22).getTime();
const at = (sec: number) => base + sec * 1000;
const offset = 14 * 3600;
const settings = getSettingsSync();

// 1. Ochrona pociągów: ani mode === 'train', ani pl: nie może być automatycznie podmieniana.
assert.equal(isProtectedTrainLeg({ mode: 'train', tripId: 'kd-1' }), true);
assert.equal(isProtectedTrainLeg({ mode: 'bus', tripId: 'pl:ic-6124' }), true);
assert.equal(isProtectedTrainLeg({ mode: 'tram', tripId: 'wro:trip-10' }), false);

const urbanStops: LegStop[] = ['A', 'B', 'C', 'D'].map((stopId, i) => ({
  stopId,
  name: `Przystanek ${stopId}`,
  lat: 51.1,
  lon: 17.0 + i * 0.004,
  seq: i,
  departSec: offset + i * 240,
  arriveSec: offset + i * 240,
}));

const trainNextConnection: Connection = {
  id: 'mixed-urban-to-rail',
  fromTitle: 'Przystanek A',
  toTitle: 'Warszawa Centralna',
  departureSec: offset,
  departAt: '14:00',
  arriveAt: '18:00',
  durationMin: 240,
  departInMin: 0,
  transfers: 1,
  delayMin: 0,
  live: true,
  legs: [
    {
      id: 'leg-tram-4',
      mode: 'tram',
      line: '4',
      tripId: 'wro:tram-4',
      fromStop: 'Przystanek A',
      fromStopId: 'A',
      toStop: 'Przystanek C',
      toStopId: 'C',
      fromLat: 51.1,
      fromLon: 17.0,
      toLat: 51.1,
      toLon: 17.008,
      departAt: '14:00',
      arriveAt: '14:08',
      stopsCount: 2,
      live: true,
    },
    {
      id: 'leg-ic-6124',
      mode: 'train',
      line: 'IC 6124',
      tripId: 'pl:ic-6124',
      fromStop: 'Wrocław Główny',
      fromStopId: 'pl:5100067',
      toStop: 'Warszawa Centralna',
      toStopId: 'pl:5100065',
      fromLat: 51.0989,
      fromLon: 17.0366,
      toLat: 52.2288,
      toLon: 21.0033,
      departAt: '14:12',
      arriveAt: '18:00',
      stopsCount: 5,
      live: true,
    },
  ],
};

async function testForegroundIntegration() {
  const require = createRequire(__filename);
  const originalLoad = (Module as unknown as { _load: (req: string, parent: NodeModule, isMain: boolean) => unknown })._load;

  let liveRows: Array<{ matchedTripId: string; delaySec: number; updatedAt: number }> = [];
  let currentNow = at(offset + 300);

  const apiStub = {
    RoutingService: {
      getTripStops: async (tripId: string) => (tripId === 'wro:tram-4' ? urbanStops : []),
      getConnections: async () => [
        {
          id: 'next-train-conn',
          fromTitle: 'Wrocław Główny',
          toTitle: 'Warszawa Centralna',
          departureSec: offset + 3600,
          departAt: '15:00',
          arriveAt: '19:00',
          durationMin: 240,
          departInMin: 55,
          transfers: 0,
          legs: [
            {
              id: 'ic-next',
              mode: 'train',
              line: 'IC 6200',
              trainName: 'SILESIUM',
              tripId: 'pl:ic-6200',
              fromStop: 'Wrocław Główny',
              toStop: 'Warszawa Centralna',
              departAt: '15:00',
              arriveAt: '19:00',
              stopsCount: 5,
              live: true,
            },
          ],
        },
      ],
    },
  };

  (Module as unknown as { _load: (req: string, parent: NodeModule, isMain: boolean) => unknown })._load = function (
    request: string,
    parent: NodeModule,
    isMain: boolean,
  ) {
    if (request === '../currentLocation') return { getCurrentLocationSnapshot: () => ({ location: null }) };
    if (request === '../liveTracker') {
      return { liveTracker: { snapshot: () => liveRows } };
    }
    if (request === '../api') return apiStub;
    if (request === '../settings') {
      return { getSettingsSync: () => settings, profileWalkSpeedMps: () => 1.2 };
    }
    return originalLoad.call(this, request, parent, isMain);
  };

  mock.timers.enable({ apis: ['Date'], now: currentNow });
  try {
    delete require.cache[require.resolve('../src/services/notifications/transferForeground')];
    const { ForegroundTransferProtection } = require(
      '../src/services/notifications/transferForeground',
    ) as typeof import('../src/services/notifications/transferForeground');

    const guard = new ForegroundTransferProtection({
      id: trainNextConnection.id,
      fromTitle: trainNextConnection.fromTitle,
      fromLat: 51.1,
      fromLon: 17.0,
      toId: 'warszawa',
      toTitle: trainNextConnection.toTitle,
      toLat: 52.2288,
      toLon: 21.0033,
      connection: trainNextConnection,
      startedAt: at(offset - 120),
      protectionEnabled: true,
    });

    // Live delay +9 min na tramwaju 4 bez GPS locka -> musi wykryć opóźnienie live i wejść w tryb konduktora (ZERO podmiany pociągu!).
    liveRows = [{ matchedTripId: 'wro:tram-4', delaySec: 540, updatedAt: currentNow - 5_000 }];
    const state1 = await guard.refresh();
    assert.equal(state1.delaySource, 'live', 'Opóźnienie z feedu live powinno działać bez GPS');
    assert.ok((state1.transfers?.length ?? 0) === 1, 'Trasa mieszana miejsko-kolejowa ma 1 przesiadkę');

    // Histereza (drugi odczyt po 16s) potwierdza spóźnienie na pociąg -> tryb conductor.
    assert.equal(state1.status, 'risk', 'Pierwszy odczyt w histerezie daje risk');
    currentNow += 22_000;
    mock.timers.setTime(currentNow);
    liveRows = [{ matchedTripId: 'wro:tram-4', delaySec: 540, updatedAt: currentNow - 2_000 }];
    const state2 = await guard.refresh();
    assert.equal(state2.status, 'conductor', 'Spóźnienie na pociąg musi uruchomić tryb konduktora');
    assert.equal(state2.alternative, undefined, 'Pociąg nigdy nie może być automatycznie podmieniany');
    assert.equal(state2.alternatives, undefined, 'Pociąg nigdy nie zwraca listy zamienników miejskich');
    assert.equal(state2.nextTrain?.label, 'IC 6200', 'Powinien podpowiedzieć kolejny pociąg');
  } finally {
    mock.timers.reset();
    (Module as unknown as { _load: (req: string, parent: NodeModule, isMain: boolean) => unknown })._load = originalLoad;
  }
}

async function testTripMonitorIntegration() {
  const require = createRequire(__filename);
  const originalLoad = (Module as unknown as { _load: (req: string, parent: NodeModule, isMain: boolean) => unknown })._load;

  const kv = new Map<string, string>();
  let clearedNative = 0;

  const storageStub = {
    getItem: async (k: string) => kv.get(k) ?? null,
    setItem: async (k: string, v: string) => {
      kv.set(k, v);
    },
    removeItem: async (k: string) => {
      kv.delete(k);
    },
  };

  (Module as unknown as { _load: (req: string, parent: NodeModule, isMain: boolean) => unknown })._load = function (
    request: string,
    parent: NodeModule,
    isMain: boolean,
  ) {
    if (request === 'react-native') {
      return {
        AppState: { currentState: 'active', addEventListener: () => ({ remove: () => {} }) },
        Platform: { OS: 'ios' },
      };
    }
    if (request === '../storage') return { storage: storageStub, kvGet: (k: string) => storageStub.getItem(k), kvSet: (k: string, v: string) => storageStub.setItem(k, v), kvRemove: (k: string) => storageStub.removeItem(k) };
    if (request === '../api') {
      return {
        RoutingService: { getConnections: async () => [], getTripStops: async () => [] },
        rememberPlannedConnection: () => {},
      };
    }
    if (request === '../liveTracker') {
      return {
        liveTracker: {
          acquire: () => {},
          release: () => {},
          pin: () => {},
          unpin: () => {},
          subscribe: () => () => {},
          snapshot: () => [],
          getTripDelays: () => new Map(),
          supportsLive: () => false,
          getLiveState: () => 'idle',
        },
      };
    }
    if (request === '../widgetBridge') return { updateWidget: async () => {} };
    if (request === '../onboardDetector') {
      return {
        onboardDetector: {
          startTrip: () => {},
          stopTrip: () => {},
          observe: () => {},
          subscribe: () => () => {},
          getSnapshot: () => ({ state: 'idle' }),
        },
      };
    }
    if (request === './module') {
      return {
        areNotificationsSupported: () => true,
        getNotifications: () => ({
          scheduleNotificationAsync: async () => 'n1',
          dismissNotificationAsync: async () => {},
          cancelScheduledNotificationAsync: async () => {},
          setNotificationChannelAsync: async () => {},
          AndroidImportance: { HIGH: 4, DEFAULT: 3, LOW: 2 },
        }),
        getTrackingNative: () => ({
          isAvailable: () => false,
          canPromote: async () => false,
          startTrip: async () => false,
          stopTrip: async () => true,
          consumeStopRequest: async () => false,
          clearTransferProtection: async () => {
            clearedNative++;
            return true;
          },
        }),
        isTransferProtectionSupported: () => true,
        usesNativeTransferProtection: () => false,
      };
    }
    if (request === './transferForeground') {
      return {
        ForegroundTransferProtection: class {
          resetSearchCooldown() {}
          async refresh() {
            return {
              tripId: 't1',
              status: 'safe',
              revision: 1,
              updatedAt: Date.now(),
              scope: 'foreground',
            };
          }
        },
      };
    }
    if (request === './transferSnapshot') {
      return {
        writeTransferSnapshot: async () => null,
        removeTransferSnapshot: async () => {},
      };
    }
    return originalLoad.call(this, request, parent, isMain);
  };

  try {
    delete require.cache[require.resolve('../src/services/notifications/tripMonitor')];
    const monitor = require('../src/services/notifications/tripMonitor') as typeof import('../src/services/notifications/tripMonitor');

    const urbanTransferConn: Connection = {
      id: 'urban-4-10',
      fromTitle: 'Biskupin',
      toTitle: 'Rynek',
      departureSec: offset,
      departAt: '14:00',
      arriveAt: '14:24',
      durationMin: 24,
      departInMin: 0,
      transfers: 1,
      delayMin: 0,
      live: false,
      legs: [
        {
          id: 'leg-4',
          mode: 'tram',
          line: '4',
          fromStop: 'Biskupin',
          toStop: 'Plac Grunwaldzki',
          departAt: '14:00',
          arriveAt: '14:10',
          stopsCount: 4,
          live: false,
        },
        {
          id: 'leg-10',
          mode: 'tram',
          line: '10',
          fromStop: 'Plac Grunwaldzki',
          toStop: 'Rynek',
          departAt: '14:14',
          arriveAt: '14:24',
          stopsCount: 4,
          live: false,
        },
      ],
    };

    const startedAt = Date.now();
    await monitor.startTracking({
      id: urbanTransferConn.id,
      fromTitle: urbanTransferConn.fromTitle,
      fromLat: 51.1,
      fromLon: 17.0,
      toId: 'rynek',
      toTitle: urbanTransferConn.toTitle,
      toLat: 51.11,
      toLon: 17.03,
      connection: urbanTransferConn,
      startedAt,
      protectionEnabled: true,
    });
    const initialStartedAt = monitor.getTrackedTripSync()!.startedAt;

    // 1. Wymiana odcinka miejskiego (np. swipe na linię 33) aktualizuje śledzoną podróż w locie bez utraty id/startedAt.
    const swappedConn: Connection = {
      ...urbanTransferConn,
      id: 'urban-4-33',
      arriveAt: '14:27',
      legs: [
        urbanTransferConn.legs[0],
        { ...urbanTransferConn.legs[1], id: 'leg-33', line: '33', departAt: '14:17', arriveAt: '14:27' },
      ],
    };
    const updated = await monitor.updateTrackedConnection(swappedConn, { reason: 'legSwap' });
    assert.equal(updated, true);
    const afterSwap = monitor.getTrackedTripSync();
    assert.ok(afterSwap);
    assert.equal(afterSwap.id, 'urban-4-10', 'ID śledzonej podróży pozostaje stabilne po wymianie odcinka');
    assert.equal(afterSwap.startedAt, initialStartedAt, 'startedAt pozostaje stabilne po wymianie odcinka');
    assert.equal(afterSwap.connection.id, 'urban-4-33', 'Połączenie zostało podmienione w locie');
    assert.equal(afterSwap.protectionEnabled, true, 'Ochrona przesiadek pozostaje aktywna');
    assert.equal(afterSwap.transfer?.swappedByUser, true, 'Flaga swappedByUser jest ustawiona');

    // 2. Wyłączenie ochrony NIE kończy śledzenia podróży!
    await monitor.setTransferProtectionEnabled(false);
    const afterPause = monitor.getTrackedTripSync();
    assert.ok(afterPause, 'Wyłączenie ochrony przesiadek nie może przerywać śledzenia podróży');
    assert.equal(afterPause.protectionEnabled, false);
    assert.equal(afterPause.transfer, undefined);
    assert.ok(clearedNative >= 1);

    // 3. Ponowne włączenie ochrony reaktywuje ją bez restartu podróży.
    await monitor.setTransferProtectionEnabled(true);
    const afterResume = monitor.getTrackedTripSync();
    assert.ok(afterResume);
    assert.equal(afterResume.protectionEnabled, true);
    assert.equal(afterResume.startedAt, initialStartedAt);

    await monitor.stopTracking();
  } finally {
    (Module as unknown as { _load: (req: string, parent: NodeModule, isMain: boolean) => unknown })._load = originalLoad;
  }
}

async function main() {
  await testForegroundIntegration();
  await testTripMonitorIntegration();
  console.log('PASS: transfer integration (live delay, rail conductor, leg swap sync, pause/resume protection)');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
