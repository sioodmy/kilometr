// Ekran „Mapa trasy”: OSM w stylu aplikacji + trasa, przystanki, start/cel
// i pozycja pojazdu na żywo.
//
// Trasa rysuje się od razu (prostymi odcinkami), a przebieg ulic dociąga się
// w tle — dzięki temu ekran nigdy nie stoi pusty, nawet bez sieci.

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
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Location from 'expo-location';
import {
  ChevronLeft,
  Gamepad2,
  Info,
  LocateFixed,
  Maximize,
  Navigation,
  RotateCw,
  WifiOff,
} from 'lucide-react-native';
import { elev, scheme, shape, type } from '../src/theme/tokens';
import { RoutingService } from '../src/services';
import { findCachedConnection, rehydrateConnections } from '../src/services/offlineCache';
import { liveTracker } from '../src/services/liveTracker';
import {
  buildMapRoute,
  findNearestStop,
  getAllRouteCoords,
  interpolateRoute,
  projectOnGeometry,
  resolveGeometry,
  straightGeometry,
} from '../src/services/routeGeometry';
import { RouteMap, type MapStopTap, type RouteMapHandle } from '../src/components/RouteMap';
import { RouteJoystick } from '../src/components/RouteJoystick';
import { getLineColors, inferTransitMode, LineBadge } from '../src/components/LineBadge';
import { LiveDot } from '../src/components/LiveDot';
import { formatWalkDistance } from '../src/services/settings';
import { secondsToTimeString } from '../src/gtfs/geo';
import type { Connection } from '../src/types/models';
import type { MapLeg, MapRoute, MapVehicle } from '../src/map/types';

type Coord = [number, number];

const VEHICLE_POLL_MS = 8000;
const LOCATION_MIN_MOVE_M = 8;

function nowSec(): number {
  const d = new Date();
  return d.getHours() * 3600 + d.getMinutes() * 60 + d.getSeconds();
}

