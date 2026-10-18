import 'react-native-gesture-handler';
import 'react-native-reanimated';
import { LogBox, Platform } from 'react-native';
import { useEffect, useState } from 'react';
import { Stack, router, usePathname } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useReducedMotion } from 'react-native-reanimated';
import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { scheme } from '../src/theme/tokens';
import { initDynamicColors } from '../src/theme/dynamic';
import { initLocale } from '../src/i18n';
import { loadActiveCity } from '../src/services/cityStore';
import { loadSettings } from '../src/services/settings';
import { hasSeenOnboarding } from '../src/services/onboarding';
import { loadNotificationPreferences } from '../src/services/notifications/preferences';
import { migrateFromSqliteKv } from '../src/services/kvMigration';
import {
  addTripResponseListener,
  getLastTripResponse,
  restoreTrackedTrip,
  setupNotifications,
  startTrackedTripListener,
  stopTracking,
  type TripResponse,
} from '../src/services/notifications';
import {
  initContributorAutoFollow,
  ingestNativeSessions,
} from '../src/services/contributor/collector';
import {
  isContributorAvailable,
  loadContributorSettings,
} from '../src/services/contributor/config';
import { sweepRetention } from '../src/services/contributor/store';

LogBox.ignoreAllLogs(true);
void SplashScreen.preventAutoHideAsync().catch(() => {});

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
  const [needsOnboarding, setNeedsOnboarding] = useState(false);
  const pathname = usePathname();
  const reduceMotion = useReducedMotion();

  // Ustawienia trasy i język z kv-store dostępne globalnie od startu
  useEffect(() => {
    let isMounted = true;

    const initApp = async () => {
      // Paleta musi być gotowa przed pierwszym renderem ekranów.
      await initDynamicColors();
      await migrateFromSqliteKv();
      // Miasto przed bazą: getGtfsDb() otwiera plik per-miasto po sync id.
      await loadActiveCity();
      await loadSettings();
      await initLocale();
      await loadNotificationPreferences();
      try {
        const seen = await hasSeenOnboarding();
        if (isMounted) setNeedsOnboarding(!seen);
      } catch (err) {
        console.warn('[RootLayout] onboarding flag unreadable:', err);
      }
    };

    const initAppReady = initApp()
      .catch((err) => console.warn('[RootLayout] init:', err))
      .finally(() => {
        if (isMounted) setReady(true);
      });

    // Odtwarzanie podróży wymaga wczytanego miasta i kanałów powiadomień.
    void initAppReady.then(async () => {
      await setupNotifications();
      await restoreTrackedTrip();
    }).catch((err) => console.warn('[RootLayout] notifications init:', err));
    startTrackedTripListener();

    // Contributor: po podstawowych inicjalizacjach przenosimy pliki z
    // serwisu natywnego do bazy (GPS mógł zbierać przez noc), retencję
    // dbamy przy każdym starcie. Na prodzie wszystko jest no-opem.
    void initAppReady.then(async () => {
      if (!isContributorAvailable()) return;
      await loadContributorSettings();
      await sweepRetention();
      await ingestNativeSessions();
      initContributorAutoFollow();
    }).catch((err) => console.warn('[RootLayout] contributor init:', err));

    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    if (ready && needsOnboarding) router.replace('/onboarding');
  }, [ready, needsOnboarding]);

  useEffect(() => {
    if (!ready || !needsOnboarding || pathname === '/onboarding') return;
    void hasSeenOnboarding().then((seen) => {
      if (seen) setNeedsOnboarding(false);
    });
  }, [ready, needsOnboarding, pathname]);

  useEffect(() => {
    if (!ready || (needsOnboarding && pathname !== '/onboarding')) return;
    const frame = requestAnimationFrame(() => SplashScreen.hide());
    return () => cancelAnimationFrame(frame);
  }, [ready, needsOnboarding, pathname]);

  useEffect(() => {
    if (!ready || needsOnboarding) return;
    void getLastTripResponse().then(navigateFromNotification).catch((err) => {
      console.warn('[RootLayout] notification response:', err);
    });
    return addTripResponseListener(navigateFromNotification);
  }, [ready, needsOnboarding]);

  if (!ready) return null;

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
            animation: reduceMotion ? 'none' : Platform.OS === 'android' ? 'fade_from_bottom' : 'slide_from_right',
            animationDuration: 300,
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
              animation: reduceMotion ? 'none' : 'slide_from_bottom',
              animationDuration: 300,
              animationMatchesGesture: true,
              gestureDirection: 'vertical',
            }}
          />
          <Stack.Screen
            name="article"
            options={{
              presentation: 'card',
              animation: reduceMotion ? 'none' : Platform.OS === 'android' ? 'fade_from_bottom' : 'slide_from_right',
              animationDuration: 300,
            }}
          />
          <Stack.Screen
            name="settings"
            options={{
              presentation: 'modal',
              animation: reduceMotion ? 'none' : 'slide_from_bottom',
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
