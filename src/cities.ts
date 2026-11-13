// Rejestr obsługiwanych miast. Jedno miejsce na wszystko co specyficzne
// dla miasta: środek strefy, bboxy, feedy GTFS/live/news, kafle offline.
// Nowe miasto = jeden wpis tutaj + build workera. Zero ifów po id miasta
// w reszcie kodu: serwisy czytają aktywny wpis przez cityStore.

export type CityId =
  | 'wroclaw' | 'krakow' | 'gzm' | 'warszawa' | 'poznan' | 'trojmiasto' | 'lodz'
  | 'szczecin' | 'kielce' | 'olsztyn' | 'bialystok' | 'opole' | 'rzeszow' | 'lublin' | 'radom'
  | 'bydgoszcz' | 'torun' | 'elblag' | 'gorzow' | 'czestochowa' | 'zielonagora' | 'rybnik'
  | 'slupsk' | 'walbrzych' | 'kalisz' | 'siedlce' | 'lomza' | 'krosno' | 'jaslo'
  | 'olkusz' | 'chrzanow' | 'bochnia' | 'ilawa';

interface CityCenter {
  lat: number;
  lon: number;
}

interface CityBbox {
  minLat: number;
  maxLat: number;
  minLon: number;
  maxLon: number;
}

export interface CityDef {
  id: CityId;
  /** Nazwa w mianowniku (do chipów i nagłówków). */
  name: string;
  center: CityCenter;
  /** Promień strefy obsługi w metrach. */
  radiusM: number;
  bounds: CityBbox;
  /** Nominatim viewbox: minLon,maxLat,maxLon,minLat. */
  nominatimViewbox: string;
  /** Overpass: south,west,north,east. */
  overpassBbox: string;
  /** Zbiorkom: slug miasta + bbox minLon,minLat,maxLon,maxLat. */
  zbiorkomSlug: string;
  zbiorkomBbox: string;
  /** Plik bazy w katalogu SQLite per-miasto. */
  dbFile: string;
  /** Pakiet kafli offline w R2 i na telefonie. */
  tilePack: string;
  tileBbox: CityBbox;
  tileMaxZoom: number;
  /** Orientacyjny rozmiar pakietu kafli (MB) do tekstów UI; "ok." w i18n. */
  tilePackMB: number;
  /**
   * Stacje kolejowe bramowe miasta: tu planer intercity kończy nogę
   * miejską i zaczyna pociąg (dataset `polska`). Nazwy dokładnie jak w
   * feedzie PLK (patrz build-polska.mjs); Łódź i Warszawa mają po kilka
   * stacji głównych, reszta miast jedną.
   */
  railGateways: string[];
  features: {
    /** Kolej linowa (Polinka) istnieje tylko we Wrocławiu. */
    cable: boolean;
    /** Budynki uczelni w wyszukiwarce (PWr). */
    campusPois: boolean;
    /** Pociągi regionalne w prebuilt (KD we Wrocławiu). */
    regionalRail: boolean;
    /**
     * Czy zbiorkom.live ma endpoint pozycji dla miasta. Fałsz wyłącza
     * polling i chip „brak danych live” (endpoint nie istnieje = wieczny
     * „brak”, a nie awaria). Pociągi ogólnopolskie działają dalej.
     */
    live: boolean;
    /**
     * Czy miasto ma źródło komunikatów pasażerskich. Fałsz ukrywa dzwonek
     * w UI i gasi scrapery (pusta lista zamiast cudzych komunikatów).
     */
    news: boolean;
    /** Bezpośredni POST bus_position jako fallback live (tylko MPK Wrocław). */
    directBusPosition: boolean;
  };
}

const WROCLAW: CityDef = {
  id: 'wroclaw',
  name: 'Wrocław',
  center: { lat: 51.1079, lon: 17.0385 },
  radiusM: 15_000,
  bounds: { minLat: 50.95, maxLat: 51.25, minLon: 16.7, maxLon: 17.25 },
  nominatimViewbox: '16.7,51.25,17.25,50.95',
  overpassBbox: '50.95,16.70,51.25,17.25',
  zbiorkomSlug: 'wroclaw',
  zbiorkomBbox: '16.7,50.95,17.25,51.25',
  dbFile: 'kilometr-gtfs-wroclaw.db',
  tilePack: 'wroclaw-tiles.ktp',
  tileBbox: { minLat: 51.0, maxLat: 51.22, minLon: 16.8, maxLon: 17.28 },
  tileMaxZoom: 14,
  tilePackMB: 19,
  railGateways: ['Wrocław Główny'],
  features: { cable: true, campusPois: true, regionalRail: true, live: true, news: true, directBusPosition: true },
};

const KRAKOW: CityDef = {
  id: 'krakow',
  name: 'Kraków',
  center: { lat: 50.0614, lon: 19.9366 },
  radiusM: 15_000,
  bounds: { minLat: 49.95, maxLat: 50.17, minLon: 19.7, maxLon: 20.3 },
  nominatimViewbox: '19.7,50.17,20.3,49.95',
  overpassBbox: '49.95,19.70,50.17,20.30',
  zbiorkomSlug: 'krakow',
  zbiorkomBbox: '19.7,49.95,20.3,50.17',
  dbFile: 'kilometr-gtfs-krakow.db',
  tilePack: 'krakow-tiles.ktp',
  tileBbox: { minLat: 49.96, maxLat: 50.16, minLon: 19.7, maxLon: 20.3 },
  tileMaxZoom: 14,
  tilePackMB: 21,
  railGateways: ['Kraków Główny'],
  features: { cable: false, campusPois: false, regionalRail: true, live: true, news: true, directBusPosition: false },
};

const GZM: CityDef = {
  id: 'gzm',
  name: 'GZM',
  // Strefa obsługi metropolii: promień musi sięgać najdalszych gmin GZM
  // (najdalszy punkt to Rudziniec Gliwicki ~46 km od Katowic), a nie obejmować
  // Bielska (~49,5 km). Rybnik i Wodzisław Śląskie NIE są w GZM, więc nie
  // wyznaczają promienia.
  center: { lat: 50.2649, lon: 19.0238 },
  radiusM: 48_000,
  bounds: { minLat: 49.95, maxLat: 50.6, minLon: 18.35, maxLon: 19.8 },
  nominatimViewbox: '18.35,50.6,19.8,49.95',
  overpassBbox: '49.95,18.35,50.60,19.80',
  zbiorkomSlug: 'gzm',
  zbiorkomBbox: '18.35,49.95,19.8,50.6',
  dbFile: 'kilometr-gtfs-gzm.db',
  tilePack: 'gzm-tiles.ktp',
  tileBbox: { minLat: 49.9, maxLat: 50.65, minLon: 18.25, maxLon: 19.85 },
  // Dzięki kompresji gzip z14 dla całej metropolii mieści się w ~104 MB
  // (limit R2 to 300 MB) i odblokowuje pieszy routing offline w Raptorze.
  tileMaxZoom: 14,
  tilePackMB: 104,
  railGateways: ['Katowice'],
  features: { cable: false, campusPois: false, regionalRail: true, live: true, news: true, directBusPosition: false },
};

const WARSZAWA: CityDef = {
  id: 'warszawa',
  name: 'Warszawa',
  center: { lat: 52.2297, lon: 21.0122 },
  radiusM: 16_000,
  bounds: { minLat: 52.0, maxLat: 52.4, minLon: 20.8, maxLon: 21.3 },
  nominatimViewbox: '20.8,52.4,21.3,52.0',
  overpassBbox: '52.00,20.80,52.40,21.30',
  // zbiorkom.live nazywa miasto `warsaw` (agencja `default`); bbox jak bounds.
  zbiorkomSlug: 'warsaw',
  zbiorkomBbox: '20.8,52.0,21.3,52.4',
  dbFile: 'kilometr-gtfs-warszawa.db',
  tilePack: 'warszawa-tiles.ktp',
  tileBbox: { minLat: 52.05, maxLat: 52.35, minLon: 20.85, maxLon: 21.28 },
  // Warszawa w z14 z kompresją gzip mieści się w ~39 MB z zapasem na lotnisko i SKM.
  tileMaxZoom: 14,
  tilePackMB: 39,
  // SKM siedzi w GTFS WTP, KM i WKD dociąga build z PDP (jak KD we Wrocławiu).
  railGateways: ['Warszawa Centralna', 'Warszawa Zachodnia', 'Warszawa Wschodnia', 'Warszawa Gdańska', 'Warszawa Śródmieście'],
  features: { cable: false, campusPois: false, regionalRail: true, live: true, news: true, directBusPosition: false },
};

