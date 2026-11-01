import { useEffect } from 'react';
import { StyleSheet, Text, View, useWindowDimensions } from 'react-native';
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
import { scheme, shape, type } from '../theme/tokens';
import { motion } from '../theme/motion';
import type { Connection } from '../types/models';
import { RollingTime } from './RollingTime';
import { boardingDepartureSec, scheduledLegTimes } from '../services/routing/connectionTimes';
import { secondsToTimeString } from '../gtfs/geo';
import { isFallbackOrigin } from '../config';

export function ConnectionSummary({
  item,
  offline = false,
  availableWidth,
  fromY,
  _fromH,
}: {
  item: Connection;
  offline?: boolean;
  availableWidth?: number;
  fromY?: number;
  fromH?: number;
}) {
  const s = useStrings();
  const insets = useSafeAreaInsets();
  const reduceMotion = useReducedMotion();
  const { width, fontScale } = useWindowDimensions();
  const stacked = ((availableWidth ?? width - 32) - 44) / fontScale < 280;
  const boarding = item.legs.filter((leg) => leg.mode !== 'walk');
  const firstVehicle = boarding[0];
  const departureSec = boardingDepartureSec(item);
  const departure = firstVehicle ? secondsToTimeString(departureSec) : item.departAt;
  const scheduled = firstVehicle
    ? scheduledLegTimes(firstVehicle, departureSec).departure
    : undefined;
  const departureDelay =
    firstVehicle?.live && !offline ? Math.round((firstVehicle.delaySec ?? 0) / 60) : 0;
  const hasApproach = item.legs[0]?.mode === 'walk' && firstVehicle != null;
  const Direction = stacked ? ArrowDown : ArrowRight;

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
    const borderRadius = interpolate(progress.value, [0, 1], [shape.large, shape.extraLarge]);

    return {
      transform: [{ translateY }],
      borderRadius,
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

  return (
    <Animated.View style={[styles.summary, containerAnimatedStyle]}>
      <Animated.View style={[styles.content, contentAnimatedStyle]}>
        <View style={[styles.endpoints, stacked && styles.endpointsStacked]}>
          <View style={styles.endpoint}>
            <Text style={styles.label}>
              {firstVehicle ? s.routeDetails.vehicleDeparture : s.routeDetails.departure}
            </Text>
            <RollingTime value={departure} style={styles.time} />
            {departureDelay !== 0 && scheduled != null && (
              <View style={styles.delayDetails} accessibilityLiveRegion="polite">
                <Text style={styles.label}>
                  {s.routeDetails.scheduledTime(secondsToTimeString(scheduled))}
                </Text>
                <Text
                  style={[
                    styles.status,
                    { color: departureDelay > 0 ? scheme.error : scheme.warning },
                  ]}
                >
                  {departureDelay > 0
                    ? s.routeDetails.late(departureDelay)
                    : s.routeDetails.early(-departureDelay)}
                </Text>
              </View>
            )}
            <Text style={styles.place}>{firstVehicle?.fromStop ?? item.fromTitle}</Text>
          </View>
          <View style={[styles.direction, stacked && styles.directionStacked]}>
            <Direction size={30} color={scheme.primary} />
          </View>
          <View style={styles.endpoint}>
            <Text style={styles.label}>{s.routeDetails.arrival}</Text>
            <RollingTime value={item.arriveAt} style={styles.time} />
            <Text style={styles.place}>{item.toTitle}</Text>
          </View>
        </View>
        {hasApproach && (
          <Text style={styles.label}>
            {isFallbackOrigin(item.fromTitle) && firstVehicle?.fromStop
              ? s.routeDetails.walkDepartureTo(item.departAt, firstVehicle.fromStop)
              : s.routeDetails.walkDeparture(item.departAt, item.fromTitle)}
          </Text>
        )}
        <View style={styles.facts}>
          <View style={styles.fact}>
            <Clock3 size={17} color={scheme.primary} />
            <Text style={styles.duration}>{s.common.durMin(item.durationMin)}</Text>
          </View>
          <Text style={styles.label}>
            {boarding.length === 0 ? s.connection.walkAll : s.connection.transfers(item.transfers)}
          </Text>
        </View>
      </Animated.View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  summary: {
    padding: 22,
    backgroundColor: scheme.surfaceContainerLow,
    borderRadius: shape.extraLarge,
  },
  content: {
    gap: 22,
  },
  endpoints: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  endpointsStacked: { flexDirection: 'column' },
  endpoint: { flex: 1, minWidth: 0, gap: 6 },
  delayDetails: { gap: 4 },
  label: { ...type.bodyMedium, color: scheme.onSurfaceVariant },
  time: {
    fontSize: 38,
    fontWeight: '600',
    letterSpacing: -1.5,
    color: scheme.onSurface,
    fontVariant: ['tabular-nums'],
    includeFontPadding: false,
  },
  place: { ...type.bodyLarge, fontWeight: '500', color: scheme.onSurface, lineHeight: 23 },
  direction: { paddingTop: 31 },
  directionStacked: { paddingTop: 0 },
  facts: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', columnGap: 18, rowGap: 8 },
  fact: { flexDirection: 'row', alignItems: 'center', gap: 7, flexShrink: 1 },
  duration: { ...type.titleMedium, fontWeight: '600', color: scheme.onSurface },
  status: { ...type.bodySmall, flexShrink: 1 },
});
