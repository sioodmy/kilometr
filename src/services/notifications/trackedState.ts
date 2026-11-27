import type { TrackedTrip, TripProgress } from './types';

export type TrackedListener = (trip: TrackedTrip | null, p: TripProgress | null) => void;

let tracked: TrackedTrip | null = null;
let progress: TripProgress | null = null;
const listeners = new Set<TrackedListener>();

export function subscribeTracked(listener: TrackedListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getTrackedTripSync(): TrackedTrip | null {
  return tracked ? { ...tracked } : null;
}

export function getTripProgressSync(): TripProgress | null {
  return progress ? { ...progress } : null;
}

export function setTrackedSnapshot(
  nextTracked: TrackedTrip | null,
  nextProgress: TripProgress | null,
  notifyListeners = true,
): void {
  tracked = nextTracked;
  progress = nextProgress;
  if (!notifyListeners) return;
  for (const l of listeners) {
    l(tracked ? { ...tracked } : null, progress ? { ...progress } : null);
  }
}
