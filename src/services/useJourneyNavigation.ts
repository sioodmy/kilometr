import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { useFocusEffect } from 'expo-router';
import type { Connection, LegStop } from '../types/models';
import { RoutingService } from './index';
import { liveTracker } from './liveTracker';
import { useCurrentLocation } from './currentLocation';
import { toAbsoluteMs } from './notifications/format';
import {
  navigationTarget,
  navigationTimeline,
  rideNavigation,
  type NavigationTarget,
} from './navigationTarget';

export function useJourneyNavigation(connection: Connection) {
  const { location, state: locationState } = useCurrentLocation();
  const [clockNow, setNow] = useState(Date.now);
  const now = Math.max(clockNow, Date.now());
  const departureAt = useMemo(
    () =>
      toAbsoluteMs(connection.departureSec) - (navigationTimeline(connection, 0)[0]?.departMs ?? 0),
    [connection.id, connection.departureSec],
  );
  const [tripStops, setTripStops] = useState<{
    connectionId: string;
    stops: Map<string, LegStop[]>;
  } | null>(null);
  const previous = useRef<{ connectionId: string; target: NavigationTarget | null } | null>(null);

  useFocusEffect(
    useCallback(() => {
      const refresh = () => setNow(Date.now());
      refresh();
      void liveTracker.ensureFresh();
      const timer = setInterval(() => {
        if (AppState.currentState === 'active') refresh();
      }, 5000);
      const sub = AppState.addEventListener('change', (state) => {
        if (state === 'active') refresh();
      });
      return () => {
        clearInterval(timer);
        sub.remove();
      };
    }, []),
  );

  useEffect(() => {
    let cancelled = false;
    const stops = new Map<string, LegStop[]>();
    for (const leg of connection.legs) {
      if (!leg.tripId || leg.mode === 'walk') continue;
      void RoutingService.getTripStops(leg.tripId)
        .then((rows) => {
          if (cancelled || rows.length < 2) return;
          stops.set(leg.id, rows);
          setTripStops({ connectionId: connection.id, stops: new Map(stops) });
        })
        .catch(() => undefined);
    }
    return () => {
      cancelled = true;
    };
  }, [connection.id, connection.legs]);

  const enriched = useMemo(
    () => ({
      ...connection,
      legs: connection.legs.map((leg) => {
        const stops =
          tripStops?.connectionId === connection.id ? tripStops.stops.get(leg.id) : null;
        return stops ? { ...leg, intermediateStops: stops } : leg;
      }),
    }),
    [connection, tripStops],
  );
  const vehicles = liveTracker.snapshot();
  const target = navigationTarget(enriched, departureAt, now, {
    location,
    vehicles,
    previous: previous.current?.connectionId === connection.id ? previous.current.target : null,
  });
  useEffect(() => {
    previous.current = { connectionId: connection.id, target };
  }, [connection.id, target]);
  const ride = target?.phase === 'riding' ? rideNavigation(target, now, vehicles) : null;
  return { target, ride, now, location, locationState };
}
