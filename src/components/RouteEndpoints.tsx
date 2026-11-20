import { useCallback } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, {
  Easing,
  FadeIn,
  FadeOut,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';
import { Anchor, ArrowUpDown, X } from './icons';
import { LineBadge } from './LineBadge';
import { SpringPressable } from './SpringPressable';
import { useStrings } from '../i18n';
import { motion } from '../theme/motion';
import { scheme, shape, type } from '../theme/tokens';
import type { BoardedTripOrigin } from '../types/models';

// Kotwica i GPS podmieniają się w tym samym polu: krótki crossfade bez sprężyny.
const SWAP_IN = FadeIn.duration(140).easing(Easing.out(Easing.quad));
const SWAP_OUT = FadeOut.duration(90).easing(Easing.in(Easing.quad));

/** Karta początku i celu trasy z obrotowym przyciskiem zamiany kierunków M3 Expressive. */
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

  const handleSwap = useCallback(() => {
    if (!reduceMotion) {
      swapSpin.value = withSpring(swapSpin.value + 180, motion.spring.spatialFast);
    }
    onSwap();
  }, [onSwap, reduceMotion, swapSpin]);

  const swapIconStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${swapSpin.value}deg` }],
  }));

  return (
    <View style={styles.container}>
      <View style={styles.fields}>
        <SpringPressable
          onPress={onFrom}
          scaleDelta={0.014}
          opacityDelta={0.07}
          haptic="selection"
          accessibilityRole="button"
          accessibilityLabel={fromLabel}
          style={styles.field}
        >
          <Text style={styles.label}>{s.routeDetails.origin}</Text>
          {boarded ? (
            <Animated.View
              key="boarded"
              style={styles.anchorRow}
              entering={SWAP_IN}
              exiting={SWAP_OUT}
            >
              <LineBadge mode={boarded.mode} line={boarded.line} compact />
              <View style={styles.anchorSpacer} />
              <SpringPressable
                onPress={boarded.onDismiss}
                accessibilityRole="button"
                accessibilityLabel={boarded.dismissA11y}
                style={styles.anchorX}
                scaleDelta={0.06}
                haptic="selection"
              >
                <X size={15} color={scheme.onSurfaceVariant} />
              </SpringPressable>
            </Animated.View>
          ) : anchor ? (
            <Animated.View
              key="anchor"
              style={styles.anchorRow}
              entering={SWAP_IN}
              exiting={SWAP_OUT}
            >
              <Anchor size={13} color={scheme.primary} />
              <Text style={styles.originAnchor} numberOfLines={1}>
                {anchor.stopName}
              </Text>
              <SpringPressable
                onPress={anchor.onDismiss}
                accessibilityRole="button"
                accessibilityLabel={anchor.dismissA11y}
                style={styles.anchorX}
                scaleDelta={0.06}
                haptic="selection"
              >
                <X size={15} color={scheme.onSurfaceVariant} />
              </SpringPressable>
            </Animated.View>
          ) : (
            <Animated.View key="gps" entering={SWAP_IN} exiting={SWAP_OUT}>
              <Text style={styles.origin} numberOfLines={1}>
                {from}
              </Text>
            </Animated.View>
          )}
        </SpringPressable>
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
          <Text style={styles.label}>{s.routeDetails.destination}</Text>
          <Text style={styles.destination}>{to}</Text>
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
          <ArrowUpDown size={22} color={scheme.primary} />
        </Animated.View>
      </SpringPressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: scheme.surfaceContainerLow,
    borderRadius: shape.extraLarge,
    padding: 16,
  },
  fields: { flex: 1, minWidth: 0 },
  field: { minHeight: 48, justifyContent: 'center', gap: 3, borderRadius: shape.small },
  label: { ...type.bodySmall, color: scheme.onSurfaceVariant },
  origin: { ...type.titleMedium, color: scheme.onSurface },
  destination: { ...type.titleMedium, fontWeight: '600', color: scheme.onSurface },
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: scheme.outlineVariant,
    marginVertical: 8,
  },
  swap: {
    width: 48,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: shape.medium,
    backgroundColor: scheme.surfaceContainerHigh,
  },
  anchorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  originAnchor: {
    ...type.bodyMedium,
    fontWeight: '600',
    color: scheme.primary,
    flex: 1,
    minWidth: 0,
  },
  anchorSpacer: {
    flex: 1,
  },
  anchorX: {
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: scheme.surfaceContainerHighest,
  },
});
