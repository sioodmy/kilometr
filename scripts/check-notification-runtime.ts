// Daty w teście są lokalne, a rozkład liczy się w strefie Warszawy.
// Bez tego CI (UTC) widzi odjazd sprzed dwóch godzin i test kończy śledzenie.
process.env.TZ = 'Europe/Warsaw';

import assert from 'node:assert/strict';
import Module, { createRequire, registerHooks } from 'node:module';
import { mock } from 'node:test';
import type {
  NotificationRequestInput,
  NotificationResponse,
  NotificationHandler,
} from 'expo-notifications';
import type { Connection } from '../src/types/models';
import type { LivePlan, TrackedTrip } from '../src/services/notifications/types';
import { DEFAULT_NOTIFICATION_PREFERENCES } from '../src/services/notifications/types';
import { createSharedConnection, encodeSharedConnection } from '../src/sharing/connection';
import { sharedToConnection } from '../src/sharing/native';

const require = createRequire(import.meta.url);
const at = (h: number, m: number) => new Date(2026, 9, 19, h, m).getTime();
const storage = new Map<string, string>();
const scheduled = new Map<string, NotificationRequestInput>();
const dismissed: string[] = [];
const plans: LivePlan[] = [];
let nativeOk = true;
let pendingStop = false;
let response: NotificationResponse | null = null;
let respond: ((value: NotificationResponse) => void) | undefined;
let handler: NotificationHandler | undefined;
let route: () => Promise<Connection[]>;
let pauseSchedule: (() => Promise<void>) | undefined;
let pinned: unknown = null;
let transferState: string | null = null;
const remembered: Connection[] = [];
const snapshotHooks = registerHooks({ resolve(specifier, context, next) {
  if (context.parentURL?.includes('/notifications/tripMonitor.') && specifier.includes('transferSnapshot')) {
    return { url: 'data:text/javascript,export async function prepareTransferSnapshot(){return "/tmp/transfer-test/context.json"} export function removeTransferSnapshot(){}', shortCircuit: true };
  }
  return next(specifier, context);
} });

const notifications = {
  SchedulableTriggerInputTypes: { DATE: 'date' },
  scheduleNotificationAsync: async (request: NotificationRequestInput) => {
    await pauseSchedule?.();
    scheduled.set(request.identifier!, request);
    return request.identifier!;
  },
  cancelScheduledNotificationAsync: async (id: string) => {
    scheduled.delete(id);
  },
  dismissNotificationAsync: async (id: string) => {
    dismissed.push(id);
  },
  getLastNotificationResponseAsync: async () => response,
  clearLastNotificationResponseAsync: async () => {
    response = null;
  },
  addNotificationResponseReceivedListener: (listener: typeof respond) => {
    respond = listener;
    return {
      remove: () => {
        respond = undefined;
      },
    };
  },
  setNotificationHandler: (value: NotificationHandler) => {
    handler = value;
  },
};
const native = {
  startTrip: async (json: string) => {
    plans.push(JSON.parse(json));
    return nativeOk;
  },
  stopTrip: async () => { transferState = null; return true; },
  consumeStopRequest: async () => {
    const value = pendingStop;
    pendingStop = false;
    return value;
  },
  hasStopRequest: async () => pendingStop,
  getTransferProtectionState: async () => transferState,
  configureTransferProtection: async () => true,
};
const stubs: Record<string, unknown> = {
  './module': {
    getNotifications: () => notifications,
    getTrackingNative: () => native,
    areNotificationsSupported: () => true,
    usesNativeTransferProtection: () => true,
    warnUnsupportedOnce: () => {},
    TRACKING_NOTIFICATION_ID: 'kilometr.tracking.v2',
  },
  '../storage': {
    kvGet: async (key: string) => storage.get(key) ?? null,
    kvSet: async (key: string, value: string) => {
      storage.set(key, value);
    },
    kvRemove: async (key: string) => {
      storage.delete(key);
    },
  },
  '../settings': { getSettingsSync: () => ({}), profileWalkSpeedMps: () => 1.3 },
  '../api': { RoutingService: { getConnections: () => route() }, rememberPlannedConnection: (value: Connection) => { remembered.push(value); } },
  '../liveTracker': { liveTracker: { snapshot: () => [], pin: () => {}, start: () => {}, stop: () => {},
    getLiveState: () => 'fresh', getTripDelays: () => new Map([['t1', 300]]) } },
  '../../cities': { inCityBounds: () => true },
  '../cityStore': { getActiveCitySync: () => ({}) },
  '../widgetSnapshot': {
    buildRoutesLink: () => 'kilometr://routes',
    departureTs: () => at(12, 20),
    legBadge: () => ({}),
    mergeWidgetSnapshot: async (patch: { pinned: unknown }) => {
      pinned = patch.pinned;
    },
  },
};
const loader = Module as unknown as {
  _load: (request: string, parent: { filename?: string }, ...rest: unknown[]) => unknown;
};
const originalLoad = loader._load;
loader._load = function (request, parent, ...rest) {
  if (parent?.filename?.includes('/services/notifications/') && request in stubs)
    return stubs[request];
  return originalLoad.call(this, request, parent, ...rest);
};

