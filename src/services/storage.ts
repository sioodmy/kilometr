// Centralny key-value store aplikacji.
//
// Historia:
// 1. @react-native-async-storage/async-storage crashował natywnie na starcie
//    (FATAL EXCEPTION: SQLiteCantOpenDatabaseException na GrapheneOS).
// 2. expo-sqlite/kv-store crashował w release buildach z
//    ERR_USING_RELEASED_SHARED_OBJECT (NativeDatabase.prepareAsync rejectuje,
//    bo natywny shared object jest przedwcześnie zwalniany - znany bug
//    expo-sqlite ≤57.0.3 na niektórych urządzeniach/Androidach).
//
// Zamiennik: prosty, bezpieczny KV oparty na expo-file-system/legacy + in-memory cache.
// - Zero natywnych shared objects, zero ryzyka wycieku / zwolnienia uchwytu SQLite.
// - Pamięć podręczna w RAM (memCache) daje natychmiastowe kolejne odczyty (< 1 ms).
// - Pliki trzymane w documentDirectory/.kv/ (lub fallback cacheDirectory).

import * as FileSystem from 'expo-file-system/legacy';
import { Platform } from 'react-native';

const IS_WEB = Platform.OS === 'web';
const WEB_KV_DB = 'kilometr-web-kv';
const WEB_KV_STORE = 'kv';
const memCache = new Map<string, string>();
const pending = new Map<string, Promise<void>>();
let dirReady = false;
let webKvDbPromise: Promise<IDBDatabase> | null = null;

function openWebKvDb(): Promise<IDBDatabase> {
  if (webKvDbPromise) return webKvDbPromise;
  webKvDbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB unavailable'));
      return;
    }
    const req = indexedDB.open(WEB_KV_DB, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(WEB_KV_STORE)) {
        db.createObjectStore(WEB_KV_STORE);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB open failed'));
  });
  webKvDbPromise.catch(() => {
    webKvDbPromise = null;
  });
  return webKvDbPromise;
}

async function webKvGet(key: string): Promise<string | null> {
  if (typeof indexedDB === 'undefined') return null;
  const db = await openWebKvDb();
  return new Promise<string | null>((resolve, reject) => {
    const tx = db.transaction(WEB_KV_STORE, 'readonly');
    const req = tx.objectStore(WEB_KV_STORE).get(key);
    req.onsuccess = () => resolve(typeof req.result === 'string' ? req.result : null);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB get failed'));
  });
}

async function webKvSet(key: string, value: string): Promise<void> {
  if (typeof indexedDB === 'undefined') return;
  const db = await openWebKvDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(WEB_KV_STORE, 'readwrite');
    tx.objectStore(WEB_KV_STORE).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('IndexedDB put failed'));
  });
}

async function webKvDelete(key: string): Promise<void> {
  if (typeof indexedDB === 'undefined') return;
  const db = await openWebKvDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(WEB_KV_STORE, 'readwrite');
    tx.objectStore(WEB_KV_STORE).delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('IndexedDB delete failed'));
  });
}

function serialize<T>(key: string, operation: () => Promise<T>): Promise<T> {
  const result = (pending.get(key) ?? Promise.resolve()).then(operation);
  const settled = result.then(
    () => undefined,
    () => undefined,
  );
  pending.set(key, settled);
  void settled.then(() => {
    if (pending.get(key) === settled) pending.delete(key);
  });
  return result;
}

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

/** Bezpieczna nazwa pliku z klucza (zastąp nielegalne znaki i zapobiegaj ENAMETOOLONG). */
function keyToFile(dir: string, key: string): string {
  const encoded = encodeURIComponent(key);
  if (encoded.length <= 150) {
    return `${dir}${encoded}`;
  }
  // Długie klucze (np. ID połączeń w biletach kolejowych) przekraczają limit
  // 255 bajtów nazwy pliku na ext4/f2fs/APFS, powodując ENAMETOOLONG i cichy brak zapisu na dysk.
  const prefix = encoded.slice(0, 40);
  let h1 = 0xdeadbeef;
  let h2 = 0x41c64e6d;
  for (let i = 0; i < key.length; i++) {
    const ch = key.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  const hash = `${(h1 >>> 0).toString(16).padStart(8, '0')}${(h2 >>> 0).toString(16).padStart(8, '0')}`;
  return `${dir}${prefix}_h_${hash}`;
}

export async function kvGet(key: string): Promise<string | null> {
  try {
    return await kvGetStrict(key);
  } catch (err) {
    console.warn('[Storage] getItem failed:', err);
    return null;
  }
}

/**
 * Jak kvGet, ale błąd odczytu rzuca zamiast zwracać null. Do read-modify-write
 * (np. lista miejsc): pusta lista po błędzie nie może nadpisać prawdziwych danych.
 * Brak klucza nadal zwraca null.
 */
export async function kvGetStrict(key: string): Promise<string | null> {
  return serialize(key, () => readValue(key));
}

async function readValue(key: string): Promise<string | null> {
  if (memCache.has(key)) {
    return memCache.get(key) ?? null;
  }
  if (IS_WEB) {
    const val = await webKvGet(key);
    if (val !== null) memCache.set(key, val);
    return val;
  }
  const dir = await ensureDir();
  if (!dir) throw new Error('kv storage directory unavailable');
  const path = keyToFile(dir, key);
  const info = await FileSystem.getInfoAsync(path);
  if (!info.exists) return null;
  const val = await FileSystem.readAsStringAsync(path);
  memCache.set(key, val);
  return val;
}

export async function kvSet(key: string, value: string): Promise<void> {
  try {
    await kvSetStrict(key, value);
  } catch (err) {
    console.warn('[Storage] setItem failed:', err);
  }
}

export async function kvSetStrict(key: string, value: string): Promise<void> {
  return serialize(key, () => writeValue(key, value));
}

async function writeValue(key: string, value: string): Promise<void> {
  if (IS_WEB) {
    await webKvSet(key, value);
    memCache.set(key, value);
    return;
  }
  const dir = await ensureDir();
  if (!dir) throw new Error('kv storage directory unavailable');
  const path = keyToFile(dir, key);
  // Zapis atomowy: najpierw plik tymczasowy, potem podmiana. Przerwany
  // zapis nie zostawi wtedy uciętego JSON-a, który kasowałby całą listę.
  const tmp = `${path}.tmp`;
  await FileSystem.writeAsStringAsync(tmp, value);
  await FileSystem.moveAsync({ from: tmp, to: path });
  memCache.set(key, value);
}

export async function kvRemove(key: string): Promise<void> {
  return serialize(key, () => removeValue(key));
}

async function removeValue(key: string): Promise<void> {
  try {
    if (IS_WEB) {
      await webKvDelete(key);
      memCache.delete(key);
      return;
    }
    const dir = await ensureDir();
    if (!dir) return;
    const path = keyToFile(dir, key);
    const info = await FileSystem.getInfoAsync(path);
    if (info.exists) {
      await FileSystem.deleteAsync(path, { idempotent: true });
    }
    memCache.delete(key);
  } catch (err) {
    console.warn('[Storage] removeItem failed:', err);
  }
}
