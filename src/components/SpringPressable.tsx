import { useCallback } from 'react';
import {
  Pressable,
  type GestureResponderEvent,
  type PressableProps,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';
import { hapticSelection, hapticTap } from '../services/haptics';
import { motion } from '../theme/motion';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

export interface SpringPressableProps extends Omit<PressableProps, 'style'> {
  style?: StyleProp<ViewStyle>;
  scaleDelta?: number;
  opacityDelta?: number;
  haptic?: 'selection' | 'light' | false;
}

/** Przycisk z natychmiastową, sprężystą reakcją M3 Expressive na wątku UI. */
export function SpringPressable({
  children,
  style,
  scaleDelta = 0.025,
  opacityDelta = 0.08,
  haptic = false,
  disabled,
  onPress,
  onPressIn,
  onPressOut,
  ...rest
}: SpringPressableProps) {
  const press = useSharedValue(0);

  const animStyle = useAnimatedStyle(() => ({
    transform: [{ scale: 1 - press.value * scaleDelta }],
    opacity: 1 - press.value * opacityDelta,
  }));

  const handlePressIn = useCallback(
    (e: GestureResponderEvent) => {
      if (!disabled) {
        press.value = withSpring(1, motion.spring.press);
      }
      onPressIn?.(e);
    },
    [disabled, onPressIn, press],
  );

  const handlePressOut = useCallback(
    (e: GestureResponderEvent) => {
      press.value = withSpring(0, motion.spring.press);
      onPressOut?.(e);
    },
    [onPressOut, press],
  );

  const handlePress = useCallback(
    (e: GestureResponderEvent) => {
      if (!disabled && haptic) {
        if (haptic === 'selection') {
          hapticSelection();
        } else {
          hapticTap();
        }
      }
      onPress?.(e);
    },
    [disabled, haptic, onPress],
  );

  return (
    <AnimatedPressable
      {...rest}
      disabled={disabled}
      onPress={onPress ? handlePress : undefined}
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
      style={[animStyle, style]}
    >
      {children}
    </AnimatedPressable>
  );
}
