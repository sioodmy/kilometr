import { useCallback, useEffect, useRef, useState } from 'react';
import { warsawNow } from '../gtfs/geo';
import type { Connection } from '../types/models';
import {
  applyLegSwapToConnection,
  EXPAND_STEP_SEC,
  extractLegSwapConstraints,
  INITIAL_LOOKAHEAD_SEC,
  INITIAL_LOOKBACK_SEC,
  isSwappableUrbanLeg,
  loadLegAlternatives,
  materializeAlternativeLeg,
  MAX_EXPAND_SPAN_SEC,
  type LegAlternative,
  type LegAlternativesResult,
} from '../services/routing/legAlternatives';
import { getSettingsSync, profileWalkSpeedMps } from '../services/settings';
import { gtfsStore } from '../services/routing/store';

export type SwapDirection = 'earlier' | 'later';

export interface LegSwapSlotState {
  swappable: boolean;
  status: 'idle' | 'loading' | 'ready' | 'error';
  alternatives: LegAlternative[];
  currentIndex: number;
  earlierAlt: LegAlternative | null;
  laterAlt: LegAlternative | null;
  hasEarlier: boolean;
  hasLater: boolean;
  canLoadMoreEarlier: boolean;
  canLoadMoreLater: boolean;
  loadingDirection: SwapDirection | null;
}

interface InternalSlot extends LegSwapSlotState {
  neighborKey: string;
  lookbackSec: number;
  lookaheadSec: number;
}

interface CacheEntry {
  result: LegAlternativesResult;
  lookbackSec: number;
  lookaheadSec: number;
}

const MAX_CACHE_ENTRIES = 40;
/** Krótki odstęp po zakończeniu animacji wejścia, żeby skanowanie nie blokowało pierwszej interakcji. */
const INITIAL_PREFETCH_DELAY_MS = 40;

function buildNeighborKey(
  connection: Connection,
  legIndex: number,
  anchorFromStopId: string,
  anchorToStopId: string,
): string {
  const c = extractLegSwapConstraints(connection, legIndex);
  return [
    connection.serviceDate ?? '',
    anchorFromStopId,
    anchorToStopId,
    c.prevTransitLeg?.toStopId ?? '',
    c.prevArriveSec ?? 'none',
    c.nextTransitLeg?.fromStopId ?? '',
    c.nextDepartSec ?? 'none',
  ].join('|');
}

function findCurrentIndex(alternatives: LegAlternative[], tripId?: string, departSec?: number): number {
  if (alternatives.length === 0) return 0;
  if (tripId) {
    const byTrip = alternatives.findIndex((a) => a.tripId === tripId);
    if (byTrip >= 0) return byTrip;
  }
  const byFlag = alternatives.findIndex((a) => a.isCurrent);
  if (byFlag >= 0) return byFlag;
  if (departSec !== undefined) {
    let best = 0;
    let bestDiff = Infinity;
    for (let i = 0; i < alternatives.length; i++) {
      const diff = Math.abs(alternatives[i].effectiveDepartureSec - departSec);
      if (diff < bestDiff) {
        bestDiff = diff;
        best = i;
      }
    }
    return best;
  }
  return 0;
}

function slotFromResult(
  result: LegAlternativesResult,
  neighborKey: string,
  lookbackSec: number,
  lookaheadSec: number,
  activeTripId?: string,
  activeDepartSec?: number,
): InternalSlot {
  const idx = findCurrentIndex(result.alternatives, activeTripId, activeDepartSec);
  const alts = result.alternatives.map((a, i) =>
    a.isCurrent === (i === idx) ? a : { ...a, isCurrent: i === idx },
  );
  return {
    swappable: true,
    status: 'ready',
    alternatives: alts,
    currentIndex: idx,
    earlierAlt: idx > 0 ? alts[idx - 1] : null,
    laterAlt: idx + 1 < alts.length ? alts[idx + 1] : null,
    hasEarlier: idx > 0,
    hasLater: idx + 1 < alts.length,
    canLoadMoreEarlier: result.canExpandEarlier,
    canLoadMoreLater: result.canExpandLater,
    loadingDirection: null,
    neighborKey,
    lookbackSec,
    lookaheadSec,
  };
}

