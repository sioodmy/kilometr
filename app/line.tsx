import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AppState,
  FlatList,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import Animated, {
  interpolate,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  AlertCircle,
  ArrowRight,
  ArrowUpDown,
  Check,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Maximize2,
  RefreshCw,
  RouteOff,
  Ticket,
} from '../src/components/icons';
import { LineBadge, resolveLegBadgeColors } from '../src/components/LineBadge';
import { MorphingLoader } from '../src/components/MorphingLoader';
import { SpringPressable } from '../src/components/SpringPressable';
import { StopDeparturesSheet } from '../src/components/StopDeparturesSheet';
import { TimetableDeparturesView } from '../src/components/TimetableDeparturesView';
import { getLocaleSync, useStrings } from '../src/i18n';
import { isFareBoundary, parseFareBoundary } from '../src/gtfs/fareBoundary';
import {
  countPhysicalLineStops,
  findNextDeparture,
  firstPhysicalStopIndex,
  lastPhysicalStopIndex,
  findTripSegment,
  formatTimetableDateCompact,
  parseClockToSeconds,
  physicalStopOrdinal,
  selectInitialPattern,
  shiftTimetableDate,
  stepPhysicalStopIndex,
  timetableClock,
  timetableToday,
  type LineStop,
} from '../src/services/lineTimetable';
import { useLineTimetable } from '../src/services/useLineTimetable';
import { resolveRailStrokeColor } from '../src/theme/colorContrast';
import { useWebLayout } from '../src/theme/layout';
import { motion } from '../src/theme/motion';
import { elev, scheme, shape, type } from '../src/theme/tokens';
import type { LegMode } from '../src/types/models';

const RAIL_COL_W = 28;
const SPINE_W = 3;

/** Zwraca aktualny czas dnia w sekundach w strefie Europe/Warsaw (zgodny z GTFS). */
function nowSecondsInWarsaw(): number {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Warsaw',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(new Date());
  const h = Number(parts.find((p) => p.type === 'hour')?.value ?? 0);
  const m = Number(parts.find((p) => p.type === 'minute')?.value ?? 0);
  const s = Number(parts.find((p) => p.type === 'second')?.value ?? 0);
  return (h % 24) * 3600 + m * 60 + s;
}

