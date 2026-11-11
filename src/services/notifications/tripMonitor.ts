import { AppState, Platform } from 'react-native';
import { kvGet, kvRemove, kvSet } from '../storage';
import { inCityBounds } from '../../cities';
import { getActiveCitySync } from '../cityStore';
import { RoutingService, rememberPlannedConnection } from '../api';
import { getSettingsSync, profileWalkSpeedMps } from '../settings';
import { liveTracker } from '../liveTracker';
import { acquireCurrentLocation, getCurrentLocationSnapshot } from '../currentLocation';
import {
  OnboardEstimator,
  onboardStops,
  publishOnboardEstimate,
  type OnboardEstimate,
  type OnboardFix,
} from '../onboardGps';
import type { Connection, Leg, LegStop, VehiclePosition } from '../../types/models';
import {
  buildRoutesLink,
  departureTs,
  legBadge,
  mergeWidgetSnapshot,
  type WidgetPinned,
} from '../widgetSnapshot';
import { clockFromMs, nearestDepartureMs, toAbsoluteMs } from './format';
import { findUserSegment, nowSecOfDay } from '../vehiclePosition';
import { ensureTrainTrack, trainTrackKey, type TrainTrack } from '../trainTrack';
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
import {
  areNotificationsSupported,
  getTrackingNative,
  usesNativeTransferProtection,
  warnUnsupportedOnce,
} from './module';
import type { NotificationPreferences, TripProgress, TrackedTrip } from './types';
import type { TransferProtectionState } from './transferTypes';
import { hasTransfer } from './transferTypes';
import { applyLiveDelays } from '../routing/engine';
import { anchorConnectionToPlan } from '../routing/connectionTimes';
import { sharedTimeMs } from '../../sharing/progress';
import type { ForegroundTransferProtection } from './transferForeground';
import { decodeSharedConnection } from '../../sharing/connection';
import { sharedLiveConnection, sharedVehicle } from '../../sharing/native';

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
/** Zapis stanu i widgetu najwyżej raz na 30 s, i tylko gdy plan się zmienił. */
const WRITE_THROTTLE_MS = 30_000;

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
let foregroundProtection: ForegroundTransferProtection | null = null;
let lastPersistAt = 0;
let lastPersistSig = '';
let lastWidgetAt = 0;
let lastWidgetSig = '';

/**
 * Start i stop z UI przechodzą jeden po drugim. Dzięki temu nowy start czeka
 * na pełne sprzątanie po poprzednim stopie i nie walczy z jego spóźnionymi
 * awaitami. Wewnętrzne stop-y z refresh() omijają kolejkę (stopTrackingNow),
 * bo start sam je wywołuje.
 */
let transition: Promise<unknown> = Promise.resolve();

function enqueueTransition<T>(work: () => Promise<T>): Promise<T> {
  const next = transition.then(work, work);
  transition = next.then(
    () => undefined,
    () => undefined,
  );
  return next;
}

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

// ─── Pojazd ─────────────────────────────────────────────────────────────────

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

// ─── GPS pasażera ───────────────────────────────────────────────────────────

const onboard = new OnboardEstimator();
/** Miejscowe na pomiarach z natywnego serwisu (Android, także w tle). */
let nativeFix: OnboardFix | null = null;
let nativeFixSub: (() => void) | null = null;
/** Watch expo-location dla platform bez natywnych eventów (iOS, Expo Go). */
let locationWatchRelease: (() => void) | null = null;

function subscribeOnboardFixes(): void {
  nativeFix = null;
  const native = getTrackingNative();
  if (native?.subscribeTripLocation) {
    nativeFixSub =
      native.subscribeTripLocation((fix) => {
        nativeFix = fix;
      }) ?? null;
  }
  // Bez natywnych eventów (iOS, Expo Go) watch expo-location to jedyne
  // źródło pomiarów; na Androidzie wystarczą eventy z serwisu.
  if (!nativeFixSub) locationWatchRelease = acquireCurrentLocation(false);
}

function releaseOnboardFixes(): void {
  nativeFixSub?.();
  nativeFixSub = null;
  nativeFix = null;
  locationWatchRelease?.();
  locationWatchRelease = null;
  onboard.reset();
  onboardTrack = null;
  onboardTrackKey = null;
  publishOnboardEstimate(null);
}

