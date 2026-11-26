import { memo, useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  Easing,
  cancelAnimation,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { Sensors } from './icons';

const LiveSensorsAnimated = memo(function LiveSensorsAnimated({
  color,
  size,
  pingKey,
}: {
  color: string;
  size: number;
  pingKey?: number | string;
}) {
  const ring1 = useSharedValue(1);
  const ring2 = useSharedValue(1);
  const iconScale = useSharedValue(1);

  useEffect(() => {
    [ring1, ring2].forEach((ring, i) => {
      cancelAnimation(ring);
      ring.value = 0;
      ring.value = withDelay(
        i * 140,
        withTiming(1, { duration: 1200, easing: Easing.out(Easing.quad) }),
      );
    });
    cancelAnimation(iconScale);
    iconScale.value = withSequence(
      withSpring(1.25, { damping: 10, stiffness: 260 }),
      withSpring(1, { damping: 12, stiffness: 200 }),
    );
    return () => {
      cancelAnimation(ring1);
      cancelAnimation(ring2);
      cancelAnimation(iconScale);
    };
  }, [ring1, ring2, iconScale, pingKey]);

  const r1Style = useAnimatedStyle(() => {
    const p = Math.min(1, Math.max(0, ring1.value));
    return {
      opacity: p >= 1 ? 0 : 0.45 * (1 - p),
      transform: [{ scale: 1 + p * 0.9 }],
    };
  });

  const r2Style = useAnimatedStyle(() => {
    const p = Math.min(1, Math.max(0, ring2.value));
    return {
      opacity: p >= 1 ? 0 : 0.3 * (1 - p),
      transform: [{ scale: 1 + p * 0.55 }],
    };
  });

  const iconStyle = useAnimatedStyle(() => ({
    transform: [{ scale: iconScale.value }],
  }));

  const containerSize = size + 4;
  return (
    <View style={[styles.wrap, { width: containerSize, height: containerSize }]}>
      <Animated.View
        style={[
          styles.halo,
          {
            backgroundColor: color,
            borderRadius: containerSize / 2,
            width: containerSize,
            height: containerSize,
          },
          r1Style,
        ]}
      />
      <Animated.View
        style={[
          styles.halo,
          {
            backgroundColor: color,
            borderRadius: containerSize / 2,
            width: containerSize,
            height: containerSize,
          },
          r2Style,
        ]}
      />
      <Animated.View style={iconStyle}>
        <Sensors size={size} color={color} />
      </Animated.View>
    </View>
  );
});

// M3 Expressive live indicator: ikona sensors z dwoma opóźnionymi pierścieniami
// i skokiem ikony przy każdym odświeżeniu danych. Gdy pulse jest wyłączone albo
// użytkownik ma reduceMotion, pomija worklety Reanimated.
export const LiveSensors = memo(function LiveSensors({
  color,
  size = 16,
  pulse = true,
  pingKey,
}: {
  color: string;
  size?: number;
  pulse?: boolean;
  pingKey?: number | string;
}) {
  const reduceMotion = useReducedMotion();
  if (!pulse || reduceMotion) {
    const containerSize = size + 4;
    return (
      <View style={[styles.wrap, { width: containerSize, height: containerSize }]}>
        <Sensors size={size} color={color} />
      </View>
    );
  }
  return <LiveSensorsAnimated color={color} size={size} pingKey={pingKey} />;
});

const styles = StyleSheet.create({
  wrap: {
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  halo: {
    position: 'absolute',
    width: '100%',
    height: '100%',
  },
});
