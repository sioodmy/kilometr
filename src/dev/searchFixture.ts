import type { Suggestion } from '../types/models';
import type { TransitLine } from '../services/lineTimetable';

export type SearchDevScenario =
  | 'initial'
  | 'results'
  | 'lines'
  | 'loading'
  | 'noResults'
  | 'error'
  | 'startMode'
  | 'gpsNotice';

export interface SearchFixtureData {
  query: string;
  loading: boolean;
  error: boolean;
  results: Suggestion[];
  recent: Suggestion[];
  savedQuick: Suggestion[];
  placeholder?: string;
  originTitle?: string;
  notice?: string;
  lineMatches: TransitLine[];
}

const DEV_GPS_SUGGESTION: Suggestion = {
  id: '__gps',
  title: 'Bieżąca lokalizacja',
  address: 'Dworzec Główny, Wrocław',
  kind: 'history',
  lat: 51.0988,
  lon: 17.0366,
};

const DEV_SAVED_QUICK: Suggestion[] = [
  {
    id: 'place-home',
    title: 'Dom',
    address: 'ul. Powstańców Śląskich 12',
    kind: 'history',
    lat: 51.096,
    lon: 17.028,
  },
  {
    id: 'place-work',
    title: 'Praca',
    address: 'Centrum Południe',
    kind: 'history',
    lat: 51.092,
    lon: 17.021,
  },
  {
    id: 'place-school',
    title: 'Uczelnia',
    address: 'wyb. Wyspiańskiego 27',
    kind: 'history',
    lat: 51.107,
    lon: 17.059,
  },
];

const DEV_RECENT_SUGGESTIONS: Suggestion[] = [
  DEV_GPS_SUGGESTION,
  {
    id: 'sug-rynek',
    title: 'Rynek',
    address: 'Stare Miasto, Wrocław',
    kind: 'place',
    category: 'tourism',
    lat: 51.1097,
    lon: 17.0315,
    distanceM: 950,
  },
  {
    id: 'sug-grunwald',
    title: 'Plac Grunwaldzki',
    address: 'Przystanek tramwajowy • Słup 20820',
    kind: 'stop',
    lat: 51.1118,
    lon: 17.0601,
    distanceM: 1850,
  },
  {
    id: 'sug-swidnicka',
    title: 'ul. Świdnicka 12',
    address: 'Wrocław',
    kind: 'address',
    lat: 51.1042,
    lon: 17.0312,
    distanceM: 620,
  },
  {
    id: 'sug-galeria',
    title: 'Galeria Dominikańska',
    address: 'pl. Dominikański 3, Wrocław',
    kind: 'place',
    category: 'shop',
    lat: 51.1083,
    lon: 17.0392,
    distanceM: 780,
  },
  {
    id: 'sug-nadodrze',
    title: 'Dworzec Nadodrze',
    address: 'Przystanek kolejowo-tramwajowy • Słup 10502',
    kind: 'stop',
    category: 'train',
    lat: 51.1235,
    lon: 17.0322,
    distanceM: 2600,
  },
  {
    id: 'sug-restaurant',
    title: 'Piknik Na Odpoczynku',
    address: 'ul. Wita Stwosza 15, Wrocław',
    kind: 'place',
    category: 'restaurant',
    lat: 51.1102,
    lon: 17.0345,
    distanceM: 1100,
  },
];

const DEV_SAMPLE_LINES: TransitLine[] = [
  { routeId: '4', shortName: '4', longName: 'Biskupin — Oporów', mode: 'tram' },
  { routeId: '10', shortName: '10', longName: 'Biskupin — Leśnica', mode: 'tram' },
  { routeId: '14', shortName: '14', longName: 'Osobowice — FAT', mode: 'tram' },
  { routeId: '144', shortName: '144', longName: 'Polanowice — Wojszycka', mode: 'bus' },
  { routeId: '145', shortName: '145', longName: 'Sępolno — Iwiny Rondo', mode: 'bus' },
  { routeId: '241', shortName: '241', longName: 'Nowy Dwór — Pawłowice', mode: 'bus' },
  { routeId: 'D1', shortName: 'D1', longName: 'Koleje Dolnośląskie: Wrocław — Legnica', mode: 'train' },
];

