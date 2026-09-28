// i18n: poprawna ścieżka dla Expo (Android czyta locale systemowe).
//
// - Wykrywanie języka: expo-localization (getLocales) — to jest oficjalny,
//   wspierany sposób w Expo, zamiast zgadywania przez NativeModules.
// - Nadpisanie per-app: Ustawienia → Język (Systemowy / PL / EN / DE / UK),
//   persistowane w kv-store. Bez tego zmiana języka wymagałaby grzebania
//   w ustawieniach systemowych telefonu.
// - Słowniki typowane: `Strings = typeof pl`, więc brak klucza w en/de/uk
//   to błąd kompilacji, nie pusty label w runtime.
// - Liczby mnogie i interpolacje to funkcje w słowniku (pl: 1/2-4/5+,
//   uk: tak samo, en/de: 1/wiele) — zero runtime'owego silnika pluralizacji.

import { useEffect, useState } from 'react';
import { getLocales } from 'expo-localization';
import { kvGet, kvSet } from '../services/storage';
import { pl, type Strings } from './pl';
import { en } from './en';
import { de } from './de';
import { uk } from './uk';

export type Locale = 'pl' | 'en' | 'de' | 'uk';
export type LocaleSetting = Locale | 'system';
export type { Strings };

const DICTS: Record<Locale, Strings> = { pl, en, de, uk };
const STORE_KEY = 'kilometr.locale.v1';

function deviceLocale(): Locale {
  try {
    for (const l of getLocales()) {
      const code = (l.languageCode || '').toLowerCase();
      if (code.startsWith('pl')) return 'pl';
      if (code.startsWith('en')) return 'en';
      if (code.startsWith('de')) return 'de';
      if (code.startsWith('uk') || code.startsWith('ua')) return 'uk';
    }
  } catch {}
  return 'pl';
}

function resolve(setting: LocaleSetting): Locale {
  return setting === 'system' ? deviceLocale() : setting;
}

let currentSetting: LocaleSetting = 'system';
let currentLocale: Locale = deviceLocale();
const listeners = new Set<() => void>();

function notify() {
  for (const l of listeners) l();
}

/** Synchroniczny odczyt dla kodu poza React (serwisy, helpery formatujące). */
export function getLocaleSync(): Locale {
  return currentLocale;
}

export function getLocaleSettingSync(): LocaleSetting {
  return currentSetting;
}

/** Wczytaj zapisany wybór (wołać raz przy starcie, przed pierwszym renderem UI). */
export async function initLocale(): Promise<Locale> {
  try {
    const raw = await kvGet(STORE_KEY);
    if (raw === 'pl' || raw === 'en' || raw === 'de' || raw === 'uk' || raw === 'system') {
      currentSetting = raw;
    }
  } catch {}
  currentLocale = resolve(currentSetting);
  notify();
  return currentLocale;
}

export async function setLocaleSetting(setting: LocaleSetting): Promise<void> {
  currentSetting = setting;
  currentLocale = resolve(setting);
  try {
    await kvSet(STORE_KEY, setting);
  } catch {}
  notify();
}

/** Pełny słownik pod aktualne locale; prze-renderowuje przy zmianie języka. */
export function useStrings(): Strings {
  const [locale, setLocale] = useState(currentLocale);
  useEffect(() => {
    const fn = () => setLocale(currentLocale);
    listeners.add(fn);
    return () => {
      listeners.delete(fn);
    };
  }, []);
  return DICTS[locale];
}

/** Wybór języka do ekranu Ustawień. */
export function useLocaleSetting(): {
  setting: LocaleSetting;
  locale: Locale;
  setSetting: (s: LocaleSetting) => void;
} {
  const [locale, setLocale] = useState(currentLocale);
  const [setting, setSettingState] = useState(currentSetting);
  useEffect(() => {
    const fn = () => {
      setLocale(currentLocale);
      setSettingState(currentSetting);
    };
    listeners.add(fn);
    return () => {
      listeners.delete(fn);
    };
  }, []);
  return { setting, locale, setSetting: (s) => void setLocaleSetting(s) };
}
