import React from 'react';
import {
  Pressable,
  type PressableProps,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import Animated, {
  ReduceMotion,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

const SPRING_CONFIG = {
  damping: 24,
  stiffness: 420,
  reduceMotion: ReduceMotion.System,
} as const;

export interface SpringPressableProps extends Omit<PressableProps, 'style'> {
  style?: StyleProp<ViewStyle>;
  scaleDelta?: number;
  opacityDelta?: number;
}

export function SpringPressable({
  children,
  style,
  scaleDelta = 0.025,
  opacityDelta = 0.1,
  disabled,
  onPressIn,
  onPressOut,
  ...rest
}: SpringPressableProps) {
  const press = useSharedValue(0);

  const animStyle = useAnimatedStyle(() => ({
    transform: [{ scale: 1 - press.value * scaleDelta }],
    opacity: 1 - press.value * opacityDelta,
  }));

  const setPressed = (val: number) => {
    press.value = withSpring(val, SPRING_CONFIG);
  };

  return (
    <AnimatedPressable
      {...rest}
      disabled={disabled}
      onPressIn={(e) => {
        if (!disabled) setPressed(1);
        onPressIn?.(e);
      }}
      onPressOut={(e) => {
        setPressed(0);
        onPressOut?.(e);
      }}
      style={[animStyle, style]}
    >
      {children}
    </AnimatedPressable>
  );
}
