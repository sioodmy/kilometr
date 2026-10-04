// Aktywne miasto: co aplikacja traktuje jako „swoje" miasto.
//
// ─── Zasada: nie zgadujemy miasta przy każdym uruchomieniu ─────────────────
// Wykrywanie miasta po GPS działa TYLKO na pierwszym starcie (onboarding) albo
// na wyraźne żądanie z Ustawień. Przy zwykłym uruchomieniu czytamy ostatnio
// użyte miasto z dysku i otwieramy je — nawet jeśli użytkownik wyjechał z
// Wrocławia do Krakowa na tydzień. Powody:
//
// - start nie może blokować się na lokalizacji (GPS potrafi nie odpowiedzieć,
//   a użytkownik i tak ma swój rozkład pod ręką),
// - automatyczna zmiana miasta wywołałaby po cichu pełny reimport danych,
// - miasto to decyzja użytkownika, nie wniosek z modułu GPS.

import * as Location from 'expo-location';
import { kvGet, kvSet } from '../services/storage';
import { DEFAULT_CITY_ID, detectCityFromCoords, getCity, isCityId } from './registry';
import type { CityDefinition, CityId } from './types';

export { detectCityFromCoords };

const KEY = 'kilometr.city.v1';

/**
 * Miasto w pamięci. `null` oznacza „jeszcze nie wczytane" — dopóki trwa to,
 * `getActiveCitySync()` zwraca miasto domyślne, żeby kod startowy nie czekał
 * na I/O.
 */
let activeId: CityId | null = null;
let loaded = false;
const listeners = new Set<(city: CityDefinition) => void>();

/**
 * Aktywne miasto bez I/O. Do serwisów, które muszą działać od razu (render
 * ikony, kolor linii, odczyt rozkładu) i dla pierwszej klatki animacji.
 */
export function getActiveCitySync(): CityDefinition {
  return getCity(activeId);
}

/** Identyfikator aktywnego miasta — do kluczy namespace w pamięci podręcznej. */
export function getActiveCityIdSync(): CityId {
  return activeId ?? DEFAULT_CITY_ID;
}

/**
 * Wczytuje miasto z dysku. Wołane raz, przy starcie aplikacji (`_layout`),
 * zanim cokolwiek zapytamy o rozkład.
 */
export async function loadActiveCity(): Promise<CityDefinition> {
  try {
    const raw = await kvGet(KEY);
    // Dane z dysku mogą pochodzić z usuniętej już wersji aplikacji, więc
    // identyfikator walidujemy zamiast ufać zapisowi.
    if (isCityId(raw)) activeId = raw;
  } catch (err) {
    console.warn('[Cities] active city unreadable, using default:', err);
  } finally {
    loaded = true;
  }
  return getActiveCitySync();
}

/** Czy miasto zostało już wczytane z dysku (przydatne w testach/diagnostyce). */
export function isActiveCityLoaded(): boolean {
  return loaded;
}

/**
 * Przełącza miasto i zapisuje wybór. Subskrybenci dostają nową definicję
 * jeszcze przed zakończeniem zapisu, żeby UI nie czekał na dysk.
 *
 * Zmiana miasta NIE kasuje danych poprzedniego — każde miasto ma własny
 * rozkład w pamięci, więc powrót nie wymaga ponownego pobierania.
 */
export async function setActiveCity(id: CityId): Promise<void> {
  const next = getCity(id);
  if (next.id === activeId && loaded) {
    // Wybór tego samego miasta — nie wołamy subskrybentów, żeby nie
    // przebudowywać całego drzewa UI bez powodu.
    return;
  }
  activeId = next.id;
  loaded = true;
  for (const fn of listeners) {
    try {
      fn(next);
    } catch {
      // subskrybent nie może wywrócić przełączenia miasta
    }
  }
  try {
    await kvSet(KEY, next.id);
  } catch (err) {
    console.warn('[Cities] failed to persist active city:', err);
  }
}

/** Zmiana aktywnego miasta (albo zdarzenie wymuszające odświeżenie UI). */
export function subscribeActiveCity(fn: (city: CityDefinition) => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/**
 * Wykrywa miasto z GPS. Wołane WYŁĄCZNIE z onboardingu (krok wyboru miasta)
 * oraz z przycisku „wykryj" w Ustawieniach — nigdy przy zwykłym starcie.
 *
 * Nie rzuca: brak uprawnień albo błąd GPS to `null`, a wywołujący decyduje,
 * co z tym zrobić (zazwyczaj pokaże ręczny wybór). Sama geometria siedzi w
 * `registry` (`detectCityFromCoords`), więc da się ją sprawdzić bez telefonu
 * i bez budowania APK (`npm run check:cities`).
 */
export async function detectCityFromGps(): Promise<CityId | null> {
  try {
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== 'granted') return null;
    const pos = await Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy.Balanced,
    });
    return detectCityFromCoords(pos.coords.latitude, pos.coords.longitude);
  } catch (err) {
    console.warn('[Cities] GPS detection failed:', err);
    return null;
  }
}

/** Testy/diagnostyka: zapomnij wczytane miasto (dla odświeżenia z dysku). */
export function resetActiveCityCache(): void {
  activeId = null;
  loaded = false;
}

export type { CityDefinition, CityId } from './types';
