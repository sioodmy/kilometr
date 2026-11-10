// Udogodnienia składu pociągu (klimatyzacja, gniazdka, rowery, ...) z vagonweb.
// Dane leżą w bazie ogólnopolskiej (tabela trip_amenities), budowanej przez
// cloudflare/scripts/build-polska.mjs z cloudflare/data/rail-amenities.json.
// Brak wiersza = brak danych, nie "brak udogodnień": karta pokazuje wtedy nic.

import type { Leg, RailAmenity } from '../types/models';
import { getNationalDb } from './gtfsDatabase';
import { trainNumberVariants } from './nationalRailLive';

/** Kolejność ikon w karcie: najważniejsze pierwsze (ta sama co w skrypcie). */
export const RAIL_AMENITY_ORDER: readonly RailAmenity[] = [
  'klimatyzacja',
  'gniazdka_230V',
  'gniazdka_usb',
  'wifi',
  'wagon_restauracyjny',
  'bar',
  'przewoz_rowerow',
  'dostepny_wozkarze',
  'miejsca_lezace',
  'miejsca_sypialne',
  'strefa_ciszy',
];

const AMENITY_SET = new Set<string>(RAIL_AMENITY_ORDER);

export interface RailAmenities {
  keys: RailAmenity[];
  counts: Partial<Record<RailAmenity, number>>;
}

/** Maska bitowa z rzędu tabeli -> klucze w kolejności wyświetlania. */
export function decodeAmenities(bits: number): RailAmenity[] {
  return RAIL_AMENITY_ORDER.filter((_, i) => (bits & (1 << i)) !== 0);
}

/** Klucze z pliku JSON -> maska bitowa (build-polska). */
export function encodeAmenities(keys: readonly string[]): number {
  let bits = 0;
  for (const key of keys) {
    const index = RAIL_AMENITY_ORDER.indexOf(key as RailAmenity);
    if (index >= 0) bits |= 1 << index;
  }
  return bits;
}

/** Tylko znane klucze, w kolejności wyświetlania (nieufne dane z pliku). */
export function sanitizeAmenities(keys: readonly string[]): RailAmenity[] {
  const seen = new Set(keys.filter((k) => AMENITY_SET.has(k)));
  return RAIL_AMENITY_ORDER.filter((k) => seen.has(k));
}

const cache = new Map<string, RailAmenities | null>();

function cacheKey(leg: Leg): string {
  return `${leg.railAgency ?? ''}|${leg.trainNumber ?? leg.line ?? ''}|${leg.trainName ?? ''}`;
}

/**
 * Udogodnienia dla nogi kolejowej. Czyta trip_amenities po trip_id, a gdy
 * baza nie zna kursu, po parach agency + numer pociągu (warianty numerów).
 * Wynik jest cache'owany per pociąg: karta połączenia jest przerysowywana
 * przy każdym ticku live.
 */
export async function loadRailAmenities(leg: Leg): Promise<RailAmenities | null> {
  const key = cacheKey(leg);
  const hit = cache.get(key);
  if (hit !== undefined) return hit;

  let result: RailAmenities | null = null;
  try {
    const db = await getNationalDb();
    const tripId = leg.tripId?.startsWith('pl:') ? leg.tripId : null;
    let row = tripId
      ? await db.getFirstAsync<{ bits: number; numbers: string }>(
          'SELECT bits, numbers FROM trip_amenities WHERE trip_id = ?',
          tripId,
        )
      : null;
    if (!row) {
      const agency = leg.railAgency ?? '';
      const numbers = trainNumberVariants(leg.trainNumber, leg.line);
      if (agency && numbers.length > 0) {
        const placeholders = numbers.map(() => '?').join(',');
        row = await db.getFirstAsync<{ bits: number; numbers: string }>(
          `SELECT a.bits AS bits, a.numbers AS numbers
             FROM trip_amenities a JOIN trips t ON t.trip_id = a.trip_id
            WHERE t.agency = ? AND t.train_number IN (${placeholders})
            LIMIT 1`,
          agency,
          ...numbers,
        );
      }
    }
    if (row) {
      const counts: Partial<Record<RailAmenity, number>> = {};
      if (row.numbers) {
        const parsed: unknown = JSON.parse(row.numbers);
        if (parsed && typeof parsed === 'object') {
          for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
            if (AMENITY_SET.has(k) && typeof v === 'number' && v > 0) {
              counts[k as RailAmenity] = v;
            }
          }
        }
      }
      result = { keys: decodeAmenities(row.bits), counts };
    }
  } catch {
    // Baza kolejowa niedostępna (nie pobrana / stara wersja bez tabeli)
    result = null;
  }

  cache.set(key, result);
  if (cache.size > 500) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  return result;
}

/** Czyści cache po podmianie bazy kolejowej. */
export function resetRailAmenitiesCache(): void {
  cache.clear();
}
