// Klient live opóźnień i estymacji dla strony udostępnionego połączenia (kilometr.app/t#...).
// Działa z pełnym bezpiecznym fallbackiem: jeśli api.kilometr.app jest niedostępne lub
// podróż jest poza aktywnym oknem czasowym, strona płynnie zostaje w trybie statycznym.

import type { SharedConnection } from '../../src/sharing/connection';
import { sharedJourneySeconds } from '../../src/sharing/progress';

const DEFAULT_API_BASE = 'https://api.kilometr.app';
const FETCH_TIMEOUT_MS = 4000;

export interface SharedWebLegLive {
  status: 'live' | 'estimated' | 'scheduled';
  delaySec: number;
  arrivalDelaySec?: number;
  confidence: number;
  source: string;
  typicalDelaySec?: number;
  cancelled: boolean;
  detour: boolean;
  platform?: string;
  track?: string;
  currentStop?: string;
  nextStop?: string;
}

export interface SharedWebLiveSnapshot {
  updatedAt: number;
  legs: (SharedWebLegLive | null)[];
  hasAnyLive: boolean;
}

function getApiBase(): string {
  const fromEnv = (import.meta as unknown as { env?: Record<string, string | undefined> }).env
    ?.VITE_KILOMETR_API_URL;
  return (fromEnv || DEFAULT_API_BASE).replace(/\/$/, '');
}

/** Sprawdza, czy udostępniona podróż jest w oknie czasowym, w którym live ma sens. */
export function isJourneyInLiveWindow(journey: SharedConnection, now = new Date()): boolean {
  const elapsed = sharedJourneySeconds(journey.date, now);
  const startSec = journey.departure * 60;
  const endSec = journey.arrival * 60;
  return elapsed >= startSec - 45 * 60 && elapsed <= endSec + 60 * 60;
}

function resolveScheduledSec(
  actualMin: number,
  scheduledMin: number | undefined,
): number {
  if (scheduledMin === undefined) return actualMin * 60;
  const dayOffset = Math.round((actualMin - scheduledMin) / 1440);
  return (scheduledMin + dayOffset * 1440) * 60;
}

/** Pobiera bieżące opóźnienia GPS/PLK oraz estymacje bez GPS dla odcinków udostępnionej podróży. */
export async function fetchSharedJourneyLive(
  journey: SharedConnection,
  signal?: AbortSignal,
): Promise<SharedWebLiveSnapshot | null> {
  const transitLegs = journey.legs
    .map((leg, index) => ({ leg, index }))
    .filter(({ leg }) => leg.mode !== 'walk');
  if (transitLegs.length === 0) return null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  const onAbort = () => controller.abort();
  signal?.addEventListener('abort', onAbort, { once: true });

  try {
    const payload = {
      city: journey.city,
      date: journey.date,
      legs: transitLegs.map(({ leg, index }) => ({
        id: String(index),
        mode: leg.mode,
        line: leg.line,
        trip_id: leg.trip,
        train_number: leg.mode === 'train' ? leg.line : undefined,
        direction: leg.direction,
        from_stop: leg.from,
        to_stop: leg.to,
        from_lat: leg.fromLat,
        from_lon: leg.fromLon,
        to_lat: leg.toLat,
        to_lon: leg.toLon,
        scheduled_departure_sec: resolveScheduledSec(leg.departure, leg.scheduledDeparture),
        scheduled_arrival_sec: resolveScheduledSec(leg.arrival, leg.scheduledArrival),
      })),
    };

    const res = await fetch(`${getApiBase()}/v1/shared/live`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    if (!res.ok) return null;

    const raw = (await res.json()) as {
      updated_at?: number;
      legs?: Array<{
        id: string;
        status: 'live' | 'estimated' | 'scheduled';
        delay_sec: number;
        arrival_delay_sec?: number;
        confidence: number;
        source: string;
        typical_delay_sec?: number;
        cancelled: boolean;
        detour: boolean;
        platform?: string;
        track?: string;
        vehicle?: { current_stop?: string; next_stop?: string };
      }>;
    };

    if (!raw || !Array.isArray(raw.legs)) return null;

    const legs: (SharedWebLegLive | null)[] = journey.legs.map(() => null);
    let hasAnyLive = false;

    for (const item of raw.legs) {
      const idx = Number(item.id);
      if (!Number.isInteger(idx) || idx < 0 || idx >= legs.length) continue;
      if (item.status === 'live' || item.status === 'estimated' || item.cancelled) {
        hasAnyLive = true;
      }
      legs[idx] = {
        status: item.status,
        delaySec: item.delay_sec,
        arrivalDelaySec: item.arrival_delay_sec,
        confidence: item.confidence,
        source: item.source,
        typicalDelaySec: item.typical_delay_sec,
        cancelled: item.cancelled,
        detour: item.detour,
        platform: item.platform,
        track: item.track,
        currentStop: item.vehicle?.current_stop,
        nextStop: item.vehicle?.next_stop,
      };
    }

    return {
      updatedAt: raw.updated_at ?? Date.now(),
      legs,
      hasAnyLive,
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
}
