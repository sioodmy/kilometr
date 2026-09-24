import { DayIndex, LocalGtfsStore as GtfsStore } from './store';
import { JourneySegment, RawJourney, TransitModePreference } from './types';

const INF = 1e9;

// ────────────────────────────────────────────────────────────────────────────
// Parametry spacerowe (spójne z store.ts)
// ────────────────────────────────────────────────────────────────────────────
const WALK_SPEED_MPS = 1.3;
const WALK_DETOUR_FACTOR = 1.3;

interface BoardingStop {
  stopId: string;
  walkSec: number;
  walkM: number;
}

interface AlightingStop {
  stopId: string;
  walkSec: number;
  walkM: number;
}

interface RaptorOptions {
  /** maksymalna liczba przesiadek (0 = tylko bezpośrednie). Default 2. */
  maxTransfers?: number;
  /** minimalny czas na przesiadkę w sekundach. Default 90. */
  minTransferSec?: number;
  /** indeks dzienny (rozkład sobotni/niedzielny różni się od powszedniego) */
  dayIndex?: DayIndex;
  /** znane opóźnienia kursów (GTFS-RT): tripId -> sekundy. RAPTOR wsiada
      wg czasów EFEKTYWNYCH, więc da się złapać opóźniony kurs. */
  tripDelays?: Map<string, number>;
  /** dozwolone pojazdy. Default 'all'. Filtr działa W silniku (nie post-filtr):
      RAPTOR w ogóle nie skanuje wzorców niedozwolonych linii, więc pruning
      globalBestArrival nie wycina dozwolonych alternatyw. */
  allowedModes?: TransitModePreference;
}

/**
 * Klasyfikacja linii na tramwaj/autobus — ta sama heurystyka co w backtrack
 * i LineBadge (Wrocław: route_type 0 albo numer 1–33 to tramwaj).
 */
export function classifyTransitMode(
  routeType: number | undefined,
  shortName: string | undefined,
): 'tram' | 'bus' {
  if (routeType === 0) return 'tram';
  const lineNum = parseInt((shortName || '').trim(), 10);
  if (!isNaN(lineNum) && lineNum >= 1 && lineNum <= 33) return 'tram';
  return 'bus';
}

const TRANSFER_PENALTY_SEC = 600; // 10 min kary za każdą przesiadkę — spacer 300 m się opłaca

