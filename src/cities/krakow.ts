import type { CityDefinition } from './types';

// Kraków — dane ZTP (Zarząd Transportu Publicznego w Krakowie), ZDMK.
//
// Różnica w architekturze danych względem Wrocławia: ZTP NIE wystawia jednego
// pliku, tylko trzy, rozdzielone według przewoźnika i typu pojazdu:
//
//   GTFS_KRK_T.zip → tramwaje   (ZTP, route_type = 900 — extended GTFS)
//   GTFS_KRK_A.zip → autobusy    (MPK, route_type = 3)
//   GTFS_KRK_M.zip → autobusy    (Mobilis — przewoźnik prywatny)
//
// Dlatego CityFeed ma tu trzy wpisy, a każdy ma `mode`. To najmocniejszy
// sygnał o typie pojazdu, jaki w ogóle istnieje: sam operator mówi, czym jest
// archiwum. Bez tego numery tramwajów 49/62/69/70/74/76/77 wyglądają jak
// numery autobusów.
//
// Granice policzone z 4107 przystanków wszystkich trzech feedów
// (lat 49.90249–50.24532, lon 19.58379–20.35261), zaokrąglone na zewnątrz.
// To cały obszar ZTM, nie samo miasto — linie dojeżdżają m.in. pod
// Oświęcim i Tarnów, więc granica miasta musi je obejmować.
export const KRAKOW: CityDefinition = {
  id: 'krakow',
  nameKey: 'krakow',
  countryCode: 'pl',

  bounds: { minLat: 49.88, maxLat: 50.27, minLon: 19.56, maxLon: 20.38 },
  // Rynek Sukienniczy — środek Starego Miasta.
  center: { lat: 50.0614, lon: 19.9366 },

  // left,top,right,bottom
  nominatimBbox: '19.56,50.27,20.38,49.88',
  // south,west,north,east
  overpassBbox: '49.88,19.56,50.27,20.38',

  feeds: [
    // Tramwaje w pierwszym miejscu: app startuje na nich najczęściej, a przy
    // awarii jednego pliku reszta feedów nadal się zaimportuje.
    { id: 'tram', url: 'https://gtfs.ztp.krakow.pl/GTFS_KRK_T.zip', mode: 'tram' },
    { id: 'bus-mpk', url: 'https://gtfs.ztp.krakow.pl/GTFS_KRK_A.zip', mode: 'bus' },
    // Mobilis bywa najmniej stabilnym feedem — brak nie może blokować reszty.
    { id: 'bus-mobilis', url: 'https://gtfs.ztp.krakow.pl/GTFS_KRK_M.zip', mode: 'bus', optional: true },
  ],
  // ZTP nie wystawia katalogu z datami wydań (pliki nadpisywane w miejscu),
  // więc adresy w `feeds` są docelowe i nie wymagają discovery.
  catalogueUrl: 'https://gtfs.ztp.krakow.pl/',
  fallbackDownloadUrl: 'https://gtfs.ztp.krakow.pl/GTFS_KRK_T.zip',

  // Feed RSS przewoźnika. Bywa pusty (np. gdy nie ma nowych wpisów) — ekran
  // aktualności ma wtedy swój stan pusty, nie traktujemy tego jako błędu.
  newsFeedUrl: 'https://www.kmkrakow.pl/rss',

  // Kraków ma GTFS-RT, więc pozycje pojazdów są prostsze niż we Wrocławiu
  // (formularz POST): to protobuf, a my go jeszcze nie parsujemy. Świadomie
  // zostawiamy `realtime` nieustawione, dopóki nie dodamy parsera .pb — bez
  // niego `fetchVehicles` musi uczciwie zwrócić „brak danych”, zamiast
  // udawać Wrocławski endpoint.
  realtime: undefined,

  // route_type jest poprawne (900 vs 3), więc lista tylko na wypadek
  // uszkodzonego feedu. Numery z GTFS_KRK_T (stan na 2026-10).
  tramLineFallback: [
    '1', '3', '5', '7', '8', '9', '11', '12', '13', '14', '15',
    '16', '18', '20', '21', '22', '49', '62', '69', '70', '74', '76', '77',
  ],

  refreshHours: 24,
};
