// Format kopii zapasowej (import/eksport user space).
//
// Ten plik jest CELOWO czysty — zero `expo-*`, zero `kvGet`. Importuje tylko
// typy, więc da się go uruchomić pod `tsx` bez telefonu (`npm run check:backup`).
// Wersjonowanie: kopie starsze od naszej wersji schematu odrzucamy (dane
// wymagają migracji, której nie mamy), nowsze też (nie umiemy ich czytać).
// W obrębie sekcji dane są walidowane punkt po punkcie, a uszkodzone wpisy
// są pomijane zamiast odrzucać całą kopię — inaczej jedno zepsute miejsce
// zrobiłoby z kopii nie do odzyskania.

import type { Connection, Leg, SavedPlace, SavedRoute, SavedPlaceIcon } from '../types/models';
import type { TripHistoryItem } from './smartRanking';
import type { RoutingSettings } from './settings';
import type { NotificationPreferences } from './notifications/types';
import type { LocaleSetting } from '../i18n';

/** Wersja schematu. Bump przy zmianie kształtu `BackupData`. */
export const BACKUP_SCHEMA = 1;

export const BACKUP_FILE_KIND = 'kilometr-backup';
export const BACKUP_APP_ID = 'kilometr';
/** Rozszerzenie pliku — Android rozpoznaje po nim JSON w meniu udostępniania. */
export const BACKUP_EXTENSION = 'json';
/** MIME type przy udostępnianiu. */
export const BACKUP_MIME = 'application/json';

export interface BackupData {
  places: SavedPlace[];
  savedRoutes: SavedRoute[];
  tripHistory: TripHistoryItem[];
  routingSettings: RoutingSettings | null;
  notificationPrefs: NotificationPreferences | null;
  locale: LocaleSetting | null;
}

export interface BackupEnvelope {
  kind: typeof BACKUP_FILE_KIND;
  app: typeof BACKUP_APP_ID;
  schema: number;
  createdAt: number;
  appVersion: string | null;
  data: BackupData;
}

export const EMPTY_BACKUP_DATA: BackupData = {
  places: [],
  savedRoutes: [],
  tripHistory: [],
  routingSettings: null,
  notificationPrefs: null,
  locale: null,
};

/** Ile pozycji każdej sekcji — do potwierdzenia przed importem i do podsumowania. */
export interface BackupCounts {
  places: number;
  savedRoutes: number;
  tripHistory: number;
  routingSettings: boolean;
  notificationPrefs: boolean;
  locale: boolean;
}

export function countBackupData(data: BackupData): BackupCounts {
  return {
    places: data.places.length,
    savedRoutes: data.savedRoutes.length,
    tripHistory: data.tripHistory.length,
    routingSettings: data.routingSettings !== null,
    notificationPrefs: data.notificationPrefs !== null,
    locale: data.locale !== null,
  };
}

/** Czy kopia w ogóle coś wnosi — pusty plik nie jest wart importu. */
export function isBackupEmpty(data: BackupData): boolean {
  const c = countBackupData(data);
  return !(
    c.places ||
    c.savedRoutes ||
    c.tripHistory ||
    c.routingSettings ||
    c.notificationPrefs ||
    c.locale
  );
}

// ─── Walidacja ──────────────────────────────────────────────────────────────

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function str(v: unknown): string | null {
  return typeof v === 'string' ? v : null;
}

/** Skończona liczba — `NaN`/`Infinity` z uszkodzonego pliku odpadają. */
function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

const MAX_TEXT = 300;

function text(v: unknown, max = MAX_TEXT): string | null {
  const s = str(v);
  return s === null ? null : s.slice(0, max);
}

/** Ikona miejsca: UI już zna fallback (`SAVED_PLACE_ICONS[icon] ?? MapPin`),
 *  więc nieznana ikona nie może nam zepsuć importu — zostawiamy jak jest. */
function placeIcon(v: unknown): SavedPlaceIcon {
  const s = str(v);
  return (s as SavedPlaceIcon) ?? 'home';
}

