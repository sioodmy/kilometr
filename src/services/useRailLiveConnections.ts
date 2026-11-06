import { useEffect, useMemo, useState } from 'react';
import type { Connection } from '../types/models';
import { applyLiveDelays } from './routing/engine';
import { fetchNationalRailLive, type NationalRailLive } from './nationalRailLive';
import { fetchZbRailDepartures, railLegKey, type ZbRailDeparture } from './zbiorkomRail';
import { liveTracker } from './liveTracker';

const RAIL_LIVE_MAX_AGE_MS = 120_000;

/**
 * Dokłada live do nóg kolejowych:
 * - tablica odjazdów zbiorkomu (peron, nazwa handlowa, opóźnienie),
 * - pozycje pociągów ogólnopolskich (opóźnienie + punkt na mapie).
 * Źródłem prawdy czasów zostaje rozkład; live tylko go koryguje.
 */
export function useRailLiveConnections(
  connections: Connection[],
  tripDelays: Map<string, number>,
  enabled: boolean,
): Connection[] {
  const [railData, setRailData] = useState<Map<string, ZbRailDeparture>>(new Map());
  const [national, setNational] = useState<NationalRailLive | null>(null);
  const signature = useMemo(
    () =>
      JSON.stringify(
        connections.flatMap((connection) =>
          connection.legs
            .filter((leg) => leg.mode === 'train')
            .map((leg) => [
              railLegKey(leg),
              leg.fromStopId,
              leg.fromStop,
              leg.toStop,
              leg.fromLat,
              leg.fromLon,
              leg.toLat,
              leg.toLon,
              leg.line,
              leg.direction,
              leg.trainNumber,
              leg.railAgency,
              leg.scheduledDepartureSec ?? leg.departAt,
            ]),
        ),
      ),
    [connections],
  );

  useEffect(() => {
    if (
      !enabled ||
      !connections.some((connection) => connection.legs.some((leg) => leg.mode === 'train'))
    )
      return;
    let active = true;
    // Tracker dostaje nogi ogólnopolskie: pozycje i opóźnienia wchodzą do
    // snapshotu, więc mapa i etykiety działają jak dla KD.
    const nationalLegs = connections.flatMap((connection) =>
      connection.legs.filter((leg) => leg.mode === 'train' && leg.tripId?.startsWith('pl:')),
    );
    liveTracker.setNationalWatch(nationalLegs);
    const load = () => {
      const legs = connections.flatMap((connection) => connection.legs);
      void fetchZbRailDepartures(legs).then((data) => {
        if (active && data.size > 0) setRailData(data);
      });
      if (nationalLegs.length > 0) {
        void fetchNationalRailLive(nationalLegs).then((data) => {
          if (active && data.delays.size > 0) setNational(data);
        });
      }
    };
    load();
    const timer = setInterval(load, 30_000);
    return () => {
      active = false;
      clearInterval(timer);
      liveTracker.setNationalWatch([]);
    };
  }, [connections, enabled, signature]);

  // Poza kolejami nie ruszamy obiektów: tick live nie może tworzyć nowej listy.
  const enriched = useMemo(() => {
    if (!enabled || (railData.size === 0 && !national)) return connections;
    let touched = false;
    const next = connections.map((connection) => {
      let legsChanged = false;
      const legs = connection.legs.map((leg) => {
        const rail = railData.get(railLegKey(leg));
        const pos = leg.tripId ? national?.positions.get(leg.tripId) : undefined;
        if (!rail && !pos) return leg;
        const platformCode = rail?.platform ?? leg.platformCode;
        if (
          leg.railAgency === (rail?.agency ?? leg.railAgency) &&
          leg.railLine === (rail?.line ?? leg.railLine) &&
          leg.railColor === (rail?.color ?? leg.railColor) &&
          leg.trainNumber === (rail?.trainNumber ?? leg.trainNumber) &&
          leg.trainName === (rail?.trainName ?? leg.trainName) &&
          leg.platformCode === platformCode
        )
          return leg;
        legsChanged = true;
        return {
          ...leg,
          railAgency: rail?.agency ?? leg.railAgency,
          railLine: rail?.line ?? leg.railLine,
          railColor: rail?.color ?? leg.railColor,
          trainNumber: rail?.trainNumber ?? leg.trainNumber,
          trainName: rail?.trainName ?? leg.trainName,
          platformCode,
        };
      });
      if (!legsChanged) return connection;
      touched = true;
      return { ...connection, legs };
    });
    return touched ? next : connections;
  }, [connections, enabled, railData, national]);

  return useMemo(() => {
    if (!enabled || (railData.size === 0 && !national)) return applyLiveDelays(enriched, tripDelays);
    const delays = new Map(tripDelays);
    const now = Date.now();
    for (const connection of enriched) {
      for (const leg of connection.legs) {
        if (!leg.tripId) continue;
        const rail = railData.get(railLegKey(leg));
        if (rail?.live && now - rail.fetchedAt <= RAIL_LIVE_MAX_AGE_MS) {
          delays.set(leg.tripId, rail.delaySec);
        }
        const posDelay = national?.delays.get(leg.tripId);
        if (posDelay != null && now - (national?.fetchedAt ?? 0) <= RAIL_LIVE_MAX_AGE_MS) {
          delays.set(leg.tripId, posDelay);
        }
      }
    }
    return applyLiveDelays(enriched, delays);
  }, [enabled, enriched, railData, national, tripDelays]);
}
