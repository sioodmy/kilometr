// Kopia zapasowa user space: zapisane miejsca, zapisane trasy, historia
// przejazdów, ustawienia trasowania, powiadomień i język.
//
// ŚWIADOMIE POZA KOPĄ (to nie user space, tylko stan urządzenia lub cache):
//  - rozkład MPK (kilkadziesiąt MB, odtwarza się jednym pobraniem),
//  - cache połączeń/podpowiedzi/ostatniej lokalizacji (30 min–7 dni TTL),
//  - śledzony kurs `trackedTrip.v2` (przestaje mieć sens po zmianie planu),
//  - `onboardingSeen`, znaczniki przeczytanych aktualności, flagi migracji.
//
// Format pliku żyje w `backupFormat.ts` (czysty, testowany przez tsx) - tu
// tylko I/O i decyzje o scalaniu z istniejącymi danymi.

import * as FileSystem from 'expo-file-system/legacy';
import type * as DocumentPicker from 'expo-document-picker';
import { kvGetStrict, kvSet } from './storage';
import { getLocaleSettingSync, setLocaleSetting, type LocaleSetting } from '../i18n';
import { loadSettings, saveSettings, type RoutingSettings } from './settings';
import {
  loadNotificationPreferences,
  saveNotificationPreferences,
} from './notifications/preferences';
import type { NotificationPreferences } from './notifications/types';
import type { SavedPlace, SavedRoute } from '../types/models';
import type { TripHistoryItem } from './smartRanking';
import { CITIES, cityKey, type CityId } from '../cities';
import {
  BACKUP_EXTENSION,
  BACKUP_MIME,
  backupFileName,
  buildBackupFile,
  countBackupData,
  parseBackupFile,
  type BackupCounts,
  type BackupData,
  type BackupParseFailure,
  type BackupParseResult,
} from './backupFormat';

const KEYS = {
  places: 'kilometr.places',
  savedRoutes: 'kilometr.saved_routes',
  tripHistory: 'kilometr.trip_history',
} as const;

/** Kubełek miasta dla klucza bazowego (ten sam wzorzec co reszta aplikacji). */
function bucketKey(base: string, cityId: CityId): string {
  return cityKey(base, cityId);
}

/** Historia jest przycięta do 80 pozycji przez `saveTripHistory`; import
 *  zapisuje tędy, więc dłuższa kopia i tak zostanie ucięta. */
const MAX_TRIP_HISTORY = 80;

/** Ile kopii zostawiamy na urządzeniu. Więcej nie ma sensu - export jest
 *  jednym kliknięciem, a bez limitu katalog rośnie w nieskończoność. */
const KEEP_BACKUPS = 3;

/**
 * Odczyt surowego JSON-a z klucza. Brak klucza to legalna pusta lista, ale
 * błąd odczytu lub uszkodzony JSON RZUCA: eksport nie może po cichu wysłać
 * kopii bez sekcji, a import nie może nadpisać istniejących danych pustką.
 */
async function readArray<T>(key: string): Promise<T[]> {
  const raw = await kvGetStrict(key);
  if (!raw) return [];
  const parsed: unknown = JSON.parse(raw);
  if (!Array.isArray(parsed)) throw new Error(`${key} is not an array`);
  return parsed as T[];
}

// ─── Eksport ────────────────────────────────────────────────────────────────

/**
 * Czyta kubełek miasta. Pusty kubełek to pusta lista, ale uszkodzony JSON
 * rzuca jak dawniej: eksport nie może po cichu wysłać kopii bez sekcji.
 */
async function readCityBucket<T>(base: string, cityId: CityId): Promise<T[]> {
  return readArray<T>(bucketKey(base, cityId));
}

