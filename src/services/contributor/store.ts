// Magazyn telemetrii: osobna baza expo-sqlite (contributor.db) w stylu
// gtfsDatabase. Append-only: próbki dochodzą, edycja nigdy. Retencję
// zamyka `sweepRetention` (30 dni) - baza nie może rosnąć bez końca,
// bo tester ma ją głównie po to, by ją wysłać.

import * as SQLite from 'expo-sqlite';
import { randomId } from './config';

/** ~120 B na próbkę wyeksportowaną w JSONL, do liczenia rozmiaru w UI. */
export const BYTES_PER_SAMPLE = 120;

export const RETENTION_DAYS = 30;

export type SessionSource = 'manual' | 'trip' | 'native';

export interface SessionMeta {
  city: string;
  line?: string;
  routeId?: string;
  tripId?: string;
  headsign?: string;
  fromTitle?: string;
  toTitle?: string;
  delayMin?: number;
  source: SessionSource;
}

export interface SessionRow {
  id: string;
  deviceId: string;
  startedAt: number;
  endedAt: number | null;
  source: SessionSource;
  city: string;
  line: string;
  routeId: string;
  tripId: string;
  headsign: string;
  fromTitle: string;
  toTitle: string;
  delayMin: number | null;
  contextJson: string;
  samples: number;
  uploaded: number;
  origin: string;
}

export interface SampleRow {
  tms: number;
  lat: number | null;
  lng: number | null;
  alt: number | null;
  hacc: number | null;
  spd: number | null;
  brg: number | null;
  aMin: number;
  aMax: number;
  aAvg: number;
  aStd: number;
  xAvg: number;
  yAvg: number;
  zAvg: number;
  moved: boolean;
}

export interface StatsResult {
  sessions: number;
  samples: number;
  uploaded: number;
}

let dbPromise: Promise<SQLite.SQLiteDatabase> | null = null;

async function initDb(): Promise<SQLite.SQLiteDatabase> {
  const db = await SQLite.openDatabaseAsync('contributor.db');
  await db.execAsync(`
    PRAGMA journal_mode = WAL;
    PRAGMA busy_timeout = 15000;
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY NOT NULL,
      device_id TEXT NOT NULL,
      started_at INTEGER NOT NULL,
      ended_at INTEGER,
      source TEXT NOT NULL DEFAULT 'manual',
      city TEXT NOT NULL DEFAULT '',
      line TEXT NOT NULL DEFAULT '',
      route_id TEXT NOT NULL DEFAULT '',
      trip_id TEXT NOT NULL DEFAULT '',
      headsign TEXT NOT NULL DEFAULT '',
      from_title TEXT NOT NULL DEFAULT '',
      to_title TEXT NOT NULL DEFAULT '',
      delay_min INTEGER,
      context_json TEXT NOT NULL DEFAULT '{}',
      samples INTEGER NOT NULL DEFAULT 0,
      uploaded INTEGER NOT NULL DEFAULT 0,
      origin TEXT NOT NULL DEFAULT 'js'
    );
    CREATE TABLE IF NOT EXISTS samples (
      session_id TEXT NOT NULL,
      tms INTEGER NOT NULL,
      lat REAL, lng REAL, alt REAL, hacc REAL, spd REAL, brg REAL,
      a_min REAL NOT NULL, a_max REAL NOT NULL, a_avg REAL NOT NULL, a_std REAL NOT NULL,
      x_avg REAL NOT NULL, y_avg REAL NOT NULL, z_avg REAL NOT NULL,
      moved INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (session_id, tms)
    ) WITHOUT ROWID;
    CREATE INDEX IF NOT EXISTS idx_samples_session ON samples (session_id);
  `);
  return db;
}

export function openContributorDb(): Promise<SQLite.SQLiteDatabase> {
  if (!dbPromise) dbPromise = initDb();
  return dbPromise;
}

export interface CreatedSession {
  id: string;
  deviceId: string;
}

