import { useEffect, useMemo, useRef, useState } from 'react';
import type { Connection } from '../types/models';
import { applyLiveDelays } from './routing/engine';
import {
  fetchNationalRailLive,
  type NationalLiveLeg,
  type NationalRailLive,
} from './nationalRailLive';
import {
  fetchNationalRailUpdates,
  isRailUpdateFresh,
  type NationalRailLegUpdate,
} from './nationalRailUpdates';
import { fetchZbRailDepartures, railLegKey, type ZbRailDeparture } from './zbiorkomRail';
import { liveTracker } from './liveTracker';

const RAIL_LIVE_MAX_AGE_MS = 120_000;

let sharedRailData = new Map<string, ZbRailDeparture>();
let sharedNational: NationalRailLive | null = null;
let sharedNationalUpdates = new Map<string, NationalRailLegUpdate>();

function mergeMap<V>(prev: Map<string, V>, incoming: Map<string, V>): Map<string, V> {
  if (incoming.size === 0) return prev;
  if (prev.size === 0) return new Map(incoming);
  let changed = false;
  const next = new Map(prev);
  for (const [k, v] of incoming) {
    if (next.get(k) !== v) {
      next.set(k, v);
      changed = true;
    }
  }
  return changed ? next : prev;
}

function mergeNationalRailLive(
  prev: NationalRailLive | null,
  incoming: NationalRailLive,
): NationalRailLive {
  if (!prev) return incoming;
  return {
    delays: mergeMap(prev.delays, incoming.delays),
    positions: mergeMap(prev.positions, incoming.positions),
    zbTripIds: mergeMap(prev.zbTripIds, incoming.zbTripIds),
    fetchedAt: Math.max(prev.fetchedAt, incoming.fetchedAt),
  };
}

/**
 * Dokłada live do nóg kolejowych:
 * - oficjalny feed PKP PLK via mkuran.pl (główne źródło opóźnień, peronów i torów w całym kraju),
 * - tablica odjazdów zbiorkomu (nazwa handlowa i fallback peronu),
 * - pozycje pociągów ogólnopolskich (punkt na mapie, model składu i fallback opóźnienia).
 * Źródłem prawdy czasów zostaje rozkład; live koryguje go z pierwszeństwem PKP PLK.
 */
