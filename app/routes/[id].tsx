import { Suspense, lazy, startTransition, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  AppState,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type LayoutChangeEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import Animated, { FadeIn, useReducedMotion } from 'react-native-reanimated';
import * as Location from 'expo-location';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  AlarmClock,
  ChevronLeft,
  ChevronRight,
  CloudOff,
  Pin,
  RouteOff,
  Share2,
} from '../../src/components/icons';
import { elev, scheme, shape, type } from '../../src/theme/tokens';
import { useWebLayout } from '../../src/theme/layout';
import { MorphingLoader } from '../../src/components/MorphingLoader';
import { defaultLocationForCity } from '../../src/config';
import { getActiveCityIdSync } from '../../src/services/cityStore';
import { useStrings } from '../../src/i18n';
import { RoutingService, subscribeSavedRoutes } from '../../src/services';
import * as Haptics from 'expo-haptics';
import {
  getPlannedConnection,
  isRouteSavedSync,
  rememberPlannedConnection,
} from '../../src/services/api';
import { useLegAlternatives } from '../../src/hooks/useLegAlternatives';
import { useScreenTransitionSettled } from '../../src/hooks/useScreenTransitionSettled';
import {
  normalizeConnectionId,
  stableConnectionId,
} from '../../src/services/routing/connectionIdentity';
import {
  boardingTripKey,
  getConnectionGroup,
  refreshConnectionGroupOptions,
} from '../../src/services/routing/connectionGroups';
import { useRailLiveConnectionsWithStatus } from '../../src/services/useRailLiveConnections';
import { liveTracker } from '../../src/services/liveTracker';
import { beginUiScroll, endUiScroll } from '../../src/services/routing/yieldFrame';
import type { Connection } from '../../src/types/models';
import { ConnectionLineAlerts } from '../../src/components/ConnectionLineAlerts';
import { LegTimeline } from '../../src/components/LegTimeline';
import { ConnectionSummary } from '../../src/components/ConnectionSummary';
import { ConnectionVariantSwitcher } from '../../src/components/ConnectionVariantSwitcher';
import {
  useRouteCardTransition,
  type CardTransitionSource,
} from '../../src/components/RouteCardTransition';
import {
  RouteDetailsMorphShell,
  type MorphShellRenderProps,
} from '../../src/components/RouteDetailsMorphShell';
import type { TransitionRect } from '../../src/components/routeCardTransitionMath';
import { SpringPressable } from '../../src/components/SpringPressable';
import { RouteReliabilityCard } from '../../src/components/RouteReliabilityCard';
import { MapCardSkeleton, RouteDetailsSkeleton } from '../../src/components/RouteDetailsSkeleton';
import { RouteTravelDeck } from '../../src/components/RouteTravelDeck';
import { SheetLoadingFallback } from '../../src/components/SkeletonPulse';
import { useTransferProtection } from '../../src/components/TransferProtectionProvider';
import { hasTransfer } from '../../src/services/notifications/transferTypes';

const ShareConnectionSheet = lazy(() =>
  import('../../src/components/ShareConnectionSheet').then((m) => ({
    default: m.ShareConnectionSheet,
  })),
);
const RouteMapCard = lazy(() =>
  import('../../src/components/RouteMapCard').then((m) => ({ default: m.RouteMapCard })),
);
const DepartureAlarmSheet = lazy(() =>
  import('../../src/components/DepartureAlarmSheet').then((m) => ({
    default: m.DepartureAlarmSheet,
  })),
);
import { getDepartureAlarmSync, useDepartureAlarm } from '../../src/services/departureAlarm';
import { useTransferThresholds, useWalkSpeedMps } from '../../src/services/settings';
import {
  areNotificationsSupported,
  ensureNotificationPermission,
  getTrackedTripSync,
  permissionDeniedMessage,
  setTransferProtectionEnabled,
  startTracking,
  stopTracking,
  updateTrackedConnection,
  useTrackedTrip,
  isTransferProtectionSupported,
} from '../../src/services/notifications';

