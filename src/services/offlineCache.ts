import { kvGet, kvSet } from './storage';

import type { Connection, RouteQuery, Suggestion } from '../types/models';

/** Szybki heartbeat: czy backend żyje (do wykrywania powrotu sieci). */
export async function pingBackend(timeoutMs = 2500): Promise<boolean> {
  // Tryb offline-first: lokalny GTFS w SQLite znaczy "działa".
  try {
    const { getGtfsStats } = await import('./gtfsDatabase');
    const stats = await getGtfsStats();
    return stats.stops > 0;
  } catch {
    return false;
  }
}

// Offline-first cache (kv-store): trasy, podpowiedzi, recent.
// Gdy backend nie odpowiada, ekrany serwują ostatnie prawdziwe dane
// zamiast pustki — a po powrocie sieci cicho podmieniają na świeże.

const KEYS = {
  connections: 'kilometr.cache.connections.v1',
  suggestions: 'kilometr.cache.suggestions.v1',
  recent: 'kilometr.cache.recent.v1',
  location: 'kilometr.cache.location.v1',
} as const;

const CONNECTIONS_TTL_MS = 6 * 3600 * 1000;
const SUGGESTIONS_TTL_MS = 7 * 24 * 3600 * 1000;
const MAX_SUGGESTION_ENTRIES = 60;
const MAX_CACHED_QUERIES = 25;

interface Stamped<T> {
  savedAt: number;
  data: T;
}

