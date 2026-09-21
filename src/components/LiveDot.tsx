import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  Easing,
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';

// M3-style live indicator: solid dot + expanding halo. No text needed —
// pulsing = tracked live, static = schedule. Replaces "• GPS" labels.
export function LiveDot({
  color,
  size = 8,
  pulse = true,
}: {
  color: string;
  size?: number;
  pulse?: boolean;
}) {
  const halo = useSharedValue(0);

  useEffect(() => {
    if (!pulse) return;
    halo.value = withRepeat(
      withTiming(1, { duration: 1600, easing: Easing.out(Easing.ease) }),
      -1,
      false,
    );
    return () => cancelAnimation(halo);
  }, [halo, pulse]);

  const haloStyle = useAnimatedStyle(() => ({
    opacity: pulse ? 0.45 * (1 - halo.value) : 0.25,
    transform: [{ scale: pulse ? 1 + halo.value * 1.6 : 1.4 }],
  }));

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

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', justifyContent: 'center' },
  halo: { position: 'absolute', width: '62%', height: '62%' },
  dot: {},
});