/** Nowa sesja: wpist w `sessions`, próbki dochodzą potem. */
export async function createSession(deviceId: string, meta: SessionMeta): Promise<CreatedSession> {
  const db = await openContributorDb();
  const id = sessionId();
  await runInsert(db, id, deviceId, Date.now(), meta, 'js');
  return { id, deviceId };
}

/** Sesja z pliku natywnego: id i start pochodzi z nagłówka JSONL. */
export async function createSessionFromNative(
  deviceId: string,
  id: string,
  startedAt: number,
  meta: SessionMeta,
): Promise<CreatedSession> {
  const db = await openContributorDb();
  await db.runAsync('DELETE FROM samples WHERE session_id = ?', [id]);
  await db.runAsync('DELETE FROM sessions WHERE id = ?', [id]);
  await runInsert(db, id, deviceId, startedAt, meta, 'native');
  return { id, deviceId };
}

export async function insertNativeSamples(
  sessionId: string,
  rows: SampleRow[],
  context: Record<string, unknown> = {},
): Promise<void> {
  if (rows.length === 0) return;
  const db = await openContributorDb();
  await db.withTransactionAsync(async () => {
    for (const s of rows) {
      await db.runAsync(
        `INSERT OR IGNORE INTO samples
           (session_id, tms, lat, lng, alt, hacc, spd, brg,
            a_min, a_max, a_avg, a_std, x_avg, y_avg, z_avg, moved)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        sampleParams(sessionId, s),
      );
    }
  });
  if (Object.keys(context).length > 0) {
    await db.runAsync('UPDATE sessions SET context_json = ? WHERE id = ?', [
      JSON.stringify(context),
      sessionId,
    ]);
  }
}

/** Domyknięcie sesji: zapisuje liczbę próbek i stan końcowy. */
export async function closeSession(
  sessionId: string,
  delayMin?: number,
  context?: Record<string, unknown>,
): Promise<void> {
  const db = await openContributorDb();
  const count = await db.getFirstAsync<{ n: number }>(
    'SELECT COUNT(*) AS n FROM samples WHERE session_id = ?',
    [sessionId],
  );
  await db.runAsync(
    `UPDATE sessions
        SET ended_at = ?, samples = ?, delay_min = ?, context_json = ?
      WHERE id = ?`,
    [
      Date.now(),
      count?.n ?? 0,
      delayMin ?? null,
      context ? JSON.stringify(context) : '{}',
      sessionId,
    ],
  );
}

/** Wersja dla ingestu: czasy kończy nagłówek pliku natywnego. */
export async function closeNativeSession(sessionId: string, endedAt: number): Promise<void> {
  const db = await openContributorDb();
  const count = await db.getFirstAsync<{ n: number }>(
    'SELECT COUNT(*) AS n FROM samples WHERE session_id = ?',
    [sessionId],
  );
  await db.runAsync('UPDATE sessions SET ended_at = ?, samples = ? WHERE id = ?', [
    endedAt,
    count?.n ?? 0,
    sessionId,
  ]);
}

async function runInsert(
  db: SQLite.SQLiteDatabase,
  id: string,
  deviceId: string,
  startedAt: number,
  meta: SessionMeta,
  origin: string,
): Promise<void> {
  await db.runAsync(
    `INSERT INTO sessions
       (id, device_id, started_at, ended_at, source, city, line, route_id, trip_id, headsign,
        from_title, to_title, delay_min, context_json, samples, uploaded, origin)
     VALUES (?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, ?)`,
    [
      id,
      deviceId,
      startedAt,
      meta.source,
      meta.city ?? '',
      meta.line ?? '',
      meta.routeId ?? '',
      meta.tripId ?? '',
      meta.headsign ?? '',
      meta.fromTitle ?? '',
      meta.toTitle ?? '',
      meta.delayMin ?? null,
      '{}',
      origin,
    ],
  );
}

function sessionId(): string {
  return `${Date.now().toString(36)}-${randomId().slice(0, 12)}`;
}

function sampleParams(sessionId: string, s: SampleRow): (number | string | null)[] {
  return [
    sessionId,
    s.tms,
    s.lat,
    s.lng,
    s.alt,
    s.hacc,
    s.spd,
    s.brg,
    s.aMin,
    s.aMax,
    s.aAvg,
    s.aStd,
    s.xAvg,
    s.yAvg,
    s.zAvg,
    s.moved ? 1 : 0,
  ];
}

export async function appendSample(sessionId: string, s: SampleRow): Promise<void> {
  const db = await openContributorDb();
  await db.runAsync(
    `INSERT OR IGNORE INTO samples
       (session_id, tms, lat, lng, alt, hacc, spd, brg,
        a_min, a_max, a_avg, a_std, x_avg, y_avg, z_avg, moved)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    sampleParams(sessionId, s),
  );
}

/** Dopisek do wolnego kontekstu sesji (bierze się rosnące śledzenie w liveTracker). */
export async function appendSessionContext(
  sessionId: string,
  patch: Record<string, unknown>,
  delayMin?: number,
): Promise<void> {
  const db = await openContributorDb();
  const row = await db.getFirstAsync<{ context_json: string }>(
    'SELECT context_json FROM sessions WHERE id = ?',
    [sessionId],
  );
  const current = safeContext(row?.context_json ?? '{}');
  Object.assign(current, patch);
  if (delayMin !== undefined) {
    await db.runAsync('UPDATE sessions SET context_json = ?, delay_min = ? WHERE id = ?', [
      JSON.stringify(current),
      delayMin,
      sessionId,
    ]);
  } else {
    await db.runAsync('UPDATE sessions SET context_json = ? WHERE id = ?', [
      JSON.stringify(current),
      sessionId,
    ]);
  }
}

function safeContext(raw: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed))
      return parsed as Record<string, unknown>;
  } catch {
    // uszkodzony wpis nadpisujemy świeżą wersją
  }
  return {};
}

