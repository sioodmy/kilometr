import { useEffect, useMemo, useState } from 'react';
import type { Connection } from '../types/models';
import { applyLiveDelays } from './routing/engine';
import { fetchZbRailDepartures, railLegKey, type ZbRailDeparture } from './zbiorkomRail';

const RAIL_LIVE_MAX_AGE_MS = 120_000;

/** Dokłada dane tablicy odjazdów do pociągów, bez zmiany źródła prawdziwości GTFS. */
export function useRailLiveConnections(
  connections: Connection[],
  tripDelays: Map<string, number>,
  enabled: boolean,
): Connection[] {
  const [railData, setRailData] = useState<Map<string, ZbRailDeparture>>(new Map());
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
              leg.fromLat,
              leg.fromLon,
              leg.line,
              leg.direction,
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
    const load = () => {
      const legs = connections.flatMap((connection) => connection.legs);
      void fetchZbRailDepartures(legs).then((data) => {
        if (active && data.size > 0) setRailData(data);
      });
    };
    load();
    const timer = setInterval(load, 30_000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [connections, enabled, signature]);

  // Poza kolejami nie ruszamy obiektów: tick live nie może tworzyć nowej listy.
  const enriched = useMemo(() => {
    if (!enabled || railData.size === 0) return connections;
    let touched = false;
    const next = connections.map((connection) => {
      let legsChanged = false;
      const legs = connection.legs.map((leg) => {
        const rail = railData.get(railLegKey(leg));
        if (!rail) return leg;
        const platformCode = rail.platform ?? leg.platformCode;
        if (
          leg.railAgency === rail.agency &&
          leg.railLine === rail.line &&
          leg.railColor === rail.color &&
          leg.trainNumber === rail.trainNumber &&
          leg.trainName === rail.trainName &&
          leg.platformCode === platformCode
        )
          return leg;
        legsChanged = true;
        return {
          ...leg,
          railAgency: rail.agency,
          railLine: rail.line,
          railColor: rail.color,
          trainNumber: rail.trainNumber,
          trainName: rail.trainName,
          platformCode,
        };
      });
      if (!legsChanged) return connection;
      touched = true;
      return { ...connection, legs };
    });
    return touched ? next : connections;
  }, [connections, enabled, railData]);

  return useMemo(() => {
    if (!enabled || railData.size === 0) return applyLiveDelays(enriched, tripDelays);
    const delays = new Map(tripDelays);
    const now = Date.now();
    for (const connection of enriched) {
      for (const leg of connection.legs) {
        if (!leg.tripId) continue;
        const rail = railData.get(railLegKey(leg));
        if (rail?.live && now - rail.fetchedAt <= RAIL_LIVE_MAX_AGE_MS) {
          delays.set(leg.tripId, rail.delaySec);
        }
      }
    }
    return applyLiveDelays(enriched, delays);
  }, [enabled, enriched, railData, tripDelays]);
}
