import { memo, useCallback, useMemo, useState } from 'react';
import * as Haptics from 'expo-haptics';
import { Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';
import { ArrowDown, Footprints, TriangleAlert } from './icons';
import { motion } from '../theme/motion';
import { elev, scheme, shape, type } from '../theme/tokens';
import type { Connection, Leg } from '../types/models';
import { LineBadge, resolveLegBadgeColors } from './LineBadge';
import { DirectionsWalk } from './DirectionsWalk';
import { LiveSensors } from './LiveDot';
import { ConnectionPeekTarget, type ConnectionPeekHandlers } from './ConnectionPeek';
import { RailAlertsChip } from './RailAlertsChip';
import {
  formatDistance,
  formatWalkTime,
  useTransferThresholds,
  useWalkSpeedMps,
  walkMinutesFor,
} from '../services/settings';
import { getActiveCityIdSync } from '../services/cityStore';
import {
  analyzeConnection,
  type ConnectionInsights,
  type TransferRiskInfo,
} from './connectionInsights';
import { tr, useStrings } from '../i18n';
import {
  boardingDepartureMs,
  boardingDepartureSec,
  scheduledLegTimes,
} from '../services/routing/connectionTimes';
import { reliabilityNotice } from './reliabilityNotice';
import { secondsToTimeString } from '../gtfs/geo';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);
const PRESS_SPRING = motion.spring.press;
const DASH_COUNT = 20;
const DASH_INDICES = Array.from({ length: DASH_COUNT }, (_, i) => i);

/** Poprawna odmiana liczby przesiadek (słownik i18n: 1 / 2-4 / 5+). */
export function transfersLabel(n: number): string {
  return tr().connection.transfers(n);
}

/** Nazwy przystanków przesiadkowych z pola interchange silnika. */
function interchangeStops(raw?: string): string[] {
  if (!raw) return [];
  const colon = raw.indexOf(':');
  const body = colon >= 0 ? raw.slice(colon + 1) : raw;
  return body
    .split('•')
    .map((s) => s.trim())
    .filter(Boolean);
}

type StripStep =
  | { key: string; kind: 'leg'; leg: Leg }
  | { key: string; kind: 'walk'; walkMin: number }
  | { key: string; kind: 'risk'; risk: TransferRiskInfo; walkMin: number };

type BarSegment =
  | { key: string; kind: 'leg'; min: number; color: string }
  | { key: string; kind: 'walk'; min: number }
  | { key: string; kind: 'longWalk'; min: number }
  | { key: string; kind: 'riskTight' | 'riskCritical'; min: number };

