// Stacje Polinki w wyszukiwarce - dopasowanie rozmyte wykonywane wsadowo w Rust.

import { polinkaStops } from '../data/polinka';
import { distanceMeters, normalizePolish } from '../gtfs/geo';
import { fuzzyMatchBatch } from '../gtfs/fuzzy';
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
  const stops = polinkaStops();
  const targets = stops.map((stop) => `${stop.stop_name} ${kindLabel}`);
  const matches = fuzzyMatchBatch(normQ, targets);

  const scored: { item: Suggestion; score: number }[] = [];

  for (let i = 0; i < stops.length; i++) {
    const stop = stops[i];
    const byName = matches[i];
    if (!byName || !byName.matches) continue;
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
