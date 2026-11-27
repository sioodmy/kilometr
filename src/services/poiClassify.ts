// Czyste helpery klasyfikacji POI i siatki przestrzennej (bez natywnych importów, testowalne w node).

export type PoiCategory =
  | 'restaurant'
  | 'cafe'
  | 'bar'
  | 'hotel'
  | 'shop'
  | 'medical'
  | 'education'
  | 'culture'
  | 'nature'
  | 'sport'
  | 'business'
  | 'finance'
  | 'civic'
  | 'fuel'
  | 'worship'
  | 'train'
  | 'place';

export interface RichPoiClassification {
  category: PoiCategory;
  subtype: string;
  baseRank: number;
  tags: string[];
}

const CATEGORY_LABEL: Record<string, { category: string; label: string }> = {
  'shop:supermarket': { category: 'shop', label: 'Supermarket' },
  'shop:mall': { category: 'shop', label: 'Galeria handlowa' },
  'shop:department_store': { category: 'shop', label: 'Dom handlowy' },
  'amenity:pharmacy': { category: 'medical', label: 'Apteka' },
  'amenity:hospital': { category: 'medical', label: 'Szpital' },
  'amenity:clinic': { category: 'medical', label: 'Przychodnia' },
  'amenity:university': { category: 'school', label: 'Uczelnia' },
  'amenity:college': { category: 'school', label: 'Uczelnia' },
  'amenity:school': { category: 'school', label: 'Szkoła' },
  'amenity:cinema': { category: 'entertainment', label: 'Kino' },
  'amenity:theatre': { category: 'entertainment', label: 'Teatr' },
  'amenity:library': { category: 'school', label: 'Biblioteka' },
  'amenity:fuel': { category: 'fuel', label: 'Stacja paliw' },
  'tourism:hotel': { category: 'tourism', label: 'Hotel' },
  'tourism:museum': { category: 'tourism', label: 'Muzeum' },
  'tourism:attraction': { category: 'tourism', label: 'Atrakcja' },
  'tourism:zoo': { category: 'tourism', label: 'ZOO' },
  'tourism:viewpoint': { category: 'tourism', label: 'Punkt widokowy' },
  'leisure:park': { category: 'sport', label: 'Park' },
  'leisure:garden': { category: 'sport', label: 'Ogród' },
  'leisure:stadium': { category: 'sport', label: 'Stadion' },
  'leisure:swimming_pool': { category: 'sport', label: 'Basen' },
  'leisure:sports_centre': { category: 'sport', label: 'Obiekt sportowy' },
  'leisure:fitness_centre': { category: 'sport', label: 'Siłownia' },
  'railway:station': { category: 'train', label: 'Stacja kolejowa' },
  'railway:halt': { category: 'train', label: 'Przystanek kolejowy' },
  'landuse:commercial': { category: 'place', label: 'Centrum komercyjne' },
};

export function classifyPoi(tags: Record<string, string>): { category: string; label: string } | null {
  const keys = ['shop', 'amenity', 'tourism', 'leisure', 'railway', 'landuse'];
  for (const k of keys) {
    const v = tags[k];
    if (!v) continue;
    const hit = CATEGORY_LABEL[`${k}:${v}`];
    if (hit) return hit;
    if (k === 'shop') return { category: 'shop', label: 'Sklep' };
    if (k === 'amenity' && ['restaurant', 'cafe', 'fast_food', 'bar', 'pub'].includes(v)) {
      return { category: 'restaurant', label: 'Gastronomia' };
    }
  }
  return null;
}

/** Linia adresu: "Label • Osiedle, Ulica Nr". */
export function buildPoiAddress(
  label: string,
  tags: Record<string, string>,
): { address: string; street: string | null; district: string | null } {
  const district =
    tags['addr:suburb'] ||
    tags['addr:district'] ||
    tags['addr:neighbourhood'] ||
    tags['addr:quarter'] ||
    tags['addr:city_district'] ||
    null;
  const street = tags['addr:street'] || null;
  const house = tags['addr:housenumber'] || null;
  const streetPart = street ? `${street}${house ? ` ${house}` : ''}` : null;
  const place = [district, streetPart].filter(Boolean).join(', ');
  return {
    address: place ? `${label} • ${place}` : label,
    street: streetPart,
    district,
  };
}