/** Najświeższy pomiar: natywny event albo watch expo-location. */
function latestOnboardFix(): OnboardFix | null {
  const watched = getCurrentLocationSnapshot().location;
  const fix = watched
    ? { lat: watched.lat, lon: watched.lon, accuracy: watched.accuracy, speed: watched.speed, heading: watched.heading, timestamp: watched.timestamp }
    : null;
  if (nativeFix && fix) return nativeFix.timestamp >= fix.timestamp ? nativeFix : fix;
  return nativeFix ?? fix;
}

// Oś toru bieżącej nogi: dociągana raz na nogę, między stacjami z niej
// interpolujemy opóźnienie (onboardGps) zamiast zamrażać je na ostatniej stacji.
let onboardTrack: TrainTrack | null = null;
let onboardTrackKey: string | null = null;

function onboardTrackFor(leg: Leg, stops: LegStop[]): TrainTrack | null {
  const window = findUserSegment(stops, leg);
  const key = trainTrackKey(leg, stops, window);
  if (key === onboardTrackKey) return onboardTrack;
  onboardTrackKey = key;
  onboardTrack = null;
  if (key != null) {
    void ensureTrainTrack(leg, stops, window).then(
      (track) => {
        if (onboardTrackKey === key) onboardTrack = track;
      },
      () => {},
    );
  }
  return null;
}

/**
 * Estymacja z GPS na bieżącej nodze kolejowej. Zwraca null poza jazdą
 * (dojście pieszo, oczekiwanie, przesiadka) albo przy nieświeższym pomiarze.
 */
function observeOnboard(p: TripProgress): OnboardEstimate | null {
  if (p.phase !== 'riding' || !p.leg || p.leg.mode !== 'train') return null;
  const fix = latestOnboardFix();
  if (!fix) return null;
  const stops = onboardStops(p.leg);
  return onboard.observe(p.leg, stops, fix, Date.now(), onboardTrackFor(p.leg, stops));
}

/** Pojazd syntetyczny z GPS telefonu: pasażer wygrywa z feedem, bo jedzie tym pociągiem. */
function onboardVehicle(estimate: OnboardEstimate | null, leg: TripProgress['leg']): VehiclePosition | null {
  if (!estimate || !leg || estimate.legId !== leg.id || !leg.tripId) return null;
  if (Date.now() - estimate.fix.timestamp > 60_000) return null;
  return {
    vehicleId: 'onboard',
    line: leg.line ?? '',
    lat: estimate.fix.lat,
    lon: estimate.fix.lon,
    delaySec: estimate.delaySec,
    matchedTripId: leg.tripId,
    updatedAt: estimate.fix.timestamp,
  };
}

// ─── Odświeżenie ─────────────────────────────────────────────────────────────

/**
 * Absolutny odjazd planu: data serwisowa przy udostępnionej podróży, inaczej
 * wystąpienie wskazane przez `departInMin`. Sam `departureSec` nie rozróżnia
 * kursu 24:xx od kursu z jutra, bo oba mają tę samą wartość.
 */
