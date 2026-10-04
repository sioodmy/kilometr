// Pobieranie GTFS bezpośrednio na telefon, dla AKTYWNEGO MIASTA.
// Używa legacy FileSystem (documentDirectory + downloadAsync), bo ten sam
// mechanizm obsługuje już widgetSnapshot — nowy File API przejdzie w etapie 2.
//
// Strategia pamięciowa (ważne przy stop_times.txt ~140 MB dla Krakowa):
// - zip ląduje jako plik, nie w RAM,
// - rozpakowanie przez fflate na Uint8Array + zapis plików po kolei,
// - małe pliki (stops/routes/trips/calendar) parsujemy w całości,
// - stop_times importujemy batched do SQLite (patrz gtfsDatabase).
// Nie trzymamy całego rozkładu w Mapach jak serwer — telefon pyta SQLite.
//
// Miasto może wystawiać WIELE archiwów (Kraków: tramwaje + dwa przewoźnicy
// autobusowych), dlatego wszystko niżej operuje na `feed.id`, nie na jednej
// stałej nazwie pliku.

import * as FileSystem from 'expo-file-system/legacy';
import { strFromU8, unzipSync } from 'fflate';
import { API_URL } from '../config';
import { getActiveCityIdSync, getActiveCitySync } from '../cities/active';
import { DEFAULT_CITY_ID } from '../cities/registry';
import type { CityFeed } from '../cities/types';
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

/**
 * Katalog bazowy danych GTFS na telefonie.
 *
 * Ułożenie: `kilometr/<cityId>/<feedId>.zip` oraz `kilometr/<cityId>/<feedId>/`.
 * Rozdzielenie po mieście jest konieczne, bo aktywne miasto może się zmienić
 * w trakcie życia aplikacji, a rozkładu nie chcemy nadpisywać — powrót do
 * poprzedniego miasta ma działać natychmiast, bez ponownego pobierania.
 */
function baseDir(): string {
  const base = FileSystem.documentDirectory;
  if (!base) throw new Error('Brak documentDirectory (expo-file-system)');
  return `${base}kilometr/${getActiveCityIdSync()}/`;
}

/** Katalog jednej części rozkładu (`gtfsDir('tram')` → katalog z feedu tramwajowego). */
export function gtfsDir(feedId?: string): string {
  return `${baseDir()}${feedId ?? 'all'}/`;
}

/** Ścieżka archiwum jednej części. */
export function gtfsZipUri(feedId?: string): string {
  return `${baseDir()}${feedId ?? 'all'}.zip`;
}

export async function ensureBaseDir(): Promise<void> {
  const dir = baseDir();
  const info = await FileSystem.getInfoAsync(dir);
  if (!info.exists) {
    await FileSystem.makeDirectoryAsync(dir, { intermediates: true });
  }
}

/**
 * Usuwa pliki z poprzedniej wersji aplikacji, która trzymała rozkład w
 * `kilometr/gtfs.zip` i `kilometr/gtfs/`. Bez tego upgrade zostawiałby
 * ~75 MB śmieci. Najlepsza robota, brak błędu do zgłoszenia.
 */
async function removeLegacyPaths(): Promise<void> {
  const base = FileSystem.documentDirectory;
  if (!base) return;
  for (const legacy of [`${base}kilometr/gtfs.zip`, `${base}kilometr/gtfs/`]) {
    try {
      await FileSystem.deleteAsync(legacy, { idempotent: true });
    } catch {
      // najgorszy wypadek to pozostawienie pliku
    }
  }
}

/**
 * Wybiera najnowszy obowiązujący archiwum GTFS z katalogu danych.
 *
 * Tylko Wrocław publikuje katalog z listą wydań (Open Data). Pozostałe miasta
 * wystawiają pliki pod stałym adresem, nadpisywane w miejscu — dla nich
 * discovery nie ma czego szukać i zwracamy pierwszy feed wprost.
 */
