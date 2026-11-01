// Lokalny indeks miejsc (POI) aktywnego miasta na telefonie.
// Zasilany ze snapshotów budowanych w potoku rozkładu (tabela pois w bazie SQLite).
// Dzięki temu "sky tower", "zoo", "apteka" podpowiadają się natychmiast i w 100% offline,
// bez czekania na sieć i bez obciążania Overpass API z telefonu użytkownika.

import { distanceMeters, normalizePolish } from '../gtfs/geo';
import { fuzzyMatchBatch } from '../gtfs/fuzzy';
import type { Suggestion } from '../types/models';
import { findPoiCandidates, type PoiRow } from './gtfsDatabase';

/**
 * Kompatybilność wsteczna - dawniej odpalało Overpass w tle,
 * teraz POI są wgrane bezpośrednio do bazy SQLite miasta.
 */
export function ensurePoiIndex(): void {}

/**
 * Wyszukiwarka POI: kandydaci z bazy po SQLite LIKE, ranking
 * w JS/Rust (fuzzyMatchBatch + kara za dystans od użytkownika).
 */
export async function searchPois(
  query: string,
  userLat?: number,
  userLon?: number,
  limit = 8,
): Promise<Suggestion[]> {
  const normQ = normalizePolish(query.trim());
  if (!normQ || normQ.length < 2) return [];
  const hasPos = userLat !== undefined && userLon !== undefined;

  const candidates = await findPoiCandidates(normQ).catch(() => [] as PoiRow[]);
  const matches = fuzzyMatchBatch(normQ, candidates.map((row) => row.name));
  const scored: { row: PoiRow; score: number; distM?: number }[] = [];
  for (let i = 0; i < candidates.length; i++) {
    const row = candidates[i];
    const match = matches[i];
    if (!match?.matches) continue;
    let distM: number | undefined;
    let score = match.score;
    if (hasPos && userLat !== undefined && userLon !== undefined) {
      distM = Math.round(distanceMeters(userLat, userLon, row.lat, row.lon));
      score -= Math.min(40, distM / 250);
    }
    scored.push({ row, score, distM });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit).map(({ row, distM }) => ({
    id: `poi-osm-${row.osm_id.replace('/', '-')}`,
    title: row.name,
    address: row.address,
    kind: 'place' as const,
    category: row.category,
    lat: row.lat,
    lon: row.lon,
    distanceM: distM,
  }));
}
