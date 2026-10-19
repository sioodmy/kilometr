import { pl } from './landing/pl';
import { en } from './landing/en';
import { de } from './landing/de';
import { uk } from './landing/uk';

export type Locale = 'pl' | 'en' | 'de' | 'uk';
const dictionaries = { pl, en, de, uk };
const key = 'kilometr.website.language';
const listeners = new Set<() => void>();
let locale: Locale = 'pl';

export function initWebLocale() {
  let stored: string | null = null;
  try {
    stored = localStorage.getItem(key);
  } catch {}
  const preferred = stored ?? navigator.language.split('-')[0];
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