async function collectBackupData(): Promise<BackupData> {
  const perCity = CITIES.map((c) => c.id);
  const [placesByCity, routesByCity, historyByCity, routing, prefs] = await Promise.all([
    Promise.all(
      perCity.map(async (city) => ({
        city,
        items: await readCityBucket<SavedPlace>(KEYS.places, city),
      })),
    ),
    Promise.all(
      perCity.map(async (city) => ({
        city,
        items: await readCityBucket<SavedRoute>(KEYS.savedRoutes, city),
      })),
    ),
    Promise.all(
      perCity.map(async (city) => ({
        city,
        items: await readCityBucket<TripHistoryItem>(KEYS.tripHistory, city),
      })),
    ),
    loadSettings(),
    loadNotificationPreferences(),
  ]);
  // Puste kubełki pomijamy: kopia z samego Wrocławia nie musi wozić
  // pustych sekcji Krakowa (import pustej sekcji i tak jest no-opem).
  const nonEmpty = <T>(sections: { city: CityId; items: T[] }[]) =>
    sections.filter((s) => s.items.length > 0);
  // Język bierzemy z modułu, nie z KV: `getLocaleSettingSync` to jedyne
  // miejsce, które zna aktualny wybór (również 'system', gdy klucza nie ma).
  const locale: LocaleSetting = getLocaleSettingSync();
  return {
    places: nonEmpty(placesByCity),
    savedRoutes: nonEmpty(routesByCity),
    tripHistory: nonEmpty(historyByCity),
    routingSettings: routing,
    notificationPrefs: prefs,
    locale,
  };
}

/**
 * Zapisuje kopię i zwraca ścieżkę.
 *
 * Do `documentDirectory`, nie `cacheDirectory`: system czyści cache przy
 * niskiej pamięci, a plik z kopiami użytkownik wywołał świadomie i ma go
 * znaleźć jeszcze za tydzień. Stare kopie sprzątamy (`KEEP_BACKUPS`), żeby
 * eksport nie zaśmiecał pamięci telefonu w nieskończoność.
 */
export async function writeBackupFile(appVersion: string | null): Promise<string> {
  const data = await collectBackupData();
  const json = buildBackupFile(data, appVersion);
  const base = FileSystem.documentDirectory ?? FileSystem.cacheDirectory;
  if (!base) throw new Error('brak katalogu na pliki');
  const dir = `${base.endsWith('/') ? base : `${base}/`}kilometr-backups/`;
  try {
    await FileSystem.makeDirectoryAsync(dir, { intermediates: true });
  } catch {
    // katalog może już istnieć - makeDirectory rzuca wtedy, więc ignorujemy
  }
  const path = `${dir}${backupFileName(new Date())}`;
  await FileSystem.writeAsStringAsync(path, json, {
    encoding: FileSystem.EncodingType.UTF8,
  });
  // Sprzątanie PO zapisie: wtedy `KEEP_BACKUPS` liczy też świeży plik, więc
  // na dysku zostaje dokładnie ta liczba, a nie o jedną więcej.
  await pruneOldBackups(dir);
  return path;
}

/** Zostawia `KEEP_BACKUPS` najnowszych plików, resztę kasuje. */
async function pruneOldBackups(dir: string): Promise<void> {
  try {
    const names = (await FileSystem.readDirectoryAsync(dir))
      .filter((n) => n.endsWith(`.${BACKUP_EXTENSION}`))
      .sort();
    for (const old of names.slice(0, Math.max(0, names.length - KEEP_BACKUPS))) {
      await FileSystem.deleteAsync(`${dir}${old}`, { idempotent: true });
    }
  } catch (err) {
    // sprzątanie jest best-effort - brak katalogu nie może zepsuć eksportu
    console.warn('[Backup] prune failed:', err);
  }
}

export interface BackupExportResult {
  path: string;
  /** Czy otworzyło się systemowe okno udostępniania. Gdy nie, plik i tak
   *  leży na urządzeniu i użytkownik musi dostać jego ścieżkę. */
  shared: boolean;
}

