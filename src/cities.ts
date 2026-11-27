// Rejestr obsługiwanych miast. Jedno miejsce na wszystko co specyficzne
// dla miasta: środek strefy, bboxy, feedy GTFS/live/news, kafle offline.
// Nowe miasto = jeden wpis tutaj + build workera. Zero ifów po id miasta
// w reszcie kodu: serwisy czytają aktywny wpis przez cityStore.

export type CityId =
  | 'wroclaw' | 'krakow' | 'gzm' | 'warszawa' | 'poznan' | 'trojmiasto' | 'lodz'
  | 'szczecin' | 'kielce' | 'olsztyn' | 'bialystok' | 'opole' | 'rzeszow' | 'lublin' | 'radom'
  | 'bydgoszcz' | 'torun' | 'elblag' | 'gorzow' | 'czestochowa' | 'zielonagora' | 'rybnik'
  | 'slupsk' | 'walbrzych' | 'kalisz' | 'siedlce' | 'lomza' | 'krosno' | 'jaslo'
  | 'olkusz' | 'chrzanow' | 'bochnia' | 'ilawa'
  | 'bielskobiala' | 'koszalin' | 'piotrkow' | 'tomaszow' | 'skarzysko' | 'oswiecim' | 'swinoujscie' | 'zakopane'
  | 'plock' | 'tarnow' | 'legnica' | 'jastrzebie' | 'pila' | 'konin' | 'suwalki' | 'ostrowiec'
  | 'stalowawola' | 'przemysl' | 'elk' | 'leszno' | 'chelm' | 'mielec' | 'tczew' | 'ostroleka'
  | 'starachowice' | 'kutno' | 'kolobrzeg' | 'radomsko' | 'boleslawiec' | 'cieszyn' | 'zywiec' | 'krasnik'
  | 'grodzisk' | 'pruszkow' | 'sochaczew' | 'minskmazowiecki' | 'otwock' | 'nowydwormaz' | 'zabki' | 'pabianice'
  | 'zgierz' | 'grudziadz' | 'stargard' | 'gniezno' | 'jaworzno' | 'kedzierzynkozle' | 'zamosc' | 'raciborz'
  | 'belchatow' | 'tarnobrzeg' | 'skierniewice' | 'zawiercie' | 'starogard' | 'zdunskawola' | 'nysa' | 'malbork'
  | 'sieradz' | 'szczecinek' | 'nowasol' | 'olesnica' | 'czechowicedziedzice' | 'ostroda' | 'nowytarg' | 'augustow'
  | 'ketrzyn' | 'zgorzelec' | 'polkowice' | 'gorlice' | 'jarocin' | 'wrzesnia' | 'walcz' | 'gizycko'
  | 'zagan' | 'koscierzyna' | 'krotoszyn' | 'sandomierz' | 'bartoszyce' | 'wielun' | 'mragowo' | 'swiecie'
  | 'wagrowiec' | 'bielskpodlaski' | 'dzialdowo' | 'brzesko' | 'gostyn' | 'chodziez' | 'lidzbarkwarminski' | 'pszczyna'
  | 'wodzislaw' | 'zabkowice' | 'strzelin' | 'srodaslaska' | 'jedrzejow' | 'kozienice' | 'oborniki' | 'wieliczka'
  | 'myszkow' | 'slubice' | 'kartuzy';

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
  /** Subdomena kiedyprzyjedzie.pl (np. grudziadz) dla feedów KP GTFS/live. */
  kpPrefix?: string;
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
    /** Dedykowana, wieloźródłowa baza POI w R2 (`{miasto}/db/kilometr-pois.db.gz`). */
    poiDb?: boolean;
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
  features: { cable: true, campusPois: true, regionalRail: true, live: true, news: true, directBusPosition: true, poiDb: true },
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
  features: { cable: false, campusPois: false, regionalRail: true, live: true, news: true, directBusPosition: false, poiDb: true },
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
  features: { cable: false, campusPois: false, regionalRail: true, live: true, news: true, directBusPosition: false, poiDb: true },
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
  features: { cable: false, campusPois: false, regionalRail: true, live: true, news: true, directBusPosition: false, poiDb: true },
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

const BIELSKOBIALA: CityDef = {
  id: 'bielskobiala',
  name: 'Bielsko-Biała',
  center: { lat: 49.8425, lon: 19.0454 },
  radiusM: 15_000,
  bounds: { minLat: 49.7274, maxLat: 49.9576, minLon: 18.945, maxLon: 19.1457 },
  nominatimViewbox: '18.945,49.9576,19.1457,49.7274',
  overpassBbox: '49.7274,18.945,49.9576,19.1457',
  zbiorkomSlug: 'bielskoBiala',
  zbiorkomBbox: '18.9494,49.7317,19.1416,49.9564',
  kpPrefix: 'bielsko',
  dbFile: 'kilometr-gtfs-bielskobiala.db',
  tilePack: 'bielskobiala-tiles.ktp',
  tileBbox: { minLat: 49.7274, maxLat: 49.9576, minLon: 18.945, maxLon: 19.1457 },
  tileMaxZoom: 14,
  tilePackMB: 5,
  railGateways: ['Bielsko-Biała Główna'],
  features: { cable: false, campusPois: false, regionalRail: false, live: true, news: false, directBusPosition: false },
};

const KOSZALIN: CityDef = {
  id: 'koszalin',
  name: 'Koszalin',
  center: { lat: 54.198, lon: 16.2133 },
  radiusM: 13_000,
  bounds: { minLat: 54.1033, maxLat: 54.2927, minLon: 16.1127, maxLon: 16.314 },
  nominatimViewbox: '16.1127,54.2927,16.314,54.1033',
  overpassBbox: '54.1033,16.1127,54.2927,16.314',
  zbiorkomSlug: 'koszalin',
  zbiorkomBbox: '16.1167,54.1033,16.3095,54.2923',
  dbFile: 'kilometr-gtfs-koszalin.db',
  tilePack: 'koszalin-tiles.ktp',
  tileBbox: { minLat: 54.1033, maxLat: 54.2927, minLon: 16.1127, maxLon: 16.314 },
  tileMaxZoom: 14,
  tilePackMB: 4,
  railGateways: ['Koszalin'],
  features: { cable: false, campusPois: false, regionalRail: false, live: true, news: false, directBusPosition: false },
};

const PIOTRKOW: CityDef = {
  id: 'piotrkow',
  name: 'Piotrków Trybunalski',
  center: { lat: 51.4067, lon: 19.6906 },
  radiusM: 9_000,
  bounds: { minLat: 51.3485, maxLat: 51.4648, minLon: 19.6151, maxLon: 19.7661 },
  nominatimViewbox: '19.6151,51.4648,19.7661,51.3485',
  overpassBbox: '51.3485,19.6151,51.4648,19.7661',
  zbiorkomSlug: 'piotrkowTrybunalski',
  zbiorkomBbox: '19.6036,51.3514,19.7658,51.461',
  dbFile: 'kilometr-gtfs-piotrkow.db',
  tilePack: 'piotrkow-tiles.ktp',
  tileBbox: { minLat: 51.3485, maxLat: 51.4648, minLon: 19.6151, maxLon: 19.7661 },
  tileMaxZoom: 14,
  tilePackMB: 2,
  railGateways: ['Piotrków Trybunalski'],
  features: { cable: false, campusPois: false, regionalRail: false, live: true, news: false, directBusPosition: false },
};

const TOMASZOW: CityDef = {
  id: 'tomaszow',
  name: 'Tomaszów Mazowiecki',
  center: { lat: 51.5231, lon: 20.0197 },
  radiusM: 17_000,
  bounds: { minLat: 51.4186, maxLat: 51.6275, minLon: 19.8399, maxLon: 20.1994 },
  nominatimViewbox: '19.8399,51.6275,20.1994,51.4186',
  overpassBbox: '51.4186,19.8399,51.6275,20.1994',
  zbiorkomSlug: 'tomaszowMazowiecki',
  zbiorkomBbox: '19.8404,51.4216,20.2026,51.6271',
  dbFile: 'kilometr-gtfs-tomaszow.db',
  tilePack: 'tomaszow-tiles.ktp',
  tileBbox: { minLat: 51.4186, maxLat: 51.6275, minLon: 19.8399, maxLon: 20.1994 },
  tileMaxZoom: 14,
  tilePackMB: 8,
  railGateways: ['Tomaszów Mazowiecki'],
  features: { cable: false, campusPois: false, regionalRail: false, live: true, news: false, directBusPosition: false },
};

const SKARZYSKO: CityDef = {
  id: 'skarzysko',
  name: 'Skarżysko-Kamienna',
  center: { lat: 51.1182, lon: 20.8665 },
  radiusM: 9_000,
  bounds: { minLat: 51.0609, maxLat: 51.1755, minLon: 20.7809, maxLon: 20.9521 },
  nominatimViewbox: '20.7809,51.1755,20.9521,51.0609',
  overpassBbox: '51.0609,20.7809,51.1755,20.9521',
  zbiorkomSlug: 'skarzyskoKamienna',
  zbiorkomBbox: '20.7855,51.0633,20.9583,51.1729',
  dbFile: 'kilometr-gtfs-skarzysko.db',
  tilePack: 'skarzysko-tiles.ktp',
  tileBbox: { minLat: 51.0609, maxLat: 51.1755, minLon: 20.7809, maxLon: 20.9521 },
  tileMaxZoom: 14,
  tilePackMB: 2,
  railGateways: ['Skarżysko-Kamienna'],
  features: { cable: false, campusPois: false, regionalRail: false, live: true, news: false, directBusPosition: false },
};

const OSWIECIM: CityDef = {
  id: 'oswiecim',
  name: 'Oświęcim',
  center: { lat: 50.0342, lon: 19.2108 },
  radiusM: 7_500,
  bounds: { minLat: 49.9197, maxLat: 50.062, minLon: 19.135, maxLon: 19.3626 },
  nominatimViewbox: '19.0557,50.1324,19.3626,49.9197',
  overpassBbox: '49.9197,19.0557,50.1324,19.3626',
  zbiorkomSlug: 'oswiecim',
  zbiorkomBbox: '19.0585,49.92,19.3589,50.1292',
  dbFile: 'kilometr-gtfs-oswiecim.db',
  tilePack: 'oswiecim-tiles.ktp',
  tileBbox: { minLat: 49.9197, maxLat: 50.1324, minLon: 19.0557, maxLon: 19.3626 },
  tileMaxZoom: 14,
  tilePackMB: 7,
  railGateways: ['Oświęcim'],
  features: { cable: false, campusPois: false, regionalRail: false, live: true, news: false, directBusPosition: false },
};

const SWINOUJSCIE: CityDef = {
  id: 'swinoujscie',
  name: 'Świnoujście',
  center: { lat: 53.8897, lon: 14.3363 },
  radiusM: 12_000,
  bounds: { minLat: 53.8263, maxLat: 53.9531, minLon: 14.1928, maxLon: 14.4797 },
  nominatimViewbox: '14.1928,53.9531,14.4797,53.8263',
  overpassBbox: '53.8263,14.1928,53.9531,14.4797',
  zbiorkomSlug: 'swinoujscie',
  zbiorkomBbox: '14.1963,53.8312,14.4755,53.9485',
  dbFile: 'kilometr-gtfs-swinoujscie.db',
  tilePack: 'swinoujscie-tiles.ktp',
  tileBbox: { minLat: 53.8263, maxLat: 53.9531, minLon: 14.1928, maxLon: 14.4797 },
  tileMaxZoom: 14,
  tilePackMB: 4,
  railGateways: ['Świnoujście'],
  features: { cable: false, campusPois: false, regionalRail: false, live: true, news: false, directBusPosition: false },
};

const ZAKOPANE: CityDef = {
  id: 'zakopane',
  name: 'Zakopane',
  center: { lat: 49.2964, lon: 19.9607 },
  radiusM: 9_000,
  bounds: { minLat: 49.2452, maxLat: 49.3476, minLon: 19.8809, maxLon: 20.0405 },
  nominatimViewbox: '19.8809,49.3476,20.0405,49.2452',
  overpassBbox: '49.2452,19.8809,49.3476,20.0405',
  zbiorkomSlug: 'zakopane',
  zbiorkomBbox: '19.8859,49.2502,20.0355,49.3426',
  dbFile: 'kilometr-gtfs-zakopane.db',
  tilePack: 'zakopane-tiles.ktp',
  tileBbox: { minLat: 49.2452, maxLat: 49.3476, minLon: 19.8809, maxLon: 20.0405 },
  tileMaxZoom: 14,
  tilePackMB: 2,
  railGateways: ['Zakopane'],
  features: { cable: false, campusPois: false, regionalRail: false, live: true, news: false, directBusPosition: false },
};

const PLOCK: CityDef = {
  id: 'plock',
  name: 'Płock',
  center: { lat: 52.584, lon: 19.7421 },
  radiusM: 24_000,
  bounds: { minLat: 52.4084, maxLat: 52.7595, minLon: 19.5536, maxLon: 19.9306 },
  nominatimViewbox: '19.5536,52.7595,19.9306,52.4084',
  overpassBbox: '52.4084,19.5536,52.7595,19.9306',
  zbiorkomSlug: 'plock',
  zbiorkomBbox: '19.5549,52.3802,19.9339,52.7591',
  dbFile: 'kilometr-gtfs-plock.db',
  tilePack: 'plock-tiles.ktp',
  tileBbox: { minLat: 52.4084, maxLat: 52.7595, minLon: 19.5536, maxLon: 19.9306 },
  tileMaxZoom: 14,
  tilePackMB: 13,
  railGateways: ['Płock'],
  features: { cable: false, campusPois: false, regionalRail: false, live: true, news: false, directBusPosition: false },
};

