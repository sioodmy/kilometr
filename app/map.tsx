// Ekran „Mapa trasy": czysty podgląd trasy na mapie OSM.
//
// Filozofia: mapa jest podglądem, nie centrum sterowania. Użytkownik otworzył
// ją z karty połączenia, żeby zobaczyć, którędy jedzie. Wystarczy trasa
// na mapie, przystanki, etapy na dole i opcjonalny punkt pojazdu na żywo.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Location from 'expo-location';
import { ChevronLeft, WifiOff } from 'lucide-react-native';
import { elev, scheme, shape, type } from '../src/theme/tokens';
import { RoutingService } from '../src/services';
import { liveTracker } from '../src/services/liveTracker';
import { isLegRunning, matchVehicleToLeg, type LegVehicleMatch } from '../src/services/liveVehicle';
import {
  buildMapRoute,
  resolveGeometry,
  straightGeometry,
} from '../src/services/routeGeometry';
import { RouteMap, type RouteMapHandle } from '../src/components/RouteMap';
import { getLineColors, inferTransitMode, LineBadge } from '../src/components/LineBadge';
import { LiveDot } from '../src/components/LiveDot';
import { formatWalkDistance } from '../src/services/settings';
import type { Connection } from '../src/types/models';
import type { MapLeg, MapRoute, MapVehicle } from '../src/map/types';
import { useStrings } from '../src/i18n';

type Coord = [number, number];

const VEHICLE_POLL_MS = 6000;
const LOCATION_MIN_MOVE_M = 6;

function nowSec(): number {
  const d = new Date();
  return d.getHours() * 3600 + d.getMinutes() * 60 + d.getSeconds();
}

