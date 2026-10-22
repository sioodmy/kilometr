import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Linking, Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
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
  TramFront,
  BusFront,
  TrainFront,
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
import { useJourneyNavigation } from '../services/useJourneyNavigation';
import { clockFromMs } from '../services/notifications/format';
import type { TransferProtectionState } from '../services/notifications/transferTypes';

interface StopCompassCardProps {
  connection: Connection;
  /** Otwiera pełną mapę trasy. Cały widget nawigacji jest w tym celu klikalny. */
  onOpenMap?: () => void;
  transfer?: TransferProtectionState;
}

const OFF_ROUTE_M = 38;
// Cały widget (mapa + panel instrukcji) ma zmieścić się na ekranie: 70%
// wysokości okna zostawia miejsce na paski systemowe i naraz widoczny
// nagłówek strony szczegółów.
const NAV_WIDGET_FRACTION = 0.7;
// Panel instrukcji M3 (~98 px treści) plus padding 8 widgetu i dystans 8
// mapy od panelu. Stała: mapa dostaje resztę widgetu, więc wysokość mapy
// nie skacze wraz z treścią panelu (np. przy „Wyznaczam nową trasę”).
const MAP_WIDGET_RESERVE = 122;
const ARRIVED_M = 20;
const REROUTE_COOLDOWN_MS = 4000;
const REROUTE_MIN_MOVE_M = 12;
const REROUTE_MAX_DIST_M = 10000;

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

