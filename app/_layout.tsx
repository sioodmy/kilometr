import { LogBox } from 'react-native';
import { useEffect, useState } from 'react';
import { Stack, router } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { scheme } from '../src/theme/tokens';
import { loadSettings } from '../src/services/settings';
import { hasSeenOnboarding } from '../src/services/onboarding';
import {
  addPinTapListener,
  getPinTapData,
  restorePinnedQuery,
  setupNotificationHandler,
  setupPinnedChannel,
  startPinnedTicker,
  type PinTapData,
} from '../src/services/pinnedConnection';

LogBox.ignoreAllLogs(true);

function navigateFromNotification(data: PinTapData) {
  if (!data) return;
  router.push({ pathname: '/routes', params: data });
}

export default function RootLayout() {
  const [ready, setReady] = useState(false);

  // Ustawienia trasy z AsyncStorage dostępne globalnie od startu
  useEffect(() => {
    loadSettings();
    // Pierwsze uruchomienie → onboarding (dostępy, rozkład offline, miejsca).
    // .catch jest tu krytyczny: bez niego odrzucenie (np. uszkodzony KV po
    // przywróceniu z backupu) zostawiałoby `ready === false` na zawsze, czyli
    // biały ekran bez możliwości wyjścia. Odtąd startujemy, a problem
    // zgłaszamy — ekran połączeń i tak pokaże pusty stan rozkładu.
    hasSeenOnboarding()
      .then((seen) => {
        if (!seen) router.replace('/onboarding');
      })
      .catch((err) => {
        console.warn('[RootLayout] onboarding flag unreadable:', err);
      })
      .finally(() => setReady(true));
    // Powiadomienia ładowane leniwie w serwisie (guard na Expo Go)
    setupNotificationHandler();
    setupPinnedChannel();
    restorePinnedQuery();
    startPinnedTicker();

    // Tap w przypięte powiadomienie → ekran połączeń
    getPinTapData().then(navigateFromNotification, () => {});
    const remove = addPinTapListener(navigateFromNotification);
    return remove;
  }, []);
  if (!ready) {
    return <GestureHandlerRootView style={{ flex: 1, backgroundColor: scheme.surface }} />;
  }

  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: scheme.surface }}>
      <SafeAreaProvider>
        <StatusBar style="light" />
        <Stack
          screenOptions={{
            headerShown: false,
            contentStyle: { backgroundColor: scheme.surface },
            // Jednolite, szybkie przejścia między ekranami (iOS + Android).
            // animationMatchesGesture synchronizuje animację z gestem wstecz.
            animation: 'slide_from_right',
            animationDuration: 240,
            animationMatchesGesture: true,
            gestureEnabled: true,
            gestureDirection: 'horizontal',
            fullScreenGestureEnabled: true,
          }}
        >
          <Stack.Screen name="index" />
          <Stack.Screen name="onboarding" options={{ gestureEnabled: false }} />
          <Stack.Screen name="routes" options={{ headerShown: false }} />
          {/* Mapa ma własny gest przesuwania — natywny swipe-back zjadałby
              przeciąganie widoku i mapa skakałaby przy powrocie. */}
          <Stack.Screen name="map" options={{ gestureEnabled: false }} />
          <Stack.Screen
            name="news"
            options={{
              presentation: 'modal',
              animation: 'slide_from_bottom',
              animationDuration: 300,
              animationMatchesGesture: true,
              gestureDirection: 'vertical',
            }}
          />
          <Stack.Screen
            name="settings"
            options={{
              presentation: 'modal',
              animation: 'slide_from_bottom',
              animationDuration: 300,
              animationMatchesGesture: true,
              gestureDirection: 'vertical',
            }}
          />
        </Stack>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
