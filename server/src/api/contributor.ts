import fs from 'node:fs';
import path from 'node:path';
import express, { Router, type Request, type Response } from 'express';
import { config } from '../config';
import { getDb } from '../db';

// Telemetria Contributor: testerzy wysyłają sesje GPS + akcelerometru ze
// buildów dev/nightly. Serwer jest prosty: przyjmuje JSON, waliduje id i
// rozmiar, zapisuje surowy JSONL na dysku (do analiz), a opis sesji trafia
// do SQLite (do szybkiego podglądu). Dane są pseudonimizowane (stały
// deviceId), a wysyła je testujący świadomie z karty w Ustawieniach.

const contributorRouter = Router();

const DATA_DIR = path.join(config.dataDir, 'contributor');

/** id/deviceId stają się częścią ścieżki pliku - walidujemy całość. */
const SAFE_ID = /^[A-Za-z0-9._-]{1,80}$/;
const MAX_SESSIONS_PER_UPLOAD = 200;
const MAX_SAMPLES_PER_SESSION = 200_000;
const MAX_SESSION_BYTES = 50_000_000;

/** Limit uploadów w pamięci procesu: deviceId na godzinę. Restart serwera
 * czyści liczniki - dla telemetrii testowej to akceptowalne. */
const MAX_UPLOADS_PER_HOUR = 30;
const uploadsByDevice = new Map<string, number[]>();

interface UploadManifest {
  kind?: string;
  schema?: number;
  deviceId?: string;
  sessions?: unknown;
}

/** Envelope od aplikacji: data[id] = cały JSONL (header + próbki). */
interface UploadEnvelope {
  manifest?: UploadManifest;
  data?: Record<string, unknown>;
}

interface SessionHeader {
  kind?: string;
  schema?: number;
  id?: string;
  startedAt?: number;
  endedAt?: number | null;
  city?: string;
  line?: string;
  tripId?: string;
}

function isSafeId(value: unknown): value is string {
  return typeof value === 'string' && SAFE_ID.test(value);
}

function allowUpload(deviceId: string): boolean {
  const now = Date.now();
  const recent = (uploadsByDevice.get(deviceId) ?? []).filter((t) => now - t < 60 * 60 * 1000);
  if (recent.length >= MAX_UPLOADS_PER_HOUR) return false;
  recent.push(now);
  uploadsByDevice.set(deviceId, recent);
  return true;
}

/** Zapisuje plik sesji (header + próbki). Zwraca liczbę próbek. */
function writeSessionFile(deviceId: string, sessionId: string, lines: string[]): number {
  const dir = path.join(DATA_DIR, deviceId);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${sessionId}.jsonl`), `${lines.join('\n')}\n`, 'utf8');
  return lines.length - 1;
}

function recordSession(
  deviceId: string,
  sessionId: string,
  header: SessionHeader,
  samples: number,
): void {
  try {
    getDb()
      .prepare(
        `INSERT OR REPLACE INTO contributor_sessions
           (id, device_id, city, line, trip_id, samples, started_at, ended_at, received_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        sessionId,
        deviceId,
        typeof header.city === 'string' ? header.city : '',
        typeof header.line === 'string' ? header.line : '',
        typeof header.tripId === 'string' ? header.tripId : '',
        samples,
        typeof header.startedAt === 'number' ? header.startedAt : 0,
        typeof header.endedAt === 'number' ? header.endedAt : 0,
        Date.now(),
      );
  } catch (err) {
    // bez wiersza w bazie sesja nadal istnieje jako plik; tracą tylko statystyki
    console.warn('[Contributor] db record failed:', err);
  }
}

contributorRouter.post('/upload', express.json({ limit: '30mb' }), (req: Request, res: Response) => {
  const body = req.body as UploadEnvelope | undefined;
  const manifest = body?.manifest;
  const data = body?.data;
  if (typeof manifest !== 'object' || manifest === null || typeof data !== 'object' || data === null) {
    res.status(400).json({ error: 'unsupported envelope' });
    return;
  }
  if (manifest.kind !== 'kilometr-contributor' || manifest.schema !== 1) {
    res.status(400).json({ error: 'unsupported manifest' });
    return;
  }
  const deviceId = manifest.deviceId;
  if (!isSafeId(deviceId)) {
    res.status(400).json({ error: 'invalid deviceId' });
    return;
  }
  if (!allowUpload(deviceId)) {
    res.status(429).json({ error: 'too many uploads' });
    return;
  }

  const requested = Array.isArray(manifest.sessions)
    ? manifest.sessions.filter(isSafeId).slice(0, MAX_SESSIONS_PER_UPLOAD)
    : [];
  const accepted: string[] = [];

  for (const sessionId of requested) {
    const raw = (data as Record<string, unknown>)[sessionId];
    if (typeof raw !== 'string' || raw.length === 0 || raw.length > MAX_SESSION_BYTES) continue;

    const lines = raw.split('\n').map((line) => line.trim()).filter(Boolean);
    if (lines.length < 2 || lines.length - 1 > MAX_SAMPLES_PER_SESSION) continue;

    try {
      const header = JSON.parse(lines[0]) as SessionHeader;
      if (header.kind !== 'session' || header.schema !== 1 || header.id !== sessionId) continue;
      const samples = writeSessionFile(deviceId, sessionId, lines);
      recordSession(deviceId, sessionId, header, samples);
      accepted.push(sessionId);
    } catch {
      // uszkodzony nagłówek dyskwalifikuje sesję; reszta paczki przechodzi dalej
    }
  }

  res.json({ ok: true, accepted });
});

export { contributorRouter };
