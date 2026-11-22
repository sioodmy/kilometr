import type { SchemeKey } from '../theme/tokens';
import type { SavedPlaceIcon, Suggestion } from '../types/models';
import { normalizePolish } from '../gtfs/geo';

export type PlaceIconCategory =
  | 'all'
  | 'frequent'
  | 'transit'
  | 'food'
  | 'health'
  | 'culture'
  | 'sport'
  | 'services';

export interface PlaceIconTone {
  bg: SchemeKey;
  fg: SchemeKey;
}

export interface PlaceIconMeta {
  key: SavedPlaceIcon;
  category: Exclude<PlaceIconCategory, 'all'>;
  keywords: string[];
}

export interface IconSuggestionResult {
  icon: SavedPlaceIcon;
  source: 'name' | 'location';
}

export const PLACE_ICON_CATEGORY_KEYS: PlaceIconCategory[] = [
  'all',
  'frequent',
  'transit',
  'food',
  'health',
  'culture',
  'sport',
  'services',
];

/** Katalog ikon dostępnych dla zapisanych miejsc wraz ze słowami kluczowymi (PL/EN/DE/UK). */
export const PLACE_ICON_CATALOG: PlaceIconMeta[] = [
  // Codzienne / Częste
  {
    key: 'home',
    category: 'frequent',
    keywords: ['dom', 'mieszkanie', 'pokoj', 'chata', 'kwadrat', 'home', 'house', 'flat', 'zuhause', 'wohnung', 'дім', 'додому', 'квартира'],
  },
  {
    key: 'work',
    category: 'frequent',
    keywords: ['praca', 'biuro', 'firma', 'robota', 'korpo', 'work', 'office', 'job', 'arbeit', 'buro', 'робота', 'офіс'],
  },
  {
    key: 'school',
    category: 'frequent',
    keywords: ['szkola', 'liceum', 'technikum', 'podstawowka', 'edukacja', 'school', 'highschool', 'schule', 'gymnasium', 'школа', 'ліцей'],
  },
  {
    key: 'university',
    category: 'frequent',
    keywords: [
      'uczelnia',
      'studia',
      'uniwersytet',
      'politechnika',
      'polibuda',
      'akademia',
      'wydzial',
      'kampus',
      'pwr',
      'uwr',
      'agh',
      'uam',
      'sgh',
      'university',
      'college',
      'campus',
      'uni',
      'universitat',
      'hochschule',
      'університет',
      'універ',
      'політехніка',
      'академія',
    ],
  },
  {
    key: 'shopping',
    category: 'frequent',
    keywords: [
      'sklep',
      'zakupy',
      'galeria',
      'mall',
      'butik',
      'pasaz',
      'centrum handlowe',
      'dom handlowy',
      'wroclavia',
      'magnolia',
      'manufaktura',
      'posnania',
      'arkadia',
      'zlote tarasy',
      'shop',
      'shopping',
      'store',
      'laden',
      'einkaufszentrum',
      'магазин',
      'торговий',
    ],
  },
  {
    key: 'heart',
    category: 'frequent',
    keywords: [
      'wazne',
      'serce',
      'rodzina',
      'rodzice',
      'mama',
      'tata',
      'babcia',
      'dziadek',
      'partner',
      'dziewczyna',
      'chlopak',
      'zona',
      'maz',
      'milosc',
      'family',
      'parents',
      'mom',
      'dad',
      'heart',
      'familie',
      'eltern',
      'mama',
      'родина',
      'батьки',
      'мама',
      'тато',
    ],
  },
  {
    key: 'friends',
    category: 'frequent',
    keywords: ['znajomi', 'przyjaciele', 'ekipa', 'kumpel', 'kolega', 'kolezanka', 'friends', 'freunde', 'друзі'],
  },
  {
    key: 'star',
    category: 'frequent',
    keywords: ['ulubione', 'gwiazdka', 'top', 'favorite', 'favourite', 'star', 'favoriten', 'улюблене'],
  },

  // Podróż i transport
  {
    key: 'train',
    category: 'transit',
    keywords: [
      'pociag',
      'dworzec',
      'dworca',
      'dworcu',
      'pkp',
      'kolej',
      'kolejowy',
      'kolejowa',
      'stacja kolejowa',
      'przystanek kolejowy',
      'intercity',
      'polregio',
      'skm',
      'wkd',
      'train',
      'railway',
      'station',
      'bahnhof',
      'zug',
      'вокзал',
      'потяг',
      'поїзд',
      'залізничний',
    ],
  },
  {
    key: 'tram',
    category: 'transit',
    keywords: ['tramwaj', 'tramwajowy', 'tramwajowa', 'szyny', 'petla', 'tram', 'strassenbahn', 'трамвай'],
  },
  {
    key: 'bus',
    category: 'transit',
    keywords: ['autobus', 'autobusowy', 'dworzec autobusowy', 'pks', 'flixbus', 'przystanek', 'bus', 'haltestelle', 'автобус', 'зупинка'],
  },
  {
    key: 'plane',
    category: 'transit',
    keywords: [
      'lotnisko',
      'port lotniczy',
      'samolot',
      'terminal',
      'airport',
      'flight',
      'flughafen',
      'аеропорт',
      'літак',
    ],
  },
  {
    key: 'bike',
    category: 'transit',
    keywords: ['rower', 'rowerowa', 'sciezka', 'bike', 'bicycle', 'fahrrad', 'велосипед'],
  },
  {
    key: 'car',
    category: 'transit',
    keywords: ['samochod', 'auto', 'parking', 'garaz', 'parkuj', 'car', 'garage', 'паркінг', 'авто'],
  },
  {
    key: 'fuel',
    category: 'transit',
    keywords: ['paliwo', 'stacja paliw', 'benzyna', 'diesel', 'orlen', 'shell', 'moya', 'circle', 'lotos', 'mol', 'fuel', 'petrol', 'tankstelle', 'заправка', 'азс'],
  },
  {
    key: 'ship',
    category: 'transit',
    keywords: ['prom', 'statek', 'port', 'przystan', 'marina', 'kajaki', 'ferry', 'ship', 'hafen', 'fahre', 'пором', 'порт'],
  },
  {
    key: 'compass',
    category: 'transit',
    keywords: ['orientacja', 'punkt widokowy', 'kompas', 'atrakcja', 'viewpoint', 'compass', 'kompass', 'компас'],
  },

  // Jedzenie i napoje
  {
    key: 'coffee',
    category: 'food',
    keywords: [
      'kawiarnia',
      'kawa',
      'cafe',
      'coffee',
      'espresso',
      'herbata',
      'cukiernia',
      'ciastko',
      'starbucks',
      'costa',
      'green caffe',
      'kaffee',
      'кавʼярня',
      'кавярня',
      'кава',
    ],
  },
  {
    key: 'restaurant',
    category: 'food',
    keywords: [
      'restauracja',
      'jedzenie',
      'obiad',
      'lunch',
      'kolacja',
      'gastronomia',
      'bar mleczny',
      'sushi',
      'ramen',
      'karczma',
      'restaurant',
      'food',
      'essen',
      'ресторан',
      'їжа',
    ],
  },
  {
    key: 'pizza',
    category: 'food',
    keywords: ['pizza', 'pizzeria', 'wloska', 'піца', 'піцерія'],
  },
  {
    key: 'sandwich',
    category: 'food',
    keywords: ['bistro', 'kanapka', 'piekarnia', 'sniadanie', 'fastfood', 'burger', 'kebab', 'mcdonald', 'kfc', 'bakery', 'backerei', 'пекарня', 'бістро'],
  },
  {
    key: 'beer',
    category: 'food',
    keywords: ['pub', 'piwo', 'browar', 'kraft', 'beer', 'bier', 'пиво', 'паб'],
  },
  {
    key: 'wine',
    category: 'food',
    keywords: ['wino', 'bar', 'drinki', 'cocktail', 'wine', 'wein', 'вино'],
  },
  {
    key: 'market',
    category: 'food',
    keywords: ['rynek', 'targ', 'targowisko', 'hala targowa', 'bazar', 'warzywniak', 'market', 'markt', 'ринок', 'базар'],
  },
  {
    key: 'cart',
    category: 'food',
    keywords: [
      'supermarket',
      'hipermarket',
      'biedronka',
      'lidl',
      'dino',
      'auchan',
      'kaufland',
      'carrefour',
      'netto',
      'aldi',
      'zabka',
      'stokrotka',
      'intermarche',
      'lewiatan',
      'koszyk',
      'supermarkt',
      'супермаркет',
    ],
  },

  // Zdrowie i uroda
  {
    key: 'pharmacy',
    category: 'health',
    keywords: ['apteka', 'leki', 'farmacja', 'recepta', 'doz', 'gemini', 'pharmacy', 'apotheke', 'аптека'],
  },
  {
    key: 'hospital',
    category: 'health',
    keywords: ['szpital', 'sor', 'klinika', 'pogotowie', 'hospital', 'krankenhaus', 'лікарня'],
  },
  {
    key: 'doctor',
    category: 'health',
    keywords: [
      'lekarz',
      'przychodnia',
      'doktor',
      'dentysta',
      'stomatolog',
      'badania',
      'medycyna',
      'medicover',
      'luxmed',
      'enelmed',
      'nfz',
      'doctor',
      'clinic',
      'arzt',
      'arztpraxis',
      'клініка',
      'лікар',
    ],
  },
  {
    key: 'scissors',
    category: 'health',
    keywords: ['fryzjer', 'barber', 'strzyzenie', 'hairdresser', 'friseur', 'перукарня', 'барбер'],
  },
  {
    key: 'sparkles',
    category: 'health',
    keywords: ['uroda', 'spa', 'kosmetyczka', 'paznokcie', 'masaz', 'beauty', 'краса'],
  },

  // Kultura i rozrywka
  {
    key: 'cinema',
    category: 'culture',
    keywords: ['kino', 'film', 'seans', 'cinema', 'multikino', 'helios', 'nowe horyzonty', 'кіно'],
  },
  {
    key: 'theater',
    category: 'culture',
    keywords: ['teatr', 'spektakl', 'opera', 'filharmonia', 'operetka', 'theatre', 'theater', 'театр'],
  },
  {
    key: 'culture',
    category: 'culture',
    keywords: ['muzeum', 'wystawa', 'zabytek', 'zamek', 'palac', 'museum', 'музей'],
  },
  {
    key: 'library',
    category: 'culture',
    keywords: ['biblioteka', 'ksiazki', 'czytelnia', 'library', 'bibliothek', 'бібліотека'],
  },
  {
    key: 'music',
    category: 'culture',
    keywords: ['muzyka', 'koncert', 'festiwal', 'music', 'musik', 'музика', 'концерт'],
  },
  {
    key: 'ticket',
    category: 'culture',
    keywords: ['wydarzenie', 'bilet', 'impreza', 'targi', 'event', 'подія'],
  },
  {
    key: 'gamepad',
    category: 'culture',
    keywords: ['gry', 'arcade', 'kregle', 'bilard', 'planszowki', 'rozrywka', 'gaming', 'entertainment', 'розваги'],
  },

  // Sport i rekreacja
  {
    key: 'gym',
    category: 'sport',
    keywords: [
      'silownia',
      'silka',
      'fitness',
      'trening',
      'crossfit',
      'zdrofit',
      'cityfit',
      'well fitness',
      'sport',
      'gym',
      'fitnessstudio',
      'спортзал',
      'фітнес',
    ],
  },
  {
    key: 'park',
    category: 'sport',
    keywords: ['park', 'las', 'ogrod', 'botaniczny', 'skwer', 'spacer', 'zielen', 'zoo', 'garden', 'парк', 'сад'],
  },
  {
    key: 'mountain',
    category: 'sport',
    keywords: ['gory', 'szlak', 'wspinaczka', 'scianka', 'wycieczka', 'mountains', 'berge', 'гори'],
  },
  {
    key: 'tent',
    category: 'sport',
    keywords: ['kemping', 'namiot', 'biwak', 'camping', 'кемпінг'],
  },
  {
    key: 'trophy',
    category: 'sport',
    keywords: ['stadion', 'arena', 'boisko', 'hala sportowa', 'mecz', 'stadium', 'stadion', 'стадіон'],
  },
  {
    key: 'swimming',
    category: 'sport',
    keywords: ['basen', 'aquapark', 'plywalnia', 'plaza', 'termy', 'pool', 'swimming', 'beach', 'schwimmbad', 'басейн', 'пляж'],
  },

  // Społeczność i usługi
  {
    key: 'church',
    category: 'services',
    keywords: ['kosciol', 'parafia', 'msza', 'kaplica', 'katedra', 'bazylika', 'church', 'kirche', 'церква'],
  },
  {
    key: 'baby',
    category: 'services',
    keywords: ['przedszkole', 'zlobek', 'dzieci', 'dziecko', 'kindergarten', 'kita', 'садок'],
  },
  {
    key: 'pet',
    category: 'services',
    keywords: ['zwierzak', 'pies', 'kot', 'pupil', 'weterynarz', 'vet', 'pet', 'haustier', 'ветеринар', 'улюбленець'],
  },
  {
    key: 'hotel',
    category: 'services',
    keywords: ['hotel', 'hostel', 'nocleg', 'apartament', 'motel', 'готель', 'хостел'],
  },
  {
    key: 'bank',
    category: 'services',
    keywords: ['bank', 'bankomat', 'wplatomat', 'finanse', 'atm', 'geldautomat', 'банк', 'банкомат'],
  },
  {
    key: 'post',
    category: 'services',
    keywords: ['poczta', 'inpost', 'paczkomat', 'kurier', 'paczka', 'dhl', 'dpd', 'orlen paczka', 'post', 'parcel', 'paket', 'пошта', 'посилка'],
  },
  {
    key: 'laptop',
    category: 'services',
    keywords: ['coworking', 'praca zdalna', 'biurko', 'desk', 'коворкінг'],
  },
  {
    key: 'mapPin',
    category: 'services',
    keywords: ['inne', 'punkt', 'adres', 'miejsce', 'cel', 'other', 'sonstige', 'інше'],
  },
];

