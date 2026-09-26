import { Platform } from 'react-native';
import type { LiveActivity, LiveActivityFactory } from 'expo-widgets';
import type { TripActivityProps } from '../types';
import { TRIP_ACTIVITY_NAME } from './KilometrTripActivity';

// Kontroler Live Activity. Moduł z widgetem importujemy leniwie i tylko na
// iOS: bundle widgetu ciągnie @expo/ui i natywny ExpoWidgets, a na Androidzie
// (i w Expo Go) nie ma po co go w ogóle ewaluować.

type ActivityFactory = LiveActivityFactory<TripActivityProps>;

let factory: ActivityFactory | null | undefined;
let current: LiveActivity<TripActivityProps> | null = null;
let currentId: string | null = null;

function getFactory(): ActivityFactory | null {
  if (factory !== undefined) return factory;
  if (Platform.OS !== 'ios') {
    factory = null;
    return factory;
  }
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require('./KilometrTripActivity') as { default: ActivityFactory };
    factory = mod.default ?? null;
  } catch {
    factory = null;
  }
  return factory;
}

/** Czy na tej platformie da się w ogóle pokazać Live Activity. */
export function isLiveActivitySupported(): boolean {
  return getFactory() != null;
}

/**
 * Uruchamia Live Activity albo aktualizuje istniejącą. Zwraca identyfikator
 * aktywności (do logowania) albo null, gdy Live Activity nie są dostępne.
 *
 * `staleAfterSec` mówi systemowi, po jakim czasie bez aktualizacji ma przygasnąć
 * prezentację — dzięki temu użytkownik widzi, że dane mogą być nieaktualne,
 * zamiast dostawać stan sprzed godziny bez żadnego ostrzeżenia.
 */
export function presentTripActivity(
  props: TripActivityProps,
  url?: string,
  staleAfterSec = 240,
): string | null {
  const f = getFactory();
  if (!f) return null;
  try {
    if (current) {
      void current.update(props, new Date(Date.now() + staleAfterSec * 1000));
      return currentId;
    }
    const staleDate = new Date(Date.now() + staleAfterSec * 1000);
    const instance = f.start(props, url, staleDate);
    current = instance;
    currentId = instance.getId();
    return currentId;
  } catch {
    return null;
  }
}

/** Kończy aktywność, zostawiając na ekranie blokady stan przez `lingerSec`. */
export function dismissTripActivity(props?: TripActivityProps, lingerSec = 0): void {
  const f = getFactory();
  const instance = current;
  current = null;
  currentId = null;
  if (!f || !instance) return;
  try {
    const after = Math.max(0, lingerSec) * 1000;
    void instance.end(
      after > 0 ? { after: new Date(Date.now() + after) } : 'immediate',
      props,
    );
  } catch {
    // aktywność mogła już zniknąć (użytkownik przesunął, iOS wyłączył)
  }
}

/**
 * Podpina się do aktywności, która przeżyła restart aplikacji. Bez tego
 * po ubiciu procesu zostalibyśmy ze świeżym stanem w JS i martwą aktywnością
 * na ekranie blokady.
 */
export function adoptOrphanActivity(): LiveActivity<TripActivityProps> | null {
  const f = getFactory();
  if (!f) return null;
  if (current) return current;
  try {
    const instances = f.getInstances();
    const live = instances.find((i) => {
      try {
        return i.getId() === currentId;
      } catch {
        return true;
      }
    });
    const picked = live ?? instances[0] ?? null;
    if (picked) {
      current = picked;
      try {
        currentId = picked.getId();
      } catch {
        currentId = null;
      }
    }
    return picked;
  } catch {
    return null;
  }
}

/** Czy mamy aktywność, którą aktualizujemy. Używane przez testy i diagnostykę. */
export function hasActiveTripActivity(): boolean {
  return current != null;
}

export { TRIP_ACTIVITY_NAME };
