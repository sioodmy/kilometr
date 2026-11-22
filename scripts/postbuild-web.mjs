// Post-build PWA dla Cloudflare Pages (web.kilometr.app):
// 1. Generuje ikony PWA (192, 512, maskable-512, apple-touch-icon 180) i splash-icon z assets/.
// 2. Wstrzykuje listę zasobów statycznych oraz hash buildu do dist/sw.js.
// 3. Weryfikuje kompletność artefaktów pod deploy na Cloudflare Pages.

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const ROOT = path.resolve(import.meta.dirname, '..');
const DIST = path.join(ROOT, 'dist');
const ASSETS = path.join(ROOT, 'assets');
const ICONS_DIR = path.join(DIST, 'icons');

// ─── Minimalny dekoder/enkoder PNG (zero zewnętrznych zależności) ────────────

const CRC_TABLE = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) c = (c & 1) ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  CRC_TABLE[n] = c >>> 0;
}

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

function decodePng(filePath) {
  const buf = fs.readFileSync(filePath);
  let offset = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  let palette = null;
  let trns = null;
  const idat = [];

  while (offset < buf.length) {
    const len = buf.readUInt32BE(offset);
    const type = buf.subarray(offset + 4, offset + 8).toString('ascii');
    const data = buf.subarray(offset + 8, offset + 8 + len);
    offset += 12 + len;
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
    } else if (type === 'PLTE') {
      palette = data;
    } else if (type === 'tRNS') {
      trns = data;
    } else if (type === 'IDAT') {
      idat.push(data);
    } else if (type === 'IEND') {
      break;
    }
  }

  if (bitDepth !== 8) {
    throw new Error(`Nieobsługiwana głębia bitowa PNG (${bitDepth}) w ${filePath}`);
  }

  const raw = zlib.inflateSync(Buffer.concat(idat));
  const channels = colorType === 6 ? 4 : colorType === 2 ? 3 : colorType === 4 ? 2 : 1;
  const stride = width * channels;
  const unfilt = new Uint8Array(height * stride);

  let inPos = 0;
  for (let y = 0; y < height; y++) {
    const filter = raw[inPos++];
    const rowStart = y * stride;
    for (let x = 0; x < stride; x++) {
      const byte = raw[inPos++];
      const a = x >= channels ? unfilt[rowStart + x - channels] : 0;
      const b = y > 0 ? unfilt[rowStart - stride + x] : 0;
      const c = y > 0 && x >= channels ? unfilt[rowStart - stride + x - channels] : 0;
      let val = byte;
      if (filter === 1) val = (byte + a) & 0xff;
      else if (filter === 2) val = (byte + b) & 0xff;
      else if (filter === 3) val = (byte + ((a + b) >> 1)) & 0xff;
      else if (filter === 4) val = (byte + paeth(a, b, c)) & 0xff;
      unfilt[rowStart + x] = val;
    }
  }

  const rgba = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    const o = i * 4;
    if (colorType === 6) {
      rgba[o] = unfilt[o];
      rgba[o + 1] = unfilt[o + 1];
      rgba[o + 2] = unfilt[o + 2];
      rgba[o + 3] = unfilt[o + 3];
    } else if (colorType === 2) {
      const s = i * 3;
      rgba[o] = unfilt[s];
      rgba[o + 1] = unfilt[s + 1];
      rgba[o + 2] = unfilt[s + 2];
      rgba[o + 3] = 255;
    } else if (colorType === 3 && palette) {
      const idx = unfilt[i];
      rgba[o] = palette[idx * 3];
      rgba[o + 1] = palette[idx * 3 + 1];
      rgba[o + 2] = palette[idx * 3 + 2];
      rgba[o + 3] = trns && idx < trns.length ? trns[idx] : 255;
    } else if (colorType === 4) {
      const s = i * 2;
      rgba[o] = rgba[o + 1] = rgba[o + 2] = unfilt[s];
      rgba[o + 3] = unfilt[s + 1];
    } else {
      const g = unfilt[i];
      rgba[o] = rgba[o + 1] = rgba[o + 2] = g;
      rgba[o + 3] = 255;
    }
  }

  return { width, height, rgba };
}

function pngChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

function encodePng(width, height, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    const outRow = y * (stride + 1);
    raw[outRow] = 0;
    raw.set(rgba.subarray(y * stride, (y + 1) * stride), outRow + 1);
  }
  const compressed = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', compressed),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

function resizeRgba(src, targetW, targetH) {
  const dst = new Uint8Array(targetW * targetH * 4);
  const scaleX = src.width / targetW;
  const scaleY = src.height / targetH;

  for (let y = 0; y < targetH; y++) {
    const y0 = Math.floor(y * scaleY);
    const y1 = Math.min(src.height, Math.max(y0 + 1, Math.ceil((y + 1) * scaleY)));
    for (let x = 0; x < targetW; x++) {
      const x0 = Math.floor(x * scaleX);
      const x1 = Math.min(src.width, Math.max(x0 + 1, Math.ceil((x + 1) * scaleX)));
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      let count = 0;
      for (let sy = y0; sy < y1; sy++) {
        for (let sx = x0; sx < x1; sx++) {
          const i = (sy * src.width + sx) * 4;
          const alpha = src.rgba[i + 3];
          r += src.rgba[i] * alpha;
          g += src.rgba[i + 1] * alpha;
          b += src.rgba[i + 2] * alpha;
          a += alpha;
          count++;
        }
      }
      const o = (y * targetW + x) * 4;
      const outA = Math.round(a / count);
      dst[o + 3] = outA;
      if (a > 0) {
        dst[o] = Math.round(r / a);
        dst[o + 1] = Math.round(g / a);
        dst[o + 2] = Math.round(b / a);
      }
    }
  }
  return { width: targetW, height: targetH, rgba: dst };
}

