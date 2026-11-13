import { AppState, Platform } from 'react-native';
import { tr } from '../../i18n';
import type { Connection } from '../../types/models';
import { RoutingService } from '../api';
import { fetchNationalRailUpdates } from '../nationalRailUpdates';
import { isTrainLeg } from '../railIdentity';
import { boardingDepartureMs, boardingDepartureSec } from '../routing/connectionTimes';
import { sharedTimeMs } from '../../sharing/progress';
import { kvGet, kvSet } from '../storage';
import {
  getTicketForConnection,
  getTicketIndex,
  type AttachedRailTicket,
  type TicketIndexEntry,
} from '../ticketStorage';
import { ALERT_CATEGORY } from './categories';
import { ALERTS_CHANNEL_ID } from './channels';
import {
  cancelledTrainLeg,
  compensationLevelForDelay,
  compensationThresholdMinutes,
  finalTrainLeg,
  isCompensationCandidate,
  measuredCompensationDelay,
  type CompensationLevel,
} from './compensation';
import { getNotifications } from './module';
import { hasNotificationPermission } from './permissions';
import { getNotificationPreferencesSync } from './preferences';

// Monitor zwrotów za opóźnienie pociągu. Sprawdza bilety z indeksu na starcie,
// po powrocie aplikacji na pierwszy plan i co 10 minut, dopóki proces żyje.
// Stan powiadomień trzyma w kv, więc restart nie dubluje alertu.
//
// Gdy aplikacja jest całkiem ubita, system nie budzi JS: to znane ograniczenie,
// nie obietnica powiadomienia w tle.

const STATE_KEY = 'kilometr.ticketCompensation.v1';
const CHECK_INTERVAL_MS = 10 * 60_000;
const STATE_MAX_AGE_MS = 30 * 24 * 3600_000;

interface NotifiedCompensation {
  level: CompensationLevel;
  notifiedAt: number;
  connectionId: string;
}

type CompensationState = Record<string, NotifiedCompensation>;

let started = false;
let running: Promise<void> | null = null;

/** Uruchamia monitor raz na proces; kolejne wywołania są ignorowane. */
export function startTicketCompensationMonitor(): void {
  if (started) return;
  started = true;
  AppState.addEventListener('change', (state) => {
    if (state === 'active') void checkTicketCompensation();
  });
  setInterval(() => {
    void checkTicketCompensation();
  }, CHECK_INTERVAL_MS);
  void checkTicketCompensation();
}

/** Jednorazowe sprawdzenie; przydatne po dołączeniu biletu i w testach. */
export function checkTicketCompensation(now = Date.now()): Promise<void> {
  if (running) return running;
  const work = runCheck(now)
    .catch((err) => {
      console.warn('[Rekompensata] sprawdzenie nie wyszło:', err);
    })
    .finally(() => {
      if (running === work) running = null;
    });
  running = work;
  return work;
}

async function runCheck(now: number): Promise<void> {
  if (!getNotificationPreferencesSync().disruptionAlertsEnabled) return;
  if (!(await hasNotificationPermission())) return;

  const index = await getTicketIndex();
  if (index.length === 0) return;

  const state = await loadState(now);
  for (const entry of index) {
    await checkEntry(entry, state, now);
  }
}

async function checkEntry(
  entry: TicketIndexEntry,
  state: CompensationState,
  now: number,
): Promise<void> {
  const already = state[entry.id]?.level ?? 0;
  if (already >= 50) return;

  const found = await RoutingService.getConnectionById(entry.connectionId);
  if (!found) return;
  const connection = found.connection;
  if (!connection.legs.some(isTrainLeg)) return;

  const window = tripWindow(connection, entry.tripDate, now);
  if (!window) return;

  const firstVehicle = connection.legs.find((leg) => leg.mode !== 'walk') ?? connection.legs[0];
  const scheduledDepartureMs = window.boardingMs - (firstVehicle?.delaySec ?? 0) * 1000;
  if (
    !isCompensationCandidate({
      addedAt: entry.addedAt,
      scheduledDepartureMs,
      boardingDepartureMs: window.boardingMs,
      arrivalMs: window.arrivalMs,
      delayAtAttachSec: entry.delayAtAttachSec,
      now,
    })
  ) {
    return;
  }

  const updates = await fetchNationalRailUpdates(connection.legs);
  if (updates.size === 0) return;
  if (cancelledTrainLeg(connection, updates)) return;

  const measured = measuredCompensationDelay(connection, updates, now);
  if (!measured) return;
  const level = compensationLevelForDelay(measured.delaySec);
  if (!level || level <= already) return;

  // Indeks może być starszy niż plik, więc potwierdzamy bilet przed alertem.
  const ticket = await getTicketForConnection(entry.connectionId, connection);
  if (!ticket) return;

  const sent = await sendCompensationNotification(connection, ticket, level);
  if (!sent) return;

  state[ticket.id] = {
    level,
    notifiedAt: now,
    connectionId: connection.id,
  };
  await saveState(state);
}

