// Podpowiedzi budynków Politechniki Wrocławskiej (D-21, C-4, ...).
// Dopasowanie rozmyte wykonywane wsadowo w Rust (`fuzzyMatchBatch`).

import { PWR_BUILDINGS } from '../data/pwrBuildings';
import { distanceMeters, normalizePolish } from '../gtfs/geo';
import { fuzzyMatchBatch } from '../gtfs/fuzzy';
import type { Suggestion } from '../types/models';

const DIST_PENALTY_CAP = 40;
const DIST_PENALTY_PER_M = 250;

/** "D-21" -> "d21": myślnik, spacja i kropka nie mają znaczenia. */
export function compactBuildingCode(value: string): string {
  return normalizePolish(value).replace(/[^a-z0-9]/g, '');
}

const COMPACT_CODES = PWR_BUILDINGS.map((b) => compactBuildingCode(b.code));
const FULL_TARGETS = PWR_BUILDINGS.map((b) => `${b.code} Politechnika Wrocławska`);

export function searchPwrBuildings(
  query: string,
  userLat?: number,
  userLon?: number,
  limit = 8,
): Suggestion[] {
  const normQ = normalizePolish(query.trim());
  const compactQ = compactBuildingCode(normQ);
  if (normQ.length < 2 || !compactQ) return [];

  const hasPos = userLat !== undefined && userLon !== undefined;
  const tokens = normQ
    .split(/[\s,./()\\-]+/)
    .map(compactBuildingCode)
    .filter(Boolean);

  const batchResults = fuzzyMatchBatch(normQ, FULL_TARGETS);
  const scored: { item: Suggestion; score: number }[] = [];

  for (let i = 0; i < PWR_BUILDINGS.length; i++) {
    const b = PWR_BUILDINGS[i];
    const compactCode = COMPACT_CODES[i];
    let score = 0;
    if (compactQ === compactCode) score = 100;
    else if (tokens.includes(compactCode)) score = 96;
    else if (compactQ.length >= 2 && compactCode.startsWith(compactQ)) score = 90;
    else {
      const byName = batchResults[i];
      if (byName && byName.matches) score = byName.score;
    }
    if (score <= 0) continue;

    let distanceM: number | undefined;
    if (hasPos && userLat !== undefined && userLon !== undefined) {
      distanceM = Math.round(distanceMeters(userLat, userLon, b.lat, b.lon));
      score -= Math.min(DIST_PENALTY_CAP, distanceM / DIST_PENALTY_PER_M);
    }
    scored.push({
      item: {
        id: `pwr-${compactCode}`,
        title: `Budynek ${b.code} Politechniki Wrocławskiej`,
        address: b.address,
        kind: 'place',
        category: 'school',
        lat: b.lat,
        lon: b.lon,
        distanceM,
        aliases: [b.code.replace(/-/g, '')],
      },
      score,
    });
  }

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit).map((s) => s.item);
}
