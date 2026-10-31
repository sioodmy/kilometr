import fs from 'node:fs';
import path from 'node:path';

const ROOT_DIR = path.resolve(import.meta.dirname, '../..');
const CACHE_FILE = path.join(ROOT_DIR, 'cloudflare/.cache/wroclaw-osm-elements.json');
const FORCE = process.argv.includes('--force');

async function main() {
  if (!FORCE && fs.existsSync(CACHE_FILE) && fs.statSync(CACHE_FILE).size > 500_000) {
    console.log(
      `[i] OSM cache already exists: ${(fs.statSync(CACHE_FILE).size / 1024 / 1024).toFixed(1)} MB (użyj --force aby odświeżyć)`,
    );
    return;
  }

  const q = `[out:json][timeout:60];
(
  nwr(51.02,16.82,51.21,17.18)["public_transport"="platform"];
  nwr(51.02,16.82,51.21,17.18)["highway"="bus_stop"];
  nwr(51.02,16.82,51.21,17.18)["railway"~"tram_stop|station|halt"];
  nwr(51.02,16.82,51.21,17.18)["shop"];
  nwr(51.02,16.82,51.21,17.18)["amenity"~"fuel|fast_food|restaurant|cafe|pharmacy|post_office|hospital|bank|cinema|theatre|place_of_worship|marketplace|pub"];
  nwr(51.02,16.82,51.21,17.18)["leisure"~"park|garden|playground"];
  nwr(51.02,16.82,51.21,17.18)["tourism"~"museum|hotel|attraction|viewpoint"];
  nwr(51.02,16.82,51.21,17.18)["building"~"train_station|commercial|retail|hospital|public|supermarket"];
  nwr(51.02,16.82,51.21,17.18)["bridge"];
  nwr(51.02,16.82,51.21,17.18)["waterway"~"river|canal"];
  nwr(51.02,16.82,51.21,17.18)["highway"~"primary|secondary|tertiary|residential"];
);
out center tags;`;

  console.log(
    '[i] Pobieranie pełnego kontekstu OSM dla Wrocławia (w tym parki, restauracje, mosty)...',
  );
  const mirrors = [
    'https://overpass.kumi.systems/api/interpreter',
    'https://overpass-api.de/api/interpreter',
    'https://overpass.openstreetmap.fr/api/interpreter',
  ];

  for (const mirror of mirrors) {
    try {
      console.log(`[i] Próba lustra: ${mirror}`);
      const res = await fetch(mirror, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': 'KilometrStopHints/1.0 (https://github.com/sioodmy/kilometr)',
        },
        body: 'data=' + encodeURIComponent(q),
        signal: AbortSignal.timeout(60000),
      });
      if (res.ok) {
        const json = await res.json();
        if (json.elements && json.elements.length > 1000) {
          fs.writeFileSync(CACHE_FILE, JSON.stringify(json.elements), 'utf8');
          console.log(`[✓] Zapisano ${json.elements.length} elementów OSM do: ${CACHE_FILE}`);
          return;
        }
      }
    } catch (err) {
      console.warn(`[!] Błąd lustra ${mirror}: ${err.message}`);
    }
  }
  throw new Error('Nie udało się pobrać danych z żadnego lustra Overpass.');
}

main().catch((err) => {
  console.error('[!] Błąd cache-osm:', err);
  process.exit(1);
});
