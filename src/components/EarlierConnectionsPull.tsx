import { memo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, {
  Extrapolation,
  interpolate,
  interpolateColor,
  useAnimatedStyle,
  useDerivedValue,
  withSpring,
  type SharedValue,
} from 'react-native-reanimated';
import { ChevronDown } from './icons';
import { MorphingLoader } from './MorphingLoader';
import { useStrings } from '../i18n';
import { EARLIER_PULL_ARM } from '../services/earlierPull';
import { motion } from '../theme/motion';
import { scheme, shape, type } from '../theme/tokens';

interface EarlierConnectionsPullProps {
  pullHeight: SharedValue<number>;
  armed: SharedValue<boolean>;
  armPulse: SharedValue<number>;
  loading: boolean;
  noMore: boolean;
  reduceMotion: boolean;
}

/**
 * Panel wczytywania wcześniejszych połączeń odsłaniany pociągnięciem listy w dół.
 * Cała reakcja na gest działa na wątku UI (GPU transform + kolory M3 Expressive).
 */
export const EarlierConnectionsPull = memo(function EarlierConnectionsPull({
  pullHeight,
  armed,
  armPulse,
  loading,
  noMore,
  reduceMotion,
}: EarlierConnectionsPullProps) {
  const s = useStrings();

  const armedProgress = useDerivedValue(() => {
    const target = !loading && !noMore && armed.value ? 1 : 0;
    return reduceMotion ? target : withSpring(target, motion.spring.effectsFast);
  }, [loading, noMore, reduceMotion]);

  const containerStyle = useAnimatedStyle(() => {
    const h = Math.max(0, pullHeight.value);
    return {
      height: h,
      opacity: interpolate(h, [4, 24], [0, 1], Extrapolation.CLAMP),
    };
  });

  const pillStyle = useAnimatedStyle(() => {
    const h = Math.max(0, pullHeight.value);
    const baseScale = reduceMotion
      ? 1
      : interpolate(h, [0, EARLIER_PULL_ARM], [0.9, 1], Extrapolation.CLAMP) +
        armPulse.value * 0.045;
    return {
      transform: [{ scale: baseScale }],
      backgroundColor: interpolateColor(
        armedProgress.value,
        [0, 1],
        [scheme.surfaceContainerHigh, scheme.primaryContainer],
      ),
      borderColor: interpolateColor(
        armedProgress.value,
        [0, 1],
        [scheme.outlineVariant, scheme.primary],
      ),
    };
  });

  const arrowStyle = useAnimatedStyle(() => {
    const pullRot = reduceMotion
      ? 0
      : interpolate(pullHeight.value, [12, EARLIER_PULL_ARM], [0, 35], Extrapolation.CLAMP);
    const armedRot = armedProgress.value * 180;
    return {
      transform: [{ rotate: `${Math.min(180, pullRot + armedRot)}deg` }],
    };
  });

  const idleLayerStyle = useAnimatedStyle(() => ({
    opacity: 1 - armedProgress.value,
  }));

  const armedLayerStyle = useAnimatedStyle(() => ({
    opacity: armedProgress.value,
  }));

  return (
    <Animated.View
      style={[styles.wrap, containerStyle]}
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <Animated.View style={[styles.pill, pillStyle]}>
        {loading ? (
          <>
            <MorphingLoader size={17} color={scheme.primary} />
            <Text style={styles.label} numberOfLines={1}>
              {s.routes.earlierLoading}
            </Text>
          </>
        ) : noMore ? (
          <Text style={styles.labelMuted} numberOfLines={1}>
            {s.routes.earlierEmpty}
          </Text>
        ) : (
          <>
            <Animated.View style={[styles.iconBox, arrowStyle]}>
              <Animated.View style={[StyleSheet.absoluteFill, styles.center, idleLayerStyle]}>
                <ChevronDown size={17} color={scheme.onSurfaceVariant} />
              </Animated.View>
              <Animated.View style={[StyleSheet.absoluteFill, styles.center, armedLayerStyle]}>
                <ChevronDown size={17} color={scheme.onPrimaryContainer} />
              </Animated.View>
            </Animated.View>
            <View style={styles.labelStack}>
              <Animated.Text style={[styles.label, idleLayerStyle]} numberOfLines={1}>
                {s.routes.earlierPullHint}
              </Animated.Text>
              <Animated.Text
                style={[styles.label, styles.labelArmed, styles.labelOverlay, armedLayerStyle]}
                numberOfLines={1}
              >
                {s.routes.earlierReleaseHint}
              </Animated.Text>
            </View>
          </>
        )}
      </Animated.View>
    </Animated.View>
  );
});

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    zIndex: 1,
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    minHeight: 38,
    maxWidth: '90%',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: shape.full,
    borderWidth: 2,
  },
  iconBox: {
    width: 18,
    height: 18,
    position: 'relative',
  },
  center: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  labelStack: {
    position: 'relative',
    justifyContent: 'center',
    flexShrink: 1,
  },
  label: {
    ...type.labelLarge,
    fontWeight: '600',
    color: scheme.onSurfaceVariant,
  },
  labelArmed: {
    color: scheme.onPrimaryContainer,
    fontWeight: '700',
  },
  labelOverlay: {
    position: 'absolute',
    left: 0,
    right: 0,
  },
  labelMuted: {
    ...type.labelMedium,
    fontWeight: '600',
    color: scheme.onSurfaceVariant,
  },
});
