import { useMemo } from 'react';
import { Stack } from 'expo-router';
import { useReducedMotion } from 'react-native-reanimated';
import { scheme } from '../../src/theme/tokens';
import { useWebLayout } from '../../src/theme/layout';

/** Stos ekranów wyników i szczegółów trasy z przejściem M3 Expressive i pełnym gestem wstecz. */
export default function RoutesLayout() {
  const reduceMotion = useReducedMotion();
  const webLayout = useWebLayout();
  const disableScreenAnim = reduceMotion || webLayout.isMedium;

  const screenOptions = useMemo(
    () => ({
      headerShown: false,
      contentStyle: { backgroundColor: scheme.surface },
      animation: (disableScreenAnim ? 'none' : 'fade_from_bottom') as 'none' | 'fade_from_bottom',
      animationDuration: 200,
      animationMatchesGesture: false,
      gestureEnabled: !webLayout.isMedium,
      gestureDirection: 'horizontal' as const,
      fullScreenGestureEnabled: true,
    }),
    [disableScreenAnim, webLayout.isMedium],
  );

  return (
    <Stack screenOptions={screenOptions}>
      <Stack.Screen name="index" />
      <Stack.Screen name="[id]" />
    </Stack>
  );
}