function buildMaskableIcon(iconSrc, size, bgRgb) {
  const innerSize = Math.round(size * 0.8);
  const inner = resizeRgba(iconSrc, innerSize, innerSize);
  const pad = Math.floor((size - innerSize) / 2);
  const out = new Uint8Array(size * size * 4);
  for (let i = 0; i < size * size; i++) {
    const o = i * 4;
    out[o] = bgRgb[0];
    out[o + 1] = bgRgb[1];
    out[o + 2] = bgRgb[2];
    out[o + 3] = 255;
  }
  for (let y = 0; y < innerSize; y++) {
    for (let x = 0; x < innerSize; x++) {
      const si = (y * innerSize + x) * 4;
      const di = ((y + pad) * size + (x + pad)) * 4;
      const a = inner.rgba[si + 3] / 255;
      out[di] = Math.round(inner.rgba[si] * a + out[di] * (1 - a));
      out[di + 1] = Math.round(inner.rgba[si + 1] * a + out[di + 1] * (1 - a));
      out[di + 2] = Math.round(inner.rgba[si + 2] * a + out[di + 2] * (1 - a));
      out[di + 3] = 255;
    }
  }
  return { width: size, height: size, rgba: out };
}

// ─── 1. Generowanie ikon PWA ────────────────────────────────────────────────

fs.mkdirSync(ICONS_DIR, { recursive: true });
const iconSrc = decodePng(path.join(ASSETS, 'icon.png'));
const splashSrc = decodePng(path.join(ASSETS, 'splash-icon.png'));

const writeResized = (img, size, outName) => {
  const resized = resizeRgba(img, size, size);
  fs.writeFileSync(path.join(ICONS_DIR, outName), encodePng(resized.width, resized.height, resized.rgba));
};

writeResized(iconSrc, 192, 'icon-192.png');
writeResized(iconSrc, 512, 'icon-512.png');
writeResized(iconSrc, 180, 'apple-touch-icon.png');
writeResized(splashSrc, 268, 'splash-icon.png');

const maskable = buildMaskableIcon(iconSrc, 512, [0x00, 0xa8, 0x84]);
fs.writeFileSync(
  path.join(ICONS_DIR, 'icon-maskable-512.png'),
  encodePng(maskable.width, maskable.height, maskable.rgba),
);

// ─── 2. Wstrzyknięcie listy precache do dist/sw.js ──────────────────────────

function walk(dir, rel = '') {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const nextRel = rel ? `${rel}/${entry.name}` : entry.name;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...walk(full, nextRel));
    } else {
      out.push(nextRel);
    }
  }
  return out;
}

const EXCLUDE_PRECACHE = new Set(['sw.js', '_headers', '_redirects', 'metadata.json']);
const allFiles = walk(DIST).sort();
const precacheUrls = [
  '/',
  ...allFiles
    .filter((f) => !EXCLUDE_PRECACHE.has(f) && !f.endsWith('.map'))
    .map((f) => `/${f}`),
];

const hash = crypto.createHash('sha256');
for (const f of allFiles) {
  if (f === 'sw.js') continue;
  hash.update(f);
  hash.update(fs.readFileSync(path.join(DIST, f)));
}
const version = hash.digest('hex').slice(0, 12);

const swPath = path.join(DIST, 'sw.js');
if (!fs.existsSync(swPath)) {
  throw new Error('Brak dist/sw.js po eksporcie Expo.');
}
const swTemplate = fs.readFileSync(swPath, 'utf8');
const swBuilt = swTemplate
  .replace('__KM_SW_VERSION__', version)
  .replace('__KM_PRECACHE_URLS__', JSON.stringify(precacheUrls));
fs.writeFileSync(swPath, swBuilt);

// ─── 3. Weryfikacja kompletności buildu Cloudflare Pages ────────────────────

const required = [
  'index.html',
  'manifest.webmanifest',
  'sw.js',
  '_headers',
  '_redirects',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/icon-maskable-512.png',
  'icons/apple-touch-icon.png',
  'icons/splash-icon.png',
];

for (const file of required) {
  const full = path.join(DIST, file);
  if (!fs.existsSync(full) || fs.statSync(full).size === 0) {
    throw new Error(`Brak wymaganego pliku PWA: dist/${file}`);
  }
}

const hasWasm = allFiles.some((f) => f.endsWith('.wasm'));
if (!hasWasm) {
  throw new Error('Brak pliku wa-sqlite.wasm w dist/ (sprawdź metro.config.js).');
}

const indexHtml = fs.readFileSync(path.join(DIST, 'index.html'), 'utf8');
for (const marker of [
  'manifest.webmanifest',
  'serviceWorker',
  'km-boot-splash',
  '/_expo/static/js/web/',
]) {
  if (!indexHtml.includes(marker)) {
    throw new Error(`dist/index.html nie zawiera wymaganego elementu PWA: ${marker}`);
  }
}

console.log(
  `[postbuild-web] OK: version=${version}, precache=${precacheUrls.length} plików, icons=5, wasm=ok`,
);
