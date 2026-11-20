import 'react-native-gesture-handler';
import 'react-native-reanimated';
import { LogBox, Platform } from 'react-native';
import { Fragment, useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
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

/** Główny układ nawigacji aplikacji z jednolitymi, płynnymi przejściami ekranów. */
export default function RootLayout() {
  const [ready, setReady] = useState(false);
  const [needsOnboarding, setNeedsOnboarding] = useState(false);
  const pathname = usePathname();
  const params = useGlobalSearchParams<{ trip?: string }>();
  const reduceMotion = useReducedMotion();
  const themeSetting = useThemeSetting();

  const navigationTheme = useMemo(
    () => ({
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
    }),
    [themeSetting],
  );

  const renderScreenLayout = useCallback(
    ({ children }: { children: ReactNode }) => <Fragment key={themeSetting}>{children}</Fragment>,
    [themeSetting],
  );

  const stackScreenOptions = useMemo(
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
    [reduceMotion, themeSetting],
  );

  const verticalScreenOptions = useMemo(
    () => ({
      headerShown: false,
      animation: (reduceMotion
        ? 'none'
        : Platform.OS === 'android'
          ? 'fade_from_bottom'
          : 'slide_from_right') as 'none' | 'fade_from_bottom' | 'slide_from_right',
      animationDuration: 210,
      animationMatchesGesture: true,
    }),
    [reduceMotion],
  );

  const mapScreenOptions = useMemo(
    () => ({
      gestureEnabled: false,
      animation: (reduceMotion ? 'none' : 'fade_from_bottom') as 'none' | 'fade_from_bottom',
      animationDuration: 210,
    }),
    [reduceMotion],
  );

  // Ustawienia trasy i język z kv-store dostępne globalnie od startu.
  useEffect(() => {
    let isMounted = true;

    const initApp = async () => {
      await migrateFromSqliteKv();
      await initLocale();
      const [seen] = await Promise.all([
        hasSeenOnboarding().catch((err) => {
          console.warn('[RootLayout] onboarding flag unreadable:', err);
          return true;
        }),
        initTheme(),
        loadActiveCity(),
        loadSettings(),
        loadNotificationPreferences(),
        refreshDepartureAlarm(),
        setupNotifications().catch((err) => {
          console.warn('[RootLayout] notifications:', err);
        }),
      ]);
      if (isMounted) setNeedsOnboarding(!seen);
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

  // Ciężka praca po splashu startuje dopiero, gdy pierwsza klatka jest już na ekranie.
  useEffect(() => {
    if (!ready) return;
    const timer = setTimeout(() => {
      void refreshTrackedTrip().catch(() => {});
      void cleanupExpiredTickets().catch(() => {});
      startTicketCompensationMonitor();
    }, 0);
    const nationalTimer = setTimeout(() => {
      void import('../src/services/gtfsDatabase')
        .then(async (db) => {
          if (!(await db.hasNationalDb())) return;
          const handle = await db.getNationalDb();
          await handle.getFirstAsync('SELECT bits FROM station_amenities LIMIT 1');
          await handle.getFirstAsync('SELECT bits FROM trip_amenities LIMIT 1');
        })
        .catch(() => {});
    }, 2500);
    return () => {
      clearTimeout(timer);
      clearTimeout(nationalTimer);
    };
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
            <Stack screenLayout={renderScreenLayout} screenOptions={stackScreenOptions}>
              <Stack.Screen name="index" />
              <Stack.Screen name="onboarding" options={{ gestureEnabled: false }} />
              <Stack.Screen name="routes" options={verticalScreenOptions} />
              <Stack.Screen name="line" />
              <Stack.Screen name="line-departures" />
              {/* Mapa ma własny gest przesuwania: natywny swipe-back zjadałby przeciąganie widoku. */}
              <Stack.Screen name="map" options={mapScreenOptions} />
              <Stack.Screen name="live-map" options={mapScreenOptions} />
              <Stack.Screen name="news" />
              <Stack.Screen name="article" />
              <Stack.Screen name="settings" />
            </Stack>
          </TransferProtectionProvider>
        </ThemeProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
