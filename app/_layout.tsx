import { LogBox } from 'react-native';
import { useEffect, useState } from 'react';
import { Stack, router } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { scheme } from '../src/theme/tokens';
import { loadSettings } from '../src/services/settings';
import { hasSeenOnboarding } from '../src/services/onboarding';
import { loadNotificationPreferences } from '../src/services/notifications/preferences';
import {
  addTripResponseListener,
  getLastTripResponse,
  restoreTrackedTrip,
  setupNotifications,
  startTrackedTripListener,
  stopTracking,
  type TripResponse,
} from '../src/services/notifications';

LogBox.ignoreAllLogs(true);

function navigateFromNotification(res: TripResponse) {
  if (res.stop) {
    void stopTracking();
    return;
  }
  if (!res.link) return;
  router.push({ pathname: '/routes', params: res.link });
}

export default function RootLayout() {
  const [ready, setReady] = useState(false);

  // Ustawienia trasy z AsyncStorage dostępne globalnie od startu
  useEffect(() => {
    loadSettings();
    // Powiadomienia ładowane leniwie w serwisie (guard na Expo Go)
    void loadNotificationPreferences();
    // Kanały muszą istnieć przed prośbą o uprawnienia (Android 13+), więc
    // konfigurujemy je na starcie, a nie przy przypięciu trasy.
    void setupNotifications();
    // Pierwsze uruchomienie → onboarding (dostępy, rozkład offline, miejsca).
    hasSeenOnboarding().then((seen) => {
      if (!seen) router.replace('/onboarding');
      setReady(true);
    });
    // Śledzenie podróży przeżywa restart telefonu, więc podnosimy je,
    // zanim użytkownik cokolwiek otworzy.
    void restoreTrackedTrip();
    startTrackedTripListener();

    // Tap w powiadomienie lub przycisk akcji → ekran połączeń / koniec
    getLastTripResponse().then(navigateFromNotification);
    const remove = addTripResponseListener(navigateFromNotification);
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
