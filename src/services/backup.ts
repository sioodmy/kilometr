// Kopia zapasowa user space: zapisane miejsca, zapisane trasy, historia
// przejazdów, ustawienia trasowania, powiadomień i język.
//
// ŚWIADOMIE POZA KOPĄ (to nie user space, tylko stan urządzenia lub cache):
//  - rozkład MPK (kilkadziesiąt MB, odtwarza się jednym pobraniem),
//  - cache połączeń/podpowiedzi/ostatniej lokalizacji (30 min–7 dni TTL),
//  - śledzony kurs `trackedTrip.v2` (przestaje mieć sens po zmianie planu),
//  - `onboardingSeen`, znaczniki przeczytanych aktualności, flagi migracji.
//
// Format pliku żyje w `backupFormat.ts` (czysty, testowany przez tsx) — tu
// tylko I/O i decyzje o scalaniu z istniejącymi danymi.

import * as FileSystem from 'expo-file-system/legacy';
import type * as DocumentPicker from 'expo-document-picker';
import { kvGet, kvSet } from './storage';
import { getLocaleSettingSync, setLocaleSetting, type LocaleSetting } from '../i18n';
import { loadSettings, saveSettings, type RoutingSettings } from './settings';
import {
  loadNotificationPreferences,
  saveNotificationPreferences,
} from './notifications/preferences';
import type { NotificationPreferences } from './notifications/types';
import type { SavedPlace, SavedRoute } from '../types/models';
import type { TripHistoryItem } from './smartRanking';
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

/** Historia jest przycięta do 80 pozycji przez `saveTripHistory`; import
 *  zapisuje tędy, więc dłuższa kopia i tak zostanie ucięta. */
const MAX_TRIP_HISTORY = 80;

/** Ile kopii zostawiamy na urządzeniu. Więcej nie ma sensu — export jest
 *  jednym kliknięciem, a bez limitu katalog rośnie w nieskończoność. */
const KEEP_BACKUPS = 3;

/**
 * Odczyt surowego JSON-a z klucza. Zwraca `null` dla każdego kształtu, którego
 * nie jesteśmy pewni (uszkodzony JSON, nie-tablica) — eksport wtedy ma jedną
 * sekcję pustą zamiast się wywrócić, a import i tak waliduje wejście od nowa.
 */
async function readArray<T>(key: string): Promise<T[] | null> {
  try {
    const raw = await kvGet(key);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as T[]) : null;
  } catch {
    return null;
  }
}

// ─── Eksport ────────────────────────────────────────────────────────────────

async function collectBackupData(): Promise<BackupData> {
  const [places, savedRoutes, tripHistory, routing, prefs] = await Promise.all([
    readArray<SavedPlace>(KEYS.places),
    readArray<SavedRoute>(KEYS.savedRoutes),
    readArray<TripHistoryItem>(KEYS.tripHistory),
    loadSettings(),
    loadNotificationPreferences(),
  ]);
  // Język bierzemy z modułu, nie z KV: `getLocaleSettingSync` to jedyne
  // miejsce, które zna aktualny wybór (również 'system', gdy klucza nie ma).
  const locale: LocaleSetting = getLocaleSettingSync();
  return {
    places: places ?? [],
    savedRoutes: savedRoutes ?? [],
    tripHistory: tripHistory ?? [],
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
    // katalog może już istnieć — makeDirectory rzuca wtedy, więc ignorujemy
  }
  await pruneOldBackups(dir);
  const path = `${dir}${backupFileName(new Date())}`;
  await FileSystem.writeAsStringAsync(path, json, {
    encoding: FileSystem.EncodingType.UTF8,
  });
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
    // sprzątanie jest best-effort — brak katalogu nie może zepsuć eksportu
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

/** Ile sekcji faktycznie wypełniliśmy — do informacji po ekranie. */
export async function previewBackupCounts(): Promise<BackupCounts> {
  return countBackupData(await collectBackupData());
}

// ─── Powiadamienie konsumentów ─────────────────────────────────────────────
//
// Sam zapis do KV nie wystarczy: ekran główny trzyma miejsca i ranking
// „ostatnich miejsc" w `useState`, więc po imporcie pokazałby dane sprzed
// wczytania aż do restartu aplikacji. Ten kanał pozwala ekranowi odświeżyć
// stan od razu — bez niego import działałby „na pół".
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
 * Wybiera plik i wczytuje go, NIE zapisując nic — żeby UI mogło pokazać
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
 * Scalenie po `id` — import nie może wygenerować duplikatów miejsc o tej
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
 * a nie tego, co było w kopercie — inaczej po imporcie telefon z 4 miejscami
 * i kopią z 2 miejscami zgłosiłby „scalono 2", co jest prawdą na połowę.
 */
export async function applyBackup(data: BackupData): Promise<BackupCounts> {
  const [places, savedRoutes, tripHistory] = await Promise.all([
    readArray<SavedPlace>(KEYS.places),
    readArray<SavedRoute>(KEYS.savedRoutes),
    readArray<TripHistoryItem>(KEYS.tripHistory),
  ]);

  const nextPlaces = data.places.length > 0 ? mergeById(places ?? [], data.places) : places ?? [];
  if (nextPlaces !== places && data.places.length > 0) {
    await kvSet(KEYS.places, JSON.stringify(nextPlaces));
  }

  const nextRoutes =
    data.savedRoutes.length > 0 ? mergeById(savedRoutes ?? [], data.savedRoutes) : savedRoutes ?? [];
  if (nextRoutes !== savedRoutes && data.savedRoutes.length > 0) {
    await kvSet(KEYS.savedRoutes, JSON.stringify(nextRoutes));
  }

  let nextHistory = tripHistory ?? [];
  if (data.tripHistory.length > 0) {
    nextHistory = mergeById(nextHistory, data.tripHistory).sort(byNewest).slice(0, MAX_TRIP_HISTORY);
    await kvSet(KEYS.tripHistory, JSON.stringify(nextHistory));
  }

  // Ustawienia idą przez `save*`, nie przez kvSet: moduły trzymają cache w
  // pamięci, więc zapis bezpośredni zostawiłby UI na starych wartościach do
  // restartu aplikacji.
  if (data.routingSettings) await saveSettings(data.routingSettings as Partial<RoutingSettings>);
  if (data.notificationPrefs) {
    await saveNotificationPreferences(data.notificationPrefs as Partial<NotificationPreferences>);
  }
  if (data.locale) await setLocaleSetting(data.locale);

  notifyApplied();

  return countBackupData({
    places: nextPlaces,
    savedRoutes: nextRoutes,
    tripHistory: nextHistory,
    routingSettings: data.routingSettings,
    notificationPrefs: data.notificationPrefs,
    locale: data.locale,
  });
}

export { BACKUP_EXTENSION, BACKUP_MIME };
export type { BackupCounts, BackupData, BackupParseFailure, BackupParseResult };