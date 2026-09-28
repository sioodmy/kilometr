import { Platform } from 'react-native';
import { getNotifications } from './module';

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
  if (Platform.OS === 'android') {
    return 'Powiadomienia są wyłączone. Włącz je w ustawieniach systemu dla kilometr, żeby śledzić odjazd i postęp podróży.';
  }
  return 'Powiadomienia są wyłączone. Włącz je w Ustawieniach → kilometr → Powiadomienia, żeby śledzić odjazd i postęp podróży.';
}

/** Czy na tej platformie w ogóle da się Live Activity (czyli iOS 16.1+). */
export function isDynamicIslandPlatform(): boolean {
  return Platform.OS === 'ios';
}
