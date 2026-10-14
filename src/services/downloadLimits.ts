// Limity dużych pobrań z R2 (mapa ~31 MB, rozkład ~40–80 MB).
// Chronią free tier przed wielokrotnym ściąganiem tego samego pakietu.
// Limit liczy się od udanego pobrania; nieudana próba nie blokuje retry.

import { kvGet, kvSet } from './storage';
import { getCity } from '../cities';
import { getActiveCityIdSync } from './cityStore';
import { getMeta, setMeta } from './gtfsDatabase';

/** Mapa OSM zmienia się wolno: raz na miesiąc wystarczy. */
export const MAP_DOWNLOAD_MIN_INTERVAL_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Rozkład MPK/KD bywa codzienny, ale pełna baza to dziesiątki MB.
 * Między pełnymi pobraniami min. 12 h, nawet gdy na serwerze jest nowsza wersja.
 */
export const TIMETABLE_DOWNLOAD_MIN_INTERVAL_MS = 12 * 60 * 60 * 1000;

const MAP_LAST_KEY = 'kilometr.offlineMap.lastDownloadAt';
const TIMETABLE_LAST_META = 'gtfs_last_download';

function mapKey(cityId?: string): string {
  const city = getCity(cityId ?? getActiveCityIdSync());
  // Legacy klucz Wrocławia bez sufiksu (kompat ze starymi instalacjami).
  return city.id === 'wroclaw' ? MAP_LAST_KEY : `${MAP_LAST_KEY}.${city.id}`;
}

export type DownloadGate =
  | { allowed: true }
  | { allowed: false; retryAfterMs: number };

function gateFrom(lastIso: string | null | undefined, minIntervalMs: number): DownloadGate {
  if (!lastIso) return { allowed: true };
  const last = Date.parse(lastIso);
  if (!Number.isFinite(last)) return { allowed: true };
  const elapsed = Date.now() - last;
  if (elapsed >= minIntervalMs) return { allowed: true };
  return { allowed: false, retryAfterMs: Math.max(0, minIntervalMs - elapsed) };
}

export async function getMapDownloadGate(cityId?: string): Promise<DownloadGate> {
  return gateFrom(await kvGet(mapKey(cityId)), MAP_DOWNLOAD_MIN_INTERVAL_MS);
}

export async function markMapDownloaded(cityId?: string): Promise<void> {
  await kvSet(mapKey(cityId), new Date().toISOString());
}

export async function getTimetableDownloadGate(_cityId?: string): Promise<DownloadGate> {
  // Limit jest per-baza: znacznik siedzi w tabeli meta per-miastowego SQLite,
  // więc parametr miasta jest celowo ignorowany (parzystość z getMapDownloadGate).
  try {
    // Nowy znacznik; fallback na datę importu, żeby po aktualizacji apki
    // istniejące instalacje nie odpalały od razu pełnego pobrania.
    const last =
      (await getMeta(TIMETABLE_LAST_META)) ?? (await getMeta('gtfs_imported_at'));
    return gateFrom(last, TIMETABLE_DOWNLOAD_MIN_INTERVAL_MS);
  } catch {
    return { allowed: true };
  }
}

export async function markTimetableDownloaded(): Promise<void> {
  await setMeta(TIMETABLE_LAST_META, new Date().toISOString());
}

/** Do UI: pełne dni w górę (1 = „jutro” / „1 dzień”). */
export function remainingDays(retryAfterMs: number): number {
  return Math.max(1, Math.ceil(retryAfterMs / (24 * 60 * 60 * 1000)));
}

/** Do UI: pełne godziny w górę. */
export function remainingHours(retryAfterMs: number): number {
  return Math.max(1, Math.ceil(retryAfterMs / (60 * 60 * 1000)));
}