export function useRailLiveConnections(
  connections: Connection[],
  tripDelays: Map<string, number>,
  enabled = true,
): Connection[] {
  const [railData, setRailData] = useState<Map<string, ZbRailDeparture>>(() => sharedRailData);
  const [national, setNational] = useState<NationalRailLive | null>(() => sharedNational);
  const [nationalUpdates, setNationalUpdates] = useState<Map<string, NationalRailLegUpdate>>(
    () => sharedNationalUpdates,
  );
  const connectionsRef = useRef(connections);
  connectionsRef.current = connections;
  const signature = useMemo(
    () =>
      JSON.stringify(
        connections.map((connection) =>
          connection.legs
            .filter((leg) => leg.mode === 'train')
            .map((leg) => [
              leg.tripId,
              leg.line,
              leg.fromStopId,
              leg.scheduledDepartureSec ?? leg.departAt,
            ]),
        ),
      ),
    [connections],
  );

  useEffect(() => {
    let active = true;
    const trainLegs = connectionsRef.current
      .flatMap((connection) => connection.legs)
      .filter((leg) => leg.mode === 'train');
    if (trainLegs.length === 0) return;

    const watchLegs: NationalLiveLeg[] = trainLegs.map((leg) => ({
      tripId: leg.tripId ?? '',
      mode: leg.mode,
      fromStop: leg.fromStop,
      toStop: leg.toStop,
      fromStopId: leg.fromStopId,
      toStopId: leg.toStopId,
      fromLat: leg.fromLat,
      fromLon: leg.fromLon,
      toLat: leg.toLat,
      toLon: leg.toLon,
      departAt: leg.departAt,
      arriveAt: leg.arriveAt,
      scheduledDepartureSec: leg.scheduledDepartureSec,
      scheduledArrivalSec: leg.scheduledArrivalSec,
      intermediateStops: leg.intermediateStops,
      line: leg.line,
      trainNumber: leg.trainNumber,
      railAgency: leg.railAgency,
    }));

    if (enabled) {
      liveTracker.setNationalWatch(watchLegs);
    }
    const load = () => {
      void Promise.all([
        fetchZbRailDepartures(trainLegs).catch(() => null),
        fetchNationalRailUpdates(watchLegs).catch(() => null),
        fetchNationalRailLive(watchLegs).catch(() => null),
      ]).then(([zbData, updData, liveData]) => {
        if (!active) return;
        if (zbData && zbData.size > 0) {
          sharedRailData = mergeMap(sharedRailData, zbData);
          setRailData(sharedRailData);
        }
        if (updData && updData.size > 0) {
          sharedNationalUpdates = mergeMap(sharedNationalUpdates, updData);
          setNationalUpdates(sharedNationalUpdates);
        }
        if (liveData && (liveData.delays.size > 0 || liveData.positions.size > 0)) {
          sharedNational = mergeNationalRailLive(sharedNational, liveData);
          setNational(sharedNational);
        }
      });
    };
    load();
    if (!enabled) {
      return () => {
        active = false;
      };
    }
    const timer = setInterval(load, 30_000);
    return () => {
      active = false;
      clearInterval(timer);
      liveTracker.setNationalWatch([]);
    };
  }, [enabled, signature]);

  // Poza kolejami nie ruszamy obiektów: tick live nie może tworzyć nowej listy.
  const enriched = useMemo(() => {
    if (railData.size === 0 && !national && nationalUpdates.size === 0) return connections;
    let touched = false;
    const next = connections.map((connection) => {
      let legsChanged = false;
      const legs = connection.legs.map((leg) => {
        const rail = railData.get(railLegKey(leg));
        const pos = leg.tripId ? national?.positions.get(leg.tripId) : undefined;
        const update = leg.tripId ? nationalUpdates.get(leg.tripId) : undefined;
        if (!rail && !pos && !update) return leg;
        const platformCode = update?.platform ?? rail?.platform ?? leg.platformCode;
        const trackCode = update?.track ?? leg.trackCode;
        const cancelled = update?.cancelled === true || rail?.cancelled === true || leg.cancelled;
        const vehicleModel = pos?.model ?? leg.vehicleModel;
        if (
          leg.railAgency === (update?.agency ?? rail?.agency ?? leg.railAgency) &&
          leg.railLine === (rail?.line ?? leg.railLine) &&
          leg.railColor === (rail?.color ?? leg.railColor) &&
          leg.trainNumber === (update?.numbers?.[0] ?? rail?.trainNumber ?? leg.trainNumber) &&
          leg.trainName === (rail?.trainName ?? leg.trainName) &&
          leg.platformCode === platformCode &&
          leg.trackCode === trackCode &&
          Boolean(leg.cancelled) === Boolean(cancelled) &&
          leg.vehicleModel === vehicleModel
        )
          return leg;
        legsChanged = true;
        return {
          ...leg,
          railAgency: update?.agency ?? rail?.agency ?? leg.railAgency,
          railLine: rail?.line ?? leg.railLine,
          railColor: rail?.color ?? leg.railColor,
          trainNumber: update?.numbers?.[0] ?? rail?.trainNumber ?? leg.trainNumber,
          trainName: rail?.trainName ?? leg.trainName,
          platformCode,
          trackCode,
          cancelled: cancelled || undefined,
          vehicleModel,
        };
      });
      if (!legsChanged) return connection;
      touched = true;
      return { ...connection, legs };
    });
    return touched ? next : connections;
  }, [connections, railData, national, nationalUpdates]);

  return useMemo(() => {
    if (railData.size === 0 && !national && nationalUpdates.size === 0)
      return applyLiveDelays(enriched, tripDelays);
    const delays = new Map(tripDelays);
    const arrivalDelays = new Map<string, number>();
    const now = Date.now();
    for (const connection of enriched) {
      for (const leg of connection.legs) {
        if (!leg.tripId) continue;
        // Fallback 1: tablica odjazdów zbiorkomu
        const rail = railData.get(railLegKey(leg));
        if (rail?.live && now - rail.fetchedAt <= RAIL_LIVE_MAX_AGE_MS) {
          delays.set(leg.tripId, rail.delaySec);
        }
        // Fallback 2: estymacja z pozycji pojazdu na mapie
        const posDelay = national?.delays.get(leg.tripId);
        if (posDelay != null && now - (national?.fetchedAt ?? 0) <= RAIL_LIVE_MAX_AGE_MS) {
          delays.set(leg.tripId, posDelay);
        }
        // Główne źródło: oficjalny feed PKP PLK (nadpisuje wartości heurystyczne)
        const update = nationalUpdates.get(leg.tripId);
        if (update && update.hasRealtimeDelay !== false && isRailUpdateFresh(update, now)) {
          delays.set(leg.tripId, update.delaySec);
          if (update.arrivalDelaySec != null) {
            arrivalDelays.set(leg.tripId, update.arrivalDelaySec);
          }
        }
      }
    }
    return applyLiveDelays(enriched, delays, arrivalDelays);
  }, [enriched, railData, national, nationalUpdates, tripDelays]);
}
