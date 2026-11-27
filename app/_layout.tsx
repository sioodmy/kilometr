import 'react-native-gesture-handler';
import 'react-native-reanimated';
import { LogBox, Platform } from 'react-native';
import {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
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
import { SafeAreaProvider, type Metrics } from 'react-native-safe-area-context';
import { enableFreeze } from 'react-native-screens';
import { scheme } from '../src/theme/tokens';
import { useWebLayout } from '../src/theme/layout';
import { DesktopShell } from '../src/components/DesktopShell';
import { TransferProtectionProvider } from '../src/components/TransferProtectionProvider';
import { WebAlertHost } from '../src/components/WebAlertHost';
import { initRaptorWasmAsync } from '../modules/kilometr-raptor';
import { initTheme, useThemeSetting } from '../src/theme/personalization';
import { initLocale } from '../src/i18n';
import { loadActiveCity } from '../src/services/cityStore';
import { loadSettings } from '../src/services/settings';
import { hasSeenOnboarding } from '../src/services/onboarding';
import { migrateFromSqliteKv } from '../src/services/kvMigration';
import { kvPreload } from '../src/services/storage';
import type { TripResponse } from '../src/services/notifications/response';

const STARTUP_KV_KEYS = [
  '__kv_migrated_from_sqlite',
  'kilometr.locale.v1',
  'kilometr.onboardingSeen.v1',
  'kilometr.theme.v1',
  'kilometr.activeCity.v1',
  'kilometr.routingSettings.v1',
  'kilometr.trackedTrip.v2',
  'kilometr.notificationPrefs.v1',
] as const;

let BootSplash: { hide: (options?: { fade?: boolean }) => Promise<boolean> } = {
  hide: async (options) => {
    if (Platform.OS === 'web' && typeof document !== 'undefined') {
      const el = document.getElementById('km-boot-splash');
      if (el) {
        if (options?.fade) {
          el.classList.add('km-hide');
          setTimeout(() => el.remove(), 260);
        } else {
          el.remove();
        }
        return true;
      }
    }
    return false;
  },
};
if (Platform.OS !== 'web') {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    BootSplash = require('react-native-bootsplash').default;
  } catch {
    // W Expo Go brak natywnego TurboModule RNBootSplash.
  }
}

function readWebSafeAreaMetrics(): Metrics | undefined {
  if (Platform.OS !== 'web' || typeof window === 'undefined' || typeof document === 'undefined') {
    return undefined;
  }
  const style = getComputedStyle(document.documentElement);
  const px = (prop: string) => {
    const v = parseFloat(style.getPropertyValue(prop));
    return Number.isFinite(v) && v >= 0 ? v : 0;
  };
  return {
    frame: { x: 0, y: 0, width: window.innerWidth, height: window.innerHeight },
    insets: {
      top: px('--km-sat'),
      right: px('--km-sar'),
      bottom: px('--km-sab'),
      left: px('--km-sal'),
    },
  };
}

LogBox.ignoreAllLogs(true);
if (Platform.OS !== 'web') {
  enableFreeze(true);
}

