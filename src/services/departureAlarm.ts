import { useEffect, useState } from 'react';
import { AppState, Platform } from 'react-native';
import { requireOptionalNativeModule } from 'expo';
import { getLocaleSync, tr } from '../i18n';
import { scheme } from '../theme/tokens';
import type { Connection } from '../types/models';
import { clockFromMs } from './notifications/format';
import { departureAlarmTiming } from './departureAlarmPlan';
import { iosDepartureAlarm } from './iosDepartureAlarm';
import { areNotificationsSupported } from './notifications/module';

export interface AlarmPermissions {
  notifications: boolean;
  exact: boolean;
  fullScreen: boolean;
  channel: boolean;
}

export interface DepartureAlarm {
  connectionId: string;
  connection: Connection;
  leadMin: number;
  at: number;
  journeyAt: number;
  referenceAt?: number;
  status: 'scheduled' | 'ringing' | 'dismissed';
  time: string;
  date: string;
}

interface AlarmNative {
  getAlarm(): Promise<string | null>;
  getPermissions(): Promise<AlarmPermissions>;
  openPermission(kind: keyof AlarmPermissions): Promise<boolean>;
  schedule(json: string): Promise<boolean>;
  cancel(): Promise<boolean>;
  preview(json: string): Promise<boolean>;
}

const native: AlarmNative | null = Platform.OS === 'android'
  ? requireOptionalNativeModule<AlarmNative>('KilometrAlarm')
  : Platform.OS === 'ios' ? iosDepartureAlarm : null;
let cached: DepartureAlarm | null = null;
const listeners = new Set<() => void>();

export const isDepartureAlarmSupported = () =>
  native != null && (Platform.OS !== 'ios' || areNotificationsSupported());
export const getDepartureAlarmSync = () => cached;

export async function refreshDepartureAlarm(): Promise<void> {
  try {
    const raw = await native?.getAlarm();
    cached = raw ? JSON.parse(raw) as DepartureAlarm : null;
    for (const listener of listeners) listener();
  } catch (err) {
    console.warn('[Budzik] odczyt:', err);
  }
}

export const getAlarmPermissions = () => native?.getPermissions() ?? Promise.resolve(null);
export const openAlarmPermission = (kind: keyof AlarmPermissions) =>
  native?.openPermission(kind) ?? Promise.resolve(false);

function buildPlan(connection: Connection, leadMin: number, reference: Date) {
  const timing = departureAlarmTiming(connection, leadMin, reference);
  if (!timing) return null;
  const s = tr();
  const a = s.alarm;
  return {
    connectionId: connection.id,
    connection,
    leadMin,
    at: timing.at,
    journeyAt: timing.journeyAt,
    referenceAt: reference.getTime(),
    time: clockFromMs(timing.at),
    date: new Intl.DateTimeFormat(getLocaleSync(), {
      weekday: 'long', day: 'numeric', month: 'long',
    }).format(new Date(timing.at)),
    routeLabel: `${connection.fromTitle} → ${connection.toTitle}`,
    journeyLabel: a.journeyAt(clockFromMs(timing.journeyAt)),
    boardingLabel: a.boarding(timing.leg.line || s.notification.modeBus, clockFromMs(timing.boardAt), timing.leg.fromStop),
    labels: {
      title: a.title, preview: a.preview, ringTitle: a.ringTitle, dismiss: a.dismiss,
      showRoute: a.showRoute, close: s.common.close,
      channel: a.channel, channelDescription: a.channelDescription,
    },
    colors: {
      surface: scheme.surface, onSurface: scheme.onSurface, onSurfaceVariant: scheme.onSurfaceVariant,
      primary: scheme.primary, onPrimary: scheme.onPrimary,
      primaryContainer: scheme.primaryContainer, onPrimaryContainer: scheme.onPrimaryContainer,
      surfaceContainerHigh: scheme.surfaceContainerHigh,
    },
  };
}

export async function setDepartureAlarm(connection: Connection, leadMin: number, reference: Date): Promise<boolean> {
  const plan = buildPlan(connection, leadMin, reference);
  if (!native || !plan || plan.at <= Date.now()) return false;
  const saved = await native.schedule(JSON.stringify(plan));
  if (saved) await refreshDepartureAlarm();
  return saved;
}

export async function cancelDepartureAlarm(): Promise<void> {
  if (!await native?.cancel()) throw new Error('Alarm cancellation failed');
  await refreshDepartureAlarm();
}

export async function previewDepartureAlarm(connection: Connection, leadMin: number, reference: Date): Promise<boolean> {
  const plan = buildPlan(connection, leadMin, reference);
  return native && plan ? native.preview(JSON.stringify(plan)) : false;
}

export function useDepartureAlarm() {
  const [, rerender] = useState(0);
  useEffect(() => {
    const update = () => rerender((value) => value + 1);
    listeners.add(update);
    void refreshDepartureAlarm();
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') void refreshDepartureAlarm();
    });
    const timer = setInterval(() => { if (AppState.currentState === 'active') void refreshDepartureAlarm(); }, 5000);
    return () => { listeners.delete(update); sub.remove(); clearInterval(timer); };
  }, []);
  return cached && (cached.status === 'ringing' || cached.status === 'scheduled' && cached.at > Date.now())
    ? cached : null;
}
