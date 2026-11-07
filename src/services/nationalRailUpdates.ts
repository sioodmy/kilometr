/**
 * Pobiera live opóźnienia i perony dla pociągów ogólnopolskich z endpointu Workera
 * (/api/rail/delays), zasilanego feedem PKP PLK (updates.json).
 *
 * Obejmuje wszystkich przewoźników w Polsce (Polregio, KW, KM, KD, KS, KMŁ, ŁKA, SKMT, IC).
 */

import { TIMETABLE } from './gtfsConfig';
import { withTimeout } from './net';

export interface NationalRailUpdateQueryLeg {
  tripId?: string;
  mode?: string;
  trainNumber?: string;
  fromStop?: string;
  toStop?: string;
  departAt?: string;
  scheduledDepartureSec?: number;
}

export interface NationalRailLegUpdate {
  tripId: string;
  delaySec: number;
  platform?: string;
  track?: string;
  cancelled: boolean;
  detour: boolean;
  confirmed?: boolean;
  agency?: string;
  numbers?: string[];
  fetchedAt: number;
}

interface ApiStopUpdate {
  seq: number;
  arr?: string;
  dep?: string;
  platform?: string;
  track?: string;
  confirmed?: boolean;
  cancelled?: boolean;
}

interface ApiTripUpdate {
  tripId: string;
  agency: string;
  numbers: string[];
  cancelled: boolean;
  detour: boolean;
  lastConfirmedSeq?: number;
  stops: ApiStopUpdate[];
}

interface ApiResponse {
  updatedAt?: string;
  trips?: Record<string, ApiTripUpdate>;
}

const CACHE_TTL_MS = 20_000;
let cachedResult: { at: number; map: Map<string, NationalRailLegUpdate> } | null = null;

function parseHmsToSec(hms?: string): number | null {
  if (!hms) return null;
  const timePart = hms.includes('T') ? hms.split('T')[1] : hms;
  const parts = timePart.split(':').map((n) => parseInt(n, 10));
  if (parts.length < 2 || isNaN(parts[0]) || isNaN(parts[1])) return null;
  return parts[0] * 3600 + parts[1] * 60 + (parts[2] || 0);
}

/**
 * Odpytuje Worker o live status nóg ogólnopolskich (tripId z prefiksem 'pl:').
 */
export async function fetchNationalRailUpdates(
  legs: NationalRailUpdateQueryLeg[],
  baseUrl: string = TIMETABLE.baseUrl,
): Promise<Map<string, NationalRailLegUpdate>> {
  const plLegs = legs.filter(
    (l) => (!l.mode || l.mode === 'train') && (l.tripId?.startsWith('pl:') || l.trainNumber),
  );
  if (plLegs.length === 0) return new Map();

  const now = Date.now();
  if (cachedResult && now - cachedResult.at < CACHE_TTL_MS) {
    // Sprawdź czy mamy w cache wszystkie żądane tripId
    const hasAll = plLegs.every((l) => !l.tripId || cachedResult!.map.has(l.tripId));
    if (hasAll) {
      return cachedResult.map;
    }
  }

  const tripIds = [
    ...new Set(plLegs.map((l) => l.tripId).filter((id): id is string => !!id)),
  ];
  const numbers = [
    ...new Set(plLegs.map((l) => l.trainNumber).filter((n): n is string => !!n)),
  ];

  const params = new URLSearchParams();
  if (tripIds.length > 0) params.set('trips', tripIds.join(','));
  if (numbers.length > 0) params.set('numbers', numbers.join(','));

  const requestUrl = `${baseUrl}/api/rail/delays?${params.toString()}`;
  const timeout = withTimeout(5000);

  try {
    const res = await fetch(requestUrl, {
      signal: timeout.signal,
      headers: { Accept: 'application/json' },
    });

    if (!res.ok) {
      return cachedResult?.map ?? new Map();
    }

    const data = (await res.json()) as ApiResponse;
    const trips = data.trips ?? {};
    const result = new Map<string, NationalRailLegUpdate>();

    for (const leg of plLegs) {
      if (!leg.tripId) continue;
      const tripData =
        trips[leg.tripId] ||
        (leg.trainNumber
          ? Object.values(trips).find((t) => t.numbers?.includes(leg.trainNumber!))
          : undefined);

      if (!tripData) continue;

      // Wyliczamy opóźnienie dla stacji odjazdu tej nogi
      let delaySec = 0;
      let matchedStop: ApiStopUpdate | undefined;

      const schedSec =
        leg.scheduledDepartureSec !== undefined
          ? leg.scheduledDepartureSec % 86400
          : parseHmsToSec(leg.departAt);

      if (schedSec !== null && tripData.stops.length > 0) {
        // Szukamy przystanku odpowiadającego odjazdowi
        let minDiff = Infinity;
        for (const st of tripData.stops) {
          const depSec = parseHmsToSec(st.dep || st.arr);
          if (depSec !== null) {
            const diff = Math.abs(depSec - schedSec);
            if (diff < minDiff) {
              minDiff = diff;
              matchedStop = st;
            }
          }
        }

        if (matchedStop && minDiff < 1800) {
          const actualDepSec = parseHmsToSec(matchedStop.dep || matchedStop.arr);
          if (actualDepSec !== null) {
            // Opóźnienie na tej konkretnej stacji
            delaySec = actualDepSec - schedSec;
          }
        }
      } else if (tripData.stops.length > 0) {
        const lastSt = tripData.stops.filter((s) => s.confirmed).pop() || tripData.stops[0];
        if (lastSt) {
          matchedStop = lastSt;
        }
      }

      result.set(leg.tripId, {
        tripId: leg.tripId,
        delaySec,
        platform: matchedStop?.platform,
        track: matchedStop?.track,
        cancelled: tripData.cancelled || matchedStop?.cancelled === true,
        detour: tripData.detour,
        confirmed: matchedStop?.confirmed,
        agency: tripData.agency,
        numbers: tripData.numbers,
        fetchedAt: now,
      });
    }

    cachedResult = { at: now, map: result };
    return result;
  } catch {
    return cachedResult?.map ?? new Map();
  }
}