export async function getSessionRow(sessionId: string): Promise<SessionRow | null> {
  return rowBySession(sessionId);
}

async function rowBySession(sessionId: string): Promise<SessionRow | null> {
  const db = await openContributorDb();
  const row = await db.getFirstAsync<OHraw>('SELECT * FROM sessions WHERE id = ?', [sessionId]);
  return row ? mapSession(row) : null;
}

type OHraw = {
  id: string;
  device_id: string;
  started_at: number;
  ended_at: number | null;
  source: string;
  city: string;
  line: string;
  route_id: string;
  trip_id: string;
  headsign: string;
  from_title: string;
  to_title: string;
  delay_min: number | null;
  context_json: string;
  samples: number;
  uploaded: number;
  origin: string;
};

function mapSession(r: OHraw): SessionRow {
  return {
    id: r.id,
    deviceId: r.device_id,
    startedAt: r.started_at,
    endedAt: r.ended_at,
    source: (r.source as SessionSource) ?? 'manual',
    city: r.city,
    line: r.line,
    routeId: r.route_id,
    tripId: r.trip_id,
    headsign: r.headsign,
    fromTitle: r.from_title,
    toTitle: r.to_title,
    delayMin: r.delay_min,
    contextJson: r.context_json,
    samples: r.samples,
    uploaded: r.uploaded,
    origin: r.origin,
  };
}

/** Niewysłane, dokończone sesje, od nowszych do starszych. */
export async function listPendingSessions(limit = 50): Promise<SessionRow[]> {
  const db = await openContributorDb();
  const rows = await db.getAllAsync<OHraw>(
    'SELECT * FROM sessions WHERE ended_at IS NOT NULL AND uploaded = 0 ORDER BY started_at DESC LIMIT ?',
    [limit],
  );
  return rows.map(mapSession);
}

