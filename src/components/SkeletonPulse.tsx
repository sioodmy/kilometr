import { memo, useEffect, useState, type ReactNode } from 'react';
import {
  StyleSheet,
  View,
  type DimensionValue,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import Animated, {
  Easing,
  ReduceMotion,
  cancelAnimation,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import { scheme, shape } from '../theme/tokens';

const PULSE_HALF_MS = 780;

const SkeletonPulseAnimated = memo(function SkeletonPulseAnimated({
  children,
  style,
}: {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  const opacity = useSharedValue(0.86);

  useEffect(() => {
    opacity.value = withRepeat(
      withSequence(
        withTiming(0.42, {
          duration: PULSE_HALF_MS,
          easing: Easing.inOut(Easing.ease),
          reduceMotion: ReduceMotion.System,
        }),
        withTiming(0.86, {
          duration: PULSE_HALF_MS,
          easing: Easing.inOut(Easing.ease),
          reduceMotion: ReduceMotion.System,
        }),
      ),
      -1,
      false,
    );
    return () => {
      cancelAnimation(opacity);
    };
  }, [opacity]);

  const animStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
  }));

  return <Animated.View style={[style, animStyle]}>{children}</Animated.View>;
});

/**
 * Wspólny kontener loading state dla mock elementów graficznych.
 * Tworzy tylko jeden lekki worklet opacity dla całej grupy kości, a przy
 * włączonym ograniczeniu ruchu renderuje statyczny kontener bez Reanimated.
 */
export const SkeletonPulse = memo(function SkeletonPulse({
  children,
  style,
  accessibilityLabel,
}: {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
}) {
  const reduceMotion = useReducedMotion();
  const a11yProps = accessibilityLabel
    ? { accessible: true as const, accessibilityLabel }
    : {
        accessibilityElementsHidden: true as const,
        importantForAccessibility: 'no-hide-descendants' as const,
      };

  if (reduceMotion) {
    return (
      <View {...a11yProps} style={[styles.staticPulse, style]}>
        {children}
      </View>
    );
  }

  return (
    <View {...a11yProps}>
      <SkeletonPulseAnimated style={style}>{children}</SkeletonPulseAnimated>
    </View>
  );
});

/** Pojedynczy mock element (pasek, ikona lub pigułka) wewnątrz SkeletonPulse. */
export const SkeletonBone = memo(function SkeletonBone({
  width,
  height,
  radius = shape.small,
  tone = 'default',
  style,
}: {
  width: DimensionValue;
  height: number;
  radius?: number;
  tone?: 'default' | 'subtle';
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <View
      style={[
        tone === 'subtle' ? styles.boneSubtle : styles.boneDefault,
        { width, height, borderRadius: radius },
        style,
      ]}
    />
  );
});

/**
 * Odkłada montaż ciężkich elementów graficznych o zadaną liczbę klatek
 * po aktywacji, rozkładając pracę na kilka ramek zamiast jednej ciężkiej klatki.
 */
export function useDeferredReveal(active: boolean, frames = 1): boolean {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!active) {
      setReady(false);
      return;
    }
    let cancelled = false;
    let remaining = Math.max(1, frames);
    let rafId: number | null = null;

    const tick = () => {
      if (cancelled) return;
      remaining -= 1;
      if (remaining <= 0) {
        rafId = null;
        setReady(true);
        return;
      }
      rafId = requestAnimationFrame(tick);
    };

    rafId = requestAnimationFrame(tick);
    return () => {
      cancelled = true;
      if (rafId !== null) cancelAnimationFrame(rafId);
    };
  }, [active, frames]);

  return ready;
}

const styles = StyleSheet.create({
  staticPulse: {
    opacity: 0.72,
  },
  boneDefault: {
    backgroundColor: scheme.surfaceContainerHighest,
  },
  boneSubtle: {
    backgroundColor: scheme.surfaceContainerHigh,
  },
});
