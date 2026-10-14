// Lokalny indeks miejsc (POI) aktywnego miasta na telefonie. Port server/src/search/poiIndex.ts.
// Zasilany z Overpass API, cachowany w SQLite (tabela pois, per-miasto jak reszta
// bazy). Dzięki temu "lidl", "zoo", "apteka" podpowiadają się natychmiast,
// bez czekania na Nominatim, i są sortowane po odległości od użytkownika.

import { OVERPASS, overpassBbox } from './gtfsConfig';
import { getActiveCityIdSync } from './cityStore';
import type { CityId } from '../cities';
import { distanceMeters, normalizePolish } from '../gtfs/geo';
import { fuzzyMatchBatch } from '../gtfs/fuzzy';
import { classifyPoi, buildPoiAddress } from './poiClassify';
import type { Suggestion } from '../types/models';
import { findPoiCandidates, getMeta, poiCount, replacePois, setMeta, type PoiRow } from './gtfsDatabase';

const ADDR_VERSION = '2';
const REFRESH_DAYS = 7;

const OVERPASS_FILTERS_BASE = [
  'node["shop"~"^(supermarket|mall|department_store)$"]',
  'way["shop"~"^(supermarket|mall|department_store)$"]',
  'node["amenity"~"^(pharmacy|hospital|clinic|university|college|school|cinema|theatre|library)$"]',
  'way["amenity"~"^(university|college|school|hospital|cinema|theatre)$"]',
  'node["tourism"~"^(hotel|museum|attraction|zoo|viewpoint)$"]',
  'node["leisure"~"^(park|garden|stadium|swimming_pool|sports_centre|fitness_centre)$"]',
  'node["railway"="station"]',
  'node["amenity"="fuel"]',
];

function poiQuery(cityId: CityId): string {
  let bbox: string = OVERPASS.bbox;
  try {
    bbox = overpassBbox(cityId);
  } catch {
    // legacy Wrocław
  }
  const filters = OVERPASS_FILTERS_BASE.map((f) => `${f}(${bbox});`).join('\n  ');
  return `[out:json][timeout:30];\n(\n  ${filters}\n);\nout center;`;
}

let refreshInFlight = false;

function isStale(last: string | null): boolean {
  if (!last) return true;
  const days = (Date.now() - Number(last)) / 86400000;
  return days >= REFRESH_DAYS;
}

/** Pobiera POI z Overpass i podmienia tabelę. Best-effort — błąd zostawia stare. */
export async function refreshPoiIndex(): Promise<number> {
  if (refreshInFlight) return poiCount();
  // Zapytanie potrafi trwać 45 s, a użytkownik zmieni miasto w międzyczasie.
  // Bbox bierzemy i sprawdzamy dla jednego miasta: inaczej odpowiedź dla
  // Wrocławia trafiłaby do bazy Krakowa i wyszukiwarka pokazywałaby
  // wrocławskie sklepy przez cały cykl życia indeksu.
  const cityId = getActiveCityIdSync();
  refreshInFlight = true;
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), OVERPASS.timeoutMs);
    try {
      const res = await fetch(OVERPASS.baseUrl, {
        method: 'POST',
        headers: {
          'User-Agent': OVERPASS.userAgent,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: 'data=' + encodeURIComponent(poiQuery(cityId)),
        signal: ctrl.signal,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as { elements?: any[] };
      const elements = json.elements || [];

      const rows: PoiRow[] = [];
      for (const el of elements) {
        const tags = el.tags as Record<string, string> | undefined;
        if (!tags) continue;
        const name = tags.name;
        if (!name) continue;
        const cls = classifyPoi(tags);
        if (!cls) continue;
        const lat = el.lat ?? el.center?.lat;
        const lon = el.lon ?? el.center?.lon;
        if (typeof lat !== 'number' || typeof lon !== 'number') continue;
        const addr = buildPoiAddress(cls.label, tags);
        rows.push({
          osm_id: `${el.type}/${el.id}`,
          kind: 'place',
          category: cls.category,
          name,
          norm_name: normalizePolish(name),
          address: addr.address,
          lat,
          lon,
          street: addr.street,
          district: addr.district,
        });
      }

      if (getActiveCityIdSync() !== cityId) {
        console.warn('[Poi] miasto zmienione w trakcie odświeżania, pomijam zapis');
        return poiCount();
      }
      await replacePois(rows);
      await setMeta('poi_last_refresh', String(Date.now()));
      await setMeta('poi_addr_version', ADDR_VERSION);
      return rows.length;
    } finally {
      clearTimeout(timer);
    }
  } catch (err) {
    console.warn('[POI Index] Refresh failed (keeping old data):', err);
    return poiCount();
  } finally {
    refreshInFlight = false;
  }
}

/**
 * Leniwy trigger: odśwież w tle jeśli pusto, stare lub stary format.
 * Nigdy nie blokuje wyszukiwania.
 */
export function ensurePoiIndex(): void {
  void (async () => {
    try {
      const [count, last, ver] = await Promise.all([
        poiCount(),
        getMeta('poi_last_refresh'),
        getMeta('poi_addr_version'),
      ]);
      if (count === 0 || isStale(last) || ver !== ADDR_VERSION) {
        void refreshPoiIndex();
      }
    } catch {
      // indeks opcjonalny — search działa bez niego
    }
  })();
}

/**
 * Szukanie po lokalnym indeksie. Scoring: dopasowanie nazwy minus
 * kara za dystans — najbliższe wygrywają jak w Jakdojade.
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
