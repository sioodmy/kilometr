// Formatowanie czasu i odleglosci dla powiadomien.
//
// Tu sa wylacznie operacje jezykowo neutralne: czasy bezwzgledne, jednostki
// metryczne i czysta arytmetyka. Wszystko, co ma byc po polsku, angielsku,
// niemiecku lub ukrainsku (jednostki po min, liczby mnogie, nazwy faz),
// zyje w slownikach src/i18n, patrz buildPhaseCopy w content.ts.
//
// Zasada: 14:32 w tresci powiadomienia, a liczbe typu 4 min rysuje zegar
// systemowy przez setUsesChronometer. Dzieki temu tekst nie zestarzeje sie
// przy pierwszym odswiezeniu.

import { warsawNow, shiftWarsawDate } from '../../gtfs/geo';
import { sharedTimeMs } from '../../sharing/progress';

const WARSAW_TIME_FMT = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/Warsaw',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

/** Sekundy od polnocy -> 'HH:MM'. */
export function formatClock(sec: number): string {
  const s = ((Math.round(sec) % 86400) + 86400) % 86400;
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/**
 * 'HH:MM' z bezwzglednego znacznika ms w strefie Europe/Warsaw.
 */
export function clockFromMs(ms: number): string {
  if (!isFinite(ms) || ms <= 0) return '';
  return WARSAW_TIME_FMT.format(new Date(ms));
}

/** 'HH:MM' -> liczba sekund od polnocy. Odwrotnosc formatClock. */
export function parseClock(hm: string | undefined | null): number | null {
  if (!hm) return null;
  const m = /^(\d{1,2}):(\d{2})/.exec(hm);
  if (!m) return null;
  return Number(m[1]) * 3600 + Number(m[2]) * 60;
}

const DAY_SEC = 86400;
const AMBIGUOUS_WINDOW_MS = 14 * 3600 * 1000;

/**
 * Sekundy od polnocy (moga przekroczyc 86400 przy kursorze na jutrzejszy
 * rozklad, patrz engine.ts, dayOffsetSec) -> bezwzgledny znacznik ms.
 *
 * Pelne doby w sec wynikaja z kursora daty (jutro = +86400, wczoraj =
 * -86400), wiec liczymy je wprost z kalendarza Europe/Warsaw. Dla wartosci z jednej doby
 * wybieramy wystapienie najblizsze now: podroz o 23:58 ogladana o 00:03
 * ma byc 3 minuty temu, a nie ETA za 24 godziny.
 */
export function toAbsoluteMs(sec: number, now: Date = new Date()): number {
  const s = Math.round(sec);
  const dayShift = Math.floor(s / DAY_SEC);
  const remSec = s - dayShift * DAY_SEC;
  const w = warsawNow(now);
  const target = dayShift === 0 ? w : shiftWarsawDate(w, dayShift);
  const base = sharedTimeMs(target.isoDate, remSec);
  if (Math.abs(sec) >= DAY_SEC) return base;
  const diff = base - now.getTime();
  if (diff < -AMBIGUOUS_WINDOW_MS) {
    const next = shiftWarsawDate(w, dayShift + 1);
    return sharedTimeMs(next.isoDate, remSec);
  }
  if (diff > AMBIGUOUS_WINDOW_MS) {
    const prev = shiftWarsawDate(w, dayShift - 1);
    return sharedTimeMs(prev.isoDate, remSec);
  }
  return base;
}

/**
 * Absolutny odjazd kursu najblizszy now, bez offsetu dnia serwisowego.
 *
 * toAbsoluteMs zostawia 24:xx w dzisiejszej dobie, wiec po polnocy kurs
 * 24:xx wypadaby jutro. Plan sledzenia bierzemy z doby serwisowej najblizszej
 * zegarowi: po polnocy 24:xx nalezy jeszcze do wczorajszej. Uzywamy dokladnego
 * czasu Europe/Warsaw z sharedTimeMs, dzieki czemu zmiana czasu DST
 * nie przesuwa kursu o godzine.
 */
export function nearestDepartureMs(sec: number, now: Date = new Date()): number {
  const s = Math.round(sec);
  const dayShift = s < 0 ? Math.floor(s / DAY_SEC) : 0;
  const remSec = s - dayShift * DAY_SEC;
  const w = warsawNow(now);
  const target = dayShift === 0 ? w : shiftWarsawDate(w, dayShift);
  const base = sharedTimeMs(target.isoDate, remSec);
  const diff = base - now.getTime();
  if (diff < -AMBIGUOUS_WINDOW_MS) {
    const next = shiftWarsawDate(w, dayShift + 1);
    return sharedTimeMs(next.isoDate, remSec);
  }
  if (diff > AMBIGUOUS_WINDOW_MS) {
    const prev = shiftWarsawDate(w, dayShift - 1);
    return sharedTimeMs(prev.isoDate, remSec);
  }
  return base;
}

export function clamp01(v: number): number {
  if (!isFinite(v)) return 0;
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/** 320 m, 1.2 km: miedzynarodowe symbole jednostek, bez odmiany. */
export function formatDistance(meters: number | null | undefined): string {
  if (meters == null || !isFinite(meters) || meters < 0) return '';
  if (meters < 50) return `${Math.max(5, Math.round(meters / 5) * 5)} m`;
  if (meters < 1000) return `${Math.round(meters / 10) * 10} m`;
  return `${(meters / 1000).toFixed(1)} km`;
}