const OSM_EXACT_CLASSIFICATION: Record<string, RichPoiClassification> = {
  'amenity:restaurant': { category: 'restaurant', subtype: 'Restauracja', baseRank: 230, tags: ['restauracja', 'jedzenie', 'obiad', 'kolacja'] },
  'amenity:fast_food': { category: 'restaurant', subtype: 'Fast food', baseRank: 195, tags: ['fast food', 'jedzenie', 'burger', 'kebab', 'pizza'] },
  'amenity:food_court': { category: 'restaurant', subtype: 'Strefa gastro', baseRank: 220, tags: ['gastronomia', 'jedzenie', 'food court'] },
  'amenity:biergarten': { category: 'bar', subtype: 'Ogródek piwny', baseRank: 205, tags: ['ogrodek piwny', 'piwo', 'bar'] },
  'amenity:cafe': { category: 'cafe', subtype: 'Kawiarnia', baseRank: 225, tags: ['kawiarnia', 'kawa', 'cafe', 'ciasto'] },
  'amenity:ice_cream': { category: 'cafe', subtype: 'Lodziarnia', baseRank: 200, tags: ['lody', 'lodziarnia', 'deser'] },
  'shop:bakery': { category: 'cafe', subtype: 'Piekarnia', baseRank: 195, tags: ['piekarnia', 'chleb', 'bulki'] },
  'shop:pastry': { category: 'cafe', subtype: 'Cukiernia', baseRank: 205, tags: ['cukiernia', 'ciasto', 'tort'] },
  'shop:coffee': { category: 'cafe', subtype: 'Palarnia kawy', baseRank: 195, tags: ['kawa', 'kawiarnia'] },
  'amenity:bar': { category: 'bar', subtype: 'Bar', baseRank: 225, tags: ['bar', 'drinki', 'koktajle'] },
  'amenity:pub': { category: 'bar', subtype: 'Pub', baseRank: 230, tags: ['pub', 'piwo', 'bar'] },
  'amenity:nightclub': { category: 'bar', subtype: 'Klub nocny', baseRank: 235, tags: ['klub', 'impreza', 'dyskoteka'] },
  'tourism:hotel': { category: 'hotel', subtype: 'Hotel', baseRank: 270, tags: ['hotel', 'nocleg'] },
  'tourism:hostel': { category: 'hotel', subtype: 'Hostel', baseRank: 235, tags: ['hostel', 'nocleg'] },
  'tourism:guest_house': { category: 'hotel', subtype: 'Pensjonat', baseRank: 215, tags: ['pensjonat', 'nocleg'] },
  'tourism:motel': { category: 'hotel', subtype: 'Motel', baseRank: 210, tags: ['motel', 'nocleg'] },
  'tourism:apartment': { category: 'hotel', subtype: 'Apartamenty', baseRank: 195, tags: ['apartamenty', 'nocleg'] },
  'shop:mall': { category: 'shop', subtype: 'Galeria handlowa', baseRank: 340, tags: ['galeria', 'centrum handlowe', 'zakupy', 'sklepy'] },
  'shop:department_store': { category: 'shop', subtype: 'Dom handlowy', baseRank: 295, tags: ['dom handlowy', 'zakupy', 'sklep'] },
  'shop:supermarket': { category: 'shop', subtype: 'Supermarket', baseRank: 245, tags: ['supermarket', 'market', 'zakupy', 'spozywczy'] },
  'shop:convenience': { category: 'shop', subtype: 'Sklep spożywczy', baseRank: 165, tags: ['sklep', 'spozywczy', 'zakupy'] },
  'shop:chemist': { category: 'shop', subtype: 'Drogeria', baseRank: 205, tags: ['drogeria', 'kosmetyki'] },
  'shop:electronics': { category: 'shop', subtype: 'Elektronika', baseRank: 210, tags: ['elektronika', 'rtv', 'agd'] },
  'shop:books': { category: 'shop', subtype: 'Księgarnia', baseRank: 210, tags: ['ksiegarnia', 'ksiazki'] },
  'shop:clothes': { category: 'shop', subtype: 'Odzież', baseRank: 180, tags: ['odziez', 'ubrania', 'sklep'] },
  'shop:shoes': { category: 'shop', subtype: 'Obuwie', baseRank: 175, tags: ['buty', 'obuwie', 'sklep'] },
  'shop:diy': { category: 'shop', subtype: 'Sklep budowlany', baseRank: 235, tags: ['budowlany', 'remont', 'market'] },
  'shop:hardware': { category: 'shop', subtype: 'Narzędzia', baseRank: 185, tags: ['narzedzia', 'sklep'] },
  'shop:furniture': { category: 'shop', subtype: 'Meble', baseRank: 215, tags: ['meble', 'wnetrza'] },
  'shop:sports': { category: 'shop', subtype: 'Sklep sportowy', baseRank: 195, tags: ['sport', 'sklep sportowy'] },
  'shop:florist': { category: 'shop', subtype: 'Kwiaciarnia', baseRank: 165, tags: ['kwiaty', 'kwiaciarnia'] },
  'shop:hairdresser': { category: 'business', subtype: 'Fryzjer', baseRank: 180, tags: ['fryzjer', 'salon', 'uslugi'] },
  'shop:beauty': { category: 'business', subtype: 'Salon urody', baseRank: 180, tags: ['kosmetyczka', 'salon', 'uslugi'] },
  'shop:optician': { category: 'medical', subtype: 'Optyk', baseRank: 185, tags: ['optyk', 'okulary'] },
  'amenity:marketplace': { category: 'shop', subtype: 'Targowisko', baseRank: 255, tags: ['targ', 'rynek', 'bazar', 'hala targowa'] },
  'amenity:pharmacy': { category: 'medical', subtype: 'Apteka', baseRank: 215, tags: ['apteka', 'leki'] },
  'amenity:hospital': { category: 'medical', subtype: 'Szpital', baseRank: 330, tags: ['szpital', 'sor', 'zdrowie'] },
  'amenity:clinic': { category: 'medical', subtype: 'Przychodnia', baseRank: 245, tags: ['przychodnia', 'lekarz', 'zdrowie'] },
  'amenity:doctors': { category: 'medical', subtype: 'Gabinet lekarski', baseRank: 195, tags: ['lekarz', 'gabinet', 'zdrowie'] },
  'amenity:dentist': { category: 'medical', subtype: 'Dentysta', baseRank: 190, tags: ['dentysta', 'stomatolog'] },
  'amenity:veterinary': { category: 'medical', subtype: 'Weterynarz', baseRank: 195, tags: ['weterynarz', 'zwierzeta'] },
  'amenity:university': { category: 'education', subtype: 'Uczelnia', baseRank: 330, tags: ['uczelnia', 'uniwersytet', 'politechnika', 'studia'] },
  'amenity:college': { category: 'education', subtype: 'Szkoła wyższa', baseRank: 270, tags: ['uczelnia', 'studia'] },
  'amenity:school': { category: 'education', subtype: 'Szkoła', baseRank: 225, tags: ['szkola', 'liceum', 'technikum'] },
  'amenity:kindergarten': { category: 'education', subtype: 'Przedszkole', baseRank: 175, tags: ['przedszkole', 'zlobek'] },
  'amenity:library': { category: 'education', subtype: 'Biblioteka', baseRank: 235, tags: ['biblioteka', 'ksiazki'] },
  'amenity:cinema': { category: 'culture', subtype: 'Kino', baseRank: 295, tags: ['kino', 'film'] },
  'amenity:theatre': { category: 'culture', subtype: 'Teatr', baseRank: 300, tags: ['teatr', 'kultura', 'spektakl'] },
  'amenity:arts_centre': { category: 'culture', subtype: 'Centrum kultury', baseRank: 260, tags: ['kultura', 'sztuka', 'galeria'] },
  'amenity:community_centre': { category: 'culture', subtype: 'Dom kultury', baseRank: 235, tags: ['dom kultury', 'kultura'] },
  'amenity:concert_hall': { category: 'culture', subtype: 'Sala koncertowa', baseRank: 300, tags: ['koncert', 'filharmonia', 'muzyka'] },
  'tourism:museum': { category: 'culture', subtype: 'Muzeum', baseRank: 310, tags: ['muzeum', 'kultura', 'zwiedzanie'] },
  'tourism:gallery': { category: 'culture', subtype: 'Galeria sztuki', baseRank: 255, tags: ['galeria sztuki', 'sztuka', 'wystawa'] },
  'tourism:attraction': { category: 'culture', subtype: 'Atrakcja', baseRank: 285, tags: ['atrakcja', 'zabytek', 'turystyka'] },
  'tourism:viewpoint': { category: 'culture', subtype: 'Punkt widokowy', baseRank: 245, tags: ['punkt widokowy', 'panorama'] },
  'tourism:zoo': { category: 'nature', subtype: 'Ogród zoologiczny', baseRank: 345, tags: ['zoo', 'zwierzeta'] },
  'tourism:theme_park': { category: 'culture', subtype: 'Park rozrywki', baseRank: 290, tags: ['rozrywka', 'park'] },
  'historic:castle': { category: 'culture', subtype: 'Zamek', baseRank: 315, tags: ['zamek', 'zabytek'] },
  'historic:palace': { category: 'culture', subtype: 'Pałac', baseRank: 295, tags: ['palac', 'zabytek'] },
  'historic:monument': { category: 'culture', subtype: 'Pomnik', baseRank: 245, tags: ['pomnik', 'zabytek'] },
  'leisure:park': { category: 'nature', subtype: 'Park', baseRank: 270, tags: ['park', 'zielone', 'spacer'] },
  'leisure:garden': { category: 'nature', subtype: 'Ogród', baseRank: 250, tags: ['ogrod', 'botaniczny', 'park'] },
  'leisure:nature_reserve': { category: 'nature', subtype: 'Rezerwat', baseRank: 265, tags: ['rezerwat', 'przyroda'] },
  'leisure:stadium': { category: 'sport', subtype: 'Stadion', baseRank: 325, tags: ['stadion', 'arena', 'sport'] },
  'leisure:sports_centre': { category: 'sport', subtype: 'Obiekt sportowy', baseRank: 265, tags: ['sport', 'hala', 'centrum sportu'] },
  'leisure:swimming_pool': { category: 'sport', subtype: 'Basen', baseRank: 255, tags: ['basen', 'plywalnia', 'aquapark'] },
  'leisure:water_park': { category: 'sport', subtype: 'Aquapark', baseRank: 310, tags: ['aquapark', 'basen'] },
  'leisure:fitness_centre': { category: 'sport', subtype: 'Siłownia', baseRank: 225, tags: ['silownia', 'fitness', 'klub'] },
  'leisure:bowling_alley': { category: 'sport', subtype: 'Kręgielnia', baseRank: 215, tags: ['kregle', 'kregielnia', 'rozrywka'] },
  'leisure:escape_game': { category: 'culture', subtype: 'Escape room', baseRank: 205, tags: ['escape room', 'rozrywka'] },
  'amenity:coworking_space': { category: 'business', subtype: 'Coworking', baseRank: 230, tags: ['coworking', 'biuro', 'praca'] },
  'office:company': { category: 'business', subtype: 'Biuro', baseRank: 205, tags: ['biuro', 'firma', 'biurowiec'] },
  'office:it': { category: 'business', subtype: 'Firma IT', baseRank: 210, tags: ['it', 'firma', 'biuro'] },
  'office:coworking': { category: 'business', subtype: 'Coworking', baseRank: 225, tags: ['coworking', 'biuro'] },
  'office:government': { category: 'civic', subtype: 'Urząd', baseRank: 255, tags: ['urzad', 'instytucja'] },
  'office:lawyer': { category: 'business', subtype: 'Kancelaria', baseRank: 185, tags: ['kancelaria', 'prawnik', 'adwokat'] },
  'office:accountant': { category: 'business', subtype: 'Biuro rachunkowe', baseRank: 175, tags: ['ksiegowosc', 'biuro'] },
  'office:estate_agent': { category: 'business', subtype: 'Nieruchomości', baseRank: 175, tags: ['nieruchomosci', 'biuro'] },
  'office:insurance': { category: 'finance', subtype: 'Ubezpieczenia', baseRank: 175, tags: ['ubezpieczenia'] },
  'office:diplomatic': { category: 'civic', subtype: 'Konsulat', baseRank: 245, tags: ['konsulat', 'ambasada'] },
  'landuse:commercial': { category: 'business', subtype: 'Centrum biznesowe', baseRank: 270, tags: ['biurowiec', 'komercyjne', 'biznes'] },
  'amenity:bank': { category: 'finance', subtype: 'Bank', baseRank: 200, tags: ['bank', 'finanse'] },
  'amenity:post_office': { category: 'civic', subtype: 'Poczta', baseRank: 210, tags: ['poczta', 'paczki'] },
  'amenity:townhall': { category: 'civic', subtype: 'Urząd miasta', baseRank: 295, tags: ['ratusz', 'urzad', 'miasto'] },
  'amenity:courthouse': { category: 'civic', subtype: 'Sąd', baseRank: 270, tags: ['sad', 'instytucja'] },
  'amenity:police': { category: 'civic', subtype: 'Policja', baseRank: 235, tags: ['policja', 'komisariat'] },
  'amenity:embassy': { category: 'civic', subtype: 'Ambasada', baseRank: 255, tags: ['ambasada', 'konsulat'] },
  'amenity:fuel': { category: 'fuel', subtype: 'Stacja paliw', baseRank: 210, tags: ['paliwo', 'stacja', 'benzyna'] },
  'amenity:charging_station': { category: 'fuel', subtype: 'Ładowarka EV', baseRank: 185, tags: ['ladowarka', 'ev'] },
  'amenity:place_of_worship': { category: 'worship', subtype: 'Świątynia', baseRank: 235, tags: ['kosciol', 'katedra', 'bazylika', 'swiatynia'] },
  'railway:station': { category: 'train', subtype: 'Stacja kolejowa', baseRank: 340, tags: ['dworzec', 'pkp', 'pociag', 'kolej'] },
  'railway:halt': { category: 'train', subtype: 'Przystanek kolejowy', baseRank: 240, tags: ['kolej', 'pociag'] },
  'aeroway:aerodrome': { category: 'train', subtype: 'Lotnisko', baseRank: 360, tags: ['lotnisko', 'airport', 'port lotniczy'] },
};

