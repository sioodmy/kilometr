// Pobieranie zestawu mapy offline (Wrocław).
//
// Wzorzec ten sam co przy rozkładzie: pobierz do pliku tymczasowego, sprawdź,
// podmieniaj atomowo. Trzy rodzaje plików:
//   - pakiet kafelków `.ktp` (kafle OSM, ~31 MB) z R2,
//   - silnik MapLibre (`maplibre-gl.js` + `.css`) z CDN-u,
//   - glify (czcionki etykiet) z OpenFreeMap.
//
// Po pobraniu natywny serwer mapy serwuje je z filesDir/maps, więc mapa działa
// bez internetu. Bez zestawu mapa dalej działa, tylko online.

import * as FileSystem from 'expo-file-system/legacy';
import { MAP_GLYPHS_URL } from '../config';

/** Katalog, z którego czyta natywny serwer mapy (filesDir/maps). */
export const MAP_DIR_NAME = 'maps';
export const TILE_PACK_NAME = 'wroclaw-tiles.ktp';

const FONTS = ['Noto Sans Regular', 'Noto Sans Bold', 'Noto Sans Italic'];
const GLYPH_RANGES = ['0-255', '256-511'];

const TILE_PACK_URL =
  process.env.EXPO_PUBLIC_TILE_PACK_URL ??
  'https://data.kilometr.wroclaw.pl/maps/wroclaw-tiles.ktp';

const MAPLIBRE_VERSION = '4.7.1';

export interface OfflineMapProgress {
  /** 0..1 */
  progress: number;
  label: string;
}

/** `file:///.../files/maps/` — ten sam katalog co filesDir natywnego serwera. */
function mapsUri(): string {
  return `${FileSystem.documentDirectory}${MAP_DIR_NAME}/`;
}

async function ensureDir(uri: string): Promise<void> {
  const info = await FileSystem.getInfoAsync(uri);
  if (!info.exists) await FileSystem.makeDirectoryAsync(uri, { intermediates: true });
}

/** Czy zestaw mapy offline jest już na telefonie. */
export async function hasOfflineMap(): Promise<boolean> {
  try {
    const info = await FileSystem.getInfoAsync(`${mapsUri()}${TILE_PACK_NAME}`);
    return info.exists && (info.size ?? 0) > 1024;
  } catch {
    return false;
  }
}

/** Pobiera plik do `dest` przez plik tymczasowy, potem podmienia atomowo. */
async function downloadTo(url: string, dest: string): Promise<boolean> {
  const tmp = `${dest}.tmp`;
  try {
    try {
      await FileSystem.deleteAsync(tmp, { idempotent: true });
    } catch {
      // brak pliku tymczasowego to nie błąd
    }
    const res = await FileSystem.downloadAsync(url, tmp);
    if (res.status !== 200) {
      await FileSystem.deleteAsync(tmp, { idempotent: true });
      return false;
    }
    const info = await FileSystem.getInfoAsync(tmp);
    if (!info.exists || (info.size ?? 0) === 0) return false;
    await FileSystem.deleteAsync(dest, { idempotent: true });
    await FileSystem.moveAsync({ from: tmp, to: dest });
    return true;
  } catch {
    try {
      await FileSystem.deleteAsync(tmp, { idempotent: true });
    } catch {
      // sprzątanie best-effort
    }
    return false;
  }
}

/**
 * Pobiera cały zestaw mapy offline. Zwraca true, gdy pakiet kafelków jest na
 * miejscu. Silnik i glify są potrzebne do rysowania, ale brak któregoś z nich
 * nie przerywa całości: mapa po prostu nie pokaże etykiet albo w ogóle się
 * nie narysuje, więc brak silnika traktujemy jako porażkę.
 */
export async function downloadOfflineMap(
  onProgress?: (p: OfflineMapProgress) => void,
): Promise<boolean> {
  const report = (progress: number, label: string) => onProgress?.({ progress, label });
  const root = mapsUri();
  await ensureDir(root);

  // 1. Silnik mapy (mały, ale bez niego nie ma czego rysować).
  report(0.02, 'maplibre-gl.js');
  const jsOk = await downloadTo(
    `https://cdn.jsdelivr.net/npm/maplibre-gl@${MAPLIBRE_VERSION}/dist/maplibre-gl.js`,
    `${root}maplibre-gl.js`,
  );
  report(0.08, 'maplibre-gl.css');
  await downloadTo(
    `https://cdn.jsdelivr.net/npm/maplibre-gl@${MAPLIBRE_VERSION}/dist/maplibre-gl.css`,
    `${root}maplibre-gl.css`,
  );
  if (!jsOk) return false;

  // 2. Glify: po jednym pliku na font i zakres.
  let done = 0;
  const total = FONTS.length * GLYPH_RANGES.length;
  for (const font of FONTS) {
    const dir = `${root}fonts/${font}/`;
    await ensureDir(dir);
    for (const range of GLYPH_RANGES) {
      const url = MAP_GLYPHS_URL.replace('{fontstack}', encodeURIComponent(font)).replace(
        '{range}',
        range,
      );
      await downloadTo(url, `${dir}${range}.pbf`);
      done++;
      report(0.1 + 0.2 * (done / total), `${font} ${range}`);
    }
  }

  // 3. Pakiet kafelków: największy, więc na końcu.
  report(0.35, 'kafle Wrocławia');
  const ok = await downloadTo(TILE_PACK_URL, `${root}${TILE_PACK_NAME}`);
  if (ok) report(1, 'gotowe');
  return ok;
}

/** Usuwa zestaw mapy offline (odzyskanie ~31 MB). */
export async function deleteOfflineMap(): Promise<void> {
  try {
    await FileSystem.deleteAsync(mapsUri(), { idempotent: true });
  } catch {
    // best-effort
  }
}