import { pl } from './landing/pl';
import { en } from './landing/en';
import { de } from './landing/de';
import { uk } from './landing/uk';
import { pl as sharePl } from './share/pl';
import { en as shareEn } from './share/en';
import { de as shareDe } from './share/de';
import { uk as shareUk } from './share/uk';

export type Locale = 'pl' | 'en' | 'de' | 'uk';
const dictionaries = { pl, en, de, uk };
const shareDictionaries = { pl: sharePl, en: shareEn, de: shareDe, uk: shareUk };
const key = 'kilometr.website.language';
const listeners = new Set<() => void>();
let locale: Locale = 'pl';

export function initWebLocale() {
  let stored: string | null = null;
  try {
    stored = localStorage.getItem(key);
  } catch {}
  const sharedLocale = window.location.hash.startsWith('#trip=')
    ? new URLSearchParams(window.location.hash.slice(1)).get('lang')
    : null;
  const preferred = sharedLocale ?? stored ?? navigator.language.split('-')[0];
  if (preferred === 'pl' || preferred === 'en' || preferred === 'de' || preferred === 'uk')
    locale = preferred;
  document.documentElement.lang = locale;
}

export function setWebLocale(next: Locale) {
  locale = next;
  document.documentElement.lang = next;
  try {
    localStorage.setItem(key, next);
  } catch {}
  listeners.forEach((listener) => listener());
}

export function subscribeWebLocale(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getWebLocale(): Locale {
  return locale;
}

export function getWebStrings() {
  return dictionaries[locale];
}

export function getWebShareStrings() {
  return shareDictionaries[locale];
}
