// Oś czasu launch video: długość, teksty scen i pomocnicze krzywe ruchu.
// Wszystko liczone z czasu `t` (sekundy), więc każda klatka jest powtarzalna.

import { pl } from '../../src/i18n/pl';

export type Format = 'h' | 'v';

export const FPS = 30;
export const DURATION = 27;
export const SIZE: Record<Format, { w: number; h: number }> = {
  h: { w: 1920, h: 1080 },
  v: { w: 1080, h: 1920 },
};

export const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
export const ramp = (t: number, a: number, b: number) => clamp01((t - a) / (b - a));
export const smooth = (x: number) => x * x * (3 - 2 * x);
export const easeOut = (x: number) => 1 - (1 - x) ** 3;
export const easeInOut = (x: number) => (x < 0.5 ? 4 * x ** 3 : 1 - (-2 * x + 2) ** 3 / 2);
export const lerp = (a: number, b: number, k: number) => a + (b - a) * k;

/** 0 → 1 przez `fade` s od `a`, potem 1 → 0 przez `fade` s przed `b`. */
export const visible = (t: number, a: number, b: number, fade = 0.4) =>
  Math.min(ramp(t, a, a + fade), 1 - ramp(t, b - fade, b));

/** Granice scen (s). */
export const S = {
  wave: 0,
  route: 4.2,
  live: 8.5,
  train: 11.6,
  poland: 17.0,
  promise: 21.0,
  end: 24.0,
} as const;

/** Fala: sekundy od wyjścia (20:25) w funkcji czasu wideo. */
export const WAVE_MAX = 60 * 60;
export const waveAt = (t: number) => WAVE_MAX * smooth(ramp(t, 0.6, 3.9));

/** Zegar rozkładu w scenach z pojazdami (s od północy). */
export const LIVE_FROM = 8.4;
export const FOLLOW_START = 9.0;
/** Koniec jazdy: kropka stoi na Katedrze. */
export const FOLLOW_END = 11.0;
/** Pauza na Katedrze przed sceną pociągu. */
export const FOLLOW_HOLD = 0.6;
/** Tempo zegara podczas śledzenia (s rozkładu / s wideo). */
export const FOLLOW_RATE = 130;

export const busClock = (t: number, focusAt: number) => {
  if (t <= FOLLOW_START) return focusAt;
  if (t <= FOLLOW_END) return focusAt + (t - FOLLOW_START) * FOLLOW_RATE;
  // Trzymaj rozkład na przyjeździe pod Katedrę przez FOLLOW_HOLD.
  return focusAt + (FOLLOW_END - FOLLOW_START) * FOLLOW_RATE;
};

/** Postęp pociągu IC Wrocław → Warszawa w scenie kolejowej (0…1). */
export const railProgress = (t: number) => easeInOut(ramp(t, S.train + 0.4, S.poland - 0.4));

const L = pl.landing;

export interface Copy {
  at: number;
  to: number;
  title: string[];
  sub: string;
}

export function copyFor(cities: number): Copy[] {
  return [
    { at: 0.25, to: 4.0, title: ['Ze Sky Tower', 'pod Katedrę?'], sub: 'Kilometr sprawdza wszystkie kursy MPK Wrocław.' },
    { at: 4.3, to: 8.2, title: ['Trasę liczy', 'Twój telefon.'], sub: 'Pełny rozkład jest zapisany w aplikacji.' },
    {
      at: 8.6,
      to: 11.5,
      title: ['Śledzenie kursu', 'w powiadomieniu.'],
      sub: 'Na mapie widzisz tramwaj, a w powiadomieniu kolejny przystanek.',
    },
    {
      at: 11.7,
      to: 16.7,
      title: ['To może teraz', 'do Warszawy?'],
      sub: 'Pociągi dalekobieżne z opóźnieniami, udogodnieniami i komunikatami PKP.',
    },
    {
      at: 17.1,
      to: 20.7,
      title: ['Komunikacja', `w ${cities} miastach.`],
      sub: 'Do tego pociągi w całej Polsce, z opóźnieniami i komunikatami PKP.',
    },
  ];
}

export const PROMISE = [L.promise.ads, L.promise.free, L.promise.forever];
export const CLOSING = L.footer.tagline;
export const NOTIFY = pl.notification;
export const SITE = 'kilometr.app';
export const PLATFORMS = `${L.install.android} · ${L.install.ios}`;
export const ATTRIBUTION = 'Mapa © OpenStreetMap, OpenFreeMap · Rozkład MPK: UM Wrocław';
export const LIVE_NOTE = 'Pozycje pojazdów według rozkładu';
