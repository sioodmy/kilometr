// Karta nawigacji pieszej do przystanku / celu na ekranie szczegółów trasy.
//
// Minimapka z dociągniętą trasą pieszą zajmuje górę widgetu (ok. 60%
// wysokości ekranu), a pod nią leży panel instrukcji w stylu M3:
// ikona manewru, „Skręć w lewo · 50 m”, potem następny manewr („Potem
// skręć w prawo · 120 m”). Dotknięcie całego widgetu otwiera pełną mapę
// trasy.

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  Linking,
  Pressable,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import {
  ArrowUp,
  ArrowUpLeft,
  ArrowUpRight,
  CornerDownLeft,
  CornerDownRight,
  CornerUpLeft,
  CornerUpRight,
  LocateFixed,
  MapPinned,
  Maximize2,
  Navigation2,
  RotateCcw,
} from 'lucide-react-native';
import { elev, scheme, shape, type } from '../theme/tokens';
import type { Connection } from '../types/models';
import { getLineColors, LineBadge, mapLineColor } from './LineBadge';
import { useWalkSpeedMps, walkMinutesFor } from '../services/settings';

import { useStrings } from '../i18n';
import { NavMiniMap } from './NavMiniMap';
import { fetchFootRoute, routeFootSync, type Coord } from '../services/routeGeometry';
import {
  matchOnPath,
  nextGuidance,
  nextGuidanceAfter,
  slicePathFromProjection,
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

const OFF_ROUTE_M = 38;
const ARRIVED_M = 20;
const REROUTE_COOLDOWN_MS = 4000;
const REROUTE_MIN_MOVE_M = 12;
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

function parseClockTimestamp(hhmm: string | undefined, nowMs: number): number | null {
  if (!hhmm) return null;
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim());
  if (!m) return null;
  const hours = Number(m[1]);
  const minutes = Number(m[2]);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null;
  const d = new Date(nowMs);
  d.setHours(hours % 24, minutes, 0, 0);
  if (hours >= 24) {
    d.setDate(d.getDate() + 1);
  }
  let ts = d.getTime();
  if (ts - nowMs < -6 * 3600_000) ts += 24 * 3600_000;
  if (ts - nowMs > 18 * 3600_000) ts -= 24 * 3600_000;
  return ts;
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
      return ArrowUp;
  }
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
  const { height: winH } = useWindowDimensions();
  // Widget nawigacji sięga ok. 60% wysokości ekranu: mapa na górze,
  // panel instrukcji pod nią (układ jak w Google Maps), całość klikalna.
  const navWidgetH = Math.round(winH * 0.6);
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
  const fallbackFirstDepartureAt = useMemo(
    () => Date.now() + connection.departInMin * 60 * 1000,
    [connection.id, connection.departInMin],
  );
  const firstDepartureAt = useMemo(
    () => parseClockTimestamp(transitLegs[0]?.departAt, clockNow) ?? fallbackFirstDepartureAt,
    [transitLegs, clockNow, fallbackFirstDepartureAt],
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

  const { bg: lineAccent } = getLineColors(activeLeg?.line, activeLeg?.mode);

  // Jednorazowe pojawienie się treści nawigacji po pierwszym fixie GPS.
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
  const [confirmedOffRoute, setConfirmedOffRoute] = useState(false);
  const routeRequest = useRef<AbortController | null>(null);
  const prevAlongRef = useRef<{ targetKey: string; alongM: number } | null>(null);
  const minOffsetRef = useRef<{ path: Coord[]; minOffsetM: number } | null>(null);
  const offRouteStreakRef = useRef(0);
  const lastRerouteAttempt = useRef<{
    targetKey: string;
    at: number;
    lat: number;
    lon: number;
  } | null>(null);

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

  const gpsMovementHeading = useMemo<number | null>(() => {
    if (userLocation?.heading == null || !Number.isFinite(userLocation.heading)) return null;
    if (userLocation.speed != null && userLocation.speed < 0.8) return null;
    return userLocation.heading;
  }, [userLocation?.heading, userLocation?.speed]);

  const offRouteThreshold = useMemo(
    () => Math.max(OFF_ROUTE_M, Math.min(72, (userLocation?.accuracy ?? 12) * 1.4)),
    [userLocation?.accuracy],
  );

  const routeProjection = useMemo(() => {
    if (!routeForTarget || !userLocation || !targetKey) return null;
    const prevAlongM =
      prevAlongRef.current?.targetKey === targetKey ? prevAlongRef.current.alongM : null;
    return matchOnPath(
      routeForTarget,
      [userLocation.lat, userLocation.lon],
      prevAlongM,
      userLocation.accuracy,
      gpsMovementHeading,
    );
  }, [routeForTarget, userLocation, targetKey, gpsMovementHeading]);

  useEffect(() => {
    if (!routeProjection || !routeForTarget || !targetKey) return;
    if (!minOffsetRef.current || minOffsetRef.current.path !== routeForTarget) {
      minOffsetRef.current = { path: routeForTarget, minOffsetM: routeProjection.offsetM };
    } else if (routeProjection.offsetM < minOffsetRef.current.minOffsetM) {
      minOffsetRef.current.minOffsetM = routeProjection.offsetM;
    }

    // Jeśli punkt startowy leży na dziedzińcu / placu > 38 m od najbliższej
    // zamapowanej w OSM alejki, nie uznajemy go za zejście z trasy, dopóki
    // pieszy faktycznie nie oddali się od wyznaczonej ścieżki.
    const effectiveThreshold = Math.max(
      offRouteThreshold,
      minOffsetRef.current.minOffsetM + 24,
    );

    if (routeProjection.offsetM <= effectiveThreshold) {
      prevAlongRef.current = { targetKey, alongM: routeProjection.alongM };
      offRouteStreakRef.current = 0;
      setConfirmedOffRoute(false);
    } else {
      offRouteStreakRef.current += 1;
      if (
        offRouteStreakRef.current >= 2 ||
        routeProjection.offsetM > effectiveThreshold * 1.5
      ) {
        setConfirmedOffRoute(true);
      }
    }
  }, [userLocation?.timestamp, routeProjection, routeForTarget, targetKey, offRouteThreshold]);

  const offRoute = confirmedOffRoute;

  const guidance: Guidance | null = useMemo(() => {
    if (!routeForTarget || !userLocation || !navigationSpans.length) return null;
    if (offRoute && routeProjection && routeProjection.offsetM > offRouteThreshold * 2.2) {
      return null;
    }
    return nextGuidance(
      routeForTarget,
      navigationSpans,
      [userLocation.lat, userLocation.lon],
      routeProjection,
    );
  }, [routeForTarget, userLocation, navigationSpans, offRoute, routeProjection, offRouteThreshold]);

  const nextUp = useMemo(() => {
    if (!routeForTarget || !userLocation || !guidance || !navigationSpans.length || offRoute) {
      return null;
    }
    return nextGuidanceAfter(
      routeForTarget,
      navigationSpans,
      [userLocation.lat, userLocation.lon],
      35,
      routeProjection,
    );
  }, [routeForTarget, userLocation, guidance, navigationSpans, offRoute, routeProjection]);

  const { distanceM, stopBearing } = useMemo(() => {
    if (!userLocation || targetLat == null || targetLon == null) {
      return { distanceM: null, stopBearing: 0 };
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
    return {
      distanceM: Math.round(dist / 5) * 5,
      stopBearing: bearing,
    };
  }, [userLocation, targetLat, targetLon]);

  // Orientacja minimapki bez magnetometru: wzdłuż aktualnego odcinka trasy
  // pieszej (dzięki czemu zakręt w lewo/prawo na mapie zawsze pokrywa się z
  // ikoną manewru), a poza trasą według kursu ruchu GPS lub kierunku do przystanku.
  const activeHeading = useMemo<number>(() => {
    if (!onTransit && routeProjection && !offRoute) {
      return routeProjection.segmentBearingDeg;
    }
    return gpsMovementHeading ?? stopBearing;
  }, [onTransit, routeProjection, offRoute, gpsMovementHeading, stopBearing]);

  const snapThreshold = useMemo(
    () => Math.max(26, Math.min(45, (userLocation?.accuracy ?? 10) * 1.25)),
    [userLocation?.accuracy],
  );

  // Przyciągamy kursor użytkownika do osi chodnika, gdy idzie wzdłuż wyznaczonej trasy.
  const displayUserPos = useMemo<Coord | null>(() => {
    if (!userPos) return null;
    if (routeProjection && !offRoute && routeProjection.offsetM <= snapThreshold) {
      return routeProjection.snappedPoint;
    }
    return userPos;
  }, [userPos, routeProjection, offRoute, snapThreshold]);

  // Na minimapce rysujemy odcinek trasy zaczynający się od pozycji użytkownika do przystanku.
  const displayRoutePath = useMemo<Coord[]>(() => {
    if (routeForTarget && routeForTarget.length >= 2) {
      if (routeProjection && !offRoute) {
        return slicePathFromProjection(routeForTarget, routeProjection);
      }
      return routeForTarget;
    }
    if (displayUserPos && stopPos) {
      return [displayUserPos, stopPos];
    }
    return [];
  }, [routeForTarget, routeProjection, offRoute, displayUserPos, stopPos]);

  const hasTarget = targetLat != null && targetLon != null;
  const showNav = hasTarget && displayUserPos != null && stopPos != null;

  const compassHint = !hasTarget
    ? s.compass.noCoords
    : locState === 'denied'
      ? s.compass.locOff
      : s.compass.locWaiting;

  const walkDistanceM = useMemo<number | null>(() => {
    if (distanceM == null) return null;
    if (!onTransit && guidance && !offRoute && guidance.remainM > 0) {
      return Math.max(distanceM, Math.round(guidance.remainM));
    }
    return distanceM;
  }, [distanceM, onTransit, guidance, offRoute]);

  const walkMin = !onTransit && walkDistanceM != null ? walkMinutesFor(walkDistanceM, walkMps) : null;

  useEffect(() => {
    routeRequest.current?.abort();
    routeRequest.current = null;
    lastRerouteAttempt.current = null;
    prevAlongRef.current = null;
    minOffsetRef.current = null;
    offRouteStreakRef.current = 0;
    setConfirmedOffRoute(false);
    setNavigationRoute(null);
    setRerouting(false);
  }, [targetKey]);

  useEffect(() => {
    if (!showNav || !userLocation || !stopPos || !targetKey) return;
    if (onTransit || distanceM == null || distanceM > REROUTE_MAX_DIST_M) return;
    const routeIsCurrent = navigationRoute?.targetKey === targetKey;
    const needsRoute = !routeIsCurrent || routeProjection == null || offRoute;
    if (!needsRoute || routeRequest.current) return;

    const now = Date.now();
    const last = lastRerouteAttempt.current;
    if (routeIsCurrent && last && last.targetKey === targetKey) {
      if (now - last.at < REROUTE_COOLDOWN_MS) return;
      if (
        calculateDistanceMeters(last.lat, last.lon, userLocation.lat, userLocation.lon) <
        REROUTE_MIN_MOVE_M
      ) {
        return;
      }
    }

    const fromCoord: Coord = [userLocation.lat, userLocation.lon];

    // Jeśli kafelki są już w pamięci silnika Rust, przeliczamy trasę synchronicznie bez stanu ładowania.
    const immediatePath = routeFootSync(fromCoord, stopPos);
    if (immediatePath && immediatePath.length >= 2) {
      prevAlongRef.current = { targetKey, alongM: 0 };
      minOffsetRef.current = null;
      offRouteStreakRef.current = 0;
      setConfirmedOffRoute(false);
      setNavigationRoute({ targetKey, path: immediatePath });
      setRerouting(false);
      lastRerouteAttempt.current = {
        targetKey,
        at: now,
        lat: userLocation.lat,
        lon: userLocation.lon,
      };
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
    void fetchFootRoute(fromCoord, stopPos, controller.signal)
      .then((path) => {
        if (routeRequest.current !== controller || !path || path.length < 2) return;
        prevAlongRef.current = { targetKey, alongM: 0 };
        minOffsetRef.current = null;
        offRouteStreakRef.current = 0;
        setConfirmedOffRoute(false);
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
    offRoute,
    onTransit,
  ]);
  useEffect(() => () => routeRequest.current?.abort(), []);

  const hasArrived =
    !onTransit &&
    ((guidance != null && guidance.remainM <= ARRIVED_M) ||
      (distanceM != null && distanceM <= ARRIVED_M));

  const ManeuverIcon = useMemo(() => {
    if (hasArrived) return MapPinned;
    if (!guidance) return ArrowUp;
    if (
      guidance.maneuver.kind === 'board' ||
      guidance.maneuver.kind === 'alight' ||
      guidance.maneuver.kind === 'arrive'
    ) {
      return ArrowUp;
    }
    return maneuverIcon(guidance.maneuver.kind);
  }, [guidance, hasArrived]);

  const maneuverLabel = useMemo(() => {
    const m = s.map.maneuver;
    if (hasArrived) return m.arrive;
    if (!guidance) return null;
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
      case 'arrive':
        return s.compass.headToStop;
      default:
        return m.straight;
    }
  }, [guidance, hasArrived, s]);

  const distText = guidance
    ? s.compass.distanceText(roundNavM(guidance.maneuver.distanceM))
    : null;

  const headLabel = onTransit
    ? s.compass.nextStop
    : maneuverLabel ?? s.compass.headToStop;
  const headDist =
    guidance && distText
      ? distText
      : walkDistanceM != null
        ? s.compass.distanceText(roundNavM(walkDistanceM))
        : '';
  const footerText =
    walkMin != null
      ? walkDistanceM != null
        ? `${s.compass.navToStop(s.compass.distanceText(roundNavM(walkDistanceM)))} · ${s.compass.walkMins(walkMin)}`
        : s.compass.walkMins(walkMin)
      : '';

  // „Potem” pokazujemy tylko wtedy, gdy następny manewr jest wyraźnie
  // dalej niż obecny. Inaczej dwie linijki mówią to samo.
  const nextUpText = useMemo(() => {
    if (!nextUp || hasArrived) return null;
    const gap = nextUp.maneuver.distanceM - (guidance?.maneuver.distanceM ?? 0);
    if (gap < 40) return null;
    const label = s.map.maneuver;
    const kind = nextUp.maneuver.kind;
    const what =
      kind === 'arrive' || kind === 'board' || kind === 'alight'
        ? s.compass.headToStop
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
    return `${label.then} ${what.toLocaleLowerCase()} · ${s.compass.distanceText(roundNavM(gap))}`;
  }, [nextUp, guidance, hasArrived, s]);

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

      {/* Slot rezerwuje wysokość docelowego widgetu od pierwszego renderu,
          żeby karta nie skakała po otrzymaniu fixu GPS. */}
      {showNav && displayUserPos && stopPos ? (
        // Cały widget jest jednym przyciskiem: dotknięcie otwiera pełną mapę.
        <AnimatedPressable
          onPress={openMap}
          style={({ pressed }) => [
            styles.navWidget,
            { height: navWidgetH, opacity: navOpacity },
            pressed && styles.navWidgetPressed,
          ]}
          accessibilityRole="button"
          accessibilityLabel={s.compass.navA11y(headLabel, headDist)}
        >
          {/* Mapa na pełną szerokość, góra widgetu. Instrukcje leżą pod nią
              w panelu M3, jak w Google Maps. */}
          <NavMiniMap
            path={displayRoutePath}
            user={displayUserPos}
            stop={stopPos}
            headingDeg={activeHeading}
            accuracyM={userLocation?.accuracy ?? null}
            accent={mapLineColor(lineAccent)}
            style={styles.navMapPane}
          />
          <View style={styles.navSheet}>
            {rerouting ? (
              <View style={styles.navCopy}>
                <Text style={styles.navInstruction} numberOfLines={2}>
                  {s.compass.rerouting}
                </Text>
                {headDist ? (
                  <Text style={styles.navDistance} numberOfLines={1}>
                    {headDist}
                  </Text>
                ) : null}
              </View>
            ) : (
              <View style={styles.navRowMain}>
                <View style={styles.maneuverBadge}>
                  <ManeuverIcon size={28} strokeWidth={2.2} color={scheme.onPrimary} />
                </View>
                <View style={styles.navCopy}>
                  <Text style={styles.navInstruction} numberOfLines={2}>
                    {headLabel}
                  </Text>
                  {nextUpText ? (
                    <Text style={styles.navNext} numberOfLines={2}>
                      {nextUpText}
                    </Text>
                  ) : null}
                </View>
                <Text style={styles.navDistance} numberOfLines={1}>
                  {headDist}
                </Text>
              </View>
            )}
            <View style={styles.navFooter}>
              <Text style={styles.navFooterText} numberOfLines={1}>
                {footerText}
              </Text>
              <Maximize2 size={16} color={scheme.onSurfaceVariant} />
            </View>
          </View>
        </AnimatedPressable>
      ) : (
        <Pressable
          onPress={openMap}
          style={({ pressed }) => [
            styles.hintRow,
            styles.navSlot,
            styles.navSlotHint,
            pressed && styles.navWidgetPressed,
          ]}
          accessibilityRole="button"
          accessibilityLabel={s.compass.navA11y(stopName ?? '', '')}
        >
          <LocateFixed size={18} color={scheme.onSurfaceVariant} />
          <Text style={styles.hintText}>{compassHint}</Text>
          <Maximize2 size={16} color={scheme.onSurfaceVariant} />
        </Pressable>
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

  // Slot rezerwuje wysokość docelowego widgetu, żeby przejście
  // oczekiwanie -> mapa nie przesuwało reszty ekranu.
  navSlot: {
    minHeight: 148,
  },
  navSlotHint: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  navWidget: {
    backgroundColor: scheme.surfaceContainerLowest,
    borderRadius: shape.large,
    padding: 8,
    gap: 8,
  },
  navWidgetPressed: {
    opacity: 0.85,
  },
  // Mapa wypełnia górę widgetu (wysokość widgetu ustawiana inline: ok. 60%
  // ekranu), panel instrukcji leży pod nią w tonalnym boxie.
  navMapPane: {
    flex: 1,
    minWidth: 0,
  },
  navSheet: {
    backgroundColor: scheme.surfaceContainerHighest,
    borderRadius: shape.medium,
    padding: 14,
    gap: 10,
  },
  navRowMain: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  // Plakietka manewru w tonalnym kolorze akcentu, jak w komponentach M3.
  maneuverBadge: {
    width: 44,
    height: 44,
    borderRadius: shape.full,
    backgroundColor: scheme.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  navCopy: {
    flex: 1,
    minWidth: 0,
    gap: 3,
  },
  navDistance: {
    fontSize: 22,
    lineHeight: 26,
    fontWeight: '800',
    color: scheme.onSurface,
    fontVariant: ['tabular-nums'],
    includeFontPadding: false,
    flexShrink: 0,
    marginLeft: 2,
  },
  navInstruction: {
    ...type.titleMedium,
    fontWeight: '700',
    color: scheme.onSurface,
    lineHeight: 19,
    includeFontPadding: false,
  },
  navNext: {
    ...type.labelSmall,
    color: scheme.onSurfaceVariant,
  },
  navFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  navFooterText: {
    ...type.labelMedium,
    color: scheme.onSurfaceVariant,
    flex: 1,
    minWidth: 0,
  },
  hintRow: {
    flexDirection: 'row',
    alignItems: 'center',
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
});