const OVERTURE_EXACT_CLASSIFICATION: Record<string, RichPoiClassification> = {
  restaurant: { category: 'restaurant', subtype: 'Restauracja', baseRank: 220, tags: ['restauracja', 'jedzenie', 'obiad'] },
  casual_eatery: { category: 'restaurant', subtype: 'Bar szybkiej obsługi', baseRank: 195, tags: ['jedzenie', 'bistro', 'bar mleczny'] },
  fast_food_restaurant: { category: 'restaurant', subtype: 'Fast food', baseRank: 190, tags: ['fast food', 'jedzenie', 'burger', 'kebab'] },
  pizza_restaurant: { category: 'restaurant', subtype: 'Pizzeria', baseRank: 215, tags: ['pizza', 'pizzeria', 'wloska'] },
  sushi_restaurant: { category: 'restaurant', subtype: 'Sushi', baseRank: 215, tags: ['sushi', 'japonska', 'restauracja'] },
  burger_restaurant: { category: 'restaurant', subtype: 'Burgerownia', baseRank: 210, tags: ['burger', 'burgery', 'restauracja'] },
  kebab_shop: { category: 'restaurant', subtype: 'Kebab', baseRank: 190, tags: ['kebab', 'street food'] },
  cafe: { category: 'cafe', subtype: 'Kawiarnia', baseRank: 220, tags: ['kawiarnia', 'kawa'] },
  coffee_shop: { category: 'cafe', subtype: 'Kawiarnia', baseRank: 220, tags: ['kawiarnia', 'kawa', 'espresso'] },
  bakery: { category: 'cafe', subtype: 'Piekarnia', baseRank: 195, tags: ['piekarnia', 'cukiernia', 'pieczywo'] },
  dessert_shop: { category: 'cafe', subtype: 'Cukiernia', baseRank: 200, tags: ['cukiernia', 'lody', 'deser'] },
  ice_cream_shop: { category: 'cafe', subtype: 'Lodziarnia', baseRank: 200, tags: ['lody', 'lodziarnia'] },
  bar: { category: 'bar', subtype: 'Bar', baseRank: 220, tags: ['bar', 'drinki', 'koktajle'] },
  pub: { category: 'bar', subtype: 'Pub', baseRank: 225, tags: ['pub', 'piwo', 'bar'] },
  cocktail_bar: { category: 'bar', subtype: 'Koktajlbar', baseRank: 225, tags: ['koktajl', 'bar', 'drinki'] },
  wine_bar: { category: 'bar', subtype: 'Winiarnia', baseRank: 215, tags: ['wino', 'bar'] },
  brewery: { category: 'bar', subtype: 'Browar', baseRank: 230, tags: ['browar', 'piwo', 'craft'] },
  nightclub: { category: 'bar', subtype: 'Klub nocny', baseRank: 230, tags: ['klub', 'impreza'] },
  hotel: { category: 'hotel', subtype: 'Hotel', baseRank: 260, tags: ['hotel', 'nocleg'] },
  hostel: { category: 'hotel', subtype: 'Hostel', baseRank: 225, tags: ['hostel', 'nocleg'] },
  bed_and_breakfast: { category: 'hotel', subtype: 'Pensjonat', baseRank: 205, tags: ['pensjonat', 'nocleg'] },
  shopping_mall: { category: 'shop', subtype: 'Galeria handlowa', baseRank: 330, tags: ['galeria', 'centrum handlowe', 'zakupy'] },
  department_store: { category: 'shop', subtype: 'Dom handlowy', baseRank: 280, tags: ['dom handlowy', 'zakupy'] },
  supermarket: { category: 'shop', subtype: 'Supermarket', baseRank: 240, tags: ['supermarket', 'market', 'zakupy'] },
  grocery_store: { category: 'shop', subtype: 'Sklep spożywczy', baseRank: 185, tags: ['spozywczy', 'market', 'zakupy'] },
  convenience_store: { category: 'shop', subtype: 'Sklep spożywczy', baseRank: 165, tags: ['sklep', 'spozywczy'] },
  food_and_beverage_store: { category: 'shop', subtype: 'Sklep spożywczy', baseRank: 170, tags: ['sklep', 'spozywczy'] },
  fashion_and_apparel_store: { category: 'shop', subtype: 'Sklep odzieżowy', baseRank: 165, tags: ['odziez', 'moda', 'sklep'] },
  electronics_store: { category: 'shop', subtype: 'Elektronika', baseRank: 195, tags: ['elektronika', 'rtv'] },
  hardware_home_and_garden_store: { category: 'shop', subtype: 'Dom i ogród', baseRank: 185, tags: ['dom', 'ogrod', 'remont'] },
  books_music_and_video_store: { category: 'shop', subtype: 'Księgarnia', baseRank: 195, tags: ['ksiegarnia', 'muzyka', 'ksiazki'] },
  flowers_and_gifts_store: { category: 'shop', subtype: 'Kwiaciarnia', baseRank: 165, tags: ['kwiaty', 'prezenty'] },
  shopping: { category: 'shop', subtype: 'Sklep', baseRank: 165, tags: ['sklep', 'zakupy'] },
  pharmacy: { category: 'medical', subtype: 'Apteka', baseRank: 210, tags: ['apteka', 'leki'] },
  hospital: { category: 'medical', subtype: 'Szpital', baseRank: 320, tags: ['szpital', 'zdrowie'] },
  medical_clinic: { category: 'medical', subtype: 'Przychodnia', baseRank: 235, tags: ['przychodnia', 'lekarz'] },
  dental_clinic: { category: 'medical', subtype: 'Stomatolog', baseRank: 185, tags: ['dentysta', 'stomatolog'] },
  diagnostics_imaging_or_lab_service: { category: 'medical', subtype: 'Laboratorium', baseRank: 180, tags: ['badania', 'laboratorium'] },
  veterinarian: { category: 'medical', subtype: 'Weterynarz', baseRank: 190, tags: ['weterynarz'] },
  college_university: { category: 'education', subtype: 'Uczelnia', baseRank: 315, tags: ['uczelnia', 'uniwersytet', 'studia'] },
  school: { category: 'education', subtype: 'Szkoła', baseRank: 215, tags: ['szkola'] },
  specialty_school: { category: 'education', subtype: 'Szkoła', baseRank: 185, tags: ['szkola', 'kursy'] },
  place_of_learning: { category: 'education', subtype: 'Edukacja', baseRank: 180, tags: ['edukacja', 'szkola'] },
  library: { category: 'education', subtype: 'Biblioteka', baseRank: 230, tags: ['biblioteka'] },
  museum: { category: 'culture', subtype: 'Muzeum', baseRank: 300, tags: ['muzeum', 'kultura'] },
  art_gallery: { category: 'culture', subtype: 'Galeria sztuki', baseRank: 230, tags: ['galeria sztuki', 'sztuka'] },
  cinema: { category: 'culture', subtype: 'Kino', baseRank: 290, tags: ['kino', 'film'] },
  theater: { category: 'culture', subtype: 'Teatr', baseRank: 295, tags: ['teatr', 'kultura'] },
  performing_arts: { category: 'culture', subtype: 'Kultura', baseRank: 245, tags: ['teatr', 'koncert', 'kultura'] },
  historic_site: { category: 'culture', subtype: 'Zabytek', baseRank: 265, tags: ['zabytek', 'historia', 'atrakcja'] },
  landmark_and_historical_building: { category: 'culture', subtype: 'Zabytek', baseRank: 270, tags: ['zabytek', 'atrakcja'] },
  park: { category: 'nature', subtype: 'Park', baseRank: 260, tags: ['park', 'zielone'] },
  zoo: { category: 'nature', subtype: 'ZOO', baseRank: 335, tags: ['zoo'] },
  botanical_garden: { category: 'nature', subtype: 'Ogród botaniczny', baseRank: 275, tags: ['ogrod', 'park'] },
  stadium_arena: { category: 'sport', subtype: 'Stadion', baseRank: 315, tags: ['stadion', 'arena', 'sport'] },
  sport_or_fitness_facility: { category: 'sport', subtype: 'Sport i fitness', baseRank: 215, tags: ['silownia', 'fitness', 'sport'] },
  gym: { category: 'sport', subtype: 'Siłownia', baseRank: 215, tags: ['silownia', 'fitness'] },
  swimming_pool: { category: 'sport', subtype: 'Basen', baseRank: 245, tags: ['basen', 'plywalnia'] },
  personal_or_beauty_service: { category: 'business', subtype: 'Salon urody', baseRank: 170, tags: ['salon', 'fryzjer', 'kosmetyczka', 'uslugi'] },
  wellness_service: { category: 'business', subtype: 'Wellness i spa', baseRank: 175, tags: ['spa', 'masaz', 'wellness'] },
  professional_service: { category: 'business', subtype: 'Usługi', baseRank: 165, tags: ['firma', 'biuro', 'uslugi'] },
  attorney_or_law_firm: { category: 'business', subtype: 'Kancelaria prawna', baseRank: 165, tags: ['kancelaria', 'adwokat', 'prawo'] },
  legal_service: { category: 'business', subtype: 'Kancelaria prawna', baseRank: 165, tags: ['kancelaria', 'prawnik'] },
  real_estate_service: { category: 'business', subtype: 'Nieruchomości', baseRank: 165, tags: ['nieruchomosci', 'biuro'] },
  travel_service: { category: 'business', subtype: 'Biuro podróży', baseRank: 175, tags: ['podroze', 'biuro'] },
  shipping_or_delivery_service: { category: 'business', subtype: 'Punkt kurierski', baseRank: 165, tags: ['kurier', 'paczki'] },
  business_to_business_service: { category: 'business', subtype: 'Firma B2B', baseRank: 160, tags: ['firma', 'biuro'] },
  coworking_space: { category: 'business', subtype: 'Coworking', baseRank: 220, tags: ['coworking', 'biuro'] },
  bank_or_credit_union: { category: 'finance', subtype: 'Bank', baseRank: 195, tags: ['bank', 'finanse'] },
  financial_service: { category: 'finance', subtype: 'Usługi finansowe', baseRank: 165, tags: ['finanse', 'kantor', 'bank'] },
  post_office: { category: 'civic', subtype: 'Poczta', baseRank: 205, tags: ['poczta'] },
  government_service: { category: 'civic', subtype: 'Urząd', baseRank: 235, tags: ['urzad', 'instytucja'] },
  social_or_community_service: { category: 'civic', subtype: 'Instytucja', baseRank: 185, tags: ['instytucja', 'fundacja'] },
  gas_station: { category: 'fuel', subtype: 'Stacja paliw', baseRank: 205, tags: ['paliwo', 'stacja'] },
  ev_charging_station: { category: 'fuel', subtype: 'Ładowarka EV', baseRank: 180, tags: ['ev', 'ladowarka'] },
  place_of_worship: { category: 'worship', subtype: 'Świątynia', baseRank: 225, tags: ['kosciol', 'swiatynia'] },
  church: { category: 'worship', subtype: 'Kościół', baseRank: 230, tags: ['kosciol', 'parafia'] },
  train_station: { category: 'train', subtype: 'Stacja kolejowa', baseRank: 330, tags: ['dworzec', 'kolej', 'pociag'] },
  airport: { category: 'train', subtype: 'Lotnisko', baseRank: 350, tags: ['lotnisko', 'airport'] },
};

