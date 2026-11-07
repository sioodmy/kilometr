/**
 * Pobiera live opóźnienia i perony dla pociągów ogólnopolskich z endpointu Workera
 * (/api/rail/delays), zasilanego feedem PKP PLK (updates.json).
 *
 * Obejmuje wszystkich przewoźników w Polsce (Polregio, KW, KM, KD, KS, KMŁ, ŁKA, SKMT, IC).
 */

import type { LegStop } from '../types/models';
import { TIMETABLE } from './gtfsConfig';
import { getNationalDb } from './gtfsDatabase';
import { withTimeout } from './net';

export interface NationalRailUpdateQueryLeg {
  tripId?: string;
  mode?: string;
  line?: string;
  trainNumber?: string;
  fromStop?: string;
  fromStopId?: string;
  toStop?: string;
  toStopId?: string;
  departAt?: string;
  arriveAt?: string;
  scheduledDepartureSec?: number;
  scheduledArrivalSec?: number;
  boardSeq?: number;
  alightSeq?: number;
  intermediateStops?: LegStop[];
}

export interface NationalRailLegUpdate {
  tripId: string;
  delaySec: number;
  arrivalDelaySec?: number;
  hasRealtimeDelay?: boolean;
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
  fetchedAt?: number;
  trips?: Record<string, ApiTripUpdate>;
}

const CACHE_TTL_MS = 20_000;
const MAX_TRAIN_DELAY_SEC = 4 * 3600;

let cachedApi: {
  at: number;
  url: string;
  fetchRef: typeof fetch;
  data: ApiResponse;
} | null = null;

export function resetNationalRailUpdatesCache(): void {
  cachedApi = null;
}

function parseHmsToSec(hms?: string): number | null {
  if (!hms) return null;
  const timePart = hms.includes('T') ? hms.split('T')[1] : hms;
  const clean = timePart.split(/[+\-Z]/)[0];
  const parts = clean.split(':').map((n) => parseInt(n, 10));
  if (parts.length < 2 || isNaN(parts[0]) || isNaN(parts[1])) return null;
  return parts[0] * 3600 + parts[1] * 60 + (parts[2] || 0);
}

function wrapSignedDelaySec(actualSec: number, schedSec: number): number {
  return ((actualSec - (schedSec % 86400) + 129600) % 86400) - 43200;
}

/**
 * Konwertuje trip_id z bazy ogólnopolskiej (`pl:PLK_...`) lub miejskiej (`KD:T:2026:...`,
 * `KML:PLK_...`, `KS:PLK_...`) na kanoniczny identyfikator PLK bez sufiksu `_LEG\d+`.
 */
export function toPlkTripId(tripId?: string): string | null {
  if (!tripId) return null;
  const trimmed = tripId.trim().replace(/_LEG\d+$/i, '');
  const kdMatch = /^KD:T:(\d+):(\d+)(?::\d+)?$/i.exec(trimmed);
  if (kdMatch) return `PLK_KD_${kdMatch[1]}_${kdMatch[2]}`;
  const prefixedPlk = /^[A-Z0-9]+:(PLK_.+)$/i.exec(trimmed);
  if (prefixedPlk) return prefixedPlk[1];
  if (trimmed.startsWith('pl:')) return trimmed.slice(3);
  if (trimmed.startsWith('PLK_')) return trimmed;
  return null;
}

function toPlkNumericStopId(stopId?: string): string | null {
  if (!stopId) return null;
  const m = /(?:^|:)(\d+)$/.exec(stopId.trim());
  return m ? `pl:${m[1]}` : null;
}

/**
 * Wyciąga warianty numeru pociągu bez ukośnika (np. "8308/9" -> ["8308", "8309"],
 * "IC 6146" -> ["6146"]), zgodne z tablicą `numbers` w feedzie PKP PLK.
 */
function slashFreeNumbers(trainNumber?: string, line?: string): string[] {
  const out = new Set<string>();
  for (const src of [trainNumber, line]) {
    if (!src) continue;
    for (const token of src.trim().split(/\s+/)) {
      if (!/^\d{3,6}(?:\/\d{1,6})?$/.test(token)) continue;
      if (!token.includes('/')) {
        out.add(token);
        continue;
      }
      const [base, suffix] = token.split('/');
      out.add(base);
      if (suffix.length < base.length) {
        out.add(base.slice(0, base.length - suffix.length) + suffix);
      } else {
        out.add(suffix);
      }
    }
  }
  return [...out];
}