const TARNOW: CityDef = {
  id: 'tarnow',
  name: 'Tarnów',
  center: { lat: 50.0245, lon: 20.9768 },
  radiusM: 10_000,
  bounds: { minLat: 49.9635, maxLat: 50.0854, minLon: 20.8869, maxLon: 21.0666 },
  nominatimViewbox: '20.8869,50.0854,21.0666,49.9635',
  overpassBbox: '49.9635,20.8869,50.0854,21.0666',
  zbiorkomSlug: 'tarnow',
  zbiorkomBbox: '20.8915,49.9668,21.0617,50.0805',
  dbFile: 'kilometr-gtfs-tarnow.db',
  tilePack: 'tarnow-tiles.ktp',
  tileBbox: { minLat: 49.9635, maxLat: 50.0854, minLon: 20.8869, maxLon: 21.0666 },
  tileMaxZoom: 14,
  tilePackMB: 2,
  railGateways: ['Tarnów'],
  features: { cable: false, campusPois: false, regionalRail: false, live: true, news: false, directBusPosition: false },
};

const LEGNICA: CityDef = {
  id: 'legnica',
  name: 'Legnica',
  center: { lat: 51.2095, lon: 16.2383 },
  radiusM: 18_000,
  bounds: { minLat: 51.087, maxLat: 51.3319, minLon: 16.0867, maxLon: 16.3899 },
  nominatimViewbox: '16.0867,51.3319,16.3899,51.087',
  overpassBbox: '51.087,16.0867,51.3319,16.3899',
  zbiorkomSlug: 'legnica',
  zbiorkomBbox: '16.0893,51.0911,16.3895,51.3443',
  dbFile: 'kilometr-gtfs-legnica.db',
  tilePack: 'legnica-tiles.ktp',
  tileBbox: { minLat: 51.087, maxLat: 51.3319, minLon: 16.0867, maxLon: 16.3899 },
  tileMaxZoom: 14,
  tilePackMB: 7,
  railGateways: ['Legnica'],
  features: { cable: false, campusPois: false, regionalRail: false, live: true, news: false, directBusPosition: false },
};

const JASTRZEBIE: CityDef = {
  id: 'jastrzebie',
  name: 'Jastrzębie-Zdrój',
  center: { lat: 49.9508, lon: 18.5758 },
  radiusM: 18_000,
  bounds: { minLat: 49.8527, maxLat: 50.145, minLon: 18.346, maxLon: 18.8312 },
  nominatimViewbox: '18.346,50.2072,18.8312,49.8527',
  overpassBbox: '49.8527,18.346,50.2072,18.8312',
  zbiorkomSlug: 'rybnik',
  zbiorkomBbox: '18.3309,49.8512,18.8314,50.2152',
  dbFile: 'kilometr-gtfs-jastrzebie.db',
  tilePack: 'jastrzebie-tiles.ktp',
  tileBbox: { minLat: 49.8527, maxLat: 50.2072, minLon: 18.346, maxLon: 18.8312 },
  tileMaxZoom: 14,
  tilePackMB: 17,
  railGateways: ['Zebrzydowice'],
  features: { cable: false, campusPois: false, regionalRail: false, live: true, news: false, directBusPosition: false },
};

const PILA: CityDef = {
  id: 'pila',
  name: 'Piła',
  center: { lat: 53.1093, lon: 16.6973 },
  radiusM: 14_000,
  bounds: { minLat: 53.0088, maxLat: 53.2098, minLon: 16.5866, maxLon: 16.8079 },
  nominatimViewbox: '16.5866,53.2098,16.8079,53.0088',
  overpassBbox: '53.0088,16.5866,53.2098,16.8079',
  zbiorkomSlug: 'pila',
  zbiorkomBbox: '16.5787,53.0129,16.8096,53.205',
  dbFile: 'kilometr-gtfs-pila.db',
  tilePack: 'pila-tiles.ktp',
  tileBbox: { minLat: 53.0088, maxLat: 53.2098, minLon: 16.5866, maxLon: 16.8079 },
  tileMaxZoom: 14,
  tilePackMB: 4,
  railGateways: ['Piła Główna'],
  features: { cable: false, campusPois: false, regionalRail: false, live: true, news: false, directBusPosition: false },
};

const KONIN: CityDef = {
  id: 'konin',
  name: 'Konin',
  center: { lat: 52.2255, lon: 18.2661 },
  radiusM: 21_000,
  bounds: { minLat: 52.0876, maxLat: 52.3634, minLon: 18.0633, maxLon: 18.4688 },
  nominatimViewbox: '18.0633,52.3634,18.4688,52.0876',
  overpassBbox: '52.0876,18.0633,52.3634,18.4688',
  zbiorkomSlug: 'konin',
  zbiorkomBbox: '18.0682,52.0832,18.4703,52.3613',
  dbFile: 'kilometr-gtfs-konin.db',
  tilePack: 'konin-tiles.ktp',
  tileBbox: { minLat: 52.0876, maxLat: 52.3634, minLon: 18.0633, maxLon: 18.4688 },
  tileMaxZoom: 14,
  tilePackMB: 11,
  railGateways: ['Konin'],
  features: { cable: false, campusPois: false, regionalRail: false, live: true, news: false, directBusPosition: false },
};

const SUWALKI: CityDef = {
  id: 'suwalki',
  name: 'Suwałki',
  center: { lat: 54.0883, lon: 22.938 },
  radiusM: 14_000,
  bounds: { minLat: 53.9953, maxLat: 54.1812, minLon: 22.804, maxLon: 23.072 },
  nominatimViewbox: '22.804,54.1812,23.072,53.9953',
  overpassBbox: '53.9953,22.804,54.1812,23.072',
  zbiorkomSlug: 'suwalki',
  zbiorkomBbox: '22.8006,53.9964,23.0795,54.1816',
  dbFile: 'kilometr-gtfs-suwalki.db',
  tilePack: 'suwalki-tiles.ktp',
  tileBbox: { minLat: 53.9953, maxLat: 54.1812, minLon: 22.804, maxLon: 23.072 },
  tileMaxZoom: 14,
  tilePackMB: 5,
  railGateways: ['Suwałki'],
  features: { cable: false, campusPois: false, regionalRail: false, live: true, news: false, directBusPosition: false },
};

const OSTROWIEC: CityDef = {
  id: 'ostrowiec',
  name: 'Ostrowiec Świętokrzyski',
  center: { lat: 50.934, lon: 21.3736 },
  radiusM: 16_000,
  bounds: { minLat: 50.8595, maxLat: 51.0085, minLon: 21.1813, maxLon: 21.5659 },
  nominatimViewbox: '21.1813,51.0085,21.5659,50.8595',
  overpassBbox: '50.8595,21.1813,51.0085,21.5659',
  zbiorkomSlug: 'ostrowiecSwietokrzyski',
  zbiorkomBbox: '21.1862,50.8641,21.5611,51.0038',
  dbFile: 'kilometr-gtfs-ostrowiec.db',
  tilePack: 'ostrowiec-tiles.ktp',
  tileBbox: { minLat: 50.8595, maxLat: 51.0085, minLon: 21.1813, maxLon: 21.5659 },
  tileMaxZoom: 14,
  tilePackMB: 6,
  railGateways: ['Ostrowiec Świętokrzyski'],
  features: { cable: false, campusPois: false, regionalRail: false, live: true, news: false, directBusPosition: false },
};

const STALOWAWOLA: CityDef = {
  id: 'stalowawola',
  name: 'Stalowa Wola',
  center: { lat: 50.5743, lon: 22.0463 },
  radiusM: 17_000,
  bounds: { minLat: 50.4739, maxLat: 50.6747, minLon: 21.8663, maxLon: 22.2263 },
  nominatimViewbox: '21.8663,50.6747,22.2263,50.4739',
  overpassBbox: '50.4739,21.8663,50.6747,22.2263',
  zbiorkomSlug: 'stalowaWola',
  zbiorkomBbox: '21.8713,50.4789,22.2213,50.6697',
  dbFile: 'kilometr-gtfs-stalowawola.db',
  tilePack: 'stalowawola-tiles.ktp',
  tileBbox: { minLat: 50.4739, maxLat: 50.6747, minLon: 21.8663, maxLon: 22.2263 },
  tileMaxZoom: 14,
  tilePackMB: 7,
  railGateways: ['Stalowa Wola Rozwadów'],
  features: { cable: false, campusPois: false, regionalRail: false, live: false, news: false, directBusPosition: false },
};

const PRZEMYSL: CityDef = {
  id: 'przemysl',
  name: 'Przemyśl',
  center: { lat: 49.7721, lon: 22.7618 },
  radiusM: 14_000,
  bounds: { minLat: 49.6777, maxLat: 49.8666, minLon: 22.6433, maxLon: 22.8803 },
  nominatimViewbox: '22.6433,49.8666,22.8803,49.6777',
  overpassBbox: '49.6777,22.6433,49.8666,22.8803',
  zbiorkomSlug: 'przemysl',
  zbiorkomBbox: '22.6482,49.681,22.8753,49.8639',
  dbFile: 'kilometr-gtfs-przemysl.db',
  tilePack: 'przemysl-tiles.ktp',
  tileBbox: { minLat: 49.6777, maxLat: 49.8666, minLon: 22.6433, maxLon: 22.8803 },
  tileMaxZoom: 14,
  tilePackMB: 4,
  railGateways: ['Przemyśl Główny'],
  features: { cable: false, campusPois: false, regionalRail: false, live: false, news: false, directBusPosition: false },
};

const ELK: CityDef = {
  id: 'elk',
  name: 'Ełk',
  center: { lat: 53.8408, lon: 22.3272 },
  radiusM: 19_000,
  bounds: { minLat: 53.7173, maxLat: 53.9643, minLon: 22.1448, maxLon: 22.5096 },
  nominatimViewbox: '22.1448,53.9643,22.5096,53.7173',
  overpassBbox: '53.7173,22.1448,53.9643,22.5096',
  zbiorkomSlug: 'elk',
  zbiorkomBbox: '22.1492,53.7202,22.5059,53.9599',
  dbFile: 'kilometr-gtfs-elk.db',
  tilePack: 'elk-tiles.ktp',
  tileBbox: { minLat: 53.7173, maxLat: 53.9643, minLon: 22.1448, maxLon: 22.5096 },
  tileMaxZoom: 14,
  tilePackMB: 9,
  railGateways: ['Ełk'],
  features: { cable: false, campusPois: false, regionalRail: false, live: true, news: false, directBusPosition: false },
};

const LESZNO: CityDef = {
  id: 'leszno',
  name: 'Leszno',
  center: { lat: 51.8549, lon: 16.582 },
  radiusM: 16_000,
  bounds: { minLat: 51.7314, maxLat: 51.9784, minLon: 16.469, maxLon: 16.695 },
  nominatimViewbox: '16.469,51.9784,16.695,51.7314',
  overpassBbox: '51.7314,16.469,51.9784,16.695',
  zbiorkomSlug: 'leszno',
  zbiorkomBbox: '16.474,51.7364,16.6901,51.9746',
  dbFile: 'kilometr-gtfs-leszno.db',
  tilePack: 'leszno-tiles.ktp',
  tileBbox: { minLat: 51.7314, maxLat: 51.9784, minLon: 16.469, maxLon: 16.695 },
  tileMaxZoom: 14,
  tilePackMB: 6,
  railGateways: ['Leszno'],
  features: { cable: false, campusPois: false, regionalRail: false, live: true, news: false, directBusPosition: false },
};

const CHELM: CityDef = {
  id: 'chelm',
  name: 'Chełm',
  center: { lat: 51.1371, lon: 23.4828 },
  radiusM: 9_000,
  bounds: { minLat: 51.0856, maxLat: 51.1885, minLon: 23.4014, maxLon: 23.5642 },
  nominatimViewbox: '23.4014,51.1885,23.5642,51.0856',
  overpassBbox: '51.0856,23.4014,51.1885,23.5642',
  zbiorkomSlug: 'chelm',
  zbiorkomBbox: '23.4064,51.0906,23.5592,51.1835',
  dbFile: 'kilometr-gtfs-chelm.db',
  tilePack: 'chelm-tiles.ktp',
  tileBbox: { minLat: 51.0856, maxLat: 51.1885, minLon: 23.4014, maxLon: 23.5642 },
  tileMaxZoom: 14,
  tilePackMB: 2,
  railGateways: ['Chełm'],
  features: { cable: false, campusPois: false, regionalRail: false, live: true, news: false, directBusPosition: false },
};

const MIELEC: CityDef = {
  id: 'mielec',
  name: 'Mielec',
  center: { lat: 50.3023, lon: 21.4655 },
  radiusM: 14_000,
  bounds: { minLat: 50.2046, maxLat: 50.4, minLon: 21.3426, maxLon: 21.5883 },
  nominatimViewbox: '21.3426,50.4,21.5883,50.2046',
  overpassBbox: '50.2046,21.3426,50.4,21.5883',
  zbiorkomSlug: 'mielec',
  zbiorkomBbox: '21.3407,50.1967,21.5879,50.3988',
  dbFile: 'kilometr-gtfs-mielec.db',
  tilePack: 'mielec-tiles.ktp',
  tileBbox: { minLat: 50.2046, maxLat: 50.4, minLon: 21.3426, maxLon: 21.5883 },
  tileMaxZoom: 14,
  tilePackMB: 5,
  railGateways: ['Mielec'],
  features: { cable: false, campusPois: false, regionalRail: false, live: true, news: false, directBusPosition: false },
};

const TCZEW: CityDef = {
  id: 'tczew',
  name: 'Tczew',
  center: { lat: 54.2087, lon: 18.7165 },
  radiusM: 21_000,
  bounds: { minLat: 54.0373, maxLat: 54.3801, minLon: 18.6034, maxLon: 18.8297 },
  nominatimViewbox: '18.6034,54.3801,18.8297,54.0373',
  overpassBbox: '54.0373,18.6034,54.3801,18.8297',
  zbiorkomSlug: 'tczew',
  zbiorkomBbox: '18.608,54.0418,18.8247,54.3751',
  dbFile: 'kilometr-gtfs-tczew.db',
  tilePack: 'tczew-tiles.ktp',
  tileBbox: { minLat: 54.0373, maxLat: 54.3801, minLon: 18.6034, maxLon: 18.8297 },
  tileMaxZoom: 14,
  tilePackMB: 8,
  railGateways: ['Tczew'],
  features: { cable: false, campusPois: false, regionalRail: false, live: true, news: false, directBusPosition: false },
};

