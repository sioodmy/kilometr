// Formatowanie czasu i odległości dla powiadomień. Trzymamy je w jednym
// miejscu, bo ta sama liczba występuje w kilku kontekstach (tray, Dynamic
// Island, pasek postępu) i różne sformułowania wyglądają jak błąd.
//
// Zasada: „za 4 min” w odliczaniu (zawsze mała litera, bez wielokropka),
// „14:32” w bezwzględnych godzinach, liczby zawsze w tablicach.

/** Polska odmiana przez liczebniki: 1 minuta / 2 minuty / 5 minut. */
export function plural(n: number, one: string, few: string, many: string): string {
  const abs = Math.abs(Math.round(n));
  if (abs === 1) return one;
  const last = abs % 10;
  const teen = abs % 100;
  if (last >= 2 && last <= 4 && (teen < 12 || teen > 14)) return few;
  return many;
}

export function minutesText(min: number): string {
  const m = Math.max(0, Math.round(min));
  return `${m} ${plural(m, 'minuta', 'minuty', 'minut')}`;
}

export function minutesShort(min: number): string {
  return `${Math.max(0, Math.round(min))} min`;
}

/** Odliczanie do odjazdu. Prawdziwe „teraz”, a nie „za 0 min”. */
export function countdownText(sec: number): string {
  const s = Math.round(sec);
  if (s <= 45) return 'odjazd teraz';
  const min = Math.round(s / 60);
  if (min < 60) return `za ${min} ${plural(min, 'minutę', 'minuty', 'minut')}`;
  const h = Math.floor(min / 60);
  const rest = min % 60;
  return rest === 0
    ? `za ${h} ${plural(h, 'godzinę', 'godziny', 'godzin')}`
    : `za ${h} ${plural(h, 'godzinę', 'godziny', 'godzin')} ${rest} ${plural(rest, 'minutę', 'minuty', 'minut')}`;
}

/** Bez „za” — do tytułów typu „4 min do odjazdu”. */
export function untilText(sec: number): string {
  const s = Math.round(sec);
  if (s <= 45) return 'odjazd teraz';
  const min = Math.round(s / 60);
  return `${min} ${plural(min, 'minuta', 'minuty', 'minut')}`;
}

/** Opóźnienie kursu: „+6 min”, „punktualnie”, „−2 min”. */
export function delayText(delayMin: number): string {
  if (delayMin >= 1) return `+${Math.round(delayMin)} min`;
  if (delayMin <= -1) return `−${Math.abs(Math.round(delayMin))} min`;
  return 'punktualnie';
}

export function formatClock(sec: number): string {
  const s = ((Math.round(sec) % 86400) + 86400) % 86400;
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

export function formatDistance(meters: number | null | undefined): string {
  if (meters == null || !isFinite(meters) || meters < 0) return '';
  if (meters < 50) return `${Math.max(5, Math.round(meters / 5) * 5)} m`;
  if (meters < 1000) return `${Math.round(meters / 10) * 10} m`;
  return `${(meters / 1000).toFixed(1)} km`;
}

export function nowSecOfDay(d: Date = new Date()): number {
  return d.getHours() * 3600 + d.getMinutes() * 60 + d.getSeconds();
}

/**
 * Sekundy od północy (mogą przekroczyć 86400 przy kursorze na jutrzejszy
 * rozkład — patrz engine.ts, dayOffsetSec) → bezwzględny znacznik ms.
 * Bez tej normalizacji odliczanie po północy pokazuje godziny wczoraj.
 */
export function toAbsoluteMs(sec: number, now: Date = new Date()): number {
  const midnight = new Date(now);
  midnight.setHours(0, 0, 0, 0);
  return midnight.getTime() + Math.round(sec) * 1000;
}

export function clamp01(v: number): number {
  if (!isFinite(v)) return 0;
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/** Zaokrąglone do 1000 — dokładność, której nie potrzeba, tylko noise w logach. */
export function toPermille(v: number): number {
  return Math.round(clamp01(v) * 1000);
}

/** '14:32' → liczba sekund od północy. Odwrotność formatClock. */
export function parseClock(hm: string | undefined | null): number | null {
  if (!hm) return null;
  const m = /^(\d{1,2}):(\d{2})/.exec(hm);
  if (!m) return null;
  return Number(m[1]) * 3600 + Number(m[2]) * 60;
}
