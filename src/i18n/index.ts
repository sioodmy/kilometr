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
//
// Stan języka siedzi w `locale.ts` bez importu Expo, żeby czysta logika
// (serwisy, `tr()` w skryptach) nie ciągnęła `react-native` za sobą.

import { useEffect, useState } from 'react';
import { getLocales } from 'expo-localization';
import { kvGet, kvSet } from '../services/storage';
import {
  DICTS,
  getLocaleSettingSync,
  getLocaleSync,
  setLocaleInternal,
  subscribeLocale,
  type Locale,
  type LocaleSetting,
  type Strings,
} from './locale';

export type { Locale, LocaleSetting, Strings };
export { getLocaleSync, getLocaleSettingSync, tr } from './locale';

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

/** Wczytaj zapisany wybór (wołać raz przy starcie, przed pierwszym renderem UI). */
export async function initLocale(): Promise<Locale> {
  let setting: LocaleSetting = 'system';
  try {
    const raw = await kvGet(STORE_KEY);
    if (raw === 'pl' || raw === 'en' || raw === 'de' || raw === 'uk' || raw === 'system') {
      setting = raw;
    }
  } catch {}
  setLocaleInternal(setting, resolve(setting));
  return getLocaleSync();
}

export async function setLocaleSetting(setting: LocaleSetting): Promise<void> {
  setLocaleInternal(setting, resolve(setting));
  try {
    await kvSet(STORE_KEY, setting);
  } catch {}
}

/** Pełny słownik pod aktualne locale; prze-renderowuje przy zmianie języka. */
export function useStrings(): Strings {
  const [locale, setLocale] = useState(getLocaleSync());
  useEffect(() => subscribeLocale(() => setLocale(getLocaleSync())), []);
  return DICTS[locale];
}

/** Wybór języka do ekranu Ustawień. */
export function useLocaleSetting(): {
  setting: LocaleSetting;
  locale: Locale;
  setSetting: (s: LocaleSetting) => void;
} {
  const [setting, setSettingState] = useState(getLocaleSettingSync());
  const [locale, setLocale] = useState(getLocaleSync());
  useEffect(
    () =>
      subscribeLocale(() => {
        setSettingState(getLocaleSettingSync());
        setLocale(getLocaleSync());
      }),
    [],
  );
  return { setting, locale, setSetting: (s) => void setLocaleSetting(s) };
}
