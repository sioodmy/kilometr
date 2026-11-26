import { useCallback } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, {
  Easing,
  FadeIn,
  FadeOut,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { Anchor, ArrowUpDown, X } from './icons';
import { LineBadge } from './LineBadge';
import { SpringPressable } from './SpringPressable';
import { useStrings } from '../i18n';
import { motion } from '../theme/motion';
import { elev, scheme, shape, type } from '../theme/tokens';
import type { BoardedTripOrigin } from '../types/models';

// Krzywe bezier działają natywnie także w Reanimated na Web (bez fallbacku do linear).
const SWAP_IN = FadeIn.duration(140).easing(motion.enter.easing);
const SWAP_OUT = FadeOut.duration(90).easing(motion.exit.easing);

/** Karta początku i celu trasy z szyną relacji i obrotowym przyciskiem zamiany kierunków. */
export function RouteEndpoints({
  from,
  to,
  fromLabel,
  onFrom,
  onTo,
  onSwap,
  anchor,
  boarded,
}: {
  from: string;
  to: string;
  fromLabel: string;
  onFrom: () => void;
  onTo: () => void;
  onSwap: () => void;
  anchor?: { stopName: string; onDismiss: () => void; dismissA11y: string };
  boarded?: {
    line: string;
    mode: BoardedTripOrigin['mode'];
    onDismiss: () => void;
    dismissA11y: string;
  };
}) {
  const s = useStrings();
  const reduceMotion = useReducedMotion();
  const swapSpin = useSharedValue(0);
  const swapKick = useSharedValue(0);

  const handleSwap = useCallback(() => {
    if (!reduceMotion) {
      swapSpin.value = withSpring(swapSpin.value + 180, motion.spring.spatialFast);
      swapKick.value = withSequence(
        withTiming(1, { duration: 75, easing: Easing.out(Easing.quad) }),
        withSpring(0, motion.spring.spatialFast),
      );
    }
    onSwap();
  }, [onSwap, reduceMotion, swapKick, swapSpin]);

  const swapIconStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${swapSpin.value}deg` }],
  }));

  const fromShiftStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: swapKick.value * 5 }],
  }));

  const toShiftStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: -swapKick.value * 5 }],
  }));

  return (
    <View style={styles.container}>
      <View
        style={styles.railCol}
        accessible={false}
        importantForAccessibility="no-hide-descendants"
      >
        <View style={[styles.railDotStart, (anchor || boarded) && styles.railDotAnchored]} />
        <View style={styles.railConnector}>
          <View style={styles.railConnectorDot} />
          <View style={styles.railConnectorDot} />
          <View style={styles.railConnectorDot} />
        </View>
        <View style={styles.railDotEnd} />
      </View>

      <View style={styles.fields}>
        {boarded || anchor ? (
          // Dwa sąsiednie przyciski zamiast zagnieżdżonego <button> w <button> na Web.
          <View style={styles.field}>
            <SpringPressable
              onPress={onFrom}
              scaleDelta={0.014}
              opacityDelta={0.07}
              haptic="selection"
              accessibilityRole="button"
              accessibilityLabel={fromLabel}
            >
              <Text style={styles.label} numberOfLines={1}>
                {s.routeDetails.origin}
              </Text>
            </SpringPressable>
            {boarded ? (
              <Animated.View
                key="boarded"
                style={[styles.anchorPill, fromShiftStyle]}
                entering={SWAP_IN}
                exiting={SWAP_OUT}
              >
                <SpringPressable
                  onPress={onFrom}
                  accessibilityRole="button"
                  accessibilityLabel={fromLabel}
                  style={styles.anchorMainTap}
                  scaleDelta={0.014}
                  opacityDelta={0.07}
                  haptic="selection"
                >
                  <LineBadge mode={boarded.mode} line={boarded.line} compact />
                  <View style={styles.anchorSpacer} />
                </SpringPressable>
                <SpringPressable
                  onPress={boarded.onDismiss}
                  accessibilityRole="button"
                  accessibilityLabel={boarded.dismissA11y}
                  style={styles.anchorX}
                  hitSlop={10}
                  scaleDelta={0.06}
                  haptic="selection"
                >
                  <X size={14} color={scheme.onSurface} />
                </SpringPressable>
              </Animated.View>
            ) : anchor ? (
              <Animated.View
                key="anchor"
                style={[styles.anchorPill, fromShiftStyle]}
                entering={SWAP_IN}
                exiting={SWAP_OUT}
              >
                <SpringPressable
                  onPress={onFrom}
                  accessibilityRole="button"
                  accessibilityLabel={fromLabel}
                  style={styles.anchorMainTap}
                  scaleDelta={0.014}
                  opacityDelta={0.07}
                  haptic="selection"
                >
                  <Anchor size={13} color={scheme.onPrimaryContainer} />
                  <Text style={styles.originAnchor} numberOfLines={1}>
                    {anchor.stopName}
                  </Text>
                </SpringPressable>
                <SpringPressable
                  onPress={anchor.onDismiss}
                  accessibilityRole="button"
                  accessibilityLabel={anchor.dismissA11y}
                  style={styles.anchorX}
                  hitSlop={10}
                  scaleDelta={0.06}
                  haptic="selection"
                >
                  <X size={14} color={scheme.onSurface} />
                </SpringPressable>
              </Animated.View>
            ) : null}
          </View>
        ) : (
          <SpringPressable
            onPress={onFrom}
            scaleDelta={0.014}
            opacityDelta={0.07}
            haptic="selection"
            accessibilityRole="button"
            accessibilityLabel={fromLabel}
            style={styles.field}
          >
            <Text style={styles.label} numberOfLines={1}>
              {s.routeDetails.origin}
            </Text>
            <Animated.View key="gps" style={fromShiftStyle} entering={SWAP_IN} exiting={SWAP_OUT}>
              <Text style={styles.origin} numberOfLines={1}>
                {from}
              </Text>
            </Animated.View>
          </SpringPressable>
        )}

        <View style={styles.divider} />

        <SpringPressable
          onPress={onTo}
          scaleDelta={0.014}
          opacityDelta={0.07}
          haptic="selection"
          accessibilityRole="button"
          accessibilityLabel={s.routes.changeToA11y(to)}
          style={styles.field}
        >
          <Text style={styles.label} numberOfLines={1}>
            {s.routeDetails.destination}
          </Text>
          <Animated.View style={toShiftStyle}>
            <Text style={styles.destination} numberOfLines={1}>
              {to}
            </Text>
          </Animated.View>
        </SpringPressable>
      </View>

      <SpringPressable
        onPress={handleSwap}
        accessibilityRole="button"
        accessibilityLabel={s.routes.swapA11y}
        style={styles.swap}
        scaleDelta={0.06}
        haptic="light"
      >
        <Animated.View style={swapIconStyle}>
          <ArrowUpDown size={20} color={scheme.onSecondaryContainer} />
        </Animated.View>
      </SpringPressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: scheme.surfaceContainer,
    borderRadius: shape.extraLarge,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: scheme.outlineVariant,
    paddingHorizontal: 14,
    paddingVertical: 10,
    ...elev.level1,
  },
  railCol: {
    width: 14,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    gap: 5,
  },
  railDotStart: {
    width: 10,
    height: 10,
    borderRadius: 5,
    borderWidth: 2.5,
    borderColor: scheme.primary,
    backgroundColor: scheme.surfaceContainer,
  },
  railDotAnchored: {
    borderColor: scheme.tertiary,
  },
  railConnector: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    paddingVertical: 2,
  },
  railConnectorDot: {
    width: 3,
    height: 3,
    borderRadius: 1.5,
    backgroundColor: scheme.outline,
  },
  railDotEnd: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: scheme.primary,
  },
  fields: {
    flex: 1,
    minWidth: 0,
  },
  field: {
    minHeight: 46,
    justifyContent: 'center',
    gap: 2,
    paddingVertical: 3,
    paddingHorizontal: 4,
    borderRadius: shape.medium,
  },
  label: {
    ...type.labelSmall,
    color: scheme.onSurfaceVariant,
    fontWeight: '600',
    letterSpacing: 0.2,
  },
  origin: {
    ...type.titleMedium,
    fontWeight: '600',
    color: scheme.onSurface,
  },
  destination: {
    ...type.titleMedium,
    fontWeight: '700',
    color: scheme.onSurface,
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: scheme.outlineVariant,
    marginVertical: 4,
    marginHorizontal: 4,
  },
  swap: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: shape.full,
    backgroundColor: scheme.secondaryContainer,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: scheme.outlineVariant,
  },
  anchorPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 2,
    backgroundColor: scheme.primaryContainer,
    borderRadius: shape.full,
    paddingLeft: 10,
    paddingRight: 4,
    paddingVertical: 3,
    minHeight: 30,
  },
  anchorMainTap: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  originAnchor: {
    ...type.labelMedium,
    fontWeight: '700',
    color: scheme.onPrimaryContainer,
    flex: 1,
    minWidth: 0,
  },
  anchorSpacer: {
    flex: 1,
  },
  anchorX: {
    width: 24,
    height: 24,
    borderRadius: shape.full,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: scheme.surfaceContainerLow,
  },
});
