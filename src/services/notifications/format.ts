// Formatowanie czasu i odległości dla powiadomień.
//
// Tu są WYŁĄCZNIE operacje językowo-neutralne: czasy bezwzględne, jednostki
// metryczne i czysta arytmetyka. Wszystko, co ma być po polsku, angielsku,
// niemiecku lub ukraińsku (jednostki po „min", liczby mnogie, nazwy faz),
// żyje w słownikach `src/i18n` - patrz `buildPhaseCopy` w `content.ts`.
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
 * 'HH:MM' z bezwzględnego znacznika ms - do tekstu w powiadomieniu, nie do
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

const DAY_SEC = 86400;
const DAY_MS = DAY_SEC * 1000;

/**
 * Sekundy od północy (mogą przekroczyć 86400 przy kursorze na jutrzejszy
 * rozkład - patrz engine.ts, dayOffsetSec) → bezwzględny znacznik ms.
 *
 * Pełne doby w `sec` wynikają z kursoru daty (jutro = +86400, wczoraj =
 * -86400), więc liczymy je wprost z midnight. Dla wartości z jednej doby
 * wybieramy wystąpienie najbliższe `now`: podróż o 23:58 oglądana o 00:03
 * ma być "3 minuty temu", a nie ETA za 24 godziny.
 */
export function toAbsoluteMs(sec: number, now: Date = new Date()): number {
  const s = Math.round(sec);
  // GTFS 24:xx liczy się od początku TEJ doby serwisowej, nie od jutrzejszej:
  // w przeddzień zmiany czasu jutrzejszy start jest o 1 h obok.
  const dayShift = s < 0 ? Math.floor(s / DAY_SEC) : 0;
  const offsetMs = (s - dayShift * DAY_SEC) * 1000;
  const base = serviceDayStartMs(now, dayShift) + offsetMs;
  // Bez tego jutrzejszy kurs (sec >= 86400) po południu wracał jako dzisiejszy:
  // diff > 12h cofał go o dobę i tripMonitor widział "już dotarłeś".
  if (Math.abs(sec) >= DAY_SEC) return base;
  const diff = base - now.getTime();
  if (diff < -DAY_MS / 2) return serviceDayStartMs(now, dayShift + 1) + offsetMs;
  if (diff > DAY_MS / 2) return serviceDayStartMs(now, dayShift - 1) + offsetMs;
  return base;
}

/**
 * Absolutny odjazd kursu najbliższy `now`, bez offsetu dnia serwisowego.
 *
 * `toAbsoluteMs` zostawia 24:xx w dzisiejszej dobie, więc po północy kurs
 * 24:xx wypadał jutro. Plan śledzenia zapisujemy jako samo `HH:MM` i bierzemy
 * wystąpienie najbliższe zegarowi.
 */
export function nearestDepartureMs(sec: number, now: Date = new Date()): number {
  return toAbsoluteMs(Math.round(sec) % DAY_SEC, now);
}

/**
 * Początek doby GTFS: południe minus 12 h, nie północ. W dniu zmiany czasu
 * doba ma 23 albo 25 h i od północy wszystkie godziny wychodziły o 1 h obok.
 */
function serviceDayStartMs(now: Date, dayShift: number): number {
  const noon = new Date(now.getFullYear(), now.getMonth(), now.getDate() + dayShift, 12, 0, 0, 0);
  return noon.getTime() - DAY_MS / 2;
}

export function clamp01(v: number): number {
  if (!isFinite(v)) return 0;
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/** '320 m', '1.2 km' - międzynarodowe symbole jednostek, bez odmiany. */
export function formatDistance(meters: number | null | undefined): string {
  if (meters == null || !isFinite(meters) || meters < 0) return '';
  if (meters < 50) return `${Math.max(5, Math.round(meters / 5) * 5)} m`;
  if (meters < 1000) return `${Math.round(meters / 10) * 10} m`;
  return `${(meters / 1000).toFixed(1)} km`;
}
