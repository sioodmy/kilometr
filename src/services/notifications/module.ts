import { Platform } from 'react-native';
import Constants from 'expo-constants';
import type { NativeTrackingState } from './types';

// Leniwe ładowanie modułów natywnych.
//
// Expo Go: sam import 'expo-notifications' wywala ewaluację modułu
// (DevicePushTokenAutoRegistration woła push API niedostępne w Expo Go),
// więc ładujemy je leniwie przez require + guard na appOwnership. W Expo Go
// powiadomienia są po prostu wyłączone, a nie zepsute.

export type NotificationsModule = typeof import('expo-notifications');

/** Minimalny interfejs natywnego modułu Androida (modules/kilometr-tracking). */
export interface TrackingNativeModule {
  /** Czy natywna powiadomienie z paskiem postępu jest dostępna. */
  isAvailable(): boolean;
  /** Buduje kanały (Android 8+) i czyści ewentualne zombie. */
  ensureChannels(): Promise<void>;
  /** wystawia / aktualizuje trwałą powiadomienie śledzącą podróż */
  present(state: NativeTrackingState): Promise<boolean>;
  /** usuwa powiadomienie śledzącą */
  dismiss(): Promise<void>;
}

let nmod: NotificationsModule | null | undefined;
let warnedUnsupported = false;

export function getNotifications(): NotificationsModule | null {
  if (nmod !== undefined) return nmod;
  try {
    if (Constants.appOwnership === 'expo') {
      nmod = null;
      return nmod;
    }
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    nmod = require('expo-notifications') as NotificationsModule;
  } catch {
    nmod = null;
  }
  return nmod;
}

/** Czy w ogóle da się pokazać powiadomienie (dev build / produkcja). */
export function areNotificationsSupported(): boolean {
  return getNotifications() != null;
}

/** Ostrzeżenie w konsoli zamiast cichych nulli — pomocne przy testowaniu. */
export function warnUnsupportedOnce(what: string): void {
  if (warnedUnsupported) return;
  warnedUnsupported = true;
  console.warn(
    `[Powiadomienia] ${what} niedostępne — potrzebny build deweloperski (Expo Go nie wspiera powiadomień).`,
  );
}

let tracking: TrackingNativeModule | null | undefined;

/**
 * Natywna powiadomienie śledząca na Androidzie: postęp paskiem + chronometr
 * odliczający w dół, liczone przez system. Moduł jest lokalny (modules/) i nie
 * istnieje na iOS, więc trzymamy require w jednym miejscu.
 */
export function getTrackingNative(): TrackingNativeModule | null {
  if (tracking !== undefined) return tracking;
  if (Platform.OS !== 'android') {
    tracking = null;
    return tracking;
  }
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require('../../../modules/kilometr-tracking') as TrackingNativeModule;
    tracking = mod?.isAvailable?.() ? mod : null;
  } catch {
    tracking = null;
  }
  return tracking;
}

/** Czy na tej platformie mamy natywny pasek postępu w powiadomieniu. */
export function isNativeTrackingSupported(): boolean {
  return getTrackingNative() != null;
}

/** Identyfikator powiadomienia śledzącej — wspólny dla update i dismiss. */
export const TRACKING_NOTIFICATION_ID = 'kilometr.tracking.v2';
