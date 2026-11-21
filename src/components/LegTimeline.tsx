import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as Haptics from 'expo-haptics';
import { useRouter } from 'expo-router';
import { AppState, Pressable, StyleSheet, Text, View } from 'react-native';
import {
  ArrowRight,
  BusFront,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Footprints,
  MapPin,
  Ticket,
  TrainFront,
  TramFront,
  TriangleAlert,
} from './icons';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { elev, scheme, shape, type } from '../theme/tokens';
import type { Leg, LegStop, MetroEntranceRef } from '../types/models';
import { LineBadge, resolveLegBadgeColors } from './LineBadge';
import { RailAmenities } from './RailAmenities';
import { StationAmenities } from './StationAmenities';
import { shouldShowStationAmenities } from './stationAmenitiesGate';
import { VehicleSpecsStrip, formatVehicleSpecsA11y } from './VehicleSpecsStrip';
import { LiveSensors } from './LiveDot';
import { RoutingService } from '../services';
import { formatWalkTime, useWalkSpeedMps, walkMinutesFor } from '../services/settings';
import { liveTracker, type TrackedVehicle } from '../services/liveTracker';
import { useCurrentLocation, type CurrentLocation } from '../services/currentLocation';
import {
  buildFallbackStops,
  findNearestStopOnRoute,
  findUserSegment,
  locateLiveStopPosition,
  normalizeName,
  nowSecOfDay,
  positionToRank,
  type LiveStopPosition,
} from '../services/vehiclePosition';
import { ensureTrainTrack, type TrainTrack } from '../services/trainTrack';
import { loadTrainDoorSide, type DoorSide } from '../services/trainDoorSide';
import { classifyVehicleModel } from '../services/vehicleInfo';
import { useStrings, type Strings } from '../i18n';
import { motion } from '../theme/motion';
import { isFareBoundary, parseFareBoundary } from '../gtfs/fareBoundary';
import { secondsToTimeString, timeStringToSeconds } from '../gtfs/geo';
import { legDurationMin, scheduledLegTimes } from '../services/routing/connectionTimes';
import { reliabilityNotice } from './reliabilityNotice';
import {
  inferRailAgency,
  isIntercityTrain,
  isTrainLeg,
  railAgencyFullName,
  railDirectionLabel,
} from '../services/railIdentity';
import { useStopHint } from '../services/stopHints';
import { getActiveCityIdSync } from '../services/cityStore';
import { suggestCityForCoords } from '../cities';
import { isFallbackOrigin } from '../config';
import { formatPlatformLabel } from '../services/platformLabel';

// Wspólna geometria 3-kolumnowej osi czasu: lewa kolumna z godzinami (54 px),
// środkowa szyna z węzłami i markerem pojazdu (28 px), prawa kolumna treści.
// Taca rozwijanych przystanków rozszerza się o TRAY_BLEED na boki, ale zachowuje
// dokładnie tę samą oś X szyny co nagłówek odjazdu, wiersz linii i stopka przyjazdu.
const CARD_PAD_H = 14;
const TIME_COL_W = 54;
const RAIL_COL_W = 28;
const COL_GAP = 8;
const SPINE_W = 3;
const TRAY_BLEED = 6;
const TRAY_BORDER_W = 1;

