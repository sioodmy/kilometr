// Aktywne miasto użytkownika. Persist w kv-store, default Wrocław
// (migracja istniejących instalacji bez wyboru).
//
// Zmiana miasta przełącza bazę SQLite i pakiet kafli per-miasto, więc dane
// drugiego miasta zostają nietknięte na dysku.

import { useCallback, useEffect, useSyncExternalStore } from 'react';
import { DEFAULT_CITY_ID, getCity, isCityId, type CityDef, type CityId } from '../cities';
import { kvGet, kvSet } from './storage';

const KEY = 'kilometr.activeCity.v1';

let cachedId: CityId = DEFAULT_CITY_ID;
let pendingId: CityId = DEFAULT_CITY_ID;
let loaded = false;
let manualCitySelectedInSession = false;
const listeners = new Set<(id: CityId) => void>();
/** Zmiany miasta idą jedna po drugiej: dwie równoległe podmiany baz
 *  zamykałyby bazę pod zapytaniami tej drugiej i mieszały dane miast. */
let switchQueue: Promise<unknown> = Promise.resolve();

export type CitySwitchSource = 'manual' | 'auto';

export interface SetActiveCityOptions {
  source?: CitySwitchSource;
}

/** Czy użytkownik ręcznie wybrał miasto w tej sesji (blokuje powrót przez GPS). */
export function isManualCitySelectedInSession(): boolean {
  return manualCitySelectedInSession;
}

function enqueueSwitch<T>(task: () => Promise<T>): Promise<T> {
  const run = switchQueue.then(task, task);
  switchQueue = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

function notify(): void {
  for (const l of listeners) {
    try {
      l(cachedId);
    } catch {
      // listener nie może wywalić zmiany miasta
    }
  }
}

export async function loadActiveCity(options?: { skipStoreSwap?: boolean }): Promise<CityId> {
  if (loaded) return cachedId;
  let id: CityId = DEFAULT_CITY_ID;
  try {
    const raw = await kvGet(KEY);
    if (raw && isCityId(raw)) id = raw;
  } catch {
    // storage niedostępny, zostaje default
  }
  loaded = true;
  // Zapisane miasto różni się od domyślnego: na żywo trzeba zresetować otwarte bazy,
  // ale przy zimnym starcie przed zamontowaniem ekranów bazy jeszcze nie istnieją.
  if (id !== cachedId) {
    pendingId = id;
    if (options?.skipStoreSwap) {
      cachedId = id;
      notify();
      return cachedId;
    }
    await enqueueSwitch(async () => {
      if (id === cachedId) return;
      await swapStores();
      cachedId = id;
      notify();
    });
    return cachedId;
  }
  pendingId = cachedId;
  notify();
  return cachedId;
}

/** Synchroniczny odczyt do serwisów (po loadActiveCity w _layout). */
export function getActiveCityIdSync(): CityId {
  return cachedId;
}

/** Nasłuch zmiany miasta dla cache trzymanych w pamięci (np. planów). */
export function subscribeActiveCity(listener: (id: CityId) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
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
    const { resetDataStatusForCity } = await import('./dataManager');
    // Najpierw przerywamy trwający download/manifest, żeby stary import nie
    // wszedł w podmianę pliku i nie emitował już postępu starego miasta.
    resetDataStatusForCity();
  } catch (err) {
    console.warn('[CityStore] data status reset failed:', err);
  }
  await Promise.all([
    (async () => {
      try {
        const { closeGtfsDb, waitForGtfsSwap } = await import('./gtfsDatabase');
        // Import mógł w tej chwili podmieniać plik (close->move). Zamknięcie bazy
        // w trakcie `move` zostawiało otwarty uchwyt do nieistniejącego pliku.
        await waitForGtfsSwap();
        await closeGtfsDb();
      } catch (err) {
        console.warn('[CityStore] db switch failed:', err);
      }
    })(),
    (async () => {
      try {
        const { gtfsStore } = await import('./routing/store');
        gtfsStore.reset();
      } catch (err) {
        console.warn('[CityStore] routing store reset failed:', err);
      }
    })(),
    (async () => {
      try {
        const { liveTracker } = await import('./liveTracker');
        liveTracker.reset();
      } catch (err) {
        console.warn('[CityStore] live tracker reset failed:', err);
      }
    })(),
    (async () => {
      try {
        const { invalidateLocalTimetableCache } = await import('./offlineCache');
        invalidateLocalTimetableCache();
      } catch (err) {
        console.warn('[CityStore] offline cache reset failed:', err);
      }
    })(),
  ]);
}

/**
 * Zmiana miasta: persist + przełączenie bazy na plik drugiego miasta.
 * Nie kasuje nic z poprzedniego miasta (baza ani kafle zostają na dysku).
 * Kolejność swap -> `cachedId`: patrz `loadActiveCity` (żaden czytelnik nie
 * widzi nowego miasta przy starej bazie).
 */
export function setActiveCityId(id: CityId, options?: SetActiveCityOptions): Promise<CityDef> {
  const source: CitySwitchSource = options?.source ?? 'manual';
  if (source === 'manual') manualCitySelectedInSession = true;
  // To samo miasto i brak innego oczekującego przełączenia w kolejce.
  if (id === cachedId && pendingId === id) return Promise.resolve(getCity(id));
  pendingId = id;
  // Przerywamy stary download natychmiast, bez czekania na koniec kolejki.
  void import('./dataManager')
    .then(({ cancelActiveImport }) => cancelActiveImport())
    .catch(() => {});
  return enqueueSwitch(async () => {
    // Kolejna zmiana z kolejki mogła już ustawić to miasto.
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
  });
}

function subscribeCitySnapshot(onStoreChange: () => void): () => void {
  const listener = () => onStoreChange();
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Hook do ekranów: chipy miasta, onboarding, ustawienia, nagłówki. */
export function useActiveCity(): {
  cityId: CityId;
  city: CityDef;
  setCity: (id: CityId, options?: SetActiveCityOptions) => Promise<CityDef>;
} {
  const cityId = useSyncExternalStore(
    subscribeCitySnapshot,
    getActiveCityIdSync,
    getActiveCityIdSync,
  );

  useEffect(() => {
    if (!loaded) {
      void loadActiveCity().catch(() => {});
    }
  }, []);

  const setCity = useCallback(
    (id: CityId, options?: SetActiveCityOptions) => setActiveCityId(id, options),
    [],
  );
  return { cityId, city: getCity(cityId), setCity };
}