const OSTROLEKA: CityDef = {
  id: 'ostroleka',
  name: 'Ostrołęka',
  center: { lat: 53.0575, lon: 21.6114 },
  radiusM: 13_000,
  bounds: { minLat: 52.9632, maxLat: 53.1518, minLon: 21.5134, maxLon: 21.7095 },
  nominatimViewbox: '21.5134,53.1518,21.7095,52.9632',
  overpassBbox: '52.9632,21.5134,53.1518,21.7095',
  zbiorkomSlug: 'ostroleka',
  zbiorkomBbox: '21.5085,52.9642,21.7128,53.1493',
  dbFile: 'kilometr-gtfs-ostroleka.db',
  tilePack: 'ostroleka-tiles.ktp',
  tileBbox: { minLat: 52.9632, maxLat: 53.1518, minLon: 21.5134, maxLon: 21.7095 },
  tileMaxZoom: 14,
  tilePackMB: 4,
  railGateways: ['Ostrołęka'],
  features: { cable: false, campusPois: false, regionalRail: false, live: true, news: false, directBusPosition: false },
};

const STARACHOWICE: CityDef = {
  id: 'starachowice',
  name: 'Starachowice',
  center: { lat: 51.0364, lon: 21.0785 },
  radiusM: 10_000,
  bounds: { minLat: 50.9746, maxLat: 51.0982, minLon: 20.9845, maxLon: 21.1724 },
  nominatimViewbox: '20.9845,51.0982,21.1724,50.9746',
  overpassBbox: '50.9746,20.9845,51.0982,21.1724',
  zbiorkomSlug: 'starachowice',
  zbiorkomBbox: '20.9889,50.9793,21.1676,51.0932',
  dbFile: 'kilometr-gtfs-starachowice.db',
  tilePack: 'starachowice-tiles.ktp',
  tileBbox: { minLat: 50.9746, maxLat: 51.0982, minLon: 20.9845, maxLon: 21.1724 },
  tileMaxZoom: 14,
  tilePackMB: 2,
  railGateways: ['Starachowice'],
  features: { cable: false, campusPois: false, regionalRail: false, live: true, news: false, directBusPosition: false },
};

const KUTNO: CityDef = {
  id: 'kutno',
  name: 'Kutno',
  center: { lat: 52.2297, lon: 19.371 },
  radiusM: 10_000,
  bounds: { minLat: 52.1716, maxLat: 52.2878, minLon: 19.2732, maxLon: 19.4687 },
  nominatimViewbox: '19.2732,52.2878,19.4687,52.1716',
  overpassBbox: '52.1716,19.2732,52.2878,19.4687',
  zbiorkomSlug: 'kutno',
  zbiorkomBbox: '19.2782,52.1766,19.4639,52.2828',
  dbFile: 'kilometr-gtfs-kutno.db',
  tilePack: 'kutno-tiles.ktp',
  tileBbox: { minLat: 52.1716, maxLat: 52.2878, minLon: 19.2732, maxLon: 19.4687 },
  tileMaxZoom: 14,
  tilePackMB: 2,
  railGateways: ['Kutno'],
  features: { cable: false, campusPois: false, regionalRail: false, live: true, news: false, directBusPosition: false },
};

const KOLOBRZEG: CityDef = {
  id: 'kolobrzeg',
  name: 'Kołobrzeg',
  center: { lat: 54.1591, lon: 15.5746 },
  radiusM: 11_000,
  bounds: { minLat: 54.1006, maxLat: 54.2175, minLon: 15.4548, maxLon: 15.6945 },
  nominatimViewbox: '15.4548,54.2175,15.6945,54.1006',
  overpassBbox: '54.1006,15.4548,54.2175,15.6945',
  zbiorkomSlug: 'kolobrzeg',
  zbiorkomBbox: '15.4598,54.1056,15.6895,54.2125',
  dbFile: 'kilometr-gtfs-kolobrzeg.db',
  tilePack: 'kolobrzeg-tiles.ktp',
  tileBbox: { minLat: 54.1006, maxLat: 54.2175, minLon: 15.4548, maxLon: 15.6945 },
  tileMaxZoom: 14,
  tilePackMB: 3,
  railGateways: ['Kołobrzeg'],
  features: { cable: false, campusPois: false, regionalRail: false, live: true, news: false, directBusPosition: false },
};

const RADOMSKO: CityDef = {
  id: 'radomsko',
  name: 'Radomsko',
  center: { lat: 51.1145, lon: 19.453 },
  radiusM: 17_000,
  bounds: { minLat: 50.995, maxLat: 51.2339, minLon: 19.3241, maxLon: 19.5819 },
  nominatimViewbox: '19.3241,51.2339,19.5819,50.995',
  overpassBbox: '50.995,19.3241,51.2339,19.5819',
  zbiorkomSlug: 'radomsko',
  zbiorkomBbox: '19.329,50.9998,19.5773,51.229',
  dbFile: 'kilometr-gtfs-radomsko.db',
  tilePack: 'radomsko-tiles.ktp',
  tileBbox: { minLat: 50.995, maxLat: 51.2339, minLon: 19.3241, maxLon: 19.5819 },
  tileMaxZoom: 14,
  tilePackMB: 6,
  railGateways: ['Radomsko'],
  features: { cable: false, campusPois: false, regionalRail: false, live: true, news: false, directBusPosition: false },
};

const BOLESLAWIEC: CityDef = {
  id: 'boleslawiec',
  name: 'Bolesławiec',
  center: { lat: 51.2566, lon: 15.4308 },
  radiusM: 15_000,
  bounds: { minLat: 51.1958, maxLat: 51.3173, minLon: 15.2393, maxLon: 15.6223 },
  nominatimViewbox: '15.2393,51.3173,15.6223,51.1958',
  overpassBbox: '51.1958,15.2393,51.3173,15.6223',
  zbiorkomSlug: 'boleslawiec',
  zbiorkomBbox: '15.2443,51.2008,15.6173,51.3123',
  dbFile: 'kilometr-gtfs-boleslawiec.db',
  tilePack: 'boleslawiec-tiles.ktp',
  tileBbox: { minLat: 51.1958, maxLat: 51.3173, minLon: 15.2393, maxLon: 15.6223 },
  tileMaxZoom: 14,
  tilePackMB: 5,
  railGateways: ['Bolesławiec'],
  features: { cable: false, campusPois: false, regionalRail: false, live: true, news: false, directBusPosition: false },
};

const CIESZYN: CityDef = {
  id: 'cieszyn',
  name: 'Cieszyn',
  center: { lat: 49.7833, lon: 18.6325 },
  radiusM: 11_000,
  bounds: { minLat: 49.703, maxLat: 49.8635, minLon: 18.5533, maxLon: 18.7116 },
  nominatimViewbox: '18.5533,49.8635,18.7116,49.703',
  overpassBbox: '49.703,18.5533,49.8635,18.7116',
  zbiorkomSlug: 'cieszyn',
  zbiorkomBbox: '18.5583,49.708,18.7066,49.8585',
  dbFile: 'kilometr-gtfs-cieszyn.db',
  tilePack: 'cieszyn-tiles.ktp',
  tileBbox: { minLat: 49.703, maxLat: 49.8635, minLon: 18.5533, maxLon: 18.7116 },
  tileMaxZoom: 14,
  tilePackMB: 3,
  railGateways: ['Cieszyn'],
  features: { cable: false, campusPois: false, regionalRail: false, live: true, news: false, directBusPosition: false },
};

const ZYWIEC: CityDef = {
  id: 'zywiec',
  name: 'Żywiec',
  center: { lat: 49.7052, lon: 19.227 },
  radiusM: 16_000,
  bounds: { minLat: 49.5922, maxLat: 49.8181, minLon: 19.0905, maxLon: 19.3636 },
  nominatimViewbox: '19.0905,49.8181,19.3636,49.5922',
  overpassBbox: '49.5922,19.0905,49.8181,19.3636',
  zbiorkomSlug: 'zywiec',
  zbiorkomBbox: '19.0906,49.5964,19.3638,49.8197',
  dbFile: 'kilometr-gtfs-zywiec.db',
  tilePack: 'zywiec-tiles.ktp',
  tileBbox: { minLat: 49.5922, maxLat: 49.8181, minLon: 19.0905, maxLon: 19.3636 },
  tileMaxZoom: 14,
  tilePackMB: 6,
  railGateways: ['Żywiec'],
  features: { cable: false, campusPois: false, regionalRail: false, live: true, news: false, directBusPosition: false },
};

const KRASNIK: CityDef = {
  id: 'krasnik',
  name: 'Kraśnik',
  center: { lat: 50.9532, lon: 22.1567 },
  radiusM: 18_000,
  bounds: { minLat: 50.8539, maxLat: 51.0524, minLon: 21.9684, maxLon: 22.345 },
  nominatimViewbox: '21.9684,51.0524,22.345,50.8539',
  overpassBbox: '50.8539,21.9684,51.0524,22.345',
  zbiorkomSlug: 'krasnik',
  zbiorkomBbox: '21.9692,50.8588,22.34,51.0481',
  dbFile: 'kilometr-gtfs-krasnik.db',
  tilePack: 'krasnik-tiles.ktp',
  tileBbox: { minLat: 50.8539, maxLat: 51.0524, minLon: 21.9684, maxLon: 22.345 },
  tileMaxZoom: 14,
  tilePackMB: 7,
  railGateways: ['Kraśnik'],
  features: { cable: false, campusPois: false, regionalRail: false, live: true, news: false, directBusPosition: false },
};

const GRODZISK: CityDef = {
  id: 'grodzisk',
  name: 'Grodzisk Mazowiecki',
  center: { lat: 52.106, lon: 20.631 },
  radiusM: 12_000,
  bounds: { minLat: 52, maxLat: 52.22, minLon: 20.38, maxLon: 20.78 },
  nominatimViewbox: '20.38,52.22,20.78,52',
  overpassBbox: '52,20.38,52.22,20.78',
  zbiorkomSlug: 'warsaw',
  zbiorkomBbox: '20.2177,51.905,20.9646,52.3689',
  dbFile: 'kilometr-gtfs-grodzisk.db',
  tilePack: 'grodzisk-tiles.ktp',
  tileBbox: { minLat: 51.99, maxLat: 52.23, minLon: 20.37, maxLon: 20.79 },
  tileMaxZoom: 14,
  tilePackMB: 10,
  railGateways: ['Grodzisk Mazowiecki'],
  features: { cable: false, campusPois: false, regionalRail: false, live: true, news: false, directBusPosition: false },
};

const PRUSZKOW: CityDef = {
  id: 'pruszkow',
  name: 'Pruszków',
  center: { lat: 52.1721, lon: 20.8075 },
  radiusM: 5_000,
  bounds: { minLat: 52.13, maxLat: 52.21, minLon: 20.76, maxLon: 20.85 },
  nominatimViewbox: '20.76,52.21,20.85,52.13',
  overpassBbox: '52.13,20.76,52.21,20.85',
  zbiorkomSlug: 'warsaw',
  zbiorkomBbox: '20.7463,52.1139,20.8687,52.2302',
  dbFile: 'kilometr-gtfs-pruszkow.db',
  tilePack: 'pruszkow-tiles.ktp',
  tileBbox: { minLat: 52.12, maxLat: 52.22, minLon: 20.75, maxLon: 20.86 },
  tileMaxZoom: 14,
  tilePackMB: 2,
  railGateways: ['Pruszków'],
  features: { cable: false, campusPois: false, regionalRail: false, live: true, news: false, directBusPosition: false },
};

const SOCHACZEW: CityDef = {
  id: 'sochaczew',
  name: 'Sochaczew',
  center: { lat: 52.2555, lon: 20.3278 },
  radiusM: 16_000,
  bounds: { minLat: 52.1616, maxLat: 52.3494, minLon: 20.1679, maxLon: 20.4876 },
  nominatimViewbox: '20.1679,52.3494,20.4876,52.1616',
  overpassBbox: '52.1616,20.1679,52.3494,20.4876',
  zbiorkomSlug: 'warsaw',
  zbiorkomBbox: '20.1729,52.1666,20.4826,52.3444',
  dbFile: 'kilometr-gtfs-sochaczew.db',
  tilePack: 'sochaczew-tiles.ktp',
  tileBbox: { minLat: 52.1616, maxLat: 52.3494, minLon: 20.1679, maxLon: 20.4876 },
  tileMaxZoom: 14,
  tilePackMB: 6,
  railGateways: ['Sochaczew'],
  features: { cable: false, campusPois: false, regionalRail: false, live: true, news: false, directBusPosition: false },
};

const MINSKMAZOWIECKI: CityDef = {
  id: 'minskmazowiecki',
  name: 'Mińsk Mazowiecki',
  center: { lat: 52.1807, lon: 21.5581 },
  radiusM: 7_000,
  bounds: { minLat: 52.1402, maxLat: 52.2212, minLon: 21.4996, maxLon: 21.6167 },
  nominatimViewbox: '21.4996,52.2212,21.6167,52.1402',
  overpassBbox: '52.1402,21.4996,52.2212,21.6167',
  zbiorkomSlug: 'warsaw',
  zbiorkomBbox: '21.5046,52.1407,21.6117,52.2207',
  dbFile: 'kilometr-gtfs-minskmazowiecki.db',
  tilePack: 'minskmazowiecki-tiles.ktp',
  tileBbox: { minLat: 52.1402, maxLat: 52.2212, minLon: 21.4996, maxLon: 21.6167 },
  tileMaxZoom: 14,
  tilePackMB: 2,
  railGateways: ['Mińsk Mazowiecki'],
  features: { cable: false, campusPois: false, regionalRail: false, live: true, news: false, directBusPosition: false },
};

