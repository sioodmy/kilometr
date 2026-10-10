// Most do natywnego serwera HTTP mapy.
//
// Serwer istnieje z jednego powodu: WebView z `source={{ html }}` dostaje origin
// `null`, więc Service Worker się nie zarejestruje i nie da się podmienić
// kafelków przez Cache API. Jedyne miejsce, z którego MapLibre zobaczy kafle
// z telefonu, to prawdziwy serwer na 127.0.0.1.
//
// Moduł jest opcjonalny: w Expo Go i w buildach bez pakietu kafelków
// `available` jest false, a caller wraca do mapy online.

import { requireOptionalNativeModule } from 'expo-modules-core';

interface MapServerNative {
  hasTilePack(): Promise<boolean>;
  start(): Promise<string>;
  stop(): Promise<void>;
}

const native = requireOptionalNativeModule<MapServerNative>('KilometrMapServer');

export const mapServerAvailable = native != null;

/** Czy pakiet kafelków Wrocławia jest już na telefonie. */
export async function hasTilePack(): Promise<boolean> {
  if (!native) return false;
  try {
    return await native.hasTilePack();
  } catch {
    return false;
  }
}

/**
 * Startuje serwer i zwraca bazowy URL (np. `http://127.0.0.1:45999`),
 * albo null gdy modułu nie ma albo nie ma pakietu. W trybie online caller
 * używa wtedy CDN-ów i nic się nie zmienia.
 */
export async function startMapServer(): Promise<string | null> {
  if (!native) return null;
  try {
    return await native.start();
  } catch {
    return null;
  }
}

export async function stopMapServer(): Promise<void> {
  if (!native) return;
  try {
    await native.stop();
  } catch {
    // Serwer i tak ginie razem z procesem aplikacji.
  }
}