const OVERTURE_BANNED_CATEGORIES = new Set([
  'atm',
  'private_home',
  'residence',
  'residential_building',
  'apartment_or_condo_building',
  'parking',
  'parking_lot',
  'bus_stop',
  'public_transit_stop',
  'tram_stop',
  'wholesale',
  'manufacturer',
  'industrial_facility',
  'construction_services',
  'freight_and_cargo_service',
  'warehouse',
  'storage_facility',
  'agricultural_service',
  'mining',
]);

const CUISINE_TAG_MAP: Record<string, string[]> = {
  pizza: ['pizza', 'pizzeria', 'wloska'],
  italian: ['wloska', 'pasta', 'makaron'],
  ramen: ['ramen', 'japonska', 'zupa'],
  sushi: ['sushi', 'japonska'],
  japanese: ['japonska', 'sushi', 'ramen'],
  burger: ['burger', 'burgery', 'amerykanska'],
  american: ['amerykanska', 'burger'],
  kebab: ['kebab', 'turecka'],
  turkish: ['turecka', 'kebab'],
  polish: ['polska', 'obiady', 'pierogi'],
  indian: ['indyjska', 'curry'],
  thai: ['tajska', 'pad thai'],
  vietnamese: ['wietnamska', 'pho'],
  chinese: ['chinska', 'azjatycka'],
  asian: ['azjatycka'],
  mexican: ['meksykanska', 'tacos'],
  georgian: ['gruzinska', 'chaczapuri'],
  vegan: ['weganska', 'wegetarianska'],
  vegetarian: ['wegetarianska'],
  coffee_shop: ['kawa', 'kawiarnia'],
  ice_cream: ['lody', 'lodziarnia'],
  breakfast: ['sniadania', 'brunch'],
  seafood: ['owoce morza', 'ryby'],
  steak_house: ['steki', 'grill'],
};

