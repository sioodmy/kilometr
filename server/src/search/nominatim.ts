import { config } from '../config';
import { Suggestion } from './types';

let lastRequestTime = 0;
const MIN_GAP_MS = 1000; // 1 req/sec max to respect Nominatim usage policy
const SLICE_MS = 100;

/**
 * Czeka na slot rate-limitu, ale co SLICE_MS sprawdza czy zapytanie nie jest
 * już przestarzałe (użytkownik pisze dalej). Przestarzałe odpuszcza kolejkę
 * natychmiast zamiast blokować świeże zapytania za sobą (head-of-line).
 * Zwraca false gdy przestarzałe — wołający ma zwrócić pusty wynik.
 */
export async function rateLimit(isFresh: () => boolean): Promise<boolean> {
  for (;;) {
    const elapsed = Date.now() - lastRequestTime;
    if (elapsed >= MIN_GAP_MS) break;
    await new Promise((r) => setTimeout(r, Math.min(SLICE_MS, MIN_GAP_MS - elapsed)));
    if (!isFresh()) return false;
  }
  if (!isFresh()) return false;
  lastRequestTime = Date.now();
  return true;
}

export async function searchNominatim(query: string, isFresh: () => boolean = () => true): Promise<Suggestion[]> {
  const q = query.trim();
  if (!q || q.length < 2) return [];

  // Przestarzałe zapytanie nie dostaje slotu — nie blokuje kolejki
  if (!(await rateLimit(isFresh))) return [];

  const url = new URL(config.nominatim.baseUrl);
  url.searchParams.set('q', q);
  url.searchParams.set('format', 'jsonv2');
  url.searchParams.set('addressdetails', '1');
  url.searchParams.set('extratags', '1');
  url.searchParams.set('countrycodes', 'pl');
  url.searchParams.set('viewbox', config.nominatim.wroclawBbox);
  url.searchParams.set('bounded', '1');
  url.searchParams.set('accept-language', 'pl');
  url.searchParams.set('limit', '12');

  try {
    const res = await fetch(url.toString(), {
      headers: {
        'User-Agent': config.nominatim.userAgent,
        Accept: 'application/json',
      },
      signal: AbortSignal.timeout(4500),
    });

    if (!res.ok) {
      console.warn(`[Nominatim] Search failed: HTTP ${res.status}`);
      return [];
    }

    const items = (await res.json()) as any[];
    if (!Array.isArray(items)) return [];

    const suggestions: Suggestion[] = [];

    const typeTranslations: Record<string, string> = {
      restaurant: 'Restauracja', cafe: 'Kawiarnia', fast_food: 'Fast food',
      bar: 'Bar', pub: 'Pub', pharmacy: 'Apteka', hospital: 'Szpital',
      clinic: 'Przychodnia', doctors: 'Lekarz', dentist: 'Dentysta',
      school: 'Szkoła', university: 'Uniwersytet', college: 'Uczelnia',
      library: 'Biblioteka', kindergarten: 'Przedszkole', cinema: 'Kino',
      theatre: 'Teatr', nightclub: 'Klub nocny', fuel: 'Stacja paliw',
      car_wash: 'Myjnia', parking: 'Parking', charging_station: 'Stacja ładowania',
      station: 'Stacja kolejowa', park: 'Park', playground: 'Plac zabaw',
      bank: 'Bank', atm: 'Bankomat', post_office: 'Poczta',
      place_of_worship: 'Kościół', sports_centre: 'Centrum sportowe',
      swimming_pool: 'Basen', stadium: 'Stadion', fitness_centre: 'Siłownia'
    };

    for (const item of items) {
      const lat = Number(item.lat);
      const lon = Number(item.lon);
      if (isNaN(lat) || isNaN(lon)) continue;
      // Ścisły filtr: obsługujemy tylko Wrocław (viewbox/bounded nie wystarczają).
      if (
        lat < config.bounds.minLat ||
        lat > config.bounds.maxLat ||
        lon < config.bounds.minLon ||
        lon > config.bounds.maxLon
      ) {
        continue;
      }

      const c = item.category || item.class;
      const t = item.type;

      // Classify kind
      const kind =
        t === 'house' || t === 'residential' || c === 'building' || c === 'highway'
          ? 'address'
          : 'place';

      let category = 'place';
      if (c === 'shop') category = 'shop';
      else if (c === 'amenity' && ['restaurant', 'cafe', 'fast_food', 'bar', 'pub', 'food_court', 'ice_cream'].includes(t)) category = 'restaurant';
      else if (c === 'amenity' && ['pharmacy', 'hospital', 'doctors', 'dentist', 'clinic'].includes(t)) category = 'medical';
      else if (c === 'amenity' && ['school', 'university', 'college', 'library', 'kindergarten'].includes(t)) category = 'school';
      else if (c === 'amenity' && ['cinema', 'theatre', 'nightclub', 'arts_centre'].includes(t)) category = 'entertainment';
      else if (c === 'amenity' && ['fuel', 'car_wash', 'parking', 'charging_station'].includes(t)) category = 'fuel';
      else if (c === 'railway' || (c === 'public_transport' && t === 'station')) category = 'train';
      else if (c === 'tourism') category = 'tourism';
      else if (c === 'leisure' && ['park', 'garden', 'playground', 'sports_centre', 'fitness_centre', 'swimming_pool', 'stadium'].includes(t)) category = 'sport';
      else if (c === 'amenity' && ['bank', 'atm', 'post_office'].includes(t)) category = 'bank';
      else if (c === 'amenity' && t === 'place_of_worship') category = 'church';

      // Tytuł: nazwa własna, a dla adresów ULICA + NUMER
      // (sama ulica przy "grabiszyńska 309" to za mało precyzji).
      const road = item.address?.road;
      const houseNo = item.address?.house_number;
      const title =
        item.name ||
        (road && houseNo
          ? `${road} ${houseNo}`
          : road || item.display_name.split(',')[0]);
      const suburb = item.address?.suburb || item.address?.neighbourhood || item.address?.quarter || 'Wrocław';
      
      let typeName = 'Miejsce';
      if (kind === 'address') typeName = 'Adres';
      else if (c === 'shop') typeName = 'Sklep';
      else if (t && typeTranslations[t]) typeName = typeTranslations[t];

      const address = `${typeName} • ${suburb}`;

      suggestions.push({
        id: `nom-${item.place_id || item.osm_id}`,
        title,
        address,
        kind,
        category,
        lat,
        lon,
      });
    }

    return suggestions;
  } catch (err: any) {
    console.warn('[Nominatim] Error:', err?.message || err);
    return [];
  }
}
