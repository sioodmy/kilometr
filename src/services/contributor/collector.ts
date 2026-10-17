// Zbieranie GPS + akcelerometru. Dwie drogi w jednym starcie:
//
//  native (Android + zgoda na tło) - ContributorService pisze JSONL do pliku,
//    ingest do bazy idzie po powrocie do aplikacji,
//  js (fallback) - expo-location + expo-sensors w foreground, próbki wprost
//    do SQLite. Uruchamiany ręcznie z karty albo automatycznie przy
//    śledzeniu podróży (autoFollow).

import * as Location from 'expo-location';
import { Accelerometer } from 'expo-sensors';
import {
  appendSample,
  appendSessionContext,
  closeNativeSession,
  closeSession,
  createSession,
  createSessionFromNative,
  insertNativeSamples,
  type SampleRow,
  type SessionMeta,
} from './store';
import {
  getContributorDeviceId,
  getContributorSettingsSync,
  isContributorAvailable,
} from './config';
import { getActiveCitySync } from '../cityStore';
import { getTrackedTripSync, subscribeTracked } from '../notifications/tripMonitor';
import type { TrackedTrip, TripProgress } from '../notifications/types';
import type { Connection, Leg } from '../../types/models';
import {
  deleteNativeFile,
  hasNativeCollector,
  listNativeFiles,
  readNativeFile,
  startNativeCollector,
  stopNativeCollector,
} from './native';

// Magnituda akcelerometru w oknie 1 s zamyka się w min/max/avg/std, żeby
// próbka była mała, a klasa trybu (tram/bus/spacer) została czytelna.
const FLUSH_MS = 1000;
const ACCEL_INTERVAL_MS = 50;
/** Skok magnitude, poniżej którego stojące urządzenie nie produkuje wiersza. */
const MOVE_THRESHOLD_MPS2 = 1.2;

export type CollectorState = 'idle' | 'js' | 'native';

/** Teksty powiadomienia natywnego - karta ustawia je z aktualnego słownika. */
export interface NativeNotificationCopy {
  title: string;
  text: string;
  channelName?: string;
  channelDescription?: string;
}

let state: CollectorState = 'idle';
let activeSessionId: string | null = null;
let watchSub: Location.LocationSubscription | null = null;
let accelSub: { remove(): void } | null = null;
let flushTimer: ReturnType<typeof setInterval> | null = null;

let latestFix: Location.LocationObject | null = null;
let bucketX: number[] = [];
let bucketY: number[] = [];
let bucketZ: number[] = [];
let writtenLastMag = 0;
let sessionMeta: SessionMeta | null = null;
let sessionSrc: 'manual' | 'trip' | null = null;
let nativeCopy: NativeNotificationCopy = {
  title: 'Kilometr Contributor',
  text: 'Zbieram telemetrię',
};

const stateListeners = new Set<() => void>();

export function getCollectorState(): CollectorState {
  return state;
}

export function getActiveSessionId(): string | null {
  return activeSessionId;
}

export function getActiveSessionSource(): 'manual' | 'trip' | null {
  return sessionSrc;
}

export function subscribeCollectorState(fn: () => void): () => void {
  stateListeners.add(fn);
  return () => {
    stateListeners.delete(fn);
  };
}

function setState(next: CollectorState, sessionId: string | null): void {
  state = next;
  activeSessionId = sessionId;
  for (const l of stateListeners) l();
}

/** Tekst powiadomienia natywnego ustala UI (tam jest dostępny słownik). */
export function setNativeNotificationCopy(copy: NativeNotificationCopy): void {
  nativeCopy = copy;
}

/** Zgoda na tło potrzebna tylko drodze natywnej. */
export async function hasBackgroundLocationPermission(): Promise<boolean> {
  const fg = await Location.getForegroundPermissionsAsync();
  if (!fg.granted) return false;
  const bg = await Location.getBackgroundPermissionsAsync();
  return bg.granted;
}

export async function requestBackgroundLocationPermission(): Promise<boolean> {
  const fg = await Location.getForegroundPermissionsAsync();
  if (!fg.granted) {
    const asked = await Location.requestForegroundPermissionsAsync();
    if (!asked.granted) return false;
  }
  const bg = await Location.getBackgroundPermissionsAsync();
  if (bg.granted) return true;
  const askedBg = await Location.requestBackgroundPermissionsAsync();
  return askedBg.granted;
}

