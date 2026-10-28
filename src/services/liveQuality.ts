import type { RawVehicleRow, TrackedVehicle } from './liveTracker';
import { distanceMeters } from '../gtfs/geo';
import { normalizeName } from './vehiclePosition';

export const MAX_DELAY_SEC = 5400;
export const MAX_SAMPLE_AGE_MS = 120_000;

export function sampleTime(row: RawVehicleRow, now: number): number | null {
  const at = row.timestamp ?? now;
  return Number.isFinite(at) && at <= now + 15_000 && now - at <= MAX_SAMPLE_AGE_MS
    ? Math.min(at, now)
    : null;
}

export function apiDelay(row: RawVehicleRow): number | undefined {
  const d = row.delaySec;
  return d != null && Number.isFinite(d) && d >= -300 && d <= MAX_DELAY_SEC ? d : undefined;
}

export interface MatchHints {
  api?: number;
  headsign: string;
  previous?: TrackedVehicle;
  nextStop: string;
  nextSec?: number;
}

export function matchHints(row: RawVehicleRow, previous?: TrackedVehicle): MatchHints {
  const next = row.upcomingStops?.[0];
  const api = apiDelay(row);
  return {
    api:
      previous?.delaySec != null && (api == null || Math.abs(api - previous.delaySec) > 180)
        ? previous.delaySec
        : api,
    headsign: normalizeName(row.headsign ?? ''),
    previous,
    nextStop: normalizeName(next?.name ?? ''),
    nextSec: next?.schedSec,
  };
}

/** Wynik porównuje rozkład z chwilą pomiaru, kierunkiem i poprzednim kursem. */
export function matchScore(
  hints: MatchHints,
  tripId: string,
  headsign: string,
  delay: number,
  distance: number,
  lat: number,
  lon: number,
  nextLat: number,
  nextLon: number,
  nextName: string,
  nextSec: number,
): number {
  if (delay < -300 || delay > MAX_DELAY_SEC) return Infinity;
  const direction = normalizeName(headsign);
  const directionMatch = !!hints.headsign && !!direction && hints.headsign === direction;
  if (hints.headsign && direction && !directionMatch) return Infinity;
  const sameTrip = hints.previous?.matchedTripId === tripId;
  const stopMatch = !!hints.nextStop && hints.nextStop === normalizeName(nextName);
  if (delay > 2100 && !directionMatch && !sameTrip && !stopMatch) return Infinity;
  let score = Math.abs(delay - (hints.api ?? 0)) + distance * 2;
  if (sameTrip) score -= 240;
  if (stopMatch && hints.nextSec != null) {
    const diff = Math.abs(nextSec - hints.nextSec);
    score += Math.min(diff, Math.abs(diff - 86400)) * 2;
  }
  const prev = hints.previous;
  if (prev && distanceMeters(prev.lat, prev.lon, lat, lon) >= 25) {
    const cos = Math.cos((lat * Math.PI) / 180);
    const dx = (lon - prev.lon) * cos;
    const dy = lat - prev.lat;
    const tx = (nextLon - lon) * cos;
    const ty = nextLat - lat;
    if (dx * tx + dy * ty < 0) score += 900;
  }
  return score;
}

/** Rozbieżny delay z API ustępuje GPS; pojedynczy skok nie zmienia całej prognozy. */
export function fusedDelay(row: RawVehicleRow, gps: number, previous?: TrackedVehicle): number {
  const api = apiDelay(row);
  const measured = api != null && Math.abs(api - gps) <= 180 ? api : gps;
  if (!previous || previous.delaySec == null) return Math.round(measured);
  const elapsed = Math.max(0, ((row.timestamp ?? Date.now()) - previous.updatedAt) / 1000);
  if (elapsed === 0) return previous.delaySec;
  const alpha = 1 - Math.exp(-elapsed / 15);
  return Math.round(previous.delaySec + alpha * (measured - previous.delaySec));
}
