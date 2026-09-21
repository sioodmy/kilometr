import type {
  Connection,
  SavedPlace,
  SmartDestination,
  Suggestion,
} from '../types/models';

// ─── Fixed demo origin (fake GPS until expo-location is wired) ───────────────
export const CURRENT_LOCATION = {
  title: 'Dworzec Główny',
  address: 'ul. Piłsudskiego 105, Wrocław',
  lat: 51.0997,
  lon: 17.0364,
  stopId: 'dworzec-glowny',
};

// ─── Saved places (custom names + icons supported) ───────────────────────────
export const SAVED_PLACES: SavedPlace[] = [
  { id: 'home', name: 'Dom', icon: 'home', placeId: 'swojczycka', address: 'Swojczycka 41, Wrocław', lat: 51.1085, lon: 17.1021 },
  { id: 'school', name: 'Szkoła', icon: 'school', placeId: 'pwr', address: 'Politechnika Wrocławska, Wybrzeże Wyspiańskiego', lat: 51.1079, lon: 17.0617 },
  { id: 'work', name: 'Praca', icon: 'work', placeId: 'sky-tower', address: 'Sky Tower, Powstańców Śląskich 95', lat: 51.0938, lon: 17.0196 },
  { id: 'gym', name: 'Siłownia', icon: 'gym', placeId: 'magnolia', address: 'Magnolia Park, Legnicka 58', lat: 51.1181, lon: 16.9946 },
];

// ─── Search corpus: stops + addresses + POIs around Wrocław ──────────────────
export const SUGGESTIONS: Suggestion[] = [
  { id: 'stop-arkady', title: 'Arkady (Capitol)', address: 'Przystanek • ul. Piłsudskiego', kind: 'stop', lat: 51.1008, lon: 17.0312, distanceM: 420 },
  { id: 'stop-rondo', title: 'Rondo', address: 'Przystanek • Rondo Reagana', kind: 'stop', lat: 51.1094, lon: 17.0542, distanceM: 1450 },
  { id: 'stop-rynek', title: 'Rynek', address: 'Przystanek • Świdnicka', kind: 'stop', lat: 51.1072, lon: 17.0312, distanceM: 980 },
  { id: 'stop-dworzec', title: 'Dworzec Główny', address: 'Przystanek • Piłsudskiego 105', kind: 'stop', lat: 51.0997, lon: 17.0364, distanceM: 120 },
  { id: 'stop-biskupin', title: 'Biskupin', address: 'Pętla • ul. Olszewskiego', kind: 'stop', lat: 51.1123, lon: 17.0987, distanceM: 5200 },
  { id: 'stop-krzyki', title: 'Krzyki', address: 'Pętla • ul. Krzycka', kind: 'stop', lat: 51.0764, lon: 17.0198, distanceM: 3400 },
  { id: 'stop-gal dominated', title: 'Galeria Dominikańska', address: 'Przystanek • pl. Dominikański', kind: 'stop', lat: 51.1066, lon: 17.0407, distanceM: 1100 },
  { id: 'poi-zoo', title: 'ZOO Wrocław', address: 'Miejsce • ul. Wróblewskiego 1-5', kind: 'place', lat: 51.1043, lon: 17.0746, distanceM: 3900 },
  { id: 'poi-rynek', title: 'Rynek we Wrocławiu', address: 'Miejsce • Rynek 1', kind: 'place', lat: 51.1079, lon: 17.0385, distanceM: 1050 },
  { id: 'poi-hala', title: 'Hala Stulecia', address: 'Miejsce • Wystawowa 1', kind: 'place', lat: 51.1067, lon: 17.0772, distanceM: 4100 },
  { id: 'addr-swojczycka', title: 'Swojczycka 41', address: 'Adres • Swojczyce', kind: 'address', lat: 51.1085, lon: 17.1021, distanceM: 5600 },
  { id: 'addr-legnicka', title: 'Legnicka 58', address: 'Adres • Magnolia Park', kind: 'address', lat: 51.1181, lon: 16.9946, distanceM: 4300 },
  { id: 'hist-capitol', title: 'Arkady Capitol', address: 'Ostatnio • Piłsudskiego 64', kind: 'history', lat: 51.1008, lon: 17.0312, distanceM: 420 },
  { id: 'hist-pwr', title: 'Politechnika Wrocławska', address: 'Ostatnio • Wybrzeże Wyspiańskiego 27', kind: 'history', lat: 51.1079, lon: 17.0617, distanceM: 2100 },
];

