// Pakiet kafelków miasta do archiwum gotowego do serwowania z telefonu.
//
// Format archiwum (KMTP v2):
//   nagłówek 32 B  : magic "KMTP" | wersja u32 (=2) | liczba kafelków u32 | maxzoom u32
//   katalog       : pozycja + rozmiar kafla (offset u64, len u32) + z/x/y (u8/u16/u16) + pad u8
//   dane          : sklejone kafle, każdy skompresowany gzipem (level 9).
//                   Natywny serwer HTTP odsyła kafel z nagłówkiem `Content-Encoding: gzip`,
//                   dzięki czemu silnik WebView rozpakowuje go sprzętowo/w C++ w locie.
//
// Katalog jest posortowany po (z, x, y), więc natywny serwer znajduje kafel
// zwykłym wyszukiwaniem binarnym po pliku, bez wczytywania indeksu do RAM.
//
// Uruchomienie: node scripts/build-tile-pack.mjs [--city=wroclaw|krakow|gzm|warszawa|poznan|lodz] [output]
//
// Nowe miasto = wpis w CITY_PACKS niżej (bbox + maxzoom + nazwa pliku).

import { mkdirSync, writeFileSync, readFileSync, statSync } from 'node:fs';
import { Buffer } from 'node:buffer';
import { gzipSync } from 'node:zlib';

const TS = '20261004_113936_pt';
const BASE = `https://tiles.openfreemap.org/planet/${TS}`;

/** Bboxy pakietów: muszą pokrywać strefę obsługi miasta z zapasem. */
const CITY_PACKS = {
  wroclaw: {
    out: 'wroclaw-tiles.ktp',
    bbox: { minLon: 16.8, minLat: 51.0, maxLon: 17.28, maxLat: 51.22 },
    maxZoom: 14,
  },
  krakow: {
    out: 'krakow-tiles.ktp',
    bbox: { minLon: 19.7, minLat: 49.96, maxLon: 20.3, maxLat: 50.16 },
    maxZoom: 14,
  },
  gzm: {
    out: 'gzm-tiles.ktp',
    bbox: { minLon: 18.25, minLat: 49.9, maxLon: 19.85, maxLat: 50.65 },
    // Dzięki kompresji gzip pełne z14 dla całej metropolii mieści się w ~104 MB
    // (limit R2 to 300 MB) i odblokowuje pieszy routing offline w Raptorze.
    maxZoom: 14,
  },
  warszawa: {
    out: 'warszawa-tiles.ktp',
    bbox: { minLon: 20.85, minLat: 52.05, maxLon: 21.28, maxLat: 52.35 },
    // Stolica w z14 z kompresją gzip zajmuje ~39 MB z zapasem na lotnisko i SKM.
    maxZoom: 14,
  },
  poznan: {
    out: 'poznan-tiles.ktp',
    bbox: { minLon: 16.6, minLat: 52.15, maxLon: 17.3, maxLat: 52.65 },
    // Pełna strefa aglomeracji w z14 z gzipem to ~23 MB (jak tileBbox w cities.ts).
    maxZoom: 14,
  },
  lodz: {
    out: 'lodz-tiles.ktp',
    bbox: { minLon: 19.05, minLat: 51.55, maxLon: 19.85, maxLat: 51.97 },
    // Pełna strefa aglomeracji w z14 z gzipem to ~20 MB (pomiar próbką kafli).
    maxZoom: 14,
  },
};

const argv = process.argv.slice(2);
const cityArg = argv.map((a) => /^--city=(.+)$/.exec(a)?.[1]).find(Boolean) || 'wroclaw';
const CITY = CITY_PACKS[cityArg] ? cityArg : 'wroclaw';
const PACK = CITY_PACKS[CITY];
const OUT = argv.find((a) => !a.startsWith('--')) || PACK.out;
const CACHE = `tilecache-${CITY}`;

const BBOX = PACK.bbox;
const MAXZOOM = PACK.maxZoom;

function lon2x(lon, z) {
  return Math.floor(((lon + 180) / 360) * 2 ** z);
}
function lat2y(lat, z) {
  const r = (lat * Math.PI) / 180;
  return Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** z);
}

function tilesFor(z) {
  const out = [];
  const x0 = lon2x(BBOX.minLon, z),
    x1 = lon2x(BBOX.maxLon, z);
  const y0 = lat2y(BBOX.maxLat, z),
    y1 = lat2y(BBOX.minLat, z);
  for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) out.push([z, x, y]);
  return out;
}

