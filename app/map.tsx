import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  type LayoutChangeEvent,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  ArrowRight,
  ChevronLeft,
  ChevronRight,
  ScanLine,
  WifiOff,
} from '../src/components/icons';
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
import { RouteMap, type RouteMapHandle } from '../src/components/RouteMap';
import {
  getLineColors,
  inferTransitMode,
  LineBadge,
  mapLineColor,
} from '../src/components/LineBadge';
import {
  buildMapStages,
  resolveStageSelection,
  useEnrichedConnection,
} from '../src/map/stages';
import { acquireMapServerForRoute } from '../src/services/mapServerLease';
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

export default function RouteMapScreen() {
  const s = useStrings();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { width, fontScale } = useWindowDimensions();
  const compact = width / fontScale < 330;
  const { id: routeId, stageId: initialStageId } = useLocalSearchParams<{
    id: string;
    stageId?: string;
  }>();
  const id = normalizeConnectionId(routeId ?? '');

  const [loadedItem, setItem] = useState<Connection | null>(null);
  const { trip: trackedTrip } = useTrackedTrip();
  const trackedConnection =
    trackedTrip?.connection.id === String(id) ? trackedTrip.connection : null;
  const rawItem = trackedConnection ?? (loadedItem?.id === String(id) ? loadedItem : null);
  const item = useEnrichedConnection(rawItem) ?? rawItem;
  const [loadFailed, setLoadFailed] = useState(false);
  const [panelHeight, setPanelHeight] = useState(120);
  const [headerHeight, setHeaderHeight] = useState(96);
  const [selectedStageId, setSelectedStageId] = useState<string | null>(initialStageId ?? null);
  const [geometryVersion, setGeometryVersion] = useState(0);
  const [vehicle, setVehicle] = useState<MapVehicle | null>(null);
  const [tilesDown, setTilesDown] = useState(false);
  const [showOfflinePill, setShowOfflinePill] = useState(false);
  const [mapError, setMapError] = useState<string | null>(null);
  const offlinePillTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const mapRef = useRef<RouteMapHandle>(null);
  const legScrollRef = useRef<ScrollView>(null);
  const geometryRef = useRef(new Map<string, Coord[]>());

  // Mapa pokazuje pojazd na żywo, więc poll chodzi tylko, gdy ekran widać.
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
      setSelectedStageId(null);
    }
  }, [initialStageId, route?.id]);

  const cardWidth = useMemo(
    () => Math.min(width - 40, 290 * Math.max(1, fontScale)),
    [fontScale, width],
  );

  useEffect(() => {
    if (!activeStage) return;
    const idx = activeStage.stageNumber - 1;
    const offset = Math.max(0, idx * (cardWidth + 12) - 20);
    legScrollRef.current?.scrollTo({ x: offset, animated: true });
  }, [activeStage, cardWidth]);

  // ─── Geometria ulic i torów (OSRM / OSM Overpass, w tle) ──────
  const pushGeometry = useCallback((legId: string, coords: Coord[]) => {
    geometryRef.current.set(legId, coords);
    setGeometryVersion((v) => v + 1);
    mapRef.current?.setGeometry(legId, coords, true);
  }, []);

  // ─── Zestaw mapy offline ──────────────────────────────────────
  // undefined = jeszcze sprawdzamy lokalny serwer; null = brak pakietu (CDN);
  // string = kafle z telefonu. WebView montujemy dopiero po decyzji, inaczej
  // mapa chwilę ładuje CDN, pada bez sieci i miga żółtym „offline".
  const [offlineBase, setOfflineBase] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    let cancelled = false;
    let release: (() => void) | null = null;
    (async () => {
      // Trasy międzyregionalne wychodzą poza pakiet miasta: kafelki online.
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
      // Trasa, którą użytkownik właśnie otworzył, zostaje w cache na stałe:
      // to ona najczęściej przyda się offline.
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
      // GPS pasażera wygrywa z feedem: gdy jedziemy tym pociągiem, nasz
      // telefon mówi prawdę o pozycji, a feed PKP potrafi być nieświeży
      // (pociąg „stoi" na stacji początkowej godzinę po odjeździe).
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
      // Tryb bierze się z leg.mode (planner ustawia go z route_type feedu),
      // więc metro i SKA niosą własne tryby. 'walk' tu nie trafia, ale
      // unia MapVehicle go nie zna, stąd mapowanie na autobus.
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

  // ─── Akcje ────────────────────────────────────────────────────
  const handleSelectStage = useCallback(
    (stageId: string) => {
      if (activeStage?.id === stageId) mapRef.current?.fit();
      else setSelectedStageId(stageId);
    },
    [activeStage?.id],
  );

  const handleLegTap = useCallback(
    (legId: string) => {
      const next = resolveStageSelection(stages, legId, activeStage?.id ?? null);
      if (next) {
        setSelectedStageId(next.id);
      }
    },
    [activeStage?.id, stages],
  );

  const handleStepStage = useCallback(
    (delta: -1 | 1) => {
      if (stages.length === 0) return;
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
    if (activeStage === null) mapRef.current?.fit();
    else setSelectedStageId(null);
  }, [activeStage]);

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

  // ─── Render ───────────────────────────────────────────────────
  if (loadFailed && !item) {
    return (
      <View style={styles.safe}>
        <View style={[styles.headerSafe, { paddingTop: insets.top + 6 }]}>
          <Pressable
            onPress={goBack}
            style={styles.backBtn}
            accessibilityRole="button"
            accessibilityLabel={s.map.backA11y}
          >
            <ChevronLeft size={22} color={scheme.onSurface} />
          </Pressable>
          <Text style={styles.headerTitle}>{s.map.title}</Text>
        </View>
        <View style={styles.centered}>
          <Text style={styles.centeredTitle}>{s.map.loadFail}</Text>
          <Text style={styles.centeredSub}>{s.map.loadFailBody}</Text>
          <Pressable
            onPress={goBack}
            style={({ pressed }) => [styles.primaryBtn, pressed && { opacity: 0.85 }]}
            accessibilityRole="button"
            accessibilityLabel={s.map.backToDetails}
          >
            <Text style={styles.primaryBtnText}>{s.map.backToDetails}</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  if (!item || !route) {
    return (
      <View style={styles.safe}>
        <View style={[styles.headerSafe, { paddingTop: insets.top + 6 }]}>
          <Pressable
            onPress={goBack}
            style={styles.backBtn}
            accessibilityRole="button"
            accessibilityLabel={s.map.backA11y}
          >
            <ChevronLeft size={22} color={scheme.onSurface} />
          </Pressable>
          <Text style={styles.headerTitle}>{s.map.title}</Text>
        </View>
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={scheme.primary} />
          <Text style={styles.centeredSub}>{s.map.assembling}</Text>
        </View>
      </View>
    );
  }

  const delayMin = item.live ? item.delayMin : 0;

  return (
    <View style={styles.root}>
      {offlineBase !== undefined ? (
        <RouteMap
          ref={mapRef}
          route={route}
          vehicle={vehicle}
          selectedLegId={activeStage?.legId ?? null}
          focusCoords={activeStage?.focusCoords ?? null}
          stopRange={activeStage?.stopRange ?? null}
          focusMaxZoom={activeStage?.focusMaxZoom ?? null}
          offlineBase={offlineBase}
          showPoi
          fitOnGeometry
          paddingTop={insets.top + 8 + headerHeight + 16}
          paddingBottom={panelHeight + insets.bottom + 16}
          onReady={handleMapReady}
          onLegTap={handleLegTap}
          onTilesStatus={handleTilesStatus}
          onError={handleMapError}
        />
      ) : (
        <View style={styles.mapPlaceholder} />
      )}

      <View style={[styles.header, { paddingTop: insets.top + 8 }]} pointerEvents="box-none">
        <View style={styles.headerSurface} onLayout={handleHeaderLayout}>
          <View style={styles.headerRow}>
            <Pressable
              onPress={goBack}
              style={({ pressed }) => [styles.backBtn, pressed && { opacity: 0.7 }]}
              accessibilityRole="button"
              accessibilityLabel={s.map.backA11y}
            >
              <ChevronLeft size={22} color={scheme.onSurface} />
            </Pressable>
            <View style={styles.headerContent}>
              {item.fromTitle === item.toTitle ? (
                <Text style={styles.headerTitle} numberOfLines={fontScale > 1.3 ? undefined : 2}>
                  {item.toTitle}
                </Text>
              ) : (
                <View style={styles.headerTitleRow}>
                  <Text style={styles.headerTitle} numberOfLines={1}>
                    {item.fromTitle}
                  </Text>
                  <ArrowRight size={16} color={scheme.primary} />
                  <Text style={styles.headerTitle} numberOfLines={1}>
                    {item.toTitle}
                  </Text>
                </View>
              )}
              <Text style={styles.headerSub}>
                {item.departAt}–{item.arriveAt} • {s.common.durMin(item.durationMin)}
                {item.transfers > 0 ? s.map.transfersSuffix(item.transfers) : ''}
                {delayMin !== 0 ? s.map.delaySuffix(delayMin) : ''}
              </Text>
            </View>
          </View>
          {offlineBase !== undefined && tilesDown && showOfflinePill && (
            <View style={styles.offlineNotice} accessibilityRole="alert">
              <WifiOff size={18} color={scheme.warning} />
              <Text style={styles.offlineText}>
                {mapError ? s.map.offlineTitle : s.map.offlineSub}
              </Text>
            </View>
          )}
        </View>
      </View>

      <View
        style={[styles.panel, { paddingBottom: Math.max(insets.bottom, 12) + 8 }]}
        onLayout={handlePanelLayout}
      >
        <View style={[styles.panelHead, compact && styles.panelHeadCompact]}>
          <View style={styles.panelTitleWrap}>
            <Text style={styles.panelTitle}>{s.map.stagesTitle}</Text>
            <View style={styles.stageCounterChip}>
              <Text style={styles.stageCounterText}>
                {activeStage ? `${activeStage.stageNumber}/${stages.length}` : stages.length}
              </Text>
            </View>
          </View>
          <View style={styles.panelActions}>
            {stages.length > 1 && (
              <View style={styles.stepperGroup}>
                <Pressable
                  onPress={() => handleStepStage(-1)}
                  accessibilityRole="button"
                  accessibilityLabel={s.map.backA11y}
                  style={({ pressed }) => [styles.stepperBtn, pressed && { opacity: 0.75 }]}
                >
                  <ChevronLeft size={18} color={scheme.onSurface} />
                </Pressable>
                <Pressable
                  onPress={() => handleStepStage(1)}
                  accessibilityRole="button"
                  accessibilityLabel={s.map.stagesTitle}
                  style={({ pressed }) => [styles.stepperBtn, pressed && { opacity: 0.75 }]}
                >
                  <ChevronRight size={18} color={scheme.onSurface} />
                </Pressable>
              </View>
            )}
            <Pressable
              onPress={handleShowRoute}
              accessibilityRole="button"
              accessibilityState={{ selected: activeStage === null }}
              accessibilityLabel={s.map.showWholeRoute}
              style={({ pressed }) => [
                styles.fitBtn,
                activeStage === null && styles.fitBtnActive,
                pressed && { opacity: 0.75 },
              ]}
            >
              <ScanLine
                size={20}
                color={activeStage === null ? scheme.onPrimaryContainer : scheme.onSurface}
              />
              <Text
                style={[
                  styles.fitLabel,
                  activeStage !== null && { color: scheme.onSurface },
                ]}
              >
                {s.map.showWholeRoute}
              </Text>
            </Pressable>
          </View>
        </View>
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
            const endpointTitle =
              stage.endpointRole === 'start'
                ? `${s.map.board}: ${stage.fromStop}`
                : stage.endpointRole === 'end'
                  ? `${s.map.alight}: ${stage.toStop}`
                  : null;
            return (
              <Pressable
                key={stage.id}
                onPress={() => handleSelectStage(stage.id)}
                style={({ pressed }) => [
                  styles.legCard,
                  { width: cardWidth },
                  active && styles.legCardActive,
                  pressed && { opacity: 0.8 },
                ]}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
                accessibilityLabel={
                  leg.mode === 'walk'
                    ? s.map.walkStageA11y(formatWalkDistance(stage.walkM ?? 0))
                    : s.map.lineStageA11y(leg.line ?? '', stage.toStop)
                }
              >
                <View style={styles.legBadgeColumn}>
                  <LineBadge mode={leg.mode} line={leg.line} compact active={active} />
                  {stage.segmentIndex && stage.segmentCount ? (
                    <View
                      style={[
                        styles.segmentPill,
                        active && styles.segmentPillActive,
                      ]}
                    >
                      <Text
                        style={[
                          styles.segmentPillText,
                          active && styles.segmentPillTextActive,
                        ]}
                      >
                        {stage.segmentIndex}/{stage.segmentCount}
                      </Text>
                    </View>
                  ) : (
                    <Text
                      style={[
                        styles.stageNumLabel,
                        active && styles.legTitleActive,
                      ]}
                    >
                      #{stage.stageNumber}
                    </Text>
                  )}
                </View>
                <View style={styles.legInfo}>
                  {endpointTitle ? (
                    <Text
                      style={[styles.legTitle, active && styles.legTitleActive]}
                      numberOfLines={fontScale > 1.3 ? undefined : 2}
                    >
                      {endpointTitle}
                    </Text>
                  ) : stage.fromStop === stage.toStop ? (
                    <Text
                      style={[styles.legTitle, active && styles.legTitleActive]}
                      numberOfLines={fontScale > 1.3 ? undefined : 2}
                    >
                      {stage.toStop}
                    </Text>
                  ) : leg.mode === 'walk' && isFallbackOrigin(stage.fromStop) ? (
                    <Text
                      style={[styles.legTitle, active && styles.legTitleActive]}
                      numberOfLines={fontScale > 1.3 ? undefined : 2}
                    >
                      {s.connection.walkTo(stage.toStop)}
                    </Text>
                  ) : (
                    <View style={styles.legTitleRow}>
                      <Text
                        style={[styles.legTitle, active && styles.legTitleActive]}
                        numberOfLines={fontScale > 1.3 ? 2 : 1}
                      >
                        {stage.fromStop}
                      </Text>
                      <ArrowRight
                        size={14}
                        color={active ? scheme.onPrimaryContainer : scheme.onSurfaceVariant}
                      />
                      <Text
                        style={[styles.legTitle, active && styles.legTitleActive]}
                        numberOfLines={fontScale > 1.3 ? 2 : 1}
                      >
                        {stage.toStop}
                      </Text>
                    </View>
                  )}
                  <Text style={[styles.legSub, active && styles.legTitleActive]}>
                    {stage.endpointRole
                      ? stage.departAt
                      : `${stage.departAt}–${stage.arriveAt}`}
                    {leg.mode === 'walk'
                      ? ` • ${formatWalkDistance(stage.walkM ?? 0)}`
                      : stage.stopsCount > 0
                        ? ` • ${s.map.legStops(stage.stopsCount)}`
                        : ''}
                  </Text>
                </View>
              </Pressable>
            );
          })}
        </ScrollView>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: scheme.surface },
  safe: { flex: 1, backgroundColor: scheme.surface },

  header: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    paddingHorizontal: 12,
  },
  headerSafe: {
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  headerSurface: {
    backgroundColor: scheme.surfaceContainerLow,
    borderRadius: shape.extraLarge,
    padding: 12,
    gap: 12,
    ...elev.level1,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  backBtn: {
    width: 48,
    height: 48,
    borderRadius: shape.large,
    backgroundColor: scheme.surfaceContainerHigh,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerContent: { flex: 1, minWidth: 0, gap: 4 },
  headerTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  headerTitle: { ...type.bodyLarge, fontWeight: '500', color: scheme.onSurface, flexShrink: 1 },
  headerSub: { ...type.bodySmall, color: scheme.onSurfaceVariant },

  mapPlaceholder: { flex: 1, backgroundColor: scheme.surface },

  offlineNotice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 8,
    paddingBottom: 4,
  },
  offlineText: { ...type.bodySmall, color: scheme.onSurfaceVariant, flex: 1 },

  panel: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: scheme.surfaceContainerLow,
    borderTopLeftRadius: shape.extraLarge,
    borderTopRightRadius: shape.extraLarge,
    paddingTop: 16,
  },
  panelHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    marginBottom: 14,
    gap: 12,
  },
  panelHeadCompact: { flexDirection: 'column', alignItems: 'stretch' },
  panelTitleWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexShrink: 1,
  },
  panelTitle: { ...type.titleMedium, fontWeight: '500', color: scheme.onSurface, flexShrink: 1 },
  stageCounterChip: {
    backgroundColor: scheme.surfaceContainerHighest,
    borderRadius: shape.full,
    paddingHorizontal: 9,
    paddingVertical: 3,
  },
  stageCounterText: {
    ...type.labelSmall,
    color: scheme.onSurfaceVariant,
    fontVariant: ['tabular-nums'],
  },
  panelActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  stepperGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  stepperBtn: {
    width: 44,
    height: 44,
    borderRadius: shape.large,
    backgroundColor: scheme.surfaceContainerHigh,
    alignItems: 'center',
    justifyContent: 'center',
  },
  fitBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 44,
    paddingHorizontal: 14,
    paddingVertical: 8,
    gap: 8,
    borderRadius: shape.large,
    backgroundColor: scheme.surfaceContainerHigh,
  },
  fitBtnActive: {
    backgroundColor: scheme.primaryContainer,
  },
  fitLabel: { ...type.labelLarge, color: scheme.onPrimaryContainer, flexShrink: 1 },
  legScroller: { flexGrow: 0, flexShrink: 0 },
  legScroll: {
    paddingHorizontal: 20,
    gap: 12,
  },
  legCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    minHeight: 74,
    borderRadius: shape.large,
    borderWidth: 1,
    borderColor: 'transparent',
    backgroundColor: scheme.surfaceContainerHigh,
  },
  legCardActive: {
    backgroundColor: scheme.primaryContainer,
    borderColor: scheme.primary,
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
    color: scheme.onSurfaceVariant,
    fontVariant: ['tabular-nums'],
  },
  legInfo: { flex: 1, minWidth: 0, gap: 6 },
  legTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  legTitle: {
    ...type.bodyMedium,
    fontWeight: '500',
    color: scheme.onSurface,
    flex: 1,
    minWidth: 0,
  },
  legTitleActive: { color: scheme.onPrimaryContainer },
  legSub: { ...type.bodySmall, color: scheme.onSurfaceVariant },

  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10, padding: 32 },
  centeredTitle: { ...type.titleMedium, color: scheme.onSurface, textAlign: 'center' },
  centeredSub: { ...type.bodyMedium, color: scheme.onSurfaceVariant, textAlign: 'center' },
  primaryBtn: {
    backgroundColor: scheme.primary,
    borderRadius: shape.large,
    paddingHorizontal: 20,
    paddingVertical: 16,
    minHeight: 52,
    marginTop: 8,
  },
  primaryBtnText: { ...type.labelLarge, fontWeight: '700', color: scheme.onPrimary },
});
