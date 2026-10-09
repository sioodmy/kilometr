import * as Location from 'expo-location';
import type { TrackedTrip, TripProgress } from './notifications/types';
import { recordWalkSample, type WalkSample } from './walkPace';
import { createWalkEpisodeMachine, type WalkEpisodeMachine, type WalkSampleOut } from './walkEpisode';

/**
 * Pomiar tempa chodzenia podczas śledzenia kursu.
 *
 * „Śledź ten kurs" trzyma już foreground service z trwałym powiadomieniem,
 * więc dokładamy do niego obserwator GPS (tylko foreground, bez nowych
 * uprawnień w manifeście). Gdy faza podróży to dojście piesze, zbieramy fixy
 * i liczymy efektywne tempo: dystans z GPS przez czas, razem z postojami na
 * światłach. Przerwy, rezygnację użytkownika i kryteria akceptacji obsługuje
 * maszyna `walkEpisode`, tutaj zostaje tylko pomost na `expo-location`.
 *
 * Czujniki: prędkość z `coords.speed` daje system (GPS + IMU), a koprocesor
 * ruchu (`watchMotionActivityAsync`) odcina jazdę pojazdem, żeby tramwaj nie
 * wszedł do statystyki spaceru. Oba best effort: bez nich działa sam GPS.
 *
 * Rezygnacja: użytkownik może wcisnąć „Zakończ" w połowie dojścia albo nie
 * iść na przystanek wcale. Zapisujemy wtedy to, co przeszło filtry maszyny;
 * co nie przeszło, ginie. Ochroną są kryteria akceptacji, a nie odrzucenie
 * połówki, bo prawdziwy spacer zasługuje na pomiar niezależnie od tego, czy
 * user dojechał.
 */

let machine: WalkEpisodeMachine | null = null;
let lastFix: { lat: number; lon: number } | null = null;
let inVehicle = false;
let locSub: Location.LocationSubscription | null = null;
let motionSub: Location.LocationSubscription | null = null;

/** W tramwaju, aucie lub na rowerze nie mierzymy spaceru. */
function vehicleActivity(a: Location.MotionActivityObject): boolean {
  const acts = a.activities as Record<string, { detected?: boolean } | undefined>;
  const vehicle = acts.automotive?.detected === true || acts.cycling?.detected === true;
  const onFoot = acts.walking?.detected === true || acts.running?.detected === true;
  return vehicle && !onFoot;
}

function remember(sample: WalkSampleOut | null) {
  if (!sample) return;
  void recordWalkSample(sample as WalkSample);
}

function onLocation(loc: Location.LocationObject) {
  const { latitude, longitude, accuracy, speed } = loc.coords;
  lastFix = { lat: latitude, lon: longitude };
  if (!machine) return;
  remember(
    machine.feed(
      {
        lat: latitude,
        lon: longitude,
        ts: loc.timestamp ?? Date.now(),
        accuracyM: accuracy ?? null,
        speedMps: speed ?? null,
        mocked: loc.mocked === true,
      },
      inVehicle,
    ),
  );
}

/**
 * Wołane z tickera śledzenia po każdym przeliczeniu postępu. Granice dojścia
 * wyznacza faza: dojście otwiera, wszystko inne zamyka.
 */
export function walkPaceTick(p: TripProgress, trip: TrackedTrip) {
  if (!machine) return;
  if (p.phase === 'walking' || p.phase === 'transfer') {
    remember(machine.begin(p.stopName ?? null, trip.fromLat, trip.fromLon));
  } else {
    remember(machine.end());
  }
}

/** Start obserwatora na czas śledzenia. False gdy brak zgody na lokalizację. */
export async function startWalkPaceTracking(): Promise<boolean> {
  if (machine) return true;
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
  machine = createWalkEpisodeMachine(Date.now());
  inVehicle = false;
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
    machine = null;
    return false;
  }
  try {
    const motionPerm = await Location.requestMotionActivityPermissionsAsync();
    if (motionPerm.granted) {
      motionSub = await Location.watchMotionActivityAsync((a) => {
        inVehicle = vehicleActivity(a);
      });
    }
  } catch {
    // Bez koprocesora ruchu działa sam GPS.
  }
  return true;
}

/**
 * Stop obserwatora. Dojście w połowie przechodzi te same filtry co każde
 * inne: prawdziwy spacer jest wart pomiaru, nawet bez dojechania do przystanku.
 */
export async function stopWalkPaceTracking(): Promise<void> {
  const current = machine;
  machine = null;
  if (current) await recordWalkSampleOrIgnore(current.end());
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
  inVehicle = false;
}

async function recordWalkSampleOrIgnore(sample: WalkSampleOut | null) {
  if (!sample) return;
  await recordWalkSample(sample as WalkSample);
}