const PRIMARY_TONE_ICONS = new Set<SavedPlaceIcon>([
  'home',
  'heart',
  'star',
  'friends',
  'baby',
  'pet',
]);

const TERTIARY_TONE_ICONS = new Set<SavedPlaceIcon>([
  'work',
  'school',
  'university',
  'laptop',
  'library',
  'train',
  'tram',
  'bus',
  'plane',
  'bike',
  'car',
  'fuel',
  'ship',
  'compass',
]);

/** Role tonalne ikon zapisanych miejsc: dynamiczne pod tapetę Material You M3. */
export function placeIconTone(icon: SavedPlaceIcon): PlaceIconTone {
  if (PRIMARY_TONE_ICONS.has(icon)) {
    return { bg: 'primaryContainer', fg: 'onPrimaryContainer' };
  }
  if (TERTIARY_TONE_ICONS.has(icon)) {
    return { bg: 'tertiaryContainer', fg: 'onTertiaryContainer' };
  }
  return { bg: 'secondaryContainer', fg: 'onSecondaryContainer' };
}

/** Normalizacja tekstu pod dopasowania (łacińskie znaki diakrytyczne + małe litery, zachowuje cyrylicę). */
function normalizeText(raw: string): string {
  return normalizePolish(raw).replace(/[ʼ'’`]/g, '').replace(/\s+/g, ' ').trim();
}

function tokenize(raw: string): string[] {
  const norm = normalizeText(raw);
  if (!norm) return [];
  return norm.split(/[^a-z0-9\u0400-\u04ff]+/i).filter(Boolean);
}

const FLEX_VOWEL_END = /[aeoyiаяоеиі]$/i;

/** Sprawdza czy token jest prefiksem lub odmianą samogłoskową słowa kluczowego (po odrzuceniu dokładnych trafień). */
function tokenMatchesPrefix(tok: string, normKw: string): boolean {
  // Krótkie słowa (<= 3 znaki, np. "bar", "pub", "dom", "pwr") tylko jako pełne wyrazy.
  if (normKw.length >= 4 && tok.startsWith(normKw) && tok.length <= normKw.length + 3) {
    return true;
  }
  // Odmiana samogłoskowa (np. "politechnika" -> "politechniki", "szkola" -> "szkoly").
  // Nie obcinamy spółgłosek, aby np. "przystan" nie pasowało do "przystanek".
  if (normKw.length >= 5 && FLEX_VOWEL_END.test(normKw)) {
    const stem = normKw.slice(0, -1);
    if (tok.startsWith(stem) && tok.length <= normKw.length + 3) {
      return true;
    }
  }
  return false;
}

/** Priorytetowe reguły kolejności dopasowania dla niejednoznacznych tekstów. */
const SUGGESTION_ORDER: SavedPlaceIcon[] = [
  'home',
  'work',
  'university',
  'school',
  'baby',
  'library',
  'plane',
  'train',
  'tram',
  'ship',
  'fuel',
  'pharmacy',
  'hospital',
  'doctor',
  'pet',
  'scissors',
  'sparkles',
  'gym',
  'swimming',
  'trophy',
  'park',
  'mountain',
  'tent',
  'cinema',
  'theater',
  'culture',
  'music',
  'gamepad',
  'ticket',
  'coffee',
  'pizza',
  'beer',
  'wine',
  'sandwich',
  'restaurant',
  'cart',
  'market',
  'shopping',
  'hotel',
  'church',
  'post',
  'bank',
  'laptop',
  'heart',
  'friends',
  'bike',
  'car',
  'bus',
];

const CATALOG_BY_KEY = new Map<SavedPlaceIcon, PlaceIconMeta>(
  PLACE_ICON_CATALOG.map((item) => [item.key, item]),
);

const CATEGORY_DEFAULT_ICON: Record<string, SavedPlaceIcon> = {
  train: 'train',
  school: 'school',
  medical: 'doctor',
  shop: 'shopping',
  restaurant: 'restaurant',
  entertainment: 'cinema',
  fuel: 'fuel',
  tourism: 'culture',
  sport: 'gym',
  bank: 'bank',
  church: 'church',
};

function matchTextToIcon(text: string): SavedPlaceIcon | null {
  const norm = normalizeText(text);
  if (!norm) return null;
  const tokens = tokenize(norm);
  if (tokens.length === 0) return null;
  const padded = ` ${tokens.join(' ')} `;

  // 1. Najpierw wielowyrazowe frazy kluczowe (np. "port lotniczy", "stacja paliw", "dworzec autobusowy").
  for (const key of SUGGESTION_ORDER) {
    const meta = CATALOG_BY_KEY.get(key);
    if (!meta) continue;
    for (const kw of meta.keywords) {
      const normKw = normalizeText(kw);
      if (!normKw.includes(' ')) continue;
      if (padded.includes(` ${normKw} `) || norm.includes(normKw)) return key;
    }
  }

  // 2. Dokładne dopasowanie całego tokenu (chroni np. "przystanek" przed prefiksem "przystan", "parking" przed "park").
  for (const tok of tokens) {
    for (const key of SUGGESTION_ORDER) {
      const meta = CATALOG_BY_KEY.get(key);
      if (!meta) continue;
      for (const kw of meta.keywords) {
        const normKw = normalizeText(kw);
        if (!normKw || normKw.includes(' ')) continue;
        if (tok === normKw) return key;
      }
    }
  }

  // 3. Dopasowanie prefiksowe / odmiana w kolejności występowania (pierwsze słowo niesie główny sens).
  for (const tok of tokens) {
    for (const key of SUGGESTION_ORDER) {
      const meta = CATALOG_BY_KEY.get(key);
      if (!meta) continue;
      for (const kw of meta.keywords) {
        const normKw = normalizeText(kw);
        if (!normKw || normKw.includes(' ')) continue;
        if (tokenMatchesPrefix(tok, normKw)) return key;
      }
    }
  }
  return null;
}

/**
 * Automatycznie proponuje ikonę na podstawie wpisywanej nazwy i/lub wybranej lokalizacji.
 * Dla zwykłych adresów bez słów kluczowych zwraca `null`, aby nie zgadywać w ciemno.
 */
export function suggestPlaceIcon(input: {
  name?: string;
  location?: Pick<Suggestion, 'title' | 'address' | 'kind' | 'category'> | null;
}): IconSuggestionResult | null {
  const trimmedName = input.name?.trim();
  if (trimmedName) {
    const fromName = matchTextToIcon(trimmedName);
    if (fromName) return { icon: fromName, source: 'name' };
  }

  const loc = input.location;
  if (!loc) return null;

  // 1. Konkretne dopasowanie po nazwie obiektu/przystanku (np. "Politechnika", "Apteka", "Dworzec Główny").
  const fromTitle = matchTextToIcon(loc.title);
  if (fromTitle) return { icon: fromTitle, source: 'location' };

  // 2. Dopasowanie po etykiecie typu w adresie POI (np. "Supermarket • Krzyki", "Basen • ...").
  if (loc.kind !== 'address' && loc.address) {
    const firstSegment = loc.address.split('•')[0] ?? '';
    const fromAddrLabel = matchTextToIcon(firstSegment);
    if (fromAddrLabel) return { icon: fromAddrLabel, source: 'location' };
  }

  // 3. Kategoria z indeksu POI / Nominatim.
  if (loc.category && CATEGORY_DEFAULT_ICON[loc.category]) {
    return { icon: CATEGORY_DEFAULT_ICON[loc.category], source: 'location' };
  }

  // 4. Przystanek GTFS bez bardziej szczegółowego słowa kluczowego.
  if (loc.kind === 'stop') {
    return { icon: 'bus', source: 'location' };
  }

  return null;
}

const BASE_QUICK_ICONS: SavedPlaceIcon[] = [
  'home',
  'work',
  'university',
  'school',
  'gym',
  'coffee',
  'shopping',
  'train',
  'heart',
  'mapPin',
];

/** Buduje zwarty pasek szybkiego wyboru ikon (zawsze z aktywną i sugerowaną na przedzie). */
export function buildQuickIcons(
  selectedIcon: SavedPlaceIcon,
  suggestedIcon?: SavedPlaceIcon | null,
): SavedPlaceIcon[] {
  const out: SavedPlaceIcon[] = [];
  const pushUnique = (key?: SavedPlaceIcon | null) => {
    if (!key || key === 'plus' || out.includes(key)) return;
    if (!CATALOG_BY_KEY.has(key)) return;
    out.push(key);
  };

  pushUnique(suggestedIcon);
  pushUnique(selectedIcon);
  for (const key of BASE_QUICK_ICONS) {
    pushUnique(key);
  }
  return out.slice(0, 10);
}

/** Filtruje katalog ikon z obsługą polskich znaków diakrytycznych i wielojęzycznych słów kluczowych. */
export function filterPlaceIcons(
  query: string,
  category: PlaceIconCategory,
  labels: Partial<Record<SavedPlaceIcon, string>>,
): PlaceIconMeta[] {
  const q = normalizeText(query);
  return PLACE_ICON_CATALOG.filter((item) => {
    if (category !== 'all' && item.category !== category) {
      return false;
    }
    if (!q) return true;
    const label = normalizeText(labels[item.key] ?? '');
    if (label.includes(q)) return true;
    if (item.key.toLowerCase().includes(q)) return true;
    return item.keywords.some((kw) => normalizeText(kw).includes(q));
  });
}
