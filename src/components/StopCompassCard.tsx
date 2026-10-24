import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Linking,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { useReducedMotion } from 'react-native-reanimated';
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
  Footprints,
  X,
  Compass,
  ChevronDown,
} from 'lucide-react-native';
import { scheme, shape, type } from '../theme/tokens';
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
  /** Otwiera przegląd całej podróży. */
  onOpenMap?: () => void;
  transfer?: TransferProtectionState;
}

const OFF_ROUTE_M = 38;
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
  const reduceMotion = useReducedMotion();
  const { height: winH, width: winW, fontScale } = useWindowDimensions();
  const [fullscreen, setFullscreen] = useState(false);
  const [needsCalibration, setNeedsCalibration] = useState(false);
  const [calibrationExpanded, setCalibrationExpanded] = useState(false);
  const [sheetHeight, setSheetHeight] = useState<number>();
  const cardHeight = useRef(0);
  const landscape = fullscreen && winW > winH;
  const navMapH = Math.round(Math.max(220, Math.min(380, winH * 0.42)));
  const walkMps = useWalkSpeedMps();
  const {
    target: targetSelection,
    ride,
    now,
    location,
    locationState: locState,
    alight,
    board,
    undoAlight,
  } = useJourneyNavigation(connection, transfer);
  const userLocation =
    location && locState === 'ok' && now - location.timestamp <= 15_000 ? location : null;
  const [focused, setFocused] = useState<string | null>(null);
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

  const distanceM = useMemo(() => {
    if (!userLocation || targetLat == null || targetLon == null) return null;
    const dist = calculateDistanceMeters(userLocation.lat, userLocation.lon, targetLat, targetLon);
    return Math.round(dist / 5) * 5;
  }, [userLocation, targetLat, targetLon]);

  const activeHeading = gpsMovementHeading;

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
    ? ride?.source === 'device'
      ? s.compass.deviceGps
      : ride?.source === 'vehicle'
        ? s.compass.vehicleGps
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
    setFullscreen(false);
    onOpenMap?.();
  }, [onOpenMap]);

  const phaseLabel = onTransit
    ? s.compass.riding
    : finalWalk
      ? s.compass.headToDestination
      : targetSelection?.phase === 'transfer'
        ? s.compass.transferWalk
        : s.compass.followCompass;
  const content = (
    <>
      <View style={styles.header}>
        <Navigation2 size={22} color={scheme.primary} />
        <View style={styles.copy}>
          <Text style={styles.title} accessibilityRole="header">
            {s.compass.journeyTitle}
          </Text>
          <Text style={styles.secondary}>{phaseLabel}</Text>
        </View>
        <Pressable
          onPress={() => setFullscreen(!fullscreen)}
          onFocus={() => setFocused('fullscreen')}
          onBlur={() => setFocused(null)}
          accessibilityRole="button"
          accessibilityLabel={fullscreen ? s.compass.closeFullscreen : s.compass.fullscreen}
          style={({ pressed }) => [
            styles.iconButton,
            pressed && styles.pressed,
            focused === 'fullscreen' && styles.focused,
          ]}
        >
          {fullscreen ? (
            <X size={24} color={scheme.onSurface} />
          ) : (
            <Maximize2 size={23} color={scheme.onSurface} />
          )}
        </Pressable>
      </View>
      <View style={[fullscreen && styles.fullBody, landscape && styles.landscape]}>
        {showNav && stopPos ? (
          <NavMiniMap
            targetId={targetKey ?? activeLeg?.id ?? connection.id}
            path={onTransit ? (ride?.remainingPath ?? []) : displayRoutePath}
            traveled={onTransit ? ride?.traveledPath : undefined}
            stops={onTransit ? ride?.stops : undefined}
            user={onTransit ? userPos : displayUserPos}
            vehicle={onTransit ? ride?.position : null}
            stop={stopPos}
            headingDeg={activeHeading ?? (onTransit ? (ride?.heading ?? null) : null)}
            accuracyM={userLocation?.accuracy ?? null}
            accent={mapLineColor(onTransit ? lineAccent : scheme.primary)}
            riding={onTransit}
            interactive={fullscreen}
            line={onTransit ? activeLeg?.line : undefined}
            onCompassCalibrationChange={setNeedsCalibration}
            style={[styles.map, fullscreen ? styles.fullMap : { height: navMapH }]}
          />
        ) : (
          <View style={styles.noMap}>
            <LocateFixed size={24} color={scheme.onSurfaceVariant} />
            <Text style={styles.secondary}>{compassHint}</Text>
          </View>
        )}
        <ScrollView
          nestedScrollEnabled
          style={[
            styles.sheetScroll,
            fullscreen && !landscape && {
              height: sheetHeight,
              maxHeight: winH * (fontScale > 1.3 ? 0.55 : 0.48),
            },
            landscape && { width: Math.min(360, winW * 0.46), height: '100%' },
          ]}
          contentContainerStyle={styles.sheet}
          onContentSizeChange={(_, height) => setSheetHeight(height)}
          showsVerticalScrollIndicator={fullscreen}
        >
          {needsCalibration ? (
            <View style={styles.calibration}>
              <Pressable
                onPress={() => setCalibrationExpanded((value) => !value)}
                onFocus={() => setFocused('calibration')}
                onBlur={() => setFocused(null)}
                accessibilityRole="button"
                accessibilityState={{ expanded: calibrationExpanded }}
                accessibilityLabel={`${s.compass.compassAccuracyLow}. ${s.compass.calibrationHelp}`}
                style={({ pressed }) => [
                  styles.calibrationButton,
                  pressed && styles.pressed,
                  focused === 'calibration' && styles.focused,
                ]}
              >
                <Compass size={24} color={scheme.onWarningContainer} />
                <View style={styles.copy}>
                  <Text style={styles.calibrationTitle}>{s.compass.compassAccuracyLow}</Text>
                  <Text style={styles.calibrationHelp}>{s.compass.calibrationHelp}</Text>
                </View>
                <ChevronDown
                  size={22}
                  color={scheme.onWarningContainer}
                  style={{ transform: [{ rotate: calibrationExpanded ? '180deg' : '0deg' }] }}
                />
              </Pressable>
              {calibrationExpanded ? (
                <Text style={styles.calibrationBody}>{s.compass.calibrateCompass}</Text>
              ) : null}
            </View>
          ) : null}
          <View style={styles.lineRow}>
            {activeLeg && <LineBadge mode={activeLeg.mode} line={activeLeg.line} />}
            <Text style={[styles.secondary, styles.shrink]}>
              {activeLeg?.direction ? s.compass.directionPrefix(activeLeg.direction) : stopName}
            </Text>
            {platform ? <Text style={styles.platform}>{platform}</Text> : null}
          </View>
          <View style={[styles.instructionRow, fontScale > 1.3 && styles.wrap]}>
            <View style={styles.maneuver}>
              {onTransit || waitingAtStop ? (
                <VehicleIcon size={30} strokeWidth={2.3} color={scheme.onPrimaryContainer} />
              ) : (
                <ManeuverIcon size={32} strokeWidth={2.3} color={scheme.onPrimaryContainer} />
              )}
            </View>
            <View style={styles.copy}>
              {onTransit && ride?.nextStop ? (
                <Text style={styles.secondary}>
                  {ride.stopsLeft === 1 ? s.compass.prepareToAlight : s.compass.nextStop}
                </Text>
              ) : null}
              {headDist ? <Text style={styles.distance}>{headDist}</Text> : null}
              <Text style={[styles.instruction, onTransit && styles.nextStop]}>
                {rerouting && !onTransit && targetSelection?.phase !== 'arrived'
                  ? s.compass.rerouting
                  : onTransit && ride?.nextStop
                    ? ride.nextStop
                    : headLabel}
              </Text>
              {nextUpText && !onTransit && !waitingAtStop ? (
                <Text style={styles.secondary}>{nextUpText}</Text>
              ) : null}
            </View>
          </View>
          {onTransit ? (
            <View style={styles.rideDestination}>
              {ride?.nextStop !== stopName ? (
                <Text style={styles.destination}>{s.compass.alightAt(stopName)}</Text>
              ) : null}
              {ride?.stopsLeft != null ? (
                <Text style={styles.remaining}>{s.compass.stopsRemaining(ride.stopsLeft)}</Text>
              ) : null}
              {ride?.progress != null ? (
                <View
                  style={styles.progress}
                  accessibilityRole="progressbar"
                  accessibilityLabel={s.compass.rideProgress}
                  accessibilityValue={{ min: 0, max: 100, now: Math.round(ride.progress * 100) }}
                >
                  <View
                    style={[styles.progressFill, { width: `${Math.round(ride.progress * 100)}%` }]}
                  />
                </View>
              ) : null}
            </View>
          ) : (
            <Text style={styles.destination}>{stopName}</Text>
          )}
          <Text style={styles.secondary}>{footerText}</Text>
          {onTransit || undoAlight ? (
            <Pressable
              onPress={onTransit ? alight : undoAlight}
              onFocus={() => setFocused('alight')}
              onBlur={() => setFocused(null)}
              accessibilityRole="button"
              accessibilityLabel={onTransit ? s.compass.alighted : s.compass.undoAlight}
              style={({ pressed }) => [
                styles.action,
                pressed && styles.pressed,
                focused === 'alight' && styles.focused,
              ]}
            >
              <Footprints size={21} color={scheme.onSecondaryContainer} />
              <Text style={styles.actionText}>
                {onTransit ? s.compass.alighted : s.compass.undoAlight}
              </Text>
            </Pressable>
          ) : null}
          {waitingAtStop && !onTransit ? (
            <Pressable
              onPress={board}
              onFocus={() => setFocused('board')}
              onBlur={() => setFocused(null)}
              accessibilityRole="button"
              accessibilityLabel={s.compass.boarded}
              style={({ pressed }) => [
                styles.action,
                pressed && styles.pressed,
                focused === 'board' && styles.focused,
              ]}
            >
              <VehicleIcon size={21} color={scheme.onSecondaryContainer} />
              <Text style={styles.actionText}>{s.compass.boarded}</Text>
            </Pressable>
          ) : null}
          {locState === 'denied' && hasTarget ? (
            <Pressable
              onPress={() => void Linking.openSettings()}
              onFocus={() => setFocused('settings')}
              onBlur={() => setFocused(null)}
              accessibilityRole="button"
              accessibilityLabel={s.compass.openSettingsA11y}
              style={({ pressed }) => [
                styles.action,
                pressed && styles.pressed,
                focused === 'settings' && styles.focused,
              ]}
            >
              <Text style={styles.actionText}>{s.compass.enableLoc}</Text>
            </Pressable>
          ) : null}
          {onOpenMap ? (
            <Pressable
              onPress={openMap}
              onFocus={() => setFocused('overview')}
              onBlur={() => setFocused(null)}
              accessibilityRole="button"
              accessibilityLabel={s.compass.openMap}
              style={({ pressed }) => [
                styles.overview,
                pressed && styles.pressed,
                focused === 'overview' && styles.focused,
              ]}
            >
              <MapPinned size={19} color={scheme.onSurfaceVariant} />
              <Text style={styles.secondary}>{s.compass.openMap}</Text>
            </Pressable>
          ) : null}
        </ScrollView>
      </View>
    </>
  );

  return fullscreen ? (
    <View style={{ height: cardHeight.current }}>
      <Modal
        visible
        animationType={reduceMotion ? 'none' : 'slide'}
        statusBarTranslucent
        navigationBarTranslucent
        onRequestClose={() => setFullscreen(false)}
      >
        <SafeAreaProvider>
          <SafeAreaView style={styles.fullscreen} onAccessibilityEscape={() => setFullscreen(false)}>
            {content}
          </SafeAreaView>
        </SafeAreaProvider>
      </Modal>
    </View>
  ) : (
    <View
      style={styles.card}
      onLayout={(event) => {
        cardHeight.current = event.nativeEvent.layout.height;
      }}
    >
      {content}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: scheme.surfaceContainer,
    borderRadius: shape.extraLarge,
    overflow: 'hidden',
  },
  fullscreen: { flex: 1, backgroundColor: scheme.surface },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingLeft: 18,
    paddingRight: 8,
    paddingVertical: 8,
  },
  title: { ...type.titleMedium, color: scheme.onSurface, fontWeight: '700' },
  secondary: { ...type.bodySmall, color: scheme.onSurfaceVariant, lineHeight: 18 },
  copy: { flex: 1, minWidth: 0, gap: 4 },
  shrink: { flex: 1, minWidth: 0 },
  iconButton: {
    width: 48,
    height: 48,
    borderRadius: shape.medium,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: 'transparent',
  },
  pressed: { opacity: 0.75 },
  focused: { borderColor: scheme.primary },
  fullBody: { flex: 1, minHeight: 0 },
  landscape: { flexDirection: 'row' },
  map: { borderRadius: 0 },
  fullMap: { flex: 1, minHeight: 120 },
  noMap: { minHeight: 160, gap: 12, padding: 24, alignItems: 'center', justifyContent: 'center' },
  sheetScroll: { flexGrow: 0, flexShrink: 1 },
  sheet: { backgroundColor: scheme.surfaceContainer, padding: 18, gap: 14 },
  calibration: {
    backgroundColor: scheme.warningContainer,
    borderRadius: shape.medium,
    padding: 8,
    gap: 4,
  },
  calibrationButton: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 6,
    borderWidth: 2,
    borderColor: 'transparent',
    borderRadius: shape.small,
  },
  calibrationTitle: { ...type.labelLarge, color: scheme.onWarningContainer, fontWeight: '700' },
  calibrationHelp: { ...type.bodySmall, color: scheme.onWarningContainer },
  calibrationBody: {
    ...type.bodyMedium,
    color: scheme.onWarningContainer,
    lineHeight: 21,
    paddingHorizontal: 8,
    paddingBottom: 8,
  },
  lineRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  platform: {
    ...type.labelLarge,
    color: scheme.onSecondaryContainer,
    backgroundColor: scheme.secondaryContainer,
    padding: 8,
    borderRadius: shape.small,
  },
  instructionRow: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  wrap: { flexDirection: 'column', alignItems: 'stretch' },
  maneuver: {
    width: 56,
    height: 56,
    borderRadius: 20,
    backgroundColor: scheme.primaryContainer,
    alignItems: 'center',
    justifyContent: 'center',
  },
  distance: {
    fontSize: 34,
    fontWeight: '800',
    color: scheme.onSurface,
    fontVariant: ['tabular-nums'],
    includeFontPadding: false,
  },
  instruction: { ...type.titleMedium, fontWeight: '700', color: scheme.onSurface, lineHeight: 24 },
  nextStop: { ...type.headlineSmall, fontWeight: '700', lineHeight: 30 },
  rideDestination: { gap: 8 },
  destination: { ...type.bodyLarge, fontWeight: '600', color: scheme.onSurface },
  remaining: { ...type.labelLarge, color: scheme.primary },
  progress: {
    height: 6,
    borderRadius: 3,
    backgroundColor: scheme.outlineVariant,
    overflow: 'hidden',
  },
  progressFill: { height: 6, borderRadius: 3, backgroundColor: scheme.primary },
  action: {
    minHeight: 48,
    paddingVertical: 12,
    paddingHorizontal: 18,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    backgroundColor: scheme.secondaryContainer,
    borderRadius: shape.large,
    borderWidth: 2,
    borderColor: 'transparent',
  },
  actionText: {
    ...type.labelLarge,
    color: scheme.onSecondaryContainer,
    fontWeight: '700',
    flexShrink: 1,
  },
  overview: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderRadius: shape.medium,
    paddingHorizontal: 8,
    borderWidth: 2,
    borderColor: 'transparent',
  },
});
