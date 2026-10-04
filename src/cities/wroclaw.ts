import type { CityDefinition } from './types';

// Wrocław — jedyne miasto, które aplikacja obsługiwała do tej pory. Wszystkie
// wartości przeniesione z dawnych modułów `services/gtfsConfig` i `config`.
export const WROCLAW: CityDefinition = {
  id: 'wroclaw',
  nameKey: 'wroclaw',
  countryCode: 'pl',

  // Granice z Open Data Wrocław — obejmują cały obszar komunikacyjny,
  // w tym podmiejskie linie na południu i wschodzie.
  bounds: { minLat: 50.95, maxLat: 51.25, minLon: 16.7, maxLon: 17.25 },
  // Rynek — środek miasta, używany zanim GPS zwróci pozycję.
  center: { lat: 51.1079, lon: 17.0385 },

  // left,top,right,bottom = minLon, maxLat, maxLon, minLat
  nominatimBbox: '16.7,51.25,17.25,50.95',
  // south,west,north,east
  overpassBbox: '50.95,16.70,51.25,17.25',

  // Katalog danych wskazuje kilka wydań; downloader wybiera najnowsze
  // obowiązujące po dacie w nazwie pliku, a `136` jest zawsze dostępne.
  feeds: [{ id: 'all', url: 'https://open-data.cui.wroclaw.pl/hdb/download/136/' }],
  catalogueUrl: 'https://api.open-data.cui.wroclaw.pl/od2/6/',
  downloadBase: 'https://open-data.cui.wroclaw.pl/hdb/download',
  fallbackDownloadUrl: 'https://open-data.cui.wroclaw.pl/hdb/download/136/',

  newsFeedUrl: 'https://www.wroclaw.pl/komunikacja/rss',

  realtime: {
    kind: 'mpk-form',
    endpoint: 'https://mpk.wroc.pl/bus_position',
    // Endpoint MPK wymaga wprost listy linii w podziale na tramwaje i
    // autobusy — bez kompletu zwraca tylko część pojazdów. Listy odwzorowują
    // feed Open Data (tramwaje 0–24, autobusy A/D/K/N i trzycyfrowe).
    tramLines: [
      '0', '1', '2', '3', '4', '5', '6', '7', '8', '9', '10',
      '11', '12', '13', '14', '15', '16', '17', '18', '19', '20',
      '21', '22', '23', '24',
    ],
    busLines: [
      'A', 'D', 'K', 'N',
      '100', '101', '102', '103', '104', '105', '106', '107', '108', '109', '110',
      '111', '112', '113', '114', '115', '116', '117', '118', '119', '120', '121', '122',
      '123', '124', '125', '126', '127', '128', '129', '130', '131', '132', '133', '134',
      '136', '137', '138', '140', '142', '143', '144', '145', '146', '147', '148', '149',
      '150', '151', '152', '153',
      '206', '240', '241', '242', '243', '244', '245', '246', '247', '248', '249',
      '250', '251', '253', '255', '257', '259',
      '306', '310', '315', '319', '343', '345',
      '602', '607', '612',
      '704', '715', '747',
      '903', '904', '905', '906', '907', '908', '909', '911', '914', '920', '921',
      '924', '927', '930', '931', '934', '936', '947', '948', '955', '958', '967',
    ],
    pollIntervalMs: 12000,
    timeoutMs: 8000,
  },

  // `route_type` w feedzie jest poprawny (tramwaje = 0, autobusy = 3), więc
  // ta lista tylko zabezpiecza feed z uszkodzonym route_type. Numery wzięte
  // z routes.txt Open Data Wrocław: dokładnie 0–24, bez linii literowych
  // (literowe A, D, K, N to u nich autobusy).
  tramLineFallback: [
    '0', '1', '2', '3', '4', '5', '6', '7', '8', '9',
    '10', '11', '12', '13', '14', '15', '16', '17', '18', '19',
    '20', '21', '22', '23', '24',
  ],

  refreshHours: 24,
};