export default function RouteMapScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { id } = useLocalSearchParams<{ id: string }>();

  const [item, setItem] = useState<Connection | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [panelHeight, setPanelHeight] = useState(230);
  const [selectedLegId, setSelectedLegId] = useState<string | null>(null);
  const [follow, setFollow] = useState(false);
  const [vehicle, setVehicle] = useState<MapVehicle | null>(null);
  const [liveState, setLiveState] = useState<'fresh' | 'stale' | 'unknown'>('unknown');
  const [userLoc, setUserLoc] = useState<{ lat: number; lon: number } | null>(null);
  const [tilesDown, setTilesDown] = useState(false);
  const [schematic, setSchematic] = useState(false);
  const [mapError, setMapError] = useState<string | null>(null);
  const [shaping, setShaping] = useState(false);
  const [stopTap, setStopTap] = useState<MapStopTap | null>(null);

  // Sterowanie joystickiem
  const [geometryRev, setGeometryRev] = useState(0);
  const [showJoystick, setShowJoystick] = useState(false);
  const [joystickProgress, setJoystickProgress] = useState(0);
  const [joystickZoom, setJoystickZoom] = useState(15.5);

  const mapRef = useRef<RouteMapHandle>(null);
  // Geometria ulic trzymana jest poza stanem renderu: mapa dostaje ją
  // impulsowo, a po remoncie WebView trzeba ją wysłać jeszcze raz.
  const geometryRef = useRef(new Map<string, Coord[]>());

  // ─── Połączenie ─────────────────────────────────────────────
  useEffect(() => {
    if (!id) return;
    const connectionId = String(id);
    let cancelled = false;
    (async () => {
      let found: Connection | undefined;
      try {
        found = await RoutingService.getConnectionById(connectionId);
      } catch {
        found = undefined;
      }
      if (!found) {
        const cached = await findCachedConnection(connectionId);
        if (cached) found = rehydrateConnections([cached])[0];
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

  // Współrzędne całej trasy do płynnej nawigacji joystickiem
  const allRouteCoords = useMemo(() => {
    return getAllRouteCoords(route, geometryRef.current);
  }, [route, geometryRev]);

  const currentRoutePoint = useMemo(() => {
    return interpolateRoute(allRouteCoords, joystickProgress);
  }, [allRouteCoords, joystickProgress]);

  const nearestStopInfo = useMemo(() => {
    return findNearestStop(route, currentRoutePoint.point);
  }, [route, currentRoutePoint.point]);

  // Domyślnie zaznaczamy pierwszy etap: mapa od razu wie, co jest aktywne.
  useEffect(() => {
    if (!route || selectedLegId) return;
    setSelectedLegId(route.legs[0]?.id ?? null);
  }, [route, selectedLegId]);

  // ─── Geometria ulic (OSRM, w tle) ───────────────────────────
  const pushGeometry = useCallback((legId: string, coords: Coord[]) => {
    geometryRef.current.set(legId, coords);
    mapRef.current?.setGeometry(legId, coords);
    setGeometryRev((v) => v + 1);
  }, []);

  useEffect(() => {
    if (!route) return;
    let cancelled = false;
    const abort = new AbortController();
    setShaping(true);
    // Startujemy od prostych odcinków, żeby trasa była widoczna natychmiast.
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
      if (cancelled) return;
      setShaping(false);
      // Jeśli po dociągnięciu nadal rysujemy same proste między przystankami,
      // mówimy wprost, że to szkic — inaczej mapa kłamie o przebiegu ulic.
      const transit = route.legs.filter((l) => l.mode !== 'walk');
      setSchematic(
        transit.length > 0 &&
          transit.every((l) => (geometryRef.current.get(l.id)?.length ?? 0) <= l.stops.length),
      );
    })();
    return () => {
      cancelled = true;
      // Nie ciągniemy zapytań do OSRM po zamknięciu ekranu.
      abort.abort();
    };
  }, [route, pushGeometry]);

  const handleMapReady = useCallback(() => {
    // Po (re)montażu WebView wrzucamy geometrię jeszcze raz — bootstrap niesie
    // tylko przystanki, nie ulice.
    geometryRef.current.forEach((coords, legId) => {
      mapRef.current?.setGeometry(legId, coords);
    });
    // Dopasowanie po stronie aplikacji: tu znamy realny rozmiar mapy i
    // wysokość panelu, a WebView dopiero co wstał.
    mapRef.current?.fit();
  }, []);

  // ─── Pojazd na żywo ─────────────────────────────────────────
  useEffect(() => {
    if (!item) return;
    let cancelled = false;

    const update = () => {
      if (cancelled) return;
      setLiveState(liveTracker.getLiveState());
      const legs = route?.legs.filter((l) => l.mode !== 'walk' && l.tripId) ?? [];
      if (legs.length === 0) {
        setVehicle(null);
        return;
      }
      const trips = new Set(legs.map((l) => l.tripId as string));
      const sec = nowSec();
      // Najpierw noga, którą faktycznie jedziemy, potem dowolna dopasowana.
      const sorted = [...legs].sort((a, b) => {
        const inA = sec >= timeToSec(a.departAt) && sec <= timeToSec(a.arriveAt) ? 0 : 1;
        const inB = sec >= timeToSec(b.departAt) && sec <= timeToSec(b.arriveAt) ? 0 : 1;
        return inA - inB;
      });
      const match = liveTracker
        .snapshot()
        .find((v) => v.matchedTripId && trips.has(v.matchedTripId));
      if (!match) {
        setVehicle(null);
        return;
      }
      const leg = sorted.find((l) => l.tripId === match.matchedTripId) ?? sorted[0];
      const coords = geometryRef.current.get(leg.id) ?? straightGeometry(leg);
      const heading = projectOnGeometry(coords, match.lat, match.lon)?.heading ?? 0;
      const { bg } = getLineColors(match.line, leg.mode);
      setVehicle({
        vehicleId: match.vehicleId,
        legId: leg.id,
        line: match.line,
        mode: inferTransitMode(leg.mode, match.line) === 'tram' ? 'tram' : 'bus',
        color: bg,
        lat: match.lat,
        lon: match.lon,
        heading,
        delaySec: match.delaySec,
        currentStopName: match.currentStopName,
        nextStopName: match.nextStopName,
        updatedAt: match.updatedAt,
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
          setUserLoc({ lat: loc.coords.latitude, lon: loc.coords.longitude });
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
    setStopTap(null);
  };

  const handleLocate = () => {
    if (!userLoc) return;
    setFollow(false);
    mapRef.current?.center(userLoc.lat, userLoc.lon, 16);
  };

  const handleFit = () => {
    setFollow(false);
    mapRef.current?.fit();
  };

  const handleJoystickNavigate = useCallback(
    (prog: number, z: number, dur = 0) => {
      setJoystickProgress(prog);
      setJoystickZoom(z);
      setFollow(false);

      const coords = getAllRouteCoords(route, geometryRef.current);
      const { point } = interpolateRoute(coords, prog);
      mapRef.current?.center(point[0], point[1], z, dur);
      mapRef.current?.setCursor({ lat: point[0], lon: point[1] });
    },
    [route],
  );

  const handleJoystickJumpStart = useCallback(() => {
    handleJoystickNavigate(0, 16, 400);
  }, [handleJoystickNavigate]);

  const handleJoystickJumpFinish = useCallback(() => {
    handleJoystickNavigate(1, 16, 400);
  }, [handleJoystickNavigate]);

  const toggleJoystick = useCallback(() => {
    setShowJoystick((prev) => {
      const next = !prev;
      if (next) {
        setFollow(false);
        const coords = getAllRouteCoords(route, geometryRef.current);
        const { point } = interpolateRoute(coords, joystickProgress);
        mapRef.current?.center(point[0], point[1], joystickZoom, 400);
        mapRef.current?.setCursor({ lat: point[0], lon: point[1] });
      } else {
        mapRef.current?.setCursor(null);
      }
      return next;
    });
  }, [route, joystickProgress, joystickZoom]);

  const handleCloseJoystick = useCallback(() => {
    setShowJoystick(false);
    mapRef.current?.setCursor(null);
  }, []);

  // ─── Render ─────────────────────────────────────────────────
  if (loadFailed) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <View style={styles.header}>
          <Pressable onPress={() => router.back()} style={styles.iconBtn} hitSlop={10}>
            <ChevronLeft size={23} color={scheme.onSurface} />
          </Pressable>
          <Text style={styles.headerTitle}>Mapa trasy</Text>
        </View>
        <View style={styles.centered}>
          <Text style={styles.centeredTitle}>Nie udało się wczytać połączenia</Text>
          <Text style={styles.centeredSub}>
            Mapa pokazuje konkretne połączenie, więc musi być dostępne w pamięci lub w cache.
          </Text>
          <Pressable
            onPress={() => router.back()}
            style={({ pressed }) => [styles.primaryBtn, pressed && { opacity: 0.85 }]}
          >
            <Text style={styles.primaryBtnText}>Wróć do szczegółów</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  if (!item || !route) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <View style={styles.header}>
          <Pressable onPress={() => router.back()} style={styles.iconBtn} hitSlop={10}>
            <ChevronLeft size={23} color={scheme.onSurface} />
          </Pressable>
          <Text style={styles.headerTitle}>Mapa trasy</Text>
        </View>
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={scheme.primary} />
          <Text style={styles.centeredSub}>Składam połączenie…</Text>
        </View>
      </SafeAreaView>
    );
  }

  const transitLegs = route.legs.filter((l) => l.mode !== 'walk');
  const walkLegs = route.legs.filter((l) => l.mode === 'walk');
  const delayMin = item.live ? item.delayMin : 0;

  return (
    <View style={styles.root}>
      <RouteMap
        ref={mapRef}
        route={route}
        vehicle={vehicle}
        follow={follow}
        user={userLoc ? { ...userLoc, heading: null } : null}
        selectedLegId={selectedLegId}
        paddingBottom={panelHeight + insets.bottom + 16}
        onReady={handleMapReady}
        onLegTap={handleSelectLeg}
        onStopTap={(s) => setStopTap(s)}
        onUserMoved={() => setFollow(false)}
        onTilesStatus={(ok) => {
          setTilesDown(!ok);
          if (ok) setMapError(null);
        }}
        onError={(message) => {
          setMapError(message);
          setTilesDown(true);
        }}
      />

      {/* Sticky info o kafelkach i geometrii — nad mapą, pod paskiem */}
      {(tilesDown || shaping || schematic) && (
        <View style={[styles.chipStack, { top: insets.top + 62 }]} pointerEvents="none">
          {tilesDown ? (
            <View style={styles.chip}>
              <WifiOff size={13} color={scheme.onWarningContainer} />
              <Text style={styles.chipText}>
                {mapError ? 'Mapa niedostępna — brak sieci' : 'Kafelki się nie ładują'}
              </Text>
            </View>
          ) : (
            <>
              {shaping && (
                <View style={styles.chip}>
                  <RotateCw size={13} color={scheme.onSecondaryContainer} />
                  <Text style={styles.chipText}>Uzupełniam przebieg ulic…</Text>
                </View>
              )}
              {schematic && (
                <View style={styles.chip}>
                  <Info size={13} color={scheme.onSecondaryContainer} />
                  <Text style={styles.chipText}>Trasa szkicowa — bez przebiegu ulic</Text>
                </View>
              )}
            </>
          )}
        </View>
      )}

      {/* 1. Górny pasek: wstecz, trasa, dopasuj, joystick, zlokalizuj, śledź */}
      <View style={[styles.header, { paddingTop: insets.top + 6 }]} pointerEvents="box-none">
        <View style={styles.headerBar} pointerEvents="auto">
          <Pressable
            onPress={() => router.back()}
            style={({ pressed }) => [styles.iconBtn, pressed && { opacity: 0.7 }]}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="Wróć"
          >
            <ChevronLeft size={22} color={scheme.onSurface} />
          </Pressable>
          <View style={styles.headerText}>
            <Text style={styles.headerTitle} numberOfLines={1}>
              {item.fromTitle} → {item.toTitle}
            </Text>
            <Text style={styles.headerSub} numberOfLines={1}>
              {item.departAt}–{item.arriveAt} • {item.durationMin} min
              {item.transfers > 0 ? ` • ${item.transfers} przesiad.` : ''}
              {delayMin !== 0 ? ` • ${delayMin > 0 ? '+' : ''}${delayMin} min` : ''}
            </Text>
          </View>
          <Pressable
            onPress={handleFit}
            style={({ pressed }) => [styles.iconBtn, pressed && { opacity: 0.7 }]}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="Dopasuj widok do trasy"
          >
            <Maximize size={19} color={scheme.onSecondaryContainer} />
          </Pressable>
          <Pressable
            onPress={toggleJoystick}
            style={({ pressed }) => [
              styles.iconBtn,
              showJoystick && styles.iconBtnActive,
              pressed && { opacity: 0.7 },
            ]}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityState={{ selected: showJoystick }}
            accessibilityLabel={showJoystick ? 'Wyłącz joystick trasy' : 'Sterowanie trasą joystickiem'}
          >
            <Gamepad2
              size={19}
              color={showJoystick ? scheme.onPrimaryContainer : scheme.onSecondaryContainer}
            />
          </Pressable>
          <Pressable
            onPress={handleLocate}
            style={({ pressed }) => [styles.iconBtn, pressed && { opacity: 0.7 }]}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="Pokaż moją pozycję"
          >
            <LocateFixed size={19} color={scheme.onSecondaryContainer} />
          </Pressable>
          <Pressable
            onPress={() => setFollow((f) => !f)}
            style={({ pressed }) => [
              styles.iconBtn,
              follow && styles.iconBtnActive,
              pressed && { opacity: 0.7 },
            ]}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityState={{ selected: follow }}
            accessibilityLabel={follow ? 'Wyłącz śledzenie pojazdu' : 'Śledź pojazd'}
          >
            <Navigation
              size={19}
              color={follow ? scheme.onPrimaryContainer : scheme.onSecondaryContainer}
              fill={follow ? scheme.onPrimaryContainer : 'transparent'}
            />
          </Pressable>
        </View>
      </View>

      {/* 2. Panel dolny: Joystick trasy LUB etapy i szczegóły */}
      {showJoystick && route ? (
        <View
          style={[styles.joystickContainer, { paddingBottom: Math.max(insets.bottom, 12) }]}
          onLayout={(e) => {
            const h = e.nativeEvent.layout.height;
            if (Math.abs(h - panelHeight) > 2) setPanelHeight(h);
          }}
        >
          <RouteJoystick
            route={route}
            progress={joystickProgress}
            zoom={joystickZoom}
            nearestStopName={nearestStopInfo?.stop.name}
            currentLegLine={nearestStopInfo?.leg.line}
            currentLegMode={nearestStopInfo?.leg.mode}
            onNavigate={handleJoystickNavigate}
            onJumpStart={handleJoystickJumpStart}
            onJumpFinish={handleJoystickJumpFinish}
            onFit={handleFit}
            onClose={handleCloseJoystick}
          />
        </View>
      ) : (
        <View
          style={[styles.panel, { paddingBottom: Math.max(insets.bottom, 10) }]}
          onLayout={(e) => {
            const h = e.nativeEvent.layout.height;
            if (Math.abs(h - panelHeight) > 2) setPanelHeight(h);
          }}
        >
          {stopTap ? (
            <View style={styles.stopCard}>
              <View style={[styles.stopDot, stopDotStyle(stopTap.role)]} />
              <View style={styles.stopText}>
                <Text style={styles.stopRole}>{stopRoleLabel(stopTap.role)}</Text>
                <Text style={styles.stopName} numberOfLines={2}>
                  {stopTap.name}
                </Text>
              </View>
              {stopTap.arriveSec != null && (
                <Text style={styles.stopTime}>{secondsToTimeString(stopTap.arriveSec)}</Text>
              )}
              <Pressable
                onPress={() => setStopTap(null)}
                hitSlop={10}
                style={({ pressed }) => [styles.stopClose, pressed && { opacity: 0.6 }]}
                accessibilityRole="button"
                accessibilityLabel="Zamknij informację o przystanku"
              >
                <Text style={styles.stopCloseText}>✕</Text>
              </Pressable>
            </View>
          ) : (
            <Text style={styles.legsHint}>Etapy podróży</Text>
          )}

          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            overScrollMode="never"
            contentContainerStyle={styles.legChips}
          >
            {route.legs.map((leg) => {
              const active = leg.id === selectedLeg?.id;
              return (
                <Pressable
                  key={leg.id}
                  onPress={() => handleSelectLeg(leg.id)}
                  style={({ pressed }) => [
                    styles.legChip,
                    active && styles.legChipActive,
                    pressed && { opacity: 0.8 },
                  ]}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                  accessibilityLabel={
                    leg.mode === 'walk'
                      ? `Etap pieszy ${formatWalkDistance(leg.walkM ?? 0)}`
                      : `Linia ${leg.line ?? ''} kierunek ${leg.direction ?? ''}`
                  }
                >
                  {leg.mode === 'walk' ? (
                    <Text style={styles.walkIcon}>🚶</Text>
                  ) : (
                    <LineBadge line={leg.line} mode={leg.mode} compact />
                  )}
                  <View style={styles.legChipText}>
                    <Text style={[styles.legChipTitle, active && styles.legChipTitleActive]}>
                      {leg.mode === 'walk' ? formatWalkDistance(leg.walkM ?? 0) : `Linia ${leg.line}`}
                    </Text>
                    <Text style={styles.legChipSub} numberOfLines={1}>
                      {leg.departAt}–{leg.arriveAt}
                    </Text>
                  </View>
                </Pressable>
              );
            })}
          </ScrollView>

          {/* Szczegóły wybranego etapu + pojazd live */}
          <View style={styles.legDetails}>
            {selectedLeg && (
              <>
                <View style={styles.legMeta}>
                  <Text style={styles.legMetaFrom} numberOfLines={1}>
                    Z: <Text style={styles.legMetaBold}>{selectedLeg.fromStop}</Text>
                  </Text>
                  <Text style={styles.legMetaTo} numberOfLines={1}>
                    Do: <Text style={styles.legMetaBold}>{selectedLeg.toStop}</Text>
                  </Text>
                </View>
                {selectedLeg.stops.length > 2 && (
                  <Text style={styles.stopsCount}>
                    {selectedLeg.stops.length - 2}{' '}
                    {selectedLeg.stops.length - 2 === 1
                      ? 'przystanek pośredni'
                      : selectedLeg.stops.length - 2 < 5
                        ? 'przystanki pośrednie'
                        : 'przystanków pośrednich'}
                  </Text>
                )}
              </>
            )}

            {/* Pojazd na żywo dla wybranego etapu */}
            {vehicle && selectedLeg && vehicle.legId === selectedLeg.id ? (
              <View style={styles.vehicleRow}>
                <LiveDot color={vehicle.color} size={8} pulse={liveState === 'fresh'} />
                <Text style={styles.vehicleText} numberOfLines={1}>
                  Pojazd {vehicle.vehicleId ?? vehicle.line} •{' '}
                  {vehicle.delaySec > 30
                    ? `spóźniony +${Math.round(vehicle.delaySec / 60)} min`
                    : vehicle.delaySec < -30
                      ? `przed czasem ${Math.round(vehicle.delaySec / 60)} min`
                      : 'punktualnie'}
                  {vehicle.nextStopName ? ` • następny: ${vehicle.nextStopName}` : ''}
                </Text>
              </View>
            ) : (
              selectedLeg?.mode !== 'walk' && (
                <Text style={styles.vehicleMuted}>
                  {liveState === 'stale'
                    ? 'Brak danych live z MPK (rozkład z wyliczonymi czasami).'
                    : 'Rozkład jazdy — pozycja pojazdu pojawi się, gdy MPK ją udostępni.'}
                </Text>
              )
            )}
          </View>

          {/* Legenda + akcja włączenia joysticka */}
          <View style={styles.legend}>
            {transitLegs.slice(0, 1).map((l) => (
              <View key={`l-${l.id}`} style={styles.legendItem}>
                <View style={[styles.legendLine, { backgroundColor: l.color }]} />
                <Text style={styles.legendText}>kurs {l.line ?? ''}</Text>
              </View>
            ))}
            {walkLegs.length > 0 && (
              <View style={styles.legendItem}>
                <View style={styles.legendDash} />
                <Text style={styles.legendText}>spacer</Text>
              </View>
            )}
            <View style={styles.legendItem}>
              <View style={[styles.legendLine, { backgroundColor: scheme.success }]} />
              <Text style={styles.legendText}>start</Text>
            </View>
            <View style={styles.legendItem}>
              <View style={[styles.legendLine, { backgroundColor: scheme.error }]} />
              <Text style={styles.legendText}>cel</Text>
            </View>
            <Pressable
              onPress={toggleJoystick}
              style={({ pressed }) => [styles.joystickPill, pressed && { opacity: 0.75 }]}
              hitSlop={6}
              accessibilityRole="button"
              accessibilityLabel="Włącz sterowanie trasą joystickiem"
            >
              <Gamepad2 size={13} color={scheme.primary} />
              <Text style={styles.joystickPillText}>Joystick</Text>
            </Pressable>
          </View>
        </View>
      )}
    </View>
  );
}

function timeToSec(hhmm: string): number {
  const m = /^(\d{1,2}):(\d{2})/.exec(hhmm.trim());
  if (!m) return -1;
  return Number(m[1]) * 3600 + Number(m[2]) * 60;
}

function stopRoleLabel(role: MapStopTap['role']): string {
  if (role === 'board') return 'Wsiadaj';
  if (role === 'alight') return 'Wysiadaj';
  if (role === 'walk') return 'Spacer';
  return 'Przystanek';
}

function stopDotStyle(role: MapStopTap['role']) {
  if (role === 'board') return { backgroundColor: scheme.primary };
  if (role === 'alight') return { backgroundColor: scheme.error };
  return { backgroundColor: scheme.onSurfaceVariant };
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: scheme.surface },
  safe: { flex: 1, backgroundColor: scheme.surface },
  header: { position: 'absolute', top: 0, left: 0, right: 0, paddingHorizontal: 12 },
  headerBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: scheme.surfaceContainerHigh,
    borderRadius: shape.large,
    paddingVertical: 8,
    paddingHorizontal: 8,
    ...elev.level2,
  },
  iconBtn: {
    width: 38,
    height: 38,
    borderRadius: shape.full,
    backgroundColor: scheme.surfaceContainerHighest,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconBtnActive: { backgroundColor: scheme.primaryContainer },
  headerText: { flex: 1, minWidth: 0 },
  headerTitle: { ...type.titleSmall, fontWeight: '700', color: scheme.onSurface },
  headerSub: { ...type.labelSmall, color: scheme.onSurfaceVariant, marginTop: 1 },
  chipStack: { position: 'absolute', left: 16, right: 16, gap: 6, alignItems: 'center' },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: scheme.secondaryContainer,
    borderRadius: shape.full,
    paddingHorizontal: 12,
    paddingVertical: 6,
    ...elev.level1,
  },
  chipText: { ...type.labelSmall, fontWeight: '600', color: scheme.onSecondaryContainer },
  panel: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: scheme.surfaceContainer,
    borderTopLeftRadius: shape.extraLarge,
    borderTopRightRadius: shape.extraLarge,
    paddingHorizontal: 14,
    paddingTop: 12,
    gap: 10,
    ...elev.level3,
  },
  joystickContainer: {
    position: 'absolute',
    left: 10,
    right: 10,
    bottom: 0,
    zIndex: 10,
  },
  legsHint: { ...type.labelSmall, color: scheme.onSurfaceVariant, fontWeight: '700', letterSpacing: 0.4 },
  legChips: { gap: 8, paddingRight: 14 },
  legChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: shape.medium,
    backgroundColor: scheme.surfaceContainerHighest,
  },
  legChipActive: {
    backgroundColor: scheme.secondaryContainer,
    borderWidth: 1,
    borderColor: scheme.primary,
  },
  walkIcon: { fontSize: 16 },
  legChipText: { gap: 1 },
  legChipTitle: { ...type.labelMedium, fontWeight: '700', color: scheme.onSurface },
  legChipTitleActive: { color: scheme.onSecondaryContainer },
  legChipSub: { ...type.labelSmall, color: scheme.onSurfaceVariant },
  legDetails: { gap: 6 },
  legMeta: { flexDirection: 'row', gap: 12, flexWrap: 'wrap' },
  legMetaFrom: { ...type.bodySmall, color: scheme.onSurfaceVariant, flex: 1, minWidth: 120 },
  legMetaTo: { ...type.bodySmall, color: scheme.onSurfaceVariant, flex: 1, minWidth: 120 },
  legMetaBold: { color: scheme.onSurface, fontWeight: '700' },
  stopsCount: { ...type.labelSmall, color: scheme.onSurfaceVariant },
  vehicleRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 2 },
  vehicleText: { ...type.labelSmall, color: scheme.primary, fontWeight: '700', flex: 1 },
  vehicleMuted: { ...type.labelSmall, color: scheme.onSurfaceVariant, fontStyle: 'italic' },
  legend: { flexDirection: 'row', alignItems: 'center', gap: 12, flexWrap: 'wrap' },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  legendLine: { width: 18, height: 4, borderRadius: 2 },
  legendDash: {
    width: 18,
    height: 4,
    borderRadius: 2,
    backgroundColor: scheme.onSurfaceVariant,
    opacity: 0.6,
  },
  legendText: { ...type.labelSmall, color: scheme.onSurfaceVariant },
  joystickPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
    backgroundColor: scheme.surfaceContainerHighest,
    borderWidth: 1,
    borderColor: scheme.outlineVariant,
    marginLeft: 'auto',
  },
  joystickPillText: {
    ...type.labelSmall,
    color: scheme.onSurface,
    fontWeight: '700',
  },
  stopCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: scheme.surfaceContainerHigh,
    borderRadius: shape.large,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  stopDot: { width: 10, height: 10, borderRadius: 5 },
  stopText: { flex: 1, minWidth: 0 },
  stopRole: { ...type.labelSmall, color: scheme.onSurfaceVariant, fontWeight: '700' },
  stopName: { ...type.bodyMedium, color: scheme.onSurface, fontWeight: '600' },
  stopTime: {
    ...type.titleMedium,
    color: scheme.onSurface,
    fontVariant: ['tabular-nums'],
  },
  stopClose: { width: 28, height: 28, alignItems: 'center', justifyContent: 'center' },
  stopCloseText: { color: scheme.onSurfaceVariant, fontSize: 15 },
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
