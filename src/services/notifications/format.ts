// Formatowanie czasu i odległości dla powiadomień.
//
// Tu są WYŁĄCZNIE operacje językowo-neutralne: czasy bezwzględne, jednostki
// metryczne i czysta arytmetyka. Wszystko, co ma być po polsku, angielsku,
// niemiecku lub ukraińsku (jednostki po „min", liczby mnogie, nazwy faz),
// żyje w słownikach `src/i18n` — patrz `buildPhaseCopy` w `content.ts`.
//
// Zasada: „14:32" w treści powiadomienia, a liczbę typu „4 min" rysuje zegar
// systemowy przez `setUsesChronometer`. Dzięki temu tekst nie zestarzeje się
// przy pierwszym odświeżeniu.

/** Sekundy od północy → 'HH:MM'. */
export function formatClock(sec: number): string {
  const s = ((Math.round(sec) % 86400) + 86400) % 86400;
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/**
 * 'HH:MM' z bezwzględnego znacznika ms — do tekstu w powiadomieniu, nie do
 * arytmetyki.
 */
export function clockFromMs(ms: number): string {
  if (!isFinite(ms) || ms <= 0) return '';
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/** 'HH:MM' → liczba sekund od północy. Odwrotność formatClock. */
export function parseClock(hm: string | undefined | null): number | null {
  if (!hm) return null;
  const m = /^(\d{1,2}):(\d{2})/.exec(hm);
  if (!m) return null;
  return Number(m[1]) * 3600 + Number(m[2]) * 60;
}

export function nowSecOfDay(d: Date = new Date()): number {
  return d.getHours() * 3600 + d.getMinutes() * 60 + d.getSeconds();
}

const DAY_SEC = 86400;
const DAY_MS = DAY_SEC * 1000;

/**
 * Sekundy od północy (mogą przekroczyć 86400 przy kursorze na jutrzejszy
 * rozkład — patrz engine.ts, dayOffsetSec) → bezwzględny znacznik ms.
 *
 * Wybieramy wystąpienie najbliższe `now`, a nie to z dzisiejszego dnia.
 * Bez tego podróż o 23:58 oglądana o 00:03 dostałaby „dziś 23:58", czyli
 * ETA 24 godziny zamiast „3 minuty temu".
 */
export function toAbsoluteMs(sec: number, now: Date = new Date()): number {
  const midnight = new Date(now);
  midnight.setHours(0, 0, 0, 0);
  const base = midnight.getTime() + Math.round(sec) * 1000;
  const diff = base - now.getTime();
  if (diff < -DAY_MS / 2) return base + DAY_MS;
  if (diff > DAY_MS / 2) return base - DAY_MS;
  return base;
}

export function clamp01(v: number): number {
  if (!isFinite(v)) return 0;
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/** Zaokrąglone do 1000 — dokładność, której nie potrzeba, tylko noise w logach. */
export function toPermille(v: number): number {
  return Math.round(clamp01(v) * 1000);
}

/** '320 m', '1.2 km' — międzynarodowe symbole jednostek, bez odmiany. */
export function formatDistance(meters: number | null | undefined): string {
  if (meters == null || !isFinite(meters) || meters < 0) return '';
  if (meters < 50) return `${Math.max(5, Math.round(meters / 5) * 5)} m`;
  if (meters < 1000) return `${Math.round(meters / 10) * 10} m`;
  return `${(meters / 1000).toFixed(1)} km`;
}