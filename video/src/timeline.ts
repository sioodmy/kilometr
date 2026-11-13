// Oś czasu launch video: długość, teksty scen i pomocnicze krzywe ruchu.
// Wszystko liczone z czasu `t` (sekundy), więc każda klatka jest powtarzalna.

import { pl } from '../../src/i18n/pl';

export type Format = 'h' | 'v';

export const FPS = 30;
export const DURATION = 42;
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
  route: 6.5,
  offline: 12.5,
  live: 17.5,
  bench: 23.5,
  poland: 28.5,
  promise: 33.5,
  end: 37.5,
} as const;

/** Fala: sekundy od wyjścia (20:25) w funkcji czasu wideo. */
export const WAVE_MAX = 60 * 60;
export const waveAt = (t: number) => WAVE_MAX * smooth(ramp(t, 1.3, 6.1));

/** Zegar rozkładu w scenach z pojazdami (s od północy). */
export const LIVE_FROM = 17.3;
export const FOLLOW_START = 18.3;
export const FOLLOW_END = 23.2;
export const busClock = (t: number, focusAt: number) => {
  // Śledzenie: 7 min jazdy tramwaju w 5 s, potem szybszy podgląd całego miasta.
  const follow = focusAt + (t - FOLLOW_START) * 84;
  if (t <= FOLLOW_END) return follow;
  return focusAt + (FOLLOW_END - FOLLOW_START) * 84 + (t - FOLLOW_END) * 220;
};

/** Wynik z README.md („Wyniki na tle jakdojade”, server/scripts/compare-jakdojade.ts). */
export const BENCH = { total: 72, wins: 46, ties: 24, losses: 2 };

const L = pl.landing;

export interface Copy {
  at: number;
  to: number;
  title: string[];
  sub: string;
}

export function copyFor(cities: number): Copy[] {
  return [
    { at: 0.4, to: 6.3, title: ['Ze Sky Tower', 'na PWr?'], sub: 'Kilometr sprawdza wszystkie kursy MPK Wrocław.' },
    { at: 6.7, to: 12.3, title: ['Trasę liczy', 'Twój telefon.'], sub: 'Pełny rozkład jest zapisany w aplikacji.' },
    {
      at: 12.7,
      to: 17.3,
      title: ['Działa w trybie', 'samolotowym.'],
      sub: 'Mapa i rozkład są w telefonie, więc zasięg nie jest potrzebny.',
    },
    {
      at: 17.7,
      to: 23.3,
      title: ['Przypomni Ci,', 'kiedy wysiąść.'],
      sub: 'Na mapie widzisz tramwaj, a w powiadomieniu kolejny przystanek.',
    },
    {
      at: 23.7,
      to: 28.3,
      title: ['Szybszy dojazd', `w ${BENCH.wins} z ${BENCH.total} tras.`],
      sub: 'Porównanie z jakdojade na tych samych trasach we Wrocławiu.',
    },
    {
      at: 28.7,
      to: 33.3,
      title: ['Komunikacja', `w ${cities} miastach.`],
      sub: 'Do tego pociągi w całej Polsce, z opóźnieniami i komunikatami PKP.',
    },
  ];
}

export const PROMISE = [L.promise.ads, L.promise.free, L.promise.forever];
export const CLOSING = L.closing.title;
export const NOTIFY = pl.notification;
export const SITE = 'sioodmy.github.io/kilometr';
export const PLATFORMS = `${L.install.android} · ${L.install.ios}`;
export const BENCH_LABELS = { wins: 'Kilometr szybciej', ties: 'remis', losses: 'jakdojade szybciej' };
export const BENCH_NOTE = 'Test: server/scripts/compare-jakdojade.ts, wtorek, sobota i niedziela.';
export const ATTRIBUTION = 'Mapa © OpenStreetMap, OpenFreeMap · Rozkład MPK: UM Wrocław';
export const LIVE_NOTE = 'Pozycje pojazdów według rozkładu';
