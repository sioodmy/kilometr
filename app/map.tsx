// Ekran „Mapa trasy”: OSM w stylu aplikacji + trasa, przystanki, start/cel
// i pozycja pojazdu na żywo.
//
// Trasa rysuje się od razu (prostymi odcinkami), a przebieg ulic dociąga się
// w tle — dzięki temu ekran nigdy nie stoi pusty, nawet bez sieci.
//
// Całe sterowanie jest w dolnym menu (ThumbBar): akcje mapy i joystick
// trasy to dwa elementy jednego piku, a nie osobne podmenu. Górny pasek
// niesie tylko nawigację wstecz i nazwę połączenia.

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
import { liveTracker } from '../src/services/liveTracker';
import { isLegRunning, matchVehicleToLeg, type LegVehicleMatch } from '../src/services/liveVehicle';
import {
  buildMapRoute,
  distanceM,
  findNextStop,
  getAllRouteCoords,
  interpolateRoute,
  resolveGeometry,
  straightGeometry,
} from '../src/services/routeGeometry';
import { RouteMap, type MapStopTap, type RouteMapHandle } from '../src/components/RouteMap';
import { RouteJoystick } from '../src/components/RouteJoystick';
import { ThumbBar, ThumbBarDivider, ThumbBarItem } from '../src/components/ThumbBar';
import { getLineColors, inferTransitMode, LineBadge } from '../src/components/LineBadge';
import { LiveDot } from '../src/components/LiveDot';
import { formatWalkDistance } from '../src/services/settings';
import { secondsToTimeString } from '../src/gtfs/geo';
import type { Connection } from '../src/types/models';
import type { MapLeg, MapRoute, MapVehicle } from '../src/map/types';

type Coord = [number, number];

