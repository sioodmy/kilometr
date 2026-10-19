// Diagnostyka danych offline: health check bazy GTFS pod kartę w Ustawieniach.
// Tylko odczyty (quick_check, liczniki, kalendarz, wagi, POI, rozmiar pliku).
// Naprawa to osobna akcja w UI (ponowne pobranie przez dataManager).

import * as Clipboard from 'expo-clipboard';
import Constants from 'expo-constants';
import * as FileSystem from 'expo-file-system/legacy';
import { Platform } from 'react-native';
import { getCity } from '../cities';
import { de } from '../i18n/de';
import { en } from '../i18n/en';
import { getLocaleSync, type Strings } from '../i18n';
import { pl } from '../i18n/pl';
import { uk } from '../i18n/uk';
import { getActiveCityIdSync } from './cityStore';
import {
  getActiveServices,
  getGtfsDb,
  getGtfsStats,
  getMeta,
  needsStopWeights,
  poiCount,
} from './gtfsDatabase';

const DICTS: Record<string, Strings> = { pl, en, de, uk };

function diagTr(): Strings['settings'] {
  return (DICTS[getLocaleSync()] ?? pl).settings;
}

function cityNameOf(cityId: string): string {
  return (DICTS[getLocaleSync()] ?? pl).city.name(cityId);
}

export type DiagLevel = 'ok' | 'warn' | 'error';

type DiagItemId = 'db' | 'counts' | 'trains' | 'calendar' | 'search';

export interface DiagItem {
  id: DiagItemId;
  level: DiagLevel;
  title: string;
  detail: string | null;
}

export interface DiagResult {
  items: DiagItem[];
  appVersion: string | null;
  os: string;
  cityId: string;
  cityName: string;
  timetableVersion: string | null;
  importedAt: string | null;
  dbBytes: number | null;
  counts: { stops: number; routes: number; trips: number; stopTimes: number };
  calendar: { from: string; to: string } | null;
  servicesToday: number | null;
  weightedStops: number;
  pois: number;
  trains: number;
}

export function diagOverall(result: DiagResult): DiagLevel {
  if (result.items.some((i) => i.level === 'error')) return 'error';
  if (result.items.some((i) => i.level === 'warn')) return 'warn';
  return 'ok';
}

