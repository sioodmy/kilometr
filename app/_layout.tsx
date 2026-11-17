import 'react-native-gesture-handler';
import 'react-native-reanimated';
import { LogBox, Platform } from 'react-native';
import { Fragment, useEffect, useState } from 'react';
import {
  DarkTheme,
  ThemeProvider,
  Stack,
  router,
  usePathname,
  useGlobalSearchParams,
} from 'expo-router';
import { useReducedMotion } from 'react-native-reanimated';
import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { scheme } from '../src/theme/tokens';
import { TransferProtectionProvider } from '../src/components/TransferProtectionProvider';
import { initTheme, useThemeSetting } from '../src/theme/personalization';
import { initLocale } from '../src/i18n';
import { loadActiveCity } from '../src/services/cityStore';
import { loadSettings } from '../src/services/settings';
import { hasSeenOnboarding } from '../src/services/onboarding';
import { loadNotificationPreferences } from '../src/services/notifications/preferences';
import { migrateFromSqliteKv } from '../src/services/kvMigration';
import { refreshDepartureAlarm } from '../src/services/departureAlarm';
import { cleanupExpiredTickets } from '../src/services/ticketStorage';
import {
  addTripResponseListener,
  getLastTripResponse,
  refreshTrackedTrip,
  restoreTrackedTrip,
  setupNotifications,
  startTicketCompensationMonitor,
  startTrackedTripListener,
  stopTracking,
  type TripResponse,
} from '../src/services/notifications';

let BootSplash: { hide: (options?: { fade?: boolean }) => Promise<boolean> } = {
  hide: async () => false,
};
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  BootSplash = require('react-native-bootsplash').default;
} catch {
  // W Expo Go brak natywnego TurboModule RNBootSplash.
}

LogBox.ignoreAllLogs(true);

function navigateFromNotification(res: TripResponse) {
  if (res.stop) {
    void stopTracking();
    return;
  }
  if (!res.link) return;
  if (res.link.sharedTrip) {
    router.navigate({ pathname: '/shared', params: { trip: res.link.sharedTrip } });
    return;
  }
  // Prosto do szczegółów kursu. Lista połączeń jest zbędnym przystankiem,
  // gdy użytkownik wraca z powiadomienia śledzenia.
  if (res.link.open) {
    const params: { id: string; action?: string } = { id: res.link.open };
    if (res.ticket || res.link.action === 'ticket') params.action = 'ticket';
    const detail = { pathname: '/routes/[id]' as const, params };
    if (router.canGoBack()) router.dismissTo(detail);
    else router.push(detail);
    return;
  }
  const target = { pathname: '/routes' as const, params: res.link };
  if (router.canGoBack()) router.dismissTo(target);
  else router.push(target);
}

