import { Platform } from 'react-native';
import { tr } from '../../i18n';
import { kvGet, kvRemove, kvSet } from '../storage';
import { getNotifications } from './module';
import { ALERT_CATEGORY } from './categories';
import { ALERTS_CHANNEL_ID } from './channels';
import { buildTripCopy, tripNotificationData } from './content';
import { computeLegTimeline } from './tripProgress';
import { clockFromMs } from './format';
import type { NotificationPreferences, TripProgress, TrackedTrip } from './types';

const ALERT_IDS_KEY = 'kilometr.alertIds.v1';
const DELAY_ALERT_STEP_MIN = 3;
let alertQueue: Promise<unknown> = Promise.resolve();

function enqueue<T>(work: () => Promise<T>): Promise<T> {
  const next = alertQueue.then(work, work);
  alertQueue = next.catch(() => {});
  return next;
}

async function readAlertIds(): Promise<string[]> {
  try {
    return JSON.parse((await kvGet(ALERT_IDS_KEY)) ?? '[]') as string[];
  } catch {
    return [];
  }
}

export function cancelScheduledAlerts(): Promise<void> {
  return enqueue(async () => {
    const N = getNotifications();
    for (const id of await readAlertIds()) {
      await N?.cancelScheduledNotificationAsync(id).catch(() => {});
      await N?.dismissNotificationAsync(id).catch(() => {});
    }
    await kvRemove(ALERT_IDS_KEY);
  });
}

export function scheduleIOSTripAlerts(
  p: TripProgress,
  trip: TrackedTrip,
): Promise<void> {
  if (Platform.OS !== 'ios') return Promise.resolve();
  return enqueue(async () => {
    const N = getNotifications();
    if (!N) return;
    const s = tr();
    const now = Date.now();
    const alerts = computeLegTimeline(trip.connection, new Date(p.computedAt))
      .filter(({ leg }) => leg.mode !== 'walk')
      .map(({ leg, arriveMs }, index) => ({
        id: `kilometr.alert.ios.${trip.id}.alight.${index}`,
        at: arriveMs - 60_000,
        title: s.notification.alightAt(leg.toStop),
        body: `${leg.line ?? ''} • ${clockFromMs(arriveMs)}`,
        kind: 'alight',
      }));
    const arrived = buildTripCopy({ ...p, phase: 'arrived' }, trip.connection, s);
    alerts.push({
      id: `kilometr.alert.ios.${trip.id}.arrived`,
      at: p.arriveAtMs, title: arrived.title, body: arrived.subtitle, kind: 'arrived',
    });
    const future = alerts.filter((alert) => alert.at > now).slice(0, 60);
    const ids = await readAlertIds();
    const wanted = new Set(future.map((alert) => alert.id));
    for (const id of ids.filter((id) => id.startsWith('kilometr.alert.ios.') && !wanted.has(id))) {
      await N.cancelScheduledNotificationAsync(id);
    }
    for (const alert of future) {
      await N.scheduleNotificationAsync({
        identifier: alert.id,
        content: {
          title: alert.title, body: alert.body, sound: 'default',
          categoryIdentifier: ALERT_CATEGORY,
          data: tripNotificationData(trip, alert.kind),
        },
        trigger: { type: N.SchedulableTriggerInputTypes.DATE, date: new Date(alert.at) },
      });
      await rememberAlert(alert.id);
    }
  });
}

// Po aktualizacji usuwamy także alerty „wyjdź” zapisane przez poprzednią wersję.
export function cancelLegacyDepartureAlerts(): Promise<void> {
  return enqueue(async () => {
    const N = getNotifications();
    const ids = await readAlertIds();
    const remaining: string[] = [];
    for (const id of ids) {
      if (id.startsWith('kilometr.alert.lead.') || id.startsWith('kilometr.alert.imminent.')) {
        await N?.cancelScheduledNotificationAsync(id).catch(() => {});
        await N?.dismissNotificationAsync(id).catch(() => {});
      } else remaining.push(id);
    }
    await kvSet(ALERT_IDS_KEY, JSON.stringify(remaining));
  });
}

export function sendDisruptionAlert(
  p: TripProgress,
  trip: TrackedTrip,
  prefs: NotificationPreferences,
): Promise<boolean> {
  return enqueue(async () => {
    if (!prefs.disruptionAlertsEnabled) return false;
    const N = getNotifications();
    if (!N) return false;
    const s = tr();
    const n = s.notification;
    const id = `kilometr.alert.disruption.${trip.id}`;
    try {
      await N.scheduleNotificationAsync({
        identifier: id,
        content: {
          title: n.delayTitle(p.line, s.common.durMin(Math.max(1, Math.round(p.departInSec / 60)))),
          body: [
            p.leg ? n.stopHere(p.leg.fromStop) : null,
            n.newDeparture(p.departAt),
            p.delayMin >= 2 ? n.delayLate(p.delayMin) : '',
          ].filter(Boolean).join(' • '),
          data: tripNotificationData(trip, 'disruption'),
          sound: 'default',
          categoryIdentifier: ALERT_CATEGORY,
          ...(Platform.OS === 'ios' ? { interruptionLevel: 'timeSensitive' as const } : {}),
          ...(Platform.OS === 'android' ? { priority: 'high' as const } : {}),
        },
        trigger: Platform.OS === 'android' ? { channelId: ALERTS_CHANNEL_ID } : null,
      });
      await rememberAlert(id);
      return true;
    } catch (err) {
      console.warn('[Powiadomienia] alert o opóźnieniu nie wyszedł:', err);
      return false;
    }
  });
}

export function sendArrivedNotification(p: TripProgress, trip: TrackedTrip): Promise<void> {
  return enqueue(async () => {
    const N = getNotifications();
    if (!N) return;
    const copy = buildTripCopy(p, trip.connection, tr());
    const id = `kilometr.alert.arrived.${trip.id}`;
    try {
      await N.scheduleNotificationAsync({
        identifier: id,
        content: {
          title: copy.title,
          body: [copy.subtitle, copy.body].filter(Boolean).join(' • '),
          data: tripNotificationData(trip, 'arrived'),
          sound: 'default',
          categoryIdentifier: ALERT_CATEGORY,
          ...(Platform.OS === 'ios' ? { interruptionLevel: 'active' as const } : {}),
          ...(Platform.OS === 'android' ? { priority: 'high' as const } : {}),
        },
        trigger: Platform.OS === 'android' ? { channelId: ALERTS_CHANNEL_ID } : null,
      });
      await rememberAlert(id);
    } catch (err) {
      console.warn('[Powiadomienia] komunikat o przyjeździe:', err);
    }
  });
}

async function rememberAlert(id: string): Promise<void> {
  await kvSet(ALERT_IDS_KEY, JSON.stringify([...new Set([...(await readAlertIds()), id])]));
}

export function shouldAlertDelay(previousDelayMin: number, currentDelayMin: number): boolean {
  return currentDelayMin >= DELAY_ALERT_STEP_MIN &&
    currentDelayMin - previousDelayMin >= DELAY_ALERT_STEP_MIN;
}
