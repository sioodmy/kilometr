import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  Easing,
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { Sensors } from './icons';

// M3-style live indicator: solid dot + single expanding halo ping on data arrival.
// Pulsing reflects the actual vehicle/feed polling updates rather than an infinite loop.
export function LiveDot({
  color,
  size = 8,
  pulse = true,
  pingKey,
}: {
  color: string;
  size?: number;
  pulse?: boolean;
  pingKey?: number | string;
}) {
  const halo = useSharedValue(1);

  useEffect(() => {
    if (!pulse) {
      cancelAnimation(halo);
      halo.value = 1;
      return;
    }
    cancelAnimation(halo);
    halo.value = 0;
    halo.value = withTiming(1, { duration: 1200, easing: Easing.out(Easing.quad) });
    return () => cancelAnimation(halo);
  }, [halo, pulse, pingKey]);

  const haloStyle = useAnimatedStyle(() => {
    const p = Math.min(1, Math.max(0, halo.value));
    const opacity = p >= 1 ? 0 : 0.55 * (1 - p);
    const scale = 1 + p * 1.5;
    return {
      opacity,
      transform: [{ scale }],
    };
  });

  const r = size / 2;
  return (
    <View style={[styles.wrap, { width: size * 3, height: size * 3 }]}>
      <Animated.View
        style={[styles.halo, { backgroundColor: color, borderRadius: size * 2 }, haloStyle]}
      />
      <View style={[styles.dot, { backgroundColor: color, width: size, height: size, borderRadius: r }]} />
    </View>
  );
}

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
  const halo = useSharedValue(1);

  useEffect(() => {
    if (!pulse) {
      cancelAnimation(halo);
      halo.value = 1;
      return;
    }
    cancelAnimation(halo);
    halo.value = 0;
    halo.value = withTiming(1, { duration: 1200, easing: Easing.out(Easing.quad) });
    return () => cancelAnimation(halo);
  }, [halo, pulse, pingKey]);

  const haloStyle = useAnimatedStyle(() => {
    const p = Math.min(1, Math.max(0, halo.value));
    const opacity = p >= 1 ? 0 : 0.45 * (1 - p);
    const scale = 1 + p * 0.45;
    return {
      opacity,
      transform: [{ scale }],
    };
  });

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
          haloStyle,
        ]}
      />
      <Sensors size={size} color={color} />
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
  dot: {},
});