export default function RootLayout() {
  const [ready, setReady] = useState(false);
  const [needsOnboarding, setNeedsOnboarding] = useState(false);
  const pathname = usePathname();
  const params = useGlobalSearchParams<{ trip?: string }>();
  const reduceMotion = useReducedMotion();
  const themeSetting = useThemeSetting();
  const navigationTheme = {
    ...DarkTheme,
    colors: {
      ...DarkTheme.colors,
      primary: scheme.primary,
      background: scheme.surface,
      card: scheme.surface,
      text: scheme.onSurface,
      border: scheme.outlineVariant,
      notification: scheme.error,
    },
  };

  // Ustawienia trasy i język z kv-store dostępne globalnie od startu
  useEffect(() => {
    let isMounted = true;

    const initApp = async () => {
      // Migracja najpierw: pozostałe odczyty muszą widzieć już przeniesione klucze.
      await migrateFromSqliteKv();
      // Język przed kanałami powiadomień: nazwy kanałów biorą się ze słownika.
      await initLocale();
      // Reszta to niezależne odczyty i natywne mostki. Serializowane awaited
      // sumowały czas dysku pod splash screenem, równoległe mieszczą się w jednym.
      const [seen] = await Promise.all([
        hasSeenOnboarding().catch((err) => {
          console.warn('[RootLayout] onboarding flag unreadable:', err);
          // Błąd odczytu nie może wysłać użytkownika drugi raz w onboarding.
          return true;
        }),
        initTheme(),
        // Miasto przed bazą: getGtfsDb() otwiera plik per-miasto po sync id.
        loadActiveCity(),
        loadSettings(),
        loadNotificationPreferences(),
        refreshDepartureAlarm(),
        setupNotifications().catch((err) => {
          console.warn('[RootLayout] notifications:', err);
        }),
      ]);
      if (isMounted) setNeedsOnboarding(!seen);
      // Pin podróży bez pierwszego przeliczenia planu: to planer i sieć, splash
      // nie ma na co czekać. Odświeżenie leci po pierwszej klatce (niżej).
      await restoreTrackedTrip({ refresh: false }).catch((err) => {
        console.warn('[RootLayout] restore tracked trip:', err);
      });
    };

    void initApp()
      .catch((err) => console.warn('[RootLayout] init:', err))
      .finally(() => {
        if (isMounted) setReady(true);
      });

    startTrackedTripListener();

    return () => {
      isMounted = false;
    };
  }, []);

  // Ciężka praca po splashu: odświeżenie śledzonej podróży i monitor zwrotów
  // startują dopiero, gdy pierwsza klatka jest już na ekranie.
  useEffect(() => {
    if (!ready) return;
    const timer = setTimeout(() => {
      void refreshTrackedTrip().catch(() => {});
      void cleanupExpiredTickets().catch(() => {});
      startTicketCompensationMonitor();
    }, 0);
    return () => clearTimeout(timer);
  }, [ready]);

  useEffect(() => {
    if (ready && needsOnboarding)
      router.replace({
        pathname: '/onboarding',
        params: pathname === '/shared' && params.trip ? { sharedTrip: params.trip } : {},
      });
  }, [ready, needsOnboarding]);

  useEffect(() => {
    if (!ready || !needsOnboarding || pathname === '/onboarding') return;
    void hasSeenOnboarding()
      .then((seen) => {
        if (seen) setNeedsOnboarding(false);
      })
      .catch(() => {});
  }, [ready, needsOnboarding, pathname]);

  useEffect(() => {
    if (!ready || (needsOnboarding && pathname !== '/onboarding')) return;
    const frame = requestAnimationFrame(() => {
      void BootSplash.hide({ fade: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [ready, needsOnboarding, pathname]);

  useEffect(() => {
    if (!ready || needsOnboarding) return;
    void getLastTripResponse()
      .then(navigateFromNotification)
      .catch((err) => {
        console.warn('[RootLayout] notification response:', err);
      });
    return addTripResponseListener(navigateFromNotification);
  }, [ready, needsOnboarding]);

  if (!ready) return null;

  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: scheme.surface }}>
      <SafeAreaProvider>
        <StatusBar style="light" />
        <ThemeProvider value={navigationTheme}>
          <TransferProtectionProvider key={themeSetting}>
            <Stack
              screenLayout={({ children }) => <Fragment key={themeSetting}>{children}</Fragment>}
              screenOptions={{
                headerShown: false,
                contentStyle: { backgroundColor: scheme.surface },
                // Jednolite, szybkie przejścia między ekranami Material 3 Expressive (iOS + Android).
                // animationMatchesGesture synchronizuje animację z gestem wstecz.
                animation: reduceMotion
                  ? 'none'
                  : Platform.OS === 'android'
                    ? 'fade_from_bottom'
                    : 'slide_from_right',
                animationDuration: 200,
                animationMatchesGesture: true,
                gestureEnabled: true,
                gestureDirection: 'horizontal',
                fullScreenGestureEnabled: true,
              }}
            >
              <Stack.Screen name="index" />
              <Stack.Screen name="onboarding" options={{ gestureEnabled: false }} />
              <Stack.Screen
                name="routes"
                options={{
                  headerShown: false,
                  animation: reduceMotion ? 'none' : 'fade',
                  animationDuration: 240,
                }}
              />

              <Stack.Screen name="line" />
              <Stack.Screen name="line-departures" />
              {/* Mapa ma własny gest przesuwania: natywny swipe-back zjadałby
                przeciąganie widoku i mapa skakałaby przy powrocie. */}
              <Stack.Screen name="map" options={{ gestureEnabled: false }} />
              <Stack.Screen name="live-map" options={{ gestureEnabled: false }} />
              <Stack.Screen
                name="news"
                options={{
                  presentation: 'card',
                  animation: reduceMotion
                    ? 'none'
                    : Platform.OS === 'android'
                      ? 'fade_from_bottom'
                      : 'slide_from_right',
                  animationDuration: 200,
                  animationMatchesGesture: true,
                  gestureDirection: 'horizontal',
                }}
              />
              <Stack.Screen
                name="article"
                options={{
                  presentation: 'card',
                  animation: reduceMotion
                    ? 'none'
                    : Platform.OS === 'android'
                      ? 'fade_from_bottom'
                      : 'slide_from_right',
                  animationDuration: 200,
                  animationMatchesGesture: true,
                  gestureDirection: 'horizontal',
                }}
              />
              <Stack.Screen
                name="settings"
                options={{
                  presentation: 'card',
                  animation: reduceMotion
                    ? 'none'
                    : Platform.OS === 'android'
                      ? 'fade_from_bottom'
                      : 'slide_from_right',
                  animationDuration: 200,
                  animationMatchesGesture: true,
                  gestureDirection: 'horizontal',
                }}
              />
            </Stack>
          </TransferProtectionProvider>
        </ThemeProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
