import type { LegMode, SavedPlace, SmartDestination } from '../types/models';
import type { TripHistoryItem } from '../services/smartRanking';
import type { DataStatus, TimetableUpdate } from '../services/dataManager';
import type { CityId } from '../cities';

export type HomeDevScenario =
  | 'standard'
  | 'empty'
  | 'updateAvailable'
  | 'downloading'
  | 'importing'
  | 'error'
  | 'outsideGps'
  | 'customStart';

export interface HomeFixtureData {
  cityId: CityId;
  locTitle: string;
  isCustomStart: boolean;
  saved: SavedPlace[];
  smart: SmartDestination[];
  smartReady: boolean;
  liveDepartures: Record<string, number>;
  firstLegs: Record<string, { mode?: LegMode; line?: string }>;
  lastTrip: TripHistoryItem | null;
  dataStatus: DataStatus;
  timetableUpdate: TimetableUpdate | null;
  gpsUnsupported: boolean;
  gpsCity: string | null;
  gpsLocation: { lat: number; lon: number; title: string; city?: string | null } | null;
  newsAlert: boolean;
}

export function homeFixture(scenario: HomeDevScenario = 'standard'): HomeFixtureData {
  const baseSaved: SavedPlace[] = [
    {
      id: 'place-home',
      placeId: 'place-home',
      name: 'Dom',
      icon: 'home',
      address: 'ul. Powstańców Śląskich 12, Wrocław',
      lat: 51.096,
      lon: 17.028,
    },
    {
      id: 'place-work',
      placeId: 'place-work',
      name: 'Praca',
      icon: 'work',
      address: 'Centrum Południe, Wrocław',
      lat: 51.092,
      lon: 17.021,
    },
    {
      id: 'place-gym',
      placeId: 'place-gym',
      name: 'Siłownia',
      icon: 'gym',
      address: 'ul. Świdnicka 40, Wrocław',
      lat: 51.104,
      lon: 17.031,
    },
    {
      id: 'place-school',
      placeId: 'place-school',
      name: 'Uczelnia',
      icon: 'school',
      address: 'wyb. Wyspiańskiego 27, Wrocław',
      lat: 51.107,
      lon: 17.059,
    },
    {
      id: 'place-coffee',
      placeId: 'place-coffee',
      name: 'Kawiarnia',
      icon: 'coffee',
      address: 'ul. Szewska 25, Wrocław',
      lat: 51.109,
      lon: 17.035,
    },
  ];

  const baseSmart: SmartDestination[] = [
    {
      id: 'dest-rynek',
      title: 'Rynek',
      address: 'Stare Miasto, Wrocław',
      lat: 51.1097,
      lon: 17.0315,
      frequency: 24,
      avgDurationMin: 12,
      originId: 'origin-dworzec',
    },
    {
      id: 'dest-grunwald',
      title: 'Plac Grunwaldzki',
      address: 'Rondo Reagana, Wrocław',
      lat: 51.1118,
      lon: 17.0601,
      frequency: 18,
      avgDurationMin: 15,
      originId: 'origin-dworzec',
    },
    {
      id: 'dest-nadodrze',
      title: 'Dworzec Nadodrze',
      address: 'pl. Staszica, Wrocław',
      lat: 51.1235,
      lon: 17.0322,
      frequency: 12,
      avgDurationMin: 14,
      originId: 'origin-dworzec',
    },
    {
      id: 'dest-zoo',
      title: 'Zoo Wrocław',
      address: 'ul. Wróblewskiego 1, Wrocław',
      lat: 51.1054,
      lon: 17.0768,
      frequency: 8,
      avgDurationMin: 22,
      originId: 'origin-dworzec',
    },
    {
      id: 'dest-lotnisko',
      title: 'Port Lotniczy Wrocław',
      address: 'ul. Graniczna 190, Wrocław',
      lat: 51.1082,
      lon: 16.8858,
      frequency: 5,
      avgDurationMin: 45,
      originId: 'origin-dworzec',
    },
  ];

  const baseDepartures: Record<string, number> = {
    'dest-rynek': 3,
    'dest-grunwald': 7,
    'dest-nadodrze': 12,
    'dest-zoo': 18,
    'dest-lotnisko': 35,
  };

  const baseLegs: Record<string, { mode?: LegMode; line?: string }> = {
    'dest-rynek': { mode: 'tram', line: '10' },
    'dest-grunwald': { mode: 'bus', line: '145' },
    'dest-nadodrze': { mode: 'tram', line: '7' },
    'dest-zoo': { mode: 'tram', line: '4' },
    'dest-lotnisko': { mode: 'bus', line: '106' },
  };

  const baseLastTrip: TripHistoryItem = {
    id: 'trip-last',
    origin_title: 'Dworzec Główny',
    origin_lat: 51.0988,
    origin_lon: 17.0366,
    dest_id: 'dest-rynek',
    dest_title: 'Rynek',
    dest_address: 'Stare Miasto, Wrocław',
    dest_lat: 51.1097,
    dest_lon: 17.0315,
    duration_min: 12,
    timestamp: Date.now() - 45 * 60 * 1000,
    uses: 14,
  };

  const baseDataStatus: DataStatus = {
    state: 'ready',
    stops: 2450,
    trips: 18400,
    updatedAt: new Date().toISOString().slice(0, 10),
    source: 'network',
  };

  const common: HomeFixtureData = {
    cityId: 'wroclaw',
    locTitle: 'Dworzec Główny',
    isCustomStart: false,
    saved: baseSaved,
    smart: baseSmart,
    smartReady: true,
    liveDepartures: baseDepartures,
    firstLegs: baseLegs,
    lastTrip: baseLastTrip,
    dataStatus: baseDataStatus,
    timetableUpdate: null,
    gpsUnsupported: false,
    gpsCity: null,
    gpsLocation: { lat: 51.0988, lon: 17.0366, title: 'Dworzec Główny' },
    newsAlert: true,
  };

  switch (scenario) {
    case 'empty':
      return {
        ...common,
        saved: [],
        smart: [],
        smartReady: true,
        liveDepartures: {},
        firstLegs: {},
        lastTrip: null,
        newsAlert: false,
      };

    case 'updateAvailable':
      return {
        ...common,
        timetableUpdate: {
          version: '2026-11-08-wroc',
          checkedAt: new Date().toISOString(),
        },
      };

    case 'downloading':
      return {
        ...common,
        dataStatus: { state: 'downloading', progress: 0.65 },
      };

    case 'importing':
      return {
        ...common,
        dataStatus: {
          state: 'importing',
          step: 'stop_times.txt (42000 / 68000)',
          progress: 0.62,
        },
      };

    case 'error':
      return {
        ...common,
        dataStatus: {
          state: 'error',
          message: 'Błąd pobierania danych rozkładu',
          hint: 'Sprawdź połączenie z siecią i spróbuj ponownie.',
        },
      };

    case 'outsideGps':
      return {
        ...common,
        gpsUnsupported: true,
        gpsCity: 'Warszawa',
        gpsLocation: {
          lat: 52.2297,
          lon: 21.0122,
          title: 'Warszawa Centralna',
          city: 'Warszawa',
        },
      };

    case 'customStart':
      return {
        ...common,
        isCustomStart: true,
        locTitle: 'Plac Grunwaldzki (Rondo Reagana)',
      };

    case 'standard':
    default:
      return common;
  }
}
