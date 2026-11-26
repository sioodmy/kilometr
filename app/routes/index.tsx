import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  BackHandler,
  FlatList,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  View,
  InteractionManager,
  type LayoutChangeEvent,
} from 'react-native';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  AlertCircle,
  ChevronDown,
  ChevronLeft,
  ChevronUp,
  Clock3,
  CloudOff,
  Flag,
  MapPin,
  RouteOff,
  SlidersHorizontal,
} from '../../src/components/icons';
import Animated, {
  Extrapolation,
  FadeIn,
  FadeOut,
  ReduceMotion,
  interpolate,
  runOnJS,
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';
import { MorphingLoader } from '../../src/components/MorphingLoader';
import { RouteLoadingView } from '../../src/components/RouteLoadingView';
import { SpringPressable } from '../../src/components/SpringPressable';
import { EarlierConnectionsPull } from '../../src/components/EarlierConnectionsPull';
import {
  ConnectionListItem,
  type CardEnterMode,
  type ReorderAnimationToken,
} from '../../src/components/ConnectionListItem';
import { useRouteCardTransition } from '../../src/components/RouteCardTransition';
import { normalizeConnectionId } from '../../src/services/routing/connectionIdentity';
import {
  EARLIER_PULL_EDGE_MAX,
  EARLIER_PULL_LOADING,
  EARLIER_PULL_MAX,
  earlierRubberBand,
  nextEarlierPullArmed,
} from '../../src/services/earlierPull';
import {
  hapticEdge,
  hapticError,
  hapticGestureArm,
  hapticGestureDisarm,
  hapticSuccess,
  hapticTap,
} from '../../src/services/haptics';
import { computeReorderShifts } from '../../src/services/routing/listReorder';
import { motion } from '../../src/theme/motion';
import { useWebLayout } from '../../src/theme/layout';
import { elev, scheme, shape, type } from '../../src/theme/tokens';
import { defaultLocationForCity } from '../../src/config';
import { getActiveCityIdSync, useActiveCity } from '../../src/services/cityStore';
import {
  FavoritesService,
  LocationService,
  LOCATION_REFINE_DELTA_M,
  RoutingService,
  SearchService,
  distanceMeters,
  findAnchorForLocation,
  recordTripSearch,
  type ActiveAnchor,
  type LocationResult,
} from '../../src/services';
// Mediana czasu dojazdu jest czysta i idzie do nawyku w „Ostatnich miejscach",
// więc siedzi przy rankingu, a nie w ekranie (i ma test w check:smart-rank).
import { typicalDurationMin } from '../../src/services/smartRanking';
import { getSettingsSync, loadSettings, profileWalkSpeedMps } from '../../src/services/settings';
import { stopTracking } from '../../src/services/notifications';
import { isIntercityRouteQuery, rememberPlannedConnection } from '../../src/services/api';
import {
  ensureNationalTimetable,
  nationalTimetableReady,
  subscribeNationalTimetable,
} from '../../src/services/nationalTimetable';
import { IntercityDownloadCard } from '../../src/components/IntercityDownloadCard';
import {
  loadCachedConnections,
  hasLocalTimetable,
  rehydrateConnections,
} from '../../src/services/offlineCache';
import {
  getDataStatus,
  importGtfsFromNetwork,
  subscribeDataStatus,
  type DataStatus,
} from '../../src/services/dataManager';
import { liveTracker } from '../../src/services/liveTracker';
import { consumePendingBoardedOrigin } from '../../src/services/boardedOriginSelection';
import {
  buildBoardedOriginFromVehicle,
  findNearbyLiveVehicles,
} from '../../src/services/onboardDetector';
import { gtfsStore } from '../../src/services/routing/store';
import {
  deduplicateConnections,
  mergeConnections,
} from '../../src/services/routing/connectionIdentity';
import { loadEarlierConnections } from '../../src/services/routing/earlierConnections';
import { useRailLiveConnections } from '../../src/services/useRailLiveConnections';
import {
  boardingDepartureMs,
  boardingDepartureSec,
} from '../../src/services/routing/connectionTimes';
import type { JourneyTimeMode } from '../../src/services/routing/types';
import { isOutsideServiceArea } from '../../src/services/serviceArea';
import { ensureStopHintsLoaded } from '../../src/services/stopHints';
import type { BoardedTripOrigin, Connection, LegMode, SavedPlace, Suggestion } from '../../src/types/models';
import { ConnectionPeek, type ConnectionPeekHandlers } from '../../src/components/ConnectionPeek';
import { RouteEndpoints } from '../../src/components/RouteEndpoints';
import {
  DepartureTimeSheet,
  type JourneyTimeSelection,
} from '../../src/components/DepartureTimeSheet';
import {
  RouteFilterSheet,
  type RouteModeFilter,
  type RouteTransfersFilter,
} from '../../src/components/RouteFilterSheet';
import { SearchSheet } from '../../src/components/SearchSheet';
import { useStrings } from '../../src/i18n';

// Stabilna referencja: nowa funkcja na każdym renderze zmuszałaby
// VirtualizedList do przeliczenia komórek od zera przy każdej aktualizacji.
const connectionKey = (item: Connection) => item.id;

// Szybkie wyszukiwania kończą się przed tym czasem, więc pełnoekranowy
// wskaźnik nie mruga między wejściem w ekran a pierwszą kartą wyniku.
const INITIAL_LOADING_DELAY_MS = 700;

function parseBoardedParam(raw?: string): BoardedTripOrigin | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<BoardedTripOrigin>;
    if (!parsed || typeof parsed.tripId !== 'string' || typeof parsed.line !== 'string') {
      return null;
    }
    return parsed as BoardedTripOrigin;
  } catch {
    return null;
  }
}

