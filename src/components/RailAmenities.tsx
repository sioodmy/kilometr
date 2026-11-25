import { useEffect, useState } from 'react';
import {
  getCachedRailAmenities,
  loadRailAmenities,
  type RailAmenities as Amenities,
} from '../services/railAmenities';

interface RailAmenitiesQuery {
  enabled?: boolean;
  deferLoad?: boolean;
  tripId?: string;
  agency?: string;
  trainNumber?: string;
  line?: string;
  trainName?: string;
}

/**
 * Ładuje udogodnienia składu z vagonweb dla odcinka kolejowego.
 * Zwraca wynik synchronicznie z cache (bez mignięcia layoutu), a przy jego braku dociąga z bazy.
 */
export function useRailAmenities({
  enabled = true,
  deferLoad = false,
  tripId,
  agency,
  trainNumber,
  line,
  trainName,
}: RailAmenitiesQuery): Amenities | null {
  const [data, setData] = useState<Amenities | null>(() =>
    enabled
      ? (getCachedRailAmenities({
          tripId,
          railAgency: agency,
          trainNumber,
          line,
          trainName,
        }) ?? null)
      : null,
  );

  useEffect(() => {
    if (!enabled) {
      setData(null);
      return;
    }
    let alive = true;
    const cached = getCachedRailAmenities({
      tripId,
      railAgency: agency,
      trainNumber,
      line,
      trainName,
    });
    if (cached !== undefined) {
      setData(cached);
      return;
    }
    if (deferLoad) return;
    setData(null);
    void loadRailAmenities({
      id: '',
      mode: 'train',
      fromStop: '',
      toStop: '',
      departAt: '',
      arriveAt: '',
      stopsCount: 0,
      live: false,
      tripId,
      railAgency: agency,
      trainNumber,
      line,
      trainName,
    }).then((next) => {
      if (alive) setData(next);
    });
    return () => {
      alive = false;
    };
  }, [enabled, deferLoad, tripId, agency, trainNumber, line, trainName]);

  return data;
}