const VEHICLE_POLL_MS = 6000;
const LOCATION_MIN_MOVE_M = 6;
/** Ile metrów trasy „dalej” podświetlamy przy sterowaniu joystickiem. */
const AHEAD_HIGHLIGHT_M = 420;

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
  const [userLoc, setUserLoc] = useState<{ lat: number; lon: number; heading: number | null } | null>(
    null,
  );
  const [tilesDown, setTilesDown] = useState(false);
  const [schematic, setSchematic] = useState(false);
  const [mapError, setMapError] = useState<string | null>(null);
  const [shaping, setShaping] = useState(false);
  const [stopTap, setStopTap] = useState<MapStopTap | null>(null);

  // Sterowanie trasą (joystick w dolnym menu)
  const [geometryRev, setGeometryRev] = useState(0);
  const [joystickOn, setJoystickOn] = useState(false);
  const [joystickProgress, setJoystickProgress] = useState(0);
  const [joystickZoom, setJoystickZoom] = useState(15.5);

  const mapRef = useRef<RouteMapHandle>(null);
  // Geometria ulic trzymana jest poza stanem renderu: mapa dostaje ją
  // impulsowo, a po remoncie WebView trzeba ją wysłać jeszcze raz.
  const geometryRef = useRef(new Map<string, Coord[]>());
  // vehicleId, którego właśnie pokazujemy — pilnujemy go, żeby strzałka
  // nie skakała między dwoma pojazdami tego samego kursu.
  const shownVehicleRef = useRef<string | null>(null);


  // ─── Połączenie ─────────────────────────────────────────────
  useEffect(() => {
    if (!id) return;
    const connectionId = String(id);
    let cancelled = false;
    (async () => {
      let found: Connection | undefined;
      try {
        // Serwis sam zgłasza, czy połączenie jest świeże czy z pamięci
        // podręcznej — osobny fallback do findCachedConnection był martwy
        // (serwis już go wykonywał), więc mapa nie wiedziała, skąd ma dane.
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

  // Współrzędne całej trasy do płynnej nawigacji joystickiem
  const allRouteCoords = useMemo(() => {
    return getAllRouteCoords(route, geometryRef.current);
  }, [route, geometryRev]);

  const currentRoutePoint = useMemo(() => {
    return interpolateRoute(allRouteCoords, joystickProgress);
  }, [allRouteCoords, joystickProgress]);

  // Przystanek „dalej” wzdłuż trasy (ten, do którego zbliża się kursor) —
  // nie byle jaki najbliższy, bo przy skręcie byłby za kulisami.
  const aheadStop = useMemo(
    () => findNextStop(route, allRouteCoords, joystickProgress),
    [route, allRouteCoords, joystickProgress],
  );

  const userDistanceToCursor = useMemo(() => {
    if (!userLoc) return null;
    return distanceM(currentRoutePoint.point, [userLoc.lat, userLoc.lon]);
  }, [userLoc, currentRoutePoint.point]);

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
  // Kluczowe: pokazujemy wyłącznie pojazd, który naprawdę obsługuje
  // wybraną nogę. Tracker globalny dopasowuje każdy pojazd do jakiegoś
  // kursu, więc samo „ma matchedTripId z mojej listy” wystarczało, żeby
  // strzałka skakała po mieście. Dlatego filtrujemy po linii, korytarzu
  // wokół NOGI i zgodności z rozkładem (patrz services/liveVehicle).
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
      // Noga, którą właśnie jedziemy, ma pierwszeństwo przed resztą.
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
  }, [item, route, geometryRev]);

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
      // „Nitka trasy dalej” — na dużej mapie widać, co jest przed nami,
      // a nie tylko kursor w losowym miejscu.
      mapRef.current?.setAhead(aheadSlice(coords, prog, AHEAD_HIGHLIGHT_M));
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
    setJoystickOn((prev) => {
      const next = !prev;
      if (next) {
        setFollow(false);
        const coords = getAllRouteCoords(route, geometryRef.current);
        const { point } = interpolateRoute(coords, joystickProgress);
        mapRef.current?.center(point[0], point[1], joystickZoom, 400);
        mapRef.current?.setCursor({ lat: point[0], lon: point[1] });
        mapRef.current?.setAhead(aheadSlice(coords, joystickProgress, AHEAD_HIGHLIGHT_M));
      } else {
        mapRef.current?.setCursor(null);
        mapRef.current?.setAhead(null);
      }
      return next;
    });
  }, [route, joystickProgress, joystickZoom]);

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

  const delayMin = item.live ? item.delayMin : 0;

  return (
    <View style={styles.root}>
      <RouteMap
        ref={mapRef}
        route={route}
        vehicle={vehicle}
        follow={follow}
        user={userLoc}
        selectedLegId={selectedLegId}
        paddingTop={insets.top + 62}
        paddingBottom={panelHeight + insets.bottom + 12}
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

      {/* Sticky info o kafelkach i geometrii — tylko gdy coś jest nie tak */}
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

      {/* 1. Górny pasek: wstecz i nazwa połączenia. Sterowanie jest na dole,
          więc nic tu się nie powtarza. */}
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

      {/* 2. Dolne menu — jedyne sterowanie mapą. Zawiera joystick trasy,
          ale nie jako osobne podmenu: to kolejny element tego samego piku. */}
      <View
        style={[styles.menu, { paddingBottom: Math.max(insets.bottom, 8) }]}
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
          <View style={styles.legDetails}>
            {selectedLeg ? (
              <>
                <View style={styles.legMetaRow}>
                  <LineBadge line={selectedLeg.line} mode={selectedLeg.mode} compact />
                  <Text style={styles.legMetaBold} numberOfLines={1}>
                    {selectedLeg.mode === 'walk'
                      ? `Spacer ${formatWalkDistance(selectedLeg.walkM ?? 0)}`
                      : `${selectedLeg.fromStop} → ${selectedLeg.toStop}`}
                  </Text>
                </View>
                {vehicle && selectedLeg && vehicle.legId === selectedLeg.id ? (
                  <View style={styles.vehicleRow}>
                    <LiveDot color={vehicle.color} size={7} pulse={liveState === 'fresh'} />
                    <Text style={styles.vehicleText} numberOfLines={1}>
                      Pojazd {vehicle.vehicleId ?? vehicle.line} •{' '}
                      {vehicle.delaySec > 30
                        ? `spóźniony +${Math.round(vehicle.delaySec / 60)} min`
                        : vehicle.delaySec < -30
                          ? `przed czasem ${Math.round(vehicle.delaySec / 60)} min`
                          : 'punktualnie'}
                    </Text>
                  </View>
                ) : (
                  selectedLeg?.mode !== 'walk' && (
                    <Text style={styles.vehicleMuted} numberOfLines={1}>
                      {liveState === 'stale'
                        ? 'Brak danych live z MPK — rozkład z wyliczonymi czasami.'
                        : 'Pozycja pojazdu pojawi się, gdy MPK ją udostępni.'}
                    </Text>
                  )
                )}
              </>
            ) : null}
          </View>
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

        {joystickOn ? (
          <RouteJoystick
            coords={allRouteCoords}
            progress={joystickProgress}
            zoom={joystickZoom}
            aheadStopName={aheadStop?.stop.name}
            aheadStopDistanceM={aheadStop?.distanceM}
            userDistanceM={userDistanceToCursor}
            user={userLoc}
            vehicle={vehicle}
            onNavigate={handleJoystickNavigate}
            onJumpStart={handleJoystickJumpStart}
            onJumpFinish={handleJoystickJumpFinish}
          />
        ) : null}

        <ThumbBar inline>
          <ThumbBarItem
            onPress={handleFit}
            icon={<Maximize size={19} color={scheme.onSurfaceVariant} />}
            label="Dopasuj"
            accessibilityLabel="Dopasuj widok do trasy"
          />
          <ThumbBarDivider />
          <ThumbBarItem
            onPress={handleLocate}
            icon={
              <LocateFixed
                size={19}
                color={userLoc ? scheme.onSurfaceVariant : scheme.outline}
              />
            }
            label="Moje"
            accessibilityLabel="Pokaż moją pozycję"
          />
          <ThumbBarDivider />
          <ThumbBarItem
            onPress={() => {
              setFollow((f) => !f);
              setJoystickOn(false);
              mapRef.current?.setCursor(null);
              mapRef.current?.setAhead(null);
            }}
            active={follow}
            icon={
              <Navigation
                size={19}
                color={follow ? scheme.onPrimaryContainer : scheme.onSurfaceVariant}
                fill={follow ? scheme.onPrimaryContainer : 'transparent'}
              />
            }
            label="Śledź"
            accessibilityLabel={follow ? 'Wyłącz śledzenie pojazdu' : 'Śledź pojazd'}
          />
          <ThumbBarDivider />
          <ThumbBarItem
            onPress={toggleJoystick}
            active={joystickOn}
            icon={
              <Gamepad2
                size={19}
                color={joystickOn ? scheme.onPrimaryContainer : scheme.onSurfaceVariant}
              />
            }
            label="Trasa"
            accessibilityLabel={
              joystickOn ? 'Wyłącz sterowanie trasą' : 'Sterowanie trasą joystickiem'
            }
          />
        </ThumbBar>
      </View>
    </View>
  );
}
/** Odcinek trasy przed punktem `progress` — „nitka dalej” na dużej mapie. */
function aheadSlice(coords: Coord[], progress: number, maxM: number): Coord[] {
  if (coords.length < 2) return [];
  const { point: cursor, index } = interpolateRoute(coords, progress);
  const out: Coord[] = [cursor];
  let travelled = 0;
  let previous: Coord = cursor;
  for (let i = index + 1; i < coords.length; i++) {
    travelled += distanceM(previous, coords[i]);
    previous = coords[i];
    if (travelled > maxM) break;
    out.push(coords[i]);
  }
  return out;
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
    gap: 10,
    backgroundColor: scheme.surfaceContainerHigh,
    borderRadius: shape.large,
    paddingVertical: 6,
    paddingHorizontal: 6,
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
  headerText: { flex: 1, minWidth: 0 },
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

  // Dolne menu: jeden panel, w którym mieszczą się akcje mapy i joystick.
  menu: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: scheme.surfaceContainer,
    borderTopLeftRadius: shape.extraLarge,
    borderTopRightRadius: shape.extraLarge,
    paddingHorizontal: 10,
    paddingTop: 10,
    gap: 8,
    ...elev.level3,
  },
  legDetails: { gap: 3, paddingHorizontal: 4 },
  legMetaRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  legMetaBold: { ...type.bodyMedium, color: scheme.onSurface, fontWeight: '700', flex: 1 },
  legChips: { gap: 8, paddingRight: 4 },
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
  vehicleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  vehicleText: { ...type.labelSmall, color: scheme.primary, fontWeight: '700', flex: 1 },
  vehicleMuted: { ...type.labelSmall, color: scheme.onSurfaceVariant, fontStyle: 'italic' },

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
