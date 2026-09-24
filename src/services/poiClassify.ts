// Czyste helpery klasyfikacji POI (bez natywnych importów — testowalne w node).

export const CATEGORY_LABEL: Record<string, { category: string; label: string }> = {
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
};

export function classifyPoi(tags: Record<string, string>): { category: string; label: string } | null {
  const keys = ['shop', 'amenity', 'tourism', 'leisure', 'railway'];
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

/** Linia adresu: "Label • Osiedle, Ulica Nr" (bez miasta — tylko Wrocław). */
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
