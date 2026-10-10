// Kafelki OSM w tle widgetu nawigacji.
//
// Widget ma pokazywać prawdziwą mapę (ulice, budynki), a nie pusty wektor.
// Drugi silnik MapLibre na karcie byłby za ciężki, więc dociągamy kilka
// rastrowych kafli OSM i rysujemy je zwykłymi <Image> pod trasą.
//
// Żeby nie łamać Tile Usage Policy: stały zoom, tylko kafle wokół użytkownika
// (zwykle 4), trwały cache na dysku, maksymalnie 2 równoległe pobrania,
// prawdziwy User-Agent i widoczna atrybucja. Bez sieci albo bez kafli widget
// pokazuje jasny podkład i samą trasę.

import { useEffect, useMemo, useRef, useState } from 'react';
import * as FileSystem from 'expo-file-system/legacy';

/** Stały zoom widgetu. Zmienna skala przy każdym kroku gubiła czytelność. */
export const NAV_TILE_Z = 16;
const TILE_PX = 256;
const TILE_URL = (z: number, x: number, y: number) =>
  `https://tile.openstreetmap.org/${z}/${x}/${y}.png`;
// OSM wymaga identyfikowalnego User-Agenta.
const TILE_UA = 'Kilometr/1.0 (https://github.com/sioodmy/kilometr)';
/** OSM prosi o maksymalnie 2 równoległe pobierania. */
const MAX_CONCURRENT = 2;
const MAX_FILES = 400;
const DOWNLOAD_TIMEOUT_MS = 15000;
/** Ponowna próba po błędzie, żeby słaba sieć nie młóciła serwera. */
const RETRY_AFTER_MS = 60000;
/** Ile trafień trzymamy w pamięci (reszta i tak jest na dysku). */
const MEM_CACHE_MAX = 2000;

export const OSM_ATTRIBUTION = '© OpenStreetMap';
export const OSM_ATTRIBUTION_LONG = '© autorzy OpenStreetMap';

const DEG = Math.PI / 180;