const monitor: typeof import('../src/services/notifications/tripMonitor') = require('../src/services/notifications/tripMonitor');
const alerts: typeof import('../src/services/notifications/alerts') = require('../src/services/notifications/alerts');
const presenter: typeof import('../src/services/notifications/presenter') = require('../src/services/notifications/presenter');
const responses: typeof import('../src/services/notifications/response') = require('../src/services/notifications/response');
const setup: typeof import('../src/services/notifications/setup') = require('../src/services/notifications/setup');
const preferences: typeof import('../src/services/notifications/preferences') = require('../src/services/notifications/preferences');
const {
  computeTripProgress,
}: typeof import('../src/services/notifications/tripProgress') = require('../src/services/notifications/tripProgress');

const connection: Connection = {
  id: 'tracked',
  fromTitle: 'Dom',
  toTitle: 'Cel',
  departureSec: 12 * 3600 + 20 * 60,
  departInMin: 20,
  departAt: '12:20',
  arriveAt: '12:50',
  durationMin: 30,
  transfers: 1,
  delayMin: 0,
  live: false,
  legs: [
    {
      id: 'w1',
      mode: 'walk',
      fromStop: 'Dom',
      toStop: 'A',
      departAt: '12:13',
      arriveAt: '12:20',
      walkM: 500,
      stopsCount: 0,
      live: false,
    },
    {
      id: 't1',
      tripId: 't1',
      mode: 'tram',
      line: '4',
      fromStop: 'A',
      toStop: 'B',
      departAt: '12:20',
      arriveAt: '12:35',
      stopsCount: 5,
      live: false,
    },
    {
      id: 'w2',
      mode: 'walk',
      fromStop: 'B',
      toStop: 'C',
      departAt: '12:35',
      arriveAt: '12:38',
      walkM: 180,
      stopsCount: 0,
      live: false,
    },
    {
      id: 't2',
      tripId: 't2',
      mode: 'bus',
      line: '12',
      fromStop: 'C',
      toStop: 'Cel',
      departAt: '12:40',
      arriveAt: '12:50',
      stopsCount: 3,
      live: false,
    },
  ],
};
const trip: TrackedTrip = {
  id: connection.id,
  fromTitle: 'Dom',
  fromLat: 51.1,
  fromLon: 17,
  toId: 'cel',
  toTitle: 'Cel',
  toLat: 51.11,
  toLon: 17.01,
  connection,
  startedAt: at(12, 0),
};
const prefs = { ...DEFAULT_NOTIFICATION_PREFERENCES };
const progress = () => computeTripProgress(connection);
const departureAlerts = () =>
  [...scheduled.keys()].filter((id) => id.startsWith('kilometr.alert.'));
const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};