function parseHexRgb(hex: string): [number, number, number] | null {
  const clean = hex.trim().replace(/^#/, '');
  if (clean.length !== 6) return null;
  const r = parseInt(clean.slice(0, 2), 16);
  const g = parseInt(clean.slice(2, 4), 16);
  const b = parseInt(clean.slice(4, 6), 16);
  if (Number.isNaN(r) || Number.isNaN(g) || Number.isNaN(b)) return null;
  return [r, g, b];
}

function relativeLuminance([r, g, b]: [number, number, number]): number {
  const lin = (v: number) => {
    const srgb = v / 255;
    return srgb <= 0.03928 ? srgb / 12.92 : Math.pow((srgb + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

function contrastRatio(a: [number, number, number], b: [number, number, number]): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const lighter = Math.max(la, lb);
  const darker = Math.min(la, lb);
  return (lighter + 0.05) / (darker + 0.05);
}

function toHex([r, g, b]: [number, number, number]): string {
  const clamp = (n: number) => Math.max(0, Math.min(255, Math.round(n)));
  return (
    '#' +
    [clamp(r), clamp(g), clamp(b)].map((c) => c.toString(16).padStart(2, '0')).join('')
  );
}

/**
 * Zapewnia wyraźny kontrast (>= 3.8:1) pionowej szyny i pierścieni przystanków
 * względem tła karty w obu motywach (ciemnym i jasnym). Ciemne barwy przewoźników
 * (np. granat IC) rozjaśnia na ciemnym tle, a jasne tony (np. miętowy tramwaj)
 * przyciemnia na jasnym tle, zachowując barwę linii.
 */
function resolveRailStrokeColor(accentHex: string, surfaceHex: string): string {
  const accent = parseHexRgb(accentHex);
  const surface = parseHexRgb(surfaceHex);
  if (!accent || !surface) return accentHex;
  if (contrastRatio(accent, surface) >= 3.6) return accentHex;

  const isDarkSurface = relativeLuminance(surface) < 0.25;
  const target: [number, number, number] = isDarkSurface ? [255, 255, 255] : [0, 0, 0];
  for (let step = 1; step <= 10; step++) {
    const t = step * 0.08;
    const mixed: [number, number, number] = [
      accent[0] + (target[0] - accent[0]) * t,
      accent[1] + (target[1] - accent[1]) * t,
      accent[2] + (target[2] - accent[2]) * t,
    ];
    if (contrastRatio(mixed, surface) >= 4.0) return toHex(mixed);
  }
  return toHex([
    accent[0] + (target[0] - accent[0]) * 0.6,
    accent[1] + (target[1] - accent[1]) * 0.6,
    accent[2] + (target[2] - accent[2]) * 0.6,
  ]);
}

function genericModeNom(t: Strings, mode: Leg['mode']): string {
  if (mode === 'tram') return t.leg.modeTram;
  if (mode === 'train') return t.leg.modeTrain;
  if (mode === 'subway') return t.leg.modeSubway;
  if (mode === 'trolleybus') return t.leg.modeTrolley;
  if (mode === 'cable') return t.leg.modeCable;
  if (mode === 'bus') return t.leg.modeBus;
  return t.leg.modeVehicle;
}

function genericModeGen(t: Strings, mode: Leg['mode']): string {
  if (mode === 'tram') return t.routes.vehicleTramGen;
  if (mode === 'train') return t.routes.vehicleTrainGen;
  if (mode === 'subway') return t.routes.vehicleSubwayGen;
  if (mode === 'trolleybus') return t.routes.vehicleTrolleyGen;
  if (mode === 'cable') return t.routes.vehicleCableGen;
  return t.routes.vehicleBusGen;
}

// Modułowy cache: brak flickeru przy zwijaniu/rozwijaniu.
// Limit wpisów, żeby przeglądanie setek kursów w jednej sesji nie zjadało pamięci.
const STOPS_CACHE_MAX = 80;
const stopsCache = new Map<string, LegStop[]>();
const stopsPromise = new Map<string, Promise<LegStop[]>>();

function cacheStops(key: string, stops: LegStop[]) {
  stopsCache.set(key, stops);
  while (stopsCache.size > STOPS_CACHE_MAX) {
    const oldest = stopsCache.keys().next();
    if (oldest.done) break;
    stopsCache.delete(oldest.value);
  }
}

function VehicleGlyph({ mode, color }: { mode: Leg['mode']; color: string }) {
  const Icon =
    mode === 'tram' ? TramFront : mode === 'train' || mode === 'subway' ? TrainFront : BusFront;
  return <Icon size={14} color={color} />;
}

/** Zwraca true, jeśli odcinek między przystankiem k a k+1 został już w całości przejechany. */
function isEdgePassed(livePosition: LiveStopPosition | null, fromIdx: number): boolean {
  if (!livePosition) return false;
  if (livePosition.atStopIndex != null) {
    return fromIdx < livePosition.atStopIndex;
  }
  return fromIdx < livePosition.passedStopIndex;
}

/** Wiersz pozycji pojazdu w trasie między przystankami na pionowej osi czasu. */
const InTransitRow = memo(function InTransitRow({
  nextStopName,
  mode,
  badgeBg,
  badgeFg,
  railStroke,
  vehicleLabel,
}: {
  nextStopName: string;
  mode: Leg['mode'];
  badgeBg: string;
  badgeFg: string;
  railStroke: string;
  vehicleLabel: string;
}) {
  const t = useStrings();

  return (
    <View style={s.inTransitRow}>
      <View style={s.timeCol} />
      <View style={s.railCol}>
        <View style={[s.railHalfTop, { backgroundColor: scheme.outlineVariant }]} />
        <View
          accessible
          accessibilityRole="image"
          accessibilityLabel={vehicleLabel}
          style={[s.vehicleSquircle, { backgroundColor: badgeBg }]}
        >
          <VehicleGlyph mode={mode} color={badgeFg} />
        </View>
        <View style={[s.railHalfBottom, { backgroundColor: railStroke }]} />
      </View>
      <View style={s.inTransitContent}>
        <View style={s.inTransitPill}>
          <Text style={s.inTransitPillText} numberOfLines={1}>
            {t.leg.inTransitTo(nextStopName)}
          </Text>
        </View>
      </View>
    </View>
  );
});

/** Pojedynczy wiersz przystanku pośredniego wyrównany do wspólnej osi 3-kolumnowej. */
const IntermediateStopRow = memo(function IntermediateStopRow({
  stop,
  vehicleMode,
  isTrain,
  railStroke,
  badgeBg,
  badgeFg,
  passed,
  isAtStop,
  topSpinePassed,
  bottomSpinePassed,
  vehicleLabel,
  showStationArrivals,
  delayShiftSec,
}: {
  stop: LegStop;
  vehicleMode: Leg['mode'];
  isTrain: boolean;
  railStroke: string;
  badgeBg: string;
  badgeFg: string;
  passed: boolean;
  isAtStop: boolean;
  topSpinePassed: boolean;
  bottomSpinePassed: boolean;
  vehicleLabel: string;
  showStationArrivals: boolean;
  delayShiftSec: number;
}) {
  const t = useStrings();
  const boundary = parseFareBoundary(stop.name);

  const arrClock =
    stop.arriveSec != null ? secondsToTimeString(stop.arriveSec + delayShiftSec) : null;
  const depClock =
    stop.departSec != null ? secondsToTimeString(stop.departSec + delayShiftSec) : null;
  const dwellMin =
    stop.arriveSec != null && stop.departSec != null
      ? Math.floor((stop.departSec - stop.arriveSec) / 60)
      : 0;
  const stationPlatform =
    stop.platform || stop.track
      ? formatPlatformLabel(t, stop.platform, vehicleMode, stop.name, stop.track)
      : null;
  const subMeta = [stationPlatform, dwellMin >= 2 ? t.leg.dwellMin(dwellMin) : null]
    .filter(Boolean)
    .join(' \u00b7 ');

  const hasDistinctDualTimes = Boolean(arrClock && depClock && arrClock !== depClock);
  const showDualRailTimes = !boundary && hasDistinctDualTimes && (showStationArrivals || dwellMin >= 2);
  const singleClock = depClock ?? arrClock;

  const topColor = topSpinePassed ? scheme.outlineVariant : railStroke;
  const bottomColor = bottomSpinePassed ? scheme.outlineVariant : railStroke;

  if (boundary) {
    return (
      <View style={s.stopGridRow} accessibilityRole="text">
        <View style={s.timeCol} />
        <View style={s.railCol}>
          <View style={[s.railContinuous, { backgroundColor: topColor }]} />
        </View>
        <View style={s.stopContentCol}>
          <View style={s.boundaryChip}>
            <Ticket size={14} color={scheme.onSecondaryContainer} />
            <View style={s.boundaryText}>
              <Text style={s.boundaryTitle}>{t.leg.fareBoundary}</Text>
              <Text style={s.boundaryDetail}>
                {t.leg.fareBoundaryDetail(boundary.areas, boundary.point)}
              </Text>
            </View>
          </View>
        </View>
      </View>
    );
  }

  return (
    <View style={s.stopGridRow}>
      <View style={s.stopTimeCol}>
        {showDualRailTimes ? (
          <>
            <Text
              style={[s.stopTimePrimary, passed && !isAtStop && s.stopTimePassed]}
              numberOfLines={1}
            >
              {arrClock}
            </Text>
            <Text style={s.stopTimeSecondary} numberOfLines={1}>
              {depClock}
            </Text>
          </>
        ) : singleClock ? (
          <Text
            style={[s.stopTimeSingle, passed && !isAtStop && s.stopTimePassed]}
            numberOfLines={1}
          >
            {singleClock}
          </Text>
        ) : null}
      </View>

      <View style={s.railCol}>
        <View style={[s.railHalfTop, { backgroundColor: topColor }]} />
        {isAtStop ? (
          <View
            accessible
            accessibilityRole="image"
            accessibilityLabel={vehicleLabel}
            style={[s.vehicleSquircle, { backgroundColor: badgeBg }]}
          >
            <VehicleGlyph mode={vehicleMode} color={badgeFg} />
          </View>
        ) : passed ? (
          <View style={s.passedStopDot} />
        ) : (
          <View style={[s.upcomingStopRing, { borderColor: railStroke }]} />
        )}
        <View style={[s.railHalfBottom, { backgroundColor: bottomColor }]} />
      </View>

      <View style={s.stopContentCol}>
        <Text
          style={[
            s.stopName,
            passed && !isAtStop && s.stopNamePassed,
            isAtStop && s.stopNameActive,
          ]}
          numberOfLines={2}
        >
          {stop.name}
        </Text>
        {subMeta ? (
          <Text style={s.stopMeta} numberOfLines={1}>
            {subMeta}
          </Text>
        ) : null}
        {isAtStop ? (
          <View style={s.atStopPill}>
            <Text style={s.atStopPillText}>
              {isTrain ? t.leg.atStationNow : t.leg.atStopNow}
            </Text>
          </View>
        ) : null}
      </View>
    </View>
  );
});

/** Rozwijana taca stacji / przystanków pośrednich z ciągłą osią czasu. */
const LegStopsTray = memo(function LegStopsTray({
  leg,
  stops,
  segment,
  isTrain,
  railStroke,
  badgeBg,
  badgeFg,
  livePosition,
  loading,
  delayShiftSec,
  entrySpineColor,
  exitSpineColor,
}: {
  leg: Leg;
  stops: LegStop[];
  segment: { start: number; end: number };
  isTrain: boolean;
  railStroke: string;
  badgeBg: string;
  badgeFg: string;
  livePosition: LiveStopPosition | null;
  loading: boolean;
  delayShiftSec: number;
  entrySpineColor: string;
  exitSpineColor: string;
}) {
  const t = useStrings();
  const showStationArrivals = isIntercityTrain(leg) || isTrain;
  const intermediateIndices = useMemo(() => {
    const out: number[] = [];
    for (let i = segment.start + 1; i < segment.end; i++) {
      out.push(i);
    }
    return out;
  }, [segment.start, segment.end]);

  const showTrailingInTransit =
    !loading &&
    livePosition?.marker?.placement === 'between' &&
    livePosition.marker.index === segment.end - 1 &&
    segment.end > segment.start;

  return (
    <View style={s.trayOuter}>
      <View style={s.trayCard}>
        {/* Górny łącznik szyny wchodzący do tacy */}
        <View style={s.trayCapRow}>
          <View style={s.timeCol} />
          <View style={s.railCol}>
            <View style={[s.railContinuous, { backgroundColor: entrySpineColor }]} />
          </View>
          <View style={s.capSpacer} />
        </View>

        {loading ? (
          <View accessible accessibilityLabel={t.leg.stopsLoading}>
            {[0, 1, 2].map((idx) => (
              <View key={idx} style={s.stopGridRow}>
                <View style={s.stopTimeCol}>
                  <View style={[s.skeletonBar, { width: 34 }]} />
                </View>
                <View style={s.railCol}>
                  <View style={[s.railHalfTop, { backgroundColor: railStroke }]} />
                  <View style={[s.upcomingStopRing, { borderColor: railStroke }]} />
                  <View style={[s.railHalfBottom, { backgroundColor: railStroke }]} />
                </View>
                <View style={s.stopContentCol}>
                  <View style={[s.skeletonBar, { width: `${72 - idx * 14}%` }]} />
                </View>
              </View>
            ))}
          </View>
        ) : (
          <>
            {intermediateIndices.map((i) => {
              const stop = stops[i];
              if (!stop) return null;
              const prevStop = stops[i - 1];
              const passed = livePosition != null && i <= livePosition.passedStopIndex;
              const isAtStop =
                livePosition?.marker?.placement === 'at_stop' && livePosition.marker.index === i;
              const showInTransitBefore =
                livePosition?.marker?.placement === 'between' &&
                livePosition.marker.index === i - 1;
              const topSpinePassed = showInTransitBefore ? false : isEdgePassed(livePosition, i - 1);
              const bottomSpinePassed =
                livePosition?.marker?.placement === 'between' && livePosition.marker.index === i
                  ? true
                  : isEdgePassed(livePosition, i);

              return (
                <View key={`${stop.stopId}-${stop.seq}`}>
                  {showInTransitBefore ? (
                    <InTransitRow
                      nextStopName={stop.name}
                      mode={leg.mode}
                      badgeBg={badgeBg}
                      badgeFg={badgeFg}
                      railStroke={railStroke}
                      vehicleLabel={t.leg.vehicleBetween(
                        genericModeGen(t, leg.mode),
                        prevStop?.name ?? leg.fromStop,
                        stop.name,
                      )}
                    />
                  ) : null}
                  <IntermediateStopRow
                    stop={stop}
                    vehicleMode={leg.mode}
                    isTrain={isTrain}
                    railStroke={railStroke}
                    badgeBg={badgeBg}
                    badgeFg={badgeFg}
                    passed={passed}
                    isAtStop={isAtStop}
                    topSpinePassed={topSpinePassed}
                    bottomSpinePassed={bottomSpinePassed}
                    showStationArrivals={showStationArrivals}
                    delayShiftSec={delayShiftSec}
                    vehicleLabel={t.leg.nearStop(genericModeNom(t, leg.mode), stop.name)}
                  />
                </View>
              );
            })}

            {showTrailingInTransit ? (
              <InTransitRow
                nextStopName={leg.toStop}
                mode={leg.mode}
                badgeBg={badgeBg}
                badgeFg={badgeFg}
                railStroke={railStroke}
                vehicleLabel={t.leg.vehicleBetween(
                  genericModeGen(t, leg.mode),
                  stops[segment.end - 1]?.name ?? leg.fromStop,
                  leg.toStop,
                )}
              />
            ) : null}
          </>
        )}

        {/* Dolny łącznik szyny wychodzący z tacy */}
        <View style={s.trayCapRow}>
          <View style={s.timeCol} />
          <View style={s.railCol}>
            <View style={[s.railContinuous, { backgroundColor: exitSpineColor }]} />
          </View>
          <View style={s.capSpacer} />
        </View>
      </View>

      {/* Odstęp pod tacą zachowujący ciągłość szyny przed przystankiem końcowym */}
      <View style={s.trayFooterConnector}>
        <View style={s.timeCol} />
        <View style={s.railCol}>
          <View style={[s.railContinuous, { backgroundColor: exitSpineColor }]} />
        </View>
        <View style={s.capSpacer} />
      </View>
    </View>
  );
});

const LiveDataAgeInline = memo(function LiveDataAgeInline({ timestamp }: { timestamp: number }) {
  const t = useStrings();
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = setInterval(() => {
      setNow(Date.now());
    }, 1000);
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        setNow(Date.now());
      }
    });
    return () => {
      clearInterval(timer);
      sub.remove();
    };
  }, []);

  const ageSec = Math.max(0, Math.floor((now - timestamp) / 1000));
  return <Text style={s.liveInlineMuted}>{` \u00b7 ${t.leg.liveAgeShort(ageSec)}`}</Text>;
});

