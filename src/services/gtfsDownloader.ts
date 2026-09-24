// Pobieranie GTFS bezpośrednio na telefon (Open Data Wrocław).
// Używa legacy FileSystem (documentDirectory + downloadAsync), bo ten sam
// mechanizm obsługuje już widgetSnapshot — nowy File API przejdzie w etapie 2.
//
// Strategia pamięciowa (ważne przy stop_times.txt ~46 MB):
// - zip (~12 MB) ląduje jako plik, nie w RAM,
// - rozpakowanie przez fflate na Uint8Array + zapis plików po kolei,
// - małe pliki (stops/routes/trips/calendar) parsujemy w całości,
// - stop_times importujemy batched do SQLite (patrz gtfsDatabase).
// Nie trzymamy całego rozkładu w Mapach jak serwer — telefon pyta SQLite.

import * as FileSystem from 'expo-file-system/legacy';
import { strFromU8, unzipSync } from 'fflate';
import { GTFS } from './gtfsConfig';

export interface GtfsArchiveCandidate {
  id: number;
  url: string;
  filename?: string;
  effectiveDate?: number;
}

function parseEffectiveDate(name: string): number | null {
  const match = /(\d{2})(\d{2})(\d{4})(?!\d)/.exec(name);
  if (!match) return null;
  const day = Number(match[1]);
  const month = Number(match[2]);
  const year = Number(match[3]);
  if (day < 1 || day > 31 || month < 1 || month > 12) return null;
  return Date.UTC(year, month - 1, day);
}

function baseDir(): string {
  const base = FileSystem.documentDirectory;
  if (!base) throw new Error('Brak documentDirectory (expo-file-system)');
  return `${base}kilometr/`;
}

export function gtfsZipUri(): string {
  return `${baseDir()}${GTFS.cacheFile}`;
}

export function gtfsDir(): string {
  return `${baseDir()}${GTFS.extractedDir}/`;
}

export async function ensureBaseDir(): Promise<void> {
  const dir = baseDir();
  const info = await FileSystem.getInfoAsync(dir);
  if (!info.exists) {
    await FileSystem.makeDirectoryAsync(dir, { intermediates: true });
  }
}

/** Wybiera najnowszy obowiązujący archiwum GTFS z katalogu Open Data. */
export async function discoverBestArchiveUrl(): Promise<string> {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 10000);
    try {
      const res = await fetch(GTFS.catalogueUrl, {
        headers: { Accept: 'application/json' },
        signal: ctrl.signal,
      });
      if (res.ok) {
        const data = (await res.json()) as { pliki?: number[] };
        const fileIds = Array.isArray(data.pliki) ? data.pliki.slice(0, 5) : [];
        const candidates: GtfsArchiveCandidate[] = [];
        const now = Date.now();
        for (const id of fileIds) {
          const url = `${GTFS.downloadBase}/${id}/`;
          try {
            const headCtrl = new AbortController();
            const headTimer = setTimeout(() => headCtrl.abort(), 5000);
            try {
              const headRes = await fetch(url, {
                method: 'HEAD',
                headers: { 'User-Agent': 'Mozilla/5.0' },
                signal: headCtrl.signal,
              });
              const disposition = headRes.headers.get('content-disposition') || '';
              const filenameMatch = /filename="?([^"]+)"?/.exec(disposition);
              const filename = filenameMatch ? filenameMatch[1] : '';
              const effectiveDate = parseEffectiveDate(filename) || 0;
              candidates.push({ id, url, filename, effectiveDate });
            } finally {
              clearTimeout(headTimer);
            }
          } catch {
            // pojedynczy kandydat może odpaść — lecimy dalej
          }
        }
        const inForce = candidates
          .filter((c) => c.effectiveDate && c.effectiveDate <= now)
          .sort((a, b) => (b.effectiveDate || 0) - (a.effectiveDate || 0));
        if (inForce.length > 0) return inForce[0].url;
        if (candidates.length > 0) return candidates[0].url;
      }
    } finally {
      clearTimeout(timer);
    }
  } catch (err) {
    console.warn('[GtfsDownloader] discovery failed, fallback:', err);
  }
  return GTFS.fallbackDirectUrl;
}

