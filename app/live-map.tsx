// Pełnoekranowa mapa pojazdów, przystanków i utrudnień na żywo w stylu M3 Expressive:
// pływająca wyszukiwarka linii i przystanków, filtry z licznikami live, kropki na oddaleniu
// przechodzące w pigułki linii, prawa szyna akcji (śledzenie, cała trasa, zoom, GPS) oraz
// rozwijane dolne karty pojazdu, przystanku i utrudnienia.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  BackHandler,
  Keyboard,
  type LayoutChangeEvent,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
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
import { MorphingLoader } from '../src/components/MorphingLoader';
import * as Haptics from 'expo-haptics';
import {
  ArrowLeft,
  BusFront,
  CableCar,
  ChevronDown,
  ChevronUp,
  Clock3,
  ExternalLink,
  LocateFixed,
  MapPin,
  Minus,
  Navigation,
  Plus,
  RefreshCw,
  ScanLine,
  Search,
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
import { MapActionRail, type MapActionItem } from '../src/components/MapActionRail';
import { SpringPressable } from '../src/components/SpringPressable';
import { useEscapeKey, useWebLayout } from '../src/theme/layout';
import type {
  LiveMapDelaySegmentItem,
  LiveMapDisruptionItem,
  LiveMapSelectedRoute,
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
import { resolveLineBadgeIdentity } from '../src/services/lineIdentity';
import {
  buildLiveMapStops,
  buildSelectedVehicleRoute,
  getStopDepartureBoard,
  getVehicleUpcomingBoard,
  loadLiveMapSchedule,
  resolveNationalTrainVehicleRoute,
  type LiveMapScheduleContext,
  type LiveVehicleRoute,
  type VehicleStopEta,
} from '../src/services/liveMapBoard';
import {
  buildLiveMapDisruptions,
  type LiveMapDisruptionMarker,
} from '../src/services/liveMapDisruptions';
import {
  buildLiveMapDelayCorridors,
  corridorGeometryCacheKey,
  getCachedRoadCorridorGeometry,
  polylineMidpointLonLat,
  resolveRoadCorridorGeometry,
  type LiveMapDelayCorridor,
} from '../src/services/liveMapDelays';
import {
  fetchBackendDelayHubs,
  type DelayHubSummary,
  type ViewportBbox,
} from '../src/services/kilometrApi';
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
import {
  ensureRailTrackShapes,
  getCachedRailTrackBearing,
  projectRouteTangent,
  resolveLiveVehicleRouteGeometry,
} from '../src/services/routeGeometry';
import { gtfsStore } from '../src/services/routing/store';
import { useScreenTransitionSettled } from '../src/hooks/useScreenTransitionSettled';
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
const MAP_LOADER_EXITING = FadeOut.duration(220).reduceMotion(motion.state.reduceMotion);
const SMOOTH_LAYOUT = LinearTransition.duration(motion.state.duration)
  .easing(motion.state.easing)
  .reduceMotion(motion.state.reduceMotion);

function normalizeSearch(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/ł/g, 'l');
}

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
  const webLayout = useWebLayout();
  const { height: windowHeight } = useWindowDimensions();
  const { cityId, city } = useActiveCity();
  const transitionSettled = useScreenTransitionSettled();
  const [screenFocused, setScreenFocused] = useState(false);
  const { returnTo } = useLocalSearchParams<{ returnTo?: string }>();
  const returnTarget: 'home' | 'routes' = returnTo === 'routes' ? 'routes' : 'home';

  const mapRef = useRef<LiveVehiclesMapHandle>(null);
  const searchInputRef = useRef<TextInput>(null);
  const { location: userLoc } = useCurrentLocation(true, false);

  const [vehicles, setVehicles] = useState<TrackedVehicle[]>(() => liveTracker.snapshot());
  const [filter, setFilter] = useState<ModeFilter>('all');
  const [lineFilter, setLineFilter] = useState<string | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [showStops, setShowStops] = useState(true);
  const [showDisruptions, setShowDisruptions] = useState(true);
  const [showDelays, setShowDelays] = useState(true);
  const [followVehicle, setFollowVehicle] = useState(false);
  const [zoomMode, setZoomMode] = useState<'dots' | 'pills'>('pills');
  const [sheetExpanded, setSheetExpanded] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedStopId, setSelectedStopId] = useState<string | null>(null);
  const [routeStopFallback, setRouteStopFallback] = useState<LiveMapStopItem | null>(null);
  const [selectedDisruptionId, setSelectedDisruptionId] = useState<string | null>(null);
  const [selectedDelayId, setSelectedDelayId] = useState<string | null>(null);
  const [backendDelayHubs, setBackendDelayHubs] = useState<{
    city: string;
    hubs: DelayHubSummary[];
    updatedAt: number;
  } | null>(null);
  const [roadGeomVersion, setRoadGeomVersion] = useState(0);
  const viewportRef = useRef<ViewportBbox | null>(null);
  const [newsItems, setNewsItems] = useState<MpkNewsItem[]>(() => getCachedNews() ?? []);
  const [offlineBase, setOfflineBase] = useState<string | null | undefined>(undefined);
  const [gtfsLoaded, setGtfsLoaded] = useState(() => gtfsStore.isLoaded);
  const [scheduleCtx, setScheduleCtx] = useState<LiveMapScheduleContext | null>(null);
  const [nowSec, setNowSec] = useState(() => warsawNow().sec);
  const [showOfflinePill, setShowOfflinePill] = useState(false);
  const [mapError, setMapError] = useState<string | null>(null);
  const [mapRendered, setMapRendered] = useState(false);
  const [sheetHeight, setSheetHeight] = useState(0);
  const [railShapeVersion, setRailShapeVersion] = useState(0);
  const [asyncRouteData, setAsyncRouteData] = useState<{
    key: string;
    coords?: [number, number][];
    nationalRoute?: LiveVehicleRoute;
    upcoming?: VehicleStopEta[];
  } | null>(null);
  // Bez sieci pierwszy poll live nigdy nie kończy się sukcesem, więc bez
  // timeoutu spinner "Ładowanie pojazdów" wisiałby w nieskończoność.
  const [liveWaitExpired, setLiveWaitExpired] = useState(false);
  const offlinePillTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const motionRef = useRef(
    new Map<
      string,
      {
        lat: number;
        lon: number;
        bearing?: number;
        tripId?: string;
        routeBearing?: number;
        checkedGtfs?: boolean;
      }
    >(),
  );

  useFocusEffect(
    useCallback(() => {
      setScreenFocused(true);
      return () => {
        setScreenFocused(false);
      };
    }, []),
  );

  useEffect(() => {
    if (!transitionSettled || !screenFocused) return;
    liveTracker.acquire(true);
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
          // Ciche zachowanie istniejącego cache komunikatów przy braku sieci.
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
    const refreshDelayHubs = () => {
      if (cancelled) return;
      void fetchBackendDelayHubs(cityId, viewportRef.current)
        .then((hubs) => {
          if (!cancelled && hubs) {
            setBackendDelayHubs({ city: cityId, hubs, updatedAt: Date.now() });
          }
        })
        .catch(() => {});
    };
    refreshDelayHubs();
    const delayHubsTimer = setInterval(refreshDelayHubs, 30000);
    return () => {
      cancelled = true;
      newsController.abort();
      clearInterval(clock);
      clearInterval(delayHubsTimer);
      clearTimeout(liveWaitTimer);
      unsubNews();
      unsub();
      liveTracker.setMapViewport(null);
      liveTracker.release(true);
    };
  }, [city.features.news, cityId, screenFocused, transitionSettled]);

  useEffect(() => {
    if (!transitionSettled) return;
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
  }, [cityId, transitionSettled]);

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

  useEffect(() => {
    if (!transitionSettled) return;
    const railCandidates: Array<{
      vehicleId: string;
      line: string;
      matchedTripId?: string;
      lat: number;
      lon: number;
      currentStopName?: string;
      nextStopName?: string;
    }> = [];
    for (const v of vehicles) {
      if (!Number.isFinite(v.lat) || !Number.isFinite(v.lon)) continue;
      const id = resolveLineBadgeIdentity({ mode: v.type, line: v.line, cityId });
      if (id.resolvedMode !== 'train') continue;
      railCandidates.push({
        vehicleId: v.vehicleId,
        line: v.line,
        matchedTripId: v.matchedTripId,
        lat: v.lat,
        lon: v.lon,
        currentStopName: v.currentStopName,
        nextStopName: v.nextStopName,
      });
    }
    if (railCandidates.length === 0) return;
    const ctrl = new AbortController();
    void ensureRailTrackShapes(railCandidates, ctrl.signal).then((resolved) => {
      if (!ctrl.signal.aborted && resolved) {
        setRailShapeVersion((n) => n + 1);
      }
    });
    return () => ctrl.abort();
  }, [cityId, transitionSettled, vehicles]);

  // Pełna lista pojazdów przed filtrami (do liczników i wyszukiwarki linii).
  const allVehicleItems = useMemo<LiveMapVehicleItem[]>(() => {
    if (!transitionSettled) return [];
    void railShapeVersion;
    const out: LiveMapVehicleItem[] = [];
    const seen = new Set<string>();
    const identityCache = new Map<string, ReturnType<typeof resolveLineBadgeIdentity>>();
    const angleDiff = (a: number, b: number): number => {
      const d = Math.abs(a - b) % 360;
      return d > 180 ? 360 - d : d;
    };

    for (const v of vehicles) {
      if (!Number.isFinite(v.lat) || !Number.isFinite(v.lon)) continue;
      seen.add(v.vehicleId);

      const prevMotion = motionRef.current.get(v.vehicleId);
      const movedFar = prevMotion
        ? distanceMeters(prevMotion.lat, prevMotion.lon, v.lat, v.lon) >= 12
        : true;
      let observedBearing = prevMotion?.bearing;
      if (prevMotion && movedFar) {
        observedBearing =
          Math.round(bearingDegrees(prevMotion.lat, prevMotion.lon, v.lat, v.lon)) % 360;
      }

      const idKey = `${v.type ?? ''}\0${v.line ?? ''}`;
      let identity = identityCache.get(idKey);
      if (!identity) {
        identity = resolveLineBadgeIdentity({ mode: v.type, line: v.line, cityId });
        identityCache.set(idKey, identity);
      }

      const resolvedMode: Exclude<LegMode, 'walk'> =
        identity.resolvedMode === 'walk' ? 'bus' : identity.resolvedMode;

      const canReuseRouteBearing =
        Boolean(prevMotion) &&
        !movedFar &&
        prevMotion?.tripId === v.matchedTripId &&
        Boolean(prevMotion?.checkedGtfs) === gtfsLoaded;

      const routeBearing = canReuseRouteBearing
        ? prevMotion?.routeBearing
        : gtfsLoaded
          ? resolveVehicleBearing(v, gtfsStore)
          : undefined;

      if (
        !prevMotion ||
        movedFar ||
        prevMotion.tripId !== v.matchedTripId ||
        prevMotion.checkedGtfs !== gtfsLoaded
      ) {
        motionRef.current.set(v.vehicleId, {
          lat: movedFar ? v.lat : prevMotion?.lat ?? v.lat,
          lon: movedFar ? v.lon : prevMotion?.lon ?? v.lon,
          bearing: observedBearing,
          tripId: v.matchedTripId,
          routeBearing,
          checkedGtfs: gtfsLoaded,
        });
      }

      const rawFeedB =
        typeof v.bearing === 'number' && Number.isFinite(v.bearing)
          ? ((v.bearing % 360) + 360) % 360
          : undefined;
      const feedBearing =
        rawFeedB === 0 && observedBearing !== undefined && angleDiff(0, observedBearing) > 35
          ? undefined
          : rawFeedB;
      const liveHeading = feedBearing ?? observedBearing;

      let selectedRouteBearing: number | undefined;
      if (v.vehicleId === selectedId && asyncRouteData?.key.startsWith(`${v.vehicleId}|`)) {
        const geom = asyncRouteData.coords ?? asyncRouteData.nationalRoute?.coords;
        if (geom && geom.length >= 2) {
          const tan = projectRouteTangent(
            geom,
            v.lat,
            v.lon,
            resolvedMode === 'train' ? 2500 : 250,
            resolvedMode === 'train' ? 40 : 25,
          );
          if (tan) selectedRouteBearing = Math.round(tan.heading) % 360;
        }
      }

      const railShapeBearing =
        selectedRouteBearing === undefined && resolvedMode === 'train'
          ? getCachedRailTrackBearing(
              {
                vehicleId: v.vehicleId,
                line: v.line,
                matchedTripId: v.matchedTripId,
                lat: v.lat,
                lon: v.lon,
                currentStopName: v.currentStopName,
                nextStopName: v.nextStopName,
              },
              routeBearing ?? liveHeading,
            )
          : undefined;

      let finalBearing: number | undefined;
      let bearingExact = false;
      if (selectedRouteBearing !== undefined) {
        finalBearing = selectedRouteBearing;
        bearingExact = true;
      } else if (railShapeBearing !== undefined) {
        finalBearing = railShapeBearing;
        bearingExact = true;
      } else if (routeBearing !== undefined) {
        finalBearing =
          liveHeading !== undefined && angleDiff(routeBearing, liveHeading) <= 105
            ? liveHeading
            : routeBearing;
      } else {
        finalBearing = liveHeading;
      }

      out.push({
        id: v.vehicleId,
        line: identity.normalizedLine || v.line || '?',
        mode: resolvedMode,
        bg: identity.bg,
        fg: identity.fg,
        railAgency: identity.railAgency,
        lat: v.lat,
        lon: v.lon,
        bearing: finalBearing,
        bearingExact,
        delaySec: v.delaySec ?? null,
        updatedAt: v.updatedAt,
      });
    }
    for (const key of motionRef.current.keys()) {
      if (!seen.has(key)) motionRef.current.delete(key);
    }
    return out;
  }, [asyncRouteData, cityId, gtfsLoaded, railShapeVersion, selectedId, transitionSettled, vehicles]);

  const modeCounts = useMemo(() => {
    let tram = 0;
    let bus = 0;
    let train = 0;
    for (const item of allVehicleItems) {
      if (item.mode === 'tram') tram += 1;
      else if (item.mode === 'bus' || item.mode === 'trolleybus') bus += 1;
      else train += 1;
    }
    return { all: allVehicleItems.length, tram, bus, train };
  }, [allVehicleItems]);

  const mapItems = useMemo<LiveMapVehicleItem[]>(() => {
    const normalizedLineFilter = lineFilter ? normalizeSearch(lineFilter) : null;
    return allVehicleItems.filter((item) => {
      if (!matchesFilter(item.mode, filter)) return false;
      if (normalizedLineFilter && normalizeSearch(item.line) !== normalizedLineFilter) {
        return false;
      }
      return true;
    });
  }, [allVehicleItems, filter, lineFilter]);

  const mapStops = useMemo<LiveMapStopItem[]>(() => {
    if (!gtfsLoaded) return [];
    return buildLiveMapStops(gtfsStore, scheduleCtx?.dayIndex ?? null, cityId);
  }, [cityId, gtfsLoaded, scheduleCtx?.dayIndex]);

  // Indeks wyszukiwarki: aktywne linie live + przystanki GTFS.
  const searchResults = useMemo(() => {
    const q = normalizeSearch(searchQuery);
    if (!searchOpen || q.length === 0) return { lines: [], stops: [] };

    const lineMap = new Map<
      string,
      { line: string; mode: Exclude<LegMode, 'walk'>; count: number; nearestId: string; lat: number; lon: number; dist: number }
    >();
    const refLat = userLoc?.lat ?? city.center.lat;
    const refLon = userLoc?.lon ?? city.center.lon;

    for (const item of allVehicleItems) {
      const norm = normalizeSearch(item.line);
      if (!norm.includes(q)) continue;
      const d = distanceMeters(refLat, refLon, item.lat, item.lon);
      const existing = lineMap.get(item.line);
      if (!existing) {
        lineMap.set(item.line, {
          line: item.line,
          mode: item.mode,
          count: 1,
          nearestId: item.id,
          lat: item.lat,
          lon: item.lon,
          dist: d,
        });
      } else {
        existing.count += 1;
        if (d < existing.dist) {
          existing.nearestId = item.id;
          existing.lat = item.lat;
          existing.lon = item.lon;
          existing.dist = d;
        }
      }
    }

    const lines = [...lineMap.values()]
      .sort((a, b) => {
        const aExact = normalizeSearch(a.line) === q ? 0 : 1;
        const bExact = normalizeSearch(b.line) === q ? 0 : 1;
        if (aExact !== bExact) return aExact - bExact;
        const aStarts = normalizeSearch(a.line).startsWith(q) ? 0 : 1;
        const bStarts = normalizeSearch(b.line).startsWith(q) ? 0 : 1;
        if (aStarts !== bStarts) return aStarts - bStarts;
        return a.line.localeCompare(b.line, undefined, { numeric: true });
      })
      .slice(0, 8);

    const stops: LiveMapStopItem[] = [];
    if (q.length >= 2) {
      const seenNames = new Set<string>();
      for (const st of mapStops) {
        const norm = normalizeSearch(st.name);
        if (!norm.includes(q)) continue;
        const dedupeKey = `${norm}|${st.code ?? ''}`;
        if (seenNames.has(dedupeKey)) continue;
        seenNames.add(dedupeKey);
        stops.push(st);
        if (stops.length >= 8) break;
      }
      stops.sort((a, b) => {
        const aStarts = normalizeSearch(a.name).startsWith(q) ? 0 : 1;
        const bStarts = normalizeSearch(b.name).startsWith(q) ? 0 : 1;
        if (aStarts !== bStarts) return aStarts - bStarts;
        return (
          distanceMeters(refLat, refLon, a.lat, a.lon) -
          distanceMeters(refLat, refLon, b.lat, b.lon)
        );
      });
    }

    return { lines, stops: stops.slice(0, 6) };
  }, [allVehicleItems, city.center.lat, city.center.lon, mapStops, searchOpen, searchQuery, userLoc?.lat, userLoc?.lon]);

  const disruptionMarkers = useMemo<LiveMapDisruptionMarker[]>(() => {
    if (!city.features.news || newsItems.length === 0) return [];
    return buildLiveMapDisruptions(
      newsItems,
      gtfsLoaded ? gtfsStore : null,
      scheduleCtx?.dayIndex ?? null,
    );
  }, [city.features.news, gtfsLoaded, newsItems, scheduleCtx?.dayIndex]);

  const mapDisruptionItems = useMemo<LiveMapDisruptionItem[]>(() => {
    void roadGeomVersion;
    return disruptionMarkers.map((d) => {
      let corridorCoords: [number, number][] | undefined;
      let anchorLat = d.lat;
      let anchorLon = d.lon;
      if (d.corridorCoords.length >= 2) {
        const waypointsLatLon: [number, number][] = d.corridorCoords.map(([lon, lat]) => [lat, lon]);
        const routed = getCachedRoadCorridorGeometry(waypointsLatLon, d.mode);
        if (routed && routed.length >= 2) {
          corridorCoords = routed;
          const mid = polylineMidpointLonLat(routed);
          anchorLat = mid.lat;
          anchorLon = mid.lon;
        } else if (
          d.corridorCoords.length === 2 &&
          distanceMeters(
            d.corridorCoords[0][1],
            d.corridorCoords[0][0],
            d.corridorCoords[1][1],
            d.corridorCoords[1][0],
          ) <= 220
        ) {
          corridorCoords = d.corridorCoords;
        }
      }
      return {
        id: d.id,
        label: d.shortLabel,
        severity: d.severity,
        lat: anchorLat,
        lon: anchorLon,
        corridorCoords,
        stopPoints:
          d.affectedStops.length > 0
            ? d.affectedStops.map((st) => [st.lon, st.lat] as [number, number])
            : undefined,
      };
    });
  }, [disruptionMarkers, roadGeomVersion]);

  const stopsById = useMemo(() => {
    const map = new Map<string, LiveMapStopItem>();
    for (const st of mapStops) map.set(st.id, st);
    return map;
  }, [mapStops]);

  const selectedVehicle = useMemo(
    () => (selectedId ? (vehicles.find((v) => v.vehicleId === selectedId) ?? null) : null),
    [selectedId, vehicles],
  );

  // Podążanie kamery za zaznaczonym pojazdem live (z automatycznym wyłączeniem po przesunięciu mapy).
  useEffect(() => {
    if (!followVehicle) return;
    if (!selectedVehicle) {
      setFollowVehicle(false);
      return;
    }
    mapRef.current?.centerOn(selectedVehicle.lat, selectedVehicle.lon);
  }, [followVehicle, selectedVehicle]);

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
    const identity = resolveLineBadgeIdentity({
      mode: selectedVehicle.type,
      line: selectedVehicle.line,
      cityId,
    });
    const mode: Exclude<LegMode, 'walk'> =
      identity.resolvedMode === 'walk' ? 'bus' : identity.resolvedMode;
    const direction = selectedOrigin?.direction || trip?.trip_headsign || '';
    const nextStop = selectedVehicle.nextStopName || '';
    const distM = userLoc
      ? Math.round(distanceMeters(userLoc.lat, userLoc.lon, selectedVehicle.lat, selectedVehicle.lon))
      : null;
    const delayMin =
      selectedVehicle.delaySec != null ? Math.round(selectedVehicle.delaySec / 60) : null;
    return {
      mode,
      bg: identity.bg,
      fg: identity.fg,
      line: identity.normalizedLine || selectedVehicle.line || '?',
      routeId: trip?.route_id ?? null,
      tripId: selectedVehicle.matchedTripId ?? null,
      direction,
      nextStop,
      distM,
      delayMin,
    };
  }, [cityId, gtfsLoaded, selectedOrigin, selectedVehicle, userLoc]);

  const localVehicleRoute = useMemo(() => {
    if (!selectedVehicle || !gtfsLoaded) return null;
    const motion = motionRef.current.get(selectedVehicle.vehicleId);
    return buildSelectedVehicleRoute(
      selectedVehicle,
      gtfsStore,
      scheduleCtx?.dayIndex ?? null,
      cityId,
      motion?.routeBearing ?? motion?.bearing,
    );
  }, [cityId, gtfsLoaded, scheduleCtx?.dayIndex, selectedVehicle]);

  const selectedVehicleRouteKey = selectedVehicle
    ? `${selectedVehicle.vehicleId}|${selectedVehicle.matchedTripId ?? ''}|${selectedVehicle.line}|${selectedVehicle.type ?? ''}`
    : '';

  const selectedVehicleRef = useRef(selectedVehicle);
  selectedVehicleRef.current = selectedVehicle;
  const localVehicleRouteRef = useRef(localVehicleRoute);
  localVehicleRouteRef.current = localVehicleRoute;
  const nowSecRef = useRef(nowSec);
  nowSecRef.current = nowSec;

  useEffect(() => {
    if (!selectedVehicleRouteKey) {
      setAsyncRouteData(null);
      return;
    }
    const veh = selectedVehicleRef.current;
    if (!veh) {
      setAsyncRouteData(null);
      return;
    }

    const ctrl = new AbortController();
    const localRoute = localVehicleRouteRef.current;

    if (localRoute) {
      setAsyncRouteData(null);
      if (
        localRoute.mode === 'train' ||
        localRoute.mode === 'bus' ||
        localRoute.mode === 'trolleybus'
      ) {
        void resolveLiveVehicleRouteGeometry({
          mode: localRoute.mode,
          line: localRoute.line,
          tripId: localRoute.tripId,
          color: localRoute.color,
          stops: localRoute.stops.map((st) => ({
            id: st.stopId,
            name: st.stopName,
            lat: st.lat,
            lon: st.lon,
          })),
          signal: ctrl.signal,
        })
          .then((coords) => {
            if (ctrl.signal.aborted || !coords || coords.length < 2) return;
            setAsyncRouteData({ key: selectedVehicleRouteKey, coords });
          })
          .catch(() => {});
      }
    } else {
      setAsyncRouteData(null);
      void resolveNationalTrainVehicleRoute(veh, cityId, nowSecRef.current, ctrl.signal)
        .then((res) => {
          if (ctrl.signal.aborted || !res) return;
          setAsyncRouteData({
            key: selectedVehicleRouteKey,
            nationalRoute: res.route,
            upcoming: res.upcoming,
          });
        })
        .catch(() => {});
    }

    return () => ctrl.abort();
  }, [cityId, gtfsLoaded, selectedVehicleRouteKey]);

  const selectedRoute = useMemo<LiveMapSelectedRoute | null>(() => {
    const activeRoute =
      localVehicleRoute ??
      (asyncRouteData?.key === selectedVehicleRouteKey ? asyncRouteData.nationalRoute : null);
    if (!activeRoute) return null;
    const coords =
      asyncRouteData?.key === selectedVehicleRouteKey && asyncRouteData.coords
        ? asyncRouteData.coords
        : activeRoute.coords;
    return {
      color: activeRoute.color,
      coords,
      stops: activeRoute.stops.map((st) => ({
        id: st.stopId,
        name: st.stopName,
        lat: st.lat,
        lon: st.lon,
        passed: st.passed,
        isNext: st.isNext,
      })),
    };
  }, [asyncRouteData, localVehicleRoute, selectedVehicleRouteKey]);

  const vehicleBoard = useMemo(() => {
    if (!selectedVehicle) return [];
    const localBoard = gtfsLoaded
      ? getVehicleUpcomingBoard(selectedVehicle, gtfsStore, nowSec)
      : [];
    if (localBoard.length > 0) return localBoard;
    if (asyncRouteData?.key === selectedVehicleRouteKey && asyncRouteData.upcoming) {
      return asyncRouteData.upcoming;
    }
    return [];
  }, [asyncRouteData, gtfsLoaded, nowSec, selectedVehicle, selectedVehicleRouteKey]);

  const selectedStop = useMemo(() => {
    if (!selectedStopId) return null;
    const item = stopsById.get(selectedStopId);
    if (item) return item;
    const raw = gtfsStore.stops.get(selectedStopId);
    if (raw) {
      const { bg, fg } = resolveLineBadgeIdentity({ mode: 'bus', cityId });
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
    }
    if (routeStopFallback && routeStopFallback.id === selectedStopId) {
      return routeStopFallback;
    }
    return null;
  }, [cityId, routeStopFallback, selectedStopId, stopsById]);

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

  // Korytarze opóźnień wyznaczone z aktywnych pojazdów i lokalnego GTFS, wzbogacone o normy z backendu.
  const delayCorridors = useMemo<LiveMapDelayCorridor[]>(() => {
    if (!gtfsLoaded) return [];
    const hubs =
      backendDelayHubs &&
      backendDelayHubs.city === cityId &&
      Date.now() - backendDelayHubs.updatedAt < 120_000
        ? backendDelayHubs.hubs
        : null;
    return buildLiveMapDelayCorridors(
      vehicles,
      gtfsStore,
      scheduleCtx?.dayIndex ?? null,
      cityId,
      hubs,
    );
  }, [backendDelayHubs, cityId, gtfsLoaded, scheduleCtx?.dayIndex, vehicles]);

  // Lista zadań geometrii drogowej/torowej dla opóźnień oraz korytarzy utrudnień.
  const corridorRoutingTasks = useMemo(() => {
    const map = new Map<string, { waypoints: [number, number][]; mode: LiveMapDelayCorridor['mode'] }>();
    if (showDelays) {
      for (const c of delayCorridors) {
        if (c.waypoints.length < 2) continue;
        const key = corridorGeometryCacheKey(c.waypoints, c.mode);
        if (!map.has(key)) map.set(key, { waypoints: c.waypoints, mode: c.mode });
      }
    }
    if (showDisruptions) {
      for (const d of disruptionMarkers) {
        if (d.corridorCoords.length < 2) continue;
        const waypoints: [number, number][] = d.corridorCoords.map(([lon, lat]) => [lat, lon]);
        const key = corridorGeometryCacheKey(waypoints, d.mode);
        if (!map.has(key)) map.set(key, { waypoints, mode: d.mode });
      }
    }
    return Array.from(map.entries());
  }, [delayCorridors, disruptionMarkers, showDelays, showDisruptions]);

  const corridorRoutingKey = useMemo(
    () => corridorRoutingTasks.map(([k]) => k).join('|'),
    [corridorRoutingTasks],
  );
  const corridorRoutingTasksRef = useRef(corridorRoutingTasks);
  corridorRoutingTasksRef.current = corridorRoutingTasks;

  useEffect(() => {
    const tasks = corridorRoutingTasksRef.current.filter(
      ([, t]) => getCachedRoadCorridorGeometry(t.waypoints, t.mode) === undefined,
    );
    if (tasks.length === 0) return;

    const ctrl = new AbortController();
    let idx = 0;
    let resolvedAny = false;
    const CONCURRENCY = 4;

    const worker = async () => {
      while (idx < tasks.length && !ctrl.signal.aborted) {
        const current = tasks[idx++];
        if (!current) break;
        const res = await resolveRoadCorridorGeometry(
          current[1].waypoints,
          current[1].mode,
          ctrl.signal,
        );
        if (res && !ctrl.signal.aborted) {
          resolvedAny = true;
        }
      }
    };

    void Promise.all(
      Array.from({ length: Math.min(CONCURRENCY, tasks.length) }, () => worker()),
    ).then(() => {
      if (resolvedAny && !ctrl.signal.aborted) {
        setRoadGeomVersion((v) => v + 1);
      }
    });

    return () => ctrl.abort();
  }, [corridorRoutingKey]);

  const mapDelaySegments = useMemo<LiveMapDelaySegmentItem[]>(() => {
    void roadGeomVersion;
    const out: LiveMapDelaySegmentItem[] = [];
    for (const c of delayCorridors) {
      const routed = getCachedRoadCorridorGeometry(c.waypoints, c.mode);
      if (!routed || routed.length < 2) continue;
      const anchor = polylineMidpointLonLat(routed);
      out.push({
        id: c.id,
        label: `+${Math.max(1, Math.round(c.avgDelaySec / 60))}m`,
        severity: c.severity,
        coords: routed,
        anchorLat: anchor.lat,
        anchorLon: anchor.lon,
        showBadge: c.severity !== 'moderate' || c.avgDelaySec >= 180,
      });
    }
    return out;
  }, [delayCorridors, roadGeomVersion]);

  const selectedDelaySegment = useMemo(
    () =>
      selectedDelayId
        ? (delayCorridors.find((c) => c.id === selectedDelayId) ?? null)
        : null,
    [delayCorridors, selectedDelayId],
  );

  const closeSearch = useCallback(() => {
    setSearchOpen(false);
    setSearchQuery('');
    Keyboard.dismiss();
  }, []);

  const searchOpenRef = useRef(searchOpen);
  searchOpenRef.current = searchOpen;

  const handleOpenSearch = useCallback(() => {
    void Haptics.selectionAsync().catch(() => {});
    setSearchOpen(true);
    requestAnimationFrame(() => searchInputRef.current?.focus());
  }, []);

  const handleSelectVehicle = useCallback(
    (vehicleId: string) => {
      void Haptics.selectionAsync().catch(() => {});
      setSelectedStopId(null);
      setRouteStopFallback(null);
      setSelectedDisruptionId(null);
      setSelectedDelayId(null);
      setSelectedId(vehicleId);
      setFollowVehicle(false);
      setSheetExpanded(false);
      const found = vehicles.find((v) => v.vehicleId === vehicleId);
      if (found) {
        mapRef.current?.centerOn(found.lat, found.lon, 15.2);
      }
    },
    [vehicles],
  );

  const handleSelectStop = useCallback(
    (stopId: string) => {
      void Haptics.selectionAsync().catch(() => {});
      const routeStop = selectedRoute?.stops.find((item) => item.id === stopId);
      if (routeStop && !stopsById.has(stopId) && !gtfsStore.stops.has(stopId)) {
        const mode = selectedMeta?.mode ?? 'train';
        const { bg, fg } = resolveLineBadgeIdentity({
          mode,
          line: selectedMeta?.line,
          cityId,
        });
        setRouteStopFallback({
          id: routeStop.id,
          name: routeStop.name,
          lat: routeStop.lat,
          lon: routeStop.lon,
          mode,
          bg,
          fg,
        });
      } else {
        setRouteStopFallback(null);
      }
      setSelectedId(null);
      setFollowVehicle(false);
      setSelectedDisruptionId(null);
      setSelectedDelayId(null);
      setSelectedStopId(stopId);
      setSheetExpanded(false);
      const st = stopsById.get(stopId) ?? gtfsStore.stops.get(stopId) ?? routeStop;
      if (st) {
        const lat = 'lat' in st ? st.lat : st.stop_lat;
        const lon = 'lon' in st ? st.lon : st.stop_lon;
        if (Number.isFinite(lat) && Number.isFinite(lon)) {
          mapRef.current?.centerOn(lat, lon, 15.6);
        }
      }
    },
    [cityId, selectedMeta, selectedRoute, stopsById],
  );

  const handleSelectDisruption = useCallback(
    (disruptionId: string) => {
      void Haptics.selectionAsync().catch(() => {});
      setSelectedId(null);
      setFollowVehicle(false);
      setSelectedStopId(null);
      setRouteStopFallback(null);
      setSelectedDelayId(null);
      setSelectedDisruptionId(disruptionId);
      setSheetExpanded(false);
      const found = disruptionMarkers.find((d) => d.id === disruptionId);
      if (found) {
        mapRef.current?.centerOn(found.lat, found.lon, 14.4);
      }
    },
    [disruptionMarkers],
  );

  const handleSelectDelay = useCallback(
    (delayId: string) => {
      void Haptics.selectionAsync().catch(() => {});
      setSelectedId(null);
      setFollowVehicle(false);
      setSelectedStopId(null);
      setRouteStopFallback(null);
      setSelectedDisruptionId(null);
      setSelectedDelayId(delayId);
      setSheetExpanded(false);
      const found = mapDelaySegments.find((seg) => seg.id === delayId);
      if (found) {
        mapRef.current?.centerOn(found.anchorLat, found.anchorLon, 14.6);
      }
    },
    [mapDelaySegments],
  );

  const handleViewportChange = useCallback(
    (bbox: ViewportBbox) => {
      viewportRef.current = bbox;
      liveTracker.setMapViewport(bbox);
    },
    [],
  );

  const handleClearSelection = useCallback(() => {
    setSelectedId(null);
    setFollowVehicle(false);
    setSelectedStopId(null);
    setRouteStopFallback(null);
    setSelectedDisruptionId(null);
    setSelectedDelayId(null);
    setSheetExpanded(false);
    setSheetHeight(0);
  }, []);

  const handleUserDrag = useCallback(() => {
    setFollowVehicle(false);
  }, []);

  const handlePickSearchLine = useCallback(
    (entry: { line: string; nearestId: string; lat: number; lon: number }) => {
      closeSearch();
      setFilter('all');
      setLineFilter(entry.line);
      setSelectedStopId(null);
      setSelectedDisruptionId(null);
      setSelectedId(entry.nearestId);
      setFollowVehicle(true);
      mapRef.current?.centerOn(entry.lat, entry.lon, 15.2);
    },
    [closeSearch],
  );

  const handlePickSearchStop = useCallback(
    (stop: LiveMapStopItem) => {
      closeSearch();
      setShowStops(true);
      handleSelectStop(stop.id);
    },
    [closeSearch, handleSelectStop],
  );

  const handleToggleDisruptions = useCallback(() => {
    void Haptics.selectionAsync().catch(() => {});
    setShowDisruptions((prev) => {
      const next = !prev;
      if (!next) setSelectedDisruptionId(null);
      return next;
    });
  }, []);

  const handleToggleDelays = useCallback(() => {
    void Haptics.selectionAsync().catch(() => {});
    setShowDelays((prev) => {
      const next = !prev;
      if (!next) setSelectedDelayId(null);
      return next;
    });
  }, []);

  const handleToggleStops = useCallback(() => {
    void Haptics.selectionAsync().catch(() => {});
    setShowStops((prev) => {
      const next = !prev;
      if (!next) setSelectedStopId(null);
      return next;
    });
  }, []);

  const handleResetFilters = useCallback(() => {
    void Haptics.selectionAsync().catch(() => {});
    setFilter('all');
    setLineFilter(null);
  }, []);

  const handleRecenter = useCallback(() => {
    void Haptics.selectionAsync().catch(() => {});
    setFollowVehicle(false);
    if (userLoc) {
      mapRef.current?.centerOn(userLoc.lat, userLoc.lon, 15.2);
    } else {
      mapRef.current?.centerOn(city.center.lat, city.center.lon, 13.4);
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

  const handleOpenLineTimetable = useCallback(() => {
    if (!selectedMeta) return;
    void Haptics.selectionAsync().catch(() => {});
    router.push({
      pathname: '/line',
      params: {
        line: selectedMeta.line,
        mode: selectedMeta.mode,
        ...(selectedMeta.routeId ? { routeId: selectedMeta.routeId } : {}),
        ...(selectedMeta.tripId ? { tripId: selectedMeta.tripId } : {}),
        ...(selectedMeta.direction ? { direction: selectedMeta.direction } : {}),
      },
    });
  }, [router, selectedMeta]);

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

  useEffect(() => {
    setMapRendered(false);
  }, [cityId]);

  const handleMapReady = useCallback(() => {
    setMapError(null);
  }, []);

  const handleMapRendered = useCallback(() => {
    setMapError(null);
    setMapRendered(true);
  }, []);

  const handleMapReloading = useCallback(() => {
    setMapRendered(false);
  }, []);

  const handleRetryMap = useCallback(() => {
    void Haptics.selectionAsync().catch(() => {});
    setMapError(null);
    setMapRendered(false);
    mapRef.current?.reload();
  }, []);

  const handleSheetLayout = useCallback((e: LayoutChangeEvent) => {
    setSheetHeight(Math.round(e.nativeEvent.layout.height));
  }, []);

  const liveState = liveTracker.getLiveState();
  const isInitialLoading = vehicles.length === 0 && liveState === 'unknown' && !liveWaitExpired;
  const hasSheet = Boolean(
    (selectedVehicle && selectedMeta) || selectedStop || selectedDisruption || selectedDelaySegment,
  );
  useEscapeKey(hasSheet && !searchOpen, handleClearSelection);
  const hasSheetRef = useRef(hasSheet);
  hasSheetRef.current = hasSheet;
  // Wstecz zamyka najpierw wyszukiwarkę, potem panel pojazdu, przystanku lub alertu.
  useFocusEffect(
    useCallback(() => {
      const sub = BackHandler.addEventListener('hardwareBackPress', () => {
        if (searchOpenRef.current) {
          closeSearch();
          return true;
        }
        if (hasSheetRef.current) {
          handleClearSelection();
          return true;
        }
        return false;
      });
      return () => sub.remove();
    }, [closeSearch, handleClearSelection]),
  );
  const hasActiveFilter = filter !== 'all' || lineFilter !== null;
  const expandedBoardMaxHeight = Math.round(Math.min(windowHeight * 0.44, 380));

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
    return `${base} \u00b7 ${s.liveMap.disruptionsCount(disruptionMarkers.length)}`;
  }, [disruptionMarkers.length, isInitialLoading, mapItems.length, s.liveMap]);

  const railActions = useMemo<MapActionItem[]>(() => {
    const list: MapActionItem[] = [];
    if (selectedVehicle) {
      list.push({
        id: 'follow-vehicle',
        icon: Navigation,
        accessibilityLabel: s.liveMap.followVehicleA11y,
        active: followVehicle,
        onPress: () => {
          setFollowVehicle((prev) => {
            const next = !prev;
            if (next) mapRef.current?.centerOn(selectedVehicle.lat, selectedVehicle.lon, 15.6);
            return next;
          });
        },
      });
    }
    if (selectedRoute && selectedRoute.coords.length >= 2) {
      list.push({
        id: 'fit-route',
        icon: ScanLine,
        accessibilityLabel: s.liveMap.fitRouteA11y,
        onPress: () => {
          setFollowVehicle(false);
          mapRef.current?.fitRoute();
        },
      });
    }
    return list;
  }, [
    followVehicle,
    s.liveMap.fitRouteA11y,
    s.liveMap.followVehicleA11y,
    selectedRoute,
    selectedVehicle,
  ]);

  const zoomPair = useMemo<[MapActionItem, MapActionItem]>(
    () => [
      {
        id: 'zoom-in',
        icon: Plus,
        accessibilityLabel: s.liveMap.zoomInA11y,
        onPress: () => mapRef.current?.zoomBy(1.2),
      },
      {
        id: 'zoom-out',
        icon: Minus,
        accessibilityLabel: s.liveMap.zoomOutA11y,
        onPress: () => mapRef.current?.zoomBy(-1.2),
      },
    ],
    [s.liveMap.zoomInA11y, s.liveMap.zoomOutA11y],
  );

  const locationAction = useMemo<MapActionItem>(
    () => ({
      id: 'recenter',
      icon: LocateFixed,
      accessibilityLabel: s.liveMap.recenterA11y,
      tone: 'secondary',
      onPress: handleRecenter,
    }),
    [handleRecenter, s.liveMap.recenterA11y],
  );

  const railBottom = hasSheet ? sheetHeight + 14 : Math.max(insets.bottom, 16) + 14;
  const desktopSheetWidth = Math.min(400, Math.max(320, webLayout.contentWidth - 104));
  const desktopSheetStyle = webLayout.isMedium
    ? [styles.sheetDesktop, { width: desktopSheetWidth }]
    : undefined;
  const desktopBoardDefaultMaxHeight = Math.round(Math.min(360, webLayout.height * 0.42));
  const desktopBoardExpandedMaxHeight = Math.round(Math.min(540, webLayout.height * 0.65));

  return (
    <View style={styles.root}>
      {transitionSettled && offlineBase !== undefined && (
        <LiveVehiclesMap
          ref={mapRef}
          vehicles={mapItems}
          stops={mapStops}
          disruptions={mapDisruptionItems}
          delaySegments={mapDelaySegments}
          selectedId={selectedId}
          selectedStopId={selectedStopId}
          selectedRoute={selectedRoute}
          selectedDisruptionId={selectedDisruptionId}
          selectedDelayId={selectedDelayId}
          showDisruptions={showDisruptions}
          showDelays={showDelays}
          showStops={showStops}
          userLat={userLoc?.lat ?? null}
          userLon={userLoc?.lon ?? null}
          offlineBase={offlineBase}
          bottomOffset={
            webLayout.isMedium ? 24 : hasSheet ? sheetHeight : Math.max(insets.bottom, 12)
          }
          onSelectVehicle={handleSelectVehicle}
          onSelectStop={handleSelectStop}
          onSelectDisruption={handleSelectDisruption}
          onSelectDelay={handleSelectDelay}
          onClearSelection={handleClearSelection}
          onUserDrag={handleUserDrag}
          onZoomModeChange={setZoomMode}
          onViewportChange={handleViewportChange}
          onTilesStatus={handleTilesStatus}
          onError={setMapError}
          onReady={handleMapReady}
          onRendered={handleMapRendered}
          onReloading={handleMapReloading}
        />
      )}

      {!mapRendered && !mapError && (
        <Animated.View
          exiting={MAP_LOADER_EXITING}
          style={styles.mapLoaderOverlay}
          accessibilityLiveRegion="polite"
        >
          <MorphingLoader variant="contained" size={44} startIndex={3} />
          <Text style={styles.mapLoaderText}>{s.compass.mapLoading}</Text>
        </Animated.View>
      )}

      {/* Górna pływająca warstwa: powrót, wyszukiwarka/nagłówek, filtry z licznikami */}
      <View
        style={[styles.topOverlay, { paddingTop: Math.max(insets.top, 10) + 6 }]}
        pointerEvents="box-none"
      >
        <View style={[styles.headerRow, webLayout.isMedium && styles.headerRowDesktop]}>
          {(!webLayout.isMedium || searchOpen || router.canGoBack()) && (
            <SpringPressable
              onPress={() => {
                if (searchOpen) closeSearch();
                else if (router.canGoBack()) router.back();
                else router.replace('/');
              }}
              haptic="selection"
              accessibilityRole="button"
              accessibilityLabel={s.liveMap.backA11y}
              style={styles.circleBtn}
              scaleDelta={0.05}
            >
              <ArrowLeft size={22} color={scheme.onSurface} />
            </SpringPressable>
          )}

          {searchOpen ? (
            <View style={styles.searchPill}>
              <Search size={18} color={scheme.primary} />
              <TextInput
                ref={searchInputRef}
                value={searchQuery}
                onChangeText={setSearchQuery}
                placeholder={s.liveMap.searchPlaceholder}
                placeholderTextColor={scheme.onSurfaceVariant}
                returnKeyType="search"
                autoCorrect={false}
                style={styles.searchInput}
                accessibilityLabel={s.liveMap.searchA11y}
              />
              <SpringPressable
                onPress={closeSearch}
                haptic="selection"
                accessibilityRole="button"
                accessibilityLabel={s.liveMap.clearSearchA11y}
                style={styles.searchClearBtn}
              >
                <X size={18} color={scheme.onSurfaceVariant} />
              </SpringPressable>
            </View>
          ) : (
            <SpringPressable
              onPress={handleOpenSearch}
              haptic="selection"
              scaleDelta={0.015}
              accessibilityRole="button"
              accessibilityLabel={s.liveMap.searchA11y}
              style={styles.titlePill}
            >
              <View style={styles.titlePillText}>
                <Text style={styles.titleText} numberOfLines={1}>
                  {s.liveMap.title}
                </Text>
                <Text style={styles.countText} numberOfLines={1}>
                  {headerSubtitle}
                </Text>
              </View>
              <View style={styles.searchBadgeIcon}>
                <Search size={18} color={scheme.onSecondaryContainer} />
              </View>
            </SpringPressable>
          )}
        </View>

        {/* Lista wyników wyszukiwania (linie na żywo + przystanki) */}
        {searchOpen && searchQuery.trim().length > 0 ? (
          <Animated.View
            entering={BADGE_ENTERING}
            exiting={BADGE_EXITING}
            style={[styles.searchDropdown, webLayout.isMedium && styles.searchDropdownDesktop]}
          >
            {searchResults.lines.length === 0 && searchResults.stops.length === 0 ? (
              <Text style={styles.searchEmptyText}>{s.liveMap.searchNoResults}</Text>
            ) : (
              <ScrollView
                style={styles.searchDropdownScroll}
                keyboardShouldPersistTaps="handled"
                showsVerticalScrollIndicator={false}
              >
                {searchResults.lines.length > 0 && (
                  <View style={styles.searchSection}>
                    <Text style={styles.searchSectionLabel}>{s.liveMap.searchLinesHeader}</Text>
                    <View style={styles.searchLinesGrid}>
                      {searchResults.lines.map((entry) => (
                        <SpringPressable
                          key={entry.line}
                          onPress={() => handlePickSearchLine(entry)}
                          haptic="selection"
                          style={styles.searchLineChip}
                        >
                          <LineBadge mode={entry.mode} line={entry.line} compact />
                          <Text style={styles.searchLineCount}>{entry.count}</Text>
                        </SpringPressable>
                      ))}
                    </View>
                  </View>
                )}

                {searchResults.stops.length > 0 && (
                  <View style={styles.searchSection}>
                    <Text style={styles.searchSectionLabel}>{s.liveMap.searchStopsHeader}</Text>
                    {searchResults.stops.map((st, idx) => (
                      <SpringPressable
                        key={st.id}
                        onPress={() => handlePickSearchStop(st)}
                        haptic="selection"
                        scaleDelta={0.015}
                        style={[styles.searchStopRow, idx > 0 && styles.depRowBorder]}
                      >
                        <View style={[styles.searchStopIcon, { backgroundColor: st.bg }]}>
                          <ModeGlyph mode={st.mode} size={15} color={st.fg} />
                        </View>
                        <Text style={styles.searchStopName} numberOfLines={1}>
                          {st.name}
                          {st.code && !st.name.includes(st.code) ? ` ${st.code}` : ''}
                        </Text>
                      </SpringPressable>
                    ))}
                  </View>
                )}
              </ScrollView>
            )}
          </Animated.View>
        ) : (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.filterRow}
          >
            {lineFilter && (
              <SpringPressable
                onPress={() => setLineFilter(null)}
                haptic="selection"
                accessibilityRole="button"
                accessibilityLabel={s.liveMap.clearSearchA11y}
                style={[styles.filterChip, styles.filterChipActive]}
              >
                <Text style={[styles.filterText, styles.filterTextActive]}>{lineFilter}</Text>
                <X size={15} color={scheme.onPrimaryContainer} />
              </SpringPressable>
            )}

            {(
              [
                { id: 'all', label: s.liveMap.filterAll, count: modeCounts.all, Icon: null },
                { id: 'tram', label: s.liveMap.filterTram, count: modeCounts.tram, Icon: TramFront },
                { id: 'bus', label: s.liveMap.filterBus, count: modeCounts.bus, Icon: BusFront },
                {
                  id: 'train',
                  label: s.liveMap.filterTrain,
                  count: modeCounts.train,
                  Icon: TrainFront,
                },
              ] as const
            ).map(({ id, label, count, Icon }) => {
              const active = filter === id && !lineFilter;
              return (
                <SpringPressable
                  key={id}
                  onPress={() => {
                    void Haptics.selectionAsync().catch(() => {});
                    setLineFilter(null);
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
                  {count > 0 && (
                    <Text style={[styles.filterCount, active && styles.filterCountActive]}>
                      {count}
                    </Text>
                  )}
                </SpringPressable>
              );
            })}

            {gtfsLoaded && mapStops.length > 0 && (
              <SpringPressable
                onPress={handleToggleStops}
                accessibilityRole="button"
                accessibilityState={{ selected: showStops }}
                style={[styles.filterChip, showStops && styles.secondaryChipActive]}
                scaleDelta={0.03}
              >
                <MapPin
                  size={15}
                  color={showStops ? scheme.onSecondaryContainer : scheme.onSurfaceVariant}
                />
                <Text style={[styles.filterText, showStops && styles.secondaryChipTextActive]}>
                  {s.liveMap.filterStops}
                </Text>
              </SpringPressable>
            )}

            {mapDelaySegments.length > 0 && (
              <SpringPressable
                onPress={handleToggleDelays}
                accessibilityRole="button"
                accessibilityState={{ selected: showDelays }}
                style={[styles.filterChip, showDelays && styles.delayChipActive]}
                scaleDelta={0.03}
              >
                <Clock3
                  size={15}
                  color={showDelays ? scheme.onWarningContainer : scheme.onSurfaceVariant}
                />
                <Text style={[styles.filterText, showDelays && styles.delayChipTextActive]}>
                  {`${s.liveMap.filterDelays} (${mapDelaySegments.length})`}
                </Text>
              </SpringPressable>
            )}

            {disruptionMarkers.length > 0 && (
              <SpringPressable
                onPress={handleToggleDisruptions}
                accessibilityRole="button"
                accessibilityState={{ selected: showDisruptions }}
                style={[styles.filterChip, showDisruptions && styles.disruptionChipActive]}
                scaleDelta={0.03}
              >
                <TriangleAlert
                  size={15}
                  color={showDisruptions ? scheme.onErrorContainer : scheme.onSurfaceVariant}
                />
                <Text
                  style={[styles.filterText, showDisruptions && styles.disruptionChipTextActive]}
                >
                  {`${s.liveMap.filterDisruptions} (${disruptionMarkers.length})`}
                </Text>
              </SpringPressable>
            )}
          </ScrollView>
        )}

        {/* Subtelna podpowiedź przy oddaleniu (kropki zamiast pigułek) */}
        {!searchOpen && zoomMode === 'dots' && mapItems.length > 0 && !showOfflinePill && (
          <Animated.View entering={BADGE_ENTERING} exiting={BADGE_EXITING} layout={SMOOTH_LAYOUT}>
            <SpringPressable
              onPress={() => mapRef.current?.zoomBy(2.2)}
              haptic="selection"
              style={styles.zoomHintPill}
              accessibilityRole="button"
              accessibilityLabel={s.liveMap.zoomForLinesHint}
            >
              <Plus size={14} color={scheme.onSecondaryContainer} />
              <Text style={styles.zoomHintText}>{s.liveMap.zoomForLinesHint}</Text>
            </SpringPressable>
          </Animated.View>
        )}

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

      {/* Prawa szyna szybkich akcji mapy (śledzenie, cała trasa, zoom, GPS) */}
      {!searchOpen && !mapError && mapRendered && (
        <View
          style={[
            styles.railWrap,
            { bottom: webLayout.isMedium ? 20 : railBottom },
            webLayout.isMedium && styles.railWrapDesktop,
          ]}
          pointerEvents="box-none"
        >
          <MapActionRail
            actions={railActions}
            zoomPair={zoomPair}
            primaryAction={locationAction}
          />
        </View>
      )}

      {mapRendered && isInitialLoading && !mapError && (
        <Animated.View
          entering={BADGE_ENTERING}
          exiting={BADGE_EXITING}
          style={styles.centerBadge}
          pointerEvents="none"
        >
          <MorphingLoader size={18} color={scheme.primary} />
          <Text style={styles.centerBadgeText}>{s.liveMap.loadingVehicles}</Text>
        </Animated.View>
      )}

      {mapError && (
        <Animated.View
          entering={SHEET_ENTERING}
          exiting={SHEET_EXITING}
          style={[
            styles.errorCard,
            { bottom: webLayout.isMedium ? 16 : Math.max(insets.bottom, 16) + 12 },
            webLayout.isMedium && styles.floatingCardDesktop,
          ]}
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

      {mapRendered && !isInitialLoading && mapItems.length === 0 && !hasSheet && !mapError && (
        <Animated.View
          entering={SHEET_ENTERING}
          exiting={SHEET_EXITING}
          style={[
            styles.emptyCard,
            { bottom: webLayout.isMedium ? 16 : Math.max(insets.bottom, 16) + 12 },
            webLayout.isMedium && styles.floatingCardDesktop,
          ]}
        >
          <Text style={styles.emptyTitle}>{s.liveMap.noVehiclesTitle}</Text>
          <Text style={styles.emptyBody}>{s.liveMap.noVehiclesBody}</Text>
          {hasActiveFilter && (
            <SpringPressable
              onPress={handleResetFilters}
              haptic="selection"
              style={styles.resetFilterBtn}
              accessibilityRole="button"
              accessibilityLabel={s.liveMap.resetFilterCta}
            >
              <Text style={styles.resetFilterText}>{s.liveMap.resetFilterCta}</Text>
            </SpringPressable>
          )}
        </Animated.View>
      )}

      {/* Dolna karta szczegółów wybranego utrudnienia */}
      {selectedDisruption && (
        <Animated.View
          key={`disruption-${selectedDisruption.id}`}
          entering={SHEET_ENTERING}
          exiting={SHEET_EXITING}
          layout={SMOOTH_LAYOUT}
          onLayout={handleSheetLayout}
          style={[
            styles.sheet,
            { paddingBottom: webLayout.isMedium ? 16 : Math.max(insets.bottom, 16) + 4 },
            desktopSheetStyle,
          ]}
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
                {!webLayout.isMedium && <View style={styles.sheetHandle} />}
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
                    style={styles.delayLinesScroll}
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

      {/* Dolna karta wybranego odcinka opóźnień naniesionego na drogę/torowisko */}
      {selectedDelaySegment && (
        <Animated.View
          key={`delay-seg-${selectedDelaySegment.id}`}
          entering={SHEET_ENTERING}
          exiting={SHEET_EXITING}
          layout={SMOOTH_LAYOUT}
          onLayout={handleSheetLayout}
          style={[
            styles.sheet,
            { paddingBottom: webLayout.isMedium ? 16 : Math.max(insets.bottom, 16) + 4 },
            desktopSheetStyle,
          ]}
        >
          {(() => {
            const avgMin = Math.max(1, Math.round(selectedDelaySegment.avgDelaySec / 60));
            const p90Min = Math.max(avgMin, Math.round(selectedDelaySegment.p90DelaySec / 60));
            const deltaMin =
              selectedDelaySegment.deltaVsTypicalSec != null
                ? Math.round(selectedDelaySegment.deltaVsTypicalSec / 60)
                : null;
            const isSevere = selectedDelaySegment.severity === 'severe';
            const tone = isSevere
              ? { bg: scheme.errorContainer, fg: scheme.onErrorContainer }
              : { bg: scheme.warningContainer, fg: scheme.onWarningContainer };
            const sevLabel =
              selectedDelaySegment.severity === 'severe'
                ? s.liveMap.delaySeveritySevere
                : selectedDelaySegment.severity === 'heavy'
                  ? s.liveMap.delaySeverityHeavy
                  : s.liveMap.delaySeverityModerate;
            return (
              <>
                {!webLayout.isMedium && <View style={styles.sheetHandle} />}
                <View style={styles.sheetHeader}>
                  <View style={[styles.stopIconBox, { backgroundColor: tone.bg }]}>
                    <Clock3 size={22} color={tone.fg} />
                  </View>
                  <View style={styles.sheetTitleWrap}>
                    <View style={styles.disruptionBadgeRow}>
                      <View style={[styles.severityPill, { backgroundColor: tone.bg }]}>
                        <Text style={[styles.severityPillText, { color: tone.fg }]}>
                          {sevLabel}
                        </Text>
                      </View>
                      <Text style={styles.metaMuted}>{s.liveMap.delayZoneSheetTitle}</Text>
                    </View>
                    <Text style={styles.sheetTitle} numberOfLines={2}>
                      {selectedDelaySegment.title}
                    </Text>
                  </View>
                  <SpringPressable
                    onPress={handleClearSelection}
                    haptic="selection"
                    accessibilityRole="button"
                    accessibilityLabel={s.liveMap.closeSheetA11y}
                    style={styles.closeBtn}
                  >
                    <X size={20} color={scheme.onSurfaceVariant} />
                  </SpringPressable>
                </View>

                <View style={styles.delayMetricsRow}>
                  <View style={[styles.delayMetricCard, { backgroundColor: tone.bg }]}>
                    <Text style={[styles.delayMetricPrimary, { color: tone.fg }]}>
                      {s.liveMap.delayAvgNow(avgMin)}
                    </Text>
                    <Text style={[styles.delayMetricSub, { color: tone.fg }]}>
                      {s.liveMap.delayP90(p90Min)}
                    </Text>
                  </View>
                  <View style={styles.delayMetricCardNeutral}>
                    <Text style={styles.delayMetricNeutralTitle} numberOfLines={1}>
                      {s.liveMap.delayVehiclesAffected(
                        selectedDelaySegment.delayedCount,
                        selectedDelaySegment.vehicleCount,
                      )}
                    </Text>
                    {deltaMin != null && Math.abs(deltaMin) >= 1 ? (
                      <Text
                        style={[
                          styles.delayMetricNeutralSub,
                          { color: deltaMin > 0 ? scheme.warning : scheme.success },
                        ]}
                        numberOfLines={1}
                      >
                        {deltaMin > 0
                          ? s.liveMap.delayVsTypicalHigher(deltaMin)
                          : s.liveMap.delayVsTypicalLower(Math.abs(deltaMin))}
                      </Text>
                    ) : null}
                  </View>
                </View>

                {selectedDelaySegment.topLines.length > 0 && (
                  <View style={styles.delayLinesSection}>
                    <Text style={styles.metaMuted}>{s.liveMap.delayAffectedLines}</Text>
                    <ScrollView
                      horizontal
                      style={styles.delayLinesScroll}
                      showsHorizontalScrollIndicator={false}
                      contentContainerStyle={styles.disruptionLinesRow}
                    >
                      {selectedDelaySegment.topLines.map((line) => (
                        <SpringPressable
                          key={line}
                          onPress={() => {
                            void Haptics.selectionAsync().catch(() => {});
                            setFilter('all');
                            setLineFilter(line);
                            setSelectedDelayId(null);
                          }}
                          accessibilityRole="button"
                          accessibilityLabel={line}
                          scaleDelta={0.04}
                        >
                          <LineBadge line={line} compact />
                        </SpringPressable>
                      ))}
                    </ScrollView>
                    <Text style={styles.metaMuted}>{s.liveMap.delayTapLineHint}</Text>
                  </View>
                )}
              </>
            );
          })()}
        </Animated.View>
      )}

      {/* Dolna tablica odjazdów wybranego przystanku */}
      {selectedStop && (
        <Animated.View
          key={`stop-${selectedStop.id}`}
          entering={SHEET_ENTERING}
          exiting={SHEET_EXITING}
          layout={SMOOTH_LAYOUT}
          onLayout={handleSheetLayout}
          style={[
            styles.sheet,
            { paddingBottom: webLayout.isMedium ? 16 : Math.max(insets.bottom, 16) + 4 },
            desktopSheetStyle,
          ]}
        >
          {!webLayout.isMedium && (
            <SpringPressable
              onPress={() => setSheetExpanded((v) => !v)}
              haptic="selection"
              scaleDelta={0.015}
              style={styles.handleTouch}
              accessibilityRole="button"
              accessibilityLabel={s.liveMap.toggleSheetA11y}
            >
              <View style={styles.sheetHandle} />
            </SpringPressable>
          )}

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
                {selectedStop.code ? ` \u00b7 ${s.liveMap.stopCodeLabel(selectedStop.code)}` : ''}
              </Text>
            </View>
            <View style={styles.sheetHeaderActions}>
              <SpringPressable
                onPress={() => setSheetExpanded((v) => !v)}
                haptic="selection"
                accessibilityRole="button"
                accessibilityLabel={s.liveMap.toggleSheetA11y}
                style={styles.closeBtn}
                scaleDelta={0.05}
              >
                {sheetExpanded ? (
                  <ChevronDown size={20} color={scheme.onSurfaceVariant} />
                ) : (
                  <ChevronUp size={20} color={scheme.onSurfaceVariant} />
                )}
              </SpringPressable>
              <SpringPressable
                onPress={handleClearSelection}
                hitSlop={6}
                accessibilityRole="button"
                accessibilityLabel={s.liveMap.closeSheetA11y}
                style={styles.closeBtn}
                scaleDelta={0.05}
              >
                <X size={20} color={scheme.onSurfaceVariant} />
              </SpringPressable>
            </View>
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
              style={[
                styles.boardScroll,
                webLayout.isMedium && { maxHeight: desktopBoardDefaultMaxHeight },
                sheetExpanded && {
                  maxHeight: webLayout.isMedium
                    ? desktopBoardExpandedMaxHeight
                    : expandedBoardMaxHeight,
                },
              ]}
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
                    <LineBadge mode={dep.mode} line={dep.line} />
                    <View style={styles.depInfo}>
                      <Text style={styles.depHeadsign} numberOfLines={1}>
                        {dep.headsign}
                      </Text>
                      <Text style={[styles.depSub, { color: statusColor }]} numberOfLines={1}>
                        {statusText}
                        {' \u00b7 '}
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

      {/* Dolna tablica kolejnych przystanków wybranego pojazdu oraz akcje */}
      {selectedVehicle && selectedMeta && (
        <Animated.View
          key={`vehicle-${selectedVehicle.vehicleId}`}
          entering={SHEET_ENTERING}
          exiting={SHEET_EXITING}
          layout={SMOOTH_LAYOUT}
          onLayout={handleSheetLayout}
          style={[
            styles.sheet,
            { paddingBottom: webLayout.isMedium ? 16 : Math.max(insets.bottom, 16) + 4 },
            desktopSheetStyle,
          ]}
        >
          {!webLayout.isMedium && (
            <SpringPressable
              onPress={() => setSheetExpanded((v) => !v)}
              haptic="selection"
              scaleDelta={0.015}
              style={styles.handleTouch}
              accessibilityRole="button"
              accessibilityLabel={s.liveMap.toggleSheetA11y}
            >
              <View style={styles.sheetHandle} />
            </SpringPressable>
          )}

          <View style={styles.sheetHeader}>
            <LineBadge
              mode={selectedMeta.mode}
              line={selectedVehicle.line}
              size="large"
              maxWidth={132}
            />
            <View style={styles.sheetTitleWrap}>
              <Text style={styles.sheetTitle} numberOfLines={1}>
                {selectedMeta.direction
                  ? s.liveMap.vehicleTowards(selectedMeta.direction)
                  : selectedMeta.line}
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
                    {' \u00b7 '}
                    {s.liveMap.distanceAway(selectedMeta.distM)}
                  </Text>
                )}
              </View>
            </View>
            <View style={styles.sheetHeaderActions}>
              {vehicleBoard.length > 3 && (
                <SpringPressable
                  onPress={() => setSheetExpanded((v) => !v)}
                  haptic="selection"
                  accessibilityRole="button"
                  accessibilityLabel={s.liveMap.toggleSheetA11y}
                  style={styles.closeBtn}
                  scaleDelta={0.05}
                >
                  {sheetExpanded ? (
                    <ChevronDown size={20} color={scheme.onSurfaceVariant} />
                  ) : (
                    <ChevronUp size={20} color={scheme.onSurfaceVariant} />
                  )}
                </SpringPressable>
              )}
              <SpringPressable
                onPress={handleClearSelection}
                hitSlop={6}
                accessibilityRole="button"
                accessibilityLabel={s.liveMap.closeSheetA11y}
                style={styles.closeBtn}
                scaleDelta={0.05}
              >
                <X size={20} color={scheme.onSurfaceVariant} />
              </SpringPressable>
            </View>
          </View>

          {vehicleBoard.length > 0 ? (
            <View style={styles.vehicleBoardWrap}>
              <Text style={styles.sectionLabel}>{s.liveMap.vehicleBoardTitle}</Text>
              <ScrollView
                style={[
                  styles.vehicleBoardScroll,
                  webLayout.isMedium && { maxHeight: desktopBoardDefaultMaxHeight },
                  sheetExpanded && {
                    maxHeight: webLayout.isMedium
                      ? desktopBoardExpandedMaxHeight
                      : expandedBoardMaxHeight,
                  },
                ]}
                contentContainerStyle={styles.boardScrollContent}
                nestedScrollEnabled
                showsVerticalScrollIndicator={false}
              >
                {vehicleBoard.map((stop, idx) => {
                  const diffMin = Math.round((stop.expectedSec - nowSec) / 60);
                  const isLast = idx === vehicleBoard.length - 1;
                  return (
                    <SpringPressable
                      key={`${stop.stopId}-${idx}`}
                      onPress={() => handleSelectStop(stop.stopId)}
                      accessibilityRole="button"
                      style={styles.vehStopRow}
                      scaleDelta={0.015}
                    >
                      <View style={styles.timelineRail}>
                        {idx > 0 && <View style={styles.timelineLineTop} />}
                        {!isLast && <View style={styles.timelineLineBottom} />}
                        <View
                          style={
                            stop.isNext
                              ? styles.timelineDotNext
                              : isLast
                                ? styles.timelineDotEnd
                                : styles.timelineDot
                          }
                        />
                      </View>
                      <View style={[styles.vehStopContent, idx > 0 && styles.depRowBorder]}>
                        <Text
                          style={[styles.vehStopName, stop.isNext && styles.vehStopNameNext]}
                          numberOfLines={1}
                        >
                          {stop.stopName}
                        </Text>
                        <Text style={styles.vehStopTime}>
                          {secondsToTimeString(stop.expectedSec)}
                        </Text>
                        <Text
                          style={[
                            styles.vehStopCountdown,
                            stop.isNext && styles.vehStopCountdownNext,
                          ]}
                        >
                          {s.liveMap.departInMin(diffMin)}
                        </Text>
                      </View>
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

          <View style={styles.vehicleActionsRow}>
            {selectedOrigin ? (
              <SpringPressable
                onPress={handleBoardVehicle}
                accessibilityRole="button"
                accessibilityLabel={s.liveMap.boardCta}
                style={[styles.boardBtn, styles.boardBtnFlex]}
              >
                <Text style={styles.boardBtnText} numberOfLines={1}>
                  {s.liveMap.boardCta}
                </Text>
              </SpringPressable>
            ) : (
              <View style={[styles.unmatchedBox, styles.boardBtnFlex]}>
                <Text style={styles.unmatchedTitle} numberOfLines={1}>
                  {s.liveMap.unmatchedTitle}
                </Text>
                <Text style={styles.unmatchedBody} numberOfLines={2}>
                  {s.liveMap.unmatchedBody}
                </Text>
              </View>
            )}

            <SpringPressable
              onPress={handleOpenLineTimetable}
              haptic="selection"
              accessibilityRole="button"
              accessibilityLabel={s.liveMap.openTimetableCta}
              style={styles.timetableBtn}
            >
              <Clock3 size={18} color={scheme.onSecondaryContainer} />
              <Text style={styles.timetableBtnText} numberOfLines={1}>
                {s.liveMap.openTimetableCta}
              </Text>
            </SpringPressable>
          </View>
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
  mapLoaderOverlay: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 14,
    paddingHorizontal: 24,
    backgroundColor: scheme.surface,
  },
  mapLoaderText: {
    ...type.bodyMedium,
    color: scheme.onSurfaceVariant,
    textAlign: 'center',
  },
  topOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    paddingHorizontal: 14,
    gap: 9,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  headerRowDesktop: {
    maxWidth: 420,
    width: '100%',
  },
  circleBtn: {
    width: 48,
    height: 48,
    borderRadius: 18,
    backgroundColor: scheme.surfaceContainerHigh,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: scheme.outlineVariant,
    alignItems: 'center',
    justifyContent: 'center',
    ...elev.level2,
  },
  titlePill: {
    flex: 1,
    minHeight: 48,
    borderRadius: 22,
    backgroundColor: scheme.surfaceContainerHigh,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: scheme.outlineVariant,
    paddingLeft: 16,
    paddingRight: 8,
    paddingVertical: 6,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    ...elev.level2,
  },
  titlePillText: {
    flex: 1,
    minWidth: 0,
    gap: 1,
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
  searchBadgeIcon: {
    width: 36,
    height: 36,
    borderRadius: shape.full,
    backgroundColor: scheme.secondaryContainer,
    alignItems: 'center',
    justifyContent: 'center',
  },
  searchPill: {
    flex: 1,
    minHeight: 48,
    borderRadius: 22,
    backgroundColor: scheme.surfaceContainerHigh,
    borderWidth: 1.5,
    borderColor: scheme.primary,
    paddingLeft: 14,
    paddingRight: 6,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    ...elev.level3,
  },
  searchInput: {
    flex: 1,
    ...type.bodyMedium,
    color: scheme.onSurface,
    paddingVertical: 10,
  },
  searchClearBtn: {
    width: 44,
    height: 44,
    borderRadius: shape.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  searchDropdown: {
    borderRadius: 22,
    backgroundColor: scheme.surfaceContainerHigh,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: scheme.outlineVariant,
    paddingVertical: 12,
    paddingHorizontal: 14,
    maxHeight: 320,
    ...elev.level3,
  },
  searchDropdownDesktop: {
    maxWidth: 420,
    width: '100%',
  },
  searchDropdownScroll: {
    maxHeight: 296,
  },
  searchEmptyText: {
    ...type.bodyMedium,
    color: scheme.onSurfaceVariant,
    textAlign: 'center',
    paddingVertical: 14,
  },
  searchSection: {
    gap: 8,
    marginBottom: 10,
  },
  searchSectionLabel: {
    ...type.labelMedium,
    color: scheme.onSurfaceVariant,
    fontWeight: '700',
  },
  searchLinesGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  searchLineChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    minHeight: 40,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 14,
    backgroundColor: scheme.surfaceContainerLow,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: scheme.outlineVariant,
  },
  searchLineCount: {
    ...type.labelSmall,
    fontWeight: '700',
    color: scheme.onSurfaceVariant,
    fontVariant: ['tabular-nums'],
  },
  searchStopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 10,
    minHeight: 44,
  },
  searchStopIcon: {
    width: 30,
    height: 30,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  searchStopName: {
    flex: 1,
    ...type.bodyMedium,
    fontWeight: '600',
    color: scheme.onSurface,
  },
  filterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 2,
  },
  filterChip: {
    minHeight: 44,
    paddingHorizontal: 13,
    borderRadius: 16,
    backgroundColor: scheme.surfaceContainerHigh,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: scheme.outlineVariant,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    ...elev.level1,
  },
  filterChipActive: {
    borderRadius: shape.full,
    backgroundColor: scheme.primaryContainer,
    borderWidth: 1.5,
    borderColor: scheme.primary,
  },
  secondaryChipActive: {
    borderRadius: shape.full,
    backgroundColor: scheme.secondaryContainer,
    borderColor: scheme.outlineVariant,
  },
  secondaryChipTextActive: {
    color: scheme.onSecondaryContainer,
    fontWeight: '700',
  },
  disruptionChipActive: {
    borderRadius: shape.full,
    backgroundColor: scheme.errorContainer,
    borderColor: scheme.error,
  },
  disruptionChipTextActive: {
    color: scheme.onErrorContainer,
    fontWeight: '700',
  },
  delayChipActive: {
    borderRadius: shape.full,
    backgroundColor: scheme.warningContainer,
    borderColor: scheme.warning,
  },
  delayChipTextActive: {
    color: scheme.onWarningContainer,
    fontWeight: '700',
  },
  delayMetricsRow: {
    flexDirection: 'row',
    gap: 10,
  },
  delayMetricCard: {
    borderRadius: shape.large,
    paddingHorizontal: 14,
    paddingVertical: 10,
    gap: 2,
  },
  delayMetricPrimary: {
    ...type.titleSmall,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  delayMetricSub: {
    ...type.labelSmall,
    opacity: 0.9,
    fontVariant: ['tabular-nums'],
  },
  delayMetricCardNeutral: {
    flex: 1,
    borderRadius: shape.large,
    paddingHorizontal: 14,
    paddingVertical: 10,
    backgroundColor: scheme.surfaceContainerHigh,
    justifyContent: 'center',
    gap: 2,
  },
  delayMetricNeutralTitle: {
    ...type.labelMedium,
    color: scheme.onSurface,
    fontWeight: '600',
  },
  delayMetricNeutralSub: {
    ...type.labelSmall,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  delayLinesSection: {
    gap: 6,
  },
  delayLinesScroll: {
    flexGrow: 0,
    flexShrink: 0,
  },
  filterText: {
    ...type.labelLarge,
    color: scheme.onSurfaceVariant,
  },
  filterTextActive: {
    color: scheme.onPrimaryContainer,
    fontWeight: '700',
  },
  filterCount: {
    ...type.labelSmall,
    fontWeight: '700',
    color: scheme.onSurfaceVariant,
    fontVariant: ['tabular-nums'],
    opacity: 0.85,
  },
  filterCountActive: {
    color: scheme.onPrimaryContainer,
    opacity: 1,
  },
  zoomHintPill: {
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    minHeight: 36,
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: shape.full,
    backgroundColor: scheme.secondaryContainer,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: scheme.outlineVariant,
    ...elev.level2,
  },
  zoomHintText: {
    ...type.labelMedium,
    fontWeight: '700',
    color: scheme.onSecondaryContainer,
  },
  statusBanner: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: shape.full,
    backgroundColor: scheme.surfaceContainerHigh,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: scheme.outlineVariant,
    ...elev.level2,
  },
  statusBannerText: {
    ...type.labelMedium,
    color: scheme.onSurface,
  },
  railWrap: {
    position: 'absolute',
    right: 14,
  },
  railWrapDesktop: {
    right: 20,
  },
  floatingCardDesktop: {
    left: 16,
    right: undefined,
    width: 420,
    maxWidth: '82%',
  },
  centerBadge: {
    position: 'absolute',
    alignSelf: 'center',
    top: '46%',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: shape.full,
    backgroundColor: scheme.surfaceContainerHigh,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: scheme.outlineVariant,
    ...elev.level3,
  },
  centerBadgeText: {
    ...type.labelLarge,
    color: scheme.onSurface,
  },
  errorCard: {
    position: 'absolute',
    left: 16,
    right: 16,
    padding: 18,
    borderRadius: shape.extraLarge,
    backgroundColor: scheme.surfaceContainerHigh,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: scheme.outlineVariant,
    gap: 14,
    ...elev.level3,
  },
  errorHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  errorIconBox: {
    width: 44,
    height: 44,
    borderRadius: 14,
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
    borderRadius: shape.full,
    backgroundColor: scheme.primary,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  retryBtnText: {
    ...type.labelLarge,
    color: scheme.onPrimary,
    fontWeight: '700',
  },
  emptyCard: {
    position: 'absolute',
    left: 16,
    right: 76,
    padding: 16,
    borderRadius: shape.extraLarge,
    backgroundColor: scheme.surfaceContainerHigh,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: scheme.outlineVariant,
    gap: 6,
    ...elev.level3,
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
  resetFilterBtn: {
    alignSelf: 'flex-start',
    marginTop: 6,
    minHeight: 40,
    paddingHorizontal: 16,
    borderRadius: shape.full,
    backgroundColor: scheme.primaryContainer,
    alignItems: 'center',
    justifyContent: 'center',
  },
  resetFilterText: {
    ...type.labelLarge,
    fontWeight: '700',
    color: scheme.onPrimaryContainer,
  },
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    borderTopLeftRadius: shape.extraLarge,
    borderTopRightRadius: shape.extraLarge,
    backgroundColor: scheme.surfaceContainerLow,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: scheme.outlineVariant,
    paddingHorizontal: 18,
    paddingTop: 4,
    gap: 12,
    ...elev.level3,
  },
  sheetDesktop: {
    left: 16,
    right: undefined,
    bottom: 16,
    borderRadius: shape.extraLarge,
    borderWidth: 1,
    borderColor: scheme.outlineVariant,
    paddingTop: 14,
  },
  handleTouch: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 8,
  },
  sheetHandle: {
    alignSelf: 'center',
    width: 36,
    height: 4,
    borderRadius: shape.full,
    backgroundColor: scheme.outline,
    opacity: 0.45,
  },
  sheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  sheetHeaderActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  stopIconBox: {
    width: 44,
    height: 44,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sheetTitleWrap: {
    flex: 1,
    gap: 2,
    minWidth: 0,
  },
  sheetTitle: {
    ...type.titleMedium,
    color: scheme.onSurface,
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
    fontVariant: ['tabular-nums'],
  },
  metaMuted: {
    ...type.bodySmall,
    color: scheme.onSurfaceVariant,
    fontVariant: ['tabular-nums'],
  },
  closeBtn: {
    width: 40,
    height: 40,
    borderRadius: shape.full,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: scheme.surfaceContainerHigh,
  },
  disruptionBadgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  severityPill: {
    borderRadius: shape.full,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  severityPillText: {
    ...type.labelSmall,
    fontWeight: '700',
  },
  disruptionLinesRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  disruptionMetaBox: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: shape.medium,
    backgroundColor: scheme.surfaceContainerHigh,
  },
  disruptionCorridorText: {
    ...type.labelMedium,
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
    borderRadius: shape.full,
    backgroundColor: scheme.secondaryContainer,
  },
  replacementText: {
    ...type.labelMedium,
    color: scheme.onSecondaryContainer,
    fontWeight: '700',
  },
  emptyBoardBox: {
    paddingVertical: 14,
  },
  boardScroll: {
    maxHeight: 240,
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
    maxHeight: 196,
  },
  boardScrollContent: {
    paddingBottom: 4,
  },
  depRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 10,
    minHeight: 52,
  },
  depRowBorder: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: scheme.outlineVariant,
  },
  depInfo: {
    flex: 1,
    gap: 2,
    minWidth: 0,
  },
  depHeadsign: {
    ...type.bodyMedium,
    color: scheme.onSurface,
    fontWeight: '600',
  },
  depSub: {
    ...type.labelSmall,
    fontVariant: ['tabular-nums'],
  },
  depCountdown: {
    ...type.titleSmall,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  vehStopRow: {
    flexDirection: 'row',
    alignItems: 'stretch',
    gap: 12,
    minHeight: 44,
  },
  vehStopContent: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 10,
    minHeight: 44,
    minWidth: 0,
  },
  timelineRail: {
    width: 18,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  timelineLineTop: {
    position: 'absolute',
    top: 0,
    bottom: '50%',
    width: 2.5,
    backgroundColor: scheme.outlineVariant,
  },
  timelineLineBottom: {
    position: 'absolute',
    top: '50%',
    bottom: 0,
    width: 2.5,
    backgroundColor: scheme.outlineVariant,
  },
  timelineDot: {
    width: 10,
    height: 10,
    borderRadius: shape.full,
    borderWidth: 2,
    borderColor: scheme.outline,
    backgroundColor: scheme.surfaceContainerLow,
    zIndex: 2,
  },
  timelineDotEnd: {
    width: 10,
    height: 10,
    borderRadius: shape.full,
    backgroundColor: scheme.outline,
    zIndex: 2,
  },
  timelineDotNext: {
    width: 14,
    height: 14,
    borderRadius: shape.full,
    backgroundColor: scheme.primary,
    borderWidth: 3,
    borderColor: scheme.primaryContainer,
    zIndex: 2,
  },
  vehStopName: {
    flex: 1,
    ...type.bodyMedium,
    color: scheme.onSurface,
  },
  vehStopNameNext: {
    fontWeight: '700',
    color: scheme.primary,
  },
  vehStopTime: {
    ...type.labelMedium,
    color: scheme.onSurfaceVariant,
    fontVariant: ['tabular-nums'],
  },
  vehStopCountdown: {
    ...type.labelMedium,
    color: scheme.onSurface,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
    minWidth: 50,
    textAlign: 'right',
  },
  vehStopCountdownNext: {
    color: scheme.primary,
  },
  nextStopText: {
    ...type.bodyMedium,
    color: scheme.onSurface,
  },
  vehicleActionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  boardBtn: {
    minHeight: 50,
    borderRadius: shape.full,
    backgroundColor: scheme.primary,
    paddingHorizontal: 18,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  boardBtnFlex: {
    flex: 1,
  },
  boardBtnText: {
    ...type.labelLarge,
    color: scheme.onPrimary,
    fontWeight: '700',
  },
  timetableBtn: {
    minHeight: 50,
    borderRadius: shape.full,
    backgroundColor: scheme.secondaryContainer,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: scheme.outlineVariant,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  timetableBtnText: {
    ...type.labelLarge,
    color: scheme.onSecondaryContainer,
    fontWeight: '700',
  },
  unmatchedBox: {
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: shape.large,
    backgroundColor: scheme.surfaceContainerHigh,
    gap: 2,
  },
  unmatchedTitle: {
    ...type.labelLarge,
    color: scheme.onSurface,
    fontWeight: '700',
  },
  unmatchedBody: {
    ...type.bodySmall,
    color: scheme.onSurfaceVariant,
  },
});
