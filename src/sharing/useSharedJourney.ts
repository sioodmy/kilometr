import { useCallback, useEffect, useMemo, useState } from 'react';
import { AppState } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { decodeSharedConnection } from './connection';
import { sharedLiveConnection, sharedToConnection, sharedVehicle } from './native';
import { sharedJourneySeconds } from './progress';
import { useActiveCity } from '../services/cityStore';
import { gtfsStore } from '../services/routing/store';
import { RoutingService } from '../services/api';
import { liveTracker } from '../services/liveTracker';
import { fetchBackendSharedLive, type SharedLiveLegOutput } from '../services/kilometrApi';
import type { LegStop } from '../types/models';
import { getSharedJourneyData } from '../services/sharedJourneyData';
import type { SharedConnection } from './connection';

export function useSharedJourney(encoded: string) {
  const journey = useMemo(() => decodeSharedConnection(encoded), [encoded]);
  const { cityId } = useActiveCity();
  const sameCity = journey?.city === cityId;
  const [loaded, setLoaded] = useState<{
    encoded: string;
    stops: LegStop[][];
    journey: SharedConnection;
  } | null>(null);
  const [backendLive, setBackendLive] = useState<Map<string, SharedLiveLegOutput> | null>(null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const [retry, setRetry] = useState(0);
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    if (!journey || !sameCity) return;
    let cancelled = false;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20000);
    setLoading(true);
    setFailed(false);
    void (async () => {
      try {
        await gtfsStore.load();
        let stops = await Promise.all(
          journey.legs.map((leg) =>
            leg.trip ? RoutingService.getTripStops(leg.trip) : Promise.resolve([]),
          ),
        );
        let enriched = journey;
        try {
          const details = await getSharedJourneyData(journey, controller.signal);
          enriched = details.journey;
          stops = stops.map((local, i) => (local.length >= 2 ? local : details.stops[i]));
        } catch {
          /* Lokalny rozkład zostaje dostępny offline. */
        }
        if (!cancelled) {
          setLoaded({ encoded, stops, journey: enriched });
          setFailed(journey.legs.some((leg, i) => leg.mode !== 'walk' && stops[i].length < 2));
        }
      } catch {
        if (!cancelled) setFailed(true);
      } finally {
        clearTimeout(timeout);
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
      controller.abort();
      clearTimeout(timeout);
    };
  }, [journey, encoded, sameCity, retry]);

  useFocusEffect(
    useCallback(() => {
      if (!journey) return;
      if (sameCity) {
        // Współdzielona podróż pokazuje pojazd na żywo, więc trzyma poll,
        // dopóki ekran jest widoczny.
        liveTracker.acquire();
      }
      let active = true;
      let lastBackendAt = 0;
      const pollBackend = () => {
        const clock = new Date();
        const elapsed = sharedJourneySeconds(journey.date, clock);
        if (elapsed < journey.departure * 60 - 2700 || elapsed > journey.arrival * 60 + 3600) {
          return;
        }
        if (Date.now() - lastBackendAt < 18000) return;
        lastBackendAt = Date.now();
        const legs = journey.legs
          .map((leg, idx) => ({ leg, idx }))
          .filter(({ leg }) => leg.mode !== 'walk')
          .map(({ leg, idx }) => ({
            id: String(idx),
            mode: leg.mode,
            line: leg.line,
            tripId: leg.trip,
            trainNumber: leg.mode === 'train' ? leg.line : undefined,
            direction: leg.direction,
            fromStop: leg.from,
            toStop: leg.to,
            fromLat: leg.fromLat,
            fromLon: leg.fromLon,
            toLat: leg.toLat,
            toLon: leg.toLon,
            scheduledDepartureSec: (leg.scheduledDeparture ?? leg.departure) * 60,
            scheduledArrivalSec: (leg.scheduledArrival ?? leg.arrival) * 60,
          }));
        void fetchBackendSharedLive(journey.city, legs)
          .then((res) => {
            if (active && res) setBackendLive(res);
          })
          .catch(() => {});
      };
      const update = () => {
        if (AppState.currentState !== 'active') return;
        const clock = new Date();
        setNow(clock);
        const elapsed = sharedJourneySeconds(journey.date, clock);
        if (sameCity && elapsed >= journey.departure * 60 - 1800 && elapsed <= journey.arrival * 60 + 1800)
          void liveTracker.ensureFresh().catch(() => {});
        pollBackend();
      };
      update();
      const timer = setInterval(update, 5000);
      const sub = AppState.addEventListener('change', update);
      return () => {
        active = false;
        clearInterval(timer);
        sub.remove();
        if (sameCity) liveTracker.release();
      };
    }, [journey, sameCity]),
  );

  const base = useMemo(
    () =>
      journey
        ? sharedToConnection(
            loaded?.encoded === encoded ? loaded.journey : journey,
            encoded,
            loaded?.encoded === encoded && sameCity ? loaded.stops : [],
          )
        : null,
    [journey, encoded, loaded, sameCity],
  );
  const connection = useMemo(() => {
    if (!base || !journey) return null;
    const delays = new Map<string, number>();
    if (sameCity && liveTracker.getLiveState() === 'fresh') {
      for (const [k, v] of liveTracker.getTripDelays()) delays.set(k, v);
    }
    if (backendLive) {
      journey.legs.forEach((leg, idx) => {
        if (!leg.trip || delays.has(leg.trip)) return;
        const item = backendLive.get(String(idx));
        if (item && (item.status === 'live' || item.status === 'estimated')) {
          delays.set(leg.trip, item.delaySec);
        }
      });
    }
    return sharedLiveConnection(base, journey, delays, now);
  }, [backendLive, base, journey, now, sameCity]);
  const match =
    connection && sameCity ? sharedVehicle(connection, liveTracker.snapshot(), now) : null;
  return {
    base,
    journey,
    connection,
    match,
    sameCity,
    now,
    loading,
    failed,
    retry: () => setRetry((n) => n + 1),
  };
}