const POZNAN: CityDef = {
  id: 'poznan',
  name: 'Poznań',
  center: { lat: 52.4084, lon: 16.9336 },
  // Aglomeracja z liniami podmiejskimi (PKS Poznań, Kombus, Środa Wlkp.):
  // najdalszy regularny punkt to Środa Wielkopolska (~31 km od centrum).
  radiusM: 32_000,
  bounds: { minLat: 52.15, maxLat: 52.65, minLon: 16.6, maxLon: 17.3 },
  nominatimViewbox: '16.6,52.65,17.3,52.15',
  overpassBbox: '52.15,16.60,52.65,17.30',
  // zbiorkom.live nazywa miasto `poznan` (agencje `default`, `PKSPOZNAN`,
  // `KOMBUS`, `SRODAWLKP`); bbox jak bounds.
  zbiorkomSlug: 'poznan',
  zbiorkomBbox: '16.6,52.15,17.3,52.65',
  dbFile: 'kilometr-gtfs-poznan.db',
  tilePack: 'poznan-tiles.ktp',
  // Kafle pokrywają całą strefę (jak bounds i live), żeby trasa do Środy
  // Wlkp. czy Murowanej Gośliny działała offline bez dziur na krawędzi.
  tileBbox: { minLat: 52.15, maxLat: 52.65, minLon: 16.6, maxLon: 17.3 },
  // Aglomeracja w z14 z kompresją gzip zajmuje ~23 MB (pomiar próbką kafli).
  tileMaxZoom: 14,
  tilePackMB: 23,
  // Kolej aglomeracyjna (KW/PKM) siedzi we własnym publicznym GTFS
  // Kolei Wielkopolskich, nie w PDP. ZTM nie ma publicznego bus_position.
  railGateways: ['Poznań Główny'],
  features: { cable: false, campusPois: false, regionalRail: true, live: true, news: true, directBusPosition: false },
};

const TROJMIASTO: CityDef = {
  id: 'trojmiasto',
  name: 'Trójmiasto',
  // Środek aglomeracji: Sopot leży między Gdańskiem a Gdynią.
  center: { lat: 54.4418, lon: 18.5629 },
  // Wejherowo to ~28 km od Sopotu, Pruszcz Gdański ~20 km.
  radiusM: 32_000,
  bounds: { minLat: 54.1, maxLat: 54.66, minLon: 18.15, maxLon: 18.98 },
  nominatimViewbox: '18.15,54.66,18.98,54.1',
  overpassBbox: '54.10,18.15,54.66,18.98',
  // zbiorkom.live nazywa miasto `tricity` (agencje `default` dla Gdańska
  // i `GDYNIA` dla Gdyni); bbox jak bounds.
  zbiorkomSlug: 'tricity',
  zbiorkomBbox: '18.15,54.1,18.98,54.66',
  dbFile: 'kilometr-gtfs-trojmiasto.db',
  tilePack: 'trojmiasto-tiles.ktp',
  tileBbox: { minLat: 54.1, maxLat: 54.66, minLon: 18.15, maxLon: 18.9 },
  // Pasmo Gdańsk - Sopot - Gdynia - Wejherowo w z14 z gzipem to ok. 30 MB.
  tileMaxZoom: 14,
  tilePackMB: 30,
  // SKM siedzi we własnym publicznym GTFS (jak KW w Poznaniu). Ani ZTM
  // Gdańsk, ani ZKM Gdynia nie mają publicznego bus_position.
  railGateways: ['Gdynia Główna', 'Gdańsk Główny'],
  features: { cable: false, campusPois: false, regionalRail: true, live: true, news: true, directBusPosition: false },
};

const LODZ: CityDef = {
  id: 'lodz',
  name: 'Łódź',
  center: { lat: 51.7592, lon: 19.455 },
  // Aglomeracja z liniami podmiejskimi (tramwaje 41/43 do Pabianic
  // i Zgierza, Stryków na wschodzie): najdalszy punkt to Zgierz
  // (~25 km od centrum).
  radiusM: 28_000,
  bounds: { minLat: 51.55, maxLat: 51.97, minLon: 19.05, maxLon: 19.85 },
  nominatimViewbox: '19.05,51.97,19.85,51.55',
  overpassBbox: '51.55,19.05,51.97,19.85',
  // zbiorkom.live nazywa miasto `lodz`; bbox jak bounds.
  zbiorkomSlug: 'lodz',
  zbiorkomBbox: '19.05,51.55,19.85,51.97',
  dbFile: 'kilometr-gtfs-lodz.db',
  tilePack: 'lodz-tiles.ktp',
  // Kafle pokrywają całą strefę (jak bounds i live), żeby trasa do Zgierza
  // czy Strykowa działała offline bez dziur na krawędzi.
  tileBbox: { minLat: 51.55, maxLat: 51.97, minLon: 19.05, maxLon: 19.85 },
  // Aglomeracja w z14 z kompresją gzip zajmuje ~20 MB (pomiar próbką kafli).
  tileMaxZoom: 14,
  tilePackMB: 20,
  // ŁKA siedzi we własnym publicznym GTFS (pkp-lka.zip), nie w PDP.
  // ZDiT nie ma publicznego bus_position.
  railGateways: ['Łódź Fabryczna', 'Łódź Kaliska', 'Łódź Widzew'],
  features: { cable: false, campusPois: false, regionalRail: true, live: true, news: true, directBusPosition: false },
};

const SZCZECIN: CityDef = {
  id: 'szczecin',
  name: 'Szczecin',
  center: { lat: 53.4285, lon: 14.5528 },
  // Strefa ZDiTM z gminami ościennymi (Police na północy, Dobra na
  // zachodzie, Dąbie na wschodzie): najdalszy punkt to Police
  // (~15 km od centrum).
  radiusM: 20_000,
  bounds: { minLat: 53.3, maxLat: 53.6, minLon: 14.35, maxLon: 14.75 },
  nominatimViewbox: '14.35,53.6,14.75,53.3',
  overpassBbox: '53.30,14.35,53.60,14.75',
  // zbiorkom.live nazywa miasto `szczecin` (jedna agencja `default`,
  // więc bez filtra); bbox jak bounds.
  zbiorkomSlug: 'szczecin',
  zbiorkomBbox: '14.35,53.3,14.75,53.6',
  dbFile: 'kilometr-gtfs-szczecin.db',
  tilePack: 'szczecin-tiles.ktp',
  // Kafle pokrywają całą strefę (jak bounds i live), żeby trasa do Polic
  // działała offline bez dziur na krawędzi.
  tileBbox: { minLat: 53.3, maxLat: 53.6, minLon: 14.35, maxLon: 14.75 },
  // Mniejsza strefa niż Łódź (0,12 vs 0,34 deg2), więc ~10 MB w z14 z gzipem.
  tileMaxZoom: 14,
  tilePackMB: 10,
  // Kolej (SKM Szczecin) nie ma publicznego GTFS ani feedu live w bboxie
  // (sprawdzone: zbiorkom `pkp` zwraca tu tylko dalekobieżne IC).
  // ZDiTM nie ma publicznego bus_position.
  railGateways: ['Szczecin Główny'],
  features: { cable: false, campusPois: false, regionalRail: false, live: true, news: true, directBusPosition: false },
};

const KIELCE: CityDef = {
  id: 'kielce',
  name: 'Kielce',
  center: { lat: 50.8711, lon: 20.6312 },
  // Strefa ZTM z gminami ościennymi (Morawica i Chęciny na południu,
  // Masłów na północy, Daleszyce na wschodzie): najdalszy przystanek
  // to Obice Szkoła (~21 km od centrum).
  radiusM: 24_000,
  bounds: { minLat: 50.65, maxLat: 51.02, minLon: 20.3, maxLon: 20.95 },
  nominatimViewbox: '20.3,51.02,20.95,50.65',
  overpassBbox: '50.65,20.30,51.02,20.95',
  // zbiorkom.live nazywa miasto `kielce` (jedna agencja `default`,
  // więc bez filtra); bbox jak bounds.
  zbiorkomSlug: 'kielce',
  zbiorkomBbox: '20.3,50.65,20.95,51.02',
  dbFile: 'kilometr-gtfs-kielce.db',
  tilePack: 'kielce-tiles.ktp',
  // Kafle pokrywają całą strefę (jak bounds i live), żeby trasa do Obic
  // działała offline bez dziur na krawędzi.
  tileBbox: { minLat: 50.65, maxLat: 51.02, minLon: 20.3, maxLon: 20.95 },
  // Strefa nieco mniejsza niż Łódź (0,24 vs 0,34 deg2), więc ~15 MB w z14 z gzipem.
  tileMaxZoom: 14,
  tilePackMB: 15,
  // Kielce mają wyłącznie autobusy (GTFS ZTM to sam route_type 3, linie
  // 0W/0Z, 1-54, 102-114, E/F, N1/N2, T/Z). Kolej nie ma publicznego GTFS,
  // ZTM nie ma publicznego bus_position.
  railGateways: ['Kielce Główne'],
  features: { cable: false, campusPois: false, regionalRail: false, live: true, news: true, directBusPosition: false },
};