function extraCuisineTags(rawCuisine?: string | null): string[] {
  if (!rawCuisine) return [];
  const out: string[] = [];
  for (const part of rawCuisine.toLowerCase().split(/[;,/]+/)) {
    const k = part.trim().replace(/\s+/g, '_');
    if (!k) continue;
    out.push(k.replace(/_/g, ' '));
    const mapped = CUISINE_TAG_MAP[k];
    if (mapped) out.push(...mapped);
  }
  return out;
}

/** Bogata klasyfikacja obiektu OSM dla osobnej bazy POI. */
export function classifyRichOsmPoi(tags: Record<string, string>): RichPoiClassification | null {
  const keys = ['amenity', 'shop', 'tourism', 'leisure', 'office', 'historic', 'railway', 'aeroway', 'landuse'];
  for (const k of keys) {
    const v = tags[k];
    if (!v) continue;
    const hit = OSM_EXACT_CLASSIFICATION[`${k}:${v}`];
    if (hit) {
      const extra = extraCuisineTags(tags.cuisine);
      return {
        ...hit,
        tags: extra.length ? [...new Set([...hit.tags, ...extra])] : hit.tags,
      };
    }
    if (k === 'shop' && v !== 'vacant' && v !== 'yes') {
      return { category: 'shop', subtype: 'Sklep', baseRank: 165, tags: ['sklep', 'zakupy', v.replace(/_/g, ' ')] };
    }
    if (k === 'office' && v !== 'vacant' && v !== 'yes') {
      return { category: 'business', subtype: 'Biuro', baseRank: 175, tags: ['biuro', 'firma'] };
    }
    if (k === 'tourism' && v === 'information' && tags.information === 'office') {
      return { category: 'civic', subtype: 'Informacja turystyczna', baseRank: 230, tags: ['informacja turystyczna'] };
    }
  }
  return null;
}