export default function RouteDetailsScreen() {
  const s = useStrings();
  const router = useRouter();
  // Inset z kontekstu od razu, nie z natywnego SafeAreaView: przy ciężkim
  // pierwszym renderze natywny padding wpada po kolejnym commicie i nagłówek
  // chwilowo ląduje pod paskiem stanu.
  const insets = useSafeAreaInsets();
  const webLayout = useWebLayout();
  const reduceMotion = useReducedMotion();
  const cardTransition = useRouteCardTransition();
  const openTransferProtection = useTransferProtection();
  const goBack = useCallback(
    () => (router.canGoBack() ? router.back() : router.replace('/routes')),
    [router],
  );
  const {
    id: routeId,
    action: routeAction,
    morph: routeMorph,
  } = useLocalSearchParams<{
    id: string;
    action?: string;
    morph?: string;
  }>();
  const id = normalizeConnectionId(routeId ?? '');
  const openTicket = routeAction === 'ticket';
  const [morphSource] = useState<CardTransitionSource | null>(() => {
    if (routeMorph !== '1' || !cardTransition || !id) return null;
    return cardTransition.consumeTransition(id);
  });
  const activeMorphSource =
    morphSource && morphSource.normalizedId === id && !reduceMotion && !webLayout.isMedium
      ? morphSource
      : null;
  const [morphSettled, setMorphSettled] = useState(() => !activeMorphSource);
  const scrollYRef = useRef(0);
  const screenLayoutRef = useRef<{ x: number; y: number } | null>(null);
  const scrollLayoutRef = useRef<{ x: number; y: number } | null>(null);
  const stripInScrollRef = useRef<TransitionRect | null>(null);
  const targetStripCbRef = useRef<((rect: TransitionRect) => void) | null>(null);

  const emitTargetStripRect = useCallback(() => {
    const cb = targetStripCbRef.current;
    const screenL = screenLayoutRef.current;
    const scrollL = scrollLayoutRef.current;
    const stripL = stripInScrollRef.current;
    if (!cb || !screenL || !scrollL || !stripL) return;
    cb({
      x: screenL.x + scrollL.x + stripL.x,
      y: screenL.y + scrollL.y + stripL.y,
      width: stripL.width,
      height: stripL.height,
    });
  }, []);

  const handleScreenLayout = useCallback(
    (event: LayoutChangeEvent) => {
      const { x, y } = event.nativeEvent.layout;
      screenLayoutRef.current = { x, y };
      emitTargetStripRect();
    },
    [emitTargetStripRect],
  );

  const handleScrollViewLayout = useCallback(
    (event: LayoutChangeEvent) => {
      const { x, y } = event.nativeEvent.layout;
      scrollLayoutRef.current = { x, y };
      emitTargetStripRect();
    },
    [emitTargetStripRect],
  );

  const handleSummaryStripLayout = useCallback(
    (rect: TransitionRect) => {
      stripInScrollRef.current = rect;
      emitTargetStripRect();
    },
    [emitTargetStripRect],
  );

  const handleScroll = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    scrollYRef.current = event.nativeEvent.contentOffset.y;
  }, []);
  const handleMorphSettled = useCallback(() => {
    setMorphSettled(true);
  }, []);

  const { trip: trackedTrip } = useTrackedTrip();
  const cachedItem = getTrackedTripSync()?.connection;
  const alarmItem = getDepartureAlarmSync()?.connection;

  const [selectedVariantId, setSelectedVariantId] = useState<string>(id);
  const [swappedBase, setSwappedBase] = useState<Connection | null>(null);
  const pendingTrackedSyncRef = useRef<string | null>(null);
  const prevTrackedConnIdRef = useRef<string | null>(null);
  const hadProtectionBeforeDirectRef = useRef(false);

  useEffect(() => {
    setSelectedVariantId(id);
    setSwappedBase(null);
    pendingTrackedSyncRef.current = null;
    prevTrackedConnIdRef.current = null;
    hadProtectionBeforeDirectRef.current = false;
  }, [id]);
  const matchTrackId = normalizeConnectionId(swappedBase?.id ?? selectedVariantId);

  const isTrackedThis = useMemo(() => {
    if (!trackedTrip) return false;
    const targets = new Set([id, matchTrackId, normalizeConnectionId(selectedVariantId)].filter(Boolean));
    const trackedId = trackedTrip.id ? normalizeConnectionId(trackedTrip.id) : '';
    const trackedConnId = trackedTrip.connection.id
      ? normalizeConnectionId(trackedTrip.connection.id)
      : '';
    if (targets.has(trackedId) || targets.has(trackedConnId)) return true;
    if (
      trackedTrip.groupAlternatives?.some((alt) => targets.has(normalizeConnectionId(alt.id)))
    ) {
      return true;
    }
    try {
      if (targets.has(normalizeConnectionId(stableConnectionId(trackedTrip.connection))))
        return true;
    } catch {
      // ignore
    }
    return false;
  }, [trackedTrip, id, matchTrackId, selectedVariantId]);

  const matchesRouteId = useCallback(
    (candidateId?: string | null) => {
      if (!candidateId) return false;
      return candidateId === id || normalizeConnectionId(candidateId) === id;
    },
    [id],
  );

  const immediateItem =
    matchesRouteId(cachedItem?.id)
      ? cachedItem
      : matchesRouteId(alarmItem?.id)
        ? alarmItem
        : (getPlannedConnection(String(id)) ?? activeMorphSource?.connection);
  const [loadedItem, setItem] = useState<Connection | null>(() => immediateItem ?? null);
  const [offline, setOffline] = useState(false);
  const [liveStale, setLiveStale] = useState(
    () => liveTracker.supportsLive() && liveTracker.getLiveState() !== 'fresh',
  );

  const baseGroupConnections = useMemo(() => {
    const cachedGroup = getConnectionGroup(id);
    if (cachedGroup && cachedGroup.options.length > 1) {
      const list = cachedGroup.options.map((opt) => opt.connection);
      if (loadedItem) {
        const key = boardingTripKey(loadedItem);
        const normLoaded = normalizeConnectionId(loadedItem.id);
        if (
          key &&
          boardingTripKey(list[0]) === key &&
          !list.some((c) => normalizeConnectionId(c.id) === normLoaded)
        ) {
          return [loadedItem, ...list];
        }
      }
      return list;
    }
    if (isTrackedThis && trackedTrip?.groupAlternatives && trackedTrip.groupAlternatives.length > 0) {
      const pool = [trackedTrip.connection, ...trackedTrip.groupAlternatives];
      const seen = new Set<string>();
      return pool.filter((c) => {
        const norm = normalizeConnectionId(c.id);
        if (seen.has(norm)) return false;
        seen.add(norm);
        return true;
      });
    }
    return loadedItem ? [loadedItem] : immediateItem ? [immediateItem] : [];
  }, [id, immediateItem, isTrackedThis, loadedItem, trackedTrip]);

  const activeRawItem = useMemo(() => {
    if (swappedBase) return swappedBase;
    const selectedNorm = normalizeConnectionId(selectedVariantId);
    if (
      isTrackedThis &&
      trackedTrip &&
      normalizeConnectionId(trackedTrip.connection.id) === selectedNorm
    ) {
      return trackedTrip.connection;
    }
    const inGroup = baseGroupConnections.find(
      (c) => normalizeConnectionId(c.id) === selectedNorm,
    );
    if (inGroup) return inGroup;
    if (matchesRouteId(loadedItem?.id)) return loadedItem;
    return immediateItem ?? null;
  }, [
    baseGroupConnections,
    immediateItem,
    isTrackedThis,
    loadedItem,
    matchesRouteId,
    selectedVariantId,
    swappedBase,
    trackedTrip,
  ]);

  const navTransitionSettled = useScreenTransitionSettled();
  const transitionSettled = activeMorphSource ? morphSettled : navTransitionSettled;
  const [secondaryReady, setSecondaryReady] = useState(false);
  useEffect(() => {
    if (!transitionSettled) {
      setSecondaryReady(false);
      return;
    }
    let cancelled = false;
    let frame2: number | null = null;
    const frame1 = requestAnimationFrame(() => {
      if (cancelled) return;
      frame2 = requestAnimationFrame(() => {
        if (!cancelled) setSecondaryReady(true);
      });
    });
    return () => {
      cancelled = true;
      cancelAnimationFrame(frame1);
      if (frame2 !== null) cancelAnimationFrame(frame2);
    };
  }, [transitionSettled]);

  // Stan aktywnego scrollowania szczegółów: sygnalizuje yieldFrame i buforuje
  // przeliczanie liveTick do zakończenia gestu użytkownika.
  const scrollActiveRef = useRef(false);
  const pendingLiveOkRef = useRef<number | null>(null);
  const scrollFlushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flushPendingScrollLive = useCallback(() => {
    if (scrollFlushTimerRef.current !== null) {
      clearTimeout(scrollFlushTimerRef.current);
      scrollFlushTimerRef.current = null;
    }
    const nextLive = pendingLiveOkRef.current;
    pendingLiveOkRef.current = null;
    if (nextLive === null) return;
    startTransition(() => {
      setLiveTick(nextLive);
    });
  }, []);

  const markDetailsScrollStart = useCallback(() => {
    if (!scrollActiveRef.current) {
      scrollActiveRef.current = true;
      beginUiScroll();
    }
    if (scrollFlushTimerRef.current !== null) {
      clearTimeout(scrollFlushTimerRef.current);
    }
    scrollFlushTimerRef.current = setTimeout(() => {
      scrollFlushTimerRef.current = null;
      if (scrollActiveRef.current) {
        scrollActiveRef.current = false;
        endUiScroll();
      }
      flushPendingScrollLive();
    }, 650);
  }, [flushPendingScrollLive]);

  const markDetailsScrollEnd = useCallback(() => {
    if (scrollActiveRef.current) {
      scrollActiveRef.current = false;
      endUiScroll();
    }
    flushPendingScrollLive();
  }, [flushPendingScrollLive]);

  useEffect(() => {
    return () => {
      if (scrollFlushTimerRef.current !== null) {
        clearTimeout(scrollFlushTimerRef.current);
        scrollFlushTimerRef.current = null;
      }
      if (scrollActiveRef.current) {
        scrollActiveRef.current = false;
        endUiScroll();
      }
    };
  }, []);

  // Opóźnienia z feedu żyją niezależnie od zamrożonego połączenia.
  // Podczas animacji morphingu i scrollu nie wymuszamy re-renderu ekranu; synchronizujemy po domknięciu.
  const initialLiveOk = liveTracker.getLastOk();
  const [liveTick, setLiveTick] = useState(initialLiveOk);
  const lastLiveOk = useRef(initialLiveOk);
  useEffect(() => {
    if (!transitionSettled) return;
    const check = () => {
      const stale = liveTracker.supportsLive() && liveTracker.getLiveState() !== 'fresh';
      setLiveStale((prev) => (prev === stale ? prev : stale));
      const ok = liveTracker.getLastOk();
      if (ok !== lastLiveOk.current) {
        lastLiveOk.current = ok;
        if (scrollActiveRef.current) {
          pendingLiveOkRef.current = ok;
        } else {
          startTransition(() => {
            setLiveTick(ok);
          });
        }
      }
    };
    check();
    const unsub = liveTracker.subscribe(check);
    const t = setInterval(check, 30000);
    return () => {
      unsub();
      clearInterval(t);
    };
  }, [transitionSettled]);

  // Poll live utrzymujemy od wejścia, ale wymuszone odświeżenie sieciowe
  // startuje dopiero po zakończeniu animacji przejścia (jeśli snapshot ma >10 s).
  useFocusEffect(
    useCallback(() => {
      liveTracker.acquire();
      const sub = AppState.addEventListener('change', (state) => {
        if (state === 'active') {
          void liveTracker.refresh();
        }
      });
      return () => {
        sub.remove();
        liveTracker.release();
      };
    }, []),
  );

  useEffect(() => {
    if (!transitionSettled) return;
    const lastOk = liveTracker.getLastOk();
    if (lastOk === 0 || Date.now() - lastOk > 10_000) {
      void liveTracker.refresh();
    }
  }, [transitionSettled]);

  const rawItems = useMemo(() => {
    if (baseGroupConnections.length <= 1) {
      return activeRawItem ? [activeRawItem] : [];
    }
    const selectedNorm = normalizeConnectionId(selectedVariantId);
    let replaced = false;
    const list = baseGroupConnections.map((c) => {
      if (activeRawItem && normalizeConnectionId(c.id) === selectedNorm) {
        replaced = true;
        return activeRawItem;
      }
      return c;
    });
    if (!replaced && activeRawItem) {
      return [activeRawItem, ...list];
    }
    return list;
  }, [activeRawItem, baseGroupConnections, selectedVariantId]);

  const tripDelays = useMemo(
    () => (offline || liveStale ? new Map<string, number>() : liveTracker.getTripDelays()),
    [offline, liveStale, liveTick],
  );
  const { items: liveItems, loading: railLiveLoading } = useRailLiveConnectionsWithStatus(
    rawItems,
    tripDelays,
    !offline && transitionSettled,
  );
  const item = useMemo(() => {
    if (liveItems.length === 0) return null;
    if (swappedBase) {
      const swappedNorm = normalizeConnectionId(swappedBase.id);
      const hit = liveItems.find((c) => normalizeConnectionId(c.id) === swappedNorm);
      if (hit) return hit;
    }
    const selectedNorm = normalizeConnectionId(selectedVariantId);
    return (
      liveItems.find((c) => normalizeConnectionId(c.id) === selectedNorm) ??
      liveItems[0] ??
      null
    );
  }, [liveItems, selectedVariantId, swappedBase]);

  const walkMps = useWalkSpeedMps();
  const thresholds = useTransferThresholds();
  const groupOptions = useMemo(
    () =>
      liveItems.length > 1
        ? refreshConnectionGroupOptions(liveItems, walkMps, thresholds)
        : [],
    [liveItems, walkMps, thresholds],
  );

  const siblingsFor = useCallback(
    (chosen: Connection) => {
      const chosenNorm = normalizeConnectionId(chosen.id);
      return liveItems.filter((c) => normalizeConnectionId(c.id) !== chosenNorm).slice(0, 3);
    },
    [liveItems],
  );

  const handleApplyLegSwap = useCallback(
    (nextConnection: Connection) => {
      rememberPlannedConnection(nextConnection);
      setSwappedBase(nextConnection);
      if (isTrackedThis) {
        pendingTrackedSyncRef.current = normalizeConnectionId(nextConnection.id);
        void updateTrackedConnection(nextConnection, { reason: 'legSwap' });
      }
    },
    [isTrackedThis],
  );

  const handleSelectVariant = useCallback(
    (nextConnection: Connection) => {
      const nextNormId = normalizeConnectionId(nextConnection.id);
      if (nextNormId === normalizeConnectionId(selectedVariantId) && !swappedBase) return;
      rememberPlannedConnection(nextConnection);
      setSelectedVariantId(nextNormId);
      setSwappedBase(null);
      if (isTrackedThis) {
        const currentlyProtected = trackedTrip?.protectionEnabled === true;
        const nextHasTransfers = hasTransfer(nextConnection);
        let enableProtection: boolean | undefined;
        if (currentlyProtected && !nextHasTransfers) {
          hadProtectionBeforeDirectRef.current = true;
          enableProtection = false;
        } else if (nextHasTransfers && hadProtectionBeforeDirectRef.current) {
          hadProtectionBeforeDirectRef.current = false;
          enableProtection = true;
        }
        pendingTrackedSyncRef.current = nextNormId;
        void updateTrackedConnection(nextConnection, {
          reason: 'variantSwitch',
          enableProtection,
          groupAlternatives: siblingsFor(nextConnection),
        });
      }
    },
    [isTrackedThis, selectedVariantId, siblingsFor, swappedBase, trackedTrip?.protectionEnabled],
  );

  const { swapStates, swapLeg, retryLeg } = useLegAlternatives({
    connection: item,
    routeKey: selectedVariantId,
    tripDelays,
    onApplySwap: handleApplyLegSwap,
    ready: transitionSettled,
  });

  const activeId = normalizeConnectionId(item?.id ?? selectedVariantId);
  const [trackingBusy, setTrackingBusy] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [alarmOpen, setAlarmOpen] = useState(false);
  const [alarmFocused, setAlarmFocused] = useState(false);
  const alarm = useDepartureAlarm();
  const currentAlarm =
    alarm && normalizeConnectionId(alarm.connectionId) === activeId ? alarm : null;

  useEffect(() => {
    if (!isTrackedThis || !trackedTrip?.connection) {
      pendingTrackedSyncRef.current = null;
      prevTrackedConnIdRef.current = null;
      return;
    }
    const trackedNormId = normalizeConnectionId(trackedTrip.connection.id);
    if (pendingTrackedSyncRef.current) {
      if (trackedNormId === pendingTrackedSyncRef.current) {
        pendingTrackedSyncRef.current = null;
        prevTrackedConnIdRef.current = trackedNormId;
      }
      return;
    }
    if (prevTrackedConnIdRef.current === trackedNormId) return;
    prevTrackedConnIdRef.current = trackedNormId;
    setSelectedVariantId(trackedNormId);
    setItem(trackedTrip.connection);
    setSwappedBase(null);
  }, [isTrackedThis, trackedTrip?.connection]);

  const hasTransfers = item != null && hasTransfer(item);
  const [isSavedRoute, setIsSavedRoute] = useState<boolean>(
    () => isRouteSavedSync(immediateItem?.id ?? id) ?? false,
  );

  useEffect(() => {
    if (!item?.id) return;
    const syncHit = isRouteSavedSync(item.id);
    if (syncHit !== undefined) {
      setIsSavedRoute((prev) => (prev === syncHit ? prev : syncHit));
    }
    let cancelled = false;
    const checkSaved = () => {
      RoutingService.isRouteSaved(item.id)
        .then((saved) => {
          if (!cancelled) setIsSavedRoute((prev) => (prev === saved ? prev : saved));
        })
        .catch(() => {});
    };
    if (transitionSettled && syncHit === undefined) {
      checkSaved();
    }
    const unsub = subscribeSavedRoutes(checkSaved);
    return () => {
      cancelled = true;
      unsub();
    };
  }, [item?.id, transitionSettled]);

  const isPinned = isSavedRoute || isTrackedThis;

  const showFullAppOnlyAlert = () => {
    Alert.alert(s.routeDetails.fullAppOnlyTitle, s.routeDetails.fullAppOnlyBody, [
      { text: s.common.close, style: 'cancel' },
      {
        text: s.routeDetails.fullAppDownload,
        onPress: () => void Linking.openURL('https://kilometr.app'),
      },
    ]);
  };

  const togglePin = async () => {
    if (!item || trackingBusy) return;
    if (Platform.OS === 'web') {
      showFullAppOnlyAlert();
      return;
    }
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    if (isPinned) {
      try {
        await RoutingService.deleteSavedRoute(item.id);
        setIsSavedRoute(false);
        if (isTrackedThis) {
          await stopTracking();
        }
      } catch (err) {
        console.warn('Failed to unpin route:', err);
      }
    } else {
      try {
        await RoutingService.saveRoute(item);
        setIsSavedRoute(true);
        if (!isTrackedThis && areNotificationsSupported()) {
          void toggleTracking();
        }
      } catch (err) {
        console.warn('Failed to pin route:', err);
      }
    }
  };

  // Nagłówek przełącza śledzenie, karta włącza ochronę. Monitor trzyma jedną podróż.
  const toggleTracking = async (enableProtection = false) => {
    if (!item || trackingBusy) return;
    if (isTrackedThis && !enableProtection) {
      await stopTracking();
      return;
    }
    if (isTrackedThis && enableProtection && !trackedTrip?.protectionEnabled) {
      setTrackingBusy(true);
      try {
        let permission = await Location.getForegroundPermissionsAsync();
        if (!permission.granted) permission = await Location.requestForegroundPermissionsAsync();
        const precise =
          permission.granted &&
          permission.android?.accuracy !== 'coarse' &&
          permission.ios?.accuracy !== 'reduced';
        if (!precise) {
          Alert.alert(s.transferGuard.title, s.transferGuard.locationRequired, [
            { text: s.common.cancel, style: 'cancel' },
            { text: s.compass.openSettingsA11y, onPress: () => void Linking.openSettings() },
          ]);
          return;
        }
        await setTransferProtectionEnabled(true);
      } finally {
        setTrackingBusy(false);
      }
      return;
    }
    setTrackingBusy(true);
    try {
      if (!areNotificationsSupported() && !hasTransfers) {
        Alert.alert(s.routes.trackUnsupportedTitle, s.routes.trackUnsupportedBody);
        return;
      }
      const ok = !areNotificationsSupported() || (await ensureNotificationPermission());
      if (!ok) {
        Alert.alert(s.routes.notifOffTitle, permissionDeniedMessage());
        return;
      }
      let protectionEnabled = hasTransfers && isTransferProtectionSupported();
      if (protectionEnabled) {
        let permission = await Location.getForegroundPermissionsAsync();
        if (!permission.granted) permission = await Location.requestForegroundPermissionsAsync();
        protectionEnabled =
          permission.granted &&
          permission.android?.accuracy !== 'coarse' &&
          permission.ios?.accuracy !== 'reduced';
        if (!protectionEnabled) {
          Alert.alert(s.transferGuard.title, s.transferGuard.locationRequired, [
            { text: s.common.cancel, style: 'cancel' },
            { text: s.compass.openSettingsA11y, onPress: () => void Linking.openSettings() },
          ]);
          return;
        }
      }
      const firstLeg = item.legs[0];
      const lastLeg = item.legs[item.legs.length - 1];
      const fallback = defaultLocationForCity(getActiveCityIdSync());
      const groupSiblings = siblingsFor(item);
      await startTracking({
        id: item.id,
        fromTitle: item.fromTitle,
        fromLat: firstLeg?.fromLat ?? fallback.lat,
        fromLon: firstLeg?.fromLon ?? fallback.lon,
        toId: item.toTitle,
        toTitle: item.toTitle,
        toLat: lastLeg?.toLat ?? fallback.lat,
        toLon: lastLeg?.toLon ?? fallback.lon,
        anchorStopId: firstLeg?.fromStopId,
        anchorStopLat: firstLeg?.fromLat,
        anchorStopLon: firstLeg?.fromLon,
        connection: item,
        groupAlternatives: groupSiblings.length > 0 ? groupSiblings : undefined,
        startedAt: Date.now(),
        protectionEnabled,
      });
    } catch {
      Alert.alert(s.routes.trackFailTitle, s.routes.trackFailBody);
    } finally {
      setTrackingBusy(false);
    }
  };

  useEffect(() => {
    if (!id) {
      setLoadFailed(true);
      return;
    }
    setLoadFailed(false);
    setOffline(false);
    if (immediateItem) {
      setItem(immediateItem);
      return;
    }
    let cancelled = false;
    const load = async () => {
      try {
        const hit = await RoutingService.getConnectionById(String(id));
        if (cancelled) return;
        if (hit) {
          setItem(hit.connection);
          setOffline(hit.source === 'cache');
          return;
        }
        setLoadFailed(true);
      } catch (err) {
        console.warn('[RouteDetails] load failed:', err);
        if (!cancelled) setLoadFailed(true);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [id, immediateItem]);

  const itemId = item?.id;
  const openRouteMap = useCallback(
    (stageId?: string) => {
      if (!itemId) return;
      router.push({
        pathname: '/map',
        params: stageId ? { id: itemId, stageId } : { id: itemId },
      });
    },
    [itemId, router],
  );

  const toggleTrackingRef = useRef(toggleTracking);
  toggleTrackingRef.current = toggleTracking;
  const transferProtectionActive = isTrackedThis && trackedTrip?.protectionEnabled === true;
  const handleTransferPress = useCallback(() => {
    if (transferProtectionActive) {
      openTransferProtection();
    } else {
      void toggleTrackingRef.current(true);
    }
  }, [openTransferProtection, transferProtectionActive]);

  if (loadFailed) {
    return (
      <View style={[styles.safe, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
        <View style={[styles.header, webLayout.isMedium && styles.mediumConstrained]}>
          <Pressable
            onPress={goBack}
            style={({ pressed }) => [styles.backBtn, pressed && styles.pressed]}
            accessibilityRole="button"
            accessibilityLabel={s.map.backA11y}
          >
            <ChevronLeft size={22} color={scheme.onSurface} />
          </Pressable>
          <Text style={styles.headerTitle} numberOfLines={1}>
            {s.routeDetails.title}
          </Text>
        </View>
        <View style={[styles.stateWrap, webLayout.isMedium && styles.mediumConstrained]}>
          <View style={styles.emptyCard}>
            <View style={styles.emptyIconCircle}>
              <RouteOff size={24} color={scheme.onSecondaryContainer} />
            </View>
            <Text style={styles.emptyTitle}>{s.routeDetails.loadFail}</Text>
            <Pressable
              onPress={goBack}
              accessibilityRole="button"
              style={({ pressed }) => [styles.retryBtn, pressed && styles.pressed]}
            >
              <Text style={styles.retryText}>{s.routeDetails.backToList}</Text>
            </Pressable>
          </View>
        </View>
      </View>
    );
  }

  if (!item) {
    return (
      <View style={[styles.safe, { paddingTop: insets.top }]}>
        <View style={[styles.header, webLayout.isMedium && styles.mediumConstrained]}>
          <Pressable
            onPress={goBack}
            style={({ pressed }) => [styles.backBtn, pressed && styles.pressed]}
            accessibilityRole="button"
            accessibilityLabel={s.map.backA11y}
          >
            <ChevronLeft size={22} color={scheme.onSurface} />
          </Pressable>
          <Text style={styles.headerTitle} numberOfLines={1}>
            {s.routeDetails.title}
          </Text>
        </View>
        <View
          style={[styles.stateWrap, webLayout.isMedium && styles.mediumConstrained]}
          accessibilityLiveRegion="polite"
        >
          <MorphingLoader variant="contained" size={44} />
          <Text style={styles.emptyText}>{s.routeDetails.loading}</Text>
        </View>
      </View>
    );
  }

  const noLegs = item.legs.length === 0;
  const hasTransitLeg = item.legs.some((leg) => leg.mode !== 'walk');
  const hasTrainLeg = item.legs.some((leg) => leg.mode === 'train');
  const hasHeaderActions = !noLegs || hasTransitLeg;

  const dataNote = offline
    ? s.routeDetails.offlineNote
    : liveStale && !item.live
      ? s.routeDetails.noLiveNote
      : null;

  const desktopSplit = webLayout.isDesktop && !noLegs;
  const leftColWidth = webLayout.isWide ? 520 : 440;
  const summaryAvailableWidth = desktopSplit
    ? leftColWidth
    : webLayout.isMedium
      ? Math.min(740, webLayout.contentWidth) - 28
      : undefined;

  const renderHeaderContent = (onBackPress: () => void) => (
    <>
      <SpringPressable
        onPress={onBackPress}
        scaleDelta={0.06}
        style={styles.backBtn}
        accessibilityRole="button"
        accessibilityLabel={s.map.backA11y}
      >
        <ChevronLeft size={22} color={scheme.onSurface} />
      </SpringPressable>

      <Text
        style={styles.headerTitle}
        accessibilityRole="header"
        numberOfLines={1}
        adjustsFontSizeToFit
        minimumFontScale={0.85}
      >
        {s.routeDetails.title}
      </Text>

      {hasHeaderActions && (
        <View style={styles.actionCluster}>
          {!noLegs && (
            <SpringPressable
              onPress={() => setSharing(true)}
              scaleDelta={0.06}
              haptic="selection"
              accessibilityRole="button"
              accessibilityLabel={s.share.title}
              style={styles.clusterBtn}
              hitSlop={4}
            >
              <Share2 size={19} color={scheme.onSurface} />
            </SpringPressable>
          )}

          {hasTransitLeg && (
            <SpringPressable
              onPress={() => {
                if (Platform.OS === 'web') {
                  showFullAppOnlyAlert();
                  return;
                }
                setAlarmOpen(true);
              }}
              scaleDelta={0.06}
              haptic="selection"
              accessibilityRole="button"
              onFocus={() => setAlarmFocused(true)}
              onBlur={() => setAlarmFocused(false)}
              accessibilityState={{
                selected: currentAlarm != null,
                disabled: Platform.OS === 'web',
              }}
              accessibilityLabel={
                currentAlarm
                  ? `${s.alarm.edit}. ${s.alarm.ringsAt(currentAlarm.time)}`
                  : s.alarm.set
              }
              style={[
                styles.clusterBtn,
                Platform.OS === 'web' && styles.clusterBtnLocked,
                currentAlarm && styles.clusterBtnActive,
                alarmFocused && styles.alarmFocused,
              ]}
              hitSlop={4}
            >
              <AlarmClock
                size={19}
                color={currentAlarm ? scheme.onPrimaryContainer : scheme.onSurface}
              />
            </SpringPressable>
          )}

          {!noLegs && (
            <SpringPressable
              onPress={() => void togglePin()}
              disabled={trackingBusy}
              scaleDelta={0.06}
              haptic="light"
              accessibilityRole="button"
              accessibilityState={{
                selected: isPinned,
                disabled: Platform.OS === 'web' || trackingBusy,
              }}
              accessibilityLabel={
                isPinned
                  ? s.home.unpinRouteA11y(item.toTitle)
                  : s.home.pinRouteA11y(item.toTitle)
              }
              style={[
                styles.clusterBtn,
                Platform.OS === 'web' && styles.clusterBtnLocked,
                isPinned && styles.clusterBtnActive,
              ]}
              hitSlop={4}
            >
              <Pin
                size={19}
                color={isPinned ? scheme.onPrimaryContainer : scheme.onSurface}
              />
            </SpringPressable>
          )}
        </View>
      )}
    </>
  );

  const renderSummaryAndMeta = (morphProps?: MorphShellRenderProps) => (
    <>
      <ConnectionSummary
        item={item}
        offline={offline}
        availableWidth={summaryAvailableWidth}
        showLegStrip
        onStripLayoutInParent={morphProps ? handleSummaryStripLayout : undefined}
        stripAnimatedStyle={morphProps?.targetStripAnimatedStyle}
      />

      {currentAlarm && (
        <SpringPressable
          onPress={() => setAlarmOpen(true)}
          scaleDelta={0.02}
          haptic="selection"
          accessibilityRole="button"
          accessibilityLabel={`${s.alarm.edit}. ${s.alarm.ringsAt(currentAlarm.time)}`}
          style={styles.alarmBanner}
        >
          <View style={styles.alarmIconWrap}>
            <AlarmClock size={18} color={scheme.onPrimaryContainer} />
          </View>
          <View style={styles.alarmTextCol}>
            <Text style={styles.alarmEyebrow} numberOfLines={1}>
              {s.alarm.title}
            </Text>
            <Text style={styles.alarmTimeText} numberOfLines={1}>
              {s.alarm.ringsAt(currentAlarm.time)}
            </Text>
          </View>
          <ChevronRight size={17} color={scheme.onPrimaryContainer} />
        </SpringPressable>
      )}

      {dataNote && (
        <View style={styles.offlineBanner}>
          <View style={styles.offlineIconWrap}>
            <CloudOff size={16} color={scheme.onSecondaryContainer} />
          </View>
          <Text style={styles.offlineBannerText}>{dataNote}</Text>
        </View>
      )}
    </>
  );

  const showFullDetails = desktopSplit || openTicket || transitionSettled;
  const legSections = showFullDetails ? (
    <>
      {groupOptions.length > 1 && (
        <ConnectionVariantSwitcher
          options={groupOptions}
          selectedId={item.id}
          onSelect={handleSelectVariant}
          trackedConnectionId={isTrackedThis ? trackedTrip?.connection.id : undefined}
          transferProtectionActive={transferProtectionActive}
        />
      )}
      <RouteTravelDeck
        connection={item}
        hasTransfers={hasTransfers}
        transferState={isTrackedThis && trackedTrip ? trackedTrip.transfer : undefined}
        transferActive={transferProtectionActive}
        trackingBusy={trackingBusy}
        autoInspectTicket={openTicket}
        deferLoad={!transitionSettled}
        onTransferPress={handleTransferPress}
      />
      <LegTimeline
        legs={item.legs}
        boardedDepartAt={item.boarded ? item.departAt : undefined}
        legSwapStates={swapStates}
        onSwapLeg={swapLeg}
        onRetrySwapLeg={retryLeg}
        transferState={transferProtectionActive ? trackedTrip?.transfer : undefined}
        onOpenTransferProtection={openTransferProtection}
        deferSecondaryWork={!transitionSettled}
        railLiveLoading={railLiveLoading && !offline}
      />
    </>
  ) : null;

  const renderScreenBody = (morphProps?: MorphShellRenderProps) => {
    targetStripCbRef.current = morphProps?.onTargetStripRect ?? null;
    const onBackPress = morphProps ? morphProps.requestClose : goBack;
    return (
      <View
        style={[
          styles.safe,
          morphProps && styles.safeTransparent,
          { paddingTop: insets.top },
        ]}
      >
        <View
          onLayout={morphProps ? handleScreenLayout : undefined}
          style={[styles.screen, desktopSplit && styles.desktopContainer]}
          importantForAccessibility={sharing || alarmOpen ? 'no-hide-descendants' : 'auto'}
          accessibilityElementsHidden={sharing || alarmOpen}
        >
          {desktopSplit ? (
            <>
              <View style={styles.desktopHeader}>{renderHeaderContent(onBackPress)}</View>
              <View style={styles.desktopSplit}>
                <ScrollView
                  style={{ width: leftColWidth, flexGrow: 0, flexShrink: 0 }}
                  contentContainerStyle={styles.desktopLeftBody}
                  showsVerticalScrollIndicator={false}
                  overScrollMode="never"
                  onScrollBeginDrag={markDetailsScrollStart}
                  onMomentumScrollBegin={markDetailsScrollStart}
                  onScrollEndDrag={markDetailsScrollEnd}
                  onMomentumScrollEnd={markDetailsScrollEnd}
                >
                  {renderSummaryAndMeta()}
                  <View style={styles.detailsContent}>
                    {legSections}
                    {transitionSettled && (
                      <>
                        <RouteReliabilityCard connection={item} />
                        <ConnectionLineAlerts connection={item} />
                      </>
                    )}
                  </View>
                  <View style={{ height: 24 }} />
                </ScrollView>
                <View style={styles.desktopMapCol}>
                  <Suspense fallback={<MapCardSkeleton />}>
                    <RouteMapCard
                      desktopFill
                      connection={item}
                      onOpenMap={openRouteMap}
                    />
                  </Suspense>
                </View>
              </View>
            </>
          ) : (
            <>
              <Animated.View
                style={[
                  styles.header,
                  webLayout.isMedium && styles.mediumConstrained,
                  morphProps?.headerAnimatedStyle,
                ]}
              >
                {renderHeaderContent(onBackPress)}
              </Animated.View>

              <ScrollView
                onLayout={morphProps ? handleScrollViewLayout : undefined}
                onScroll={morphProps ? handleScroll : undefined}
                onScrollBeginDrag={markDetailsScrollStart}
                onMomentumScrollBegin={markDetailsScrollStart}
                onScrollEndDrag={markDetailsScrollEnd}
                onMomentumScrollEnd={markDetailsScrollEnd}
                scrollEventThrottle={16}
                contentContainerStyle={[
                  styles.body,
                  webLayout.isMedium && styles.mediumConstrained,
                ]}
                showsVerticalScrollIndicator={false}
                overScrollMode="never"
              >
                {renderSummaryAndMeta(morphProps)}

                {noLegs ? (
                  <Animated.View style={[styles.emptyCard, morphProps?.belowSummaryAnimatedStyle]}>
                    <View style={styles.emptyIconCircle}>
                      <RouteOff size={24} color={scheme.onSecondaryContainer} />
                    </View>
                    <Text style={styles.emptyTitle}>{s.routeDetails.noTrip}</Text>
                    <Text style={styles.emptyText}>{s.routeDetails.noTripBody}</Text>
                    <Pressable
                      onPress={onBackPress}
                      accessibilityRole="button"
                      style={({ pressed }) => [styles.retryBtn, pressed && styles.pressed]}
                    >
                      <Text style={styles.retryText}>{s.routeDetails.backToList}</Text>
                    </Pressable>
                  </Animated.View>
                ) : (
                  <Animated.View
                    style={[styles.detailsContent, morphProps?.belowSummaryAnimatedStyle]}
                  >
                    {openTicket || transitionSettled ? (
                      <Animated.View
                        entering={!openTicket && !reduceMotion ? FadeIn.duration(130) : undefined}
                        style={styles.detailsContent}
                      >
                        {legSections}
                        {secondaryReady ? (
                          <>
                            <Suspense fallback={<MapCardSkeleton />}>
                              <RouteMapCard connection={item} onOpenMap={openRouteMap} />
                            </Suspense>
                            <RouteReliabilityCard connection={item} />
                            <ConnectionLineAlerts connection={item} />
                          </>
                        ) : (
                          <MapCardSkeleton />
                        )}
                      </Animated.View>
                    ) : (
                      <RouteDetailsSkeleton
                        connection={item}
                        showDeckPlaceholder={hasTransfers || hasTrainLeg}
                      />
                    )}
                  </Animated.View>
                )}

                <View style={{ height: 24 }} />
              </ScrollView>
            </>
          )}
        </View>
      </View>
    );
  };

  if (activeMorphSource && !desktopSplit) {
    return (
      <View style={styles.morphHost}>
        <RouteDetailsMorphShell
          source={activeMorphSource}
          connection={item}
          topInset={insets.top}
          scrollYRef={scrollYRef}
          canInterceptBack={!sharing && !alarmOpen}
          onSettled={handleMorphSettled}
          onDismissComplete={goBack}
        >
          {(morphProps) => renderScreenBody(morphProps)}
        </RouteDetailsMorphShell>
        {sharing && (
          <Suspense fallback={<SheetLoadingFallback />}>
            <ShareConnectionSheet connection={item} onClose={() => setSharing(false)} />
          </Suspense>
        )}
        {alarmOpen && (
          <Suspense fallback={<SheetLoadingFallback />}>
            <DepartureAlarmSheet connection={item} alarm={alarm} onClose={() => setAlarmOpen(false)} />
          </Suspense>
        )}
      </View>
    );
  }

  return (
    <View style={styles.morphHost}>
      {renderScreenBody()}
      {sharing && (
        <Suspense fallback={<SheetLoadingFallback />}>
          <ShareConnectionSheet connection={item} onClose={() => setSharing(false)} />
        </Suspense>
      )}
      {alarmOpen && (
        <Suspense fallback={<SheetLoadingFallback />}>
          <DepartureAlarmSheet connection={item} alarm={alarm} onClose={() => setAlarmOpen(false)} />
        </Suspense>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  morphHost: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  safe: {
    flex: 1,
    backgroundColor: scheme.surface,
  },
  safeTransparent: {
    backgroundColor: 'transparent',
  },
  screen: {
    flex: 1,
  },
  mediumConstrained: {
    width: '100%',
    maxWidth: 740,
    alignSelf: 'center',
  },
  desktopContainer: {
    width: '100%',
    maxWidth: 1320,
    alignSelf: 'center',
    paddingHorizontal: 28,
    paddingTop: 16,
    paddingBottom: 20,
    gap: 14,
  },
  desktopHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  desktopSplit: {
    flex: 1,
    flexDirection: 'row',
    gap: 24,
    minHeight: 0,
  },
  desktopLeftBody: {
    gap: 14,
    paddingBottom: 24,
  },
  desktopMapCol: {
    flex: 1,
    minWidth: 0,
    minHeight: 0,
  },
  stateWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 20,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  backBtn: {
    width: 44,
    height: 44,
    borderRadius: shape.full,
    backgroundColor: scheme.surfaceContainer,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: scheme.outlineVariant,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    flex: 1,
    fontSize: 17,
    lineHeight: 22,
    fontWeight: '800',
    letterSpacing: -0.3,
    color: scheme.onSurface,
  },
  actionCluster: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    padding: 3,
    borderRadius: shape.full,
    backgroundColor: scheme.surfaceContainer,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: scheme.outlineVariant,
  },
  clusterBtn: {
    width: 44,
    height: 44,
    borderRadius: shape.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  clusterBtnActive: {
    backgroundColor: scheme.primaryContainer,
  },
  clusterBtnLocked: {
    opacity: 0.42,
  },
  alarmFocused: {
    borderWidth: 2,
    borderColor: scheme.primary,
  },
  pressed: {
    opacity: 0.78,
    transform: [{ scale: 0.97 }],
  },
  body: {
    paddingHorizontal: 14,
    paddingTop: 4,
    gap: 14,
    paddingBottom: 40,
  },
  alarmBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    minHeight: 56,
    backgroundColor: scheme.primaryContainer,
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 10,
    ...elev.level1,
  },
  alarmIconWrap: {
    width: 34,
    height: 34,
    borderRadius: 12,
    backgroundColor: scheme.primary + '26',
    alignItems: 'center',
    justifyContent: 'center',
  },
  alarmTextCol: {
    flex: 1,
    minWidth: 0,
    gap: 1,
  },
  alarmEyebrow: {
    fontSize: 11,
    lineHeight: 14,
    fontWeight: '700',
    color: scheme.onPrimaryContainer,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  alarmTimeText: {
    fontSize: 14.5,
    lineHeight: 19,
    fontWeight: '800',
    color: scheme.onPrimaryContainer,
    fontVariant: ['tabular-nums'],
  },
  offlineBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: scheme.surfaceContainer,
    borderRadius: 20,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: scheme.outlineVariant,
    paddingHorizontal: 14,
    paddingVertical: 11,
  },
  offlineIconWrap: {
    width: 32,
    height: 32,
    borderRadius: 11,
    backgroundColor: scheme.secondaryContainer,
    alignItems: 'center',
    justifyContent: 'center',
  },
  offlineBannerText: {
    ...type.bodySmall,
    color: scheme.onSurfaceVariant,
    flex: 1,
    lineHeight: 18,
  },
  emptyCard: {
    width: '100%',
    alignItems: 'center',
    gap: 10,
    backgroundColor: scheme.surfaceContainer,
    borderRadius: shape.extraLarge,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: scheme.outlineVariant,
    padding: 24,
    ...elev.level1,
  },
  emptyIconCircle: {
    width: 52,
    height: 52,
    borderRadius: shape.full,
    backgroundColor: scheme.secondaryContainer,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 2,
  },
  emptyTitle: {
    ...type.titleMedium,
    fontWeight: '800',
    color: scheme.onSurface,
    textAlign: 'center',
  },
  emptyText: {
    ...type.bodyMedium,
    color: scheme.onSurfaceVariant,
    textAlign: 'center',
    lineHeight: 20,
  },
  retryBtn: {
    minHeight: 48,
    minWidth: 160,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: scheme.primary,
    borderRadius: shape.full,
    paddingHorizontal: 24,
    paddingVertical: 12,
    marginTop: 6,
  },
  retryText: {
    ...type.labelLarge,
    fontWeight: '700',
    color: scheme.onPrimary,
  },
  detailsContent: {
    gap: 14,
  },
});
