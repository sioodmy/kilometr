import { useEffect, useMemo, useState } from 'react';
import { AppState, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import Animated, {
  interpolate,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ArrowDown, ArrowRight, Clock3 } from './icons';
import { useStrings } from '../i18n';
import { elev, scheme, shape, type } from '../theme/tokens';
import { motion } from '../theme/motion';
import type { Connection } from '../types/models';
import { RollingTime } from './RollingTime';
import { LiveSensors } from './LiveDot';
import { boardingDepartureSec } from '../services/routing/connectionTimes';
import { secondsToTimeString, timeStringToSeconds } from '../gtfs/geo';
import { nowSecOfDay } from '../services/vehiclePosition';

export function ConnectionSummary({
  item,
  offline = false,
  availableWidth,
  fromY,
}: {
  item: Connection;
  offline?: boolean;
  availableWidth?: number;
  fromY?: number;
}) {
  const s = useStrings();
  const insets = useSafeAreaInsets();
  const reduceMotion = useReducedMotion();
  const { width, fontScale } = useWindowDimensions();
  const stacked = ((availableWidth ?? width - 32) - 44) / fontScale < 280;
  const boarding = item.legs.filter((leg) => leg.mode !== 'walk');
  const firstVehicle = boarding[0];
  const lastVehicle = boarding[boarding.length - 1];
  const departureSec = boardingDepartureSec(item);
  const departure =
    item.boarded || !firstVehicle ? item.departAt : secondsToTimeString(departureSec);
  const departureDelay =
    !item.boarded && firstVehicle?.live && !offline
      ? Math.round((firstVehicle.delaySec ?? 0) / 60)
      : 0;
  const arrivalDelaySec =
    lastVehicle?.live && !offline ? (lastVehicle.arrivalDelaySec ?? lastVehicle.delaySec ?? 0) : 0;
  const arrivalDelay = Math.round(arrivalDelaySec / 60);
  const Direction = stacked ? ArrowDown : ArrowRight;

  // Odliczanie czasu do odjazdu pierwszego pojazdu (lub wyjścia)
  const [nowSec, setNowSec] = useState(() => nowSecOfDay());
  useEffect(() => {
    const timer = setInterval(() => setNowSec(nowSecOfDay()), 15_000);
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') setNowSec(nowSecOfDay());
    });
    return () => {
      clearInterval(timer);
      sub.remove();
    };
  }, []);

  const countdownLabel = useMemo(() => {
    if (item.boarded) return s.connection.inVehicleNow;
    const targetSec = firstVehicle ? departureSec : timeStringToSeconds(item.departAt);
    let diffSec = targetSec - nowSec;
    if (diffSec < -43200) diffSec += 86400;
    const diffMin = Math.round(diffSec / 60);
    if (diffMin < -2 || diffMin > 180) return null;
    if (diffMin <= 0) return s.common.departNow;
    return s.common.departIn(diffMin);
  }, [item.boarded, item.departAt, firstVehicle, departureSec, nowSec, s]);

  const targetY = insets.top + 64;
  const deltaY = fromY != null ? fromY - targetY : 0;
  const hasTransform = fromY != null && !reduceMotion;

  const progress = useSharedValue(hasTransform ? 0 : 1);

  useEffect(() => {
    if (hasTransform) {
      progress.value = withTiming(1, {
        duration: motion.enter.duration,
        easing: motion.enter.easing,
      });
    }
  }, [hasTransform, progress]);

  const containerAnimatedStyle = useAnimatedStyle(() => {
    if (!hasTransform) return {};
    const translateY = interpolate(progress.value, [0, 1], [deltaY, 0]);
    return {
      transform: [{ translateY }],
    };
  });

  const contentAnimatedStyle = useAnimatedStyle(() => {
    if (!hasTransform) return {};
    const opacity = interpolate(progress.value, [0, 0.35, 1], [0.35, 0.85, 1]);
    const scale = interpolate(progress.value, [0, 1], [0.96, 1]);
    return {
      opacity,
      transform: [{ scale }],
    };
  });

  const innerContent = (
    <>
      {/* 1. Górny pasek statusu M3 Expressive: odliczanie live, punktualność, przesiadki i czas podróży */}
      <View style={styles.topBar}>
        <View style={styles.topPillsLeft}>
          {countdownLabel ? (
            <View style={[styles.countdownPill, item.boarded && styles.countdownPillBoarded]}>
              {!offline && item.live ? (
                <LiveSensors
                  color={item.boarded ? scheme.onTertiaryContainer : scheme.onPrimaryContainer}
                  size={13}
                />
              ) : null}
              <Text
                style={[styles.countdownText, item.boarded && styles.countdownTextBoarded]}
                numberOfLines={1}
              >
                {countdownLabel}
              </Text>
            </View>
          ) : null}

          <View style={styles.metaPill}>
            <Text style={styles.metaPillText} numberOfLines={1}>
              {boarding.length === 0
                ? s.connection.walkAll
                : s.connection.transfers(item.transfers)}
            </Text>
          </View>
        </View>

        <View style={styles.durationPill}>
          <Clock3 size={14} color={scheme.onSecondaryContainer} />
          <Text style={styles.durationText}>{s.common.durMin(item.durationMin)}</Text>
        </View>
      </View>

      {/* 2. Dwie karty punktów końcowych połączone okrągłym łącznikiem kierunku */}
      <View style={[styles.endpointsWrap, stacked && styles.endpointsWrapStacked]}>
        <View style={styles.endpointBox}>
          <Text style={styles.endpointTag} numberOfLines={1}>
            {item.boarded
              ? s.connection.inVehicleNow
              : firstVehicle
                ? s.routeDetails.vehicleDeparture
                : s.routeDetails.departure}
          </Text>
          <RollingTime value={departure} style={styles.time} />
          {departureDelay !== 0 && (
            <View
              style={[
                styles.delayBadge,
                departureDelay > 0 ? styles.delayBadgeLate : styles.delayBadgeEarly,
              ]}
              accessibilityLiveRegion="polite"
            >
              <Text
                style={[
                  styles.delayBadgeText,
                  {
                    color:
                      departureDelay > 0
                        ? scheme.onErrorContainer
                        : scheme.onWarningContainer,
                  },
                ]}
                numberOfLines={1}
              >
                {departureDelay > 0
                  ? s.routeDetails.late(departureDelay)
                  : s.routeDetails.early(-departureDelay)}
              </Text>
            </View>
          )}
          <Text style={styles.place} numberOfLines={2}>
            {item.boarded ? item.fromTitle : (firstVehicle?.fromStop ?? item.fromTitle)}
          </Text>
        </View>

        <View style={[styles.connectorBadge, stacked && styles.connectorBadgeStacked]}>
          <Direction size={18} color={scheme.onSecondaryContainer} />
        </View>

        <View style={styles.endpointBox}>
          <Text style={styles.endpointTag} numberOfLines={1}>
            {s.routeDetails.arrival}
          </Text>
          <RollingTime value={item.arriveAt} style={styles.time} />
          {arrivalDelay !== 0 &&
            (item.boarded || arrivalDelay !== departureDelay) && (
              <View
                style={[
                  styles.delayBadge,
                  arrivalDelay > 0 ? styles.delayBadgeLate : styles.delayBadgeEarly,
                ]}
                accessibilityLiveRegion="polite"
              >
                <Text
                  style={[
                    styles.delayBadgeText,
                    {
                      color:
                        arrivalDelay > 0
                          ? scheme.onErrorContainer
                          : scheme.onWarningContainer,
                    },
                  ]}
                  numberOfLines={1}
                >
                  {arrivalDelay > 0
                    ? s.routeDetails.late(arrivalDelay)
                    : s.routeDetails.early(-arrivalDelay)}
                </Text>
              </View>
            )}
          <Text style={styles.place} numberOfLines={2}>
            {item.toTitle}
          </Text>
        </View>
      </View>
    </>
  );

  if (!hasTransform) {
    return (
      <View style={styles.summary}>
        <View style={styles.content}>{innerContent}</View>
      </View>
    );
  }

  return (
    <Animated.View style={[styles.summary, containerAnimatedStyle]}>
      <Animated.View style={[styles.content, contentAnimatedStyle]}>
        {innerContent}
      </Animated.View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  summary: {
    padding: 14,
    backgroundColor: scheme.surfaceContainer,
    borderRadius: shape.extraLarge,
    ...elev.level1,
  },
  content: {
    gap: 10,
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    flexWrap: 'wrap',
  },
  topPillsLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 6,
    flex: 1,
  },
  countdownPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: scheme.primaryContainer,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: shape.full,
  },
  countdownPillBoarded: {
    backgroundColor: scheme.tertiaryContainer,
  },
  countdownText: {
    ...type.labelMedium,
    fontWeight: '700',
    color: scheme.onPrimaryContainer,
  },
  countdownTextBoarded: {
    color: scheme.onTertiaryContainer,
  },
  metaPill: {
    backgroundColor: scheme.surfaceContainerLow,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: shape.full,
  },
  metaPillText: {
    ...type.labelSmall,
    fontWeight: '600',
    color: scheme.onSurfaceVariant,
  },
  durationPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: scheme.secondaryContainer,
    paddingHorizontal: 11,
    paddingVertical: 5,
    borderRadius: shape.full,
  },
  durationText: {
    ...type.labelLarge,
    fontWeight: '800',
    color: scheme.onSecondaryContainer,
    fontVariant: ['tabular-nums'],
  },
  endpointsWrap: {
    flexDirection: 'row',
    alignItems: 'stretch',
    gap: 8,
  },
  endpointsWrapStacked: {
    flexDirection: 'column',
  },
  endpointBox: {
    flex: 1,
    minWidth: 0,
    backgroundColor: scheme.surfaceContainerLow,
    borderRadius: shape.large,
    paddingHorizontal: 13,
    paddingVertical: 12,
    gap: 4,
  },
  endpointTag: {
    ...type.labelSmall,
    fontWeight: '700',
    color: scheme.onSurfaceVariant,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  time: {
    fontSize: 32,
    lineHeight: 36,
    fontWeight: '800',
    letterSpacing: -1.1,
    color: scheme.onSurface,
    fontVariant: ['tabular-nums'],
    includeFontPadding: false,
  },
  delayBadge: {
    alignSelf: 'flex-start',
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: shape.small,
  },
  delayBadgeLate: {
    backgroundColor: scheme.errorContainer,
  },
  delayBadgeEarly: {
    backgroundColor: scheme.warningContainer,
  },
  delayBadgeText: {
    ...type.labelSmall,
    fontWeight: '700',
    fontSize: 11,
    lineHeight: 14,
  },
  place: {
    ...type.bodyMedium,
    fontWeight: '700',
    color: scheme.onSurface,
    lineHeight: 19,
    marginTop: 2,
  },
  connectorBadge: {
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'center',
  },
  connectorBadgeStacked: {
    marginVertical: -2,
  },
});