const OTWOCK: CityDef = {
  id: 'otwock',
  name: 'Otwock',
  center: { lat: 52.106, lon: 21.261 },
  radiusM: 6_000,
  bounds: { minLat: 52.08, maxLat: 52.16, minLon: 21.18, maxLon: 21.32 },
  nominatimViewbox: '21.18,52.16,21.32,52.08',
  overpassBbox: '52.08,21.18,52.16,21.32',
  zbiorkomSlug: 'warsaw',
  zbiorkomBbox: '21.0259,52.0718,21.3241,52.1693',
  dbFile: 'kilometr-gtfs-otwock.db',
  tilePack: 'otwock-tiles.ktp',
  tileBbox: { minLat: 52.07, maxLat: 52.17, minLon: 21.17, maxLon: 21.33 },
  tileMaxZoom: 14,
  tilePackMB: 2,
  railGateways: ['Otwock'],
  features: { cable: false, campusPois: false, regionalRail: false, live: true, news: false, directBusPosition: false },
};

const NOWYDWORMAZ: CityDef = {
  id: 'nowydwormaz',
  name: 'Nowy Dwór Mazowiecki',
  center: { lat: 52.4329, lon: 20.7149 },
  radiusM: 6_000,
  bounds: { minLat: 52.389, maxLat: 52.4768, minLon: 20.6413, maxLon: 20.7885 },
  nominatimViewbox: '20.6413,52.4768,20.7885,52.389',
  overpassBbox: '52.389,20.6413,52.4768,20.7885',
  zbiorkomSlug: 'warsaw',
  zbiorkomBbox: '20.6463,52.3929,20.7835,52.4729',
  dbFile: 'kilometr-gtfs-nowydwormaz.db',
  tilePack: 'nowydwormaz-tiles.ktp',
  tileBbox: { minLat: 52.389, maxLat: 52.4768, minLon: 20.6413, maxLon: 20.7885 },
  tileMaxZoom: 14,
  tilePackMB: 2,
  railGateways: ['Nowy Dwór Mazowiecki'],
  features: { cable: false, campusPois: false, regionalRail: false, live: true, news: false, directBusPosition: false },
};

const ZABKI: CityDef = {
  id: 'zabki',
  name: 'Ząbki',
  center: { lat: 52.292, lon: 21.116 },
  radiusM: 3_500,
  bounds: { minLat: 52.26, maxLat: 52.31, minLon: 21.08, maxLon: 21.16 },
  nominatimViewbox: '21.08,52.31,21.16,52.26',
  overpassBbox: '52.26,21.08,52.31,21.16',
  zbiorkomSlug: 'warsaw',
  zbiorkomBbox: '21.03,52.233,21.1811,52.329',
  dbFile: 'kilometr-gtfs-zabki.db',
  tilePack: 'zabki-tiles.ktp',
  tileBbox: { minLat: 52.245, maxLat: 52.325, minLon: 21.07, maxLon: 21.17 },
  tileMaxZoom: 14,
  tilePackMB: 2,
  railGateways: ['Ząbki'],
  features: { cable: false, campusPois: false, regionalRail: false, live: true, news: false, directBusPosition: false },
};

const PABIANICE: CityDef = {
  id: 'pabianice',
  name: 'Pabianice',
  center: { lat: 51.664, lon: 19.354 },
  radiusM: 6_000,
  bounds: { minLat: 51.62, maxLat: 51.7, minLon: 19.3, maxLon: 19.44 },
  nominatimViewbox: '19.3,51.7,19.44,51.62',
  overpassBbox: '51.62,19.3,51.7,19.44',
  zbiorkomSlug: 'lodz',
  zbiorkomBbox: '19.274,51.5366,19.5141,51.7187',
  dbFile: 'kilometr-gtfs-pabianice.db',
  tilePack: 'pabianice-tiles.ktp',
  tileBbox: { minLat: 51.61, maxLat: 51.71, minLon: 19.29, maxLon: 19.45 },
  tileMaxZoom: 14,
  tilePackMB: 2,
  railGateways: ['Pabianice'],
  features: { cable: false, campusPois: false, regionalRail: false, live: true, news: false, directBusPosition: false },
};

const ZGIERZ: CityDef = {
  id: 'zgierz',
  name: 'Zgierz',
  center: { lat: 51.855, lon: 19.406 },
  radiusM: 6_000,
  bounds: { minLat: 51.82, maxLat: 51.92, minLon: 19.35, maxLon: 19.48 },
  nominatimViewbox: '19.35,51.92,19.48,51.82',
  overpassBbox: '51.82,19.35,51.92,19.48',
  zbiorkomSlug: 'lodz',
  zbiorkomBbox: '19.2527,51.7355,19.5088,51.9823',
  dbFile: 'kilometr-gtfs-zgierz.db',
  tilePack: 'zgierz-tiles.ktp',
  tileBbox: { minLat: 51.81, maxLat: 51.93, minLon: 19.34, maxLon: 19.49 },
  tileMaxZoom: 14,
  tilePackMB: 2,
  railGateways: ['Zgierz'],
  features: { cable: false, campusPois: false, regionalRail: false, live: true, news: false, directBusPosition: false },
};

const GRUDZIADZ: CityDef = {
  id: 'grudziadz',
  name: 'Grudziądz',
  center: { lat: 53.4851, lon: 18.7682 },
  radiusM: 20_000,
  bounds: { minLat: 53.376, maxLat: 53.61, minLon: 18.67, maxLon: 19.068 },
  nominatimViewbox: '18.67,53.61,19.068,53.376',
  overpassBbox: '53.376,18.67,53.61,19.068',
  zbiorkomSlug: 'grudziadz',
  zbiorkomBbox: '18.67,53.376,19.068,53.61',
  kpPrefix: 'grudziadz',
  dbFile: 'kilometr-gtfs-grudziadz.db',
  tilePack: 'grudziadz-tiles.ktp',
  tileBbox: { minLat: 53.376, maxLat: 53.61, minLon: 18.67, maxLon: 19.068 },
  tileMaxZoom: 14,
  tilePackMB: 9,
  railGateways: ['Grudziądz'],
  features: { cable: false, campusPois: false, regionalRail: false, live: true, news: false, directBusPosition: false },
};

const STARGARD: CityDef = {
  id: 'stargard',
  name: 'Stargard',
  center: { lat: 53.3354, lon: 15.0257 },
  radiusM: 11_000,
  bounds: { minLat: 53.229, maxLat: 53.425, minLon: 14.863, maxLon: 15.133 },
  nominatimViewbox: '14.863,53.425,15.133,53.229',
  overpassBbox: '53.229,14.863,53.425,15.133',
  zbiorkomSlug: 'stargard',
  zbiorkomBbox: '14.863,53.229,15.133,53.425',
  kpPrefix: 'stargard',
  dbFile: 'kilometr-gtfs-stargard.db',
  tilePack: 'stargard-tiles.ktp',
  tileBbox: { minLat: 53.229, maxLat: 53.425, minLon: 14.863, maxLon: 15.133 },
  tileMaxZoom: 14,
  tilePackMB: 5,
  railGateways: ['Stargard'],
  features: { cable: false, campusPois: false, regionalRail: false, live: true, news: false, directBusPosition: false },
};

const GNIEZNO: CityDef = {
  id: 'gniezno',
  name: 'Gniezno',
  center: { lat: 52.534, lon: 17.6042 },
  radiusM: 7_000,
  bounds: { minLat: 52.44, maxLat: 52.629, minLon: 17.481, maxLon: 17.706 },
  nominatimViewbox: '17.481,52.629,17.706,52.44',
  overpassBbox: '52.44,17.481,52.629,17.706',
  zbiorkomSlug: 'gniezno',
  zbiorkomBbox: '17.481,52.44,17.706,52.629',
  kpPrefix: 'gniezno',
  dbFile: 'kilometr-gtfs-gniezno.db',
  tilePack: 'gniezno-tiles.ktp',
  tileBbox: { minLat: 52.44, maxLat: 52.629, minLon: 17.481, maxLon: 17.706 },
  tileMaxZoom: 14,
  tilePackMB: 4,
  railGateways: ['Gniezno'],
  features: { cable: false, campusPois: false, regionalRail: false, live: true, news: false, directBusPosition: false },
};

const JAWORZNO: CityDef = {
  id: 'jaworzno',
  name: 'Jaworzno',
  center: { lat: 50.2099, lon: 19.2636 },
  radiusM: 9_000,
  bounds: { minLat: 50.145, maxLat: 50.285, minLon: 19.16, maxLon: 19.41 },
  nominatimViewbox: '18.977,50.345,19.457,50.092',
  overpassBbox: '50.092,18.977,50.345,19.457',
  zbiorkomSlug: 'jaworzno',
  zbiorkomBbox: '18.977,50.092,19.457,50.345',
  kpPrefix: 'jaworzno',
  dbFile: 'kilometr-gtfs-jaworzno.db',
  tilePack: 'jaworzno-tiles.ktp',
  tileBbox: { minLat: 50.092, maxLat: 50.345, minLon: 18.977, maxLon: 19.457 },
  tileMaxZoom: 14,
  tilePackMB: 12,
  railGateways: ['Jaworzno Szczakowa'],
  features: { cable: false, campusPois: false, regionalRail: false, live: true, news: false, directBusPosition: false },
};

const KEDZIERZYNKOZLE: CityDef = {
  id: 'kedzierzynkozle',
  name: 'Kędzierzyn-Koźle',
  center: { lat: 50.348, lon: 18.207 },
  radiusM: 9_000,
  bounds: { minLat: 50.254, maxLat: 50.423, minLon: 18.074, maxLon: 18.371 },
  nominatimViewbox: '18.074,50.423,18.371,50.254',
  overpassBbox: '50.254,18.074,50.423,18.371',
  zbiorkomSlug: 'kedzierzynkozle',
  zbiorkomBbox: '18.074,50.254,18.371,50.423',
  kpPrefix: 'mzkkk',
  dbFile: 'kilometr-gtfs-kedzierzynkozle.db',
  tilePack: 'kedzierzynkozle-tiles.ktp',
  tileBbox: { minLat: 50.254, maxLat: 50.423, minLon: 18.074, maxLon: 18.371 },
  tileMaxZoom: 14,
  tilePackMB: 5,
  railGateways: ['Kędzierzyn-Koźle'],
  features: { cable: false, campusPois: false, regionalRail: false, live: true, news: false, directBusPosition: false },
};

const ZAMOSC: CityDef = {
  id: 'zamosc',
  name: 'Zamość',
  center: { lat: 50.7264, lon: 23.2557 },
  radiusM: 23_000,
  bounds: { minLat: 50.59, maxLat: 50.968, minLon: 23.036, maxLon: 23.553 },
  nominatimViewbox: '23.036,50.968,23.553,50.59',
  overpassBbox: '50.59,23.036,50.968,23.553',
  zbiorkomSlug: 'zamosc',
  zbiorkomBbox: '23.036,50.59,23.553,50.968',
  kpPrefix: 'zamosc',
  dbFile: 'kilometr-gtfs-zamosc.db',
  tilePack: 'zamosc-tiles.ktp',
  tileBbox: { minLat: 50.59, maxLat: 50.968, minLon: 23.036, maxLon: 23.553 },
  tileMaxZoom: 14,
  tilePackMB: 20,
  railGateways: ['Zamość'],
  features: { cable: false, campusPois: false, regionalRail: false, live: true, news: false, directBusPosition: false },
};

const RACIBORZ: CityDef = {
  id: 'raciborz',
  name: 'Racibórz',
  center: { lat: 50.0873, lon: 18.2146 },
  radiusM: 7_000,
  bounds: { minLat: 50.014, maxLat: 50.162, minLon: 18.122, maxLon: 18.331 },
  nominatimViewbox: '18.122,50.162,18.331,50.014',
  overpassBbox: '50.014,18.122,50.162,18.331',
  zbiorkomSlug: 'raciborz',
  zbiorkomBbox: '18.122,50.014,18.331,50.162',
  kpPrefix: 'raciborz',
  dbFile: 'kilometr-gtfs-raciborz.db',
  tilePack: 'raciborz-tiles.ktp',
  tileBbox: { minLat: 50.014, maxLat: 50.162, minLon: 18.122, maxLon: 18.331 },
  tileMaxZoom: 14,
  tilePackMB: 3,
  railGateways: ['Racibórz'],
  features: { cable: false, campusPois: false, regionalRail: false, live: true, news: false, directBusPosition: false },
};

const BELCHATOW: CityDef = {
  id: 'belchatow',
  name: 'Bełchatów',
  center: { lat: 51.3645, lon: 19.3736 },
  radiusM: 6_000,
  bounds: { minLat: 51.289, maxLat: 51.428, minLon: 19.285, maxLon: 19.458 },
  nominatimViewbox: '19.285,51.428,19.458,51.289',
  overpassBbox: '51.289,19.285,51.428,19.458',
  zbiorkomSlug: 'belchatow',
  zbiorkomBbox: '19.285,51.289,19.458,51.428',
  kpPrefix: 'belchatow',
  dbFile: 'kilometr-gtfs-belchatow.db',
  tilePack: 'belchatow-tiles.ktp',
  tileBbox: { minLat: 51.289, maxLat: 51.428, minLon: 19.285, maxLon: 19.458 },
  tileMaxZoom: 14,
  tilePackMB: 2,
  railGateways: ['Piotrków Trybunalski'],
  features: { cable: false, campusPois: false, regionalRail: false, live: true, news: false, directBusPosition: false },
};

