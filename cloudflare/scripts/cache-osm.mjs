import fs from 'node:fs';
import path from 'node:path';
import { fetchOverpassElements, overpassMirrors } from './overpass.mjs';

const ROOT_DIR = path.resolve(import.meta.dirname, '../..');
const CACHE_DIR = path.join(ROOT_DIR, 'cloudflare/.cache');
const USER_AGENT = 'KilometrStopHints/2.0 (https://github.com/sioodmy/kilometr)';

export const CITY_BOUNDS = {
  warszawa: { bbox: [52.08, 20.84, 52.37, 21.26], tiles: [2, 2] },
  wroclaw: { bbox: [51.03, 16.82, 51.21, 17.22], tiles: [2, 1] },
  krakow: { bbox: [49.97, 19.77, 50.15, 20.17], tiles: [2, 1] },
  poznan: { bbox: [52.30, 16.73, 52.50, 17.08], tiles: [2, 1] },
  gzm: { bbox: [50.14, 18.60, 50.45, 19.30], tiles: [2, 2] },
};

function makeTiles([s, w, n, e], [rows, cols]) {
  const out = [];
  const dLat = (n - s) / rows;
  const dLon = (e - w) / cols;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      out.push([
        +(s + r * dLat).toFixed(5),
        +(w + c * dLon).toFixed(5),
        +(s + (r + 1) * dLat).toFixed(5),
        +(w + (c + 1) * dLon).toFixed(5),
      ]);
    }
  }
  return out;
}

function buildPoiQuery(tile) {
  const b = tile.join(',');
  return `[out:json][timeout:90];
(
  nwr(${b})["public_transport"="platform"];
  node(${b})["highway"="bus_stop"];
  node(${b})["railway"~"^(tram_stop|station|halt|subway_entrance)$"];
  way(${b})["railway"~"^(station|halt)$"]["name"];
  way(${b})["railway"~"^(rail|light_rail)"]["bridge"="yes"];
  nwr(${b})["shop"~"^(mall|department_store|supermarket|convenience|chemist|bakery|books|electronics|doityourself|furniture|sports)$"]["name"];
  nwr(${b})["amenity"~"^(fuel|fast_food|restaurant|cafe|pharmacy|post_office|hospital|bank|cinema|theatre|place_of_worship|marketplace|library|university|college|school|townhall|bus_station|police|fire_station|arts_centre)$"]["name"];
  nwr(${b})["leisure"~"^(park|garden|stadium|sports_centre)$"]["name"];
  nwr(${b})["tourism"~"^(museum|hotel|attraction|gallery|zoo)$"]["name"];
);
out center tags;`;
}

function buildRoadQuery(tile) {
  const b = tile.join(',');
  return `[out:json][timeout:90];
(
  way(${b})["highway"~"^(trunk|primary|secondary|tertiary|unclassified|residential|living_street|pedestrian)$"]["name"];
);
out geom tags;`;
}

async function fetchTiled(city, kind, queryBuilder, outFile, force) {
  if (!force && fs.existsSync(outFile) && fs.statSync(outFile).size > 50_000) {
    console.log(`[i] ${city}/${kind}: cache juz istnieje (${(fs.statSync(outFile).size / 1024 / 1024).toFixed(1)} MB)`);
    return;
  }

  const { bbox, tiles: grid } = CITY_BOUNDS[city];
  const tiles = makeTiles(bbox, grid);
  const mirrors = overpassMirrors(process.env.OVERPASS_URL);
  const byKey = new Map();

  for (let i = 0; i < tiles.length; i++) {
    const tile = tiles[i];
    console.log(`[i] ${city}/${kind}: kafel ${i + 1}/${tiles.length} [${tile.join(',')}]...`);
    const els = await fetchOverpassElements({
      query: queryBuilder(tile),
      mirrors,
      userAgent: USER_AGENT,
      timeoutMs: 90_000,
      hedgeMs: 12_000,
    });
    for (const el of els) {
      const k = `${el.type}:${el.id}`;
      if (!byKey.has(k)) {
        // Slim down geometry/tags to keep cache compact and fast to parse
        if (kind === 'roads') {
          if (Array.isArray(el.geometry) && el.geometry.length >= 2 && el.tags?.name) {
            byKey.set(k, {
              id: el.id,
              name: el.tags.name,
              hw: el.tags.highway,
              bridge: el.tags.bridge === 'yes' ? 1 : 0,
              tunnel: el.tags.tunnel === 'yes' || el.tags.layer === '-1' ? 1 : 0,
              g: el.geometry.map((p) => [+p.lat.toFixed(6), +p.lon.toFixed(6)]),
            });
          }
        } else {
          const lat = el.lat ?? el.center?.lat;
          const lon = el.lon ?? el.center?.lon;
          if (lat != null && lon != null) {
            byKey.set(k, {
              type: el.type,
              id: el.id,
              lat: +lat.toFixed(6),
              lon: +lon.toFixed(6),
              tags: el.tags || {},
            });
          }
        }
      }
    }
    if (i < tiles.length - 1) {
      await new Promise((r) => setTimeout(r, 1500));
    }
  }

  const list = [...byKey.values()];
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  fs.writeFileSync(outFile, JSON.stringify(list), 'utf8');
  console.log(`[✓] ${city}/${kind}: zapisano ${list.length} elementow -> ${path.basename(outFile)} (${(fs.statSync(outFile).size / 1024 / 1024).toFixed(1)} MB)`);
}

async function main() {
  const args = process.argv.slice(2);
  const force = args.includes('--force');
  const all = args.includes('--all');
  const cityArg = args.find((a) => a.startsWith('--city='))?.split('=')[1];
  const cities = all
    ? Object.keys(CITY_BOUNDS)
    : cityArg
      ? [cityArg]
      : ['wroclaw'];

  for (const city of cities) {
    if (!CITY_BOUNDS[city]) {
      throw new Error(`Nieznane miasto: ${city}`);
    }
    await fetchTiled(city, 'pois', buildPoiQuery, path.join(CACHE_DIR, `${city}-osm-pois.json`), force);
    await fetchTiled(city, 'roads', buildRoadQuery, path.join(CACHE_DIR, `${city}-osm-roads.json`), force);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error('[!] Blad cache-osm:', err);
    process.exit(1);
  });
}