async function canUseNative(): Promise<boolean> {
  if (!hasNativeCollector()) return false;
  const fg = await Location.getForegroundPermissionsAsync();
  if (!fg.granted) return false;
  const bg = await Location.getBackgroundPermissionsAsync();
  return bg.granted;
}

/**
 * Start manualny albo ze śledzenia. Droga natywna jest preferowana, bo
 * przeżywa zamknięcie aplikacji; porażka staru FGS spada na foreground.
 */
export async function startCollection(
  meta: Omit<SessionMeta, 'source'>,
  source: 'manual' | 'trip',
): Promise<boolean> {
  if (!isContributorAvailable()) return false;
  if (state !== 'idle') return true;

  sessionMeta = { ...meta, source };
  sessionSrc = source;

  if (await canUseNative()) {
    const deviceId = await getContributorDeviceId();
    const started = await startNativeCollector(sessionMeta, deviceId, nativeCopy);
    if (started) {
      setState('native', null);
      return true;
    }
  }

  return startJsCollection();
}

async function startJsCollection(): Promise<boolean> {
  const fg = await Location.getForegroundPermissionsAsync();
  if (!fg.granted) return false;
  const meta = sessionMeta;
  if (!meta) return false;

  const deviceId = await getContributorDeviceId();
  const created = await createSession(deviceId, meta);
  const sessionId = created.id;

  latestFix = null;
  bucketX = [];
  bucketY = [];
  bucketZ = [];
  writtenLastMag = 0;

  try {
    watchSub = await Location.watchPositionAsync(
      { accuracy: Location.Accuracy.Balanced, timeInterval: FLUSH_MS, distanceInterval: 1 },
      (fix) => {
        latestFix = fix;
      },
    );
  } catch (err) {
    console.warn('[Contributor] watch failed:', err);
    await closeSession(sessionId);
    setState('idle', null);
    return false;
  }

  try {
    Accelerometer.setUpdateInterval(ACCEL_INTERVAL_MS);
    accelSub = Accelerometer.addListener(({ x, y, z }) => {
      bucketX.push(x * 9.80665);
      bucketY.push(y * 9.80665);
      bucketZ.push(z * 9.80665);
    });
  } catch (err) {
    console.warn('[Contributor] accel unavailable:', err);
  }

  flushTimer = setInterval(() => {
    void flushSecond(sessionId);
  }, FLUSH_MS);
  setState('js', sessionId);
  return true;
}

/** Sformatowana magnituda i ostatni fix zamienione w jeden wiersz bazy. */
async function flushSecond(sessionId: string): Promise<void> {
  if (bucketX.length === 0) return;
  const magnitudes = bucketX.map((_, i) => Math.hypot(bucketX[i], bucketY[i], bucketZ[i]));
  const mag = statsOf(magnitudes);
  const deltaMove = Math.abs(mag.avg - writtenLastMag);
  const fix = latestFix;
  if (!fix && deltaMove < MOVE_THRESHOLD_MPS2) {
    bucketX = [];
    bucketY = [];
    bucketZ = [];
    return;
  }
  writtenLastMag = mag.avg;
  const row: SampleRow = {
    tms: Date.now(),
    lat: fix?.coords.latitude ?? null,
    lng: fix?.coords.longitude ?? null,
    alt: fix?.coords.altitude ?? null,
    hacc: fix?.coords.accuracy ?? null,
    spd: fix?.coords.speed != null && fix.coords.speed >= 0 ? fix.coords.speed : null,
    brg: fix?.coords.heading != null && fix.coords.heading >= 0 ? fix.coords.heading : null,
    aMin: mag.min,
    aMax: mag.max,
    aAvg: mag.avg,
    aStd: mag.std,
    xAvg: avgOf(bucketX),
    yAvg: avgOf(bucketY),
    zAvg: avgOf(bucketZ),
    moved: deltaMove > MOVE_THRESHOLD_MPS2 || (fix?.coords.speed ?? 0) > 0.3,
  };
  bucketX = [];
  bucketY = [];
  bucketZ = [];
  try {
    await appendSample(sessionId, row);
  } catch {
    // pełny dysk nie może zabić pętli; kolejne sekundy próbują dalej
  }
}