const TARNOBRZEG: CityDef = {
  id: 'tarnobrzeg',
  name: 'Tarnobrzeg',
  center: { lat: 50.5747, lon: 21.6915 },
  radiusM: 9_000,
  bounds: { minLat: 50.481, maxLat: 50.686, minLon: 21.571, maxLon: 21.808 },
  nominatimViewbox: '21.571,50.686,21.808,50.481',
  overpassBbox: '50.481,21.571,50.686,21.808',
  zbiorkomSlug: 'tarnobrzeg',
  zbiorkomBbox: '21.571,50.481,21.808,50.686',
  kpPrefix: 'tarnobrzeg',
  dbFile: 'kilometr-gtfs-tarnobrzeg.db',
  tilePack: 'tarnobrzeg-tiles.ktp',
  tileBbox: { minLat: 50.481, maxLat: 50.686, minLon: 21.571, maxLon: 21.808 },
  tileMaxZoom: 14,
  tilePackMB: 5,
  railGateways: ['Tarnobrzeg'],
  features: { cable: false, campusPois: false, regionalRail: false, live: true, news: false, directBusPosition: false },
};

const SKIERNIEWICE: CityDef = {
  id: 'skierniewice',
  name: 'Skierniewice',
  center: { lat: 51.9583, lon: 20.1491 },
  radiusM: 6_000,
  bounds: { minLat: 51.887, maxLat: 52.026, minLon: 20.063, maxLon: 20.266 },
  nominatimViewbox: '20.063,52.026,20.266,51.887',
  overpassBbox: '51.887,20.063,52.026,20.266',
  zbiorkomSlug: 'skierniewice',
  zbiorkomBbox: '20.063,51.887,20.266,52.026',
  kpPrefix: 'skierniewice',
  dbFile: 'kilometr-gtfs-skierniewice.db',
  tilePack: 'skierniewice-tiles.ktp',
  tileBbox: { minLat: 51.887, maxLat: 52.026, minLon: 20.063, maxLon: 20.266 },
  tileMaxZoom: 14,
  tilePackMB: 3,
  railGateways: ['Skierniewice'],
  features: { cable: false, campusPois: false, regionalRail: false, live: true, news: false, directBusPosition: false },
};

const ZAWIERCIE: CityDef = {
  id: 'zawiercie',
  name: 'Zawiercie',
  center: { lat: 50.487, lon: 19.417 },
  radiusM: 12_000,
  bounds: { minLat: 50.43, maxLat: 50.592, minLon: 19.31, maxLon: 19.615 },
  nominatimViewbox: '19.19,50.592,19.615,50.43',
  overpassBbox: '50.43,19.19,50.592,19.615',
  zbiorkomSlug: 'zawiercie',
  zbiorkomBbox: '19.19,50.43,19.615,50.592',
  kpPrefix: 'zawiercie',
  dbFile: 'kilometr-gtfs-zawiercie.db',
  tilePack: 'zawiercie-tiles.ktp',
  tileBbox: { minLat: 50.43, maxLat: 50.592, minLon: 19.19, maxLon: 19.615 },
  tileMaxZoom: 14,
  tilePackMB: 7,
  railGateways: ['Zawiercie'],
  features: { cable: false, campusPois: false, regionalRail: false, live: true, news: false, directBusPosition: false },
};

const STAROGARD: CityDef = {
  id: 'starogard',
  name: 'Starogard Gdański',
  center: { lat: 53.964, lon: 18.5225 },
  radiusM: 7_000,
  bounds: { minLat: 53.884, maxLat: 54.057, minLon: 18.433, maxLon: 18.61 },
  nominatimViewbox: '18.433,54.057,18.61,53.884',
  overpassBbox: '53.884,18.433,54.057,18.61',
  zbiorkomSlug: 'starogard',
  zbiorkomBbox: '18.433,53.884,18.61,54.057',
  kpPrefix: 'starogard',
  dbFile: 'kilometr-gtfs-starogard.db',
  tilePack: 'starogard-tiles.ktp',
  tileBbox: { minLat: 53.884, maxLat: 54.057, minLon: 18.433, maxLon: 18.61 },
  tileMaxZoom: 14,
  tilePackMB: 3,
  railGateways: ['Starogard Gdański'],
  features: { cable: false, campusPois: false, regionalRail: false, live: true, news: false, directBusPosition: false },
};

const ZDUNSKAWOLA: CityDef = {
  id: 'zdunskawola',
  name: 'Zduńska Wola',
  center: { lat: 51.5982, lon: 18.9332 },
  radiusM: 17_000,
  bounds: { minLat: 51.469, maxLat: 51.744, minLon: 18.661, maxLon: 19.102 },
  nominatimViewbox: '18.661,51.744,19.102,51.469',
  overpassBbox: '51.469,18.661,51.744,19.102',
  zbiorkomSlug: 'zdunskawola',
  zbiorkomBbox: '18.661,51.469,19.102,51.744',
  kpPrefix: 'zdw',
  dbFile: 'kilometr-gtfs-zdunskawola.db',
  tilePack: 'zdunskawola-tiles.ktp',
  tileBbox: { minLat: 51.469, maxLat: 51.744, minLon: 18.661, maxLon: 19.102 },
  tileMaxZoom: 14,
  tilePackMB: 12,
  railGateways: ['Zduńska Wola'],
  features: { cable: false, campusPois: false, regionalRail: false, live: true, news: false, directBusPosition: false },
};

const NYSA: CityDef = {
  id: 'nysa',
  name: 'Nysa',
  center: { lat: 50.4669, lon: 17.3359 },
  radiusM: 16_000,
  bounds: { minLat: 50.311, maxLat: 50.555, minLon: 17.091, maxLon: 17.524 },
  nominatimViewbox: '17.091,50.555,17.524,50.311',
  overpassBbox: '50.311,17.091,50.555,17.524',
  zbiorkomSlug: 'nysa',
  zbiorkomBbox: '17.091,50.311,17.524,50.555',
  kpPrefix: 'nysa',
  dbFile: 'kilometr-gtfs-nysa.db',
  tilePack: 'nysa-tiles.ktp',
  tileBbox: { minLat: 50.311, maxLat: 50.555, minLon: 17.091, maxLon: 17.524 },
  tileMaxZoom: 14,
  tilePackMB: 11,
  railGateways: ['Nysa'],
  features: { cable: false, campusPois: false, regionalRail: false, live: true, news: false, directBusPosition: false },
};

const MALBORK: CityDef = {
  id: 'malbork',
  name: 'Malbork',
  center: { lat: 54.029, lon: 19.0384 },
  radiusM: 6_000,
  bounds: { minLat: 53.969, maxLat: 54.085, minLon: 18.963, maxLon: 19.122 },
  nominatimViewbox: '18.963,54.085,19.122,53.969',
  overpassBbox: '53.969,18.963,54.085,19.122',
  zbiorkomSlug: 'malbork',
  zbiorkomBbox: '18.963,53.969,19.122,54.085',
  kpPrefix: 'malbork',
  dbFile: 'kilometr-gtfs-malbork.db',
  tilePack: 'malbork-tiles.ktp',
  tileBbox: { minLat: 53.969, maxLat: 54.085, minLon: 18.963, maxLon: 19.122 },
  tileMaxZoom: 14,
  tilePackMB: 2,
  railGateways: ['Malbork'],
  features: { cable: false, campusPois: false, regionalRail: false, live: true, news: false, directBusPosition: false },
};

const SIERADZ: CityDef = {
  id: 'sieradz',
  name: 'Sieradz',
  center: { lat: 51.5956, lon: 18.737 },
  radiusM: 19_000,
  bounds: { minLat: 51.526, maxLat: 51.672, minLon: 18.619, maxLon: 19.053 },
  nominatimViewbox: '18.619,51.672,19.053,51.526',
  overpassBbox: '51.526,18.619,51.672,19.053',
  zbiorkomSlug: 'sieradz',
  zbiorkomBbox: '18.619,51.526,19.053,51.672',
  kpPrefix: 'sieradz',
  dbFile: 'kilometr-gtfs-sieradz.db',
  tilePack: 'sieradz-tiles.ktp',
  tileBbox: { minLat: 51.526, maxLat: 51.672, minLon: 18.619, maxLon: 19.053 },
  tileMaxZoom: 14,
  tilePackMB: 6,
  railGateways: ['Sieradz'],
  features: { cable: false, campusPois: false, regionalRail: false, live: true, news: false, directBusPosition: false },
};

const SZCZECINEK: CityDef = {
  id: 'szczecinek',
  name: 'Szczecinek',
  center: { lat: 53.708, lon: 16.6945 },
  radiusM: 6_000,
  bounds: { minLat: 53.633, maxLat: 53.771, minLon: 16.589, maxLon: 16.776 },
  nominatimViewbox: '16.589,53.771,16.776,53.633',
  overpassBbox: '53.633,16.589,53.771,16.776',
  zbiorkomSlug: 'szczecinek',
  zbiorkomBbox: '16.589,53.633,16.776,53.771',
  kpPrefix: 'szczecinek',
  dbFile: 'kilometr-gtfs-szczecinek.db',
  tilePack: 'szczecinek-tiles.ktp',
  tileBbox: { minLat: 53.633, maxLat: 53.771, minLon: 16.589, maxLon: 16.776 },
  tileMaxZoom: 14,
  tilePackMB: 3,
  railGateways: ['Szczecinek'],
  features: { cable: false, campusPois: false, regionalRail: false, live: true, news: false, directBusPosition: false },
};

const NOWASOL: CityDef = {
  id: 'nowasol',
  name: 'Nowa Sól',
  center: { lat: 51.7978, lon: 15.7047 },
  radiusM: 28_000,
  bounds: { minLat: 51.657, maxLat: 52.068, minLon: 15.438, maxLon: 16.049 },
  nominatimViewbox: '15.438,52.068,16.049,51.657',
  overpassBbox: '51.657,15.438,52.068,16.049',
  zbiorkomSlug: 'nowasol',
  zbiorkomBbox: '15.438,51.657,16.049,52.068',
  kpPrefix: 'nowasol',
  dbFile: 'kilometr-gtfs-nowasol.db',
  tilePack: 'nowasol-tiles.ktp',
  tileBbox: { minLat: 51.657, maxLat: 52.068, minLon: 15.438, maxLon: 16.049 },
  tileMaxZoom: 14,
  tilePackMB: 25,
  railGateways: ['Nowa Sól'],
  features: { cable: false, campusPois: false, regionalRail: false, live: true, news: false, directBusPosition: false },
};

const OLESNICA: CityDef = {
  id: 'olesnica',
  name: 'Oleśnica',
  center: { lat: 51.2063, lon: 17.3882 },
  radiusM: 6_000,
  bounds: { minLat: 51.151, maxLat: 51.262, minLon: 17.309, maxLon: 17.481 },
  nominatimViewbox: '17.309,51.262,17.481,51.151',
  overpassBbox: '51.151,17.309,51.262,17.481',
  zbiorkomSlug: 'olesnica',
  zbiorkomBbox: '17.309,51.151,17.481,51.262',
  kpPrefix: 'olesnica',
  dbFile: 'kilometr-gtfs-olesnica.db',
  tilePack: 'olesnica-tiles.ktp',
  tileBbox: { minLat: 51.151, maxLat: 51.262, minLon: 17.309, maxLon: 17.481 },
  tileMaxZoom: 14,
  tilePackMB: 2,
  railGateways: ['Oleśnica'],
  features: { cable: false, campusPois: false, regionalRail: false, live: true, news: false, directBusPosition: false },
};

const CZECHOWICEDZIEDZICE: CityDef = {
  id: 'czechowicedziedzice',
  name: 'Czechowice-Dziedzice',
  center: { lat: 49.8926, lon: 19.0038 },
  radiusM: 9_000,
  bounds: { minLat: 49.785, maxLat: 49.976, minLon: 18.862, maxLon: 19.1 },
  nominatimViewbox: '18.862,49.976,19.1,49.785',
  overpassBbox: '49.785,18.862,49.976,19.1',
  zbiorkomSlug: 'czechowicedziedzice',
  zbiorkomBbox: '18.862,49.785,19.1,49.976',
  kpPrefix: 'czechowice-dziedzice',
  dbFile: 'kilometr-gtfs-czechowicedziedzice.db',
  tilePack: 'czechowicedziedzice-tiles.ktp',
  tileBbox: { minLat: 49.785, maxLat: 49.976, minLon: 18.862, maxLon: 19.1 },
  tileMaxZoom: 14,
  tilePackMB: 5,
  railGateways: ['Czechowice-Dziedzice'],
  features: { cable: false, campusPois: false, regionalRail: false, live: true, news: false, directBusPosition: false },
};

const OSTRODA: CityDef = {
  id: 'ostroda',
  name: 'Ostróda',
  center: { lat: 53.6969, lon: 19.9677 },
  radiusM: 6_000,
  bounds: { minLat: 53.632, maxLat: 53.784, minLon: 19.841, maxLon: 20.093 },
  nominatimViewbox: '19.841,53.784,20.093,53.632',
  overpassBbox: '53.632,19.841,53.784,20.093',
  zbiorkomSlug: 'ostroda',
  zbiorkomBbox: '19.841,53.632,20.093,53.784',
  kpPrefix: 'ostroda',
  dbFile: 'kilometr-gtfs-ostroda.db',
  tilePack: 'ostroda-tiles.ktp',
  tileBbox: { minLat: 53.632, maxLat: 53.784, minLon: 19.841, maxLon: 20.093 },
  tileMaxZoom: 14,
  tilePackMB: 4,
  railGateways: ['Ostróda'],
  features: { cable: false, campusPois: false, regionalRail: false, live: true, news: false, directBusPosition: false },
};