function todayKey(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}`;
}

/** 20260314 -> 14.03.2026 (zapis dzienny czytelny w pl/de/uk/en). */
function fmtDay(key: string): string {
  return `${key.slice(6, 8)}.${key.slice(4, 6)}.${key.slice(0, 4)}`;
}

function mb(bytes: number): string {
  return (bytes / 1048576).toFixed(1);
}

function daysUntil(toKey: string): number {
  const to = new Date(
    Number(toKey.slice(0, 4)),
    Number(toKey.slice(4, 6)) - 1,
    Number(toKey.slice(6, 8)),
  );
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  return Math.round((to.getTime() - now.getTime()) / 86400000);
}

async function dbFileSize(name: string): Promise<{ main: number | null; wal: number | null; orphan: string | null }> {
  try {
    const base = FileSystem.documentDirectory;
    if (!base) return { main: null, wal: null, orphan: null };
    const dir = `${base.replace(/\/+$/, '')}/SQLite`;
    const info = await FileSystem.getInfoAsync(`${dir}/${name}`);
    const main = info.exists && 'size' in info ? (info.size as number) : null;
    const walInfo = await FileSystem.getInfoAsync(`${dir}/${name}-wal`).catch(() => null);
    const wal = walInfo && walInfo.exists && 'size' in walInfo ? (walInfo.size as number) : null;
    const tmpInfo = await FileSystem.getInfoAsync(`${dir}/${name}.new.db`).catch(() => null);
    return { main, wal, orphan: tmpInfo && tmpInfo.exists ? `${name}.new.db` : null };
  } catch {
    return { main: null, wal: null, orphan: null };
  }
}

const WAL_WARN_BYTES = 32 * 1048576;

export async function runDiagnostics(): Promise<DiagResult> {
  const t = diagTr();
  const cityId = getActiveCityIdSync();
  const items: DiagItem[] = [];
  const counts = await getGtfsStats().catch(() => ({ stops: 0, routes: 0, trips: 0, stopTimes: 0 }));

  const fileInfo = await dbFileSize(getCity(cityId).dbFile);
  try {
    const db = await getGtfsDb();
    const rows = await db.getAllAsync<Record<string, unknown>>('PRAGMA quick_check(1)');
    const values = rows.map((r) => String(Object.values(r)[0] ?? ''));
    const healthy = rows.length > 0 && values.every((v) => v === 'ok');
    const { main, wal, orphan } = fileInfo;
    const parts: string[] = [];
    if (main != null) parts.push(t.diagDbSize(mb(main)));
    else parts.push(t.diagDbNoAccess);
    if (orphan) parts.push(t.diagDbOrphan(orphan));
    if (wal != null && wal > 0) parts.push(t.diagDbWal(mb(wal)));
    const walGrown = wal != null && wal > WAL_WARN_BYTES;
    items.push({
      id: 'db',
      level: !healthy ? 'error' : orphan != null || walGrown ? 'warn' : 'ok',
      title: t.diagDb,
      detail: !healthy ? t.diagDbDamaged : parts.join('. '),
    });
  } catch {
    items.push({ id: 'db', level: 'error', title: t.diagDb, detail: t.diagDbDamaged });
  }

  const empty = counts.stops === 0 || counts.trips === 0 || counts.stopTimes === 0;
  items.push({
    id: 'counts',
    level: empty ? 'error' : counts.routes === 0 ? 'warn' : 'ok',
    title: t.diagCounts,
    detail: empty
      ? t.diagCountsEmpty
      : counts.routes === 0
        ? t.diagCountsNoRoutes
        : t.diagCountsLine(counts.stops, counts.routes, counts.trips, counts.stopTimes),
  });

  let trains = 0;
  try {
    const db = await getGtfsDb();
    const row = await db.getFirstAsync<{ n: number }>('SELECT COUNT(*) AS n FROM routes WHERE type = 2');
    trains = row?.n ?? 0;
  } catch {
    trains = 0;
  }
  const railSupported = getCity(cityId).features.regionalRail;
  items.push({
    id: 'trains',
    level: !railSupported || trains > 0 ? 'ok' : empty ? 'error' : 'warn',
    title: t.diagTrains,
    detail:
      trains > 0
        ? t.diagTrainsLine(trains)
        : !railSupported
          ? t.diagTrainsNotSupported
          : empty
            ? t.diagCountsEmpty
            : t.diagTrainsNone,
  });

  let calendar: DiagResult['calendar'] = null;
  let servicesToday: number | null = null;
  try {
    const db = await getGtfsDb();
    const cal = await db.getFirstAsync<{ a: string | null; b: string | null }>(
      "SELECT MIN(start_date) AS a, MAX(end_date) AS b FROM calendar WHERE start_date <> '' AND end_date <> ''",
    );
    const cd = await db.getFirstAsync<{ a: string | null; b: string | null }>(
      'SELECT MIN(date) AS a, MAX(date) AS b FROM calendar_dates',
    );
    const from = [cal?.a, cd?.a].filter((v): v is string => !!v).sort()[0] ?? null;
    const to = [cal?.b, cd?.b].filter((v): v is string => !!v).sort().slice(-1)[0] ?? null;
    const today = todayKey();
    const now = new Date();
    try {
      servicesToday = (await getActiveServices(now.getDay(), today)).size;
    } catch {
      servicesToday = null;
    }
    if (!from || !to) {
      calendar = null;
      items.push({ id: 'calendar', level: 'error', title: t.diagCalendar, detail: t.diagCalendarEmpty });
    } else {
      calendar = { from, to };
      const line = t.diagCalendarLine(fmtDay(from), fmtDay(to));
      const svc = servicesToday != null ? ` ${t.diagCalendarServices(servicesToday)}` : '';
      const left = daysUntil(to);
      if (today < from || today > to) {
        items.push({ id: 'calendar', level: 'error', title: t.diagCalendar, detail: `${t.diagCalendarOutside}. ${line}.${svc}` });
      } else if (left <= 7) {
        items.push({ id: 'calendar', level: 'warn', title: t.diagCalendar, detail: `${t.diagCalendarExpiring(left)}. ${line}.${svc}` });
      } else if (servicesToday === 0) {
        items.push({ id: 'calendar', level: 'warn', title: t.diagCalendar, detail: `${line}.${svc}` });
      } else {
        items.push({ id: 'calendar', level: 'ok', title: t.diagCalendar, detail: `${line}.${svc}` });
      }
    }
  } catch {
    items.push({ id: 'calendar', level: 'error', title: t.diagCalendar, detail: t.diagCalendarEmpty });
  }

  let weightedStops = 0;
  let pois = 0;
  try {
    if (!empty) {
      if (await needsStopWeights()) {
        weightedStops = 0;
      } else {
        const db = await getGtfsDb();
        const row = await db.getFirstAsync<{ n: number }>('SELECT COUNT(*) AS n FROM stops WHERE weight > 0');
        weightedStops = row?.n ?? 0;
      }
    }
    pois = await poiCount();
  } catch {
    // liczniki zostają zerowe, poziom niżej
  }
  const weightsMissing = !empty && weightedStops === 0;
  items.push({
    id: 'search',
    level: empty ? 'error' : weightsMissing || pois === 0 ? 'warn' : 'ok',
    title: t.diagSearch,
    detail: empty
      ? t.diagCountsEmpty
      : weightsMissing || pois === 0
        ? [weightsMissing ? t.diagSearchWeights : null, pois === 0 ? t.diagSearchPois : null]
            .filter((v): v is string => !!v)
            .join('. ')
        : t.diagSearchOk(weightedStops, pois),
  });

  let appVersion: string | null = null;
  try {
    const v = Constants.expoConfig?.version;
    appVersion = typeof v === 'string' ? v : null;
  } catch {
    appVersion = null;
  }
  const size = fileInfo;
  const timetableVersion = await getMeta('timetable_version').catch(() => null);
  const importedAt = await getMeta('gtfs_imported_at').catch(() => null);

  return {
    items,
    appVersion,
    os: `${Platform.OS} ${String(Platform.Version)}`,
    cityId,
    cityName: cityNameOf(cityId),
    timetableVersion,
    importedAt,
    dbBytes: size.main,
    counts,
    calendar,
    servicesToday,
    weightedStops,
    pois,
    trains,
  };
}

function levelWord(level: DiagLevel): string {
  const t = diagTr();
  return level === 'ok' ? t.diagOk : level === 'warn' ? t.diagWarn : t.diagError;
}

/** Tekstowy raport do schowka: wersja appki, OS, miasto, rozkład, liczniki, statusy. */
function buildReport(r: DiagResult): string {
  const t = diagTr();
  const unknown = t.diagReportUnknown;
  const lines = [
    `Kilometr ${r.appVersion ?? unknown} (${r.os})`,
    `${t.diagReportCity}: ${r.cityName}`,
    `${t.diagReportTimetable}: ${r.timetableVersion ?? unknown} / ${t.diagReportImported}: ${r.importedAt ?? unknown}`,
    `${t.diagReportDb}: ${r.dbBytes != null ? `${mb(r.dbBytes)} MB` : unknown}`,
    t.diagCountsLine(r.counts.stops, r.counts.routes, r.counts.trips, r.counts.stopTimes),
    r.calendar ? t.diagCalendarLine(fmtDay(r.calendar.from), fmtDay(r.calendar.to)) : t.diagCalendarEmpty,
    ...r.items.map((i) => `- [${levelWord(i.level)}] ${i.title}${i.detail ? `: ${i.detail}` : ''}`),
  ];
  return lines.join('\n');
}

export async function copyReportToClipboard(r: DiagResult): Promise<boolean> {
  try {
    await Clipboard.setStringAsync(buildReport(r));
    return true;
  } catch {
    return false;
  }
}
