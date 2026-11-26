import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  AppState,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, {
  FadeIn,
  FadeInDown,
  FadeOut,
  FadeOutUp,
  LinearTransition,
  runOnJS,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { SpringPressable } from '../src/components/SpringPressable';
import { motion } from '../src/theme/motion';
import * as Haptics from 'expo-haptics';
import {
  Bell,
  ChevronDown,
  Download,
  History,
  MapPin,
  MapPinned,
  Settings2,
  X,
} from '../src/components/icons';
import { LineBadge } from '../src/components/LineBadge';
import { consumePendingBoardedOrigin } from '../src/services/boardedOriginSelection';
import { useCurrentLocation } from '../src/services/currentLocation';
import {
  ONBOARD_MIN_SPEED_MPS,
  buildBoardedOriginFromVehicle,
  detectBoardedVehicles,
  findNearbyLiveVehicles,
} from '../src/services/onboardDetector';
import { gtfsStore } from '../src/services/routing/store';
import { useWebLayout } from '../src/theme/layout';
import { elev, scheme, shape, type } from '../src/theme/tokens';
import { useStrings, type Strings } from '../src/i18n';
import { defaultLocationForCity } from '../src/config';
import {
  getActiveCityIdSync,
  isManualCitySelectedInSession,
  useActiveCity,
  type CitySwitchSource,
} from '../src/services/cityStore';
import {
  FavoritesService,
  LocationService,
  RoutingService,
  SearchService,
  subscribeSavedRoutes,
  recordTripSearch,
  type LocationResult,
} from '../src/services';
import { liveTracker } from '../src/services/liveTracker';
import { useTrackedTrip, stopTracking } from '../src/services/notifications';
import {
  deleteTicketForConnection,
  getTicketConnectionIds,
  getTicketForConnection,
  type AttachedRailTicket,
} from '../src/services/ticketStorage';
import { boardingDepartureMs } from '../src/services/routing/connectionTimes';
import { clockFromMs } from '../src/services/notifications/format';
import { nextPullOption } from '../src/services/lastTripPull';
import { isOutsideServiceArea } from '../src/services/serviceArea';
import {
  type DataStatus,
  ensureActiveCityTimetable,
  getDataStatus,
  importGtfsFromNetwork,
  subscribeDataStatus,
} from '../src/services/dataManager';
import { subscribeBackupApplied } from '../src/services/backup';
import {
  loadCachedSmartDestinations,
  loadTripHistory,
  saveCachedSmartDestinations,
  type TripHistoryItem,
} from '../src/services/smartRanker';

import {
  buildRoutesLink,
  mergeWidgetSnapshot,
  type WidgetPlace,
  type WidgetQuickItem,
} from '../src/services/widgetSnapshot';
import type {
  BoardedTripOrigin,
  Connection,
  SavedPlace,
  SmartDestination,
  Suggestion,
} from '../src/types/models';
import { SavedPlacesRow, SAVED_PLACE_ICONS } from '../src/components/SavedPlacesRow';
import { getSuggestionIconMeta, type SuggestionIconMeta } from '../src/components/SuggestionRow';
import { HomeThumbBar } from '../src/components/HomeThumbBar';
import type { DockChip } from '../src/components/HomeDockChips';
import {
  LAST_TRIP_ARM_1,
  LAST_TRIP_ARM_2,
  LAST_TRIP_DISARM_2,
  LAST_TRIP_MAX,
  LastTripPull,
  type LastTripOption,
} from '../src/components/LastTripPull';
import { SearchSheet } from '../src/components/SearchSheet';
import { SheetLoadingFallback } from '../src/components/SkeletonPulse';
import { SmartHistoryList } from '../src/components/SmartHistoryList';
import { SavedRoutesList } from '../src/components/SavedRoutesList';
import type { SavedRoute } from '../src/types/models';
import { getCity, suggestCityForCoords, type CityId } from '../src/cities';
import { hasCityDb } from '../src/services/gtfsDatabase';
import { hasSeenOnboardingSync } from '../src/services/onboarding';

const TicketInspectionModal = lazy(() =>
  import('../src/components/TicketInspectionModal').then((m) => ({
    default: m.TicketInspectionModal,
  })),
);
const AddPlaceSheet = lazy(() =>
  import('../src/components/AddPlaceSheet').then((m) => ({ default: m.AddPlaceSheet })),
);
const ManagePlacesSheet = lazy(() =>
  import('../src/components/ManagePlacesSheet').then((m) => ({
    default: m.ManagePlacesSheet,
  })),
);
const CitySelectSheet = lazy(() =>
  import('../src/components/CitySelectSheet').then((m) => ({ default: m.CitySelectSheet })),
);

/** Okno widoczności chipu biletu w docku: odjazd w ciągu 3 h. */
const TICKET_CHIP_WINDOW_MS = 3 * 60 * 60 * 1000;

/** Etykieta czasu chipu: „za 12 min” do godziny, dalej zegar „14:02”. */
function countdownLabel(deltaMs: number, s: Strings): string {
  const min = Math.round(deltaMs / 60000);
  if (min >= 60) return clockFromMs(Date.now() + deltaMs);
  if (min <= 1) return s.common.departNow;
  return s.common.departIn(min);
}

/** Cel trasy czekający na ręczny start po blokadzie GPS. */
type RouteTarget = {
  id: string;
  title: string;
  address?: string;
  lat: number;
  lon: number;
  kind?: Suggestion['kind'];
};

/** Start przekazany jawnie: świeży wybór z arkusza wygrywa ze stanem ekranu. */
type RouteOrigin = { id?: string; title: string; lat: number; lon: number; custom: boolean };

export default function HomeScreen() {
  const s = useStrings();
  const router = useRouter();
  const webLayout = useWebLayout();
  const { cityId, setCity } = useActiveCity();
  const cityGen = s.city.gen(cityId);
  const GPS_ITEM: Suggestion = useMemo(
    () => ({
      id: '__gps',
      title: s.home.gpsTitle,
      address: s.home.gpsAddressHome,
      kind: 'history',
      lat: 0,
      lon: 0,
    }),
    [s],
  );
  const [saved, setSaved] = useState<SavedPlace[]>([]);
  const [smart, setSmart] = useState<SmartDestination[]>([]);
  // Prawdziwa pustka vs ładowanie: pusty stan pokazujemy dopiero, gdy świeży
  // ranking (albo błąd GPS) potwierdzi brak danych: inaczej migałby przed GPS.
  const [smartReady, setSmartReady] = useState(false);
  const [sheetMode, setSheetModeRaw] = useState<'destination' | 'start' | null>(null);
  const sheetCloseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clearSheetCloseTimer = useCallback(() => {
    if (sheetCloseTimerRef.current) {
      clearTimeout(sheetCloseTimerRef.current);
      sheetCloseTimerRef.current = null;
    }
  }, []);
  const setSheetMode = useCallback(
    (next: 'destination' | 'start' | null) => {
      clearSheetCloseTimer();
      setSheetModeRaw(next);
    },
    [clearSheetCloseTimer],
  );
  useEffect(() => () => clearSheetCloseTimer(), [clearSheetCloseTimer]);
  const [returnToDestinationAfterStart, setReturnToDestinationAfterStart] = useState(false);
  // Cel zapamiętany przy blokadzie startu z GPS: po ręcznym starcie wracamy
  // do niego, zamiast kazać użytkownikowi wpisywać go od nowa.
  const pendingDestinationRef = useRef<RouteTarget | null>(null);
  const [savedEditFocused, setSavedEditFocused] = useState(false);
  const [gpsLocation, setGpsLocation] = useState<{
    lat: number;
    lon: number;
    title: string;
    stopId?: string;
    city?: string | null;
  } | null>(null);
  const [isCustomStart, setIsCustomStart] = useState(false);
  const [boardedOrigin, setBoardedOrigin] = useState<BoardedTripOrigin | null>(null);
  const [dismissedOnboardKey, setDismissedOnboardKey] = useState<string | null>(null);
  const [liveVersion, setLiveVersion] = useState(0);
  const [gtfsLoaded, setGtfsLoaded] = useState(() => gtfsStore.isLoaded);
  // Ref dla asynchronicznych fixów GPS: nie mogą nadpisać ręcznie wybranego startu.
  const isCustomStartRef = useRef(isCustomStart);
  isCustomStartRef.current = isCustomStart;
  // Generacja wyboru startu: spóźniony GPS jest odrzucany, gdy w międzyczasie
  // użytkownik wybrał inny start.
  const startSelGen = useRef(0);
  // GPS poza strefą aktywnego miasta: tras z GPS nie liczymy,
  // start trzeba wybrać ręcznie. Miasto z reverse-geocode do komunikatu.
  const [gpsUnsupported, setGpsUnsupported] = useState(false);
  const [gpsCity, setGpsCity] = useState<string | null>(null);
  // Miasto z GPS (strefa) i stan jego bazy: przycisk pobrania w lewym górnym rogu.
  const gpsSuggestedCity = useMemo(
    () => (gpsLocation ? suggestCityForCoords(gpsLocation.lat, gpsLocation.lon) : null),
    [gpsLocation],
  );
  const gpsOtherCityId =
    gpsUnsupported && gpsSuggestedCity && gpsSuggestedCity.id !== cityId
      ? gpsSuggestedCity.id
      : null;
  const gpsOutsideAll = gpsUnsupported && gpsLocation != null && gpsSuggestedCity == null;
  const [gpsCityReady, setGpsCityReady] = useState<{ id: CityId; ok: boolean } | null>(null);
  const gpsDownloadCityId =
    gpsOtherCityId && gpsCityReady?.id === gpsOtherCityId && !gpsCityReady.ok
      ? gpsOtherCityId
      : null;
  const [addPlaceOpen, setAddPlaceOpen] = useState(false);
  const [manageSheetOpen, setManageSheetOpen] = useState(false);
  const [citySheetOpen, setCitySheetOpen] = useState(false);
  const [switchingCity, setSwitchingCity] = useState(false);
  const [switchingCityId, setSwitchingCityId] = useState<CityId | null>(null);
  // Generacja przełączenia: szybki drugi wybór wygrywa z poprzednim, bez gubienia tapów.
  const switchGenRef = useRef(0);
  const [editingPlace, setEditingPlace] = useState<SavedPlace | null>(null);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Suggestion[]>([]);
  const [recent, setRecent] = useState<Suggestion[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchError, setSearchError] = useState(false);
  const [locTitle, setLocTitle] = useState(
    () => defaultLocationForCity(getActiveCityIdSync()).title,
  );
  const [currentCoords, setCurrentCoords] = useState<{ lat: number; lon: number }>(() => {
    const d = defaultLocationForCity(getActiveCityIdSync());
    return { lat: d.lat, lon: d.lon };
  });
  const currentCoordsRef = useRef(currentCoords);
  currentCoordsRef.current = currentCoords;
  const insets = useSafeAreaInsets();
  const isFocusedRef = useRef(true);
  const hasDockCountdownRef = useRef(false);
  const sheetModeRef = useRef(sheetMode);
  sheetModeRef.current = sheetMode;
  const queryRef = useRef(query);
  queryRef.current = query;
  const recentDirtyRef = useRef(false);
  const { location: motionLocation } = useCurrentLocation(
    !isCustomStart && !boardedOrigin && !gpsUnsupported,
    false,
  );
  // Odliczanie w chipach docka (śledzony kurs / bilet) tyka tylko gdy są aktywne.
  const [homeTick, setHomeTick] = useState(0);
  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      const wasBlurred = !isFocusedRef.current;
      isFocusedRef.current = true;
      let timer: ReturnType<typeof setTimeout> | null = null;
      if (wasBlurred) {
        // Odraczamy odświeżenia tła za 200 ms animację powrotu, aby gest wstecz z listy tras był natychmiastowy.
        timer = setTimeout(() => {
          if (cancelled) return;
          if (hasDockCountdownRef.current) {
            setHomeTick(Date.now());
          }
          if (recentDirtyRef.current) {
            recentDirtyRef.current = false;
            SearchService.recent()
              .then((list) => {
                if (!cancelled) setRecent(list);
              })
              .catch(() => {});
          }
        }, 240);
      }
      return () => {
        cancelled = true;
        if (timer) clearTimeout(timer);
        isFocusedRef.current = false;
      };
    }, []),
  );
  const [dataStatus, setDataStatus] = useState<DataStatus>(getDataStatus());
  const [newsAlert, setNewsAlert] = useState(false);

  // Szybki skrót pull-to-refresh do ostatniego połączenia: pełna obsługa
  // gestem, zero klikalnych elementów. pullOption żyje w shared value (UI thread),
  // wysokość reveal w shared value (płynnie, bez rerenderów).
  const [lastTrip, setLastTrip] = useState<TripHistoryItem | null>(null);
  const pullOption = useSharedValue<LastTripOption>(0);
  // „Na górze” jako stan też: `enabled` gestu pochodzi z renderu, bo przy
  // przewiniętej liście pull nie może zabierać zwykłego scrollowania.
  const [atTop, setAtTop] = useState(true);
  const atTopRef = useRef(true);
  const pullHeight = useSharedValue(0);
  const lastTripRef = useRef<TripHistoryItem | null>(null);
  lastTripRef.current = lastTrip;
  const sheetsOpen = sheetMode !== null || manageSheetOpen || addPlaceOpen || citySheetOpen;

  // Widgety mogą otworzyć wyszukiwarkę albo zarządzanie zapisanymi miejscami.
  // Parametry czyścimy, żeby powrót na ekran nie otwierał arkusza ponownie.
  const { search: searchParam, places: placesParam } = useLocalSearchParams<{
    search?: string;
    places?: string;
  }>();
  useEffect(() => {
    if (searchParam === '1') {
      setQuery('');
      setSheetMode('destination');
      router.setParams({ search: undefined });
    }
    if (placesParam === '1') {
      setManageSheetOpen(true);
      router.setParams({ places: undefined });
    }
  }, [placesParam, searchParam, router]);

  useEffect(() => {
    return subscribeDataStatus(setDataStatus);
  }, []);

  // Baza miasta, w którym jest GPS: decyduje, czy przełączyć od razu,
  // czy pokazać skrót pobrania.
  useEffect(() => {
    if (!gpsOtherCityId) {
      setGpsCityReady(null);
      return;
    }
    let cancelled = false;
    hasCityDb(gpsOtherCityId)
      .then((ok) => {
        if (!cancelled) setGpsCityReady({ id: gpsOtherCityId, ok });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [gpsOtherCityId]);

  // Ekran montuje się pod onboardingiem i wraca na wierzch po jego
  // ukończeniu: dociągamy prawdziwy fix po animacji powrotu.
  useFocusEffect(
    useCallback(() => {
      if (hasSeenOnboardingSync() === false) return undefined;
      const timer = setTimeout(() => {
        void LocationService.refineLocation();
      }, 280);
      return () => clearTimeout(timer);
    }, []),
  );

  const shouldWatchLive =
    sheetMode === 'start' ||
    (!isCustomStart &&
      !boardedOrigin &&
      motionLocation?.speed != null &&
      motionLocation.speed >= ONBOARD_MIN_SPEED_MPS);

  // Poll live odpalamy na ekranie głównym tylko gdy faktycznie szukamy pojazdu
  // (sheet startu lub wykryty ruch w pojeździe), bez wymuszania re-renderu przy każdym focus/blur.
  useFocusEffect(
    useCallback(() => {
      if (!shouldWatchLive || hasSeenOnboardingSync() === false) return undefined;
      liveTracker.acquire();
      if (!gtfsStore.isLoaded && getDataStatus().state === 'ready') {
        void gtfsStore.load().then(() => setGtfsLoaded(gtfsStore.isLoaded)).catch(() => {});
      }
      setLiveVersion((v) => v + 1);
      const unsub = liveTracker.subscribe(() => {
        setLiveVersion((v) => v + 1);
      });
      return () => {
        unsub();
        liveTracker.release();
      };
    }, [shouldWatchLive]),
  );

  const onboardCandidates = useMemo(() => {
    if (isCustomStart || boardedOrigin || gpsUnsupported) return [];
    if (!gtfsLoaded) return [];
    const list = detectBoardedVehicles(motionLocation, liveTracker.snapshot(), gtfsStore);
    const key = list.map((c) => c.vehicle.vehicleId).join(',');
    if (dismissedOnboardKey && key === dismissedOnboardKey) return [];
    return list;
  }, [boardedOrigin, dismissedOnboardKey, gpsUnsupported, gtfsLoaded, isCustomStart, liveVersion, motionLocation]);

  const nearbyVehicles = useMemo(() => {
    if (sheetMode !== 'start' || !gtfsLoaded) return [];
    const refLat = gpsLocation?.lat ?? currentCoords.lat;
    const refLon = gpsLocation?.lon ?? currentCoords.lon;
    return findNearbyLiveVehicles(refLat, refLon, liveTracker.snapshot(), gtfsStore);
  }, [currentCoords.lat, currentCoords.lon, gpsLocation?.lat, gpsLocation?.lon, gtfsLoaded, liveVersion, sheetMode]);

  // Badge na dzwonku: dzisiejsze pilne utrudnienie (feed miasta).
  // Sprawdzamy przy starcie i powrocie na foreground, bez interwału, żeby nie spamować feedu.
  // Zmiana miasta to nowy feed: badge trzeba przeliczyć od zera, inaczej wisiałby
  // z poprzedniego miasta do najbliższego foregroundu.
  useEffect(() => {
    let cancelled = false;
    let activeController: AbortController | null = null;
    setNewsAlert(false);
    // Miasto bez źródła komunikatów (features.news) nie odpytuje R2/feedów:
    // nie ma tam czego pokazać, a dzwonek jest ukryty.
    if (!getCity(cityId).features.news || hasSeenOnboardingSync() === false) return;
    const checkNews = async () => {
      activeController?.abort();
      const controller = new AbortController();
      activeController = controller;
      try {
        const { fetchCityNews, shouldShowNewsAlert } = await import('../src/services/mpkNews');
        const news = await fetchCityNews(controller.signal);
        if (cancelled || controller.signal.aborted || getActiveCityIdSync() !== cityId) return;
        const alert = await shouldShowNewsAlert(news);
        if (!cancelled && getActiveCityIdSync() === cityId) setNewsAlert(alert);
      } catch {
        // brak internetu / błąd RSS: badge po prostu znika, bez krzykliwego błędu
      }
    };
    void checkNews();
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') void checkNews();
    });
    return () => {
      cancelled = true;
      activeController?.abort();
      sub.remove();
    };
  }, [cityId]);

  // Weryfikacja badge'a przy powrocie na ekran główny (np. po wyjściu z sekcji newsów)
  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      // Dzwonek jest ukryty w miastach bez źródła komunikatów.
      if (!getCity(cityId).features.news) return;
      const timer = setTimeout(() => {
        if (cancelled) return;
        const verify = async () => {
          try {
            const { getCachedNews, shouldShowNewsAlert } = await import('../src/services/mpkNews');
            const cached = getCachedNews();
            if (cached) {
              const alert = await shouldShowNewsAlert(cached);
              if (!cancelled) setNewsAlert((prev) => (prev === alert ? prev : alert));
            }
          } catch {}
        };
        void verify();
      }, 280);
      return () => {
        cancelled = true;
        clearTimeout(timer);
      };
    }, [cityId]),
  );

  // Status danych: przy starcie, powrocie na foreground i co 30 s.
  // Sprawdza lokalny GTFS miasta (pusty -> auto-download) i domyślnie dba
  // o ogólnopolski rozkład kolejowy w tle.
  useEffect(() => {
    const check = async () => {
      if (!isFocusedRef.current) return;
      const st = await ensureActiveCityTimetable({ checkUpdates: true }).catch(
        () => ({ state: 'empty' }) as const,
      );
      if (!isFocusedRef.current) return;
      if (st.state === 'ready') {
        import('../src/services/nationalTimetable')
          .then((m) => m.ensureNationalTimetable())
          .catch(() => {});
      }
    };
    void check();
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') void check();
    });
    const timer = setInterval(check, 30000);
    return () => {
      sub.remove();
      clearInterval(timer);
    };
  }, [cityId]);

  const reduceMotion = useReducedMotion();
  const [homeTab, setHomeTab] = useState<'recent' | 'saved'>('recent');
  const [tabBarWidth, setTabBarWidth] = useState(0);
  const tabPillProgress = useSharedValue(0);

  useEffect(() => {
    const target = homeTab === 'saved' ? 1 : 0;
    tabPillProgress.value = reduceMotion ? target : withSpring(target, motion.spring.spatialFast);
  }, [homeTab, reduceMotion, tabPillProgress]);

  const tabPillStyle = useAnimatedStyle(() => {
    const innerWidth = Math.max(0, tabBarWidth - 10);
    const segWidth = Math.max(0, (innerWidth - 4) / 2);
    return {
      width: segWidth,
      opacity: segWidth > 0 ? 1 : 0,
      transform: [{ translateX: tabPillProgress.value * (segWidth + 4) }],
    };
  }, [tabBarWidth]);
  const [savedRoutes, setSavedRoutes] = useState<SavedRoute[]>([]);
  // Połączenia z dołączonym biletem: ikona biletu i wyższa pozycja w „Twoich trasach”.
  const [ticketIds, setTicketIds] = useState<Set<string>>(() => new Set());
  // Bilet otwarty do kontroli z karty trasy (pełnoekranowy podgląd kodu).
  const [inspection, setInspection] = useState<{
    ticket: AttachedRailTicket;
    connection: Connection;
  } | null>(null);
  const { trip: trackedTrip, progress: trackedProgress } = useTrackedTrip();
  const hasDockCountdown = trackedTrip !== null || ticketIds.size > 0;
  hasDockCountdownRef.current = hasDockCountdown;
  useEffect(() => {
    if (!hasDockCountdown) return;
    const t = setInterval(() => {
      if (isFocusedRef.current) setHomeTick(Date.now());
    }, 30000);
    return () => clearInterval(t);
  }, [hasDockCountdown]);

  const refreshSavedRoutes = useCallback(() => {
    RoutingService.getSavedRoutes()
      .then((routes) => {
        setSavedRoutes((prev) => {
          if (
            prev.length === routes.length &&
            prev.every((r, i) => r.id === routes[i].id && r.savedAt === routes[i].savedAt)
          ) {
            return prev;
          }
          return routes;
        });
      })
      .catch(() => {});
  }, []);

  const refreshTicketIds = useCallback(() => {
    getTicketConnectionIds()
      .then((next) => {
        setTicketIds((prev) => {
          if (prev.size === next.size) {
            let same = true;
            for (const id of next) {
              if (!prev.has(id)) {
                same = false;
                break;
              }
            }
            if (same) return prev;
          }
          return next;
        });
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    refreshSavedRoutes();
    refreshTicketIds();
    return subscribeSavedRoutes(refreshSavedRoutes);
  }, [refreshSavedRoutes, refreshTicketIds, cityId]);

  useFocusEffect(
    useCallback(() => {
      const timer = setTimeout(() => {
        refreshSavedRoutes();
        refreshTicketIds();
      }, 240);
      return () => clearTimeout(timer);
    }, [refreshSavedRoutes, refreshTicketIds]),
  );

  // Kolejność „Twoich tras”: aktywnie śledzona podróż -> trasy z biletem -> reszta
  // historii. Śledzony kurs może nie być zapisany (start śledzenia bez pinezki),
  // więc wpięcie go na listę syntetycznym wpisem gwarantuje mu pierwsze miejsce.
  const orderedSavedRoutes = useMemo(() => {
    const activeConn = trackedTrip?.connection;
    const list = [...savedRoutes];
    if (activeConn && !list.some((r) => r.id === activeConn.id)) {
      list.push({
        id: activeConn.id,
        savedAt: trackedTrip?.startedAt ?? Date.now(),
        connection: activeConn,
      });
    }
    const rank = (r: SavedRoute) =>
      activeConn && r.id === activeConn.id ? 0 : ticketIds.has(r.id) ? 1 : 2;
    return list.sort((a, b) => rank(a) - rank(b) || b.savedAt - a.savedAt);
  }, [savedRoutes, trackedTrip, ticketIds]);

  const handleTabSwitch = useCallback(
    (tab: 'recent' | 'saved') => {
      if (tab === homeTab) return;
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
      setHomeTab(tab);
    },
    [homeTab],
  );

  // Id śledzonego połączenia: wystarczy do warunku usuwania, bez przeładowywania
  // przy każdym ticku monitora (cały trackedTrip zmienia referencję przy odświeżeniach).
  const trackedConnId = trackedTrip?.connection.id ?? null;

  const handleRemoveSavedRoute = useCallback(
    async (route: SavedRoute) => {
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
      try {
        await RoutingService.deleteSavedRoute(route.id);
        void deleteTicketForConnection(route.id).catch(() => {});
        refreshTicketIds();
        // Usuwanie aktywnie śledzonej karty zatrzymuje też monitor: bez tego
        // wpis wracał na górę listy jako syntetyczna „aktywna podróż”.
        if (route.id === trackedConnId) {
          await stopTracking();
        }
      } catch (err) {
        console.warn('Failed to delete saved route:', err);
      }
    },
    [trackedConnId, refreshTicketIds],
  );

  // Odpięcie aktywnego kursu: zatrzymuje monitor i powiadomienia, trasa zostaje w historii.
  const handleUnpinSavedRoute = useCallback(
    async (route: SavedRoute) => {
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
      if (route.id !== trackedConnId) return;
      try {
        await RoutingService.saveRoute(route.connection);
      } catch (err) {
        console.warn('Failed to ensure route saved before unpin:', err);
      }
      void stopTracking().catch((err) => console.warn('Failed to stop tracking:', err));
    },
    [trackedConnId],
  );

  // Otwarcie biletu PDF z karty trasy: kod Aztec na pełnym ekranie do kontroli.
  const handleOpenSavedTicket = useCallback(
    async (route: SavedRoute) => {
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
      try {
        const ticket = await getTicketForConnection(route.id, route.connection);
        if (!ticket) {
          // Bilet mógł wygasnąć po retencji: odśwież ikony, zamiast pokazywać pusty podgląd.
          refreshTicketIds();
          return;
        }
        setInspection({ ticket, connection: route.connection });
      } catch (err) {
        console.warn('Failed to open saved ticket:', err);
      }
    },
    [refreshTicketIds],
  );

  const handleSelectSavedRoute = useCallback(
    (route: SavedRoute) => {
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
      router.push({ pathname: '/routes/[id]', params: { id: route.connection.id } });
    },
    [router],
  );

  // Chipy nad search barem: przypięta podróż (śledzony kurs) + pociągi
  // z biletem odjeżdżające w ciągu 3 h, najbliżej pierwszy. Kurs przypięty
  // i z biletem to jeden pill: segment biletu doklejamy do chipu podróży.
  // homeTick (30 s) odświeża odliczanie „za X min”.
  const dockChips = useMemo<DockChip[]>(() => {
    const now = Date.now();
    // Odcinki pojazdowe do LineBadge'ów: pierwsze dwa, dalej chip robi się
    // zbyt szeroki na szybki skrót.
    const badgeLegs = (conn: Connection) =>
      conn.legs.filter((l) => l.mode !== 'walk' && l.line).slice(0, 2);

    let boardedChip: DockChip | null = null;
    if (boardedOrigin) {
      boardedChip = {
        id: `boarded:${boardedOrigin.tripId}`,
        badgeLegs: [
          {
            id: 'boarded',
            mode: boardedOrigin.mode ?? 'bus',
            line: boardedOrigin.line,
            fromStop:
              (boardedOrigin.boardStopId
                ? gtfsStore.stops.get(boardedOrigin.boardStopId)?.stop_name
                : undefined) || '',
            toStop: boardedOrigin.direction || '',
            departAt: '',
            arriveAt: '',
            stopsCount: 0,
            live: true,
          },
        ],
        title: s.home.boardedChipTitle(boardedOrigin.line),
        timeLabel: s.home.boardedInVehicle,
        a11yLabel: s.home.boardedOriginTitle(boardedOrigin.line, boardedOrigin.direction || ''),
        onPress: () => {
          void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
          setQuery('');
          setSheetMode('start');
        },
      };
    }
    let pinnedChip: DockChip | null = null;
    if (trackedTrip) {
      const depInSec = trackedProgress?.departInSec ?? null;
      const time =
        depInSec != null && depInSec > 0 ? countdownLabel(depInSec * 1000, s) : undefined;
      pinnedChip = {
        id: `pinned:${trackedTrip.connection.id}`,
        badgeLegs: badgeLegs(trackedTrip.connection),
        title: trackedTrip.toTitle,
        timeLabel: time,
        pinned: true,
        a11yLabel: s.home.dockPinnedA11y(trackedTrip.toTitle, time),
        onPress: () => {
          void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
          router.push({ pathname: '/routes/[id]', params: { id: trackedTrip.connection.id } });
        },
      };
    }
    const tickets: { chip: DockChip; depMs: number }[] = [];
    for (const route of savedRoutes) {
      if (!ticketIds.has(route.id)) continue;
      if (pinnedChip && route.id === trackedTrip?.connection.id) {
        pinnedChip.ticket = {
          a11y: s.railTickets.showTicket,
          onOpen: () => void handleOpenSavedTicket(route),
        };
        continue;
      }
      const depMs = boardingDepartureMs(route.connection, new Date(now));
      if (!Number.isFinite(depMs)) continue;
      const delta = depMs - now;
      if (delta < 0 || delta > TICKET_CHIP_WINDOW_MS) continue;
      tickets.push({
        depMs,
        chip: {
          id: `ticket:${route.id}`,
          badgeLegs: badgeLegs(route.connection),
          title: route.connection.toTitle,
          timeLabel: countdownLabel(delta, s),
          ticket: {
            a11y: s.railTickets.showTicket,
            onOpen: () => void handleOpenSavedTicket(route),
          },
          a11yLabel: s.home.dockTicketA11y(route.connection.toTitle, clockFromMs(depMs)),
          onPress: () => handleSelectSavedRoute(route),
        },
      });
    }
    tickets.sort((a, b) => a.depMs - b.depMs);
    return [
      ...(boardedChip ? [boardedChip] : []),
      ...(pinnedChip ? [pinnedChip] : []),
      ...tickets.map((t) => t.chip),
    ];
  }, [
    boardedOrigin,
    trackedTrip,
    trackedProgress,
    savedRoutes,
    ticketIds,
    homeTick,
    s,
    router,
    setSheetMode,
    handleOpenSavedTicket,
    handleSelectSavedRoute,
  ]);

  const refreshPlaces = useCallback(() => {
    const requestedCity = getActiveCityIdSync();
    FavoritesService.list()
      .then((places) => {
        if (requestedCity === getActiveCityIdSync()) setSaved(places);
      })
      .catch(() => {});
  }, []);

  // Świeży ranking zapisujemy do cache, żeby następny start namalował
  // gołe ostatnie miejsca natychmiast (bez czekania na GPS).
  const applySmart = useCallback((list: SmartDestination[]) => {
    setSmart(list);
    setSmartReady(true);
    void saveCachedSmartDestinations(list);
  }, []);

  // Unieważnianie spóźnionych rankingów: zapytanie wysłane dla starego originu
  // (np. poprzednia pozycja GPS) nie może nadpisać świeższego wyniku.
  // Origin trzymamy jako stop-id, tak jak zapisuje go GPS, a nie sam tytuł-
  // inaczej ranking po zapisie miejsca liczyłby się z innego klucza.
  const smartGen = useRef(0);
  const originStopRef = useRef<string>(defaultLocationForCity(getActiveCityIdSync()).title);
  const smartCoordsRef = useRef<{ lat: number; lon: number } | null>(null);
  const requestSmart = useCallback(
    (originStop: string, coords: { lat: number; lon: number }) => {
      originStopRef.current = originStop;
      smartCoordsRef.current = coords;
      const gen = ++smartGen.current;
      const requestedCity = getActiveCityIdSync();
      FavoritesService.smartFromOrigin(originStop, coords)
        .then((list) => {
          if (gen !== smartGen.current || requestedCity !== getActiveCityIdSync()) return;
          applySmart(list);
        })
        .catch(() => {
          if (gen === smartGen.current && requestedCity === getActiveCityIdSync())
            setSmartReady(true);
        });
    },
    [applySmart],
  );

  useEffect(() => {
    let cancelled = false;
    const cacheGen = smartGen.current;
    refreshPlaces();
    SearchService.recent()
      .then((list) => {
        if (!cancelled) setRecent(list);
      })
      .catch(() => {});
    loadTripHistory()
      .then((h) => {
        if (!cancelled && h.length > 0) setLastTrip(h[0]);
      })
      .catch(() => {});
    // Spóźniony cache nie może nadpisać rankingu wyliczonego z nowej pozycji.
    loadCachedSmartDestinations()
      .then((cached) => {
        if (!cancelled && cacheGen === smartGen.current && cached.length > 0) setSmart(cached);
      })
      .catch(() => {});

    // Jeden sposób aplikowania fixu: pierwszy szybki odczyt i każdy późniejszy
    // (dokładniejszy w tle) przechodzą tędy, żeby ranking i start tras zawsze
    // używały najlepszej znanej pozycji.
    const applyGpsFix = (l: LocationResult) => {
      if (cancelled) return;
      const outside = isOutsideServiceArea(l.lat, l.lon);
      const city = l.city ?? null;
      setGpsLocation({ lat: l.lat, lon: l.lon, title: l.title, stopId: l.stopId, city });
      if (outside) {
        // Poza strefą: GPS zostaje tylko jako informacja do karty,
        // a ranking i trasy liczymy z centrum aktywnego miasta, bo start
        // i tak trzeba wybrać ręcznie, więc nie podstawiamy pozycji spoza.
        setGpsUnsupported(true);
        setGpsCity(city);
        if (!isCustomStartRef.current) {
          const d = defaultLocationForCity(getActiveCityIdSync());
          requestSmart(d.title, { lat: d.lat, lon: d.lon });
        }
        return;
      }
      setGpsUnsupported(false);
      setGpsCity(null);
      if (isCustomStartRef.current) return;
      setLocTitle(l.title);
      const coords = { lat: l.lat, lon: l.lon };
      setCurrentCoords(coords);
      requestSmart(l.stopId || l.title, coords);
    };

    LocationService.getCurrentLocation()
      .then(applyGpsFix)
      .catch(() => {
        // Brak GPS (brak zgody / emulator): lista zostaje z cache, a flaga
        // gotowości pozwala pokazać uczciwy pusty stan zamiast wiecznej dziury.
        if (!cancelled) setSmartReady(true);
      });
    const unsubscribeGps = LocationService.subscribe(applyGpsFix);
    return () => {
      cancelled = true;
      smartGen.current++;
      unsubscribeGps();
    };
    // Zmiana miasta to nowy kontekst: GPS, historia i cache ulubionych należą
    // do poprzedniego miasta, więc efekt startuje od nowa.
  }, [cityId, refreshPlaces, requestSmart]);

  // Sam reset stanu per-miasto. Ekran główny zostaje zamontowany, gdy Settings
  // jest wypchnięty na stos (native stack nie robi unmount), więc bez tego
  // po zmianie miasta pokazywałby stare ulubione, starą pozycję startu
  // i orzekał „Wrocław" przy aktywnym Krakowie.
  const firstCityRun = useRef(true);
  useEffect(() => {
    if (firstCityRun.current) {
      firstCityRun.current = false;
      return;
    }
    isCustomStartRef.current = false;
    startSelGen.current++;
    pendingDestinationRef.current = null;
    smartCoordsRef.current = null;
    setIsCustomStart(false);
    setGtfsLoaded(false);
    setGpsCityReady(null);
    setBoardedOrigin(null);
    setDismissedOnboardKey(null);
    setQuery('');
    setResults([]);
    setSmart([]);
    setSaved([]);
    setSmartReady(false);
    setRecent([]);
    setLastTrip(null);
    setGpsUnsupported(false);
    setGpsCity(null);
    const d = defaultLocationForCity(cityId);
    setLocTitle(d.title);
    setCurrentCoords({ lat: d.lat, lon: d.lon });
    // Pull ostatniego połączenia żyje na shared values, więc przetrwałby
    // zmianę miasta: nowa historia odsłoniłaby od razu pół ekranu. Zwijamy.
    pullOption.value = 0;
    pullHeight.value = withTiming(0, { duration: 180 });
    refreshSavedRoutes();
  }, [cityId, refreshSavedRoutes, pullHeight, pullOption]);

  // Po zakończeniu importu GTFS aktualizujemy odjazdy i uruchamiamy domyślny sync kolei
  useEffect(() => {
    if (dataStatus.state === 'ready') {
      refreshPlaces();
      import('../src/services/nationalTimetable')
        .then((m) => m.ensureNationalTimetable())
        .catch(() => {});
      if (!isCustomStart) {
        LocationService.getCurrentLocation()
          .then((l) => {
            if (isOutsideServiceArea(l.lat, l.lon)) return;
            const coords = { lat: l.lat, lon: l.lon };
            requestSmart(l.stopId || l.title, coords);
          })
          .catch(() => {});
      } else {
        requestSmart(originStopRef.current, currentCoords);
      }
    }
  }, [dataStatus.state, isCustomStart, locTitle, currentCoords, refreshPlaces, requestSmart]);

  // Snapshot dla widgetów z ekranu głównego. Sekcję `pinned` pisze monitor
  // podróży (ma przeliczony plan), home dostarcza skróty do celów i zapisanych
  // miejsc bez przeliczania połączeń w tle.
  useEffect(() => {
    if (isCustomStart) return;
    if (!smartReady && smart.length === 0) return;
    const from = {
      fromTitle: locTitle,
      fromLat: currentCoords.lat,
      fromLon: currentCoords.lon,
      fromGps: true,
    };
    const linkTo = (d: { id: string; title: string; lat: number; lon: number }) =>
      buildRoutesLink({ ...from, toId: d.id, toTitle: d.title, toLat: d.lat, toLon: d.lon });

    const savedById = new Map(saved.map((p) => [p.placeId, p]));
    const quick: WidgetQuickItem[] = smart.slice(0, 4).map((d) => ({
      id: d.id,
      title: savedById.get(d.id)?.name || d.title,
      icon: savedById.get(d.id)?.icon ?? 'history',
      deepLink: linkTo(d),
    }));

    const places: WidgetPlace[] = saved.slice(0, 12).map((p) => ({
      id: p.id,
      name: p.name,
      icon: p.icon,
      deepLink: linkTo({ id: p.placeId, title: p.name, lat: p.lat, lon: p.lon }),
    }));

    void mergeWidgetSnapshot({ origin: locTitle, quick, places });
  }, [locTitle, saved, smart, smartReady, isCustomStart, currentCoords.lat, currentCoords.lon]);

  // Ostatnie przejazdy w identycznej kolejności co na ekranie głównym (smart history)
  const recentFromSmart: Suggestion[] = useMemo(() => {
    const remembered = new Map(recent.map((item) => [item.id, item]));
    const list: Suggestion[] = smart.map((s) => ({
      id: s.id,
      title: s.title,
      address: s.address,
      kind: remembered.get(s.id)?.kind ?? 'history',
      lat: s.lat,
      lon: s.lon,
      searchUsage: remembered.get(s.id)?.searchUsage,
    }));
    const seen = new Set(list.map((i) => i.id));
    for (const r of recent) {
      if (!seen.has(r.id)) {
        list.push(r);
        seen.add(r.id);
      }
    }
    return list;
  }, [smart, recent]);

  const recentWithGps = useMemo(
    () => (gpsUnsupported ? recentFromSmart : [GPS_ITEM, ...recentFromSmart]),
    [recentFromSmart, GPS_ITEM, gpsUnsupported],
  );

  // Kolejność wyświetlania: najlepszy wynik na górze, najsłabszy na dole.
  // `smart` z rankera jest już posortowane malejąco po wyniku: nie odwracamy.
  const smartOrdered = smart;

  // Ikonki jak w wyszukiwarce: zapisane miejsce -> jego ikona,
  // inaczej rodzaj z historii wyszukiwania, inaczej zegar (w liście).
  const smartIcons = useMemo(() => {
    const map: Record<string, SuggestionIconMeta | undefined> = {};
    const recentById = new Map(recent.map((r) => [r.id, r]));
    for (const d of smart) {
      const savedMatch = saved.find((p) => p.placeId === d.id);
      if (savedMatch) {
        map[d.id] = {
          Icon: SAVED_PLACE_ICONS[savedMatch.icon],
          bg: scheme.primaryContainer,
          fg: scheme.onPrimaryContainer,
        };
        continue;
      }
      const r = recentById.get(d.id);
      if (r) map[d.id] = getSuggestionIconMeta(r);
    }
    return map;
  }, [smart, saved, recent]);

  // GPS spoza strefy nie może być startem trasy: zamiast nawigacji
  // pokazujemy wyjaśnienie i otwieramy ręczny wybór punktu startowego.
  const blockGpsStart = useCallback(() => {
    Alert.alert(
      s.home.gpsBlockedTitle,
      gpsCity ? s.home.gpsBlockedBody(gpsCity, cityGen) : s.home.gpsBlockedBodyUnknown(cityGen),
      [
        { text: s.common.cancel, style: 'cancel' },
        {
          text: s.home.unsupportedAction,
          onPress: () => {
            setReturnToDestinationAfterStart(false);
            setQuery('');
            setSheetMode('start');
          },
        },
      ],
    );
  }, [gpsCity, cityGen, s, setSheetMode]);

  // Reset startu na GPS: natychmiast czyści stan w UI do domyślnego/ostatniego GPS,
  // a świeży fix dociąga się w tle bez blokowania interfejsu.
  const resetToGps = useCallback(() => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    const gen = ++startSelGen.current;
    pendingDestinationRef.current = null;
    isCustomStartRef.current = false;
    setIsCustomStart(false);
    setBoardedOrigin(null);

    const fallbackTitle = gpsLocation?.title ?? defaultLocationForCity(getActiveCityIdSync()).title;
    const fallbackCoords = gpsLocation
      ? { lat: gpsLocation.lat, lon: gpsLocation.lon }
      : (() => {
          const d = defaultLocationForCity(getActiveCityIdSync());
          return { lat: d.lat, lon: d.lon };
        })();
    const fallbackOrigin = gpsLocation?.stopId || fallbackTitle;

    setLocTitle(fallbackTitle);
    setCurrentCoords(fallbackCoords);
    requestSmart(fallbackOrigin, fallbackCoords);

    if (gpsUnsupported) {
      blockGpsStart();
      return;
    }

    LocationService.getCurrentLocation({ force: true })
      .then((l) => {
        // Ręczny start wybrany w trakcie odczytu unieważnia ten fix.
        if (gen !== startSelGen.current || isCustomStartRef.current) return;
        const outside = isOutsideServiceArea(l.lat, l.lon);
        const city = (l as { city?: string | null }).city ?? null;
        setGpsLocation({ lat: l.lat, lon: l.lon, title: l.title, stopId: l.stopId, city });
        if (outside) {
          setGpsUnsupported(true);
          setGpsCity(city);
          blockGpsStart();
          return;
        }
        setGpsUnsupported(false);
        setGpsCity(null);
        setLocTitle(l.title);
        const coords = { lat: l.lat, lon: l.lon };
        setCurrentCoords(coords);
        requestSmart(l.stopId || l.title, coords);
      })
      .catch((err) => {
        console.warn('[resetToGps] błąd pobierania pozycji GPS:', err);
      });
  }, [blockGpsStart, gpsLocation, gpsUnsupported, requestSmart]);

  const handleStartSelect = async (sel: Suggestion) => {
    setQuery('');
    if (sel.id === GPS_ITEM.id) {
      if (gpsUnsupported) {
        // Pozycja GPS spoza strefy: nie zamykamy arkusza, żeby użytkownik
        // od razu wybrał punkt ręcznie; sam alert by go wyrzucał z flow.
        Alert.alert(
          s.home.gpsBlockedTitle,
          gpsCity ? s.home.gpsBlockedBody(gpsCity, cityGen) : s.home.gpsBlockedBodyUnknown(cityGen),
        );
        setQuery('');
        return;
      }
      resetToGps();
      if (returnToDestinationAfterStart) {
        setReturnToDestinationAfterStart(false);
        setSheetMode('destination');
      } else {
        setSheetMode(null);
      }
      return;
    }

    // Ręczny start unieważnia GPS w locie i wygrywa z każdym późniejszym fixem.
    startSelGen.current++;
    isCustomStartRef.current = true;
    setIsCustomStart(true);
    setBoardedOrigin(null);
    setLocTitle(sel.title);
    const coords = { lat: sel.lat, lon: sel.lon };
    setCurrentCoords(coords);
    requestSmart(sel.id || sel.title, coords);
    void SearchService.recordRecent(sel)
      .then(() => {
        SearchService.recent()
          .then(setRecent)
          .catch(() => {});
      })
      .catch(() => {});

    if (returnToDestinationAfterStart) {
      setReturnToDestinationAfterStart(false);
      setSheetMode('destination');
      return;
    }
    const pending = pendingDestinationRef.current;
    pendingDestinationRef.current = null;
    setSheetMode(null);
    // Cel zablokowany wcześniej przez GPS: start już jest ręczny, więc trasa
    // rusza od razu, bez ponownego wpisywania celu.
    if (pending) {
      goToRoutes(pending, { id: sel.id, title: sel.title, lat: sel.lat, lon: sel.lon, custom: true });
    }
  };

  // Lokalny indeks odpowiada od razu; tylko sieć czeka na przerwę w pisaniu.
  const searchSeq = useRef(0);
  useEffect(() => {
    const seq = ++searchSeq.current;
    if (!sheetMode) return;
    const q = query.trim();
    setSearchError(false);
    if (!q) {
      setResults([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    SearchService.search(q, currentCoords, 'home-sheet', (partial) => {
      if (seq === searchSeq.current) setResults(partial);
    })
      .then((r) => {
        if (seq !== searchSeq.current) return;
        setResults(r);
        setLoading(false);
      })
      .catch(() => {
        if (seq === searchSeq.current) {
          setSearchError(true);
          setLoading(false);
        }
      });
    return () => {
      ++searchSeq.current;
      SearchService.cancel('home-sheet');
    };
  }, [query, sheetMode, currentCoords]);

  const handleSearchQuery = useCallback((next: string) => {
    setQuery(next);
    if (next.trim()) {
      setLoading(true);
    } else {
      setLoading(false);
      setResults([]);
    }
  }, []);

  const quick = useMemo<Suggestion[]>(
    () =>
      saved.map((p) => ({
        id: p.placeId || `saved:${p.id}`,
        title: p.name,
        address: p.address,
        kind: 'place',
        savedIcon: p.icon,
        lat: p.lat,
        lon: p.lon,
      })),
    [saved],
  );

  const applyBoardedOrigin = useCallback(
    (origin: BoardedTripOrigin, openDest = false) => {
      startSelGen.current++;
      isCustomStartRef.current = true;
      setIsCustomStart(true);
      setBoardedOrigin(origin);
      setDismissedOnboardKey(null);
      const title = s.home.boardedOriginTitle(origin.line, origin.direction || '');
      setLocTitle(title);
      const coords = {
        lat: origin.currentLat ?? currentCoordsRef.current.lat,
        lon: origin.currentLon ?? currentCoordsRef.current.lon,
      };
      setCurrentCoords(coords);
      requestSmart(origin.boardStopId || title, coords);
      if (openDest) {
        setReturnToDestinationAfterStart(false);
        setQuery('');
        setSheetMode('destination');
      }
    },
    [requestSmart, s.home, setSheetMode],
  );

  const goToRoutes = useCallback(
    (to: RouteTarget, origin?: RouteOrigin): boolean => {
      const activeBoarded = !origin ? boardedOrigin : null;
      const fromCustom = origin?.custom ?? (isCustomStartRef.current || Boolean(activeBoarded));
      // GPS spoza strefy nie może być startem: zamiast puszczać trasę
      // z pozycji spoza strefy prosimy o ręczny wybór startu, a cel zostaje
      // zapamiętany i wraca po wybraniu startu.
      if (gpsUnsupported && !fromCustom) {
        pendingDestinationRef.current = to;
        blockGpsStart();
        return false;
      }
      pendingDestinationRef.current = null;
      const fromTitle = origin?.title ?? locTitle;
      const fromLat = origin?.lat ?? currentCoords.lat;
      const fromLon = origin?.lon ?? currentCoords.lon;
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
      recentDirtyRef.current = true;
      router.push({
        pathname: '/routes',
        params: {
          fromId: origin?.id,
          fromTitle,
          fromLat: String(fromLat),
          fromLon: String(fromLon),
          // Start z GPS: ekran tras może go po cichu podmienić na dokładniejszy fix.
          fromGps: fromCustom ? '0' : '1',
          boardedTrip: activeBoarded ? JSON.stringify(activeBoarded) : undefined,
          toId: to.id,
          toTitle: to.title,
          toLat: String(to.lat),
          toLon: String(to.lon),
        },
      });
      // Zapis do historii odraczamy za animację przejścia, aby nie wywoływać relayoutu na klatce wyjścia.
      setTimeout(() => {
        void Promise.all([
          recordTripSearch(fromLat, fromLon, fromTitle, to).catch(() => {}),
          SearchService.recordRecent({
            ...to,
            address: to.address ?? '',
            kind: to.kind ?? 'history',
          }).catch(() => {}),
        ]).then(() => {
          if (!isFocusedRef.current) return;
          recentDirtyRef.current = false;
          SearchService.recent()
            .then((list) => {
              if (isFocusedRef.current) setRecent(list);
            })
            .catch(() => {});
          loadTripHistory()
            .then((h) => {
              if (isFocusedRef.current && h.length > 0) setLastTrip(h[0]);
            })
            .catch(() => {});
        });
      }, 280);
      return true;
    },
    [
      boardedOrigin,
      gpsUnsupported,
      blockGpsStart,
      currentCoords.lat,
      currentCoords.lon,
      locTitle,
      router,
    ],
  );

  const handleSelectSavedPlace = useCallback(
    (p: SavedPlace) => {
      goToRoutes({ id: p.placeId, title: p.name, lat: p.lat, lon: p.lon });
    },
    [goToRoutes],
  );

  const handleAddSavedPlace = useCallback(() => {
    setEditingPlace(null);
    setAddPlaceOpen(true);
  }, []);

  const handleEditSavedPlace = useCallback((p: SavedPlace) => {
    setEditingPlace(p);
    setAddPlaceOpen(true);
  }, []);

  // Otwarcie ostatniego połączenia z pulla: start bierzemy z zapisanej
  // trasy (nie z bieżącego GPS), żeby skrót odtwarzał dokładnie to połączenie.
  const openLastTrip = useCallback(
    (reversed: boolean) => {
      const t = lastTripRef.current;
      if (!t) return;
      const fromTitle = reversed ? t.dest_title : t.origin_title;
      const fromLat = reversed ? t.dest_lat : t.origin_lat;
      const fromLon = reversed ? t.dest_lon : t.origin_lon;
      const to = reversed
        ? { id: t.origin_title, title: t.origin_title, lat: t.origin_lat, lon: t.origin_lon }
        : {
            id: t.dest_id,
            title: t.dest_title,
            address: t.dest_address,
            lat: t.dest_lat,
            lon: t.dest_lon,
          };
      void recordTripSearch(fromLat, fromLon, fromTitle, to);
      router.push({
        pathname: '/routes',
        params: {
          fromTitle,
          fromLat: String(fromLat),
          fromLon: String(fromLon),
          toId: to.id,
          toTitle: to.title,
          toLat: String(to.lat),
          toLon: String(to.lon),
        },
      });
    },
    [router],
  );

  const triggerHaptic = useCallback(() => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
  }, []);

  // Pull jak na Twitterze, ale zamiast spinnera: ostatnie połączenie + toggle.
  // Całość na UI threadzie (worklet). Aktywacja przy pociągnięciu w dół,
  // przy odchyleniu w bok gest pada. Brak bridge crossings w trakcie przeciągania.
  const pullGesture = useMemo(
    () =>
      Gesture.Pan()
        .activeOffsetY(12)
        .failOffsetX([-14, 14])
        .onUpdate((e) => {
          'worklet';
          const h = Math.max(0, Math.min(LAST_TRIP_MAX, e.translationY));
          pullHeight.value = h;
          const cur = pullOption.value;
          const next = nextPullOption(cur, h, LAST_TRIP_ARM_1, LAST_TRIP_ARM_2, LAST_TRIP_DISARM_2);
          if (next !== cur) {
            pullOption.value = next;
            if (next > 0) {
              runOnJS(triggerHaptic)();
            }
          }
        })
        .onEnd(() => {
          'worklet';
          const opt = pullOption.value;
          pullOption.value = 0;
          pullHeight.value = withSpring(0, motion.spring.spatialDefault);
          if (opt === 1) {
            runOnJS(openLastTrip)(false);
          } else if (opt === 2) {
            runOnJS(openLastTrip)(true);
          }
        })
        .onFinalize(() => {
          'worklet';
          pullOption.value = 0;
          pullHeight.value = withSpring(0, motion.spring.spatialDefault);
        })
        .enabled(Platform.OS !== 'web' && atTop && lastTrip != null && !sheetsOpen),
    [atTop, lastTrip, sheetsOpen, openLastTrip, triggerHaptic, pullOption, pullHeight],
  );

  const handleCityChange = useCallback(
    async (id: CityId, source: CitySwitchSource = 'manual') => {
      if (id === getActiveCityIdSync() && id === cityId) return;
      const gen = ++switchGenRef.current;
      setSwitchingCity(true);
      setSwitchingCityId(id);
      try {
        await setCity(id, { source });
        if (gen !== switchGenRef.current || getActiveCityIdSync() !== id) return;
        const st = await ensureActiveCityTimetable().catch(() => null);
        if (st && gen === switchGenRef.current && getActiveCityIdSync() === id) {
          setDataStatus(st);
        }
        const def = defaultLocationForCity(id);
        if (!isCustomStartRef.current) {
          setLocTitle(def.title);
          setCurrentCoords({ lat: def.lat, lon: def.lon });
        }
        refreshPlaces();
        requestSmart(def.title, { lat: def.lat, lon: def.lon });
      } finally {
        if (gen === switchGenRef.current) {
          setSwitchingCity(false);
          setSwitchingCityId(null);
        }
      }
    },
    [cityId, refreshPlaces, requestSmart, setCity],
  );

  // Miasto z GPS ma już bazę: przełączamy automatycznie tylko wtedy, gdy
  // użytkownik nie wybrał w tej sesji innego miasta ręcznie.
  const gpsAutoSwitchRef = useRef<CityId | null>(null);
  useEffect(() => {
    if (isManualCitySelectedInSession()) return;
    if (!gpsOtherCityId || gpsCityReady?.id !== gpsOtherCityId || !gpsCityReady.ok) return;
    if (gpsAutoSwitchRef.current === gpsOtherCityId) return;
    if (switchingCity || dataStatus.state === 'downloading' || dataStatus.state === 'importing') {
      return;
    }
    gpsAutoSwitchRef.current = gpsOtherCityId;
    void handleCityChange(gpsOtherCityId, 'auto');
  }, [gpsOtherCityId, gpsCityReady, switchingCity, dataStatus.state, handleCityChange]);

  // Skrót w nagłówku: przełącz na miasto z GPS i od razu pobierz jego rozkład.
  const handleGpsCityDownload = async (id: CityId) => {
    await handleCityChange(id, 'manual');
    if (getActiveCityIdSync() !== id) return;
    const st = getDataStatus();
    if (st.state === 'empty' || st.state === 'error') {
      void importGtfsFromNetwork(id).catch((e) => console.warn('City timetable download failed:', e));
    }
  };

  const handleSavePlace = async (placeData: {
    id?: string;
    name: string;
    icon: SavedPlace['icon'];
    address: string;
    lat: number;
    lon: number;
    anchorStopId?: string | null;
    anchorStopName?: string | null;
    anchorStopLat?: number | null;
    anchorStopLon?: number | null;
  }): Promise<boolean> => {
    try {
      if (placeData.id) {
        const updated = await FavoritesService.updatePlace(placeData.id, {
          name: placeData.name,
          icon: placeData.icon,
          address: placeData.address,
          lat: placeData.lat,
          lon: placeData.lon,
          anchorStopId: placeData.anchorStopId,
          anchorStopName: placeData.anchorStopName,
          anchorStopLat: placeData.anchorStopLat,
          anchorStopLon: placeData.anchorStopLon,
        });
        if (!updated) {
          await FavoritesService.addPlace(placeData);
        }
      } else {
        await FavoritesService.addPlace(placeData);
      }
    } catch (err) {
      console.error('[handleSavePlace error]', err);
      return false;
    }
    refreshPlaces();
    requestSmart(originStopRef.current, currentCoords);
    return true;
  };

  const handleDeletePlace = async (id: string) => {
    let removed = false;
    try {
      removed = await FavoritesService.deletePlace(id);
    } catch (err) {
      console.warn('[handleDeletePlace error]', err);
    }
    if (!removed) {
      Alert.alert(s.common.storageFailTitle, s.common.storageFailBody);
      return;
    }
    refreshPlaces();
    requestSmart(originStopRef.current, currentCoords);
  };

  // Kolejność z zarządzania miejscami zapisujemy od razu; refreshPlaces
  // zsynchronizuje prop z tym samym porządkiem (smart ranking jej nie używa).
  const handleReorderPlaces = async (orderedIds: string[]) => {
    try {
      await FavoritesService.reorderPlaces(orderedIds);
    } catch (err) {
      console.warn('[handleReorderPlaces error]', err);
    }
    refreshPlaces();
  };

  // Ostatnie połączenie świeże po powrocie (pull może odpalić nową trasę).
  // Wyszukanie trasy (tu albo na ekranie tras) dopisuje historię: wtedy
  // przeliczamy też „Ostatnie miejsca", inaczej nowy cel pojawiłby się
  // dopiero po restarcie aplikacji.
  const historyKeyRef = useRef<string | null>(null);
  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      // Po powrocie na ekran główny domykamy arkusz tylko gdy naprawdę został otwarty.
      if (sheetModeRef.current !== null) setSheetMode(null);
      if (queryRef.current !== '') setQuery('');
      const pendingBoarded = consumePendingBoardedOrigin('home');
      if (pendingBoarded) {
        applyBoardedOrigin(pendingBoarded.origin, pendingBoarded.openDestination);
      }
      const timer = setTimeout(() => {
        if (cancelled) return;
        loadTripHistory()
          .then((h) => {
            if (cancelled) return;
            if (h.length > 0) {
              setLastTrip((prev) =>
                prev && prev.id === h[0].id && prev.timestamp === h[0].timestamp ? prev : h[0],
              );
            }
            const key = h.length > 0 ? `${h.length}|${h[0].id}|${h[0].timestamp}` : '';
            const prevKey = historyKeyRef.current;
            historyKeyRef.current = key;
            if (prevKey !== null && prevKey !== key && smartCoordsRef.current) {
              requestSmart(originStopRef.current, smartCoordsRef.current);
            }
          })
          .catch(() => {});
      }, 240);
      return () => {
        cancelled = true;
        clearTimeout(timer);
      };
    }, [applyBoardedOrigin, requestSmart, setSheetMode]),
  );

  // Wczytanie kopii zapasowej podmienia miejsca i historię w KV, ale `saved`
  // i `smart` to useState: bez tego powiadomienia ekran pokazywałby stan
  // sprzed importu aż do restartu aplikacji.
  useEffect(
    () =>
      subscribeBackupApplied(() => {
        refreshPlaces();
        refreshSavedRoutes();
        // Ranking liczymy tylko przy znanej pozycji: `smartFromOrigin` i tak
        // podpada pod DEFAULT_LOCATION, a „ostatnie miejsca" z innego miasta
        // to kłamstwo.
        if (currentCoords) {
          requestSmart(originStopRef.current, currentCoords);
        }
      }),
    [currentCoords, locTitle, applySmart, refreshPlaces, refreshSavedRoutes, requestSmart],
  );

  const gpsBadges =
    (gpsDownloadCityId && !isManualCitySelectedInSession()) || gpsOutsideAll ? (
      <>
        {gpsDownloadCityId && !isManualCitySelectedInSession() && (
          <SpringPressable
            style={styles.gpsDownloadPill}
            onPress={() => void handleGpsCityDownload(gpsDownloadCityId)}
            disabled={switchingCityId === gpsDownloadCityId}
            accessibilityRole="button"
            accessibilityLabel={s.home.downloadCityTimetableA11y(s.city.gen(gpsDownloadCityId))}
            accessibilityState={{ busy: switchingCityId === gpsDownloadCityId }}
            hitSlop={6}
            scaleDelta={0.03}
          >
            <Download size={13} color={scheme.onSecondaryContainer} />
            <Text style={styles.gpsDownloadText} numberOfLines={1}>
              {s.city.name(gpsDownloadCityId)}
            </Text>
          </SpringPressable>
        )}
        {gpsOutsideAll && (
          <View style={styles.outsideAreaPill}>
            <Text style={styles.outsideArea} numberOfLines={1}>
              {s.home.outsideAreaShort}
            </Text>
          </View>
        )}
      </>
    ) : null;

  const handleOpenSearch = useCallback(() => {
    pendingDestinationRef.current = null;
    setReturnToDestinationAfterStart(false);
    setQuery('');
    setSheetMode('destination');
  }, [setSheetMode]);

  const handleOpenStart = useCallback(() => {
    pendingDestinationRef.current = null;
    setReturnToDestinationAfterStart(false);
    setQuery('');
    setSheetMode('start');
  }, [setSheetMode]);

  const thumbBarProps = useMemo(
    () => ({
      onOpenSearch: handleOpenSearch,
      startTitle: locTitle,
      isCustomStart,
      onOpenStart: handleOpenStart,
      onResetStart: resetToGps,
      gpsUnsupported,
      chips: dockChips,
      downloadProgress:
        dataStatus.state === 'downloading' || dataStatus.state === 'importing'
          ? dataStatus.progress
          : null,
      downloadStep: dataStatus.state === 'importing' ? dataStatus.step : null,
    }),
    [
      dataStatus,
      dockChips,
      gpsUnsupported,
      handleOpenSearch,
      handleOpenStart,
      isCustomStart,
      locTitle,
      resetToGps,
    ],
  );

  const recentContent =
    smartOrdered.length === 0 && smartReady ? (
      <View style={styles.emptyCard}>
        <View style={styles.emptyIcon}>
          <History size={22} color={scheme.onSecondaryContainer} />
        </View>
        <View style={styles.emptyText}>
          <Text style={styles.emptyTitle}>{s.home.historyEmptyTitle}</Text>
          <Text style={styles.emptyBody}>{s.home.historyEmptyBody}</Text>
        </View>
      </View>
    ) : (
      <SmartHistoryList
        items={smartOrdered}
        onSelect={goToRoutes}
        icons={smartIcons}
        hideHeader={true}
      />
    );

  const savedRoutesContent = (
    <SavedRoutesList
      routes={orderedSavedRoutes}
      activeId={trackedConnId}
      ticketIds={ticketIds}
      onSelect={handleSelectSavedRoute}
      onRemove={handleRemoveSavedRoute}
      onOpenTicket={handleOpenSavedTicket}
      onUnpin={handleUnpinSavedRoute}
    />
  );

  return (
    <GestureDetector gesture={pullGesture}>
      <View style={styles.root}>
        <View style={[styles.safe, { paddingTop: insets.top }]}>
          <ScrollView
            contentContainerStyle={[
              styles.body,
              webLayout.isMedium && [
                styles.bodyDesktop,
                { paddingHorizontal: webLayout.isDesktop ? 32 : 24 },
              ],
            ]}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
            overScrollMode="never"
            scrollEnabled={true}
            scrollEventThrottle={16}
            onScroll={(e) => {
              // Stan zmienia się dopiero przy przekroczeniu górki: bez tego
              // każdy scroll event wymuszałby rerender całego ekranu.
              const top = e.nativeEvent.contentOffset.y <= 1;
              if (top !== atTopRef.current) {
                atTopRef.current = top;
                setAtTop(top);
              }
            }}
          >
            {lastTrip && (
              <LastTripPull
                trip={lastTrip}
                option={pullOption}
                height={pullHeight}
                onActivate={() => openLastTrip(false)}
              />
            )}
            {!webLayout.isMedium && (
              <View style={styles.topBar}>
                <View style={styles.cityContextWrap}>
                  <SpringPressable
                    style={styles.cityPill}
                    onPress={() => setCitySheetOpen(true)}
                    accessibilityRole="button"
                    accessibilityLabel={`${s.city.name(cityId)}, ${s.city.changeAction}`}
                    accessibilityHint={s.city.settingsHint}
                    accessibilityState={{ busy: switchingCity }}
                    hitSlop={8}
                    scaleDelta={0.03}
                  >
                    <View style={styles.cityPinIcon}>
                      {switchingCity ? (
                        <ActivityIndicator size="small" color={scheme.onPrimaryContainer} />
                      ) : (
                        <MapPin size={15} color={scheme.onPrimaryContainer} />
                      )}
                    </View>
                    <Text style={styles.cityName} numberOfLines={1}>
                      {s.city.name(cityId)}
                    </Text>
                    <ChevronDown size={16} color={scheme.onSurfaceVariant} />
                  </SpringPressable>
                  {gpsBadges}
                </View>
                <View style={styles.topActions}>
                  {getCity(cityId).features.news && (
                    <SpringPressable
                      style={[styles.iconBtn, styles.iconBtnStart, newsAlert && styles.iconBtnAlert]}
                      hitSlop={8}
                      onPress={() => {
                        router.push('/news');
                        setTimeout(() => {
                          void import('../src/services/mpkNews').then(({ markNewsSeen }) =>
                            markNewsSeen(),
                          );
                        }, 260);
                      }}
                      accessibilityLabel={newsAlert ? s.home.newsAlertA11y : s.home.newsA11y}
                      accessibilityRole="button"
                      scaleDelta={0.05}
                    >
                      <Bell
                        size={20}
                        color={newsAlert ? scheme.onPrimaryContainer : scheme.onSurfaceVariant}
                      />
                      {newsAlert && (
                        <View style={styles.alertBadge}>
                          <Text style={styles.alertMark}>!</Text>
                        </View>
                      )}
                    </SpringPressable>
                  )}
                  <SpringPressable
                    style={[
                      styles.iconBtn,
                      !getCity(cityId).features.news ? styles.iconBtnStart : styles.iconBtnMid,
                    ]}
                    onPress={() =>
                      router.push({ pathname: '/live-map', params: { returnTo: 'home' } })
                    }
                    accessibilityRole="button"
                    accessibilityLabel={s.home.liveMapA11y}
                    scaleDelta={0.05}
                  >
                    <MapPinned size={20} color={scheme.onSurfaceVariant} />
                  </SpringPressable>
                  <SpringPressable
                    style={[styles.iconBtn, styles.iconBtnEnd]}
                    onPress={() => router.push('/settings')}
                    accessibilityRole="button"
                    accessibilityLabel={s.settings.title}
                    scaleDelta={0.05}
                  >
                    <Settings2 size={20} color={scheme.onSurfaceVariant} />
                  </SpringPressable>
                </View>
              </View>
            )}

            <View style={[styles.heroBlock, webLayout.isMedium && styles.heroBlockDesktop]}>
              <Text
                style={[styles.headerTitle, webLayout.isDesktop && styles.headerTitleDesktop]}
                accessibilityRole="header"
              >
                {s.home.title}
              </Text>
              {webLayout.isMedium && gpsBadges && (
                <View style={styles.desktopGpsBadges}>{gpsBadges}</View>
              )}
            </View>

            {webLayout.isMedium && <HomeThumbBar {...thumbBarProps} variant="planner" />}

            {onboardCandidates.length > 0 && !boardedOrigin && (
              <Animated.View
                entering={FadeInDown.duration(motion.enter.duration)
                  .easing(motion.enter.easing)
                  .reduceMotion(motion.enter.reduceMotion)}
                exiting={FadeOutUp.duration(motion.state.duration)
                  .easing(motion.state.easing)
                  .reduceMotion(motion.state.reduceMotion)}
                layout={LinearTransition.duration(motion.state.duration)
                  .easing(motion.state.easing)
                  .reduceMotion(motion.state.reduceMotion)}
                style={styles.onboardCard}
              >
                <View style={styles.onboardHeader}>
                  <View style={styles.onboardTitles}>
                    <Text style={styles.onboardTitle}>{s.home.boardedDetectedTitle}</Text>
                    <Text style={styles.onboardSub}>{s.home.boardedDetectedSub}</Text>
                  </View>
                  <SpringPressable
                    onPress={() =>
                      setDismissedOnboardKey(
                        onboardCandidates.map((c) => c.vehicle.vehicleId).join(','),
                      )
                    }
                    hitSlop={6}
                    accessibilityRole="button"
                    accessibilityLabel={s.home.boardedDismissA11y}
                    style={styles.onboardDismiss}
                    scaleDelta={0.05}
                  >
                    <X size={18} color={scheme.onSurfaceVariant} />
                  </SpringPressable>
                </View>
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={styles.onboardRow}
                >
                  {onboardCandidates.map((cand) => (
                    <SpringPressable
                      key={cand.vehicle.vehicleId}
                      onPress={() => {
                        void Haptics.selectionAsync().catch(() => {});
                        applyBoardedOrigin(cand.origin, false);
                      }}
                      accessibilityRole="button"
                      accessibilityLabel={
                        cand.direction
                          ? `${cand.line} ${s.search.vehicleDirectionTo(cand.direction)}`
                          : cand.line
                      }
                      style={styles.onboardChip}
                      scaleDelta={0.03}
                    >
                      <LineBadge line={cand.line} mode={cand.mode} compact />
                      <Text style={styles.onboardChipText} numberOfLines={1}>
                        {cand.direction || cand.nextStopName || cand.line}
                      </Text>
                    </SpringPressable>
                  ))}
                  <SpringPressable
                    onPress={() =>
                      router.push({ pathname: '/live-map', params: { returnTo: 'home' } })
                    }
                    accessibilityRole="button"
                    accessibilityLabel={s.home.boardedPickOnMap}
                    style={styles.onboardMapChip}
                    scaleDelta={0.03}
                  >
                    <MapPinned size={15} color={scheme.onSecondaryContainer} />
                    <Text style={styles.onboardMapText}>{s.home.boardedPickOnMap}</Text>
                  </SpringPressable>
                </ScrollView>
              </Animated.View>
            )}

            {dataStatus.state === 'error' && (
              <SpringPressable
                style={styles.importCardError}
                scaleDelta={0.02}
                haptic="light"
                accessibilityRole="button"
                onPress={() => void importGtfsFromNetwork()}
              >
                <Text style={styles.importTitleError}>{s.home.importErrorTitle}</Text>
                <Text style={styles.importSubError}>
                  {dataStatus.message}. {dataStatus.hint ?? s.home.importErrorRetry}
                </Text>
              </SpringPressable>
            )}

            <View style={styles.savedSection}>
              <View style={styles.sectionHeader}>
                <Text style={styles.section} accessibilityRole="header">
                  {s.home.savedTitle}
                </Text>
                {saved.length > 0 && (
                  <SpringPressable
                    onPress={() => setManageSheetOpen(true)}
                    onFocus={() => setSavedEditFocused(true)}
                    onBlur={() => setSavedEditFocused(false)}
                    hitSlop={6}
                    scaleDelta={0.04}
                    haptic="selection"
                    accessibilityRole="button"
                    accessibilityLabel={s.home.editSavedA11y}
                    style={[styles.editSaved, savedEditFocused && styles.editSavedFocused]}
                  >
                    <Text style={styles.editSavedLabel}>{s.home.editCard}</Text>
                  </SpringPressable>
                )}
              </View>
              <SavedPlacesRow
                places={saved}
                onSelect={handleSelectSavedPlace}
                onAdd={handleAddSavedPlace}
                onEdit={handleEditSavedPlace}
                desktopGrid={webLayout.isMedium}
              />
            </View>

            <View style={styles.sectionSpacer} />

            {webLayout.isWide ? (
              <View style={styles.wideColumns}>
                <View style={styles.wideColLeft}>
                  <View style={styles.wideColHeader}>
                    <History size={18} color={scheme.primary} />
                    <Text style={styles.wideColTitle} accessibilityRole="header">
                      {s.home.tabRecent}
                    </Text>
                  </View>
                  {recentContent}
                </View>

                <View style={styles.wideColRight}>
                  <View style={styles.wideColHeader}>
                    <MapPinned size={18} color={scheme.primary} />
                    <Text style={styles.wideColTitle} accessibilityRole="header">
                      {s.home.tabSaved}
                    </Text>
                    {orderedSavedRoutes.length > 0 && (
                      <View style={styles.tabCountBadge}>
                        <Text style={styles.tabCountText}>{orderedSavedRoutes.length}</Text>
                      </View>
                    )}
                  </View>
                  {savedRoutesContent}
                </View>
              </View>
            ) : (
              <>
                {/* M3 Expressive Segmented Switcher: Ostatnie połączenia / Twoje trasy */}
                <View
                  style={styles.tabContainer}
                  accessibilityRole="tablist"
                  onLayout={(e) => setTabBarWidth(e.nativeEvent.layout.width)}
                >
                  <Animated.View style={[styles.tabPill, tabPillStyle]} pointerEvents="none" />
                  <SpringPressable
                    onPress={() => handleTabSwitch('recent')}
                    accessibilityRole="tab"
                    accessibilityState={{ selected: homeTab === 'recent' }}
                    accessibilityLabel={s.home.tabRecent}
                    scaleDelta={0.02}
                    style={styles.tabBtn}
                  >
                    <History
                      size={17}
                      color={
                        homeTab === 'recent' ? scheme.onPrimaryContainer : scheme.onSurfaceVariant
                      }
                    />
                    <Text
                      style={[
                        styles.tabLabel,
                        homeTab === 'recent' ? styles.tabLabelActive : styles.tabLabelInactive,
                      ]}
                      numberOfLines={1}
                      adjustsFontSizeToFit
                      minimumFontScale={0.85}
                    >
                      {s.home.tabRecent}
                    </Text>
                  </SpringPressable>

                  <SpringPressable
                    onPress={() => handleTabSwitch('saved')}
                    accessibilityRole="tab"
                    accessibilityState={{ selected: homeTab === 'saved' }}
                    accessibilityLabel={s.home.tabSaved}
                    scaleDelta={0.02}
                    style={styles.tabBtn}
                  >
                    <MapPinned
                      size={17}
                      color={
                        homeTab === 'saved' ? scheme.onPrimaryContainer : scheme.onSurfaceVariant
                      }
                    />
                    <Text
                      style={[
                        styles.tabLabel,
                        homeTab === 'saved' ? styles.tabLabelActive : styles.tabLabelInactive,
                      ]}
                      numberOfLines={1}
                      adjustsFontSizeToFit
                      minimumFontScale={0.85}
                    >
                      {s.home.tabSaved}
                    </Text>
                    {orderedSavedRoutes.length > 0 && (
                      <View
                        style={[
                          styles.tabCountBadge,
                          homeTab === 'saved' && styles.tabCountBadgeActive,
                        ]}
                      >
                        <Text
                          style={[
                            styles.tabCountText,
                            homeTab === 'saved' && styles.tabCountTextActive,
                          ]}
                        >
                          {orderedSavedRoutes.length}
                        </Text>
                      </View>
                    )}
                  </SpringPressable>
                </View>

                <Animated.View
                  key={homeTab}
                  entering={reduceMotion ? undefined : FadeIn.duration(160)}
                  exiting={reduceMotion ? undefined : FadeOut.duration(90)}
                >
                  {homeTab === 'recent' ? recentContent : savedRoutesContent}
                </Animated.View>
              </>
            )}
          </ScrollView>
        </View>

        {!webLayout.isMedium && (
          <View
            pointerEvents={sheetsOpen ? 'none' : 'auto'}
            accessibilityElementsHidden={sheetsOpen}
            importantForAccessibility={sheetsOpen ? 'no-hide-descendants' : 'auto'}
          >
            <HomeThumbBar {...thumbBarProps} />
          </View>
        )}

        {sheetMode && (
          <SearchSheet
            query={query}
            loading={loading}
            error={searchError}
            results={results}
            recent={sheetMode === 'start' ? recentWithGps : recentFromSmart}
            savedQuick={quick}
            placeholder={
              sheetMode === 'start' ? s.home.searchPlaceholderFrom : s.home.searchPlaceholderTo
            }
            originTitle={sheetMode === 'destination' ? locTitle : undefined}
            nearbyVehicles={sheetMode === 'start' ? nearbyVehicles : undefined}
            onSelectVehicle={
              sheetMode === 'start'
                ? (v) => {
                    const origin = buildBoardedOriginFromVehicle(v.vehicle, gtfsStore);
                    if (!origin) return;
                    const openDest = returnToDestinationAfterStart;
                    setReturnToDestinationAfterStart(false);
                    applyBoardedOrigin(origin, openDest);
                  }
                : undefined
            }
            onOpenLiveMap={
              sheetMode === 'start'
                ? () => {
                    setReturnToDestinationAfterStart(false);
                    setSheetMode(null);
                    setQuery('');
                    router.push({ pathname: '/live-map', params: { returnTo: 'home' } });
                  }
                : undefined
            }
            closeOnSelect={sheetMode === 'start' && !returnToDestinationAfterStart}
            onChangeOrigin={
              sheetMode === 'destination'
                ? () => {
                    setReturnToDestinationAfterStart(true);
                    setQuery('');
                    setSheetMode('start');
                  }
                : undefined
            }
            onQuery={handleSearchQuery}
            onSelectLine={(line) => {
              setSheetMode(null);
              setReturnToDestinationAfterStart(false);
              setQuery('');
              router.push({ pathname: '/line', params: { routeId: line.routeId } });
            }}
            onSelect={(s) => {
              if (sheetMode === 'start') {
                handleStartSelect(s);
              } else {
                // Zablokowany start (GPS poza strefą) zostawia arkusz i wpisany cel pod alertem.
                if (!goToRoutes(s)) return;
                // Nie odmontowujemy arkusza natychmiast w tej samej milisekundzie,
                // by uniknąć mignięcia ekranu domowego w trakcie tranzycji do ekranu tras.
                clearSheetCloseTimer();
                sheetCloseTimerRef.current = setTimeout(() => {
                  sheetCloseTimerRef.current = null;
                  setSheetModeRaw(null);
                  setQuery('');
                }, 240);
              }
            }}
            onClose={() => {
              pendingDestinationRef.current = null;
              setSheetMode(null);
              setReturnToDestinationAfterStart(false);
              setQuery('');
            }}
          />
        )}

        {manageSheetOpen && (
          <Suspense fallback={<SheetLoadingFallback />}>
            <ManagePlacesSheet
              places={saved}
              onClose={() => setManageSheetOpen(false)}
              onSelectPlace={(p) => {
                setManageSheetOpen(false);
                goToRoutes({
                  id: p.placeId,
                  title: p.name,
                  address: p.address,
                  lat: p.lat,
                  lon: p.lon,
                });
              }}
              onEditPlace={(p) => {
                setManageSheetOpen(false);
                setEditingPlace(p);
                setAddPlaceOpen(true);
              }}
              onDeletePlace={handleDeletePlace}
              onReorderPlaces={(ids) => {
                void handleReorderPlaces(ids);
              }}
              onAddNew={() => {
                setManageSheetOpen(false);
                setEditingPlace(null);
                setAddPlaceOpen(true);
              }}
            />
          </Suspense>
        )}

        {addPlaceOpen && (
          <Suspense fallback={<SheetLoadingFallback />}>
            <AddPlaceSheet
              initialPlace={editingPlace}
              onClose={() => {
                setAddPlaceOpen(false);
                setEditingPlace(null);
              }}
              onSave={handleSavePlace}
              onDelete={handleDeletePlace}
            />
          </Suspense>
        )}

        {citySheetOpen && (
          <Suspense fallback={<SheetLoadingFallback />}>
            <CitySelectSheet
              selectedCityId={cityId}
              onSelectCity={(id) => {
                void handleCityChange(id, 'manual');
              }}
              onClose={() => setCitySheetOpen(false)}
              switchingCity={switchingCity}
              switchingCityId={switchingCityId}
            />
          </Suspense>
        )}

        {inspection && (
          <Suspense fallback={<SheetLoadingFallback />}>
            <TicketInspectionModal
              visible
              ticket={inspection.ticket}
              connection={inspection.connection}
              onClose={() => setInspection(null)}
            />
          </Suspense>
        )}
      </View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: scheme.surface },
  safe: { flex: 1 },
  body: { paddingHorizontal: 16, paddingTop: 6, paddingBottom: 28, flexGrow: 1 },
  bodyDesktop: {
    width: '100%',
    maxWidth: 1120,
    alignSelf: 'center',
    paddingTop: 28,
    paddingBottom: 40,
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    minHeight: 54,
    marginBottom: 14,
  },
  cityContextWrap: { flex: 1, minWidth: 0, justifyContent: 'center', gap: 6 },
  cityPill: {
    alignSelf: 'flex-start',
    maxWidth: '100%',
    minHeight: 44,
    paddingLeft: 7,
    paddingRight: 13,
    paddingVertical: 6,
    borderRadius: shape.full,
    backgroundColor: scheme.surfaceContainer,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: scheme.outlineVariant,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    ...elev.level1,
  },
  cityPinIcon: {
    width: 30,
    height: 30,
    borderRadius: shape.full,
    backgroundColor: scheme.primaryContainer,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cityName: {
    ...type.labelLarge,
    fontWeight: '800',
    letterSpacing: -0.1,
    color: scheme.onSurface,
    flexShrink: 1,
  },
  gpsDownloadPill: {
    alignSelf: 'flex-start',
    maxWidth: '100%',
    minHeight: 36,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: shape.full,
    backgroundColor: scheme.secondaryContainer,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  gpsDownloadText: {
    ...type.labelSmall,
    fontWeight: '700',
    color: scheme.onSecondaryContainer,
    flexShrink: 1,
  },
  outsideAreaPill: {
    alignSelf: 'flex-start',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: shape.full,
    backgroundColor: scheme.warningContainer,
  },
  outsideArea: {
    ...type.labelSmall,
    fontWeight: '700',
    color: scheme.onWarningContainer,
  },
  topActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    marginLeft: 'auto',
  },
  iconBtn: {
    width: 44,
    height: 44,
    borderRadius: 8,
    backgroundColor: scheme.surfaceContainer,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: scheme.outlineVariant,
    alignItems: 'center',
    justifyContent: 'center',
    ...elev.level1,
  },
  iconBtnAlert: {
    backgroundColor: scheme.primaryContainer,
    borderColor: scheme.primary,
  },
  iconBtnStart: {
    borderTopLeftRadius: shape.full,
    borderBottomLeftRadius: shape.full,
  },
  iconBtnMid: {
    borderRadius: 8,
  },
  iconBtnEnd: {
    borderTopRightRadius: shape.full,
    borderBottomRightRadius: shape.full,
  },
  heroBlock: {
    marginBottom: 4,
  },
  heroBlockDesktop: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    marginBottom: 4,
  },
  desktopGpsBadges: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 8,
  },
  headerTitle: {
    fontSize: 36,
    lineHeight: 42,
    fontWeight: '800',
    color: scheme.onSurface,
    letterSpacing: -1.2,
  },
  headerTitleDesktop: {
    fontSize: 40,
    lineHeight: 46,
  },
  onboardCard: {
    backgroundColor: scheme.surfaceContainer,
    borderRadius: shape.extraLarge,
    borderWidth: 1.5,
    borderColor: scheme.primary,
    padding: 16,
    gap: 12,
    marginTop: 14,
    marginBottom: 4,
    ...elev.level1,
  },
  onboardHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
  },
  onboardTitles: {
    flex: 1,
    gap: 3,
  },
  onboardTitle: {
    ...type.titleMedium,
    color: scheme.onSurface,
    fontWeight: '800',
    letterSpacing: -0.2,
  },
  onboardSub: {
    ...type.bodySmall,
    color: scheme.onSurfaceVariant,
    lineHeight: 18,
  },
  onboardDismiss: {
    width: 40,
    height: 40,
    marginTop: -4,
    marginRight: -4,
    borderRadius: shape.full,
    backgroundColor: scheme.surfaceContainerHigh,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: scheme.outlineVariant,
    alignItems: 'center',
    justifyContent: 'center',
  },
  onboardRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  onboardChip: {
    minHeight: 44,
    maxWidth: 220,
    paddingHorizontal: 14,
    borderRadius: shape.full,
    backgroundColor: scheme.primaryContainer,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  onboardChipText: {
    ...type.labelLarge,
    color: scheme.onPrimaryContainer,
    fontWeight: '700',
    flexShrink: 1,
  },
  onboardMapChip: {
    minHeight: 44,
    paddingHorizontal: 14,
    borderRadius: shape.full,
    backgroundColor: scheme.secondaryContainer,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  onboardMapText: {
    ...type.labelLarge,
    color: scheme.onSecondaryContainer,
    fontWeight: '700',
  },
  alertBadge: {
    position: 'absolute',
    top: -3,
    right: -3,
    width: 19,
    height: 19,
    borderRadius: shape.full,
    backgroundColor: scheme.error,
    borderWidth: 2,
    borderColor: scheme.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  alertMark: { fontSize: 10, fontWeight: '800', color: scheme.onError, lineHeight: 12 },
  tabContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: scheme.surfaceContainerLow,
    borderRadius: shape.full,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: scheme.outlineVariant,
    padding: 5,
    gap: 4,
    marginBottom: 12,
  },
  tabBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 46,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: shape.full,
    gap: 8,
  },
  tabPill: {
    position: 'absolute',
    top: 5,
    bottom: 5,
    left: 5,
    backgroundColor: scheme.primaryContainer,
    borderRadius: shape.full,
  },
  tabLabel: {
    ...type.labelLarge,
    letterSpacing: 0.1,
    flexShrink: 1,
  },
  tabLabelActive: {
    color: scheme.onPrimaryContainer,
    fontWeight: '800',
  },
  tabLabelInactive: {
    color: scheme.onSurfaceVariant,
    fontWeight: '600',
  },
  tabCountBadge: {
    minWidth: 22,
    height: 22,
    paddingHorizontal: 6,
    borderRadius: shape.full,
    backgroundColor: scheme.surfaceContainerHigh,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tabCountBadgeActive: {
    backgroundColor: scheme.surfaceContainerLow,
  },
  tabCountText: {
    ...type.labelSmall,
    fontWeight: '800',
    color: scheme.onSurfaceVariant,
    fontVariant: ['tabular-nums'],
  },
  tabCountTextActive: {
    color: scheme.onSurface,
  },
  savedSection: { marginTop: 18 },
  sectionSpacer: { height: 22 },
  wideColumns: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 24,
  },
  wideColLeft: {
    flex: 1.15,
    minWidth: 0,
    gap: 12,
  },
  wideColRight: {
    flex: 0.85,
    minWidth: 0,
    gap: 12,
  },
  wideColHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    minHeight: 32,
  },
  wideColTitle: {
    ...type.titleMedium,
    fontSize: 18,
    fontWeight: '800',
    letterSpacing: -0.3,
    color: scheme.onSurface,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    minHeight: 44,
    marginBottom: 8,
  },
  section: {
    ...type.titleMedium,
    fontSize: 18,
    fontWeight: '800',
    letterSpacing: -0.3,
    color: scheme.onSurface,
    flex: 1,
  },
  editSaved: {
    minHeight: 38,
    paddingHorizontal: 14,
    justifyContent: 'center',
    borderRadius: shape.full,
    backgroundColor: scheme.surfaceContainer,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: scheme.outlineVariant,
    ...elev.level1,
  },
  editSavedFocused: { borderWidth: 1.5, borderColor: scheme.primary },
  editSavedLabel: {
    ...type.labelMedium,
    fontWeight: '700',
    color: scheme.primary,
  },
  emptyCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    padding: 18,
    backgroundColor: scheme.surfaceContainer,
    borderRadius: shape.extraLarge,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: scheme.outlineVariant,
    ...elev.level1,
  },
  emptyText: { flex: 1, gap: 4, minWidth: 0 },
  emptyIcon: {
    width: 48,
    height: 48,
    borderRadius: 22,
    borderTopRightRadius: 10,
    borderBottomLeftRadius: 10,
    backgroundColor: scheme.secondaryContainer,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  emptyTitle: { ...type.titleMedium, fontWeight: '700', color: scheme.onSurface },
  emptyBody: { ...type.bodySmall, color: scheme.onSurfaceVariant, lineHeight: 18 },
  importCardError: {
    marginTop: 14,
    padding: 16,
    minHeight: 56,
    backgroundColor: scheme.errorContainer,
    borderRadius: 24,
  },
  importTitleError: {
    ...type.bodyMedium,
    color: scheme.onErrorContainer,
    fontWeight: '800',
  },
  importSubError: {
    ...type.bodySmall,
    color: scheme.onErrorContainer,
    marginTop: 3,
  },
});