function tripWindow(
  connection: Connection,
  tripDate: string | undefined,
  now: number,
): { boardingMs: number; arrivalMs: number } | null {
  if (!finalTrainLeg(connection)) return null;
  const serviceDate = connection.serviceDate ?? tripDate;
  const boardingSec = boardingDepartureSec(connection);
  const durationMs = Math.max(1, connection.durationMin) * 60_000;
  const boardingMs =
    serviceDate != null
      ? sharedTimeMs(serviceDate, boardingSec)
      : boardingDepartureMs(connection, new Date(now));
  const plannedArrivalSec = connection.arrivalSec ?? boardingSec + durationMs / 1000;
  let arrivalMs =
    serviceDate != null ? sharedTimeMs(serviceDate, plannedArrivalSec) : boardingMs + durationMs;
  if (arrivalMs <= boardingMs) arrivalMs = boardingMs + durationMs;
  return { boardingMs, arrivalMs };
}

async function sendCompensationNotification(
  connection: Connection,
  ticket: AttachedRailTicket,
  level: CompensationLevel,
): Promise<boolean> {
  const N = getNotifications();
  if (!N) return false;
  const copy = tr().notification;
  const lastTrain = finalTrainLeg(connection);
  const train =
    ticket.metadata.trainNumber ||
    lastTrain?.trainNumber ||
    lastTrain?.railLine ||
    lastTrain?.line ||
    '';
  const identifier = `kilometr.alert.compensation.${ticket.id}.${level}`;
  try {
    await N.scheduleNotificationAsync({
      identifier,
      content: {
        title: copy.compensationTitle,
        body: copy.compensationBody(train, compensationThresholdMinutes(level), level),
        data: compensationNotificationData(connection, ticket.id, level),
        sound: 'default',
        categoryIdentifier: ALERT_CATEGORY,
        ...(Platform.OS === 'ios' ? { interruptionLevel: 'timeSensitive' as const } : {}),
        ...(Platform.OS === 'android' ? { priority: 'high' as const } : {}),
      },
      trigger: Platform.OS === 'android' ? { channelId: ALERTS_CHANNEL_ID } : null,
    });
    return true;
  } catch (err) {
    console.warn('[Rekompensata] powiadomienie nie wyszło:', err);
    return false;
  }
}

function compensationNotificationData(
  connection: Connection,
  ticketId: string,
  level: CompensationLevel,
): Record<string, unknown> {
  const legs = connection.legs;
  const first = legs.find((leg) => leg.mode !== 'walk') ?? legs[0];
  const last = [...legs].reverse().find((leg) => leg.mode !== 'walk') ?? first;
  const coord = (value?: number) => (value == null ? '' : String(value));
  return {
    kind: 'trip',
    at: Date.now(),
    alert: 'compensation',
    ticketId,
    compensationLevel: level,
    fromTitle: connection.fromTitle,
    fromLat: coord(first?.fromLat),
    fromLon: coord(first?.fromLon),
    toId: last?.toStopId ?? '',
    toTitle: connection.toTitle,
    toLat: coord(last?.toLat),
    toLon: coord(last?.toLon),
    open: connection.id,
  };
}

async function loadState(now: number): Promise<CompensationState> {
  try {
    const raw = await kvGet(STATE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object') return {};
    const state: CompensationState = {};
    for (const [id, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (!value || typeof value !== 'object') continue;
      const entry = value as Partial<NotifiedCompensation>;
      if (entry.level !== 25 && entry.level !== 50) continue;
      if (typeof entry.notifiedAt !== 'number' || now - entry.notifiedAt > STATE_MAX_AGE_MS)
        continue;
      state[id] = {
        level: entry.level,
        notifiedAt: entry.notifiedAt,
        connectionId: typeof entry.connectionId === 'string' ? entry.connectionId : '',
      };
    }
    return state;
  } catch {
    return {};
  }
}

async function saveState(state: CompensationState): Promise<void> {
  await kvSet(STATE_KEY, JSON.stringify(state));
}
