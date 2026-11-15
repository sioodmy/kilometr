// Pelnoekranowa mapa pojazdow, przystankow i utrudnien na zywo w stylu zbiorkom.live:
// pigulki linii z ikona srodka transportu i strzalka kierunku, klikalne przystanki
// z tablica odjazdow, korytarze utrudnien z komunikatow oraz reczny wybor startu.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  type LayoutChangeEvent,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import Animated, {
  FadeIn,
  FadeInDown,
  FadeOut,
  FadeOutDown,
  LinearTransition,
} from 'react-native-reanimated';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import {
  BusFront,
  CableCar,
  ChevronLeft,
  ExternalLink,
  LocateFixed,
  RefreshCw,
  TrainFront,
  TramFront,
  TriangleAlert,
  WifiOff,
  X,
} from '../src/components/icons';
import { LineBadge } from '../src/components/LineBadge';
import {
  LiveVehiclesMap,
  type LiveVehiclesMapHandle,
} from '../src/components/LiveVehiclesMap';
import { SpringPressable } from '../src/components/SpringPressable';
import type {
  LiveMapDisruptionItem,
  LiveMapStopItem,
  LiveMapVehicleItem,
} from '../src/map/liveVehiclesMapDocument';
import {
  bearingDegrees,
  distanceMeters,
  secondsToTimeString,
  warsawNow,
} from '../src/gtfs/geo';
import { useStrings } from '../src/i18n';
import { setPendingBoardedOrigin } from '../src/services/boardedOriginSelection';
import { useActiveCity } from '../src/services/cityStore';
import { useCurrentLocation } from '../src/services/currentLocation';
import { inferTransitMode } from '../src/services/lineIdentity';
import {
  buildLiveMapStops,
  getLiveMapModeColors,
  getStopDepartureBoard,
  getVehicleUpcomingBoard,
  loadLiveMapSchedule,
  type LiveMapScheduleContext,
} from '../src/services/liveMapBoard';
import {
  buildLiveMapDisruptions,
  type LiveMapDisruptionMarker,
} from '../src/services/liveMapDisruptions';
import { liveTracker, type TrackedVehicle } from '../src/services/liveTracker';
import { acquireMapServer } from '../src/services/mapServerLease';
import {
  fetchCityNews,
  formatNewsDate,
  getCachedNews,
  loadNewsCache,
  rememberNewsItemForDetail,
  subscribeNewsCache,
  type DisruptionAlert,
  type MpkNewsItem,
} from '../src/services/mpkNews';
import {
  buildBoardedOriginFromVehicle,
  resolveVehicleBearing,
} from '../src/services/onboardDetector';
import { gtfsStore } from '../src/services/routing/store';
import { motion } from '../src/theme/motion';
import { elev, scheme, shape, type } from '../src/theme/tokens';
import type { LegMode } from '../src/types/models';

type ModeFilter = 'all' | 'tram' | 'bus' | 'train';

const OFFLINE_PILL_MS = 2500;

const SHEET_ENTERING = FadeInDown.duration(motion.enter.duration)
  .easing(motion.enter.easing)
  .reduceMotion(motion.enter.reduceMotion);
const SHEET_EXITING = FadeOutDown.duration(motion.state.duration)
  .easing(motion.state.easing)
  .reduceMotion(motion.state.reduceMotion);
const BADGE_ENTERING = FadeIn.duration(motion.state.duration)
  .easing(motion.state.easing)
  .reduceMotion(motion.state.reduceMotion);
const BADGE_EXITING = FadeOut.duration(140).reduceMotion(motion.state.reduceMotion);
const SMOOTH_LAYOUT = LinearTransition.duration(motion.state.duration)
  .easing(motion.state.easing)
  .reduceMotion(motion.state.reduceMotion);

function matchesFilter(mode: Exclude<LegMode, 'walk'>, filter: ModeFilter): boolean {
  if (filter === 'all') return true;
  if (filter === 'tram') return mode === 'tram';
  if (filter === 'bus') return mode === 'bus' || mode === 'trolleybus';
  if (filter === 'train') return mode === 'train' || mode === 'subway' || mode === 'cable';
  return true;
}

function ModeGlyph({
  mode,
  size,
  color,
}: {
  mode: Exclude<LegMode, 'walk'>;
  size: number;
  color: string;
}) {
  if (mode === 'cable') return <CableCar size={size} color={color} />;
  if (mode === 'train' || mode === 'subway') return <TrainFront size={size} color={color} />;
  if (mode === 'tram') return <TramFront size={size} color={color} />;
  return <BusFront size={size} color={color} />;
}

function MapLinePill({
  mode,
  line,
  bg,
  fg,
  large = false,
}: {
  mode: Exclude<LegMode, 'walk'>;
  line: string;
  bg: string;
  fg: string;
  large?: boolean;
}) {
  return (
    <View
      style={[
        styles.mapPill,
        large && styles.mapPillLarge,
        { backgroundColor: bg },
      ]}
    >
      <ModeGlyph mode={mode} size={large ? 16 : 13} color={fg} />
      <Text
        style={[styles.mapPillText, large && styles.mapPillTextLarge, { color: fg }]}
        numberOfLines={1}
      >
        {line || '?'}
      </Text>
    </View>
  );
}

function getDisruptionTone(severity: DisruptionAlert['severity']) {
  if (severity === 'blocking' || severity === 'major') {
    return { bg: scheme.errorContainer, fg: scheme.onErrorContainer };
  }
  if (severity === 'minor') {
    return { bg: scheme.warningContainer, fg: scheme.onWarningContainer };
  }
  return { bg: scheme.tertiaryContainer, fg: scheme.onTertiaryContainer };
}

