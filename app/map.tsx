// Ekran pełnoekranowej mapy trasy połączenia w stylu M3 Expressive:
// pływająca kapsuła podsumowania, szyna szybkich akcji (GPS, śledzenie pojazdu,
// warstwy POI, kadrowanie, zoom), inspektor klikniętego przystanku oraz zwijany
// dolny panel etapów podróży.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  type LayoutChangeEvent,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  ArrowLeft,
  ArrowRight,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Layers,
  LocateFixed,
  Minus,
  Navigation,
  Plus,
  RefreshCw,
  ScanLine,
  WifiOff,
  X,
} from '../src/components/icons';
import { DirectionsWalk } from '../src/components/DirectionsWalk';
import { MorphingLoader } from '../src/components/MorphingLoader';
import { MapActionRail, type MapActionItem } from '../src/components/MapActionRail';
import { SpringPressable } from '../src/components/SpringPressable';
import { useWebLayout } from '../src/theme/layout';
import { elev, scheme, shape, type } from '../src/theme/tokens';
import { RoutingService } from '../src/services';
import { liveTracker } from '../src/services/liveTracker';
import { isLegRunning, matchVehicleToLeg, type LegVehicleMatch } from '../src/services/liveVehicle';
import {
  buildMapRoute,
  resolveGeometry,
  straightGeometry,
  pinRouteGeometry,
} from '../src/services/routeGeometry';
import { RouteMap, type MapStopTap, type RouteMapHandle } from '../src/components/RouteMap';
import {
  getLineColors,
  inferTransitMode,
  LineBadge,
  mapLineColor,
} from '../src/components/LineBadge';
import { buildMapStages, resolveStageSelection, useEnrichedConnection } from '../src/map/stages';
import { acquireMapServerForRoute } from '../src/services/mapServerLease';
import { useCurrentLocation } from '../src/services/currentLocation';
import { formatWalkDistance } from '../src/services/settings';
import type { Connection } from '../src/types/models';
import type { MapLeg, MapRoute, MapVehicle } from '../src/map/types';
import { useStrings } from '../src/i18n';
import { useTrackedTrip } from '../src/services/notifications';
import { getOnboardEstimate } from '../src/services/onboardGps';
import { normalizeConnectionId } from '../src/services/routing/connectionIdentity';
import { isFallbackOrigin } from '../src/config';

type Coord = [number, number];

const VEHICLE_POLL_MS = 6000;
/** Nie pokazuj błędu podczas pierwszych prób wczytania lokalnych kafelków. */
const OFFLINE_PILL_MS = 2500;

function nowSec(): number {
  const d = new Date();
  return d.getHours() * 3600 + d.getMinutes() * 60 + d.getSeconds();
}

function formatClockSec(sec?: number): string | null {
  if (typeof sec !== 'number' || !Number.isFinite(sec)) return null;
  const wrapped = ((Math.floor(sec) % 86400) + 86400) % 86400;
  const hh = String(Math.floor(wrapped / 3600)).padStart(2, '0');
  const mm = String(Math.floor((wrapped % 3600) / 60)).padStart(2, '0');
  return `${hh}:${mm}`;
}

