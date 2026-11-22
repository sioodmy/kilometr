import { useMemo } from 'react';
import { Stack } from 'expo-router';
import { useReducedMotion } from 'react-native-reanimated';
import { scheme } from '../../src/theme/tokens';

/** Stos ekranów wyników i szczegółów trasy z kierunkowym przejściem M3 Expressive. */
export default function RoutesLayout() {
  const reduceMotion = useReducedMotion();

  const screenOptions = useMemo(
    () => ({
      headerShown: false,
      contentStyle: { backgroundColor: scheme.surface },
      animation: (reduceMotion ? 'none' : 'slide_from_right') as 'none' | 'slide_from_right',
      animationDuration: 220,
      animationMatchesGesture: true,
      gestureEnabled: true,
      gestureDirection: 'horizontal' as const,
      fullScreenGestureEnabled: true,
    }),
    [reduceMotion],
  );

  return (
    <Stack screenOptions={screenOptions}>
      <Stack.Screen name="index" />
      <Stack.Screen name="[id]" />
    </Stack>
  );
}
