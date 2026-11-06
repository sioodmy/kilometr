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
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  ArrowRight,
  ChevronLeft,
  LocateFixed,
  SubdirectoryArrowRight,
  WifiOff,
  ZoomOutMap,
} from '../src/components/icons';
import { DirectionsWalk } from '../src/components/DirectionsWalk';
import { elev, scheme, shape, type } from '../src/theme/tokens';
import { RoutingService } from '../src/services';
import {
  buildMapRoute,
  resolveGeometry,
  straightGeometry,
  pinRouteGeometry,
  userRidingTransit,
  type Coord,
} from '../src/services/routeGeometry';
import { RouteMap, type RouteMapHandle } from '../src/components/RouteMap';
import { LineBadge } from '../src/components/LineBadge';
import { acquireMapServer } from '../src/services/mapServerLease';
import { formatWalkDistance } from '../src/services/settings';
import { useCurrentLocation } from '../src/services/currentLocation';
import type { Connection } from '../src/types/models';
import type { MapRoute, MapUserDot } from '../src/map/types';
import { useStrings } from '../src/i18n';
import { useTrackedTrip } from '../src/services/notifications';
import { normalizeConnectionId } from '../src/services/routing/connectionIdentity';
import { isFallbackOrigin } from '../src/config';

/** Nie pokazuj błędu podczas pierwszych prób wczytania lokalnych kafelków. */
const OFFLINE_PILL_MS = 2500;

