// Ranking podpowiedzi wykonywany w Rust (`CMD_DEDUPE_AND_SORT`).
// Zasady: przystanki absolutnie pierwsze, potem dopasowanie nazwy,
// kara za dystans (bliższe wyżej), bonus za popularność przystanku.

import {
  BinaryReader,
  BinaryWriter,
  CMD_DEDUPE_AND_SORT,
  invokeRustSync,
} from '../../modules/kilometr-raptor';
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
  for (const alias of s.aliases ?? []) {
    const aliasMatch = fuzzyMatch(normQ, alias);
    if (aliasMatch.matches) return aliasMatch.score;
  }
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
 * Deduplikacja ze współrzędnymi (~100 m) i ranking wykonywany natywnie w Rust:
 * przystanki zawsze na górze (w swojej kolejności: trafienie + waga),
 * potem adresy przy zapytaniach z numerem, potem nazwa − dystans + waga.
 */
export function dedupeAndSort(
  local: Suggestion[],
  nominatim: Suggestion[],
  hasUserPos: boolean,
  normQ?: string,
): Suggestion[] {
  const combined = [...local, ...nominatim];
  if (combined.length === 0) return [];

  const w = new BinaryWriter(64 + combined.length * 96);
  w.u8Val(hasUserPos ? 1 : 0)
    .str(normQ ?? '')
    .u32(combined.length);

  for (let i = 0; i < combined.length; i++) {
    const item = combined[i];
    const kindCode = item.kind === 'stop' ? 0 : item.kind === 'address' ? 1 : 2;
    const hasDist = item.distanceM !== undefined && Number.isFinite(item.distanceM);
    const aliases = item.aliases ?? [];
    w.u32(i)
      .u8Val(kindCode)
      .str(item.title)
      .str(item.address ?? '')
      .str(item.category || item.kind)
      .f64(item.lat)
      .f64(item.lon)
      .u8Val(hasDist ? 1 : 0)
      .f64(hasDist ? item.distanceM! : 0)
      .f64(item.weight ?? 0)
      .u16(aliases.length);
    for (let j = 0; j < aliases.length; j++) {
      w.str(aliases[j]);
    }
  }

  const res = invokeRustSync(CMD_DEDUPE_AND_SORT, w.finish());
  if (res && res.byteLength >= 4) {
    const r = new BinaryReader(res);
    const outCount = r.u32();
    const out: Suggestion[] = new Array(outCount);
    for (let i = 0; i < outCount; i++) {
      out[i] = combined[r.u32()];
    }
    return out;
  }

  const seen = new Set<string>();
  const out: Suggestion[] = [];
  for (const item of combined) {
    const key = `${normalizePolish(item.title)}-${item.category || item.kind}-${item.lat.toFixed(3)}-${item.lon.toFixed(3)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}
