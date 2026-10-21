import { AppState, Platform } from 'react-native';
import { kvGet, kvRemove, kvSet } from '../storage';
import { inCityBounds } from '../../cities';
import { getActiveCitySync } from '../cityStore';
import { RoutingService, rememberPlannedConnection } from '../api';
import { getSettingsSync, profileWalkSpeedMps } from '../settings';
import { liveTracker } from '../liveTracker';
import type { Connection, VehiclePosition } from '../../types/models';
import {
  buildRoutesLink,
  departureTs,
  legBadge,
  mergeWidgetSnapshot,
  type WidgetPinned,
} from '../widgetSnapshot';
import { clockFromMs } from './format';
import { nowSecOfDay } from '../vehiclePosition';
import {
  getNotificationPreferencesSync,
  loadNotificationPreferences,
  subscribeNotificationPreferences,
} from './preferences';
import { computeTripProgress } from './tripProgress';
import { resolveTrackedConnection } from './planMatch';
import { ARRIVED_LINGER_MS, presentTrip, dismissTracking } from './presenter';
import {
  cancelScheduledAlerts,
  sendArrivedNotification,
  sendDisruptionAlert,
  shouldAlertDelay,
} from './alerts';
import { areNotificationsSupported, getTrackingNative, warnUnsupportedOnce } from './module';
import type { NotificationPreferences, TripProgress, TrackedTrip } from './types';
import type { TransferProtectionState } from './transferTypes';

// Orkiestrator śledzenia podróży. Trzyma jedną aktywną podróż, cyklicznie
// przelicza plan (żeby łapać opóźnienia i zmiany kursu), z tego wycieka
// TripProgress i aktualizuje plan powiadomienia.
//
// Od planu liczb (godziny, odcinki) pilnuje `LiveTripService`, więc ten
// ticker nie musi tykać co sekundę - wystarczy dowieźć zmiany z planera i
// przeliczenia pozycji pojazdu. Rytm jest adaptive: przed odjazdem i w trakcie
// jazdy częściej, po przyjeździe rzadko. Zawsze dodatkowo odświeżamy przy
// powrocie aplikacji na pierwszy plan.

const STORAGE_KEY = 'kilometr.trackedTrip.v2';
/** Ile po odjeździe kurs wciąż uznajemy za „swoje” połączenie. */
const BOARDING_GRACE_SEC = 240;

let tracked: TrackedTrip | null = null;
let progress: TripProgress | null = null;
let lastDelayMin = 0;
let arrivedAt = 0;
/**
 * Po odjeździe przestajemy przeliczać plan. Śledzony jest już konkretny kurs-
 * kolejne zapytania do RAPTOR-a tylko marnowałyby baterię, a po północy
 * potrafiłyby podmienić plan na jutrzejszy.
 */
let planLocked = false;
let ticker: ReturnType<typeof setInterval> | null = null;
let refreshing: Promise<void> | null = null;
let generation = 0;

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

// ─── Pojazd ────────────────────────────────────────────────────────────────

/**
 * Pojazd dopasowany do odcinka, na którym właśnie jesteśmy.
 *
 * Bez dopasowania po `tripId` zwracamy null zamiast pierwszego pojazdu z
 * linii. `rows[0]` to dowolny autobus tej linii, więc przy trzech pojazdach na
 * przystanku użytkownik dostawał w powiadomieniu cudzy pojazd i opóźnienie
 * z nieznanego kursu. Brak informacji jest tu uczciwszy niż zła.
 */
function vehicleForTrip(p: TripProgress): VehiclePosition | null {
  if (!p.leg || p.leg.mode === 'walk') return null;
  const tripId = p.leg.tripId;
  if (!tripId) return null;
  const line = (p.leg.line || '').trim().toUpperCase();
  const rows = liveTracker.snapshot(line || undefined);
  if (rows.length === 0) return null;
  return rows.find((v) => v.matchedTripId === tripId) ?? null;
}

// ─── Odświeżenie ───────────────────────────────────────────────────────────

async function planTracked(): Promise<Connection | null> {
  if (!tracked) return null;
  const s = getSettingsSync();
  const walkSpeedMps = profileWalkSpeedMps(s.walkPace);
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
    trainsEnabled: s.trainsEnabled,
    cableEnabled: s.cableEnabled,
    allowedTransferModes: s.allowedModes,
    trainMinTransferSec: s.trainMinTransferSec,
    maxWalkM: s.maxWalkM,
    walkSpeedMps,
    routeStyle: s.routeStyle,
  });
  if (conns.length === 0 || !tracked) return null;

  // Całą politykę doboru kursu trzyma `resolveTrackedConnection` - jest czysta
  // i da się ją przetestować bez planera (patrz scripts/check-notifications.ts).
  return resolveTrackedConnection(conns, tracked.connection, nowSecOfDay(), BOARDING_GRACE_SEC);
}