function JourneyStrip({
  insights,
  dimmed,
}: {
  insights: ConnectionInsights;
  dimmed: boolean;
}) {
  const s = useStrings();
  const { width } = useWindowDimensions();
  const cityId = getActiveCityIdSync();
  if (insights.transitLegs.length === 0) return null;

  const steps: StripStep[] = [];
  const segments: BarSegment[] = [];

  if (insights.initialWalkMin > 0) {
    steps.push({ key: 'initial-walk', kind: 'walk', walkMin: insights.initialWalkMin });
    segments.push({ key: 'seg-initial-walk', kind: 'walk', min: insights.initialWalkMin });
  }

  for (let i = 0; i < insights.transitLegs.length; i++) {
    const item = insights.transitLegs[i];
    steps.push({ key: item.key, kind: 'leg', leg: item.leg });
    const badgeColors = resolveLegBadgeColors({ leg: item.leg, compact: true, cityId });
    segments.push({
      key: `seg-${item.key}`,
      kind: 'leg',
      min: item.durationMin,
      color: badgeColors.bg,
    });

    const hasNext = i < insights.transitLegs.length - 1;
    if (hasNext && item.transferRiskAfter) {
      steps.push({
        key: `${item.key}-risk`,
        kind: 'risk',
        risk: item.transferRiskAfter,
        walkMin: item.transferWalkMinAfter,
      });
      segments.push({
        key: `seg-${item.key}-risk`,
        kind: item.transferRiskAfter.level === 'critical' ? 'riskCritical' : 'riskTight',
        min: Math.max(1, item.transferWalkMinAfter || 1),
      });
    } else if (item.transferWalkMinAfter > 0) {
      steps.push({
        key: `${item.key}-walk`,
        kind: 'walk',
        walkMin: item.transferWalkMinAfter,
      });
      segments.push({
        key: `seg-${item.key}-walk`,
        kind: 'walk',
        min: item.transferWalkMinAfter,
      });
    }
  }

  const pinFinalWalk =
    insights.hasLongDestinationWalk && insights.finalWalkMin > 0 && !dimmed;

  if (insights.finalWalkMin > 0) {
    if (!pinFinalWalk) {
      steps.push({
        key: 'final-walk',
        kind: 'walk',
        walkMin: insights.finalWalkMin,
      });
    }
    segments.push({
      key: 'seg-final-walk',
      kind: pinFinalWalk ? 'longWalk' : 'walk',
      min: insights.finalWalkMin,
    });
  }

  return (
    <View
      style={[styles.stripSurface, dimmed && styles.stripSurfaceDimmed]}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <View style={styles.stripTopRow}>
        <ScrollView
          horizontal
          style={styles.stripScroll}
          contentContainerStyle={styles.stripContent}
          showsHorizontalScrollIndicator={false}
          nestedScrollEnabled
        >
          {steps.map((step) => {
            if (step.kind === 'leg') {
              return (
                <LineBadge
                  key={step.key}
                  leg={step.leg}
                  compact
                  maxWidth={width - 128}
                />
              );
            }

            if (step.kind === 'risk') {
              const critical = step.risk.level === 'critical';
              const fg = critical ? scheme.onErrorContainer : scheme.onWarningContainer;
              const timeLabel = step.risk.slackMin <= 0 ? "<1'" : `${step.risk.slackMin}'`;
              return (
                <View
                  key={step.key}
                  style={[
                    styles.riskConnector,
                    critical ? styles.riskConnectorCritical : styles.riskConnectorTight,
                  ]}
                >
                  <TriangleAlert size={11} color={fg} />
                  {step.walkMin > 0 && <DirectionsWalk size={12} color={fg} />}
                  <Text style={[styles.riskConnectorText, { color: fg }]}>{timeLabel}</Text>
                </View>
              );
            }

            return (
              <View key={step.key} style={styles.walkStep}>
                <DirectionsWalk size={13} color={scheme.onSurfaceVariant} />
                <Text style={styles.walkMinutes}>{`${step.walkMin}'`}</Text>
              </View>
            );
          })}
        </ScrollView>

        {pinFinalWalk && (
          <View style={styles.pinnedFinalWalk}>
            <DirectionsWalk size={13} color={scheme.onWarningContainer} />
            <Text style={styles.pinnedFinalWalkText} numberOfLines={1}>
              {s.connection.finalWalkPill(insights.finalWalkMin)}
            </Text>
          </View>
        )}
      </View>

      {segments.length > 0 && (
        <View style={styles.proportionBar}>
          {segments.map((seg) => {
            if (seg.kind === 'longWalk') {
              return (
                <View
                  key={seg.key}
                  style={[
                    styles.barLongWalk,
                    { flexGrow: Math.max(1, seg.min), flexBasis: 0 },
                  ]}
                >
                  {DASH_INDICES.map((idx) => (
                    <View key={idx} style={styles.barDash} />
                  ))}
                </View>
              );
            }

            const barColor =
              seg.kind === 'leg'
                ? seg.color
                : seg.kind === 'riskCritical'
                  ? scheme.error
                  : seg.kind === 'riskTight'
                    ? scheme.warning
                    : scheme.outlineVariant;

            return (
              <View
                key={seg.key}
                style={[
                  styles.barSegment,
                  {
                    flexGrow: Math.max(1, seg.min),
                    flexBasis: 0,
                    backgroundColor: barColor,
                  },
                ]}
              />
            );
          })}
        </View>
      )}
    </View>
  );
}

