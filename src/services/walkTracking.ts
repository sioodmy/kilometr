import * as Location from 'expo-location';
import type { TrackedTrip, TripProgress } from './notifications/types';
import { recordWalkSample } from './walkPace';
import { haversineM } from './walkPaceMath';

/**
 * Pomiar tempa chodzenia podczas śledzenia kursu.
 *
 * „Śledź ten kurs" trzyma już foreground service z trwałym powiadomieniem,
 * więc dokładamy do niego obserwator GPS (tylko foreground, bez nowych
 * uprawnień w manifeście). Gdy faza podróży to dojście piesze, zbieramy
 * punkty i liczymy efektywne tempo: dystans z GPS przez czas, razem
 * z postojami na światłach. Postój nie dokłada metrów, ale dokłada sekundy,
 * więc dojście ze światłami wychodzi wolniej z natury, bez osobnego modelu.
 *
 * Czujniki: prędkość z `coords.speed` daje system (GPS + IMU), a koprocesor
 * ruchu (`watchMotionActivityAsync`) odcina jazdę pojazdem, żeby tramwaj nie
 * wszedł do statystyki spaceru. Oba best effort: bez nich działa sam GPS.
 */

const ACCURACY_GATE_M = 25;
const NOISE_GATE_M = 3;
const MAX_SEGMENT_MPS = 3.5;
const OS_SPEED_VEHICLE_MPS = 4.0;
const STALE_GAP_MS = 180_000;

interface Episode {
  originLat: number;
  originLon: number;
  dest: string | null;
  startTs: number;
  lastLat: number;
  lastLon: number;
  lastTs: number;
  distanceM: number;
  fixes: number;
}

let active = false;
let episode: Episode | null = null;
let lastFix: { lat: number; lon: number } | null = null;
let motion: 'unknown' | 'onFoot' | 'vehicle' = 'unknown';
let locSub: Location.LocationSubscription | null = null;
let motionSub: Location.LocationSubscription | null = null;

function isVehicleActivity(a: Location.MotionActivityObject): boolean {
  const acts = a.activities as Record<string, { detected?: boolean } | undefined>;
  const vehicle = acts.automotive?.detected === true || acts.cycling?.detected === true;
  const onFoot = acts.walking?.detected === true || acts.running?.detected === true;
  return vehicle && !onFoot;
}

function onLocation(loc: Location.LocationObject) {
  const { latitude, longitude, accuracy, speed } = loc.coords;
  if (loc.mocked === true) return;
  if (accuracy != null && accuracy > ACCURACY_GATE_M) return;
  const ts = loc.timestamp ?? Date.now();
  lastFix = { lat: latitude, lon: longitude };
  if (!active || !episode) return;
  if (motion === 'vehicle') return;
  if (speed != null && speed > OS_SPEED_VEHICLE_MPS) {
    episode.lastLat = latitude;
    episode.lastLon = longitude;
    episode.lastTs = ts;
    return;
  }
  if (ts - episode.lastTs > STALE_GAP_MS) {
    void finishEpisode(true);
    return;
  }
  const dt = (ts - episode.lastTs) / 1000;
  if (dt <= 0) return;
  const d = haversineM(episode.lastLat, episode.lastLon, latitude, longitude);
  if (d < NOISE_GATE_M) {
    // Szum albo stanie (światła): czas leci, metry nie. Dokładnie tego chcemy.
    episode.lastTs = ts;
    episode.fixes += 1;
    return;
  }
  if (d / dt > MAX_SEGMENT_MPS) {
    // Skok GPS albo pojazd: synchronizuj bez dokładania metrów.
    episode.lastLat = latitude;
    episode.lastLon = longitude;
    episode.lastTs = ts;
    return;
  }
  episode.distanceM += d;
  episode.lastLat = latitude;
  episode.lastLon = longitude;
  episode.lastTs = ts;
  episode.fixes += 1;
}

function ensureEpisode(originHint: { lat: number; lon: number }, dest: string | null) {
  if (episode) {
    if (dest && episode.dest !== dest) {
      // Nowe dojście (przesiadka): zamknij poprzednie, otwórz kolejne.
      void finishEpisode(true);
    } else {
      return;
    }
  }
  const origin = lastFix ?? originHint;
  const now = Date.now();
  episode = {
    originLat: origin.lat,
    originLon: origin.lon,
    dest,
    startTs: now,
    lastLat: origin.lat,
    lastLon: origin.lon,
    lastTs: now,
    distanceM: 0,
    fixes: 0,
  };
}

async function finishEpisode(record: boolean) {
  const ep = episode;
  episode = null;
  if (!record || !ep) return;
  const durationSec = Math.round((ep.lastTs - ep.startTs) / 1000);
  if (ep.fixes < 4 || ep.distanceM < 40 || durationSec < 30 || durationSec > 1800) return;
  const effective = ep.distanceM / Math.max(1, durationSec);
  if (effective < 0.4 || effective > 2.8) return;
  await recordWalkSample({
    originLat: ep.originLat,
    originLon: ep.originLon,
    dest: ep.dest,
    speedMps: effective,
    distanceM: Math.round(ep.distanceM),
    durationSec,
  });
}

/**
 * Wołane z tickera śledzenia po każdym przeliczeniu postępu. Granice
 * epizodu wyznacza faza: dojście piesze otwiera, reszta zamyka z zapisem.
 */
export function walkPaceTick(p: TripProgress, trip: TrackedTrip) {
  if (!active) return;
  if (p.phase === 'walking' || p.phase === 'transfer') {
    ensureEpisode({ lat: trip.fromLat, lon: trip.fromLon }, p.stopName ?? null);
  } else {
    void finishEpisode(true);
  }
}

/** Start obserwatora na czas śledzenia. False gdy brak zgody na lokalizację. */
export async function startWalkPaceTracking(): Promise<boolean> {
  if (active) return true;
  try {
    const current = await Location.getForegroundPermissionsAsync();
    if (current.status !== 'granted') {
      if (!current.canAskAgain) return false;
      const asked = await Location.requestForegroundPermissionsAsync();
      if (asked.status !== 'granted') return false;
    }
  } catch {
    return false;
  }
  active = true;
  motion = 'unknown';
  try {
    locSub = await Location.watchPositionAsync(
      {
        accuracy: Location.Accuracy.Balanced,
        timeInterval: 3000,
        distanceInterval: 4,
      },
      onLocation,
    );
  } catch {
    active = false;
    return false;
  }
  try {
    const motionPerm = await Location.requestMotionActivityPermissionsAsync();
    if (motionPerm.granted) {
      motionSub = await Location.watchMotionActivityAsync((a) => {
        motion = isVehicleActivity(a) ? 'vehicle' : 'onFoot';
      });
    }
  } catch {
    // Bez koprocesora ruchu działa sam GPS.
  }
  return true;
}

/** Stop obserwatora. Niedokończony epizod odrzucamy, nie zapisujemy połówki. */
export async function stopWalkPaceTracking(): Promise<void> {
  active = false;
  await finishEpisode(false);
  try {
    locSub?.remove();
  } catch {
    // ignoruj
  }
  try {
    motionSub?.remove();
  } catch {
    // ignoruj
  }
  locSub = null;
  motionSub = null;
  lastFix = null;
  motion = 'unknown';
}
