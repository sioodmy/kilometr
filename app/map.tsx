import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ChevronLeft, ScanLine, WifiOff } from 'lucide-react-native';
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
import { acquireMapServer } from '../src/services/mapServerLease';
import { useCurrentLocation } from '../src/services/currentLocation';
import { formatWalkDistance } from '../src/services/settings';
import type { Connection } from '../src/types/models';
import type { MapLeg, MapRoute, MapVehicle } from '../src/map/types';
import { useStrings } from '../src/i18n';
import { useTrackedTrip } from '../src/services/notifications';

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
  const { id } = useLocalSearchParams<{ id: string }>();

  const [loadedItem, setItem] = useState<Connection | null>(null);
  const { trip: trackedTrip } = useTrackedTrip();
  const trackedConnection = trackedTrip?.connection.id === String(id) ? trackedTrip.connection : null;
  const item = trackedConnection ?? (loadedItem?.id === String(id) ? loadedItem : null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [panelHeight, setPanelHeight] = useState(120);
  const [headerHeight, setHeaderHeight] = useState(96);
  const [selectedLegId, setSelectedLegId] = useState<string | null>(null);
  const [vehicle, setVehicle] = useState<MapVehicle | null>(null);
  const { location: gpsLocation } = useCurrentLocation();
  const userLoc = gpsLocation
    ? { lat: gpsLocation.lat, lon: gpsLocation.lon, heading: gpsLocation.heading }
    : null;
  const [tilesDown, setTilesDown] = useState(false);
  const [showOfflinePill, setShowOfflinePill] = useState(false);
  const [mapError, setMapError] = useState<string | null>(null);
  const offlinePillTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const mapRef = useRef<RouteMapHandle>(null);
  const geometryRef = useRef(new Map<string, Coord[]>());
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

  // ─── Pojazd na żywo ─────────────────────────────────────────
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
      const { bg } = getLineColors(match.vehicle.line, leg.mode);
      // Tryb bierze się z leg.mode (planner ustawia go z route_type feedu),
      // więc metro i SKA niosą własne tryby. 'walk' tu nie trafia, ale
      // unia MapVehicle go nie zna, stąd mapowanie na autobus.
      const vehMode = inferTransitMode(leg.mode, match.vehicle.line);
      setVehicle({
        vehicleId: match.vehicle.vehicleId,
        legId: leg.id,
        line: match.vehicle.line,
        mode: vehMode === 'walk' ? 'bus' : vehMode,
        color: mapLineColor(bg),
        lat: match.vehicle.lat,
        lon: match.vehicle.lon,
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
  }, [item, route]);

  // ─── Akcje ──────────────────────────────────────────────────
  const handleSelectLeg = (legId: string) => {
    if (legId === selectedLegId) mapRef.current?.fit();
    else setSelectedLegId(legId);
  };

  const handleShowRoute = () => {
    if (selectedLegId === null) mapRef.current?.fit();
    else setSelectedLegId(null);
  };

  const goBack = () => {
    if (router.canGoBack()) router.back();
    else router.replace('/');
  };

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
          user={userLoc}
          selectedLegId={selectedLegId}
          offlineBase={offlineBase}
          paddingTop={insets.top + 8 + headerHeight + 16}
          paddingBottom={panelHeight + insets.bottom + 16}
          onReady={handleMapReady}
          onLegTap={handleSelectLeg}
          onTilesStatus={(ok) => {
            if (ok) markTilesOk();
            else markTilesDown();
          }}
          onError={() => markTilesDown(s.map.mapLoadFail)}
        />
      ) : (
        <View style={styles.mapPlaceholder} />
      )}

      <View style={[styles.header, { paddingTop: insets.top + 8 }]} pointerEvents="box-none">
        <View
          style={styles.headerSurface}
          onLayout={(e) => setHeaderHeight(e.nativeEvent.layout.height)}
        >
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
              <Text style={styles.headerTitle} numberOfLines={fontScale > 1.3 ? undefined : 2}>
                {item.fromTitle} → {item.toTitle}
              </Text>
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
        onLayout={(e) => {
          const h = e.nativeEvent.layout.height;
          if (Math.abs(h - panelHeight) > 2) setPanelHeight(h);
        }}
      >
        <View style={[styles.panelHead, compact && styles.panelHeadCompact]}>
          <Text style={styles.panelTitle}>{s.map.stagesTitle}</Text>
          <Pressable
            onPress={handleShowRoute}
            accessibilityRole="button"
            accessibilityLabel={s.map.showWholeRoute}
            style={({ pressed }) => [styles.fitBtn, pressed && { opacity: 0.75 }]}
          >
            <ScanLine size={20} color={scheme.onPrimaryContainer} />
            <Text style={styles.fitLabel}>{s.map.showWholeRoute}</Text>
          </Pressable>
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
            return (
              <Pressable
                key={leg.id}
                onPress={() => handleSelectLeg(leg.id)}
                style={({ pressed }) => [
                  styles.legCard,
                  { width: Math.min(width - 40, 260 * Math.max(1, fontScale)) },
                  active && styles.legCardActive,
                  pressed && { opacity: 0.8 },
                ]}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
                accessibilityLabel={
                  leg.mode === 'walk'
                    ? s.map.walkStageA11y(formatWalkDistance(leg.walkM ?? 0))
                    : s.map.lineStageA11y(leg.line ?? '', leg.direction ?? '')
                }
              >
                <LineBadge line={leg.line} mode={leg.mode} compact active={active} />
                <View style={styles.legInfo}>
                  <Text
                    style={[styles.legTitle, active && styles.legTitleActive]}
                    numberOfLines={fontScale > 1.3 ? undefined : 2}
                  >
                    {leg.fromStop} → {leg.toStop}
                  </Text>
                  <Text style={[styles.legSub, active && styles.legTitleActive]}>
                    {leg.departAt}–{leg.arriveAt}
                    {leg.mode === 'walk'
                      ? ` • ${formatWalkDistance(leg.walkM ?? 0)}`
                      : leg.stopsCount > 0
                        ? ` • ${s.map.legStops(leg.stopsCount)}`
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
  fitBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 48,
    paddingHorizontal: 14,
    paddingVertical: 10,
    gap: 8,
    borderRadius: shape.large,
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
    padding: 16,
    minHeight: 96,
    borderRadius: shape.large,
    borderWidth: 1,
    borderColor: 'transparent',
    backgroundColor: scheme.surfaceContainerHigh,
  },
  legCardActive: {
    backgroundColor: scheme.primaryContainer,
    borderColor: scheme.primary,
  },
  legInfo: { flex: 1, minWidth: 0, gap: 6 },
  legTitle: {
    ...type.bodyMedium,
    fontWeight: '500',
    color: scheme.onSurface,
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
