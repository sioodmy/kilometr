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
// Zamiennik: prosty KV oparty na expo-file-system/legacy — jedno wywołanie
// read/write per operację, zero natywnych obiektów współdzielonych, zero
// bazy danych. Pliki JSON w documentDirectory/.kv/ .
//
// Trade-off: wolniejsze od SQLite przy dziesiątkach kluczy, ale w praktyce
// app czyta/pisze ~15 kluczy i nigdy ich nie iteruje, więc różnica < 1 ms.

import * as FileSystem from 'expo-file-system/legacy';

const KV_DIR = `${FileSystem.documentDirectory}.kv/`;

let dirReady = false;

async function ensureDir(): Promise<void> {
  if (dirReady) return;
  try {
    const info = await FileSystem.getInfoAsync(KV_DIR);
    if (!info.exists) {
      await FileSystem.makeDirectoryAsync(KV_DIR, { intermediates: true });
    }
    dirReady = true;
  } catch {
    // Na wszelki wypadek — jeśli getInfoAsync padnie, próbujemy dalej.
    // makeDirectoryAsync z intermediates:true jest idempotentne.
    try {
      await FileSystem.makeDirectoryAsync(KV_DIR, { intermediates: true });
      dirReady = true;
    } catch {
      // nic — operacja r/w i tak spróbuje, a blad obsłuży caller
    }
  }
}

/** Bezpieczna nazwa pliku z klucza (zastąp nielegalne znaki). */
function keyToFile(key: string): string {
  return KV_DIR + encodeURIComponent(key);
}

export async function kvGet(key: string): Promise<string | null> {
  try {
    await ensureDir();
    const path = keyToFile(key);
    const info = await FileSystem.getInfoAsync(path);
    if (!info.exists) return null;
    return await FileSystem.readAsStringAsync(path);
  } catch (err) {
    console.warn('[Storage] getItem failed:', err);
    return null;
  }
}

export async function kvSet(key: string, value: string): Promise<void> {
  try {
    await ensureDir();
    await FileSystem.writeAsStringAsync(keyToFile(key), value);
  } catch (err) {
    console.warn('[Storage] setItem failed:', err);
  }
}

export async function kvRemove(key: string): Promise<void> {
  try {
    const path = keyToFile(key);
    const info = await FileSystem.getInfoAsync(path);
    if (info.exists) {
      await FileSystem.deleteAsync(path, { idempotent: true });
    }
  } catch (err) {
    console.warn('[Storage] removeItem failed:', err);
  }
}
