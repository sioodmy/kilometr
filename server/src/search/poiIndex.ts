import { getDb } from '../db';
import { config } from '../config';
import { distanceMeters, normalizePolish } from '../gtfs/geo';
import { fuzzyMatch } from './fuzzy';
import { Suggestion } from './types';

// Lokalny indeks miejsc (POI) Wrocławia, zasilany z Overpass API i cachowany
// w SQLite. Dzięki temu "lidl", "zoo", "apteka" podpowiadają się natychmiast
// (bez czekania na Nominatim) i są sortowane po odległości od użytkownika.

interface PoiRow {
  osm_id: string;
  kind: string;
  category: string;
  name: string;
  norm_name: string;
  address: string;
  lat: number;
  lon: number;
  street: string | null;
  district: string | null;
}

// Wersja formatu adresu — bump wymusza pełny refresh (stare wiersze miały
// samo "• Wrocław" i brak kolumn street/district).
const ADDR_VERSION = '2';

/** Migracja istniejących baz: kolumny street/district + wymuszenie refresha. */
function ensureAddrColumns() {
  try {
    const db = getDb();
    const cols = db
      .prepare('PRAGMA table_info(pois)')
      .all() as { name: string }[];
    const names = new Set(cols.map((c) => c.name));
    if (!names.has('street')) {
      db.exec('ALTER TABLE pois ADD COLUMN street TEXT');
    }
    if (!names.has('district')) {
      db.exec('ALTER TABLE pois ADD COLUMN district TEXT');
    }
  } catch {
    // tabela jeszcze nie istnieje — utworzy ją CREATE TABLE
  }
}

/** Buduje linię adresu: "Label • Osiedle, Ulica Nr" (bez miasta — tylko Wrocław). */
function buildAddress(
  label: string,
  tags: Record<string, string>
): { address: string; street: string | null; district: string | null } {
  const district =
    tags['addr:suburb'] ||
    tags['addr:district'] ||
    tags['addr:neighbourhood'] ||
    tags['addr:quarter'] ||
    tags['addr:city_district'] ||
    null;
  const street = tags['addr:street'] || null;
  const house = tags['addr:housenumber'] || null;
  const streetPart = street ? `${street}${house ? ` ${house}` : ''}` : null;
  const place = [district, streetPart].filter(Boolean).join(', ');
  return {
    address: place ? `${label} • ${place}` : label,
    street: streetPart,
    district,
  };
}

let memPois: PoiRow[] | null = null;
let refreshInFlight = false;

// Kuratoryjny zestaw tagów istotnych dla dojazdów (jakdojade-like)
const OVERPASS_FILTERS = [
  'node["shop"~"^(supermarket|mall|department_store)$"]',
  'way["shop"~"^(supermarket|mall|department_store)$"]',
  'node["amenity"~"^(pharmacy|hospital|clinic|university|college|school|cinema|theatre|library)$"]',
  'way["amenity"~"^(university|college|school|hospital|cinema|theatre)$"]',
  'node["tourism"~"^(hotel|museum|attraction|zoo|viewpoint)$"]',
  'node["leisure"~"^(park|garden|stadium|swimming_pool|sports_centre|fitness_centre)$"]',
  'node["railway"="station"]',
  'node["amenity"="fuel"]',
].map((f) => `${f}(${config.overpass.bbox});`).join('\n  ');

const POI_QUERY = `[out:json][timeout:30];\n(\n  ${OVERPASS_FILTERS}\n);\nout center;`;

const CATEGORY_LABEL: Record<string, { category: string; label: string }> = {
  'shop:supermarket': { category: 'shop', label: 'Supermarket' },
  'shop:mall': { category: 'shop', label: 'Galeria handlowa' },
  'shop:department_store': { category: 'shop', label: 'Dom handlowy' },
  'amenity:pharmacy': { category: 'medical', label: 'Apteka' },
  'amenity:hospital': { category: 'medical', label: 'Szpital' },
  'amenity:clinic': { category: 'medical', label: 'Przychodnia' },
  'amenity:university': { category: 'school', label: 'Uczelnia' },
  'amenity:college': { category: 'school', label: 'Uczelnia' },
  'amenity:school': { category: 'school', label: 'Szkoła' },
  'amenity:cinema': { category: 'entertainment', label: 'Kino' },
  'amenity:theatre': { category: 'entertainment', label: 'Teatr' },
  'amenity:library': { category: 'school', label: 'Biblioteka' },
  'amenity:fuel': { category: 'fuel', label: 'Stacja paliw' },
  'tourism:hotel': { category: 'tourism', label: 'Hotel' },
  'tourism:museum': { category: 'tourism', label: 'Muzeum' },
  'tourism:attraction': { category: 'tourism', label: 'Atrakcja' },
  'tourism:zoo': { category: 'tourism', label: 'ZOO' },
  'tourism:viewpoint': { category: 'tourism', label: 'Punkt widokowy' },
  'leisure:park': { category: 'sport', label: 'Park' },
  'leisure:garden': { category: 'sport', label: 'Ogród' },
  'leisure:stadium': { category: 'sport', label: 'Stadion' },
  'leisure:swimming_pool': { category: 'sport', label: 'Basen' },
  'leisure:sports_centre': { category: 'sport', label: 'Obiekt sportowy' },
  'leisure:fitness_centre': { category: 'sport', label: 'Siłownia' },
  'railway:station': { category: 'train', label: 'Stacja kolejowa' },
};