export function runRaptor(
  store: GtfsStore,
  origins: BoardingStop[],
  destinations: AlightingStop[],
  departureTimeSec: number,
  opts: RaptorOptions = {}
): RawJourney[] {
  if (!origins.length || !destinations.length) return [];

  const maxTransfers = Math.max(0, Math.min(3, Math.round(opts.maxTransfers ?? 2)));
  const minTransferSec = Math.max(0, Math.min(600, Math.round(opts.minTransferSec ?? 90)));
  const MAX_ROUNDS = maxTransfers + 1;

  // Indeks dzienny — bez niego RAPTOR nie ma po czym jeździć
  const idx = opts.dayIndex;
  if (!idx) return [];

  // Opóźnienie kursu w sekundach (0 = wg rozkładu)
  const delayOf = (tripId: string): number => opts.tripDelays?.get(tripId) ?? 0;

  // Maks. moduł opóźnienia w mapie — do okna poszukiwań przy wsiadaniu.
  // (matcher capuje do 1800 s, ale liczymy z danych na wypadek braku capa).
  let maxDelayAbs = 0;
  if (opts.tripDelays) {
    for (const d of opts.tripDelays.values()) {
      const a = Math.abs(d);
      if (a > maxDelayAbs) maxDelayAbs = a;
    }
  }

  const destStopSet = new Map<string, AlightingStop>();
  for (const d of destinations) {
    destStopSet.set(d.stopId, d);
  }

  // ── Global best arrival — pruning: jeśli najlepsze znane dotarcie do celu
  //    to bestArrival, nie ma sensu rozwijać przystanków z arrival > bestArrival.
  let globalBestArrival = INF;

  // round -> stopId -> earliest arrival seconds
  const tau: Map<string, number>[] = Array.from({ length: MAX_ROUNDS + 1 }, () => new Map());
  // Global best per stop (across all rounds) — do pruningu
  const tauBest = new Map<string, number>();
  // round -> stopId -> previous state for backtracking
  const parent: Map<
    string,
    {
      tripId?: string;
      boardStopId?: string;
      fromStopId?: string;
      type: 'transit' | 'footpath';
      arrTime: number;
      depTime: number;
    }
  >[] = Array.from({ length: MAX_ROUNDS + 1 }, () => new Map());

  let markedStops = new Set<string>();

  // Round 0: Initialize with origins
  for (const orig of origins) {
    const arrSec = departureTimeSec + orig.walkSec;
    const prev = tau[0].get(orig.stopId) ?? INF;
    if (arrSec < prev) {
      tau[0].set(orig.stopId, arrSec);
      tauBest.set(orig.stopId, Math.min(tauBest.get(orig.stopId) ?? INF, arrSec));
      markedStops.add(orig.stopId);
    }
  }

  // ── Round 0 footpath propagation ──
  // Przystanki w zasięgu spaceru od origin-stopów też powinny być zainicjalizowane.
  for (const stopId of [...markedStops]) {
    const paths = store.footpaths.get(stopId);
    if (paths) {
      const arrAtSource = tau[0].get(stopId)!;
      for (const fp of paths) {
        const arrAtTarget = arrAtSource + fp.duration_sec;
        const prevBest = tau[0].get(fp.to_stop_id) ?? INF;
        if (arrAtTarget < prevBest) {
          tau[0].set(fp.to_stop_id, arrAtTarget);
          tauBest.set(fp.to_stop_id, Math.min(tauBest.get(fp.to_stop_id) ?? INF, arrAtTarget));
          markedStops.add(fp.to_stop_id);
        }
      }
    }
  }

  const completedJourneys: RawJourney[] = [];

  for (let k = 1; k <= MAX_ROUNDS; k++) {
    // Copy previous round's arrival times as baseline
    for (const [stopId, time] of tau[k - 1].entries()) {
      const prevK = tau[k].get(stopId) ?? INF;
      if (time < prevK) {
        tau[k].set(stopId, time);
      }
    }

    // Accumulate patterns (not routes!) serving any marked stop
    const patternsToScan = new Set<string>();
    for (const stopId of markedStops) {
      const pIds = idx.stopRoutes.get(stopId);
      if (pIds) {
        for (const pId of pIds) patternsToScan.add(pId);
      }
    }

    const newMarkedStops = new Set<string>();

    for (const patternId of patternsToScan) {
      const pattern = idx.patterns.get(patternId);
      if (!pattern) continue;

      // Jednorazowy filtr pojazdów: wzorzec niedozwolonej linii pomijamy
      // w całości (brak wsiadania = brak przesiadek przez ten pojazd).
      if (opts.allowedModes && opts.allowedModes !== 'all') {
        const route = store.routes.get(pattern.routeId);
        if (classifyTransitMode(route?.route_type, route?.route_short_name) !== opts.allowedModes) {
          continue;
        }
      }

      const stopSeq = pattern.stopSequence;
      const trips = pattern.trips;
      if (!stopSeq.length || !trips.length) continue;

      let currentTripIdx: number = -1;
      let currentTripId: string | null = null;
      let currentBoardStopId: string | null = null;
      let currentBoardDepTime = 0;
      let currentTripTimes: any[] | null = null;

      for (let sIdx = 0; sIdx < stopSeq.length; sIdx++) {
        const stopId = stopSeq[sIdx];

        // If we are currently onboard a trip, update arrival at this stop.
        // Czas EFEKTYWNY: rozkład + znane opóźnienie GPS tego kursu.
        if (currentTripId && currentTripTimes && sIdx < currentTripTimes.length) {
          const st = currentTripTimes[sIdx];
          if (st && st.stop_id === stopId) {
            const arrTime = st.arrival_sec + delayOf(currentTripId);

            // Global pruning: nie rozwijaj jeśli już jest za późno
            if (arrTime >= globalBestArrival) continue;

            const prevBest = tau[k].get(stopId) ?? INF;
            const prevGlobal = tauBest.get(stopId) ?? INF;

            if (arrTime < prevBest) {
              tau[k].set(stopId, arrTime);
              if (arrTime < prevGlobal) {
                tauBest.set(stopId, arrTime);
              }
              parent[k].set(stopId, {
                tripId: currentTripId,
                boardStopId: currentBoardStopId!,
                type: 'transit',
                arrTime,
                depTime: currentBoardDepTime,
              });
              newMarkedStops.add(stopId);

              // Check if this stop is one of our target destinations
              if (destStopSet.has(stopId)) {
                const totalArr = arrTime + destStopSet.get(stopId)!.walkSec;
                if (totalArr < globalBestArrival) {
                  globalBestArrival = totalArr;
                }
                const destInfo = destStopSet.get(stopId)!;
                const journey = backtrackJourney(
                  store,
                  parent,
                  origins,
                  k,
                  stopId,
                  destInfo,
                  departureTimeSec
                );
                if (journey) completedJourneys.push(journey);
              }
            }
          }
        }

        // Can we board an earlier or new trip at this stop?
        // Od 2. rundy wymagamy minimalnego czasu na przesiadkę.
        const earliestArr = tau[k - 1].get(stopId);
        if (earliestArr !== undefined) {
          const minBoardSec = earliestArr + (k > 1 ? minTransferSec : 0);

          // ── Wsiadanie wg czasów EFEKTYWNYCH (rozkład + opóźnienie GPS).
          // Opóźniony kurs, który planowo odjechał 2 min temu, ale ma +20 min,
          // jest wciąż do złapania — binarne przeszukiwanie rozkładu go pominie,
          // więc startujemy wcześniej o maxDelayAbs i skanujemy do pierwszego
          // kursu, którego nie da się już pobić (eff rośnie co najmniej jak
          // sched - maxDelayAbs). Bez opóźnień zachowanie identyczne jak było.
          const depArr = pattern.departures[sIdx];
          const idxArr = pattern.tripIndices[sIdx];
          if (depArr && depArr.length > 0) {
            const startIdx = maxDelayAbs > 0 ? lowerBound(depArr, minBoardSec - maxDelayAbs) : lowerBound(depArr, minBoardSec);
            let bestEff = Infinity;
            let bestTripIdx = -1;
            for (let di = startIdx; di < depArr.length; di++) {
              const schedDep = depArr[di];
              // Dalsze kursy nie pobiją bestEff nawet przy maks. przyśpieszeniu.
              // Bez opóźnień (maxDelayAbs = 0) kończy się na pierwszym pasującym,
              // czyli dokładnie jak poprzednie binary-search.
              if (schedDep - maxDelayAbs > bestEff) break;
              const candTrip = trips[idxArr[di]];
              const eff = schedDep + delayOf(candTrip.trip_id);
              if (eff >= minBoardSec && eff < bestEff) {
                bestEff = eff;
                bestTripIdx = idxArr[di];
              }
            }
            if (bestTripIdx >= 0) {
              const foundTrip = trips[bestTripIdx];
              const depTime = bestEff;

              // Only switch if this trip departs earlier or current onboard trip cannot reach
              if (!currentTripId || depTime < currentBoardDepTime) {
                currentTripIdx = bestTripIdx;
                currentTripId = foundTrip.trip_id;
                currentBoardStopId = stopId;
                currentBoardDepTime = depTime;
                currentTripTimes = store.stopTimes.get(foundTrip.trip_id)!;
              }
            }
          }
        }
      }
    }

    // Apply footpaths / platform transfers for stops updated in this round
    const footpathUpdated = new Set<string>();
    for (const stopId of newMarkedStops) {
      const paths = store.footpaths.get(stopId);
      if (paths) {
        const arrAtSource = tau[k].get(stopId)!;
        // Skip if already too late
        if (arrAtSource >= globalBestArrival) continue;

        for (const fp of paths) {
          const arrAtTarget = arrAtSource + fp.duration_sec;
          if (arrAtTarget >= globalBestArrival) continue;

          const prevBest = tau[k].get(fp.to_stop_id) ?? INF;
          if (arrAtTarget < prevBest) {
            tau[k].set(fp.to_stop_id, arrAtTarget);
            const prevGlobal = tauBest.get(fp.to_stop_id) ?? INF;
            if (arrAtTarget < prevGlobal) {
              tauBest.set(fp.to_stop_id, arrAtTarget);
            }
            parent[k].set(fp.to_stop_id, {
              fromStopId: stopId,
              type: 'footpath',
              arrTime: arrAtTarget,
              depTime: arrAtSource,
            });
            footpathUpdated.add(fp.to_stop_id);

            // Check if footpath target is destination
            if (destStopSet.has(fp.to_stop_id)) {
              const totalArr = arrAtTarget + destStopSet.get(fp.to_stop_id)!.walkSec;
              if (totalArr < globalBestArrival) {
                globalBestArrival = totalArr;
              }
              const destInfo = destStopSet.get(fp.to_stop_id)!;
              const journey = backtrackJourney(
                store,
                parent,
                origins,
                k,
                fp.to_stop_id,
                destInfo,
                departureTimeSec
              );
              if (journey) completedJourneys.push(journey);
            }
          }
        }
      }
    }

    // Dodaj do marked stops te, które zaktualizowano przez footpathy
    for (const s of footpathUpdated) newMarkedStops.add(s);

    markedStops = newMarkedStops;
    if (markedStops.size === 0) break;
  }

  // Zwracamy SUROWE podróże — deduplikacja Pareto + różnorodność dzieją się
  // raz, na połączonym zbiorze ze wszystkich okien (w engine).
  return completedJourneys;
}

