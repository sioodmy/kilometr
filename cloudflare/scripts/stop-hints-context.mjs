#!/usr/bin/env node
/**
 * Ekstraktor bogatego, uziemionego kontekstu przestrzennego dla wskazówek przystankowych (stop-hints).
 *
 * Zapobiega halucynacjom modeli (np. gemini-3.8-flash) poprzez:
 * 1. Wyciąganie z GTFS dokładnych linii i kierunków (headsigns) dla każdego konkretnego słupka.
 * 2. Odpytywanie OSM (Overpass API z lustrami awaryjnymi) o perony, relacje i obiekty POI.
 * 3. Wyliczanie dokładnej odległości w metrach (Haversine) od słupka do każdego POI.
 * 4. Twardy filtr odległości: punkty POI > 35 m są oznaczane jako nieprzylegające, by model
 *    nie zmyślał obecności sklepów czy stacji benzynowych bezpośrednio przy peronie.
 *
 * Użycie:
 *   node cloudflare/scripts/stop-hints-context.mjs --pole=20820
 *   node cloudflare/scripts/stop-hints-context.mjs --cluster="grunwaldzki"
 *   node cloudflare/scripts/stop-hints-context.mjs --limit=10
 *   node cloudflare/scripts/stop-hints-context.mjs --all
 */
import fs from 'node:fs';
import path from 'node:path';
import { execSync, spawn } from 'node:child_process';
import readline from 'node:readline';

const ROOT_DIR = path.resolve(import.meta.dirname, '../..');

const ARGS = process.argv.slice(2);
function getArg(prefix, fallback = null) {
  const match = ARGS.find((a) => a.startsWith(prefix));
  return match ? match.slice(prefix.length) : fallback;
}

const CITY = getArg('--city=', 'wroclaw').toLowerCase();
const POLE_ARG = getArg('--pole=', null);
const CLUSTER_ARG = getArg('--cluster=', null);
const LIMIT = parseInt(getArg('--limit=', '20'), 10) || 20;
const INCLUDE_ALL = ARGS.includes('--all');
const JSON_OUTPUT = ARGS.includes('--json');
const OUT_FILE = getArg('--output=', null);

const OVERPASS_MIRRORS = [
  'https://overpass.openstreetmap.fr/api/interpreter',
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
];

function haversineDistanceMeters(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Math.round(R * c);
}

