import { pl } from './landing/pl';

export type Locale = 'pl' | 'en' | 'de' | 'uk';
type LandingStrings = typeof pl;

const cache: Partial<Record<Locale, LandingStrings>> = { pl };
const pending = new Map<Locale, Promise<void>>();
const loaders: Record<Exclude<Locale, 'pl'>, () => Promise<LandingStrings>> = {
  en: () => import('./landing/en').then((m) => m.en),
  de: () => import('./landing/de').then((m) => m.de),
  uk: () => import('./landing/uk').then((m) => m.uk),
};

const key = 'kilometr.website.language';
const listeners = new Set<() => void>();
let locale: Locale = 'pl';

function isLocale(value: string | null | undefined): value is Locale {
  return value === 'pl' || value === 'en' || value === 'de' || value === 'uk';
}

function notify() {
  listeners.forEach((listener) => listener());
}

function ensureLocaleLoaded(target: Locale) {
  if (target === 'pl' || cache[target] || pending.has(target)) return;
  const task = loaders[target]()
    .then((dict) => {
      cache[target] = dict;
      if (locale === target) notify();
    })
    .catch(() => {})
    .finally(() => {
      pending.delete(target);
    });
  pending.set(target, task);
}

export function initWebLocale() {
  let stored: string | null = null;
  try {
    stored = localStorage.getItem(key);
  } catch {}

  const hash = window.location.hash;
  const hashLangMatch = hash.match(/(?:^|[#&?])lang=(pl|en|de|uk)(?:&|$)/);
  const hashLang = hashLangMatch?.[1] ?? null;
  const preferred = hashLang ?? stored ?? navigator.language.split('-')[0];
  if (isLocale(preferred)) locale = preferred;
  document.documentElement.lang = locale;
  ensureLocaleLoaded(locale);

  // Dekoder linków udostępniania ładujemy tylko dla URL-i #t= / #trip, bez ciągnięcia fflate na stronę główną.
  if (!hashLang && (hash.startsWith('#t=') || hash.startsWith('#trip'))) {
    void import('../sharing/connection')
      .then(({ extractShareTripToken, decodeSharedPayload }) => {
        const parsed = extractShareTripToken(hash);
        const payloadLocale = parsed.trip ? decodeSharedPayload(parsed.trip)?.locale : undefined;
        const sharedLocale = parsed.lang ?? payloadLocale;
        if (isLocale(sharedLocale) && sharedLocale !== locale) {
          locale = sharedLocale;
          document.documentElement.lang = locale;
          ensureLocaleLoaded(locale);
          notify();
        }
      })
      .catch(() => {});
  }
}

export function setWebLocale(next: Locale) {
  locale = next;
  document.documentElement.lang = next;
  try {
    localStorage.setItem(key, next);
  } catch {}
  ensureLocaleLoaded(next);
  notify();
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

export function getWebStrings(): LandingStrings {
  return cache[locale] ?? pl;
}

export function getDefaultWebStrings(): LandingStrings {
  return pl;
}