function statsOf(values: number[]): { min: number; max: number; avg: number; std: number } {
  if (values.length === 0) return { min: 0, max: 0, avg: 0, std: 0 };
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  let sum = 0;
  for (const v of values) {
    if (v < min) min = v;
    if (v > max) max = v;
    sum += v;
  }
  const avg = sum / values.length;
  let sqSum = 0;
  for (const v of values) sqSum += (v - avg) * (v - avg);
  return { min, max, avg, std: Math.sqrt(sqSum / values.length) };
}

function avgOf(values: number[]): number {
  if (values.length === 0) return 0;
  let sum = 0;
  for (const v of values) sum += v;
  return sum / values.length;
}

async function stopJsCollection(): Promise<void> {
  watchSub?.remove();
  watchSub = null;
  accelSub?.remove();
  accelSub = null;
  if (flushTimer) {
    clearInterval(flushTimer);
    flushTimer = null;
  }
  const sessionId = activeSessionId;
  if (sessionId) await closeSession(sessionId);
  activeSessionId = null;
  sessionMeta = null;
  sessionSrc = null;
}

/** Zatrzymanie zbierania w obu drogach. */
export async function stopCollection(): Promise<void> {
  if (state === 'native') {
    await stopNativeCollector();
    setState('idle', null);
    sessionMeta = null;
    sessionSrc = null;
    return;
  }
  if (state === 'js') {
    await stopJsCollection();
    setState('idle', null);
  }
}

// ─── Ingest z plików natywnych ─────────────────────────────────────────────

interface NativeSampleLine {
  t?: number;
  lat?: number | null;
  lng?: number | null;
  alt?: number | null;
  hacc?: number | null;
  spd?: number | null;
  brg?: number | null;
  a?: [number, number, number, number];
  xyz?: [number, number, number];
  moved?: boolean;
}

interface NativeHeader {
  kind?: string;
  id?: string;
  deviceId?: string;
  startedAt?: number;
  endedAt?: number | null;
  source?: string;
  city?: string;
  line?: string;
  routeId?: string;
  tripId?: string;
  headsign?: string;
  fromTitle?: string;
  toTitle?: string;
  delayMin?: number | null;
  context?: Record<string, unknown>;
}

/** Ingest jednego pliku: nagłówek to manifest, reszta linii to próbki. */
async function ingestFile(dbRecorded: (id: string) => void, name: string): Promise<boolean> {
  const raw = await readNativeFile(name);
  if (!raw) return false;
  const lines = raw.split('\n').filter((l) => l.trim().length > 0);
  if (lines.length < 2) {
    await deleteNativeFile(name);
    return false;
  }
  let header: NativeHeader | null = null;
  try {
    header = JSON.parse(lines[0]) as NativeHeader;
  } catch {
    await deleteNativeFile(name);
    return false;
  }
  if (!header?.id) {
    await deleteNativeFile(name);
    return false;
  }
  const created = await createSessionFromNative(
    header.deviceId ?? 'unknown',
    header.id,
    header.startedAt ?? Date.now(),
    {
      source: 'native',
      city: header.city ?? '',
      line: header.line ?? '',
      routeId: header.routeId ?? '',
      tripId: header.tripId ?? '',
      headsign: header.headsign ?? '',
      fromTitle: header.fromTitle ?? '',
      toTitle: header.toTitle ?? '',
      delayMin: header.delayMin ?? undefined,
    },
  );
  const samples: SampleRow[] = [];
  for (const line of lines.slice(1)) {
    let parsed: NativeSampleLine | null = null;
    try {
      parsed = JSON.parse(line) as NativeSampleLine;
    } catch {
      continue;
    }
    const t = parsed.t ?? 0;
    if (t <= 0) continue;
    samples.push({
      tms: t,
      lat: parsed.lat ?? null,
      lng: parsed.lng ?? null,
      alt: parsed.alt ?? null,
      hacc: parsed.hacc ?? null,
      spd: parsed.spd ?? null,
      brg: parsed.brg ?? null,
      aMin: parsed.a?.[0] ?? 0,
      aMax: parsed.a?.[1] ?? 0,
      aAvg: parsed.a?.[2] ?? 0,
      aStd: parsed.a?.[3] ?? 0,
      xAvg: parsed.xyz?.[0] ?? 0,
      yAvg: parsed.xyz?.[1] ?? 0,
      zAvg: parsed.xyz?.[2] ?? 0,
      moved: parsed.moved === true,
    });
  }
  await insertNativeSamples(created.id, samples, header.context ?? {});
  // dokończenie sesji: startedAt/endedAt z nagłówka, delay z ostatniej znanej
  await finalizeNativeSession(created.id, header);
  dbRecorded(created.id);
  await deleteNativeFile(name);
  return true;
}