export async function discoverBestArchiveUrl(): Promise<string> {
  const city = getActiveCitySync();
  if (!city.catalogueUrl) return city.fallbackDownloadUrl ?? city.feeds[0].url;
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 10000);
    try {
      const res = await fetch(city.catalogueUrl, {
        headers: { Accept: 'application/json' },
        signal: ctrl.signal,
      });
      if (res.ok) {
        const data = (await res.json()) as { pliki?: number[] };
        const fileIds = Array.isArray(data.pliki) ? data.pliki.slice(0, 5) : [];
        const candidates: GtfsArchiveCandidate[] = [];
        const now = Date.now();
        for (const id of fileIds) {
          const url = `${city.downloadBase}/${id}/`;
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
  return city.fallbackDownloadUrl ?? city.feeds[0].url;
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


/** Pobiera gtfs.zip do documentDirectory. Zwraca lokalne URI. */
export async function downloadGtfsZip(
  url: string,
  feedId: string,
  onProgress?: (p: DownloadProgress) => void,
): Promise<string> {
  await ensureBaseDir();
  const dest = gtfsZipUri(feedId);
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
  return result.uri;
}

/**
 * Lustro: to samo archiwum, które backend dev już trzyma na dysku. W buildzie
 * release (bez skonfigurowanego API_URL) nie ma do kogo sięgać, więc wtedy
 * pomijamy kandydata zamiast marnować czasu na martwe połączenie.
 *
 * Uwaga: lustro ma sens tylko dla miasta, które backend zna. Backend dev
 * trzyma Wrocław, więc dla innych miast lustro celowo pomijamy — inaczej
 * telefon w Krakowie ściągnąłby wrocławski rozkład pod nazwą krakowskiego.
 */
function mirrorArchiveUrl(cityId: string): string | null {
  if (!__DEV__ && !process.env.EXPO_PUBLIC_API_URL) return null;
  if (cityId !== DEFAULT_CITY_ID) return null;
  return `${API_URL}/api/gtfs/archive`;
}

export interface FeedDownload {
  feedId: string;
  uri: string;
  source: ArchiveSource;
}

/**
 * Pobiera JEDEN feed miasta, próbując po kolei: katalog danych → adres
 * bezpośredni → lustro backendu. Każde źródło dostaje świeży postęp (restart
 * od zera), a użytkownik widzi komunikat dopiero po wyczerpaniu wszystkich opcji.
 */
export async function downloadFeedWithFallback(
  feed: CityFeed,
  onProgress?: (p: DownloadProgress, source: ArchiveSource) => void,
): Promise<FeedDownload> {
  const city = getActiveCitySync();
  const mirror = mirrorArchiveUrl(city.id);
  const candidates: { url: string; source: ArchiveSource }[] = [];

  // Katalog (albo discovery) ma sens tylko dla miasta, które go wystawia.
  // Dla reszty pierwszym kandydatem jest po prostu adres feedu.
  if (city.catalogueUrl) {
    candidates.push({ url: await discoverBestArchiveUrl(), source: 'catalogue' });
  }
  candidates.push({ url: feed.url, source: 'direct' });
  if (city.fallbackDownloadUrl && city.fallbackDownloadUrl !== feed.url) {
    candidates.push({ url: city.fallbackDownloadUrl, source: 'direct' });
  }
  if (mirror) candidates.push({ url: mirror, source: 'mirror' });

  const failures: GtfsDownloadError[] = [];
  const seen = new Set<string>();
  for (const candidate of candidates) {
    // Ten sam URL z dwiema etykietami to marnowanie przebiegu.
    if (seen.has(candidate.url)) continue;
    seen.add(candidate.url);
    try {
      const uri = await downloadGtfsZip(candidate.url, feed.id, (p) => onProgress?.(p, candidate.source));
      return { feedId: feed.id, uri, source: candidate.source };
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

/**
 * Sprawdza czy kompletny rozpakowany GTFS aktywnego miasta już istnieje.
 *
 * Wymagamy, by każdy feed dał `stops.txt` i `stop_times.txt`. Feed opcjonalny
 * (Mobilis w Krakowie) pomijamy, gdy go nie ma — inaczej awaria jednego
 * przewoźnika prywatnego blokowałaby dostęp do całego rozkładu miasta.
 */
export async function hasExtractedGtfs(): Promise<boolean> {
  for (const feed of getActiveCitySync().feeds) {
    try {
      const stopsInfo = await FileSystem.getInfoAsync(`${gtfsDir(feed.id)}stops.txt`);
      const timesInfo = await FileSystem.getInfoAsync(`${gtfsDir(feed.id)}stop_times.txt`);
      const present = stopsInfo.exists && timesInfo.exists;
      if (feed.optional && !present) continue;
      if (!present) return false;
    } catch {
      return false;
    }
  }
  return true;
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
 * Pliki GTFS po rozpakowaniu: stops/routes/trips/calendar/
 * calendar_dates/stop_times. Zwraca listę wypakowanych nazw.
 */
export async function unzipGtfs(zipUri: string, feedId: string): Promise<string[]> {
  const dir = gtfsDir(feedId);
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

  // Filtr w unzipSync zapobiega dekompresji niepotrzebnych shapes.txt (~30 MB) i innych do RAM
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

export interface ExtractedGtfsFile {
  feedId: string;
  content: string;
}

/**
 * Czyta plik GTFS ze WSZYSTKICH feedów aktywnego miasta.
 *
 * Zwracamy listę osobno dla każdego feedu, a nie jeden sklejony tekst, i to
 * z konkretnego powodu: szerokość kolumn różni się między plikami. Tramwaje
 * ZTP Krakowa mają w routes.txt 9 kolumn, a autobusy 12 (`route_sort_order`,
 * `continuous_pickup`…). Sklejenia ciał plików pod jeden nagłówek dałoby
 * przesunięcie kolumn i cichą katastrofę: numery linii czytane z innego miejsca
 * niż `route_type`. Każdy feed ma więc własny nagłówek i własny parser.
 *
 * Feed, którego nie ma na dysku (opcjonalny), jest pomijany.
 */
export async function readGtfsFiles(name: string): Promise<ExtractedGtfsFile[]> {
  const out: ExtractedGtfsFile[] = [];
  for (const feed of getActiveCitySync().feeds) {
    try {
      const content = await FileSystem.readAsStringAsync(`${gtfsDir(feed.id)}${name}`);
      out.push({ feedId: feed.id, content });
    } catch {
      // Brak pliku w feedzie opcjonalnym jest normalny — pomijamy.
      if (!feed.optional) out.push({ feedId: feed.id, content: '' });
    }
  }
  return out;
}

/** Usuwa zip + rozpakowane txt (po imporcie do SQLite zwalniamy ~75 MB). */
export async function cleanupRawGtfs(): Promise<void> {
  for (const feed of getActiveCitySync().feeds) {
    try {
      await FileSystem.deleteAsync(gtfsZipUri(feed.id), { idempotent: true });
    } catch {
      // best-effort
    }
    try {
      await FileSystem.deleteAsync(gtfsDir(feed.id), { idempotent: true });
    } catch {
      // best-effort
    }
  }
  await removeLegacyPaths();
}
