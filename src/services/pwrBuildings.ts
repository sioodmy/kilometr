// Podpowiedzi budynków Politechniki Wrocławskiej (D-21, C-4, ...).
// Statyczna lista z mapy kampusu PWr, działa od pierwszego uruchomienia,
// bez sieci, i pozwala wpisać kod bez myślnika ("d21").

import { PWR_BUILDINGS } from '../data/pwrBuildings';
import { distanceMeters, normalizePolish } from '../gtfs/geo';
import { fuzzyMatch } from '../gtfs/fuzzy';
import type { Suggestion } from '../types/models';

const DIST_PENALTY_CAP = 40;
const DIST_PENALTY_PER_M = 250;

/** "D-21" -> "d21": myślnik, spacja i kropka nie mają znaczenia. */
export function compactBuildingCode(value: string): string {
  return normalizePolish(value).replace(/[^a-z0-9]/g, '');
}

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

  const scored: { item: Suggestion; score: number }[] = [];
  for (const b of PWR_BUILDINGS) {
    const compactCode = compactBuildingCode(b.code);
    let score = 0;
    if (compactQ === compactCode) score = 100;
    else if (tokens.includes(compactCode)) score = 96;
    else if (compactQ.length >= 2 && compactCode.startsWith(compactQ)) score = 90;
    else {
      const byName = fuzzyMatch(normQ, `${b.code} Politechnika Wrocławska`);
      if (byName.matches) score = byName.score;
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
