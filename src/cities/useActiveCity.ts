// Hook Reactowy na aktywne miasto.
//
// Osobny plik, bo `active.ts` ma zostać czysty (może być importowany przez
// serwisy poza Reactem), a `useSyncExternalStore` wymaga Reacta.

import { useSyncExternalStore } from 'react';
import { getActiveCitySync, subscribeActiveCity } from './active';
import type { CityDefinition } from './types';

/**
 * Aktywne miasto, z przekierowaniem przy zmianie wyboru.
 *
 * Zrzut z `getActiveCitySync` jest stabilny między renderami (to ten sam
 * obiekt z rejestru, dopóki miasto się nie zmieni), więc `useSyncExternalStore`
 * nie wpada w zapętlenie renderów.
 *
 * Uwaga: przed `loadActiveCity()` zwraca miasto domyślne. `_layout` wywołuje
 * `loadActiveCity()` zanim dopuszcza do reszty ekranów, więc użytkownik nie
 * zobaczy „najpierw Wrocław, potem Kraków” przy starcie aplikacji.
 */
export function useActiveCity(): CityDefinition {
  return useSyncExternalStore(subscribeActiveCity, getActiveCitySync, getActiveCitySync);
}
