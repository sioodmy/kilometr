// Eksport telemetrii do ZIP: manifest.json + jeden *.jsonl na sesję.
//
// Zapis binarny (zipSync -> Base64 -> legacy FileSystem): `atob`/`btoa` są
// dostępne w runtime aplikacji (użyte też w gtfsDownloader). Katalog
// documentDirectory/kilometr-contributor/, nie cache: tester wygenerował
// archiwum świadomie i ma je znaleźć nawet za tydzień. Stare archiwa
// sprzątamy, żeby eksport nie piętrzył się bez końca.

import * as FileSystem from 'expo-file-system/legacy';
import { zipSync } from 'fflate';
import { listCompletedSessions, sessionJsonl } from './store';
import { getContributorDeviceId } from './config';

const KEEP_EXPORTS = 3;
/**
 * Jedna sesja to kilkusetkrotnej sekundy ~120 B, ale ZIP trzymamy cały
 * w pamięci (strToU8/BtoA bez plików pośrednich). Limit chroni od miesięcy
 * danych, które robiłyby setki MB w jednym bloku alokacji.
 */
const MAX_SESSIONS_PER_ZIP = 200;

const EXPORT_DIR = `${FileSystem.documentDirectory ?? ''}kilometr-contributor/`;

export interface ContributorExportResult {
  path: string;
  sessions: number;
}

function exportFileName(now: Date): string {
  const pad = (n: number) => `${n}`.padStart(2, '0');
  return `kilometr-contributor-${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}.zip`;
}

/** Uint8Array -> base64 bez rozrzutnych tablic znakowych (duże ZIP-y). */
function u8ToBase64(bytes: Uint8Array): string {
  let bin = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(bin);
}

/** Wiersze ZIP-a: manifest plus po jednym JSONL na sesję (bez pustych plików). */
async function collectExportEntries(): Promise<{
  entries: Record<string, Uint8Array>;
  usedSessions: string[];
}> {
  const completed = await listCompletedSessions(MAX_SESSIONS_PER_ZIP);
  const entries: Record<string, Uint8Array> = {};
  const usedSessions: string[] = [];
  for (const session of completed) {
    const jsonl = await sessionJsonl(session.id);
    if (!jsonl) continue;
    entries[`${session.id}.jsonl`] = new TextEncoder().encode(jsonl);
    usedSessions.push(session.id);
  }
  return { entries, usedSessions };
}

export async function writeContributorZip(appVersion: string): Promise<ContributorExportResult> {
  const { entries, usedSessions } = await collectExportEntries();
  if (usedSessions.length === 0) {
    throw new Error('brak danych');
  }
  entries['manifest.json'] = new TextEncoder().encode(
    JSON.stringify({
      kind: 'kilometr-contributor',
      schema: 1,
      exportedAt: Date.now(),
      appVersion,
      deviceId: await getContributorDeviceId(),
      sessions: usedSessions.length,
      files: usedSessions.map((id) => `${id}.jsonl`),
    }, null, 2),
  );
  const zip = zipSync(entries, { level: 6 });
  const dir = EXPORT_DIR;
  try {
    await FileSystem.makeDirectoryAsync(dir, { intermediates: true });
  } catch {
    // katalog może już istnieć - makeDirectory rzuca wtedy, ignorujemy
  }
  const path = `${dir}${exportFileName(new Date())}`;
  await FileSystem.writeAsStringAsync(path, u8ToBase64(zip), {
    encoding: FileSystem.EncodingType.Base64,
  });
  await pruneOldExports(dir);
  return { path, sessions: usedSessions.length };
}

/** Zostawia KEEP_EXPORTS najnowszych archiwów, resztę kasuje. */
async function pruneOldExports(dir: string): Promise<void> {
  try {
    const names = (await FileSystem.readDirectoryAsync(dir))
      .filter((n) => n.endsWith('.zip'))
      .sort();
    for (const old of names.slice(0, Math.max(0, names.length - KEEP_EXPORTS))) {
      await FileSystem.deleteAsync(`${dir}${old}`, { idempotent: true });
    }
  } catch (err) {
    console.warn('[Contributor] prune exports failed:', err);
  }
}