async function main() {
  mock.timers.enable({ apis: ['Date'], now: at(12, 0) });
  route = async () => [{ ...connection }];
  let changes = 0;
  const unsubscribe = monitor.subscribeTracked(() => {
    changes++;
  });
  await monitor.startTracking(trip);
  assert.equal(monitor.getTrackedTripSync()?.id, trip.id);
  assert.ok(storage.has('kilometr.trackedTrip.v2'));
  assert.ok(pinned);
  assert.ok(changes >= 2, 'odświeżenie publikuje nowy stan po dopasowaniu planu');
  assert.equal(departureAlerts().length, 0, 'przypięcie trasy nie ustawia automatycznych alarmów');
  storage.set('kilometr.alertIds.v1', JSON.stringify([
    'kilometr.alert.lead.tracked.1', 'kilometr.alert.imminent.tracked.1',
  ]));
  await alerts.cancelLegacyDepartureAlerts();
  assert.ok(dismissed.includes('kilometr.alert.lead.tracked.1'));
  assert.ok(dismissed.includes('kilometr.alert.imminent.tracked.1'));
  monitor.startTrackedTripListener();
  await preferences.saveNotificationPreferences({ trackingEnabled: false });
  await monitor.refreshTrackedTrip();
  assert.equal(departureAlerts().length, 0, 'zmiana ustawień od razu usuwa alerty');
  await preferences.saveNotificationPreferences(prefs);
  await monitor.refreshTrackedTrip();
  await alerts.sendDisruptionAlert(progress(), trip, prefs);
  assert.deepEqual(scheduled.get('kilometr.alert.disruption.tracked')?.trigger, {
    channelId: 'kilometr.alerts',
  });
  await alerts.sendArrivedNotification(progress(), trip);
  await alerts.cancelScheduledAlerts();
  assert.equal(scheduled.size, 0);
  assert.ok(dismissed.includes('kilometr.alert.disruption.tracked'));
  assert.ok(dismissed.includes('kilometr.alert.arrived.tracked'));

  const entered = deferred();
  const release = deferred();
  pauseSchedule = async () => {
    entered.resolve();
    await release.promise;
  };
  const scheduling = alerts.sendDisruptionAlert(progress(), trip, prefs);
  await entered.promise;
  const cancelling = alerts.cancelScheduledAlerts();
  release.resolve();
  await Promise.all([scheduling, cancelling]);
  pauseSchedule = undefined;
  assert.equal(scheduled.size, 0, 'zakończenie czeka na planowanie alertu i usuwa go');

  route = async () => [];
  const beforeOffline = plans.length;
  await monitor.refreshTrackedTrip();
  assert.ok(plans.length > beforeOffline, 'pusty wynik planera nie zatrzymuje powiadomienia');
  const planning = deferred();
  const planned = deferred();
  route = async () => {
    planned.resolve();
    await planning.promise;
    return [connection];
  };
  const refresh = monitor.refreshTrackedTrip();
  await planned.promise;
  await monitor.stopTracking();
  const stoppedPlans = plans.length;
  planning.resolve();
  await refresh;
  assert.equal(plans.length, stoppedPlans, 'wynik planera po Zakończ nie wskrzesza powiadomienia');
  assert.equal(monitor.getTrackedTripSync(), null);
  assert.equal(storage.has('kilometr.trackedTrip.v2'), false);
  assert.equal(pinned, null);

  nativeOk = false;
  await presenter.presentTrip(trip, progress(), prefs);
  assert.deepEqual(scheduled.get('kilometr.tracking.v2')?.trigger, {
    channelId: 'kilometr.tracking',
  });
  nativeOk = true;
  await presenter.presentTrip(trip, progress(), prefs);
  assert.equal(scheduled.has('kilometr.tracking.v2'), false);
  assert.ok(dismissed.includes('kilometr.tracking.v2'));
  pendingStop = true;
  const beforeStoppedPresentation = plans.length;
  await presenter.presentTrip(trip, progress(), prefs);
  assert.equal(plans.length, beforeStoppedPresentation);
  pendingStop = false;

  const makeResponse = (date: number): NotificationResponse => ({
    actionIdentifier: 'expo.modules.notifications.actions.DEFAULT',
    notification: {
      date,
      request: {
        identifier: 'test-response',
        trigger: null,
        content: {
          title: null,
          subtitle: null,
          body: null,
          sound: null,
          categoryIdentifier: null,
          data: { kind: 'trip', at: at(10, 0), toLat: '51.1', toLon: '17', open: 'tracked' },
        },
      },
    },
  });
  response = makeResponse(at(11, 0));
  assert.equal(
    (await responses.getLastTripResponse()).link?.open,
    'tracked',
    'starsze powiadomienie nadal otwiera trasę',
  );
  assert.equal((await responses.getLastTripResponse()).link, null, 'odpowiedź jest jednorazowa');
  let received = 0;
  const remove = responses.addTripResponseListener((value) => {
    if (value.link) received++;
  });
  const duplicate = makeResponse(at(11, 1));
  respond!(duplicate);
  respond!(duplicate);
  assert.equal(received, 1, "duplikat jest ignorowany");

  for (let i = 0; i < 32; i++) {
    const other = makeResponse(at(11, 2) + i * 1000);
    respond!(other);
  }
  respond!(duplicate);
  assert.equal(received, 34, "po 32 wpisach najstarszy klucz wylecial z bufora FIFO");
  remove();

  setup.setupNotificationHandler();
  const alert = makeResponse(at(12, 0)).notification;
  alert.request.content.data!.alert = 'lead';
  assert.equal((await handler!.handleNotification(alert)).shouldPlaySound, true);
  delete alert.request.content.data!.alert;
  assert.equal((await handler!.handleNotification(alert)).shouldPlaySound, false);

  storage.set('kilometr.trackedTrip.v2', JSON.stringify(trip));
  mock.timers.setTime(at(12, 55));
  assert.equal(await monitor.restoreTrackedTrip(), null);
  assert.equal(
    storage.has('kilometr.trackedTrip.v2'),
    false,
    'zakończona podróż nie wraca po restarcie',
  );

  mock.timers.setTime(at(12, 25));
  route = async () => { throw new Error('The boarded trip must stay locked'); };
  storage.set('kilometr.trackedTrip.v2', JSON.stringify({ ...trip, protectionEnabled: true, startedAt: Date.now() }));
  await monitor.restoreTrackedTrip();
  const changed = { ...connection, arriveAt: '13:10', durationMin: 50,
    legs: connection.legs.map((leg, i) => i === connection.legs.length - 1 ? { ...leg, line: '12', arriveAt: '13:10' } : leg) };
  mock.timers.setTime(at(12, 56));
  transferState = JSON.stringify({ tripId: trip.id, status: 'changed', updatedAt: Date.now(), revision: 1, connection: changed });
  await monitor.refreshTrackedTrip();
  assert.equal(monitor.getTrackedTripSync()?.connection.arriveAt, connection.arriveAt, 'natywny stan nie zmienia planu bez decyzji pasażera');
  assert.equal(remembered.length, 0, 'mapa nadal pokazuje plan pasażera');
  assert.equal(monitor.getTrackedTripSync()?.transfer?.status, 'changed');
  assert.ok(monitor.getTrackedTripSync(), 'stara godzina przyjazdu nie kończy opóźnionej podróży');
  transferState = JSON.stringify({ tripId: 'another-trip', status: 'changed', updatedAt: Date.now(), revision: 2, connection });
  await monitor.refreshTrackedTrip();
  assert.equal(monitor.getTrackedTripSync()?.connection.arriveAt, connection.arriveAt, 'obcy plan nie nadpisuje aktywnej podróży');
  const alternative = { id: 'proposal-12', connection: changed, activeLegIndex: 1,
    nextLine: '12', transferStop: 'C', departureAtMs: at(13, 0), arrivalAtMs: at(13, 10),
    validUntil: Date.now() - 1, kind: 'sameStop' };
  transferState = JSON.stringify({ tripId: trip.id, status: 'alternative', updatedAt: Date.now(), revision: 0, alternative });
  assert.equal(await monitor.acceptTransferAlternative(alternative.id), false, 'odrzucona nieaktualna propozycja');
  alternative.validUntil = at(13, 0);
  transferState = JSON.stringify({ tripId: trip.id, status: 'alternative', updatedAt: Date.now(), revision: 0, alternative });
  assert.equal(await monitor.acceptTransferAlternative('another-proposal'), false, 'potwierdzenie dotyczy wyświetlonej propozycji');
  assert.equal(monitor.getTrackedTripSync()?.connection.arriveAt, connection.arriveAt);
  assert.equal(await monitor.acceptTransferAlternative(alternative.id), true);
  assert.equal(monitor.getTrackedTripSync()?.connection.arriveAt, '13:10', 'dopiero potwierdzenie zmienia plan');
  assert.equal(remembered.at(-1)?.arriveAt, '13:10', 'mapa dostaje zaakceptowany plan');
  mock.timers.setTime(at(13, 16));
  transferState = JSON.stringify({ tripId: trip.id, status: 'complete', updatedAt: Date.now(), revision: 1, arrivalAtMs: at(13, 20) });
  await monitor.refreshTrackedTrip();
  assert.ok(monitor.getTrackedTripSync(), 'opóźnienie ostatniego tramwaju chroni przed przedwczesnym zakończeniem');
  pendingStop = true;
  await monitor.refreshTrackedTrip();
  assert.equal(monitor.getTrackedTripSync(), null, 'natywne Zakończ zatrzymuje także ochronę');
  transferState = null;
  mock.timers.setTime(at(12, 25));
  await monitor.startTracking({ ...trip, protectionEnabled: true, connection: {
    ...connection, transfers: 0, legs: [connection.legs[1]],
  } });
  assert.equal(monitor.getTrackedTripSync()?.protectionEnabled, false, 'ochrona nie startuje dla jednego pojazdu');
  assert.equal(plans.at(-1)?.transferProtectionEnabled, false, 'serwis Androida też nie uruchamia ochrony');
  await monitor.stopTracking();
  let replans = 0;
  route = async () => { replans++; return [connection]; };
  await monitor.startTracking({ ...trip, protectionEnabled: true,
    connection: { ...connection, transfers: 0, legs: [connection.legs[1]] },
    transfer: { tripId: trip.id, status: 'changed', updatedAt: Date.now(), revision: 0 },
  });
  assert.equal(replans, 0, 'potwierdzona trasa bezpośrednia pozostaje zablokowana po wyłączeniu ochrony');
  await monitor.stopTracking();
  mock.timers.setTime(at(12, 10));
  const shared = createSharedConnection({ ...connection, departAt: connection.legs[0].departAt }, 'wroclaw', new Date());
  const sharedJourney = encodeSharedConnection(shared);
  const sharedConnection = sharedToConnection(shared, sharedJourney);
  replans = 0;
  await monitor.startTracking({ ...trip, id: sharedConnection.id, sharedJourney, connection: sharedConnection });
  assert.equal(replans, 0, 'obserwowanie nie wyszukuje innego połączenia przed odjazdem');
  assert.deepEqual(monitor.getTrackedTripSync()?.connection.legs.map((leg) => leg.tripId), sharedConnection.legs.map((leg) => leg.tripId));
  assert.equal(plans.at(-1)?.deepLink, `kilometr://shared?trip=${sharedJourney}`);
  assert.equal(plans.at(-1)?.alightAlertsEnabled, false);
  assert.equal(plans.at(-1)?.transferProtectionEnabled, false);
  const savedShared = storage.get('kilometr.trackedTrip.v2');
  await monitor.stopTracking();
  assert.ok(savedShared);
  storage.set('kilometr.trackedTrip.v2', savedShared);
  await monitor.restoreTrackedTrip();
  assert.equal(monitor.getTrackedTripSync()?.sharedJourney, sharedJourney, 'powrót po restarcie zachowuje link obserwowanej podróży');
  assert.equal(replans, 0);
  await monitor.stopTracking();

  // Kurs 24:10 (w rozkładzie 00:10) rozpoczęty przed północą: po północy
  // odjazd ma zostać przy tej samej dacie, a nie przeskoczyć o dobę.
  const midnightConnection: Connection = {
    id: 'midnight',
    fromTitle: 'Dom',
    toTitle: 'Cel',
    departureSec: 24 * 3600 + 10 * 60,
    departAt: '00:10',
    arriveAt: '00:30',
    departInMin: 15,
    durationMin: 20,
    transfers: 0,
    delayMin: 0,
    live: false,
    legs: [
      {
        id: 'midnight-t1',
        tripId: 't1',
        mode: 'tram',
        line: '4',
        fromStop: 'A',
        toStop: 'Cel',
        departAt: '00:10',
        arriveAt: '00:30',
        stopsCount: 3,
        live: false,
        scheduledDepartureSec: 24 * 3600 + 10 * 60,
        scheduledArrivalSec: 24 * 3600 + 30 * 60,
        delaySec: 0,
        arrivalDelaySec: 0,
      },
    ],
  };
  route = async () => [{ ...midnightConnection }];
  mock.timers.setTime(new Date(2026, 9, 19, 23, 55).getTime());
  await monitor.startTracking({ ...trip, id: 'midnight', connection: midnightConnection });
  const beforeMidnight = monitor.getTripProgressSync()!;
  assert.ok(
    beforeMidnight.departInSec > 13 * 60 && beforeMidnight.departInSec < 16 * 60,
    'kurs 00:10 śledzony od 23:55 jest za kwadrans, nie za dobę',
  );
  const savedMidnight = storage.get('kilometr.trackedTrip.v2');
  assert.ok(savedMidnight);
  await monitor.stopTracking();

  mock.timers.setTime(new Date(2026, 9, 20, 0, 5).getTime());
  storage.set('kilometr.trackedTrip.v2', savedMidnight);
  await monitor.restoreTrackedTrip();
  const afterMidnight = monitor.getTripProgressSync()!;
  assert.ok(
    afterMidnight.departInSec > 0 && afterMidnight.departInSec < 12 * 60,
    'po północy ten sam kurs nadal odjeżdża dziś',
  );
  assert.ok(afterMidnight.delayMin > 0, 'opóźnienie live wchodzi po północy');
  assert.equal(new Date(afterMidnight.departAtMs).getDate(), 20);
  mock.timers.setTime(new Date(2026, 9, 20, 0, 6).getTime());
  await monitor.refreshTrackedTrip();
  assert.ok(
    (monitor.getTripProgressSync()?.delayMin ?? 0) > 0,
    'kolejne odświeżenie nie gubi opóźnienia przez rozkład z poprzedniej doby',
  );
  await monitor.stopTracking();

  // Kurs z feedu zapisany jako 24:xx, uruchomiony już po północy.
  const lateNightConnection: Connection = {
    ...midnightConnection,
    id: 'late-night',
    departureSec: 24 * 3600 + 40 * 60,
    departAt: '00:40',
    arriveAt: '00:55',
    durationMin: 15,
    legs: [
      {
        ...midnightConnection.legs[0],
        id: 'late-night-t1',
        tripId: 'late-night-t1',
        line: '9',
        departAt: '00:40',
        arriveAt: '00:55',
        scheduledDepartureSec: 24 * 3600 + 40 * 60,
        scheduledArrivalSec: 24 * 3600 + 55 * 60,
      },
    ],
  };
  route = async () => [{ ...lateNightConnection }];
  mock.timers.setTime(new Date(2026, 9, 20, 0, 30).getTime());
  await monitor.startTracking({ ...trip, id: 'late-night', connection: lateNightConnection });
  const lateNight = monitor.getTripProgressSync()!;
  assert.ok(
    lateNight.departInSec > 9 * 60 && lateNight.departInSec < 11 * 60,
    'kurs 24:40 po północy odjeżdża za 10 minut, nie za dobę',
  );
  assert.equal(new Date(lateNight.departAtMs).getDate(), 20);
  assert.equal(monitor.getTrackedTripSync()?.connection.departureSec, 40 * 60);
  assert.equal(
    monitor.getTrackedTripSync()?.connection.legs[0].scheduledDepartureSec,
    40 * 60,
    'rozkład odcinka przesuwa się razem z odjazdem',
  );
  mock.timers.setTime(new Date(2026, 9, 20, 0, 42).getTime());
  await monitor.refreshTrackedTrip();
  assert.equal(monitor.getTripProgressSync()?.phase, 'riding', 'kurs 24:xx po północy w końcu jedzie');
  await monitor.stopTracking();

  // Kursor na jutro ma ten sam `departureSec` co nocny 24:xx, więc plan
  // odjazdu musi wybrać dobę z `departInMin`, a nie zawsze najbliższy zegar.
  const tomorrowConnection: Connection = {
    ...midnightConnection,
    id: 'tomorrow',
    departureSec: 24 * 3600 + 8 * 3600,
    arrivalSec: 24 * 3600 + 8 * 3600 + 20 * 60,
    departAt: '08:00',
    arriveAt: '08:20',
    departInMin: 18 * 60,
    legs: [
      {
        ...midnightConnection.legs[0],
        id: 'tomorrow-t1',
        tripId: 'tomorrow-t1',
        line: '17',
        departAt: '08:00',
        arriveAt: '08:20',
        scheduledDepartureSec: 24 * 3600 + 8 * 3600,
        scheduledArrivalSec: 24 * 3600 + 8 * 3600 + 20 * 60,
      },
    ],
  };
  route = async () => [{ ...tomorrowConnection }];
  mock.timers.setTime(new Date(2026, 9, 19, 14, 0).getTime());
  await monitor.startTracking({ ...trip, id: 'tomorrow', connection: tomorrowConnection });
  const tomorrow = monitor.getTripProgressSync()!;
  assert.ok(
    tomorrow.departInSec > 17 * 3600 && tomorrow.departInSec < 19 * 3600,
    'kurs z jutra zostaje jutro, nie cofa się do dzisiejszego poranka',
  );
  assert.equal(new Date(tomorrow.departAtMs).getDate(), 20);
  assert.equal(
    monitor.getTrackedTripSync()?.connection.departureSec,
    24 * 3600 + 8 * 3600,
  );
  await monitor.refreshTrackedTrip();
  assert.ok(monitor.getTrackedTripSync(), 'kurs z jutra nie kończy śledzenia po odświeżeniu');
  await monitor.stopTracking();

  unsubscribe();
  console.log(
    'PASS: cykl śledzenia, przesiadki w tle, dojście, anulowanie, wyścigi, fallback, akcje i dźwięk',
  );
}

void main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await monitor.stopTracking();
    mock.timers.reset();
    loader._load = originalLoad;
    snapshotHooks.deregister();
  });