export interface DownloadProgress {
  bytesWritten: number;
  totalBytes: number;
}

/** Pobiera gtfs.zip do documentDirectory. Zwraca lokalne URI. */
export async function downloadGtfsZip(
  url: string,
  onProgress?: (p: DownloadProgress) => void,
): Promise<string> {
  await ensureBaseDir();
  const dest = gtfsZipUri();
  // Wyczyść ewentualny stary/niekompletny plik zip przed startem pobierania
  await FileSystem.deleteAsync(dest, { idempotent: true });
  const task = FileSystem.createDownloadResumable(
    url,
    dest,
    { headers: { 'User-Agent': 'Mozilla/5.0' } },
    (progress) => {
      onProgress?.({
        bytesWritten: progress.totalBytesWritten,
        totalBytes: progress.totalBytesExpectedToWrite,
      });
    },
  );
  const result = await task.downloadAsync();
  if (!result?.uri) throw new Error('Pobieranie GTFS nie zwróciło pliku');
  return result.uri;
}

/** Sprawdza czy kompletny rozpakowany GTFS już istnieje na telefonie. */
export async function hasExtractedGtfs(): Promise<boolean> {
  try {
    const stopsInfo = await FileSystem.getInfoAsync(`${gtfsDir()}stops.txt`);
    const timesInfo = await FileSystem.getInfoAsync(`${gtfsDir()}stop_times.txt`);
    return stopsInfo.exists && timesInfo.exists;
  } catch {
    return false;
  }
}

const NEEDED_GTFS_FILES = new Set([
  'stops.txt',
  'routes.txt',
  'calendar.txt',
  'calendar_dates.txt',
  'trips.txt',
  'stop_times.txt',
]);

/**
 * Rozpakowuje gtfs.zip (fflate, w JS) do plików documentDirectory.
 * Pliki GTFS Wrocławia po rozpakowaniu: stops/routes/trips/calendar/
 * calendar_dates/stop_times. Zwraca listę wypakowanych nazw.
 */
export async function unzipGtfs(zipUri: string): Promise<string[]> {
  const dir = gtfsDir();
  const dirInfo = await FileSystem.getInfoAsync(dir);
  if (!dirInfo.exists) {
    await FileSystem.makeDirectoryAsync(dir, { intermediates: true });
  }
  // Szybka konwersja base64 na Uint8Array w jednej pętli indeksowanej (bez 12M alokacji closure)
  const base64 = await FileSystem.readAsStringAsync(zipUri, {
    encoding: FileSystem.EncodingType.Base64,
  });
  const binStr = atob(base64);
  const len = binStr.length;
  const binary = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    binary[i] = binStr.charCodeAt(i);
  }

  // Filtr w unzipSync zapobiega dekompresji niepotrzebnych shapes.txt (~15 MB) i innych do RAM
  const entries = unzipSync(binary, {
    filter(file) {
      const short = file.name.split('/').pop() || file.name;
      return NEEDED_GTFS_FILES.has(short);
    },
  });

  const names: string[] = [];
  for (const [name, data] of Object.entries(entries)) {
    if (name.endsWith('/')) continue;
    const short = name.split('/').pop() || name;
    if (!NEEDED_GTFS_FILES.has(short)) continue;
    const text = strFromU8(data);
    await FileSystem.writeAsStringAsync(`${dir}${short}`, text);
    names.push(short);
  }
  return names;
}

/** Czyta mały plik GTFS (stops/routes/trips/calendar) jako tekst. */
export async function readGtfsText(name: string): Promise<string | null> {
  try {
    return await FileSystem.readAsStringAsync(`${gtfsDir()}${name}`);
  } catch {
    return null;
  }
}

/** Usuwa zip + rozpakowane txt (po imporcie do SQLite zwalniamy ~75 MB). */
export async function cleanupRawGtfs(): Promise<void> {
  try {
    await FileSystem.deleteAsync(gtfsZipUri(), { idempotent: true });
  } catch {
    // best-effort
  }
  try {
    await FileSystem.deleteAsync(gtfsDir(), { idempotent: true });
  } catch {
    // best-effort
  }
}