// ─── Smart list: top destinations FROM current GPS, ranked by frequency ──────
export const SMART_DESTINATIONS: SmartDestination[] = [
  { id: 'hist-capitol', title: 'Arkady Capitol', address: 'Piłsudskiego 64 • 4, 10, 14', frequency: 18, avgDurationMin: 9, lat: 51.1008, lon: 17.0312, originId: 'dworzec-glowny' },
  { id: 'hist-pwr', title: 'Politechnika Wrocławska', address: 'Wybrzeże Wyspiańskiego • 13, 23', frequency: 12, avgDurationMin: 16, lat: 51.1079, lon: 17.0617, originId: 'dworzec-glowny' },
  { id: 'poi-zoo', title: 'ZOO / Hala Stulecia', address: 'Wróblewskiego • 1, 4', frequency: 7, avgDurationMin: 21, lat: 51.1043, lon: 17.0746, originId: 'dworzec-glowny' },
  { id: 'poi-rynek', title: 'Rynek', address: 'Świdnicka • 6, 7, 15', frequency: 6, avgDurationMin: 11, lat: 51.1079, lon: 17.0385, originId: 'dworzec-glowny' },
  { id: 'addr-legnicka', title: 'Magnolia Park', address: 'Legnicka 58 • 3, 10, 20', frequency: 4, avgDurationMin: 24, lat: 51.1181, lon: 16.9946, originId: 'dworzec-glowny' },
];

// ─── Connections Dworzec Główny → Arkady Capitol (sorted by departInMin) ─────
export const CONNECTIONS: Connection[] = [
  {
    id: 'c1',
    fromTitle: 'Dworzec Główny',
    toTitle: 'Arkady Capitol',
    departInMin: 2,
    departAt: '14:02',
    arriveAt: '14:11',
    durationMin: 9,
    transfers: 1,
    delayMin: 0,
    live: true,
    interchange: 'Przesiadka: Rondo',
    legs: [
      { id: 'c1l1', mode: 'tram', line: '4', direction: 'BISKUPIN', fromStop: 'Dworzec Główny', toStop: 'Arkady (Capitol)', departAt: '14:02', arriveAt: '14:05', stopsCount: 2, live: true },
      { id: 'c1l2', mode: 'walk', fromStop: 'Arkady (Capitol)', toStop: 'Rondo', departAt: '14:05', arriveAt: '14:07', stopsCount: 0, walkM: 180, live: false },
      { id: 'c1l3', mode: 'tram', line: '2', direction: 'KRZYKI', fromStop: 'Rondo', toStop: 'Arkady Capitol', departAt: '14:08', arriveAt: '14:11', stopsCount: 2, live: true },
    ],
  },
  {
    id: 'c2',
    fromTitle: 'Dworzec Główny',
    toTitle: 'Arkady Capitol',
    departInMin: 6,
    departAt: '14:06',
    arriveAt: '14:17',
    durationMin: 11,
    transfers: 0,
    delayMin: 4,
    live: true,
    legs: [
      { id: 'c2l1', mode: 'tram', line: '10', direction: 'BISKUPIN', fromStop: 'Dworzec Główny', toStop: 'Arkady Capitol', departAt: '14:06', arriveAt: '14:17', stopsCount: 4, live: true },
    ],
  },
  {
    id: 'c3',
    fromTitle: 'Dworzec Główny',
    toTitle: 'Arkady Capitol',
    departInMin: 9,
    departAt: '14:09',
    arriveAt: '14:24',
    durationMin: 15,
    transfers: 1,
    delayMin: -1,
    live: false,
    interchange: 'Przesiadka: Gal. Dominikańska',
    legs: [
      { id: 'c3l1', mode: 'bus', line: 'K', direction: 'KROMERA', fromStop: 'Dworzec Główny', toStop: 'Gal. Dominikańska', departAt: '14:09', arriveAt: '14:15', stopsCount: 3, live: false },
      { id: 'c3l2', mode: 'walk', fromStop: 'Gal. Dominikańska', toStop: 'Dominikański', departAt: '14:15', arriveAt: '14:18', stopsCount: 0, walkM: 240, live: false },
      { id: 'c3l3', mode: 'tram', line: '7', direction: 'KRZYKI', fromStop: 'Dominikański', toStop: 'Arkady Capitol', departAt: '14:19', arriveAt: '14:24', stopsCount: 3, live: false },
    ],
  },
  {
    id: 'c4',
    fromTitle: 'Dworzec Główny',
    toTitle: 'Arkady Capitol',
    departInMin: 14,
    departAt: '14:14',
    arriveAt: '14:26',
    durationMin: 12,
    transfers: 0,
    delayMin: 0,
    live: false,
    legs: [
      { id: 'c4l1', mode: 'tram', line: '14', direction: 'KRZYKI', fromStop: 'Dworzec Główny', toStop: 'Arkady Capitol', departAt: '14:14', arriveAt: '14:26', stopsCount: 5, live: false },
    ],
  },
];