function navigateFromNotification(res: TripResponse) {
  if (res.stop) {
    void import('../src/services/notifications/tripMonitor')
      .then((m) => m.stopTracking())
      .catch(() => {});
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

/** Izoluje subskrypcję ścieżki wyłącznie na czas onboardingu, żeby RootLayout nie przerysowywał się przy każdej nawigacji. */
function OnboardingGuard({ onCompleted }: { onCompleted: () => void }) {
  const pathname = usePathname();
  const params = useGlobalSearchParams<{ trip?: string }>();
  const redirectedRef = useRef(false);

  useEffect(() => {
    if (redirectedRef.current || pathname === '/onboarding') return;
    redirectedRef.current = true;
    router.replace({
      pathname: '/onboarding',
      params: pathname === '/shared' && params.trip ? { sharedTrip: params.trip } : {},
    });
  }, [pathname, params.trip]);

  useEffect(() => {
    if (pathname === '/onboarding') return;
    void hasSeenOnboarding()
      .then((seen) => {
        if (seen) onCompleted();
      })
      .catch(() => {});
  }, [pathname, onCompleted]);

  useEffect(() => {
    if (pathname !== '/onboarding') return;
    const frame = requestAnimationFrame(() => {
      void BootSplash.hide({ fade: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [pathname]);

  return null;
}

/** Główny układ nawigacji aplikacji z jednolitymi, płynnymi przejściami ekranów. */
export default function RootLayout() {
  const [ready, setReady] = useState(false);
  const [needsOnboarding, setNeedsOnboarding] = useState(false);
  const reduceMotion = useReducedMotion();
  const themeSetting = useThemeSetting();
  const webLayout = useWebLayout();
  const disableScreenAnim = reduceMotion || webLayout.isMedium;

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
      animation: (disableScreenAnim ? 'none' : 'fade_from_bottom') as 'none' | 'fade_from_bottom',
      animationDuration: 200,
      animationMatchesGesture: false,
      gestureEnabled: !webLayout.isMedium,
      gestureDirection: 'horizontal' as const,
      fullScreenGestureEnabled: true,
    }),
    [disableScreenAnim, themeSetting, webLayout.isMedium],
  );

  const homeScreenOptions = useMemo(
    () => ({
      // Wyłączamy react-freeze na ekranie głównym, aby powrót gestem wstecz z listy połączeń
      // nie musiał synchronicznie odmrażać całego drzewa widoków w klatce przejścia.
      freezeOnBlur: false,
    }),
    [],
  );

  const routesScreenOptions = useMemo(
    () => ({
      fullScreenGestureEnabled: false,
    }),
    [],
  );

  const mapScreenOptions = useMemo(
    () => ({
      gestureEnabled: !webLayout.isMedium,
      gestureDirection: 'horizontal' as const,
      // Na mapie gest z lewej krawędzi wraca wstecz bez przejmowania przesuwania mapy.
      fullScreenGestureEnabled: false,
      animation: (disableScreenAnim ? 'none' : 'fade_from_bottom') as 'none' | 'fade_from_bottom',
      animationDuration: 200,
      animationMatchesGesture: false,
    }),
    [disableScreenAnim, webLayout.isMedium],
  );

  // Ustawienia trasy, motyw, miasto i język z kv-store dostępne globalnie od startu.
  useEffect(() => {
    let isMounted = true;

    const initApp = async () => {
      await kvPreload(STARTUP_KV_KEYS);
      await migrateFromSqliteKv();
      const [, seen] = await Promise.all([
        initLocale(),
        hasSeenOnboarding().catch((err) => {
          console.warn('[RootLayout] onboarding flag unreadable:', err);
          return true;
        }),
        initTheme(),
        loadActiveCity({ skipStoreSwap: true }),
        loadSettings(),
      ]);
      if (isMounted) setNeedsOnboarding(!seen);
    };

    void initApp()
      .catch((err) => console.warn('[RootLayout] init:', err))
      .finally(() => {
        if (isMounted) setReady(true);
      });

    return () => {
      isMounted = false;
    };
  }, []);

  // Ciężka praca po splashu startuje dopiero, gdy pierwsza klatka jest już na ekranie.
  useEffect(() => {
    if (!ready) return;
    const timer = setTimeout(() => {
      void initRaptorWasmAsync().catch(() => false);
      void Promise.all([
        import('../src/services/notifications/preferences')
          .then((m) => m.loadNotificationPreferences())
          .catch(() => {}),
        import('../src/services/notifications/setup')
          .then((m) => m.setupNotifications())
          .catch((err) => {
            console.warn('[RootLayout] notifications:', err);
          }),
      ])
        .then(() => import('../src/services/notifications/ticketCompensation'))
        .then((m) => m.startTicketCompensationMonitor())
        .catch(() => {});
      void import('../src/services/departureAlarm')
        .then((m) => m.refreshDepartureAlarm())
        .catch(() => {});
      void import('../src/services/notifications/tripMonitor')
        .then(async (m) => {
          m.startTrackedTripListener();
          const restored = await m.restoreTrackedTrip({ refresh: false }).catch((err) => {
            console.warn('[RootLayout] restore tracked trip:', err);
            return null;
          });
          if (restored) {
            await m.refreshTrackedTrip().catch(() => {});
          }
        })
        .catch(() => {});
      if (needsOnboarding) {
        // Rozpocznij pobieranie GTFS aktywnego miasta w tle już podczas onboardingu.
        void import('../src/services/dataManager')
          .then((m) => m.ensureActiveCityTimetable({ checkUpdates: true }))
          .then((st) => {
            if (st.state === 'ready') {
              return import('../src/services/nationalTimetable').then((n) =>
                n.ensureNationalTimetable(),
              );
            }
          })
          .catch(() => {});
      }
      void import('../src/services/ticketStorage')
        .then((m) => m.cleanupExpiredTickets())
        .catch(() => {});
    }, 0);
    const nationalTimer = setTimeout(() => {
      void import('../src/services/gtfsDatabase')
        .then(async (db) => {
          if (await db.hasNationalDb()) {
            const handle = await db.getNationalDb();
            await handle.getFirstAsync('SELECT bits FROM station_amenities LIMIT 1');
            await handle.getFirstAsync('SELECT bits FROM trip_amenities LIMIT 1');
          }
          const national = await import('../src/services/nationalTimetable');
          void national.ensureNationalTimetable().catch(() => {});
        })
        .catch(() => {});
    }, 2500);
    const poiTimer = setTimeout(() => {
      void import('../src/services/poiSync')
        .then((m) => m.ensureCityPoiDb())
        .catch(() => {});
    }, 3500);
    return () => {
      clearTimeout(timer);
      clearTimeout(nationalTimer);
      clearTimeout(poiTimer);
    };
  }, [ready, needsOnboarding]);

  const handleOnboardingCompleted = useCallback(() => {
    setNeedsOnboarding(false);
  }, []);

  useEffect(() => {
    if (!ready || needsOnboarding) return;
    const frame = requestAnimationFrame(() => {
      void BootSplash.hide({ fade: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [ready, needsOnboarding]);

  useEffect(() => {
    if (!ready || needsOnboarding) return;
    let cancelled = false;
    let removeListener: (() => void) | undefined;
    void import('../src/services/notifications/response')
      .then((m) => {
        if (cancelled) return;
        removeListener = m.addTripResponseListener(navigateFromNotification);
        return m.getLastTripResponse();
      })
      .then((res) => {
        if (!cancelled && res) navigateFromNotification(res);
      })
      .catch((err) => {
        console.warn('[RootLayout] notification response:', err);
      });
    return () => {
      cancelled = true;
      removeListener?.();
    };
  }, [ready, needsOnboarding]);

  const initialMetrics = useMemo(() => readWebSafeAreaMetrics(), []);

  if (!ready) return null;

  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: scheme.surface }}>
      <SafeAreaProvider initialMetrics={initialMetrics}>
        <StatusBar style="light" />
        <ThemeProvider value={navigationTheme}>
          <TransferProtectionProvider key={themeSetting}>
            <DesktopShell>
              {needsOnboarding && <OnboardingGuard onCompleted={handleOnboardingCompleted} />}
              <Stack
                initialRouteName={needsOnboarding ? 'onboarding' : 'index'}
                screenLayout={renderScreenLayout}
                screenOptions={stackScreenOptions}
              >
                <Stack.Screen name="index" options={homeScreenOptions} />
                <Stack.Screen name="onboarding" options={{ gestureEnabled: false }} />
                <Stack.Screen name="routes" options={routesScreenOptions} />
                <Stack.Screen name="line" />
                <Stack.Screen name="line-departures" />
                {/* Mapa ma własny gest przesuwania: cofanie działa z lewej krawędzi bez zjadania mapy. */}
                <Stack.Screen name="map" options={mapScreenOptions} />
                <Stack.Screen name="live-map" options={mapScreenOptions} />
                <Stack.Screen name="news" />
                <Stack.Screen name="article" />
                <Stack.Screen name="settings" />
              </Stack>
            </DesktopShell>
            <WebAlertHost />
          </TransferProtectionProvider>
        </ThemeProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
