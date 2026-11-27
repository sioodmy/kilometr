/**
 * Buduje wieloźródłową, skompresowaną bazę POI dla wybranego miasta i zapisuje:
 * - `<out>/<city>/db/kilometr-pois.db.gz`
 * - `<out>/<city>/pois-manifest.json`
 *
 * Źródła: Overture Maps Places (DuckDB S3 Parquet) + OSM (Overpass) +
 * Wolt Discovery + CWOH (turystyka.gov.pl) + Wikidata (ranking landmarków).
 */
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync, gzipSync } from 'node:zlib';
import { getCity } from '../../src/cities.ts';
import {
  buildPoiAddress,
  classifyOvertureCategory,
  classifyRichOsmPoi,
} from '../../src/services/poiClassify.ts';
import { envNumber, fetchOverpassElements, overpassMirrors } from './overpass.mjs';
import { buildPoiSqlite, conflatePois } from './poi-conflate.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE_CACHE_TTL_MS = 7 * 86_400_000;
const OVERPASS_MIRRORS = overpassMirrors(process.env.POI_OVERPASS_URL);
const OVERPASS_TIMEOUT_MS = envNumber('POI_OVERPASS_TIMEOUT_MS', 75_000);
const OVERPASS_HEDGE_MS = envNumber('POI_HEDGE_MS', 8_000);

const WOLT_ANCHORS = {
  wroclaw: [
    [51.109, 17.032],
    [51.078, 17.018],
    [51.132, 17.072],
    [51.118, 16.968],
    [51.124, 17.022],
  ],
  krakow: [
    [50.061, 19.937],
    [50.048, 19.948],
    [50.077, 19.914],
    [50.072, 20.037],
    [50.025, 19.908],
  ],
  warszawa: [
    [52.23, 21.012],
    [52.193, 21.021],
    [52.235, 20.962],
    [52.254, 21.036],
    [52.275, 20.978],
    [52.155, 21.035],
    [52.164, 21.084],
    [52.238, 20.912],
  ],
  gzm: [
    [50.26, 19.025],
    [50.215, 19.005],
    [50.297, 18.954],
    [50.286, 19.104],
    [50.294, 18.671],
    [50.325, 18.786],
    [50.348, 18.916],
    [50.322, 19.195],
    [50.24, 19.138],
    [50.258, 18.856],
    [50.137, 18.966],
    [50.324, 19.129],
  ],
};

const RICH_OSM_FILTERS = [
  'nwr["amenity"~"^(restaurant|cafe|bar|pub|fast_food|ice_cream|biergarten|nightclub|food_court|cinema|theatre|arts_centre|concert_hall|community_centre|library|pharmacy|hospital|clinic|doctors|dentist|veterinary|university|college|school|kindergarten|bank|post_office|fuel|charging_station|marketplace|coworking_space|townhall|courthouse|police|embassy|place_of_worship)$"]["name"]',
  'nwr["shop"]["name"]',
  'nwr["tourism"~"^(hotel|hostel|guest_house|motel|apartment|museum|gallery|attraction|viewpoint|zoo|theme_park)$"]["name"]',
  'nwr["tourism"="information"]["information"="office"]["name"]',
  'nwr["leisure"~"^(park|garden|nature_reserve|stadium|swimming_pool|water_park|sports_centre|fitness_centre|bowling_alley|escape_game)$"]["name"]',
  'nwr["office"]["name"]',
  'nwr["historic"~"^(castle|palace|monument)$"]["name"]',
  'nwr["railway"~"^(station|halt)$"]["name"]',
  'nwr["aeroway"="aerodrome"]["name"]',
  'nwr["landuse"="commercial"]["name"]',
];

function parseArgs(argv) {
  const opts = {
    city: '',
    out: join(ROOT, 'dist', 'poi-db'),
    cache: join(ROOT, 'dist', 'poi-sources-cache'),
    refresh: false,
    skipOverture: false,
    skipOsm: false,
    skipWolt: false,
    skipCwoh: false,
    skipWikidata: false,
  };
  for (const arg of argv) {
    if (arg.startsWith('--city=')) opts.city = arg.slice(7).trim();
    else if (arg.startsWith('--out=')) opts.out = resolve(arg.slice(6));
    else if (arg.startsWith('--cache=')) opts.cache = resolve(arg.slice(8));
    else if (arg === '--refresh') opts.refresh = true;
    else if (arg === '--skip-overture') opts.skipOverture = true;
    else if (arg === '--skip-osm') opts.skipOsm = true;
    else if (arg === '--skip-wolt') opts.skipWolt = true;
    else if (arg === '--skip-cwoh') opts.skipCwoh = true;
    else if (arg === '--skip-wikidata') opts.skipWikidata = true;
  }
  return opts;
}

