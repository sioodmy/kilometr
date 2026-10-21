// Pobieranie GTFS bezpośrednio na telefon (Open Data Wrocław).
// Używa legacy FileSystem (documentDirectory + downloadAsync), bo ten sam
// mechanizm obsługuje już widgetSnapshot - nowy File API przejdzie w etapie 2.
//
// Strategia pamięciowa (ważne przy stop_times.txt ~46 MB):
// - zip (~12 MB) ląduje jako plik, nie w RAM,
// - nazwy plików odczytujemy z katalogu centralnego, potem rozpakowujemy
//   PO JEDNYM pliku i od razu zapisujemy na dysk,
// - małe pliki (stops/routes/trips/calendar) parsujemy w całości,
// - stop_times importujemy batched do SQLite (patrz gtfsDatabase).
// Nie trzymamy całego rozkładu w Mapach jak serwer - telefon pyta SQLite.

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

interface GtfsArchiveCandidate {
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

function gtfsZipUri(): string {
  return `${baseDir()}${GTFS.cacheFile}`;
}

export function gtfsDir(): string {
  return `${baseDir()}${GTFS.extractedDir}/`;
}

async function ensureBaseDir(): Promise<void> {
  const dir = baseDir();
  const info = await FileSystem.getInfoAsync(dir);
  if (!info.exists) {
    await FileSystem.makeDirectoryAsync(dir, { intermediates: true });
  }
}

/** Wybiera najnowszy obowiązujący archiwum GTFS z katalogu Open Data. */
async function discoverBestArchiveUrl(): Promise<string> {
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
            // pojedynczy kandydat może odpaść - lecimy dalej
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

  // Bez internetu nie ma sensu próbować kolejnych źródeł - mówimy wprost.
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
async function downloadGtfsZip(
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
  // downloadAsync rozwiązuje się także dla 4xx/5xx - bez tego strony błędu
  // (404/503, captive portal) trafiały do gtfs.zip jako „sukces".
  if (result.status < 200 || result.status >= 300) {
    await FileSystem.deleteAsync(dest, { idempotent: true });
    throw new Error(`HTTP response status code ${result.status}`);
  }
  return result.uri;
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
 * Nazwy plików z katalogu centralnego ZIP-a (bez dekompresji).
 * Są potrzebne PRZED rozpakowywaniem: inaczej fflate rozpakuje wszystko
 * naraz i stop_times (~46 MB) ląduje w RAM razem z resztą - OOM na
 * słabszych telefonach.
 */
function zipEntryNames(binary: Uint8Array): string[] {
  // Katalog centralny lokalizujemy przez EOCD (PK\5\6). Skan od końca,
  // bo EOCD może mieć za sobą komentarz zipa (do 64 KB).
  let eocd = -1;
  const eocdMin = Math.max(0, binary.length - 22 - 65557);
  for (let i = binary.length - 22; i >= eocdMin; i--) {
    if (binary[i] === 0x50 && binary[i + 1] === 0x4b && binary[i + 2] === 0x05 && binary[i + 3] === 0x06) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) return [];
  const cdSize = binary[eocd + 12] | (binary[eocd + 13] << 8) | (binary[eocd + 14] << 16) | (binary[eocd + 15] << 24);
  const cdsStart = binary[eocd + 16] | (binary[eocd + 17] << 8) | (binary[eocd + 18] << 16) | (binary[eocd + 19] << 24);
  const names: string[] = [];
  let pos = cdsStart;
  const cdEnd = cdsStart + cdSize;
  while (pos + 46 <= cdEnd && pos + 46 <= binary.length) {
    if (!(binary[pos] === 0x50 && binary[pos + 1] === 0x4b && binary[pos + 2] === 0x01 && binary[pos + 3] === 0x02)) break;
    const nameLen = binary[pos + 28] | (binary[pos + 29] << 8);
    const extraLen = binary[pos + 30] | (binary[pos + 31] << 8);
    const commentLen = binary[pos + 32] | (binary[pos + 33] << 8);
    let name = '';
    for (let k = 0; k < nameLen; k++) name += String.fromCharCode(binary[pos + 46 + k]);
    names.push(name);
    pos += 46 + nameLen + extraLen + commentLen;
  }
  return names;
}

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
  // base64 z legacy FileSystem-a żyje raz: po konwersji na binary zwalniamy
  // obie kopie tekstowe, żeby nie wisiały obok rozpakowywania.
  let base64 = await FileSystem.readAsStringAsync(zipUri, {
    encoding: FileSystem.EncodingType.Base64,
  });
  let binStr = atob(base64);
  base64 = '';
  const len = binStr.length;
  const binary = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    binary[i] = binStr.charCodeAt(i);
  }
  binStr = '';

  const zipNames = zipEntryNames(binary);
  if (zipNames.length === 0) throw new Error('Nieprawidłowe archiwum GTFS (brak katalogu ZIP)');

  // Rozpakowujemy i zapisujemy po jednym pliku: fflate z filtrem dekompresuje
  // tylko pasujące wpisy, więc stop_times nie leży w RAM razem z resztą.
  const unpacked: string[] = [];
  for (const full of zipNames) {
    if (full.endsWith('/')) continue;
    const short = full.split('/').pop() || full;
    if (!NEEDED_GTFS_FILES.has(short)) continue;
    const one = unzipSync(binary, { filter: (file) => file.name === full });
    const data = one[full];
    if (!data) continue;
    const text = strFromU8(data);
    await FileSystem.writeAsStringAsync(`${dir}${short}`, text);
    unpacked.push(short);
  }
  return unpacked;
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