const DEV_ALL_SUGGESTIONS_POOL: Suggestion[] = [
  ...DEV_RECENT_SUGGESTIONS,
  {
    id: 'sug-rynek-stop',
    title: 'Rynek',
    address: 'Przystanek tramwajowy • Słup 10101',
    kind: 'stop',
    lat: 51.1095,
    lon: 17.0318,
    distanceM: 920,
  },
  {
    id: 'sug-rynek-addr',
    title: 'Rynek 1',
    address: 'Wrocław',
    kind: 'address',
    lat: 51.1099,
    lon: 17.0322,
    distanceM: 980,
  },
  {
    id: 'sug-nowy-targ',
    title: 'Nowy Targ',
    address: 'Przystanek tramwajowy • Słup 10103',
    kind: 'stop',
    lat: 51.1108,
    lon: 17.0371,
    distanceM: 1100,
  },
  {
    id: 'sug-sukiennice',
    title: 'Sukiennice',
    address: 'Rynek, Wrocław',
    kind: 'place',
    category: 'place',
    lat: 51.1096,
    lon: 17.032,
    distanceM: 960,
  },
  {
    id: 'sug-czwartakow',
    title: 'Czwartaków',
    address: 'Przystanek autobusowy • Słup 23101',
    kind: 'stop',
    lat: 51.134,
    lon: 17.085,
    distanceM: 4500,
  },
  {
    id: 'sug-politechnika',
    title: 'Politechnika Wrocławska',
    address: 'wyb. Wyspiańskiego 27, Wrocław',
    kind: 'place',
    category: 'school',
    lat: 51.107,
    lon: 17.059,
    distanceM: 1700,
  },
  {
    id: 'sug-zoo',
    title: 'Zoo Wrocław & Afrykarium',
    address: 'ul. Wróblewskiego 1, Wrocław',
    kind: 'place',
    category: 'tourism',
    lat: 51.1054,
    lon: 17.0768,
    distanceM: 3200,
  },
  {
    id: 'sug-lotnisko',
    title: 'Port Lotniczy Wrocław',
    address: 'ul. Graniczna 190, Wrocław',
    kind: 'place',
    category: 'tourism',
    lat: 51.1082,
    lon: 16.8858,
    distanceM: 9400,
  },
];

export function filterMockSearch(query: string): {
  results: Suggestion[];
  lineMatches: TransitLine[];
  error?: boolean;
} {
  const q = query.trim().toLowerCase();
  if (q === 'error') {
    return { results: [], lineMatches: [], error: true };
  }
  if (!q) {
    return { results: [], lineMatches: [] };
  }

  // Dopasowanie linii
  const lineMatches = DEV_SAMPLE_LINES.filter(
    (line) =>
      line.shortName.toLowerCase().startsWith(q) ||
      line.longName.toLowerCase().includes(q),
  );

  // Dopasowanie sugestii
  const results = DEV_ALL_SUGGESTIONS_POOL.filter(
    (item) =>
      item.id !== '__gps' &&
      (item.title.toLowerCase().includes(q) ||
        item.address.toLowerCase().includes(q)),
  );

  return { results, lineMatches };
}

export function searchFixture(scenario: SearchDevScenario = 'initial'): SearchFixtureData {
  const common = {
    loading: false,
    error: false,
    recent: DEV_RECENT_SUGGESTIONS,
    savedQuick: DEV_SAVED_QUICK,
    originTitle: 'Dworzec Główny',
    lineMatches: [],
  };

  switch (scenario) {
    case 'results': {
      const filtered = filterMockSearch('Rynek');
      return {
        ...common,
        query: 'Rynek',
        results: filtered.results,
        lineMatches: filtered.lineMatches,
      };
    }

    case 'lines': {
      const filtered = filterMockSearch('4');
      return {
        ...common,
        query: '4',
        results: filtered.results,
        lineMatches: filtered.lineMatches,
      };
    }

    case 'loading':
      return {
        ...common,
        query: 'Krakowska',
        loading: true,
        results: [],
        lineMatches: [],
      };

    case 'noResults':
      return {
        ...common,
        query: 'Zzzzz999',
        results: [],
        lineMatches: [],
      };

    case 'error':
      return {
        ...common,
        query: 'Politechnika',
        error: true,
        results: [],
        lineMatches: [],
      };

    case 'startMode':
      return {
        ...common,
        query: '',
        results: [],
        originTitle: undefined,
        placeholder: 'Wybierz punkt startowy…',
      };

    case 'gpsNotice':
      return {
        ...common,
        query: '',
        results: [],
        originTitle: undefined,
        placeholder: 'Wybierz punkt startowy…',
        notice: 'GPS poza obsługiwanym miastem, wybierz punkt manualnie.',
      };

    case 'initial':
    default:
      return {
        ...common,
        query: '',
        results: [],
        lineMatches: [],
      };
  }
}