/** Karta jednego przejazdu M3 Expressive z ciągłą 3-kolumnową osią czasu. */

function formatMetroEntranceLabel(
  t: Strings,
  kind: 'entrance' | 'exit',
  entrance: MetroEntranceRef,
): string {
  const base =
    kind === 'entrance'
      ? t.leg.metroEntrance(entrance.num)
      : t.leg.metroExit(entrance.num);
  if (entrance.wheelchair && !/winda|lift|aufzug|ліфт/i.test(entrance.num)) {
    return `${base} (${t.leg.metroElevatorTag})`;
  }
  return base;
}

function MetroEntranceBlock({
  t,
  kind,
  entrance,
  compactMargin,
}: {
  t: Strings;
  kind: 'entrance' | 'exit';
  entrance: MetroEntranceRef;
  compactMargin?: boolean;
}) {
  return (
    <View style={compactMargin ? s.entranceConnectorWrap : s.entranceLegWrap}>
      <View style={s.platformBadge}>
        <Text style={s.platformBadgeText}>
          {formatMetroEntranceLabel(t, kind, entrance)}
        </Text>
      </View>
      {entrance.hint ? (
        <View style={s.stopHintBox}>
          <MapPin size={14} color={scheme.primary} style={s.stopHintIcon} />
          <Text style={s.stopHintText}>{entrance.hint}</Text>
        </View>
      ) : null}
    </View>
  );
}

