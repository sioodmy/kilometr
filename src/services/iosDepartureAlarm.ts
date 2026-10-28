import { Linking } from 'react-native';
import { kvGet, kvRemove, kvSet } from './storage';
import { getNotifications } from './notifications/module';
import { hasNotificationPermission } from './notifications/permissions';
import { ALERT_CATEGORY } from './notifications/categories';
import type { AlarmPermissions, DepartureAlarm } from './departureAlarm';

const KEY = 'kilometr.iosDepartureAlarm.v1';
const ID = 'kilometr.departureAlarm';
type Plan = DepartureAlarm & {
  routeLabel: string;
  boardingLabel: string;
  labels: { ringTitle: string };
};

async function schedule(json: string): Promise<boolean> {
  const N = getNotifications();
  if (!N || !await hasNotificationPermission()) return false;
  const plan = JSON.parse(json) as Plan;
  if (plan.at <= Date.now()) return false;
  const connection = plan.connection;
  const first = connection.legs[0];
  const last = connection.legs[connection.legs.length - 1];
  await N.scheduleNotificationAsync({
    identifier: ID,
    content: {
      title: plan.labels.ringTitle,
      body: `${plan.routeLabel}\n${plan.boardingLabel}`,
      sound: 'default',
      categoryIdentifier: ALERT_CATEGORY,
      data: {
        kind: 'trip', alert: 'departureAlarm', open: connection.id,
        fromTitle: connection.fromTitle, toTitle: connection.toTitle,
        ...(first?.fromLat != null && first.fromLon != null
          ? { fromLat: String(first.fromLat), fromLon: String(first.fromLon) } : {}),
        ...(last?.toLat != null && last.toLon != null
          ? { toLat: String(last.toLat), toLon: String(last.toLon) } : {}),
      },
    },
    trigger: { type: N.SchedulableTriggerInputTypes.DATE, date: new Date(plan.at) },
  });
  try {
    await kvSet(KEY, JSON.stringify({ ...plan, status: 'scheduled' }));
  } catch (error) {
    await N.cancelScheduledNotificationAsync(ID);
    throw error;
  }
  return true;
}

export const iosDepartureAlarm = {
  async getAlarm(): Promise<string | null> {
    const raw = await kvGet(KEY);
    if (!raw) return null;
    const plan = JSON.parse(raw) as Plan;
    const pending = await getNotifications()?.getAllScheduledNotificationsAsync();
    if (plan.at <= Date.now() || !pending?.some((item) => item.identifier === ID)) {
      await kvRemove(KEY);
      return null;
    }
    return raw;
  },
  async getPermissions(): Promise<AlarmPermissions> {
    return { notifications: await hasNotificationPermission(), exact: true, fullScreen: true, channel: true };
  },
  async openPermission(): Promise<boolean> {
    await Linking.openSettings();
    return true;
  },
  schedule,
  async cancel(): Promise<boolean> {
    const N = getNotifications();
    if (!N) return false;
    await N.cancelScheduledNotificationAsync(ID);
    await N.dismissNotificationAsync(ID);
    await kvRemove(KEY);
    return true;
  },
};
