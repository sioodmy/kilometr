// Rejestr obsługiwanych miast. Jedno miejsce na wszystko co specyficzne
// dla miasta: środek strefy, bboxy, feedy GTFS/live/news, kafle offline.
// Nowe miasto = jeden wpis tutaj + build workera. Zero ifów po id miasta
// w reszcie kodu: serwisy czytają aktywny wpis przez cityStore.

export type CityId = 'wroclaw' | 'krakow' | 'gzm' | 'warszawa' | 'poznan' | 'trojmiasto' | 'lodz' | 'szczecin' | 'kielce' | 'olsztyn' | 'bialystok' | 'opole' | 'rzeszow' | 'lublin';

export interface CityCenter {
  lat: number;
  lon: number;
}

export interface CityBbox {
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
  features: {
    /** Kolej linowa (Polinka) istnieje tylko we Wrocławiu. */
    cable: boolean;
    /** Budynki uczelni w wyszukiwarce (PWr). */
    campusPois: boolean;
    /** Pociągi regionalne w prebuilt (KD we Wrocławiu). */
    regionalRail: boolean;
    /** Bezpośredni POST bus_position (tylko MPK Wrocław). */
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
  features: { cable: true, campusPois: true, regionalRail: true, directBusPosition: true },
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
  features: { cable: false, campusPois: false, regionalRail: true, directBusPosition: false },
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
  bounds: { minLat: 49.95, maxLat: 50.6, minLon: 18.3, maxLon: 19.8 },
  nominatimViewbox: '18.3,50.6,19.8,49.95',
  overpassBbox: '49.95,18.30,50.60,19.80',
  zbiorkomSlug: 'gzm',
  zbiorkomBbox: '18.3,49.95,19.8,50.6',
  dbFile: 'kilometr-gtfs-gzm.db',
  tilePack: 'gzm-tiles.ktp',
  tileBbox: { minLat: 49.9, maxLat: 50.65, minLon: 18.25, maxLon: 19.85 },
  // Dzięki kompresji gzip z14 dla całej metropolii mieści się w ~104 MB
  // (limit R2 to 300 MB) i odblokowuje pieszy routing offline w Raptorze.
  tileMaxZoom: 14,
  tilePackMB: 104,
  features: { cable: false, campusPois: false, regionalRail: true, directBusPosition: false },
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
  features: { cable: false, campusPois: false, regionalRail: true, directBusPosition: false },
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
  features: { cable: false, campusPois: false, regionalRail: true, directBusPosition: false },
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
  features: { cable: false, campusPois: false, regionalRail: true, directBusPosition: false },
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
  features: { cable: false, campusPois: false, regionalRail: true, directBusPosition: false },
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
  features: { cable: false, campusPois: false, regionalRail: false, directBusPosition: false },
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
  features: { cable: false, campusPois: false, regionalRail: false, directBusPosition: false },
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
  features: { cable: false, campusPois: false, regionalRail: false, directBusPosition: false },
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
  features: { cable: false, campusPois: false, regionalRail: false, directBusPosition: false },
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
  features: { cable: false, campusPois: false, regionalRail: false, directBusPosition: false },
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
  features: { cable: false, campusPois: false, regionalRail: false, directBusPosition: false },
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
  features: { cable: false, campusPois: false, regionalRail: false, directBusPosition: false },
};

export const CITIES: readonly CityDef[] = [WROCLAW, KRAKOW, GZM, WARSZAWA, POZNAN, TROJMIASTO, LODZ, SZCZECIN, KIELCE, OLSZTYN, BIALYSTOK, OPOLE, RZESZOW, LUBLIN];

export const DEFAULT_CITY_ID: CityId = 'wroclaw';

export function getCity(id: string | null | undefined): CityDef {
  return CITIES.find((c) => c.id === id) ?? WROCLAW;
}

export function isCityId(id: string | null | undefined): id is CityId {
  return CITIES.some((c) => c.id === id);
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
export function cityDistanceM(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const R = 6_371_000;
  const dLa = ((bLat - aLat) * Math.PI) / 180;
  const dLo = ((bLon - aLon) * Math.PI) / 180;
  const s =
    Math.sin(dLa / 2) ** 2 +
    Math.cos((aLat * Math.PI) / 180) * Math.cos((bLat * Math.PI) / 180) * Math.sin(dLo / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

/** Miasto dla współrzędnych: najbliższy środek w swoim promieniu, inaczej null. */
export function suggestCityForCoords(lat: number, lon: number): CityDef | null {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  let best: CityDef | null = null;
  let bestDist = Infinity;
  for (const c of CITIES) {
    const d = cityDistanceM(lat, lon, c.center.lat, c.center.lon);
    if (d <= c.radiusM && d < bestDist) {
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