/** Binary search: znajdź indeks pierwszego elementu >= target w posortowanej tablicy. */
function lowerBound(arr: number[], target: number): number {
  let lo = 0;
  let hi = arr.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (arr[mid] < target) {
      lo = mid + 1;
    } else {
      hi = mid;
    }
  }
  return lo;
}

function backtrackJourney(
  store: GtfsStore,
  parent: Map<string, any>[],
  origins: BoardingStop[],
  round: number,
  finalTransitStopId: string,
  destInfo: AlightingStop,
  departureTimeSec: number,
  destTitle?: string,
  fromTitle?: string
): RawJourney | null {
  const segments: JourneySegment[] = [];
  let currStopId = finalTransitStopId;
  let currRound = round;

  while (currRound > 0 && currStopId) {
    const p = parent[currRound].get(currStopId);
    if (!p) {
      currRound--;
      continue;
    }

    if (p.type === 'footpath') {
      const fromStop = store.stops.get(p.fromStopId);
      const toStop = store.stops.get(currStopId);
      const walkSec = Math.max(0, p.arrTime - p.depTime);
      segments.unshift({
        type: 'walk',
        fromStopId: p.fromStopId,
        fromStopName: fromStop?.stop_name || 'Przystanek',
        toStopId: currStopId,
        toStopName: toStop?.stop_name || 'Przystanek',
        departSec: p.depTime,
        arriveSec: p.arrTime,
        stopsCount: 0,
        walkMeters: Math.max(20, Math.round(walkSec * WALK_SPEED_MPS)),
      });
      currStopId = p.fromStopId;
    } else if (p.type === 'transit') {
      const trip = store.trips.get(p.tripId);
      const route = trip ? store.routes.get(trip.route_id) : null;
      const boardStop = store.stops.get(p.boardStopId);
      const alightStop = store.stops.get(currStopId);
      const times = store.stopTimes.get(p.tripId) || [];

      const boardIdx = times.findIndex((t: any) => t.stop_id === p.boardStopId);
      const alightIdx = times.findIndex((t: any) => t.stop_id === currStopId);
      const stopsCount = Math.max(0, alightIdx - boardIdx);

      const lineName = route?.route_short_name || '';
      const lineNum = parseInt(lineName, 10);
      const isTram = route?.route_type === 0 || (!isNaN(lineNum) && lineNum >= 1 && lineNum <= 33);
      const mode = isTram ? 'tram' : 'bus';

      segments.unshift({
        type: 'transit',
        tripId: p.tripId,
        routeId: route?.route_id,
        line: route?.route_short_name || 'MPK',
        mode,
        direction: trip?.trip_headsign || '',
        fromStopId: p.boardStopId,
        fromStopName: boardStop?.stop_name || 'Przystanek',
        toStopId: currStopId,
        toStopName: alightStop?.stop_name || 'Przystanek',
        departSec: p.depTime,
        arriveSec: p.arrTime,
        stopsCount,
      });

      currStopId = p.boardStopId;
      currRound--;
    }
  }

  if (segments.length === 0) return null;

  // Find origin walk
  const originMatch = origins.find((o) => o.stopId === currStopId);
  const firstTransitDep = segments[0]?.departSec ?? departureTimeSec;
  const originWalkM = originMatch ? originMatch.walkM : 0;
  const originWalkSec = originMatch ? originMatch.walkSec : 0;

  if (originWalkM > 50) {
    segments.unshift({
      type: 'walk',
      fromStopId: 'origin',
      fromStopName: fromTitle || 'Twoja lokalizacja',
      toStopId: currStopId,
      toStopName: store.stops.get(currStopId)?.stop_name || 'Przystanek',
      departSec: Math.max(departureTimeSec, firstTransitDep - originWalkSec),
      arriveSec: firstTransitDep,
      stopsCount: 0,
      walkMeters: originWalkM,
    });
  }

  // Add final walk to destination if needed — jeden odcinek prosto do celu,
  // NIE stop->stop + stop->cel.
  if (destInfo.walkM > 50) {
    const lastArrSec = segments[segments.length - 1]?.arriveSec ?? departureTimeSec;
    segments.push({
      type: 'walk',
      fromStopId: finalTransitStopId,
      fromStopName: store.stops.get(finalTransitStopId)?.stop_name || 'Przystanek',
      toStopId: 'destination',
      toStopName: destTitle || 'Cel podróży',
      departSec: lastArrSec,
      arriveSec: lastArrSec + destInfo.walkSec,
      stopsCount: 0,
      walkMeters: destInfo.walkM,
    });
  }

  const merged = mergeConsecutiveWalks(segments);

  const transitSegments = merged.filter((s) => s.type === 'transit');
  if (transitSegments.length === 0) return null;

  const depSec = merged[0].departSec;
  const arrSec = merged[merged.length - 1].arriveSec;

  return {
    departureSec: depSec,
    arrivalSec: arrSec,
    transfers: Math.max(0, transitSegments.length - 1),
    segments: merged,
  };
}

