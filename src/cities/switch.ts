// Przełączenie miasta: co trzeba zresetować, żeby aplikacja nie mieszała miast.
//
// Zmiana miasta to nie tylko podmiana URL-a. W pamięci telefonu leży wiele
// stanu zbudowanego dla konkretnego rozkładu — uchwyty do bazy, indeks
// RAPTOR-a, wagi przystanków, ostatnie lokalizacje. Gdyby zostawić któryś z
// tych stanów, planer pokazałby trasy z poprzedniego miasta (przystanki nie
// istnieją w nowym rozkładzie), a wyszukiwarka podpowiedziałaby nazwy
// przystanków z innego miasta.
//
// Kolejność ma znaczenie: `setActiveCity` musi się wykonać PRZED resetem
// pamięci podręcznych, bo ich klucze są nazwane według aktywnego miasta.

import { setActiveCity } from './active';
import type { CityId } from './types';

/**
 * Przełącza miasto i czyści stan zależny od poprzedniego.
 *
 * Nie kasujemy danych — każde miasto ma własną bazę SQLite i własne pliki
 * rozkładu, więc powrót do poprzedniego miasta działa natychmiast, bez
 * ponownego pobierania.
 */
export async function switchCity(id: CityId): Promise<void> {
  await setActiveCity(id);
  await invalidateCityScopedState();
}

/**
 * Czyści stan zależny od miasta, nie zmieniając wyboru. Wywoływane po
 * przełączeniu oraz przy starcie aplikacji, gdy aktywne miasto zostało właśnie
 * wczytane z dysku (pamięć podręczna procesu i tak jest wtedy pusta, ale
 * wolimy jedną ścieżkę kodu niż dwa).
 */
export async function invalidateCityScopedState(): Promise<void> {
  const { resetGtfsDb } = await import('../services/gtfsDatabase');
  resetGtfsDb();

  // Indeks tras i śledzenie pojazdów trzymają przystanki w Mapach — po
  // zmianie miasta są bezużyteczne i muszą zostać zbudowane od nowa.
  try {
    const { gtfsStore } = await import('../services/routing/store');
    gtfsStore.reset();
  } catch (err) {
    console.warn('[Cities] routing store reset failed:', err);
  }
  try {
    const { liveTracker } = await import('../services/liveTracker');
    liveTracker.reset();
  } catch (err) {
    console.warn('[Cities] live tracker reset failed:', err);
  }
}
