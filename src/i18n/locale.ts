// Stan języka, bez zależności od Expo.
//
// `index.tsx` wykrywa locale systemowy przez `expo-localization`, ale to
// zadanie nie powinno być dostępne dla czystej logiki (serwisy, skrypty
// testowe). Dlatego trzymamy stan tutaj, a wykrywanie zostaje w `index.ts`.
// Dzięki temu `tr()` działa wszędzie, także poza Reactem.

import { pl, type Strings } from './pl';
import { en } from './en';
import { de } from './de';
import { uk } from './uk';

export type Locale = 'pl' | 'en' | 'de' | 'uk';
export type LocaleSetting = Locale | 'system';
export type { Strings };

export const DICTS: Record<Locale, Strings> = { pl, en, de, uk };

let currentSetting: LocaleSetting = 'system';
let currentLocale: Locale = 'pl';
const listeners = new Set<() => void>();

export function notifyLocaleListeners(): void {
  for (const l of listeners) l();
}

export function getLocaleSettingSync(): LocaleSetting {
  return currentSetting;
}

export function setLocaleInternal(setting: LocaleSetting, resolved: Locale): void {
  currentSetting = setting;
  currentLocale = resolved;
  notifyLocaleListeners();
}

export function subscribeLocale(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/** Aktywny locale (bez odpytywania systemu, do użyć po `initLocale`). */
export function getLocaleSync(): Locale {
  return currentLocale;
}

/**
 * Słownik pod bieżące locale. Wołać WEWNĄTRZ funkcji, nie na module
 * (inaczej zmiana języka nie odświeży tekstów).
 */
export function tr(): Strings {
  return DICTS[currentLocale] ?? pl;
}