/** Mapuje kategorie Overture Places v2.0.0 (`basic_category` i `taxonomy`) na kanoniczną taksonomię Kilometr. */
export function classifyOvertureCategory(
  basicCategory: string | null | undefined,
  taxonomyPrimary: string | null | undefined,
  hierarchy?: readonly string[] | null,
): RichPoiClassification | null {
  const candidates = [taxonomyPrimary, basicCategory, ...(hierarchy ? [...hierarchy].reverse() : [])]
    .filter((v): v is string => typeof v === 'string' && v.length > 0)
    .map((v) => v.toLowerCase());

  if (!candidates.length) return null;
  if (candidates.some((c) => OVERTURE_BANNED_CATEGORIES.has(c))) return null;

  for (const c of candidates) {
    const hit = OVERTURE_EXACT_CLASSIFICATION[c];
    if (hit) return hit;
  }

  const joined = candidates.join(' ');
  if (/restaurant|eatery|bistro|diner|ramen|steak|taco|noodle|seafood|grill|pierogi/.test(joined)) {
    return { category: 'restaurant', subtype: 'Restauracja', baseRank: 210, tags: ['restauracja', 'jedzenie'] };
  }
  if (/coffee|cafe|tea_room|bakery|pastry|donut|ice_cream/.test(joined)) {
    return { category: 'cafe', subtype: 'Kawiarnia', baseRank: 210, tags: ['kawiarnia', 'kawa'] };
  }
  if (/bar|pub|tavern|lounge|nightclub|club/.test(joined)) {
    return { category: 'bar', subtype: 'Bar', baseRank: 210, tags: ['bar', 'pub', 'drinki'] };
  }
  if (/hotel|motel|hostel|lodging|resort|inn|guest_house/.test(joined)) {
    return { category: 'hotel', subtype: 'Hotel', baseRank: 245, tags: ['hotel', 'nocleg'] };
  }
  if (/hospital|clinic|medical|doctor|dentist|pharmacy|health/.test(joined)) {
    return { category: 'medical', subtype: 'Zdrowie', baseRank: 185, tags: ['zdrowie', 'lekarz'] };
  }
  if (/university|college|school|academy|education|library/.test(joined)) {
    return { category: 'education', subtype: 'Edukacja', baseRank: 190, tags: ['edukacja', 'szkola'] };
  }
  if (/museum|theater|theatre|cinema|gallery|monument|historic|cultural|arts/.test(joined)) {
    return { category: 'culture', subtype: 'Kultura', baseRank: 230, tags: ['kultura', 'atrakcja'] };
  }
  if (/park|garden|zoo|forest|nature/.test(joined)) {
    return { category: 'nature', subtype: 'Przyroda', baseRank: 235, tags: ['park', 'przyroda'] };
  }
  if (/sport|fitness|gym|stadium|pool|tennis|climbing/.test(joined)) {
    return { category: 'sport', subtype: 'Sport', baseRank: 205, tags: ['sport', 'fitness'] };
  }
  if (/bank|credit|atm|exchange|insurance|financial/.test(joined)) {
    return { category: 'finance', subtype: 'Finanse', baseRank: 165, tags: ['finanse', 'bank'] };
  }
  if (/government|courthouse|police|embassy|post_office|city_hall/.test(joined)) {
    return { category: 'civic', subtype: 'Urząd', baseRank: 205, tags: ['urzad', 'instytucja'] };
  }
  if (/church|cathedral|mosque|synagogue|temple|worship/.test(joined)) {
    return { category: 'worship', subtype: 'Świątynia', baseRank: 215, tags: ['kosciol', 'swiatynia'] };
  }
  if (/gas_station|fuel|charging/.test(joined)) {
    return { category: 'fuel', subtype: 'Stacja paliw', baseRank: 195, tags: ['paliwo', 'stacja'] };
  }
  if (/store|shop|retail|mall|boutique|market|supermarket/.test(joined)) {
    return { category: 'shop', subtype: 'Sklep', baseRank: 165, tags: ['sklep', 'zakupy'] };
  }
  if (/beauty|salon|barber|spa|office|service|consulting|agency|company|repair|studio/.test(joined)) {
    return { category: 'business', subtype: 'Usługi i biznes', baseRank: 160, tags: ['uslugi', 'firma', 'biuro'] };
  }
  return null;
}

