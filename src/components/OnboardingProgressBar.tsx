import { memo, useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  interpolateColor,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { ChevronLeft } from './icons';
import { SpringPressable } from './SpringPressable';
import { motion } from '../theme/motion';
import { scheme, shape } from '../theme/tokens';
import { useStrings } from '../i18n';

const StepSegment = memo(function StepSegment({
  state,
}: {
  /** 0 = przyszły, 1 = ukończony, 2 = aktywny */
  state: 0 | 1 | 2;
}) {
  const reduceMotion = useReducedMotion();
  const tone = useSharedValue(state);

  useEffect(() => {
    if (reduceMotion) {
      tone.value = state;
      return;
    }
    tone.value = withTiming(state, motion.state);
  }, [reduceMotion, state, tone]);

  const animStyle = useAnimatedStyle(() => ({
    backgroundColor: interpolateColor(
      tone.value,
      [0, 1, 2],
      [scheme.surfaceContainerHighest, scheme.primaryContainer, scheme.primary],
    ),
  }));

  return <Animated.View style={[styles.segment, state === 2 && styles.segmentActive, animStyle]} />;
});

interface OnboardingProgressBarProps {
  step: number;
  onBack: () => void;
}

/** Minimalistyczny pasek kroków onboardingu: cienkie segmenty i przycisk wstecz. */
export const OnboardingProgressBar = memo(function OnboardingProgressBar({
  step,
  onBack,
}: OnboardingProgressBarProps) {
  const s = useStrings();
  const steps = s.onboarding.steps;
  const total = steps.length;
  const stepName = steps[step] ?? '';

  return (
    <View style={styles.bar}>
      <View style={styles.sideSlot}>
        {step > 0 ? (
          <SpringPressable
            onPress={onBack}
            haptic="selection"
            scaleDelta={0.05}
            style={styles.backBtn}
            accessibilityRole="button"
            accessibilityLabel={s.onboarding.backA11y}
          >
            <ChevronLeft size={22} color={scheme.onSurface} />
          </SpringPressable>
        ) : null}
      </View>

      <View style={styles.trackWrap}>
        <View
          style={styles.track}
          accessible
          accessibilityRole="progressbar"
          accessibilityLabel={s.onboarding.stepOf(step + 1, total, stepName)}
          accessibilityValue={{ min: 1, max: total, now: step + 1 }}
        >
          {steps.map((label, i) => (
            <StepSegment key={label} state={i === step ? 2 : i < step ? 1 : 0} />
          ))}
        </View>
      </View>

      <View style={styles.sideSlot} />
    </View>
  );
});

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 4,
    minHeight: 56,
    gap: 12,
  },
  sideSlot: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  backBtn: {
    width: 44,
    height: 44,
    borderRadius: shape.full,
    backgroundColor: scheme.surfaceContainerLow,
    alignItems: 'center',
    justifyContent: 'center',
  },
  trackWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  track: {
    width: '100%',
    maxWidth: 112,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  segment: {
    flex: 1,
    height: 4,
    borderRadius: shape.full,
  },
  segmentActive: {
    flex: 2.2,
  },
});