/** Łączy pod rząd idące odcinki piesze w jeden (np. przesiadka + dojście do celu). */
export function mergeConsecutiveWalks(segments: JourneySegment[]): JourneySegment[] {
  const out: JourneySegment[] = [];
  for (const seg of segments) {
    const prev = out[out.length - 1];
    if (prev && prev.type === 'walk' && seg.type === 'walk') {
      prev.toStopId = seg.toStopId;
      prev.toStopName = seg.toStopName;
      prev.arriveSec = seg.arriveSec;
      prev.walkMeters = (prev.walkMeters ?? 0) + (seg.walkMeters ?? 0);
      // fromStop/departSec zostają z pierwszego odcinka
    } else {
      out.push({ ...seg });
    }
  }
  return out;
}

function journeyCost(j: RawJourney, departureTimeSec: number): number {
  const doorToDoor = j.arrivalSec - departureTimeSec;
  return doorToDoor + j.transfers * TRANSFER_PENALTY_SEC;
}

export function filterParetoJourneys(journeys: RawJourney[], departureTimeSec = 0): RawJourney[] {
  const result: RawJourney[] = [];

  // Sortuj po koszcie uogólnionym (czas + kara za przesiadki), nie po samym przyjeździe.
  const sorted = [...journeys].sort((a, b) => {
    const ca = journeyCost(a, departureTimeSec);
    const cb = journeyCost(b, departureTimeSec);
    if (ca !== cb) return ca - cb;
    return a.arrivalSec - b.arrivalSec;
  });

  // ── Pareto front: odrzuć zdominowane podróże ──
  // Podróż A dominuje B jeśli A.arrival <= B.arrival ORAZ A.transfers <= B.transfers.
  // Zostawiamy tylko niezdominowane + te z minimalnym kosztem ogólnym.
  const paretoFront: RawJourney[] = [];
  for (const j of sorted) {
    const dominated = paretoFront.some(
      (p) => p.arrivalSec <= j.arrivalSec && p.transfers <= j.transfers && p.departureSec >= j.departureSec
    );
    if (!dominated) {
      paretoFront.push(j);
    }
  }

  // Różnorodność jak w Jakdojade: ta sama kombinacja linii w różnych godzinach
  // to OSOBNE propozycje (np. bezpośredni za 5 i za 15 min) — trzymamy max 5
  // odjazdów na kombinację, ale rozstrzelone w czasie (min. 2 min odstępu):
  // dwa warianty "10:06 vs 10:06+minuta spaceru" to dla użytkownika duplikat,
  // a "10:06 vs 10:21" to już wybór.
  const lineCombo = (j: RawJourney) =>
    j.segments
      .filter((s) => s.type === 'transit')
      .map((s) => s.line)
      .join('+');
  const comboKeptDeps = new Map<string, number[]>();

  // Łączymy Pareto-niezdominowane + najlepsze kosztowo (do 2× ilość)
  const candidates = [...paretoFront];
  for (const j of sorted) {
    if (!candidates.includes(j)) {
      candidates.push(j);
      if (candidates.length >= sorted.length) break;
    }
  }

  const diverse = candidates.filter((j) => {
    const combo = lineCombo(j);
    const kept = comboKeptDeps.get(combo) ?? [];
    if (kept.length >= 5) return false;
    if (kept.some((d) => Math.abs(d - j.departureSec) < 120)) return false;
    kept.push(j.departureSec);
    comboKeptDeps.set(combo, kept);
    return true;
  });

  const seenSignatures = new Set<string>();
  for (const j of diverse) {
    // Dokładny duplikat = te same linie w tych samych godzinach
    // (np. ten sam kurs znaleziony z dwóch okien czasowych).
    const sig =
      j.segments
        .filter((s) => s.type === 'transit')
        .map((s) => `${s.line}@${s.departSec}-${s.arriveSec}`)
        .join('|') + `@${Math.round(j.departureSec / 60)}`;
    if (seenSignatures.has(sig)) continue;
    seenSignatures.add(sig);
    result.push(j);
  }

  // Najtańsze najpierw — bezpośrednie z dłuższym spacerem wygrywają
  // z wieloprzesiadkowymi z najbliższego słupka.
  result.sort((a, b) => journeyCost(a, departureTimeSec) - journeyCost(b, departureTimeSec));

  return result.slice(0, 10);
}
