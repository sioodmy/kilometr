// Stan i sync ogólnopolskiej bazy kolejowej (dataset `polska`).
// Pobierana LAZY: dopiero gdy użytkownik planuje podróż między miastami
// albo włącza ją w ustawieniach. Rozkład miasta i tak działa bez niej.
//
// To nie jest "miejski" cyklus dataManagera: osobne bramki podmiany pliku
// (gtfsDatabase), osobne meta (w samej bazie polska) i osobny limit
// pobierań, żeby nie blokował odświeżania rozkładu miasta.

import {
  getNationalMeta,
  getNationalTimetableEndDate,
  hasNationalDb,
  setNationalMeta,
} from './gtfsDatabase';
import { downloadNationalDb, fetchNationalManifest, getNationalTimetableVersion } from './timetableSync';

/** Minimalny odstęp między sprawdzeniami manifestu kolejowego. */
const CHECK_INTERVAL_MS = 12 * 3600 * 1000;

export type NationalTimetableState =
  | { phase: 'idle' }
  | { phase: 'checking' }
  | { phase: 'downloading'; progress: number }
  | { phase: 'ready'; version: string | null; endDate: string | null }
  | { phase: 'error' };

let state: NationalTimetableState = { phase: 'idle' };
const listeners = new Set<(state: NationalTimetableState) => void>();

function setState(next: NationalTimetableState): void {
  state = next;
  for (const l of listeners) {
    try {
      l(state);
    } catch {
      // słuchacz nie może wywrócić syncu
    }
  }
}

export function getNationalTimetableState(): NationalTimetableState {
  return state;
}

export function subscribeNationalTimetable(listener: (state: NationalTimetableState) => void): () => void {
  listeners.add(listener);
  listener(state);
  return () => {
    listeners.delete(listener);
  };
}

let inFlight: Promise<NationalTimetableState> | null = null;

async function lastCheckAt(): Promise<number> {
  const raw = await getNationalMeta('plk_last_check').catch(() => null);
  const n = raw ? Number(raw) : 0;
  return Number.isFinite(n) ? n : 0;
}

/**
 * Utrzymuje bazę kolejową: sprawdza manifest i pobiera nowszą wersję.
 * Idempotentne i zserializowane (wspólny promise); nie rzuca - stan
 * błędy oddaje przez fazę 'error'.
 */
export function ensureNationalTimetable(force = false): Promise<NationalTimetableState> {
  if (inFlight) return inFlight;
  inFlight = (async () => {
    try {
      const present = await hasNationalDb();
      if (!present && !force) {
        // Bez bazy nie pobieramy sami z siebie: pobiera UI na żądanie
        // (karta w wynikach / ustawienia), żeby nie zaskakiwać transferem.
        setState({ phase: 'idle' });
        return state;
      }
      const last = await lastCheckAt();
      if (!force && Date.now() - last < CHECK_INTERVAL_MS) {
        const version = await getNationalTimetableVersion();
        const endDate = await getNationalTimetableEndDate().catch(() => null);
        setState({ phase: 'ready', version, endDate });
        return state;
      }

      setState({ phase: 'checking' });
      const manifest = await fetchNationalManifest();
      await setNationalMeta('plk_last_check', String(Date.now())).catch(() => {});
      const local = await getNationalTimetableVersion();
      if (local && local === manifest.version) {
        const endDate = await getNationalTimetableEndDate().catch(() => null);
        setState({ phase: 'ready', version: local, endDate });
        return state;
      }

      setState({ phase: 'downloading', progress: 0 });
      await downloadNationalDb(manifest, (written, total) => {
        setState({ phase: 'downloading', progress: total > 0 ? written / total : 0 });
      });
      const version = await getNationalTimetableVersion();
      const endDate = await getNationalTimetableEndDate().catch(() => null);
      setState({ phase: 'ready', version, endDate });
      return state;
    } catch (err) {
      console.warn('[NationalTimetable] sync failed:', err instanceof Error ? err.message : String(err));
      setState({ phase: 'error' });
      return state;
    } finally {
      inFlight = null;
    }
  })();
  return inFlight;
}

/** Pobiera bazę kolejową na żądanie (karta w wynikach / ustawienia). */
export function downloadNationalTimetable(): Promise<NationalTimetableState> {
  return ensureNationalTimetable(true);
}

/** Rozmiar do pobrania z manifestu (do tekstu "ok. X MB" na karcie). */
export async function nationalTimetableSizeMb(): Promise<string | null> {
  try {
    const manifest = await fetchNationalManifest();
    const mb = manifest.db.sizeBytes / (1024 * 1024);
    return mb >= 10 ? String(Math.round(mb)) : mb.toFixed(1);
  } catch {
    return null;
  }
}

/** Czy baza kolejowa jest pobrana i niepusta (szybki check). */
export async function nationalTimetableReady(): Promise<boolean> {
  return hasNationalDb();
}

/** Usuwa bazę kolejową (ustawienia): zamyka uchwyt i kasuje plik. */
export async function deleteNationalTimetable(): Promise<void> {
  const gtfs = await import('./gtfsDatabase');
  const FileSystem = await import('expo-file-system/legacy');
  gtfs.beginNationalDbSwap();
  try {
    await gtfs.closeNationalDb();
    const { polskaStore } = await import('./routing/store');
    polskaStore.reset();
    const base = FileSystem.documentDirectory;
    if (base) {
      const dir = `${base.replace(/\/+$/, '')}/SQLite`;
      const main = `${dir}/${gtfs.NATIONAL_DB_FILE}`;
      for (const suffix of ['', '-wal', '-shm', '-journal', '.bak']) {
        try {
          await FileSystem.deleteAsync(`${main}${suffix}`, { idempotent: true });
        } catch {
          // best-effort
        }
      }
    }
    setState({ phase: 'idle' });
  } finally {
    gtfs.endNationalDbSwap();
  }
}