async function refresh(): Promise<void> {
  if (!tracked) return;
  if (refreshing) return refreshing;

  const work = (async () => {
    const run = generation;
    const before = tracked;
    if (!before) return;

    // Użytkownik wcisnął „Zakończ" pod powiadomieniem, a aplikacja dalej
    // żyje w tle. Bez tego sprawdzenia następny tick wskrzesiłby powiadomienie
    // i serwis, które właśnie zniknęły.
    const stopped = await consumeNativeStop();
    if (run !== generation) return;
    if (stopped) {
      await stopTracking();
      return;
    }

    if (before.protectionEnabled) {
      await syncTransferProtection();
      if (run !== generation) return;
    }

    const savedProgress = computeTripProgress(tracked?.connection ?? before.connection, {
      now: new Date(before.startedAt),
    });
    if (!before.protectionEnabled && Date.now() >= savedProgress.arriveAtMs + ARRIVED_LINGER_MS) {
      await stopTracking();
      return;
    }

    const prefs: NotificationPreferences = getNotificationPreferencesSync();

    // Planujemy tylko do momentu odjazdu (patrz `planLocked`).
    if (!planLocked) {
      try {
        const fresh = await planTracked();
        if (run !== generation) return;
        if (!fresh) {
          // Brak połączeń (albo awaria sieci) - zostaje ostatni znany plan.
          // Oddajemy śledzenie dopiero wtedy, gdy minęło pół godziny od
          // ODJAZDU (nie od rozpoczęcia śledzenia): przypięty na dwie
          // godziny kurs nie może zniknąć tylko dlatego, że planer chwilowo
          // zwrócił pustkę.
          const deadline = (progress?.departAtMs ?? before.startedAt) + 30 * 60 * 1000;
          if (Date.now() > deadline) {
            await stopTracking();
          }
        } else {
          tracked = { ...before, connection: fresh };
        }
      } catch {
        // offline - zostaje ostatni plan
      }
    }

    if (run !== generation) return;
    const trip = tracked;
    if (!trip) return;

    // Użytkownik wyłączył wszystkie powiadomienia - nie ma po co dalej
    // planować, tym bardziej że samo śledzenie kosztuje odpytania planera.
    if ((!prefs.trackingEnabled && !prefs.disruptionAlertsEnabled) || trip.protectionEnabled && !prefs.trackingEnabled) {
      await stopTracking();
      return;
    }

    const conn = trip.connection;

    const walkSpeedMps = profileWalkSpeedMps(getSettingsSync().walkPace);
    const base = computeTripProgress(conn, { walkSpeedMps });
    const vehicle = vehicleForTrip(base);
    // Drugi przelot z pojazdem: GPS potrafi wskazać przystanek dokładniej
    // niż interpolacja po czasie, a wynik różni się w tym, ile zostało.
    const p = vehicle ? computeTripProgress(conn, { vehicle, walkSpeedMps }) : base;
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
    // Jak wyżej: stop w trakcie publikacji nie może pozwolić na dalsze alerty.
    if (run !== generation) {
      if (!tracked) await dismissTracking();
      return;
    }
    const stoppedDuringPublish = await consumeNativeStop();
    if (run !== generation) return;
    if (stoppedDuringPublish) {
      await stopTracking();
      return;
    }
    const arrivalAt = Math.max(p.arriveAtMs, trip.transfer?.arrivalAtMs ?? p.arriveAtMs);
    if (p.phase === 'arrived' && Date.now() >= arrivalAt && (!trip.protectionEnabled || trip.transfer?.status === 'complete')) {
      // Komunikat o dotarciu pojawia się dopiero po uwzględnieniu opóźnienia z telefonu.
      if (arrivedAt === 0) {
        arrivedAt = arrivalAt;
        if (prefs.trackingEnabled && Platform.OS !== 'ios') await sendArrivedNotification(p, trip);
      }
      // Komunikat zostaje chwilę na ekranie blokady, potem sprzątamy.
      if (Date.now() - arrivedAt >= ARRIVED_LINGER_MS) {
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
    if (refreshing === work) refreshing = null;
  });

  refreshing = work;
  return work;
}

/**
 * Rytm odświeżania zależy od tego, jak daleko jesteśmy od odjazdu. Licznik
 * i pasek postępu liczy serwis Androida z zegara, więc JS nie musi tykać co
 * sekundę - wystarczy, że dowieziemy mu plan. Im bliżej odjazdu, tym
 * częściej, bo wtedy zmienia się to, czego użytkownik realnie potrzebuje:
 * pozycja pojazdu, liczba przystanków, opóźnienie.
 */
const TICK_FAR_MS = 5 * 60_000;
const TICK_APPROACH_MS = 20_000;
const TICK_RIDING_MS = 30_000;
const TICK_IDLE_MS = 60_000;
/** Poniżej tej granicy odjazdu warto dopytywać planer częściej. */
const CLOSE_DEPARTURE_SEC = 45 * 60;

function tickIntervalMs(p: TripProgress | null): number {
  if (tracked?.protectionEnabled && AppState.currentState === 'active') return 5000;
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

/** Uruchamia śledzenie podróży: Live Update, alerty odjazdu, widgety. */
export async function startTracking(trip: TrackedTrip): Promise<void> {
  if (!areNotificationsSupported()) {
    warnUnsupportedOnce('Śledzenie podróży');
  }
  await loadNotificationPreferences();
  await stopTracking();
  refreshing = null;
  await consumeNativeStop();
  generation++;
  const run = generation;
  tracked = { ...trip, startedAt: Date.now() };
  arrivedAt = 0;
  planLocked = trip.protectionEnabled === true;
  lastDelayMin = trip.connection.delayMin;
  progress = computeTripProgress(trip.connection, {
    walkSpeedMps: profileWalkSpeedMps(getSettingsSync().walkPace),
  });
  notify();
  rescheduleTicker();
  await persist();
  // Live Tracker musi odpytywać także w tle, bo powiadomienia o przesunięciach
  // (Live Update) potrzebują świeżych pozycji pojazdów.
  liveTracker.pin(true);
  if (run !== generation || !tracked || !progress) return;
  await presentTrip(tracked, progress, getNotificationPreferencesSync());
  if (run !== generation) {
    if (!tracked) await dismissTracking();
    return;
  }
  await refresh();
  void pushWidgetPinned(tracked);
  if (trip.protectionEnabled) void configureTransferProtection(run);
}

async function configureTransferProtection(run: number): Promise<void> {
  const trip = tracked;
  if (!trip?.protectionEnabled) return;
  tracked = { ...trip, transfer: { tripId: trip.id, status: 'preparing', updatedAt: Date.now(), revision: 0 } };
  notify();
  let path: string | undefined;
  try {
    const { prepareTransferSnapshot, removeTransferSnapshot } = await import('./transferSnapshot');
    path = await prepareTransferSnapshot(trip);
    if (run !== generation || !tracked) { removeTransferSnapshot(path); return; }
    const native = getTrackingNative();
    if (!await native?.configureTransferProtection?.(trip.id, path)) throw new Error('Transfer protection unavailable');
    if (run !== generation || !tracked) { removeTransferSnapshot(path); return; }
    tracked = { ...tracked, transferContextPath: path };
    await persist();
    if (progress) await presentTrip(tracked, progress, getNotificationPreferencesSync());
  } catch (error) {
    console.warn('[TransferProtection] setup:', error);
    if (path) {
      const { removeTransferSnapshot } = await import('./transferSnapshot');
      removeTransferSnapshot(path);
    }
    if (run === generation && tracked) {
      tracked = { ...tracked, transfer: { tripId: trip.id, status: 'unavailable', updatedAt: Date.now(), revision: 0, reason: 'routing' } };
      notify();
    }
  }
}

async function syncTransferProtection(): Promise<void> {
  const trip = tracked;
  if (!trip?.protectionEnabled) return;
  try {
    const raw = await getTrackingNative()?.getTransferProtectionState?.();
    if (!raw || tracked?.id !== trip.id || tracked.startedAt !== trip.startedAt) return;
    const state = JSON.parse(raw) as TransferProtectionState;
    if (state.tripId !== trip.id || !Number.isFinite(state.updatedAt) || !Number.isFinite(state.revision)) return;
    if (Date.now() - trip.startedAt > 8 * 60 * 60_000 || state.reason === 'expired') {
      await stopTracking();
      return;
    }
    const connection = state.revision > (trip.transferRevision ?? 0) && state.connection?.id === trip.connection.id &&
      Array.isArray(state.connection.legs) ? state.connection : trip.connection;
    const { connection: _connection, ...transfer } = state;
    tracked = { ...tracked, connection, transfer, transferRevision: state.revision };
    if (connection !== trip.connection) rememberPlannedConnection(connection);
    planLocked = true;
  } catch (error) {
    console.warn('[TransferProtection] state:', error);
  }
}

/**
 * Kończy śledzenie: serwis, alerty, widgety i zapisany stan.
 */
export async function stopTracking(): Promise<void> {
  const contextPath = tracked?.transferContextPath;
  generation++;
  tracked = null;
  progress = null;
  arrivedAt = 0;
  planLocked = false;
  lastDelayMin = 0;
  if (ticker) {
    clearInterval(ticker);
    ticker = null;
  }
  liveTracker.pin(false);
  notify();
  await cancelScheduledAlerts();
  await dismissTracking();
  if (contextPath) {
    const { removeTransferSnapshot } = await import('./transferSnapshot');
    try { removeTransferSnapshot(contextPath); } catch { /* The service has already stopped. */ }
  }
  await kvRemove(STORAGE_KEY);
  await mergeWidgetSnapshot({ pinned: null });
  notify();
}

/** Wznawia śledzenie po restarcie aplikacji (telefon zrestartowany, ubity proces). */
export async function restoreTrackedTrip(): Promise<TrackedTrip | null> {
  if (tracked) return { ...tracked };
  // Użytkownik mógł w międzyczasie wcisnąć „Zakończ" pod powiadomieniem-
  // obsłużył to natywny odbiorca, więc myśląc o wznowieniu tylko byśmy
  // odpalili śledzenie, które on właśnie zakończył.
  if (await consumeNativeStop()) {
    await kvRemove(STORAGE_KEY);
    await cancelScheduledAlerts();
    await dismissTracking();
    await mergeWidgetSnapshot({ pinned: null });
    return null;
  }
  try {
    const raw = await kvGet(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as TrackedTrip;
    if (!parsed?.connection) return null;
    const savedProgress = computeTripProgress(parsed.connection, {
      now: new Date(parsed.startedAt),
    });
    if (!parsed.protectionEnabled && Date.now() >= savedProgress.arriveAtMs + ARRIVED_LINGER_MS) {
      await stopTracking();
      return null;
    }
    // Kurs z innego miasta: jego przystanki i opóźnienia istnieją tylko w tamtej
    // bazie, więc po przełączeniu miasta nie da się go odświeżyć. Instalacje
    // sprzed tej poprawki mogły zostawić taki pin, więc go odrzucamy.
    if (!inCityBounds(getActiveCitySync(), parsed.fromLat, parsed.fromLon)) {
      await kvRemove(STORAGE_KEY);
      return null;
    }
    tracked = parsed;
    planLocked = parsed.protectionEnabled === true;
    generation++;
    await loadNotificationPreferences();
    progress = computeTripProgress(parsed.connection, {
      walkSpeedMps: profileWalkSpeedMps(getSettingsSync().walkPace),
    });
    notify();
    rescheduleTicker();
    await refresh();
    return tracked ? { ...tracked } : null;
  } catch {
    return null;
  }
}

/** @public Wywoływane przez createRequire w check-notification-runtime.ts. */
export function refreshTrackedTrip(): Promise<void> {
  return refresh();
}

/**
 * Przycisk „Zakończ" pod powiadomieniem obsługuje `TripActionReceiver`
 * natywnie - powiadomienie znika natychmiast, bez otwierania aplikacji. Do
 * JS informacja wraca flagą w SharedPreferences, bo intencja do odbiorcy nie
 * trafia do procesu aplikacji. Sprawdzamy ją przy każdym wyjściu na plan.
 */
async function consumeNativeStop(): Promise<boolean> {
  const native = getTrackingNative();
  if (!native) return false;
  try {
    return await native.consumeStopRequest();
  } catch {
    return false;
  }
}

/** Idempotentny ticker globalny: odświeża przy powrocie na pierwszy plan. */
let trackedTripListenerAttached = false;
export function startTrackedTripListener(): void {
  if (trackedTripListenerAttached) return;
  trackedTripListenerAttached = true;
  subscribeNotificationPreferences(() => {
    if (!tracked) return;
    void (async () => {
      await refreshing;
      await refresh();
    })();
  });
  AppState.addEventListener('change', (state) => {
    if (state !== 'active' || !tracked) return;
    void (async () => {
      if (await consumeNativeStop()) {
        await stopTracking();
        return;
      }
      await refresh();
    })();
  });
}

async function persist(): Promise<void> {
  if (!tracked) return;
  try {
    await kvSet(STORAGE_KEY, JSON.stringify(tracked));
  } catch {
    // persist opcjonalny - bez niego śledzenie nie przeżywa restartu
  }
}

/** Sekcja przypięcia w snapshocie widgetów - godziny dokłada odświeżenie. */
function pushWidgetPinned(trip: TrackedTrip | null): Promise<void> {
  if (!trip) return mergeWidgetSnapshot({ pinned: null });
  const conn = trip.connection;
  // Postęp ma już godziny z opóźnieniem live; bez niego liczymy z rozkładu.
  const departTs = progress?.departAtMs || departureTs(conn);
  const arriveTs = progress?.arriveAtMs || departTs + conn.durationMin * 60_000;
  const section: WidgetPinned = {
    fromTitle: trip.fromTitle,
    toTitle: trip.toTitle,
    departTs,
    arriveTs,
    departAt: clockFromMs(departTs) || conn.departAt,
    arriveAt: clockFromMs(arriveTs) || conn.arriveAt,
    delayMin: conn.delayMin,
    live: conn.live,
    legs: conn.legs.map(legBadge),
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