async function finalizeNativeSession(sessionId: string, header: NativeHeader): Promise<void> {
  await closeNativeSession(sessionId, header.endedAt ?? Date.now());
}

/** Przenosi wszystkie pliki natywne do bazy. Zwraca liczbę przeniesionych sesji. */
export async function ingestNativeSessions(): Promise<number> {
  const files = await listNativeFiles();
  let ingested = 0;
  for (const name of files) {
    try {
      if (await ingestFile(() => {}, name)) ingested += 1;
    } catch (err) {
      console.warn('[Contributor] ingest failed for', name, err);
    }
  }
  return ingested;
}

// ─── Auto-follow przy śledzeniu podróży ────────────────────────────────────

let autoFollowAttached = false;
/** Ostatnie opóźnienie dopisane do sesji, żeby nie pisać do bazy co tick. */
let lastContextDelay: number | null = null;

/** Pierwszy odcinek pojazdem opisuje kurs, który testujemy. */
function firstTransitLeg(connection: Connection): Leg | null {
  return connection.legs.find((l) => l.mode !== 'walk') ?? null;
}

/** Meta sesji z przypiętej podróży - bez niej plik jest bezwartościowy. */
export function metaFromTracked(trip: TrackedTrip): SessionMeta {
  const leg = firstTransitLeg(trip.connection);
  return {
    city: getActiveCitySync().id,
    line: leg?.line ?? '',
    routeId: leg?.routeId ?? '',
    tripId: leg?.tripId ?? '',
    headsign: leg?.direction ?? '',
    fromTitle: trip.fromTitle,
    toTitle: trip.toTitle,
    delayMin: trip.connection.delayMin,
    source: 'trip',
  };
}

/**
 * Wpina auto-follow: sesja rusza razem ze śledzeniem podróży i kończy się
 * z nim. Ręczną sesję użytkownika to nie rusza.
 */
export function initContributorAutoFollow(): void {
  if (autoFollowAttached) return;
  autoFollowAttached = true;

  subscribeTracked((trip, progress) => {
    if (!isContributorAvailable()) return;
    void autoFollowTick(trip, progress).catch((err) =>
      console.warn('[Contributor] auto-follow:', err),
    );
  });

  // Restart aplikacji mógł przywrócić przypiętą podróż - dokończ start sesji.
  const trip = getTrackedTripSync();
  if (trip && getContributorSettingsSync().autoFollow && getCollectorState() === 'idle') {
    void startCollection(metaFromTracked(trip), 'trip');
  }
}

async function autoFollowTick(
  trip: TrackedTrip | null,
  progress: TripProgress | null,
): Promise<void> {
  if (trip) {
    if (getCollectorState() === 'idle') {
      if (!getContributorSettingsSync().autoFollow) return;
      await startCollection(metaFromTracked(trip), 'trip');
      return;
    }
    if (getActiveSessionSource() !== 'trip' || !progress) return;
    // Opóźnienie i fazę dopisujemy tylko przy zmianie - ticki przyjeżdżają
    // co kilkadziesiąt sekund, a baza nie musi tego widzieć częściej.
    if (progress.delayMin === lastContextDelay) return;
    lastContextDelay = progress.delayMin;
    const sid = getActiveSessionId();
    if (!sid) return;
    await appendSessionContext(
      sid,
      {
        phase: progress.phase,
        legIndex: progress.legIndex,
        line: progress.line,
        direction: progress.direction,
        delayMin: progress.delayMin,
      },
      progress.delayMin,
    );
    return;
  }
  // Podróż się skończyła: zamykamy tylko sesję automatyczną.
  if (getActiveSessionSource() === 'trip') await stopCollection();
  lastContextDelay = null;
}