/** Zapis kopii + systemowe okno udostępniania (tam trafia plik). */
export async function exportBackupToFile(appVersion: string | null): Promise<BackupExportResult> {
  const path = await writeBackupFile(appVersion);
  const Sharing = await import('expo-sharing');
  if (!(await Sharing.isAvailableAsync())) return { path, shared: false };
  await Sharing.shareAsync(path, {
    mimeType: BACKUP_MIME,
    UTI: 'public.json',
    dialogTitle: 'kilometr',
  });
  return { path, shared: true };
}

/** Ile sekcji faktycznie wypełniliśmy - do informacji po ekranie. */
export async function previewBackupCounts(): Promise<BackupCounts> {
  return countBackupData(await collectBackupData());
}

// ─── Powiadamienie konsumentów ─────────────────────────────────────────────
//
// Sam zapis do KV nie wystarczy: ekran główny trzyma miejsca i ranking
// „ostatnich miejsc" w `useState`, więc po imporcie pokazałby dane sprzed
// wczytania aż do restartu aplikacji. Ten kanał pozwala ekranowi odświeżyć
// stan od razu - bez niego import działałby „na pół".
const appliedListeners = new Set<() => void>();

/** Subskrypcja na zapis wczytanej kopii. Zwraca funkcję odsubskrybującą. */
export function subscribeBackupApplied(fn: () => void): () => void {
  appliedListeners.add(fn);
  return () => {
    appliedListeners.delete(fn);
  };
}

function notifyApplied(): void {
  for (const l of appliedListeners) l();
}

// ─── Import ────────────────────────────────────────────────────────────────

/**
 * Wybiera plik i wczytuje go, NIE zapisując nic - żeby UI mogło pokazać
 * zawartość kopii przed potwierdzeniem (`applyBackup`).
 * `null` = użytkownik anulował wybór (nie błąd, nie pokazujemy nic).
 */
export async function pickBackupFile(): Promise<BackupParseResult | null> {
  let picked: DocumentPicker.DocumentPickerResult;
  try {
    const DocumentPicker = await import('expo-document-picker');
    picked = await DocumentPicker.getDocumentAsync({
      // Bez tego `FileSystem` nie zawsze czyta plik od razu po wyborze.
      copyToCacheDirectory: true,
      type: [BACKUP_MIME, 'text/json', 'text/plain', 'application/octet-stream'],
      multiple: false,
    });
  } catch (err) {
    console.warn('[Backup] file picker failed:', err);
    return { ok: false, reason: 'unreadable' };
  }
  if (picked.canceled) return null;
  const uri = picked.assets?.[0]?.uri;
  if (!uri) return { ok: false, reason: 'noFile' };

  try {
    const raw = await FileSystem.readAsStringAsync(uri, {
      encoding: FileSystem.EncodingType.UTF8,
    });
    return parseBackupFile(raw);
  } catch (err) {
    console.warn('[Backup] read failed:', err);
    return { ok: false, reason: 'unreadable' };
  }
}

/**
 * Scalenie po `id` - import nie może wygenerować duplikatów miejsc o tej
 * samej nazwie, a przy ponownym imporcie tej samej kopii nie może ich dublować.
 */
function mergeById<T extends { id: string }>(current: T[], incoming: T[]): T[] {
  const out = [...current];
  for (const item of incoming) {
    const idx = out.findIndex((x) => x.id === item.id);
    if (idx === -1) out.push(item);
    else out[idx] = item;
  }
  return out;
}

/** Historia maleje według daty; najnowsze wpisy muszą przetrwać obcięcie. */
function byNewest(a: TripHistoryItem, b: TripHistoryItem): number {
  return b.timestamp - a.timestamp;
}

