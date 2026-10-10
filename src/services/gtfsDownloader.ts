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
import { API_URL } from '../config';
import { getLocaleSync, type Strings } from '../i18n';
import { pl } from '../i18n/pl';
import { en } from '../i18n/en';
import { de } from '../i18n/de';
import { uk } from '../i18n/uk';

const DL_DICTS: Record<string, Strings> = { pl, en, de, uk };

function dlTr() {
  return (DL_DICTS[getLocaleSync()] ?? pl).downloader;
}

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

/**
 * Błąd pobierania archiwum. `message` jest zdaniem dla użytkownika
 * (w jego języku, bez surowego komunikatu sieciowego), `hint` mówi co
 * z tym zrobić, a `detail` zostaje w logach.
 */
export class GtfsDownloadError extends Error {
  readonly detail: string;
  readonly hint: string;
  /** Stabilny kod przyczyny (niezależny od języka komunikatu). */
  readonly code: 'no-net' | 'timeout' | 'no-space' | 'unreachable' | 'unknown';

  constructor(message: string, detail: string, hint: string, code: GtfsDownloadError['code'] = 'unknown') {
    super(message);
    this.name = 'GtfsDownloadError';
    this.detail = detail;
    this.hint = hint;
    this.code = code;
  }
}

/** Tłumaczy surowy błąd sieci/HTTP RN na komunikat zrozumiały dla użytkownika. */
export function describeDownloadError(err: unknown): GtfsDownloadError {
  const T = dlTr();
  const detail = err instanceof Error ? err.message : String(err);
  const low = detail.toLowerCase();
  if (
    low.includes('resolve host') ||
    low.includes('no address associated') ||
    low.includes('network request failed') ||
    low.includes('econnrefused') ||
    low.includes('failed to connect') ||
    low.includes('unable to resolve')
  ) {
    return new GtfsDownloadError(T.noNet, detail, T.hintRetry, 'no-net');
  }
  if (low.includes('timeout') || low.includes('timed out')) {
    return new GtfsDownloadError(T.timeout, detail, T.hintTouch, 'timeout');
  }
  if (low.includes('enospc') || low.includes('no space')) {
    return new GtfsDownloadError(T.noSpace, detail, T.hintSpace, 'no-space');
  }
  if (low.includes('http response status code')) {
    return new GtfsDownloadError(T.unavailable, detail, T.hintLater, 'unreachable');
  }
  return new GtfsDownloadError(T.failed, detail, T.hintTouch, 'unknown');
}

export type ArchiveSource = 'catalogue' | 'direct' | 'mirror';

export interface ArchiveDownload {
  uri: string;
  source: ArchiveSource;
}

/**
 * Lustro: to samo archiwum, które backend dev już trzyma na dysku. W buildzie
 * release (bez skonfigurowanego API_URL) nie ma do kogo sięgać, więc wtedy
 * pomijamy kandydata zamiast marnować czasu na martwe połączenie.
 */
function mirrorArchiveUrl(): string | null {
  if (!__DEV__ && !process.env.EXPO_PUBLIC_API_URL) return null;
  return `${API_URL}/api/gtfs/archive`;
}

/**
 * Pobiera archiwum, próbując po kolei: katalog Open Data → adres bezpośredni
 * → lustro backendu. Każde źródło dostaje świeży postęp (restart od zera),
 * a użytkownik widzi komunikat dopiero po wyczerpaniu wszystkich opcji.
 */
export async function downloadArchiveWithFallback(
  onProgress?: (p: DownloadProgress, source: ArchiveSource) => void,
): Promise<ArchiveDownload> {
  const mirror = mirrorArchiveUrl();
  const candidates: { url: string; source: ArchiveSource }[] = [
    { url: await discoverBestArchiveUrl(), source: 'catalogue' },
    { url: GTFS.fallbackDirectUrl, source: 'direct' },
  ];
  if (mirror) candidates.push({ url: mirror, source: 'mirror' });

  const failures: GtfsDownloadError[] = [];
  const seen = new Set<string>();
  for (const candidate of candidates) {
    // Ten sam URL z dwiema etykietami to marnowanie przebiegu.
    if (seen.has(candidate.url)) continue;
    seen.add(candidate.url);
    try {
      const uri = await downloadGtfsZip(candidate.url, (p) => onProgress?.(p, candidate.source));
      return { uri, source: candidate.source };
    } catch (err) {
      const failure = describeDownloadError(err);
      console.warn(`[GtfsDownloader] źródło ${candidate.source} zawiodło:`, failure.detail);
      failures.push(failure);
    }
  }

  // Bez internetu nie ma sensu próbować kolejnych źródeł — mówimy wprost.
  const T = dlTr();
  if (failures.length > 0 && failures.every((f) => f.code === 'no-net')) {
    throw new GtfsDownloadError(
      T.noNet,
      failures.map((f) => f.detail).join(' | '),
      failures[0].hint,
      'no-net',
    );
  }
  throw failures[failures.length - 1] ?? new GtfsDownloadError(T.failed, 'brak kandydatów', T.hintTouch, 'unknown');
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
  if (!result?.uri) throw new Error(dlTr().noFile);
  // downloadAsync rozwiązuje się także dla 4xx/5xx — bez tego strony błędu
  // (404/503, captive portal) trafiały do gtfs.zip jako „sukces".
  if (result.status < 200 || result.status >= 300) {
    await FileSystem.deleteAsync(dest, { idempotent: true });
    throw new Error(`HTTP response status code ${result.status}`);
  }
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
