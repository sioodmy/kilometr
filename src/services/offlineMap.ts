// Pobieranie zestawu mapy offline aktywnego miasta (per-miasto plik `.ktp`).
//
// Wzorzec ten sam co przy rozkładzie: pobierz do pliku tymczasowego, sprawdź,
// podmieniaj atomowo. Dwa rodzaje plików:
//   - pakiet kafelków `.ktp` (kafle OSM, rozmiar zależny od miasta) z R2,
//   - glify (czcionki etykiet) z OpenFreeMap.
//
// Po pobraniu natywny serwer mapy serwuje je z filesDir/maps, więc mapa działa
// bez internetu. Silnik MapLibre jest w paczce aplikacji.
//
// Pakiet z R2 ma twardy limit (downloadLimits): raz pobrany starczy na długo.
// Limit zajmuje dopiero pakiet z poprawnym nagłówkiem KMTP i pełnym katalogiem.

import { File, FileMode } from 'expo-file-system';
import * as FileSystem from 'expo-file-system/legacy';
import { MAP_GLYPHS_URL } from '../config';
import { CITIES, getCity, type CityId } from '../cities';
import { tr } from '../i18n';
import { getActiveCityIdSync } from './cityStore';
import { clearMapDownloadLimit, getMapDownloadGate, markMapDownloaded } from './downloadLimits';
import {
  parseTilePackHeader,
  TILE_PACK_ENTRY_BYTES,
  TILE_PACK_HEADER_BYTES,
  TILE_PACK_MAX_CATALOG_BYTES,
  validateTilePackCatalog,
} from './tilePack';

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

export interface OfflineMapProgress {
  /** 0..1 */
  progress: number;
  label: string;
}

export type OfflineMapState = 'missing' | 'ready' | 'invalid';

export interface DownloadedMap {
  cityId: CityId;
  sizeMB: number;
  invalid: boolean;
}

export type OfflineMapDownloadResult =
  | { ok: true }
  | { ok: false; reason: 'fail' }
  | { ok: false; reason: 'invalid' }
  | { ok: false; reason: 'cooldown'; retryAfterMs: number };

/** `file:///.../files/maps/` - ten sam katalog co filesDir natywnego serwera. */
function mapsUri(): string {
  return `${FileSystem.documentDirectory}${MAP_DIR_NAME}/`;
}

async function ensureDir(uri: string): Promise<void> {
  const info = await FileSystem.getInfoAsync(uri);
  if (!info.exists) await FileSystem.makeDirectoryAsync(uri, { intermediates: true });
}

interface TilePackInspection {
  state: OfflineMapState;
  size: number;
}

/** Czyta nagłówek i katalog pakietu; plik zostaje nietknięty. */
async function inspectTilePack(uri: string): Promise<TilePackInspection> {
  let size = 0;
  try {
    const info = await FileSystem.getInfoAsync(uri);
    if (!info.exists) return { state: 'missing', size: 0 };
    size = info.size ?? 0;
    if (size < TILE_PACK_HEADER_BYTES) return { state: 'invalid', size };
    const handle = new File(uri).open(FileMode.ReadOnly);
    try {
      const header = parseTilePackHeader(handle.readBytes(TILE_PACK_HEADER_BYTES));
      if (!header) return { state: 'invalid', size };
      const catalogBytes = header.tileCount * TILE_PACK_ENTRY_BYTES;
      if (
        catalogBytes > TILE_PACK_MAX_CATALOG_BYTES ||
        TILE_PACK_HEADER_BYTES + catalogBytes > size
      ) {
        return { state: 'invalid', size };
      }
      const catalog = handle.readBytes(catalogBytes);
      return {
        state: validateTilePackCatalog(header, catalog, size) ? 'ready' : 'invalid',
        size,
      };
    } finally {
      handle.close();
    }
  } catch {
    return { state: size > 0 ? 'invalid' : 'missing', size };
  }
}

async function isTilePackValid(uri: string): Promise<boolean> {
  return (await inspectTilePack(uri)).state === 'ready';
}