async function resolvePlkBoardAndAlightSeq(
  leg: NationalRailUpdateQueryLeg,
  plkId: string | null,
  schedDepSec: number | null,
  schedArrSec: number | null,
): Promise<{ boardSeq?: number; alightSeq?: number; resolvedSchedDepSec?: number }> {
  const isDirectPlTrip =
    Boolean(leg.tripId?.startsWith('pl:')) && !/_LEG[1-9]\d*$/i.test(leg.tripId ?? '');

  if (isDirectPlTrip) {
    const bSeq = leg.boardSeq ?? leg.intermediateStops?.[0]?.seq;
    const aSeq =
      leg.alightSeq ??
      (leg.intermediateStops && leg.intermediateStops.length >= 2
        ? leg.intermediateStops[leg.intermediateStops.length - 1].seq
        : undefined);
    if (bSeq !== undefined) {
      return { boardSeq: bSeq, alightSeq: aSeq };
    }
  }

  if (!plkId) return {};
  const plTripId = `pl:${plkId}`;
  const plFromStopId = toPlkNumericStopId(leg.fromStopId ?? leg.intermediateStops?.[0]?.stopId);
  const plToStopId = toPlkNumericStopId(
    leg.toStopId ??
      (leg.intermediateStops && leg.intermediateStops.length >= 2
        ? leg.intermediateStops[leg.intermediateStops.length - 1].stopId
        : undefined),
  );

  // Sprawdź bazę SQLite polska (jeśli dostępna)
  try {
    const db = await getNationalDb();
    const rows = await db.getAllAsync<{
      seq: number;
      stop_id: string;
      arr_sec: number;
      dep_sec: number;
    }>(
      'SELECT seq, stop_id, arr_sec, dep_sec FROM stop_times WHERE trip_id = ? ORDER BY seq ASC',
      plTripId,
    );
    if (rows.length > 0) {
      let boardSeq: number | undefined;
      let alightSeq: number | undefined;
      let resolvedSchedDepSec: number | undefined;
      for (const r of rows) {
        const stopMatch = plFromStopId ? r.stop_id === plFromStopId : true;
        const timeMatch =
          schedDepSec !== null ? Math.abs((r.dep_sec % 86400) - schedDepSec) <= 180 : true;
        if (
          boardSeq === undefined &&
          stopMatch &&
          timeMatch &&
          (plFromStopId || schedDepSec !== null)
        ) {
          boardSeq = r.seq;
          resolvedSchedDepSec = r.dep_sec % 86400;
        }
        if (
          plToStopId &&
          r.stop_id === plToStopId &&
          (boardSeq === undefined || r.seq > boardSeq) &&
          (schedArrSec === null || Math.abs((r.arr_sec % 86400) - schedArrSec) <= 300)
        ) {
          alightSeq = r.seq;
        }
      }
      if (boardSeq !== undefined) {
        return { boardSeq, alightSeq, resolvedSchedDepSec };
      }
    }
  } catch {
    // Brak bazy ogólnopolskiej (np. w testach jednostkowych lub przed pobraniem)
  }

  return {};
}

function matchSubtripProfileSeq(
  stops: ApiStopUpdate[],
  legStops: LegStop[],
): { boardSeq: number; alightSeq: number } | undefined {
  const K = legStops.length;
  if (K < 2 || stops.length < K) return undefined;
  const baseDep = legStops[0].departSec ?? legStops[0].arriveSec;
  if (baseDep == null) return undefined;

  let bestWindow: { boardSeq: number; alightSeq: number } | undefined;
  let bestScore = Infinity;

  for (let i = 0; i + K <= stops.length; i++) {
    const t0 = parseHmsToSec(stops[i].dep ?? stops[i].arr);
    if (t0 === null) continue;
    const delay0 = wrapSignedDelaySec(t0, baseDep);
    if (delay0 < -600 || delay0 > MAX_TRAIN_DELAY_SEC) continue;

    let err = 0;
    let ok = true;
    for (let k = 0; k < K; k++) {
      const arrK = parseHmsToSec(stops[i + k].arr ?? stops[i + k].dep);
      const depK = parseHmsToSec(stops[i + k].dep ?? stops[i + k].arr);
      if (arrK === null || depK === null) {
        ok = false;
        break;
      }
      const schedArr = legStops[k].arriveSec;
      const schedDep = legStops[k].departSec;
      if (k > 0 && schedArr != null) {
        let actArrDelta = arrK - t0;
        if (actArrDelta < -43200) actArrDelta += 86400;
        const schedArrDelta = schedArr - baseDep;
        err += Math.abs(actArrDelta - schedArrDelta);
      }
      if (k < K - 1 && schedDep != null) {
        let actDepDelta = depK - t0;
        if (actDepDelta < -43200) actDepDelta += 86400;
        const schedDepDelta = schedDep - baseDep;
        err += Math.abs(actDepDelta - schedDepDelta);
      }
    }
    if (!ok) continue;
    const score = err / K + Math.abs(delay0) * 0.05;
    if (score < bestScore) {
      bestScore = score;
      bestWindow = { boardSeq: stops[i].seq, alightSeq: stops[i + K - 1].seq };
    }
  }

  return bestWindow;
}

