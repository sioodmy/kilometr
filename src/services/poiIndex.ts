// Lokalny indeks miejsc (POI) aktywnego miasta na telefonie.
// W miastach z osobną bazą POI korzysta z wieloźródłowego indeksu `poi_terms`
// (Overture + OSM + Wolt + CWOH + Wikidata), a w pozostałych miastach wraca
// do tabeli `pois` w bazie GTFS. Działa w 100% offline.

import { fuzzyMatch, fuzzyMatchBatch } from '../gtfs/fuzzy';
import { distanceMeters, normalizePolish } from '../gtfs/geo';
import type { Suggestion } from '../types/models';
import { getActiveCityIdSync } from './cityStore';
import { findPoiCandidates, type PoiRow } from './gtfsDatabase';
import { hasPoiDb, queryRichPoiCandidates, type RichPoiRow } from './poiDatabase';

/** Kompatybilność wsteczna - baza POI synchronizuje się w tle przez poiSync. */
export function ensurePoiIndex(): void {}

const DIST_PENALTY_CAP = 40;
const DIST_PENALTY_PER_M = 250;

function scoreRichRow(
  row: RichPoiRow,
  normQ: string,
  nameMatchScore: number | null,
  distM?: number,
): number | null {
  let base = nameMatchScore ?? 0;
  if (base === 0) {
    // Trafienie po kategorii, kuchni lub ulicy (np. "ramen", "pizza", "kawiarnia", "mariacka").
    const tagMatch = row.tags ? fuzzyMatch(normQ, row.tags.replace(/,/g, ' ')) : { matches: false, score: 0 };
    const subMatch = fuzzyMatch(normQ, row.subtype);
    const addrMatch = row.street || row.district ? fuzzyMatch(normQ, `${row.district ?? ''} ${row.street ?? ''}`) : { matches: false, score: 0 };
    const bestMeta = Math.max(
      tagMatch.matches ? tagMatch.score : 0,
      subMatch.matches ? subMatch.score : 0,
      addrMatch.matches ? Math.max(55, addrMatch.score - 10) : 0,
    );
    if (bestMeta <= 0) return null;
    base = Math.min(84, Math.max(66, bestMeta - 6));
  }

  const rankBonus = Math.min(24, Math.round(row.rank / 42));
  const distPenalty = distM !== undefined ? Math.min(DIST_PENALTY_CAP, distM / DIST_PENALTY_PER_M) : 0;
  return base + rankBonus - distPenalty;
}

function buildAliases(row: RichPoiRow): string[] | undefined {
  const out: string[] = [];
  if (row.subtype) out.push(row.subtype);
  if (row.tags) {
    for (const tag of row.tags.split(',')) {
      const clean = tag.trim();
      if (clean && !out.includes(clean)) out.push(clean);
      if (out.length >= 4) break;
    }
  }
  return out.length ? out : undefined;
}

/**
 * Wyszukiwarka POI: dla miast z osobną bazą używa `poi_terms` + rankingu jakości,
 * dla pozostałych miast korzysta z tabeli `pois` w bazie rozkładu.
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
  const cityId = getActiveCityIdSync();

  if (await hasPoiDb(cityId).catch(() => false)) {
    const rich = await queryRichPoiCandidates(normQ, cityId, Math.max(60, limit * 5)).catch(
      () => [] as RichPoiRow[],
    );
    if (rich.length) {
      const matches = fuzzyMatchBatch(
        normQ,
        rich.map((row) => row.name),
      );
      const scored: { row: RichPoiRow; score: number; distM?: number }[] = [];
      for (let i = 0; i < rich.length; i++) {
        const row = rich[i];
        const match = matches[i];
        const distM =
          hasPos && userLat !== undefined && userLon !== undefined
            ? Math.round(distanceMeters(userLat, userLon, row.lat, row.lon))
            : undefined;
        const score = scoreRichRow(row, normQ, match?.matches ? match.score : null, distM);
        if (score === null) continue;
        scored.push({ row, score, distM });
      }
      scored.sort((a, b) => b.score - a.score || b.row.rank - a.row.rank);
      return scored.slice(0, limit).map(({ row, distM }) => ({
        id: `poi-db-${row.id}`,
        title: row.name,
        address: row.address,
        kind: 'place' as const,
        category: row.category,
        aliases: buildAliases(row),
        weight: Math.round(row.rank * 1.2),
        lat: row.lat,
        lon: row.lon,
        distanceM: distM,
      }));
    }
  }

  const candidates = await findPoiCandidates(normQ).catch(() => [] as PoiRow[]);
  const matches = fuzzyMatchBatch(
    normQ,
    candidates.map((row) => row.name),
  );
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
