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
  try {
    const raw = await kvGet(KEY);
    if (raw && isCityId(raw)) cachedId = raw;
  } catch {
    // storage niedostępny — zostaje default
  }
  loaded = true;
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
 * Zmiana miasta: persist + przełączenie bazy na plik drugiego miasta.
 * Nie kasuje nic z poprzedniego miasta (baza ani kafle zostają na dysku).
 */
export async function setActiveCityId(id: CityId): Promise<CityDef> {
  cachedId = id;
  notify();
  try {
    await kvSet(KEY, id);
  } catch {
    // ignoruj błąd zapisu
  }
  try {
    const { closeGtfsDb } = await import('./gtfsDatabase');
    await closeGtfsDb();
  } catch (err) {
    console.warn('[CityStore] db switch failed:', err);
  }
  try {
    const { gtfsStore } = await import('./routing/store');
    gtfsStore.reset();
    const { liveTracker } = await import('./liveTracker');
    liveTracker.reset();
  } catch (err) {
    console.warn('[CityStore] store reset failed:', err);
  }
  return getCity(id);
}

/** Hook do ekranów: chipy miasta, onboarding, ustawienia. */
export function useActiveCity(): { cityId: CityId; city: CityDef; setCity: (id: CityId) => Promise<CityDef> } {
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