export default function RouteMapScreen() {
  const s = useStrings();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { width, fontScale } = useWindowDimensions();
  const compact = width / fontScale < 330;
  const { location: myLocation } = useCurrentLocation();
  const { id: routeId } = useLocalSearchParams<{ id: string }>();
  const id = normalizeConnectionId(routeId ?? '');

  const [loadedItem, setItem] = useState<Connection | null>(null);
  const { trip: trackedTrip } = useTrackedTrip();
  const trackedConnection =
    trackedTrip?.connection.id === String(id) ? trackedTrip.connection : null;
  const item = trackedConnection ?? (loadedItem?.id === String(id) ? loadedItem : null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [panelHeight, setPanelHeight] = useState(120);
  const [headerHeight, setHeaderHeight] = useState(96);
  const [selectedLegId, setSelectedLegId] = useState<string | null>(null);
  /** true = user przewinął/przybliżył mapę ręcznie; zeruje „niebieski” stan przycisku trasy. */
  const [userPanned, setUserPanned] = useState(false);
  /** true = kropeczka GPS ukryta, bo lokalizacja leży na trasie (user jedzie pojazdem). */
  const [dotHidden, setDotHidden] = useState(false);
  const [tilesDown, setTilesDown] = useState(false);
  const [showOfflinePill, setShowOfflinePill] = useState(false);
  const [mapError, setMapError] = useState<string | null>(null);
  const offlinePillTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const mapRef = useRef<RouteMapHandle>(null);
  const geometryRef = useRef(new Map<string, Coord[]>());

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

  // ─── Połączenie ─────────────────────────────────────────────
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

  // Stare połączenia bywają bez stacji (kurs spoza wycinka). Bez nich noga
  // to dwa punkty, czyli kreska cięciem zamiast wzdłuż torów. Dociągamy
  // sekwencję tym samym kanałem co LegTimeline.
  useEffect(() => {
    if (!item) return;
    const connId = item.id;
    const legs = item.legs;
    if (
      !legs.some(
        (l) =>
          l.mode !== 'walk' && l.tripId && (!l.intermediateStops || l.intermediateStops.length < 2),
      )
    ) {
      return;
    }
    let cancelled = false;
    (async () => {
      const enriched = await Promise.all(
        legs.map(async (l) => {
          if (
            l.mode === 'walk' ||
            !l.tripId ||
            (l.intermediateStops && l.intermediateStops.length >= 2)
          )
            return l;
          try {
            const full = await RoutingService.getTripStops(l.tripId);
            if (!full || full.length < 2) return l;
            const b = full.findIndex((s) => s.stopId === l.fromStopId);
            const a = full.findIndex((s) => s.stopId === l.toStopId);
            const slice = b >= 0 && a >= 0 && b < a ? full.slice(b, a + 1) : full;
            return slice.length >= 2 ? { ...l, intermediateStops: slice } : l;
          } catch {
            return l;
          }
        }),
      );
      if (!cancelled && enriched.some((l, i) => l !== legs[i])) {
        setItem((prev) => (prev && prev.id === connId ? { ...prev, legs: enriched } : prev));
      }
    })();
    return () => {
      cancelled = true;
    };
    // Raz na połączenie: po wzbogaceniu id bez zmian, więc bez pętli.
  }, [item?.id]);

  const route: MapRoute | null = useMemo(() => (item ? buildMapRoute(item) : null), [item]);

  useEffect(() => {
    setSelectedLegId(null);
  }, [route?.id]);

  // ─── Geometria ulic (OSRM, w tle) ───────────────────────────
  const pushGeometry = useCallback((legId: string, coords: Coord[]) => {
    geometryRef.current.set(legId, coords);
    mapRef.current?.setGeometry(legId, coords);
  }, []);

  // ─── Zestaw mapy offline ────────────────────────────────────
  // undefined = jeszcze sprawdzamy lokalny serwer; null = brak pakietu (CDN);
  // string = kafle z telefonu. WebView montujemy dopiero po decyzji, inaczej
  // mapa chwilę ładuje CDN, pada bez sieci i miga żółtym „offline".
  const [offlineBase, setOfflineBase] = useState<string | null | undefined>(undefined);
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
      markTilesOk();
    })();
    return () => {
      cancelled = true;
      release?.();
    };
  }, [markTilesOk]);

  useEffect(() => {
    if (!route) return;
    let cancelled = false;
    const abort = new AbortController();
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
    mapRef.current?.fit();
  }, []);

  // ─── Kropeczka GPS ──────────────────────────────────────────
  // Ukrywamy ją, gdy user najwyraźniej jedzie: lokalizacja leży blisko
  // geometrii nogi kursowej, ale daleko od przystanku wejściowego i
  // wyjściowego (tam czeka albo już wysiadł, więc kropka zostaje).
  useEffect(() => {
    if (!myLocation || !route) {
      setDotHidden(false);
      return;
    }
    setDotHidden(userRidingTransit(route, myLocation, geometryRef.current));
  }, [myLocation, route]);

  const userDot = useMemo<MapUserDot | null>(
    () =>
      myLocation && !dotHidden
        ? { lat: myLocation.lat, lon: myLocation.lon, accuracy: myLocation.accuracy }
        : null,
    [myLocation, dotHidden],
  );

  // ─── Akcje ──────────────────────────────────────────────────
  const handleSelectLeg = useCallback(
    (legId: string) => {
      if (legId === selectedLegId) mapRef.current?.fit();
      else setSelectedLegId(legId);
    },
    [selectedLegId],
  );

  const handleShowRoute = useCallback(() => {
    setUserPanned(false);
    if (selectedLegId === null) mapRef.current?.fit();
    else setSelectedLegId(null);
  }, [selectedLegId]);

  const handleCenterOnMe = useCallback(() => {
    if (!myLocation) return;
    setUserPanned(true);
    mapRef.current?.centerOnMe(myLocation.lat, myLocation.lon);
  }, [myLocation]);

  const handleCamMove = useCallback(() => setUserPanned(true), []);

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

  // ─── Render ─────────────────────────────────────────────────
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
  // „Cała trasa” jest w kolorze dopiero, gdy kamera faktycznie pokazuje całą trasę.
  const routeAtView = selectedLegId === null && !userPanned;

  return (
    <View style={styles.root}>
      {offlineBase !== undefined ? (
        <RouteMap
          ref={mapRef}
          route={route}
          userDot={userDot}
          selectedLegId={selectedLegId}
          offlineBase={offlineBase}
          showPoi
          paddingTop={insets.top + 8 + headerHeight + 16}
          paddingBottom={panelHeight + insets.bottom + 16}
          onReady={handleMapReady}
          onLegTap={handleSelectLeg}
          onCamMove={handleCamMove}
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
          <Text style={styles.panelTitle}>{s.map.stagesTitle}</Text>
          <View style={[styles.panelActions, compact && styles.panelActionsCompact]}>
            <Pressable
              onPress={handleCenterOnMe}
              disabled={!myLocation}
              accessibilityRole="button"
              accessibilityLabel={s.map.myLocationA11y}
              accessibilityState={{ disabled: !myLocation }}
              style={({ pressed }) => [
                styles.locBtn,
                !myLocation && styles.locBtnOff,
                pressed && { opacity: 0.75 },
              ]}
            >
              <LocateFixed size={20} color={scheme.onSurfaceVariant} />
            </Pressable>
            <Pressable
              onPress={handleShowRoute}
              accessibilityRole="button"
              accessibilityLabel={s.map.showWholeRoute}
              style={({ pressed }) => [
                styles.fitBtn,
                routeAtView && styles.fitBtnActive,
                compact && styles.fitBtnCompact,
                pressed && { opacity: 0.75 },
              ]}
            >
              <ZoomOutMap
                size={20}
                color={routeAtView ? scheme.onPrimaryContainer : scheme.onSurfaceVariant}
              />
              <Text style={[styles.fitLabel, routeAtView && styles.fitLabelActive]}>
                {s.map.showWholeRoute}
              </Text>
            </Pressable>
          </View>
        </View>
        <ScrollView
          style={styles.legScroller}
          horizontal
          showsHorizontalScrollIndicator={false}
          overScrollMode="never"
          contentContainerStyle={styles.legScroll}
        >
          {route.legs.map((leg) => {
            const active = leg.id === selectedLegId;
            const dimmed = selectedLegId !== null && !active;
            const walk = leg.mode === 'walk';
            // Spacer „OD do DO” dostaje dwa wiersze; spacer do przystanku jeden.
            const twoRowWalk =
              walk && leg.fromStop !== leg.toStop && !isFallbackOrigin(leg.fromStop);
            const dist = formatWalkDistance(leg.walkM ?? 0);
            return (
              <Pressable
                key={leg.id}
                onPress={() => handleSelectLeg(leg.id)}
                style={({ pressed }) => [
                  styles.legChip,
                  walk ? styles.legChipWalk : styles.legChipTransit,
                  dimmed && styles.legChipDimmed,
                  pressed && { opacity: 0.8 },
                ]}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
                accessibilityLabel={
                  walk
                    ? twoRowWalk
                      ? s.map.walkStageStopsA11y(leg.fromStop, leg.toStop, dist)
                      : s.map.walkStageA11y(leg.toStop, dist)
                    : s.map.lineStageA11y(leg.line ?? '', leg.direction ?? '')
                }
              >
                {walk ? (
                  twoRowWalk ? (
                    <View style={styles.walkRows}>
                      <View style={styles.walkRow}>
                        <DirectionsWalk size={20} color={scheme.onSurfaceVariant} />
                        <Text style={styles.walkText} numberOfLines={1}>
                          {leg.fromStop}
                        </Text>
                      </View>
                      <View style={styles.walkRow}>
                        <SubdirectoryArrowRight size={20} color={scheme.onSurfaceVariant} />
                        <Text style={styles.walkText} numberOfLines={1}>
                          {leg.toStop}
                        </Text>
                      </View>
                    </View>
                  ) : (
                    <View style={styles.walkRow}>
                      <DirectionsWalk size={20} color={scheme.onSurfaceVariant} />
                      <Text style={styles.walkText} numberOfLines={1}>
                        {leg.toStop}
                      </Text>
                    </View>
                  )
                ) : (
                  <LineBadge leg={leg} size="large" style={styles.legChipBadge} />
                )}
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
  panelTitle: { ...type.titleMedium, fontWeight: '500', color: scheme.onSurface, flexShrink: 1 },
  panelActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  panelActionsCompact: { alignSelf: 'stretch' },
  locBtn: {
    width: 48,
    minHeight: 48,
    borderRadius: shape.large,
    backgroundColor: scheme.surfaceContainerHigh,
    alignItems: 'center',
    justifyContent: 'center',
  },
  locBtnOff: { opacity: 0.4 },
  fitBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 48,
    paddingHorizontal: 14,
    paddingVertical: 10,
    gap: 8,
    borderRadius: shape.large,
    backgroundColor: scheme.surfaceContainerHigh,
  },
  fitBtnActive: { backgroundColor: scheme.primaryContainer },
  fitBtnCompact: { flex: 1 },
  fitLabel: { ...type.labelLarge, color: scheme.onSurfaceVariant, flexShrink: 1 },
  fitLabelActive: { color: scheme.onPrimaryContainer },
  legScroller: { flexGrow: 0, flexShrink: 0 },
  legScroll: {
    paddingHorizontal: 20,
    gap: 12,
    alignItems: 'stretch',
  },
  legChip: {
    minHeight: 72,
    borderRadius: shape.large,
    justifyContent: 'center',
  },
  // chip z pojazdem: wiersz, żeby badge rozciągał się na wysokość (cross axis).
  legChipTransit: { flexDirection: 'row', alignItems: 'stretch' },
  // chip pieszy: tło i zaokrąglenie jak karty etapów, wysokość dyktuje spacer OD->DO.
  legChipWalk: {
    backgroundColor: scheme.surfaceContainerHigh,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  legChipDimmed: { opacity: 0.5 },
  legChipBadge: { alignSelf: 'stretch', borderRadius: shape.large, paddingHorizontal: 24 },
  walkRows: { gap: 10 },
  walkRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  walkText: {
    ...type.bodyMedium,
    fontWeight: '500',
    color: scheme.onSurface,
    maxWidth: 190,
  },

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
