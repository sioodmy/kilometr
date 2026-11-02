import { Stack } from 'expo-router';
import { Platform } from 'react-native';
import { useReducedMotion } from 'react-native-reanimated';
import { scheme } from '../../src/theme/tokens';

export default function RoutesLayout() {
  const reduceMotion = useReducedMotion();
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: scheme.surface },
        animation: reduceMotion ? 'none' : Platform.OS === 'android' ? 'fade_from_bottom' : 'slide_from_right',
        animationDuration: 300,
        animationMatchesGesture: true,
        gestureEnabled: true,
        gestureDirection: 'horizontal',
        fullScreenGestureEnabled: true,
      }}
    >
      <Stack.Screen name="index" />
      <Stack.Screen
        name="[id]"
        options={{
          animation: reduceMotion ? 'none' : 'fade',
          animationDuration: 240,
        }}
      />
    </Stack>
  );
}
