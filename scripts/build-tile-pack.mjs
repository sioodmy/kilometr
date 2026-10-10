// Pakiet kafelków Wrocławia do archiwum gotowego do serwowania z telefonu.
//
// Format archiwum (KMTP v1):
//   nagłówek 32 B  : magic "KMTP" | wersja u32 | liczba kafelków u32 | maxzoom u32
//   katalog       : pozycja + rozmiar kafla (offset u64, len u32) + z/x/y (u8/u16/u16)
//   dane          : sklejone kafle, bez zmian (serwer wysyła jako application/x-protobuf)
//
// Katalog jest posortowany po (z, x, y), więc natywny serwer znajduje kafel
// zwykłym wyszukiwaniem binarnym po pliku, bez wczytywania indeksu do RAM.
//
// Uruchomienie: node scripts/build-tile-pack.mjs

import { mkdirSync, writeFileSync, readFileSync, statSync } from 'node:fs';
import { Buffer } from 'node:buffer';

const TS = '20261004_113936_pt';
const BASE = `https://tiles.openfreemap.org/planet/${TS}`;
const OUT = process.argv[2] || 'wroclaw-tiles.ktp';
const CACHE = 'tilecache';

const BBOX = { minLon: 16.8, minLat: 51.0, maxLon: 17.28, maxLat: 51.22 };
const MAXZOOM = 14;

function lon2x(lon, z) { return Math.floor(((lon + 180) / 360) * 2 ** z); }
function lat2y(lat, z) {
  const r = (lat * Math.PI) / 180;
  return Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** z);
}

function tilesFor(z) {
  const out = [];
  const x0 = lon2x(BBOX.minLon, z), x1 = lon2x(BBOX.maxLon, z);
  const y0 = lat2y(BBOX.maxLat, z), y1 = lat2y(BBOX.minLat, z);
  for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) out.push([z, x, y]);
  return out;
}

function key(z, x, y) { return `${z}/${x}/${y}`; }

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
  } catch (e) {
    if (attempt >= 3) return null;
    await new Promise((r) => setTimeout(r, 800 * attempt));
    return fetchTile(z, x, y, attempt + 1);
  }
}

(async () => {
  try { mkdirSync(CACHE); } catch {}
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
      const k = key(z, x, y);
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
        entries.push({ z, x, y, data: buf });
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
  header.writeUInt32LE(1, 4);
  header.writeUInt32LE(entries.length, 8);
  header.writeUInt32LE(MAXZOOM, 12);

  const DATA_START = 32 + dirBytes;
  const dir = Buffer.alloc(dirBytes);
  const ordered = Buffer.concat([header, dir]);
  let dataPos = DATA_START;
  let p = 0;
  for (const e of entries) {
    // Katalog ma stać szerokość 18 B na pozycję: offset u64, len u32, z u8,
    // x u16, y u16, pad u8. Bez paddingu pozycje rozjeżdżają się o bajt.
    dir.writeBigUInt64LE(BigInt(dataPos), p); p += 8;
    dir.writeUInt32LE(e.data.length, p); p += 4;
    dir.writeUInt8(e.z, p); p += 1;
    dir.writeUInt16LE(e.x, p); p += 2;
    dir.writeUInt16LE(e.y, p); p += 2;
    dir.writeUInt8(0, p); p += 1;
    dataPos += e.data.length;
  }

  writeFileSync(OUT, Buffer.concat([header, dir, ...entries.map((e) => e.data)]));
  const size = statSync(OUT).size;
  console.log(`\nGotowe: ${OUT}`);
  console.log(`  kafelkow: ${entries.length}`);
  console.log(`  rozmiar:  ${(size / 1048576).toFixed(1)} MB`);
  if (dataPos !== size) {
    throw new Error(`Offsety nie zgadzają się z rozmiarem pliku (${dataPos} vs ${size})`);
  }
})();