function stripControlChars(raw: string): string {
  let out = '';
  for (let i = 0; i < raw.length; i++) {
    const code = raw.charCodeAt(i);
    out += code < 32 || code === 127 ? ' ' : raw[i];
  }
  return out;
}

/** Czyści nazwę POI z artefaktów białych znaków, znaków kontrolnych i nadmiarowych spacji. */
export function cleanPoiName(raw: string): string {
  const cleaned = stripControlChars(String(raw || ''))
    .replace(/[\u2014\u2013]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!cleaned) return '';
  // Zamiana nazw pisanych wyłącznie WIELKIMI LITERAMI (częste w CWOH) na czytelny Title Case.
  if (cleaned.length >= 4 && cleaned === cleaned.toUpperCase() && /[A-ZĄĆĘŁŃÓŚŹŻ]/.test(cleaned)) {
    const keepUpper = new Set(['SPA', 'PKO', 'PKP', 'SKM', 'II', 'III', 'IV', 'AGD', 'RTV', 'VIP', 'IT']);
    return cleaned
      .split(' ')
      .map((word) => {
        if (keepUpper.has(word)) return word;
        return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
      })
      .join(' ');
  }
  return cleaned;
}

/**
 * Buduje czytelną jednowierszową linię adresu do listy wyników i karty na mapie.
 * W strefach wielomiejskich (GZM, Trójmiasto) miasto zawsze stoi na początku.
 */