/**
 * Odpytuje Worker o live status nóg kolejowych (`pl:...`, `KD:T:...`, `KML:PLK_...` lub z numerem pociągu).
 */
export async function fetchNationalRailUpdates(
  legs: NationalRailUpdateQueryLeg[],
  baseUrl: string = TIMETABLE.baseUrl,
): Promise<Map<string, NationalRailLegUpdate>> {
  const plLegs = legs.filter((l) => {
    if (l.mode && l.mode !== 'train') return false;
    return toPlkTripId(l.tripId) !== null || slashFreeNumbers(l.trainNumber, l.line).length > 0;
  });
  if (plLegs.length === 0) return new Map();

  const tripIds: string[] = [];
  const numbers: string[] = [];
  const seenTrips = new Set<string>();
  const seenNums = new Set<string>();

  for (const l of plLegs) {
    const nums = slashFreeNumbers(l.trainNumber, l.line);
    for (const n of nums) {
      if (!seenNums.has(n)) {
        seenNums.add(n);
        numbers.push(n);
      }
    }
    // Jeśli noga nie ma numeru pociągu, odpytujemy po kanonicznym trip_id.
    // Dla nóg z numerem odpytujemy przez ?numbers=..., co w Workerze zawsze zwraca
    // aktywny dzisiejszy kurs `pl:PLK_...` i obsługuje numery łamane (np. 8308/9 -> 8308,8309).
    if (nums.length === 0 && l.tripId) {
      const plkId = toPlkTripId(l.tripId);
      const queryId = plkId ? `pl:${plkId}` : l.tripId;
      if (!seenTrips.has(queryId)) {
        seenTrips.add(queryId);
        tripIds.push(queryId);
      }
    }
  }

  const params = new URLSearchParams();
  if (tripIds.length > 0) params.set('trips', tripIds.join(','));
  if (numbers.length > 0) params.set('numbers', numbers.join(','));
  if (tripIds.length === 0 && numbers.length === 0) return new Map();

  const requestUrl = `${baseUrl}/api/rail/delays?${params.toString()}`;
  const now = Date.now();

  let data: ApiResponse;
  if (
    cachedApi &&
    now - cachedApi.at < CACHE_TTL_MS &&
    cachedApi.url === requestUrl &&
    cachedApi.fetchRef === globalThis.fetch
  ) {
    data = cachedApi.data;
  } else {
    const timeout = withTimeout(5000);
    try {
      const res = await fetch(requestUrl, {
        signal: timeout.signal,
        headers: { Accept: 'application/json' },
      });
      if (!res.ok) {
        return new Map();
      }
      data = (await res.json()) as ApiResponse;
      cachedApi = {
        at: Date.now(),
        url: requestUrl,
        fetchRef: globalThis.fetch,
        data,
      };
    } catch {
      return new Map();
    } finally {
      timeout.dispose();
    }
  }

  const trips = data.trips ?? {};
  const allTrips = Object.values(trips);
  const result = new Map<string, NationalRailLegUpdate>();

  for (const leg of plLegs) {
    if (!leg.tripId) continue;
    const plkId = toPlkTripId(leg.tripId);
    const canonicalKey = plkId ? `pl:${plkId}` : undefined;
    const legNums = new Set(slashFreeNumbers(leg.trainNumber, leg.line));

    let tripData =
      trips[leg.tripId] ??
      (canonicalKey ? trips[canonicalKey] : undefined) ??
      (plkId ? trips[plkId] : undefined);

    if (!tripData && legNums.size > 0) {
      const candidates = allTrips.filter((t) => {
        const tNums = (t.numbers ?? []).flatMap((n) => slashFreeNumbers(n));
        return tNums.some((n) => legNums.has(n));
      });
      if (candidates.length === 1) {
        tripData = candidates[0];
      } else if (candidates.length > 1) {
        tripData =
          candidates.find((c) => canonicalKey && c.tripId === canonicalKey) ?? candidates[0];
      }
    }

    if (!tripData) continue;

    const rawSchedDep =
      leg.scheduledDepartureSec !== undefined
        ? leg.scheduledDepartureSec
        : leg.intermediateStops?.[0]?.departSec !== undefined
          ? leg.intermediateStops[0].departSec
          : parseHmsToSec(leg.departAt);
    let schedSec =
      rawSchedDep !== null && rawSchedDep !== undefined
        ? ((rawSchedDep % 86400) + 86400) % 86400
        : null;

    const lastInterStop =
      leg.intermediateStops && leg.intermediateStops.length >= 2
        ? leg.intermediateStops[leg.intermediateStops.length - 1]
        : undefined;
    const rawSchedArr =
      leg.scheduledArrivalSec !== undefined
        ? leg.scheduledArrivalSec
        : lastInterStop?.arriveSec !== undefined
          ? lastInterStop.arriveSec
          : parseHmsToSec(leg.arriveAt);
    const schedArrSec =
      rawSchedArr !== null && rawSchedArr !== undefined
        ? ((rawSchedArr % 86400) + 86400) % 86400
        : null;

    const resolved = await resolvePlkBoardAndAlightSeq(leg, plkId, schedSec, schedArrSec);
    if (schedSec === null && resolved.resolvedSchedDepSec !== undefined) {
      schedSec = resolved.resolvedSchedDepSec;
    }

    let boardSeq = resolved.boardSeq;
    let profileAlightSeq: number | undefined;
    if (
      boardSeq === undefined &&
      leg.intermediateStops &&
      leg.intermediateStops.length >= 2 &&
      tripData.stops.length >= leg.intermediateStops.length
    ) {
      const matchedProfile = matchSubtripProfileSeq(tripData.stops, leg.intermediateStops);
      boardSeq = matchedProfile?.boardSeq;
      profileAlightSeq = matchedProfile?.alightSeq;
    }

    let matchedStop: ApiStopUpdate | undefined;
    let delaySec = 0;
    let hasRealtimeDelay = false;

    if (boardSeq !== undefined && tripData.stops.length > 0) {
      matchedStop = tripData.stops.find((st) => st.seq === boardSeq);
      if (matchedStop && schedSec !== null) {
        const actualDepSec = parseHmsToSec(matchedStop.dep ?? matchedStop.arr);
        if (actualDepSec !== null) {
          const diff = wrapSignedDelaySec(actualDepSec, schedSec);
          if (diff >= -1800 && diff <= MAX_TRAIN_DELAY_SEC) {
            delaySec = diff;
            hasRealtimeDelay = true;
          }
        }
      }
    }

    if (!matchedStop && schedSec !== null && tripData.stops.length > 0) {
      let bestScore = Infinity;
      for (const st of tripData.stops) {
        const depSec = parseHmsToSec(st.dep ?? st.arr);
        if (depSec === null) continue;
        const rawDiff = wrapSignedDelaySec(depSec, schedSec);
        if (rawDiff < -600 || rawDiff > MAX_TRAIN_DELAY_SEC) continue;
        // Preferujemy stacje z nieujemnym opóźnieniem, aby opóźniony pociąg nie dopasował
        // się do wcześniejszej stacji na trasie z pozornym ujemnym opóźnieniem.
        const score = rawDiff < -120 ? Math.abs(rawDiff) + 7200 : Math.abs(rawDiff);
        if (score < bestScore) {
          bestScore = score;
          matchedStop = st;
        }
      }
      if (matchedStop) {
        const actualDepSec = parseHmsToSec(matchedStop.dep ?? matchedStop.arr);
        if (actualDepSec !== null) {
          delaySec = wrapSignedDelaySec(actualDepSec, schedSec);
          hasRealtimeDelay = true;
        }
      }
    } else if (!matchedStop && tripData.stops.length > 0) {
      matchedStop = tripData.stops.filter((s) => s.confirmed).pop() ?? tripData.stops[0];
    }

    let arrivalDelaySec: number | undefined;
    const alightSeq =
      resolved.alightSeq ??
      profileAlightSeq ??
      (boardSeq !== undefined && leg.intermediateStops && leg.intermediateStops.length >= 2
        ? boardSeq + (leg.intermediateStops.length - 1)
        : undefined);
    if (alightSeq !== undefined && schedArrSec !== null) {
      const alightStop = tripData.stops.find((st) => st.seq === alightSeq);
      const actualArrSec = parseHmsToSec(alightStop?.arr ?? alightStop?.dep);
      if (actualArrSec !== null) {
        const arrDiff = wrapSignedDelaySec(actualArrSec, schedArrSec);
        if (arrDiff >= -1800 && arrDiff <= MAX_TRAIN_DELAY_SEC) {
          arrivalDelaySec = arrDiff;
        }
      }
    }

    result.set(leg.tripId, {
      tripId: leg.tripId,
      delaySec,
      arrivalDelaySec,
      hasRealtimeDelay,
      platform: matchedStop?.platform,
      track: matchedStop?.track,
      cancelled: tripData.cancelled || matchedStop?.cancelled === true,
      detour: tripData.detour,
      confirmed: matchedStop?.confirmed,
      agency: tripData.agency,
      numbers: tripData.numbers,
      fetchedAt: Date.now(),
    });
  }

  return result;
}