/** Globalny piksel Web-Mercatora (kafel * 256). */
export function lonLatToGlobalPx(lat: number, lon: number, z: number = NAV_TILE_Z) {
  const n = 2 ** z;
  const x = ((lon + 180) / 360) * n * TILE_PX;
  const s = Math.sin(lat * DEG);
  const y = (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * n * TILE_PX;
  return { x, y };
}

/** Ile metrów ma piksel kafla na danej szerokości geograficznej. */
export function metersPerTilePx(lat: number, z: number = NAV_TILE_Z): number {
  return (156543.03392 * Math.cos(lat * DEG)) / 2 ** z;
}

function tileDir(): string | null {
  const base = FileSystem.cacheDirectory;
  return base ? `${base}navtiles/` : null;
}

async function ensureDir(dir: string): Promise<void> {
  const info = await FileSystem.getInfoAsync(dir);
  if (!info.exists) await FileSystem.makeDirectoryAsync(dir, { intermediates: true });
}

// ─── Kolejka pobrań ────────────────────────────────────────────
const inflight = new Map<string, Promise<string | null>>();
const memHits = new Map<string, string>();
const lastFailAt = new Map<string, number>();
let running = 0;
const waiting: Array<() => Promise<void>> = [];

function pump() {
  while (running < MAX_CONCURRENT && waiting.length > 0) {
    const job = waiting.shift();
    if (!job) break;
    running += 1;
    let done = false;
    const release = () => {
      if (done) return;
      done = true;
      running -= 1;
      pump();
    };
    // Zawieszone pobieranie zwalnia slot, żeby nie zablokować kolejki.
    // Plik i tak wyląduje w cache, gdy się dobije.
    const timer = setTimeout(release, DOWNLOAD_TIMEOUT_MS);
    void job().finally(() => {
      clearTimeout(timer);
      release();
    });
  }
}

function memSet(key: string, uri: string) {
  memHits.set(key, uri);
  if (memHits.size > MEM_CACHE_MAX) {
    const first = memHits.keys().next();
    if (!first.done) memHits.delete(first.value);
  }
}

/** Lokalny URI kafla (pobiera, gdy go nie ma). Null = brak sieci albo błąd. */
export function ensureTile(z: number, x: number, y: number): Promise<string | null> {
  const key = `${z}/${x}/${y}`;
  const mem = memHits.get(key);
  if (mem) return Promise.resolve(mem);
  const failedAt = lastFailAt.get(key) ?? 0;
  if (Date.now() - failedAt < RETRY_AFTER_MS) return Promise.resolve(null);
  const hit = inflight.get(key);
  if (hit) return hit;
  const p = new Promise<string | null>((resolve) => {
    waiting.push(async () => {
      try {
        const uri = await downloadTile(z, x, y);
        if (uri) memSet(key, uri);
        else lastFailAt.set(key, Date.now());
        resolve(uri);
      } catch {
        lastFailAt.set(key, Date.now());
        resolve(null);
      }
    });
    pump();
  });
  inflight.set(key, p);
  void p.finally(() => {
    if (inflight.get(key) === p) inflight.delete(key);
  });
  return p;
}

async function downloadTile(z: number, x: number, y: number): Promise<string | null> {
  const dir = tileDir();
  if (!dir) return null;
  await ensureDir(dir);
  const dest = `${dir}${z}_${x}_${y}.png`;
  const info = await FileSystem.getInfoAsync(dest);
  if (info.exists && (info.size ?? 0) > 1024) return dest;
  const res = await FileSystem.downloadAsync(TILE_URL(z, x, y), dest, {
    headers: { 'User-Agent': TILE_UA, Referer: 'https://github.com/sioodmy/kilometr' },
  });
  if (res.status !== 200) {
    await FileSystem.deleteAsync(dest, { idempotent: true }).catch(() => undefined);
    return null;
  }
  const done = await FileSystem.getInfoAsync(dest);
  if (!done.exists || (done.size ?? 0) <= 1024) {
    await FileSystem.deleteAsync(dest, { idempotent: true }).catch(() => undefined);
    return null;
  }
  void trimCache(dir);
  return dest;
}

/** Najstarsze kafle wypadają, żeby cache nie rósł bez końca. Best-effort. */
async function trimCache(dir: string): Promise<void> {
  try {
    const names = await FileSystem.readDirectoryAsync(dir);
    if (names.length <= MAX_FILES) return;
    const withTime: Array<{ name: string; t: number }> = [];
    for (const name of names) {
      const info = await FileSystem.getInfoAsync(dir + name);
      withTime.push({
        name,
        t: info.exists && info.modificationTime ? info.modificationTime : 0,
      });
    }
    withTime.sort((a, b) => a.t - b.t);
    for (const { name } of withTime.slice(0, withTime.length - MAX_FILES)) {
      await FileSystem.deleteAsync(dir + name, { idempotent: true }).catch(() => undefined);
    }
  } catch {
    // cache to wygoda, nie kontrakt
  }
}

export interface NavTileRect {
  x: number;
  y: number;
  /** lewy górny róg względem środka (użytkownika) [m]; x na wschód, y na południe */
  dxM: number;
  dyM: number;
  /** bok kafla [m] */
  sizeM: number;
  uri: string | null;
}

/**
 * Kafle pokrywające kwadrat o połówce `halfSideM` wokół środka. Pozycje są
 * w metrach względem środka, więc komponent przelicza je na ekran tą samą
 * skalą co trasę i nic się nie rozjeżdża. URI dociągają w tle i dopisują się
 * same; pudła próbujemy ponownie przy kolejnym ruchu (z throttlingiem w
 * ensureTile).
 */
export function useNavTiles(lat: number, lon: number, halfSideM: number): NavTileRect[] {
  const knownUris = useRef(new Map<string, string>());
  const [tick, setTick] = useState(0);

  const rects = useMemo(() => {
    const mpp = metersPerTilePx(lat);
    const c = lonLatToGlobalPx(lat, lon);
    // Ćwierć kafla zapasu na ruch między odświeżeniami. Obrót nie potrzebuje
    // zapasu (koło jest niezmiennicze), więc zwykle wystarczą 4 kafle.
    const halfPx = halfSideM / mpp + TILE_PX / 4;
    const x0 = Math.floor((c.x - halfPx) / TILE_PX);
    const x1 = Math.floor((c.x + halfPx) / TILE_PX);
    const y0 = Math.floor((c.y - halfPx) / TILE_PX);
    const y1 = Math.floor((c.y + halfPx) / TILE_PX);
    const out: Array<Omit<NavTileRect, 'uri'>> = [];
    for (let x = x0; x <= x1; x++) {
      for (let y = y0; y <= y1; y++) {
        out.push({
          x,
          y,
          dxM: (x * TILE_PX - c.x) * mpp,
          dyM: (y * TILE_PX - c.y) * mpp,
          sizeM: TILE_PX * mpp,
        });
      }
    }
    return out;
  }, [lat, lon, halfSideM]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const jobs = rects.map(async (r) => {
        const k = `${r.x}/${r.y}`;
        if (knownUris.current.has(k)) return false;
        const uri = await ensureTile(NAV_TILE_Z, r.x, r.y);
        if (cancelled || !uri) return false;
        knownUris.current.set(k, uri);
        return true;
      });
      const results = await Promise.all(jobs);
      if (!cancelled && results.some(Boolean)) setTick((t) => t + 1);
    })();
    return () => {
      cancelled = true;
    };
  }, [rects]);

  // knownUris to ref, a tick wymusza ponowny render po dociągnięciu kafli.
  return useMemo(
    () => rects.map((r) => ({ ...r, uri: knownUris.current.get(`${r.x}/${r.y}`) ?? null })),
    [rects, tick],
  );
}