export function formatRichPoiAddress(input: {
  subtype: string;
  street?: string | null;
  district?: string | null;
  city?: string | null;
  multiCity: boolean;
}): string {
  const street = input.street?.trim() || null;
  const district = input.district?.trim() || null;
  const city = input.city?.trim() || null;

  const placeParts: string[] = [];
  if (district && (!street || !street.toLowerCase().includes(district.toLowerCase()))) {
    placeParts.push(district);
  }
  if (street) placeParts.push(street);

  if (input.multiCity && city) {
    return [city, input.subtype, placeParts.join(', ')].filter(Boolean).join(' • ');
  }
  return [input.subtype, placeParts.join(', ')].filter(Boolean).join(' • ');
}

const COARSE_STEPS_PER_DEG = 50; // 0.02 deg (~2.2 km x 1.4 km)
const FINE_STEPS_PER_DEG = 250; // 0.004 deg (~440 m x 280 m)

/** Wyznacza deterministyczne identyfikatory komórek siatki B-tree dla indeksowania bez R-Tree. */
export function poiGridCells(lat: number, lon: number): { coarse: number; fine: number } {
  const cLat = Math.floor((lat + 90) * COARSE_STEPS_PER_DEG);
  const cLon = Math.floor((lon + 180) * COARSE_STEPS_PER_DEG);
  const fLat = Math.floor((lat + 90) * FINE_STEPS_PER_DEG);
  const fLon = Math.floor((lon + 180) * FINE_STEPS_PER_DEG);
  return {
    coarse: cLat * 65536 + cLon,
    fine: fLat * 262144 + fLon,
  };
}

/** Zwraca komórki siatki przecinające bbox [west, south, east, north] z twardym limitem liczności. */
export function poiGridCellsInBbox(
  bbox: readonly [number, number, number, number],
  level: 'coarse' | 'fine',
  maxCells = 256,
): number[] {
  const [rawWest, rawSouth, rawEast, rawNorth] = bbox;
  const west = Math.max(-180, Math.min(180, rawWest));
  const east = Math.max(-180, Math.min(180, rawEast));
  const south = Math.max(-90, Math.min(90, rawSouth));
  const north = Math.max(-90, Math.min(90, rawNorth));
  if (west > east || south > north) return [];

  const scale = level === 'coarse' ? COARSE_STEPS_PER_DEG : FINE_STEPS_PER_DEG;
  const stride = level === 'coarse' ? 65536 : 262144;
  const latMin = Math.floor((south + 90) * scale);
  const latMax = Math.floor((north + 90) * scale);
  const lonMin = Math.floor((west + 180) * scale);
  const lonMax = Math.floor((east + 180) * scale);

  const count = (latMax - latMin + 1) * (lonMax - lonMin + 1);
  if (count <= 0 || count > maxCells) return [];

  const cells: number[] = [];
  for (let y = latMin; y <= latMax; y++) {
    const base = y * stride;
    for (let x = lonMin; x <= lonMax; x++) {
      cells.push(base + x);
    }
  }
  return cells;
}