function classify(tags: Record<string, string>): { category: string; label: string } | null {
  const keys = ['shop', 'amenity', 'tourism', 'leisure', 'railway'];
  for (const k of keys) {
    const v = tags[k];
    if (!v) continue;
    const hit = CATEGORY_LABEL[`${k}:${v}`];
    if (hit) return hit;
    // Regex-fallback: shop=* → sklep, amenity=restaurant → gastronomia
    if (k === 'shop') return { category: 'shop', label: 'Sklep' };
    if (k === 'amenity' && ['restaurant', 'cafe', 'fast_food', 'bar', 'pub'].includes(v)) {
      return { category: 'restaurant', label: 'Gastronomia' };
    }
  }
  return null;
}

function getMeta(key: string): string | null {
  try {
    const row = getDb()
      .prepare('SELECT value FROM poi_meta WHERE key = ?')
      .get(key) as { value: string } | undefined;
    return row?.value ?? null;
  } catch {
    return null;
  }
}

function setMeta(key: string, value: string) {
  try {
    getDb()
      .prepare('INSERT OR REPLACE INTO poi_meta (key, value) VALUES (?, ?)')
      .run(key, value);
  } catch {
    // meta opcjonalna
  }
}

export function poiCount(): number {
  try {
    const row = getDb().prepare('SELECT COUNT(*) as n FROM pois').get() as { n: number };
    return row?.n ?? 0;
  } catch {
    return 0;
  }
}

function isStale(): boolean {
  const last = getMeta('last_refresh');
  if (!last) return true;
  const days = (Date.now() - Number(last)) / 86400000;
  return days >= config.overpass.refreshDays;
}

/** Pobiera POI z Overpass i podmienia tabelę. Best-effort — błąd zostawia stare dane. */
export async function refreshPoiIndex(): Promise<number> {
  if (refreshInFlight) return poiCount();
  refreshInFlight = true;
  try {
    const res = await fetch(config.overpass.baseUrl, {
      method: 'POST',
      headers: {
        'User-Agent': config.overpass.userAgent,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: 'data=' + encodeURIComponent(POI_QUERY),
      signal: AbortSignal.timeout(config.overpass.timeoutMs),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = (await res.json()) as { elements?: any[] };
    const elements = json.elements || [];

    const db = getDb();
    const insert = db.prepare(
      'INSERT OR REPLACE INTO pois (osm_id, kind, category, name, norm_name, address, lat, lon, street, district) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    );

    const rows: PoiRow[] = [];
    for (const el of elements) {
      const tags = el.tags as Record<string, string> | undefined;
      if (!tags) continue;
      const name = tags.name;
      if (!name) continue;
      const cls = classify(tags);
      if (!cls) continue;
      const lat = el.lat ?? el.center?.lat;
      const lon = el.lon ?? el.center?.lon;
      if (typeof lat !== 'number' || typeof lon !== 'number') continue;
      const addr = buildAddress(cls.label, tags);
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

    // Podmiana atomowa: wyczyść + wstaw
    db.exec('BEGIN');
    try {
      db.exec('DELETE FROM pois');
      for (const r of rows) {
        insert.run(r.osm_id, r.kind, r.category, r.name, r.norm_name, r.address, r.lat, r.lon, r.street, r.district);
      }
      db.exec('COMMIT');
    } catch {
      try {
        db.exec('ROLLBACK');
      } catch {
        // ignoruj
      }
      throw new Error('POI insert failed');
    }
    const count = rows.length;

    memPois = null; // unieważnij pamięć podręczną
    setMeta('last_refresh', String(Date.now()));
    setMeta('addr_version', ADDR_VERSION);
    console.log(`[POI Index] Refreshed ${count} places from Overpass.`);
    return count;
  } catch (err: any) {
    console.warn('[POI Index] Refresh failed (keeping old data):', err?.message || err);
    return poiCount();
  } finally {
    refreshInFlight = false;
  }
}

/** Startowy / leniwy trigger: odśwież w tle jeśli pusto, stare lub stary format. Nie blokuje. */
export function ensurePoiIndex() {
  try {
    ensureAddrColumns();
    if (poiCount() === 0 || isStale() || getMeta('addr_version') !== ADDR_VERSION) {
      refreshPoiIndex().catch(() => {});
    }
  } catch {
    // indeks opcjonalny — search działa bez niego
  }
}

function loadAll(): PoiRow[] {
  if (memPois) return memPois;
  try {
    memPois = getDb().prepare('SELECT * FROM pois').all() as unknown as PoiRow[];
  } catch {
    memPois = [];
  }
  return memPois;
}

/**
 * Szukanie po lokalnym indeksie. Scoring: dopasowanie nazwy (prefix > wyraz >
 * zawiera) minus kara za dystans — najbliższe wygrywają jak w Jakdojade.
 */
export function searchPois(
  query: string,
  userLat?: number,
  userLon?: number,
  limit = 8
): Suggestion[] {
  const normQ = normalizePolish(query.trim());
  if (!normQ || normQ.length < 2) return [];
  const hasPos = userLat !== undefined && userLon !== undefined;

  const scored: { row: PoiRow; score: number; distM?: number }[] = [];
  for (const row of loadAll()) {
    const match = fuzzyMatch(normQ, row.name);
    if (!match.matches) continue;

    let distM: number | undefined;
    let score = match.score;
    if (hasPos && userLat !== undefined && userLon !== undefined) {
      distM = Math.round(distanceMeters(userLat, userLon, row.lat, row.lon));
      score -= Math.min(40, distM / 250); // kara za dystans
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