const OLSZTYN: CityDef = {
  id: 'olsztyn',
  name: 'Olsztyn',
  center: { lat: 53.7784, lon: 20.4802 },
  // Strefa ZDZiT z gminami ościennymi (Barczewo na północnym wschodzie,
  // Jonkowo na zachodzie, Nikielkowo na wschodzie): najdalszy przystanek
  // to Barczewo (~16 km od centrum; reszta strefy bliżej).
  radiusM: 22_000,
  bounds: { minLat: 53.6, maxLat: 53.95, minLon: 20.2, maxLon: 20.75 },
  nominatimViewbox: '20.2,53.95,20.75,53.6',
  overpassBbox: '53.60,20.20,53.95,20.75',
  // zbiorkom.live nazywa miasto `olsztyn`; filtr `agencies=default`
  // odcina podmiejskie S7 agencji TRIBUS (nie ma ich w GTFS ZDZiT,
  // więc wisiałyby na mapie jako kropki bez rozkładu); bbox jak bounds.
  zbiorkomSlug: 'olsztyn',
  zbiorkomBbox: '20.2,53.6,20.75,53.95',
  dbFile: 'kilometr-gtfs-olsztyn.db',
  tilePack: 'olsztyn-tiles.ktp',
  // Kafle pokrywają całą strefę (jak bounds i live), żeby trasa do Barczewa
  // czy Jonkowa działała offline bez dziur na krawędzi.
  tileBbox: { minLat: 53.6, maxLat: 53.95, minLon: 20.2, maxLon: 20.75 },
  // Strefa 0,19 deg2 (między Szczecinem a Łodzią), w z14 z gzipem ok. 15 MB.
  tileMaxZoom: 14,
  tilePackMB: 15,
  // Kolej nie ma publicznego GTFS ani feedu live w bboxie (sprawdzone:
  // zbiorkom `pkp` zwraca tu tylko dalekobieżne IC). ZDZiT nie ma
  // publicznego bus_position.
  railGateways: ['Olsztyn Główny'],
  features: { cable: false, campusPois: false, regionalRail: false, live: true, news: true, directBusPosition: false },
};

const BIALYSTOK: CityDef = {
  id: 'bialystok',
  name: 'Białystok',
  center: { lat: 53.1325, lon: 23.1688 },
  // Sieć BKM z gminami ościennymi (Choroszcz na zachodzie, Supraśl na
  // północnym wschodzie, Niewodnica na południu): najdalszy punkt to
  // Niewodnica (~24 km od centrum).
  radiusM: 26_000,
  bounds: { minLat: 52.9, maxLat: 53.26, minLon: 22.9, maxLon: 23.35 },
  nominatimViewbox: '22.9,53.26,23.35,52.9',
  overpassBbox: '52.90,22.90,53.26,23.35',
  // zbiorkom.live nazywa miasto `bialystok`; bbox jak bounds.
  zbiorkomSlug: 'bialystok',
  zbiorkomBbox: '22.9,52.9,23.35,53.26',
  dbFile: 'kilometr-gtfs-bialystok.db',
  tilePack: 'bialystok-tiles.ktp',
  // Kafle pokrywają całą strefę (jak bounds i live), żeby trasa do
  // Choroszczy czy Supraśla działała offline bez dziur na krawędzi.
  tileBbox: { minLat: 52.9, maxLat: 53.26, minLon: 22.9, maxLon: 23.35 },
  // Strefa ~0,16 deg2 (między Szczecinem a Łodzią), więc ~12 MB w z14 z gzipem.
  tileMaxZoom: 14,
  tilePackMB: 12,
  // Kolej regionalna (POLREGIO) nie ma publicznego GTFS, więc miasto jedzie
  // bez sekcji kolejowej. BKM nie ma publicznego bus_position.
  railGateways: ['Białystok'],
  features: { cable: false, campusPois: false, regionalRail: false, live: true, news: true, directBusPosition: false },
};

const OPOLE: CityDef = {
  id: 'opole',
  name: 'Opole',
  center: { lat: 50.6667, lon: 17.9233 },
  // Sieć MZK z gminami ościennymi (Dobrzeń Wielki na północy, Prószków
  // na południu, Wawelno na zachodzie): najdalszy przystanek to Dobrzeń
  // Wielki (~12,6 km od Rynku).
  radiusM: 15_000,
  bounds: { minLat: 50.55, maxLat: 50.8, minLon: 17.7, maxLon: 18.1 },
  nominatimViewbox: '17.7,50.8,18.1,50.55',
  overpassBbox: '50.55,17.70,50.80,18.10',
  // zbiorkom.live nazywa miasto `opole` (jedna agencja `default`,
  // więc bez filtra); bbox jak bounds.
  zbiorkomSlug: 'opole',
  zbiorkomBbox: '17.7,50.55,18.1,50.8',
  dbFile: 'kilometr-gtfs-opole.db',
  tilePack: 'opole-tiles.ktp',
  // Kafle pokrywają całą strefę (jak bounds i live), żeby trasa do
  // Dobrzenia Wielkiego działała offline bez dziur na krawędzi.
  tileBbox: { minLat: 50.55, maxLat: 50.8, minLon: 17.7, maxLon: 18.1 },
  // Mniejsza strefa niż Szczecin (0,10 vs 0,12 deg2), więc ~8 MB w z14 z gzipem.
  tileMaxZoom: 14,
  tilePackMB: 8,
  // Opole nie ma tramwajów ani kolei z publicznym GTFS (wszystkie 27 linii
  // MZK to autobusy, route_type 3). MZK nie ma publicznego bus_position.
  railGateways: ['Opole Główne'],
  features: { cable: false, campusPois: false, regionalRail: false, live: true, news: true, directBusPosition: false },
};

const RZESZOW: CityDef = {
  id: 'rzeszow',
  name: 'Rzeszów',
  center: { lat: 50.0412, lon: 21.9991 },
  // Strefa ZTM z gminami ościennymi (Albigowa na wschodzie, Hermanowa
  // na zachodzie): najdalszy przystanek to Albigowa (~17 km od centrum).
  radiusM: 20_000,
  bounds: { minLat: 49.9, maxLat: 50.15, minLon: 21.78, maxLon: 22.26 },
  nominatimViewbox: '21.78,50.15,22.26,49.9',
  overpassBbox: '49.90,21.78,50.15,22.26',
  // zbiorkom.live nazywa miasto `rzeszow` (agencje `default` i `PKSRZESZOW`);
  // filtr w zbiorkom.ts zostawia samo `default`, bbox jak bounds.
  zbiorkomSlug: 'rzeszow',
  zbiorkomBbox: '21.78,49.9,22.26,50.15',
  dbFile: 'kilometr-gtfs-rzeszow.db',
  tilePack: 'rzeszow-tiles.ktp',
  // Kafle pokrywają całą strefę (jak bounds i live), żeby trasa do Albigowej
  // działała offline bez dziur na krawędzi.
  tileBbox: { minLat: 49.9, maxLat: 50.15, minLon: 21.78, maxLon: 22.26 },
  // Mała strefa jak Szczecin (621 kafli w z0-14), więc ~10 MB w z14 z gzipem.
  tileMaxZoom: 14,
  tilePackMB: 10,
  // Kolej nie ma publicznego GTFS ani feedu live w bboxie (sprawdzone:
  // zbiorkom `pkp` zwraca tu zero pojazdów). ZTM nie ma publicznego
  // bus_position.
  railGateways: ['Rzeszów Główny'],
  features: { cable: false, campusPois: false, regionalRail: false, live: true, news: true, directBusPosition: false },
};