export const ConnectionCard = memo(function ConnectionCard({
  item,
  onPress,
  dimmed = false,
  tick = 0,
  peek,
}: {
  item: Connection;
  onPress: (item: Connection) => void;
  /** historyczne (przeszłe) połączenie: przygaszony wygląd tła karty */
  dimmed?: boolean;
  /** Zmienia się co interwał, żeby odliczanie „za X min” nie zamarzło pod memo. */
  tick?: number;
  peek?: ConnectionPeekHandlers;
}) {
  const s = useStrings();
  const { width, fontScale } = useWindowDimensions();
  const reduceMotion = useReducedMotion();
  const [focused, setFocused] = useState(false);
  const press = useSharedValue(0);

  const verticalTimes = (width - 64) / fontScale < 148;
  const walkMps = useWalkSpeedMps();
  const thresholds = useTransferThresholds();
  const now = useMemo(() => new Date(), [tick]);

  const boarding = useMemo(() => item.legs.filter((l) => l.mode !== 'walk'), [item.legs]);
  const walkOnly = boarding.length === 0;
  const insights = useMemo(
    () => analyzeConnection(item, walkMps, thresholds),
    [item, walkMps, thresholds],
  );
  const transfers = useMemo(() => interchangeStops(item.interchange), [item.interchange]);

  const departureMs = boardingDepartureMs(item, now);
  const departAt = walkOnly ? item.departAt : secondsToTimeString(boardingDepartureSec(item));
  const firstVehicle = boarding[0];
  const notice = reliabilityNotice(boarding, s);
  const scheduledDeparture =
    !item.boarded &&
    firstVehicle?.live &&
    Math.round((firstVehicle.delaySec ?? 0) / 60) === item.delayMin
      ? scheduledLegTimes(firstVehicle, boardingDepartureSec(item)).departure
      : undefined;
  const minsAgo =
    !item.boarded && item.departureSec > 0
      ? Math.floor((now.getTime() - departureMs) / 60000)
      : -1;
  const historical = minsAgo >= 1;

  const effectiveMin =
    item.departureSec > 0
      ? Math.max(0, Math.ceil((departureMs - now.getTime()) / 60000))
      : item.departInMin;

  const walkM = walkOnly ? item.legs[0]?.walkM : undefined;
  const walkMin = item.durationMin || (walkM != null ? walkMinutesFor(walkM, walkMps) : 1);

  const departureText = item.boarded
    ? s.connection.inVehicleNow
    : historical
      ? minsAgo <= 1
        ? tr().common.departJustAgo
        : tr().common.departAgo(minsAgo)
      : walkOnly && walkM != null
        ? formatWalkTime(walkMin)
        : effectiveMin <= 0
          ? tr().common.departNow
          : effectiveMin > 59
            ? departAt
            : tr().common.departIn(effectiveMin);

  const showLiveOnTime = item.live && item.delayMin === 0 && !item.boarded && !dimmed && !walkOnly;
  const showDelayPill =
    !notice && item.live && item.delayMin !== 0 && !item.boarded && !dimmed && !walkOnly;

  const departureColor =
    dimmed || historical
      ? scheme.onSurfaceVariant
      : item.boarded || showLiveOnTime
        ? scheme.primary
        : walkOnly && insights.hasLongDestinationWalk
          ? scheme.warning
          : scheme.onSurface;

  const linesSummary = boarding
    .map((b) => b.line)
    .filter(Boolean)
    .join(', ');
  const transferSummary = walkOnly ? s.connection.walkLeg : transfersLabel(item.transfers);
  const transferA11y = [transferSummary, ...transfers].join(' • ');

  const contextRightText = walkOnly
    ? s.connection.walkLeg
    : transfers.length > 0
      ? `${transferSummary} · ${transfers.join(' · ')}`
      : item.boarded && insights.lastTransitStop
        ? `${transferSummary} · ${s.connection.exitStopLabel(insights.lastTransitStop)}`
        : insights.firstBoardingStop
          ? `${transferSummary} · ${s.connection.fromStopLabel(insights.firstBoardingStop)}`
          : transferSummary;

  const worstRisk = !dimmed ? insights.worstTransferRisk : undefined;
  const riskA11yText = worstRisk
    ? s.connection.riskyTransferA11y(worstRisk.stopName, worstRisk.slackMin)
    : undefined;
  const longWalkA11yText = insights.hasLongDestinationWalk
    ? s.connection.longWalkA11y(insights.destinationWalkMin)
    : undefined;

  const accessibilityDesc = [
    tr().connection.cardA11y(
      departureText,
      item.durationMin,
      departAt,
      item.arriveAt,
      walkOnly ? tr().connection.walkRoute : transferA11y,
      linesSummary,
    ),
    riskA11yText,
    longWalkA11yText,
    notice,
  ]
    .filter(Boolean)
    .join('. ');

  const animatedCardStyle = useAnimatedStyle(() => {
    if (reduceMotion) return {};
    return {
      borderRadius: shape.extraLarge - press.value * 8,
      transform: [{ scale: 1 - press.value * 0.015 }],
    };
  });

  const setPress = useCallback(
    (value: number) => {
      if (reduceMotion) return;
      press.value = withSpring(value, PRESS_SPRING);
    },
    [press, reduceMotion],
  );

  const handlePress = useCallback(() => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    onPress(item);
  }, [item, onPress]);

  const showLongWalkStyle = insights.hasLongDestinationWalk && !dimmed && !item.boarded;

  return (
    <ConnectionPeekTarget item={item} handlers={peek}>
        <AnimatedPressable
          collapsable={false}
          onPress={handlePress}
          onPressIn={() => setPress(1)}
          onPressOut={() => setPress(0)}
          accessibilityRole="button"
          accessibilityLabel={accessibilityDesc}
          accessibilityHint={peek ? s.connection.previewHint : undefined}
          accessibilityActions={
            peek
              ? [{ name: 'activate' }, { name: 'longpress', label: s.connection.previewTitle }]
              : undefined
          }
          onAccessibilityTap={handlePress}
          onAccessibilityAction={(event) => {
            if (event.nativeEvent.actionName === 'longpress') peek?.show(item, true);
            if (event.nativeEvent.actionName === 'activate') handlePress();
          }}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          style={[
            styles.card,
            showLongWalkStyle && styles.longWalkCard,
            item.boarded && styles.boardedCard,
            dimmed && styles.pastCard,
            focused && styles.focused,
            animatedCardStyle,
          ]}
        >
          <View style={styles.headerRow}>
            <View style={styles.headerLeft}>
              <Text style={[styles.departure, { color: departureColor }]}>
                {walkOnly ? s.connection.walkRoute : departureText}
              </Text>

              {showLiveOnTime && (
                <View style={styles.onTimePill}>
                  <LiveSensors size={13} color={scheme.onSuccessContainer} pulse={!dimmed} />
                  <Text style={styles.onTimePillText}>{s.connection.onTimeBadge}</Text>
                </View>
              )}

              {showDelayPill && (
                <View
                  style={[
                    styles.delayPill,
                    item.delayMin > 0 ? styles.delayPillLate : styles.delayPillEarly,
                  ]}
                >
                  <Text
                    style={[
                      styles.delayPillText,
                      {
                        color:
                          item.delayMin > 0 ? scheme.onErrorContainer : scheme.onWarningContainer,
                      },
                    ]}
                  >
                    {item.delayMin > 0 ? `+${item.delayMin} min` : `${item.delayMin} min`}
                  </Text>
                </View>
              )}
            </View>

            <View style={styles.headerRight}>
              <RailAlertsChip connection={item} dimmed={dimmed} />
              <View style={[styles.durationPill, dimmed && styles.durationPillDimmed]}>
                <Text style={[styles.durationText, dimmed && styles.durationTextDimmed]}>
                  {s.common.durMin(item.durationMin)}
                </Text>
              </View>
            </View>
          </View>

          <View style={[styles.timeRow, fontScale > 1.3 && styles.timeRowStacked]}>
            <View style={[styles.timeRange, verticalTimes && styles.timeRangeStacked]}>
              <Text style={[styles.departClock, dimmed && styles.textDimmed]}>{departAt}</Text>
              {verticalTimes ? (
                <ArrowDown size={13} color={scheme.onSurfaceVariant} />
              ) : (
                <View
                  style={styles.miniBridge}
                  accessible={false}
                  importantForAccessibility="no-hide-descendants"
                >
                  <View style={styles.miniDotStart} />
                  <View style={styles.miniTrack} />
                  <View style={styles.miniDotEnd} />
                </View>
              )}
              <Text style={[styles.arriveClock, dimmed && styles.textDimmed]}>{item.arriveAt}</Text>
              {scheduledDeparture != null && item.live && item.delayMin !== 0 && (
                <Text style={styles.plannedInline}>
                  {s.connection.plannedShort(secondsToTimeString(scheduledDeparture))}
                </Text>
              )}
            </View>

            <Text
              style={styles.contextRight}
              numberOfLines={fontScale > 1.3 ? 2 : 1}
              ellipsizeMode="tail"
            >
              {contextRightText}
            </Text>
          </View>

          {walkOnly ? (
            <View
              style={[
                styles.walkOnlyBox,
                insights.hasLongDestinationWalk && !dimmed && styles.walkOnlyBoxLong,
                dimmed && styles.stripSurfaceDimmed,
              ]}
            >
              <View
                style={[
                  styles.walkIconBadge,
                  insights.hasLongDestinationWalk && !dimmed && styles.walkIconBadgeLong,
                ]}
              >
                <Footprints
                  size={16}
                  color={
                    insights.hasLongDestinationWalk && !dimmed
                      ? scheme.onWarningContainer
                      : scheme.onSurfaceVariant
                  }
                />
              </View>
              <Text
                style={[
                  styles.walkOnlyLabel,
                  insights.hasLongDestinationWalk && !dimmed && styles.walkOnlyLabelLong,
                ]}
              >
                {s.connection.walkAll}
                {walkM != null && walkM > 0 ? ` · ${formatDistance(walkM)}` : ''}
              </Text>
            </View>
          ) : insights.transitLegs.length > 0 ? (
            <JourneyStrip insights={insights} dimmed={dimmed} />
          ) : null}

          {!!notice && <Text style={styles.noticeText}>{notice}</Text>}
      </AnimatedPressable>
    </ConnectionPeekTarget>
  );
});

