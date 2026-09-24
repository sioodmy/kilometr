// Czysty ranking podpowiedzi — port server/src/search/service.ts (dedupeAndSort).
// Bez zależności natywnych: działa w Hermes i w testach node.
// Zasady: przystanki absolutnie pierwsze, potem dopasowanie nazwy,
// kara za dystans (bliższe wyżej), bonus za popularność przystanku.

import { distanceMeters, normalizePolish } from '../gtfs/geo';
import { fuzzyMatch } from '../gtfs/fuzzy';
import type { Suggestion } from '../types/models';
import { BOUNDS } from './gtfsConfig';

/** Ścisły filtr: obsługujemy tylko Wrocław. Viewbox Nominatim nie wystarcza. */
export function inWroclaw(lat: number, lon: number): boolean {
  return (
    Number.isFinite(lat) &&
    Number.isFinite(lon) &&
    lat >= BOUNDS.minLat &&
    lat <= BOUNDS.maxLat &&
    lon >= BOUNDS.minLon &&
    lon <= BOUNDS.maxLon
  );
}

/** Odległości liczone na końcu (cache trzyma surowe wyniki bez pozycji usera). */
export function withDistances(
  items: Suggestion[],
  userLat?: number,
  userLon?: number,
): Suggestion[] {
  if (userLat === undefined || userLon === undefined) return items;
  return items.map((item) => ({
    ...item,
    distanceM: Math.round(distanceMeters(userLat, userLon, item.lat, item.lon)),
  }));
}

const DIST_PENALTY_CAP = 40;
const DIST_PENALTY_PER_M = 250;

export function distPenalty(s: Suggestion, hasUserPos: boolean): number {
  if (!hasUserPos) return 0;
  return Math.min(DIST_PENALTY_CAP, (s.distanceM ?? Infinity) / DIST_PENALTY_PER_M);
}

export function nameScore(s: Suggestion, normQ: string): number {
  if (!normQ) return 0;
  const match = fuzzyMatch(normQ, s.title);
  if (match.matches) return match.score;
  if (s.address) {
    const addrMatch = fuzzyMatch(normQ, s.address);
    if (addrMatch.matches) return Math.max(30, addrMatch.score - 15);
  }
  return 10;
}

/** Bonus za popularność przystanku (waga = liczba odjazdów). */
export function weightBonus(s: Suggestion): number {
  return (s.weight ?? 0) / 100;
}

/**
 * Deduplikacja ze współrzędnymi (~100 m): sieciówki w różnych częściach
 * miasta (Lidl, Biedronka) MUSZĄ przetrwać jako osobne wyniki, a ten sam
 * obiekt z dwóch źródeł (POI + Nominatim) scala się w jeden.
 * Sort: przystanki zawsze na górze (w swojej kolejności: trafienie + waga),
 * potem adresy przy zapytaniach z numerem, potem nazwa − dystans + waga.
 */
export function dedupeAndSort(
  local: Suggestion[],
  nominatim: Suggestion[],
  hasUserPos: boolean,
  normQ?: string,
): Suggestion[] {
  const seen = new Set<string>();
  const out: Suggestion[] = [];
  for (const item of [...local, ...nominatim]) {
    const key = `${normalizePolish(item.title)}-${item.category || item.kind}-${item.lat.toFixed(3)}-${item.lon.toFixed(3)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }

  const wantsAddress = normQ ? /\d/.test(normQ) : false;

  out.sort((a, b) => {
    // 1. Absolutny priorytet dla przystanków
    const aIsStop = a.kind === 'stop' ? 1 : 0;
    const bIsStop = b.kind === 'stop' ? 1 : 0;
    if (aIsStop !== bIsStop) return bIsStop - aIsStop;

    // Wśród przystanków: kolejność z searchStops (trafienie, potem waga).
    // Stabilny sort JS zachowuje ją, gdy comparator zwraca 0.
    if (aIsStop && bIsStop) return 0;

    // 2. Dokładne adresy na górze, jeśli zapytanie wygląda jak adres
    if (wantsAddress) {
      const aAddr = a.kind === 'address' ? 0 : 1;
      const bAddr = b.kind === 'address' ? 0 : 1;
      if (aAddr !== bAddr) return aAddr - bAddr;
    }

    // 3. Nazwa − dystans + popularność
    const scoreA = nameScore(a, normQ ?? '') - distPenalty(a, hasUserPos) + weightBonus(a);
    const scoreB = nameScore(b, normQ ?? '') - distPenalty(b, hasUserPos) + weightBonus(b);
    return scoreB - scoreA;
  });
  return out;
}