async function downloadOrGetGtfs() {
  const cachePath = path.join('/tmp', `kilometr-gtfs-${CITY}.zip`);
  if (fs.existsSync(cachePath) && fs.statSync(cachePath).size > 100_000) {
    return cachePath;
  }
  console.error(`[i] Pobieranie świeżego GTFS dla: ${CITY}...`);
  const url =
    CITY === 'wroclaw'
      ? 'https://open-data.cui.wroclaw.pl/hdb/download/136/'
      : null;
  if (!url) {
    throw new Error(`Brak zdefiniowanego źródła GTFS dla miasta: ${CITY}`);
  }
  const res = await fetch(url, {
    headers: { 'User-Agent': 'KilometrStopHints/1.0' },
  });
  if (!res.ok) throw new Error(`Błąd pobierania GTFS HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(cachePath, buf);
  return cachePath;
}

async function queryOverpass(query) {
  for (const mirror of OVERPASS_MIRRORS) {
    try {
      const res = await fetch(mirror, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': 'KilometrStopHints/1.0 (https://github.com/sioodmy/kilometr)',
        },
        body: 'data=' + encodeURIComponent(query),
        signal: AbortSignal.timeout(12000),
      });
      if (res.ok) {
        const json = await res.json();
        if (Array.isArray(json.elements)) {
          return json.elements;
        }
      }
    } catch {
      // Lustro awaryjne przejmuje zapytanie
    }
  }
  return [];
}

/**
 * Odpytuje OSM o infrastrukturę peronową oraz obiekty POI wokół zadanego punktu.
 */
async function getOsmContextForCoords(lat, lon, radius = 90) {
  const query = `
[out:json][timeout:15];
(
  nwr(around:${radius},${lat},${lon})["public_transport"="platform"];
  nwr(around:${radius},${lat},${lon})["highway"="bus_stop"];
  nwr(around:${radius},${lat},${lon})["railway"="tram_stop"];
  nwr(around:${radius},${lat},${lon})["shop"];
  nwr(around:${radius},${lat},${lon})["amenity"~"fuel|fast_food|pharmacy|post_office|hospital|bank|cinema|theatre|place_of_worship"];
  nwr(around:${radius},${lat},${lon})["building"~"train_station|commercial|retail|hospital|public"];
  nwr(around:${radius},${lat},${lon})["highway"~"primary|secondary|tertiary|residential"];
);
out center tags;
`;
  let rawElements = [];
  for (let attempt = 0; attempt < 3; attempt++) {
    rawElements = await queryOverpass(query);
    if (rawElements.length) break;
    // Lustra Overpass potrafią zwrócić 200 z pustą listą: ponawiamy przed kapitulacją
    if (attempt < 2) await new Promise((r) => setTimeout(r, 2500));
  }
  console.error(`[i] Overpass: ${rawElements.length} elementów w promieniu ${radius}m`);

  const platforms = [];
  const landmarks = [];
  const streetNames = new Map(); // klucz: lowercase, wartość: oryginalna nazwa

  for (const e of rawElements) {
    const t = e.tags || {};
    const eLat = e.lat ?? e.center?.lat;
    const eLon = e.lon ?? e.center?.lon;
    if (eLat == null || eLon == null) continue;

    const dist = haversineDistanceMeters(lat, lon, eLat, eLon);

    if (t.highway && !t.bus_stop && t.name) {
      const key = t.name.toLowerCase();
      if (!streetNames.has(key)) streetNames.set(key, t.name);
      continue; // ulice nie są landmarkami
    }

    if (t.public_transport === 'platform' || t.highway === 'bus_stop' || t.railway === 'tram_stop') {
      platforms.push({
        id: `${e.type}/${e.id}`,
        distMeters: dist,
        ref: t.ref || t.local_ref || t['ref:bus'] || t['ref:tram'],
        inscription: t.inscription,
        name: t.name,
        shelter: t.shelter === 'yes',
        tactile: t.tactile_paving === 'yes',
        level: t.level,
      });
      continue;
    }

    const name = t.name || t.brand || t.operator;
    if (name) {
      const category = t.shop
        ? `sklep (${t.shop})`
        : t.amenity === 'fuel'
          ? 'stacja paliw'
          : t.amenity === 'place_of_worship'
            ? 'kościół/świątynia'
            : t.amenity === 'fast_food'
              ? 'gastronomia'
              : t.amenity === 'pharmacy'
                ? 'apteka'
                : t.amenity === 'post_office'
                  ? 'poczta'
                  : t.amenity === 'hospital'
                    ? 'szpital'
                    : t.place === 'square'
                      ? 'plac'
                      : t.leisure === 'park'
                        ? 'park'
                        : t.tourism || t.historic
                          ? 'atrakcja'
                          : t.building === 'train_station'
                            ? 'dworzec kolejowy'
                            : t.building || t.amenity;

      const isMajor =
        /train_station|hospital|commercial|retail|mall/i.test(category) ||
        /galeria|dworzec|szpital|kościół|plac/i.test(name);

      landmarks.push({
        name,
        category,
        brand: t.brand,
        distMeters: dist,
        isMajor,
      });
    }
  }

  // Dedup landmarków: ten sam POI zwrócony jako node i way ma jedną nazwę
  const seenLandmarks = new Map();
  for (const l of landmarks) {
    const key = `${l.name.toLowerCase()}|${l.category}`;
    if (!seenLandmarks.has(key) || seenLandmarks.get(key).distMeters > l.distMeters) {
      seenLandmarks.set(key, l);
    }
  }
  const dedupedLandmarks = Array.from(seenLandmarks.values());

  platforms.sort((a, b) => a.distMeters - b.distMeters);
  dedupedLandmarks.sort((a, b) => a.distMeters - b.distMeters);

  return {
    platforms,
    landmarks: dedupedLandmarks,
    streets: Array.from(streetNames.values()),
  };
}

async function loadGtfsIndex(zipPath) {
  console.error('[i] Indeksowanie GTFS (stops, routes, trips, stop_times)...');

  const stopsCsv = execSync(`unzip -p "${zipPath}" stops.txt`, {
    maxBuffer: 30 * 1024 * 1024,
  }).toString('utf8');

  const routesCsv = execSync(`unzip -p "${zipPath}" routes.txt`, {
    maxBuffer: 30 * 1024 * 1024,
  }).toString('utf8');

  const tripsCsv = execSync(`unzip -p "${zipPath}" trips.txt`, {
    maxBuffer: 30 * 1024 * 1024,
  }).toString('utf8');

  const routesMap = new Map();
  for (const line of routesCsv.split('\n').slice(1)) {
    if (!line.trim()) continue;
    const p = line.split(',');
    if (p.length >= 3) {
      routesMap.set(p[0].trim(), p[2].replace(/"/g, '').trim());
    }
  }

  const tripToRoute = new Map();
  const tripToHeadsign = new Map();
  for (const line of tripsCsv.split('\n').slice(1)) {
    if (!line.trim()) continue;
    const p = line.split(',');
    if (p.length >= 4) {
      const routeId = p[0].trim();
      const tripId = p[2].trim();
      const headsign = p[3].replace(/"/g, '').trim();
      const routeShort = routesMap.get(routeId);
      if (routeShort) tripToRoute.set(tripId, routeShort);
      if (headsign) tripToHeadsign.set(tripId, headsign);
    }
  }

  const stopLinesMap = new Map();
  const stopHeadsignsMap = new Map();

  await new Promise((resolve) => {
    const child = spawn('unzip', ['-p', zipPath, 'stop_times.txt']);
    const rl = readline.createInterface({ input: child.stdout, crlfDelay: Infinity });
    let isHeader = true;

    rl.on('line', (line) => {
      if (isHeader) {
        isHeader = false;
        return;
      }
      const p = line.split(',');
      if (p.length >= 4) {
        const tripId = p[0].trim();
        const stopId = p[3].trim();

        const route = tripToRoute.get(tripId);
        if (route) {
          let sRoutes = stopLinesMap.get(stopId);
          if (!sRoutes) {
            sRoutes = new Set();
            stopLinesMap.set(stopId, sRoutes);
          }
          sRoutes.add(route);
        }

        const headsign = tripToHeadsign.get(tripId);
        if (headsign) {
          let sHeadsigns = stopHeadsignsMap.get(stopId);
          if (!sHeadsigns) {
            sHeadsigns = new Set();
            stopHeadsignsMap.set(stopId, sHeadsigns);
          }
          sHeadsigns.add(headsign);
        }
      }
    });

    rl.on('close', resolve);
  });

  const stops = [];
  for (const line of stopsCsv.split('\n').slice(1)) {
    if (!line.trim()) continue;
    const p = line.split(',');
    if (p.length < 5) continue;
    const stopId = p[0].trim();
    const stopCode = p[1].replace(/"/g, '').trim();
    const stopName = p[2].replace(/"/g, '').trim();
    const lat = parseFloat(p[3]);
    const lon = parseFloat(p[4]);

    const lines = Array.from(stopLinesMap.get(stopId) || []).sort((a, b) =>
      a.localeCompare(b, undefined, { numeric: true }),
    );
    const headsigns = Array.from(stopHeadsignsMap.get(stopId) || []).slice(0, 5);

    stops.push({
      stopId,
      stopCode,
      stopName,
      lat,
      lon,
      lines,
      headsigns,
    });
  }

  return stops;
}

function formatPoleContext(pole, osm) {
  const primaryLandmarks = osm.landmarks.filter(
    (l) => l.distMeters <= 35 || (l.isMajor && l.distMeters <= 75),
  );

  return {
    code: pole.stopCode,
    id: pole.stopId,
    name: pole.stopName,
    coords: `${pole.lat.toFixed(5)}, ${pole.lon.toFixed(5)}`,
    lines: pole.lines.join(', ') || 'brak stałych linii',
    destinations: pole.headsigns.join(', ') || 'brak danych',
    surroundingStreets: osm.streets.slice(0, 4).join(', ') || 'nieokreślona',
    verifiedNearbyLandmarks: primaryLandmarks.map(
      (l) => `${l.name} (${l.category}, ${l.distMeters}m od słupka)`,
    ),
    osmPlatformsNearby: osm.platforms.slice(0, 3).map((p) => {
      const tags = [];
      if (p.ref) tags.push(`peron/ref: ${p.ref}`);
      if (p.inscription) tags.push(`napis: ${p.inscription}`);
      if (p.level) tags.push(`poziom: ${p.level}`);
      if (p.shelter) tags.push('wiata: tak');
      return `${p.distMeters}m: ${tags.join(', ') || p.name || p.id}`;
    }),
  };
}

async function main() {
  const zipPath = await downloadOrGetGtfs();
  const allStops = await loadGtfsIndex(zipPath);

  // Filtrowanie według słupka lub klastra
  let targetStops = allStops;
  if (POLE_ARG) {
    targetStops = allStops.filter(
      (s) => s.stopCode === POLE_ARG || s.stopId === POLE_ARG,
    );
    if (!targetStops.length) {
      console.error(`[!] Nie znaleziono słupka o kodzie/ID: ${POLE_ARG}`);
      process.exit(1);
    }
  } else if (CLUSTER_ARG) {
    const q = CLUSTER_ARG.toLowerCase();
    targetStops = allStops.filter((s) => s.stopName.toLowerCase().includes(q));
    if (!targetStops.length) {
      console.error(`[!] Nie znaleziono zespołu przystankowego pasującego do: ${CLUSTER_ARG}`);
      process.exit(1);
    }
  }

  // Grupowanie w zespoły
  const clusterMap = new Map();
  for (const s of targetStops) {
    const list = clusterMap.get(s.stopName) || [];
    list.push(s);
    clusterMap.set(s.stopName, list);
  }

  let selectedClusters = Array.from(clusterMap.entries());
  if (!POLE_ARG && !CLUSTER_ARG && !INCLUDE_ALL) {
    // Pomiń przelotowe (<= 2 słupki)
    selectedClusters = selectedClusters.filter(([, poles]) => poles.length > 2);
  }
  selectedClusters.sort((a, b) => b[1].length - a[1].length);
  selectedClusters = selectedClusters.slice(0, LIMIT);

  const results = [];

  for (const [clusterName, poles] of selectedClusters) {
    console.error(`\n[+] Pobieranie kontekstu OSM dla zespołu: ${clusterName} (${poles.length} słupków)...`);
    const polesData = [];

    for (const pole of poles) {
      const osm = await getOsmContextForCoords(pole.lat, pole.lon, 80);
      polesData.push(formatPoleContext(pole, osm));
    }

    results.push({
      cluster: clusterName,
      poleCount: poles.length,
      poles: polesData,
    });
  }

  if (JSON_OUTPUT || OUT_FILE) {
    const out = JSON.stringify(results, null, 2);
    if (OUT_FILE) {
      fs.writeFileSync(OUT_FILE, out, 'utf8');
      console.error(`[✓] Zapisano kontekst do: ${OUT_FILE}`);
    } else {
      console.log(out);
    }
    return;
  }

  // Human / LLM-friendly Text Output
  console.log(`\n======================================================`);
  console.log(` RAPORT KONTEKSTU PRZESTRZENNEGO DLA MODELU AI`);
  console.log(`======================================================\n`);

  for (const cluster of results) {
    console.log(`### ZESPÓŁ: ${cluster.cluster} (liczba słupków: ${cluster.poleCount})`);
    for (const p of cluster.poles) {
      console.log(`\n  * SŁUPEK [${p.code}] (ID: ${p.id})`);
      console.log(`    - Współrzędne: ${p.coords}`);
      console.log(`    - Ulice przy słupku: ${p.surroundingStreets}`);
      console.log(`    - Linie: ${p.lines}`);
      console.log(`    - Główne kierunki: ${p.destinations}`);
      if (p.osmPlatformsNearby.length) {
        console.log(`    - Perony OSM: ${p.osmPlatformsNearby.join(' | ')}`);
      }
      if (p.verifiedNearbyLandmarks.length) {
        console.log(`    - ZWERYFIKOWANE PUNKTY ORIENTACYJNE (< 35m lub kluczowe < 75m):`);
        for (const lm of p.verifiedNearbyLandmarks) {
          console.log(`      * ${lm}`);
        }
      } else {
        console.log(`    - Punkty orientacyjne: BRAK bezpośrednio przylegających (ZAKAZ wymyślania sklepów/sieciówek!)`);
      }
    }
    console.log(`\n------------------------------------------------------`);
  }
}

main().catch((err) => {
  console.error(`[!] Błąd:`, err.message);
  process.exit(1);
});