/**
 * Zapisuje wczytaną kopię. Scalamy zamiast nadpisywać: użytkownik mógł dodać
 * miejsca po zrobieniu kopii, a skasowanie ich bez pytania byłoby najgorszym
 * możliwym zachowaniem („import" nie znaczy „wywal wszystko").
 *
 * Zwracamy licznik tego, co NAPRAWDĘ jest teraz na urządzeniu (po scaleniu),
 * a nie tego, co było w kopercie - inaczej po imporcie telefon z 4 miejscami
 * i kopią z 2 miejscami zgłosiłby „scalono 2", co jest prawdą na połowę.
 */
/** Wszystkie kubełki klucza (do liczników po scaleniu). */
async function readAllBuckets<T>(base: string): Promise<{ city: CityId; items: T[] }[]> {
  const out: { city: CityId; items: T[] }[] = [];
  for (const c of CITIES) {
    try {
      const items = await readArray<T>(bucketKey(base, c.id));
      if (items.length > 0) out.push({ city: c.id, items });
    } catch {
      // Uszkodzony kubełek nie może wywalić liczenia reszty.
    }
  }
  return out;
}

export async function applyBackup(data: BackupData): Promise<BackupCounts> {
  // Scalanie idzie per kubełek miasta: kopia z Krakowa nie dotyka Wrocławia.
  // Sekcje dla nieznanych miast nie przechodzą walidacji formatu, więc tu
  // ich nie ma, ale na wszelki wypadek pomijamy je zamiast rzucać.
  const mergeSection = async <T extends { id: string }>(
    base: string,
    sections: { city: CityId; items: T[] }[],
    sort?: (a: T, b: T) => number,
    cap?: number,
  ): Promise<{ city: CityId; items: T[] }[]> => {
    const out: { city: CityId; items: T[] }[] = [];
    for (const section of sections) {
      if (!CITIES.some((c) => c.id === section.city) || section.items.length === 0) continue;
      const key = bucketKey(base, section.city);
      const current = await readArray<T>(key);
      let next = mergeById(current, section.items);
      if (sort) next = next.sort(sort);
      if (cap !== undefined) next = next.slice(0, cap);
      if (next !== current) await kvSet(key, JSON.stringify(next));
      out.push({ city: section.city, items: next });
    }
    return out;
  };

  await Promise.all([
    mergeSection(KEYS.places, data.places),
    mergeSection(KEYS.savedRoutes, data.savedRoutes),
    mergeSection<TripHistoryItem>(KEYS.tripHistory, data.tripHistory, byNewest, MAX_TRIP_HISTORY),
  ]);

  // Ustawienia idą przez `save*`, nie przez kvSet: moduły trzymają cache w
  // pamięci, więc zapis bezpośredni zostawiłby UI na starych wartościach do
  // restartu aplikacji.
  if (data.routingSettings) await saveSettings(data.routingSettings as Partial<RoutingSettings>);
  if (data.notificationPrefs) {
    await saveNotificationPreferences(data.notificationPrefs as Partial<NotificationPreferences>);
  }
  if (data.locale) await setLocaleSetting(data.locale);

  notifyApplied();

  // Licznik pokazuje stan telefonu po scaleniu (wszystkie kubełki), nie tylko
  // to, co było w kopercie. Kopia z samego Krakowa nie zeruje wrocławskich
  // liczb na ekranie potwierdzenia.
  const [placesNow, routesNow, historyNow] = await Promise.all([
    readAllBuckets<SavedPlace>(KEYS.places),
    readAllBuckets<SavedRoute>(KEYS.savedRoutes),
    readAllBuckets<TripHistoryItem>(KEYS.tripHistory),
  ]);
  return countBackupData({
    places: placesNow,
    savedRoutes: routesNow,
    tripHistory: historyNow,
    routingSettings: data.routingSettings,
    notificationPrefs: data.notificationPrefs,
    locale: data.locale,
  });
}

export { BACKUP_EXTENSION, BACKUP_MIME };
export type { BackupCounts, BackupData, BackupParseFailure, BackupParseResult };