/** Stan pakietu miasta: brak pliku, gotowy do mapy albo uszkodzony. */
export async function getOfflineMapState(cityId?: string): Promise<OfflineMapState> {
  return (await inspectTilePack(`${mapsUri()}${tilePackName(cityId)}`)).state;
}

/** Czy zestaw mapy offline miasta jest już na telefonie i nadaje się do użycia. */
export async function hasOfflineMap(cityId?: string): Promise<boolean> {
  return (await getOfflineMapState(cityId)) === 'ready';
}

/** Pakiety pozostałych miast na dysku; do listy z osobnym usuwaniem w Ustawieniach. */
export async function listDownloadedMaps(activeCityId?: string): Promise<DownloadedMap[]> {
  const activeId = getCity(activeCityId ?? getActiveCityIdSync()).id;
  const found = await Promise.all(
    CITIES.filter((city) => city.id !== activeId).map(
      async (city): Promise<DownloadedMap | null> => {
        const { state, size } = await inspectTilePack(`${mapsUri()}${city.tilePack}`);
        if (state === 'missing') return null;
        return {
          cityId: city.id,
          sizeMB: Math.round(size / (1024 * 1024)),
          invalid: state === 'invalid',
        };
      },
    ),
  );
  return found.filter((entry): entry is DownloadedMap => entry !== null);
}

type DownloadOutcome = 'ok' | 'fail' | 'invalid';

/** Pobiera plik do `dest` przez plik tymczasowy, potem podmienia atomowo. */
async function downloadTo(
  url: string,
  dest: string,
  validate?: (uri: string) => Promise<boolean>,
): Promise<DownloadOutcome> {
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
      return 'fail';
    }
    const info = await FileSystem.getInfoAsync(tmp);
    if (!info.exists || (info.size ?? 0) === 0) {
      await FileSystem.deleteAsync(tmp, { idempotent: true });
      return 'fail';
    }
    if (validate && !(await validate(tmp))) {
      await FileSystem.deleteAsync(tmp, { idempotent: true });
      return 'invalid';
    }
    await FileSystem.deleteAsync(dest, { idempotent: true });
    await FileSystem.moveAsync({ from: tmp, to: dest });
    return 'ok';
  } catch {
    try {
      await FileSystem.deleteAsync(tmp, { idempotent: true });
    } catch {
      // sprzątanie best-effort
    }
    return 'fail';
  }
}

/**
 * Pobiera cały zestaw mapy offline. Zwraca ok, gdy pakiet kafelków jest na
 * miejscu. Brak glifów nie przerywa pobierania, mapa nie pokaże wtedy etykiet.
 *
 * Limit R2: kolejne udane pobranie pakietu dopiero po miesiącu
 * (nawet po usunięciu lokalnych plików). Uszkodzony pakiet nie zajmuje limitu.
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

  const s = tr();
  report(0.35, s.settings.offlineMapStepTiles(s.city.gen(city.id)));
  const outcome = await downloadTo(
    tilePackUrl(city.id),
    `${root}${city.tilePack}`,
    isTilePackValid,
  );
  if (outcome === 'invalid') return { ok: false, reason: 'invalid' };
  if (outcome !== 'ok') return { ok: false, reason: 'fail' };
  await markMapDownloaded(city.id);
  report(1, s.settings.offlineMapStepDone);
  return { ok: true };
}

/**
 * Usuwa zestaw mapy offline miasta (odzyskanie miejsca zajętego przez pakiet).
 * Uszkodzony pakiet czyści też limit R2, żeby pobranie działało od razu.
 * Inne miasta nietknięte (osobne pliki w tym samym katalogu).
 */
export async function deleteOfflineMap(cityId?: string): Promise<void> {
  const city = getCity(cityId ?? getActiveCityIdSync());
  const state = await getOfflineMapState(city.id);
  try {
    await FileSystem.deleteAsync(`${mapsUri()}${city.tilePack}`, { idempotent: true });
  } catch {
    // best-effort
  }
  if (state === 'invalid') await clearMapDownloadLimit(city.id);
}