const LUBLIN: CityDef = {
  id: 'lublin',
  name: 'Lublin',
  center: { lat: 51.2465, lon: 22.5684 },
  // Strefa ZDiTM z gminami ościennymi (Świdnik na wschodzie, Niemce na
  // północy, Głusk na południu): najdalsze przystanki z GTFS to ~18 km
  // od centrum (51.09 na południu, 51.40 na północy).
  radiusM: 20_000,
  bounds: { minLat: 51.05, maxLat: 51.42, minLon: 22.3, maxLon: 22.8 },
  nominatimViewbox: '22.3,51.42,22.8,51.05',
  overpassBbox: '51.05,22.30,51.42,22.80',
  // zbiorkom.live nazywa miasto `lublin` (jedna agencja `default`,
  // więc bez filtra); bbox jak bounds.
  zbiorkomSlug: 'lublin',
  zbiorkomBbox: '22.3,51.05,22.8,51.42',
  dbFile: 'kilometr-gtfs-lublin.db',
  tilePack: 'lublin-tiles.ktp',
  // Kafle pokrywają całą strefę (jak bounds i live), żeby trasa do Świdnika
  // czy Niemiec działała offline bez dziur na krawędzi.
  tileBbox: { minLat: 51.05, maxLat: 51.42, minLon: 22.3, maxLon: 22.8 },
  // Strefa 0,19 deg2 (między Szczecinem a Łodzią), więc ~14 MB w z14 z gzipem.
  tileMaxZoom: 14,
  tilePackMB: 14,
  // Kolej (POLREGIO/IC przez Lublin) nie ma publicznego GTFS w zakresie
  // budowy, więc matcher nie miałby do czego spinać pojazdów z `pkp`.
  // ZDiTM nie ma publicznego bus_position.
  railGateways: ['Lublin Główny'],
  features: { cable: false, campusPois: false, regionalRail: false, live: true, news: true, directBusPosition: false },
};

const RADOM: CityDef = {
  id: 'radom',
  name: 'Radom',
  center: { lat: 51.4027, lon: 21.1471 },
  // Miasto zwarte z liniami podmiejskimi (Milejowice i Godów na północy,
  // Wolanowska na południowym zachodzie): najdalszy przystanek GTFS
  // to ok. 13 km od centrum.
  radiusM: 18_000,
  bounds: { minLat: 51.28, maxLat: 51.5, minLon: 21.0, maxLon: 21.36 },
  nominatimViewbox: '21.0,51.5,21.36,51.28',
  overpassBbox: '51.28,21.00,51.50,21.36',
  // zbiorkom.live nazywa miasto `radom` (jedna agencja `default`,
  // więc bez filtra); bbox jak bounds.
  zbiorkomSlug: 'radom',
  zbiorkomBbox: '21.0,51.28,21.36,51.5',
  dbFile: 'kilometr-gtfs-radom.db',
  tilePack: 'radom-tiles.ktp',
  // Kafle pokrywają całą strefę (jak bounds i live), żeby trasa
  // do Milejowic działała offline bez dziur na krawędzi.
  tileBbox: { minLat: 51.28, maxLat: 51.5, minLon: 21.0, maxLon: 21.36 },
  // Mniejsza strefa niż Szczecin (0,08 vs 0,12 deg2), ale gęste centrum:
  // pomiar próbką kafli z z14 (gzip -9) daje ~9,8 MB.
  tileMaxZoom: 14,
  tilePackMB: 10,
  // Same autobusy MZDiK (linie 1-27 i nocne N1-N3, route_type 3 w GTFS).
  // Kolei regionalnej nie ma w buildzie (KM dojeżdża do Radomia, ale
  // statyczny feed mamy tylko dla obwiedni Warszawy), więc miasto jedzie
  // bez sekcji kolejowej jak Szczecin. MZDiK nie ma publicznego bus_position.
  railGateways: ['Radom Główny'],
  features: { cable: false, campusPois: false, regionalRail: false, live: true, news: true, directBusPosition: false },
};

const BYDGOSZCZ: CityDef = {
  id: 'bydgoszcz',
  name: 'Bydgoszcz',
  center: { lat: 53.1235, lon: 18.0117 },
  // Feed ZDMiKP obejmuje miasto z gminami ościennymi (Zławieś Wielka na
  // wschodzie, Wudzyn na północy, Tarkowo Dolne na południu): najdalszy
  // przystanek feedu to ~33 km.
  radiusM: 33_000,
  bounds: { minLat: 52.94, maxLat: 53.34, minLon: 17.78, maxLon: 18.35 },
  nominatimViewbox: '17.78,53.34,18.35,52.94',
  overpassBbox: '52.94,17.78,53.34,18.35',
  // zbiorkom.live nie ma Bydgoszczy (CITY_NOT_FOUND), więc miasto jedzie
  // wyłącznie na rozkładzie; features.live gaśnie polling i chip „brak live”.
  zbiorkomSlug: 'bydgoszcz',
  zbiorkomBbox: '17.78,52.94,18.35,53.34',
  dbFile: 'kilometr-gtfs-bydgoszcz.db',
  tilePack: 'bydgoszcz-tiles.ktp',
  tileBbox: { minLat: 52.94, maxLat: 53.34, minLon: 17.78, maxLon: 18.35 },
  // Strefa 0,23 deg2 (jak połowa Łodzi), w z14 z gzipem ok. 20 MB (szacunek
  // z gęstości Łodzi; do weryfikacji przy pierwszym buildzie kafli).
  tileMaxZoom: 14,
  tilePackMB: 20,
  // Tramwaje (10 tras, route_type 0) i autobusy ZDMiKP; kolej regionalna
  // nie ma publicznego GTFS, więc bez sekcji kolejowej jak Radom.
  railGateways: ['Bydgoszcz Główna'],
  features: { cable: false, campusPois: false, regionalRail: false, live: false, news: false, directBusPosition: false },
};

const TORUN: CityDef = {
  id: 'torun',
  name: 'Toruń',
  center: { lat: 53.0138, lon: 18.5983 },
  // Feed MZK obejmuje miasto z gminami ościennymi (Gronowo na północy,
  // Osiek na południu, Zławieś Wielka na zachodzie): najdalszy przystanek
  // feedu to ~26 km.
  radiusM: 26_000,
  bounds: { minLat: 52.91, maxLat: 53.11, minLon: 18.31, maxLon: 18.94 },
  nominatimViewbox: '18.31,53.11,18.94,52.91',
  overpassBbox: '52.91,18.31,53.11,18.94',
  // zbiorkom.live nazywa miasto `torun` (agencja `default`); bbox jak bounds.
  zbiorkomSlug: 'torun',
  zbiorkomBbox: '18.31,52.91,18.94,53.11',
  dbFile: 'kilometr-gtfs-torun.db',
  tilePack: 'torun-tiles.ktp',
  tileBbox: { minLat: 52.91, maxLat: 53.11, minLon: 18.31, maxLon: 18.94 },
  // Strefa 0,13 deg2 (między Szczecinem a Łodzią), w z14 z gzipem ok. 12 MB.
  tileMaxZoom: 14,
  tilePackMB: 12,
  // Tramwaje 1-8 (route_type 0) i autobusy MZK; kolej bez publicznego GTFS.
  railGateways: ['Toruń Główny'],
  features: { cable: false, campusPois: false, regionalRail: false, live: true, news: false, directBusPosition: false },
};

const ELBLAG: CityDef = {
  id: 'elblag',
  name: 'Elbląg',
  center: { lat: 54.1522, lon: 19.3947 },
  // Sieć ZKM to miasto z gminami ościennymi (Próchnik na północy, Majewo
  // na wschodzie, Nowakowo na zachodzie): najdalszy przystanek feedu
  // to ~17 km od Rynku.
  radiusM: 17_000,
  bounds: { minLat: 54.12, maxLat: 54.25, minLon: 19.33, maxLon: 19.59 },
  nominatimViewbox: '19.33,54.25,19.59,54.12',
  overpassBbox: '54.12,19.33,54.25,19.59',
  // zbiorkom.live nazywa miasto `elblag` (agencja `default`); bbox jak bounds.
  zbiorkomSlug: 'elblag',
  zbiorkomBbox: '19.33,54.12,19.59,54.25',
  dbFile: 'kilometr-gtfs-elblag.db',
  tilePack: 'elblag-tiles.ktp',
  tileBbox: { minLat: 54.12, maxLat: 54.25, minLon: 19.33, maxLon: 19.59 },
  // Mała strefa (0,03 deg2, najmniejsza z miast), w z14 z gzipem ok. 4 MB.
  tileMaxZoom: 14,
  tilePackMB: 4,
  // Tramwaje 1-5 (route_type 0) i autobusy ZKM; kolej bez publicznego GTFS.
  railGateways: ['Elbląg'],
  features: { cable: false, campusPois: false, regionalRail: false, live: true, news: false, directBusPosition: false },
};

