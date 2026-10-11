// Stacje Polinki w wyszukiwarce.
//
// Stacje wstrzykujemy do sklepu w pamięci, a `searchStops` pyta bazę SQLite
// wprost, więc bez tego wpisanie „Polinka" albo „Na Grobli" nic nie znajdzie,
// mimo że planer po niej jeździ. To jedyne miejsce, gdzie trzeba o niej
// pamiętać poza sklepem.

import { polinkaStops } from '../data/polinka';
import { distanceMeters, normalizePolish } from '../gtfs/geo';
import { fuzzyMatch } from '../gtfs/fuzzy';
import { tr } from '../i18n';
import type { Suggestion } from '../types/models';

export function searchPolinkaStops(
  query: string,
  userLat?: number,
  userLon?: number,
  limit = 4,
): Suggestion[] {
  const normQ = normalizePolish(query.trim());
  if (normQ.length < 2) return [];

  const kindLabel = tr().notification.modeCable;
  const scored: { item: Suggestion; score: number }[] = [];

  for (const stop of polinkaStops()) {
    // Nazwa stacji plus nazwa linii: „polinka", „kolej linowa" i „geocentrum"
    // mają trafiać w tę samą podpowiedź.
    const byName = fuzzyMatch(normQ, `${stop.stop_name} ${kindLabel}`);
    if (!byName.matches) continue;
    scored.push({
      item: {
        id: `stop-${stop.stop_id}`,
        title: stop.stop_name,
        address: kindLabel,
        kind: 'stop',
        lat: stop.stop_lat,
        lon: stop.stop_lon,
        distanceM:
          userLat !== undefined && userLon !== undefined
            ? Math.round(distanceMeters(userLat, userLon, stop.stop_lat, stop.stop_lon))
            : undefined,
        weight: 40,
      },
      score: byName.score,
    });
  }

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit).map((s) => s.item);
}