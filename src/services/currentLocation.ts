import { useEffect, useSyncExternalStore } from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import * as Location from 'expo-location';

export interface CurrentLocation {
  lat: number;
  lon: number;
  accuracy: number | null;
  speed: number | null;
  heading: number | null;
  timestamp: number;
}

export type CurrentLocationState = 'seeking' | 'ok' | 'denied' | 'noFix';

interface LocationSnapshot {
  location: CurrentLocation | null;
  state: CurrentLocationState;
}

const listeners = new Set<() => void>();
let snapshot: LocationSnapshot = { location: null, state: 'seeking' };
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

function removeWatch() {
  generation += 1;
  locationSub?.remove();
  locationSub = null;
  if (firstFixTimer) clearTimeout(firstFixTimer);
  firstFixTimer = null;
}

function startWatch(requestPermission: boolean): Promise<void> {
  if (startPromise) return startPromise;
  const token = ++generation;
  const pending = (async () => {
    try {
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

      const nextSub = await Location.watchPositionAsync(
        {
          accuracy: Location.Accuracy.High,
          timeInterval: 1000,
          distanceInterval: 6,
        },
        (loc) => {
          if (token !== generation) return;
          if (firstFixTimer) clearTimeout(firstFixTimer);
          firstFixTimer = null;
          publish({
            state: 'ok',
            location: {
              lat: loc.coords.latitude,
              lon: loc.coords.longitude,
              accuracy: loc.coords.accuracy,
              speed: loc.coords.speed,
              heading:
                loc.coords.heading != null && Number.isFinite(loc.coords.heading)
                  ? loc.coords.heading
                  : null,
              timestamp: loc.timestamp,
            },
          });
        },
      );

      if (token !== generation || subscriberCount === 0) {
        nextSub.remove();
        return;
      }
      locationSub = nextSub;
      firstFixTimer = setTimeout(() => {
        if (token === generation && snapshot.state === 'seeking') {
          publish({ location: snapshot.location, state: 'noFix' });
        }
      }, 12000);
    } catch {
      if (token === generation) publish({ location: snapshot.location, state: 'noFix' });
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
    publish({ location: null, state: 'seeking' });
    void startWatch(true);
    appStateSub = AppState.addEventListener('change', (state: AppStateStatus) => {
      if (state !== 'active' || subscriberCount === 0) return;
      removeWatch();
      publish({ location: null, state: 'seeking' });
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

export function useCurrentLocation(): LocationSnapshot {
  const value = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  useEffect(() => acquire(), []);
  return value;
}