function readPlace(v: unknown): SavedPlace | null {
  if (!isRecord(v)) return null;
  const id = text(v.id, 64);
  const name = text(v.name);
  const lat = num(v.lat);
  const lon = num(v.lon);
  // Bez id i nazwy miejsce nie ma sensu, a bez współrzędnych nie da się
  // zaplanować dojazdu — to już nie miejsce, tylko śmieć.
  if (!id || !name || lat === null || lon === null) return null;
  return {
    id,
    placeId: text(v.placeId, 64) ?? id,
    name,
    icon: placeIcon(v.icon),
    address: text(v.address) ?? '',
    lat,
    lon,
    anchorStopId: text(v.anchorStopId, 64) ?? undefined,
    anchorStopName: text(v.anchorStopName) ?? undefined,
    anchorStopLat: num(v.anchorStopLat) ?? undefined,
    anchorStopLon: num(v.anchorStopLon) ?? undefined,
  };
}

const LEG_MODES: readonly string[] = ['tram', 'bus', 'walk'];

function readLeg(v: unknown): Leg | null {
  if (!isRecord(v)) return null;
  const id = text(v.id, 64);
  const mode = str(v.mode);
  const fromStop = text(v.fromStop);
  const toStop = text(v.toStop);
  const departAt = text(v.departAt, 8);
  const arriveAt = text(v.arriveAt, 8);
  // Odcinek bez id, przystanków albo godzin nie da się narysować na osi
  // czasu — lepiej go wyrzucić niż pokazać dziurę w trasie.
  if (!id || !mode || !LEG_MODES.includes(mode) || !fromStop || !toStop) return null;
  if (!departAt || !arriveAt) return null;
  const walkM = num(v.walkM);
  const stopsCount = num(v.stopsCount);
  return {
    ...v,
    id,
    mode: mode as Leg['mode'],
    fromStop,
    toStop,
    departAt,
    arriveAt,
    stopsCount: stopsCount !== null ? Math.max(0, Math.round(stopsCount)) : 0,
    live: v.live === true,
    line: text(v.line, 16) ?? undefined,
    direction: text(v.direction, 80) ?? undefined,
    walkM: walkM !== null && walkM > 0 ? walkM : undefined,
    fromStopId: text(v.fromStopId, 64) ?? undefined,
    toStopId: text(v.toStopId, 64) ?? undefined,
  } as Leg;
}

/** Zapisane połączenie: wymagamy id i niepustej listy odcinków. Głębiej nie
 *  walidujemy — `Connection` jest typem strukturalnym, a uszkodzony odcinek
 *  i tak zostanie odrzucony przez renderer. */
function readSavedRoute(v: unknown): SavedRoute | null {
  if (!isRecord(v)) return null;
  const id = text(v.id, 64);
  const savedAt = num(v.savedAt);
  if (!id || !isRecord(v.connection)) return null;
  const legs = (Array.isArray(v.connection.legs) ? v.connection.legs : [])
    .map(readLeg)
    .filter((l): l is Leg => l !== null);
  if (legs.length === 0) return null;
  const c = v.connection;
  // Pola liczbowe dostają 0, a nie `undefined`: ekran szczegółów liczy z nich
  // różnice (`departureSec - now`), a `undefined` zamieniłby się w `NaN` w
  // miejscu, gdzie użytkownik ma zobaczyć odjazd.
  const connection: Connection = {
    ...(c as unknown as Connection),
    id,
    fromTitle: text(c.fromTitle) ?? '',
    toTitle: text(c.toTitle) ?? '',
    departInMin: num(c.departInMin) ?? 0,
    departureSec: num(c.departureSec) ?? 0,
    departAt: text(c.departAt, 8) ?? '',
    arriveAt: text(c.arriveAt, 8) ?? '',
    durationMin: num(c.durationMin) ?? 0,
    transfers: num(c.transfers) ?? 0,
    delayMin: num(c.delayMin) ?? 0,
    live: c.live === true,
    legs,
  };
  return { id, savedAt: savedAt ?? Date.now(), connection };
}