function departureMsOf(connection: Connection, at: Date): number {
  if (connection.serviceDate)
    return sharedTimeMs(connection.serviceDate, connection.departureSec);
  const aligned = toAbsoluteMs(connection.departureSec, at);
  const nearest = nearestDepartureMs(connection.departureSec, at);
  const hinted = at.getTime() + Math.max(0, connection.departInMin ?? 0) * 60_000;
  return Math.abs(nearest - hinted) <= Math.abs(aligned - hinted) ? nearest : aligned;
}

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
    departureTimeSec: tracked.connection.departureSec,
    maxTransfers: s.maxTransfers,
    minTransferSec: s.minTransferSec,
    trainsEnabled: s.trainsEnabled,
    cableEnabled: s.cableEnabled,
    allowedTransferModes: s.allowedModes,
    trainMinTransferSec: s.trainMinTransferSec,
    maxWalkM: s.maxWalkM,
    walkSpeedMps,
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

    // Kurs 24:xx po północy należy jeszcze do wczorajszej doby serwisowej.
    // Bez przesunięcia o całe doby odjazd wypadał jutro i śledzenie gasło.
    if (before.plannedDepartureMs != null) {
      const anchored = anchorConnectionToPlan(before.connection, before.plannedDepartureMs);
      if (anchored !== before.connection) tracked = { ...before, connection: anchored };
    }

    // Użytkownik wcisnął „Zakończ" pod powiadomieniem, a aplikacja dalej
    // żyje w tle. Bez tego sprawdzenia następny tick wskrzesiłby powiadomienie
    // i serwis, które właśnie zniknęły.
    const stopped = await consumeNativeStop();
    if (run !== generation) return;
    if (stopped) {
      await stopTrackingNow();
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
      await stopTrackingNow();
      return;
    }

    const prefs: NotificationPreferences = getNotificationPreferencesSync();

    const current = tracked ?? before;
    const tripDelays =
      liveTracker.getLiveState() === 'fresh' ? liveTracker.getTripDelays() : new Map();
    if (current.sharedJourney) {
      const journey = decodeSharedConnection(current.sharedJourney);
      if (!journey) {
        await stopTrackingNow();
        return;
      }
      tracked = {
        ...current,
        connection: sharedLiveConnection(current.connection, journey, tripDelays),
      };
    } else {
      // Zawsze na bieżąco nanosimy aktualne opóźnienia i live-status na śledzone połączenie:
      const updated = applyLiveDelays([current.connection], tripDelays)[0] ?? current.connection;
      tracked = { ...current, connection: updated };

      const hasTransfers = current.connection.legs.filter((l) => l.mode !== 'walk').length > 1;
      // Re-planowanie przez RAPTOR-a ma sens tylko przed odjazdem i tylko dla połączeń
      // z przesiadkami (kursy bezpośrednie to jeden stały przejazd, opóźnienia załatwia applyLiveDelays):
      if (!planLocked && hasTransfers) {
        try {
          const fresh = await planTracked();
          if (run !== generation) return;
          if (fresh) {
            tracked = { ...current, connection: fresh };
          }
        } catch {
          // offline - zostaje ostatni plan
        }
      }
    }

    if (run !== generation) return;
    let trip = tracked;
    if (!trip) return;

    // Użytkownik wyłączył wszystkie powiadomienia - nie ma po co dalej
    // planować, tym bardziej że samo śledzenie kosztuje odpytania planera.
    if (
      (!prefs.trackingEnabled && !prefs.disruptionAlertsEnabled) ||
      ((trip.protectionEnabled || trip.sharedJourney) && !prefs.trackingEnabled)
    ) {
      await stopTrackingNow();
      return;
    }

    let conn = trip.connection;

    const walkSpeedMps = profileWalkSpeedMps(getSettingsSync().walkPace);
    let base = computeTripProgress(conn, { walkSpeedMps });

    // GPS pasażera: feed PKP potrafi pokazać pociąg na stacji początkowej
    // długie minuty po odjeździe, a telefon zawsze wie, gdzie jesteśmy.
    // Opóźnienie z przejazdu stacji wchodzi do planu jak opóźnienie z feedu.
    const onboardEstimate = observeOnboard(base);
    publishOnboardEstimate(onboardEstimate);
    if (onboardEstimate?.delaySec != null && base.leg?.tripId) {
      const withGps = new Map(tripDelays);
      withGps.set(base.leg.tripId, Math.round(onboardEstimate.delaySec));
      const updated = applyLiveDelays([conn], withGps)[0] ?? conn;
      if (updated !== conn) {
        conn = updated;
        tracked = { ...trip, connection: updated };
        trip = tracked;
        base = computeTripProgress(updated, { walkSpeedMps });
      }
    }

    const gpsVehicle = onboardVehicle(onboardEstimate, base.leg);
    const vehicle = trip.sharedJourney
      ? sharedVehicle(conn, liveTracker.snapshot())?.vehicle
      : (gpsVehicle ?? vehicleForTrip(base));
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
    // Zanik danych live zeruje opóźnienie, ale to nie poprawa: bez tego to samo
    // opóźnienie po powrocie danych alarmowało drugi raz.
    const measured = conn.legs.some(
      (l) => l.mode !== 'walk' && (l.live || l.delayConfidence === 'estimated'),
    );
    if (measured || p.delayMin > lastDelayMin) lastDelayMin = p.delayMin;

    await presentTrip(trip, p, prefs);
    // Jak wyżej: stop w trakcie publikacji nie może pozwolić na dalsze alerty.
    if (run !== generation) {
      if (!tracked) await dismissTracking();
      return;
    }
    const stoppedDuringPublish = await consumeNativeStop();
    if (run !== generation) return;
    if (stoppedDuringPublish) {
      await stopTrackingNow();
      return;
    }
    const arrivalAt = Math.max(p.arriveAtMs, trip.transfer?.arrivalAtMs ?? p.arriveAtMs);
    if (
      p.phase === 'arrived' &&
      Date.now() >= arrivalAt &&
      (!trip.protectionEnabled || trip.transfer?.status === 'complete')
    ) {
      // Komunikat o dotarciu pojawia się dopiero po uwzględnieniu opóźnienia z telefonu.
      if (arrivedAt === 0) {
        arrivedAt = arrivalAt;
        if (prefs.trackingEnabled && Platform.OS !== 'ios') await sendArrivedNotification(p, trip);
      }
      // Komunikat zostaje chwilę na ekranie blokady, potem sprzątamy.
      if (Date.now() - arrivedAt >= ARRIVED_LINGER_MS) {
        await stopTrackingNow();
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

// ─── Cykl życia ─────────────────────────────────────────────────────────────

/** Uruchamia śledzenie podróży: Live Update, alerty odjazdu, widgety. */
export function startTracking(trip: TrackedTrip): Promise<void> {
  return enqueueTransition(() => startTrackingNow(trip));
}

async function startTrackingNow(trip: TrackedTrip): Promise<void> {
  if (!areNotificationsSupported()) {
    warnUnsupportedOnce('Śledzenie podróży');
  }
  await loadNotificationPreferences();
  await stopTrackingNow();
  refreshing = null;
  await consumeNativeStop();
  generation++;
  const run = generation;
  const protectionEnabled =
    !trip.sharedJourney && trip.protectionEnabled === true && hasTransfer(trip.connection);
  const startedAt = Date.now();
  const startedDate = new Date(startedAt);
  const plannedDepartureMs = departureMsOf(trip.connection, startedDate);
  const connection = anchorConnectionToPlan(trip.connection, plannedDepartureMs, startedDate);
  const walkSpeedMps = profileWalkSpeedMps(getSettingsSync().walkPace);
  const initial = computeTripProgress(connection, { now: startedDate, walkSpeedMps });
  tracked = {
    ...trip,
    connection,
    protectionEnabled,
    startedAt,
    plannedDepartureMs,
    plannedArrivalMs: initial.arriveAtMs,
  };
  arrivedAt = 0;
  planLocked = !!trip.sharedJourney || protectionEnabled || trip.transfer?.status === 'changed';
  lastDelayMin = trip.connection.delayMin;
  progress = initial;
  notify();
  rescheduleTicker();
  await persist(true);
  // Live Tracker musi odpytywać także w tle, bo powiadomienia o przesunięciach
  // (Live Update) potrzebują świeżych pozycji pojazdów.
  liveTracker.pin(true);
  // GPS pasażera w trasie (opóźnienie z przejazdu stacji) - patrz observeOnboard.
  subscribeOnboardFixes();
  if (run !== generation || !tracked || !progress) return;
  await presentTrip(tracked, progress, getNotificationPreferencesSync());
  if (run !== generation) {
    if (!tracked) await dismissTracking();
    return;
  }
  await refresh();
  void pushWidgetPinned(tracked);
  if (protectionEnabled) void configureTransferProtection(run);
}

async function configureTransferProtection(run: number): Promise<void> {
  const trip = tracked;
  if (!trip?.protectionEnabled) return;
  if (!usesNativeTransferProtection()) {
    await syncTransferProtection();
    notify();
    return;
  }
  tracked = {
    ...trip,
    transfer: {
      tripId: trip.id,
      status: 'preparing',
      updatedAt: Date.now(),
      revision: 0,
      scope: 'background',
    },
  };
  notify();
  let path: string | undefined;
  try {
    const { prepareTransferSnapshot, removeTransferSnapshot } = await import('./transferSnapshot');
    path = await prepareTransferSnapshot(trip);
    if (run !== generation || !tracked) {
      removeTransferSnapshot(path);
      return;
    }
    const native = getTrackingNative();
    if (!(await native?.configureTransferProtection?.(trip.id, path)))
      throw new Error('Transfer protection unavailable');
    if (run !== generation || !tracked) {
      removeTransferSnapshot(path);
      return;
    }
    tracked = { ...tracked, transferContextPath: path };
    await persist(true);
    if (progress) await presentTrip(tracked, progress, getNotificationPreferencesSync());
  } catch (error) {
    console.warn('[TransferProtection] setup:', error);
    if (path) {
      const { removeTransferSnapshot } = await import('./transferSnapshot');
      removeTransferSnapshot(path);
    }
    if (run === generation && tracked) {
      tracked = {
        ...tracked,
        transfer: {
          tripId: trip.id,
          status: 'unavailable',
          updatedAt: Date.now(),
          revision: 0,
          reason: 'routing',
        },
      };
      notify();
    }
  }
}

async function syncTransferProtection(): Promise<void> {
  const trip = tracked;
  if (!trip?.protectionEnabled) return;
  const run = generation;
  try {
    if (Date.now() - trip.startedAt > 8 * 60 * 60_000) {
      await stopTrackingNow();
      return;
    }
    if (!usesNativeTransferProtection()) {
      if (AppState.currentState !== 'active') return;
      if (!foregroundProtection) {
        const { ForegroundTransferProtection } = await import('./transferForeground');
        if (run !== generation) return;
        foregroundProtection = new ForegroundTransferProtection(trip);
      }
      const transfer = await foregroundProtection.refresh();
      if (run === generation && tracked) tracked = { ...tracked, transfer };
      return;
    }
    const raw = await getTrackingNative()?.getTransferProtectionState?.();
    if (!raw || tracked?.id !== trip.id || tracked.startedAt !== trip.startedAt) return;
    const state = JSON.parse(raw) as TransferProtectionState;
    if (
      state.tripId !== trip.id ||
      !Number.isFinite(state.updatedAt) ||
      !Number.isFinite(state.revision)
    )
      return;
    if (Date.now() - trip.startedAt > 8 * 60 * 60_000 || state.reason === 'expired') {
      await stopTrackingNow();
      return;
    }
    const { connection: _connection, ...transfer } = state;
    tracked = { ...tracked, transfer, transferRevision: state.revision };
    planLocked = true;
  } catch (error) {
    console.warn('[TransferProtection] state:', error);
    if (run === generation && tracked)
      tracked = {
        ...tracked,
        transfer: {
          tripId: trip.id,
          status: 'unavailable',
          updatedAt: Date.now(),
          revision: trip.transferRevision ?? 0,
          reason: 'routing',
          scope: usesNativeTransferProtection() ? 'background' : 'foreground',
        },
      };
  }
}

/** Podmienia plan wyłącznie po potwierdzeniu aktualnej propozycji. */
export async function acceptTransferAlternative(alternativeId: string): Promise<boolean> {
  await refresh();
  const trip = tracked;
  const alternative = trip?.transfer?.alternative;
  if (
    !trip ||
    !alternative ||
    alternative.id !== alternativeId ||
    alternative.validUntil <= Date.now() ||
    Date.now() - (trip.transfer?.updatedAt ?? 0) > 30_000
  )
    return false;
  const connection = alternative.connection;
  rememberPlannedConnection(connection);
  await startTracking({
    ...trip,
    connection,
    fromTitle: connection.fromTitle,
    fromLat: connection.legs[0]?.fromLat ?? trip.fromLat,
    fromLon: connection.legs[0]?.fromLon ?? trip.fromLon,
    transferContextPath: undefined,
    transfer: {
      tripId: trip.id,
      status: 'changed',
      updatedAt: Date.now(),
      revision: 0,
      activeLegIndex: alternative.activeLegIndex,
      nextLine: alternative.nextLine,
      transferStop: alternative.transferStop,
    },
    transferRevision: 0,
  });
  return tracked?.connection === connection || tracked?.connection.id === connection.id;
}

/**
 * Kończy śledzenie: serwis, alerty, widgety i zapisany stan.
 *
 * Sprzątanie sprawdza generation: spóźniony stop nie może zdjąć powiadomienia
 * ani widgetu podróży, którą w międzyczasie uruchomił startTracking.
 */
export function stopTracking(): Promise<void> {
  return enqueueTransition(() => stopTrackingNow());
}

async function stopTrackingNow(): Promise<void> {
  const contextPath = tracked?.transferContextPath;
  const run = ++generation;
  foregroundProtection = null;
  tracked = null;
  progress = null;
  arrivedAt = 0;
  planLocked = false;
  lastDelayMin = 0;
  lastPersistAt = 0;
  lastPersistSig = '';
  lastWidgetAt = 0;
  lastWidgetSig = '';
  if (ticker) {
    clearInterval(ticker);
    ticker = null;
  }
  liveTracker.pin(false);
  releaseOnboardFixes();
  notify();
  // Zapis KV kasujemy od razu, przed długim sprzątaniem: restart w jego
  // trakcie nie może wskrzesić podróży, którą użytkownik zakończył. Nowy
  // start zapisze swoją podróż dopiero po tym usunięciu.
  const removal = kvRemove(STORAGE_KEY);
  if (contextPath) {
    const { removeTransferSnapshot } = await import('./transferSnapshot');
    try {
      removeTransferSnapshot(contextPath);
    } catch {
      /* The service has already stopped. */
    }
  }
  await cancelScheduledAlerts();
  if (run !== generation || tracked) return;
  await dismissTracking();
  if (run !== generation || tracked) return;
  await removal;
  if (run !== generation || tracked) return;
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
    const startedDate = new Date(parsed.startedAt);
    const plannedDepartureMs =
      parsed.plannedDepartureMs ?? departureMsOf(parsed.connection, startedDate);
    const connection = anchorConnectionToPlan(parsed.connection, plannedDepartureMs);
    const savedProgress = computeTripProgress(connection, {
      now: startedDate,
    });
    if (!parsed.protectionEnabled && Date.now() >= savedProgress.arriveAtMs + ARRIVED_LINGER_MS) {
      await stopTrackingNow();
      return null;
    }
    // Kurs z innego miasta: jego przystanki i opóźnienia istnieją tylko w tamtej
    // bazie, więc po przełączeniu miasta nie da się go odświeżyć. Instalacje
    // sprzed tej poprawki mogły zostawić taki pin, więc go odrzucamy.
    if (!inCityBounds(getActiveCitySync(), parsed.fromLat, parsed.fromLon)) {
      await kvRemove(STORAGE_KEY);
      return null;
    }
    tracked = {
      ...parsed,
      connection,
      plannedDepartureMs,
      plannedArrivalMs: parsed.plannedArrivalMs ?? savedProgress.arriveAtMs,
      protectionEnabled:
        !parsed.sharedJourney &&
        parsed.protectionEnabled === true &&
        hasTransfer(parsed.connection),
    };
    planLocked =
      !!tracked.sharedJourney ||
      tracked.protectionEnabled === true ||
      tracked.transfer?.status === 'changed';
    generation++;
    // Jak w startTracking: bez pinu opóźnienia gasną po zablokowaniu ekranu,
    // a bez ostatniego opóźnienia ten sam alert o spóźnieniu dzwoni drugi raz.
    lastDelayMin = parsed.connection.delayMin;
    liveTracker.pin(true);
    subscribeOnboardFixes();
    await loadNotificationPreferences();
    progress = computeTripProgress(connection, {
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

/** To, co realnie warto zapisać: plan, opóźnienia i status przesiadki. */
function tripSignature(trip: TrackedTrip): string {
  const c = trip.connection;
  const legs = c.legs
    .map((l) =>
      [l.id, l.departAt, l.arriveAt, l.delaySec ?? '', l.live ? 1 : 0, l.liveNextStop ?? ''].join(
        ':',
      ),
    )
    .join(',');
  const t = trip.transfer;
  return [
    c.id,
    c.departureSec,
    c.arrivalSec,
    c.durationMin,
    c.transfers,
    c.delayMin,
    c.live ? 1 : 0,
    legs,
    trip.protectionEnabled ? 1 : 0,
    t?.status ?? '',
    t?.activeLegIndex ?? '',
    t?.nextLine ?? '',
    t?.alternative?.id ?? '',
  ].join('|');
}

async function persist(force = false): Promise<void> {
  if (!tracked) return;
  const sig = tripSignature(tracked);
  const now = Date.now();
  if (!force && (sig === lastPersistSig || now - lastPersistAt < WRITE_THROTTLE_MS)) return;
  lastPersistAt = now;
  try {
    await kvSet(STORAGE_KEY, JSON.stringify(tracked));
    lastPersistSig = sig;
  } catch {
    // persist opcjonalny - bez niego śledzenie nie przeżywa restartu
  }
}

/** Sekcja przypięcia w snapshocie widgetów - godziny dokłada odświeżenie. */
function pushWidgetPinned(trip: TrackedTrip | null): Promise<void> {
  if (!trip) return mergeWidgetSnapshot({ pinned: null });
  if (trip.sharedJourney) return Promise.resolve();
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
      open: conn.id,
    }),
  };
  const sig = JSON.stringify(section);
  const now = Date.now();
  if (sig === lastWidgetSig || now - lastWidgetAt < WRITE_THROTTLE_MS) return Promise.resolve();
  lastWidgetSig = sig;
  lastWidgetAt = now;
  return mergeWidgetSnapshot({ pinned: section });
}
