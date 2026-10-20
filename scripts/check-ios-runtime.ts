import assert from 'node:assert/strict';
import Module, { createRequire } from 'node:module';
import { mock } from 'node:test';
import type { NotificationRequestInput } from 'expo-notifications';
import type { Connection } from '../src/types/models';
import type { TrackedTrip } from '../src/services/notifications/types';
import { DEFAULT_NOTIFICATION_PREFERENCES } from '../src/services/notifications/types';
import { buildIOSLiveActivity } from '../src/services/notifications/iosLiveActivity';
import { computeTripProgress } from '../src/services/notifications/tripProgress';
import { pl } from '../src/i18n/pl';
import { en } from '../src/i18n/en';
import { de } from '../src/i18n/de';
import { uk } from '../src/i18n/uk';

const require = createRequire(import.meta.url);
require('react-native').Platform.OS = 'ios';
const at = (hour: number, minute: number) => new Date(2026, 9, 20, hour, minute).getTime();
mock.timers.enable({ apis: ['Date'], now: at(12, 0) });
const scheduled = new Map<string, NotificationRequestInput>();
const storage = new Map<string, string>();
const plans: string[] = [];
let permission = true;
let available = true;
let stopped = 0;
const notifications = {
  SchedulableTriggerInputTypes: { DATE: 'date' },
  getPermissionsAsync: async () => ({ granted: permission }),
  IosAuthorizationStatus: { PROVISIONAL: 3 },
  scheduleNotificationAsync: async (request: NotificationRequestInput) => {
    scheduled.set(request.identifier!, request);
    return request.identifier!;
  },
  cancelScheduledNotificationAsync: async (id: string) => { scheduled.delete(id); },
  dismissNotificationAsync: async () => {},
  getAllScheduledNotificationsAsync: async () => [...scheduled.values()],
};
const notificationModule = {
  getNotifications: () => notifications,
  getTrackingNative: () => available ? {
    hasStopRequest: async () => false,
    startTrip: async (json: string) => { plans.push(json); return true; },
    stopTrip: async () => { stopped++; },
  } : null,
  TRACKING_NOTIFICATION_ID: 'kilometr.tracking.v2',
  warnUnsupportedOnce: () => {},
};
const kv = {
  kvGet: async (key: string) => storage.get(key) ?? null,
  kvSet: async (key: string, value: string) => { storage.set(key, value); },
  kvRemove: async (key: string) => { storage.delete(key); },
};
const loader = Module as unknown as {
  _load: (request: string, parent: { filename?: string }, ...rest: unknown[]) => unknown;
};
const original = loader._load;
loader._load = function (request, parent, ...rest) {
  if (parent?.filename?.includes('/src/services/')) {
    if (request === './notifications/module' || request === './module') return notificationModule;
    if (request === './storage' || request === '../storage') return kv;
  }
  return original.call(this, request, parent, ...rest);
};

const presenter: typeof import('../src/services/notifications/presenter') = require('../src/services/notifications/presenter');
const alerts: typeof import('../src/services/notifications/alerts') = require('../src/services/notifications/alerts');
const { iosDepartureAlarm }: typeof import('../src/services/iosDepartureAlarm') = require('../src/services/iosDepartureAlarm');
const connection: Connection = {
  id: 'ios-trip', fromTitle: 'Dom', toTitle: 'Cel', departInMin: 20,
  departureSec: 12 * 3600 + 20 * 60, departAt: '12:20', arriveAt: '12:50',
  durationMin: 30, transfers: 0, delayMin: 0, live: false,
  legs: [{
    id: 'tram', mode: 'tram', line: '4', fromStop: 'A', toStop: 'B',
    departAt: '12:20', arriveAt: '12:50', stopsCount: 4, live: false,
    fromLat: 51.1, fromLon: 17.0, toLat: 51.12, toLon: 17.02,
  }],
};
const trip: TrackedTrip = {
  id: 'ios-trip', fromTitle: 'Dom', fromLat: 51.1, fromLon: 17.0,
  toId: 'destination', toTitle: 'Cel', toLat: 51.12, toLon: 17.02, startedAt: at(12, 0), connection,
};
const p = computeTripProgress(connection, { now: new Date() });

async function main() {
  for (const strings of [pl, en, de, uk]) {
    const json = buildIOSLiveActivity(p, trip, strings);
    const plan = JSON.parse(json);
    assert.ok(Buffer.byteLength(json) < 4096, 'ActivityKit payload budget');
    assert.equal(plan.staleLabel, strings.ios.stale);
    assert.equal(plan.countdownAt, at(12, 20) / 1000);
    assert.ok(plan.staleAt <= at(12, 2) / 1000);
    assert.equal(new URL(plan.deepLink).searchParams.get('open'), connection.id);
  }
  await presenter.presentTrip(trip, p, DEFAULT_NOTIFICATION_PREFERENCES);
  assert.equal(plans.length, 1);
  assert.equal(JSON.parse(plans[0]).tripId, trip.id);
  assert.equal(scheduled.size, 2, 'Alight and arrival survive JS suspension');
  const alight = [...scheduled.values()].find((n) => n.content.data?.alert === 'alight')!;
  assert.equal((alight.trigger as { date: Date }).date.getTime(), at(12, 49));
  await presenter.presentTrip(trip, p, DEFAULT_NOTIFICATION_PREFERENCES);
  assert.equal(scheduled.size, 2, 'Updates replace pending alerts');
  await presenter.presentTrip(trip, p, { ...DEFAULT_NOTIFICATION_PREFERENCES, trackingEnabled: false });
  assert.equal(scheduled.size, 0, 'Disabling tracking cancels iOS alerts');
  assert.ok(stopped > 0);
  available = false;
  await presenter.presentTrip(trip, p, DEFAULT_NOTIFICATION_PREFERENCES);
  assert.ok(scheduled.has('kilometr.tracking.v2'), 'Banner when Live Activity is unavailable');
  await alerts.cancelScheduledAlerts();
  scheduled.clear();

  const plan = JSON.stringify({
    connectionId: connection.id, connection, at: at(12, 10), leadMin: 10,
    journeyAt: at(12, 20), routeLabel: 'Dom → Cel', boardingLabel: '4 • 12:20 • A',
    labels: { ringTitle: pl.alarm.ringTitle, preview: pl.alarm.preview },
  });
  permission = false;
  assert.equal(await iosDepartureAlarm.schedule(plan), false);
  assert.equal(scheduled.size, 0);
  permission = true;
  assert.equal(await iosDepartureAlarm.schedule(plan), true);
  assert.equal(JSON.parse((await iosDepartureAlarm.getAlarm())!).status, 'scheduled');
  assert.equal(scheduled.get('kilometr.departureAlarm')!.content.data?.toLat, '51.12');
  await iosDepartureAlarm.preview(plan);
  assert.equal(scheduled.size, 2);
  await iosDepartureAlarm.cancel();
  assert.equal(scheduled.size, 0);
  assert.equal(await iosDepartureAlarm.getAlarm(), null);
  await iosDepartureAlarm.schedule(plan);
  mock.timers.setTime(at(12, 11));
  assert.equal(await iosDepartureAlarm.getAlarm(), null, 'An elapsed reminder is not a ringing alarm');
  assert.equal(await iosDepartureAlarm.schedule(plan), false);
  console.log('PASS: iOS ActivityKit payload, translations, fallback, scheduled alerts, reminder permissions and cancellation');
}

main().finally(() => {
  loader._load = original;
  mock.timers.reset();
}).catch((error) => { console.error(error); process.exitCode = 1; });