function yieldFrame(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

export interface UseLegAlternativesParams {
  connection: Connection | null;
  routeKey: string;
  tripDelays: ReadonlyMap<string, number>;
  onApplySwap: (nextConnection: Connection) => void;
  ready?: boolean;
}

export interface UseLegAlternativesReturn {
  swapStates: ReadonlyMap<string, LegSwapSlotState>;
  swapLeg: (legId: string, direction: SwapDirection) => void;
  retryLeg: (legId: string) => void;
}

/**
 * Leniwie wyznacza i cache'uje alternatywne miejskie kursy dla każdej wymienialnej nogi
 * połączenia. Skanowanie rusza po animacji otwarcia ekranu, bez blokowania UI.
 */
export function useLegAlternatives({
  connection,
  routeKey,
  tripDelays,
  onApplySwap,
  ready = true,
}: UseLegAlternativesParams): UseLegAlternativesReturn {
  const [slots, setSlots] = useState<Map<string, InternalSlot>>(() => new Map());

  const connectionRef = useRef<Connection | null>(connection);
  connectionRef.current = connection;
  const delaysRef = useRef<ReadonlyMap<string, number>>(tripDelays);
  delaysRef.current = tripDelays;
  const onApplySwapRef = useRef(onApplySwap);
  onApplySwapRef.current = onApplySwap;
  const slotsRef = useRef<Map<string, InternalSlot>>(slots);
  slotsRef.current = slots;

  // Kotwice pierwotnych przystanków na slot (zapobiegają dryfowi przy kolejnych przesunięciach).
  const anchorsRef = useRef<Map<string, { fromStopId: string; toStopId: string }>>(new Map());
  const cacheRef = useRef<Map<string, CacheEntry>>(new Map());
  const inFlightRef = useRef<Set<string>>(new Set());
  const generationRef = useRef(0);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      generationRef.current += 1;
    };
  }, []);

  // Resetuj kotwice i stan po przejściu na zupełnie inne połączenie (parametr URL `id`).
  useEffect(() => {
    generationRef.current += 1;
    anchorsRef.current.clear();
    inFlightRef.current.clear();
    setSlots(new Map());
  }, [routeKey]);

  const getAnchor = useCallback((conn: Connection, legIndex: number) => {
    const leg = conn.legs[legIndex];
    const existing = anchorsRef.current.get(leg.id);
    if (existing) return existing;
    const anchor = {
      fromStopId: leg.fromStopId ?? '',
      toStopId: leg.toStopId ?? '',
    };
    anchorsRef.current.set(leg.id, anchor);
    return anchor;
  }, []);

  const putCache = useCallback((key: string, entry: CacheEntry) => {
    const map = cacheRef.current;
    if (map.has(key)) map.delete(key);
    map.set(key, entry);
    if (map.size > MAX_CACHE_ENTRIES) {
      const oldest = map.keys().next().value;
      if (oldest !== undefined) map.delete(oldest);
    }
  }, []);

  const loadSlot = useCallback(
    async (
      legId: string,
      opts?: {
        lookbackSec?: number;
        lookaheadSec?: number;
        loadingDirection?: SwapDirection | null;
        autoSwapDirection?: SwapDirection;
        forceRefresh?: boolean;
      },
    ): Promise<InternalSlot | null> => {
      const conn = connectionRef.current;
      if (!conn) return null;
      const legIndex = conn.legs.findIndex((l) => l.id === legId);
      if (legIndex < 0 || !isSwappableUrbanLeg(conn, legIndex)) return null;

      const anchor = getAnchor(conn, legIndex);
      if (!anchor.fromStopId || !anchor.toStopId) return null;

      const neighborKey = buildNeighborKey(conn, legIndex, anchor.fromStopId, anchor.toStopId);
      const prevSlot = slotsRef.current.get(legId);
      const lookbackSec = opts?.lookbackSec ?? prevSlot?.lookbackSec ?? INITIAL_LOOKBACK_SEC;
      const lookaheadSec = opts?.lookaheadSec ?? prevSlot?.lookaheadSec ?? INITIAL_LOOKAHEAD_SEC;
      const cacheKey = `${neighborKey}|${lookbackSec}|${lookaheadSec}`;
      const leg = conn.legs[legIndex];

      if (!opts?.forceRefresh) {
        const cached = cacheRef.current.get(cacheKey);
        if (cached) {
          const nextSlot = slotFromResult(
            cached.result,
            neighborKey,
            lookbackSec,
            lookaheadSec,
            leg.tripId,
            leg.scheduledDepartureSec,
          );
          if (mountedRef.current) {
            setSlots((prev) => {
              const next = new Map(prev);
              next.set(legId, nextSlot);
              return next;
            });
          }
          return nextSlot;
        }
      }

      const flightKey = `${legId}:${cacheKey}`;
      if (inFlightRef.current.has(flightKey)) return null;
      inFlightRef.current.add(flightKey);
      const gen = generationRef.current;

      // Cichy prefetch w tle nie wymaga pośredniego re-renderu ze stanem loading;
      // stan ładowania pokazujemy tylko przy jawnej akcji użytkownika (przycisk / retry).
      if (mountedRef.current && (opts?.loadingDirection != null || opts?.forceRefresh)) {
        setSlots((prev) => {
          const next = new Map(prev);
          const cur = prev.get(legId);
          next.set(legId, {
            swappable: true,
            status: cur?.status === 'ready' ? 'ready' : 'loading',
            alternatives: cur?.alternatives ?? [],
            currentIndex: cur?.currentIndex ?? 0,
            earlierAlt: cur?.earlierAlt ?? null,
            laterAlt: cur?.laterAlt ?? null,
            hasEarlier: cur?.hasEarlier ?? false,
            hasLater: cur?.hasLater ?? false,
            canLoadMoreEarlier: cur?.canLoadMoreEarlier ?? false,
            canLoadMoreLater: cur?.canLoadMoreLater ?? false,
            loadingDirection: opts?.loadingDirection ?? null,
            neighborKey,
            lookbackSec,
            lookaheadSec,
          });
          return next;
        });
      }

      try {
        const result = await loadLegAlternatives(conn, legIndex, {
          anchorFromStopId: anchor.fromStopId,
          anchorToStopId: anchor.toStopId,
          lookbackSec,
          lookaheadSec,
          tripDelays: delaysRef.current,
        });

        if (!mountedRef.current || gen !== generationRef.current) return null;

        if (!result) {
          // Przystanki nogi nie należą do aktywnego miasta: nie oferuj wymiany.
          setSlots((prev) => {
            if (!prev.has(legId)) return prev;
            const next = new Map(prev);
            next.delete(legId);
            return next;
          });
          return null;
        }

        putCache(cacheKey, { result, lookbackSec, lookaheadSec });

        const latestConn = connectionRef.current ?? conn;
        const latestIdx = latestConn.legs.findIndex((l) => l.id === legId);
        const latestLeg = latestIdx >= 0 ? latestConn.legs[latestIdx] : leg;
        const nextSlot = slotFromResult(
          result,
          neighborKey,
          lookbackSec,
          lookaheadSec,
          latestLeg.tripId,
          latestLeg.scheduledDepartureSec,
        );

        setSlots((prev) => {
          const next = new Map(prev);
          next.set(legId, nextSlot);
          return next;
        });

        // Jeśli użytkownik przesunął na krawędzi i dociągnęliśmy nowe opcje, od razu podmień nogę.
        if (opts?.autoSwapDirection && latestIdx >= 0) {
          const targetIdx =
            opts.autoSwapDirection === 'earlier'
              ? nextSlot.currentIndex - 1
              : nextSlot.currentIndex + 1;
          if (targetIdx >= 0 && targetIdx < nextSlot.alternatives.length) {
            const alt = nextSlot.alternatives[targetIdx];
            const settings = getSettingsSync();
            const materialized = materializeAlternativeLeg(alt, latestLeg, gtfsStore, warsawNow().sec);
            const updatedConn = applyLegSwapToConnection(latestConn, latestIdx, materialized, {
              boardWalkM: alt.boardWalkM,
              boardWalkSec: alt.boardWalkSec,
              alightWalkM: alt.alightWalkM,
              alightWalkSec: alt.alightWalkSec,
              walkSpeedMps: profileWalkSpeedMps(settings.walkPace),
              nowSec: warsawNow().sec,
            });
            onApplySwapRef.current(updatedConn);
          }
        }

        return nextSlot;
      } catch {
        if (!mountedRef.current || gen !== generationRef.current) return null;
        setSlots((prev) => {
          const next = new Map(prev);
          const cur = prev.get(legId);
          next.set(legId, {
            swappable: true,
            status: 'error',
            alternatives: cur?.alternatives ?? [],
            currentIndex: cur?.currentIndex ?? 0,
            earlierAlt: cur?.earlierAlt ?? null,
            laterAlt: cur?.laterAlt ?? null,
            hasEarlier: cur?.hasEarlier ?? false,
            hasLater: cur?.hasLater ?? false,
            canLoadMoreEarlier: cur?.canLoadMoreEarlier ?? false,
            canLoadMoreLater: cur?.canLoadMoreLater ?? false,
            loadingDirection: null,
            neighborKey,
            lookbackSec,
            lookaheadSec,
          });
          return next;
        });
        return null;
      } finally {
        inFlightRef.current.delete(flightKey);
      }
    },
    [getAnchor, putCache],
  );

  // Leniwie przeskanuj wymienialne nogi miejskie po zakończeniu animacji ekranu
  // oraz po każdej podmianie nogi (tylko te nogi, którym zmieniły się ograniczenia sąsiadów).
  useEffect(() => {
    if (!connection || !ready) return;

    const swappableLegs: Array<{ legId: string; legIndex: number; neighborKey: string }> = [];
    for (let i = 0; i < connection.legs.length; i++) {
      if (!isSwappableUrbanLeg(connection, i)) continue;
      const leg = connection.legs[i];
      const anchor = getAnchor(connection, i);
      if (!anchor.fromStopId || !anchor.toStopId) continue;
      const neighborKey = buildNeighborKey(connection, i, anchor.fromStopId, anchor.toStopId);
      swappableLegs.push({ legId: leg.id, legIndex: i, neighborKey });
    }

    if (swappableLegs.length === 0) return;

    // Natychmiastowo zaktualizuj currentIndex dla nóg, których lista sąsiadów nie uległa zmianie.
    setSlots((prev) => {
      let changed = false;
      const next = new Map(prev);
      for (const item of swappableLegs) {
        const existing = next.get(item.legId);
        const leg = connection.legs[item.legIndex];
        if (existing && existing.status === 'ready' && existing.neighborKey === item.neighborKey) {
          const newIdx = findCurrentIndex(
            existing.alternatives,
            leg.tripId,
            leg.scheduledDepartureSec,
          );
          if (newIdx !== existing.currentIndex) {
            const alts = existing.alternatives.map((a, i) =>
              a.isCurrent === (i === newIdx) ? a : { ...a, isCurrent: i === newIdx },
            );
            next.set(item.legId, {
              ...existing,
              alternatives: alts,
              currentIndex: newIdx,
              earlierAlt: newIdx > 0 ? alts[newIdx - 1] : null,
              laterAlt: newIdx + 1 < alts.length ? alts[newIdx + 1] : null,
              hasEarlier: newIdx > 0,
              hasLater: newIdx + 1 < alts.length,
            });
            changed = true;
          }
        }
      }
      return changed ? next : prev;
    });

    const toLoad = swappableLegs.filter((item) => {
      const existing = slotsRef.current.get(item.legId);
      return !existing || existing.status === 'idle' || existing.neighborKey !== item.neighborKey;
    });

    if (toLoad.length === 0) return;

    let cancelled = false;
    const timer = setTimeout(() => {
      void (async () => {
        for (const item of toLoad) {
          if (cancelled || !mountedRef.current) return;
          await loadSlot(item.legId, {
            lookbackSec: INITIAL_LOOKBACK_SEC,
            lookaheadSec: INITIAL_LOOKAHEAD_SEC,
          });
          if (toLoad.length > 1) await yieldFrame();
        }
      })();
    }, INITIAL_PREFETCH_DELAY_MS);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [connection, getAnchor, loadSlot, ready]);

  const swapLeg = useCallback(
    (legId: string, direction: SwapDirection) => {
      const conn = connectionRef.current;
      if (!conn) return;
      const legIndex = conn.legs.findIndex((l) => l.id === legId);
      if (legIndex < 0 || !isSwappableUrbanLeg(conn, legIndex)) return;

      const slot = slotsRef.current.get(legId);
      if (!slot || slot.status !== 'ready') {
        void loadSlot(legId, {
          loadingDirection: direction,
          autoSwapDirection: direction,
        });
        return;
      }

      if (slot.loadingDirection !== null) return;

      const targetIndex = direction === 'earlier' ? slot.currentIndex - 1 : slot.currentIndex + 1;
      if (targetIndex >= 0 && targetIndex < slot.alternatives.length) {
        const alt = slot.alternatives[targetIndex];
        const baseLeg = conn.legs[legIndex];

        // Optymistycznie przesuń kursor w slocie i od razu zaktualizuj połączenie.
        const alts = slot.alternatives.map((a, i) =>
          a.isCurrent === (i === targetIndex) ? a : { ...a, isCurrent: i === targetIndex },
        );
        const updatedSlot: InternalSlot = {
          ...slot,
          alternatives: alts,
          currentIndex: targetIndex,
          earlierAlt: targetIndex > 0 ? alts[targetIndex - 1] : null,
          laterAlt: targetIndex + 1 < alts.length ? alts[targetIndex + 1] : null,
          hasEarlier: targetIndex > 0,
          hasLater: targetIndex + 1 < alts.length,
        };
        setSlots((prev) => {
          const next = new Map(prev);
          next.set(legId, updatedSlot);
          return next;
        });

        const nowSec = warsawNow().sec;
        const materialized = materializeAlternativeLeg(alt, baseLeg, gtfsStore, nowSec);

        const settings = getSettingsSync();
        const nextConnection = applyLegSwapToConnection(conn, legIndex, materialized, {
          boardWalkM: alt.boardWalkM,
          boardWalkSec: alt.boardWalkSec,
          alightWalkM: alt.alightWalkM,
          alightWalkSec: alt.alightWalkSec,
          walkSpeedMps: profileWalkSpeedMps(settings.walkPace),
          nowSec,
        });
        onApplySwapRef.current(nextConnection);

        // Cichy prefetch szerszego okna w tle po dojściu do krawędzi listy.
        if (direction === 'earlier' && targetIndex === 0 && slot.canLoadMoreEarlier) {
          void loadSlot(legId, {
            lookbackSec: Math.min(MAX_EXPAND_SPAN_SEC, slot.lookbackSec + EXPAND_STEP_SEC),
            lookaheadSec: slot.lookaheadSec,
          });
        } else if (
          direction === 'later' &&
          targetIndex === slot.alternatives.length - 1 &&
          slot.canLoadMoreLater
        ) {
          void loadSlot(legId, {
            lookbackSec: slot.lookbackSec,
            lookaheadSec: Math.min(MAX_EXPAND_SPAN_SEC, slot.lookaheadSec + EXPAND_STEP_SEC),
          });
        }
        return;
      }

      // Krawędź listy: spróbuj leniwie rozszerzyć okno wyszukiwania w żądanym kierunku.
      if (direction === 'earlier' && slot.canLoadMoreEarlier) {
        void loadSlot(legId, {
          lookbackSec: Math.min(MAX_EXPAND_SPAN_SEC, slot.lookbackSec + EXPAND_STEP_SEC),
          lookaheadSec: slot.lookaheadSec,
          loadingDirection: 'earlier',
          autoSwapDirection: 'earlier',
        });
      } else if (direction === 'later' && slot.canLoadMoreLater) {
        void loadSlot(legId, {
          lookbackSec: slot.lookbackSec,
          lookaheadSec: Math.min(MAX_EXPAND_SPAN_SEC, slot.lookaheadSec + EXPAND_STEP_SEC),
          loadingDirection: 'later',
          autoSwapDirection: 'later',
        });
      }
    },
    [loadSlot],
  );

  const retryLeg = useCallback(
    (legId: string) => {
      void loadSlot(legId, { forceRefresh: true });
    },
    [loadSlot],
  );

  return {
    swapStates: slots,
    swapLeg,
    retryLeg,
  };
}