async function fetchTile(z, x, y, attempt = 1) {
  const url = `${BASE}/${z}/${x}/${y}.pbf`;
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 30000);
    const res = await fetch(url, { signal: ctrl.signal });
    clearTimeout(t);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    return buf.length > 0 ? buf : null; // pusty kafel = poza zasięgiem, pomijamy
  } catch {
    if (attempt >= 3) return null;
    await new Promise((r) => setTimeout(r, 800 * attempt));
    return fetchTile(z, x, y, attempt + 1);
  }
}

function compressTile(buf) {
  // Jeśli z jakiegoś powodu bufor jest już gzipem (np. z zewnętrznego źródła)
  if (buf.length >= 2 && buf[0] === 0x1f && buf[1] === 0x8b) {
    return buf;
  }
  return gzipSync(buf, { level: 9 });
}

(async () => {
  try {
    mkdirSync(CACHE);
  } catch {}
  const all = [];
  for (let z = 0; z <= MAXZOOM; z++) all.push(...tilesFor(z));
  console.log(`Kafelkow do pobrania: ${all.length} (z0-${MAXZOOM})`);

  const entries = [];
  let done = 0;
  const t0 = Date.now();

  // Umiarkowana równoległość, żeby nie obciążać publicznego serwera.
  const CONC = 6;
  const queue = [...all];

  async function worker() {
    for (;;) {
      const t = queue.shift();
      if (!t) return;
      const [z, x, y] = t;
      let buf = await fetchTile(z, x, y);
      const cpath = `${CACHE}/${z}/${x}/${y}.pbf`;
      if (buf) {
        mkdirSync(`${CACHE}/${z}/${x}`, { recursive: true });
        writeFileSync(cpath, buf);
      } else {
        // Kafel pusty albo poza zasięgiem: sprawdzamy cache przy kolejnym buildzie.
        try {
          buf = readFileSync(cpath);
        } catch {
          buf = null;
        }
      }
      if (buf && buf.length > 0) {
        entries.push({ z, x, y, data: compressTile(buf) });
      }
      done++;
      if (done % 25 === 0) {
        const mb = entries.reduce((a, e) => a + e.data.length, 0) / 1048576;
        const el = (Date.now() - t0) / 1000;
        console.log(`  ${done}/${all.length} kafelkow, ${mb.toFixed(1)} MB, ${el.toFixed(0)}s`);
      }
    }
  }

  await Promise.all(Array.from({ length: CONC }, worker));

  // Kafle zbieraliśmy współbiegle, więc kolejność katalogu nie odpowiada
  // kolejności bajtów w pliku. Sortujemy, a offsety przeliczamy dopiero
  // potem — inaczej katalog wskazuje cudze bajty.
  entries.sort((a, b) => a.z - b.z || a.x - b.x || a.y - b.y);

  const dirBytes = entries.length * 18;
  const header = Buffer.alloc(32);
  header.write('KMTP', 0, 'ascii');
  header.writeUInt32LE(2, 4); // KMTP v2: kafle skompresowane gzipem
  header.writeUInt32LE(entries.length, 8);
  header.writeUInt32LE(MAXZOOM, 12);

  const DATA_START = 32 + dirBytes;
  const dir = Buffer.alloc(dirBytes);
  let dataPos = DATA_START;
  let p = 0;
  for (const e of entries) {
    // Katalog ma stać szerokość 18 B na pozycję: offset u64, len u32, z u8,
    // x u16, y u16, pad u8. Bez paddingu pozycje rozjeżdżają się o bajt.
    dir.writeBigUInt64LE(BigInt(dataPos), p);
    p += 8;
    dir.writeUInt32LE(e.data.length, p);
    p += 4;
    dir.writeUInt8(e.z, p);
    p += 1;
    dir.writeUInt16LE(e.x, p);
    p += 2;
    dir.writeUInt16LE(e.y, p);
    p += 2;
    dir.writeUInt8(0, p);
    p += 1;
    dataPos += e.data.length;
  }

  writeFileSync(OUT, Buffer.concat([header, dir, ...entries.map((e) => e.data)]));
  const size = statSync(OUT).size;
  console.log(`\nGotowe: ${OUT} (KMTP v2)`);
  console.log(`  kafelkow: ${entries.length}`);
  console.log(`  rozmiar:  ${(size / 1048576).toFixed(1)} MB`);
  if (dataPos !== size) {
    throw new Error(`Offsety nie zgadzają się z rozmiarem pliku (${dataPos} vs ${size})`);
  }
})();