/** Ekran rozkładu linii spójny wizualnie i ruchowo ze szczegółami połączenia. */
export default function LineScreen() {
  const {
    routeId,
    direction,
    line,
    mode,
    tripId,
    fromStopId,
    toStopId,
    fromStop,
    toStop,
    dbTarget,
    fromY: fromYParam,
    departAt,
    arriveAt,
  } = useLocalSearchParams<{
    routeId?: string;
    direction?: string;
    line?: string;
    mode?: string;
    tripId?: string;
    fromStopId?: string;
    toStopId?: string;
    fromStop?: string;
    toStop?: string;
    dbTarget?: string;
    fromY?: string;
    departAt?: string;
    arriveAt?: string;
  }>();

  const router = useRouter();
  const s = useStrings();
  const t = s.lineTimetable;
  const insets = useSafeAreaInsets();
  const webLayout = useWebLayout();
  const reduceMotion = useReducedMotion();
  const { width, fontScale } = useWindowDimensions();
  const stackTwoDirections = width / fontScale < 360;

  const [date, setDate] = useState(timetableToday);
  const isToday = date === timetableToday();
  const [nowSec, setNowSec] = useState(nowSecondsInWarsaw);

  useEffect(() => {
    if (!isToday) return;
    setNowSec(nowSecondsInWarsaw());
    const tick = setInterval(() => setNowSec(nowSecondsInWarsaw()), 30_000);
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') setNowSec(nowSecondsInWarsaw());
    });
    return () => {
      clearInterval(tick);
      sub.remove();
    };
  }, [isToday]);

  const { data, loading, error, retry } = useLineTimetable(routeId ?? '', date, {
    tripId,
    line,
    mode: mode as LegMode | undefined,
    dbTarget,
  });

  const [patternId, setPatternId] = useState('');
  const [sheetStopIndex, setSheetStopIndex] = useState<number | null>(null);
  const directionsScrollRef = useRef<ScrollView>(null);
  const scrolledForKeyRef = useRef('');

  useEffect(() => {
    setPatternId('');
    setSheetStopIndex(null);
    scrolledForKeyRef.current = '';
  }, [routeId, direction, tripId, line]);

  const fromY = useMemo(() => {
    if (!fromYParam) return undefined;
    const parsed = Number(fromYParam);
    return Number.isFinite(parsed) ? parsed : undefined;
  }, [fromYParam]);

  // Płynne przejście M3 Expressive z pozycji karty linii w szczegółach połączenia.
  const heroProgress = useSharedValue(reduceMotion ? 1 : 0);
  const heroDeltaY = useSharedValue(fromY != null ? 56 : 16);
  const heroMeasuredRef = useRef(false);
  const heroViewRef = useRef<View>(null);

  useEffect(() => {
    if (reduceMotion) {
      heroProgress.value = 1;
      return;
    }
    if (fromY == null) {
      heroDeltaY.value = 16;
      heroProgress.value = withSpring(1, motion.spring.spatialDefault);
    }
  }, [fromY, heroDeltaY, heroProgress, reduceMotion]);

  const handleHeroLayout = useCallback(() => {
    if (heroMeasuredRef.current || reduceMotion || fromY == null) return;
    heroMeasuredRef.current = true;
    heroViewRef.current?.measureInWindow((_x, y) => {
      const rawDelta = fromY - y;
      heroDeltaY.value = Math.max(-320, Math.min(420, rawDelta));
      heroProgress.value = withSpring(1, motion.spring.spatialDefault);
    });
  }, [fromY, heroDeltaY, heroProgress, reduceMotion]);

  const heroAnimStyle = useAnimatedStyle(() => {
    const p = heroProgress.value;
    return {
      opacity: interpolate(p, [0, 0.45, 1], [0.45, 0.96, 1]),
      transform: [
        { translateY: interpolate(p, [0, 1], [heroDeltaY.value, 0]) },
        { scale: interpolate(p, [0, 1], [0.965, 1]) },
      ],
    };
  });

  const bodyAnimStyle = useAnimatedStyle(() => {
    const p = heroProgress.value;
    return {
      opacity: interpolate(p, [0, 0.3, 1], [0, 0.72, 1]),
      transform: [{ translateY: interpolate(p, [0, 1], [14, 0]) }],
    };
  });

  const matchedPattern = useMemo(
    () =>
      selectInitialPattern(data?.patterns ?? [], {
        direction,
        fromStopId,
        toStopId,
        fromStop,
        toStop,
      }),
    [data?.patterns, direction, fromStopId, toStopId, fromStop, toStop],
  );

  const pattern =
    (patternId ? data?.patterns.find((item) => item.id === patternId) : undefined) ??
    matchedPattern ??
    data?.patterns[0];

  const headsignCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const item of data?.patterns ?? []) {
      counts.set(item.headsign, (counts.get(item.headsign) ?? 0) + 1);
    }
    return counts;
  }, [data?.patterns]);

  const dateCompact = useMemo(
    () => formatTimetableDateCompact(date, getLocaleSync()),
    [date, s],
  );

  const displayLine = data?.line?.shortName ?? line ?? '';
  const displayMode: LegMode =
    data?.line?.mode ?? (mode as LegMode | undefined) ?? 'bus';
  const displayHeadsign = pattern?.headsign ?? direction ?? '';
  const firstPhysicalIdx = useMemo(
    () => (pattern ? firstPhysicalStopIndex(pattern.stops) : -1),
    [pattern],
  );
  const lastPhysicalIdx = useMemo(
    () => (pattern ? lastPhysicalStopIndex(pattern.stops) : -1),
    [pattern],
  );
  const physicalStopsCount = useMemo(
    () => (pattern ? countPhysicalLineStops(pattern.stops) : 0),
    [pattern],
  );
  const originStop = firstPhysicalIdx >= 0 ? pattern?.stops[firstPhysicalIdx] : pattern?.stops[0];

  const railStroke = useMemo(() => {
    if (!displayLine) return scheme.primary;
    const { bg } = resolveLegBadgeColors({ mode: displayMode, line: displayLine });
    return resolveRailStrokeColor(bg, scheme.surfaceContainer);
  }, [displayLine, displayMode]);

  const tripSegment = useMemo(() => {
    if (!pattern) return null;
    return findTripSegment(pattern.stops, {
      fromStopId,
      toStopId,
      fromStop,
      toStop,
    });
  }, [pattern, fromStopId, toStopId, fromStop, toStop]);

  const boardingIndex = tripSegment?.fromIndex ?? -1;
  const alightingIndex = tripSegment?.toIndex ?? -1;
  const hasFullSegment = boardingIndex >= 0 && alightingIndex > boardingIndex;
  const plannedDepartSec = useMemo(() => parseClockToSeconds(departAt), [departAt]);

  // Najbliższy odjazd w karcie głównej (z przystanku wsiadania albo z pętli początkowej).
  const heroReferenceStop = useMemo(() => {
    if (!pattern) return undefined;
    if (boardingIndex >= 0 && boardingIndex < lastPhysicalIdx) {
      return pattern.stops[boardingIndex];
    }
    return firstPhysicalIdx >= 0 ? pattern.stops[firstPhysicalIdx] : pattern.stops[0];
  }, [pattern, boardingIndex, firstPhysicalIdx, lastPhysicalIdx]);

  const heroNextDep = useMemo(
    () =>
      heroReferenceStop
        ? findNextDeparture(heroReferenceStop.departures, nowSec, isToday)
        : null,
    [heroReferenceStop, nowSec, isToday],
  );

  const resolvedRouteId = data?.line?.routeId ?? routeId ?? '';
  const goBack = () => (router.canGoBack() ? router.back() : router.replace('/'));

  const patterns = data?.patterns ?? [];
  const handleCycleDirection = useCallback(() => {
    if (patterns.length < 2 || !pattern) return;
    const idx = patterns.findIndex((item) => item.id === pattern.id);
    const next = patterns[(idx + 1) % patterns.length];
    setPatternId(next.id);
    setSheetStopIndex(null);
  }, [patterns, pattern]);

  const handleOpenFullDepartures = useCallback(
    (index: number) => {
      if (!pattern) return;
      setSheetStopIndex(null);
      router.push({
        pathname: '/line-departures',
        params: {
          routeId: resolvedRouteId,
          date,
          patternId: pattern.id,
          stopIndex: String(index),
          ...(departAt && index === boardingIndex ? { departAt } : {}),
          ...(dbTarget ? { dbTarget } : {}),
        },
      });
    },
    [boardingIndex, date, dbTarget, departAt, pattern, resolvedRouteId, router],
  );

  const hasTripContext = Boolean(fromStop || toStop);
  const stopsData = loading || error ? [] : (pattern?.stops ?? []);
  const desktopStopIndex =
    webLayout.isDesktop && stopsData.length > 0
      ? (sheetStopIndex ??
        (boardingIndex >= 0 && boardingIndex < stopsData.length
          ? boardingIndex
          : firstPhysicalIdx >= 0
            ? firstPhysicalIdx
            : 0))
      : null;

  const renderStopItem = useCallback(
    ({ item, index }: { item: LineStop; index: number }) => {
      const total = pattern?.stops.length ?? 0;
      const isFirstRow = index === 0;
      const isLastRow = index === total - 1;
      const boundary = parseFareBoundary(item.name);
      const isFirst = index === firstPhysicalIdx;
      const isTerminal = index === lastPhysicalIdx;
      const isBoarding = index === boardingIndex;
      const isAlighting = index === alightingIndex;
      const inSegment = hasFullSegment
        ? index >= boardingIndex && index <= alightingIndex
        : true;
      const topRailActive = hasFullSegment
        ? index > boardingIndex && index <= alightingIndex
        : true;
      const bottomRailActive = hasFullSegment
        ? index >= boardingIndex && index < alightingIndex
        : true;

      if (boundary) {
        const lineColor =
          topRailActive && bottomRailActive ? railStroke : scheme.outlineVariant;
        return (
          <View
            style={[
              styles.stopCardSlice,
              isFirstRow && styles.stopCardFirst,
              isLastRow && styles.stopCardLast,
            ]}
            accessibilityRole="text"
          >
            <View style={styles.boundaryRow}>
              <View style={styles.railCol}>
                <View style={[styles.railContinuous, { backgroundColor: lineColor }]} />
              </View>
              <View
                style={[styles.boundaryContentCol, !isFirstRow && styles.stopContentDivider]}
              >
                <View style={styles.boundaryChip}>
                  <Ticket size={14} color={scheme.onSecondaryContainer} />
                  <View style={styles.boundaryText}>
                    <Text style={styles.boundaryTitle}>{s.leg.fareBoundary}</Text>
                    <Text style={styles.boundaryDetail}>
                      {s.leg.fareBoundaryDetail(boundary.areas, boundary.point)}
                    </Text>
                  </View>
                </View>
              </View>
            </View>
          </View>
        );
      }
      const nodeColor = inSegment || isBoarding || isAlighting ? railStroke : scheme.outline;
      const stopNextDep = !isTerminal
        ? findNextDeparture(item.departures, nowSec, isToday)
        : null;
      const highlightedRow = isBoarding || isAlighting;
      const selectedOnDesktop = webLayout.isDesktop && index === desktopStopIndex;
      const rowBg = selectedOnDesktop
        ? scheme.primaryContainer
        : highlightedRow
          ? scheme.surfaceContainerHigh
          : scheme.surfaceContainer;

      const rowA11y = [
        t.selectStop(item.name),
        item.code ? t.stopCode(item.code) : '',
        isBoarding ? t.boardingStop : '',
        isAlighting ? t.alightingStop : '',
        isTerminal
          ? t.terminal
          : stopNextDep
            ? `${timetableClock(stopNextDep.seconds)} (${
                stopNextDep.minutesUntil <= 0
                  ? s.common.departNow
                  : s.common.departIn(stopNextDep.minutesUntil)
              })`
            : item.departures.length > 0
              ? t.departuresCount(item.departures.length)
              : '',
      ]
        .filter(Boolean)
        .join(', ');

      return (
        <View
          style={[
            styles.stopCardSlice,
            isFirstRow && styles.stopCardFirst,
            isLastRow && styles.stopCardLast,
            highlightedRow && styles.stopCardHighlighted,
            selectedOnDesktop && styles.stopCardSelectedDesktop,
          ]}
        >
          <SpringPressable
            onPress={() => setSheetStopIndex(index)}
            haptic="selection"
            scaleDelta={0.012}
            accessibilityRole="button"
            accessibilityLabel={rowA11y}
            style={styles.stopRow}
          >
            <View style={styles.railCol}>
              {!isFirstRow && (
                <View
                  style={[
                    styles.railTop,
                    { backgroundColor: topRailActive ? railStroke : scheme.outlineVariant },
                  ]}
                />
              )}
              {!isLastRow && (
                <View
                  style={[
                    styles.railBottom,
                    {
                      backgroundColor: bottomRailActive
                        ? railStroke
                        : scheme.outlineVariant,
                    },
                  ]}
                />
              )}
              {isTerminal || isAlighting ? (
                <View style={[styles.nodeFilled, { backgroundColor: nodeColor }]} />
              ) : isFirst || isBoarding ? (
                <View
                  style={[
                    styles.nodeHollowLarge,
                    { borderColor: nodeColor, backgroundColor: rowBg },
                  ]}
                />
              ) : (
                <View
                  style={[
                    styles.nodeRing,
                    { borderColor: nodeColor, backgroundColor: rowBg },
                  ]}
                />
              )}
            </View>

            <View style={[styles.stopContentCol, !isFirstRow && styles.stopContentDivider]}>
              <View style={styles.stopMainCol}>
                <Text
                  style={[
                    styles.stopName,
                    (isFirst || isTerminal || highlightedRow || selectedOnDesktop) &&
                      styles.stopNameStrong,
                    hasFullSegment && !inSegment && !selectedOnDesktop && styles.stopNameMuted,
                    selectedOnDesktop && styles.stopNameSelectedDesktop,
                  ]}
                  numberOfLines={2}
                >
                  {item.name}
                </Text>
                {(!!item.code || isBoarding || isAlighting || isTerminal) && (
                  <View style={styles.stopBadgesRow}>
                    {isBoarding && (
                      <View style={styles.tripStopBadge}>
                        <Text style={styles.tripStopBadgeText}>{t.boardingStop}</Text>
                      </View>
                    )}
                    {isAlighting && (
                      <View style={styles.tripStopBadge}>
                        <Text style={styles.tripStopBadgeText}>{t.alightingStop}</Text>
                      </View>
                    )}
                    {!!item.code && (
                      <View style={styles.platformBadge}>
                        <Text style={styles.platformBadgeText}>
                          {t.stopCode(item.code)}
                        </Text>
                      </View>
                    )}
                    {isTerminal && (
                      <Text style={styles.terminalCaption}>{t.terminal}</Text>
                    )}
                  </View>
                )}
              </View>

              {!isTerminal && (
                <View style={styles.stopRightCol}>
                  {stopNextDep ? (
                    <View style={styles.stopNextTimeCol}>
                      <Text
                        style={[
                          styles.stopNextClock,
                          isBoarding && styles.stopNextClockAccent,
                        ]}
                      >
                        {timetableClock(stopNextDep.seconds)}
                      </Text>
                      <Text style={styles.stopNextEta}>
                        {stopNextDep.minutesUntil <= 0
                          ? s.common.departNow
                          : s.common.departIn(stopNextDep.minutesUntil)}
                      </Text>
                    </View>
                  ) : item.departures.length > 0 ? (
                    <Text style={styles.stopTripCount}>
                      {t.departuresCount(item.departures.length)}
                    </Text>
                  ) : null}
                  <ChevronRight size={18} color={scheme.onSurfaceVariant} />
                </View>
              )}
            </View>
          </SpringPressable>
        </View>
      );
    },
    [
      alightingIndex,
      boardingIndex,
      desktopStopIndex,
      firstPhysicalIdx,
      hasFullSegment,
      isToday,
      lastPhysicalIdx,
      nowSec,
      pattern?.stops.length,
      railStroke,
      s.common.departIn,
      s.common.departNow,
      s.leg,
      t,
      webLayout.isDesktop,
    ],
  );

  const topBarContent = (
    <>
      <SpringPressable
        onPress={goBack}
        haptic="selection"
        scaleDelta={0.05}
        accessibilityRole="button"
        accessibilityLabel={t.back}
        style={styles.backBtn}
      >
        <ChevronLeft size={22} color={scheme.onSurface} />
      </SpringPressable>
      <Text style={styles.topBarTitle} numberOfLines={1}>
        {t.title}
      </Text>
      {patterns.length >= 2 && (
        <View style={styles.actionCluster}>
          <SpringPressable
            onPress={handleCycleDirection}
            haptic="selection"
            scaleDelta={0.05}
            accessibilityRole="button"
            accessibilityLabel={t.reverseDirection}
            style={styles.clusterBtn}
          >
            <ArrowUpDown size={19} color={scheme.onSurfaceVariant} />
          </SpringPressable>
        </View>
      )}
    </>
  );

  const lineList = (
    <FlatList
      data={stopsData}
      keyExtractor={(item, index) => `${item.id}:${index}`}
      contentContainerStyle={[
        styles.listContent,
        webLayout.isDesktop && styles.listContentDesktop,
        { paddingBottom: Math.max(insets.bottom, 16) + 28 },
      ]}
      showsVerticalScrollIndicator={false}
      ListHeaderComponent={
        <View style={styles.headerStack}>
          {!!displayLine && (
            <Animated.View
              ref={heroViewRef}
              onLayout={handleHeroLayout}
              style={[styles.heroCard, heroAnimStyle]}
            >
              <View style={styles.heroTopRow}>
                <View style={styles.heroBadgeGroup}>
                  <LineBadge line={displayLine} mode={displayMode} size="large" />
                  <View style={styles.heroLineMeta}>
                    <Text style={styles.heroLineTitle} numberOfLines={1}>
                      {t.line(displayLine)}
                    </Text>
                    {!!data?.line?.longName && (
                      <Text style={styles.heroLineLongName} numberOfLines={1}>
                        {data.line.longName}
                      </Text>
                    )}
                  </View>
                </View>
                <View style={styles.heroPillsRow}>
                  {pattern && (
                    <View style={styles.secondaryPill}>
                      <Text style={styles.secondaryPillText}>
                        {t.stopsCount(physicalStopsCount)}
                      </Text>
                    </View>
                  )}
                  {heroNextDep && (
                    <View style={styles.primaryPill}>
                      <Clock3 size={13} color={scheme.onPrimaryContainer} />
                      <Text style={styles.primaryPillText}>
                        {timetableClock(heroNextDep.seconds)} {'\u00b7'}{' '}
                        {heroNextDep.minutesUntil <= 0
                          ? s.common.departNow
                          : s.common.departIn(heroNextDep.minutesUntil)}
                      </Text>
                    </View>
                  )}
                </View>
              </View>

              {!!displayHeadsign && (
                <View style={styles.corridorBlock}>
                  <Text style={styles.corridorEyebrow}>{t.direction}</Text>
                  <Text style={styles.corridorHeadsign} numberOfLines={2}>
                    {displayHeadsign}
                  </Text>
                  <View style={styles.corridorBridgeRow}>
                    <View style={[styles.bridgeStartDot, { borderColor: railStroke }]} />
                    <View style={[styles.bridgeLine, { backgroundColor: railStroke }]} />
                    <View style={[styles.bridgeEndDot, { backgroundColor: railStroke }]} />
                  </View>
                  {!!originStop && (
                    <Text style={styles.corridorOrigin} numberOfLines={1}>
                      {t.fromOrigin(originStop.name)}
                    </Text>
                  )}
                </View>
              )}

              {hasTripContext && (
                <SpringPressable
                  onPress={() => {
                    if (boardingIndex >= 0) setSheetStopIndex(boardingIndex);
                  }}
                  disabled={boardingIndex < 0}
                  haptic="selection"
                  scaleDelta={0.015}
                  accessibilityRole={boardingIndex >= 0 ? 'button' : undefined}
                  accessibilityLabel={
                    boardingIndex >= 0 && fromStop ? t.selectStop(fromStop) : t.yourTrip
                  }
                  style={styles.tripContextCard}
                >
                  <View style={styles.tripContextHeader}>
                    <View style={styles.tripContextTag}>
                      <Text style={styles.tripContextTagText}>{t.yourTrip}</Text>
                    </View>
                    {!!departAt && (
                      <Text style={styles.tripContextTimes}>
                        {departAt}
                        {arriveAt ? ` \u2192 ${arriveAt}` : ''}
                      </Text>
                    )}
                  </View>
                  <View style={styles.tripContextRouteRow}>
                    <Text style={styles.tripContextStops} numberOfLines={1}>
                      {fromStop ?? ''}
                    </Text>
                    {!!fromStop && !!toStop && (
                      <ArrowRight size={14} color={scheme.onSurfaceVariant} />
                    )}
                    {!!toStop && (
                      <Text style={styles.tripContextStops} numberOfLines={1}>
                        {toStop}
                      </Text>
                    )}
                    {boardingIndex >= 0 && (
                      <ChevronRight size={18} color={scheme.onSurfaceVariant} />
                    )}
                  </View>
                </SpringPressable>
              )}
            </Animated.View>
          )}

          <Animated.View style={[styles.controlsStack, bodyAnimStyle]}>
            <View style={styles.dateBar}>
              <SpringPressable
                onPress={() => {
                  setDate(shiftTimetableDate(date, -1));
                  setSheetStopIndex(null);
                }}
                haptic="selection"
                scaleDelta={0.06}
                accessibilityRole="button"
                accessibilityLabel={t.previousDay}
                style={styles.dateStepBtn}
              >
                <ChevronLeft size={20} color={scheme.onSurface} />
              </SpringPressable>

              <View style={styles.dateCenter}>
                <Text style={styles.dateLabel} numberOfLines={1}>
                  {dateCompact}
                </Text>
                {!isToday && (
                  <SpringPressable
                    onPress={() => {
                      setDate(timetableToday());
                      setSheetStopIndex(null);
                    }}
                    haptic="selection"
                    scaleDelta={0.04}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    accessibilityRole="button"
                    style={styles.todayPill}
                  >
                    <Text style={styles.todayPillText}>{s.common.today}</Text>
                  </SpringPressable>
                )}
              </View>

              <SpringPressable
                onPress={() => {
                  setDate(shiftTimetableDate(date, 1));
                  setSheetStopIndex(null);
                }}
                haptic="selection"
                scaleDelta={0.06}
                accessibilityRole="button"
                accessibilityLabel={t.nextDay}
                style={styles.dateStepBtn}
              >
                <ChevronRight size={20} color={scheme.onSurface} />
              </SpringPressable>
            </View>

            {patterns.length > 1 && (
              <View style={styles.sectionBlock}>
                <Text style={styles.sectionEyebrow} accessibilityRole="header">
                  {t.direction}
                </Text>
                {patterns.length === 2 ? (
                  <View
                    style={[
                      styles.twoDirRow,
                      stackTwoDirections && styles.twoDirColumn,
                    ]}
                  >
                    {patterns.map((item, index) => {
                      const selected = item.id === pattern?.id;
                      const duplicate = (headsignCounts.get(item.headsign) ?? 0) > 1;
                      return (
                        <SpringPressable
                          key={item.id}
                          onPress={() => {
                            setPatternId(item.id);
                            setSheetStopIndex(null);
                          }}
                          haptic="selection"
                          scaleDelta={0.02}
                          accessibilityRole="radio"
                          accessibilityState={{ selected }}
                          style={[
                            styles.dirCard,
                            !stackTwoDirections && styles.dirCardEqual,
                            selected && styles.dirCardSelected,
                          ]}
                        >
                          <View style={styles.dirCardHeader}>
                            <View
                              style={[
                                styles.dirDot,
                                {
                                  backgroundColor: selected
                                    ? scheme.onPrimaryContainer
                                    : railStroke,
                                },
                              ]}
                            />
                            <Text
                              style={[
                                styles.dirHeadsign,
                                selected && styles.dirHeadsignSelected,
                              ]}
                              numberOfLines={2}
                            >
                              {item.headsign}
                            </Text>
                            {selected && (
                              <Check size={16} color={scheme.onPrimaryContainer} />
                            )}
                          </View>
                          <Text
                            style={[
                              styles.dirOrigin,
                              selected && styles.dirOriginSelected,
                            ]}
                            numberOfLines={1}
                          >
                            {(item.stops.find((st) => !isFareBoundary(st.name)) ?? item.stops[0]).name}
                            {duplicate ? ` \u00b7 ${t.variant(index + 1)}` : ''}
                          </Text>
                        </SpringPressable>
                      );
                    })}
                  </View>
                ) : (
                  <ScrollView
                    ref={directionsScrollRef}
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    contentContainerStyle={styles.dirScrollContent}
                  >
                    {patterns.map((item, index) => {
                      const selected = item.id === pattern?.id;
                      const duplicate = (headsignCounts.get(item.headsign) ?? 0) > 1;
                      return (
                        <View
                          key={item.id}
                          onLayout={(e) => {
                            if (!selected || patternId) return;
                            const key = `${resolvedRouteId}:${item.id}`;
                            if (scrolledForKeyRef.current === key) return;
                            scrolledForKeyRef.current = key;
                            const x = e.nativeEvent.layout.x;
                            if (x > 24) {
                              directionsScrollRef.current?.scrollTo({
                                x: Math.max(0, x - 14),
                                animated: false,
                              });
                            }
                          }}
                        >
                          <SpringPressable
                            onPress={() => {
                              setPatternId(item.id);
                              setSheetStopIndex(null);
                            }}
                            haptic="selection"
                            scaleDelta={0.02}
                            accessibilityRole="radio"
                            accessibilityState={{ selected }}
                            style={[
                              styles.dirCard,
                              styles.dirCardScrollItem,
                              selected && styles.dirCardSelected,
                            ]}
                          >
                            <View style={styles.dirCardHeader}>
                              <View
                                style={[
                                  styles.dirDot,
                                  {
                                    backgroundColor: selected
                                      ? scheme.onPrimaryContainer
                                      : railStroke,
                                  },
                                ]}
                              />
                              <Text
                                style={[
                                  styles.dirHeadsign,
                                  selected && styles.dirHeadsignSelected,
                                ]}
                                numberOfLines={2}
                              >
                                {item.headsign}
                              </Text>
                              {selected && (
                                <Check size={16} color={scheme.onPrimaryContainer} />
                              )}
                            </View>
                            <Text
                              style={[
                                styles.dirOrigin,
                                selected && styles.dirOriginSelected,
                              ]}
                              numberOfLines={1}
                            >
                              {(item.stops.find((st) => !isFareBoundary(st.name)) ?? item.stops[0]).name}
                              {duplicate ? ` \u00b7 ${t.variant(index + 1)}` : ''}
                            </Text>
                          </SpringPressable>
                        </View>
                      );
                    })}
                  </ScrollView>
                )}
              </View>
            )}

            {stopsData.length > 0 && (
              <View style={styles.stopsHeaderRow}>
                <Text style={styles.sectionEyebrow} accessibilityRole="header">
                  {t.stops}
                </Text>
                <Text style={styles.stopsHint}>{t.stopsHint}</Text>
              </View>
            )}
          </Animated.View>
        </View>
      }
      renderItem={renderStopItem}
      ListEmptyComponent={
        <View style={styles.stateCard} accessibilityLiveRegion="polite">
          {loading ? (
            <>
              <MorphingLoader variant="contained" size={32} />
              <Text style={styles.stateTitle}>{t.loading}</Text>
            </>
          ) : error ? (
            <>
              <View style={styles.stateIconCircle}>
                <AlertCircle size={24} color={scheme.onSecondaryContainer} />
              </View>
              <Text style={styles.stateBody} accessibilityRole="alert">
                {t.error}
              </Text>
              <SpringPressable
                onPress={retry}
                haptic="selection"
                accessibilityRole="button"
                style={styles.statePrimaryBtn}
              >
                <RefreshCw size={16} color={scheme.onPrimary} />
                <Text style={styles.statePrimaryBtnText}>{s.common.retry}</Text>
              </SpringPressable>
            </>
          ) : (
            <>
              <View style={styles.stateIconCircle}>
                <RouteOff size={24} color={scheme.onSecondaryContainer} />
              </View>
              <Text style={styles.stateBody}>{data?.line ? t.empty : t.missing}</Text>
              {data?.line && !isToday && (
                <SpringPressable
                  onPress={() => setDate(timetableToday())}
                  haptic="selection"
                  accessibilityRole="button"
                  style={styles.statePrimaryBtn}
                >
                  <Text style={styles.statePrimaryBtnText}>{s.common.today}</Text>
                </SpringPressable>
              )}
            </>
          )}
        </View>
      }
    />
  );

  const desktopSelectedStop =
    desktopStopIndex != null && pattern ? pattern.stops[desktopStopIndex] : undefined;
  const desktopPrevIndex =
    desktopStopIndex != null && pattern
      ? stepPhysicalStopIndex(pattern.stops, desktopStopIndex, -1)
      : -1;
  const desktopNextIndex =
    desktopStopIndex != null && pattern
      ? stepPhysicalStopIndex(pattern.stops, desktopStopIndex, 1)
      : -1;
  const desktopTotalStops = pattern ? countPhysicalLineStops(pattern.stops) : 0;
  const desktopCurrentOrdinal =
    desktopStopIndex != null && pattern ? physicalStopOrdinal(pattern.stops, desktopStopIndex) : 0;

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      {webLayout.isDesktop ? (
        <View style={styles.desktopSplit}>
          <View style={[styles.desktopLeftCol, { width: webLayout.isWide ? 460 : 410 }]}>
            <View style={styles.desktopTopBar}>{topBarContent}</View>
            {lineList}
          </View>
          <View style={styles.desktopRightCol}>
            {desktopSelectedStop && data?.line && pattern && desktopStopIndex != null ? (
              <View style={styles.desktopDetailCard}>
                <View style={styles.desktopDetailHeader}>
                  <LineBadge line={data.line.shortName} mode={data.line.mode} size="medium" />
                  <View style={styles.desktopDetailTitleCol}>
                    <Text style={styles.desktopDetailStopName} numberOfLines={2}>
                      {desktopSelectedStop.name}
                    </Text>
                    <View style={styles.desktopDetailMetaRow}>
                      {!!desktopSelectedStop.code && (
                        <View style={styles.platformBadge}>
                          <Text style={styles.platformBadgeText}>
                            {t.stopCode(desktopSelectedStop.code)}
                          </Text>
                        </View>
                      )}
                      {desktopStopIndex === boardingIndex && (
                        <View style={styles.tripStopBadge}>
                          <Text style={styles.tripStopBadgeText}>{t.boardingStop}</Text>
                        </View>
                      )}
                      {desktopStopIndex === alightingIndex && (
                        <View style={styles.tripStopBadge}>
                          <Text style={styles.tripStopBadgeText}>{t.alightingStop}</Text>
                        </View>
                      )}
                    </View>
                  </View>
                  <SpringPressable
                    onPress={() => handleOpenFullDepartures(desktopStopIndex)}
                    haptic="selection"
                    scaleDelta={0.05}
                    accessibilityRole="button"
                    accessibilityLabel={t.openFullScreen}
                    style={styles.desktopFullBtn}
                  >
                    <Maximize2 size={18} color={scheme.onSurfaceVariant} />
                  </SpringPressable>
                </View>

                <View style={styles.desktopStopNavBar}>
                  <SpringPressable
                    onPress={() => desktopPrevIndex >= 0 && setSheetStopIndex(desktopPrevIndex)}
                    disabled={desktopPrevIndex < 0}
                    haptic="selection"
                    scaleDelta={0.06}
                    accessibilityRole="button"
                    accessibilityLabel={t.previousStop}
                    accessibilityState={{ disabled: desktopPrevIndex < 0 }}
                    style={[
                      styles.desktopStepBtn,
                      desktopPrevIndex < 0 && styles.desktopStepBtnDisabled,
                    ]}
                  >
                    <ChevronLeft
                      size={20}
                      color={desktopPrevIndex >= 0 ? scheme.onSurface : scheme.outline}
                    />
                  </SpringPressable>
                  <View style={styles.desktopStopNavCenter}>
                    <Text style={styles.desktopStopNavHeadsign} numberOfLines={1}>
                      {pattern.headsign}
                    </Text>
                    <Text style={styles.desktopStopNavMeta} numberOfLines={1}>
                      {desktopCurrentOrdinal} / {desktopTotalStops} {'\u00b7'} {dateCompact}
                    </Text>
                  </View>
                  <SpringPressable
                    onPress={() => desktopNextIndex >= 0 && setSheetStopIndex(desktopNextIndex)}
                    disabled={desktopNextIndex < 0}
                    haptic="selection"
                    scaleDelta={0.06}
                    accessibilityRole="button"
                    accessibilityLabel={t.nextStop}
                    accessibilityState={{ disabled: desktopNextIndex < 0 }}
                    style={[
                      styles.desktopStepBtn,
                      desktopNextIndex < 0 && styles.desktopStepBtnDisabled,
                    ]}
                  >
                    <ChevronRight
                      size={20}
                      color={desktopNextIndex >= 0 ? scheme.onSurface : scheme.outline}
                    />
                  </SpringPressable>
                </View>

                <ScrollView
                  style={styles.desktopDetailScroll}
                  contentContainerStyle={styles.desktopDetailScrollContent}
                  showsVerticalScrollIndicator={false}
                >
                  <TimetableDeparturesView
                    stop={desktopSelectedStop}
                    terminal={desktopStopIndex === lastPhysicalIdx}
                    isToday={isToday}
                    nowSec={nowSec}
                    railStroke={railStroke}
                    plannedDepartSec={
                      desktopStopIndex === boardingIndex ? plannedDepartSec : null
                    }
                  />
                </ScrollView>
              </View>
            ) : (
              <View style={styles.stateCard} accessibilityLiveRegion="polite">
                {loading ? (
                  <>
                    <MorphingLoader variant="contained" size={32} />
                    <Text style={styles.stateTitle}>{t.loading}</Text>
                  </>
                ) : (
                  <Text style={styles.stateBody}>{t.stopsHint}</Text>
                )}
              </View>
            )}
          </View>
        </View>
      ) : (
        <>
          <View style={[styles.topBar, webLayout.isMedium && styles.topBarMedium]}>
            {topBarContent}
          </View>
          {lineList}
          {sheetStopIndex != null && data?.line && pattern && pattern.stops[sheetStopIndex] && (
            <StopDeparturesSheet
              line={data.line}
              pattern={pattern}
              stopIndex={sheetStopIndex}
              dateLabel={dateCompact}
              isToday={isToday}
              nowSec={nowSec}
              railStroke={railStroke}
              boardingIndex={boardingIndex}
              alightingIndex={alightingIndex}
              plannedDepartSec={plannedDepartSec}
              onSelectStopIndex={setSheetStopIndex}
              onOpenFullScreen={() => handleOpenFullDepartures(sheetStopIndex)}
              onClose={() => setSheetStopIndex(null)}
            />
          )}
        </>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: scheme.surface,
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  topBarMedium: {
    width: '100%',
    maxWidth: 680,
    alignSelf: 'center',
  },
  desktopSplit: {
    flex: 1,
    flexDirection: 'row',
    width: '100%',
    maxWidth: 1240,
    alignSelf: 'center',
    paddingHorizontal: 28,
    paddingTop: 16,
    paddingBottom: 20,
    gap: 24,
    minHeight: 0,
  },
  desktopLeftCol: {
    flexShrink: 0,
    minHeight: 0,
  },
  desktopTopBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingBottom: 10,
  },
  listContentDesktop: {
    paddingHorizontal: 0,
    maxWidth: undefined,
  },
  desktopRightCol: {
    flex: 1,
    minWidth: 0,
    minHeight: 0,
  },
  desktopDetailCard: {
    flex: 1,
    minHeight: 0,
    backgroundColor: scheme.surfaceContainerLow,
    borderRadius: shape.extraLarge,
    borderWidth: 1,
    borderColor: scheme.outlineVariant,
    overflow: 'hidden',
    ...elev.level1,
  },
  desktopDetailHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    paddingHorizontal: 20,
    paddingTop: 18,
    paddingBottom: 12,
  },
  desktopDetailTitleCol: {
    flex: 1,
    minWidth: 0,
    gap: 6,
  },
  desktopDetailStopName: {
    ...type.titleLarge,
    fontSize: 21,
    lineHeight: 26,
    fontWeight: '800',
    letterSpacing: -0.3,
    color: scheme.onSurface,
  },
  desktopDetailMetaRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  desktopFullBtn: {
    width: 44,
    height: 44,
    borderRadius: shape.full,
    backgroundColor: scheme.surfaceContainerHigh,
    alignItems: 'center',
    justifyContent: 'center',
  },
  desktopStopNavBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginHorizontal: 18,
    marginBottom: 12,
    padding: 4,
    borderRadius: shape.extraLarge,
    backgroundColor: scheme.surfaceContainer,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: scheme.outlineVariant,
  },
  desktopStepBtn: {
    width: 44,
    height: 44,
    borderRadius: shape.full,
    backgroundColor: scheme.surfaceContainerHigh,
    alignItems: 'center',
    justifyContent: 'center',
  },
  desktopStepBtnDisabled: {
    backgroundColor: scheme.surfaceContainerLow,
    opacity: 0.45,
  },
  desktopStopNavCenter: {
    flex: 1,
    minWidth: 0,
    alignItems: 'center',
    gap: 2,
    paddingHorizontal: 4,
  },
  desktopStopNavHeadsign: {
    ...type.labelLarge,
    fontWeight: '700',
    color: scheme.onSurface,
  },
  desktopStopNavMeta: {
    ...type.bodySmall,
    color: scheme.onSurfaceVariant,
    fontVariant: ['tabular-nums'],
  },
  desktopDetailScroll: {
    flex: 1,
  },
  desktopDetailScrollContent: {
    paddingHorizontal: 18,
    paddingBottom: 24,
  },
  backBtn: {
    width: 44,
    height: 44,
    borderRadius: shape.full,
    backgroundColor: scheme.surfaceContainer,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: scheme.outlineVariant,
    alignItems: 'center',
    justifyContent: 'center',
  },
  topBarTitle: {
    flex: 1,
    fontSize: 17,
    lineHeight: 22,
    fontWeight: '800',
    letterSpacing: -0.3,
    color: scheme.onSurface,
  },
  actionCluster: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    padding: 3,
    borderRadius: shape.full,
    backgroundColor: scheme.surfaceContainer,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: scheme.outlineVariant,
  },
  clusterBtn: {
    width: 44,
    height: 44,
    borderRadius: shape.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  listContent: {
    paddingHorizontal: 14,
    paddingTop: 4,
    width: '100%',
    maxWidth: 680,
    alignSelf: 'center',
  },
  headerStack: {
    gap: 14,
    marginBottom: 8,
  },
  heroCard: {
    backgroundColor: scheme.surfaceContainer,
    borderRadius: shape.extraLarge,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: scheme.outlineVariant,
    padding: 16,
    gap: 14,
    ...elev.level1,
  },
  heroTopRow: {
    flexDirection: 'column',
    alignItems: 'flex-start',
    gap: 10,
  },
  heroBadgeGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    flexShrink: 1,
    minWidth: 0,
  },
  heroLineMeta: {
    flexShrink: 1,
    minWidth: 0,
    gap: 2,
  },
  heroLineTitle: {
    fontSize: 15,
    lineHeight: 20,
    fontWeight: '800',
    letterSpacing: -0.2,
    color: scheme.onSurface,
  },
  heroLineLongName: {
    ...type.bodySmall,
    color: scheme.onSurfaceVariant,
  },
  heroPillsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 6,
  },
  secondaryPill: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: shape.full,
    backgroundColor: scheme.secondaryContainer,
  },
  secondaryPillText: {
    ...type.labelSmall,
    fontWeight: '700',
    color: scheme.onSecondaryContainer,
    fontVariant: ['tabular-nums'],
  },
  primaryPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: shape.full,
    backgroundColor: scheme.primaryContainer,
  },
  primaryPillText: {
    ...type.labelSmall,
    fontWeight: '700',
    color: scheme.onPrimaryContainer,
    fontVariant: ['tabular-nums'],
  },
  corridorBlock: {
    gap: 5,
  },
  corridorEyebrow: {
    fontSize: 11,
    lineHeight: 14,
    fontWeight: '700',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    color: scheme.onSurfaceVariant,
  },
  corridorHeadsign: {
    fontSize: 22,
    lineHeight: 27,
    fontWeight: '800',
    letterSpacing: -0.4,
    color: scheme.onSurface,
  },
  corridorBridgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 4,
  },
  bridgeStartDot: {
    width: 10,
    height: 10,
    borderRadius: shape.full,
    borderWidth: 2.5,
    backgroundColor: scheme.surfaceContainer,
  },
  bridgeLine: {
    flex: 1,
    height: 3,
    borderRadius: shape.full,
  },
  bridgeEndDot: {
    width: 10,
    height: 10,
    borderRadius: shape.full,
  },
  corridorOrigin: {
    ...type.bodySmall,
    color: scheme.onSurfaceVariant,
    marginTop: 2,
  },
  tripContextCard: {
    backgroundColor: scheme.surfaceContainerHigh,
    borderRadius: shape.large,
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 6,
    minHeight: 48,
  },
  tripContextHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  tripContextTag: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: shape.full,
    backgroundColor: scheme.primaryContainer,
  },
  tripContextTagText: {
    fontSize: 11,
    lineHeight: 14,
    fontWeight: '700',
    color: scheme.onPrimaryContainer,
  },
  tripContextTimes: {
    ...type.labelMedium,
    fontWeight: '700',
    color: scheme.onSurface,
    fontVariant: ['tabular-nums'],
  },
  tripContextRouteRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  tripContextStops: {
    ...type.bodySmall,
    fontWeight: '700',
    color: scheme.onSurface,
    flexShrink: 1,
  },
  controlsStack: {
    gap: 14,
  },
  dateBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    padding: 5,
    borderRadius: shape.extraLarge,
    backgroundColor: scheme.surfaceContainer,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: scheme.outlineVariant,
    ...elev.level1,
  },
  dateStepBtn: {
    width: 44,
    height: 44,
    borderRadius: shape.full,
    backgroundColor: scheme.surfaceContainerHigh,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dateCenter: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingHorizontal: 4,
  },
  dateLabel: {
    ...type.titleSmall,
    fontSize: 15,
    fontWeight: '700',
    color: scheme.onSurface,
    textAlign: 'center',
  },
  todayPill: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: shape.full,
    backgroundColor: scheme.primaryContainer,
  },
  todayPillText: {
    ...type.labelSmall,
    fontWeight: '700',
    color: scheme.onPrimaryContainer,
  },
  sectionBlock: {
    gap: 8,
  },
  sectionEyebrow: {
    fontSize: 11.5,
    lineHeight: 15,
    fontWeight: '700',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    color: scheme.onSurfaceVariant,
    paddingHorizontal: 4,
  },
  twoDirRow: {
    flexDirection: 'row',
    gap: 8,
  },
  twoDirColumn: {
    flexDirection: 'column',
  },
  dirScrollContent: {
    gap: 8,
    paddingRight: 4,
  },
  dirCard: {
    minHeight: 68,
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 12,
    backgroundColor: scheme.surfaceContainer,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: scheme.outlineVariant,
    justifyContent: 'center',
    gap: 4,
  },
  dirCardEqual: {
    flex: 1,
    minWidth: 0,
  },
  dirCardScrollItem: {
    minWidth: 196,
    maxWidth: 260,
  },
  dirCardSelected: {
    backgroundColor: scheme.primaryContainer,
    borderColor: scheme.primary,
  },
  dirCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
  },
  dirDot: {
    width: 8,
    height: 8,
    borderRadius: shape.full,
    flexShrink: 0,
  },
  dirHeadsign: {
    ...type.titleSmall,
    fontWeight: '700',
    color: scheme.onSurface,
    flex: 1,
  },
  dirHeadsignSelected: {
    color: scheme.onPrimaryContainer,
    fontWeight: '800',
  },
  dirOrigin: {
    ...type.bodySmall,
    color: scheme.onSurfaceVariant,
    paddingLeft: 15,
  },
  dirOriginSelected: {
    color: scheme.onPrimaryContainer,
  },
  stopsHeaderRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: 6,
    paddingHorizontal: 4,
  },
  stopsHint: {
    ...type.bodySmall,
    color: scheme.onSurfaceVariant,
  },
  stopCardSlice: {
    backgroundColor: scheme.surfaceContainer,
    borderLeftWidth: StyleSheet.hairlineWidth,
    borderRightWidth: StyleSheet.hairlineWidth,
    borderColor: scheme.outlineVariant,
    overflow: 'hidden',
  },
  stopCardFirst: {
    borderTopLeftRadius: shape.extraLarge,
    borderTopRightRadius: shape.extraLarge,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  stopCardLast: {
    borderBottomLeftRadius: shape.extraLarge,
    borderBottomRightRadius: shape.extraLarge,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  stopCardHighlighted: {
    backgroundColor: scheme.surfaceContainerHigh,
  },
  stopCardSelectedDesktop: {
    backgroundColor: scheme.primaryContainer,
  },
  stopRow: {
    flexDirection: 'row',
    alignItems: 'stretch',
    minHeight: 58,
    paddingHorizontal: 14,
    gap: 10,
  },
  railCol: {
    width: RAIL_COL_W,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  railTop: {
    position: 'absolute',
    top: 0,
    bottom: '50%',
    width: SPINE_W,
  },
  railBottom: {
    position: 'absolute',
    top: '50%',
    bottom: 0,
    width: SPINE_W,
  },
  railContinuous: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: SPINE_W,
  },
  boundaryRow: {
    flexDirection: 'row',
    alignItems: 'stretch',
    paddingHorizontal: 14,
    gap: 10,
  },
  boundaryContentCol: {
    flex: 1,
    minWidth: 0,
    paddingVertical: 8,
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
  nodeHollowLarge: {
    width: 12,
    height: 12,
    borderRadius: shape.full,
    borderWidth: 2.5,
    zIndex: 2,
  },
  nodeFilled: {
    width: 12,
    height: 12,
    borderRadius: shape.full,
    zIndex: 2,
  },
  nodeRing: {
    width: 10,
    height: 10,
    borderRadius: shape.full,
    borderWidth: 2.5,
    zIndex: 2,
  },
  stopContentCol: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 12,
  },
  stopContentDivider: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: scheme.outlineVariant,
  },
  stopMainCol: {
    flex: 1,
    minWidth: 0,
    gap: 4,
  },
  stopName: {
    fontSize: 15,
    lineHeight: 20,
    fontWeight: '600',
    color: scheme.onSurface,
  },
  stopNameStrong: {
    fontWeight: '800',
    letterSpacing: -0.2,
  },
  stopNameMuted: {
    color: scheme.onSurfaceVariant,
  },
  stopNameSelectedDesktop: {
    color: scheme.onPrimaryContainer,
  },
  stopBadgesRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 6,
  },
  tripStopBadge: {
    paddingHorizontal: 8,
    paddingVertical: 2.5,
    borderRadius: shape.small,
    backgroundColor: scheme.primaryContainer,
  },
  tripStopBadgeText: {
    fontSize: 11,
    lineHeight: 14,
    fontWeight: '700',
    color: scheme.onPrimaryContainer,
  },
  platformBadge: {
    paddingHorizontal: 8,
    paddingVertical: 2.5,
    borderRadius: shape.small,
    backgroundColor: scheme.secondaryContainer,
  },
  platformBadgeText: {
    fontSize: 11,
    lineHeight: 14,
    fontWeight: '700',
    color: scheme.onSecondaryContainer,
  },
  terminalCaption: {
    ...type.labelSmall,
    color: scheme.onSurfaceVariant,
  },
  stopRightCol: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flexShrink: 0,
  },
  stopNextTimeCol: {
    alignItems: 'flex-end',
    gap: 1,
  },
  stopNextClock: {
    fontSize: 15,
    lineHeight: 19,
    fontWeight: '800',
    letterSpacing: -0.2,
    color: scheme.onSurface,
    fontVariant: ['tabular-nums'],
  },
  stopNextClockAccent: {
    color: scheme.primary,
  },
  stopNextEta: {
    fontSize: 11,
    lineHeight: 14,
    fontWeight: '600',
    color: scheme.onSurfaceVariant,
    fontVariant: ['tabular-nums'],
  },
  stopTripCount: {
    ...type.labelSmall,
    color: scheme.onSurfaceVariant,
    fontVariant: ['tabular-nums'],
  },
  stateCard: {
    backgroundColor: scheme.surfaceContainer,
    borderRadius: shape.extraLarge,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: scheme.outlineVariant,
    paddingHorizontal: 24,
    paddingVertical: 32,
    alignItems: 'center',
    gap: 14,
    marginTop: 4,
    ...elev.level1,
  },
  stateIconCircle: {
    width: 52,
    height: 52,
    borderRadius: shape.full,
    backgroundColor: scheme.secondaryContainer,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stateTitle: {
    ...type.bodyLarge,
    color: scheme.onSurfaceVariant,
    textAlign: 'center',
  },
  stateBody: {
    ...type.bodyMedium,
    color: scheme.onSurfaceVariant,
    textAlign: 'center',
    maxWidth: 300,
  },
  statePrimaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    minHeight: 48,
    paddingHorizontal: 22,
    borderRadius: shape.full,
    backgroundColor: scheme.primary,
    justifyContent: 'center',
  },
  statePrimaryBtnText: {
    ...type.labelLarge,
    fontWeight: '700',
    color: scheme.onPrimary,
  },
});
