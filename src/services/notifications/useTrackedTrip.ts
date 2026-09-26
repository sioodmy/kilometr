import { useEffect, useState } from 'react';
import { subscribeTracked, getTrackedTripSync, getTripProgressSync } from './tripMonitor';
import type { TripProgress, TrackedTrip } from './types';

// Hook do ekranów: aktywna podróż + jej stan. Jeden stan dla całego drzewa
// (monitor sam w sobie jest modułem), więc każdy ekran widzi to samo i
// nie musi własnego tickera.

export function useTrackedTrip(): {
  trip: TrackedTrip | null;
  progress: TripProgress | null;
} {
  const [state, setState] = useState<{ trip: TrackedTrip | null; progress: TripProgress | null }>(
    () => ({ trip: getTrackedTripSync(), progress: getTripProgressSync() }),
  );

  useEffect(() => subscribeTracked((trip, progress) => setState({ trip, progress })), []);

  return state;
}