const GORZOW: CityDef = {
  id: 'gorzow',
  name: 'Gorzów Wielkopolski',
  center: { lat: 52.733, lon: 15.233 },
  // Sieć MZK to miasto z gminami ościennymi (Łagodzin na południu,
  // Stanowice na zachodzie, Czechów na wschodzie): najdalszy przystanek
  // feedu to ~15 km.
  radiusM: 15_000,
  bounds: { minLat: 52.67, maxLat: 52.78, minLon: 15.03, maxLon: 15.34 },
  nominatimViewbox: '15.03,52.78,15.34,52.67',
  overpassBbox: '52.67,15.03,52.78,15.34',
  // zbiorkom.live nazywa miasto `gorzow` (agencja `default`); bbox jak bounds.
  zbiorkomSlug: 'gorzow',
  zbiorkomBbox: '15.03,52.67,15.34,52.78',
  dbFile: 'kilometr-gtfs-gorzow.db',
  tilePack: 'gorzow-tiles.ktp',
  tileBbox: { minLat: 52.67, maxLat: 52.78, minLon: 15.03, maxLon: 15.34 },
  // Mała strefa jak Elbląg (0,03 deg2), w z14 z gzipem ok. 4 MB.
  tileMaxZoom: 14,
  tilePackMB: 4,
  // Tramwaje 1-4 (route_type 0) i autobusy MZK; kolej bez publicznego GTFS.
  railGateways: ['Gorzów Wielkopolski'],
  features: { cable: false, campusPois: false, regionalRail: false, live: true, news: false, directBusPosition: false },
};

const CZESTOCHOWA: CityDef = {
  id: 'czestochowa',
  name: 'Częstochowa',
  center: { lat: 50.812, lon: 19.124 },
  // Sieć MPK to miasto z gminami ościennymi (Blachownia na zachodzie,
  // Rząsawa na północy, Wancerzów na wschodzie): najdalszy przystanek
  // feedu to ~16 km od centrum.
  radiusM: 16_000,
  bounds: { minLat: 50.72, maxLat: 50.89, minLon: 18.95, maxLon: 19.3 },
  nominatimViewbox: '18.95,50.89,19.3,50.72',
  overpassBbox: '50.72,18.95,50.89,19.30',
  // zbiorkom.live nazywa miasto `czestochowa` (agencja `default`); bbox jak bounds.
  zbiorkomSlug: 'czestochowa',
  zbiorkomBbox: '18.95,50.72,19.3,50.89',
  dbFile: 'kilometr-gtfs-czestochowa.db',
  tilePack: 'czestochowa-tiles.ktp',
  tileBbox: { minLat: 50.72, maxLat: 50.89, minLon: 18.95, maxLon: 19.3 },
  // Strefa jak Rybnik (0,06 deg2), w z14 z gzipem ok. 7 MB.
  tileMaxZoom: 14,
  tilePackMB: 7,
  // Tramwaje 1-3 (route_type 0) i autobusy MPK; kolej bez publicznego GTFS.
  railGateways: ['Częstochowa'],
  features: { cable: false, campusPois: false, regionalRail: false, live: true, news: false, directBusPosition: false },
};

const ZIELONAGORA: CityDef = {
  id: 'zielonagora',
  name: 'Zielona Góra',
  center: { lat: 51.939, lon: 15.506 },
  // Sieć MZK to miasto z gminami ościennymi (Przylep na zachodzie,
  // Krępa na północy, Droszków na wschodzie): najdalszy przystanek
  // feedu to ~17 km od Rynku.
  radiusM: 17_000,
  bounds: { minLat: 51.82, maxLat: 52.01, minLon: 15.43, maxLon: 15.67 },
  nominatimViewbox: '15.43,52.01,15.67,51.82',
  overpassBbox: '51.82,15.43,52.01,15.67',
  // zbiorkom.live nie ma Zielonej Góry (CITY_NOT_FOUND), więc miasto jedzie
  // wyłącznie na rozkładzie; features.live gaśnie polling i chip „brak live”.
  zbiorkomSlug: 'zielonagora',
  zbiorkomBbox: '15.43,51.82,15.67,52.01',
  dbFile: 'kilometr-gtfs-zielonagora.db',
  tilePack: 'zielonagora-tiles.ktp',
  tileBbox: { minLat: 51.82, maxLat: 52.01, minLon: 15.43, maxLon: 15.67 },
  // Strefa nieco mniejsza niż Rybnik (0,05 deg2), w z14 z gzipem ok. 5 MB.
  tileMaxZoom: 14,
  tilePackMB: 5,
  // Cała sieć MZK to autobusy (route_type 3, także linie 1-2); kolej
  // bez publicznego GTFS.
  railGateways: ['Zielona Góra Główna'],
  features: { cable: false, campusPois: false, regionalRail: false, live: false, news: false, directBusPosition: false },
};

const RYBNIK: CityDef = {
  id: 'rybnik',
  name: 'Rybnik',
  center: { lat: 50.0972, lon: 18.5414 },
  // Sieć KM to miasto z gminami ościennymi (Żory na wschodzie, Świerklany
  // i Lyski na południu): najdalszy przystanek feedu to ~12 km od Rynku.
  // Promień 13 km, nie 17: większy sięgałby Knurova (16,7 km), który jest
  // w GZM i tam wygrywa najbliższe centrum.
  radiusM: 13_000,
  bounds: { minLat: 49.99, maxLat: 50.2, minLon: 18.37, maxLon: 18.71 },
  nominatimViewbox: '18.37,50.2,18.71,49.99',
  overpassBbox: '49.99,18.37,50.20,18.71',
  // zbiorkom.live nazywa miasto `rybnik`; filtr `agencies=default` (jak
  // Białystok) odcina agencję JASTRZEBIE: linie ZKM Jastrzębie-Zdrój nie
  // są w GTFS KM Rybnik, więc ich pojazdy wisiałyby jako kropki bez
  // rozkładu. Bbox jak bounds.
  zbiorkomSlug: 'rybnik',
  zbiorkomBbox: '18.37,49.99,18.71,50.2',
  dbFile: 'kilometr-gtfs-rybnik.db',
  tilePack: 'rybnik-tiles.ktp',
  tileBbox: { minLat: 49.99, maxLat: 50.2, minLon: 18.37, maxLon: 18.71 },
  // Strefa jak Częstochowa (0,07 deg2), w z14 z gzipem ok. 7 MB.
  tileMaxZoom: 14,
  tilePackMB: 7,
  // Same autobusy KM (route_type 3); kolej bez publicznego GTFS.
  railGateways: ['Rybnik'],
  features: { cable: false, campusPois: false, regionalRail: false, live: true, news: false, directBusPosition: false },
};

const SLUPSK: CityDef = {
  id: 'slupsk',
  name: 'Słupsk',
  center: { lat: 54.464, lon: 17.047 },
  // Sieć ZIM to zwarte miasto z gminami ościennymi (Strzelinko na północy,
  // Krępa Słupska na południu, Redzikowo na wschodzie): najdalszy
  // przystanek feedu to ~11 km od Rynku.
  radiusM: 11_000,
  bounds: { minLat: 54.4, maxLat: 54.52, minLon: 16.93, maxLon: 17.16 },
  nominatimViewbox: '16.93,54.52,17.16,54.4',
  overpassBbox: '54.40,16.93,54.52,17.16',
  // zbiorkom.live nazywa miasto `slupsk` (agencja `default`); bbox jak bounds.
  zbiorkomSlug: 'slupsk',
  zbiorkomBbox: '16.93,54.4,17.16,54.52',
  dbFile: 'kilometr-gtfs-slupsk.db',
  tilePack: 'slupsk-tiles.ktp',
  tileBbox: { minLat: 54.4, maxLat: 54.52, minLon: 16.93, maxLon: 17.16 },
  // Mała strefa jak Elbląg (0,03 deg2), w z14 z gzipem ok. 4 MB.
  tileMaxZoom: 14,
  tilePackMB: 4,
  // Same autobusy ZIM (route_type 3); kolej bez publicznego GTFS.
  railGateways: ['Słupsk'],
  features: { cable: false, campusPois: false, regionalRail: false, live: true, news: false, directBusPosition: false },
};

