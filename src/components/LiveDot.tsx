import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  Easing,
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSequence,
  withSpring,
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
  // Dwa opóźnione pierścienie + skok ikony przy każdym odświeżeniu danych.
  const ring1 = useSharedValue(1);
  const ring2 = useSharedValue(1);
  const iconScale = useSharedValue(1);

  useEffect(() => {
    if (!pulse) {
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
  }, [ring1, ring2, iconScale, pulse, pingKey]);

  const ringStyle = (ring: typeof ring1, maxScale: number, maxOpacity: number) =>
    useAnimatedStyle(() => {
      const p = Math.min(1, Math.max(0, ring.value));
      return {
        opacity: p >= 1 ? 0 : maxOpacity * (1 - p),
        transform: [{ scale: 1 + p * maxScale }],
      };
    });

  const r1Style = ringStyle(ring1, 0.9, 0.45);
  const r2Style = ringStyle(ring2, 0.55, 0.3);

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
  dot: {},
});
