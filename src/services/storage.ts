// Centralny key-value store aplikacji.
//
// Historia:
// 1. @react-native-async-storage/async-storage crashował natywnie na starcie
//    (FATAL EXCEPTION: SQLiteCantOpenDatabaseException na GrapheneOS).
// 2. expo-sqlite/kv-store crashował w release buildach z
//    ERR_USING_RELEASED_SHARED_OBJECT (NativeDatabase.prepareAsync rejectuje,
//    bo natywny shared object jest przedwcześnie zwalniany — znany bug
//    expo-sqlite ≤57.0.3 na niektórych urządzeniach/Androidach).
//
// Zamiennik: prosty, bezpieczny KV oparty na expo-file-system/legacy + in-memory cache.
// - Zero natywnych shared objects, zero ryzyka wycieku / zwolnienia uchwytu SQLite.
// - Pamięć podręczna w RAM (memCache) daje natychmiastowe kolejne odczyty (< 1 ms).
// - Pliki trzymane w documentDirectory/.kv/ (lub fallback cacheDirectory).

import * as FileSystem from 'expo-file-system/legacy';

const memCache = new Map<string, string>();
let dirReady = false;

function getKvDir(): string | null {
  const base = FileSystem.documentDirectory ?? FileSystem.cacheDirectory;
  if (!base) return null;
  return base.endsWith('/') ? `${base}.kv/` : `${base}/.kv/`;
}

async function ensureDir(): Promise<string | null> {
  const dir = getKvDir();
  if (!dir) return null;
  if (dirReady) return dir;
  try {
    const info = await FileSystem.getInfoAsync(dir);
    if (!info.exists) {
      await FileSystem.makeDirectoryAsync(dir, { intermediates: true });
    }
    dirReady = true;
    return dir;
  } catch {
    try {
      await FileSystem.makeDirectoryAsync(dir, { intermediates: true });
      dirReady = true;
      return dir;
    } catch {
      return dir;
    }
  }
}

/** Bezpieczna nazwa pliku z klucza (zastąp nielegalne znaki). */
function keyToFile(dir: string, key: string): string {
  return `${dir}${encodeURIComponent(key)}`;
}

export async function kvGet(key: string): Promise<string | null> {
  if (memCache.has(key)) {
    return memCache.get(key) ?? null;
  }
  try {
    const dir = await ensureDir();
    if (!dir) return null;
    const path = keyToFile(dir, key);
    const info = await FileSystem.getInfoAsync(path);
    if (!info.exists) return null;
    const val = await FileSystem.readAsStringAsync(path);
    memCache.set(key, val);
    return val;
  } catch (err) {
    console.warn('[Storage] getItem failed:', err);
    return null;
  }
}

export async function kvSet(key: string, value: string): Promise<void> {
  memCache.set(key, value);
  try {
    const dir = await ensureDir();
    if (!dir) return;
    await FileSystem.writeAsStringAsync(keyToFile(dir, key), value);
  } catch (err) {
    console.warn('[Storage] setItem failed:', err);
  }
}

export async function kvRemove(key: string): Promise<void> {
  memCache.delete(key);
  try {
    const dir = await ensureDir();
    if (!dir) return;
    const path = keyToFile(dir, key);
    const info = await FileSystem.getInfoAsync(path);
    if (info.exists) {
      await FileSystem.deleteAsync(path, { idempotent: true });
    }
  } catch (err) {
    console.warn('[Storage] removeItem failed:', err);
  }
}
