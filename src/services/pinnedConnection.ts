import { AppState, Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import { RoutingService } from './api';
import { getSettingsSync } from './settings';
import { inferTransitMode } from '../components/LineBadge';
import type { Connection, RouteQuery } from '../types/models';

// Persistent notification (a'la Uber Eats) z najbliższym połączeniem:
// jaki tramwaj/bus, za ile, skąd. Na Androidzie sticky (ongoing),
// odświeżane co minutę + przy powrocie apki na pierwszy plan.
//
// UWAGA Expo Go: sam import 'expo-notifications' wywala ewaluację modułu
// (DevicePushTokenAutoRegistration woła push API niedostępne w Expo Go),
// więc ładujemy je leniwie przez require + guard na appOwnership.
// W Expo Go pinezka jest niedostępna (isPinSupported() === false).

const PIN_ID = 'pinned-connection';
const CHANNEL_ID = 'pinned-connection';
const STORAGE_KEY = 'kilometr.pinnedQuery.v1';
const TICK_MS = 60000;
// Kurs uznajemy za aktualny jeszcze 3 min po odjeździe (dobiegnięcie na przystanek)
const GRACE_SEC = 180;

export interface PinnedQuery extends RouteQuery {}

type NotificationsModule = typeof import('expo-notifications');

let nmod: NotificationsModule | null | undefined;
let warnedUnsupported = false;

/** Leniwy dostęp do expo-notifications. null w Expo Go i przy braku modułu. */
function getNotifications(): NotificationsModule | null {
  if (nmod !== undefined) return nmod;
  try {
    if (Constants.appOwnership === 'expo') {
      nmod = null;
      return nmod;
    }
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    nmod = require('expo-notifications') as NotificationsModule;
  } catch {
    nmod = null;
  }
  return nmod;
}

/** Czy pinezka w ogóle może działać (dev build / prod, nie Expo Go). */
export function isPinSupported(): boolean {
  return getNotifications() != null;
}

export function setupNotificationHandler(): void {
  const N = getNotifications();
  if (!N) return;
  try {
    // Ciche aktualizacje w trayu (kanał ma niską ważność — bez banerów/dźwięku).
    N.setNotificationHandler({
      handleNotification: async () => ({
        shouldPlaySound: false,
        shouldSetBadge: false,
        shouldShowBanner: true,
        shouldShowList: true,
      }),
    });
  } catch {
    // ignoruj
  }
}

let pinned: PinnedQuery | null = null;
let tickerStarted = false;
const listeners = new Set<(q: PinnedQuery | null) => void>();

function notify() {
  for (const l of listeners) l(pinned ? { ...pinned } : null);
}

export function subscribePinned(listener: (q: PinnedQuery | null) => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getPinnedQuerySync(): PinnedQuery | null {
  return pinned ? { ...pinned } : null;
}

export function isSameQuery(a: RouteQuery, b: RouteQuery): boolean {
  return (
    a.fromTitle === b.fromTitle &&
    a.toTitle === b.toTitle &&
    Math.abs(a.fromLat - b.fromLat) < 0.0005 &&
    Math.abs(a.fromLon - b.fromLon) < 0.0005 &&
    Math.abs(a.toLat - b.toLat) < 0.0005 &&
    Math.abs(a.toLon - b.toLon) < 0.0005
  );
}

export async function setupPinnedChannel(): Promise<void> {
  const N = getNotifications();
  if (!N || Platform.OS !== 'android') return;
  try {
    await N.setNotificationChannelAsync(CHANNEL_ID, {
      name: 'Przypięte połączenie',
      importance: N.AndroidImportance.LOW,
      lockscreenVisibility: N.AndroidNotificationVisibility.PUBLIC,
    });
  } catch {
    // kanał opcjonalny — powiadomienie i tak się pokaże na kanale domyślnym
  }
}

export async function ensurePinPermissions(): Promise<boolean> {
  const N = getNotifications();
  if (!N) return false;
  try {
    const current = await N.getPermissionsAsync();
    if (current.granted) return true;
    const next = await N.requestPermissionsAsync();
    return !!next.granted;
  } catch {
    return false;
  }
}

function nowSec(): number {
  const d = new Date();
  return d.getHours() * 3600 + d.getMinutes() * 60 + d.getSeconds();
}

function timeText(conn: Connection): string {
  const mins = Math.round((conn.departureSec - nowSec()) / 60);
  if (mins <= 1) return 'odjazd teraz';
  if (mins > 59) return conn.departAt;
  return `za ${mins} min`;
}

function buildContent(conn: Connection, query: PinnedQuery) {
  const boarding = conn.legs.filter((l) => l.mode !== 'walk');
  const first = boarding[0];
  const modeWord =
    first && inferTransitMode(first.mode, first.line) === 'tram' ? 'Tramwaj' : 'Autobus';
  const title = first ? `${modeWord} ${first.line} • ${timeText(conn)}` : `Połączenie • ${timeText(conn)}`;
  const lines = boarding.map((b) => b.line).filter(Boolean).join(' → ');
  const body =
    lines.length > 0
      ? `${conn.fromTitle} → ${conn.toTitle} (${lines})`
      : `${conn.fromTitle} → ${conn.toTitle}`;
  return {
    title,
    body,
    data: {
      pinned: true,
      fromTitle: query.fromTitle,
      fromLat: String(query.fromLat),
      fromLon: String(query.fromLon),
      toId: query.toId ?? '',
      toTitle: query.toTitle,
      toLat: String(query.toLat),
      toLon: String(query.toLon),
    },
  };
}

async function postNotification(conn: Connection, query: PinnedQuery): Promise<void> {
  const N = getNotifications();
  if (!N) return;
  const content = buildContent(conn, query);
  await N.scheduleNotificationAsync({
    identifier: PIN_ID,
    content: {
      title: content.title,
      body: content.body,
      data: content.data,
      sticky: true,
    },
    trigger: null,
  });
}

/** Pobiera świeże połączenia i odświeża przypięte powiadomienie. */
export async function refreshPinnedNotification(): Promise<void> {
  if (!pinned) return;
  try {
    const s = getSettingsSync();
    const conns = await RoutingService.getConnections({
      ...pinned,
      maxTransfers: s.maxTransfers,
      minTransferSec: s.minTransferSec,
      maxWalkM: s.maxWalkM,
    });
    const now = nowSec();
    const upcoming = [...conns]
      .filter((c) => c.departureSec <= 0 || c.departureSec >= now - GRACE_SEC)
      .sort((a, b) => a.departureSec - b.departureSec)[0];
    if (!upcoming) {
      await unpinConnection();
      return;
    }
    await postNotification(upcoming, pinned);
  } catch {
    // offline — zostaje ostatnia treść powiadomienia
  }
}

export async function pinConnection(query: RouteQuery): Promise<void> {
  pinned = { ...query };
  try {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(pinned));
  } catch {
    // persist opcjonalny
  }
  notify();
  await refreshPinnedNotification();
}

export async function unpinConnection(): Promise<void> {
  pinned = null;
  try {
    await AsyncStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignoruj
  }
  const N = getNotifications();
  if (N) {
    try {
      await N.dismissNotificationAsync(PIN_ID);
    } catch {
      // mogło nie istnieć
    }
    try {
      await N.cancelScheduledNotificationAsync(PIN_ID);
    } catch {
      // ignoruj
    }
  }
  notify();
}

/** Wznawia pinezkę po starcie apki (np. po restarcie telefonu znika sticky). */
export async function restorePinnedQuery(): Promise<PinnedQuery | null> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (raw) {
      pinned = JSON.parse(raw) as PinnedQuery;
      notify();
      await refreshPinnedNotification();
      return pinned ? { ...pinned } : null;
    }
  } catch {
    // brak pinezki
  }
  return null;
}