const styles = StyleSheet.create({
  card: {
    backgroundColor: scheme.surfaceContainer,
    borderRadius: shape.extraLarge,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: scheme.outlineVariant,
    paddingHorizontal: 16,
    paddingVertical: 14,
    gap: 10,
    ...elev.level1,
  },
  boardedCard: {
    backgroundColor: scheme.primaryContainer + '35',
    borderWidth: 1.5,
    borderColor: scheme.primary + '85',
  },
  longWalkCard: {
    backgroundColor: scheme.surfaceContainer,
    borderWidth: 1.5,
    borderColor: scheme.warning + '75',
  },
  pastCard: {
    backgroundColor: scheme.surfaceContainerLow,
    borderColor: scheme.outlineVariant + '55',
    shadowOpacity: 0,
    elevation: 0,
  },
  focused: {
    borderWidth: 2,
    borderColor: scheme.primary,
  },
  headerRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'space-between',
    columnGap: 10,
    rowGap: 6,
  },
  headerLeft: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 8,
    flexShrink: 1,
  },
  headerRight: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 6,
  },
  departure: {
    fontSize: 25,
    lineHeight: 29,
    fontWeight: '800',
    letterSpacing: -0.5,
    fontVariant: ['tabular-nums'],
    includeFontPadding: false,
  },
  onTimePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: shape.full,
    backgroundColor: scheme.successContainer,
  },
  onTimePillText: {
    ...type.labelMedium,
    color: scheme.onSuccessContainer,
    fontWeight: '700',
  },
  delayPill: {
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: shape.full,
  },
  delayPillLate: {
    backgroundColor: scheme.errorContainer,
  },
  delayPillEarly: {
    backgroundColor: scheme.warningContainer,
  },
  delayPillText: {
    ...type.labelMedium,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  durationPill: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 11,
    paddingVertical: 5,
    borderRadius: shape.full,
    backgroundColor: scheme.secondaryContainer,
  },
  durationPillDimmed: {
    backgroundColor: scheme.surfaceContainerHigh,
  },
  durationText: {
    fontSize: 13,
    lineHeight: 17,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
    color: scheme.onSecondaryContainer,
  },
  durationTextDimmed: {
    color: scheme.onSurfaceVariant,
  },
  timeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  timeRowStacked: {
    flexDirection: 'column',
    alignItems: 'flex-start',
    gap: 4,
  },
  timeRange: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flexShrink: 0,
  },
  timeRangeStacked: {
    flexDirection: 'column',
    alignItems: 'flex-start',
    gap: 2,
  },
  miniBridge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    paddingHorizontal: 1,
  },
  miniDotStart: {
    width: 5,
    height: 5,
    borderRadius: 2.5,
    borderWidth: 1.5,
    borderColor: scheme.primary,
  },
  miniTrack: {
    width: 14,
    height: 1.5,
    borderRadius: 1,
    backgroundColor: scheme.outlineVariant,
  },
  miniDotEnd: {
    width: 5,
    height: 5,
    borderRadius: 2.5,
    backgroundColor: scheme.primary,
  },
  departClock: {
    fontSize: 15,
    lineHeight: 20,
    fontWeight: '800',
    color: scheme.onSurface,
    fontVariant: ['tabular-nums'],
  },
  arriveClock: {
    fontSize: 15,
    lineHeight: 20,
    fontWeight: '600',
    color: scheme.onSurfaceVariant,
    fontVariant: ['tabular-nums'],
  },
  plannedInline: {
    fontSize: 13,
    lineHeight: 18,
    color: scheme.onSurfaceVariant,
    fontVariant: ['tabular-nums'],
    marginLeft: 2,
  },
  textDimmed: {
    color: scheme.onSurfaceVariant,
  },
  contextRight: {
    ...type.bodySmall,
    fontSize: 13,
    lineHeight: 18,
    color: scheme.onSurfaceVariant,
    flexShrink: 1,
    textAlign: 'right',
  },
  stripSurface: {
    backgroundColor: scheme.surfaceContainerLow,
    borderRadius: 18,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: scheme.outlineVariant,
    paddingHorizontal: 10,
    paddingVertical: 10,
    gap: 9,
  },
  stripSurfaceDimmed: {
    opacity: 0.72,
  },
  stripTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  stripScroll: {
    flex: 1,
    minWidth: 0,
  },
  stripContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  walkStep: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: shape.full,
    minHeight: 26,
    backgroundColor: scheme.surfaceContainerHigh,
  },
  walkMinutes: {
    fontSize: 12,
    lineHeight: 14,
    fontWeight: '700',
    color: scheme.onSurfaceVariant,
    fontVariant: ['tabular-nums'],
  },
  riskConnector: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: 7,
    paddingVertical: 4,
    borderRadius: shape.full,
    minHeight: 26,
  },
  riskConnectorTight: {
    backgroundColor: scheme.warningContainer,
  },
  riskConnectorCritical: {
    backgroundColor: scheme.errorContainer,
  },
  riskConnectorText: {
    fontSize: 11,
    lineHeight: 14,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  pinnedFinalWalk: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 9,
    paddingVertical: 4,
    minHeight: 26,
    borderRadius: shape.full,
    backgroundColor: scheme.warningContainer,
    flexShrink: 0,
  },
  pinnedFinalWalkText: {
    fontSize: 12,
    lineHeight: 14,
    fontWeight: '700',
    color: scheme.onWarningContainer,
    fontVariant: ['tabular-nums'],
  },
  proportionBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
  },
  barSegment: {
    height: 5,
    borderRadius: shape.full,
    minWidth: 10,
  },
  barLongWalk: {
    height: 5,
    minWidth: 28,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    overflow: 'hidden',
  },
  barDash: {
    width: 5,
    height: 5,
    borderRadius: 2.5,
    backgroundColor: scheme.warning,
    flexShrink: 0,
  },
  walkOnlyBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: scheme.surfaceContainerLow,
    borderRadius: 18,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: scheme.outlineVariant,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  walkOnlyBoxLong: {
    backgroundColor: scheme.warningContainer,
    borderColor: scheme.warning + '50',
  },
  walkIconBadge: {
    width: 30,
    height: 30,
    borderRadius: shape.full,
    backgroundColor: scheme.surfaceContainerHigh,
    alignItems: 'center',
    justifyContent: 'center',
  },
  walkIconBadgeLong: {
    backgroundColor: scheme.surfaceContainerLow + '40',
  },
  walkOnlyLabel: {
    ...type.labelLarge,
    color: scheme.onSurfaceVariant,
    fontWeight: '600',
  },
  walkOnlyLabelLong: {
    color: scheme.onWarningContainer,
    fontWeight: '700',
  },
  noticeText: {
    ...type.labelSmall,
    color: scheme.error,
    fontWeight: '700',
  },
});