export default function RouteMapScreen() {
  const s = useStrings();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const webLayout = useWebLayout();
  const { width, fontScale } = useWindowDimensions();
  const { id: routeId, stageId: initialStageId } = useLocalSearchParams<{
    id: string;
    stageId?: string;
  }>();
  const id = normalizeConnectionId(routeId ?? '');

  const { location: userLoc } = useCurrentLocation(true, false);
  const [loadedItem, setItem] = useState<Connection | null>(null);
  const { trip: trackedTrip } = useTrackedTrip();
  const trackedConnection =
    trackedTrip?.connection.id === String(id) ? trackedTrip.connection : null;
  const rawItem = trackedConnection ?? (loadedItem?.id === String(id) ? loadedItem : null);
  const item = useEnrichedConnection(rawItem) ?? rawItem;
  const [loadFailed, setLoadFailed] = useState(false);
  const [panelHeight, setPanelHeight] = useState(140);
  const [headerHeight, setHeaderHeight] = useState(72);
  const [selectedStageId, setSelectedStageId] = useState<string | null>(initialStageId ?? null);
  const [geometryVersion, setGeometryVersion] = useState(0);
  const [vehicle, setVehicle] = useState<MapVehicle | null>(null);
  const [followVehicle, setFollowVehicle] = useState(false);
  const [poiVisible, setPoiVisible] = useState(true);
  const [deckCollapsed, setDeckCollapsed] = useState(false);
  const [inspectedStop, setInspectedStop] = useState<MapStopTap | null>(null);
  const [tilesDown, setTilesDown] = useState(false);
  const [showOfflinePill, setShowOfflinePill] = useState(false);
  const [mapError, setMapError] = useState<string | null>(null);
  const offlinePillTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const mapRef = useRef<RouteMapHandle>(null);
  const legScrollRef = useRef<ScrollView>(null);
  const chipLayoutsRef = useRef<Record<string, { x: number; width: number }>>({});
  const pendingScrollStageIdRef = useRef<string | null>(null);
  const geometryRef = useRef(new Map<string, Coord[]>());

  // Mapa pokazuje pojazd na żywo, więc poll działa tylko, gdy ekran jest aktywny.
  useFocusEffect(
    useCallback(() => {
      liveTracker.acquire();
      return () => liveTracker.release();
    }, []),
  );
  const shownVehicleRef = useRef<string | null>(null);

  const clearOfflinePillTimer = useCallback(() => {
    if (offlinePillTimer.current) {
      clearTimeout(offlinePillTimer.current);
      offlinePillTimer.current = null;
    }
  }, []);

  const markTilesOk = useCallback(() => {
    clearOfflinePillTimer();
    setTilesDown(false);
    setShowOfflinePill(false);
    setMapError(null);
  }, [clearOfflinePillTimer]);

  const markTilesDown = useCallback((errorMsg?: string | null) => {
    setTilesDown(true);
    if (errorMsg) setMapError(errorMsg);
    if (offlinePillTimer.current) return;
    offlinePillTimer.current = setTimeout(() => {
      offlinePillTimer.current = null;
      setShowOfflinePill(true);
    }, OFFLINE_PILL_MS);
  }, []);

  useEffect(() => () => clearOfflinePillTimer(), [clearOfflinePillTimer]);

  // ─── Połączenie ───────────────────────────────────────────────
  useEffect(() => {
    if (trackedConnection) {
      setItem(trackedConnection);
      setLoadFailed(false);
      return;
    }
    if (!id) {
      setLoadFailed(true);
      return;
    }
    const connectionId = String(id);
    let cancelled = false;
    (async () => {
      let found: Connection | undefined;
      try {
        const hit = await RoutingService.getConnectionById(connectionId);
        found = hit?.connection;
      } catch {
        found = undefined;
      }
      if (cancelled) return;
      if (found) {
        setItem(found);
        setLoadFailed(false);
      } else {
        setLoadFailed(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id, trackedConnection]);

  const route: MapRoute | null = useMemo(() => (item ? buildMapRoute(item) : null), [item]);

  const stages = useMemo(() => {
    void geometryVersion;
    return buildMapStages(route, geometryRef.current);
  }, [route, geometryVersion]);

  const activeStage = useMemo(
    () => resolveStageSelection(stages, selectedStageId),
    [stages, selectedStageId],
  );

  const inspectedLeg = useMemo(() => {
    if (!inspectedStop || !route) return null;
    return route.legs.find((l) => l.id === inspectedStop.legId) ?? null;
  }, [inspectedStop, route]);

  const lastRouteIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (!route?.id) return;
    if (lastRouteIdRef.current === null) {
      lastRouteIdRef.current = route.id;
      setSelectedStageId(initialStageId ?? null);
      return;
    }
    if (lastRouteIdRef.current !== route.id) {
      lastRouteIdRef.current = route.id;
      chipLayoutsRef.current = {};
      setSelectedStageId(null);
      setInspectedStop(null);
      setFollowVehicle(false);
    }
  }, [initialStageId, route?.id]);

  const expandedCardWidth = useMemo(
    () => Math.min(width - 40, 296 * Math.max(1, fontScale)),
    [fontScale, width],
  );
  const inactiveTransitMaxWidth = useMemo(
    () => Math.min(width - 48, 176 * Math.max(1, fontScale)),
    [fontScale, width],
  );

  const scrollChipIntoView = useCallback(
    (stageId: string) => {
      const layout = chipLayoutsRef.current[stageId];
      if (!layout) return;
      const offset = Math.max(0, layout.x - (width - layout.width) / 2);
      legScrollRef.current?.scrollTo({ x: offset, animated: true });
    },
    [width],
  );

  useEffect(() => {
    if (!activeStage || deckCollapsed) return;
    const targetId = activeStage.id;
    pendingScrollStageIdRef.current = targetId;
    const raf = requestAnimationFrame(() => {
      if (pendingScrollStageIdRef.current === targetId) {
        scrollChipIntoView(targetId);
        pendingScrollStageIdRef.current = null;
      }
    });
    return () => cancelAnimationFrame(raf);
  }, [activeStage, deckCollapsed, scrollChipIntoView]);

  // ─── Geometria ulic i torów (OSRM / OSM Overpass, w tle) ──────
  const pushGeometry = useCallback((legId: string, coords: Coord[]) => {
    geometryRef.current.set(legId, coords);
    setGeometryVersion((v) => v + 1);
    mapRef.current?.setGeometry(legId, coords, true);
  }, []);

  // ─── Zestaw mapy offline ──────────────────────────────────────
  const [offlineBase, setOfflineBase] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    let cancelled = false;
    let release: (() => void) | null = null;
    (async () => {
      const lease = await acquireMapServerForRoute(route);
      if (cancelled) {
        lease.release();
        return;
      }
      release = lease.release;
      setOfflineBase(lease.base);
      markTilesOk();
    })();
    return () => {
      cancelled = true;
      release?.();
    };
  }, [markTilesOk, route]);

  useEffect(() => {
    if (!route) return;
    let cancelled = false;
    const abort = new AbortController();
    geometryRef.current.clear();
    route.legs.forEach((leg) => {
      if (leg.approx) {
        const straight = straightGeometry(leg);
        if (straight.length > 1) pushGeometry(leg.id, straight);
      }
    });
    (async () => {
      await resolveGeometry(
        route,
        (legId, coords) => {
          if (!cancelled) pushGeometry(legId, coords);
        },
        abort.signal,
      );
      if (!cancelled) void pinRouteGeometry(route);
    })();
    return () => {
      cancelled = true;
      abort.abort();
    };
  }, [route, pushGeometry]);

  const handleMapReady = useCallback(() => {
    geometryRef.current.forEach((coords, legId) => {
      mapRef.current?.setGeometry(legId, coords);
    });
    if (!activeStage) {
      mapRef.current?.fit();
    }
  }, [activeStage]);

  // ─── Pojazd na żywo ───────────────────────────────────────────
  useEffect(() => {
    if (!item) return;
    let cancelled = false;

    const update = () => {
      if (cancelled) return;
      const legs = (route?.legs ?? []).filter((l) => l.mode !== 'walk' && l.line);
      const sec = nowSec();
      if (legs.length === 0) {
        setVehicle(null);
        shownVehicleRef.current = null;
        return;
      }
      const onboard = getOnboardEstimate();
      if (trackedConnection && onboard && Date.now() - onboard.fix.timestamp <= 60_000) {
        const leg = legs.find((l) => l.id === onboard.legId);
        if (leg) {
          const { bg } = getLineColors(leg.line, leg.mode);
          const vehMode = inferTransitMode(leg.mode, leg.line);
          setVehicle({
            vehicleId: 'onboard',
            legId: leg.id,
            line: leg.line || '',
            mode: vehMode === 'walk' ? 'bus' : vehMode,
            color: mapLineColor(bg),
            lat: onboard.fix.lat,
            lon: onboard.fix.lon,
            heading: onboard.fix.heading ?? 0,
            delaySec: onboard.delaySec ?? 0,
            updatedAt: onboard.fix.timestamp,
          });
          shownVehicleRef.current = 'onboard';
          return;
        }
      }
      const ordered = [...legs].sort((a, b) => {
        const run = (l: MapLeg) => (isLegRunning(l, sec) ? 0 : 1);
        return run(a) - run(b);
      });
      const snapshot = liveTracker.snapshot();
      let match: LegVehicleMatch | null = null;
      let matchLeg: MapLeg | null = null;
      for (const leg of ordered) {
        const coords = geometryRef.current.get(leg.id) ?? straightGeometry(leg);
        const found = matchVehicleToLeg(snapshot, leg, coords, {
          preferVehicleId: shownVehicleRef.current,
          nowSec: sec,
        });
        if (found) {
          match = found;
          matchLeg = leg;
          break;
        }
      }
      if (!match || !matchLeg) {
        setVehicle(null);
        shownVehicleRef.current = null;
        return;
      }
      const leg = matchLeg;
      shownVehicleRef.current = match.vehicle.vehicleId;
      const displayLine = leg.line || match.vehicle.line;
      const { bg } = getLineColors(displayLine, leg.mode);
      const vehMode = inferTransitMode(leg.mode, displayLine);
      setVehicle({
        vehicleId: match.vehicle.vehicleId,
        legId: leg.id,
        line: displayLine,
        mode: vehMode === 'walk' ? 'bus' : vehMode,
        color: mapLineColor(bg),
        lat: match.projectedLat ?? match.vehicle.lat,
        lon: match.projectedLon ?? match.vehicle.lon,
        heading: match.heading,
        delaySec: match.delaySec,
        currentStopName: match.vehicle.currentStopName,
        nextStopName: match.vehicle.nextStopName,
        updatedAt: match.vehicle.updatedAt,
      });
    };

    update();
    const interval = setInterval(update, VEHICLE_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [item, route, trackedConnection]);

  // Automatyczne podążanie kamery za pojazdem live, dopóki użytkownik nie przesunie mapy.
  useEffect(() => {
    if (!followVehicle) return;
    if (!vehicle) {
      setFollowVehicle(false);
      return;
    }
    mapRef.current?.centerOn(vehicle.lat, vehicle.lon, 15.6);
  }, [followVehicle, vehicle]);

  // ─── Akcje ────────────────────────────────────────────────────
  const handleSelectStage = useCallback(
    (stageId: string) => {
      setFollowVehicle(false);
      setInspectedStop(null);
      if (activeStage?.id === stageId) mapRef.current?.fit();
      else setSelectedStageId(stageId);
    },
    [activeStage?.id],
  );

  const handleLegTap = useCallback(
    (legId: string) => {
      setFollowVehicle(false);
      setInspectedStop(null);
      const next = resolveStageSelection(stages, legId, activeStage?.id ?? null);
      if (next) {
        setSelectedStageId(next.id);
      }
    },
    [activeStage?.id, stages],
  );

  const handleStopTap = useCallback((stop: MapStopTap) => {
    setFollowVehicle(false);
    setInspectedStop(stop);
  }, []);

  const handleUserDrag = useCallback(() => {
    setFollowVehicle(false);
  }, []);

  const handleStepStage = useCallback(
    (delta: -1 | 1) => {
      if (stages.length === 0) return;
      setFollowVehicle(false);
      setInspectedStop(null);
      if (!activeStage) {
        setSelectedStageId(delta > 0 ? stages[0].id : stages[stages.length - 1].id);
        return;
      }
      const nextIdx = activeStage.stageNumber - 1 + delta;
      if (nextIdx < 0 || nextIdx >= stages.length) {
        setSelectedStageId(null);
      } else {
        setSelectedStageId(stages[nextIdx].id);
      }
    },
    [activeStage, stages],
  );

  const handleShowRoute = useCallback(() => {
    setFollowVehicle(false);
    setInspectedStop(null);
    if (activeStage === null) mapRef.current?.fit();
    else setSelectedStageId(null);
  }, [activeStage]);

  const handleCenterUser = useCallback(() => {
    if (!userLoc) return;
    setFollowVehicle(false);
    mapRef.current?.centerOn(userLoc.lat, userLoc.lon, 15.8);
  }, [userLoc]);

  const handleToggleFollowVehicle = useCallback(() => {
    if (!vehicle) return;
    setFollowVehicle((prev) => {
      const next = !prev;
      if (next) {
        mapRef.current?.centerOn(vehicle.lat, vehicle.lon, 15.6);
      }
      return next;
    });
  }, [vehicle]);

  const goBack = useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace('/');
  }, [router]);

  const handleTilesStatus = useCallback(
    (ok: boolean) => {
      if (ok) markTilesOk();
      else markTilesDown();
    },
    [markTilesOk, markTilesDown],
  );

  const handleMapError = useCallback(() => {
    markTilesDown(s.map.mapLoadFail);
  }, [markTilesDown, s.map.mapLoadFail]);

  const handleHeaderLayout = useCallback((e: LayoutChangeEvent) => {
    setHeaderHeight(e.nativeEvent.layout.height);
  }, []);

  const handlePanelLayout = useCallback(
    (e: LayoutChangeEvent) => {
      const h = e.nativeEvent.layout.height;
      if (Math.abs(h - panelHeight) > 2) setPanelHeight(h);
    },
    [panelHeight],
  );

  const railActions = useMemo<MapActionItem[]>(() => {
    const list: MapActionItem[] = [
      {
        id: 'fit-route',
        icon: ScanLine,
        accessibilityLabel: s.map.fitRouteA11y,
        active: activeStage === null && !followVehicle,
        onPress: handleShowRoute,
      },
      {
        id: 'poi-toggle',
        icon: Layers,
        accessibilityLabel: s.map.togglePoiA11y,
        active: poiVisible,
        onPress: () => setPoiVisible((v) => !v),
      },
    ];
    if (vehicle) {
      list.unshift({
        id: 'follow-vehicle',
        icon: Navigation,
        accessibilityLabel: s.map.followVehicleA11y,
        active: followVehicle,
        onPress: handleToggleFollowVehicle,
      });
    }
    return list;
  }, [
    activeStage,
    followVehicle,
    handleShowRoute,
    handleToggleFollowVehicle,
    poiVisible,
    s.map.fitRouteA11y,
    s.map.followVehicleA11y,
    s.map.togglePoiA11y,
    vehicle,
  ]);

  const zoomPair = useMemo<[MapActionItem, MapActionItem]>(
    () => [
      {
        id: 'zoom-in',
        icon: Plus,
        accessibilityLabel: s.liveMap.zoomInA11y,
        onPress: () => mapRef.current?.zoomBy(1),
      },
      {
        id: 'zoom-out',
        icon: Minus,
        accessibilityLabel: s.liveMap.zoomOutA11y,
        onPress: () => mapRef.current?.zoomBy(-1),
      },
    ],
    [s.liveMap.zoomInA11y, s.liveMap.zoomOutA11y],
  );

  const locationAction = useMemo<MapActionItem | undefined>(() => {
    if (!userLoc) return undefined;
    return {
      id: 'my-location',
      icon: LocateFixed,
      accessibilityLabel: s.map.myLocationA11y,
      tone: 'secondary',
      onPress: handleCenterUser,
    };
  }, [handleCenterUser, s.map.myLocationA11y, userLoc]);

  // ─── Render ───────────────────────────────────────────────────
  if (loadFailed && !item) {
    return (
      <View style={styles.safe}>
        <View style={[styles.headerSafe, { paddingTop: insets.top + 8 }]}>
          <SpringPressable
            onPress={goBack}
            haptic="selection"
            style={styles.backBtn}
            accessibilityRole="button"
            accessibilityLabel={s.map.backA11y}
          >
            <ArrowLeft size={22} color={scheme.onSurface} />
          </SpringPressable>
          <Text style={styles.headerTitle}>{s.map.title}</Text>
        </View>
        <View style={styles.centered}>
          <Text style={styles.centeredTitle}>{s.map.loadFail}</Text>
          <Text style={styles.centeredSub}>{s.map.loadFailBody}</Text>
          <SpringPressable
            onPress={goBack}
            haptic="selection"
            style={styles.primaryBtn}
            accessibilityRole="button"
            accessibilityLabel={s.map.backToDetails}
          >
            <Text style={styles.primaryBtnText}>{s.map.backToDetails}</Text>
          </SpringPressable>
        </View>
      </View>
    );
  }

  if (!item || !route) {
    return (
      <View style={styles.safe}>
        <View style={[styles.headerSafe, { paddingTop: insets.top + 8 }]}>
          <SpringPressable
            onPress={goBack}
            haptic="selection"
            style={styles.backBtn}
            accessibilityRole="button"
            accessibilityLabel={s.map.backA11y}
          >
            <ArrowLeft size={22} color={scheme.onSurface} />
          </SpringPressable>
          <Text style={styles.headerTitle}>{s.map.title}</Text>
        </View>
        <View style={styles.centered} accessibilityLiveRegion="polite">
          <MorphingLoader variant="contained" size={44} startIndex={3} />
          <Text style={styles.centeredSub}>{s.map.assembling}</Text>
        </View>
      </View>
    );
  }

  const delayMin = item.live ? item.delayMin : 0;
  const inspectedTime = formatClockSec(inspectedStop?.arriveSec);
  const inspectedRoleLabel =
    inspectedStop?.role === 'board'
      ? s.map.board
      : inspectedStop?.role === 'alight'
        ? s.map.alight
        : s.map.stopRoleIntermediate;

  return (
    <View style={styles.root}>
      {offlineBase !== undefined ? (
        <RouteMap
          ref={mapRef}
          route={route}
          vehicle={vehicle}
          userLat={userLoc?.lat ?? null}
          userLon={userLoc?.lon ?? null}
          selectedLegId={activeStage?.legId ?? null}
          focusCoords={activeStage?.focusCoords ?? null}
          stopRange={activeStage?.stopRange ?? null}
          focusMaxZoom={activeStage?.focusMaxZoom ?? null}
          offlineBase={offlineBase}
          showPoi
          poiVisible={poiVisible}
          fitOnGeometry
          paddingTop={insets.top + 12 + headerHeight + 14}
          paddingBottom={panelHeight + 20}
          paddingRight={72}
          paddingLeft={28}
          onReady={handleMapReady}
          onLegTap={handleLegTap}
          onStopTap={handleStopTap}
          onUserDrag={handleUserDrag}
          onTilesStatus={handleTilesStatus}
          onError={handleMapError}
        />
      ) : (
        <View style={styles.mapPlaceholder} />
      )}

      {/* Pływający górny pasek: osobny przycisk wstecz + kapsuła podsumowania trasy */}
      <View style={[styles.topBar, { paddingTop: insets.top + 10 }]} pointerEvents="box-none">
        <View
          style={[styles.topRow, webLayout.isMedium && styles.topRowDesktop]}
          onLayout={handleHeaderLayout}
          pointerEvents="box-none"
        >
          <SpringPressable
            onPress={goBack}
            haptic="selection"
            style={styles.backBtn}
            accessibilityRole="button"
            accessibilityLabel={s.map.backA11y}
          >
            <ArrowLeft size={22} color={scheme.onSurface} />
          </SpringPressable>

          <SpringPressable
            onPress={handleShowRoute}
            haptic="selection"
            scaleDelta={0.02}
            style={styles.summaryCapsule}
            accessibilityRole="button"
            accessibilityLabel={s.map.fitRouteA11y}
          >
            {item.fromTitle === item.toTitle ? (
              <Text style={styles.headerTitle} numberOfLines={fontScale > 1.3 ? undefined : 1}>
                {item.toTitle}
              </Text>
            ) : (
              <View style={styles.headerTitleRow}>
                <Text style={styles.headerTitle} numberOfLines={1}>
                  {item.fromTitle}
                </Text>
                <ArrowRight size={14} color={scheme.primary} />
                <Text style={styles.headerTitle} numberOfLines={1}>
                  {item.toTitle}
                </Text>
              </View>
            )}
            <Text style={styles.headerSub} numberOfLines={1}>
              {item.departAt}
              {'\u2013'}
              {item.arriveAt} {'\u2022'} {s.common.durMin(item.durationMin)}
              {item.transfers > 0 ? s.map.transfersSuffix(item.transfers) : ''}
              {delayMin !== 0 ? s.map.delaySuffix(delayMin) : ''}
            </Text>
          </SpringPressable>
        </View>

        {offlineBase !== undefined && tilesDown && showOfflinePill && (
          <View
            style={[styles.offlinePill, webLayout.isMedium && styles.offlinePillDesktop]}
            accessibilityRole="alert"
          >
            <WifiOff size={16} color={scheme.warning} />
            <Text style={styles.offlineText} numberOfLines={2}>
              {mapError ? s.map.offlineTitle : s.map.offlineSub}
            </Text>
            <SpringPressable
              onPress={() => {
                markTilesOk();
                mapRef.current?.reload();
              }}
              haptic="selection"
              style={styles.offlineRetryBtn}
              accessibilityRole="button"
              accessibilityLabel={s.map.retryMap}
            >
              <RefreshCw size={15} color={scheme.onSecondaryContainer} />
            </SpringPressable>
          </View>
        )}
      </View>

      {/* Szyna akcji po prawej krawędzi mapy */}
      <View
        style={[
          styles.railWrap,
          webLayout.isMedium
            ? styles.railWrapDesktop
            : { bottom: panelHeight + (inspectedStop ? 96 : 16) },
        ]}
        pointerEvents="box-none"
      >
        <MapActionRail
          actions={railActions}
          zoomPair={zoomPair}
          primaryAction={locationAction}
        />
      </View>

      {/* Pływająca karta klikniętego przystanku (Stop Inspector) */}
      {inspectedStop && (
        <View
          style={[
            styles.stopInspectorWrap,
            webLayout.isMedium
              ? [styles.stopInspectorWrapDesktop, { bottom: panelHeight + 28 }]
              : { bottom: panelHeight + 12 },
          ]}
          pointerEvents="box-none"
        >
          <View style={styles.stopInspectorCard}>
            <SpringPressable
              onPress={() => handleLegTap(inspectedStop.legId)}
              haptic="selection"
              scaleDelta={0.02}
              style={styles.stopInspectorBody}
              accessibilityRole="button"
              accessibilityLabel={inspectedStop.name}
            >
              {inspectedLeg && inspectedLeg.mode !== 'walk' && (
                <LineBadge mode={inspectedLeg.mode} line={inspectedLeg.line} compact />
              )}
              <View style={styles.stopInspectorText}>
                <View style={styles.stopRoleRow}>
                  <View style={styles.stopRoleBadge}>
                    <Text style={styles.stopRoleText}>{inspectedRoleLabel}</Text>
                  </View>
                  {inspectedTime && <Text style={styles.stopTimeText}>{inspectedTime}</Text>}
                </View>
                <Text style={styles.stopNameText} numberOfLines={1}>
                  {inspectedStop.name}
                </Text>
              </View>
            </SpringPressable>

            <SpringPressable
              onPress={() => setInspectedStop(null)}
              haptic="selection"
              style={styles.stopCloseBtn}
              accessibilityRole="button"
              accessibilityLabel={s.map.closeStopA11y}
            >
              <X size={18} color={scheme.onSurfaceVariant} />
            </SpringPressable>
          </View>
        </View>
      )}

      {/* Zwijany dolny panel etapów w stylu M3 Expressive */}
      <View
        style={[
          styles.panel,
          webLayout.isMedium
            ? styles.panelDesktop
            : { paddingBottom: Math.max(insets.bottom, 12) + 6 },
        ]}
        onLayout={handlePanelLayout}
      >
        {!webLayout.isMedium && (
          <SpringPressable
            onPress={() => setDeckCollapsed((v) => !v)}
            haptic="selection"
            scaleDelta={0.015}
            style={styles.panelHandleTouch}
            accessibilityRole="button"
            accessibilityLabel={deckCollapsed ? s.map.expandDeckA11y : s.map.collapseDeckA11y}
          >
            <View style={styles.panelHandle} />
          </SpringPressable>
        )}

        <View style={styles.panelHead}>
          <View style={styles.panelTitleWrap}>
            <Text style={styles.panelTitle} numberOfLines={1} ellipsizeMode="tail">
              {activeStage
                ? s.map.stageCounter(activeStage.stageNumber, stages.length)
                : s.map.stagesTitle}
            </Text>
            {!activeStage && (
              <View style={styles.stageCounterChip}>
                <Text style={styles.stageCounterText}>{stages.length}</Text>
              </View>
            )}
          </View>

          <View style={styles.panelActions}>
            {stages.length > 1 && (
              <View style={styles.stepperGroup}>
                <SpringPressable
                  onPress={() => handleStepStage(-1)}
                  haptic="selection"
                  accessibilityRole="button"
                  accessibilityLabel={s.map.backA11y}
                  style={styles.stepperBtn}
                >
                  <ChevronLeft size={19} color={scheme.onSurface} />
                </SpringPressable>
                <SpringPressable
                  onPress={() => handleStepStage(1)}
                  haptic="selection"
                  accessibilityRole="button"
                  accessibilityLabel={s.map.stagesTitle}
                  style={styles.stepperBtn}
                >
                  <ChevronRight size={19} color={scheme.onSurface} />
                </SpringPressable>
              </View>
            )}

            <SpringPressable
              onPress={() => setDeckCollapsed((v) => !v)}
              haptic="selection"
              accessibilityRole="button"
              accessibilityLabel={deckCollapsed ? s.map.expandDeckA11y : s.map.collapseDeckA11y}
              style={styles.collapseBtn}
            >
              {deckCollapsed ? (
                <ChevronUp size={20} color={scheme.onSurface} />
              ) : (
                <ChevronDown size={20} color={scheme.onSurface} />
              )}
            </SpringPressable>
          </View>
        </View>

        {!deckCollapsed && (
          <ScrollView
            ref={legScrollRef}
            style={styles.legScroller}
            horizontal
            showsHorizontalScrollIndicator={false}
            overScrollMode="never"
            contentContainerStyle={styles.legScroll}
          >
            {stages.map((stage) => {
              const { leg } = stage;
              const active = activeStage?.id === stage.id;
              const isWalk = leg.mode === 'walk';
              const endpointTitle =
                stage.endpointRole === 'start'
                  ? `${s.map.board}: ${stage.fromStop}`
                  : stage.endpointRole === 'end'
                    ? `${s.map.alight}: ${stage.toStop}`
                    : null;
              return (
                <View
                  key={stage.id}
                  onLayout={(e) => {
                    const { x, width: chipWidth } = e.nativeEvent.layout;
                    chipLayoutsRef.current[stage.id] = { x, width: chipWidth };
                    if (pendingScrollStageIdRef.current === stage.id) {
                      scrollChipIntoView(stage.id);
                      pendingScrollStageIdRef.current = null;
                    }
                  }}
                >
                  <SpringPressable
                    onPress={() => handleSelectStage(stage.id)}
                    haptic="selection"
                    scaleDelta={0.03}
                    style={[
                      styles.legCard,
                      active
                        ? [styles.legCardActive, { width: expandedCardWidth }]
                        : isWalk
                          ? styles.legCardWalkCompact
                          : [styles.legCardTransitCompact, { maxWidth: inactiveTransitMaxWidth }],
                    ]}
                    accessibilityRole="button"
                    accessibilityState={{ selected: active }}
                    accessibilityLabel={
                      isWalk
                        ? s.map.walkStageA11y(formatWalkDistance(stage.walkM ?? 0))
                        : s.map.lineStageA11y(leg.line ?? '', stage.toStop)
                    }
                  >
                    {active ? (
                      <>
                        <View style={styles.legBadgeColumn}>
                          <LineBadge mode={leg.mode} line={leg.line} compact active />
                          {stage.segmentIndex && stage.segmentCount ? (
                            <View style={[styles.segmentPill, styles.segmentPillActive]}>
                              <Text style={[styles.segmentPillText, styles.segmentPillTextActive]}>
                                {stage.segmentIndex}/{stage.segmentCount}
                              </Text>
                            </View>
                          ) : (
                            <Text style={[styles.stageNumLabel, styles.legTitleActive]}>
                              #{stage.stageNumber}
                            </Text>
                          )}
                        </View>
                        <View style={styles.legInfo}>
                          {endpointTitle ? (
                            <Text
                              style={[styles.legTitle, styles.legTitleActive]}
                              numberOfLines={fontScale > 1.3 ? undefined : 2}
                            >
                              {endpointTitle}
                            </Text>
                          ) : stage.fromStop === stage.toStop ? (
                            <Text
                              style={[styles.legTitle, styles.legTitleActive]}
                              numberOfLines={fontScale > 1.3 ? undefined : 2}
                            >
                              {stage.toStop}
                            </Text>
                          ) : isWalk && isFallbackOrigin(stage.fromStop) ? (
                            <Text
                              style={[styles.legTitle, styles.legTitleActive]}
                              numberOfLines={fontScale > 1.3 ? undefined : 2}
                            >
                              {s.connection.walkTo(stage.toStop)}
                            </Text>
                          ) : (
                            <View style={styles.legTitleRow}>
                              <Text
                                style={[styles.legTitle, styles.legTitleActive]}
                                numberOfLines={fontScale > 1.3 ? 2 : 1}
                              >
                                {stage.fromStop}
                              </Text>
                              <ArrowRight size={14} color={scheme.onPrimaryContainer} />
                              <Text
                                style={[styles.legTitle, styles.legTitleActive]}
                                numberOfLines={fontScale > 1.3 ? 2 : 1}
                              >
                                {stage.toStop}
                              </Text>
                            </View>
                          )}
                          <Text style={[styles.legSub, styles.legTitleActive]}>
                            {stage.endpointRole
                              ? stage.departAt
                              : `${stage.departAt}\u2013${stage.arriveAt}`}
                            {isWalk
                              ? ` \u2022 ${formatWalkDistance(stage.walkM ?? 0)}`
                              : stage.stopsCount > 0
                                ? ` \u2022 ${s.map.legStops(stage.stopsCount)}`
                                : ''}
                          </Text>
                          {isWalk && (leg.toEntrance || leg.fromEntrance) ? (
                            <Text style={[styles.legSub, styles.legTitleActive]} numberOfLines={2}>
                              {(() => {
                                const isTo = Boolean(leg.toEntrance);
                                const ref = leg.toEntrance ?? leg.fromEntrance!;
                                const label = isTo
                                  ? s.leg.metroEntrance(ref.num)
                                  : s.leg.metroExit(ref.num);
                                const wc =
                                  ref.wheelchair && !/winda|lift|aufzug|ліфт/i.test(ref.num)
                                    ? ` (${s.leg.metroElevatorTag})`
                                    : '';
                                return ref.hint ? `${label}${wc} \u00b7 ${ref.hint}` : `${label}${wc}`;
                              })()}
                            </Text>
                          ) : null}
                        </View>
                      </>
                    ) : isWalk ? (
                      <>
                        <DirectionsWalk size={18} color={scheme.onSurfaceVariant} />
                        <Text style={styles.walkChipDist} numberOfLines={1}>
                          {formatWalkDistance(stage.walkM ?? 0)}
                        </Text>
                      </>
                    ) : (
                      <>
                        <LineBadge mode={leg.mode} line={leg.line} compact />
                        <View style={styles.legInfoCompact}>
                          <Text
                            style={styles.legTitleCompact}
                            numberOfLines={1}
                            ellipsizeMode="tail"
                          >
                            {endpointTitle ?? stage.toStop}
                          </Text>
                          <Text style={styles.legSubCompact} numberOfLines={1}>
                            {stage.departAt}
                          </Text>
                        </View>
                      </>
                    )}
                  </SpringPressable>
                </View>
              );
            })}
          </ScrollView>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: scheme.surface },
  safe: { flex: 1, backgroundColor: scheme.surface },

  topBar: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    paddingHorizontal: 14,
    gap: 8,
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  topRowDesktop: {
    maxWidth: 520,
    width: '100%',
  },
  headerSafe: {
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  backBtn: {
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
  summaryCapsule: {
    flex: 1,
    minHeight: 48,
    minWidth: 0,
    justifyContent: 'center',
    gap: 2,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 22,
    backgroundColor: scheme.surfaceContainerHigh,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: scheme.outlineVariant,
    ...elev.level2,
  },
  headerTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  headerTitle: {
    ...type.titleSmall,
    fontWeight: '700',
    color: scheme.onSurface,
    flexShrink: 1,
  },
  headerSub: {
    ...type.bodySmall,
    color: scheme.onSurfaceVariant,
    fontVariant: ['tabular-nums'],
  },

  mapPlaceholder: { flex: 1, backgroundColor: scheme.surface },

  offlinePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingLeft: 14,
    paddingRight: 8,
    paddingVertical: 8,
    borderRadius: 18,
    backgroundColor: scheme.surfaceContainerHigh,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: scheme.outlineVariant,
    ...elev.level2,
  },
  offlinePillDesktop: {
    maxWidth: 520,
    alignSelf: 'flex-start',
  },
  offlineText: { ...type.bodySmall, color: scheme.onSurface, flex: 1 },
  offlineRetryBtn: {
    width: 36,
    height: 36,
    borderRadius: shape.full,
    backgroundColor: scheme.secondaryContainer,
    alignItems: 'center',
    justifyContent: 'center',
  },

  railWrap: {
    position: 'absolute',
    right: 14,
  },
  railWrapDesktop: {
    right: 20,
    bottom: 20,
  },

  stopInspectorWrap: {
    position: 'absolute',
    left: 14,
    right: 76,
  },
  stopInspectorWrapDesktop: {
    left: 16,
    right: undefined,
    width: 420,
    maxWidth: '80%',
  },
  stopInspectorCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingLeft: 12,
    paddingRight: 8,
    paddingVertical: 10,
    borderRadius: 20,
    backgroundColor: scheme.surfaceContainerHigh,
    borderWidth: 1,
    borderColor: scheme.outlineVariant,
    ...elev.level3,
  },
  stopInspectorBody: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    minWidth: 0,
  },
  stopInspectorText: {
    flex: 1,
    minWidth: 0,
    gap: 3,
  },
  stopRoleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  stopRoleBadge: {
    backgroundColor: scheme.secondaryContainer,
    borderRadius: shape.full,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  stopRoleText: {
    ...type.labelSmall,
    fontWeight: '700',
    color: scheme.onSecondaryContainer,
  },
  stopTimeText: {
    ...type.labelMedium,
    fontWeight: '700',
    color: scheme.primary,
    fontVariant: ['tabular-nums'],
  },
  stopNameText: {
    ...type.titleSmall,
    fontWeight: '700',
    color: scheme.onSurface,
  },
  stopCloseBtn: {
    width: 40,
    height: 40,
    borderRadius: shape.full,
    alignItems: 'center',
    justifyContent: 'center',
  },

  panel: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: scheme.surfaceContainerLow,
    borderTopLeftRadius: shape.extraLarge,
    borderTopRightRadius: shape.extraLarge,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: scheme.outlineVariant,
    ...elev.level3,
  },
  panelDesktop: {
    left: 16,
    right: 86,
    bottom: 16,
    maxWidth: 820,
    borderRadius: shape.extraLarge,
    borderWidth: 1,
    borderColor: scheme.outlineVariant,
    paddingTop: 12,
    paddingBottom: 14,
  },
  panelHandleTouch: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 10,
    paddingBottom: 6,
  },
  panelHandle: {
    width: 36,
    height: 4,
    borderRadius: shape.full,
    backgroundColor: scheme.outline,
    opacity: 0.45,
  },
  panelHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 18,
    paddingBottom: 10,
    gap: 12,
  },
  panelTitleWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flex: 1,
    minWidth: 0,
  },
  panelTitle: {
    ...type.titleMedium,
    fontWeight: '700',
    color: scheme.onSurface,
    flexShrink: 1,
    fontVariant: ['tabular-nums'],
  },
  stageCounterChip: {
    backgroundColor: scheme.primaryContainer,
    borderRadius: shape.full,
    paddingHorizontal: 9,
    paddingVertical: 2,
    flexShrink: 0,
  },
  stageCounterText: {
    ...type.labelSmall,
    fontWeight: '700',
    color: scheme.onPrimaryContainer,
    fontVariant: ['tabular-nums'],
  },
  panelActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexShrink: 0,
  },
  stepperGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  stepperBtn: {
    width: 44,
    height: 44,
    borderRadius: 15,
    backgroundColor: scheme.surfaceContainerHigh,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: scheme.outlineVariant,
    alignItems: 'center',
    justifyContent: 'center',
  },
  collapseBtn: {
    width: 44,
    height: 44,
    borderRadius: 15,
    backgroundColor: scheme.surfaceContainerHigh,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: scheme.outlineVariant,
    alignItems: 'center',
    justifyContent: 'center',
  },
  legScroller: { flexGrow: 0, flexShrink: 0 },
  legScroll: {
    paddingHorizontal: 18,
    paddingBottom: 4,
    gap: 8,
    alignItems: 'stretch',
  },
  legCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    minHeight: 64,
    borderRadius: 18,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: scheme.outlineVariant,
    backgroundColor: scheme.surfaceContainerHigh,
  },
  legCardWalkCompact: {
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    paddingHorizontal: 12,
    paddingVertical: 8,
    minWidth: 62,
  },
  legCardTransitCompact: {
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  legCardActive: {
    borderRadius: 22,
    backgroundColor: scheme.primaryContainer,
    borderWidth: 1.5,
    borderColor: scheme.primary,
  },
  walkChipDist: {
    ...type.labelSmall,
    fontWeight: '600',
    color: scheme.onSurfaceVariant,
    fontVariant: ['tabular-nums'],
  },
  legBadgeColumn: {
    alignItems: 'center',
    gap: 4,
  },
  segmentPill: {
    backgroundColor: scheme.surfaceContainerHighest,
    borderRadius: shape.full,
    paddingHorizontal: 6,
    paddingVertical: 1,
  },
  segmentPillActive: {
    backgroundColor: scheme.primary,
  },
  segmentPillText: {
    ...type.labelSmall,
    fontSize: 10,
    lineHeight: 13,
    color: scheme.onSurfaceVariant,
    fontVariant: ['tabular-nums'],
  },
  segmentPillTextActive: {
    color: scheme.onPrimary,
  },
  stageNumLabel: {
    ...type.labelSmall,
    fontSize: 10,
    lineHeight: 13,
    fontWeight: '700',
    color: scheme.onSurfaceVariant,
    fontVariant: ['tabular-nums'],
  },
  legInfo: { flex: 1, minWidth: 0, gap: 4 },
  legInfoCompact: { flexShrink: 1, minWidth: 0, gap: 2 },
  legTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  legTitle: {
    ...type.bodyMedium,
    fontWeight: '700',
    color: scheme.onSurface,
    flex: 1,
    minWidth: 0,
  },
  legTitleCompact: {
    ...type.bodyMedium,
    fontWeight: '600',
    color: scheme.onSurface,
  },
  legTitleActive: { color: scheme.onPrimaryContainer },
  legSub: {
    ...type.bodySmall,
    color: scheme.onSurfaceVariant,
    fontVariant: ['tabular-nums'],
  },
  legSubCompact: {
    ...type.labelSmall,
    color: scheme.onSurfaceVariant,
    fontVariant: ['tabular-nums'],
  },

  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10, padding: 32 },
  centeredTitle: { ...type.titleMedium, fontWeight: '700', color: scheme.onSurface, textAlign: 'center' },
  centeredSub: { ...type.bodyMedium, color: scheme.onSurfaceVariant, textAlign: 'center' },
  primaryBtn: {
    backgroundColor: scheme.primary,
    borderRadius: shape.full,
    paddingHorizontal: 22,
    paddingVertical: 14,
    minHeight: 50,
    marginTop: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryBtnText: { ...type.labelLarge, fontWeight: '700', color: scheme.onPrimary },
});