/** Typer co minutę + przy powrocie na foreground. Idempotentny. */
export function startPinnedTicker(): void {
  if (tickerStarted) return;
  tickerStarted = true;
  setInterval(() => {
    if (pinned) void refreshPinnedNotification();
  }, TICK_MS);
  AppState.addEventListener('change', (state) => {
    if (state === 'active' && pinned) void refreshPinnedNotification();
  });
}

export type PinTapData = Record<string, string> | null;

/** Ostatni tap w powiadomienie (cold start). null gdy brak / brak wsparcia. */
export async function getPinTapData(): Promise<PinTapData> {
  const N = getNotifications();
  if (!N) return null;
  try {
    const res = await N.getLastNotificationResponseAsync();
    return extractPinData(res?.notification.request.content.data);
  } catch {
    return null;
  }
}

/** Subskrypcja tapów w powiadomienie. Zwraca funkcję do odsubskrybowania. */
export function addPinTapListener(cb: (data: PinTapData) => void): () => void {
  const N = getNotifications();
  if (!N) return () => {};
  try {
    const sub = N.addNotificationResponseReceivedListener((res) => {
      cb(extractPinData(res.notification.request.content.data));
    });
    return () => sub.remove();
  } catch {
    return () => {};
  }
}

function extractPinData(data: unknown): PinTapData {
  if (!data || typeof data !== 'object') return null;
  const d = data as Record<string, unknown>;
  if (d.pinned !== true) return null;
  const out: Record<string, string> = {};
  for (const k of ['fromTitle', 'fromLat', 'fromLon', 'toId', 'toTitle', 'toLat', 'toLon']) {
    const v = d[k];
    if (typeof v === 'string') out[k] = v;
  }
  return out.toLat && out.toLon ? out : null;
}
