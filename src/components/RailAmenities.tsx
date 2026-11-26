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

interface RailAmenitiesState {
  amenities: Amenities | null;
  loading: boolean;
}

/**
 * Ładuje udogodnienia składu z vagonweb dla odcinka kolejowego.
 * Zwraca wynik synchronicznie z cache, a przy jego braku sygnalizuje stan
 * ładowania do czasu dociągnięcia danych z bazy.
 */
export function useRailAmenities({
  enabled = true,
  deferLoad = false,
  tripId,
  agency,
  trainNumber,
  line,
  trainName,
}: RailAmenitiesQuery): RailAmenitiesState {
  const [state, setState] = useState<RailAmenitiesState>(() => {
    if (!enabled) return { amenities: null, loading: false };
    const cached = getCachedRailAmenities({
      tripId,
      railAgency: agency,
      trainNumber,
      line,
      trainName,
    });
    if (cached !== undefined) return { amenities: cached, loading: false };
    return { amenities: null, loading: true };
  });

  useEffect(() => {
    if (!enabled) {
      setState((prev) =>
        prev.amenities === null && !prev.loading ? prev : { amenities: null, loading: false },
      );
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
      setState({ amenities: cached, loading: false });
      return;
    }
    setState((prev) => (prev.amenities === null && prev.loading ? prev : { amenities: null, loading: true }));
    if (deferLoad) return;
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
      if (alive) setState({ amenities: next, loading: false });
    });
    return () => {
      alive = false;
    };
  }, [enabled, deferLoad, tripId, agency, trainNumber, line, trainName]);

  return state;
}