function readJsonGz(file) {
  try {
    return JSON.parse(gunzipSync(readFileSync(file)).toString('utf8'));
  } catch {
    return null;
  }
}

function writeJsonGz(file, data) {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(`${file}.tmp`, gzipSync(JSON.stringify(data)));
  renameSync(`${file}.tmp`, file);
}

function isCacheFresh(entry, ttlMs = SOURCE_CACHE_TTL_MS) {
  if (!entry || typeof entry.fetchedAt !== 'string') return false;
  const age = Date.now() - Date.parse(entry.fetchedAt);
  return age >= 0 && age < ttlMs;
}

function checkDuckDbAvailable() {
  try {
    execFileSync('duckdb', ['-version'], { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

async function fetchOvertureCandidates(city, cacheDir, refresh) {
  const cacheFile = join(cacheDir, `${city.id}-overture.json.gz`);
  const cached = !refresh ? readJsonGz(cacheFile) : null;
  if (isCacheFresh(cached)) {
    console.log(`[poi-db] ${city.id}: Overture z cache (${cached.items.length})`);
    return cached.items;
  }

  if (!checkDuckDbAvailable()) {
    if (cached?.items?.length) {
      console.warn(`[poi-db] ${city.id}: brak duckdb w PATH, używam starszego cache Overture (${cached.items.length})`);
      return cached.items;
    }
    throw new Error('Brak programu `duckdb` w PATH. Uruchom przez `nix shell nixpkgs#duckdb` albo zainstaluj duckdb CLI.');
  }

  const catalogRes = await fetch('https://stac.overturemaps.org/catalog.json', {
    signal: AbortSignal.timeout(20_000),
  });
  if (!catalogRes.ok) throw new Error(`STAC catalog HTTP ${catalogRes.status}`);
  const catalog = await catalogRes.json();
  const release = catalog.latest;
  if (!release) throw new Error('STAC catalog bez pola latest');

  const collRes = await fetch(`https://stac.overturemaps.org/${release}/places/place/collection.json`, {
    signal: AbortSignal.timeout(20_000),
  });
  if (!collRes.ok) throw new Error(`STAC place collection HTTP ${collRes.status}`);
  const coll = await collRes.json();
  const itemLinks = (coll.links || []).filter((l) => l.rel === 'item').map((l) => l.href);
  const b = city.bounds;

  const partUrls = [];
  for (const href of itemLinks) {
    const itemRes = await fetch(href, { signal: AbortSignal.timeout(15_000) });
    if (!itemRes.ok) continue;
    const item = await itemRes.json();
    const ib = item.bbox;
    if (Array.isArray(ib) && ib.length >= 4 && ib[0] <= b.maxLon && ib[2] >= b.minLon && ib[1] <= b.maxLat && ib[3] >= b.minLat) {
      const awsHref = item.assets?.aws?.href;
      if (awsHref) partUrls.push(awsHref);
    }
  }
  if (!partUrls.length) throw new Error('Brak partycji Overture dla granic miasta');

  const ndjsonPath = join(cacheDir, `${city.id}-overture.tmp.ndjson`);
  mkdirSync(cacheDir, { recursive: true });
  const sqlUrls = partUrls.map((u) => `'${u.replace(/'/g, "''")}'`).join(', ');
  const sql = `
    INSTALL httpfs; LOAD httpfs;
    SET s3_region='us-west-2';
    COPY (
      SELECT
        id,
        names.primary AS name,
        confidence,
        basic_category,
        taxonomy.primary AS tax_primary,
        taxonomy.hierarchy AS tax_hier,
        addresses[1].freeform AS street,
        addresses[1].locality AS locality,
        bbox.xmin AS lon,
        bbox.ymin AS lat,
        websites[1] AS website,
        phones[1] AS phone,
        len(coalesce(socials, [])) AS socials_cnt,
        len(coalesce(sources, [])) AS sources_cnt
      FROM read_parquet([${sqlUrls}])
      WHERE bbox.xmin BETWEEN ${b.minLon} AND ${b.maxLon}
        AND bbox.ymin BETWEEN ${b.minLat} AND ${b.maxLat}
        AND (operating_status IS NULL OR operating_status = 'in_operation')
        AND confidence >= 0.50
        AND names.primary IS NOT NULL
    ) TO '${ndjsonPath.replace(/'/g, "''")}' (FORMAT JSON);
  `;

  console.log(`[poi-db] ${city.id}: pobieram Overture ${release} (${partUrls.length} partycje) przez DuckDB…`);
  execFileSync('duckdb', ['-dark-mode', '-noheader', '-c', sql], {
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 240_000,
  });

  const rawText = readFileSync(ndjsonPath, 'utf8');
  rmSync(ndjsonPath, { force: true });

  const items = [];
  for (const line of rawText.split('\n')) {
    if (!line.trim()) continue;
    const r = JSON.parse(line);
    const cls = classifyOvertureCategory(r.basic_category, r.tax_primary, r.tax_hier);
    if (!cls) continue;
    items.push({
      extId: `ov:${r.id}`,
      source: 'overture',
      name: r.name,
      category: cls.category,
      subtype: cls.subtype,
      baseRank: cls.baseRank,
      tags: cls.tags,
      lat: Number(r.lat),
      lon: Number(r.lon),
      street: r.street || null,
      district: null,
      city: r.locality || null,
      website: r.website || null,
      phone: r.phone || null,
      confidence: Number(r.confidence) || 0.5,
      sourceCount: Number(r.sources_cnt) || 1,
      hasSocials: (Number(r.socials_cnt) || 0) > 0,
    });
  }

  writeJsonGz(cacheFile, { fetchedAt: new Date().toISOString(), release, items });
  console.log(`[poi-db] ${city.id}: Overture pobrane (${items.length})`);
  return items;
}

async function fetchOsmCandidates(city, cacheDir, refresh) {
  const cacheFile = join(cacheDir, `${city.id}-osm.json.gz`);
  const cached = !refresh ? readJsonGz(cacheFile) : null;
  if (isCacheFresh(cached)) {
    console.log(`[poi-db] ${city.id}: OSM z cache (${cached.items.length})`);
    return cached.items;
  }

  const b = city.bounds;
  const TILE_DEG = 0.18;
  const MIN_TILE_DEG = 0.05;
  const deadline = Date.now() + 8 * 60_000;
  const byKey = new Map();

  const fetchTile = async (south, west, north, east) => {
    const bbox = [south, west, north, east].join(',');
    const filters = RICH_OSM_FILTERS.map((f) => `${f}(${bbox});`).join('\n  ');
    const query = `[out:json][timeout:60];(\n  ${filters}\n);\nout center tags;`;
    let lastError = null;
    try {
      const elements = await fetchOverpassElements({
        query,
        mirrors: OVERPASS_MIRRORS,
        userAgent: 'KilometrPoiDbBuild/1.0 (https://github.com/sioodmy/kilometr)',
        timeoutMs: OVERPASS_TIMEOUT_MS,
        hedgeMs: OVERPASS_HEDGE_MS,
        deadline,
      });
      for (const el of elements) {
        const key = `${el.type}/${el.id}`;
        if (!byKey.has(key)) byKey.set(key, el);
      }
      return;
    } catch (err) {
      if (err?.code === 'OVERPASS_BUDGET') throw err;
      lastError = err;
    }
    if (Math.max(north - south, east - west) > MIN_TILE_DEG * 1.05) {
      const midLat = (south + north) / 2;
      const midLon = (west + east) / 2;
      for (const [s, w, n, e] of [
        [south, west, midLat, midLon],
        [south, midLon, midLat, east],
        [midLat, west, north, midLon],
        [midLat, midLon, north, east],
      ]) {
        await fetchTile(s, w, n, e);
      }
      return;
    }
    throw lastError ?? new Error('Overpass: brak odpowiedzi');
  };

  try {
    const latSteps = Math.max(1, Math.ceil((b.maxLat - b.minLat) / TILE_DEG));
    const lonSteps = Math.max(1, Math.ceil((b.maxLon - b.minLon) / TILE_DEG));
    console.log(`[poi-db] ${city.id}: pobieram OSM Overpass (${latSteps * lonSteps} kafelków)…`);
    for (let y = 0; y < latSteps; y++) {
      for (let x = 0; x < lonSteps; x++) {
        const south = b.minLat + (y * (b.maxLat - b.minLat)) / latSteps;
        const north = b.minLat + ((y + 1) * (b.maxLat - b.minLat)) / latSteps;
        const west = b.minLon + (x * (b.maxLon - b.minLon)) / lonSteps;
        const east = b.minLon + ((x + 1) * (b.maxLon - b.minLon)) / lonSteps;
        await fetchTile(south, west, north, east);
      }
    }

    const items = [];
    for (const el of byKey.values()) {
      const tags = el.tags;
      if (!tags || typeof tags.name !== 'string' || !tags.name.trim()) continue;
      const cls = classifyRichOsmPoi(tags);
      if (!cls) continue;
      const lat = el.lat ?? el.center?.lat;
      const lon = el.lon ?? el.center?.lon;
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
      const addr = buildPoiAddress(cls.subtype, tags);
      items.push({
        extId: `osm:${el.type}/${el.id}`,
        source: 'osm',
        name: tags.name.trim(),
        category: cls.category,
        subtype: cls.subtype,
        baseRank: cls.baseRank,
        tags: cls.tags,
        lat,
        lon,
        street: addr.street,
        district: addr.district,
        city: tags['addr:city'] || null,
        website: tags.website || tags['contact:website'] || null,
        phone: tags.phone || tags['contact:phone'] || null,
        hours: tags.opening_hours || null,
        wikidataId: tags.wikidata || null,
      });
    }
    writeJsonGz(cacheFile, { fetchedAt: new Date().toISOString(), items });
    console.log(`[poi-db] ${city.id}: OSM pobrane (${items.length})`);
    return items;
  } catch (err) {
    if (cached?.items?.length) {
      console.warn(`[poi-db] ${city.id}: Overpass błąd (${err.message}), używam cache OSM (${cached.items.length})`);
      return cached.items;
    }
    console.warn(`[poi-db] ${city.id}: Overpass niedostępny (${err.message}), kontynuuję bez OSM`);
    return [];
  }
}

function classifyWoltVenue(venue, isRetail) {
  const tags = Array.isArray(venue.tags) ? venue.tags.map((t) => String(t).toLowerCase()) : [];
  if (isRetail) {
    if (tags.some((t) => /kwiat|kwiaciar/.test(t))) return { category: 'shop', subtype: 'Kwiaciarnia', baseRank: 185 };
    if (tags.some((t) => /aptek|zdrow/.test(t))) return { category: 'medical', subtype: 'Apteka', baseRank: 215 };
    if (tags.some((t) => /piekarn|cukiern/.test(t))) return { category: 'cafe', subtype: 'Cukiernia', baseRank: 210 };
    return { category: 'shop', subtype: 'Sklep', baseRank: 180 };
  }
  if (tags.some((t) => /kawa|kawiarn|coffee|cafe|herbata/.test(t))) return { category: 'cafe', subtype: 'Kawiarnia', baseRank: 225 };
  if (tags.some((t) => /lody|deser|ciasto|cukiern|piekarn/.test(t))) return { category: 'cafe', subtype: 'Cukiernia', baseRank: 215 };
  if (tags.some((t) => /bar|pub|alkohol|piwo|wino/.test(t))) return { category: 'bar', subtype: 'Bar', baseRank: 225 };
  return { category: 'restaurant', subtype: 'Restauracja', baseRank: 230 };
}

async function fetchWoltCandidates(city, cacheDir, refresh) {
  const cacheFile = join(cacheDir, `${city.id}-wolt.json.gz`);
  const cached = !refresh ? readJsonGz(cacheFile) : null;
  if (isCacheFresh(cached)) {
    console.log(`[poi-db] ${city.id}: Wolt z cache (${cached.items.length})`);
    return cached.items;
  }

  const anchors = WOLT_ANCHORS[city.id] || [[city.center.lat, city.center.lon]];
  const venuesById = new Map();
  const tasks = [];
  for (const [lat, lon] of anchors) {
    tasks.push({ lat, lon, kind: 'restaurants', isRetail: false });
    tasks.push({ lat, lon, kind: 'retail', isRetail: true });
  }

  const CONCURRENCY = 3;
  for (let i = 0; i < tasks.length; i += CONCURRENCY) {
    const batch = tasks.slice(i, i + CONCURRENCY);
    await Promise.all(
      batch.map(async (t) => {
        try {
          const url = `https://restaurant-api.wolt.com/v1/pages/${t.kind}?lat=${t.lat}&lon=${t.lon}`;
          const res = await fetch(url, {
            headers: { 'Accept-Language': 'pl', 'User-Agent': 'KilometrPoiDbBuild/1.0' },
            signal: AbortSignal.timeout(15_000),
          });
          if (!res.ok) return;
          const json = await res.json();
          for (const sec of json.sections || []) {
            for (const it of sec.items || []) {
              const v = it.venue;
              if (!v || !v.id || !Array.isArray(v.location) || v.location.length < 2) continue;
              if (/wirtualn|virtual|dark\s*kitchen/i.test(`${v.name || ''} ${v.address || ''}`)) continue;
              if (!venuesById.has(v.id)) venuesById.set(v.id, { venue: v, isRetail: t.isRetail });
            }
          }
        } catch {
          // pojedynczy punkt siatki może nie mieć pokrycia
        }
      }),
    );
  }

  const items = [];
  for (const { venue: v, isRetail } of venuesById.values()) {
    const lon = Number(v.location[0]);
    const lat = Number(v.location[1]);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    const cls = classifyWoltVenue(v, isRetail);
    const addrParts = String(v.address || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    const street = addrParts[0] || null;
    const cityName = addrParts.length > 1 ? addrParts[addrParts.length - 1] : null;
    items.push({
      extId: `wolt:${v.id}`,
      source: 'wolt',
      name: v.name,
      category: cls.category,
      subtype: cls.subtype,
      baseRank: cls.baseRank,
      tags: Array.isArray(v.tags) ? v.tags : [],
      lat,
      lon,
      street,
      district: null,
      city: cityName,
      rating: v.rating?.score != null ? Number(v.rating.score) : null,
      ratingVolume: v.rating?.volume != null ? Number(v.rating.volume) : 0,
    });
  }

  writeJsonGz(cacheFile, { fetchedAt: new Date().toISOString(), items });
  console.log(`[poi-db] ${city.id}: Wolt pobrane (${items.length})`);
  return items;
}

function normalizeCwohCoords(coords) {
  if (!Array.isArray(coords) || coords.length < 2) return null;
  const a = Number(coords[0]);
  const b = Number(coords[1]);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  // CWOH zwraca [lat, lon] w Polsce (lat ~49..55, lon ~14..24). Walidujemy obie kolejności.
  if (a >= 48.5 && a <= 55.5 && b >= 13.5 && b <= 24.5) return { lat: a, lon: b };
  if (b >= 48.5 && b <= 55.5 && a >= 13.5 && a <= 24.5) return { lat: b, lon: a };
  return null;
}

function cwohStars(categoryStr) {
  const m = /KAT_(\d)ST/.exec(String(categoryStr || ''));
  return m ? Number(m[1]) : 0;
}

function cwohSubtype(kind) {
  if (kind === 'RODZ_MOT') return 'Motel';
  if (kind === 'RODZ_PEN') return 'Pensjonat';
  if (kind === 'RODZ_KEM') return 'Kemping';
  if (kind === 'RODZ_SCHM' || kind === 'RODZ_SCH') return 'Schronisko';
  if (kind === 'RODZ_DOMW') return 'Dom wycieczkowy';
  return 'Hotel';
}

async function fetchCwohPoland(cacheDir, refresh) {
  const cacheFile = join(cacheDir, 'cwoh-poland.json.gz');
  const cached = !refresh ? readJsonGz(cacheFile) : null;
  if (isCacheFresh(cached)) return cached.items;

  const firstRes = await fetch('https://api.turystyka.gov.pl/registers/open/cwoh?page=0&size=200', {
    signal: AbortSignal.timeout(20_000),
  });
  if (!firstRes.ok) throw new Error(`CWOH HTTP ${firstRes.status}`);
  const first = await firstRes.json();
  const totalPages = Math.min(100, Number(first.totalPages) || 1);
  const allRows = [...(first.content || [])];

  const pages = [];
  for (let p = 1; p < totalPages; p++) pages.push(p);
  const CONCURRENCY = 5;
  for (let i = 0; i < pages.length; i += CONCURRENCY) {
    const batch = pages.slice(i, i + CONCURRENCY);
    const resList = await Promise.all(
      batch.map(async (page) => {
        const r = await fetch(`https://api.turystyka.gov.pl/registers/open/cwoh?page=${page}&size=200`, {
          signal: AbortSignal.timeout(20_000),
        });
        return r.ok ? r.json() : { content: [] };
      }),
    );
    for (const json of resList) allRows.push(...(json.content || []));
  }

  const items = [];
  for (const row of allRows) {
    if (!row || row.erasureDate) continue;
    const coords = normalizeCwohCoords(row.spatialLocation?.coordinates);
    if (!coords) continue;
    const stars = cwohStars(row.category);
    const subtype = cwohSubtype(row.kind);
    items.push({
      extId: `cwoh:${row.uid || row.rid}`,
      source: 'cwoh',
      name: row.name,
      category: 'hotel',
      subtype,
      baseRank: 265,
      tags: ['hotel', 'nocleg', subtype.toLowerCase()],
      lat: coords.lat,
      lon: coords.lon,
      street: row.street ? String(row.street).replace(/\s+/g, ' ').trim() : null,
      district: null,
      city: row.city || null,
      stars,
    });
  }

  writeJsonGz(cacheFile, { fetchedAt: new Date().toISOString(), items });
  return items;
}

async function fetchCwohCandidates(city, cacheDir, refresh) {
  try {
    const poland = await fetchCwohPoland(cacheDir, refresh);
    const b = city.bounds;
    const inBounds = poland.filter(
      (x) => x.lat >= b.minLat && x.lat <= b.maxLat && x.lon >= b.minLon && x.lon <= b.maxLon,
    );
    console.log(`[poi-db] ${city.id}: CWOH hotele (${inBounds.length})`);
    return inBounds;
  } catch (err) {
    console.warn(`[poi-db] ${city.id}: CWOH niedostępny (${err.message})`);
    return [];
  }
}

async function fetchWikidataCandidates(city, cacheDir, refresh) {
  const cacheFile = join(cacheDir, `${city.id}-wikidata.json.gz`);
  const cached = !refresh ? readJsonGz(cacheFile) : null;
  if (isCacheFresh(cached)) {
    console.log(`[poi-db] ${city.id}: Wikidata z cache (${cached.items.length})`);
    return cached.items;
  }

  const b = city.bounds;
  const sparql = `SELECT ?item ?itemLabel ?lat ?lon ?sitelinks WHERE {
    SERVICE wikibase:box {
      ?item wdt:P625 ?coord .
      bd:serviceParam wikibase:cornerSouthWest "Point(${b.minLon} ${b.minLat})"^^geo:wktLiteral .
      bd:serviceParam wikibase:cornerNorthEast "Point(${b.maxLon} ${b.maxLat})"^^geo:wktLiteral .
    }
    ?item wikibase:sitelinks ?sitelinks .
    FILTER(?sitelinks >= 4)
    BIND(geof:latitude(?coord) AS ?lat)
    BIND(geof:longitude(?coord) AS ?lon)
    SERVICE wikibase:label { bd:serviceParam wikibase:language "pl,en". }
  } ORDER BY DESC(?sitelinks) LIMIT 1500`;

  try {
    const res = await fetch(`https://query.wikidata.org/sparql?format=json&query=${encodeURIComponent(sparql)}`, {
      headers: {
        'User-Agent': 'KilometrPoiDbBuild/1.0 (https://github.com/sioodmy/kilometr)',
        Accept: 'application/sparql-results+json',
      },
      signal: AbortSignal.timeout(35_000),
    });
    if (!res.ok) throw new Error(`Wikidata HTTP ${res.status}`);
    const json = await res.json();
    const items = (json.results?.bindings || [])
      .map((row) => {
        const uri = row.item?.value || '';
        const qid = uri.split('/').pop() || '';
        return {
          qid,
          label: row.itemLabel?.value || '',
          lat: Number(row.lat?.value),
          lon: Number(row.lon?.value),
          sitelinks: Number(row.sitelinks?.value) || 0,
        };
      })
      .filter((x) => x.qid && x.label && Number.isFinite(x.lat) && Number.isFinite(x.lon));
    writeJsonGz(cacheFile, { fetchedAt: new Date().toISOString(), items });
    console.log(`[poi-db] ${city.id}: Wikidata pobrane (${items.length})`);
    return items;
  } catch (err) {
    if (cached?.items?.length) return cached.items;
    console.warn(`[poi-db] ${city.id}: Wikidata niedostępna (${err.message})`);
    return [];
  }
}

export async function buildCityPoiDatabase(opts) {
  const city = getCity(opts.city);
  const started = Date.now();
  const [overture, osm, wolt, cwoh, wikidata] = await Promise.all([
    opts.skipOverture ? [] : fetchOvertureCandidates(city, opts.cache, opts.refresh),
    opts.skipOsm ? [] : fetchOsmCandidates(city, opts.cache, opts.refresh),
    opts.skipWolt ? [] : fetchWoltCandidates(city, opts.cache, opts.refresh),
    opts.skipCwoh ? [] : fetchCwohCandidates(city, opts.cache, opts.refresh),
    opts.skipWikidata ? [] : fetchWikidataCandidates(city, opts.cache, opts.refresh),
  ]);

  const rawCandidates = [...overture, ...osm, ...wolt, ...cwoh];
  if (!rawCandidates.length) {
    throw new Error(`Brak kandydatów POI dla ${city.id}`);
  }

  const pois = conflatePois(rawCandidates, city, wikidata);
  if (!pois.length) {
    throw new Error(`Po fuzji zostało 0 POI dla ${city.id}`);
  }

  const cityOut = join(opts.out, city.id);
  const dbDir = join(cityOut, 'db');
  mkdirSync(dbDir, { recursive: true });
  const dbPath = join(dbDir, 'kilometr-pois.db');
  const gzPath = `${dbPath}.gz`;
  const manifestPath = join(cityOut, 'pois-manifest.json');
  const builtAt = new Date().toISOString();

  const stats = buildPoiSqlite(dbPath, pois, {
    city: city.id,
    schema_version: '1',
    built_at: builtAt,
  });

  const rawBuf = readFileSync(dbPath);
  const gzBuf = gzipSync(rawBuf, { level: 9 });
  writeFileSync(`${gzPath}.tmp`, gzBuf);
  renameSync(`${gzPath}.tmp`, gzPath);

  const sha256 = createHash('sha256').update(gzBuf).digest('hex');
  const day = builtAt.slice(0, 10).replace(/-/g, '');
  const version = `${day}-poi-${sha256.slice(0, 8)}`;

  const manifest = {
    version,
    schemaVersion: 1,
    builtAt,
    city: city.id,
    db: {
      path: `${city.id}/db/kilometr-pois.db.gz`,
      sizeBytes: gzBuf.byteLength,
      uncompressedSizeBytes: rawBuf.byteLength,
      sha256,
    },
    stats: {
      total: stats.total,
      termCount: stats.termCount,
      byCategory: stats.byCategory,
      sources: stats.bySource,
      rawCounts: {
        overture: overture.length,
        osm: osm.length,
        wolt: wolt.length,
        cwoh: cwoh.length,
        wikidata: wikidata.length,
      },
    },
  };

  writeFileSync(`${manifestPath}.tmp`, JSON.stringify(manifest, null, 2));
  renameSync(`${manifestPath}.tmp`, manifestPath);

  const gzMb = (statSync(gzPath).size / 1048576).toFixed(2);
  const rawMb = (rawBuf.byteLength / 1048576).toFixed(2);
  console.log(
    `[poi-db] ${city.id}: gotowe ${stats.total} POI (${gzMb} MB gz / ${rawMb} MB sql) w ${((Date.now() - started) / 1000).toFixed(1)}s`,
  );
  return manifest;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const opts = parseArgs(process.argv.slice(2));
  if (!opts.city) {
    console.error('Użycie: node build-poi-db.mjs --city=<id> [--refresh] [--skip-overture|--skip-osm|--skip-wolt|--skip-cwoh|--skip-wikidata]');
    process.exit(1);
  }
  await buildCityPoiDatabase(opts);
}