export default function RouteMapScreen() {
  const s = useStrings();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { id } = useLocalSearchParams<{ id: string }>();

  const [item, setItem] = useState<Connection | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [panelHeight, setPanelHeight] = useState(120);
  const [selectedLegId, setSelectedLegId] = useState<string | null>(null);
  const [vehicle, setVehicle] = useState<MapVehicle | null>(null);
  const [liveState, setLiveState] = useState<'fresh' | 'stale' | 'unknown'>('unknown');
  const [userLoc, setUserLoc] = useState<{ lat: number; lon: number; heading: number | null } | null>(null);
  const [tilesDown, setTilesDown] = useState(false);
  const [mapError, setMapError] = useState<string | null>(null);

  const mapRef = useRef<RouteMapHandle>(null);
  const geometryRef = useRef(new Map<string, Coord[]>());
  const shownVehicleRef = useRef<string | null>(null);

  // ─── Połączenie ─────────────────────────────────────────────
  useEffect(() => {
    if (!id) return;
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
  }, [id]);

  const route: MapRoute | null = useMemo(() => (item ? buildMapRoute(item) : null), [item]);

  const selectedLeg: MapLeg | null = useMemo(
    () => route?.legs.find((l) => l.id === selectedLegId) ?? route?.legs[0] ?? null,
    [route, selectedLegId],
  );

  // Domyślnie zaznaczamy pierwszy etap.
  useEffect(() => {
    if (!route || selectedLegId) return;
    setSelectedLegId(route.legs[0]?.id ?? null);
  }, [route, selectedLegId]);

  // ─── Geometria ulic (OSRM, w tle) ───────────────────────────
  const pushGeometry = useCallback((legId: string, coords: Coord[]) => {
    geometryRef.current.set(legId, coords);
    mapRef.current?.setGeometry(legId, coords);
  }, []);

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
      setLiveState(liveTracker.getLiveState());
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
      setVehicle({
        vehicleId: match.vehicle.vehicleId,
        legId: leg.id,
        line: match.vehicle.line,
        mode: inferTransitMode(leg.mode, match.vehicle.line) === 'tram' ? 'tram' : 'bus',
        color: bg,
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

  // ─── Pozycja użytkownika ────────────────────────────────────
  useEffect(() => {
    let sub: Location.LocationSubscription | null = null;
    (async () => {
      const { status } = await Location.getForegroundPermissionsAsync();
      if (status !== Location.PermissionStatus.GRANTED) return;
      sub = await Location.watchPositionAsync(
        {
          accuracy: Location.Accuracy.Balanced,
          distanceInterval: LOCATION_MIN_MOVE_M,
        },
        (loc) => {
          const heading =
            loc.coords.heading != null && isFinite(loc.coords.heading) ? loc.coords.heading : null;
          setUserLoc({
            lat: loc.coords.latitude,
            lon: loc.coords.longitude,
            heading,
          });
        },
      );
    })();
    return () => {
      sub?.remove();
    };
  }, []);

  // ─── Akcje ──────────────────────────────────────────────────
  const handleSelectLeg = (legId: string) => {
    setSelectedLegId(legId);
  };

  // ─── Render ─────────────────────────────────────────────────
  if (loadFailed) {
    return (
      <View style={styles.safe}>
        <View style={[styles.headerSafe, { paddingTop: insets.top + 6 }]}>
          <Pressable onPress={() => router.back()} style={styles.backBtn} hitSlop={10}>
            <ChevronLeft size={22} color={scheme.onSurface} />
          </Pressable>
          <Text style={styles.headerTitle}>{s.map.title}</Text>
        </View>
        <View style={styles.centered}>
          <Text style={styles.centeredTitle}>{s.map.loadFail}</Text>
          <Text style={styles.centeredSub}>{s.map.loadFailBody}</Text>
          <Pressable
            onPress={() => router.back()}
            style={({ pressed }) => [styles.primaryBtn, pressed && { opacity: 0.85 }]}
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
          <Pressable onPress={() => router.back()} style={styles.backBtn} hitSlop={10}>
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
      <RouteMap
        ref={mapRef}
        route={route}
        vehicle={vehicle}
        user={userLoc}
        selectedLegId={selectedLegId}
        paddingTop={insets.top + 72}
        paddingBottom={panelHeight + insets.bottom + 16}
        onReady={handleMapReady}
        onLegTap={handleSelectLeg}
        onTilesStatus={(ok) => {
          setTilesDown(!ok);
          if (ok) setMapError(null);
        }}
        onError={() => {
          setMapError(s.map.mapLoadFail);
          setTilesDown(true);
        }}
      />

      {/* Offline chip */}
      {tilesDown && (
        <View style={[styles.offlineChip, { top: insets.top + 72 }]} pointerEvents="none">
          <WifiOff size={13} color={scheme.onWarningContainer} />
          <Text style={styles.offlineText}>
            {mapError ? s.map.offlineTitle : s.map.offlineSub}
          </Text>
        </View>
      )}

      {/* Header */}
      <View style={[styles.header, { paddingTop: insets.top + 8 }]} pointerEvents="box-none">
        <View style={styles.headerPill} pointerEvents="auto">
          <Pressable
            onPress={() => router.back()}
            style={({ pressed }) => [styles.backBtn, pressed && { opacity: 0.7 }]}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel={s.map.backA11y}
          >
            <ChevronLeft size={22} color={scheme.onSurface} />
          </Pressable>
          <View style={styles.headerContent}>
            <Text style={styles.headerTitle} numberOfLines={1}>
              {item.fromTitle} → {item.toTitle}
            </Text>
            <Text style={styles.headerSub} numberOfLines={1}>
              {item.departAt}–{item.arriveAt} • {item.durationMin} min
              {item.transfers > 0 ? s.map.transfersSuffix(item.transfers) : ''}
              {delayMin !== 0 ? s.map.delaySuffix(delayMin) : ''}
            </Text>
          </View>
          {vehicle ? (
            <View style={styles.livePill}>
              <LiveDot color={vehicle.color} size={7} pulse={liveState === 'fresh'} />
              <Text style={styles.livePillText} numberOfLines={1}>
                {vehicle.line}
              </Text>
            </View>
          ) : null}
        </View>
      </View>

      {/* Bottom panel: leg pills */}
      <View
        style={[styles.panel, { paddingBottom: Math.max(insets.bottom, 12) + 8 }]}
        onLayout={(e) => {
          const h = e.nativeEvent.layout.height;
          if (Math.abs(h - panelHeight) > 2) setPanelHeight(h);
        }}
      >
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          overScrollMode="never"
          contentContainerStyle={styles.legScroll}
        >
          {route.legs.map((leg) => {
            const active = leg.id === selectedLeg?.id;
            return (
              <Pressable
                key={leg.id}
                onPress={() => handleSelectLeg(leg.id)}
                style={({ pressed }) => [
                  styles.legPill,
                  active && styles.legPillActive,
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
                {leg.mode === 'walk' ? (
                  <Text style={styles.walkEmoji}>🚶</Text>
                ) : (
                  <LineBadge line={leg.line} mode={leg.mode} compact />
                )}
                <View style={styles.legPillInfo}>
                  <Text
                    style={[styles.legPillTitle, active && styles.legPillTitleActive]}
                    numberOfLines={1}
                  >
                    {leg.mode === 'walk'
                      ? formatWalkDistance(leg.walkM ?? 0)
                      : `${leg.fromStop} → ${leg.toStop}`}
                  </Text>
                  <Text style={styles.legPillSub} numberOfLines={1}>
                    {leg.departAt}–{leg.arriveAt}
                    {leg.mode !== 'walk' && leg.stopsCount > 0
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

  // ─── Header ───────────────────────────────────────────────
  header: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    paddingHorizontal: 16,
  },
  headerSafe: {
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  headerPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: scheme.surfaceContainerHigh,
    borderRadius: shape.extraLarge,
    paddingVertical: 8,
    paddingHorizontal: 8,
    ...elev.level2,
  },
  backBtn: {
    width: 36,
    height: 36,
    borderRadius: shape.full,
    backgroundColor: scheme.surfaceContainerHighest,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerContent: { flex: 1, minWidth: 0 },
  headerTitle: { ...type.titleSmall, fontWeight: '700', color: scheme.onSurface },
  headerSub: { ...type.labelSmall, color: scheme.onSurfaceVariant, marginTop: 1 },
  livePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: scheme.surfaceContainerHighest,
    borderRadius: shape.full,
    paddingHorizontal: 8,
    paddingVertical: 4,
    maxWidth: 74,
  },
  livePillText: { ...type.labelSmall, fontWeight: '700', color: scheme.onSurface },

  // ─── Offline chip ─────────────────────────────────────────
  offlineChip: {
    position: 'absolute',
    left: 16,
    right: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: scheme.warningContainer,
    borderRadius: shape.full,
    paddingHorizontal: 14,
    paddingVertical: 8,
    ...elev.level1,
  },
  offlineText: { ...type.labelSmall, fontWeight: '600', color: scheme.onWarningContainer },

  // ─── Bottom panel ─────────────────────────────────────────
  panel: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: scheme.surfaceContainer,
    borderTopLeftRadius: shape.extraLarge,
    borderTopRightRadius: shape.extraLarge,
    paddingTop: 16,
    ...elev.level3,
  },
  legScroll: {
    paddingHorizontal: 16,
    gap: 10,
  },
  legPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: shape.large,
    backgroundColor: scheme.surfaceContainerHighest,
    minWidth: 140,
  },
  legPillActive: {
    backgroundColor: scheme.primaryContainer,
    borderWidth: 1.5,
    borderColor: scheme.primary,
  },
  walkEmoji: { fontSize: 18 },
  legPillInfo: { flex: 1, minWidth: 0, gap: 2 },
  legPillTitle: {
    ...type.labelMedium,
    fontWeight: '700',
    color: scheme.onSurface,
  },
  legPillTitleActive: { color: scheme.onPrimaryContainer },
  legPillSub: { ...type.labelSmall, color: scheme.onSurfaceVariant },

  // ─── Centered states ──────────────────────────────────────
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10, padding: 32 },
  centeredTitle: { ...type.titleMedium, color: scheme.onSurface, textAlign: 'center' },
  centeredSub: { ...type.bodyMedium, color: scheme.onSurfaceVariant, textAlign: 'center' },
  primaryBtn: {
    backgroundColor: scheme.primary,
    borderRadius: shape.full,
    paddingHorizontal: 20,
    paddingVertical: 12,
    marginTop: 8,
  },
  primaryBtnText: { ...type.labelLarge, fontWeight: '700', color: scheme.onPrimary },
});
