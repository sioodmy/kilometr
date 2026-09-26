import { AppState } from 'react-native';
import { kvGet, kvRemove, kvSet } from '../storage';
import { RoutingService } from '../api';
import { getSettingsSync } from '../settings';
import { liveTracker } from '../liveTracker';
import type { Connection, RouteQuery, VehiclePosition } from '../../types/models';
import { buildRoutesLink, mergeWidgetSnapshot, type WidgetPinned } from '../widgetSnapshot';
import { nowSecOfDay } from '../vehiclePosition';
import { getNotificationPreferencesSync, loadNotificationPreferences } from './preferences';
import { computeTripProgress } from './tripProgress';
import {
  connectionInProgress,
  matchTrackedConnection,
  nextDeparture,
} from './planMatch';
import { presentTrip, dismissTracking } from './presenter';
import {
  cancelScheduledAlerts,
  scheduleDepartureAlerts,
  sendArrivedNotification,
  sendDisruptionAlert,
  shouldAlertDelay,
} from './alerts';
import { isLiveActivitySupported, adoptOrphanActivity } from './liveActivity/controller';
import { areNotificationsSupported, warnUnsupportedOnce } from './module';
import type { NotificationPreferences, TripProgress, TrackedTrip } from './types';

// Orkiestrator śledzenia podróży. Trzyma jedną aktywną podróż, cyklicznie
// przelicza plan (żeby łapać opóźnienia i zmiany kursu), z tego wycieka
// TripProgress i aktualizuje powiadomienie / Live Activity.
//
// Rytm jest adaptive: przed odjazdem i w trakcie jazdy odświeżamy częściej
// (tu liczy się każda minuta), po przyjeździe rzadko. Zawsze dodatkowo
// odświeżamy przy powrocie aplikacji na pierwszy plan.

const STORAGE_KEY = 'kilometr.trackedTrip.v2';
/** Jak długo po przyjeździe zostawiamy powiadomienie „jesteś na miejscu”. */
const ARRIVED_LINGER_MS = 3 * 60 * 1000;
const TICK_FAST_MS = 20_000;
const TICK_RIDING_MS = 30_000;
const TICK_IDLE_MS = 60_000;
/** Ile po odjeździe kurs wciąż uznajemy za „swoje” połączenie. */
const BOARDING_GRACE_SEC = 240;

let tracked: TrackedTrip | null = null;
let progress: TripProgress | null = null;
let lastDelayMin = 0;
let arrivedAt = 0;
/**
 * Po odjeździe przestajemy przeliczać plan. Śledzony jest już konkretny kurs —
 * kolejne zapytania do RAPTOR-a tylko marnowałyby baterię, a po północy
 * potrafiłyby podmienić plan na jutrzejszy.
 */
let planLocked = false;
let ticker: ReturnType<typeof setInterval> | null = null;
let refreshing: Promise<void> | null = null;

type Listener = (trip: TrackedTrip | null, p: TripProgress | null) => void;
const listeners = new Set<Listener>();

function notify() {
  for (const l of listeners) l(tracked ? { ...tracked } : null, progress ? { ...progress } : null);
}