async function readJSON<T>(key: string): Promise<T | null> {
  try {
    const raw = await kvGet(key);
    if (!raw) return null;
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function nowSec(): number {
  const d = new Date();
  return d.getHours() * 3600 + d.getMinutes() * 60 + d.getSeconds();
}

// ─── Połączenia ──────────────────────────────────────────────────────────────

export function connectionCacheKey(q: RouteQuery): string {
  const r = (n: number) => Math.round(n * 1000) / 1000;
  return [
    r(q.fromLat),
    r(q.fromLon),
    r(q.toLat),
    r(q.toLon),
    q.toId ?? '',
    q.maxTransfers ?? '',
    q.modes ?? '',
    q.maxWalkM ?? '',
    q.anchorStopId ?? '',
  ].join('|');
}

export async function saveConnections(query: RouteQuery, list: Connection[]): Promise<void> {
  try {
    const all = (await readJSON<Record<string, Stamped<Connection[]>>>(KEYS.connections)) ?? {};
    all[connectionCacheKey(query)] = { savedAt: Date.now(), data: list };
    // LRU: wywal najstarsze nad limit
    const keys = Object.keys(all);
    if (keys.length > MAX_CACHED_QUERIES) {
      keys
        .sort((a, b) => all[a].savedAt - all[b].savedAt)
        .slice(0, keys.length - MAX_CACHED_QUERIES)
        .forEach((k) => delete all[k]);
    }
    await kvSet(KEYS.connections, JSON.stringify(all));
  } catch {
    // cache best-effort
  }
}

export async function loadConnections(query: RouteQuery): Promise<Connection[] | null> {
  const all = await readJSON<Record<string, Stamped<Connection[]>>>(KEYS.connections);
  const entry = all?.[connectionCacheKey(query)];
  if (!entry || Date.now() - entry.savedAt > CONNECTIONS_TTL_MS) return null;
  if (!Array.isArray(entry.data) || entry.data.length === 0) return null;
  return entry.data;
}

/** Szuka połączenia po id we WSZYSTKICH cachowanych zapytaniach (dla szczegółów offline). */
export async function findCachedConnection(id: string): Promise<Connection | null> {
  const all = await readJSON<Record<string, Stamped<Connection[]>>>(KEYS.connections);
  if (!all) return null;
  for (const key of Object.keys(all)) {
    const entry = all[key];
    if (Date.now() - entry.savedAt > CONNECTIONS_TTL_MS) continue;
    const hit = entry.data.find((c) => c.id === id);
    if (hit) return hit;
  }
  return null;
}

/**
 * Odświeża czasy względne na bazie absolutnego departureSec.
 * Live wyłączamy — offline nie ma realtime, pokazujemy wg rozkładu.
 */
export function rehydrateConnections(list: Connection[]): Connection[] {
  const now = nowSec();
  return list.map((c) => ({
    ...c,
    departInMin: c.departureSec > 0 ? Math.max(0, Math.round((c.departureSec - now) / 60)) : c.departInMin,
    live: false,
  }));
}

// ─── Podpowiedzi ─────────────────────────────────────────────────────────────

function normQuery(q: string): string {
  return q.trim().toLowerCase().slice(0, 60);
}

export async function saveSuggestions(query: string, results: Suggestion[]): Promise<void> {
  const key = normQuery(query);
  if (!key || results.length === 0) return;
  try {
    const all = (await readJSON<Record<string, Stamped<Suggestion[]>>>(KEYS.suggestions)) ?? {};
    all[key] = { savedAt: Date.now(), data: results };
    const keys = Object.keys(all);
    if (keys.length > MAX_SUGGESTION_ENTRIES) {
      keys
        .sort((a, b) => all[a].savedAt - all[b].savedAt)
        .slice(0, keys.length - MAX_SUGGESTION_ENTRIES)
        .forEach((k) => delete all[k]);
    }
    await kvSet(KEYS.suggestions, JSON.stringify(all));
  } catch {
    // best-effort
  }
}

/** Offline: dokładny query, a jak brak — najdłuższy zapamiętany prefiks. */
export async function loadSuggestions(query: string): Promise<Suggestion[]> {
  const key = normQuery(query);
  if (!key) return [];
  const all = await readJSON<Record<string, Stamped<Suggestion[]>>>(KEYS.suggestions);
  if (!all) return [];
  const fresh = (e: Stamped<Suggestion[]> | undefined) =>
    e && Date.now() - e.savedAt <= SUGGESTIONS_TTL_MS ? e.data : null;
  const exact = fresh(all[key]);
  if (exact) return exact;
  // Prefiks: "lid" → wyniki dla "lidl" przefiltrowane po tytule
  const candidates = Object.keys(all)
    .filter((k) => k.startsWith(key) && k.length > key.length)
    .sort((a, b) => a.length - b.length);
  for (const k of candidates.slice(0, 3)) {
    const data = fresh(all[k]);
    if (data) {
      const low = key;
      const filtered = data.filter(
        (s) =>
          s.title.toLowerCase().includes(low) ||
          s.address.toLowerCase().includes(low),
      );
      if (filtered.length > 0) return filtered;
    }
  }
  return [];
}

export async function saveRecent(items: Suggestion[]): Promise<void> {
  try {
    await kvSet(KEYS.recent, JSON.stringify({ savedAt: Date.now(), data: items }));
  } catch {
    // best-effort
  }
}

export async function loadRecent(): Promise<Suggestion[]> {
  const entry = await readJSON<Stamped<Suggestion[]>>(KEYS.recent);
  if (!entry || Date.now() - entry.savedAt > SUGGESTIONS_TTL_MS) return [];
  return Array.isArray(entry.data) ? entry.data : [];
}

export async function addRecentSuggestion(item: Suggestion): Promise<Suggestion[]> {
  if (!item || !item.id || item.id === '__gps') return loadRecent();
  try {
    const current = await loadRecent();
    const updated = [
      item,
      ...current.filter((x) => x.id !== item.id && (x.title !== item.title || x.lat !== item.lat || x.lon !== item.lon)),
    ].slice(0, 10);
    await saveRecent(updated);
    return updated;
  } catch {
    return [];
  }
}

// ─── Ostatnia znana lokalizacja (ulica z reverse-geocode) ────────────────────

export interface LastLocation {
  title: string;
  address: string;
  lat: number;
  lon: number;
  stopId?: string;
  savedAt: number;
}

export async function saveLastLocation(loc: {
  title: string;
  address: string;
  lat: number;
  lon: number;
  stopId?: string;
}): Promise<void> {
  try {
    await kvSet(
      KEYS.location,
      JSON.stringify({ ...loc, savedAt: Date.now() }),
    );
  } catch {
    // best-effort
  }
}

export async function loadLastLocation(): Promise<LastLocation | null> {
  const entry = await readJSON<LastLocation>(KEYS.location);
  if (!entry || typeof entry.lat !== 'number') return null;
  return entry;
}
