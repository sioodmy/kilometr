import { useEffect } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Animated, {
  interpolate,
  interpolateColor,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';
import { Check } from 'lucide-react-native';
import { scheme } from '../theme/tokens';

// ─── Material 3 Switch (Reanimated 60/120 FPS UI Thread) ─────────────────────
// Spec M3 (dark): tor 52×32 full-rounded.
// OFF: surfaceContainerHighest + 2px outline, kciuk 16px w kolorze outline.
// ON:  primary bez ramki, kciuk 24px onPrimary z ikoną check w onPrimaryContainer.
// Całość animowana płynnie na UI thread (spring z optymalnym tłumieniem).

const TRACK_W = 52;
const TRACK_H = 32;
const THUMB_OFF = 16;
const THUMB_ON = 24;
const OFF_LEFT = 6;
const ON_LEFT = TRACK_W - THUMB_ON - 5; // 23

export function M3Switch({
  value,
  onChange,
  disabled = false,
  label,
}: {
  value: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
  label?: string;
}) {
  const progress = useSharedValue(value ? 1 : 0);

  useEffect(() => {
    progress.value = withSpring(value ? 1 : 0, {
      damping: 18,
      stiffness: 170,
      mass: 0.8,
    });
  }, [value, progress]);

  const animatedTrackStyle = useAnimatedStyle(() => {
    const bg = interpolateColor(
      progress.value,
      [0, 1],
      [scheme.surfaceContainerHighest, scheme.primary],
    );
    const border = interpolateColor(
      progress.value,
      [0, 1],
      [scheme.outline, scheme.primary],
    );
    return {
      backgroundColor: bg,
      borderColor: border,
    };
  });

  const animatedThumbStyle = useAnimatedStyle(() => {
    const translateX = interpolate(progress.value, [0, 1], [0, ON_LEFT - OFF_LEFT]);
    const size = interpolate(progress.value, [0, 1], [THUMB_OFF, THUMB_ON]);
    const bg = interpolateColor(
      progress.value,
      [0, 1],
      [scheme.outline, scheme.onPrimary],
    );
    return {
      transform: [{ translateX }],
      width: size,
      height: size,
      backgroundColor: bg,
    };
  });

  const animatedCheckStyle = useAnimatedStyle(() => {
    const opacity = interpolate(progress.value, [0.3, 0.9], [0, 1]);
    const scale = interpolate(progress.value, [0.2, 1], [0.3, 1]);
    return {
      opacity,
      transform: [{ scale }],
    };
  });

  return (
    <Pressable
      onPress={() => !disabled && onChange(!value)}
      disabled={disabled}
      accessibilityRole="switch"
      accessibilityState={{ checked: value, disabled }}
      accessibilityLabel={label ?? 'Przełącznik'}
      hitSlop={8}
    >
      <Animated.View
        style={[
          styles.track,
          animatedTrackStyle,
          { opacity: disabled ? 0.5 : 1 },
        ]}
      >
        <Animated.View
          style={[
            styles.thumb,
            animatedThumbStyle,
          ]}
        >
          <Animated.View style={[styles.iconWrap, animatedCheckStyle]} pointerEvents="none">
            <Check size={14} color={scheme.primaryContainer} strokeWidth={3.5} />
          </Animated.View>
        </Animated.View>
      </Animated.View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  track: {
    width: TRACK_W,
    height: TRACK_H,
    borderRadius: TRACK_H / 2,
    borderWidth: 2,
    justifyContent: 'center',
    paddingLeft: OFF_LEFT,
  },
  thumb: {
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: THUMB_ON,
  },
  iconWrap: {
    alignItems: 'center',
    justifyContent: 'center',
  },
});