export default function RoutesScreen() {
  const s = useStrings();
  const insets = useSafeAreaInsets();
  const webLayout = useWebLayout();
  const { cityId } = useActiveCity();
  const cityDef = defaultLocationForCity(cityId);
  const cityGen = s.city.gen(cityId);
  const gpsItem: Suggestion = useMemo(
    () => ({
      id: '__gps',
      title: s.home.gpsTitle,
      address: s.routes.gpsAddress,
      kind: 'history',
      lat: 0,
      lon: 0,
    }),
    [s],
  );
  const router = useRouter();
  const reduceMotion = useReducedMotion();
  const params = useLocalSearchParams<{
    fromId?: string;
    fromTitle?: string;
    fromLat?: string;
    fromLon?: string;
    /** '1', gdy start pochodzi z GPS; wtedy wolno go doprecyzować fixem w tle. */
    fromGps?: string;
    /** Zserializowany BoardedTripOrigin, gdy startem jest pojazd w ruchu. */
    boardedTrip?: string;
    toId?: string;
    toTitle: string;
    toLat: string;
    toLon: string;
    directOnly?: string;
    modes?: string;
    /** Dokładnie 'stop' po naciśnięciu „Zakończ” w powiadomieniu. */
    action?: string;
    /** Id połączenia, do którego ma prowadzić przycisk „Trasa” w powiadomieniu. */
    open?: string;
  }>();

  const [fromTitle, setFromTitle] = useState(params.fromTitle || cityDef.title);
  const [fromLat, setFromLat] = useState(Number(params.fromLat || cityDef.lat));
  const [fromLon, setFromLon] = useState(Number(params.fromLon || cityDef.lon));
  const [fromId, setFromId] = useState(String(params.fromId ?? ''));
  // Czy start nadal jest GPS-em (a nie ręcznie wybranym punktem). Zmiana na
  // custom wyłącza doprecyzowanie w tle i odwrotnie.
  const [gpsOrigin, setGpsOrigin] = useState(params.fromGps === '1');
  const [boardedTrip, setBoardedTrip] = useState<BoardedTripOrigin | null>(() =>
    parseBoardedParam(params.boardedTrip),
  );

  const [toTitle, setToTitle] = useState(String(params.toTitle ?? s.routes.destFallback));
  const [toLat, setToLat] = useState(Number(params.toLat ?? 0));
  const [toLon, setToLon] = useState(Number(params.toLon ?? 0));
  const [toId, setToId] = useState(String(params.toId ?? ''));
  // Ten sam punkt po obu stronach: nie ma czego planować, a silnik sam z siebie
  // potrafi tu wygenerować przejazd w kółko.
  const samePlace = !boardedTrip && distanceMeters(fromLat, fromLon, toLat, toLon) <= 40;

  // Expo-router podmienia parametry bez remountu, gdy ekran jest już otwarty.
  // Każdy nowy deep link musi przestawić start i cel, inaczej zostaje stara trasa.
  useEffect(() => {
    if (
      params.fromTitle !== undefined &&
      params.fromLat !== undefined &&
      params.fromLon !== undefined
    ) {
      const nextLat = Number(params.fromLat);
      const nextLon = Number(params.fromLon);
      if (params.fromTitle !== fromTitle || nextLat !== fromLat || nextLon !== fromLon) {
        setItems([]);
        setLoading(true);
      }
      setFromId(String(params.fromId ?? ''));
      setFromTitle(params.fromTitle);
      setFromLat(nextLat);
      setFromLon(nextLon);
      setGpsOrigin(params.fromGps === '1');
      setActiveAnchor(null);
      setBoardedTrip(parseBoardedParam(params.boardedTrip));
    }
    if (params.toTitle === undefined || params.toLat === undefined || params.toLon === undefined) {
      return;
    }
    const nextId = String(params.toId ?? '');
    const nextLat = Number(params.toLat);
    const nextLon = Number(params.toLon);
    if (nextId !== toId || params.toTitle !== toTitle || nextLat !== toLat || nextLon !== toLon) {
      setItems([]);
      setLoading(true);
    }
    setToId(nextId);
    setToTitle(params.toTitle);
    setToLat(nextLat);
    setToLon(nextLon);
  }, [
    params.fromTitle,
    params.fromLat,
    params.fromLon,
    params.fromGps,
    params.boardedTrip,
    params.toId,
    params.toTitle,
    params.toLat,
    params.toLon,
  ]);

  // Przycisk „Zakończ” w powiadomieniu to deep link z parametrem action=stop.
  // Ref zamiast stanu, żeby reakcja na deep link nie wchodziła w cykl
  // renderów; zależność od params.action, bo ekspo-router podmienia
  // parametry bez remountu, gdy ekran jest już otwarty.
  const handledStopRef = useRef<string | null>(null);
  useEffect(() => {
    if (params.action !== 'stop') {
      handledStopRef.current = null;
      return;
    }
    if (handledStopRef.current === 'stop') return;
    handledStopRef.current = 'stop';
    void stopTracking();
  }, [params.action]);

  // Przycisk „Trasa” pod powiadomieniem prowadzi prosto do szczegółów
  // śledzonego kursu. Listę połączeń użytkownik już widział: teraz chce
  // sprawdzić ten jeden kurs, więc oszczędzamy mu jedno przeskakiwanie ekranu.
  const handledOpenRef = useRef<string | null>(null);
  useEffect(() => {
    const id = params.open;
    if (!id) {
      handledOpenRef.current = null;
      return;
    }
    if (handledOpenRef.current === String(id)) return;
    handledOpenRef.current = String(id);
    router.navigate({ pathname: '/routes/[id]', params: { id: String(id) } });
  }, [params.open, router]);

  const [savedPlaces, setSavedPlaces] = useState<SavedPlace[]>([]);
  const [activeAnchor, setActiveAnchor] = useState<ActiveAnchor | null>(null);
  const dismissedAnchorsRef = useRef<Set<string>>(new Set());
  const fetchSeq = useRef(0);
  const initialAnchorCheckedRef = useRef(false);
  // Podmiana originu na dokładniejszy fix odpala się raz na wybór startu.
  const refineAppliedRef = useRef(false);
  // Generacja wyboru startu: spóźniony GPS nie nadpisze nowszego wyboru.
  const startSelGen = useRef(0);
  const originCoordsRef = useRef({ lat: fromLat, lon: fromLon });
  originCoordsRef.current = { lat: fromLat, lon: fromLon };
  const activeAnchorRef = useRef<ActiveAnchor | null>(activeAnchor);
  activeAnchorRef.current = activeAnchor;

  const handleDismissAnchor = useCallback(() => {
    if (!activeAnchor) return;
    dismissedAnchorsRef.current.add(activeAnchor.placeId);
    // Pozycja już jest prawdziwym GPS (kotwica to tylko preferencja
    // w zapytaniu): dismiss czyści samą preferencję i odświeża listę.
    setActiveAnchor(null);
  }, [activeAnchor]);

  const handleDismissBoarded = useCallback(() => {
    const gen = ++startSelGen.current;
    setBoardedTrip(null);
    setItems([]);
    setLoading(true);
    void LocationService.getCurrentLocation()
      .then((loc) => {
        if (gen !== startSelGen.current) return;
        if (isOutsideServiceArea(loc.lat, loc.lon)) {
          setFromTitle(cityDef.title);
          setFromLat(cityDef.lat);
          setFromLon(cityDef.lon);
          setGpsOrigin(false);
          return;
        }
        setGpsOrigin(true);
        setFromId(loc.stopId ?? '');
        setFromTitle(loc.title);
        setFromLat(loc.lat);
        setFromLon(loc.lon);
      })
      .catch(() => {
        if (gen === startSelGen.current) setGpsOrigin(false);
      });
  }, [cityDef.lat, cityDef.lon, cityDef.title]);

  useFocusEffect(
    useCallback(() => {
      const pending = consumePendingBoardedOrigin('routes');
      if (!pending) return;
      startSelGen.current++;
      setGpsOrigin(false);
      setActiveAnchor(null);
      setBoardedTrip(pending.origin);
      setFromId(pending.origin.boardStopId ?? '');
      setFromTitle(s.home.boardedOriginTitle(pending.origin.line, pending.origin.direction || ''));
      if (pending.origin.currentLat != null && pending.origin.currentLon != null) {
        setFromLat(pending.origin.currentLat);
        setFromLon(pending.origin.currentLon);
      }
      setItems([]);
      setLoading(true);
    }, [s.home]),
  );

  const [items, setItems] = useState<Connection[]>([]);
  const [timeSheetOpen, setTimeSheetOpen] = useState(false);
  const [targetTimeSec, setTargetTimeSec] = useState<number | undefined>(undefined);
  const [timeMode, setTimeMode] = useState<JourneyTimeMode>('departure');
  const arrivalMode = timeMode === 'arrival';
  const [loading, setLoading] = useState(true);
  const [showInitialLoading, setShowInitialLoading] = useState(false);
  const [loadError, setLoadError] = useState(false);
  useEffect(() => {
    if (!loading || items.length > 0) {
      setShowInitialLoading(false);
      return;
    }
    const timer = setTimeout(() => setShowInitialLoading(true), INITIAL_LOADING_DELAY_MS);
    return () => clearTimeout(timer);
  }, [items.length, loading]);
  const [offline, setOffline] = useState(false);
  const [preview, setPreview] = useState<{ item: Connection; sticky: boolean } | null>(null);
  const [previewReady, setPreviewReady] = useState(false);
  const previewId = useRef<string | null>(null);
  const closePreview = useCallback(() => {
    if (previewId.current === null) return;
    previewId.current = null;
    setPreview((prev) => (prev === null ? prev : null));
    setPreviewReady((prev) => (prev ? false : prev));
  }, []);
  useFocusEffect(useCallback(() => closePreview, [closePreview]));
  // Śledzimy fokus refem zamiast useIsFocused(), żeby kliknięcie karty nie wywoływało
  // re-renderu całej listy w klatce startu animacji przejścia na szczegóły.
  const isFocusedRef = useRef(true);
  const syncLiveOnFocusRef = useRef<(() => void) | null>(null);
  const restoreListScrollRef = useRef<(() => void) | null>(null);
  // Lista pokazuje opóźnienia live, więc trzyma poll, dopóki jest widoczna.
  useFocusEffect(
    useCallback(() => {
      const wasBlurred = !isFocusedRef.current;
      isFocusedRef.current = true;
      liveTracker.acquire();
      if (wasBlurred) {
        syncLiveOnFocusRef.current?.();
        setNowTick(Date.now());
        // Po powrocie ze szczegółów (zwłaszcza po systemowym udostępnianiu)
        // natywny ScrollView potrafi zostać z offsetem poza zakresem treści.
        restoreListScrollRef.current?.();
      }
      return () => {
        isFocusedRef.current = false;
        liveTracker.release();
      };
    }, []),
  );
  // Rozkład trzymany na telefonie: bez niego RAPTOR nie ma czym liczyć, więc
  // pusty wynik to nie „brak serwera", tylko brak danych offline.
  const [dataStatus, setDataStatus] = useState<DataStatus>(() => getDataStatus());
  useEffect(() => subscribeDataStatus(setDataStatus), []);
  const timetableBusy = dataStatus.state === 'downloading' || dataStatus.state === 'importing';
  const timetableReady = dataStatus.state === 'ready';
  // Brak sieci = brak opóźnień z MPK. Bez komunikatu użytkownik myśli,
  // że planer po prostu nie umie opóźnień.
  // `unknown` też oznacza brak danych: przed pierwszym udanym pollem (albo przy
  // starcie apki) nie mamy żadnego opóźnienia, więc cisza była kłamstwem.
  const [liveStale, setLiveStale] = useState(
    () => liveTracker.supportsLive() && liveTracker.getLiveState() !== 'fresh',
  );
  // Tick przerysowujący opóźnienia: wyplanowane połączenia mają flagi live
  // z chwili wyszukiwania, bez tickera byłyby zamrożone od wyszukania.
  const initialLiveOk = liveTracker.getLastOk();
  const [liveTick, setLiveTick] = useState(initialLiveOk);
  const lastLiveOk = useRef(initialLiveOk);
  useEffect(() => {
    const check = () => {
      if (!isFocusedRef.current) return;
      // Miasto bez feedu live nie może pokazywać chipa „brak danych”:
      // to nie awaria, tylko nieistniejące źródło (features.live).
      const stale = liveTracker.supportsLive() && liveTracker.getLiveState() !== 'fresh';
      setLiveStale((prev) => (prev === stale ? prev : stale));
      const ok = liveTracker.getLastOk();
      if (ok !== lastLiveOk.current) {
        lastLiveOk.current = ok;
        setLiveTick(ok);
      }
    };
    syncLiveOnFocusRef.current = check;
    check();
    const unsub = liveTracker.subscribe(check);
    const t = setInterval(check, 30000);
    return () => {
      syncLiveOnFocusRef.current = null;
      unsub();
      clearInterval(t);
    };
  }, []);
  // Odliczanie „za X min” musi tykać, inaczej po kilku minutach lista kłamie
  // (departInMin liczone przy pobraniu). Przerysowujemy wiersze, nie listę.
  const [nowTick, setNowTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => {
      if (isFocusedRef.current) setNowTick(Date.now());
    }, 30000);
    return () => clearInterval(t);
  }, []);

  // Rozgrzewamy lokalny słownik podpowiedzi przystanków w tle po pokazaniu wyników,
  // żeby wejście w szczegóły połączenia miało wskazówki od razu w pamięci bez parsowania bundla.
  const hasResults = items.length > 0;
  useEffect(() => {
    if (!hasResults) return;
    const timer = setTimeout(() => {
      if (isFocusedRef.current) void ensureStopHintsLoaded(cityId);
    }, 350);
    return () => clearTimeout(timer);
  }, [cityId, hasResults]);

  const [loadingMore, setLoadingMore] = useState(false);
  const [loadingEarlier, setLoadingEarlier] = useState(false);
  const [noMoreEarlier, setNoMoreEarlier] = useState(false);
  const [earlierFailed, setEarlierFailed] = useState(false);
  const [earlierFocused, setEarlierFocused] = useState(false);
  const earlierRequest = useRef(false);
  const [noMoreLater, setNoMoreLater] = useState(false);
  // Doładowanie potrafi paść (baza w trakcie importu, pusty dzień) i wtedy
  // lista po cichu przestawała się dociągać. Bez tego użytkownik scrollował
  // do końca i nie dostawał żadnej odpowiedzi.
  const [loadMoreFailed, setLoadMoreFailed] = useState(false);
  // Filtry połączeń: jednorazowe filtry w pamięci (bezpośrednie, środek transportu)
  // dla aktualnie wyszukanej trasy, otwierane z karty w nagłówku.
  const [transfersFilter, setTransfersFilter] = useState<RouteTransfersFilter>(
    params.directOnly === '1' ? 'direct' : 'all',
  );
  const [liveOnly, setLiveOnly] = useState(false);
  const [modeFilter, setModeFilter] = useState<RouteModeFilter>(
    params.modes === 'tram' ||
      params.modes === 'bus' ||
      params.modes === 'train' ||
      params.modes === 'cable'
      ? (params.modes as RouteModeFilter)
      : 'all',
  );
  const [filtersOpen, setFiltersOpen] = useState(false);
  const availableModes = useMemo(() => {
    const set = new Set<LegMode>();
    for (const item of items) {
      for (const leg of item.legs) {
        if (leg.mode && leg.mode !== 'walk') {
          set.add(leg.mode);
        }
      }
    }
    const ORDER: LegMode[] = ['tram', 'bus', 'train', 'cable', 'trolleybus', 'subway'];
    return ORDER.filter((m) => set.has(m));
  }, [items]);

  useEffect(() => {
    if (modeFilter !== 'all' && availableModes.length > 0 && !availableModes.includes(modeFilter)) {
      setModeFilter('all');
    }
  }, [availableModes, modeFilter]);

  const tripDelays = useMemo(
    () => (offline || liveStale ? new Map<string, number>() : liveTracker.getTripDelays()),
    [offline, liveStale, liveTick],
  );
  const liveItems = useRailLiveConnections(items, tripDelays, !offline, isFocusedRef);

  const displayed = useMemo(() => {
    let list = liveItems;
    if (transfersFilter === 'direct') {
      list = list.filter((c) => c.transfers === 0);
    } else if (transfersFilter === 'max1') {
      list = list.filter((c) => c.transfers <= 1);
    }
    if (liveOnly) {
      list = list.filter((c) => c.live);
    }
    if (modeFilter !== 'all') {
      if (modeFilter === 'tram') {
        const hasPure = list.some((c) =>
          c.legs.every((l) => l.mode === 'walk' || l.mode === 'tram'),
        );
        list = list.filter((c) =>
          hasPure
            ? c.legs.every((l) => l.mode === 'walk' || l.mode === 'tram')
            : c.legs.some((l) => l.mode === 'tram'),
        );
      } else if (modeFilter === 'bus') {
        const hasPure = list.some((c) =>
          c.legs.every((l) => l.mode === 'walk' || l.mode === 'bus' || l.mode === 'trolleybus'),
        );
        list = list.filter((c) =>
          hasPure
            ? c.legs.every((l) => l.mode === 'walk' || l.mode === 'bus' || l.mode === 'trolleybus')
            : c.legs.some((l) => l.mode === 'bus' || l.mode === 'trolleybus'),
        );
      } else {
        list = list.filter((c) => c.legs.some((l) => l.mode === modeFilter));
      }
    }
    // Kolejność zawsze po realnym odjeździe: opóźnienie przesuwa kartę na
    // jej nowe miejsce w czasie, zamiast zostawiać ją tam, gdzie stała.
    return [...list].sort(
      (a, b) =>
        boardingDepartureSec(a) - boardingDepartureSec(b) ||
        (a.arrivalSec ?? a.departureSec) - (b.arrivalSec ?? b.departureSec),
    );
  }, [liveItems, transfersFilter, liveOnly, modeFilter]);

  const listRef = useRef<FlatList<Connection>>(null);
  const listContentHeightRef = useRef(0);
  const listViewportHeightRef = useRef(0);

  const queryAt = (depSec: number | undefined) => {
    const cfg = getSettingsSync();
    return {
      fromId: fromId || undefined,
      fromTitle,
      fromLat,
      fromLon,
      toId,
      toTitle,
      toLat,
      toLon,
      // Kotwica to preferencja startowa: pozycja zostaje prawdziwym GPS,
      // silnik liczy realny spacer do kotwicy (ułatwienie, nie sztywna zasada).
      anchorStopId: activeAnchor?.stopId,
      anchorStopLat: activeAnchor?.lat,
      anchorStopLon: activeAnchor?.lon,
      boardedTrip: boardedTrip ?? undefined,
      departureTimeSec: arrivalMode ? undefined : depSec,
      arriveBySec: arrivalMode ? depSec : undefined,
      maxTransfers: cfg.maxTransfers,
      modes: 'all' as const,
      minTransferSec: cfg.minTransferSec,
      trainsEnabled: cfg.trainsEnabled,
      cableEnabled: cfg.cableEnabled,
      allowedTransferModes: cfg.allowedModes,
      trainMinTransferSec: cfg.trainMinTransferSec,
      maxWalkM: cfg.maxWalkM,
      // Tempo z profilu wybranego w ustawieniach (wolno/normalnie/szybko).
      walkSpeedMps: profileWalkSpeedMps(cfg.walkPace),
      // Miasto: godzina w przód wystarcza na pierwsze odjazdy i mieści się
      // w wycinku, który liveTracker i tak buduje na starcie. Kolej
      // międzymiastowa ma własny horyzont w planIntercity.
      searchAheadSec: intercityQuery ? undefined : 3600,
    };
  };

  // Wyszukiwarka startu / celu: ta sama co na ekranie głównym
  const [sheetFor, setSheetFor] = useState<'from' | 'to' | null>(null);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Suggestion[]>([]);
  const [recent, setRecent] = useState<Suggestion[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState(false);
  const [savedQuick, setSavedQuick] = useState<Suggestion[]>([]);
  // GPS spoza strefy aktywnego miasta nie może być startem trasy.
  const [gpsOutside, setGpsOutside] = useState(false);
  // Podróż między miastami bez pobranego rozkładu kolejowego: zamiast pustki
  // "brak połączeń" pokazujemy kartę pobrania bazy `polska`.
  const intercityQuery = useMemo(
    () =>
      isIntercityRouteQuery({
        fromLat,
        fromLon,
        toLat,
        toLon,
        toId: toId || undefined,
        trainsEnabled: getSettingsSync().trainsEnabled,
      }),
    [fromLat, fromLon, toLat, toLon, toId],
  );
  const [railDbReady, setRailDbReady] = useState<boolean | null>(null);
  useEffect(() => {
    let alive = true;
    if (!intercityQuery) {
      setRailDbReady(null);
      return;
    }
    const unsub = subscribeNationalTimetable((st) => {
      if (alive && st.phase === 'ready') setRailDbReady(true);
    });
    void nationalTimetableReady().then((ready) => {
      if (!alive) return;
      setRailDbReady(ready);
      if (!ready) {
        void ensureNationalTimetable().catch(() => {});
      }
    });
    return () => {
      alive = false;
      unsub();
    };
  }, [intercityQuery, items.length]);

  useEffect(() => {
    SearchService.recent()
      .then(setRecent)
      .catch(() => {});
    Promise.all([FavoritesService.list(), loadSettings()])
      .then(([places, currentSettings]) => {
        setSavedPlaces(places);
        setSavedQuick(
          places.map((p) => ({
            id: p.placeId || `saved:${p.id}`,
            title: p.name,
            address: p.address,
            kind: 'place' as const,
            savedIcon: p.icon,
            lat: p.lat,
            lon: p.lon,
          })),
        );

        if (!initialAnchorCheckedRef.current && !boardedTrip) {
          initialAnchorCheckedRef.current = true;
          const cityD = defaultLocationForCity(getActiveCityIdSync());
          const startLat = Number(params.fromLat || cityD.lat);
          const startLon = Number(params.fromLon || cityD.lon);
          const startTitle = params.fromTitle || cityD.title;
          const anchor = findAnchorForLocation(
            startLat,
            startLon,
            startTitle,
            places,
            currentSettings.anchorRadiusM,
            dismissedAnchorsRef.current,
          );
          if (anchor) {
            // Kotwica NIE przepisuje pozycji na przystanek (to generowało
            // absurdalne "wsiądź i od razu wysiądź" z zerowym dojściem).
            // from* zostaje prawdziwym GPS, kotwica idzie jako preferencja.
            setActiveAnchor(anchor);
            setFromTitle(startTitle);
            setFromLat(startLat);
            setFromLon(startLon);
          }
        }
      })
      .catch(() => {});
  }, []);

  // Start z GPS bez kotwicy liczy się z fixu, który mógł być słaby (Balanced
  // potrafi trafić o setki metrów i wybrać przystanek po złej stronie osiedla).
  // Po wyszukaniu bierzemy dokładniejszy fix w tle; gdy pozycja faktycznie się
  // przesunęła, podmieniamy origin, a lista odświeża się seamless, bez spinnera.
  useEffect(() => {
    if (!gpsOrigin || activeAnchor || boardedTrip) return;
    let cancelled = false;
    const gen = startSelGen.current;
    const apply = (loc: LocationResult) => {
      if (cancelled || refineAppliedRef.current || activeAnchorRef.current) return;
      // Ręczny start wybrany po starcie tego efektu unieważnia doprecyzowanie.
      if (gen !== startSelGen.current) return;
      if (isOutsideServiceArea(loc.lat, loc.lon)) return;
      const origin = originCoordsRef.current;
      if (distanceMeters(loc.lat, loc.lon, origin.lat, origin.lon) < LOCATION_REFINE_DELTA_M)
        return;
      refineAppliedRef.current = true;
      setFromTitle(loc.title);
      setFromLat(loc.lat);
      setFromLon(loc.lon);
    };
    const unsubscribe = LocationService.subscribe(apply);
    void LocationService.refineLocation()
      .then((loc) => {
        if (loc) apply(loc);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [gpsOrigin, activeAnchor, boardedTrip]);

  const handleSearchQuery = useCallback((next: string) => {
    setQuery(next);
    if (next.trim()) {
      setSearchLoading(true);
    } else {
      setSearchLoading(false);
      setResults([]);
    }
  }, []);

  // Lokalny indeks odpowiada od razu, odległości względem aktualnego startu.
  const searchSeq = useRef(0);
  useEffect(() => {
    const seq = ++searchSeq.current;
    if (!sheetFor) return;
    const q = query.trim();
    setSearchError(false);
    if (!q) {
      setResults([]);
      setSearchLoading(false);
      return;
    }
    setSearchLoading(true);
    SearchService.search(q, { lat: fromLat, lon: fromLon }, 'routes-start', (partial) => {
      if (seq === searchSeq.current) setResults(partial);
    })
      .then((r) => {
        if (seq !== searchSeq.current) return;
        setResults(r);
        setSearchLoading(false);
      })
      .catch(() => {
        if (seq === searchSeq.current) {
          setSearchError(true);
          setSearchLoading(false);
        }
      });
    return () => {
      ++searchSeq.current;
      SearchService.cancel('routes-start');
    };
  }, [query, sheetFor, fromLat, fromLon]);

  const recentWithGps = useMemo(
    () => (sheetFor === 'from' ? (gpsOutside ? recent : [gpsItem, ...recent]) : recent),
    [sheetFor, recent, gpsItem, gpsOutside],
  );

  const nearbyVehicles = useMemo(
    () =>
      sheetFor === 'from' && gtfsStore.isLoaded
        ? findNearbyLiveVehicles(fromLat, fromLon, liveTracker.snapshot(), gtfsStore)
        : [],
    [fromLat, fromLon, liveTick, sheetFor],
  );

  const handleSuggestionSelect = async (sug: Suggestion) => {
    hapticTap();
    // Wybór startu unieważnia GPS w locie: spóźniony fix nie nadpisze
    // startu wybranego później.
    const forStart = sheetFor === 'from';
    const gen = forStart ? ++startSelGen.current : startSelGen.current;
    setQuery('');
    setSheetFor(null);
    if (sug.id === gpsItem.id) {
      // Start = aktualna pozycja GPS (nie zapisana wcześniej)
      try {
        const l = await LocationService.getCurrentLocation();
        if (gen !== startSelGen.current) return;
        if (isOutsideServiceArea(l.lat, l.lon)) {
          const city = (l as { city?: string | null }).city ?? null;
          setGpsOutside(true);
          Alert.alert(
            s.home.gpsBlockedTitle,
            city ? s.home.gpsBlockedBody(city, cityGen) : s.home.gpsBlockedBodyUnknown(cityGen),
            [
              {
                text: s.home.unsupportedAction,
                onPress: () => {
                  setQuery('');
                  setSheetFor('from');
                },
              },
            ],
          );
          return;
        }
        setGpsOutside(false);
        setBoardedTrip(null);
        setGpsOrigin(true);
        refineAppliedRef.current = false;
        const currentSettings = getSettingsSync();
        dismissedAnchorsRef.current.clear();
        const anchor = findAnchorForLocation(
          l.lat,
          l.lon,
          l.title,
          savedPlaces,
          currentSettings.anchorRadiusM,
          dismissedAnchorsRef.current,
        );
        if (anchor) {
          setActiveAnchor(anchor);
          setFromTitle(l.title);
          setFromLat(l.lat);
          setFromLon(l.lon);
        } else {
          setActiveAnchor(null);
          setFromTitle(l.title);
          setFromLat(l.lat);
          setFromLon(l.lon);
        }
      } catch (err) {
        // Spóźniony błąd po nowszym wyborze startu nie pokazuje alertu.
        if (gen !== startSelGen.current) return;
        console.warn('[handleSuggestionSelect] GPS error:', err);
        Alert.alert(s.routes.gpsFailTitle, s.routes.gpsFailBody);
      }
      return;
    }

    void SearchService.recordRecent(sug)
      .then(() => {
        SearchService.recent()
          .then(setRecent)
          .catch(() => {});
      })
      .catch(() => {});

    if (sheetFor === 'from') {
      if (sug.lat !== fromLat || sug.lon !== fromLon || sug.title !== fromTitle) {
        setItems([]);
        setLoading(true);
      }
      setGpsOrigin(false);
      setActiveAnchor(null);
      setBoardedTrip(null);
      setFromId(sug.id);
      setFromTitle(sug.title);
      setFromLat(sug.lat);
      setFromLon(sug.lon);
    } else {
      if (sug.lat !== toLat || sug.lon !== toLon || sug.title !== toTitle) {
        setItems([]);
        setLoading(true);
      }
      setToId(sug.id);
      setToTitle(sug.title);
      setToLat(sug.lat);
      setToLon(sug.lon);
    }
  };

  const applyLiveList = (c: Connection[], depSec: number | undefined) => {
    // Default: tylko aktualne i przyszłe, bez historycznych.
    // Wcześniejsze odjazdy użytkownik wczytuje gestem lub przyciskiem.
    // Przy jawnie wybranej godzinie (np. z przeszłości) pokazuj wszystko jak jest.
    let list = deduplicateConnections(c).sort((a, b) => a.departureSec - b.departureSec);
    if (depSec === undefined) {
      const d = new Date();
      const nowS = d.getHours() * 3600 + d.getMinutes() * 60 + d.getSeconds();
      list = list.filter((item) => item.boarded || item.departureSec <= 0 || item.departureSec >= nowS - 60);
    }
    return list;
  };

  // Brak rozkładu = brak danych, a nie „nie znaleziono połączeń”. Silnik na
  // pustym sklepie zwraca pustkę BEZ błędu, więc sprawdzamy status w dwóch
  // miejscach: przed zapytaniem (żeby nie liczyć na nic) i po nim (żeby
  // wyłapać import, który ruszył w trakcie zapytania).
  const noTimetable = () => getDataStatus().state !== 'ready';

  const fetchRoutes = async (targetDepSec?: number, seamless = false) => {
    const seq = ++fetchSeq.current;
    setLoading(true);
    setLoadError(false);
    setOffline(false);
    setNoMoreEarlier(arrivalMode);
    setEarlierFailed(false);
    setNoMoreLater(false);
    setLoadMoreFailed(false);
    const depSec = targetDepSec !== undefined ? targetDepSec : targetTimeSec;
    try {
      // Wcześniej niż dotąd: pusty sklep dawał „zero połączeń", a ekran
      // pokazywał to jako wynik wyszukiwania.
      if (noTimetable()) {
        setItems([]);
        setLoadError(true);
        return;
      }
      const q = queryAt(depSec);
      // Zanim planer policzy świeże wyniki, pokaż ostatnią listę z dysku.
      // Karty są klikalne od razu, a szczegóły znajdują je w pamięci procesu.
      let hadSeeded = items.length > 0;
      if (!hadSeeded) {
        const cached = await loadCachedConnections(q);
        if (seq !== fetchSeq.current) return;
        if (cached) {
          const seeded = applyLiveList(
            rehydrateConnections(cached.list, cached.savedAt),
            depSec,
          );
          for (const connection of seeded) rememberPlannedConnection(connection);
          if (seeded.length > 0) {
            hadSeeded = true;
            setItems(seeded);
          }
        }
      }
      // Na zimnym starcie strumieniujemy pierwsze okno RAPTOR-a od razu do listy,
      // żeby użytkownik widział najbliższe odjazdy zanim policzą się dalsze godziny.
      const streamPartial = hadSeeded
        ? undefined
        : (partial: Connection[]) => {
            if (seq !== fetchSeq.current || noTimetable()) return;
            const livePartial = applyLiveList(partial, depSec);
            if (livePartial.length > 0) setItems(livePartial);
          };
      let c = await RoutingService.getConnections(q, streamPartial);
      // Godzinne okno wystarcza na pierwsze odjazdy i mieści się w wycinku
      // live. Gdy naprawdę nic nie ma w godzinę, dociągamy szerszy horyzont,
      // żeby nie pokazać fałszywego „brak połączeń".
      if (c.length === 0 && q.searchAheadSec === 3600) {
        c = await RoutingService.getConnections({ ...q, searchAheadSec: undefined });
        if (seq !== fetchSeq.current) return;
      }
      if (seq !== fetchSeq.current) return;
      if (noTimetable()) {
        setItems([]);
        setLoadError(true);
        return;
      }
      setItems(applyLiveList(c, depSec));
      // Zapisujemy nawyk z ZMIERZONYM czasem dojazdu (mediana z pierwszego
      // okna), żeby „Ostatnie miejsca" nie pokazywały w kartce zawsze
      // domyślnych 18 min. `mergeTripSearch` i tak potraktuje to jako to samo
      // sprawdzenie, które zapisał ekran główny.
      void recordTripSearch(
        q.fromLat,
        q.fromLon,
        q.fromTitle,
        {
          id: q.toId || q.toTitle,
          title: q.toTitle,
          lat: q.toLat,
          lon: q.toLon,
        },
        typicalDurationMin(c),
      );
    } catch {
      if (seq !== fetchSeq.current) return;
      // Offline: ostatnie prawdziwe dane z cache (z przeliczonymi czasami).
      // W trybie seamless nie czyścimy listy ani nie migoczemy spinnerem.
      const cached = await loadCachedConnections(queryAt(depSec));
      if (seq !== fetchSeq.current) return;
      if (cached) {
        setItems(applyLiveList(rehydrateConnections(cached.list, cached.savedAt), depSec));
        setOffline(true);
        setNoMoreEarlier(true);
        setNoMoreLater(true);
      } else if (!seamless || items.length === 0) {
        setLoadError(true);
      } else {
        setOffline(true);
      }
    } finally {
      if (seq === fetchSeq.current) {
        setLoading(false);
      }
    }
  };

  /**
   * Cichy refresh BEZ spinnera i BEZ czyszczenia listy: podmiana jest
   * niewidoczna, gdy dane te same (stabilne klucze FlatList = brak flickeru).
   * Używany przy powrocie sieci i zmianie czasu w trybie offline.
   */
  const quietRefresh = async (targetDepSec?: number) => {
    const seq = ++fetchSeq.current;
    const depSec = targetDepSec !== undefined ? targetDepSec : targetTimeSec;
    try {
      const c = await RoutingService.getConnections(queryAt(depSec));
      if (seq !== fetchSeq.current) return false;
      setItems(applyLiveList(c, depSec));
      setOffline(false);
      setLoadError(false);
      return true;
    } catch {
      return false;
    }
  };

  // Heartbeat offline: co 60 s sprawdzamy powrót sieci i cicho podmieniamy
  // cache na świeże dane. Bez spinnerów i skoków scrolla.
  const offlineRef = useRef(offline);
  offlineRef.current = offline;
  // Ref na najświeższy quietRefresh: interwał nie może domykać się nad
  // filtrami z chwili przejścia w offline, bo po powrocie sieci podmieniłby
  // listę wynikiem starego zapytania.
  const quietRefreshRef = useRef(quietRefresh);
  quietRefreshRef.current = quietRefresh;
  useEffect(() => {
    if (!offline) return;
    let cancelled = false;
    const beat = async () => {
      if (cancelled || !offlineRef.current) return;
      if (await hasLocalTimetable()) {
        if (cancelled) return;
        await quietRefreshRef.current();
      }
    };
    const timer = setInterval(beat, 60000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [offline]);

  const handleLoadMore = async () => {
    if (loading || loadingMore || loadingEarlier || items.length === 0 || noMoreLater || offline)
      return;

    setLoadingMore(true);
    setLoadMoreFailed(false);
    const lastDeparture = items[items.length - 1].departureSec;
    const nextTime = arrivalMode
      ? Math.min(...items.map((c) => c.arrivalSec ?? c.departureSec + c.durationMin * 60)) - 1
      : lastDeparture + 60;
    const seq = ++fetchSeq.current;

    try {
      // Przyjazdy przewijamy wstecz, bez przekraczania wybranego terminu.
      const c = await RoutingService.getConnections(queryAt(nextTime));
      if (seq !== fetchSeq.current) return;
      setItems((prev) => {
        const { list, added } = mergeConnections(prev, c);
        if (added === 0) setNoMoreLater(true);
        return list;
      });
    } catch (err) {
      console.warn('[Routes] load more failed:', err);
      if (seq === fetchSeq.current) setLoadMoreFailed(true);
    } finally {
      // Zawsze gasimy spinner: jeśli w trakcie zapytania filtr podbił fetchSeq,
      // wynik i tak odpadnie po seq, ale flaga nie może zostać true na zawsze.
      setLoadingMore(false);
    }
  };

  // Starsze (historyczne, już odjechane), dokładane Z GÓRY
  const pullTriggeredRef = useRef(false);
  const recentEarlierIdsRef = useRef<Set<string>>(new Set());
  const earlierClearTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleLoadEarlier = async (fromPull = false) => {
    if (arrivalMode) return;
    if (
      loading ||
      loadingMore ||
      earlierRequest.current ||
      items.length === 0 ||
      noMoreEarlier ||
      offline
    ) {
      if (fromPull) {
        pullBusy.value = false;
        pullHeight.value = withSpring(0, motion.spring.spatialDefault);
      }
      return;
    }
    const firstDeparture = items[0].departureSec;
    if (!firstDeparture || firstDeparture <= 0) {
      if (fromPull) {
        pullBusy.value = false;
        pullHeight.value = withSpring(0, motion.spring.spatialDefault);
      }
      return;
    }

    earlierRequest.current = true;
    pullTriggeredRef.current = fromPull;
    setLoadingEarlier(true);
    setEarlierFailed(false);
    const startedAt = Date.now();
    const prevIds = new Set(items.map((c) => c.id));
    const seq = ++fetchSeq.current;

    try {
      const result = await loadEarlierConnections(
        items,
        (at) => RoutingService.getConnections(queryAt(at)),
        () => seq !== fetchSeq.current,
      );
      if (!result) return;
      if (fromPull) {
        // Przy błyskawicznym SQLite krótkie podtrzymanie zapobiega 1-klatkowemu mignięciu panelu.
        const remaining = 180 - (Date.now() - startedAt);
        if (remaining > 0) {
          await new Promise<void>((resolve) => setTimeout(resolve, remaining));
          if (seq !== fetchSeq.current) return;
        }
      }
      if (result.added > 0) {
        const addedIds = new Set<string>();
        for (const conn of result.list) {
          if (!prevIds.has(conn.id)) addedIds.add(conn.id);
        }
        recentEarlierIdsRef.current = addedIds;
        if (earlierClearTimerRef.current) clearTimeout(earlierClearTimerRef.current);
        earlierClearTimerRef.current = setTimeout(() => {
          recentEarlierIdsRef.current.clear();
        }, 550);
        if (isFocusedRef.current) hapticSuccess();
      } else if (isFocusedRef.current) {
        hapticEdge();
      }
      setNoMoreEarlier(result.added === 0);
      setItems(result.list);
    } catch {
      if (seq === fetchSeq.current) {
        setEarlierFailed(true);
        if (isFocusedRef.current) hapticError();
      }
    } finally {
      // Jak w handleLoadMore: spinner gaśnie nawet gdy zapytanie zostało
      // unieważnione przez nowszy fetchSeq.
      earlierRequest.current = false;
      pullTriggeredRef.current = false;
      setLoadingEarlier(false);
      pullBusy.value = false;
      pullHeight.value = withSpring(0, motion.spring.spatialDefault);
    }
  };

  useEffect(
    () => () => {
      if (earlierClearTimerRef.current) clearTimeout(earlierClearTimerRef.current);
    },
    [],
  );

  // Ref na aktualną funkcję: handler gestu i przycisku pozostają stabilne.
  const loadEarlierRef = useRef(handleLoadEarlier);
  loadEarlierRef.current = handleLoadEarlier;

  useEffect(() => {
    if (samePlace) {
      setItems([]);
      setLoading(false);
      setLoadError(false);
      return;
    }
    // Intercity: nie ruszaj RAPTOR-a, dopóki nie wiemy, czy baza polska jest.
    // Inaczej pierwsze wyszukiwanie idzie w kosz (railDbReady: null → true/false).
    if (intercityQuery && railDbReady === null) return;
    const task = InteractionManager.runAfterInteractions(() => {
      fetchRoutes(targetTimeSec, items.length > 0);
    });
    return () => {
      task.cancel();
      fetchSeq.current++;
    };
    // timetableReady jest tu celowo: ekran otwarty w trakcie pierwszego
    // importu dostawał pustą listę i nigdy sam się nie odpytywał, więc
    // połączenia zostawały niewidoczne mimo gotowego rozkładu.
  }, [
    fromLat,
    fromLon,
    toLat,
    toLon,
    fromTitle,
    toTitle,
    toId,
    samePlace,
    activeAnchor,
    boardedTrip,
    timetableReady,
    targetTimeSec,
    timeMode,
    intercityQuery,
    railDbReady,
  ]);

  // Przycisk i gest dokładają wcześniejsze odjazdy do tej samej listy.
  const handleButtonEarlier = useCallback(() => {
    void loadEarlierRef.current(false);
  }, []);

  const triggerPullEarlier = useCallback(() => {
    void loadEarlierRef.current(true);
  }, []);

  const handleReverse = useCallback(() => {
    if (samePlace || (fromLat === toLat && fromLon === toLon && fromTitle === toTitle)) return;
    // Haptykę nacisku daje już przycisk zamiany w RouteEndpoints.
    // Swap ustawia ręczny start: unieważnia GPS wybrany wcześniej w arkuszu.
    startSelGen.current++;
    setItems([]);
    setLoading(true);
    // Wyniki po swapie to zupełnie nowa lista: wracamy na górę.
    listRef.current?.scrollToOffset({ offset: 0, animated: false });
    // Start = stary cel (ręczny punkt), więc doprecyzowanie GPS już nie dotyczy.
    setGpsOrigin(false);
    setActiveAnchor(null);
    setBoardedTrip(null);
    const tempId = fromId;
    const tempTitle = fromTitle;
    const tempLat = fromLat;
    const tempLon = fromLon;

    setFromId(toId);
    setFromTitle(toTitle);
    setFromLat(toLat);
    setFromLon(toLon);

    setToId(tempId);
    setToTitle(tempTitle);
    setToLat(tempLat);
    setToLon(tempLon);
  }, [samePlace, fromLat, toLat, fromLon, toLon, fromTitle, toTitle]);

  const handleTimeSelect = (result: JourneyTimeSelection) => {
    if (targetTimeSec === result.timeSec && timeMode === result.mode) return;
    fetchSeq.current++;
    setItems([]);
    setLoading(true);
    setTargetTimeSec(result.timeSec);
    setTimeMode(result.mode);
    listRef.current?.scrollToOffset({ offset: 0, animated: false });
  };

  const activeFilterCount =
    (modeFilter !== 'all' ? 1 : 0) +
    (transfersFilter !== 'all' ? 1 : 0) +
    (liveOnly ? 1 : 0);
  const hasActiveFilters = activeFilterCount > 0;
  const isCustomTime = targetTimeSec !== undefined || arrivalMode;

  const listScrollY = useSharedValue(0);
  const pullHeight = useSharedValue(0);
  const pullArmed = useSharedValue(false);
  const pullArmPulse = useSharedValue(0);
  const pullBusy = useSharedValue(false);
  const pullNoMore = useSharedValue(false);
  const pullDisabled = useSharedValue(false);
  const pullEligible = useSharedValue(false);
  const pullActive = useSharedValue(false);
  const pullEdgeHapticSent = useSharedValue(false);
  const touchStartX = useSharedValue(0);
  const touchStartY = useSharedValue(0);
  const pullOriginY = useSharedValue(0);
  const peekDragY = useSharedValue(0);

  useEffect(() => {
    pullNoMore.value = noMoreEarlier;
  }, [noMoreEarlier, pullNoMore]);

  useEffect(() => {
    pullDisabled.value = loading || loadingMore || offline || arrivalMode || items.length === 0;
  }, [arrivalMode, items.length, loading, loadingMore, offline, pullDisabled]);

  const handleListScroll = useAnimatedScrollHandler({
    onScroll: (event) => {
      listScrollY.value = event.contentOffset.y;
    },
  });

  // Powrót z innego ekranu lub odtworzenie aktywności (np. po systemowym
  // udostępnianiu) może zostawić natywny offset poza zakresem treści. Wtedy
  // lista wygląda na pustą, dopóki użytkownik sam nie przewinie. Przywracamy
  // ostatnią znaną pozycję, a natywny ScrollView sam ją przytnie do zakresu.
  const scrollListToValidOffset = useCallback(
    (force: boolean) => {
      const current = listScrollY.value;
      if (force) {
        // Przy powrocie nie znamy jeszcze nowej wysokości treści, ale natywny
        // ScrollView sam przytnie podany offset do aktualnego zakresu.
        listRef.current?.scrollToOffset({ offset: Math.max(0, current), animated: false });
        return;
      }
      const contentHeight = listContentHeightRef.current;
      const viewportHeight = listViewportHeightRef.current;
      if (contentHeight <= 0 || viewportHeight <= 0) return;
      const maxOffset = Math.max(0, contentHeight - viewportHeight);
      const target = Math.min(Math.max(current, 0), maxOffset);
      if (Math.abs(target - current) < 1) return;
      listRef.current?.scrollToOffset({ offset: target, animated: false });
      listScrollY.value = target;
    },
    [listScrollY],
  );
  restoreListScrollRef.current = () => scrollListToValidOffset(true);

  const handleListContentSize = useCallback(
    (_width: number, height: number) => {
      listContentHeightRef.current = height;
      scrollListToValidOffset(false);
    },
    [scrollListToValidOffset],
  );

  const handleListLayout = useCallback(
    (event: LayoutChangeEvent) => {
      listViewportHeightRef.current = event.nativeEvent.layout.height;
      scrollListToValidOffset(false);
    },
    [scrollListToValidOffset],
  );

  const firePullArmHaptic = useCallback(() => hapticGestureArm(), []);
  const firePullDisarmHaptic = useCallback(() => hapticGestureDisarm(), []);
  const firePullEdgeHaptic = useCallback(() => hapticEdge(), []);

  // Ręczna aktywacja na wątku UI gwarantuje, że zwykłe scrollowanie i gesty
  // boczne nigdy nie są blokowane, a przy y=0 lista płynnie jedzie za palcem.
  const pullPanGesture = useMemo(
    () =>
      Gesture.Pan()
        .enabled(Platform.OS !== 'web' && !arrivalMode && !offline)
        .manualActivation(true)
        .onTouchesDown((e, stateManager) => {
          'worklet';
          if (
            e.numberOfTouches !== 1 ||
            listScrollY.value > 2 ||
            pullBusy.value ||
            pullDisabled.value
          ) {
            pullEligible.value = false;
            pullActive.value = false;
            stateManager.fail();
            return;
          }
          const touch = e.allTouches[0];
          // Lewa krawędź zostaje dla gestu wstecz nawigacji.
          if (touch.absoluteX < 32) {
            pullEligible.value = false;
            pullActive.value = false;
            stateManager.fail();
            return;
          }
          touchStartX.value = touch.absoluteX;
          touchStartY.value = touch.absoluteY;
          pullEligible.value = true;
          pullActive.value = false;
          pullEdgeHapticSent.value = false;
        })
        .onTouchesMove((e, stateManager) => {
          'worklet';
          if (!pullEligible.value || pullActive.value) return;
          if (e.numberOfTouches !== 1 || listScrollY.value > 2) {
            pullEligible.value = false;
            stateManager.fail();
            return;
          }
          const touch = e.allTouches[0];
          const dx = touch.absoluteX - touchStartX.value;
          const dy = touch.absoluteY - touchStartY.value;
          if (dy < -5 || Math.abs(dx) > 12) {
            pullEligible.value = false;
            stateManager.fail();
            return;
          }
          if (dy > 10 && Math.abs(dy) > Math.abs(dx) * 1.4) {
            pullActive.value = true;
            pullOriginY.value = touch.absoluteY;
            stateManager.activate();
          }
        })
        .onTouchesUp((_e, stateManager) => {
          'worklet';
          if (!pullActive.value) {
            pullEligible.value = false;
            stateManager.fail();
          }
        })
        .onTouchesCancelled((_e, stateManager) => {
          'worklet';
          if (!pullActive.value) {
            pullEligible.value = false;
            stateManager.fail();
          }
        })
        .onUpdate((e) => {
          'worklet';
          if (!pullActive.value) return;
          const rawDy = Math.max(0, e.absoluteY - pullOriginY.value);
          if (pullNoMore.value) {
            const h = earlierRubberBand(rawDy, EARLIER_PULL_EDGE_MAX);
            pullHeight.value = h;
            if (h >= 24 && !pullEdgeHapticSent.value) {
              pullEdgeHapticSent.value = true;
              runOnJS(firePullEdgeHaptic)();
            }
            return;
          }
          const h = earlierRubberBand(rawDy, EARLIER_PULL_MAX);
          pullHeight.value = h;
          const nextArmed = nextEarlierPullArmed(pullArmed.value, h);
          if (nextArmed !== pullArmed.value) {
            pullArmed.value = nextArmed;
            if (nextArmed) {
              pullArmPulse.value = 1;
              pullArmPulse.value = withSpring(0, motion.spring.spatialFast);
              runOnJS(firePullArmHaptic)();
            } else {
              runOnJS(firePullDisarmHaptic)();
            }
          }
        })
        .onEnd(() => {
          'worklet';
          const shouldLoad =
            pullActive.value && pullArmed.value && !pullBusy.value && !pullNoMore.value;
          pullArmed.value = false;
          pullActive.value = false;
          pullEligible.value = false;
          pullEdgeHapticSent.value = false;
          if (shouldLoad) {
            pullBusy.value = true;
            pullHeight.value = withSpring(EARLIER_PULL_LOADING, motion.spring.spatialDefault);
            runOnJS(triggerPullEarlier)();
          } else if (!pullBusy.value) {
            pullHeight.value = withSpring(0, motion.spring.spatialDefault);
          }
        })
        .onFinalize(() => {
          'worklet';
          pullArmed.value = false;
          pullActive.value = false;
          pullEligible.value = false;
          pullEdgeHapticSent.value = false;
          if (!pullBusy.value) {
            pullHeight.value = withSpring(0, motion.spring.spatialDefault);
          }
        }),
    [
      arrivalMode,
      offline,
      listScrollY,
      pullActive,
      pullArmPulse,
      pullArmed,
      pullBusy,
      pullDisabled,
      pullEdgeHapticSent,
      pullEligible,
      pullHeight,
      pullNoMore,
      pullOriginY,
      touchStartX,
      touchStartY,
      firePullArmHaptic,
      firePullDisarmHaptic,
      firePullEdgeHaptic,
      triggerPullEarlier,
    ],
  );

  const listTranslateStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: pullHeight.value }],
  }));

  const earlierButtonFadeStyle = useAnimatedStyle(() => ({
    opacity: interpolate(pullHeight.value, [0, 22], [1, 0], Extrapolation.CLAMP),
  }));

  const stickyDividerStyle = useAnimatedStyle(() => ({
    opacity: interpolate(listScrollY.value, [4, 22], [0, 1], 'clamp'),
  }));

  // Wstecz z ręcznie ustawionym czasem wraca do ekranu głównego: użytkownik
  // przyszedł tu z konkretnego punktu startu i nie chce zostać na liście
  // przefiltrowanej na inną godzinę.
  const isCustomTimeRef = useRef(isCustomTime);
  isCustomTimeRef.current = isCustomTime;
  useFocusEffect(
    useCallback(() => {
      const sub = BackHandler.addEventListener('hardwareBackPress', () => {
        if (!isCustomTimeRef.current) return false;
        if (router.canGoBack()) {
          router.dismissTo('/');
        } else {
          router.replace('/');
        }
        return true;
      });
      return () => sub.remove();
    }, [router]),
  );

  const timeDisplayLabel = useMemo(() => {
    if (targetTimeSec === undefined) {
      return s.routes.now;
    }
    const dayOffset = Math.floor(targetTimeSec / 86400);
    const day =
      dayOffset === 0
        ? s.common.today
        : dayOffset === 1
          ? s.common.tomorrow
          : (() => {
              const d = new Date();
              d.setDate(d.getDate() + dayOffset);
              const dd = String(d.getDate()).padStart(2, '0');
              const mm = String(d.getMonth() + 1).padStart(2, '0');
              return `${dd}.${mm}`;
            })();
    const hh = String(Math.floor(targetTimeSec / 3600) % 24).padStart(2, '0');
    const mm = String(Math.floor((targetTimeSec % 3600) / 60)).padStart(2, '0');
    if (arrivalMode) {
      return `${s.routesBar.arrivalShort(`${hh}:${mm}`)}`;
    }
    return `${day} ${hh}:${mm}`;
  }, [targetTimeSec, arrivalMode, s]);

  const modeGenitive = (mode: RouteModeFilter) => {
    switch (mode) {
      case 'tram':
        return s.routes.vehicleTramGen;
      case 'bus':
        return s.routes.vehicleBusGen;
      case 'train':
        return s.routes.vehicleTrainGen;
      case 'cable':
        return s.routes.vehicleCableGen;
      case 'trolleybus':
        return s.routes.vehicleTrolleyGen;
      case 'subway':
        return s.routes.vehicleSubwayGen;
      default:
        return '';
    }
  };
  const earlierDisabled = loading || loadingMore || loadingEarlier || noMoreEarlier;

  const cardTransition = useRouteCardTransition();
  const openingRouteRef = useRef(false);
  const openingUnlockTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (openingUnlockTimerRef.current !== null) {
        clearTimeout(openingUnlockTimerRef.current);
      }
    },
    [],
  );
  useFocusEffect(
    useCallback(() => {
      openingRouteRef.current = false;
    }, []),
  );

  const openConnection = useCallback(
    (item: Connection) => {
      if (openingRouteRef.current) return;
      openingRouteRef.current = true;
      if (openingUnlockTimerRef.current !== null) {
        clearTimeout(openingUnlockTimerRef.current);
      }
      openingUnlockTimerRef.current = setTimeout(() => {
        openingRouteRef.current = false;
        openingUnlockTimerRef.current = null;
      }, 360);

      rememberPlannedConnection(item);
      closePreview();

      if (reduceMotion || webLayout.isMedium || !cardTransition) {
        router.push({
          pathname: '/routes/[id]',
          params: { id: item.id },
        });
        return;
      }

      void cardTransition.measureCard(item.id).then((measured) => {
        if (!measured) {
          router.push({
            pathname: '/routes/[id]',
            params: { id: item.id },
          });
          return;
        }
        cardTransition.prepareTransition({
          connectionId: item.id,
          normalizedId: normalizeConnectionId(item.id),
          connection: item,
          cardRect: measured.cardRect,
          stripRect: measured.stripRect,
          variant: measured.variant,
          dimmed: measured.dimmed,
          capturedAt: Date.now(),
        });
        router.push({
          pathname: '/routes/[id]',
          params: { id: item.id, morph: '1' },
        });
      });
    },
    [cardTransition, closePreview, reduceMotion, router, webLayout.isMedium],
  );

  const peek = useMemo<ConnectionPeekHandlers>(
    () => ({
      show: (item, sticky = false) => {
        previewId.current = item.id;
        setPreviewReady(false);
        setPreview({ item, sticky });
      },
      ready: setPreviewReady,
      release: (item, open) => {
        if (previewId.current !== item.id) return;
        if (open) openConnection(item);
        else closePreview();
      },
      dragY: peekDragY,
    }),
    [closePreview, openConnection, peekDragY],
  );

  const routeQueryKey = `${fromLat.toFixed(5)}:${fromLon.toFixed(5)}:${toLat.toFixed(5)}:${toLon.toFixed(5)}:${targetTimeSec ?? 'now'}:${timeMode}:${boardedTrip?.tripId ?? ''}:${activeAnchor?.placeId ?? ''}`;
  const cardHeightsRef = useRef<Map<string, number>>(new Map());
  const seenCardIdsRef = useRef<Set<string>>(new Set());
  const initialEnterDoneRef = useRef(false);
  const lastQueryKeyRef = useRef(routeQueryKey);
  if (lastQueryKeyRef.current !== routeQueryKey) {
    lastQueryKeyRef.current = routeQueryKey;
    cardHeightsRef.current.clear();
    seenCardIdsRef.current.clear();
    recentEarlierIdsRef.current.clear();
    initialEnterDoneRef.current = false;
  }

  const prevDisplayRef = useRef<{ queryKey: string; ids: string[] }>({
    queryKey: routeQueryKey,
    ids: [],
  });
  const reorderSeqRef = useRef(0);
  const reorderTokens = useMemo(() => {
    const ids = displayed.map((c) => c.id);
    const prev = prevDisplayRef.current;
    if (prev.queryKey !== routeQueryKey || prev.ids.length < 2 || ids.length < 2) {
      return null;
    }
    const shifts = computeReorderShifts(prev.ids, ids, cardHeightsRef.current, 168, 12);
    if (shifts.size === 0) return null;
    const seq = ++reorderSeqRef.current;
    const map = new Map<string, ReorderAnimationToken>();
    for (const [id, shift] of shifts) {
      map.set(id, { ...shift, seq });
    }
    return map;
  }, [displayed, routeQueryKey]);

  useLayoutEffect(() => {
    prevDisplayRef.current = {
      queryKey: routeQueryKey,
      ids: displayed.map((c) => c.id),
    };
  }, [displayed, routeQueryKey]);

  useEffect(() => {
    if (displayed.length === 0) return;
    for (const conn of displayed) seenCardIdsRef.current.add(conn.id);
    initialEnterDoneRef.current = true;
  }, [displayed]);

  const handleMeasureCardHeight = useCallback((id: string, height: number) => {
    cardHeightsRef.current.set(id, height);
  }, []);

  const nowTickRef = useRef(nowTick);
  nowTickRef.current = nowTick;

  const getCellStyle = useCallback(
    ({ item }: { item: Connection }) => {
      const token = reorderTokens?.get(item.id);
      if (token?.direction === 'up') return styles.reorderedUpCell;
      if (token?.direction === 'down') return styles.reorderedDownCell;
      return undefined;
    },
    [reorderTokens],
  );

  const renderConnection = useCallback(
    ({ item, index }: { item: Connection; index: number }) => {
      // Granica "przeszłość" liczona przy każdym rysunku: ref zaczepiony przy
      // zamontowaniu ekranu zmroził nam style dłużej niż minutę, bo nowy
      // "tick" dziecka odświeżał napis, a karta zostawała jasna.
      const past =
        !item.boarded && item.departureSec > 0 && boardingDepartureMs(item) < Date.now() - 60000;
      const enterMode: CardEnterMode = recentEarlierIdsRef.current.has(item.id)
        ? 'earlier'
        : !initialEnterDoneRef.current && !seenCardIdsRef.current.has(item.id) && index < 6
          ? 'initial'
          : 'none';
      return (
        <ConnectionListItem
          item={item}
          index={index}
          dimmed={past}
          tick={nowTickRef.current}
          onPress={openConnection}
          peek={peek}
          reduceMotion={reduceMotion}
          enterMode={enterMode}
          reorder={reorderTokens?.get(item.id)}
          onMeasureHeight={handleMeasureCardHeight}
        />
      );
    },
    [handleMeasureCardHeight, openConnection, peek, reduceMotion, reorderTokens],
  );

  const headerStyle = styles.routeHeader;
  const handleOpenFrom = useCallback(() => setSheetFor('from'), []);
  const handleOpenTo = useCallback(() => setSheetFor('to'), []);

  // Klucz tylko przy realnej zmianie kotwicy: bez niego pole originu
  // odtwarzało animację wejścia przy każdym wyszukaniu trasy.
  const anchorKey = activeAnchor ? `anchor:${activeAnchor.placeId}` : 'gps';
  const routeHeader = useMemo(
    () => (
      <View style={headerStyle} key={anchorKey}>
        <RouteEndpoints
          from={fromTitle}
          to={toTitle}
          onFrom={handleOpenFrom}
          onTo={handleOpenTo}
          onSwap={handleReverse}
          fromLabel={
            boardedTrip
              ? s.routes.changeFromBoardedA11y(
                  boardedTrip.line,
                  boardedTrip.direction ||
                    (boardedTrip.boardStopId
                      ? gtfsStore.stops.get(boardedTrip.boardStopId)?.stop_name
                      : undefined) ||
                    '',
                )
              : activeAnchor
                ? s.routes.changeFromAnchorA11y(fromTitle, activeAnchor.stopName)
                : s.routes.changeFromA11y(fromTitle)
          }
          anchor={
            activeAnchor
              ? {
                  stopName: activeAnchor.stopName,
                  onDismiss: handleDismissAnchor,
                  dismissA11y: s.routes.dismissAnchorA11y,
                }
              : undefined
          }
          boarded={
            boardedTrip
              ? {
                  line: boardedTrip.line,
                  mode: boardedTrip.mode ?? 'bus',
                  onDismiss: handleDismissBoarded,
                  dismissA11y: s.routes.dismissBoardedA11y,
                }
              : undefined
          }
        />

        <View style={styles.filterCardsRow}>
          <SpringPressable
            onPress={() => setTimeSheetOpen(true)}
            scaleDelta={0.025}
            haptic="selection"
            style={[styles.actionCard, isCustomTime && styles.actionCardTimeActive]}
            accessibilityRole="button"
            accessibilityLabel={s.routesBar.timeA11y(timeDisplayLabel)}
          >
            {arrivalMode ? (
              <Flag
                size={17}
                color={isCustomTime ? scheme.onPrimaryContainer : scheme.onSurfaceVariant}
              />
            ) : (
              <Clock3
                size={17}
                color={isCustomTime ? scheme.onPrimaryContainer : scheme.onSurfaceVariant}
              />
            )}
            <Text
              style={[styles.actionCardText, isCustomTime && styles.actionCardTimeTextActive]}
              numberOfLines={1}
            >
              {timeDisplayLabel}
            </Text>
            <ChevronDown
              size={16}
              color={isCustomTime ? scheme.onPrimaryContainer : scheme.onSurfaceVariant}
            />
          </SpringPressable>

          <SpringPressable
            onPress={() => setFiltersOpen(true)}
            scaleDelta={0.025}
            haptic="selection"
            style={[styles.actionCard, hasActiveFilters && styles.actionCardFilterActive]}
            accessibilityRole="button"
            accessibilityLabel={s.routesFilters.filterA11y}
          >
            <SlidersHorizontal
              size={17}
              color={hasActiveFilters ? scheme.onSecondaryContainer : scheme.onSurfaceVariant}
            />
            <Text
              style={[styles.actionCardText, hasActiveFilters && styles.actionCardFilterTextActive]}
              numberOfLines={1}
            >
              {s.routesFilters.filterButton}
            </Text>
            {hasActiveFilters && (
              <Animated.View
                entering={reduceMotion ? undefined : FadeIn.duration(140)}
                exiting={reduceMotion ? undefined : FadeOut.duration(100)}
                style={styles.filterCountPill}
              >
                <Text style={styles.filterCountPillText}>{activeFilterCount}</Text>
              </Animated.View>
            )}
          </SpringPressable>
        </View>
      </View>
    ),
    [
      fromTitle,
      toTitle,
      activeAnchor,
      boardedTrip,
      s,
      handleReverse,
      handleOpenFrom,
      handleOpenTo,
      handleDismissAnchor,
      handleDismissBoarded,
      hasActiveFilters,
      activeFilterCount,
      isCustomTime,
      timeDisplayLabel,
      arrivalMode,
      headerStyle,
      anchorKey,
      reduceMotion,
    ],
  );

  const showResultBadge = !samePlace && !loadError && !loading && displayed.length > 0;
  const mediumConstrained = webLayout.isMedium && !webLayout.isDesktop;

  const topBarContent = (
    <>
      {/* Deep link z widgetu omija główny ekran; wstecz wtedy wraca do niego zamiast nic nie robić. */}
      <SpringPressable
        onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))}
        scaleDelta={0.06}
        haptic="selection"
        style={styles.back}
        accessibilityRole="button"
        accessibilityLabel={s.map.backA11y}
      >
        <ChevronLeft size={22} color={scheme.onSurface} />
      </SpringPressable>

      <Text
        style={styles.screenTitle}
        numberOfLines={1}
        adjustsFontSizeToFit
        minimumFontScale={0.85}
      >
        {s.routes.title}
      </Text>

      {showResultBadge ? (
        <Animated.View
          entering={reduceMotion ? undefined : FadeIn.duration(160)}
          exiting={reduceMotion ? undefined : FadeOut.duration(110)}
          style={styles.resultBadge}
        >
          <Text style={styles.resultBadgeText} numberOfLines={1}>
            {s.connection.connections(displayed.length)}
          </Text>
        </Animated.View>
      ) : (
        <View style={styles.topBarSpacer} />
      )}
    </>
  );

  const listPaddingHorizontal = webLayout.isDesktop ? 0 : 16;

  const flatListStage = (
    <View style={styles.listStage}>
      {Platform.OS !== 'web' && !arrivalMode && !offline && (
        <EarlierConnectionsPull
          pullHeight={pullHeight}
          armed={pullArmed}
          armPulse={pullArmPulse}
          loading={loadingEarlier}
          noMore={noMoreEarlier}
          reduceMotion={reduceMotion}
        />
      )}
      <Animated.View style={[styles.listStage, Platform.OS !== 'web' && listTranslateStyle]}>
        <Animated.FlatList
          ref={listRef}
          onScroll={handleListScroll}
          onLayout={handleListLayout}
          onContentSizeChange={handleListContentSize}
          scrollEventThrottle={16}
          accessibilityState={{ busy: loading }}
          pointerEvents={loading && items.length === 0 ? 'none' : 'auto'}
          data={displayed}
          // Bez maintainVisibleContentPosition: natywna korekta offsetu po
          // powrocie z odpiętego ekranu zostawiała pustą listę.
          initialNumToRender={8}
          maxToRenderPerBatch={8}
          windowSize={9}
          // wymusza przeliczenie etykiet "za X min" bez refetchu
          extraData={nowTick}
          keyExtractor={connectionKey}
          CellRendererComponentStyle={getCellStyle}
          contentContainerStyle={[
            styles.list,
            webLayout.isDesktop && styles.listDesktop,
            mediumConstrained && styles.mediumCentered,
            { paddingBottom: insets.bottom + 28 },
          ]}
          showsVerticalScrollIndicator={false}
          overScrollMode="auto"
          // Na Androidzie RN domyślnie odpina widoki spoza kadru
          // (removeClippedSubviews). Przy kartach z cieniem i zwijanym
          // nagłówkiem powoduje to miganie pustych miejsc w trakcie
          // przeciągania palcem, więc trzymamy komórki podpięte.
          removeClippedSubviews={false}
          onEndReached={handleLoadMore}
          onEndReachedThreshold={0.5}
          renderItem={renderConnection}
          ListHeaderComponent={
            <View style={styles.listHeader}>
              {loading && displayed.length > 0 && (
                <Animated.View
                  entering={
                    reduceMotion ? undefined : FadeIn.duration(160).reduceMotion(ReduceMotion.System)
                  }
                  exiting={
                    reduceMotion ? undefined : FadeOut.duration(120).reduceMotion(ReduceMotion.System)
                  }
                  style={styles.countRow}
                  accessibilityLiveRegion="polite"
                >
                  <View style={styles.statusChip}>
                    <MorphingLoader size={17} color={scheme.primary} />
                    <Text style={styles.statusChipText}>{s.routes.updatingResults}</Text>
                  </View>
                </Animated.View>
              )}
              {(offline || liveStale) && (
                <View style={styles.countRow}>
                  {offline && (
                    <SpringPressable
                      onPress={() => quietRefresh()}
                      scaleDelta={0.03}
                      haptic="selection"
                      style={styles.statusChip}
                      hitSlop={6}
                      accessibilityRole="button"
                      accessibilityLabel={s.routes.offlineTapA11y}
                    >
                      <CloudOff size={15} color={scheme.onSurfaceVariant} />
                      <Text style={styles.statusChipText}>{s.routes.offlineChip}</Text>
                    </SpringPressable>
                  )}
                  {liveStale && !offline && (
                    <View style={styles.statusChip}>
                      <CloudOff size={15} color={scheme.onSurfaceVariant} />
                      <Text style={styles.statusChipText}>{s.routes.noLiveChip}</Text>
                    </View>
                  )}
                </View>
              )}
              {!arrivalMode && !offline && (
                <Animated.View style={Platform.OS !== 'web' ? earlierButtonFadeStyle : undefined}>
                  <SpringPressable
                    onPress={handleButtonEarlier}
                    onFocus={() => setEarlierFocused(true)}
                    onBlur={() => setEarlierFocused(false)}
                    disabled={earlierDisabled}
                    scaleDelta={0.02}
                    haptic="selection"
                    accessibilityRole="button"
                    accessibilityState={{ busy: loadingEarlier, disabled: earlierDisabled }}
                    style={[
                      styles.earlierButton,
                      earlierFocused && styles.earlierFocused,
                      noMoreEarlier && styles.earlierButtonDone,
                    ]}
                  >
                    {loadingEarlier && !pullTriggeredRef.current ? (
                      <MorphingLoader size={16} color={scheme.primary} />
                    ) : !noMoreEarlier ? (
                      <ChevronUp size={17} color={scheme.onSurfaceVariant} />
                    ) : null}
                    <Text style={styles.earlierText} accessibilityLiveRegion="polite">
                      {loadingEarlier && !pullTriggeredRef.current
                        ? s.routes.earlierLoading
                        : noMoreEarlier
                          ? s.routes.earlierEmpty
                          : earlierFailed
                            ? s.routes.earlierRetry
                            : s.routes.earlierAction}
                    </Text>
                  </SpringPressable>
                </Animated.View>
              )}
            </View>
          }
          ListFooterComponent={
            loadingMore || loadMoreFailed || (noMoreLater && items.length > 0) ? (
              <View style={styles.footer}>
                {loadingMore ? (
                  <View style={styles.footerLoadingRow} accessibilityLiveRegion="polite">
                    <MorphingLoader size={20} color={scheme.primary} />
                    <Text style={styles.footerText}>{s.routes.loadingMore}</Text>
                  </View>
                ) : loadMoreFailed ? (
                  <>
                    <Text style={styles.footerText}>{s.routes.moreFail}</Text>
                    <SpringPressable
                      onPress={() => void handleLoadMore()}
                      scaleDelta={0.025}
                      haptic="light"
                      style={styles.retryBtn}
                      accessibilityRole="button"
                      accessibilityLabel={s.routes.moreRetryA11y}
                    >
                      <Text style={styles.retryText}>{s.common.retry}</Text>
                    </SpringPressable>
                  </>
                ) : (
                  <View style={styles.endCapPill}>
                    <Text style={styles.footerText}>
                      {arrivalMode ? s.routes.noMoreArrival : s.routes.noMore}
                    </Text>
                  </View>
                )}
              </View>
            ) : null
          }
          ListEmptyComponent={
            intercityQuery && railDbReady === false ? (
              <IntercityDownloadCard onReady={() => setRailDbReady(true)} />
            ) : (
              <View style={styles.emptyCard}>
                <View style={styles.emptyIconBadge}>
                  <RouteOff size={24} color={scheme.onPrimaryContainer} />
                </View>
                <Text style={styles.emptyTitle}>
                  {liveOnly
                    ? s.routes.emptyLive
                    : hasActiveFilters
                      ? s.routes.emptyFiltered
                      : intercityQuery
                        ? s.intercity.noTrainsTitle
                        : s.routes.emptyNone}
                </Text>
                <Text style={styles.emptySub}>
                  {intercityQuery && !hasActiveFilters
                    ? s.intercity.noTrainsHint
                    : transfersFilter !== 'all' && modeFilter !== 'all'
                      ? s.routes.emptyModeDirect(modeGenitive(modeFilter))
                      : transfersFilter !== 'all'
                        ? s.routes.emptyDirect
                        : modeFilter !== 'all'
                          ? s.routes.emptyMode(modeGenitive(modeFilter))
                          : arrivalMode
                            ? s.routes.emptyArrival
                            : s.routes.emptyPlain}
                </Text>
                <View style={styles.emptyActions}>
                  {transfersFilter !== 'all' && (
                    <SpringPressable
                      onPress={() => setTransfersFilter('all')}
                      scaleDelta={0.025}
                      haptic="selection"
                      style={styles.retryBtn}
                      accessibilityRole="button"
                      accessibilityLabel={s.routes.showWithChangesA11y}
                    >
                      <Text style={styles.retryText}>{s.routes.showWithChanges}</Text>
                    </SpringPressable>
                  )}
                  {modeFilter !== 'all' && (
                    <SpringPressable
                      onPress={() => setModeFilter('all')}
                      scaleDelta={0.025}
                      haptic="selection"
                      style={styles.retryBtn}
                      accessibilityRole="button"
                      accessibilityLabel={s.routes.showAllVehiclesA11y}
                    >
                      <Text style={styles.retryText}>{s.routes.showAllVehicles}</Text>
                    </SpringPressable>
                  )}
                  {liveOnly && (
                    <SpringPressable
                      onPress={() => setLiveOnly(false)}
                      scaleDelta={0.025}
                      haptic="selection"
                      style={styles.retryBtn}
                      accessibilityRole="button"
                      accessibilityLabel={s.routes.showWithoutLive}
                    >
                      <Text style={styles.retryText}>{s.routes.showWithoutLive}</Text>
                    </SpringPressable>
                  )}
                </View>
              </View>
            )
          }
        />
      </Animated.View>
    </View>
  );

  const resultsBodyContent = samePlace ? (
    <ScrollView
      contentContainerStyle={[
        {
          flexGrow: 1,
          paddingHorizontal: listPaddingHorizontal,
          paddingTop: webLayout.isDesktop ? 0 : 12,
          paddingBottom: insets.bottom + 24,
        },
        mediumConstrained && styles.mediumCentered,
      ]}
    >
      <View style={styles.emptyCard}>
        <View style={styles.emptyIconBadge}>
          <MapPin size={24} color={scheme.onPrimaryContainer} />
        </View>
        <Text style={styles.emptyTitle}>{s.routes.samePlaceTitle}</Text>
        <Text style={styles.emptySub}>{s.routes.samePlaceBody}</Text>
      </View>
    </ScrollView>
  ) : loading && displayed.length === 0 ? (
    <ScrollView
      contentContainerStyle={[
        {
          paddingHorizontal: listPaddingHorizontal,
          paddingTop: webLayout.isDesktop ? 0 : 8,
          paddingBottom: insets.bottom + 24,
        },
        mediumConstrained && styles.mediumCentered,
      ]}
      showsVerticalScrollIndicator={false}
    >
      {showInitialLoading && <RouteLoadingView intercity={intercityQuery} />}
    </ScrollView>
  ) : loadError ? (
    <ScrollView
      contentContainerStyle={[
        {
          flexGrow: 1,
          paddingHorizontal: listPaddingHorizontal,
          paddingTop: webLayout.isDesktop ? 0 : 12,
          paddingBottom: insets.bottom + 24,
        },
        mediumConstrained && styles.mediumCentered,
      ]}
    >
      <View style={styles.emptyCard}>
        <View style={[styles.emptyIconBadge, styles.emptyIconBadgeWarn]}>
          <AlertCircle size={24} color={scheme.onWarningContainer} />
        </View>
        <Text style={styles.emptyTitle}>
          {timetableReady ? s.routes.calcFail : s.routes.noTimetable}
        </Text>
        <Text style={styles.emptySub}>
          {timetableReady ? s.routes.calcFailBody : s.routes.noTimetableBody}
        </Text>
        {!timetableReady && (
          <SpringPressable
            onPress={() => void importGtfsFromNetwork()}
            disabled={timetableBusy}
            scaleDelta={0.025}
            haptic="light"
            style={[styles.retryBtn, timetableBusy && styles.retryBtnBusy]}
            accessibilityRole="button"
            accessibilityLabel={s.routes.downloadA11y}
          >
            {timetableBusy ? (
              <Text style={styles.retryText}>
                {dataStatus.state === 'downloading'
                  ? s.routes.downloading(Math.round(dataStatus.progress * 100))
                  : dataStatus.state === 'importing'
                    ? s.routes.downloadingStep(
                        dataStatus.step,
                        Math.round(dataStatus.progress * 100),
                      )
                    : s.routes.downloadingPlain}
              </Text>
            ) : (
              <Text style={styles.retryText}>{s.routes.downloadAction}</Text>
            )}
          </SpringPressable>
        )}
        {timetableReady && (
          <SpringPressable
            onPress={() => fetchRoutes(targetTimeSec)}
            scaleDelta={0.025}
            haptic="light"
            style={styles.retryBtn}
            accessibilityRole="button"
            accessibilityLabel={s.common.retry}
          >
            <Text style={styles.retryText}>{s.common.retry}</Text>
          </SpringPressable>
        )}
      </View>
    </ScrollView>
  ) : Platform.OS === 'web' ? (
    flatListStage
  ) : (
    <GestureDetector gesture={pullPanGesture}>{flatListStage}</GestureDetector>
  );

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      {webLayout.isDesktop ? (
        <View style={styles.desktopSplit}>
          <View style={[styles.desktopLeftCol, { width: webLayout.isWide ? 380 : 340 }]}>
            <View style={styles.desktopTopBar}>{topBarContent}</View>
            {routeHeader}
          </View>
          <View style={styles.desktopRightCol}>{resultsBodyContent}</View>
        </View>
      ) : (
        <>
          <View style={[styles.topBar, mediumConstrained && styles.mediumCentered]}>
            {topBarContent}
          </View>

          <View style={[styles.stickyHeader, mediumConstrained && styles.mediumCentered]}>
            {routeHeader}
            <Animated.View style={[styles.stickyDivider, stickyDividerStyle]} pointerEvents="none" />
          </View>

          {resultsBodyContent}
        </>
      )}

      {filtersOpen && (
        <RouteFilterSheet
          availableModes={availableModes}
          selectedMode={modeFilter}
          transfersFilter={transfersFilter}
          liveOnly={liveOnly}
          resultCount={displayed.length}
          onSelectMode={setModeFilter}
          onSelectTransfers={setTransfersFilter}
          onToggleLiveOnly={() => setLiveOnly((prev) => !prev)}
          onReset={() => {
            setModeFilter('all');
            setTransfersFilter('all');
            setLiveOnly(false);
          }}
          onClose={() => setFiltersOpen(false)}
        />
      )}

      {timeSheetOpen && (
        <DepartureTimeSheet
          initialTimeSec={targetTimeSec}
          initialMode={timeMode}
          onClose={() => setTimeSheetOpen(false)}
          onSelect={handleTimeSelect}
        />
      )}

      {sheetFor && (
        <SearchSheet
          placeholder={
            sheetFor === 'from' ? s.home.searchPlaceholderFrom : s.home.searchPlaceholderTo
          }
          query={query}
          loading={searchLoading}
          error={searchError}
          results={results}
          recent={sheetFor === 'from' ? recentWithGps : recent}
          savedQuick={savedQuick}
          nearbyVehicles={sheetFor === 'from' ? nearbyVehicles : undefined}
          onSelectVehicle={
            sheetFor === 'from'
              ? (v) => {
                  const origin = buildBoardedOriginFromVehicle(v.vehicle, gtfsStore);
                  if (!origin) return;
                  startSelGen.current++;
                  setGpsOrigin(false);
                  setActiveAnchor(null);
                  setBoardedTrip(origin);
                  setFromId(origin.boardStopId ?? '');
                  setFromTitle(s.home.boardedOriginTitle(origin.line, origin.direction || ''));
                  if (origin.currentLat != null && origin.currentLon != null) {
                    setFromLat(origin.currentLat);
                    setFromLon(origin.currentLon);
                  }
                  setItems([]);
                  setLoading(true);
                  setQuery('');
                  setSheetFor(null);
                }
              : undefined
          }
          onOpenLiveMap={
            sheetFor === 'from'
              ? () => {
                  setSheetFor(null);
                  setQuery('');
                  router.push({ pathname: '/live-map', params: { returnTo: 'routes' } });
                }
              : undefined
          }
          onQuery={handleSearchQuery}
          onSelect={handleSuggestionSelect}
          onClose={() => {
            setSheetFor(null);
            setQuery('');
          }}
        />
      )}

      {preview && (
        <ConnectionPeek
          item={preview.item}
          sticky={preview.sticky}
          ready={previewReady}
          offline={offline || liveStale}
          dragY={peekDragY}
          onClose={closePreview}
          onOpen={() => openConnection(preview.item)}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: scheme.surface },
  mediumCentered: {
    width: '100%',
    maxWidth: 740,
    alignSelf: 'center',
  },
  desktopSplit: {
    flex: 1,
    flexDirection: 'row',
    width: '100%',
    maxWidth: 1240,
    alignSelf: 'center',
    paddingHorizontal: 28,
    paddingTop: 20,
    gap: 24,
  },
  desktopLeftCol: {
    flexShrink: 0,
    gap: 12,
  },
  desktopTopBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 4,
  },
  desktopRightCol: {
    flex: 1,
    minWidth: 0,
  },
  listDesktop: {
    paddingHorizontal: 0,
    paddingTop: 4,
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  back: {
    width: 44,
    height: 44,
    borderRadius: shape.full,
    backgroundColor: scheme.surfaceContainer,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: scheme.outlineVariant,
    alignItems: 'center',
    justifyContent: 'center',
  },
  screenTitle: {
    flex: 1,
    fontSize: 17,
    lineHeight: 22,
    fontWeight: '800',
    letterSpacing: -0.2,
    color: scheme.onSurface,
  },
  resultBadge: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: shape.full,
    backgroundColor: scheme.surfaceContainerLow,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: scheme.outlineVariant,
  },
  resultBadgeText: {
    ...type.labelMedium,
    fontWeight: '700',
    color: scheme.onSurfaceVariant,
    fontVariant: ['tabular-nums'],
  },
  topBarSpacer: {
    width: 4,
  },
  stickyHeader: {
    paddingHorizontal: 16,
    backgroundColor: scheme.surface,
  },
  stickyDivider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: scheme.outlineVariant,
    marginHorizontal: -16,
  },
  routeHeader: {
    marginTop: 2,
    marginBottom: 12,
  },
  filterCardsRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 10,
  },
  actionCard: {
    flex: 1,
    minHeight: 46,
    backgroundColor: scheme.surfaceContainer,
    borderRadius: shape.full,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: scheme.outlineVariant,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 14,
    paddingVertical: 10,
    gap: 7,
  },
  actionCardTimeActive: {
    backgroundColor: scheme.primaryContainer,
    borderWidth: 1,
    borderColor: scheme.primary,
  },
  actionCardFilterActive: {
    backgroundColor: scheme.secondaryContainer,
    borderWidth: 1,
    borderColor: scheme.secondary,
  },
  actionCardText: {
    ...type.labelLarge,
    color: scheme.onSurface,
    fontWeight: '600',
    flexShrink: 1,
    fontVariant: ['tabular-nums'],
  },
  actionCardTimeTextActive: {
    color: scheme.onPrimaryContainer,
    fontWeight: '800',
  },
  actionCardFilterTextActive: {
    color: scheme.onSecondaryContainer,
    fontWeight: '800',
  },
  filterCountPill: {
    minWidth: 22,
    height: 22,
    borderRadius: shape.full,
    backgroundColor: scheme.primary,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 6,
  },
  filterCountPillText: {
    ...type.labelSmall,
    color: scheme.onPrimary,
    fontWeight: '800',
    fontVariant: ['tabular-nums'],
  },
  listStage: {
    flex: 1,
    position: 'relative',
    overflow: 'hidden',
  },
  reorderedUpCell: {
    zIndex: 2,
    elevation: 4,
  },
  reorderedDownCell: {
    zIndex: 1,
  },
  list: {
    paddingHorizontal: 16,
    paddingTop: 6,
    gap: 12,
  },
  listHeader: {
    gap: 8,
  },
  countRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  statusChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    minHeight: 40,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: shape.full,
    backgroundColor: scheme.surfaceContainerLow,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: scheme.outlineVariant,
    flexShrink: 1,
  },
  statusChipText: {
    ...type.labelMedium,
    fontWeight: '600',
    color: scheme.onSurfaceVariant,
  },
  earlierButton: {
    alignSelf: 'center',
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: shape.full,
    backgroundColor: scheme.surfaceContainerLow,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: scheme.outlineVariant,
  },
  earlierButtonDone: {
    backgroundColor: 'transparent',
    borderColor: 'transparent',
  },
  earlierFocused: {
    borderColor: scheme.primary,
    borderWidth: 2,
  },
  earlierText: {
    ...type.labelLarge,
    fontWeight: '600',
    color: scheme.onSurfaceVariant,
    flexShrink: 1,
    textAlign: 'center',
  },
  footer: {
    paddingVertical: 18,
    alignItems: 'center',
    gap: 10,
  },
  footerLoadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  endCapPill: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: shape.full,
    backgroundColor: scheme.surfaceContainerLow,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: scheme.outlineVariant,
  },
  footerText: {
    ...type.labelMedium,
    color: scheme.onSurfaceVariant,
    textAlign: 'center',
  },
  emptyCard: {
    marginTop: 8,
    paddingHorizontal: 24,
    paddingVertical: 30,
    backgroundColor: scheme.surfaceContainer,
    borderRadius: shape.extraLarge,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: scheme.outlineVariant,
    alignItems: 'center',
    gap: 10,
    ...elev.level1,
  },
  emptyIconBadge: {
    width: 52,
    height: 52,
    borderRadius: shape.full,
    backgroundColor: scheme.primaryContainer,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  emptyIconBadgeWarn: {
    backgroundColor: scheme.warningContainer,
  },
  emptyTitle: {
    fontSize: 18,
    lineHeight: 24,
    fontWeight: '800',
    letterSpacing: -0.2,
    color: scheme.onSurface,
    textAlign: 'center',
  },
  emptySub: {
    ...type.bodyMedium,
    color: scheme.onSurfaceVariant,
    textAlign: 'center',
    lineHeight: 21,
    maxWidth: 320,
  },
  emptyActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 8,
    marginTop: 6,
  },
  retryBtn: {
    minHeight: 46,
    backgroundColor: scheme.primary,
    borderRadius: shape.full,
    paddingHorizontal: 20,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 4,
  },
  retryBtnBusy: { opacity: 0.7 },
  retryText: {
    ...type.labelLarge,
    fontWeight: '800',
    color: scheme.onPrimary,
  },
});
