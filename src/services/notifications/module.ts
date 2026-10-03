import { Platform } from 'react-native';
import Constants from 'expo-constants';

// Leniwe ładowanie modułów natywnych.
//
// Expo Go: sam import 'expo-notifications' wywala ewaluację modułu
// (DevicePushTokenAutoRegistration woła push API niedostępne w Expo Go),
// więc ładujemy je leniwie przez require + guard na appOwnership. W Expo Go
// powiadomienia są po prostu wyłączone, a nie zepsute.

export type NotificationsModule = typeof import('expo-notifications');

/** Minimalny interfejs natywnego modułu Androida (modules/kilometr-tracking). */
export interface TrackingNativeModule {
  /** Czy natywne Live Update jest dostępne. */
  isAvailable(): boolean;
  /** Buduje kanały (Android 8+). */
  ensureChannels(): Promise<void>;
  /** Czy system dopuści powiadomienie do strefy Live Updates. */
  canPromote(): Promise<boolean>;
  /** Przekazuje plan podróży do serwisu, który sam aktualizuje powiadomienie. */
  startTrip(planJson: string): Promise<boolean>;
  /** Zatrzymuje serwis i zdejmuje powiadomienie. */
  stopTrip(): Promise<boolean>;
  /** Czy „Zakończ" pod powiadomieniem zadziałał natywnie (bez otwierania apki). */
  consumeStopRequest(): Promise<boolean>;
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
 * Natywne Live Update na Androidzie: `Notification.ProgressStyle` z segmentami
 * podróży, licznik systemowy i serwis w pierwszym planie, który przeżywa
 * zamknięcie aplikacji. Moduł jest lokalny (modules/) i istnieje tylko na
 * Androidzie, więc wymagamy go leniwie i w jednym miejscu.
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

/** Czy na tej platformie mamy natywne Live Update. */
export function isNativeTrackingSupported(): boolean {
  return getTrackingNative() != null;
}

/** Identyfikator powiadomienia śledzącej — wspólny dla update i dismiss. */
export const TRACKING_NOTIFICATION_ID = 'kilometr.tracking.v2';
