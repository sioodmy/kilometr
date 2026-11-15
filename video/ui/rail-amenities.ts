// Mock udogodnień IC do zrzutu ekranu wideo (bez bazy trip_amenities).
import type { Leg, RailAmenity } from '../../src/types/models';

const KEYS: RailAmenity[] = [
  'klimatyzacja',
  'gniazdka_230V',
  'gniazdka_usb',
  'wifi',
  'wagon_restauracyjny',
  'przewoz_rowerow',
];

export type RailAmenities = { keys: RailAmenity[]; counts: Partial<Record<RailAmenity, number>> };

export async function loadRailAmenities(_leg: Leg): Promise<RailAmenities | null> {
  return { keys: KEYS, counts: { przewoz_rowerow: 8 } };
}

export function resetRailAmenitiesCache() {}