const NOWYTARG: CityDef = {
  id: 'nowytarg',
  name: 'Nowy Targ',
  center: { lat: 49.4824, lon: 20.0272 },
  radiusM: 9_000,
  bounds: { minLat: 49.397, maxLat: 49.589, minLon: 19.914, maxLon: 20.183 },
  nominatimViewbox: '19.914,49.589,20.183,49.397',
  overpassBbox: '49.397,19.914,49.589,20.183',
  zbiorkomSlug: 'nowytarg',
  zbiorkomBbox: '19.914,49.397,20.183,49.589',
  kpPrefix: 'nowytarg',
  dbFile: 'kilometr-gtfs-nowytarg.db',
  tilePack: 'nowytarg-tiles.ktp',
  tileBbox: { minLat: 49.397, maxLat: 49.589, minLon: 19.914, maxLon: 20.183 },
  tileMaxZoom: 14,
  tilePackMB: 5,
  railGateways: ['Nowy Targ'],
  features: { cable: false, campusPois: false, regionalRail: false, live: true, news: false, directBusPosition: false },
};

const AUGUSTOW: CityDef = {
  id: 'augustow',
  name: 'Augustów',
  center: { lat: 53.8479, lon: 22.9919 },
  radiusM: 6_000,
  bounds: { minLat: 53.792, maxLat: 53.902, minLon: 22.873, maxLon: 23.088 },
  nominatimViewbox: '22.873,53.902,23.088,53.792',
  overpassBbox: '53.792,22.873,53.902,23.088',
  zbiorkomSlug: 'augustow',
  zbiorkomBbox: '22.873,53.792,23.088,53.902',
  kpPrefix: 'augustow',
  dbFile: 'kilometr-gtfs-augustow.db',
  tilePack: 'augustow-tiles.ktp',
  tileBbox: { minLat: 53.792, maxLat: 53.902, minLon: 22.873, maxLon: 23.088 },
  tileMaxZoom: 14,
  tilePackMB: 2,
  railGateways: ['Augustów'],
  features: { cable: false, campusPois: false, regionalRail: false, live: true, news: false, directBusPosition: false },
};

const KETRZYN: CityDef = {
  id: 'ketrzyn',
  name: 'Kętrzyn',
  center: { lat: 54.079, lon: 21.3781 },
  radiusM: 9_000,
  bounds: { minLat: 54.015, maxLat: 54.137, minLon: 21.302, maxLon: 21.556 },
  nominatimViewbox: '21.302,54.137,21.556,54.015',
  overpassBbox: '54.015,21.302,54.137,21.556',
  zbiorkomSlug: 'ketrzyn',
  zbiorkomBbox: '21.302,54.015,21.556,54.137',
  kpPrefix: 'ketrzyn',
  dbFile: 'kilometr-gtfs-ketrzyn.db',
  tilePack: 'ketrzyn-tiles.ktp',
  tileBbox: { minLat: 54.015, maxLat: 54.137, minLon: 21.302, maxLon: 21.556 },
  tileMaxZoom: 14,
  tilePackMB: 3,
  railGateways: ['Kętrzyn'],
  features: { cable: false, campusPois: false, regionalRail: false, live: true, news: false, directBusPosition: false },
};

const ZGORZELEC: CityDef = {
  id: 'zgorzelec',
  name: 'Zgorzelec',
  center: { lat: 51.15, lon: 15.0138 },
  radiusM: 6_000,
  bounds: { minLat: 51.085, maxLat: 51.219, minLon: 14.954, maxLon: 15.082 },
  nominatimViewbox: '14.954,51.219,15.082,51.085',
  overpassBbox: '51.085,14.954,51.219,15.082',
  zbiorkomSlug: 'zgorzelec',
  zbiorkomBbox: '14.954,51.085,15.082,51.219',
  kpPrefix: 'zgorzelec',
  dbFile: 'kilometr-gtfs-zgorzelec.db',
  tilePack: 'zgorzelec-tiles.ktp',
  tileBbox: { minLat: 51.085, maxLat: 51.219, minLon: 14.954, maxLon: 15.082 },
  tileMaxZoom: 14,
  tilePackMB: 2,
  railGateways: ['Zgorzelec'],
  features: { cable: false, campusPois: false, regionalRail: false, live: true, news: false, directBusPosition: false },
};

const POLKOWICE: CityDef = {
  id: 'polkowice',
  name: 'Polkowice',
  center: { lat: 51.5048, lon: 16.068 },
  radiusM: 13_000,
  bounds: { minLat: 51.402, maxLat: 51.641, minLon: 15.931, maxLon: 16.231 },
  nominatimViewbox: '15.931,51.641,16.231,51.402',
  overpassBbox: '51.402,15.931,51.641,16.231',
  zbiorkomSlug: 'polkowice',
  zbiorkomBbox: '15.931,51.402,16.231,51.641',
  kpPrefix: 'polkowice',
  dbFile: 'kilometr-gtfs-polkowice.db',
  tilePack: 'polkowice-tiles.ktp',
  tileBbox: { minLat: 51.402, maxLat: 51.641, minLon: 15.931, maxLon: 16.231 },
  tileMaxZoom: 14,
  tilePackMB: 7,
  railGateways: ['Lubin'],
  features: { cable: false, campusPois: false, regionalRail: false, live: true, news: false, directBusPosition: false },
};

const GORLICE: CityDef = {
  id: 'gorlice',
  name: 'Gorlice',
  center: { lat: 49.6637, lon: 21.1765 },
  radiusM: 16_000,
  bounds: { minLat: 49.549, maxLat: 49.796, minLon: 20.978, maxLon: 21.379 },
  nominatimViewbox: '20.978,49.796,21.379,49.549',
  overpassBbox: '49.549,20.978,49.796,21.379',
  zbiorkomSlug: 'gorlice',
  zbiorkomBbox: '20.978,49.549,21.379,49.796',
  kpPrefix: 'gorlice',
  dbFile: 'kilometr-gtfs-gorlice.db',
  tilePack: 'gorlice-tiles.ktp',
  tileBbox: { minLat: 49.549, maxLat: 49.796, minLon: 20.978, maxLon: 21.379 },
  tileMaxZoom: 14,
  tilePackMB: 10,
  railGateways: ['Gorlice Zagórzany'],
  features: { cable: false, campusPois: false, regionalRail: false, live: true, news: false, directBusPosition: false },
};

const JAROCIN: CityDef = {
  id: 'jarocin',
  name: 'Jarocin',
  center: { lat: 51.967, lon: 17.5019 },
  radiusM: 19_000,
  bounds: { minLat: 51.826, maxLat: 52.129, minLon: 17.197, maxLon: 17.794 },
  nominatimViewbox: '17.197,52.129,17.794,51.826',
  overpassBbox: '51.826,17.197,52.129,17.794',
  zbiorkomSlug: 'jarocin',
  zbiorkomBbox: '17.197,51.826,17.794,52.129',
  kpPrefix: 'jarocin',
  dbFile: 'kilometr-gtfs-jarocin.db',
  tilePack: 'jarocin-tiles.ktp',
  tileBbox: { minLat: 51.826, maxLat: 52.129, minLon: 17.197, maxLon: 17.794 },
  tileMaxZoom: 14,
  tilePackMB: 18,
  railGateways: ['Jarocin'],
  features: { cable: false, campusPois: false, regionalRail: false, live: true, news: false, directBusPosition: false },
};

const WRZESNIA: CityDef = {
  id: 'wrzesnia',
  name: 'Września',
  center: { lat: 52.3273, lon: 17.5771 },
  radiusM: 11_000,
  bounds: { minLat: 52.219, maxLat: 52.442, minLon: 17.449, maxLon: 17.774 },
  nominatimViewbox: '17.449,52.442,17.774,52.219',
  overpassBbox: '52.219,17.449,52.442,17.774',
  zbiorkomSlug: 'wrzesnia',
  zbiorkomBbox: '17.449,52.219,17.774,52.442',
  kpPrefix: 'wrzesnia',
  dbFile: 'kilometr-gtfs-wrzesnia.db',
  tilePack: 'wrzesnia-tiles.ktp',
  tileBbox: { minLat: 52.219, maxLat: 52.442, minLon: 17.449, maxLon: 17.774 },
  tileMaxZoom: 14,
  tilePackMB: 7,
  railGateways: ['Września'],
  features: { cable: false, campusPois: false, regionalRail: false, live: true, news: false, directBusPosition: false },
};

const WALCZ: CityDef = {
  id: 'walcz',
  name: 'Wałcz',
  center: { lat: 53.2757, lon: 16.4684 },
  radiusM: 13_000,
  bounds: { minLat: 53.136, maxLat: 53.423, minLon: 16.335, maxLon: 16.618 },
  nominatimViewbox: '16.335,53.423,16.618,53.136',
  overpassBbox: '53.136,16.335,53.423,16.618',
  zbiorkomSlug: 'walcz',
  zbiorkomBbox: '16.335,53.136,16.618,53.423',
  kpPrefix: 'walcz',
  dbFile: 'kilometr-gtfs-walcz.db',
  tilePack: 'walcz-tiles.ktp',
  tileBbox: { minLat: 53.136, maxLat: 53.423, minLon: 16.335, maxLon: 16.618 },
  tileMaxZoom: 14,
  tilePackMB: 8,
  railGateways: ['Wałcz'],
  features: { cable: false, campusPois: false, regionalRail: false, live: true, news: false, directBusPosition: false },
};

const GIZYCKO: CityDef = {
  id: 'gizycko',
  name: 'Giżycko',
  center: { lat: 54.0375, lon: 21.7693 },
  radiusM: 13_000,
  bounds: { minLat: 53.958, maxLat: 54.132, minLon: 21.545, maxLon: 21.965 },
  nominatimViewbox: '21.545,54.132,21.965,53.958',
  overpassBbox: '53.958,21.545,54.132,21.965',
  zbiorkomSlug: 'gizycko',
  zbiorkomBbox: '21.545,53.958,21.965,54.132',
  kpPrefix: 'gizycko',
  dbFile: 'kilometr-gtfs-gizycko.db',
  tilePack: 'gizycko-tiles.ktp',
  tileBbox: { minLat: 53.958, maxLat: 54.132, minLon: 21.545, maxLon: 21.965 },
  tileMaxZoom: 14,
  tilePackMB: 7,
  railGateways: ['Giżycko'],
  features: { cable: false, campusPois: false, regionalRail: false, live: true, news: false, directBusPosition: false },
};

const ZAGAN: CityDef = {
  id: 'zagan',
  name: 'Żagań',
  center: { lat: 51.617, lon: 15.314 },
  radiusM: 12_000,
  bounds: { minLat: 51.55, maxLat: 51.68, minLon: 15.22, maxLon: 15.42 },
  nominatimViewbox: '15.22,51.68,15.42,51.55',
  overpassBbox: '51.55,15.22,51.68,15.42',
  zbiorkomSlug: 'zagan',
  zbiorkomBbox: '15.21,51.54,15.43,51.69',
  kpPrefix: 'zagan',
  dbFile: 'kilometr-gtfs-zagan.db',
  tilePack: 'zagan-tiles.ktp',
  tileBbox: { minLat: 51.54, maxLat: 51.69, minLon: 15.21, maxLon: 15.43 },
  tileMaxZoom: 14,
  tilePackMB: 3,
  railGateways: ['Żagań'],
  features: { cable: false, campusPois: false, regionalRail: false, live: true, news: false, directBusPosition: false },
};

const KOSCIERZYNA: CityDef = {
  id: 'koscierzyna',
  name: 'Kościerzyna',
  center: { lat: 54.121, lon: 17.9736 },
  radiusM: 6_000,
  bounds: { minLat: 54.07, maxLat: 54.173, minLon: 17.903, maxLon: 18.059 },
  nominatimViewbox: '17.903,54.173,18.059,54.07',
  overpassBbox: '54.07,17.903,54.173,18.059',
  zbiorkomSlug: 'koscierzyna',
  zbiorkomBbox: '17.903,54.07,18.059,54.173',
  kpPrefix: 'miastokoscierzyna',
  dbFile: 'kilometr-gtfs-koscierzyna.db',
  tilePack: 'koscierzyna-tiles.ktp',
  tileBbox: { minLat: 54.07, maxLat: 54.173, minLon: 17.903, maxLon: 18.059 },
  tileMaxZoom: 14,
  tilePackMB: 2,
  railGateways: ['Kościerzyna'],
  features: { cable: false, campusPois: false, regionalRail: false, live: true, news: false, directBusPosition: false },
};

const KROTOSZYN: CityDef = {
  id: 'krotoszyn',
  name: 'Krotoszyn',
  center: { lat: 51.6958, lon: 17.4532 },
  radiusM: 28_000,
  bounds: { minLat: 51.471, maxLat: 52.007, minLon: 17.217, maxLon: 17.856 },
  nominatimViewbox: '17.217,52.007,17.856,51.471',
  overpassBbox: '51.471,17.217,52.007,17.856',
  zbiorkomSlug: 'krotoszyn',
  zbiorkomBbox: '17.217,51.471,17.856,52.007',
  kpPrefix: 'krotoszyn',
  dbFile: 'kilometr-gtfs-krotoszyn.db',
  tilePack: 'krotoszyn-tiles.ktp',
  tileBbox: { minLat: 51.471, maxLat: 52.007, minLon: 17.217, maxLon: 17.856 },
  tileMaxZoom: 14,
  tilePackMB: 25,
  railGateways: ['Krotoszyn'],
  features: { cable: false, campusPois: false, regionalRail: false, live: true, news: false, directBusPosition: false },
};

const SANDOMIERZ: CityDef = {
  id: 'sandomierz',
  name: 'Sandomierz',
  center: { lat: 50.6846, lon: 21.7558 },
  radiusM: 6_000,
  bounds: { minLat: 50.604, maxLat: 50.748, minLon: 21.666, maxLon: 21.84 },
  nominatimViewbox: '21.666,50.748,21.84,50.604',
  overpassBbox: '50.604,21.666,50.748,21.84',
  zbiorkomSlug: 'sandomierz',
  zbiorkomBbox: '21.666,50.604,21.84,50.748',
  kpPrefix: 'sandomierz',
  dbFile: 'kilometr-gtfs-sandomierz.db',
  tilePack: 'sandomierz-tiles.ktp',
  tileBbox: { minLat: 50.604, maxLat: 50.748, minLon: 21.666, maxLon: 21.84 },
  tileMaxZoom: 14,
  tilePackMB: 3,
  railGateways: ['Sandomierz'],
  features: { cable: false, campusPois: false, regionalRail: false, live: true, news: false, directBusPosition: false },
};

