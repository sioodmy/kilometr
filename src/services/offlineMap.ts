// Pobieranie zestawu mapy offline aktywnego miasta (per-miasto plik `.ktp`).
//
// Wzorzec ten sam co przy rozkładzie: pobierz do pliku tymczasowego, sprawdź,
// podmieniaj atomowo. Trzy rodzaje plików:
//   - pakiet kafelków `.ktp` (kafle OSM, rozmiar zależny od miasta) z R2,
//   - silnik MapLibre (`maplibre-gl.js` + `.css`) z CDN-u,
//   - glify (czcionki etykiet) z OpenFreeMap.
//
// Po pobraniu natywny serwer mapy serwuje je z filesDir/maps, więc mapa działa
// bez internetu. Bez zestawu mapa dalej działa, tylko online.
//
// Pakiet z R2 ma twardy limit (downloadLimits): raz pobrany starczy na długo.

import * as FileSystem from 'expo-file-system/legacy';
import { MAP_GLYPHS_URL } from '../config';
import { getCity } from '../cities';
import { tr } from '../i18n';
import { getActiveCityIdSync } from './cityStore';
import { getMapDownloadGate, markMapDownloaded } from './downloadLimits';

/** Katalog, z którego czyta natywny serwer mapy (filesDir/maps). */
const MAP_DIR_NAME = 'maps';

/** Pakiet kafli aktywnego miasta. Inna nazwa na miasto = brak nadpisywania. */
function tilePackName(cityId?: string): string {
  return getCity(cityId ?? getActiveCityIdSync()).tilePack;
}

function tilePackUrl(cityId?: string): string {
  const city = getCity(cityId ?? getActiveCityIdSync());
  const override = process.env.EXPO_PUBLIC_TILE_PACK_URL;
  if (override && city.id === 'wroclaw') return override;
  return `https://data.kilometr.app/maps/${city.tilePack}`;
}

const FONTS = ['Noto Sans Regular', 'Noto Sans Bold', 'Noto Sans Italic'];
const GLYPH_RANGES = ['0-255', '256-511'];

const MAPLIBRE_VERSION = '4.7.1';

export interface OfflineMapProgress {
  /** 0..1 */
  progress: number;
  label: string;
}

export type OfflineMapDownloadResult =
  | { ok: true }
  | { ok: false; reason: 'fail' }
  | { ok: false; reason: 'cooldown'; retryAfterMs: number };

/** `file:///.../files/maps/` - ten sam katalog co filesDir natywnego serwera. */
function mapsUri(): string {
  return `${FileSystem.documentDirectory}${MAP_DIR_NAME}/`;
}

async function ensureDir(uri: string): Promise<void> {
  const info = await FileSystem.getInfoAsync(uri);
  if (!info.exists) await FileSystem.makeDirectoryAsync(uri, { intermediates: true });
}

/** Czy zestaw mapy offline miasta jest już na telefonie. */
export async function hasOfflineMap(cityId?: string): Promise<boolean> {
  try {
    const info = await FileSystem.getInfoAsync(`${mapsUri()}${tilePackName(cityId)}`);
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
 * Pobiera cały zestaw mapy offline. Zwraca ok, gdy pakiet kafelków jest na
 * miejscu. Silnik i glify są potrzebne do rysowania, ale brak któregoś z nich
 * nie przerywa całości: mapa po prostu nie pokaże etykiet albo w ogóle się
 * nie narysuje, więc brak silnika traktujemy jako porażkę.
 *
 * Limit R2: kolejne udane pobranie pakietu dopiero po miesiącu
 * (nawet po usunięciu lokalnych plików).
 */
export async function downloadOfflineMap(
  onProgress?: (p: OfflineMapProgress) => void,
  cityId?: string,
): Promise<OfflineMapDownloadResult> {
  const city = getCity(cityId ?? getActiveCityIdSync());
  const gate = await getMapDownloadGate(city.id);
  if (!gate.allowed) {
    return { ok: false, reason: 'cooldown', retryAfterMs: gate.retryAfterMs };
  }

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
  if (!jsOk) return { ok: false, reason: 'fail' };

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
  const s = tr();
  report(0.35, s.settings.offlineMapStepTiles(s.city.gen(city.id)));
  const ok = await downloadTo(tilePackUrl(city.id), `${root}${city.tilePack}`);
  if (!ok) return { ok: false, reason: 'fail' };
  await markMapDownloaded(city.id);
  report(1, s.settings.offlineMapStepDone);
  return { ok: true };
}

/**
 * Usuwa zestaw mapy offline miasta (odzyskanie miejsca zajętego przez pakiet). Znacznik limitu
 * zostaje. Inne miasta nietknięte (osobne pliki w tym samym katalogu).
 */
export async function deleteOfflineMap(cityId?: string): Promise<void> {
  const city = getCity(cityId ?? getActiveCityIdSync());
  try {
    await FileSystem.deleteAsync(`${mapsUri()}${city.tilePack}`, { idempotent: true });
  } catch {
    // best-effort
  }
}
