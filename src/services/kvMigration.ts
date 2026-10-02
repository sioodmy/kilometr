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

export async function migrateFromSqliteKv(): Promise<void> {
  try {
    // Czy już zmigrowano?
    const flag = await kvGet(MIGRATED_FLAG);
    if (flag === '1') return;

    // Próba odczytu starej bazy SQLite
    const { openDatabaseAsync } = await import('expo-sqlite');

    // Sprawdź czy plik bazy w ogóle istnieje
    const dbPath = `${FileSystem.documentDirectory}SQLite/ExpoSQLiteStorage`;
    const info = await FileSystem.getInfoAsync(dbPath);
    if (!info.exists) {
      // Fresh install — nie ma co migrować
      await kvSet(MIGRATED_FLAG, '1');
      return;
    }

    // Otwieramy starą bazę z useNewConnection: true, żeby uniknąć konfliktu
    // z singletonem expo-sqlite/kv-store (który może trzymać zamkniętą instancję).
    const db = await openDatabaseAsync('ExpoSQLiteStorage', { useNewConnection: true });

    try {
      const rows = await db.getAllAsync<{ key: string; value: string }>(
        'SELECT key, value FROM storage'
      );
      for (const row of rows) {
        // Nie nadpisuj, jeśli nowy KV już ma wartość (np. użytkownik zdążył
        // coś zapisać po upgrade).
        const existing = await kvGet(row.key);
        if (existing === null && row.value != null) {
          await kvSet(row.key, row.value);
        }
      }
    } finally {
      await db.closeAsync();
    }

    await kvSet(MIGRATED_FLAG, '1');
  } catch (err) {
    // Migracja jest best-effort — jeśli expo-sqlite padnie (co jest powodem
    // tej migracji!), po prostu kontynuujemy. Użytkownik zobaczy onboarding
    // jeszcze raz, a reszta to cache/ustawienia wrócą do defaultów.
    console.warn('[kvMigration] migration failed (expected on broken sqlite):', err);

    // Oznaczamy jako zmigrowane, żeby nie próbować ponownie przy każdym starcie.
    try {
      await kvSet(MIGRATED_FLAG, '1');
    } catch {
      // zapis flagi też padł — trudno, spróbujemy znów następnym razem
    }
  }
}
