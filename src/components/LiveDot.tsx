import { useEffect } from 'react';
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

// M3 Expressive live indicator: ikona sensors z dwoma opóźnionymi pierścieniami
// i skokiem ikony przy każdym odświeżeniu danych. Animacja reaguje na realny
// polling pojazdu, a nie na nieskończoną pętlę.
export function LiveSensors({
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
  const ring1 = useSharedValue(1);
  const ring2 = useSharedValue(1);
  const iconScale = useSharedValue(1);

  useEffect(() => {
    if (!pulse || reduceMotion) {
      cancelAnimation(ring1);
      cancelAnimation(ring2);
      cancelAnimation(iconScale);
      ring1.value = 1;
      ring2.value = 1;
      iconScale.value = 1;
      return;
    }
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
  }, [ring1, ring2, iconScale, pulse, pingKey, reduceMotion]);

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
}

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
