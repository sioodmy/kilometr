// Aktywne miasto użytkownika. Persist w kv-store, default Wrocław
// (migracja istniejących instalacji bez wyboru).
//
// Zmiana miasta przełącza bazę SQLite i pakiet kafli per-miasto, więc dane
// drugiego miasta zostają nietknięte na dysku.

import { useCallback, useEffect, useState } from 'react';
import { DEFAULT_CITY_ID, getCity, isCityId, type CityDef, type CityId } from '../cities';
import { kvGet, kvSet } from './storage';

const KEY = 'kilometr.activeCity.v1';

let cachedId: CityId = DEFAULT_CITY_ID;
let loaded = false;
const listeners = new Set<(id: CityId) => void>();

function notify(): void {
  for (const l of listeners) {
    try {
      l(cachedId);
    } catch {
      // listener nie może wywalić zmiany miasta
    }
  }
}

export async function loadActiveCity(): Promise<CityId> {
  if (loaded) return cachedId;
  let id: CityId = DEFAULT_CITY_ID;
  try {
    const raw = await kvGet(KEY);
    if (raw && isCityId(raw)) id = raw;
  } catch {
    // storage niedostępny, zostaje default
  }
  loaded = true;
  // Zapisane miasto różni się od domyślnego: pełna zmiana (baza + store),
  // inaczej apk startuje z rozkładem Wrocławia pod hasłem "Kraków".
  // Swap PRZED podmianą `cachedId`: w oknie między jednym a drugim
  // synchroniczni czytelnicy (`getActiveCityIdSync`) nie mogą zobaczyć nowego
  // miasta przy jeszcze starej bazie.
  if (id !== cachedId) {
    await swapStores();
    cachedId = id;
    notify();
    return cachedId;
  }
  notify();
  return cachedId;
}

/** Synchroniczny odczyt do serwisów (po loadActiveCity w _layout). */
export function getActiveCityIdSync(): CityId {
  return cachedId;
}

export function getActiveCitySync(): CityDef {
  return getCity(cachedId);
}

/**
 * Zamiana baz i cache per-miasto. Wołana PRZED zmianą `cachedId` i `notify()`,
 * więc UI nie zobaczy nowego miasta przy starym rozkładzie (wrocławskie trasy
 * podpisane "Kraków").
 */
async function swapStores(): Promise<void> {
  try {
    const { closeGtfsDb } = await import('./gtfsDatabase');
    await closeGtfsDb();
  } catch (err) {
    console.warn('[CityStore] db switch failed:', err);
  }
  try {
    const { resetDataStatusForCity } = await import('./dataManager');
    resetDataStatusForCity();
  } catch (err) {
    console.warn('[CityStore] data status reset failed:', err);
  }
  try {
    const { gtfsStore } = await import('./routing/store');
    gtfsStore.reset();
  } catch (err) {
    console.warn('[CityStore] routing store reset failed:', err);
  }
  try {
    const { liveTracker } = await import('./liveTracker');
    liveTracker.reset();
  } catch (err) {
    console.warn('[CityStore] live tracker reset failed:', err);
  }
}

/**
 * Zmiana miasta: persist + przełączenie bazy na plik drugiego miasta.
 * Nie kasuje nic z poprzedniego miasta (baza ani kafle zostają na dysku).
 * Kolejność swap -> `cachedId`: patrz `loadActiveCity` (żaden czytelnik nie
 * widzi nowego miasta przy starej bazie).
 */
export async function setActiveCityId(id: CityId): Promise<CityDef> {
  // To samo miasto: bez zamykania bazy i resetu store (np. sugestia GPS równa
  // obecnemu wyborowi w onboardingu).
  if (id === cachedId) return getCity(id);
  await swapStores();
  // Przypięty kurs planowano na bazie poprzedniego miasta, a jego przystanki
  // i opóźnienia istnieją tylko tam; planer liczy już na nowej bazie, więc
  // nie da się go odświeżyć. Zatrzymujemy go, żeby nie zostawić powiadomienia
  // z nieaktualnym planem. Robimy to TYLKO przy jawnej zmianie miasta, nie
  // przy starcie aplikacji: tam odtworzenie pinu należy do `restoreTrackedTrip`.
  try {
    const { stopTracking } = await import('./notifications/tripMonitor');
    await stopTracking();
  } catch (err) {
    console.warn('[CityStore] tracked trip stop failed:', err);
  }
  cachedId = id;
  notify();
  try {
    await kvSet(KEY, id);
  } catch {
    // ignoruj błąd zapisu
  }
  return getCity(id);
}

/** Hook do ekranów: chipy miasta, onboarding, ustawienia. */
export function useActiveCity(): {
  cityId: CityId;
  city: CityDef;
  setCity: (id: CityId) => Promise<CityDef>;
} {
  const [cityId, setCityId] = useState<CityId>(cachedId);

  useEffect(() => {
    listeners.add(setCityId);
    void loadActiveCity().then(setCityId);
    return () => {
      listeners.delete(setCityId);
    };
  }, []);

  const setCity = useCallback((id: CityId) => setActiveCityId(id), []);
  return { cityId, city: getCity(cityId), setCity };
}
