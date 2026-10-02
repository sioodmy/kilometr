// Jednorazowa migracja danych z expo-sqlite/kv-store → nowy KV (file-system).
//
// Stary backend (expo-sqlite/kv-store) trzymał dane w bazie SQLite
// "ExpoSQLiteStorage" z tabelą `storage(key, value)`. Nowy backend pisze
// po jednym pliku na klucz w documentDirectory/.kv/.
//
// Migracja czyta starą bazę raz i kopiuje klucze do nowego backendu.
// Jeśli stara baza nie istnieje (fresh install) lub expo-sqlite znów padnie —
// po prostu pomijamy. Flagę migracji trzymamy w samym nowym KV.
//
// Wywoływać RAZ w _layout przed initApp().

import * as FileSystem from 'expo-file-system/legacy';
import { kvGet, kvSet } from './storage';

const MIGRATED_FLAG = '__kv_migrated_from_sqlite';

async function performMigration(): Promise<void> {
  // Czy już zmigrowano?
  const flag = await kvGet(MIGRATED_FLAG);
  if (flag === '1') return;

  const docDir = FileSystem.documentDirectory;
  if (!docDir) {
    await kvSet(MIGRATED_FLAG, '1');
    return;
  }

  const base = docDir.endsWith('/') ? docDir : `${docDir}/`;
  const dbPath = `${base}SQLite/ExpoSQLiteStorage`;
  const info = await FileSystem.getInfoAsync(dbPath);
  if (!info.exists) {
    // Fresh install — nie ma co migrować
    await kvSet(MIGRATED_FLAG, '1');
    return;
  }

  // Próba odczytu starej bazy SQLite
  const { openDatabaseAsync } = await import('expo-sqlite');

  // Otwieramy starą bazę z useNewConnection: true, żeby uniknąć konfliktu
  // z ewentualnym singletonem.
  const db = await openDatabaseAsync('ExpoSQLiteStorage', { useNewConnection: true });

  try {
    const rows = await db.getAllAsync<{ key: string; value: string }>(
      'SELECT key, value FROM storage'
    );
    for (const row of rows) {
      if (!row || typeof row.key !== 'string' || row.value == null) continue;
      const existing = await kvGet(row.key);
      if (existing === null) {
        await kvSet(row.key, row.value);
      }
    }
  } finally {
    try {
      await db.closeAsync();
    } catch {}
  }

  await kvSet(MIGRATED_FLAG, '1');
}

export async function migrateFromSqliteKv(): Promise<void> {
  try {
    // Limit czasowy 1.5s — migracja nigdy nie może zablokować startu apki
    const timeout = new Promise<void>((_, reject) =>
      setTimeout(() => reject(new Error('kvMigration timeout')), 1500)
    );
    await Promise.race([performMigration(), timeout]);
  } catch (err) {
    console.warn('[kvMigration] migration skipped or failed:', err);
    try {
      await kvSet(MIGRATED_FLAG, '1');
    } catch {}
  }
}