const BARTOSZYCE: CityDef = {
  id: 'bartoszyce',
  name: 'Bartoszyce',
  center: { lat: 54.2524, lon: 20.8151 },
  radiusM: 6_000,
  bounds: { minLat: 54.197, maxLat: 54.325, minLon: 20.748, maxLon: 20.892 },
  nominatimViewbox: '20.748,54.325,20.892,54.197',
  overpassBbox: '54.197,20.748,54.325,20.892',
  zbiorkomSlug: 'bartoszyce',
  zbiorkomBbox: '20.748,54.197,20.892,54.325',
  kpPrefix: 'bartoszyce',
  dbFile: 'kilometr-gtfs-bartoszyce.db',
  tilePack: 'bartoszyce-tiles.ktp',
  tileBbox: { minLat: 54.197, maxLat: 54.325, minLon: 20.748, maxLon: 20.892 },
  tileMaxZoom: 14,
  tilePackMB: 2,
  railGateways: ['Korsze'],
  features: { cable: false, campusPois: false, regionalRail: false, live: true, news: false, directBusPosition: false },
};

const WIELUN: CityDef = {
  id: 'wielun',
  name: 'Wieluń',
  center: { lat: 51.2239, lon: 18.5796 },
  radiusM: 11_000,
  bounds: { minLat: 51.123, maxLat: 51.314, minLon: 18.388, maxLon: 18.762 },
  nominatimViewbox: '18.388,51.314,18.762,51.123',
  overpassBbox: '51.123,18.388,51.314,18.762',
  zbiorkomSlug: 'wielun',
  zbiorkomBbox: '18.388,51.123,18.762,51.314',
  kpPrefix: 'wielun',
  dbFile: 'kilometr-gtfs-wielun.db',
  tilePack: 'wielun-tiles.ktp',
  tileBbox: { minLat: 51.123, maxLat: 51.314, minLon: 18.388, maxLon: 18.762 },
  tileMaxZoom: 14,
  tilePackMB: 7,
  railGateways: ['Wieluń Dąbrowa'],
  features: { cable: false, campusPois: false, regionalRail: false, live: true, news: false, directBusPosition: false },
};

const MRAGOWO: CityDef = {
  id: 'mragowo',
  name: 'Mrągowo',
  center: { lat: 53.8656, lon: 21.3022 },
  radiusM: 6_000,
  bounds: { minLat: 53.801, maxLat: 53.943, minLon: 21.226, maxLon: 21.368 },
  nominatimViewbox: '21.226,53.943,21.368,53.801',
  overpassBbox: '53.801,21.226,53.943,21.368',
  zbiorkomSlug: 'mragowo',
  zbiorkomBbox: '21.226,53.801,21.368,53.943',
  kpPrefix: 'mragowo',
  dbFile: 'kilometr-gtfs-mragowo.db',
  tilePack: 'mragowo-tiles.ktp',
  tileBbox: { minLat: 53.801, maxLat: 53.943, minLon: 21.226, maxLon: 21.368 },
  tileMaxZoom: 14,
  tilePackMB: 2,
  railGateways: ['Olsztyn Główny'],
  features: { cable: false, campusPois: false, regionalRail: false, live: true, news: false, directBusPosition: false },
};

const SWIECIE: CityDef = {
  id: 'swiecie',
  name: 'Świecie',
  center: { lat: 53.4079, lon: 18.4189 },
  radiusM: 10_000,
  bounds: { minLat: 53.309, maxLat: 53.477, minLon: 18.267, maxLon: 18.521 },
  nominatimViewbox: '18.267,53.477,18.521,53.309',
  overpassBbox: '53.309,18.267,53.477,18.521',
  zbiorkomSlug: 'swiecie',
  zbiorkomBbox: '18.267,53.309,18.521,53.477',
  kpPrefix: 'swiecie',
  dbFile: 'kilometr-gtfs-swiecie.db',
  tilePack: 'swiecie-tiles.ktp',
  tileBbox: { minLat: 53.309, maxLat: 53.477, minLon: 18.267, maxLon: 18.521 },
  tileMaxZoom: 14,
  tilePackMB: 4,
  railGateways: ['Terespol Pomorski'],
  features: { cable: false, campusPois: false, regionalRail: false, live: true, news: false, directBusPosition: false },
};

const WAGROWIEC: CityDef = {
  id: 'wagrowiec',
  name: 'Wągrowiec',
  center: { lat: 52.8086, lon: 17.2053 },
  radiusM: 7_000,
  bounds: { minLat: 52.713, maxLat: 52.9, minLon: 17.116, maxLon: 17.306 },
  nominatimViewbox: '17.116,52.9,17.306,52.713',
  overpassBbox: '52.713,17.116,52.9,17.306',
  zbiorkomSlug: 'wagrowiec',
  zbiorkomBbox: '17.116,52.713,17.306,52.9',
  kpPrefix: 'wagrowiec',
  dbFile: 'kilometr-gtfs-wagrowiec.db',
  tilePack: 'wagrowiec-tiles.ktp',
  tileBbox: { minLat: 52.713, maxLat: 52.9, minLon: 17.116, maxLon: 17.306 },
  tileMaxZoom: 14,
  tilePackMB: 4,
  railGateways: ['Wągrowiec'],
  features: { cable: false, campusPois: false, regionalRail: false, live: true, news: false, directBusPosition: false },
};

const BIELSKPODLASKI: CityDef = {
  id: 'bielskpodlaski',
  name: 'Bielsk Podlaski',
  center: { lat: 52.7686, lon: 23.1892 },
  radiusM: 6_000,
  bounds: { minLat: 52.704, maxLat: 52.842, minLon: 23.073, maxLon: 23.301 },
  nominatimViewbox: '23.073,52.842,23.301,52.704',
  overpassBbox: '52.704,23.073,52.842,23.301',
  zbiorkomSlug: 'bielskpodlaski',
  zbiorkomBbox: '23.073,52.704,23.301,52.842',
  kpPrefix: 'bielskpodlaski',
  dbFile: 'kilometr-gtfs-bielskpodlaski.db',
  tilePack: 'bielskpodlaski-tiles.ktp',
  tileBbox: { minLat: 52.704, maxLat: 52.842, minLon: 23.073, maxLon: 23.301 },
  tileMaxZoom: 14,
  tilePackMB: 3,
  railGateways: ['Bielsk Podlaski'],
  features: { cable: false, campusPois: false, regionalRail: false, live: true, news: false, directBusPosition: false },
};

const DZIALDOWO: CityDef = {
  id: 'dzialdowo',
  name: 'Działdowo',
  center: { lat: 53.2359, lon: 20.1777 },
  radiusM: 6_000,
  bounds: { minLat: 53.174, maxLat: 53.292, minLon: 20.092, maxLon: 20.274 },
  nominatimViewbox: '20.092,53.292,20.274,53.174',
  overpassBbox: '53.174,20.092,53.292,20.274',
  zbiorkomSlug: 'dzialdowo',
  zbiorkomBbox: '20.092,53.174,20.274,53.292',
  kpPrefix: 'dzialdowo',
  dbFile: 'kilometr-gtfs-dzialdowo.db',
  tilePack: 'dzialdowo-tiles.ktp',
  tileBbox: { minLat: 53.174, maxLat: 53.292, minLon: 20.092, maxLon: 20.274 },
  tileMaxZoom: 14,
  tilePackMB: 2,
  railGateways: ['Działdowo'],
  features: { cable: false, campusPois: false, regionalRail: false, live: true, news: false, directBusPosition: false },
};

const BRZESKO: CityDef = {
  id: 'brzesko',
  name: 'Brzesko',
  center: { lat: 49.9716, lon: 20.6101 },
  radiusM: 8_000,
  bounds: { minLat: 49.898, maxLat: 50.081, minLon: 20.481, maxLon: 20.745 },
  nominatimViewbox: '20.481,50.081,20.745,49.898',
  overpassBbox: '49.898,20.481,50.081,20.745',
  zbiorkomSlug: 'brzesko',
  zbiorkomBbox: '20.481,49.898,20.745,50.081',
  kpPrefix: 'brzesko',
  dbFile: 'kilometr-gtfs-brzesko.db',
  tilePack: 'brzesko-tiles.ktp',
  tileBbox: { minLat: 49.898, maxLat: 50.081, minLon: 20.481, maxLon: 20.745 },
  tileMaxZoom: 14,
  tilePackMB: 5,
  railGateways: ['Brzesko Okocim'],
  features: { cable: false, campusPois: false, regionalRail: false, live: true, news: false, directBusPosition: false },
};

const GOSTYN: CityDef = {
  id: 'gostyn',
  name: 'Gostyń',
  center: { lat: 51.8816, lon: 17.0059 },
  radiusM: 9_000,
  bounds: { minLat: 51.786, maxLat: 51.989, minLon: 16.846, maxLon: 17.105 },
  nominatimViewbox: '16.846,51.989,17.105,51.786',
  overpassBbox: '51.786,16.846,51.989,17.105',
  zbiorkomSlug: 'gostyn',
  zbiorkomBbox: '16.846,51.786,17.105,51.989',
  kpPrefix: 'gostyn',
  dbFile: 'kilometr-gtfs-gostyn.db',
  tilePack: 'gostyn-tiles.ktp',
  tileBbox: { minLat: 51.786, maxLat: 51.989, minLon: 16.846, maxLon: 17.105 },
  tileMaxZoom: 14,
  tilePackMB: 5,
  railGateways: ['Gostyń'],
  features: { cable: false, campusPois: false, regionalRail: false, live: true, news: false, directBusPosition: false },
};

const CHODZIEZ: CityDef = {
  id: 'chodziez',
  name: 'Chodzież',
  center: { lat: 52.9952, lon: 16.9142 },
  radiusM: 8_000,
  bounds: { minLat: 52.919, maxLat: 53.083, minLon: 16.779, maxLon: 17.018 },
  nominatimViewbox: '16.779,53.083,17.018,52.919',
  overpassBbox: '52.919,16.779,53.083,17.018',
  zbiorkomSlug: 'chodziez',
  zbiorkomBbox: '16.779,52.919,17.018,53.083',
  kpPrefix: 'chodziez',
  dbFile: 'kilometr-gtfs-chodziez.db',
  tilePack: 'chodziez-tiles.ktp',
  tileBbox: { minLat: 52.919, maxLat: 53.083, minLon: 16.779, maxLon: 17.018 },
  tileMaxZoom: 14,
  tilePackMB: 4,
  railGateways: ['Chodzież'],
  features: { cable: false, campusPois: false, regionalRail: false, live: true, news: false, directBusPosition: false },
};

const LIDZBARKWARMINSKI: CityDef = {
  id: 'lidzbarkwarminski',
  name: 'Lidzbark Warmiński',
  center: { lat: 54.126, lon: 20.5758 },
  radiusM: 6_000,
  bounds: { minLat: 54.072, maxLat: 54.193, minLon: 20.503, maxLon: 20.664 },
  nominatimViewbox: '20.503,54.193,20.664,54.072',
  overpassBbox: '54.072,20.503,54.193,20.664',
  zbiorkomSlug: 'lidzbarkwarminski',
  zbiorkomBbox: '20.503,54.072,20.664,54.193',
  kpPrefix: 'lidzbarkwarminski',
  dbFile: 'kilometr-gtfs-lidzbarkwarminski.db',
  tilePack: 'lidzbarkwarminski-tiles.ktp',
  tileBbox: { minLat: 54.072, maxLat: 54.193, minLon: 20.503, maxLon: 20.664 },
  tileMaxZoom: 14,
  tilePackMB: 2,
  railGateways: ['Olsztyn Główny'],
  features: { cable: false, campusPois: false, regionalRail: false, live: true, news: false, directBusPosition: false },
};

const PSZCZYNA: CityDef = {
  id: 'pszczyna',
  name: 'Pszczyna',
  center: { lat: 49.9781, lon: 18.9419 },
  radiusM: 9_000,
  bounds: { minLat: 49.885, maxLat: 50.045, minLon: 18.644, maxLon: 19.175 },
  nominatimViewbox: '18.644,50.156,19.175,49.885',
  overpassBbox: '49.885,18.644,50.156,19.175',
  zbiorkomSlug: 'pszczyna',
  zbiorkomBbox: '18.644,49.885,19.175,50.156',
  kpPrefix: 'pszczyna',
  dbFile: 'kilometr-gtfs-pszczyna.db',
  tilePack: 'pszczyna-tiles.ktp',
  tileBbox: { minLat: 49.885, maxLat: 50.156, minLon: 18.644, maxLon: 19.175 },
  tileMaxZoom: 14,
  tilePackMB: 14,
  railGateways: ['Pszczyna'],
  features: { cable: false, campusPois: false, regionalRail: false, live: true, news: false, directBusPosition: false },
};

const WODZISLAW: CityDef = {
  id: 'wodzislaw',
  name: 'Wodzisław Śląski',
  center: { lat: 49.9933, lon: 18.4483 },
  radiusM: 20_000,
  bounds: { minLat: 49.864, maxLat: 50.136, minLon: 18.18, maxLon: 18.655 },
  nominatimViewbox: '18.18,50.136,18.655,49.864',
  overpassBbox: '49.864,18.18,50.136,18.655',
  zbiorkomSlug: 'wodzislaw',
  zbiorkomBbox: '18.18,49.864,18.655,50.136',
  kpPrefix: 'powiatwodzislawski',
  dbFile: 'kilometr-gtfs-wodzislaw.db',
  tilePack: 'wodzislaw-tiles.ktp',
  tileBbox: { minLat: 49.864, maxLat: 50.136, minLon: 18.18, maxLon: 18.655 },
  tileMaxZoom: 14,
  tilePackMB: 13,
  railGateways: ['Wodzisław Śląski'],
  features: { cable: false, campusPois: false, regionalRail: false, live: true, news: false, directBusPosition: false },
};

