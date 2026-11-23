// Magazyn plików binarnych (bilety PDF i kody Aztec) w IndexedDB na webie.
// Pozwala przechowywać pliki do 10 MB offline bez limitu 5 MB localStorage.

import { uint8ArrayToBase64 } from './ticketParser';

const DB_NAME = 'kilometr-web-files';
const STORE_NAME = 'files';
const WEB_URI_PREFIX = 'idb://';

interface StoredWebFile {
  id: string;
  mimeType: string;
  bytes: Uint8Array;
}

let dbPromise: Promise<IDBDatabase> | null = null;

function openFileDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB unavailable'));
      return;
    }
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB open failed'));
  });
  dbPromise.catch(() => {
    dbPromise = null;
  });
  return dbPromise;
}

/** Zamienia klucz pliku na wewnętrzne URI webowe. */
function webFileUri(id: string): string {
  return id.startsWith(WEB_URI_PREFIX) ? id : `${WEB_URI_PREFIX}${id}`;
}

/** Wyciąga klucz pliku z wewnętrznego URI webowego. */
export function isWebFileUri(uri?: string | null): boolean {
  return typeof uri === 'string' && uri.startsWith(WEB_URI_PREFIX);
}

function normalizeId(idOrUri: string): string {
  return idOrUri.startsWith(WEB_URI_PREFIX) ? idOrUri.slice(WEB_URI_PREFIX.length) : idOrUri;
}

/** Zapisuje binarny plik w IndexedDB. */
export async function webFilePut(idOrUri: string, bytes: Uint8Array, mimeType: string): Promise<string> {
  const id = normalizeId(idOrUri);
  const db = await openFileDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).put({ id, mimeType, bytes } satisfies StoredWebFile);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('IndexedDB put failed'));
  });
  return webFileUri(id);
}

/** Odczytuje binarny plik z IndexedDB. */
async function webFileGet(idOrUri: string): Promise<{ bytes: Uint8Array; mimeType: string } | null> {
  const id = normalizeId(idOrUri);
  try {
    const db = await openFileDb();
    return await new Promise<{ bytes: Uint8Array; mimeType: string } | null>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const req = tx.objectStore(STORE_NAME).get(id);
      req.onsuccess = () => {
        const res = req.result as StoredWebFile | undefined;
        if (!res) resolve(null);
        else resolve({ bytes: res.bytes, mimeType: res.mimeType });
      };
      req.onerror = () => reject(req.error ?? new Error('IndexedDB get failed'));
    });
  } catch {
    return null;
  }
}

/** Sprawdza, czy plik istnieje w IndexedDB. */
export async function webFileExists(idOrUri: string): Promise<boolean> {
  const entry = await webFileGet(idOrUri);
  return entry != null;
}

/** Usuwa plik z IndexedDB. */
export async function webFileDelete(idOrUri: string): Promise<void> {
  const id = normalizeId(idOrUri);
  try {
    const db = await openFileDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error('IndexedDB delete failed'));
    });
  } catch {
    // best-effort
  }
}

/** Koduje plik z IndexedDB jako data URL (np. do Image na webie). */
export async function webFileToDataUrl(idOrUri: string): Promise<string | null> {
  const entry = await webFileGet(idOrUri);
  if (!entry) return null;
  const b64 = uint8ArrayToBase64(entry.bytes);
  return `data:${entry.mimeType};base64,${b64}`;
}

/** Otwiera zapisany plik (np. PDF biletu) w nowej karcie przeglądarki. */
export async function webFileOpenInTab(idOrUri: string): Promise<boolean> {
  if (typeof window === 'undefined') return false;
  const entry = await webFileGet(idOrUri);
  if (!entry) return false;
  const blob = new Blob([entry.bytes as BlobPart], { type: entry.mimeType });
  const url = URL.createObjectURL(blob);
  const win = window.open(url, '_blank', 'noopener,noreferrer');
  if (!win) {
    const a = document.createElement('a');
    a.href = url;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    a.click();
  }
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
  return true;
}