function readTrip(v: unknown): TripHistoryItem | null {
  if (!isRecord(v)) return null;
  const id = text(v.id, 64);
  const destId = text(v.dest_id, 64);
  const destTitle = text(v.dest_title);
  const destLat = num(v.dest_lat);
  const destLon = num(v.dest_lon);
  const timestamp = num(v.timestamp);
  if (!id || !destId || !destTitle || destLat === null || destLon === null) return null;
  const originLat = num(v.origin_lat);
  const originLon = num(v.origin_lon);
  const duration = num(v.duration_min);
  const uses = num(v.uses);
  return {
    id,
    origin_title: text(v.origin_title) ?? '',
    origin_lat: originLat ?? 0,
    origin_lon: originLon ?? 0,
    dest_id: destId,
    dest_title: destTitle,
    dest_address: text(v.dest_address) ?? '',
    dest_lat: destLat,
    dest_lon: destLon,
    duration_min: duration !== null && duration > 0 ? duration : 0,
    timestamp: timestamp ?? 0,
    uses: uses !== null && uses >= 1 ? Math.round(uses) : undefined,
  };
}

function readRoutingSettings(v: unknown): RoutingSettings | null {
  if (!isRecord(v)) return null;
  return v as unknown as RoutingSettings;
}

function readNotificationPrefs(v: unknown): NotificationPreferences | null {
  if (!isRecord(v)) return null;
  return v as unknown as NotificationPreferences;
}

const LOCALES: readonly string[] = ['pl', 'en', 'de', 'uk', 'system'];

function readLocale(v: unknown): LocaleSetting | null {
  const s = str(v);
  return s && LOCALES.includes(s) ? (s as LocaleSetting) : null;
}

// ─── Odczyt kopii ───────────────────────────────────────────────────────────

export type BackupParseFailure = 'noFile' | 'unreadable' | 'notBackup' | 'schemaTooNew';

export type BackupParseResult =
  | { ok: true; envelope: BackupEnvelope; counts: BackupCounts; empty: boolean }
  | { ok: false; reason: BackupParseFailure };

/**
 * Parsuje i waliduje plik kopii. Nigdy nie rzuca — UI pokazuje powód
 * nieczytelności zamiast wyjątku.
 */
export function parseBackupFile(raw: string): BackupParseResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, reason: 'unreadable' };
  }
  if (!isRecord(parsed)) return { ok: false, reason: 'unreadable' };
  if (parsed.kind !== BACKUP_FILE_KIND || parsed.app !== BACKUP_APP_ID) {
    return { ok: false, reason: 'notBackup' };
  }
  const schema = num(parsed.schema);
  if (schema === null || schema < 1) return { ok: false, reason: 'unreadable' };
  if (schema > BACKUP_SCHEMA) return { ok: false, reason: 'schemaTooNew' };

  const data: BackupData = { ...EMPTY_BACKUP_DATA };
  const d = isRecord(parsed.data) ? parsed.data : {};

  if (Array.isArray(d.places)) {
    data.places = d.places.map(readPlace).filter((p): p is SavedPlace => p !== null);
  }
  if (Array.isArray(d.savedRoutes)) {
    data.savedRoutes = d.savedRoutes
      .map(readSavedRoute)
      .filter((r): r is SavedRoute => r !== null);
  }
  if (Array.isArray(d.tripHistory)) {
    data.tripHistory = d.tripHistory
      .map(readTrip)
      .filter((t): t is TripHistoryItem => t !== null);
  }
  data.routingSettings = readRoutingSettings(d.routingSettings);
  data.notificationPrefs = readNotificationPrefs(d.notificationPrefs);
  data.locale = readLocale(d.locale);

  const counts = countBackupData(data);
  const envelope: BackupEnvelope = {
    kind: BACKUP_FILE_KIND,
    app: BACKUP_APP_ID,
    schema,
    createdAt: num(parsed.createdAt) ?? 0,
    appVersion: text(parsed.appVersion, 32),
    data,
  };
  return { ok: true, envelope, counts, empty: isBackupEmpty(data) };
}

// ─── Zapis kopii ────────────────────────────────────────────────────────────

export function buildBackupFile(data: BackupData, appVersion: string | null): string {
  const envelope: BackupEnvelope = {
    kind: BACKUP_FILE_KIND,
    app: BACKUP_APP_ID,
    schema: BACKUP_SCHEMA,
    createdAt: Date.now(),
    appVersion,
    data,
  };
  return JSON.stringify(envelope, null, 2);
}

/** `kilometr-backup-2026-10-05-1842.json` — sortowanie po nazwie daje chronologię. */
export function backupFileName(now: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return (
    `kilometr-backup-${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}` +
    `-${p(now.getHours())}${p(now.getMinutes())}.${BACKUP_EXTENSION}`
  );
}