const ZABKOWICE: CityDef = {
  id: 'zabkowice',
  name: 'Ząbkowice Śląskie',
  center: { lat: 50.5936, lon: 16.8167 },
  radiusM: 9_000,
  bounds: { minLat: 50.5, maxLat: 50.696, minLon: 16.688, maxLon: 16.967 },
  nominatimViewbox: '16.688,50.696,16.967,50.5',
  overpassBbox: '50.5,16.688,50.696,16.967',
  zbiorkomSlug: 'zabkowice',
  zbiorkomBbox: '16.688,50.5,16.967,50.696',
  kpPrefix: 'zabkowice',
  dbFile: 'kilometr-gtfs-zabkowice.db',
  tilePack: 'zabkowice-tiles.ktp',
  tileBbox: { minLat: 50.5, maxLat: 50.696, minLon: 16.688, maxLon: 16.967 },
  tileMaxZoom: 14,
  tilePackMB: 5,
  railGateways: ['Ząbkowice Śląskie'],
  features: { cable: false, campusPois: false, regionalRail: false, live: false, news: false, directBusPosition: false },
};

const STRZELIN: CityDef = {
  id: 'strzelin',
  name: 'Strzelin',
  center: { lat: 50.7788, lon: 17.0685 },
  radiusM: 12_000,
  bounds: { minLat: 50.657, maxLat: 50.875, minLon: 16.914, maxLon: 17.225 },
  nominatimViewbox: '16.914,50.875,17.225,50.657',
  overpassBbox: '50.657,16.914,50.875,17.225',
  zbiorkomSlug: 'strzelin',
  zbiorkomBbox: '16.914,50.657,17.225,50.875',
  kpPrefix: 'strzelin',
  dbFile: 'kilometr-gtfs-strzelin.db',
  tilePack: 'strzelin-tiles.ktp',
  tileBbox: { minLat: 50.657, maxLat: 50.875, minLon: 16.914, maxLon: 17.225 },
  tileMaxZoom: 14,
  tilePackMB: 7,
  railGateways: ['Strzelin'],
  features: { cable: false, campusPois: false, regionalRail: false, live: true, news: false, directBusPosition: false },
};

const SRODASLASKA: CityDef = {
  id: 'srodaslaska',
  name: 'Środa Śląska',
  center: { lat: 51.1639, lon: 16.6024 },
  radiusM: 22_000,
  bounds: { minLat: 51.033, maxLat: 51.282, minLon: 16.41, maxLon: 16.952 },
  nominatimViewbox: '16.41,51.282,16.952,51.033',
  overpassBbox: '51.033,16.41,51.282,16.952',
  zbiorkomSlug: 'srodaslaska',
  zbiorkomBbox: '16.41,51.033,16.952,51.282',
  kpPrefix: 'srodaslaska',
  dbFile: 'kilometr-gtfs-srodaslaska.db',
  tilePack: 'srodaslaska-tiles.ktp',
  tileBbox: { minLat: 51.033, maxLat: 51.282, minLon: 16.41, maxLon: 16.952 },
  tileMaxZoom: 14,
  tilePackMB: 13,
  railGateways: ['Środa Śląska'],
  features: { cable: false, campusPois: false, regionalRail: false, live: true, news: false, directBusPosition: false },
};

const JEDRZEJOW: CityDef = {
  id: 'jedrzejow',
  name: 'Jędrzejów',
  center: { lat: 50.6397, lon: 20.2958 },
  radiusM: 10_000,
  bounds: { minLat: 50.547, maxLat: 50.738, minLon: 20.152, maxLon: 20.465 },
  nominatimViewbox: '20.152,50.738,20.465,50.547',
  overpassBbox: '50.547,20.152,50.738,20.465',
  zbiorkomSlug: 'jedrzejow',
  zbiorkomBbox: '20.152,50.547,20.465,50.738',
  kpPrefix: 'jedrzejow',
  dbFile: 'kilometr-gtfs-jedrzejow.db',
  tilePack: 'jedrzejow-tiles.ktp',
  tileBbox: { minLat: 50.547, maxLat: 50.738, minLon: 20.152, maxLon: 20.465 },
  tileMaxZoom: 14,
  tilePackMB: 6,
  railGateways: ['Jędrzejów'],
  features: { cable: false, campusPois: false, regionalRail: false, live: false, news: false, directBusPosition: false },
};

const KOZIENICE: CityDef = {
  id: 'kozienice',
  name: 'Kozienice',
  center: { lat: 51.5862, lon: 21.5405 },
  radiusM: 16_000,
  bounds: { minLat: 51.5, maxLat: 51.749, minLon: 21.334, maxLon: 21.711 },
  nominatimViewbox: '21.334,51.749,21.711,51.5',
  overpassBbox: '51.5,21.334,51.749,21.711',
  zbiorkomSlug: 'kozienice',
  zbiorkomBbox: '21.334,51.5,21.711,51.749',
  kpPrefix: 'kozienice',
  dbFile: 'kilometr-gtfs-kozienice.db',
  tilePack: 'kozienice-tiles.ktp',
  tileBbox: { minLat: 51.5, maxLat: 51.749, minLon: 21.334, maxLon: 21.711 },
  tileMaxZoom: 14,
  tilePackMB: 9,
  railGateways: ['Pionki Zachodnie'],
  features: { cable: false, campusPois: false, regionalRail: false, live: true, news: false, directBusPosition: false },
};

const OBORNIKI: CityDef = {
  id: 'oborniki',
  name: 'Oborniki',
  center: { lat: 52.6497, lon: 16.8022 },
  radiusM: 21_000,
  bounds: { minLat: 52.516, maxLat: 52.8, minLon: 16.479, maxLon: 17.05 },
  nominatimViewbox: '16.479,52.8,17.05,52.516',
  overpassBbox: '52.516,16.479,52.8,17.05',
  zbiorkomSlug: 'oborniki',
  zbiorkomBbox: '16.479,52.516,17.05,52.8',
  kpPrefix: 'oborniki',
  dbFile: 'kilometr-gtfs-oborniki.db',
  tilePack: 'oborniki-tiles.ktp',
  tileBbox: { minLat: 52.516, maxLat: 52.8, minLon: 16.479, maxLon: 17.05 },
  tileMaxZoom: 14,
  tilePackMB: 16,
  railGateways: ['Oborniki Wielkopolskie'],
  features: { cable: false, campusPois: false, regionalRail: false, live: true, news: false, directBusPosition: false },
};

const WIELICZKA: CityDef = {
  id: 'wieliczka',
  name: 'Wieliczka',
  center: { lat: 49.9729, lon: 20.068 },
  radiusM: 7_000,
  bounds: { minLat: 49.871, maxLat: 50.109, minLon: 19.901, maxLon: 20.221 },
  nominatimViewbox: '19.901,50.109,20.221,49.871',
  overpassBbox: '49.871,19.901,50.109,20.221',
  zbiorkomSlug: 'wieliczka',
  zbiorkomBbox: '19.901,49.871,20.221,50.109',
  kpPrefix: 'wieliczka',
  dbFile: 'kilometr-gtfs-wieliczka.db',
  tilePack: 'wieliczka-tiles.ktp',
  tileBbox: { minLat: 49.871, maxLat: 50.109, minLon: 19.901, maxLon: 20.221 },
  tileMaxZoom: 14,
  tilePackMB: 8,
  railGateways: ['Wieliczka Rynek-Kopalnia'],
  features: { cable: false, campusPois: false, regionalRail: false, live: true, news: false, directBusPosition: false },
};

const MYSZKOW: CityDef = {
  id: 'myszkow',
  name: 'Myszków',
  center: { lat: 50.576, lon: 19.326 },
  radiusM: 11_000,
  bounds: { minLat: 50.48, maxLat: 50.68, minLon: 19.18, maxLon: 19.5 },
  nominatimViewbox: '19.18,50.68,19.5,50.48',
  overpassBbox: '50.48,19.18,50.68,19.5',
  zbiorkomSlug: 'myszkow',
  zbiorkomBbox: '19.17,50.47,19.51,50.69',
  kpPrefix: 'jedzmyrazem',
  dbFile: 'kilometr-gtfs-myszkow.db',
  tilePack: 'myszkow-tiles.ktp',
  tileBbox: { minLat: 50.47, maxLat: 50.69, minLon: 19.17, maxLon: 19.51 },
  tileMaxZoom: 14,
  tilePackMB: 7,
  railGateways: ['Myszków'],
  features: { cable: false, campusPois: false, regionalRail: false, live: true, news: false, directBusPosition: false },
};

const SLUBICE: CityDef = {
  id: 'slubice',
  name: 'Słubice',
  center: { lat: 52.3483, lon: 14.5853 },
  radiusM: 7_000,
  bounds: { minLat: 52.267, maxLat: 52.416, minLon: 14.516, maxLon: 14.696 },
  nominatimViewbox: '14.516,52.416,14.696,52.267',
  overpassBbox: '52.267,14.516,52.416,14.696',
  zbiorkomSlug: 'slubice',
  zbiorkomBbox: '14.516,52.267,14.696,52.416',
  kpPrefix: 'slubice',
  dbFile: 'kilometr-gtfs-slubice.db',
  tilePack: 'slubice-tiles.ktp',
  tileBbox: { minLat: 52.267, maxLat: 52.416, minLon: 14.516, maxLon: 14.696 },
  tileMaxZoom: 14,
  tilePackMB: 3,
  railGateways: ['Słubice'],
  features: { cable: false, campusPois: false, regionalRail: false, live: true, news: false, directBusPosition: false },
};

const KARTUZY: CityDef = {
  id: 'kartuzy',
  name: 'Kartuzy',
  center: { lat: 54.334, lon: 18.201 },
  radiusM: 12_000,
  bounds: { minLat: 54.22, maxLat: 54.43, minLon: 17.92, maxLon: 18.35 },
  nominatimViewbox: '17.92,54.43,18.35,54.22',
  overpassBbox: '54.22,17.92,54.43,18.35',
  zbiorkomSlug: 'kartuzy',
  zbiorkomBbox: '17.91,54.21,18.36,54.44',
  kpPrefix: 'gryf',
  dbFile: 'kilometr-gtfs-kartuzy.db',
  tilePack: 'kartuzy-tiles.ktp',
  tileBbox: { minLat: 54.21, maxLat: 54.44, minLon: 17.91, maxLon: 18.36 },
  tileMaxZoom: 14,
  tilePackMB: 10,
  railGateways: ['Kartuzy'],
  features: { cable: false, campusPois: false, regionalRail: false, live: true, news: false, directBusPosition: false },
};

export const CITIES: readonly CityDef[] = [
  WROCLAW, KRAKOW, GZM, WARSZAWA, POZNAN, TROJMIASTO, LODZ, SZCZECIN, KIELCE, OLSZTYN,
  BIALYSTOK, OPOLE, RZESZOW, LUBLIN, RADOM,
  BYDGOSZCZ, TORUN, ELBLAG, GORZOW, CZESTOCHOWA, ZIELONAGORA, RYBNIK, SLUPSK, WALBRZYCH,
  KALISZ, SIEDLCE, LOMZA, KROSNO, JASLO, OLKUSZ, CHRZANOW, BOCHNIA, ILAWA,
  BIELSKOBIALA, KOSZALIN, PIOTRKOW, TOMASZOW, SKARZYSKO, OSWIECIM, SWINOUJSCIE,
  ZAKOPANE, PLOCK, TARNOW, LEGNICA, JASTRZEBIE, PILA, KONIN,
  SUWALKI, OSTROWIEC, STALOWAWOLA, PRZEMYSL, ELK, LESZNO, CHELM,
  MIELEC, TCZEW, OSTROLEKA, STARACHOWICE, KUTNO, KOLOBRZEG, RADOMSKO,
  BOLESLAWIEC, CIESZYN, ZYWIEC, KRASNIK, GRODZISK, PRUSZKOW, SOCHACZEW,
  MINSKMAZOWIECKI, OTWOCK, NOWYDWORMAZ, ZABKI, PABIANICE, ZGIERZ, GRUDZIADZ,
  STARGARD, GNIEZNO, JAWORZNO, KEDZIERZYNKOZLE, ZAMOSC, RACIBORZ, BELCHATOW,
  TARNOBRZEG, SKIERNIEWICE, ZAWIERCIE, STAROGARD, ZDUNSKAWOLA, NYSA, MALBORK,
  SIERADZ, SZCZECINEK, NOWASOL, OLESNICA, CZECHOWICEDZIEDZICE, OSTRODA, NOWYTARG,
  AUGUSTOW, KETRZYN, ZGORZELEC, POLKOWICE, GORLICE, JAROCIN, WRZESNIA,
  WALCZ, GIZYCKO, ZAGAN, KOSCIERZYNA, KROTOSZYN, SANDOMIERZ, BARTOSZYCE,
  WIELUN, MRAGOWO, SWIECIE, WAGROWIEC, BIELSKPODLASKI, DZIALDOWO, BRZESKO,
  GOSTYN, CHODZIEZ, LIDZBARKWARMINSKI, PSZCZYNA, WODZISLAW, ZABKOWICE, STRZELIN,
  SRODASLASKA, JEDRZEJOW, KOZIENICE, OBORNIKI, WIELICZKA, MYSZKOW, SLUBICE,
  KARTUZY,
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

export function hasPoiDatabase(id?: string | null): boolean {
  return Boolean(getCity(id).features.poiDb);
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
