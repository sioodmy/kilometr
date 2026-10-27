import { useEffect, useSyncExternalStore } from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import * as Location from 'expo-location';
import {
  createLocationFilterState,
  filterLocationFix,
  type LocationFilterState,
  type RawLocationFix,
} from './locationFilter';

export type { RawLocationFix };

export interface CurrentLocation {
  lat: number;
  lon: number;
  accuracy: number | null;
  speed: number | null;
  heading: number | null;
  timestamp: number;
}

type CurrentLocationState = 'seeking' | 'ok' | 'denied' | 'noFix';

interface LocationSnapshot {
  location: CurrentLocation | null;
  state: CurrentLocationState;
}

const listeners = new Set<() => void>();
let snapshot: LocationSnapshot = { location: null, state: 'seeking' };
const filterState: LocationFilterState = createLocationFilterState();
let subscriberCount = 0;
let generation = 0;
let startPromise: Promise<void> | null = null;
let locationSub: Location.LocationSubscription | null = null;
let appStateSub: { remove: () => void } | null = null;
let firstFixTimer: ReturnType<typeof setTimeout> | null = null;

function publish(next: LocationSnapshot) {
  snapshot = next;
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot() {
  return snapshot;
}

export function getCurrentLocationSnapshot(): LocationSnapshot {
  return snapshot;
}

export function seedCurrentLocation(raw: RawLocationFix): void {
  const filtered = filterLocationFix(filterState, raw);
  if (!filtered) return;
  publish({
    state: 'ok',
    location: filtered,
  });
}

function removeWatch() {
  generation += 1;
  locationSub?.remove();
  locationSub = null;
  if (firstFixTimer) clearTimeout(firstFixTimer);
  firstFixTimer = null;
}

function handleLocationUpdate(loc: Location.LocationObject) {
  if (firstFixTimer) clearTimeout(firstFixTimer);
  firstFixTimer = null;
  const filtered = filterLocationFix(filterState, {
    lat: loc.coords.latitude,
    lon: loc.coords.longitude,
    accuracy: loc.coords.accuracy,
    speed: loc.coords.speed,
    heading:
      loc.coords.heading != null && Number.isFinite(loc.coords.heading)
        ? loc.coords.heading
        : null,
    timestamp: loc.timestamp,
  });
  if (!filtered) return;
  publish({
    state: 'ok',
    location: filtered,
  });
}

function startWatch(requestPermission: boolean): Promise<void> {
  if (startPromise) return startPromise;
  const token = ++generation;
  const pending = (async () => {
    try {
      if (requestPermission) {
        // Jak w LocationService: mapa nie może pytać o lokalizację,
        // zanim użytkownik przejdzie onboarding.
        try {
          const { hasSeenOnboarding } = await import('./onboarding');
          if (!(await hasSeenOnboarding())) requestPermission = false;
        } catch {}
      }
      let permission = await Location.getForegroundPermissionsAsync();
      if (!permission.granted && requestPermission) {
        permission = await Location.requestForegroundPermissionsAsync();
      }
      if (token !== generation || subscriberCount === 0) return;
      if (!permission.granted) {
        publish({ location: snapshot.location, state: 'denied' });
        return;
      }
      if (!(await Location.hasServicesEnabledAsync())) {
        publish({ location: snapshot.location, state: 'noFix' });
        return;
      }

      if (!snapshot.location) {
        try {
          const cached = await Location.getLastKnownPositionAsync({
            maxAge: 45000,
            requiredAccuracy: 75,
          });
          if (cached && token === generation && subscriberCount > 0) {
            handleLocationUpdate(cached);
          }
        } catch {}
      }

      const nextSub = await Location.watchPositionAsync(
        {
          accuracy: Location.Accuracy.High,
          timeInterval: 1000,
          distanceInterval: 2,
        },
        (loc) => {
          if (token !== generation) return;
          handleLocationUpdate(loc);
        },
      );

      if (token !== generation || subscriberCount === 0) {
        nextSub.remove();
        return;
      }
      locationSub = nextSub;
      firstFixTimer = setTimeout(() => {
        if (token === generation && snapshot.state === 'seeking') {
          publish({ location: snapshot.location, state: snapshot.location ? 'ok' : 'noFix' });
        }
      }, 12000);
    } catch {
      if (token === generation) {
        publish({ location: snapshot.location, state: snapshot.location ? 'ok' : 'noFix' });
      }
    }
  })();
  startPromise = pending.finally(() => {
    startPromise = null;
    if (subscriberCount > 0 && token !== generation && !locationSub) {
      void startWatch(false);
    }
  });
  return startPromise;
}

function acquire(): () => void {
  subscriberCount += 1;
  if (subscriberCount === 1) {
    publish({
      location: snapshot.location,
      state: snapshot.location ? 'ok' : 'seeking',
    });
    void startWatch(true);
    appStateSub = AppState.addEventListener('change', (state: AppStateStatus) => {
      if (state === 'background' || state === 'inactive') {
        // W tle nikt nie czyta pozycji, a watch z Accuracy.High chodzi dalej
        // i pali baterię. Na powrocie startWatch go odtworzy.
        removeWatch();
        return;
      }
      if (state !== 'active' || subscriberCount === 0) return;
      removeWatch();
      // Zachowujemy ostatnią znaną pozycję przy wybudzeniu ekranu, żeby widget nie mrugał stanem ładowania.
      publish({
        location: snapshot.location,
        state: snapshot.location ? 'ok' : 'seeking',
      });
      void startWatch(false);
    });
  }

  let released = false;
  return () => {
    if (released) return;
    released = true;
    subscriberCount = Math.max(0, subscriberCount - 1);
    if (subscriberCount === 0) {
      removeWatch();
      if (firstFixTimer) clearTimeout(firstFixTimer);
      firstFixTimer = null;
      appStateSub?.remove();
      appStateSub = null;
    }
  };
}

export function useCurrentLocation(enabled = true): LocationSnapshot {
  const value = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  useEffect(() => enabled ? acquire() : undefined, [enabled]);
  return value;
}