const WALBRZYCH: CityDef = {
  id: 'walbrzych',
  name: 'Wałbrzych',
  center: { lat: 50.771, lon: 16.25 },
  // Feed ODT (MZUK) obejmuje miasto i gminy powiatu wałbrzyskiego
  // (Chwaliszów na północy, Głuszyca na wschodzie, Gostków na zachodzie),
  // a południową krawędzią sięga granicy czeskiej: najdalszy przystanek
  // to ~22 km.
  radiusM: 22_000,
  bounds: { minLat: 50.61, maxLat: 50.87, minLon: 16.08, maxLon: 16.4 },
  nominatimViewbox: '16.08,50.87,16.40,50.61',
  overpassBbox: '50.61,16.08,50.87,16.40',
  // zbiorkom.live nazywa miasto `walbrzych` (agencja `default`); bbox jak bounds.
  zbiorkomSlug: 'walbrzych',
  zbiorkomBbox: '16.08,50.61,16.40,50.87',
  dbFile: 'kilometr-gtfs-walbrzych.db',
  tilePack: 'walbrzych-tiles.ktp',
  tileBbox: { minLat: 50.61, maxLat: 50.87, minLon: 16.08, maxLon: 16.4 },
  // Strefa jak połowa Kielc (0,08 deg2), w z14 z gzipem ok. 8 MB.
  tileMaxZoom: 14,
  tilePackMB: 8,
  // Same autobusy MZUK (route_type 3); kolej bez publicznego GTFS.
  railGateways: ['Wałbrzych Główny'],
  features: { cable: false, campusPois: false, regionalRail: false, live: true, news: false, directBusPosition: false },
};

const KALISZ: CityDef = {
  id: 'kalisz',
  name: 'Kalisz',
  center: { lat: 51.765, lon: 18.083 },
  // Trzy feedy kasznia.net: KLA (miasto z Opatówkiem i Skalmierzycami),
  // przewoźnicy aglomeracji (Ostrów Wielkopolski, Pleszew) i PKS Kalisz.
  // Strefa sięga Ostrowa Wielkopolskiego (~22 km) i Pleszewa (~17 km);
  // pojedyncze przystanki podmiejskie (Konin) zostają w bazie poza strefą.
  radiusM: 30_000,
  bounds: { minLat: 51.6, maxLat: 51.92, minLon: 17.75, maxLon: 18.35 },
  nominatimViewbox: '17.75,51.92,18.35,51.60',
  overpassBbox: '51.60,17.75,51.92,18.35',
  // zbiorkom.live nazywa miasto `kalisz` (agencja `default`); bbox jak bounds.
  zbiorkomSlug: 'kalisz',
  zbiorkomBbox: '17.75,51.60,18.35,51.92',
  dbFile: 'kilometr-gtfs-kalisz.db',
  tilePack: 'kalisz-tiles.ktp',
  tileBbox: { minLat: 51.6, maxLat: 51.92, minLon: 17.75, maxLon: 18.35 },
  // Strefa 0,19 deg2 (jak Lublin), w z14 z gzipem ok. 18 MB.
  tileMaxZoom: 14,
  tilePackMB: 18,
  // Same autobusy (KLA i przewoźnicy, route_type 3); kolej bez publicznego GTFS.
  railGateways: ['Kalisz'],
  features: { cable: false, campusPois: false, regionalRail: false, live: true, news: false, directBusPosition: false },
};

const SIEDLCE: CityDef = {
  id: 'siedlce',
  name: 'Siedlce',
  center: { lat: 52.167, lon: 22.283 },
  // Sieć MPK obejmuje miasto i powiat siedlecki (Suchożebry na północy,
  // Wiśniew na południu, Mordy na wschodzie): najdalszy przystanek
  // feedu to ~25 km.
  radiusM: 25_000,
  bounds: { minLat: 52.05, maxLat: 52.27, minLon: 22.11, maxLon: 22.59 },
  nominatimViewbox: '22.11,52.27,22.59,52.05',
  overpassBbox: '52.05,22.11,52.27,22.59',
  // zbiorkom.live nazywa miasto `siedlce` (agencja `default`); bbox jak bounds.
  zbiorkomSlug: 'siedlce',
  zbiorkomBbox: '22.11,52.05,22.59,52.27',
  dbFile: 'kilometr-gtfs-siedlce.db',
  tilePack: 'siedlce-tiles.ktp',
  tileBbox: { minLat: 52.05, maxLat: 52.27, minLon: 22.11, maxLon: 22.59 },
  // Strefa jak Toruń (0,11 deg2), w z14 z gzipem ok. 10 MB.
  tileMaxZoom: 14,
  tilePackMB: 10,
  // Same autobusy MPK (route_type 3); kolej bez publicznego GTFS.
  railGateways: ['Siedlce'],
  features: { cable: false, campusPois: false, regionalRail: false, live: true, news: false, directBusPosition: false },
};

const LOMZA: CityDef = {
  id: 'lomza',
  name: 'Łomża',
  center: { lat: 53.178, lon: 22.068 },
  // Sieć MPK to zwarte miasto (Marianowo na północy, Kraska na południu):
  // najdalszy przystanek feedu to ~7 km.
  radiusM: 7_000,
  bounds: { minLat: 53.13, maxLat: 53.23, minLon: 22.01, maxLon: 22.13 },
  nominatimViewbox: '22.01,53.23,22.13,53.13',
  overpassBbox: '53.13,22.01,53.23,22.13',
  // zbiorkom.live nie ma Łomży (CITY_NOT_FOUND), więc miasto jedzie
  // wyłącznie na rozkładzie; features.live gaśnie polling i chip „brak live”.
  zbiorkomSlug: 'lomza',
  zbiorkomBbox: '22.01,53.13,22.13,53.23',
  dbFile: 'kilometr-gtfs-lomza.db',
  tilePack: 'lomza-tiles.ktp',
  tileBbox: { minLat: 53.13, maxLat: 53.23, minLon: 22.01, maxLon: 22.13 },
  // Najmniejsza strefa z miast (0,01 deg2), w z14 z gzipem ok. 2 MB.
  tileMaxZoom: 14,
  tilePackMB: 2,
  // Same autobusy MPK (route_type 3); kolej bez publicznego GTFS.
  railGateways: ['Łomża'],
  features: { cable: false, campusPois: false, regionalRail: false, live: false, news: false, directBusPosition: false },
};

const KROSNO: CityDef = {
  id: 'krosno',
  name: 'Krosno',
  center: { lat: 49.687, lon: 21.746 },
  // Sieć MKS obejmuje miasto i powiat krośnieński (Łęki Strzyżowskie
  // na północy, Iskrzynia na wschodzie, Potakówka na zachodzie):
  // najdalszy przystanek to ~21 km.
  radiusM: 21_000,
  bounds: { minLat: 49.61, maxLat: 49.84, minLon: 21.58, maxLon: 21.89 },
  nominatimViewbox: '21.58,49.84,21.89,49.61',
  overpassBbox: '49.61,21.58,49.84,21.89',
  // zbiorkom.live nazywa miasto `krosno` (agencja `default`); bbox jak bounds.
  zbiorkomSlug: 'krosno',
  zbiorkomBbox: '21.58,49.61,21.89,49.84',
  dbFile: 'kilometr-gtfs-krosno.db',
  tilePack: 'krosno-tiles.ktp',
  tileBbox: { minLat: 49.61, maxLat: 49.84, minLon: 21.58, maxLon: 21.89 },
  // Strefa jak Rybnik (0,07 deg2), w z14 z gzipem ok. 7 MB.
  tileMaxZoom: 14,
  tilePackMB: 7,
  // Same autobusy MKS (route_type 3); kolej bez publicznego GTFS.
  railGateways: ['Krosno'],
  features: { cable: false, campusPois: false, regionalRail: false, live: true, news: false, directBusPosition: false },
};

const JASLO: CityDef = {
  id: 'jaslo',
  name: 'Jasło',
  center: { lat: 49.745, lon: 21.473 },
  // Sieć MKS obejmuje miasto i powiat jasielski (Błażkowa na północy,
  // Ciejklin na południu, Łączki Jagiellońskie na wschodzie): najdalszy
  // przystanek feedu to ~22 km.
  radiusM: 22_000,
  bounds: { minLat: 49.63, maxLat: 49.86, minLon: 21.33, maxLon: 21.71 },
  nominatimViewbox: '21.33,49.86,21.71,49.63',
  overpassBbox: '49.63,21.33,49.86,21.71',
  // zbiorkom.live nie ma Jasła (CITY_NOT_FOUND), więc miasto jedzie
  // wyłącznie na rozkładzie; features.live gaśnie polling i chip „brak live”.
  zbiorkomSlug: 'jaslo',
  zbiorkomBbox: '21.33,49.63,21.71,49.86',
  dbFile: 'kilometr-gtfs-jaslo.db',
  tilePack: 'jaslo-tiles.ktp',
  tileBbox: { minLat: 49.63, maxLat: 49.86, minLon: 21.33, maxLon: 21.71 },
  // Strefa jak Wałbrzych (0,09 deg2), w z14 z gzipem ok. 8 MB.
  tileMaxZoom: 14,
  tilePackMB: 8,
  // Same autobusy MKS (route_type 3); kolej bez publicznego GTFS.
  railGateways: ['Jasło'],
  features: { cable: false, campusPois: false, regionalRail: false, live: false, news: false, directBusPosition: false },
};