export function StopCompassCard({ connection, onOpenMap, transfer }: StopCompassCardProps) {
  const s = useStrings();
  const { height: winH } = useWindowDimensions();
  // Cały widget (mapa + panel instrukcji) mieści się na ekranie:
  // 70% wysokości okna, mapa dostaje resztę nad panelem instrukcji.
  const navWidgetH = Math.round(winH * NAV_WIDGET_FRACTION);
  const navMapH = Math.max(180, navWidgetH - MAP_WIDGET_RESERVE);
  const walkMps = useWalkSpeedMps();
  const {
    target: targetSelection,
    ride,
    now,
    location,
    locationState: locState,
  } = useJourneyNavigation(connection, transfer);
  const userLocation =
    location && locState === 'ok' && now - location.timestamp <= 15_000 ? location : null;
  const [focused, setFocused] = useState(false);
  const [settingsFocused, setSettingsFocused] = useState(false);
  const onTransit = targetSelection?.phase === 'riding';
  const finalWalk = targetSelection?.phase === 'egress' || targetSelection?.phase === 'arrived';
  const activeLeg = targetSelection?.leg ?? connection.legs[0];
  const targetLat = targetSelection?.end ? activeLeg?.toLat : activeLeg?.fromLat;
  const targetLon = targetSelection?.end ? activeLeg?.toLon : activeLeg?.fromLon;
  const stopName = targetSelection?.end
    ? activeLeg?.toStop || connection.toTitle
    : activeLeg?.fromStop || connection.fromTitle;
  const platform = targetSelection?.end ? undefined : activeLeg?.platformCode;

  const { bg: lineAccent } = getLineColors(activeLeg?.line, activeLeg?.mode);

  const [navigationRoute, setNavigationRoute] = useState<{
    targetKey: string;
    path: Coord[];
  } | null>(null);
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
      ? `${connection.id}:${activeLeg?.id}:${onTransit}:${targetLat.toFixed(5)},${targetLon.toFixed(5)}`
      : null;
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
  const navigationSpans = useMemo<LegSpan[]>(
    () =>
      routeForTarget && routeForTarget.length > 1
        ? [{ leg: navigationLeg, start: 0, end: routeForTarget.length - 1 }]
        : [],
    [routeForTarget, navigationLeg],
  );

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
    const effectiveThreshold = Math.max(offRouteThreshold, minOffsetRef.current.minOffsetM + 24);

    if (routeProjection.offsetM <= effectiveThreshold) {
      prevAlongRef.current = { targetKey, alongM: routeProjection.alongM };
      offRouteStreakRef.current = 0;
      setConfirmedOffRoute(false);
    } else {
      offRouteStreakRef.current += 1;
      if (offRouteStreakRef.current >= 2 || routeProjection.offsetM > effectiveThreshold * 1.5) {
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
    const dist = calculateDistanceMeters(userLocation.lat, userLocation.lon, targetLat, targetLon);
    const bearing = calculateBearing(userLocation.lat, userLocation.lon, targetLat, targetLon);
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
  const showNav = hasTarget && stopPos != null;

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

  const walkMin =
    !onTransit && walkDistanceM != null ? walkMinutesFor(walkDistanceM, walkMps) : null;

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
    if (targetSelection?.phase === 'arrived') return;
    if (onTransit || distanceM == null || distanceM > REROUTE_MAX_DIST_M) return;
    const routeIsCurrent = navigationRoute?.targetKey === targetKey;
    const needsRoute = !routeIsCurrent || routeProjection == null || offRoute;
    if (!needsRoute || routeRequest.current) return;

    const now = Date.now();
    const last = lastRerouteAttempt.current;
    if (last && last.targetKey === targetKey) {
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
    targetSelection?.phase,
  ]);
  useEffect(() => () => routeRequest.current?.abort(), []);

  const hasArrived =
    !onTransit &&
    ((guidance != null && guidance.remainM <= ARRIVED_M) ||
      (distanceM != null && distanceM <= ARRIVED_M));
  const waitingAtStop = !finalWalk && (hasArrived || targetSelection?.phase === 'waiting');
  const VehicleIcon =
    activeLeg?.mode === 'tram'
      ? TramFront
      : activeLeg?.mode === 'train' || activeLeg?.mode === 'subway'
        ? TrainFront
        : BusFront;

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

  const distText = guidance ? s.compass.distanceText(roundNavM(guidance.maneuver.distanceM)) : null;

  const baseHeadLabel = onTransit
    ? ride?.nextStop
      ? s.compass.nextStopAt(ride.nextStop)
      : s.compass.rideTo(activeLeg?.toStop ?? '')
    : targetSelection?.phase === 'arrived'
      ? s.compass.journeyArrived
      : !userLocation
        ? compassHint
        : waitingAtStop
          ? s.compass.waitForDeparture(clockFromMs(targetSelection?.departMs ?? 0))
          : (maneuverLabel ?? (finalWalk ? s.compass.headToDestination : s.compass.headToStop));
  const headDist =
    onTransit || waitingAtStop || !userLocation || targetSelection?.phase === 'arrived'
      ? ''
      : guidance && distText
        ? distText
        : walkDistanceM != null
          ? s.compass.distanceText(roundNavM(walkDistanceM))
          : '';
  const baseFooterText = onTransit
    ? ride?.position
      ? `${s.compass.vehicleGps} · ${s.compass.alightAt(activeLeg?.toStop ?? '')}${ride.stopsLeft != null ? ` · ${s.compass.stopsRemaining(ride.stopsLeft)}` : ''}`
      : s.compass.vehicleGpsMissing
    : waitingAtStop
      ? s.compass.boardAt(stopName)
      : walkMin != null
        ? walkDistanceM != null
          ? `${(finalWalk ? s.compass.navToDestination : s.compass.navToStop)(s.compass.distanceText(roundNavM(walkDistanceM)))} · ${s.compass.walkMins(walkMin)}`
          : s.compass.walkMins(walkMin)
        : '';

  const headLabel = baseHeadLabel;
  const footerText = baseFooterText;

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
          <Text style={styles.cardTitle}>{s.compass.journeyTitle}</Text>
          <Text style={styles.cardSubtitle}>
            {onTransit
              ? s.compass.riding
              : finalWalk
                ? s.compass.headToDestination
                : targetSelection?.phase === 'transfer'
                  ? s.compass.transferWalk
                  : s.compass.followCompass}
          </Text>
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

      {showNav && stopPos ? (
        <View style={[styles.navWidget, { minHeight: navWidgetH }]}>
          <NavMiniMap
            path={onTransit ? (ride?.path ?? []) : displayRoutePath}
            user={onTransit ? (ride?.position ?? null) : displayUserPos}
            stop={stopPos}
            headingDeg={onTransit ? (ride?.heading ?? null) : activeHeading}
            accuracyM={onTransit ? null : (userLocation?.accuracy ?? null)}
            accent={mapLineColor(lineAccent)}
            vehicleMode={onTransit ? activeLeg?.mode : undefined}
            onOpenMap={onOpenMap}
            style={[styles.navMapPane, { height: navMapH }]}
          />
          <Pressable
            style={[styles.navSheet, focused && styles.focused]}
            onPress={openMap}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            disabled={!onOpenMap}
            accessibilityRole="button"
            accessibilityLabel={s.compass.navA11y(`${headLabel}. ${footerText}`, headDist)}
          >
            {rerouting && !onTransit && targetSelection?.phase !== 'arrived' ? (
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
                  {onTransit || waitingAtStop ? (
                    <VehicleIcon size={28} strokeWidth={2.2} color={scheme.onPrimary} />
                  ) : (
                    <ManeuverIcon size={28} strokeWidth={2.2} color={scheme.onPrimary} />
                  )}
                </View>
                <View style={styles.navCopy}>
                  <Text style={styles.navInstruction} numberOfLines={2}>
                    {headLabel}
                  </Text>
                  {nextUpText && !onTransit && !waitingAtStop ? (
                    <Text style={styles.navNext} numberOfLines={2}>
                      {nextUpText}
                    </Text>
                  ) : null}
                </View>
                {headDist ? (
                  <Text style={styles.navDistance} numberOfLines={1}>
                    {headDist}
                  </Text>
                ) : null}
              </View>
            )}
            <View style={styles.navFooter}>
              <Text style={styles.navFooterText}>{footerText}</Text>
              <Maximize2 size={16} color={scheme.onSurfaceVariant} />
            </View>
          </Pressable>
        </View>
      ) : (
        <Pressable
          onPress={openMap}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          style={({ pressed }) => [
            styles.hintRow,
            styles.navSlot,
            styles.navSlotHint,
            pressed && styles.navWidgetPressed,
            focused && styles.focused,
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
          onFocus={() => setSettingsFocused(true)}
          onBlur={() => setSettingsFocused(false)}
          style={({ pressed }) => [
            styles.settingsBtn,
            pressed && { opacity: 0.8 },
            settingsFocused && styles.focused,
          ]}
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
  },
  navWidgetPressed: {
    opacity: 0.85,
  },
  focused: { borderColor: scheme.primary, borderWidth: 2 },
  // Mapa ma stałą wysokość (inline: reszta widgetu 70% ekranu nad panelem)
  // i styka się z panelem instrukcji bez promieni na styku; góra zostaje
  // zaokrąglona (14 odpowiada defaultowi NavMiniMap).
  navMapPane: {
    minWidth: 0,
    borderTopLeftRadius: 14,
    borderTopRightRadius: 14,
    borderBottomLeftRadius: 0,
    borderBottomRightRadius: 0,
  },
  navSheet: {
    borderWidth: 2,
    borderColor: 'transparent',
    backgroundColor: scheme.surfaceContainerHighest,
    padding: 14,
    gap: 10,
    // Bez promieni u góry: box styka się z mapą; dół zachowuje zaokrąglenie.
    borderTopLeftRadius: 0,
    borderTopRightRadius: 0,
    borderBottomLeftRadius: shape.medium,
    borderBottomRightRadius: shape.medium,
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
    flexShrink: 1,
    marginLeft: 2,
  },
  navInstruction: {
    ...type.titleMedium,
    fontWeight: '700',
    color: scheme.onSurface,
    lineHeight: 24,
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
    minHeight: 44,
    borderWidth: 2,
    borderColor: 'transparent',
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