const TransitLegCard = memo(function TransitLegCard({
  leg,
  expanded,
  onToggle,
  userLocation,
  allowLive,
  boardedDepartAt,
  showStationAmenities,
  showFromEntrance,
  showToEntrance,
}: {
  leg: Leg;
  expanded: boolean;
  onToggle: (id: string) => void;
  userLocation: CurrentLocation | null;
  allowLive: boolean;
  boardedDepartAt?: string;
  showStationAmenities?: boolean;
  showFromEntrance?: boolean;
  showToEntrance?: boolean;
}) {
  const t = useStrings();
  const router = useRouter();
  const [hasExpanded, setHasExpanded] = useState(expanded);
  if (expanded && !hasExpanded) setHasExpanded(true);

  const { bg: badgeBg, fg: badgeFg } = resolveLegBadgeColors({ leg });
  const surfaceBg = scheme.surfaceContainer;
  const railStroke = useMemo(
    () => resolveRailStrokeColor(badgeBg, surfaceBg),
    [badgeBg, surfaceBg],
  );

  const scheduled = scheduledLegTimes(leg, timeStringToSeconds(leg.departAt));
  const scheduledDeparture = scheduled.departure;
  const delayMin =
    leg.live || leg.delayConfidence === 'estimated' ? Math.round((leg.delaySec ?? 0) / 60) : 0;
  const arrivalDelayMin =
    leg.live || leg.delayConfidence === 'estimated'
      ? Math.round((leg.arrivalDelaySec ?? leg.delaySec ?? 0) / 60)
      : 0;
  const delayShiftSec =
    leg.live || leg.delayConfidence === 'estimated' ? (leg.delaySec ?? 0) : 0;
  const notice = reliabilityNotice([leg], t);

  const isTrain = isTrainLeg(leg);
  const legCityId = useMemo(() => {
    if (isTrain) return null;
    if (leg.fromLat != null && leg.fromLon != null) {
      const detected = suggestCityForCoords(leg.fromLat, leg.fromLon);
      if (detected) return detected.id;
    }
    return getActiveCityIdSync();
  }, [isTrain, leg.fromLat, leg.fromLon]);

  const inferredAgency = useMemo(
    () => (isTrain ? inferRailAgency(leg, legCityId ?? undefined) : undefined),
    [isTrain, leg, legCityId],
  );
  const agencySubtitle = useMemo(
    () => (isTrain ? railAgencyFullName(inferredAgency) : undefined),
    [isTrain, inferredAgency],
  );

  const isBoardedLeg = Boolean(boardedDepartAt);
  const resolvedHint = useStopHint(
    isTrain ? '' : (legCityId ?? ''),
    leg.platformCode,
    leg.fromStopId,
    leg.fromStop,
    leg.mode,
  );
  const stopHint = isTrain || isBoardedLeg ? null : (leg.stopHint ?? resolvedHint);
  const departurePlatform = useMemo(
    () => formatPlatformLabel(t, leg.platformCode, leg.mode, leg.fromStop, leg.trackCode),
    [t, leg.platformCode, leg.mode, leg.fromStop, leg.trackCode],
  );

  const cacheKey = leg.tripId || leg.id;
  const [stops, setStops] = useState<LegStop[]>(
    () => stopsCache.get(cacheKey) ?? buildFallbackStops(leg),
  );
  const [loading, setLoading] = useState(
    () =>
      !stopsCache.has(cacheKey) &&
      !!leg.tripId &&
      !(leg.intermediateStops && leg.intermediateStops.length >= 2),
  );
  const [vehicle, setVehicle] = useState<TrackedVehicle | null>(null);
  const [lastOk, setLastOk] = useState(() => liveTracker.getLastOk());

  useEffect(() => {
    let mounted = true;
    const cached = stopsCache.get(cacheKey);
    if (cached) {
      setStops(cached);
      setLoading(false);
      return;
    }
    const hasInlineStops = Boolean(leg.intermediateStops && leg.intermediateStops.length >= 2);
    if (!leg.tripId || (!expanded && hasInlineStops)) {
      setStops(buildFallbackStops(leg));
      setLoading(false);
      return;
    }
    setLoading(!hasInlineStops);
    let promise = stopsPromise.get(leg.tripId);
    if (!promise) {
      promise = RoutingService.getTripStops(leg.tripId)
        .then((fetched) => {
          stopsPromise.delete(leg.tripId!);
          return fetched;
        })
        .catch((err) => {
          stopsPromise.delete(leg.tripId!);
          throw err;
        });
      stopsPromise.set(leg.tripId, promise);
    }
    promise.then(
      (fetched) => {
        if (!mounted) return;
        if (fetched.length >= 2) cacheStops(cacheKey, fetched);
        setStops(fetched.length >= 2 ? fetched : buildFallbackStops(leg));
        setLoading(false);
      },
      (err) => {
        console.warn('[TransitLegCard] trip stops failed:', err);
        if (!mounted) return;
        setStops(buildFallbackStops(leg));
        setLoading(false);
      },
    );
    return () => {
      mounted = false;
    };
  }, [cacheKey, expanded, leg]);

  const segment = useMemo(() => findUserSegment(stops, leg), [stops, leg]);

  const stopsCount = useMemo(() => {
    const segStops = stops.slice(segment.start, segment.end + 1);
    if (segStops.length < 2) return leg.stopsCount;
    const physicalStops = segStops.filter((stop) => !isFareBoundary(stop.name));
    if (physicalStops.length === segStops.length && stops.length <= 2) return leg.stopsCount;
    return Math.max(0, physicalStops.length - 1);
  }, [stops, segment.start, segment.end, leg.stopsCount]);

  const intermediateStats = useMemo(() => {
    const inner = stops.slice(segment.start + 1, segment.end);
    const physicalInner = inner.filter((stop) => !isFareBoundary(stop.name)).length;
    const hasBoundary = inner.length > physicalInner;
    const count =
      stops.length > 2 ? physicalInner : Math.max(0, (leg.stopsCount ?? 0) - 1);
    return {
      count,
      hasExpandable: count > 0 || hasBoundary,
    };
  }, [stops, segment.start, segment.end, leg.stopsCount]);

  const arrivalPlatform = useMemo(() => {
    const lastStop = stops[segment.end];
    if (!lastStop || (!lastStop.platform && !lastStop.track)) return null;
    return formatPlatformLabel(t, lastStop.platform, leg.mode, leg.toStop, lastStop.track);
  }, [stops, segment.end, t, leg.mode, leg.toStop]);

  const durationMin = useMemo(
    () =>
      legDurationMin({
        ...leg,
        departAt: boardedDepartAt ?? leg.departAt,
        scheduledDepartureSec: isBoardedLeg ? undefined : leg.scheduledDepartureSec,
        stopsCount,
      }),
    [
      boardedDepartAt,
      isBoardedLeg,
      leg.departAt,
      leg.arriveAt,
      leg.scheduledDepartureSec,
      leg.scheduledArrivalSec,
      stopsCount,
    ],
  );

  const [track, setTrack] = useState<TrainTrack | null>(null);
  useEffect(() => {
    if (!isTrain) return;
    let mounted = true;
    void ensureTrainTrack(leg, stops, segment).then(
      (nextTrack) => {
        if (mounted) setTrack((prev) => (prev === nextTrack ? prev : nextTrack));
      },
      () => {},
    );
    return () => {
      mounted = false;
    };
  }, [isTrain, leg, stops, segment]);

  const [doorSide, setDoorSide] = useState<DoorSide | null>(null);
  useEffect(() => {
    if (!isTrain) {
      setDoorSide(null);
      return;
    }
    let mounted = true;
    const lastStop = stops[segment.end];
    void loadTrainDoorSide({
      stopId: lastStop?.stopId ?? leg.toStopId,
      lat: lastStop?.lat ?? leg.toLat,
      lon: lastStop?.lon ?? leg.toLon,
      platform: lastStop?.platform,
      track: lastStop?.track,
      trainTrack: track,
      stops,
      segment,
    }).then((side) => {
      if (mounted) setDoorSide((prev) => (prev === side ? prev : side));
    });
    return () => {
      mounted = false;
    };
  }, [isTrain, leg.toStopId, leg.toLat, leg.toLon, stops, segment, track]);

  useEffect(() => {
    if (leg.tripId?.startsWith('pl:')) {
      setVehicle(null);
      return;
    }
    const updateVehicle = () => {
      const nowMs = Date.now();
      setLastOk(liveTracker.getLastOk());
      if (
        !allowLive ||
        !leg.tripId ||
        (leg.mode !== 'tram' &&
          leg.mode !== 'bus' &&
          leg.mode !== 'subway' &&
          leg.mode !== 'trolleybus' &&
          leg.mode !== 'train')
      ) {
        setVehicle(null);
        return;
      }
      let match = liveTracker
        .snapshot(leg.line)
        .find(
          (candidate) =>
            candidate.matchedTripId === leg.tripId &&
            nowMs - candidate.updatedAt >= 0 &&
            nowMs - candidate.updatedAt <= 120_000,
        );
      if (!match && leg.tripId) {
        match = liveTracker
          .snapshot()
          .find(
            (candidate) =>
              candidate.matchedTripId === leg.tripId &&
              nowMs - candidate.updatedAt >= 0 &&
              nowMs - candidate.updatedAt <= 120_000,
          );
      }
      setVehicle((prev) => {
        if (match) return match;
        if (prev && nowMs - prev.updatedAt >= 0 && nowMs - prev.updatedAt <= 120_000) {
          return prev;
        }
        return null;
      });
    };

    updateVehicle();
    const unsub = liveTracker.subscribe(updateVehicle);
    const timer = setInterval(updateVehicle, 5000);
    return () => {
      unsub();
      clearInterval(timer);
    };
  }, [allowLive, leg.line, leg.mode, leg.tripId]);

  const liveActive = allowLive && (expanded || leg.live || vehicle != null);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!liveActive) return;
    setNow((prev) => (Date.now() - prev > 4000 ? Date.now() : prev));
    const timer = setInterval(() => setNow(Date.now()), 5000);
    return () => clearInterval(timer);
  }, [liveActive]);

  const lastLegIdRef = useRef(leg.id);
  const rankRef = useRef<number>(-1);
  const rankSourceRef = useRef<LiveStopPosition['source']>('vehicle');
  if (lastLegIdRef.current !== leg.id) {
    lastLegIdRef.current = leg.id;
    rankRef.current = -1;
    rankSourceRef.current = 'vehicle';
  }

  const livePosition = useMemo(() => {
    if (!liveActive) return null;
    const pos = locateLiveStopPosition(
      stops,
      leg,
      vehicle,
      userLocation,
      now,
      rankRef.current,
      rankSourceRef.current,
      track,
    );
    if (pos) {
      rankRef.current =
        pos.source === 'estimate'
          ? Math.max(rankRef.current, positionToRank(pos))
          : positionToRank(pos);
      rankSourceRef.current = pos.source;
    }
    return pos;
  }, [liveActive, stops, leg, vehicle, userLocation, now, track]);

  const nearestStop = useMemo(() => {
    if (!allowLive || (!vehicle && !leg.live)) return null;
    return findNearestStopOnRoute(stops, vehicle);
  }, [stops, vehicle, allowLive, leg.live]);

  const waitingAtTerminus = useMemo(() => {
    if (!nearestStop || leg.mode === 'train') return false;
    if (stops.length < 2) return false;
    const idx = stops.findIndex((stop) => stop.stopId === nearestStop.stopId);
    if (idx !== 0 && idx !== stops.length - 1) return false;
    const departSec = timeStringToSeconds(leg.departAt);
    const minutesToDeparture = (departSec - nowSecOfDay() + 86400) % 86400;
    return minutesToDeparture > 0 && minutesToDeparture <= 20;
  }, [nearestStop, stops, leg.mode, leg.departAt]);

  const livePositionDetail = useMemo(() => {
    if (!leg.live && !vehicle) return null;
    if (waitingAtTerminus) return t.leg.waitingAtTerminus;
    if (
      livePosition?.marker?.placement === 'between' &&
      stops[livePosition.marker.index] &&
      stops[livePosition.marker.index + 1]
    ) {
      return t.leg.betweenStops(
        stops[livePosition.marker.index].name,
        stops[livePosition.marker.index + 1].name,
      );
    }
    if (livePosition?.marker?.placement === 'at_stop' && stops[livePosition.marker.index]) {
      return `${isTrain ? t.leg.atStationNow : t.leg.atStopNow}: ${stops[livePosition.marker.index].name}`;
    }
    if (nearestStop) return nearestStop.name;
    if (leg.liveNextStop) return t.leg.inTransitTo(leg.liveNextStop);
    return null;
  }, [leg.live, leg.liveNextStop, vehicle, waitingAtTerminus, livePosition, stops, isTrain, nearestStop, t]);

  const pingKey = vehicle?.updatedAt ?? (leg.live ? lastOk : undefined);
  const liveTimestamp = vehicle?.updatedAt ?? (leg.live && lastOk > 0 ? lastOk : undefined);

  const vehicleSpecs = useMemo(
    () => classifyVehicleModel(vehicle?.model, leg.mode),
    [vehicle?.model, leg.mode],
  );
  const directionLabel =
    leg.mode === 'train' ? railDirectionLabel(leg) || leg.direction : leg.direction;
  const isNationalRail =
    Boolean(leg.tripId?.startsWith('pl:')) ||
    Boolean(leg.routeId?.startsWith('pl:')) ||
    Boolean(leg.fromStopId?.startsWith('pl:') || leg.fromStopId?.startsWith('stop-pl:'));
  const canOpenLine = Boolean(leg.routeId || leg.line || leg.tripId);
  const lineCardBaseA11y = directionLabel
    ? `${t.lineTimetable.open(leg.line ?? '')}, ${t.lineTimetable.direction}: ${directionLabel}`
    : t.lineTimetable.open(leg.line ?? '');
  const lineCardA11y = vehicleSpecs
    ? `${lineCardBaseA11y}. ${formatVehicleSpecsA11y(vehicleSpecs, t)}`
    : lineCardBaseA11y;

  const openLineTimetable = useCallback(() => {
    if (!canOpenLine) return;
    void Haptics.selectionAsync();
    router.push({
      pathname: '/line',
      params: {
        ...(leg.routeId ? { routeId: leg.routeId } : {}),
        ...(leg.line ? { line: leg.line } : {}),
        ...(leg.mode ? { mode: leg.mode } : {}),
        ...(leg.tripId ? { tripId: leg.tripId } : {}),
        ...(leg.direction || directionLabel
          ? { direction: leg.direction || directionLabel }
          : {}),
        ...(leg.fromStopId ? { fromStopId: leg.fromStopId } : {}),
        ...(leg.toStopId ? { toStopId: leg.toStopId } : {}),
        ...(leg.fromStop ? { fromStop: leg.fromStop } : {}),
        ...(leg.toStop ? { toStop: leg.toStop } : {}),
        ...(isNationalRail ? { dbTarget: 'national' } : {}),
      },
    });
  }, [
    canOpenLine,
    router,
    leg.routeId,
    leg.line,
    leg.mode,
    leg.tripId,
    leg.direction,
    directionLabel,
    leg.fromStopId,
    leg.toStopId,
    leg.fromStop,
    leg.toStop,
    isNationalRail,
  ]);

  const handleToggleStops = useCallback(() => {
    if (!intermediateStats.hasExpandable) return;
    void Haptics.selectionAsync();
    onToggle(leg.id);
  }, [intermediateStats.hasExpandable, onToggle, leg.id]);

  // Animacja rozwijania tacy przystanków
  const showStationArrivals = isIntercityTrain(leg) || isTrain;
  const estimatedInitialHeight =
    Math.max(1, intermediateStats.count) * (showStationArrivals ? 58 : 46) + 28;
  const chevron = useSharedValue(expanded ? 1 : 0);
  const measuredHeight = useSharedValue(0);
  const stopsHeightAnim = useSharedValue(expanded ? estimatedInitialHeight : 0);

  useEffect(() => {
    chevron.value = withSpring(expanded ? 1 : 0, motion.spring.spatialFast);
    const targetHeight = measuredHeight.value > 0 ? measuredHeight.value : estimatedInitialHeight;
    stopsHeightAnim.value = withSpring(
      expanded && intermediateStats.hasExpandable ? targetHeight : 0,
      motion.spring.spatialDefault,
    );
  }, [
    expanded,
    intermediateStats.hasExpandable,
    chevron,
    stopsHeightAnim,
    measuredHeight,
    estimatedInitialHeight,
  ]);

  const chevronStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${chevron.value * 180}deg` }],
  }));

  const stopsAnimStyle = useAnimatedStyle(() => {
    const height = stopsHeightAnim.value;
    const maxH = Math.max(1, measuredHeight.value || estimatedInitialHeight);
    const opacity = Math.min(1, Math.max(0, height / Math.min(40, maxH)));
    return {
      height,
      opacity,
    };
  });

  // Stany szyny: przebyty vs nadchodzący odcinek
  const departurePassed = livePosition != null && segment.start <= livePosition.passedStopIndex;
  const legCompleted =
    livePosition != null &&
    (livePosition.passedStopIndex >= segment.end || livePosition.atStopIndex === segment.end);
  const isInTransitOnLeg =
    livePosition != null &&
    departurePassed &&
    !legCompleted &&
    livePosition.marker != null;

  const departureSpineColor = departurePassed ? scheme.outlineVariant : railStroke;
  const trayEntrySpineColor = departurePassed ? scheme.outlineVariant : railStroke;
  const arrivalTopSpineColor =
    legCompleted || isEdgePassed(livePosition, segment.end - 1)
      ? scheme.outlineVariant
      : railStroke;

  const showLiveBanner = Boolean(
    leg.live || notice || (delayMin !== 0 && (isBoardedLeg || scheduledDeparture != null)),
  );

  const liveStatusColor =
    delayMin > 0
      ? scheme.error
      : delayMin < 0 || leg.delayConfidence === 'estimated'
        ? scheme.warning
        : leg.live
          ? scheme.success
          : scheme.onSurfaceVariant;

  const liveLeadText =
    delayMin !== 0 && (isBoardedLeg || scheduledDeparture != null)
      ? leg.delayConfidence === 'estimated'
        ? t.routeDetails.estimatedDelay(delayMin)
        : delayMin > 0
          ? t.routeDetails.late(delayMin)
          : t.routeDetails.early(-delayMin)
      : leg.live
        ? notice || t.routeDetails.onTime
        : notice;

  const collapsedVehicleLabel =
    livePosition?.marker?.placement === 'between' &&
    stops[livePosition.marker.index] &&
    stops[livePosition.marker.index + 1]
      ? t.leg.vehicleBetween(
          genericModeGen(t, leg.mode),
          stops[livePosition.marker.index].name,
          stops[livePosition.marker.index + 1].name,
        )
      : t.leg.nearStop(
          genericModeNom(t, leg.mode),
          nearestStop?.name ?? leg.liveNextStop ?? leg.fromStop,
        );

  return (
    <View style={s.card}>
      {/* 1. Wiersz odjazdu: godzina | węzeł startowy | stacja, peron/słupek, podpowiedź */}
      <View style={s.gridRow}>
        <View style={s.endpointTimeCol}>
          <Text style={s.endpointTime} numberOfLines={1}>
            {boardedDepartAt ?? leg.departAt}
          </Text>
          {delayMin !== 0 && !isBoardedLeg && scheduledDeparture != null ? (
            <Text style={s.scheduledStrike} numberOfLines={1}>
              {secondsToTimeString(scheduledDeparture)}
            </Text>
          ) : null}
        </View>

        <View style={s.railCol}>
          <View
            style={[
              s.departureNode,
              { borderColor: departurePassed ? scheme.outline : railStroke },
            ]}
          />
          <View style={[s.departureSpine, { backgroundColor: departureSpineColor }]} />
        </View>

        <View style={s.departureContentCol}>
          <Text style={s.endpointTitle}>
            {isBoardedLeg ? t.home.boardedInVehicle : leg.fromStop}
          </Text>

          {!isBoardedLeg && departurePlatform ? (
            <View style={s.platformBadge}>
              <Text style={s.platformBadgeText}>{departurePlatform}</Text>
            </View>
          ) : null}

          {!isBoardedLeg && showFromEntrance && leg.fromEntrance ? (
            <MetroEntranceBlock t={t} kind="entrance" entrance={leg.fromEntrance} />
          ) : null}

          {stopHint ? (
            <View style={s.stopHintBox}>
              <MapPin size={14} color={scheme.primary} style={s.stopHintIcon} />
              <Text style={s.stopHintText}>{stopHint}</Text>
            </View>
          ) : null}
        </View>
      </View>

      {/* 2. Wiersz środka: czas przejazdu | ciągła szyna (lub marker w zwinięciu) | linia, udogodnienia, live, przełącznik */}
      <View style={s.gridRow}>
        <View style={s.durationCol}>
          <Text style={s.durationText} numberOfLines={1}>
            {t.common.durMin(durationMin)}
          </Text>
        </View>

        <View style={s.railCol}>
          {!expanded && isInTransitOnLeg ? (
            <>
              <View style={[s.railHalfTop, { backgroundColor: scheme.outlineVariant }]} />
              <View
                accessible
                accessibilityRole="image"
                accessibilityLabel={collapsedVehicleLabel}
                style={[s.vehicleSquircle, { backgroundColor: badgeBg }]}
              >
                <VehicleGlyph mode={leg.mode} color={badgeFg} />
              </View>
              <View style={[s.railHalfBottom, { backgroundColor: railStroke }]} />
            </>
          ) : (
            <View
              style={[
                s.railContinuous,
                {
                  backgroundColor:
                    expanded && departurePassed
                      ? scheme.outlineVariant
                      : legCompleted
                        ? scheme.outlineVariant
                        : railStroke,
                },
              ]}
            />
          )}
        </View>

        <View style={s.bodyContentCol}>
          {/* Karta linii / pociągu z przejściem do rozkładu i parametrami konkretnego pojazdu */}
          {canOpenLine ? (
            <Pressable
              onPress={openLineTimetable}
              accessibilityRole="button"
              accessibilityLabel={lineCardA11y}
              style={({ pressed }) => [
                s.lineCard,
                vehicleSpecs && s.lineCardWithSpecs,
                pressed && s.lineCardPressed,
              ]}
            >
              <View style={[s.lineCardHeader, vehicleSpecs && s.lineCardHeaderWithSpecs]}>
                <LineBadge leg={leg} />
                <View style={s.lineTextCol}>
                  {directionLabel ? (
                    <Text style={s.lineDirection} numberOfLines={1}>
                      {directionLabel}
                    </Text>
                  ) : null}
                  {agencySubtitle ? (
                    <Text style={s.lineAgencySub} numberOfLines={1}>
                      {agencySubtitle}
                    </Text>
                  ) : null}
                </View>
                <ChevronRight size={18} color={scheme.onSurfaceVariant} />
              </View>
              {vehicleSpecs ? <VehicleSpecsStrip specs={vehicleSpecs} mode={leg.mode} /> : null}
            </Pressable>
          ) : (
            <View style={[s.lineCard, vehicleSpecs && s.lineCardWithSpecs]}>
              <View style={[s.lineCardHeader, vehicleSpecs && s.lineCardHeaderWithSpecs]}>
                <LineBadge leg={leg} />
                <View style={s.lineTextCol}>
                  {directionLabel ? (
                    <Text style={s.lineDirection} numberOfLines={1}>
                      {directionLabel}
                    </Text>
                  ) : null}
                  {agencySubtitle ? (
                    <Text style={s.lineAgencySub} numberOfLines={1}>
                      {agencySubtitle}
                    </Text>
                  ) : null}
                </View>
              </View>
              {vehicleSpecs ? <VehicleSpecsStrip specs={vehicleSpecs} mode={leg.mode} /> : null}
            </View>
          )}

          {/* Udogodnienia składu (kolej, tylko gdy vagonweb zwróci realne dane) */}
          {isTrain ? (
            <RailAmenities
              tripId={leg.tripId}
              agency={leg.railAgency}
              trainNumber={leg.trainNumber}
              line={leg.line}
              trainName={leg.trainName}
              showLabel
            />
          ) : null}

          {/* Baner statusu na żywo / opóźnienia / wiarygodności */}
          {showLiveBanner ? (
            <View style={s.liveBanner}>
              <View style={s.liveIconWrap}>
                {leg.live ? (
                  <LiveSensors color={liveStatusColor} size={15} pingKey={pingKey} />
                ) : (
                  <TriangleAlert size={15} color={liveStatusColor} />
                )}
              </View>
              <Text style={s.liveBannerText}>
                {liveLeadText ? (
                  <Text style={[s.liveLeadBold, { color: liveStatusColor }]}>{liveLeadText}</Text>
                ) : null}
                {livePositionDetail ? (
                  <Text style={s.liveInlineMuted}>
                    {`${liveLeadText ? ' \u00b7 ' : ''}${livePositionDetail}`}
                  </Text>
                ) : null}
                {leg.live && liveTimestamp ? <LiveDataAgeInline timestamp={liveTimestamp} /> : null}
              </Text>
            </View>
          ) : null}

          {/* Przycisk rozwijania listy stacji / przystanków pośrednich */}
          {intermediateStats.hasExpandable ? (
            <Pressable
              onPress={handleToggleStops}
              accessibilityRole="button"
              accessibilityState={{ expanded }}
              accessibilityLabel={[
                isTrain
                  ? t.leg.expandStationsA11y(leg.line ?? '', leg.direction ?? '', expanded)
                  : t.leg.expandA11y(leg.line ?? '', leg.direction ?? '', expanded),
                notice,
              ]
                .filter(Boolean)
                .join('. ')}
              style={({ pressed }) => [
                s.stopsToggleBtn,
                expanded && s.stopsToggleBtnExpanded,
                pressed && s.stopsToggleBtnPressed,
              ]}
            >
              <Text
                style={[s.stopsToggleText, expanded && s.stopsToggleTextExpanded]}
                numberOfLines={1}
              >
                {isTrain
                  ? t.leg.intermediateStationsCount(intermediateStats.count)
                  : t.leg.intermediateStopsCount(intermediateStats.count)}
              </Text>
              <Animated.View style={chevronStyle}>
                <ChevronDown
                  size={18}
                  color={expanded ? scheme.onSecondaryContainer : scheme.onSurfaceVariant}
                />
              </Animated.View>
            </Pressable>
          ) : (
            <View style={s.directRideRow}>
              <Text style={s.directRideText}>
                {isTrain ? t.leg.noIntermediateStations : t.leg.noIntermediateStops}
              </Text>
            </View>
          )}
        </View>
      </View>

      {/* 3. Rozwijana taca stacji / przystanków pośrednich na pełnej szerokości 3 kolumn */}
      {intermediateStats.hasExpandable ? (
        <Animated.View
          pointerEvents={expanded ? 'auto' : 'none'}
          style={[s.trayAnimClip, stopsAnimStyle]}
          accessibilityElementsHidden={!expanded}
          importantForAccessibility={expanded ? 'auto' : 'no-hide-descendants'}
        >
          {expanded || hasExpanded ? (
            <View
              style={s.trayMeasuredWrap}
              onLayout={(e) => {
                const h = Math.round(e.nativeEvent.layout.height);
                if (h > 0 && Math.abs(h - measuredHeight.value) > 1) {
                  measuredHeight.value = h;
                  if (expanded) {
                    stopsHeightAnim.value = withTiming(h, motion.state);
                  }
                }
              }}
            >
              <LegStopsTray
                leg={leg}
                stops={stops}
                segment={segment}
                isTrain={isTrain}
                railStroke={railStroke}
                badgeBg={badgeBg}
                badgeFg={badgeFg}
                livePosition={livePosition}
                loading={loading}
                delayShiftSec={delayShiftSec}
                entrySpineColor={trayEntrySpineColor}
                exitSpineColor={arrivalTopSpineColor}
              />
            </View>
          ) : null}
        </Animated.View>
      ) : null}

      {/* 4. Wiersz przyjazdu: godzina | pełny węzeł końcowy | stacja, peron, udogodnienia dworca */}
      <View style={s.gridRow}>
        <View style={s.endpointTimeCol}>
          <Text style={s.endpointTime} numberOfLines={1}>
            {leg.arriveAt}
          </Text>
          {arrivalDelayMin !== 0 && arrivalDelayMin !== delayMin ? (
            <Text
              style={[
                s.arrivalDelayCaption,
                { color: arrivalDelayMin > 0 ? scheme.error : scheme.warning },
              ]}
              numberOfLines={1}
            >
              {arrivalDelayMin > 0 ? `+${arrivalDelayMin} min` : `${arrivalDelayMin} min`}
            </Text>
          ) : null}
        </View>

        <View style={s.railCol}>
          <View style={[s.arrivalSpine, { backgroundColor: arrivalTopSpineColor }]} />
          <View style={[s.arrivalNode, { backgroundColor: railStroke }]} />
        </View>

        <View style={s.arrivalContentCol}>
          <Text style={s.endpointTitle}>{leg.toStop}</Text>
          {arrivalPlatform || doorSide ? (
            <View style={s.arrivalMetaRow}>
              {arrivalPlatform ? (
                <View style={s.platformBadge}>
                  <Text style={s.platformBadgeText}>{arrivalPlatform}</Text>
                </View>
              ) : null}
              {doorSide ? (
                <View
                  style={s.doorSideHint}
                  accessible
                  accessibilityLabel={
                    doorSide === 'left' ? t.doorSide.leftA11y : t.doorSide.rightA11y
                  }
                >
                  {doorSide === 'left' ? (
                    <ChevronLeft size={12} color={scheme.onSurfaceVariant} />
                  ) : null}
                  <Text style={s.doorSideText} numberOfLines={1}>
                    {doorSide === 'left' ? t.doorSide.left : t.doorSide.right}
                  </Text>
                  {doorSide === 'right' ? (
                    <ChevronRight size={12} color={scheme.onSurfaceVariant} />
                  ) : null}
                </View>
              ) : null}
            </View>
          ) : null}
          {showToEntrance && leg.toEntrance ? (
            <MetroEntranceBlock t={t} kind="exit" entrance={leg.toEntrance} />
          ) : null}
          {showStationAmenities ? (
            <StationAmenities stopId={leg.toStopId} lat={leg.toLat} lon={leg.toLon} showLabel />
          ) : null}
        </View>
      </View>
    </View>
  );
});

const DAY = 86400;

/** Czy teraz wypada odcinek pieszy: tylko wtedy GPS ma chodzić na High/1 Hz. */
function isWalkingNow(legs: Leg[], nowSec: number): boolean {
  for (const leg of legs) {
    if (leg.mode !== 'walk') continue;
    const depart = leg.scheduledDepartureSec ?? timeStringToSeconds(leg.departAt);
    let arrive = leg.scheduledArrivalSec ?? timeStringToSeconds(leg.arriveAt);
    if (arrive < depart) arrive += DAY;
    const current = depart >= DAY && nowSec < 43200 ? nowSec + DAY : nowSec;
    if (current >= depart - 120 && current <= arrive + 120) return true;
  }
  return false;
}

/** Pionowa oś podróży M3 Expressive z kartami przejazdu i łącznikami pieszymi / przesiadkami. */
export function LegTimeline({
  legs,
  observeOnly = false,
  boardedDepartAt,
}: {
  legs: Leg[];
  observeOnly?: boolean;
  boardedDepartAt?: string;
}) {
  const t = useStrings();
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [walking, setWalking] = useState(() => isWalkingNow(legs, nowSecOfDay()));
  const walkMps = useWalkSpeedMps();
  const { location } = useCurrentLocation(!observeOnly, !observeOnly && walking);

  useEffect(() => {
    const update = () => setWalking(isWalkingNow(legs, nowSecOfDay()));
    update();
    const timer = setInterval(update, 15000);
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') update();
    });
    return () => {
      clearInterval(timer);
      sub.remove();
    };
  }, [legs]);

  const toggleLeg = useCallback(
    (id: string) => setExpandedId((prev) => (prev === id ? null : id)),
    [],
  );

  const displayLegs = useMemo(
    () =>
      legs.length > 1
        ? legs.filter(
            (leg) =>
              !(
                leg.mode === 'walk' &&
                (leg.walkM ?? 0) <= 0 &&
                (leg.departAt === leg.arriveAt || leg.fromStop === leg.toStop)
              ),
          )
        : legs,
    [legs],
  );

  const firstTransitId = boardedDepartAt
    ? displayLegs.find((l) => l.mode !== 'walk')?.id
    : undefined;

  return (
    <View style={s.list}>
      {displayLegs.map((leg, i) => {
        if (leg.mode === 'walk') {
          const walkMin = walkMinutesFor(leg.walkM ?? 200, walkMps);
          const isSameStop =
            normalizeName(leg.fromStop) === normalizeName(leg.toStop) ||
            leg.fromStop.trim().toLowerCase() === leg.toStop.trim().toLowerCase();
          const prevLeg = displayLegs[i - 1];
          const nextLeg = displayLegs[i + 1];
          const isTransferWalk =
            prevLeg != null &&
            prevLeg.mode !== 'walk' &&
            nextLeg != null &&
            nextLeg.mode !== 'walk';
          const isRailTransfer = isTransferWalk && isTrainLeg(prevLeg) && isTrainLeg(nextLeg);

          let transferWaitMin: number | null = null;
          if (isTransferWalk) {
            let gap =
              timeStringToSeconds(nextLeg.departAt) - timeStringToSeconds(prevLeg.arriveAt);
            if (gap < -43200) gap += 86400;
            if (gap > 0 && gap < 14400) {
              transferWaitMin = Math.round(gap / 60);
            }
          }

          const durationLabel =
            transferWaitMin != null ? t.common.durMin(transferWaitMin) : formatWalkTime(walkMin);

          const headline = isRailTransfer
            ? t.leg.stationTransfer
            : isTransferWalk
              ? leg.walkM && leg.walkM > 0
                ? `${t.leg.transfer} \u00b7 ${t.leg.transferWalkMeters(Math.round(leg.walkM))}`
                : t.leg.transfer
              : leg.walkM && leg.walkM > 0
                ? `${t.leg.walkStep} \u00b7 ${Math.round(leg.walkM)} m`
                : t.leg.walkStep;

          const railWalkSub =
            isRailTransfer && leg.walkM && leg.walkM > 0
              ? t.leg.transferWalkMeters(Math.round(leg.walkM))
              : null;

          return (
            <View key={leg.id} style={s.connectorRow}>
              <View style={s.connectorTimeCol}>
                <Text style={s.connectorTimeText} numberOfLines={1}>
                  {durationLabel}
                </Text>
              </View>

              <View style={s.railCol}>
                <View style={s.connectorTick} />
                <View style={s.walkIconBadge}>
                  <Footprints size={14} color={scheme.onSecondaryContainer} />
                </View>
                <View style={s.connectorTick} />
              </View>

              <View style={s.connectorContentCol}>
                <Text style={s.connectorTitle} numberOfLines={2}>
                  {headline}
                </Text>
                {railWalkSub ? (
                  <Text style={s.connectorSub} numberOfLines={1}>
                    {railWalkSub}
                  </Text>
                ) : !isTransferWalk ? (
                  isSameStop ? (
                    <Text style={s.connectorSub} numberOfLines={1}>
                      {leg.fromStop}
                    </Text>
                  ) : isFallbackOrigin(leg.fromStop) ? (
                    <Text style={s.connectorSub} numberOfLines={1}>
                      {t.connection.walkTo(leg.toStop)}
                    </Text>
                  ) : (
                    <View style={s.connectorSubRow}>
                      <Text style={s.connectorSub} numberOfLines={1}>
                        {leg.fromStop}
                      </Text>
                      <ArrowRight size={11} color={scheme.onSurfaceVariant} />
                      <Text style={s.connectorSub} numberOfLines={1}>
                        {leg.toStop}
                      </Text>
                    </View>
                  )
                ) : !isSameStop ? (
                  <View style={s.connectorSubRow}>
                    <Text style={s.connectorSub} numberOfLines={1}>
                      {leg.fromStop}
                    </Text>
                    <ArrowRight size={11} color={scheme.onSurfaceVariant} />
                    <Text style={s.connectorSub} numberOfLines={1}>
                      {leg.toStop}
                    </Text>
                  </View>
                ) : null}
                {leg.fromEntrance ? (
                  <MetroEntranceBlock t={t} kind="exit" entrance={leg.fromEntrance} compactMargin />
                ) : null}
                {leg.toEntrance ? (
                  <MetroEntranceBlock t={t} kind="entrance" entrance={leg.toEntrance} compactMargin />
                ) : null}
              </View>
            </View>
          );
        }

        const nextVehicle = displayLegs.slice(i + 1).find((next) => next.mode !== 'walk');
        let transferGap = nextVehicle
          ? timeStringToSeconds(nextVehicle.departAt) - timeStringToSeconds(leg.arriveAt)
          : Infinity;
        if (transferGap < -43200) transferGap += 86400;
        const uncertainTransfer =
          (leg.delayConfidence === 'estimated' || leg.delayConfidence === 'untracked') &&
          transferGap < 360;
        const hasNextLeg = i < displayLegs.length - 1;
        const nextLeg = hasNextLeg ? displayLegs[i + 1] : null;
        const nextLegIsTransit = nextLeg != null && nextLeg.mode !== 'walk';
        const prevDisplayedLeg = i > 0 ? displayLegs[i - 1] : null;
        const showFromEntrance = Boolean(
          leg.fromEntrance &&
            (!prevDisplayedLeg || prevDisplayedLeg.mode !== 'walk' || !prevDisplayedLeg.toEntrance),
        );
        const showToEntrance = Boolean(
          leg.toEntrance &&
            (!nextLeg || nextLeg.mode !== 'walk' || !nextLeg.fromEntrance),
        );
        const showStationAmenities = shouldShowStationAmenities(displayLegs, i, walkMps);
        const isRailImplicitTransfer =
          nextLegIsTransit && isTrainLeg(leg) && isTrainLeg(nextLeg);

        const nextPlatform =
          nextLegIsTransit && nextLeg.platformCode
            ? formatPlatformLabel(t, nextLeg.platformCode, nextLeg.mode, nextLeg.fromStop, nextLeg.trackCode)
            : null;

        return (
          <View key={leg.id} style={s.cardContainer}>
            <TransitLegCard
              leg={leg}
              expanded={expandedId === leg.id}
              userLocation={observeOnly || expandedId !== leg.id ? null : location}
              allowLive={!observeOnly || leg.live}
              boardedDepartAt={leg.id === firstTransitId ? boardedDepartAt : undefined}
              showStationAmenities={showStationAmenities}
              showFromEntrance={showFromEntrance}
              showToEntrance={showToEntrance}
              onToggle={toggleLeg}
            />

            {uncertainTransfer ? (
              <View style={s.uncertainBanner}>
                <TriangleAlert size={16} color={scheme.onWarningContainer} />
                <Text style={s.uncertainText}>{t.routeDetails.uncertainTransfer}</Text>
              </View>
            ) : null}

            {nextLegIsTransit ? (
              <View style={s.connectorRow}>
                <View style={s.connectorTimeCol}>
                  {transferGap > 0 && transferGap < 14400 ? (
                    <Text style={s.connectorTimeText} numberOfLines={1}>
                      {t.common.durMin(Math.round(transferGap / 60))}
                    </Text>
                  ) : null}
                </View>

                <View style={s.railCol}>
                  <View style={s.connectorTick} />
                  <View style={s.walkIconBadge}>
                    <Footprints size={14} color={scheme.onSecondaryContainer} />
                  </View>
                  <View style={s.connectorTick} />
                </View>

                <View style={s.connectorContentCol}>
                  <Text style={s.connectorTitle} numberOfLines={2}>
                    {isRailImplicitTransfer ? t.leg.stationTransfer : t.leg.transfer}
                  </Text>
                  {nextPlatform ? (
                    <Text style={s.connectorSub} numberOfLines={1}>
                      {`${t.leg.toPrefix}${nextPlatform}`}
                    </Text>
                  ) : null}
                </View>
              </View>
            ) : null}
          </View>
        );
      })}
    </View>
  );
}

const s = StyleSheet.create({
  list: {
    gap: 10,
  },
  cardContainer: {
    width: '100%',
    gap: 10,
  },
  card: {
    width: '100%',
    backgroundColor: scheme.surfaceContainer,
    borderRadius: shape.extraLarge,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: scheme.outlineVariant,
    paddingHorizontal: CARD_PAD_H,
    paddingVertical: 16,
    ...elev.level1,
  },
  gridRow: {
    flexDirection: 'row',
    alignItems: 'stretch',
    gap: COL_GAP,
  },
  timeCol: {
    width: TIME_COL_W,
    alignItems: 'flex-end',
    flexShrink: 0,
  },
  endpointTimeCol: {
    width: TIME_COL_W,
    alignItems: 'flex-end',
    flexShrink: 0,
    gap: 2,
  },
  endpointTime: {
    fontSize: 17.5,
    lineHeight: 22,
    fontWeight: '800',
    letterSpacing: -0.4,
    color: scheme.onSurface,
    fontVariant: ['tabular-nums'],
  },
  scheduledStrike: {
    fontSize: 11,
    lineHeight: 14,
    fontWeight: '600',
    color: scheme.onSurfaceVariant,
    textDecorationLine: 'line-through',
    fontVariant: ['tabular-nums'],
  },
  arrivalDelayCaption: {
    fontSize: 11,
    lineHeight: 14,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  durationCol: {
    width: TIME_COL_W,
    alignItems: 'flex-end',
    paddingTop: 16,
    flexShrink: 0,
  },
  durationText: {
    fontSize: 11.5,
    lineHeight: 15,
    fontWeight: '600',
    color: scheme.onSurfaceVariant,
    fontVariant: ['tabular-nums'],
  },
  railCol: {
    width: RAIL_COL_W,
    alignItems: 'center',
    flexShrink: 0,
  },
  departureNode: {
    width: 12,
    height: 12,
    borderRadius: shape.full,
    borderWidth: 2.5,
    backgroundColor: scheme.surfaceContainer,
    marginTop: 5,
    zIndex: 2,
  },
  departureSpine: {
    position: 'absolute',
    top: 17,
    bottom: 0,
    width: SPINE_W,
  },
  arrivalSpine: {
    position: 'absolute',
    top: 0,
    height: 11,
    width: SPINE_W,
  },
  arrivalNode: {
    width: 12,
    height: 12,
    borderRadius: shape.full,
    marginTop: 5,
    zIndex: 2,
  },
  railContinuous: {
    flex: 1,
    width: SPINE_W,
  },
  railHalfTop: {
    flex: 1,
    width: SPINE_W,
    minHeight: 8,
  },
  railHalfBottom: {
    flex: 1,
    width: SPINE_W,
    minHeight: 8,
  },
  vehicleSquircle: {
    width: 24,
    height: 24,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 3,
  },
  passedStopDot: {
    width: 7,
    height: 7,
    borderRadius: shape.full,
    backgroundColor: scheme.outline,
    zIndex: 2,
  },
  upcomingStopRing: {
    width: 10,
    height: 10,
    borderRadius: shape.full,
    borderWidth: 2.5,
    backgroundColor: scheme.surfaceContainerLow,
    zIndex: 2,
  },
  departureContentCol: {
    flex: 1,
    minWidth: 0,
    gap: 6,
    paddingBottom: 12,
  },
  arrivalContentCol: {
    flex: 1,
    minWidth: 0,
    gap: 6,
  },
  endpointTitle: {
    fontSize: 18,
    lineHeight: 22,
    fontWeight: '800',
    letterSpacing: -0.3,
    color: scheme.onSurface,
  },
  platformBadge: {
    alignSelf: 'flex-start',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: shape.small,
    backgroundColor: scheme.secondaryContainer,
  },
  platformBadgeText: {
    ...type.labelSmall,
    fontSize: 11.5,
    lineHeight: 15,
    fontWeight: '700',
    color: scheme.onSecondaryContainer,
  },
  arrivalMetaRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    columnGap: 8,
    rowGap: 4,
  },
  doorSideHint: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
  },
  doorSideText: {
    ...type.labelSmall,
    fontSize: 11.5,
    lineHeight: 15,
    fontWeight: '500',
    color: scheme.onSurfaceVariant,
  },
  stopHintBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 7,
    backgroundColor: scheme.surfaceContainerLow,
    borderRadius: 14,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  stopHintIcon: {
    marginTop: 2,
  },
  stopHintText: {
    ...type.bodySmall,
    flex: 1,
    fontSize: 12.5,
    lineHeight: 17.5,
    color: scheme.onSurfaceVariant,
  },
  bodyContentCol: {
    flex: 1,
    minWidth: 0,
    gap: 8,
    paddingBottom: 10,
  },
  lineCard: {
    justifyContent: 'center',
    minHeight: 48,
    backgroundColor: scheme.surfaceContainerHigh,
    borderRadius: shape.large,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  lineCardWithSpecs: {
    padding: 6,
    gap: 6,
  },
  lineCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    minHeight: 32,
  },
  lineCardHeaderWithSpecs: {
    paddingHorizontal: 4,
    paddingTop: 2,
  },
  lineCardPressed: {
    opacity: 0.78,
  },
  lineTextCol: {
    flex: 1,
    minWidth: 0,
    gap: 1,
  },
  lineDirection: {
    ...type.titleSmall,
    fontSize: 14.5,
    lineHeight: 19,
    fontWeight: '700',
    color: scheme.onSurface,
  },
  lineAgencySub: {
    ...type.bodySmall,
    fontSize: 12,
    lineHeight: 16,
    color: scheme.onSurfaceVariant,
  },
  liveBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: scheme.surfaceContainerLow,
    borderRadius: 14,
    paddingHorizontal: 10,
    paddingVertical: 9,
  },
  liveIconWrap: {
    width: 18,
    height: 18,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  liveBannerText: {
    ...type.bodySmall,
    flex: 1,
    fontSize: 12.5,
    lineHeight: 17.5,
    color: scheme.onSurfaceVariant,
  },
  liveLeadBold: {
    fontWeight: '700',
  },
  liveInlineMuted: {
    color: scheme.onSurfaceVariant,
    fontWeight: '500',
    fontVariant: ['tabular-nums'],
  },
  stopsToggleBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    minHeight: 44,
    backgroundColor: scheme.surfaceContainerHigh,
    borderRadius: shape.full,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  stopsToggleBtnExpanded: {
    backgroundColor: scheme.secondaryContainer,
  },
  stopsToggleBtnPressed: {
    opacity: 0.82,
  },
  stopsToggleText: {
    ...type.labelLarge,
    fontSize: 13,
    lineHeight: 17,
    fontWeight: '700',
    color: scheme.onSurface,
    flexShrink: 1,
  },
  stopsToggleTextExpanded: {
    color: scheme.onSecondaryContainer,
  },
  directRideRow: {
    paddingVertical: 4,
    paddingHorizontal: 2,
  },
  directRideText: {
    ...type.bodySmall,
    fontSize: 12,
    fontWeight: '600',
    color: scheme.onSurfaceVariant,
  },
  trayAnimClip: {
    marginHorizontal: -TRAY_BLEED,
    overflow: 'hidden',
  },
  trayMeasuredWrap: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
  },
  trayOuter: {
    width: '100%',
  },
  trayCard: {
    backgroundColor: scheme.surfaceContainerLow,
    borderRadius: 18,
    borderWidth: TRAY_BORDER_W,
    borderColor: scheme.outlineVariant,
    paddingHorizontal: TRAY_BLEED - TRAY_BORDER_W,
  },
  trayCapRow: {
    flexDirection: 'row',
    alignItems: 'stretch',
    gap: COL_GAP,
    height: 8,
  },
  trayFooterConnector: {
    flexDirection: 'row',
    alignItems: 'stretch',
    gap: COL_GAP,
    height: 10,
    paddingHorizontal: TRAY_BLEED,
  },
  capSpacer: {
    flex: 1,
  },
  stopGridRow: {
    flexDirection: 'row',
    alignItems: 'stretch',
    gap: COL_GAP,
    minHeight: 44,
  },
  stopTimeCol: {
    width: TIME_COL_W,
    alignItems: 'flex-end',
    justifyContent: 'center',
    paddingVertical: 7,
    flexShrink: 0,
  },
  stopTimeSingle: {
    fontSize: 12.5,
    lineHeight: 16,
    fontWeight: '700',
    color: scheme.onSurface,
    fontVariant: ['tabular-nums'],
  },
  stopTimePrimary: {
    fontSize: 12,
    lineHeight: 15,
    fontWeight: '700',
    color: scheme.onSurface,
    fontVariant: ['tabular-nums'],
  },
  stopTimeSecondary: {
    fontSize: 11,
    lineHeight: 14,
    fontWeight: '500',
    color: scheme.onSurfaceVariant,
    fontVariant: ['tabular-nums'],
  },
  stopTimePassed: {
    color: scheme.onSurfaceVariant,
    fontWeight: '500',
  },
  stopContentCol: {
    flex: 1,
    minWidth: 0,
    justifyContent: 'center',
    paddingVertical: 8,
    paddingRight: 6,
    gap: 2,
  },
  stopName: {
    ...type.bodyMedium,
    fontSize: 14,
    lineHeight: 19,
    fontWeight: '700',
    color: scheme.onSurface,
  },
  stopNamePassed: {
    color: scheme.onSurfaceVariant,
    fontWeight: '500',
  },
  stopNameActive: {
    color: scheme.onSurface,
    fontWeight: '800',
  },
  stopMeta: {
    ...type.bodySmall,
    fontSize: 12,
    lineHeight: 16,
    color: scheme.onSurfaceVariant,
  },
  atStopPill: {
    alignSelf: 'flex-start',
    marginTop: 3,
    backgroundColor: scheme.primaryContainer,
    borderRadius: shape.full,
    paddingHorizontal: 9,
    paddingVertical: 2.5,
  },
  atStopPillText: {
    ...type.labelSmall,
    fontSize: 11,
    fontWeight: '700',
    color: scheme.onPrimaryContainer,
  },
  inTransitRow: {
    flexDirection: 'row',
    alignItems: 'stretch',
    gap: COL_GAP,
    minHeight: 38,
  },
  inTransitContent: {
    flex: 1,
    minWidth: 0,
    justifyContent: 'center',
    paddingVertical: 5,
    paddingRight: 6,
  },
  inTransitPill: {
    alignSelf: 'flex-start',
    maxWidth: '100%',
    backgroundColor: scheme.primaryContainer,
    borderRadius: shape.full,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  inTransitPillText: {
    ...type.labelSmall,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '700',
    color: scheme.onPrimaryContainer,
  },
  boundaryChip: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderRadius: shape.medium,
    backgroundColor: scheme.secondaryContainer,
  },
  boundaryText: {
    flex: 1,
    gap: 1,
  },
  boundaryTitle: {
    ...type.labelMedium,
    color: scheme.onSecondaryContainer,
    fontWeight: '700',
  },
  boundaryDetail: {
    ...type.bodySmall,
    color: scheme.onSecondaryContainer,
    lineHeight: 16,
  },
  skeletonBar: {
    height: 11,
    borderRadius: shape.full,
    backgroundColor: scheme.surfaceContainerHigh,
  },
  uncertainBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: scheme.warningContainer,
    borderRadius: shape.large,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  uncertainText: {
    ...type.bodySmall,
    flex: 1,
    fontSize: 12.5,
    lineHeight: 17,
    fontWeight: '700',
    color: scheme.onWarningContainer,
  },
  connectorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: COL_GAP,
    paddingHorizontal: CARD_PAD_H,
  },
  connectorTimeCol: {
    width: TIME_COL_W,
    alignItems: 'flex-end',
    flexShrink: 0,
  },
  connectorTimeText: {
    fontSize: 12.5,
    lineHeight: 16,
    fontWeight: '700',
    color: scheme.onSurfaceVariant,
    fontVariant: ['tabular-nums'],
  },
  connectorTick: {
    width: 2,
    height: 8,
    backgroundColor: scheme.outlineVariant,
    borderRadius: 1,
  },
  walkIconBadge: {
    width: 28,
    height: 28,
    borderRadius: shape.full,
    backgroundColor: scheme.secondaryContainer,
    alignItems: 'center',
    justifyContent: 'center',
    marginVertical: 2,
  },
  entranceLegWrap: {
    gap: 6,
  },
  entranceConnectorWrap: {
    gap: 6,
    marginTop: 6,
  },
  connectorContentCol: {
    flex: 1,
    minWidth: 0,
    gap: 2,
    paddingVertical: 4,
  },
  connectorTitle: {
    ...type.labelLarge,
    fontSize: 13.5,
    lineHeight: 18,
    fontWeight: '700',
    color: scheme.onSurface,
  },
  connectorSubRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    flexWrap: 'wrap',
  },
  connectorSub: {
    ...type.bodySmall,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '500',
    color: scheme.onSurfaceVariant,
    flexShrink: 1,
  },
});
