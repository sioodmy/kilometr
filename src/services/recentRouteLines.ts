// Linie, którymi użytkownik jechał / które widział w wynikach tras.
// Zapis przy każdym cache'u połączeń + przy odczycie z zapisanych tras.
import { kvGet, kvSet } from './storage';
import type { Connection, Leg, SavedRoute } from '../types/models';

const KEY = 'kilometr.recent_route_lines.v1';
const TWO_WEEKS_MS = 14 * 24 * 3600 * 1000;
const MAX_LINES = 80;

type LineStamp = Record<string, number>;

function normalizeLine(line: string): string {
  return line.trim().toUpperCase();
}

export function linesFromConnections(list: Connection[]): string[] {
  const out = new Set<string>();
  for (const c of list) {
    for (const leg of c.legs ?? []) {
      const line = (leg as Leg).line;
      if (!line || (leg as Leg).mode === 'walk') continue;
      const n = normalizeLine(line);
      if (n) out.add(n);
    }
  }
  return [...out];
}

async function readStamps(): Promise<LineStamp> {
  try {
    const raw = await kvGet(KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as LineStamp;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

async function writeStamps(stamps: LineStamp): Promise<void> {
  const cutoff = Date.now() - TWO_WEEKS_MS;
  const entries = Object.entries(stamps)
    .filter(([, ts]) => typeof ts === 'number' && ts >= cutoff)
    .sort((a, b) => b[1] - a[1])
    .slice(0, MAX_LINES);
  await kvSet(KEY, JSON.stringify(Object.fromEntries(entries)));
}

/** Dopisz linie z właśnie sprawdzonej listy połączeń. */
export async function rememberRouteLines(
  lines: string[],
  seenAt: number = Date.now(),
): Promise<void> {
  if (lines.length === 0) return;
  const stamps = await readStamps();
  for (const raw of lines) {
    const line = normalizeLine(raw);
    if (!line) continue;
    stamps[line] = Math.max(stamps[line] ?? 0, seenAt);
  }
  await writeStamps(stamps);
}

export async function rememberLinesFromConnections(
  list: Connection[],
  seenAt: number = Date.now(),
): Promise<void> {
  await rememberRouteLines(linesFromConnections(list), seenAt);
}

/** Uzupełnij pamięć z zapisanych tras (w oknie 2 tygodni). */
export async function rememberLinesFromSavedRoutes(routes: SavedRoute[]): Promise<void> {
  const cutoff = Date.now() - TWO_WEEKS_MS;
  const stamps = await readStamps();
  let changed = false;
  for (const route of routes) {
    if (!route?.savedAt || route.savedAt < cutoff || !route.connection) continue;
    for (const line of linesFromConnections([route.connection])) {
      const prev = stamps[line] ?? 0;
      if (route.savedAt > prev) {
        stamps[line] = route.savedAt;
        changed = true;
      }
    }
  }
  if (changed) await writeStamps(stamps);
}

/** Uzupełnij z cache połączeń (także starszych niż TTL ekranu wyników). */
export async function rememberLinesFromConnectionCache(): Promise<void> {
  try {
    const raw = await kvGet('kilometr.cache.connections.v1');
    if (!raw) return;
    const all = JSON.parse(raw) as Record<string, { savedAt?: number; data?: Connection[] }>;
    if (!all || typeof all !== 'object') return;
    const cutoff = Date.now() - TWO_WEEKS_MS;
    const stamps = await readStamps();
    let changed = false;
    for (const entry of Object.values(all)) {
      const savedAt = entry?.savedAt;
      if (typeof savedAt !== 'number' || savedAt < cutoff || !Array.isArray(entry.data)) continue;
      for (const line of linesFromConnections(entry.data)) {
        if ((stamps[line] ?? 0) < savedAt) {
          stamps[line] = savedAt;
          changed = true;
        }
      }
    }
    if (changed) await writeStamps(stamps);
  } catch {
    // best-effort
  }
}

/** Zbierz linie z cache + zapisanych tras, potem oddaj listę z okna 2 tygodni. */
export async function loadRecentRouteLines(
  withinMs: number = TWO_WEEKS_MS,
): Promise<string[]> {
  await rememberLinesFromConnectionCache();
  try {
    const raw = await kvGet('kilometr.saved_routes');
    if (raw) {
      const routes = JSON.parse(raw) as SavedRoute[];
      if (Array.isArray(routes)) await rememberLinesFromSavedRoutes(routes);
    }
  } catch {
    // ignore
  }
  return getRecentRouteLines(withinMs);
}

/** Linie widziane w trasach w ostatnich 14 dniach. */
export async function getRecentRouteLines(
  withinMs: number = TWO_WEEKS_MS,
): Promise<string[]> {
  const stamps = await readStamps();
  const cutoff = Date.now() - withinMs;
  return Object.entries(stamps)
    .filter(([, ts]) => ts >= cutoff)
    .sort((a, b) => b[1] - a[1])
    .map(([line]) => line);
}

export function newsTouchesLines(item: { lines: string[]; title: string; description: string }, lines: Set<string>): boolean {
  if (lines.size === 0) return false;
  for (const raw of item.lines) {
    if (lines.has(normalizeLine(raw))) return true;
  }
  const hay = `${item.title} ${item.description}`;
  for (const line of lines) {
    const escaped = line.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // Linie MPK to cyfry / litery (N, D, A) — bez unicode property (Hermes).
    const re = new RegExp(`(?:^|[^0-9A-Za-z])${escaped}(?![0-9A-Za-z])`, 'i');
    if (re.test(hay)) return true;
  }
  return false;
}
