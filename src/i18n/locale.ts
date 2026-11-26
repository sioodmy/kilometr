// Stan języka, bez zależności od Expo.
//
// `index.tsx` wykrywa locale systemowy przez `expo-localization`, ale to
// zadanie nie powinno być dostępne dla czystej logiki (serwisy, skrypty
// testowe). Dlatego trzymamy stan tutaj, a wykrywanie zostaje w `index.ts`.
// Dzięki temu `tr()` działa wszędzie, także poza Reactem.

import { pl, type Strings } from './pl';

export type Locale = 'pl' | 'en' | 'de' | 'uk';
export type LocaleSetting = Locale | 'system';
export type { Strings };

const loadedDicts: Partial<Record<Locale, Strings>> = { pl };
const dictLoads = new Map<Locale, Promise<Strings>>();

/** Leniwie ładuje i buforuje słownik dla wskazanego języka (PL jest zawsze w pamięci). */
export async function loadLocaleDict(locale: Locale): Promise<Strings> {
  const existing = loadedDicts[locale];
  if (existing) return existing;
  const inflight = dictLoads.get(locale);
  if (inflight) return inflight;

  const task = (async () => {
    try {
      let dict: Strings = pl;
      if (locale === 'en') dict = (await import('./en')).en;
      else if (locale === 'de') dict = (await import('./de')).de;
      else if (locale === 'uk') dict = (await import('./uk')).uk;
      loadedDicts[locale] = dict;
      return dict;
    } catch {
      return pl;
    } finally {
      dictLoads.delete(locale);
    }
  })();

  dictLoads.set(locale, task);
  return task;
}

/** Zwraca załadowany słownik dla podanego języka lub fallback PL. */
export function getLocaleDict(locale: Locale): Strings {
  return loadedDicts[locale] ?? pl;
}

let currentSetting: LocaleSetting = 'system';
let currentLocale: Locale = 'pl';
const listeners = new Set<() => void>();

function notifyLocaleListeners(): void {
  for (const l of listeners) l();
}

export function getLocaleSettingSync(): LocaleSetting {
  return currentSetting;
}

export function setLocaleInternal(setting: LocaleSetting, resolved: Locale): void {
  currentSetting = setting;
  currentLocale = resolved;
  if (!loadedDicts[resolved]) {
    void loadLocaleDict(resolved).then(() => {
      if (currentLocale === resolved) notifyLocaleListeners();
    });
  }
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
  return loadedDicts[currentLocale] ?? pl;
}
