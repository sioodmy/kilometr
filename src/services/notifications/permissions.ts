import { Platform } from 'react-native';
import { tr } from '../../i18n';
import { getNotifications, getTrackingNative } from './module';

// Uprawnienia. Prompt prosimy tylko wtedy, gdy użytkownik naprawdę włącza
// funkcję (przypina trasę albo zmienia ustawienie), bo prośba „na starcie
// aplikacji” to najczęstszy powód, dla którego ludzie odmawiają.

/** Czy powiadomienia są już włączone (bez pytania użytkownika). */
export async function hasNotificationPermission(): Promise<boolean> {
  const N = getNotifications();
  if (!N) return false;
  try {
    const current = await N.getPermissionsAsync();
    if (current.granted) return true;
    // iOS: provisional to ciche powiadomienia, które i tak warto traktować
    // jako zgodę na śledzenie podróży.
    return current.ios?.status === N.IosAuthorizationStatus.PROVISIONAL;
  } catch {
    return false;
  }
}

/** Prosi o uprawnienia. Zwraca false, gdy odmówiono lub nie ma gdzie pytać. */
export async function ensureNotificationPermission(): Promise<boolean> {
  const N = getNotifications();
  if (!N) return false;
  try {
    const current = await N.getPermissionsAsync();
    if (current.granted) return true;
    if (current.ios?.status === N.IosAuthorizationStatus.PROVISIONAL) return true;
    const next = await N.requestPermissionsAsync({
      ios: { allowAlert: true, allowBadge: true, allowSound: true },
    });
    return (
      next.granted || next.ios?.status === N.IosAuthorizationStatus.PROVISIONAL
    );
  } catch {
    return false;
  }
}

/** Tekst do pokazania, gdy brak uprawnień — bez zaglądania w ustawienia systemu. */
export function permissionDeniedMessage(): string {
  return tr().notification.permDenied;
}

/**
 * Czy system wypuści powiadomienie do strefy „Live Updates" (Android 16.1+).
 * Użytkownik może to wyłączyć per-apka; wtedy powiadomienie i tak działa,
 * tylko nie dostanie wyróżnionego miejsca na ekranie blokady.
 */
export async function canShowLiveUpdates(): Promise<boolean> {
  const native = getTrackingNative();
  if (!native) return false;
  try {
    return await native.canPromote();
  } catch {
    return false;
  }
}

/** Czy na tej platformie w ogóle da się śledzić podróżę powiadomieniem. */
export function isTrackingPlatform(): boolean {
  return Platform.OS === 'android';
}