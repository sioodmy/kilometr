import { memo, useEffect } from 'react';
import { StyleSheet, Text, View } from 'react-native';
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
import { scheme, shape, type } from '../theme/tokens';
import { useStrings } from '../i18n';

const StepPill = memo(function StepPill({
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

  // Grubość zależy wprost od propsa, nie od animacji: dzięki temu nigdy nie ma
  // dwóch pogrubionych segmentów, nawet przy szybkim przechodzeniu krokami.
  return <Animated.View style={[styles.pill, state === 2 && styles.pillActive, animStyle]} />;
});

interface OnboardingProgressBarProps {
  step: number;
  onBack: () => void;
}

/**
 * Górny pasek postępu onboardingu: na kroku powitalnym minimalistyczne kapsułki,
 * na kolejnych krokach przycisk powrotu, animowany pasek segmentowy i czytelny licznik.
 */
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
      <View style={styles.leftSlot}>
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
            <StepPill key={label} state={i === step ? 2 : i < step ? 1 : 0} />
          ))}
        </View>
      </View>

      <View style={styles.rightSlot}>
        {step > 0 ? (
          <Text style={styles.counter} accessible={false}>
            {s.onboarding.stepCount(step + 1, total)}
          </Text>
        ) : null}
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 6,
    minHeight: 56,
    gap: 12,
  },
  leftSlot: {
    width: 44,
    height: 44,
    alignItems: 'flex-start',
    justifyContent: 'center',
  },
  rightSlot: {
    width: 44,
    height: 44,
    alignItems: 'flex-end',
    justifyContent: 'center',
  },
  backBtn: {
    width: 44,
    height: 44,
    borderRadius: shape.full,
    backgroundColor: scheme.surfaceContainerHigh,
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
    maxWidth: 184,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  pill: {
    flex: 1,
    height: 6,
    borderRadius: shape.full,
  },
  pillActive: {
    flex: 2.6,
    height: 8,
  },
  counter: {
    ...type.labelMedium,
    color: scheme.onSurfaceVariant,
    fontVariant: ['tabular-nums'],
    fontWeight: '600',
  },
});
