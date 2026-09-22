import { Stack } from 'expo-router';
import { scheme } from '../../src/theme/tokens';

export default function RoutesLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: scheme.surface },
        animation: 'slide_from_right',
        animationDuration: 240,
        animationMatchesGesture: true,
        gestureEnabled: true,
        gestureDirection: 'horizontal',
        fullScreenGestureEnabled: true,
      }}
    >
      <Stack.Screen name="index" />
      <Stack.Screen name="[id]" />
    </Stack>
  );
}