const OLKUSZ: CityDef = {
  id: 'olkusz',
  name: 'Olkusz',
  center: { lat: 50.281, lon: 19.562 },
  // Sieć ZKGKM obejmuje miasto i powiat olkuski (Bukowno i Klucze na
  // północy, Hucisko na północnym wschodzie): najdalszy przystanek
  // feedu to ~21 km.
  radiusM: 21_000,
  bounds: { minLat: 50.19, maxLat: 50.42, minLon: 19.37, maxLon: 19.7 },
  nominatimViewbox: '19.37,50.42,19.70,50.19',
  overpassBbox: '50.19,19.37,50.42,19.70',
  // zbiorkom.live nie ma Olkusza (CITY_NOT_FOUND), więc miasto jedzie
  // wyłącznie na rozkładzie; features.live gaśnie polling i chip „brak live”.
  zbiorkomSlug: 'olkusz',
  zbiorkomBbox: '19.37,50.19,19.70,50.42',
  dbFile: 'kilometr-gtfs-olkusz.db',
  tilePack: 'olkusz-tiles.ktp',
  tileBbox: { minLat: 50.19, maxLat: 50.42, minLon: 19.37, maxLon: 19.7 },
  // Strefa jak Krosno (0,08 deg2), w z14 z gzipem ok. 7 MB.
  tileMaxZoom: 14,
  tilePackMB: 7,
  // Same autobusy ZKGKM (route_type 3); kolej bez publicznego GTFS.
  railGateways: ['Olkusz'],
  features: { cable: false, campusPois: false, regionalRail: false, live: false, news: false, directBusPosition: false },
};

const CHRZANOW: CityDef = {
  id: 'chrzanow',
  name: 'Chrzanów',
  center: { lat: 50.133, lon: 19.402 },
  // Sieć ZKKM obejmuje powiat chrzanowski (Trzebinia i Libiąż na zachodzie,
  // Chełmek na północnym zachodzie): najdalszy przystanek feedu to ~14 km.
  // Chełmu Śląskiemu (gmina GZM, ~14,5 km od Chrzanowa) promień świadomie
  // nie sięga: najbliższe centrum wygrywa w suggestCityForCoords.
  radiusM: 14_000,
  bounds: { minLat: 50.03, maxLat: 50.22, minLon: 19.21, maxLon: 19.58 },
  nominatimViewbox: '19.21,50.22,19.58,50.03',
  overpassBbox: '50.03,19.21,50.22,19.58',
  // zbiorkom.live nie ma Chrzanowa (CITY_NOT_FOUND), więc miasto jedzie
  // wyłącznie na rozkładzie; features.live gaśnie polling i chip „brak live”.
  zbiorkomSlug: 'chrzanow',
  zbiorkomBbox: '19.21,50.03,19.58,50.22',
  dbFile: 'kilometr-gtfs-chrzanow.db',
  tilePack: 'chrzanow-tiles.ktp',
  tileBbox: { minLat: 50.03, maxLat: 50.22, minLon: 19.21, maxLon: 19.58 },
  // Strefa jak Rybnik (0,07 deg2), w z14 z gzipem ok. 7 MB.
  tileMaxZoom: 14,
  tilePackMB: 7,
  // Same autobusy ZKKM (route_type 3); kolej bez publicznego GTFS.
  railGateways: ['Chrzanów'],
  features: { cable: false, campusPois: false, regionalRail: false, live: false, news: false, directBusPosition: false },
};

const BOCHNIA: CityDef = {
  id: 'bochnia',
  name: 'Bochnia',
  center: { lat: 49.968, lon: 20.434 },
  // Sieć RPK obejmuje miasto i powiat bocheński (Cerekiew na północy,
  // Okulice na wschodzie, Stradomka na zachodzie): najdalszy przystanek
  // feedu to ~18 km.
  radiusM: 18_000,
  bounds: { minLat: 49.88, maxLat: 50.1, minLon: 20.3, maxLon: 20.55 },
  nominatimViewbox: '20.30,50.10,20.55,49.88',
  overpassBbox: '49.88,20.30,50.10,20.55',
  // zbiorkom.live nie ma Bochni (CITY_NOT_FOUND), więc miasto jedzie
  // wyłącznie na rozkładzie; features.live gaśnie polling i chip „brak live”.
  zbiorkomSlug: 'bochnia',
  zbiorkomBbox: '20.30,49.88,20.55,50.10',
  dbFile: 'kilometr-gtfs-bochnia.db',
  tilePack: 'bochnia-tiles.ktp',
  tileBbox: { minLat: 49.88, maxLat: 50.1, minLon: 20.3, maxLon: 20.55 },
  // Strefa jak połowa Lublina (0,06 deg2), w z14 z gzipem ok. 6 MB.
  tileMaxZoom: 14,
  tilePackMB: 6,
  // Same autobusy RPK (route_type 3); kolej bez publicznego GTFS.
  railGateways: ['Bochnia'],
  features: { cable: false, campusPois: false, regionalRail: false, live: false, news: false, directBusPosition: false },
};

const ILAWA: CityDef = {
  id: 'ilawa',
  name: 'Iława',
  center: { lat: 53.596, lon: 19.568 },
  // Sieć ZKM to zwarte miasto (Nowa Wieś na wschodzie): najdalszy
  // przystanek feedu to ~5 km od centrum. Jeden przystanek ma w feedzie
  // błędne współrzędne (53.89), strefa go świadomie nie obejmuje.
  radiusM: 5_000,
  bounds: { minLat: 53.55, maxLat: 53.63, minLon: 19.52, maxLon: 19.62 },
  nominatimViewbox: '19.52,53.63,19.62,53.55',
  overpassBbox: '53.55,19.52,53.63,19.62',
  // zbiorkom.live nie ma Iławy (CITY_NOT_FOUND), więc miasto jedzie
  // wyłącznie na rozkładzie; features.live gaśnie polling i chip „brak live”.
  zbiorkomSlug: 'ilawa',
  zbiorkomBbox: '19.52,53.55,19.62,53.63',
  dbFile: 'kilometr-gtfs-ilawa.db',
  tilePack: 'ilawa-tiles.ktp',
  tileBbox: { minLat: 53.55, maxLat: 53.63, minLon: 19.52, maxLon: 19.62 },
  // Najmniejsza strefa razem z Łomżą, w z14 z gzipem ok. 2 MB.
  tileMaxZoom: 14,
  tilePackMB: 2,
  // Same autobusy ZKM (route_type 3); kolej bez publicznego GTFS.
  railGateways: ['Iława Główna'],
  features: { cable: false, campusPois: false, regionalRail: false, live: false, news: false, directBusPosition: false },
};

export const CITIES: readonly CityDef[] = [
  WROCLAW, KRAKOW, GZM, WARSZAWA, POZNAN, TROJMIASTO, LODZ, SZCZECIN, KIELCE, OLSZTYN,
  BIALYSTOK, OPOLE, RZESZOW, LUBLIN, RADOM,
  BYDGOSZCZ, TORUN, ELBLAG, GORZOW, CZESTOCHOWA, ZIELONAGORA, RYBNIK, SLUPSK, WALBRZYCH,
  KALISZ, SIEDLCE, LOMZA, KROSNO, JASLO, OLKUSZ, CHRZANOW, BOCHNIA, ILAWA,
];

export const DEFAULT_CITY_ID: CityId = 'wroclaw';

export function getCity(id: string | null | undefined): CityDef {
  return CITIES.find((c) => c.id === id) ?? WROCLAW;
}

export function isCityId(id: string | null | undefined): id is CityId {
  return CITIES.some((c) => c.id === id);
}

/**
 * Metropolia z wieloma miastami w jednej strefie (GZM, Trójmiasto). Tu sama
 * ulica i dzielnica nie mówią, w którym mieście jest wynik, więc UI dopisuje
 * nazwę miasta do adresów w wyszukiwarce, zapisanych miejscach i historii.
 */
