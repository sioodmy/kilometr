import { useEffect, useMemo, useRef, useState } from 'react';
import type { Connection } from '../types/models';
import { applyLiveDelays } from './routing/engine';
import {
  fetchNationalRailLive,
  type NationalLiveLeg,
  type NationalRailLive,
} from './nationalRailLive';
import { fetchNationalRailUpdates, type NationalRailLegUpdate } from './nationalRailUpdates';
import { fetchZbRailDepartures, railLegKey, type ZbRailDeparture } from './zbiorkomRail';
import { liveTracker } from './liveTracker';

const RAIL_LIVE_MAX_AGE_MS = 120_000;

/**
 * Dokłada live do nóg kolejowych:
 * - oficjalny feed PKP PLK via mkuran.pl (główne źródło opóźnień, peronów i torów w całym kraju),
 * - tablica odjazdów zbiorkomu (nazwa handlowa i fallback peronu),
 * - pozycje pociągów ogólnopolskich (punkt na mapie i fallback opóźnienia).
 * Źródłem prawdy czasów zostaje rozkład; live koryguje go z pierwszeństwem PKP PLK.
 */
export function useRailLiveConnections(
  connections: Connection[],
  tripDelays: Map<string, number>,
  enabled = true,
): Connection[] {
  const [railData, setRailData] = useState<Map<string, ZbRailDeparture>>(new Map());
  const [national, setNational] = useState<NationalRailLive | null>(null);
  const [nationalUpdates, setNationalUpdates] = useState<Map<string, NationalRailLegUpdate>>(
    new Map(),
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
      void fetchZbRailDepartures(trainLegs).then((data) => {
        if (active && data.size > 0) setRailData(data);
      });
      void fetchNationalRailUpdates(watchLegs).then((data) => {
        if (active && data.size > 0) setNationalUpdates(data);
      });
      void fetchNationalRailLive(watchLegs).then((data) => {
        if (active && data.delays.size > 0) setNational(data);
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
        if (
          leg.railAgency === (update?.agency ?? rail?.agency ?? leg.railAgency) &&
          leg.railLine === (rail?.line ?? leg.railLine) &&
          leg.railColor === (rail?.color ?? leg.railColor) &&
          leg.trainNumber === (update?.numbers?.[0] ?? rail?.trainNumber ?? leg.trainNumber) &&
          leg.trainName === (rail?.trainName ?? leg.trainName) &&
          leg.platformCode === platformCode &&
          leg.trackCode === trackCode
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
        if (
          update &&
          update.hasRealtimeDelay !== false &&
          now - update.fetchedAt <= 12 * 3600 * 1000
        ) {
          delays.set(leg.tripId, update.delaySec);
        }
      }
    }
    return applyLiveDelays(enriched, delays);
  }, [enriched, railData, national, nationalUpdates, tripDelays]);
}
