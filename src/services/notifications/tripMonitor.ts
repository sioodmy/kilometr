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
import { resolveTrackedConnection } from './planMatch';
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

  // Całą politykę doboru kursu trzyma `resolveTrackedConnection` — jest czysta
  // i da się ją przetestować bez planera (patrz scripts/check-notifications.ts).
  return resolveTrackedConnection(conns, tracked.connection, nowSecOfDay(), BOARDING_GRACE_SEC);
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
          // Oddajemy śledzenie dopiero wtedy, gdy minęło pół godziny od
          // ODJAZDU (nie od rozpoczęcia śledzenia): przypięty na dwie
          // godziny kurs nie może zniknąć tylko dlatego, że planer chwilowo
          // zwrócił pustkę.
          const deadline = (progress?.departAtMs ?? before.startedAt) + 30 * 60 * 1000;
          if (Date.now() > deadline) {
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

    // Użytkownik wyłączył wszystkie powiadomienia — nie ma po co dalej
    // planować, tym bardziej że samo śledzenie kosztuje odpytania planera.
    if (!prefs.trackingEnabled && !prefs.departureAlertsEnabled && !prefs.disruptionAlertsEnabled) {
      await stopTracking();
      return;
    }

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
      // „Jesteś na miejscu" to komunikat, a nie stan — bez alertów go nie ma.
      if (arrivedAt === 0) {
        arrivedAt = Date.now();
        if (prefs.departureAlertsEnabled) await sendArrivedNotification(p, trip);
      }
      // Komunikat zostaje chwilę na ekranie blokady, potem sprzątamy.
      if (Date.now() - arrivedAt > ARRIVED_LINGER_MS) {
        await stopTracking();
        return;
      }
    }

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

/**
 * Rytm odświeżania zależy od tego, jak daleko jesteśmy od odjazdu. Licznik
 * i pasek postępu i tak liczy system, więc JS nie musi tykać co sekundę —
 * wystarczy, że podajemy mu aktualny plan. Im bliżej odjazdu, tym częściej,
 * bo wtedy zmienia się to, co użytkownik realnie potrzebuje.
 */
const TICK_FAR_MS = 5 * 60_000;
const TICK_APPROACH_MS = 20_000;
const TICK_RIDING_MS = 30_000;
const TICK_IDLE_MS = 60_000;
/** Poniżej tej granicy odjazdu warto dopytywać planer częściej. */
const CLOSE_DEPARTURE_SEC = 45 * 60;

function tickIntervalMs(p: TripProgress | null): number {
  if (!p) return TICK_IDLE_MS;
  if (p.phase === 'riding' || p.phase === 'transfer') return TICK_RIDING_MS;
  if (p.departInSec > CLOSE_DEPARTURE_SEC) return TICK_FAR_MS;
  if (p.phase === 'walking' || p.phase === 'waiting') return TICK_APPROACH_MS;
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