export function isMultiCityArea(id: CityId): boolean {
  return id === 'gzm' || id === 'trojmiasto';
}

/**
 * Klucz KV per-miasto. Wrocław trzyma legacy klucz bez sufiksu (kompat
 * ze starymi instalacjami), reszta miast dokleja `.id`. Jawny parametr,
 * bez odczytu aktywnego miasta: funkcja jest czysta i testowalna.
 */
export function cityKey(base: string, cityId: CityId): string {
  return cityId === 'wroclaw' ? base : `${base}.${cityId}`;
}

/** Haversine w metrach. */
function cityDistanceM(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const R = 6_371_000;
  const dLa = ((bLat - aLat) * Math.PI) / 180;
  const dLo = ((bLon - aLon) * Math.PI) / 180;
  const s =
    Math.sin(dLa / 2) ** 2 +
    Math.cos((aLat * Math.PI) / 180) * Math.cos((bLat * Math.PI) / 180) * Math.sin(dLo / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

/** Miasto dla współrzędnych: miasto obejmujące punkt (w granicach bboxa lub promienia), wybierane wg najmniejszej odległości do centrum. */
export function suggestCityForCoords(lat: number, lon: number): CityDef | null {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  let best: CityDef | null = null;
  let bestDist = Infinity;
  for (const c of CITIES) {
    const d = cityDistanceM(lat, lon, c.center.lat, c.center.lon);
    const inBounds = inCityBounds(c, lat, lon);
    const inRadius = d <= c.radiusM;
    if ((inBounds || inRadius) && d < bestDist) {
      best = c;
      bestDist = d;
    }
  }
  return best;
}

/** Ścisły filtr: punkt w bboxie miasta. */
export function inCityBounds(city: CityDef, lat: number, lon: number): boolean {
  return (
    Number.isFinite(lat) &&
    Number.isFinite(lon) &&
    lat >= city.bounds.minLat &&
    lat <= city.bounds.maxLat &&
    lon >= city.bounds.minLon &&
    lon <= city.bounds.maxLon
  );
}

/** True, gdy pozycja jest poza strefą danego miasta (zarówno poza bboxem, jak i poza promieniem od centrum). */
export function isOutsideCity(city: CityDef, lat: number, lon: number): boolean {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return false;
  if (inCityBounds(city, lat, lon)) return false;
  return cityDistanceM(lat, lon, city.center.lat, city.center.lon) > city.radiusM;
}

/** Rozpoznaje id obsługiwanego miasta na podstawie nazwy miejscowości (np. z geocodera). */
export function resolveSupportedCityId(name?: string | null): CityId | undefined {
  if (!name) return undefined;
  const n = name
    .trim()
    .toLocaleLowerCase()
    .replace(/^(gmina|miasto|powiat|wieś)\s+/i, '');
  const direct = CITIES.find((c) => c.name.toLocaleLowerCase() === n || c.id === n);
  if (direct) return direct.id;

  // GZM (Metropolia Górnośląsko-Zagłębiowska) – 41 gmin członkowskich i kluczowe miejscowości
  if (
    [
      'katowice',
      'gliwice',
      'sosnowiec',
      'zabrze',
      'bytom',
      'ruda śląska',
      'tychy',
      'dąbrowa górnicza',
      'chorzów',
      'jaworzno',
      'mysłowice',
      'siemianowice śląskie',
      'tarnowskie góry',
      'piekary śląskie',
      'będzin',
      'świętochłowice',
      'mikołów',
      'czeladź',
      'knurów',
      'pyskowice',
      'radzionków',
      'łaziska górne',
      'bieruń',
      'lędziny',
      'siewierz',
      'sławków',
      'wojkowice',
      'imielin',
      'chełm śląski',
      'bojszowy',
      'kobiór',
      'wyry',
      'ornontowice',
      'gierałtowice',
      'pilchowice',
      'sośnicowice',
      'rudziniec',
      'zbrosławice',
      'świerklaniec',
      'ożarowice',
      'bobrowniki',
      'psary',
      'mierzęcice',
      'pyrzowice',
      'miasteczko śląskie',
      'kalety',
      'tworóg',
      'toszek',
      'wielowieś',
      'krupski młyn',
      'nakło śląskie',
      'orzech',
      'kozłowa góra',
      'gostyń',
      'kotulin',
      'pławniowice',
      'przyszowice',
      'paniówki',
      'chudów',
      'wieszowa',
      'czekanów',
      'przezchlebie',
      'miedary',
      'zendek',
      'sączów',
      'tąpkowice',
      'celiny',
      'sarnów',
      'preczów',
      'gródków',
      'strzyżowice',
      'ruda',
    ].includes(n)
  ) {
    return 'gzm';
  }

  // Trójmiasto (Gdańsk-Gdynia-Sopot i powiązane gminy)
  if (
    [
      'gdańsk',
      'gdynia',
      'sopot',
      'wejherowo',
      'rumia',
      'reda',
      'pruszcz gdański',
      'puck',
      'kosakowo',
      'kolbudy',
      'żukowo',
      'banino',
      'chwaszczyno',
      'kowale',
      'bolszewo',
      'luzino',
    ].includes(n)
  ) {
    return 'trojmiasto';
  }

  // Warszawa (aglomeracja / strefa ZTM)
  if (
    [
      'warszawa',
      'pruszków',
      'legionowo',
      'piaseczno',
      'otwock',
      'wołomin',
      'ząbki',
      'marki',
      'łomianki',
      'józefów',
      'sulejówek',
      'kobyłka',
      'zielonka',
      'ożarów mazowiecki',
      'grodzisk mazowiecki',
      'milanówek',
      'piastów',
      'raszyn',
      'konstancin-jeziorna',
      'nowy dwór mazowiecki',
      'jabłonna',
      'nieporęt',
      'radzymin',
      'halinów',
      'błonie',
      'lesznowola',
      'michałowice',
      'brwinów',
      'podkowa leśna',
      'izabelin',
      'stare babice',
    ].includes(n)
  ) {
    return 'warszawa';
  }

  // Łódź i aglomeracja
  if (
    [
      'łódź',
      'zgierz',
      'pabianice',
      'aleksandrów łódzki',
      'konstantynów łódzki',
      'stryków',
      'rzgów',
      'brzeziny',
      'andrespol',
    ].includes(n)
  ) {
    return 'lodz';
  }

  // Poznań i aglomeracja
  if (
    [
      'poznań',
      'swarzędz',
      'luboń',
      'tarnowo podgórne',
      'komorniki',
      'suchy las',
      'czerwonak',
      'kórnik',
      'mosina',
      'środa wielkopolska',
      'puszczykowo',
      'pobiedziska',
    ].includes(n)
  ) {
    return 'poznan';
  }

  // Wrocław i aglomeracja
  if (
    [
      'wrocław',
      'długołęka',
      'siechnice',
      'czernica',
      'kobierzyce',
      'kąty wrocławskie',
      'miękinia',
      'wisznia mała',
      'trzebnica',
      'sobótka',
      'żórawina',
      'jelcz-laskowice',
    ].includes(n)
  ) {
    return 'wroclaw';
  }

  // Kraków i aglomeracja
  if (
    [
      'kraków',
      'wieliczka',
      'skawina',
      'niepołomice',
      'zabierzów',
      'zielonki',
      'michałowice',
      'kocmyrzów-luborzyca',
      'mogilany',
      'liszki',
      'czernichów',
      'krzeszowice',
      'wielka wieś',
    ].includes(n)
  ) {
    return 'krakow';
  }

  // Kalisz i aglomeracja (feedy kasznia.net: KLA, przewoźnicy, PKS)
  if (['kalisz', 'ostrow wielkopolski', 'pleszew', 'opatówek', 'skalmierzyce'].includes(n)) {
    return 'kalisz';
  }

  // Olkusz i powiat olkuski (ZKGKM)
  if (['olkusz', 'bukowno', 'klucze', 'bolesław'].includes(n)) {
    return 'olkusz';
  }

  // Chrzanów i powiat chrzanowski (ZKKM)
  if (['chrzanów', 'trzebinia', 'libiąż', 'chełmek'].includes(n)) {
    return 'chrzanow';
  }

  // Wałbrzych i powiat wałbrzyski (MZUK)
  if (['wałbrzych', 'szczawno-zdrój', 'szczawno', 'stare bogaczowice'].includes(n)) {
    return 'walbrzych';
  }

  return undefined;
}
