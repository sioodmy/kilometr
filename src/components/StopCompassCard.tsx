// Karta połączenia: w miejscu radaru pokazujemy kierunek do przystanku.
//
// Dalej niż 100 m od przystanku zamiast kompasu jest kompaktowy widget
// nawigacji: statyczna mapka obrócona kompasem po lewej, a po prawej ikona
// i odległość następnego manewru. Dotknięcie całego widgetu otwiera pełną
// mapę. Poniżej 100 m wraca kompas.

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  Linking,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import * as Location from 'expo-location';
import {
  ArrowUp,
  ArrowUpLeft,
  ArrowUpRight,
  BusFront,
  CornerDownLeft,
  CornerDownRight,
  CornerUpLeft,
  CornerUpRight,
  Footprints,
  LocateFixed,
  MapPinned,
  Maximize2,
  Navigation2,
  RotateCcw,
  Signpost,
  TramFront,
  TrainFront,
} from 'lucide-react-native';
import { elev, scheme, shape, type } from '../theme/tokens';
import type { Connection } from '../types/models';
import { getLineColors, inferTransitMode, LineBadge } from './LineBadge';
import { useWalkSpeedMps, walkMinutesFor } from '../services/settings';

import { useStrings, type Strings } from '../i18n';
import { NavMiniMap } from './NavMiniMap';
import { fetchFootRoute, projectRoutePoint, type Coord } from '../services/routeGeometry';
import {
  nextGuidance,
  nextGuidanceAfter,
  type Guidance,
  type LegSpan,
  type ManeuverKind,
} from '../services/turnManeuver';
import type { MapLeg } from '../map/types';
import { useCurrentLocation } from '../services/currentLocation';
import { navigationTarget } from '../services/navigationTarget';

interface StopCompassCardProps {
  connection: Connection;
  /** Otwiera pełną mapę trasy. Cały widget nawigacji jest w tym celu klikalny. */
  onOpenMap?: () => void;
}

const COMPASS_SWITCH_M = 100;
const OFF_ROUTE_M = 45;
const REROUTE_COOLDOWN_MS = 30000;
const REROUTE_MIN_MOVE_M = 25;
const REROUTE_MAX_DIST_M = 10000;
const ON_TRANSIT_MPS = 4;

// Zwykły View/Pressable nie przyjmie Animated.Value w stylu (na Fabric kończy
// się to twardym crashem `opacity: ReadableNativeMap cannot be cast to Double`
// przy pierwszym renderze). Cały widget nawigacji jest klikalny, więc animowane
// krycie dostaje przez animowany Pressable.
const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

function calculateDistanceMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371e3;
  const φ1 = (lat1 * Math.PI) / 180;
  const φ2 = (lat2 * Math.PI) / 180;
  const Δφ = ((lat2 - lat1) * Math.PI) / 180;
  const Δλ = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
    Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function calculateBearing(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const φ1 = (lat1 * Math.PI) / 180;
  const φ2 = (lat2 * Math.PI) / 180;
  const Δλ = ((lon2 - lon1) * Math.PI) / 180;
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

function getDirectionLabel(relAngle: number, s: Strings): string {
  if (relAngle <= 20 || relAngle >= 340) return s.compass.ahead;
  if (relAngle < 70) return s.compass.slightRight;
  if (relAngle <= 110) return s.compass.right;
  if (relAngle < 160) return s.compass.backRight;
  if (relAngle <= 200) return s.compass.back;
  if (relAngle < 250) return s.compass.backLeft;
  if (relAngle <= 290) return s.compass.left;
  return s.compass.slightLeft;
}

/** Ikona pieszego skrętu albo dotarcia do celu. */
function maneuverIcon(kind: ManeuverKind) {
  switch (kind) {
    case 'straight':
    case 'depart':
      return ArrowUp;
    case 'slightLeft':
      return ArrowUpLeft;
    case 'slightRight':
      return ArrowUpRight;
    case 'left':
      return CornerUpLeft;
    case 'right':
      return CornerUpRight;
    case 'sharpLeft':
      return CornerDownLeft;
    case 'sharpRight':
      return CornerDownRight;
    case 'uturn':
      return RotateCcw;
    case 'arrive':
      return MapPinned;
    default:
      return CornerUpRight;
  }
}

function legIcon(mode: string, line?: string) {
  const m = inferTransitMode(mode as never, line);
  if (m === 'tram') return TramFront;
  if (m === 'bus') return BusFront;
  if (m === 'train') return TrainFront;
  return Signpost;
}

function normalizeAngle(a: number): number {
  return ((a % 360) + 360) % 360;
}

/**
 * Zaokrąglenie do wartości, które czyta się z ekranu: 20 m, 50 m, 120 m.
 * Dokładne metry zmieniają się co sekundę i migotały na widgecie.
 */
function roundNavM(m: number): number {
  if (m < 50) return Math.max(0, Math.round(m / 5) * 5);
  if (m < 500) return Math.round(m / 10) * 10;
  return Math.round(m / 50) * 50;
}

export function StopCompassCard({ connection, onOpenMap }: StopCompassCardProps) {
  const s = useStrings();
  const walkMps = useWalkSpeedMps();
  const { location: userLocation, state: locState } = useCurrentLocation();
  const transitLegs = useMemo(() => {
    return connection.legs.filter((l) => l.mode !== 'walk');
  }, [connection.legs]);

  const [clockNow, setClockNow] = useState(Date.now);
  useEffect(() => {
    const timer = setInterval(() => setClockNow(Date.now()), 15000);
    return () => clearInterval(timer);
  }, []);
  const firstDepartureAt = useMemo(
    () => Date.now() + connection.departInMin * 60 * 1000,
    [connection.id],
  );
  const targetSelection = useMemo(
    () =>
      navigationTarget(
        connection,
        transitLegs,
        firstDepartureAt,
        clockNow,
        userLocation?.speed ?? null,
      ),
    [connection, transitLegs, firstDepartureAt, clockNow, userLocation?.speed],
  );
  const activeLeg = targetSelection?.leg ?? connection.legs[0];
  const targetLat = targetSelection?.end ? activeLeg?.toLat : activeLeg?.fromLat;
  const targetLon = targetSelection?.end ? activeLeg?.toLon : activeLeg?.fromLon;
  const stopName = targetSelection?.end
    ? activeLeg?.toStop || connection.toTitle
    : activeLeg?.fromStop || connection.fromTitle;
  const platform = targetSelection?.end ? undefined : activeLeg?.platformCode;

  const { bg: lineAccent, fg: lineFg } = getLineColors(activeLeg?.line, activeLeg?.mode);
  const TargetIcon = legIcon(activeLeg?.mode ?? 'walk', activeLeg?.line);

  const [deviceHeading, setDeviceHeading] = useState<number | null>(null);
  // Filtrowany kurs urządzenia (stopnie). Surowy magnetometr skacze ±10°,
  // wygładzamy low-pass na wektorze + histereza, żeby kompas nie migotał.
  const headingVec = useRef<{ x: number; y: number } | null>(null);
  const lastAppliedHeading = useRef(0);
  // Jednorazowe pojawienie się treści nawigacji po pierwszym fixie GPS.
  // Powód: fix i geometria schodzą asynchronicznie, więc zamiast skoku
  // layoutu jest krótki fade. Tylko raz, nie przy każdej zmianie pozycji.
  const navOpacity = useRef(new Animated.Value(0)).current;
  const navFaded = useRef(false);
  useEffect(() => {
    if (userLocation && !navFaded.current) {
      navFaded.current = true;
      Animated.timing(navOpacity, {
        toValue: 1,
        duration: 280,
        useNativeDriver: true,
      }).start();
    }
  }, [userLocation, navOpacity]);

  const [navigationRoute, setNavigationRoute] = useState<{ targetKey: string; path: Coord[] } | null>(
    null,
  );
  const [rerouting, setRerouting] = useState(false);
  const routeRequest = useRef<AbortController | null>(null);
  const lastRerouteAttempt = useRef<{
    targetKey: string;
    at: number;
    lat: number;
    lon: number;
  } | null>(null);

  useEffect(() => {
    let cancelled = false;
    let headingSub: Location.LocationSubscription | null = null;
    const alpha = 0.28;

    const applyHeading = (raw: number) => {
      const radians = raw * (Math.PI / 180);
      const previous = headingVec.current;
      const x = previous ? previous.x + (Math.sin(radians) - previous.x) * alpha : Math.sin(radians);
      const y = previous ? previous.y + (Math.cos(radians) - previous.y) * alpha : Math.cos(radians);
      headingVec.current = { x, y };
      const degrees = normalizeAngle((Math.atan2(x, y) * 180) / Math.PI);
      let difference = Math.abs(degrees - lastAppliedHeading.current) % 360;
      if (difference > 180) difference = 360 - difference;
      if (difference >= 1.5) {
        lastAppliedHeading.current = degrees;
        setDeviceHeading(degrees);
      }
    };

    void Location.watchHeadingAsync((heading) => {
      if (cancelled) return;
      const degrees = heading.trueHeading >= 0 ? heading.trueHeading : heading.magHeading;
      if (degrees >= 0) applyHeading(degrees);
    }).then((sub) => {
      if (cancelled) sub.remove();
      else headingSub = sub;
    }).catch(() => undefined);

    return () => {
      cancelled = true;
      headingSub?.remove();
    };
  }, []);

  const targetKey =
    targetLat != null && targetLon != null
      ? `${targetLat.toFixed(5)},${targetLon.toFixed(5)}`
      : null;
  const onTransit = userLocation?.speed != null && userLocation.speed >= ON_TRANSIT_MPS;
  const stopPos = useMemo<Coord | null>(
    () => (targetLat != null && targetLon != null ? [targetLat, targetLon] : null),
    [targetLat, targetLon],
  );
  const userPos = useMemo<Coord | null>(
    () => (userLocation ? [userLocation.lat, userLocation.lon] : null),
    [userLocation],
  );
  const routeForTarget =
    !onTransit && navigationRoute?.targetKey === targetKey ? navigationRoute.path : null;
  const navigationLeg = useMemo<MapLeg>(
    () => ({
      id: `walk-to-${targetKey ?? 'stop'}`,
      mode: 'walk',
      color: lineAccent,
      fromStop: '',
      toStop: stopName,
      departAt: '',
      arriveAt: '',
      stopsCount: 0,
      live: false,
      stops: [],
      approx: false,
    }),
    [targetKey, lineAccent, stopName],
  );
  const navigationSpans = useMemo<LegSpan[]>(() =>
    routeForTarget && routeForTarget.length > 1
      ? [{ leg: navigationLeg, start: 0, end: routeForTarget.length - 1 }]
      : [],
  [routeForTarget, navigationLeg]);
  const routeProjection = useMemo(() => {
    if (!routeForTarget || !userLocation) return null;
    return projectRoutePoint(routeForTarget, userLocation.lat, userLocation.lon);
  }, [routeForTarget, userLocation]);
  const offRoute = routeProjection != null && routeProjection.offsetM > OFF_ROUTE_M;
  const guidance: Guidance | null = useMemo(() => {
    if (!routeForTarget || !userLocation || !navigationSpans.length || offRoute) return null;
    return nextGuidance(routeForTarget, navigationSpans, [userLocation.lat, userLocation.lon]);
  }, [routeForTarget, userLocation, navigationSpans, offRoute]);
  const nextUp = useMemo(() => {
    if (!routeForTarget || !userLocation || !guidance || !navigationSpans.length) return null;
    return nextGuidanceAfter(routeForTarget, navigationSpans, [userLocation.lat, userLocation.lon]);
  }, [routeForTarget, userLocation, guidance, navigationSpans]);

  const activeHeading = deviceHeading ?? userLocation?.heading ?? null;
  const { distanceM, relativeAngle } = useMemo(() => {
    if (!userLocation || targetLat == null || targetLon == null) {
      return { distanceM: null, relativeAngle: 0 };
    }
    const dist = calculateDistanceMeters(
      userLocation.lat,
      userLocation.lon,
      targetLat,
      targetLon,
    );
    const bearing = calculateBearing(
      userLocation.lat,
      userLocation.lon,
      targetLat,
      targetLon,
    );
    const rel = (bearing - (activeHeading ?? 0) + 360) % 360;
    return { distanceM: Math.round(dist / 5) * 5, relativeAngle: rel };
  }, [userLocation, targetLat, targetLon, activeHeading]);

  const hasTarget = targetLat != null && targetLon != null;
  const compassReady = hasTarget && distanceM != null;

  const compassHint = !hasTarget
    ? s.compass.noCoords
    : locState === 'denied'
      ? s.compass.locOff
      : s.compass.locWaiting;

  const walkMin = !onTransit && distanceM != null ? walkMinutesFor(distanceM, walkMps) : null;
  const directionLabel = compassReady ? getDirectionLabel(relativeAngle, s) : compassHint;

  const showNav = distanceM != null && distanceM > COMPASS_SWITCH_M;

  useEffect(() => {
    routeRequest.current?.abort();
    routeRequest.current = null;
    lastRerouteAttempt.current = null;
    setNavigationRoute(null);
    setRerouting(false);
  }, [targetKey]);

  useEffect(() => {
    if (!showNav || !userLocation || !stopPos || !targetKey) return;
    if (onTransit || distanceM == null || distanceM > REROUTE_MAX_DIST_M) return;
    const routeIsCurrent = navigationRoute?.targetKey === targetKey;
    const needsRoute =
      !routeIsCurrent || routeProjection == null || routeProjection.offsetM > OFF_ROUTE_M;
    if (!needsRoute || routeRequest.current) return;

    const now = Date.now();
    const last = lastRerouteAttempt.current;
    if (last && last.targetKey === targetKey && now - last.at < REROUTE_COOLDOWN_MS) return;
    if (
      last &&
      last.targetKey === targetKey &&
      calculateDistanceMeters(last.lat, last.lon, userLocation.lat, userLocation.lon) <
        REROUTE_MIN_MOVE_M
    ) {
      return;
    }

    lastRerouteAttempt.current = {
      targetKey,
      at: now,
      lat: userLocation.lat,
      lon: userLocation.lon,
    };
    setRerouting(true);
    const controller = new AbortController();
    routeRequest.current = controller;
    void fetchFootRoute([userLocation.lat, userLocation.lon], stopPos, controller.signal)
      .then((path) => {
        if (routeRequest.current !== controller || !path || path.length < 2) return;
        setNavigationRoute({ targetKey, path });
      })
      .catch(() => undefined)
      .finally(() => {
        if (routeRequest.current === controller) {
          routeRequest.current = null;
          setRerouting(false);
        }
      });
  }, [
    showNav,
    userLocation,
    stopPos,
    targetKey,
    distanceM,
    navigationRoute,
    routeProjection,
    onTransit,
  ]);
  useEffect(() => () => routeRequest.current?.abort(), []);

  const ManeuverIcon = useMemo(() => {
    if (!guidance) return null;
    if (guidance.maneuver.kind === 'board' || guidance.maneuver.kind === 'alight') {
      return ArrowUp;
    }
    return guidance.maneuver.kind === 'arrive'
      ? Footprints
      : maneuverIcon(guidance.maneuver.kind);
  }, [guidance]);

  const maneuverLabel = useMemo(() => {
    if (!guidance) return null;
    const m = s.map.maneuver;
    switch (guidance.maneuver.kind) {
      case 'depart':
        return m.depart;
      case 'straight':
        return m.straight;
      case 'slightLeft':
        return m.slightLeft;
      case 'left':
        return m.left;
      case 'sharpLeft':
        return m.sharpLeft;
      case 'slightRight':
        return m.slightRight;
      case 'right':
        return m.right;
      case 'sharpRight':
        return m.sharpRight;
      case 'uturn':
        return m.uturn;
      case 'board':
      case 'alight':
        return s.compass.headToStop;
      case 'arrive':
        return m.arrive;
      default:
        return m.straight;
    }
  }, [guidance, s]);

  const distText = guidance
    ? s.compass.distanceText(roundNavM(guidance.maneuver.distanceM))
    : null;

  // Widget ma zawsze czytelny nagłówek. Bez instrukcji trasy (poza trasą,
  // brak geometrii) mówimy wprost, dokąd iść, a strzałka pokazuje kierunek.
  const headLabel = onTransit
    ? s.compass.nextStop
    : guidance && maneuverLabel
      ? maneuverLabel
      : s.compass.headToStop;
  const headDist =
    guidance && distText
      ? distText
      : distanceM != null
        ? s.compass.distanceText(roundNavM(distanceM))
        : '';
  const footerText =
    walkMin != null
      ? guidance && distanceM != null
        ? `${s.compass.navToStop(s.compass.distanceText(roundNavM(distanceM)))} · ${s.compass.walkMins(walkMin)}`
        : s.compass.walkMins(walkMin)
      : '';

  // „Potem” pokazujemy tylko wtedy, gdy następny manewr jest wyraźnie
  // dalej niż obecny. Inaczej dwie linijki mówią to samo.
  const nextUpText = useMemo(() => {
    if (!nextUp) return null;
    const gap = nextUp.maneuver.distanceM - (guidance?.maneuver.distanceM ?? 0);
    if (gap < 40) return null;
    const label = s.map.maneuver;
    const kind = nextUp.maneuver.kind;
    const what =
      kind === 'arrive'
        ? label.arrive
        : kind === 'straight'
          ? label.straight
          : kind === 'slightLeft'
            ? label.slightLeft
            : kind === 'left'
              ? label.left
              : kind === 'sharpLeft'
                ? label.sharpLeft
                : kind === 'slightRight'
                  ? label.slightRight
                  : kind === 'right'
                    ? label.right
                    : kind === 'sharpRight'
                      ? label.sharpRight
                      : label.uturn;
    return `${label.then} ${what.toLocaleLowerCase()} · ${s.compass.distanceText(Math.round(nextUp.maneuver.distanceM))}`;
  }, [nextUp, guidance, s]);

  const openMap = useCallback(() => {
    onOpenMap?.();
  }, [onOpenMap]);

  return (
    <View style={styles.card}>
      <View style={styles.cardHeader}>
        <View style={styles.cardHeaderIcon}>
          <Navigation2 size={18} color={scheme.primary} />
        </View>
        <View style={styles.cardHeaderText}>
          <Text style={styles.cardTitle}>{s.compass.title}</Text>
          <Text style={styles.cardSubtitle}>{s.compass.followCompass}</Text>
        </View>
      </View>

      <View style={styles.stopInfo}>
        <View style={styles.badgeRow}>
          {activeLeg && <LineBadge mode={activeLeg.mode} line={activeLeg.line} />}
          {activeLeg?.direction && (
            <Text style={styles.directionText} numberOfLines={1}>
              {s.compass.directionPrefix(activeLeg.direction)}
            </Text>
          )}
        </View>
        <Text style={styles.stopName}>{stopName}</Text>
        {platform ? (
          <View style={styles.platformBadge}>
            <Text style={styles.platformText}>{platform}</Text>
          </View>
        ) : null}
      </View>

      {/* ─── Nawigacja ─────────────────────────────────────── */}
      {/* Slot rezerwuje wysokość docelowego widgetu od pierwszego renderu.
          Powód: stany oczekiwanie/radar/mapa mają różne wysokości i bez tego
          karta skakała w momencie fixu GPS. */}
      {showNav && userPos ? (
        // Cały widget jest jednym przyciskiem: dotknięcie otwiera pełną mapę.
        <AnimatedPressable
          onPress={openMap}
          style={({ pressed }) => [styles.navWidget, styles.navSlot, { opacity: navOpacity }, pressed && styles.navWidgetPressed]}
          accessibilityRole="button"
          accessibilityLabel={s.compass.navA11y(headLabel, headDist)}
        >
          <View style={styles.navRow}>
            <NavMiniMap
              path={routeForTarget ?? []}
              user={userPos}
              stop={stopPos}
              headingDeg={activeHeading}
              accuracyM={userLocation?.accuracy ?? null}
              accent={lineAccent}
              style={styles.navMapPane}
            />
            <View style={styles.navCopy}>
              <View style={styles.navDistanceRow}>
                {guidance && ManeuverIcon ? (
                  <ManeuverIcon size={22} strokeWidth={2.5} color={scheme.primary} />
                ) : (
                  <View style={{ transform: [{ rotate: `${relativeAngle}deg` }] }}>
                    <ArrowUp size={22} strokeWidth={2.5} color={scheme.primary} />
                  </View>
                )}
                <Text style={styles.navDistance} numberOfLines={1}>
                  {headDist}
                </Text>
              </View>
              <Text style={styles.navInstruction} numberOfLines={3}>
                {headLabel}
              </Text>
              {rerouting ? (
                <Text style={styles.navNext} numberOfLines={2}>
                  {s.compass.rerouting}
                </Text>
              ) : nextUpText ? (
                <Text style={styles.navNext} numberOfLines={2}>
                  {nextUpText}
                </Text>
              ) : null}
            </View>
          </View>
          <View style={styles.navFooter}>
            <Text style={styles.navFooterText} numberOfLines={1}>
              {footerText}
            </Text>
            <Maximize2 size={16} color={scheme.onSurfaceVariant} />
          </View>
        </AnimatedPressable>
      ) : compassReady ? (
        /* Do 100 m pokazujemy kompas. */
        <Animated.View style={[styles.compassRow, styles.navSlot, { opacity: navOpacity }]}>
          <View style={styles.dialContainer}>
            <View style={styles.dial}>
              <View style={styles.innerRing} />
              <View style={styles.crosshairV} />
              <View style={styles.crosshairH} />
              <View style={styles.pointerContainer}>
                <View style={[styles.pointerBeam, { backgroundColor: lineAccent }]} />
                <View style={[styles.stopTargetBadge, { backgroundColor: lineAccent }]}>
                  <TargetIcon size={16} color={lineFg} />
                </View>
              </View>
              <View style={styles.userPulse}>
                <View style={styles.userDot} />
              </View>
            </View>
          </View>
          <View style={styles.distanceInfo}>
            <Text style={styles.directionGuide}>{directionLabel}</Text>
            <Text style={styles.distanceNumber}>{s.compass.distanceText(distanceM!)}</Text>
            <Text style={styles.distanceLabel} numberOfLines={1}>
              {s.compass.straight}
            </Text>
            {walkMin != null && (
              <View style={styles.walkBadge}>
                <Text style={styles.walkEst}>{s.compass.walkMins(walkMin)}</Text>
              </View>
            )}
          </View>
        </Animated.View>
      ) : (
        <Animated.View style={[styles.hintRow, styles.navSlot, styles.navSlotHint, { opacity: navOpacity }]}>
          <LocateFixed size={18} color={scheme.onSurfaceVariant} />
          <Text style={styles.hintText}>{directionLabel}</Text>
        </Animated.View>
      )}

      {locState === 'denied' && hasTarget && (
        <Pressable
          onPress={() => void Linking.openSettings()}
          style={({ pressed }) => [styles.settingsBtn, pressed && { opacity: 0.8 }]}
          accessibilityRole="button"
          accessibilityLabel={s.compass.openSettingsA11y}
        >
          <Text style={styles.settingsBtnText}>{s.compass.enableLoc}</Text>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: scheme.surfaceContainerHigh,
    borderRadius: shape.large,
    padding: 16,
    gap: 12,
    ...elev.level2,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 4,
  },
  cardHeaderIcon: {
    width: 36,
    height: 36,
    borderRadius: shape.full,
    backgroundColor: scheme.secondaryContainer,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardTitle: {
    ...type.titleMedium,
    fontWeight: '700',
    color: scheme.onSurface,
  },
  cardHeaderText: { flex: 1, minWidth: 0 },
  cardSubtitle: {
    ...type.labelMedium,
    color: scheme.onSurfaceVariant,
  },
  stopInfo: {
    gap: 6,
    backgroundColor: scheme.surfaceContainerHighest,
    borderRadius: shape.medium,
    padding: 12,
    marginTop: 4,
  },
  badgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  directionText: {
    ...type.labelMedium,
    color: scheme.onSurfaceVariant,
    flexShrink: 1,
  },
  stopName: {
    ...type.titleMedium,
    fontWeight: '700',
    color: scheme.onSurface,
    marginTop: 4,
  },
  platformBadge: {
    alignSelf: 'flex-start',
    backgroundColor: scheme.secondaryContainer,
    borderRadius: shape.small,
    paddingHorizontal: 8,
    paddingVertical: 2,
    marginTop: 2,
  },
  platformText: {
    ...type.labelSmall,
    color: scheme.primary,
    fontWeight: '600',
  },

  // ─── Nawigacja ─────────────────────────────────────────────
  // Slot rezerwuje wysokość docelowego widgetu, żeby przejście
  // oczekiwanie → radar/mapa nie przesuwało reszty ekranu.
  navSlot: {
    minHeight: 148,
  },
  // Wiersz oczekiwania wyśrodkowany w slocie, żeby pusty obszar nie
  // wyglądał na ucięty layout.
  navSlotHint: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  navWidget: {
    backgroundColor: scheme.surfaceContainerLowest,
    borderRadius: shape.large,
    padding: 10,
    gap: 8,
  },
  navWidgetPressed: {
    opacity: 0.85,
  },
  navRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  navMapPane: {
    flex: 65,
    minWidth: 0,
  },
  navCopy: {
    flex: 35,
    minWidth: 0,
    justifyContent: 'center',
    gap: 5,
  },
  navDistanceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  navDistance: {
    fontSize: 20,
    lineHeight: 24,
    fontWeight: '800',
    color: scheme.onSurface,
    fontVariant: ['tabular-nums'],
    includeFontPadding: false,
    flexShrink: 1,
  },
  navInstruction: {
    ...type.labelMedium,
    fontWeight: '600',
    color: scheme.onSurface,
    lineHeight: 17,
    includeFontPadding: false,
  },
  navNext: {
    fontSize: 10,
    lineHeight: 13,
    color: scheme.onSurfaceVariant,
  },
  navFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    paddingHorizontal: 2,
  },
  navFooterText: {
    ...type.labelMedium,
    color: scheme.onSurfaceVariant,
    flex: 1,
    minWidth: 0,
  },

  // ─── Radar (do 100 m) ─────────────────────────────────────
  compassRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 4,
    gap: 16,
  },
  dialContainer: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  dial: {
    width: 120,
    height: 120,
    borderRadius: 60,
    backgroundColor: scheme.surfaceContainerHighest,
    borderWidth: 1.5,
    borderColor: scheme.outlineVariant,
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
    overflow: 'hidden',
  },
  innerRing: {
    position: 'absolute',
    width: 68,
    height: 68,
    borderRadius: 34,
    borderWidth: 1,
    borderColor: scheme.outlineVariant,
    opacity: 0.6,
  },
  crosshairV: {
    position: 'absolute',
    width: 1,
    height: '100%',
    backgroundColor: scheme.outlineVariant,
    opacity: 0.35,
  },
  crosshairH: {
    position: 'absolute',
    height: 1,
    width: '100%',
    backgroundColor: scheme.outlineVariant,
    opacity: 0.35,
  },
  pointerContainer: {
    position: 'absolute',
    width: 120,
    height: 120,
    alignItems: 'center',
    justifyContent: 'flex-start',
  },
  pointerBeam: {
    position: 'absolute',
    top: 26,
    width: 2.5,
    height: 34,
    borderRadius: 2,
    opacity: 0.75,
  },
  stopTargetBadge: {
    position: 'absolute',
    top: 4,
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: scheme.surface,
    ...elev.level1,
  },
  userPulse: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: 'rgba(0, 168, 132, 0.25)',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 2,
  },
  userDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: scheme.primary,
  },
  distanceInfo: {
    flex: 1,
    gap: 3,
    alignItems: 'flex-start',
  },
  hintRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    padding: 12,
    borderRadius: shape.medium,
    backgroundColor: scheme.surfaceContainerHighest,
  },
  hintText: {
    ...type.bodyMedium,
    color: scheme.onSurfaceVariant,
    flex: 1,
    lineHeight: 19,
  },
  settingsBtn: {
    alignSelf: 'flex-start',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: shape.full,
    backgroundColor: scheme.secondaryContainer,
  },
  settingsBtnText: {
    ...type.labelLarge,
    color: scheme.onSecondaryContainer,
    fontWeight: '600',
  },
  directionGuide: {
    ...type.labelMedium,
    color: scheme.primary,
    fontWeight: '700',
  },
  distanceNumber: {
    ...type.displaySmall,
    fontWeight: '800',
    color: scheme.onSurface,
  },
  distanceLabel: {
    ...type.bodySmall,
    color: scheme.onSurfaceVariant,
  },
  walkBadge: {
    backgroundColor: scheme.secondaryContainer,
    borderRadius: shape.small,
    paddingHorizontal: 8,
    paddingVertical: 2,
    marginTop: 2,
  },
  walkEst: {
    ...type.labelSmall,
    color: scheme.onSecondaryContainer,
    fontWeight: '600',
  },
});
