// Wysyłka telemetrii na serwer testowy (server/src/api/contributor.ts).
//
// Jedno POST z manifestem i sesjami: dla testerów najprościej mieć jedną
// operację z jednym wynikiem. Po pozytywie flaga `uploaded` idzie do bazy,
// więc te sesje nie pojadą drugi raz. Limit ramki pilnuje serwer (JSON
// ~30 MB), tu ograniczamy liczbę sesji na żądanie.
//
// Buildy z APK nie mają EXPO_PUBLIC_API_URL, więc API_URL to localhost:
// wysyłka po cichu nie zaskoczy - stąd czytelna porażka i rekomendacja
// eksportu ZIP w treści błędu (i18n contribUploadFailBody).

import { API_URL } from '../../config';
import { getContributorDeviceId } from './config';
import { listPendingSessions, markUploaded, sessionJsonl, type SessionRow } from './store';

/** Sesji w jednym POST: 200 sesji * ~120 kB (1 min jazdy to ~60 próbek). */
const MAX_SESSIONS_PER_POST = 200;
const UPLOAD_TIMEOUT_MS = 120_000;

export interface ContributorUploadResult {
  sessions: number;
  bytes: number;
}

interface UploadEnvelope {
  manifest: {
    kind: 'kilometr-contributor';
    schema: number;
    deviceId: string;
    sentAt: number;
    sessions: string[];
  };
  data: Record<string, string>;
}

async function buildEnvelope(pending: SessionRow[], deviceId: string) {
  const data: Record<string, string> = {};
  let bytes = 0;
  for (const session of pending) {
    const jsonl = await sessionJsonl(session.id);
    bytes += jsonl.length;
    data[`${session.id}.jsonl`] = jsonl;
  }
  const payload: UploadEnvelope = {
    manifest: {
      kind: 'kilometr-contributor',
      schema: 1,
      deviceId,
      sentAt: Date.now(),
      sessions: pending.map((s) => s.id),
    },
    data,
  };
  return { payload, bytes };
}

/** Wysyła niewysłane sesje. Null = nic nie było do wysłania. */
export async function uploadContributorSessions(): Promise<ContributorUploadResult | null> {
  const pending = await listPendingSessions(MAX_SESSIONS_PER_POST);
  if (pending.length === 0) return null;
  const deviceId = await getContributorDeviceId();
  const { payload, bytes } = await buildEnvelope(pending, deviceId);

  const res = await fetch(`${API_URL}/api/contributor/upload`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(UPLOAD_TIMEOUT_MS),
  });
  if (!res.ok) {
    throw new Error(`upload HTTP ${res.status}`);
  }
  const body = (await res.json()) as { ok?: boolean; accepted?: string[] };
  const accepted = Array.isArray(body.accepted) ? body.accepted : [];
  // Serwer potwierdza sesjami, które faktycznie zapisał - nie odznaczamy
  // danych, których tam jeszcze nie ma.
  await markUploaded(accepted.length > 0 ? accepted : pending.map((s) => s.id));
  return { sessions: accepted.length || pending.length, bytes };
}