/** JSONL sesji: pierwsza linia to manifest, dalej próbki po `tms`. */
export async function sessionJsonl(sessionId: string): Promise<string> {
  const db = await openContributorDb();
  const row = await db.getFirstAsync<OHraw>('SELECT * FROM sessions WHERE id = ?', [sessionId]);
  if (!row) return '';
  const meta = mapSession(row);
  const lines: string[] = [
    JSON.stringify({
      kind: 'session',
      schema: 1,
      id: meta.id,
      deviceId: meta.deviceId,
      startedAt: meta.startedAt,
      endedAt: meta.endedAt,
      source: meta.source,
      origin: meta.origin,
      city: meta.city,
      line: meta.line,
      routeId: meta.routeId,
      tripId: meta.tripId,
      headsign: meta.headsign,
      fromTitle: meta.fromTitle,
      toTitle: meta.toTitle,
      delayMin: meta.delayMin,
      context: safeContext(meta.contextJson),
    }),
  ];
  const samples = await db.getAllAsync<RowSampleRaw>(
    `SELECT * FROM samples WHERE session_id = ? ORDER BY tms ASC`,
    [sessionId],
  );
  for (const s of samples) lines.push(sampleJsonLine(s));
  return `${lines.join('\n')}\n`;
}

type RowSampleRaw = {
  tms: number;
  lat: number | null;
  lng: number | null;
  alt: number | null;
  hacc: number | null;
  spd: number | null;
  brg: number | null;
  a_min: number;
  a_max: number;
  a_avg: number;
  a_std: number;
  x_avg: number;
  y_avg: number;
  z_avg: number;
  moved: number;
};

/** Jedna linia JSONL zgodna z pierwszą linią manifestu sesji. */
function sampleJsonLine(s: RowSampleRaw): string {
  return JSON.stringify({
    t: s.tms,
    lat: s.lat,
    lng: s.lng,
    alt: s.alt,
    hacc: s.hacc,
    spd: s.spd,
    brg: s.brg,
    a: [s.a_min, s.a_max, s.a_avg, s.a_std],
    xyz: [s.x_avg, s.y_avg, s.z_avg],
    moved: s.moved === 1,
  });
}

export async function markUploaded(sessionIds: string[]): Promise<void> {
  if (sessionIds.length === 0) return;
  const db = await openContributorDb();
  await db.runAsync(
    `UPDATE sessions SET uploaded = 1 WHERE id IN (${sessionIds.map(() => '?').join(',')})`,
    sessionIds,
  );
}

export async function stats(): Promise<StatsResult> {
  const db = await openContributorDb();
  const row = await db.getFirstAsync<{ sessions: number; samples: number; uploaded: number }>(
    `SELECT
       (SELECT COUNT(*) FROM sessions) AS sessions,
       (SELECT COALESCE(SUM(samples), 0) FROM sessions) AS samples,
       (SELECT COALESCE(SUM(samples), 0) FROM sessions WHERE uploaded = 1) AS uploaded`,
  );
  return { sessions: row?.sessions ?? 0, samples: row?.samples ?? 0, uploaded: row?.uploaded ?? 0 };
}

export async function clearAll(): Promise<void> {
  const db = await openContributorDb();
  await db.runAsync('DELETE FROM samples');
  await db.runAsync('DELETE FROM sessions');
}

/** Twarde limity z planu: starsze niż RETENTION_DAYS sesje wylatują z próbek. */
export async function sweepRetention(): Promise<number> {
  const db = await openContributorDb();
  const cutoff = Date.now() - RETENTION_DAYS * 86_400_000;
  const expired = await db.getAllAsync<{ id: string }>(
    'SELECT id FROM sessions WHERE started_at < ?',
    [cutoff],
  );
  if (expired.length === 0) return 0;
  const ids = expired.map((r) => r.id);
  await db.runAsync(
    `DELETE FROM samples WHERE session_id IN (${ids.map(() => '?').join(',')})`,
    ids,
  );
  await db.runAsync(`DELETE FROM sessions WHERE id IN (${ids.map(() => '?').join(',')})`, ids);
  return ids.length;
}