export default function LiveVehiclesMapScreen() {
  const s = useStrings();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { cityId, city } = useActiveCity();
  const { returnTo } = useLocalSearchParams<{ returnTo?: string }>();
  const returnTarget: 'home' | 'routes' = returnTo === 'routes' ? 'routes' : 'home';

  const mapRef = useRef<LiveVehiclesMapHandle>(null);
  const { location: userLoc } = useCurrentLocation(true, false);

  const [vehicles, setVehicles] = useState<TrackedVehicle[]>(() => liveTracker.snapshot());
  const [filter, setFilter] = useState<ModeFilter>('all');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedStopId, setSelectedStopId] = useState<string | null>(null);
  const [selectedDisruptionId, setSelectedDisruptionId] = useState<string | null>(null);
  const [showDisruptions, setShowDisruptions] = useState(true);
  const [newsItems, setNewsItems] = useState<MpkNewsItem[]>(() => getCachedNews() ?? []);
  const [offlineBase, setOfflineBase] = useState<string | null | undefined>(undefined);
  const [gtfsLoaded, setGtfsLoaded] = useState(() => gtfsStore.isLoaded);
  const [scheduleCtx, setScheduleCtx] = useState<LiveMapScheduleContext | null>(null);
  const [nowSec, setNowSec] = useState(() => warsawNow().sec);
  const [showOfflinePill, setShowOfflinePill] = useState(false);
  const [mapError, setMapError] = useState<string | null>(null);
  const [sheetHeight, setSheetHeight] = useState(0);
  // Bez sieci pierwszy poll live nigdy nie kończy się sukcesem, więc bez
  // timeoutu spinner "Ładowanie pojazdów" wisiałby w nieskończoność.
  const [liveWaitExpired, setLiveWaitExpired] = useState(false);
  const offlinePillTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const motionRef = useRef(
    new Map<string, { lat: number; lon: number; bearing?: number }>(),
  );

  useFocusEffect(
    useCallback(() => {
      liveTracker.acquire();
      let cancelled = false;
      const newsController = new AbortController();
      setLiveWaitExpired(false);
      const liveWaitTimer = setTimeout(() => setLiveWaitExpired(true), 12000);

      void loadLiveMapSchedule()
        .then((ctx) => {
          if (cancelled) return;
          setGtfsLoaded(gtfsStore.isLoaded);
          if (ctx) {
            setScheduleCtx(ctx);
            setNowSec(ctx.nowSec);
          }
        })
        .catch(() => {});

      const unsubNews = subscribeNewsCache(() => {
        if (cancelled) return;
        const cached = getCachedNews();
        if (cached) setNewsItems(cached);
      });

      if (city.features.news) {
        void (async () => {
          const cached = getCachedNews();
          if (cached && cached.length > 0) {
            if (!cancelled) setNewsItems(cached);
          } else {
            const stored = await loadNewsCache(cityId);
            if (!cancelled && stored && stored.length > 0) {
              setNewsItems(stored);
            }
          }
          try {
            const fresh = await fetchCityNews(newsController.signal);
            if (!cancelled && !newsController.signal.aborted) {
              setNewsItems(fresh);
            }
          } catch {
            // Ciche zachowanie istniejacego cache komunikatow przy braku sieci.
          }
        })();
      } else {
        setNewsItems([]);
      }

      void liveTracker.ensureFresh();
      setVehicles(liveTracker.snapshot());
      const unsub = liveTracker.subscribe(() => {
        setVehicles(liveTracker.snapshot());
        setNowSec(warsawNow().sec);
      });
      const clock = setInterval(() => {
        setNowSec(warsawNow().sec);
      }, 15000);
      return () => {
        cancelled = true;
        newsController.abort();
        clearInterval(clock);
        clearTimeout(liveWaitTimer);
        unsubNews();
        unsub();
        liveTracker.release();
      };
    }, [city.features.news, cityId]),
  );

  useEffect(() => {
    let cancelled = false;
    let release: (() => void) | null = null;
    (async () => {
      const lease = await acquireMapServer();
      if (cancelled) {
        lease.release();
        return;
      }
      release = lease.release;
      setOfflineBase(lease.base);
    })();
    return () => {
      cancelled = true;
      release?.();
    };
  }, [cityId]);

  const clearOfflineTimer = useCallback(() => {
    if (offlinePillTimer.current) {
      clearTimeout(offlinePillTimer.current);
      offlinePillTimer.current = null;
    }
  }, []);

  const handleTilesStatus = useCallback(
    (ok: boolean) => {
      if (ok) {
        clearOfflineTimer();
        setShowOfflinePill(false);
        return;
      }
      if (offlinePillTimer.current) return;
      offlinePillTimer.current = setTimeout(() => {
        offlinePillTimer.current = null;
        setShowOfflinePill(true);
      }, OFFLINE_PILL_MS);
    },
    [clearOfflineTimer],
  );

  useEffect(() => () => clearOfflineTimer(), [clearOfflineTimer]);

  const mapItems = useMemo<LiveMapVehicleItem[]>(() => {
    const out: LiveMapVehicleItem[] = [];
    const seen = new Set<string>();
    for (const v of vehicles) {
      if (!Number.isFinite(v.lat) || !Number.isFinite(v.lon)) continue;
      seen.add(v.vehicleId);

      const prevMotion = motionRef.current.get(v.vehicleId);
      let observedBearing = prevMotion?.bearing;
      if (!prevMotion) {
        motionRef.current.set(v.vehicleId, { lat: v.lat, lon: v.lon });
      } else if (distanceMeters(prevMotion.lat, prevMotion.lon, v.lat, v.lon) >= 12) {
        observedBearing = Math.round(bearingDegrees(prevMotion.lat, prevMotion.lon, v.lat, v.lon));
        motionRef.current.set(v.vehicleId, {
          lat: v.lat,
          lon: v.lon,
          bearing: observedBearing,
        });
      }

      const inferred = inferTransitMode(v.type, v.line, cityId);
      const resolvedMode: Exclude<LegMode, 'walk'> = inferred === 'walk' ? 'bus' : inferred;
      if (!matchesFilter(resolvedMode, filter)) continue;

      const { bg, fg } = getLiveMapModeColors(resolvedMode, v.line, cityId);
      const routeBearing = gtfsLoaded ? resolveVehicleBearing(v, gtfsStore) : undefined;

      out.push({
        id: v.vehicleId,
        line: v.line || '?',
        mode: resolvedMode,
        bg,
        fg,
        lat: v.lat,
        lon: v.lon,
        bearing: routeBearing ?? observedBearing,
        delaySec: v.delaySec ?? null,
        updatedAt: v.updatedAt,
      });
    }
    for (const key of motionRef.current.keys()) {
      if (!seen.has(key)) motionRef.current.delete(key);
    }
    return out;
  }, [cityId, filter, gtfsLoaded, vehicles]);

  const mapStops = useMemo<LiveMapStopItem[]>(() => {
    if (!gtfsLoaded) return [];
    return buildLiveMapStops(gtfsStore, scheduleCtx?.dayIndex ?? null, cityId);
  }, [cityId, gtfsLoaded, scheduleCtx?.dayIndex]);

  const disruptionMarkers = useMemo<LiveMapDisruptionMarker[]>(() => {
    if (!city.features.news || newsItems.length === 0) return [];
    return buildLiveMapDisruptions(
      newsItems,
      gtfsLoaded ? gtfsStore : null,
      scheduleCtx?.dayIndex ?? null,
    );
  }, [city.features.news, gtfsLoaded, newsItems, scheduleCtx?.dayIndex]);

  const mapDisruptionItems = useMemo<LiveMapDisruptionItem[]>(
    () =>
      disruptionMarkers.map((d) => ({
        id: d.id,
        label: d.shortLabel,
        severity: d.severity,
        lat: d.lat,
        lon: d.lon,
        corridorCoords: d.corridorCoords.length >= 2 ? d.corridorCoords : undefined,
        stopPoints:
          d.affectedStops.length > 0
            ? d.affectedStops.map((st) => [st.lon, st.lat] as [number, number])
            : undefined,
      })),
    [disruptionMarkers],
  );

  const stopsById = useMemo(() => {
    const map = new Map<string, LiveMapStopItem>();
    for (const st of mapStops) map.set(st.id, st);
    return map;
  }, [mapStops]);

  const selectedVehicle = useMemo(
    () => (selectedId ? (vehicles.find((v) => v.vehicleId === selectedId) ?? null) : null),
    [selectedId, vehicles],
  );

  const selectedOrigin = useMemo(
    () =>
      selectedVehicle && gtfsLoaded ? buildBoardedOriginFromVehicle(selectedVehicle, gtfsStore) : null,
    [gtfsLoaded, selectedVehicle],
  );

  const selectedMeta = useMemo(() => {
    if (!selectedVehicle) return null;
    const trip = selectedVehicle.matchedTripId
      ? gtfsStore.trips.get(selectedVehicle.matchedTripId)
      : undefined;
    const inferred = inferTransitMode(selectedVehicle.type, selectedVehicle.line, cityId);
    const mode: Exclude<LegMode, 'walk'> = inferred === 'walk' ? 'bus' : inferred;
    const { bg, fg } = getLiveMapModeColors(mode, selectedVehicle.line, cityId);
    const direction = selectedOrigin?.direction || trip?.trip_headsign || '';
    const nextStop = selectedVehicle.nextStopName || '';
    const distM = userLoc
      ? Math.round(distanceMeters(userLoc.lat, userLoc.lon, selectedVehicle.lat, selectedVehicle.lon))
      : null;
    const delayMin =
      selectedVehicle.delaySec != null ? Math.round(selectedVehicle.delaySec / 60) : null;
    return { mode, bg, fg, direction, nextStop, distM, delayMin };
  }, [cityId, gtfsLoaded, selectedOrigin, selectedVehicle, userLoc]);

  const vehicleBoard = useMemo(() => {
    if (!selectedVehicle || !gtfsLoaded) return [];
    return getVehicleUpcomingBoard(selectedVehicle, gtfsStore, nowSec);
  }, [gtfsLoaded, nowSec, selectedVehicle]);

  const selectedStop = useMemo(() => {
    if (!selectedStopId) return null;
    const item = stopsById.get(selectedStopId);
    if (item) return item;
    const raw = gtfsStore.stops.get(selectedStopId);
    if (!raw) return null;
    const { bg, fg } = getLiveMapModeColors('bus', undefined, cityId);
    return {
      id: raw.stop_id,
      name: raw.stop_name || raw.stop_id,
      code: raw.stop_code?.trim() || undefined,
      lat: raw.stop_lat,
      lon: raw.stop_lon,
      mode: 'bus' as const,
      bg,
      fg,
    };
  }, [cityId, selectedStopId, stopsById]);

  const stopDepartures = useMemo(() => {
    if (!selectedStopId || !gtfsLoaded) return [];
    return getStopDepartureBoard(
      selectedStopId,
      gtfsStore,
      scheduleCtx?.dayIndex ?? null,
      scheduleCtx?.offsets,
      vehicles,
      liveTracker.getTripDelays(),
      nowSec,
      cityId,
      24,
    );
  }, [cityId, gtfsLoaded, nowSec, scheduleCtx, selectedStopId, vehicles]);

  const selectedDisruption = useMemo(
    () =>
      selectedDisruptionId
        ? (disruptionMarkers.find((d) => d.id === selectedDisruptionId) ?? null)
        : null,
    [disruptionMarkers, selectedDisruptionId],
  );

  const handleSelectVehicle = useCallback(
    (vehicleId: string) => {
      void Haptics.selectionAsync().catch(() => {});
      setSelectedStopId(null);
      setSelectedDisruptionId(null);
      setSelectedId(vehicleId);
      const found = vehicles.find((v) => v.vehicleId === vehicleId);
      if (found) {
        mapRef.current?.centerOn(found.lat, found.lon);
      }
    },
    [vehicles],
  );

  const handleSelectStop = useCallback(
    (stopId: string) => {
      void Haptics.selectionAsync().catch(() => {});
      setSelectedId(null);
      setSelectedDisruptionId(null);
      setSelectedStopId(stopId);
      const st = stopsById.get(stopId) ?? gtfsStore.stops.get(stopId);
      if (st) {
        const lat = 'lat' in st ? st.lat : st.stop_lat;
        const lon = 'lon' in st ? st.lon : st.stop_lon;
        if (Number.isFinite(lat) && Number.isFinite(lon)) {
          mapRef.current?.centerOn(lat, lon, 15.4);
        }
      }
    },
    [stopsById],
  );

  const handleSelectDisruption = useCallback(
    (disruptionId: string) => {
      void Haptics.selectionAsync().catch(() => {});
      setSelectedId(null);
      setSelectedStopId(null);
      setSelectedDisruptionId(disruptionId);
      const found = disruptionMarkers.find((d) => d.id === disruptionId);
      if (found) {
        mapRef.current?.centerOn(found.lat, found.lon, 14.4);
      }
    },
    [disruptionMarkers],
  );

  const handleClearSelection = useCallback(() => {
    setSelectedId(null);
    setSelectedStopId(null);
    setSelectedDisruptionId(null);
    setSheetHeight(0);
  }, []);

  const handleToggleDisruptions = useCallback(() => {
    void Haptics.selectionAsync().catch(() => {});
    setShowDisruptions((prev) => {
      const next = !prev;
      if (!next) setSelectedDisruptionId(null);
      return next;
    });
  }, []);

  const handleRecenter = useCallback(() => {
    void Haptics.selectionAsync().catch(() => {});
    if (userLoc) {
      mapRef.current?.centerOn(userLoc.lat, userLoc.lon, 14.8);
    } else {
      mapRef.current?.centerOn(city.center.lat, city.center.lon, 13.0);
    }
  }, [city.center.lat, city.center.lon, userLoc]);

  const handleBoardVehicle = useCallback(() => {
    if (!selectedOrigin) return;
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    setPendingBoardedOrigin({
      origin: selectedOrigin,
      target: returnTarget,
      openDestination: returnTarget === 'home',
    });
    router.back();
  }, [returnTarget, router, selectedOrigin]);

  const handleOpenDisruptionArticle = useCallback(() => {
    if (!selectedDisruption) return;
    const item = selectedDisruption.newsItem;
    if (!item.link && !item.disruption) return;
    void Haptics.selectionAsync().catch(() => {});
    rememberNewsItemForDetail(item);
    router.push({
      pathname: '/article',
      params: {
        id: item.id,
        url: item.link,
        title: item.title,
        source: item.source,
        meta: item.pubDate ? formatNewsDate(item.pubDate) : item.dateLabel,
        lines: item.lines.join(','),
      },
    });
  }, [router, selectedDisruption]);

  const handleRetryMap = useCallback(() => {
    void Haptics.selectionAsync().catch(() => {});
    setMapError(null);
    mapRef.current?.reload();
  }, []);

  const handleSheetLayout = useCallback((e: LayoutChangeEvent) => {
    setSheetHeight(Math.round(e.nativeEvent.layout.height));
  }, []);

  const liveState = liveTracker.getLiveState();
  const isInitialLoading = vehicles.length === 0 && liveState === 'unknown' && !liveWaitExpired;
  const hasSheet = Boolean((selectedVehicle && selectedMeta) || selectedStop || selectedDisruption);

  const severityLabel = useCallback(
    (severity: DisruptionAlert['severity']) => {
      if (severity === 'blocking') return s.liveMap.disruptionSeverityBlocking;
      if (severity === 'major') return s.liveMap.disruptionSeverityMajor;
      if (severity === 'minor') return s.liveMap.disruptionSeverityMinor;
      return s.liveMap.disruptionSeverityInfo;
    },
    [s.liveMap],
  );

  const headerSubtitle = useMemo(() => {
    const base = isInitialLoading
      ? s.liveMap.loadingVehicles
      : s.liveMap.vehiclesCount(mapItems.length);
    if (disruptionMarkers.length === 0) return base;
    return `${base} · ${s.liveMap.disruptionsCount(disruptionMarkers.length)}`;
  }, [disruptionMarkers.length, isInitialLoading, mapItems.length, s.liveMap]);

  return (
    <View style={styles.root}>
      {offlineBase !== undefined && (
        <LiveVehiclesMap
          ref={mapRef}
          vehicles={mapItems}
          stops={mapStops}
          disruptions={mapDisruptionItems}
          selectedId={selectedId}
          selectedStopId={selectedStopId}
          selectedDisruptionId={selectedDisruptionId}
          showDisruptions={showDisruptions}
          userLat={userLoc?.lat ?? null}
          userLon={userLoc?.lon ?? null}
          offlineBase={offlineBase}
          bottomOffset={hasSheet ? sheetHeight : Math.max(insets.bottom, 12)}
          onSelectVehicle={handleSelectVehicle}
          onSelectStop={handleSelectStop}
          onSelectDisruption={handleSelectDisruption}
          onClearSelection={handleClearSelection}
          onTilesStatus={handleTilesStatus}
          onError={setMapError}
          onReady={() => setMapError(null)}
        />
      )}

      {/* Pasek gorny z powrotem, licznikiem i filtrami trybow */}
      <View
        style={[styles.topOverlay, { paddingTop: Math.max(insets.top, 10) + 6 }]}
        pointerEvents="box-none"
      >
        <View style={styles.headerRow}>
          <SpringPressable
            onPress={() => router.back()}
            accessibilityRole="button"
            accessibilityLabel={s.liveMap.backA11y}
            style={styles.circleBtn}
            scaleDelta={0.05}
          >
            <ChevronLeft size={22} color={scheme.onSurface} />
          </SpringPressable>

          <View style={styles.titlePill}>
            <Text style={styles.titleText} numberOfLines={1}>
              {s.liveMap.title}
            </Text>
            <Text style={styles.countText} numberOfLines={1}>
              {headerSubtitle}
            </Text>
          </View>

          <SpringPressable
            onPress={handleRecenter}
            accessibilityRole="button"
            accessibilityLabel={s.liveMap.recenterA11y}
            style={styles.circleBtn}
            scaleDelta={0.05}
          >
            <LocateFixed size={20} color={scheme.primary} />
          </SpringPressable>
        </View>

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.filterRow}
        >
          {(
            [
              { id: 'all', label: s.liveMap.filterAll, Icon: null },
              { id: 'tram', label: s.liveMap.filterTram, Icon: TramFront },
              { id: 'bus', label: s.liveMap.filterBus, Icon: BusFront },
              { id: 'train', label: s.liveMap.filterTrain, Icon: TrainFront },
            ] as const
          ).map(({ id, label, Icon }) => {
            const active = filter === id;
            return (
              <SpringPressable
                key={id}
                onPress={() => {
                  void Haptics.selectionAsync().catch(() => {});
                  setFilter(id);
                }}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
                style={[styles.filterChip, active && styles.filterChipActive]}
                scaleDelta={0.03}
              >
                {Icon && (
                  <Icon
                    size={15}
                    color={active ? scheme.onPrimaryContainer : scheme.onSurfaceVariant}
                  />
                )}
                <Text style={[styles.filterText, active && styles.filterTextActive]}>{label}</Text>
              </SpringPressable>
            );
          })}

          {disruptionMarkers.length > 0 && (
            <SpringPressable
              onPress={handleToggleDisruptions}
              accessibilityRole="button"
              accessibilityState={{ selected: showDisruptions }}
              style={[
                styles.filterChip,
                showDisruptions && styles.disruptionChipActive,
              ]}
              scaleDelta={0.03}
            >
              <TriangleAlert
                size={15}
                color={showDisruptions ? scheme.onErrorContainer : scheme.onSurfaceVariant}
              />
              <Text
                style={[
                  styles.filterText,
                  showDisruptions && styles.disruptionChipTextActive,
                ]}
              >
                {`${s.liveMap.filterDisruptions} (${disruptionMarkers.length})`}
              </Text>
            </SpringPressable>
          )}
        </ScrollView>

        {showOfflinePill && (
          <Animated.View
            entering={BADGE_ENTERING}
            exiting={BADGE_EXITING}
            layout={SMOOTH_LAYOUT}
            style={styles.statusBanner}
            accessibilityLiveRegion="polite"
          >
            <WifiOff size={15} color={scheme.warning} />
            <Text style={styles.statusBannerText}>{s.liveMap.offlineTilesNote}</Text>
          </Animated.View>
        )}
      </View>

      {isInitialLoading && !mapError && (
        <Animated.View
          entering={BADGE_ENTERING}
          exiting={BADGE_EXITING}
          style={styles.centerBadge}
          pointerEvents="none"
        >
          <ActivityIndicator size="small" color={scheme.primary} />
          <Text style={styles.centerBadgeText}>{s.liveMap.loadingVehicles}</Text>
        </Animated.View>
      )}

      {mapError && (
        <Animated.View
          entering={SHEET_ENTERING}
          exiting={SHEET_EXITING}
          style={[styles.errorCard, { bottom: Math.max(insets.bottom, 16) + 12 }]}
        >
          <View style={styles.errorHeader}>
            <View style={styles.errorIconBox}>
              <TriangleAlert size={20} color={scheme.onErrorContainer} />
            </View>
            <View style={styles.errorTextWrap}>
              <Text style={styles.emptyTitle}>{s.liveMap.mapErrorTitle}</Text>
              <Text style={styles.emptyBody}>{s.liveMap.mapErrorBody}</Text>
            </View>
          </View>
          <SpringPressable
            onPress={handleRetryMap}
            accessibilityRole="button"
            accessibilityLabel={s.liveMap.mapRetryCta}
            style={styles.retryBtn}
          >
            <RefreshCw size={16} color={scheme.onPrimary} />
            <Text style={styles.retryBtnText}>{s.liveMap.mapRetryCta}</Text>
          </SpringPressable>
        </Animated.View>
      )}

      {!isInitialLoading && mapItems.length === 0 && !hasSheet && !mapError && (
        <Animated.View
          entering={SHEET_ENTERING}
          exiting={SHEET_EXITING}
          style={[styles.emptyCard, { bottom: Math.max(insets.bottom, 16) + 12 }]}
        >
          <Text style={styles.emptyTitle}>{s.liveMap.noVehiclesTitle}</Text>
          <Text style={styles.emptyBody}>{s.liveMap.noVehiclesBody}</Text>
        </Animated.View>
      )}

      {/* Dolna karta szczegolow wybranego utrudnienia */}
      {selectedDisruption && (
        <Animated.View
          key={`disruption-${selectedDisruption.id}`}
          entering={SHEET_ENTERING}
          exiting={SHEET_EXITING}
          layout={SMOOTH_LAYOUT}
          onLayout={handleSheetLayout}
          style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, 16) + 4 }]}
        >
          {(() => {
            const tone = getDisruptionTone(selectedDisruption.severity);
            const hasCorridorEnds =
              Boolean(selectedDisruption.fromStop) && Boolean(selectedDisruption.toStop);
            const corridorText = hasCorridorEnds
              ? s.liveMap.disruptionCorridor(
                  selectedDisruption.fromStop ?? '',
                  selectedDisruption.toStop ?? '',
                )
              : selectedDisruption.corridorLabel;
            const canOpenArticle = Boolean(
              selectedDisruption.newsItem.link || selectedDisruption.newsItem.disruption,
            );

            return (
              <>
                <View style={styles.sheetHandle} />
                <View style={styles.sheetHeader}>
                  <View style={[styles.stopIconBox, { backgroundColor: tone.bg }]}>
                    <TriangleAlert size={20} color={tone.fg} />
                  </View>
                  <View style={styles.sheetTitleWrap}>
                    <View style={styles.disruptionBadgeRow}>
                      <View style={[styles.severityPill, { backgroundColor: tone.bg }]}>
                        <Text style={[styles.severityPillText, { color: tone.fg }]}>
                          {severityLabel(selectedDisruption.severity)}
                        </Text>
                      </View>
                      <Text style={styles.metaMuted} numberOfLines={1}>
                        {selectedDisruption.shortLabel}
                      </Text>
                    </View>
                    <Text style={styles.sheetTitle} numberOfLines={2}>
                      {selectedDisruption.headline}
                    </Text>
                  </View>
                  <SpringPressable
                    onPress={handleClearSelection}
                    hitSlop={8}
                    accessibilityRole="button"
                    accessibilityLabel={s.liveMap.closeSheetA11y}
                    style={styles.closeBtn}
                    scaleDelta={0.05}
                  >
                    <X size={20} color={scheme.onSurfaceVariant} />
                  </SpringPressable>
                </View>

                {selectedDisruption.lines.length > 0 && (
                  <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    contentContainerStyle={styles.disruptionLinesRow}
                  >
                    {selectedDisruption.lines.map((line) => (
                      <LineBadge key={line} line={line} compact />
                    ))}
                  </ScrollView>
                )}

                {corridorText && (
                  <View style={styles.disruptionMetaBox}>
                    <Text style={styles.disruptionCorridorText} numberOfLines={2}>
                      {corridorText}
                    </Text>
                  </View>
                )}

                {selectedDisruption.problem ? (
                  <Text style={styles.disruptionBody} numberOfLines={3}>
                    {selectedDisruption.problem}
                  </Text>
                ) : null}

                {selectedDisruption.solution ? (
                  <Text style={styles.disruptionSolution} numberOfLines={3}>
                    {selectedDisruption.solution}
                  </Text>
                ) : null}

                {selectedDisruption.replacementLine && (
                  <View style={styles.replacementPill}>
                    <Text style={styles.replacementText} numberOfLines={1}>
                      {s.liveMap.disruptionReplacement(selectedDisruption.replacementLine)}
                    </Text>
                  </View>
                )}

                {selectedDisruption.timeframe ? (
                  <Text style={styles.metaMuted} numberOfLines={1}>
                    {selectedDisruption.timeframe}
                  </Text>
                ) : null}

                {canOpenArticle && (
                  <SpringPressable
                    onPress={handleOpenDisruptionArticle}
                    accessibilityRole="button"
                    accessibilityLabel={s.liveMap.disruptionOpenArticleCta}
                    style={styles.boardBtn}
                  >
                    <Text style={styles.boardBtnText}>{s.liveMap.disruptionOpenArticleCta}</Text>
                    <ExternalLink size={16} color={scheme.onPrimary} />
                  </SpringPressable>
                )}
              </>
            );
          })()}
        </Animated.View>
      )}

      {/* Dolna tablica odjazdow wybranego przystanku */}
      {selectedStop && (
        <Animated.View
          key={`stop-${selectedStop.id}`}
          entering={SHEET_ENTERING}
          exiting={SHEET_EXITING}
          layout={SMOOTH_LAYOUT}
          onLayout={handleSheetLayout}
          style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, 16) + 4 }]}
        >
          <View style={styles.sheetHandle} />
          <View style={styles.sheetHeader}>
            <View style={[styles.stopIconBox, { backgroundColor: selectedStop.bg }]}>
              <ModeGlyph mode={selectedStop.mode} size={20} color={selectedStop.fg} />
            </View>
            <View style={styles.sheetTitleWrap}>
              <Text style={styles.sheetTitle} numberOfLines={1}>
                {selectedStop.name}
                {selectedStop.code && !selectedStop.name.includes(selectedStop.code)
                  ? ` ${selectedStop.code}`
                  : ''}
              </Text>
              <Text style={styles.metaMuted} numberOfLines={1}>
                {s.liveMap.stopBoardTitle}
                {selectedStop.code ? ` · ${s.liveMap.stopCodeLabel(selectedStop.code)}` : ''}
              </Text>
            </View>
            <SpringPressable
              onPress={handleClearSelection}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel={s.liveMap.closeSheetA11y}
              style={styles.closeBtn}
              scaleDelta={0.05}
            >
              <X size={20} color={scheme.onSurfaceVariant} />
            </SpringPressable>
          </View>

          {!gtfsLoaded ? (
            <View style={styles.emptyBoardBox}>
              <Text style={styles.metaMuted}>{s.liveMap.stopBoardUnavailable}</Text>
            </View>
          ) : stopDepartures.length === 0 ? (
            <View style={styles.emptyBoardBox}>
              <Text style={styles.metaMuted}>{s.liveMap.stopNoDepartures}</Text>
            </View>
          ) : (
            <ScrollView
              style={styles.boardScroll}
              contentContainerStyle={styles.boardScrollContent}
              nestedScrollEnabled
              showsVerticalScrollIndicator={false}
            >
              {stopDepartures.map((dep, idx) => {
                const diffMin = Math.round((dep.expectedSec - nowSec) / 60);
                const statusColor = !dep.live
                  ? scheme.onSurfaceVariant
                  : dep.delayMin != null && dep.delayMin > 0
                    ? scheme.warning
                    : dep.delayMin != null && dep.delayMin < 0
                      ? scheme.primary
                      : scheme.success;
                const statusText = !dep.live
                  ? s.liveMap.scheduledOnly
                  : dep.delayMin != null && dep.delayMin > 0
                    ? s.liveMap.delayLate(dep.delayMin)
                    : dep.delayMin != null && dep.delayMin < 0
                      ? s.liveMap.delayEarly(Math.abs(dep.delayMin))
                      : s.liveMap.delayOnTime;

                return (
                  <SpringPressable
                    key={`${dep.tripId}-${idx}`}
                    disabled={!dep.vehicleId}
                    onPress={() => {
                      if (dep.vehicleId) handleSelectVehicle(dep.vehicleId);
                    }}
                    accessibilityRole={dep.vehicleId ? 'button' : 'text'}
                    style={[styles.depRow, idx > 0 && styles.depRowBorder]}
                    scaleDelta={0.015}
                  >
                    <MapLinePill
                      mode={dep.mode}
                      line={dep.line}
                      bg={dep.bg}
                      fg={dep.fg}
                    />
                    <View style={styles.depInfo}>
                      <Text style={styles.depHeadsign} numberOfLines={1}>
                        {dep.headsign}
                      </Text>
                      <Text style={[styles.depSub, { color: statusColor }]} numberOfLines={1}>
                        {statusText}
                        {' · '}
                        {secondsToTimeString(dep.expectedSec)}
                      </Text>
                    </View>
                    <Text style={[styles.depCountdown, { color: statusColor }]}>
                      {s.liveMap.departInMin(diffMin)}
                    </Text>
                  </SpringPressable>
                );
              })}
            </ScrollView>
          )}
        </Animated.View>
      )}

      {/* Dolna tablica kolejnych przystankow wybranego pojazdu oraz CTA */}
      {selectedVehicle && selectedMeta && (
        <Animated.View
          key={`vehicle-${selectedVehicle.vehicleId}`}
          entering={SHEET_ENTERING}
          exiting={SHEET_EXITING}
          layout={SMOOTH_LAYOUT}
          onLayout={handleSheetLayout}
          style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, 16) + 4 }]}
        >
          <View style={styles.sheetHandle} />
          <View style={styles.sheetHeader}>
            <MapLinePill
              mode={selectedMeta.mode}
              line={selectedVehicle.line}
              bg={selectedMeta.bg}
              fg={selectedMeta.fg}
              large
            />
            <View style={styles.sheetTitleWrap}>
              <Text style={styles.sheetTitle} numberOfLines={1}>
                {selectedMeta.direction
                  ? s.liveMap.vehicleTowards(selectedMeta.direction)
                  : selectedVehicle.line}
              </Text>
              <View style={styles.metaRow}>
                {selectedMeta.delayMin === 0 ? (
                  <Text style={[styles.delayText, { color: scheme.success }]}>
                    {s.liveMap.delayOnTime}
                  </Text>
                ) : selectedMeta.delayMin != null && selectedMeta.delayMin > 0 ? (
                  <Text style={[styles.delayText, { color: scheme.warning }]}>
                    {s.liveMap.delayLate(selectedMeta.delayMin)}
                  </Text>
                ) : selectedMeta.delayMin != null && selectedMeta.delayMin < 0 ? (
                  <Text style={[styles.delayText, { color: scheme.primary }]}>
                    {s.liveMap.delayEarly(Math.abs(selectedMeta.delayMin))}
                  </Text>
                ) : (
                  <Text style={styles.metaMuted}>{s.liveMap.delayUnknown}</Text>
                )}

                {selectedMeta.distM !== null && (
                  <Text style={styles.metaMuted}>
                    {' · '}
                    {s.liveMap.distanceAway(selectedMeta.distM)}
                  </Text>
                )}
              </View>
            </View>
            <SpringPressable
              onPress={handleClearSelection}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel={s.liveMap.closeSheetA11y}
              style={styles.closeBtn}
              scaleDelta={0.05}
            >
              <X size={20} color={scheme.onSurfaceVariant} />
            </SpringPressable>
          </View>

          {vehicleBoard.length > 0 ? (
            <View style={styles.vehicleBoardWrap}>
              <Text style={styles.sectionLabel}>{s.liveMap.vehicleBoardTitle}</Text>
              <ScrollView
                style={styles.vehicleBoardScroll}
                contentContainerStyle={styles.boardScrollContent}
                nestedScrollEnabled
                showsVerticalScrollIndicator={false}
              >
                {vehicleBoard.map((stop, idx) => {
                  const diffMin = Math.round((stop.expectedSec - nowSec) / 60);
                  return (
                    <SpringPressable
                      key={`${stop.stopId}-${idx}`}
                      onPress={() => handleSelectStop(stop.stopId)}
                      accessibilityRole="button"
                      style={[styles.vehStopRow, idx > 0 && styles.depRowBorder]}
                      scaleDelta={0.015}
                    >
                      <View
                        style={[
                          styles.timelineDot,
                          stop.isNext && styles.timelineDotNext,
                        ]}
                      />
                      <Text
                        style={[
                          styles.vehStopName,
                          stop.isNext && styles.vehStopNameNext,
                        ]}
                        numberOfLines={1}
                      >
                        {stop.stopName}
                      </Text>
                      <Text style={styles.vehStopTime}>
                        {secondsToTimeString(stop.expectedSec)}
                      </Text>
                      <Text style={styles.vehStopCountdown}>
                        {s.liveMap.departInMin(diffMin)}
                      </Text>
                    </SpringPressable>
                  );
                })}
              </ScrollView>
            </View>
          ) : selectedMeta.nextStop ? (
            <Text style={styles.nextStopText} numberOfLines={2}>
              {s.liveMap.nextStop(selectedMeta.nextStop)}
            </Text>
          ) : (
            <Text style={styles.metaMuted}>{s.liveMap.vehicleNoStops}</Text>
          )}

          {selectedOrigin ? (
            <SpringPressable
              onPress={handleBoardVehicle}
              accessibilityRole="button"
              accessibilityLabel={s.liveMap.boardCta}
              style={styles.boardBtn}
            >
              <Text style={styles.boardBtnText}>{s.liveMap.boardCta}</Text>
            </SpringPressable>
          ) : (
            <View style={styles.unmatchedBox}>
              <Text style={styles.unmatchedTitle}>{s.liveMap.unmatchedTitle}</Text>
              <Text style={styles.unmatchedBody}>{s.liveMap.unmatchedBody}</Text>
            </View>
          )}
        </Animated.View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: scheme.surface,
  },
  topOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    paddingHorizontal: 14,
    gap: 10,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  circleBtn: {
    width: 48,
    height: 48,
    borderRadius: shape.large,
    backgroundColor: scheme.surfaceContainerHigh,
    alignItems: 'center',
    justifyContent: 'center',
    ...elev.level2,
  },
  titlePill: {
    flex: 1,
    minHeight: 48,
    borderRadius: shape.large,
    backgroundColor: scheme.surfaceContainerHigh,
    paddingHorizontal: 14,
    paddingVertical: 7,
    justifyContent: 'center',
    ...elev.level2,
  },
  titleText: {
    ...type.titleSmall,
    color: scheme.onSurface,
    fontWeight: '700',
  },
  countText: {
    ...type.bodySmall,
    color: scheme.onSurfaceVariant,
    fontVariant: ['tabular-nums'],
  },
  filterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 2,
  },
  filterChip: {
    minHeight: 44,
    paddingHorizontal: 14,
    borderRadius: shape.full,
    backgroundColor: scheme.surfaceContainerHigh,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    ...elev.level1,
  },
  filterChipActive: {
    backgroundColor: scheme.primaryContainer,
  },
  disruptionChipActive: {
    backgroundColor: scheme.errorContainer,
  },
  filterText: {
    ...type.labelLarge,
    color: scheme.onSurfaceVariant,
  },
  filterTextActive: {
    color: scheme.onPrimaryContainer,
    fontWeight: '700',
  },
  disruptionChipTextActive: {
    color: scheme.onErrorContainer,
    fontWeight: '700',
  },
  statusBanner: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: shape.medium,
    backgroundColor: scheme.surfaceContainerHigh,
    ...elev.level1,
  },
  statusBannerText: {
    ...type.bodySmall,
    color: scheme.onSurfaceVariant,
    flexShrink: 1,
  },
  centerBadge: {
    position: 'absolute',
    alignSelf: 'center',
    top: '48%',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: shape.large,
    backgroundColor: scheme.surfaceContainerHigh,
    ...elev.level2,
  },
  centerBadgeText: {
    ...type.bodyMedium,
    color: scheme.onSurface,
  },
  emptyCard: {
    position: 'absolute',
    left: 16,
    right: 16,
    padding: 16,
    borderRadius: shape.extraLarge,
    backgroundColor: scheme.surfaceContainerHigh,
    gap: 4,
    ...elev.level2,
  },
  errorCard: {
    position: 'absolute',
    left: 16,
    right: 16,
    padding: 16,
    borderRadius: shape.extraLarge,
    backgroundColor: scheme.surfaceContainerHigh,
    gap: 12,
    ...elev.level3,
  },
  errorHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  errorIconBox: {
    width: 40,
    height: 40,
    borderRadius: shape.medium,
    backgroundColor: scheme.errorContainer,
    alignItems: 'center',
    justifyContent: 'center',
  },
  errorTextWrap: {
    flex: 1,
    gap: 2,
  },
  retryBtn: {
    minHeight: 48,
    borderRadius: shape.large,
    backgroundColor: scheme.primary,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingHorizontal: 16,
  },
  retryBtnText: {
    ...type.titleSmall,
    color: scheme.onPrimary,
    fontWeight: '700',
  },
  emptyTitle: {
    ...type.titleSmall,
    color: scheme.onSurface,
    fontWeight: '700',
  },
  emptyBody: {
    ...type.bodySmall,
    color: scheme.onSurfaceVariant,
  },
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: scheme.surfaceContainerHigh,
    borderTopLeftRadius: shape.extraLarge,
    borderTopRightRadius: shape.extraLarge,
    paddingHorizontal: 20,
    paddingTop: 10,
    gap: 12,
    ...elev.level3,
  },
  sheetHandle: {
    width: 36,
    height: 4,
    borderRadius: shape.full,
    backgroundColor: scheme.outlineVariant,
    alignSelf: 'center',
    marginBottom: 2,
  },
  sheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  stopIconBox: {
    width: 40,
    height: 40,
    borderRadius: shape.medium,
    alignItems: 'center',
    justifyContent: 'center',
  },
  mapPill: {
    minHeight: 28,
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: shape.small,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  mapPillLarge: {
    minHeight: 34,
    paddingHorizontal: 11,
    paddingVertical: 6,
    borderRadius: shape.medium,
    gap: 6,
  },
  mapPillText: {
    ...type.labelLarge,
    fontWeight: '800',
    fontVariant: ['tabular-nums'],
  },
  mapPillTextLarge: {
    ...type.titleSmall,
    fontWeight: '800',
  },
  sheetTitleWrap: {
    flex: 1,
    gap: 3,
  },
  sheetTitle: {
    ...type.titleMedium,
    color: scheme.onSurface,
    fontWeight: '700',
  },
  disruptionBadgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  severityPill: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: shape.small,
  },
  severityPillText: {
    ...type.labelMedium,
    fontWeight: '700',
  },
  disruptionLinesRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  disruptionMetaBox: {
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderRadius: shape.medium,
    backgroundColor: scheme.surfaceContainer,
  },
  disruptionCorridorText: {
    ...type.bodyMedium,
    color: scheme.onSurface,
    fontWeight: '600',
  },
  disruptionBody: {
    ...type.bodyMedium,
    color: scheme.onSurface,
  },
  disruptionSolution: {
    ...type.bodySmall,
    color: scheme.onSurfaceVariant,
  },
  replacementPill: {
    alignSelf: 'flex-start',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: shape.small,
    backgroundColor: scheme.secondaryContainer,
  },
  replacementText: {
    ...type.labelMedium,
    color: scheme.onSecondaryContainer,
    fontWeight: '700',
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
  },
  delayText: {
    ...type.labelMedium,
    fontWeight: '700',
  },
  metaMuted: {
    ...type.bodySmall,
    color: scheme.onSurfaceVariant,
  },
  closeBtn: {
    width: 44,
    height: 44,
    borderRadius: shape.full,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: scheme.surfaceContainerHighest,
  },
  boardScroll: {
    maxHeight: 290,
  },
  boardScrollContent: {
    paddingBottom: 4,
  },
  emptyBoardBox: {
    paddingVertical: 14,
  },
  depRow: {
    minHeight: 54,
    paddingVertical: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  depRowBorder: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: scheme.outlineVariant,
  },
  depInfo: {
    flex: 1,
    gap: 2,
  },
  depHeadsign: {
    ...type.bodyLarge,
    color: scheme.onSurface,
    fontWeight: '600',
  },
  depSub: {
    ...type.bodySmall,
    fontVariant: ['tabular-nums'],
  },
  depCountdown: {
    ...type.labelLarge,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  vehicleBoardWrap: {
    gap: 6,
  },
  sectionLabel: {
    ...type.labelMedium,
    color: scheme.onSurfaceVariant,
    fontWeight: '700',
  },
  vehicleBoardScroll: {
    maxHeight: 200,
  },
  vehStopRow: {
    minHeight: 44,
    paddingVertical: 6,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  timelineDot: {
    width: 8,
    height: 8,
    borderRadius: shape.full,
    backgroundColor: scheme.outline,
  },
  timelineDotNext: {
    width: 10,
    height: 10,
    backgroundColor: scheme.primary,
  },
  vehStopName: {
    flex: 1,
    ...type.bodyMedium,
    color: scheme.onSurfaceVariant,
  },
  vehStopNameNext: {
    color: scheme.onSurface,
    fontWeight: '700',
  },
  vehStopTime: {
    ...type.bodyMedium,
    color: scheme.onSurface,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
  },
  vehStopCountdown: {
    ...type.labelMedium,
    color: scheme.primary,
    fontWeight: '700',
    minWidth: 52,
    textAlign: 'right',
    fontVariant: ['tabular-nums'],
  },
  nextStopText: {
    ...type.bodyMedium,
    color: scheme.onSurfaceVariant,
  },
  boardBtn: {
    minHeight: 52,
    borderRadius: shape.large,
    backgroundColor: scheme.primary,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingHorizontal: 16,
  },
  boardBtnText: {
    ...type.titleSmall,
    color: scheme.onPrimary,
    fontWeight: '700',
  },
  unmatchedBox: {
    padding: 12,
    borderRadius: shape.medium,
    backgroundColor: scheme.surfaceContainer,
    gap: 4,
  },
  unmatchedTitle: {
    ...type.labelLarge,
    color: scheme.warning,
    fontWeight: '700',
  },
  unmatchedBody: {
    ...type.bodySmall,
    color: scheme.onSurfaceVariant,
  },
});