export function subscribeTracked(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getTrackedTripSync(): TrackedTrip | null {
  return tracked ? { ...tracked } : null;
}

export function getTripProgressSync(): TripProgress | null {
  return progress ? { ...progress } : null;
}

/**
 * Czy dwa zapytania trasy opisują tę samą podróż. Używane przez ekran
 * połączeń do rozpoznania, czy śledzimy właśnie tę trasę (a nie inną),
 * oraz po przywróceniu stanu. Epsilon 0.0005° ≈ 55 m — mniejszy niż
 * rozrzut współrzędnych z wyszukiwarki, więc nie łapie sąsiednich przystanków.
 */
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

// ─── Pojazd ────────────────────────────────────────────────────────────────

/** Pojazd dopasowany do odcinka, na którym właśnie jesteśmy. */
function vehicleForTrip(p: TripProgress): VehiclePosition | null {
  if (!p.leg || p.leg.mode === 'walk') return null;
  const tripId = p.leg.tripId;
  const line = (p.leg.line || '').trim().toUpperCase();
  const rows = liveTracker.snapshot(line || undefined);
  if (rows.length === 0) return null;
  if (tripId) {
    const byTrip = rows.find((v) => v.matchedTripId === tripId);
    if (byTrip) return byTrip;
  }
  return rows[0] ?? null;
}

// ─── Odświeżenie ───────────────────────────────────────────────────────────

async function planTracked(): Promise<Connection | null> {
  if (!tracked) return null;
  const s = getSettingsSync();
  const conns = await RoutingService.getConnections({
    fromTitle: tracked.fromTitle,
    fromLat: tracked.fromLat,
    fromLon: tracked.fromLon,
    toId: tracked.toId,
    toTitle: tracked.toTitle,
    toLat: tracked.toLat,
    toLon: tracked.toLon,
    anchorStopId: tracked.anchorStopId,
    anchorStopLat: tracked.anchorStopLat,
    anchorStopLon: tracked.anchorStopLon,
    maxTransfers: s.maxTransfers,
    minTransferSec: s.minTransferSec,
    maxWalkM: s.maxWalkM,
    walkSpeedMps: s.walkSpeedMps,
  });
  if (conns.length === 0) return null;

  const nowSec = nowSecOfDay();
  // Dopóki nie odjechaliśmy, trzymamy się „naszego” odjazdu. Po odjeździe
  // szukamy kursu, którym właśnie jedziemy, a dopiero potem następnego.
  const match = matchTrackedConnection(conns, tracked.connection);
  if (match) return match;
  if (tracked.connection.departureSec > nowSec - BOARDING_GRACE_SEC) {
    return nextDeparture(conns, nowSec, BOARDING_GRACE_SEC);
  }
  return connectionInProgress(conns, nowSec) ?? nextDeparture(conns, nowSec, BOARDING_GRACE_SEC);
}

async function refresh(): Promise<void> {
  if (!tracked) return;
  if (refreshing) return refreshing;

  refreshing = (async () => {
    const before = tracked;
    if (!before) return;
    const prefs: NotificationPreferences = getNotificationPreferencesSync();

    // Planujemy tylko do momentu odjazdu (patrz `planLocked`).
    if (!planLocked) {
      try {
        const fresh = await planTracked();
        if (!fresh) {
          // Brak połączeń (albo awaria sieci) — zostaje ostatni znany plan.
          // Po pół godziny bez planu uznajemy, że śledzenie nie ma sensu.
          if (Date.now() - before.startedAt > 30 * 60 * 1000) {
            await stopTracking();
          }
          return;
        }
        tracked = { ...before, connection: fresh };
      } catch {
        // offline — zostaje ostatni plan
      }
    }

    const trip = tracked;
    if (!trip) return;
    const conn = trip.connection;

    const base = computeTripProgress(conn, {});
    const vehicle = vehicleForTrip(base);
    // Drugi przelot z pojazdem: GPS potrafi wskazać przystanek dokładniej
    // niż interpolacja po czasie, a wynik różni się w tym, ile zostało.
    const p = vehicle ? computeTripProgress(conn, { vehicle }) : base;
    progress = p;
    if (!planLocked && p.phase !== 'walking' && p.phase !== 'waiting') {
      planLocked = true;
    }

    // Opóźnienie urosło od poprzedniego ticka → obudź użytkownika.
    if (prefs.disruptionAlertsEnabled && shouldAlertDelay(lastDelayMin, p.delayMin)) {
      void sendDisruptionAlert(p, trip, prefs);
    }
    lastDelayMin = p.delayMin;

    await presentTrip(trip, p, prefs);
    await scheduleDepartureAlerts(p, trip, prefs);

    if (p.phase === 'arrived') {
      if (arrivedAt === 0) {
        arrivedAt = Date.now();
        await sendArrivedNotification(p, trip);
      }
      // Komunikat „jesteś na miejscu” zostaje chwilę na ekranie blokady.
      if (Date.now() - arrivedAt > ARRIVED_LINGER_MS) {
        await stopTracking();
        return;
      }    }

    // Faza zmienia się w trakcie podróży, a rytm odświeżania zależy od niej.
    rescheduleTicker();
    await persist();
    void pushWidgetPinned(trip);
    notify();
  })().finally(() => {
    refreshing = null;
  });

  return refreshing;
}

function tickIntervalMs(p: TripProgress | null): number {
  if (!p) return TICK_IDLE_MS;
  if (p.phase === 'riding' || p.phase === 'transfer') return TICK_RIDING_MS;
  if (p.phase === 'walking' || p.phase === 'waiting') return TICK_FAST_MS;
  return TICK_IDLE_MS;
}

function rescheduleTicker(): void {
  if (ticker) clearInterval(ticker);
  ticker = null;
  if (!tracked) return;
  ticker = setInterval(() => {
    void refresh();
  }, tickIntervalMs(progress));
}

// ─── Cykl życia ────────────────────────────────────────────────────────────

/** Uruchamia śledzenie podróży: powiadomienie, Live Activity, alerty odjazdu. */
export async function startTracking(trip: TrackedTrip): Promise<void> {
  if (!areNotificationsSupported()) {
    warnUnsupportedOnce('Śledzenie podróży');
  }
  await loadNotificationPreferences();
  tracked = { ...trip, startedAt: Date.now() };
  arrivedAt = 0;
  planLocked = false;
  lastDelayMin = trip.connection.delayMin;
  progress = computeTripProgress(trip.connection, {});
  notify();
  rescheduleTicker();
  await refresh();
  void pushWidgetPinned(tracked);
}

/**
 * Kończy śledzenie. `lingerSec` zostawia Live Activity / powiadomienie na
 * ekranie blokady jeszcze przez chwilę — używane po przyjeździe, żeby
 * „jesteś na miejscu" zdążyło się przeczytać.
 */
export async function stopTracking(lingerSec = 0): Promise<void> {
  if (!tracked) return;
  tracked = null;
  progress = null;
  arrivedAt = 0;
  planLocked = false;
  lastDelayMin = 0;
  if (ticker) {
    clearInterval(ticker);
    ticker = null;
  }
  await cancelScheduledAlerts();
  await dismissTracking(lingerSec);
  await kvRemove(STORAGE_KEY);
  await mergeWidgetSnapshot({ pinned: null });
  notify();
}

/** Wznawia śledzenie po restarcie aplikacji (telefon zrestartowany, ubity proces). */
export async function restoreTrackedTrip(): Promise<TrackedTrip | null> {
  if (tracked) return { ...tracked };
  try {
    const raw = await kvGet(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as TrackedTrip;
    if (!parsed?.connection) return null;
    tracked = parsed;
    // Live Activity przeżywa proces aplikacji — podepnij się do istniejącej,
    // inaczej po restarcie świecilibyśmy własnym stanem w martwą aktywność.
    if (isLiveActivitySupported()) adoptOrphanActivity();
    progress = computeTripProgress(parsed.connection, {});
    notify();
    rescheduleTicker();
    await refresh();
    return { ...tracked };
  } catch {
    return null;
  }
}

/** Wymuszone odświeżenie (np. po powrocie na ekran). */
export function refreshTrackedTrip(): Promise<void> {
  return refresh();
}

/** Idempotentny ticker globalny: odświeża przy powrocie na pierwszy plan. */
export function startTrackedTripListener(): void {
  AppState.addEventListener('change', (state) => {
    if (state === 'active' && tracked) void refresh();
  });
}

async function persist(): Promise<void> {
  if (!tracked) return;
  try {
    await kvSet(STORAGE_KEY, JSON.stringify(tracked));
  } catch {
    // persist opcjonalny — bez niego śledzenie nie przeżywa restartu
  }
}

/** Sekcja przypięcia w snapshocie widgetów — godziny dokłada odświeżenie. */
function pushWidgetPinned(trip: TrackedTrip | null): Promise<void> {
  if (!trip) return mergeWidgetSnapshot({ pinned: null });
  const section: WidgetPinned = {
    fromTitle: trip.fromTitle,
    toTitle: trip.toTitle,
    departAt: trip.connection.departAt,
    arriveAt: trip.connection.arriveAt,
    durationMin: trip.connection.durationMin,
    delayMin: trip.connection.delayMin,
    live: trip.connection.live,
    deepLink: buildRoutesLink({
      fromTitle: trip.fromTitle,
      fromLat: trip.fromLat,
      fromLon: trip.fromLon,
      toId: trip.toId,
      toTitle: trip.toTitle,
      toLat: trip.toLat,
      toLon: trip.toLon,
    }),
  };
  return mergeWidgetSnapshot({ pinned: section });
}
