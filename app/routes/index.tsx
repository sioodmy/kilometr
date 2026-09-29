import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, Pressable, RefreshControl, StyleSheet, Text, View, InteractionManager, type NativeScrollEvent, type NativeSyntheticEvent } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  Anchor,
  ArrowRight,
  ChevronLeft,
  Clock3,
  Pin,
  Radio,
  Rocket,
  X,
} from 'lucide-react-native';
import Animated, {
  Easing,
  FadeInUp,
  FadeOutUp,
  FlipInEasyX,
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { scheme, shape, type } from '../../src/theme/tokens';
import { DEFAULT_LOCATION } from '../../src/config';
import {
  FavoritesService,
  LocationService,
  RoutingService,
  SearchService,
  findAnchorForLocation,
  recordTripSearch,
  type ActiveAnchor,
} from '../../src/services';
// Mediana czasu dojazdu jest czysta i idzie do nawyku w „Ostatnich miejscach",
// więc siedzi przy rankingu, a nie w ekranie (i ma test w check:smart-rank).
import { typicalDurationMin } from '../../src/services/smartRanking';
import { getSettingsSync, loadSettings } from '../../src/services/settings';
import {
  areNotificationsSupported,
  ensureNotificationPermission,
  isSameQuery,
  permissionDeniedMessage,
  startTracking,
  stopTracking,
  useTrackedTrip,
  type TrackedTrip,
} from '../../src/services/notifications';
import {
  loadConnections,
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
import type { Connection, SavedPlace, Suggestion } from '../../src/types/models';
import { ConnectionCard, connectionsLabel } from '../../src/components/ConnectionCard';
import { DepartureTimeSheet, type TimeMode } from '../../src/components/DepartureTimeSheet';
import {
  RoutesThumbBar,
  type ModePreference,
  type SortMode,
} from '../../src/components/RoutesThumbBar';
import { useThumbBarInset } from '../../src/components/ThumbBar';
import { SearchSheet } from '../../src/components/SearchSheet';
import { useStrings } from '../../src/i18n';

/** Sekundy od północy — jeden zegar dla całego ekranu. */
function nowSeconds(): number {
  const d = new Date();
  return d.getHours() * 3600 + d.getMinutes() * 60 + d.getSeconds();
}

// Stabilna referencja: nowa funkcja na każdym renderze zmuszałaby
// VirtualizedList do przeliczenia komórek od zera przy każdej aktualizacji.
const connectionKey = (item: Connection) => item.id;

export default function RoutesScreen() {
  const s = useStrings();
  const gpsItem: Suggestion = {
    id: '__gps',
    title: s.home.gpsTitle,
    address: s.routes.gpsAddress,
    kind: 'history',
    lat: 0,
    lon: 0,
  };
  const router = useRouter();
  const params = useLocalSearchParams<{
    fromTitle?: string;
    fromLat?: string;
    fromLon?: string;
    toId?: string;
    toTitle: string;
    toLat: string;
    toLon: string;
    directOnly?: string;
    modes?: string;
    /** Dokładnie 'stop' po naciśnięciu „Zakończ” w powiadomieniu. */
    action?: string;
  }>();

  const [fromTitle, setFromTitle] = useState(params.fromTitle || DEFAULT_LOCATION.title);
  const [fromLat, setFromLat] = useState(Number(params.fromLat || DEFAULT_LOCATION.lat));
  const [fromLon, setFromLon] = useState(Number(params.fromLon || DEFAULT_LOCATION.lon));

  const [toTitle, setToTitle] = useState(String(params.toTitle ?? s.routes.destFallback));
  const [toLat, setToLat] = useState(Number(params.toLat ?? 0));
  const [toLon, setToLon] = useState(Number(params.toLon ?? 0));
  const [toId, setToId] = useState(String(params.toId ?? ''));

  // Przycisk „Zakończ” w powiadomieniu to deep link z parametrem action=stop.
  // Ref zamiast stanu, żeby reakcja na deep link nie wchodziła w cykl
  // renderów; zależność od params.action, bo ekspo-router podmienia
  // parametry bez remountu, gdy ekran jest już otwarty.
  const stopFromLinkRef = useRef(params.action === 'stop');
  useEffect(() => {
    if (!stopFromLinkRef.current) return;
    stopFromLinkRef.current = false;
    void stopTracking();
  }, [params.action]);

  const [savedPlaces, setSavedPlaces] = useState<SavedPlace[]>([]);
  const [activeAnchor, setActiveAnchor] = useState<ActiveAnchor | null>(null);
  const dismissedAnchorsRef = useRef<Set<string>>(new Set());
  const fetchSeq = useRef(0);
  const initialAnchorCheckedRef = useRef(false);

  const handleDismissAnchor = () => {
    if (!activeAnchor) return;
    dismissedAnchorsRef.current.add(activeAnchor.placeId);
    // Pozycja już jest prawdziwym GPS (kotwica to tylko preferencja
    // w zapytaniu) — dismiss czyści samą preferencję i odświeża listę.
    setActiveAnchor(null);
  };

  const [items, setItems] = useState<Connection[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [offline, setOffline] = useState(false);
  // Rozkład trzymany na telefonie: bez niego RAPTOR nie ma czym liczyć, więc
  // pusty wynik to nie „brak serwera", tylko brak danych offline.
  const [dataStatus, setDataStatus] = useState<DataStatus>(() => getDataStatus());
  useEffect(() => subscribeDataStatus(setDataStatus), []);
  const timetableBusy =
    dataStatus.state === 'downloading' || dataStatus.state === 'importing';
  const timetableReady = dataStatus.state === 'ready';
  // Brak sieci = brak opóźnień z MPK. Bez komunikatu użytkownik myśli,
  // że planer po prostu nie umie opóźnień.
  const [liveStale, setLiveStale] = useState(false);
  useEffect(() => {
    const check = () => setLiveStale(liveTracker.getLiveState() === 'stale');
    check();
    const t = setInterval(check, 30000);
    return () => clearInterval(t);
  }, []);
  // Odliczanie „za X min” musi tykać, inaczej po kilku minutach lista kłamie
  // (departInMin liczone przy pobraniu). Przerysowujemy wiersze, nie listę.
  const [nowTick, setNowTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setNowTick(Date.now()), 30000);
    return () => clearInterval(t);
  }, []);

  const [loadingMore, setLoadingMore] = useState(false);
  const [loadingEarlier, setLoadingEarlier] = useState(false);
  const [noMoreEarlier, setNoMoreEarlier] = useState(false);
  const [noMoreLater, setNoMoreLater] = useState(false);
  // Doładowanie potrafi paść (baza w trakcie importu, pusty dzień) i wtedy
  // lista po cichu przestawała się dociągać. Bez tego użytkownik scrollował
  // do końca i nie dostawał żadnej odpowiedzi.
  const [loadMoreFailed, setLoadMoreFailed] = useState(false);
  // Sortowanie listy: 'fastest' = najwcześniejsze przybycie (domyślnie,
  // żeby jednym tapnięciem wrócić szybko do domu), 'earliest' = jak w
  // Jakdojade, od najwcześniejszego odjazdu. Magazyn (items) zawsze
  // posortowany po odjeździe — paginacja i hold-to-load na tym bazują.
  const [sortMode, setSortMode] = useState<SortMode>('fastest');
  // Filtry mieszkają w dolnym menu (RoutesThumbBar) — na górze ekranu nie ma
  // ich wcale, żeby nic nie powtarzać się w dwóch miejscach. To wciąż
  // filtry jednorazowe, NIE ustawienia systemowe (maxTransfers w /settings
  // zostaje nietknięte): toggle wymusza maxTransfers=0, a typ pojazdu
  // ogranicza RAPTOR-a do kursów danego rodzaju.
  const [directOnly, setDirectOnly] = useState(params.directOnly === '1');
  const [modeFilter, setModeFilter] = useState<ModePreference>(
    params.modes === 'tram' || params.modes === 'bus' ? params.modes : 'all',
  );

  const displayed = useMemo(() => {
    let list = items;
    if (directOnly) {
      list = list.filter((c) => c.transfers === 0);
    }
    if (sortMode === 'earliest') return list;
    return [...list].sort(
      (a, b) =>
        a.departureSec + a.durationMin * 60 - (b.departureSec + b.durationMin * 60) ||
        a.departureSec - b.departureSec,
    );
  }, [items, sortMode, directOnly]);

  // Dolny dock (RoutesThumbBar) chowa się przy zjeździe w dół i wraca przy
  // powrocie w górę — spring zamiast sztywnego timing, żeby było „fajnie".
  // W przeciwieństwie do starego zwijanego panelu na górze nie ruszamy
  // layoutu FlatListy (zero flickeru): dock pływa nad listą (absolute).
  const dockProgress = useSharedValue(1);
  // Zapas pod listą liczony z zmierzonej wysokości docka — wpisane wcześniej
  // 96 px nie wystarczało i ostatnia karta chowała się pod paskiem.
  const thumbInset = useThumbBarInset();

  const animatedDockStyle = useAnimatedStyle(() => {
    const p = dockProgress.value;
    return {
      opacity: interpolate(p, [0, 1], [0, 1]),
      transform: [
        { translateY: interpolate(p, [0, 1], [110, 0]) },
        { scale: interpolate(p, [0, 1], [0.94, 1]) },
      ],
      // Po schowaniu dock nie łapie dotyków znad listy.
      // (pointerEvents na Animated.View nie jest animowalne — znika sam,
      //  bo opacity 0 + translate poza ekran.)
    };
  });

  // Aktywna podróż: ta sama karta, która zasila powiadomienie i Live Activity.
  const { trip: trackedTrip, progress: trackedProgress } = useTrackedTrip();

  // Toggle sortowania w topBar (iOS-style, z maina): 0 = odjazd
  // (zegar, lewo), 1 = przyjazd (rakieta, prawo). Kciuk dociąga timingiem —
  // spring overshootował i kciuk wyskakiwał poza tor w trakcie animacji.
  const SORT_TRACK_W = 78;
  const SORT_THUMB = 34;
  const SORT_PAD = 4;
  const SORT_TRAVEL = SORT_TRACK_W - SORT_THUMB - SORT_PAD * 2;
  const sortProgress = useSharedValue(sortMode === 'fastest' ? 1 : 0);
  useEffect(() => {
    sortProgress.value = withTiming(sortMode === 'fastest' ? 1 : 0, {
      duration: 190,
      easing: Easing.out(Easing.cubic),
    });
  }, [sortMode, sortProgress]);
  const animatedSortThumb = useAnimatedStyle(() => ({
    transform: [{ translateX: sortProgress.value * SORT_TRAVEL }],
  }));

  const currentQuery = useMemo(
    () => ({
      fromTitle,
      fromLat,
      fromLon,
      toId,
      toTitle,
      toLat,
      toLon,
      anchorStopId: activeAnchor?.stopId,
      anchorStopLat: activeAnchor?.lat,
      anchorStopLon: activeAnchor?.lon,
    }),
    [fromTitle, fromLat, fromLon, toId, toTitle, toLat, toLon, activeAnchor],
  );

  // Czy właśnie śledzimy tę trasę (niezależnie od wybranego kursu).
  const isTrackingThisRoute = trackedTrip != null && isSameQuery(trackedTrip, currentQuery);

  /**
   * Śledzenie konkretnego kursu, a nie całego zapytania. Użytkownik widzi
   * na liście godziny i linie — gdybyśmy śledzili zapytanie, powiadomienie
   * mogłoby w międzyczasie przeskoczyć na inny kurs i kłamać.
   */
  const startTrackingConnection = useCallback(
    async (conn: Connection) => {
      if (!areNotificationsSupported()) {
        Alert.alert(
          'Śledzenie niedostępne',
          'Powiadomienia wymagają builda deweloperskiego — Expo Go ich nie wspiera.',
        );
        return;
      }
      const ok = await ensureNotificationPermission();
      if (!ok) {
        Alert.alert('Powiadomienia wyłączone', permissionDeniedMessage());
        return;
      }
      const track: TrackedTrip = {
        id: conn.id,
        fromTitle,
        fromLat,
        fromLon,
        toId,
        toTitle,
        toLat,
        toLon,
        anchorStopId: activeAnchor?.stopId,
        anchorStopLat: activeAnchor?.lat,
        anchorStopLon: activeAnchor?.lon,
        connection: conn,
        startedAt: Date.now(),
      };
      await startTracking(track);
    },
    [fromTitle, fromLat, fromLon, toId, toTitle, toLat, toLon, activeAnchor],
  );

  /** Przycisk w pasku: śledzimy najbliższe połączenie z listy. */
  const toggleTracking = useCallback(async () => {
    if (isTrackingThisRoute) {
      await stopTracking();
      return;
    }
    const next = displayed[0] ?? items[0];
    if (!next) {
      Alert.alert('Brak połączeń', 'Poczekaj aż pojawi się kurs na tej trasie.');
      return;
    }
    await startTrackingConnection(next);
  }, [isTrackingThisRoute, displayed, items, startTrackingConnection]);

  // Refs pod utrzymanie pozycji scrolla przy dokładaniu z góry
  const listRef = useRef<FlatList<Connection>>(null);
  const scrollY = useRef(0);
  const contentH = useRef(0);
  const pendingAdjust = useRef<number | null>(null);
  // Odliczane „uspokojenie listy” przed zmianą widoczności docka
  const settleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Stan docka oczekujący na koniec pauzy po zmianie (patrz setDockVisible)
  const pendingDockState = useRef<boolean | null>(null);
  const dockCooldownTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (settleTimer.current) clearTimeout(settleTimer.current);
      if (dockCooldownTimer.current) clearTimeout(dockCooldownTimer.current);
    };
  }, []);

  // Stan wyboru godziny/daty: „wyjdź o” (depart) albo „bądź na” (arrive).
  // Nad queryAt, bo zapytanie mapuje czas na właściwy parametr silnika.
  const [timeSheetOpen, setTimeSheetOpen] = useState(false);
  const [departureTimeSec, setDepartureTimeSec] = useState<number | undefined>(undefined);
  const [timeMode, setTimeMode] = useState<TimeMode>('depart');
  const [timeLabel, setTimeLabel] = useState(s.routes.now);

  const queryAt = (depSec: number | undefined, mode: TimeMode = timeMode) => {
    const cfg = getSettingsSync();
    return {
      fromTitle,
      fromLat,
      fromLon,
      toId,
      toTitle,
      toLat,
      toLon,
      // Kotwica to preferencja startowa — pozycja zostaje prawdziwym GPS,
      // silnik liczy realny spacer do kotwicy (ułatwienie, nie sztywna zasada).
      anchorStopId: activeAnchor?.stopId,
      anchorStopLat: activeAnchor?.lat,
      anchorStopLon: activeAnchor?.lon,
      departureTimeSec: mode === 'depart' ? depSec : undefined,
      arriveBySec: mode === 'arrive' ? depSec : undefined,
      // Jednorazowe filtry nadpisują systemowe maxTransfers / typ pojazdów.
      maxTransfers: directOnly ? 0 : cfg.maxTransfers,
      modes: modeFilter,
      minTransferSec: cfg.minTransferSec,
      maxWalkM: cfg.maxWalkM,
      walkSpeedMps: cfg.walkSpeedMps,
    };
  };

  const mergeSorted = (prev: Connection[], batch: Connection[]): { list: Connection[]; added: number } => {
    const existingIds = new Set(prev.map((p) => p.id));
    const fresh = batch.filter((item) => !existingIds.has(item.id));
    const list = [...prev, ...fresh].sort((a, b) => a.departureSec - b.departureSec);
    return { list, added: fresh.length };
  };

  // Wyszukiwarka startu / celu — ta sama co na ekranie głównym
  const [sheetFor, setSheetFor] = useState<'from' | 'to' | null>(null);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Suggestion[]>([]);
  const [recent, setRecent] = useState<Suggestion[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [savedQuick, setSavedQuick] = useState<Suggestion[]>([]);

  useEffect(() => {
    SearchService.recent().then(setRecent);
    Promise.all([FavoritesService.list(), loadSettings()]).then(([places, currentSettings]) => {
      setSavedPlaces(places);
      setSavedQuick(
        places.slice(0, 3).map((p) => ({
          id: p.placeId,
          title: p.name,
          address: p.address,
          kind: 'history' as const,
          lat: p.lat,
          lon: p.lon,
        })),
      );

      if (!initialAnchorCheckedRef.current) {
        initialAnchorCheckedRef.current = true;
        const startLat = Number(params.fromLat || DEFAULT_LOCATION.lat);
        const startLon = Number(params.fromLon || DEFAULT_LOCATION.lon);
        const startTitle = params.fromTitle || DEFAULT_LOCATION.title;
        const anchor = findAnchorForLocation(
          startLat,
          startLon,
          startTitle,
          places,
          currentSettings.anchorRadiusM,
          dismissedAnchorsRef.current
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
    });
  }, []);

  // Debounced search (jak na głównym), bias wg aktualnego startu
  const searchSeq = useRef(0);
  useEffect(() => {
    if (!sheetFor) return;
    const q = query.trim();
    const seq = ++searchSeq.current;
    if (!q) {
      setResults([]);
      setSearchLoading(false);
      return;
    }
    setSearchLoading(true);
    const t = setTimeout(() => {
      SearchService.search(q, { lat: fromLat, lon: fromLon }, 'routes-start')
        .then((r) => {
          if (seq !== searchSeq.current) return;
          setResults(r);
          setSearchLoading(false);
        })
        .catch(() => {
          if (seq === searchSeq.current) setSearchLoading(false);
        });
    }, 220);
    return () => clearTimeout(t);
  }, [query, sheetFor, fromLat, fromLon]);

  const recentWithGps = useMemo(
    () => (sheetFor === 'from' ? [gpsItem, ...recent] : recent),
    [sheetFor, recent, gpsItem],
  );

  const handleSuggestionSelect = async (sug: Suggestion) => {
    setQuery('');
    setSheetFor(null);
    if (sug.id === gpsItem.id) {
      // Start = aktualna pozycja GPS (nie zapisana wcześniej)
      try {
        const l = await LocationService.getCurrentLocation();
        const currentSettings = getSettingsSync();
        dismissedAnchorsRef.current.clear();
        const anchor = findAnchorForLocation(
          l.lat,
          l.lon,
          l.title,
          savedPlaces,
          currentSettings.anchorRadiusM,
          dismissedAnchorsRef.current
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
        console.warn('[handleSuggestionSelect] GPS error:', err);
        Alert.alert(
          s.routes.gpsFailTitle,
          s.routes.gpsFailBody
        );
      }
      return;
    }

    void SearchService.recordRecent(sug).then(() => {
      SearchService.recent().then(setRecent);
    });

    if (sheetFor === 'from') {
      setActiveAnchor(null);
      setFromTitle(sug.title);
      setFromLat(sug.lat);
      setFromLon(sug.lon);
    } else {
      setToId(sug.id);
      setToTitle(sug.title);
      setToLat(sug.lat);
      setToLon(sug.lon);
    }
  };

  const applyLiveList = (c: Connection[], depSec: number | undefined) => {
    // Default: tylko aktualne i przyszłe — bez historycznych.
    // Przeszłe dociąga użytkownik gestem (scroll w górę + przytrzymanie).
    // Przy jawnie wybranej godzinie (np. z przeszłości) pokazuj wszystko jak jest.
    let list = [...c].sort((a, b) => a.departureSec - b.departureSec);
    if (depSec === undefined) {
      const d = new Date();
      const nowS = d.getHours() * 3600 + d.getMinutes() * 60 + d.getSeconds();
      list = list.filter((item) => item.departureSec <= 0 || item.departureSec >= nowS - 60);
    }
    return list;
  };

  // Brak rozkładu = brak danych, a nie „nie znaleziono połączeń”. Silnik na
  // pustym sklepie zwraca pustkę BEZ błędu, więc sprawdzamy status w dwóch
  // miejscach: przed zapytaniem (żeby nie liczyć na nic) i po nim (żeby
  // wyłapać import, który ruszył w trakcie zapytania).
  const noTimetable = () => getDataStatus().state !== 'ready';

  const fetchRoutes = async (targetDepSec?: number, seamless = false, mode: TimeMode = timeMode) => {
    const seq = ++fetchSeq.current;
    if (!seamless) {
      setLoading(true);
    }
    setLoadError(false);
    setOffline(false);
    setNoMoreEarlier(false);
    setNoMoreLater(false);
    setLoadMoreFailed(false);
    const depSec = targetDepSec !== undefined ? targetDepSec : departureTimeSec;
    try {
      // Wcześniej niż dotąd: pusty sklep dawał „zero połączeń", a ekran
      // pokazywał to jako wynik wyszukiwania.
      if (noTimetable()) {
        setItems([]);
        setLoadError(true);
        return;
      }
      const q = queryAt(depSec, mode);
      // Progresywne ładowanie "po kolei": pierwsze okno RAPTOR-a wpada szybko,
      // podmieniamy listę i gasimy pełny spinner od razu — reszta dociąga się
      // w tle bez migotania (stabilne klucze FlatList).
      const c = await RoutingService.getConnections(q, (partial) => {
        if (seq !== fetchSeq.current) return;
        const live = applyLiveList(partial, depSec);
        if (live.length === 0) return;
        setItems(live);
        setLoading(false);
      });
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
      void recordTripSearch(q.fromLat, q.fromLon, q.fromTitle, {
        id: q.toId || q.toTitle,
        title: q.toTitle,
        lat: q.toLat,
        lon: q.toLon,
      }, typicalDurationMin(c));
    } catch {
      if (seq !== fetchSeq.current) return;
      // Offline: ostatnie prawdziwe dane z cache (z przeliczonymi czasami).
      // W trybie seamless nie czyścimy listy ani nie migoczemy spinnerem.
      const cached = await loadConnections(queryAt(depSec, mode));
      if (seq !== fetchSeq.current) return;
      if (cached) {
        setItems(applyLiveList(rehydrateConnections(cached), depSec));
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
   * Cichy refresh BEZ spinnera i BEZ czyszczenia listy — podmiana jest
   * niewidoczna, gdy dane te same (stabilne klucze FlatList = brak flickeru).
   * Używany przy powrocie sieci i zmianie czasu w trybie offline.
   */
  const quietRefresh = async (targetDepSec?: number) => {
    const seq = ++fetchSeq.current;
    const depSec = targetDepSec !== undefined ? targetDepSec : departureTimeSec;
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

  // Heartbeat offline: co 15 s sprawdzamy powrót sieci i cicho podmieniamy
  // cache na świeże dane. Bez spinnerów i skoków scrolla.
  const offlineRef = useRef(offline);
  offlineRef.current = offline;
  useEffect(() => {
    if (!offline) return;
    let cancelled = false;
    const beat = async () => {
      if (cancelled || !offlineRef.current) return;
      if (await hasLocalTimetable()) {
        if (cancelled) return;
        await quietRefresh();
      }
    };
    const timer = setInterval(beat, 15000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [offline]);

  const handleLoadMore = async () => {
    if (loading || loadingMore || loadingEarlier || items.length === 0 || noMoreLater || offline) return;

    setLoadingMore(true);
    setLoadMoreFailed(false);
    const lastDeparture = items[items.length - 1].departureSec;
    const nextDeparture = lastDeparture + 60;
    const seq = ++fetchSeq.current;

    try {
      // Paginacja zawsze kotwiczy się do czasów ODJAZDÓW z krawędzi listy —
      // nawet w trybie przyjazdu (tam arriveBySec dotyczył tylko startu).
      const c = await RoutingService.getConnections(queryAt(nextDeparture, 'depart'));
      if (seq !== fetchSeq.current) return;
      setItems((prev) => {
        const { list, added } = mergeSorted(prev, c);
        if (added === 0) setNoMoreLater(true);
        return list;
      });
    } catch (err) {
      console.warn('[Routes] load more failed:', err);
      if (seq === fetchSeq.current) setLoadMoreFailed(true);
    } finally {
      if (seq === fetchSeq.current) {
        setLoadingMore(false);
      }
    }
  };

  // Starsze (historyczne, już odjechane) — dokładane Z GÓRY
  const handleLoadEarlier = async () => {
    if (loading || loadingMore || loadingEarlier || items.length === 0 || noMoreEarlier || offline) return;
    const firstDeparture = items[0].departureSec;
    if (!firstDeparture || firstDeparture <= 0) return;

    setLoadingEarlier(true);
    const seq = ++fetchSeq.current;

    try {
      // Jak wyżej: historia dokładana od czasu odjazdu, nie przyjazdu.
      const c = await RoutingService.getConnections(queryAt(firstDeparture - 1800, 'depart'));
      if (seq !== fetchSeq.current) return;
      setItems((prev) => {
        const { list, added } = mergeSorted(prev, c);
        if (added === 0) {
          setNoMoreEarlier(true);
          return list;
        }
        // Bazę do korekty scrolla bierzemy dopiero TU — czyli jeszcze przed
        // renderem, w którym dojdą nowe wiersze. Pomiar na starcie
        // zapytania bywał nieaktualny (np. rozciągał się nagłówek), przez co
        // lista skakała dwa razy zamiast raz.
        pendingAdjust.current = contentH.current;
        return list;
      });
    } catch {
      // po cichu — lista zostaje
    } finally {
      if (seq === fetchSeq.current) {
        setLoadingEarlier(false);
      }
    }
  };

  // Ref na aktualną funkcję: handler scrolla ma być stabilny (patrz useCallback
  // niżej), a nie przeżywać przez ref każdego renderu.
  const loadEarlierRef = useRef(handleLoadEarlier);
  loadEarlierRef.current = handleLoadEarlier;

  const lastScrollY = useRef(0);
  const isDockVisible = useRef(true);
  const accumulatedDelta = useRef(0);
  const momentumActive = useRef(false);
  const lastDockToggleAt = useRef(0);

  // Próg jest wysoki, bo dock reaguje dopiero na ustabilizowanym
  // scrollu (patrz handleScrollEndDrag / handleMomentumScrollEnd) — 80 px
  // to jedno świadome przejście, a nie drgnięcie palcem.
  const HIDE_THRESHOLD = 80;
  const SHOW_THRESHOLD = 40;
  // Pauza po zmianie stanu: dwa przeciwstawne gesty w krótkim czasie
  // nie mogą się zbić w serię szarpnięć docka.
  const DOCK_COOLDOWN_MS = 450;
  // Ile czekamy po puszczeniu palca na sprawdzenie, czy zaczęło się
  // „rzucanie” listy (momentum). Jeśli tak, decyzja zapada po nim.
  const SCROLL_SETTLE_MS = 120;

  // Szybki, prawie krytycznie tłumiony spring: bez podskoku, ~200 ms.
  const SPRING_SNAPPY = { damping: 55, stiffness: 550 } as const;

  // Jedno miejsce do zmiany stanu docka. Przeskok stanu jest możliwy tylko
  // raz na DOCK_COOLDOWN_MS — szarpnięcia się nie zbiją w serię, a gest
  // nie ginie: jeśli pauza trwa, oczekujący stan zostaje dopalony tuż po
  // niej (pendingDockState). `force` omija pauzę — przy powrocie na samą
  // górę listy dock musi być od razu.
  const applyDockState = (visible: boolean) => {
    if (isDockVisible.current === visible) return;
    isDockVisible.current = visible;
    lastDockToggleAt.current = Date.now();
    pendingDockState.current = null;
    if (dockCooldownTimer.current) {
      clearTimeout(dockCooldownTimer.current);
      dockCooldownTimer.current = null;
    }
    dockProgress.value = withSpring(visible ? 1 : 0, SPRING_SNAPPY);
  };

  const setDockVisible = (visible: boolean, force = false) => {
    if (isDockVisible.current === visible) return;
    const wait = DOCK_COOLDOWN_MS - (Date.now() - lastDockToggleAt.current);
    if (!force && wait > 0) {
      pendingDockState.current = visible;
      if (dockCooldownTimer.current) clearTimeout(dockCooldownTimer.current);
      dockCooldownTimer.current = setTimeout(() => {
        dockCooldownTimer.current = null;
        const next = pendingDockState.current;
        if (next != null) applyDockState(next);
      }, wait);
      return;
    }
    applyDockState(visible);
  };

  // Decyzja o docku zapada, gdy lista przestała się ruszać. W trakcie
  // przeciągania dock tylko liczy deltę — animacja leci na wątku UI
  // (Reanimated), więc nie blokuje gestu ani nie przelicza layoutu listy.
  const evaluateDockOnSettle = () => {
    if (accumulatedDelta.current >= HIDE_THRESHOLD) {
      setDockVisible(false);
    } else if (accumulatedDelta.current <= -SHOW_THRESHOLD) {
      setDockVisible(true);
    }
  };

  const handleScrollEndDrag = () => {
    momentumActive.current = false;
    if (settleTimer.current) clearTimeout(settleTimer.current);
    settleTimer.current = setTimeout(() => {
      settleTimer.current = null;
      if (!momentumActive.current) evaluateDockOnSettle();
    }, SCROLL_SETTLE_MS);
  };

  const handleMomentumScrollBegin = () => {
    momentumActive.current = true;
    if (settleTimer.current) {
      clearTimeout(settleTimer.current);
      settleTimer.current = null;
    }
  };

  const handleMomentumScrollEnd = () => {
    momentumActive.current = false;
    evaluateDockOnSettle();
  };

  // Handler scrolla pilnuje pozycji (korekta po dociągnięciu starszych
  // odjazdów z góry) i kierunku do chowania docka. Historyczne odjazdy
  // dociąga JUŻ TYLKO gest pull-to-load znad listy (RefreshControl niżej) —
  // automatyczne dokładanie po samym dotknięciu góry było za łatwe.
  const handleScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const y = e.nativeEvent.contentOffset.y;
    const dy = y - lastScrollY.current;
    lastScrollY.current = y;
    scrollY.current = y;

    // 1. Na samej górze listy (y <= 12) — dock wraca od razu, bez
    //    czekania na puszczenie palca: tam scroll i tak się kończy.
    if (y <= 12) {
      accumulatedDelta.current = 0;
      setDockVisible(true, true);
    } else if (dy > 0) {
      // Scrollowanie W DÓŁ
      if (accumulatedDelta.current < 0) {
        accumulatedDelta.current = 0;
      }
      accumulatedDelta.current += dy;
    } else if (dy < 0) {
      // Scrollowanie W GÓRĘ
      if (accumulatedDelta.current > 0) {
        accumulatedDelta.current = 0;
      }
      accumulatedDelta.current += dy;
    }
  };

  const handleContentSizeChange = (_w: number, h: number) => {
    const prevH = contentH.current;
    contentH.current = h;
    if (pendingAdjust.current != null) {
      const delta = h - pendingAdjust.current;
      pendingAdjust.current = null;
      if (delta > 0) {
        listRef.current?.scrollToOffset({
          offset: Math.max(0, scrollY.current + delta),
          animated: false,
        });
      }
    }
  };

  useEffect(() => {
    // Wait for the screen transition animation to finish before blocking JS thread with fetch
    const task = InteractionManager.runAfterInteractions(() => {
      fetchRoutes(departureTimeSec, items.length > 0);
    });
    return () => task.cancel();
    // timetableReady jest tu celowo: ekran otwarty w trakcie pierwszego
    // importu dostawał pustą listę i nigdy sam się nie odpytywał, więc
    // połączenia zostawały niewidoczne mimo gotowego rozkładu.
  }, [fromLat, fromLon, toLat, toLon, fromTitle, toTitle, activeAnchor, directOnly, modeFilter, timetableReady]);

  // Pull znad listy NIE odświeża — dociąga historyczne (już odjechane)
  // połączenia. To JEDYNY sposób na ich wczytanie; odświeżanie listy robią
  // filtry, czas i powrót na ekran (fetchRoutes w efektach).
  const handlePullEarlier = () => {
    void loadEarlierRef.current();
  };

  const handleCycleMode = () => {
    if (modeFilter === 'all') setModeFilter('tram');
    else if (modeFilter === 'tram') setModeFilter('bus');
    else setModeFilter('all');
  };

  const handleCycleSort = () => {
    setSortMode((prev) => (prev === 'fastest' ? 'earliest' : 'fastest'));
  };

  // Znacznik odwrócenia trasy: wiersze zamontowane tuż po swapie wjeżdżają
  // pionowym flipem karty (FlipInEasyX) zamiast zwykłego fade-up. Ref, nie stan —
  // nie wymusza dodatkowego rendera, odczyt w renderItem wystarczy.
  const swapAtRef = useRef(0);

  // Strzałka w nagłówku: pełny obrót 360° + minimalny pop (skala).
  // Licznik rośnie o 1 na swap — obrót zawsze do przodu, bez resetowania.
  const arrowSpin = useSharedValue(0);
  const animatedArrowStyle = useAnimatedStyle(() => {
    const p = arrowSpin.value % 1;
    return {
      transform: [
        { rotate: `${p * 360}deg` },
        { scale: 1 + 0.28 * Math.sin(Math.PI * p) },
      ],
    };
  });

  const handleSwap = () => {
    swapAtRef.current = Date.now();
    arrowSpin.value = withTiming(Math.round(arrowSpin.value) + 1, {
      duration: 450,
      easing: Easing.inOut(Easing.ease),
    });
    // Wyniki po swapie to zupełnie nowa lista — wracamy na górę.
    listRef.current?.scrollToOffset({ offset: 0, animated: false });
    setActiveAnchor(null);
    const tempTitle = fromTitle;
    const tempLat = fromLat;
    const tempLon = fromLon;

    setFromTitle(toTitle);
    setFromLat(toLat);
    setFromLon(toLon);

    setToId('');
    setToTitle(tempTitle);
    setToLat(tempLat);
    setToLon(tempLon);
  };

  const handleTimeSelect = (result: { timeSec: number | undefined; label: string; mode: TimeMode }) => {
    setDepartureTimeSec(result.timeSec);
    setTimeMode(result.mode);
    setTimeLabel(result.label);
    // Zmiana godziny przeładowuje praktycznie całą listę — pokazujemy pełny
    // spinner zamiast cichej podmiany (seamless tylko dokładałby wiersze).
    fetchRoutes(result.timeSec, false, result.mode);
  };

  const isCustomTime = departureTimeSec !== undefined;

  // Stabilne referencje dla FlatList: bez nich każdy render rodzica tworzył
  // nowe closures, przez co wiersze (pamiętane przez React.memo) przeliczały
  // się od nowa i lista „przybliżała” zamiast płynnie się toczyć.
  // Karty wskakują kaskadą (stagger po indeksie, max ~440 ms), żeby progresywne
  // dokładanie wyglądało płynnie; tuż po swapie — flipem karty.
  // UWAGA: świeża instancja buildera na wiersz — .delay() mutuje współdzielony
  // obiekt, więc współdzielenie jednego FlipInEasyX/FadeInUp rozwaliłoby delaya.
  const openConnection = useCallback(
    (item: Connection) => {
      router.push({ pathname: '/routes/[id]', params: { id: item.id } });
    },
    [router],
  );

  const renderConnection = useCallback(
    ({ item, index }: { item: Connection; index: number }) => {
      const past = item.departureSec > 0 && item.departureSec < nowSeconds() - 60;
      const stagger = Math.min(index * 55, 440);
      const freshSwap = Date.now() - swapAtRef.current < 2500;
      const isTracked = isTrackingThisRoute && trackedTrip?.connection.id === item.id;
      return (
        <Animated.View
          entering={
            freshSwap
              ? new FlipInEasyX().duration(320).delay(stagger)
              : new FadeInUp().duration(280).delay(stagger)
          }
        >
          <ConnectionCard item={item} dimmed={past} onPress={openConnection} />
          {/* Śledzimy konkretny kurs, nie całe zapytanie. */}
          {!past && isTracked ? (
            <View style={styles.trackActive}>
              <Radio size={13} color={scheme.primary} />
              <Text style={styles.trackActiveText}>Śledzone</Text>
            </View>
          ) : !past ? (
            <Pressable
              onPress={() => void startTrackingConnection(item)}
              accessibilityRole="button"
              accessibilityLabel={`Śledź połączenie o ${item.departAt}`}
              style={({ pressed }) => [styles.trackBtn, pressed && { opacity: 0.7 }]}
              hitSlop={6}
            >
              <Radio size={13} color={scheme.onSurfaceVariant} />
              <Text style={styles.trackBtnText}>Śledź ten kurs</Text>
            </Pressable>
          ) : null}
        </Animated.View>
      );
    },
    [openConnection, isTrackingThisRoute, trackedTrip?.connection.id, startTrackingConnection],
  );

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      {/* 1. Górny pasek: Wstecz, tytuł, toggle sortowania i przypięcie.
          Czas odjazdu, filtry i zamiana trasy żyją w dolnym menu pod kciukiem. */}
      <View style={styles.topBar}>
        <Pressable onPress={() => router.back()} style={styles.back} hitSlop={10}>
          <ChevronLeft size={23} color={scheme.onSurface} />
        </Pressable>

        <Text style={styles.screenTitle} numberOfLines={1}>
          {s.routes.title}
        </Text>

        {/* Sortowanie z paska (z main): 0 = odjazd, 1 = przyjazd. */}
        <View style={styles.sortWrap}>
          <Pressable
            onPress={handleCycleSort}
            accessibilityRole="switch"
            accessibilityState={{ checked: sortMode === 'fastest' }}
            accessibilityLabel={
              sortMode === 'fastest'
                ? s.routes.sortFastestA11y
                : s.routes.sortEarliestA11y
            }
            style={({ pressed }) => [
              styles.sortToggle,
              pressed && { opacity: 0.85 },
            ]}
            hitSlop={8}
          >
            <Animated.View style={[styles.sortThumb, animatedSortThumb]} />
            <View style={styles.sortIcons} pointerEvents="none">
              <Clock3
                size={15}
                color={sortMode === 'earliest' ? scheme.onSecondaryContainer : scheme.onSurfaceVariant}
              />
              <Rocket
                size={15}
                color={sortMode === 'fastest' ? scheme.onSecondaryContainer : scheme.onSurfaceVariant}
              />
            </View>
          </Pressable>
          <Text style={styles.sortLabel} numberOfLines={1}>
            {sortMode === 'fastest' ? s.routes.sortFastest : s.routes.sortEarliest}
          </Text>
        </View>

        {/* Śledzenie podróży w slocie pinezki (którą ten PR zastępuje): ten sam
            przycisk-pasek 1:1 ze strzałką wstecz i sortowaniem, tylko robi
            coś innego. Opis zostaje w accessibilityLabel, bo nagłówek ma
            już etykiety sąsiadów. */}
        <Pressable
          onPress={toggleTracking}
          accessibilityRole="button"
          accessibilityState={{ selected: isTrackingThisRoute }}
          accessibilityLabel={
            isTrackingThisRoute
              ? 'Zatrzymaj śledzenie podróży'
              : 'Śledź najbliższe połączenie'
          }
          style={({ pressed }) => [
            styles.pinBtn,
            isTrackingThisRoute && styles.pinBtnActive,
            pressed && { opacity: 0.7 },
          ]}
          hitSlop={8}
        >
          {isTrackingThisRoute ? (
            <Radio size={19} color={scheme.onPrimaryContainer} />
          ) : (
            <Pin
              size={19}
              color={scheme.onSurface}
              fill="transparent"
            />
          )}
        </Pressable>
      </View>

      {/* 2. Nagłówek trasy w stylu One UI: bez tła, jedna linia
          „Start → Cel". Strzałka to swap, boki otwierają wyszukiwarkę. */}
      <View style={styles.routeHeader}>
        <Pressable
          onPress={() => setSheetFor('from')}
          accessibilityRole="button"
          accessibilityLabel={
            activeAnchor
              ? s.routes.changeFromAnchorA11y(fromTitle, activeAnchor.stopName)
              : s.routes.changeFromA11y(fromTitle)
          }
          style={({ pressed }) => [styles.routeSide, pressed && { opacity: 0.6 }]}
          hitSlop={6}
        >
          {/* Tytuł startu zawsze ten sam co cel (ta sama rolka FadeInUp) —
              kotwica to już tylko cicha dopiska pod spodem, nie osobny
              pigułkowy świat. Cały slot dalej otwiera wyszukiwarkę startu. */}
          <Animated.View
            key={`from-${fromTitle}`}
            entering={new FadeInUp().duration(240)}
            exiting={new FadeOutUp().duration(200)}
            style={styles.routeSlide}
          >
            <Text style={styles.routeText} numberOfLines={1}>
              {fromTitle}
            </Text>
          </Animated.View>
          {activeAnchor && (
            <Animated.View
              key={`anchor-${activeAnchor.stopId ?? activeAnchor.stopName}`}
              entering={new FadeInUp().duration(240)}
              exiting={new FadeOutUp().duration(200)}
              style={styles.anchorSub}
            >
              <Anchor size={12} color={scheme.primary} />
              <Text style={styles.anchorSubText} numberOfLines={1}>
                {activeAnchor.stopName}
                <Text style={styles.anchorSubPlace}> · {activeAnchor.placeName}</Text>
              </Text>
              <Pressable
                onPress={(e) => {
                  e.stopPropagation();
                  handleDismissAnchor();
                }}
                hitSlop={10}
                style={({ pressed }) => [
                  styles.anchorX,
                  pressed && { opacity: 0.6, transform: [{ scale: 0.88 }] },
                ]}
                accessibilityRole="button"
                accessibilityLabel={s.routes.dismissAnchorA11y}
              >
                <X size={12} color={scheme.onSurfaceVariant} strokeWidth={2.5} />
              </Pressable>
            </Animated.View>
          )}
        </Pressable>

        <Pressable
          onPress={handleSwap}
          accessibilityRole="button"
          accessibilityLabel={s.routes.swapA11y}
          style={({ pressed }) => [
            styles.routeArrowBtn,
            pressed && { opacity: 0.6, transform: [{ scale: 0.9 }] },
          ]}
          hitSlop={10}
        >
          <Animated.View style={animatedArrowStyle}>
            <ArrowRight size={21} color={scheme.primary} strokeWidth={2.5} />
          </Animated.View>
        </Pressable>

        <Pressable
          onPress={() => setSheetFor('to')}
          accessibilityRole="button"
          accessibilityLabel={s.routes.changeToA11y(toTitle)}
          style={({ pressed }) => [styles.routeSideGrow, pressed && { opacity: 0.6 }]}
          hitSlop={6}
        >
          <Animated.View
            key={`to-${toTitle}`}
            entering={new FadeInUp().duration(240)}
            exiting={new FadeOutUp().duration(200)}
            style={styles.routeSlide}
          >
            <Text style={styles.routeTextStrong} numberOfLines={1}>
              {toTitle}
            </Text>
          </Animated.View>
        </Pressable>
      </View>

      {/* 3. Lista połączeń */}
      {loading ? (
        <View style={styles.loading}>
          <ActivityIndicator size="large" color={scheme.primary} />
          <Text style={styles.loadingText}>{s.routes.searching}</Text>
        </View>
      ) : loadError ? (
        <View style={styles.emptyContainer}>
          <Text style={styles.emptyTitle}>
            {timetableReady ? s.routes.calcFail : s.routes.noTimetable}
          </Text>
          <Text style={styles.emptySub}>
            {timetableReady
              ? s.routes.calcFailBody
              : s.routes.noTimetableBody}
          </Text>
          {!timetableReady && (
            <Pressable
              onPress={() => void importGtfsFromNetwork()}
              disabled={timetableBusy}
              style={({ pressed }) => [
                styles.retryBtn,
                timetableBusy && styles.retryBtnBusy,
                pressed && !timetableBusy && { opacity: 0.8 },
              ]}
              accessibilityRole="button"
              accessibilityLabel={s.routes.downloadA11y}
            >
              {timetableBusy ? (
                <Text style={styles.retryText}>
                  {dataStatus.state === 'downloading'
                    ? s.routes.downloading(Math.round(dataStatus.progress * 100))
                    : dataStatus.state === 'importing'
                      ? s.routes.downloadingStep(dataStatus.step, Math.round(dataStatus.progress * 100))
                      : s.routes.downloadingPlain}
                </Text>
              ) : (
                <Text style={styles.retryText}>{s.routes.downloadAction}</Text>
              )}
            </Pressable>
          )}
          {timetableReady && (
            <Pressable
              onPress={() => fetchRoutes(departureTimeSec)}
              style={({ pressed }) => [styles.retryBtn, pressed && { opacity: 0.8 }]}
            >
              <Text style={styles.retryText}>{s.common.retry}</Text>
            </Pressable>
          )}
        </View>
      ) : (
        <FlatList
          ref={listRef}
          refreshControl={
            <RefreshControl
              refreshing={loadingEarlier}
              onRefresh={handlePullEarlier}
              tintColor={scheme.primary}
              colors={[scheme.primary]}
              progressBackgroundColor={scheme.surfaceContainerHigh}
            />
          }
          data={displayed}
          // wymusza przeliczenie etykiet „za X min” bez refetchu
          extraData={nowTick}
          keyExtractor={connectionKey}
          contentContainerStyle={[styles.list, { paddingBottom: thumbInset }]}
          showsVerticalScrollIndicator={false}
          overScrollMode="never"
          // Na Androidzie RN domyślnie odpija widoki spoza kadru
          // (removeClippedSubviews). Przy kartach z cieniem i zwijanym
          // nagłówkiem powoduje to miganie pustych miejsc w trakcie
          // przeciągania palcem, więc trzymamy komórki podpięte.
          removeClippedSubviews={false}
          onEndReached={handleLoadMore}
          onEndReachedThreshold={0.5}
          onScroll={handleScroll}
          scrollEventThrottle={16}
          onScrollEndDrag={handleScrollEndDrag}
          onMomentumScrollBegin={handleMomentumScrollBegin}
          onMomentumScrollEnd={handleMomentumScrollEnd}
          onContentSizeChange={handleContentSizeChange}
          renderItem={renderConnection}
          ListHeaderComponent={
            <View style={styles.countRow}>
              <Text style={styles.count} numberOfLines={1}>
                {connectionsLabel(items.length)} • {isCustomTime ? (timeMode === 'arrive' ? s.routes.countArrive(timeLabel) : s.routes.countDepart(timeLabel)) : s.routes.countNearest}
                {directOnly ? s.routes.countDirect : ''}
                {modeFilter === 'tram' ? s.routes.countTram : modeFilter === 'bus' ? s.routes.countBus : ''}
                {loadingEarlier ? s.routes.countEarlier : ''}
              </Text>
              {offline && (
                <Pressable
                  onPress={() => quietRefresh()}
                  style={({ pressed }) => [styles.offlineChip, pressed && { opacity: 0.7 }]}
                  hitSlop={6}
                  accessibilityRole="button"
                  accessibilityLabel={s.routes.offlineTapA11y}
                >
                  <View style={styles.offlineDot} />
                  <Text style={styles.offlineText}>{s.routes.offlineChip}</Text>
                </Pressable>
              )}
              {liveStale && !offline && (
                <View style={styles.offlineChip}>
                  <View style={styles.offlineDot} />
                  <Text style={styles.offlineText}>{s.routes.noLiveChip}</Text>
                </View>
              )}
            </View>
          }
          // Stopka mówi wprost, co się dzieje na końcu listy: trwa doładowanie,
          // nic więcej nie ma albo doładowanie padło. Wcześniej jedyne co było
          // widać, to spinner, a po błędzie — nic, czyli lista po cichu
          // przestawała się dociągać.
          // Stopka niczego nie dokłada, dopóki nie ma czego powiedzieć —
          // inaczej każda lista dostałaby 36 px pustego miejsca na dole.
          ListFooterComponent={
            loadingMore || loadMoreFailed || (noMoreLater && items.length > 0) ? (
              <View style={styles.footer}>
                {loadingMore ? (
                  <ActivityIndicator size="small" color={scheme.primary} />
                ) : loadMoreFailed ? (
                  <>
                    <Text style={styles.footerText}>
                      {s.routes.moreFail}
                    </Text>
                    <Pressable
                      onPress={() => void handleLoadMore()}
                      style={({ pressed }) => [styles.retryBtn, pressed && { opacity: 0.8 }]}
                      accessibilityRole="button"
                      accessibilityLabel={s.routes.moreRetryA11y}
                    >
                      <Text style={styles.retryText}>{s.common.retry}</Text>
                    </Pressable>
                  </>
                ) : (
                  <Text style={styles.footerText}>{s.routes.noMore}</Text>
                )}
              </View>
            ) : null
          }
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              <Text style={styles.emptyTitle}>
                {directOnly || modeFilter !== 'all'
                  ? s.routes.emptyFiltered
                  : s.routes.emptyNone}
              </Text>
              <Text style={styles.emptySub}>
                {directOnly && modeFilter !== 'all'
                  ? s.routes.emptyModeDirect(modeFilter === 'tram' ? s.routes.vehicleTramGen : s.routes.vehicleBusGen)
                  : directOnly
                    ? s.routes.emptyDirect
                    : modeFilter !== 'all'
                      ? s.routes.emptyMode(modeFilter === 'tram' ? s.routes.vehicleTramGen : s.routes.vehicleBusGen)
                      : s.routes.emptyPlain}
              </Text>
              {directOnly && (
                <Pressable
                  onPress={() => setDirectOnly(false)}
                  style={({ pressed }) => [styles.retryBtn, pressed && { opacity: 0.8 }]}
                  accessibilityRole="button"
                  accessibilityLabel={s.routes.showWithChangesA11y}
                >
                  <Text style={styles.retryText}>{s.routes.showWithChanges}</Text>
                </Pressable>
              )}
              {modeFilter !== 'all' && (
                <Pressable
                  onPress={() => setModeFilter('all')}
                  style={({ pressed }) => [styles.retryBtn, pressed && { opacity: 0.8 }]}
                  accessibilityRole="button"
                  accessibilityLabel={s.routes.showAllVehiclesA11y}
                >
                  <Text style={styles.retryText}>{s.routes.showAllVehicles}</Text>
                </Pressable>
              )}
            </View>
          }
        />
      )}

      {/* 4. Bottom sheet wyboru daty i godziny */}
      {timeSheetOpen && (
        <DepartureTimeSheet
          initialTimeSec={departureTimeSec}
          initialLabel={timeLabel}
          initialMode={timeMode}
          onClose={() => setTimeSheetOpen(false)}
          onSelect={handleTimeSelect}
        />
      )}

      {/* 5. Wyszukiwarka startu / celu — ta sama co na ekranie głównym */}
      {sheetFor && (
        <SearchSheet
          placeholder={sheetFor === 'from' ? s.home.searchPlaceholderFrom : s.home.searchPlaceholderTo}
          query={query}
          loading={searchLoading}
          results={results}
          recent={sheetFor === 'from' ? recentWithGps : recent}
          savedQuick={savedQuick}
          onQuery={setQuery}
          onSelect={handleSuggestionSelect}
          onClose={() => {
            setSheetFor(null);
            setQuery('');
          }}
        />
      )}

      {/* 6. Dolne menu — filtry i akcje pod kciukiem (swap, bezpośr.,
          pojazd, czas), ze springowym chowaniem się przy przewijaniu listy.
          Sortowanie wróciło do toggla w górnym pasku. */}
      {!sheetFor && !timeSheetOpen && (
        <RoutesThumbBar
          animatedStyle={animatedDockStyle}
          onSwap={handleSwap}
          directOnly={directOnly}
          onToggleDirect={() => setDirectOnly(!directOnly)}
          timeLabel={timeLabel}
          isCustomTime={isCustomTime}
          onOpenTimeSheet={() => setTimeSheetOpen(true)}
          modeFilter={modeFilter}
          onCycleMode={handleCycleMode}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: scheme.surface },
  topBar: {
    flexDirection: 'row',
    // Góry w jednej linii: Wstecz (40), tor toggla (38) i pinezka (40).
    // Sam tytuł (~22 px) doklejamy paddingiem, żeby środki się zgrywały.
    alignItems: 'flex-start',
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  back: {
    width: 40,
    height: 40,
    borderRadius: shape.full,
    backgroundColor: scheme.surfaceContainerHigh,
    alignItems: 'center',
    justifyContent: 'center',
  },
  screenTitle: {
    flex: 1,
    ...type.titleMedium,
    fontWeight: '700',
    color: scheme.onSurface,
    // Optyczne wycentrowanie względem toru toggla / pinezki (38–40 px).
    paddingTop: 8,
  },
  // Toggle sortowania w stylu przełącznika iOS: tor z dwiema ikonami
  // (zegar = odjazd, rakieta = przyjazd), kciuk suwa się timingiem.
  sortWrap: {
    width: 78,
    alignItems: 'center',
  },
  sortToggle: {
    width: 78,
    height: 38,
    borderRadius: shape.full,
    backgroundColor: scheme.surfaceContainerHigh,
    borderWidth: 1,
    borderColor: scheme.outlineVariant,
    justifyContent: 'center',
    // Twardy clip: kciuk nigdy nie wystaje poza tor, nawet w locie.
    overflow: 'hidden',
  },
  sortThumb: {
    position: 'absolute',
    left: 4,
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: scheme.secondaryContainer,
  },
  sortIcons: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
  },
  // Malutki, delikatny podpis pod togglem — tylko info o aktywnym trybie.
  sortLabel: {
    marginTop: 2,
    fontSize: 9,
    lineHeight: 11,
    fontWeight: '500',
    color: scheme.onSurfaceVariant,
    opacity: 0.65,
    textAlign: 'center',
  },
  // Pinezka 1:1 ze strzałką wstecz — dwa okrągłe akcje na końcach paska.
  pinBtn: {
    width: 40,
    height: 40,
    borderRadius: shape.full,
    backgroundColor: scheme.surfaceContainerHigh,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Karta aktywnej podróży nad listą połączeń
  activeTripSlot: { paddingHorizontal: 14, paddingBottom: 12 },
  // Akcja „Śledź ten kurs” pod kartą połączenia
  trackBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    alignSelf: 'flex-start',
    marginTop: 6,
    marginLeft: 4,
    backgroundColor: scheme.surfaceContainerHigh,
    borderRadius: shape.full,
    paddingHorizontal: 12,
    height: 30,
  },
  trackBtnText: { ...type.labelMedium, color: scheme.onSurfaceVariant, fontWeight: '600' },
  trackActive: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    alignSelf: 'flex-start',
    marginTop: 6,
    marginLeft: 4,
    paddingHorizontal: 12,
    height: 30,
    justifyContent: 'center',
  },
  trackActiveText: { ...type.labelMedium, color: scheme.primary, fontWeight: '700' },
  pinBtnActive: {
    backgroundColor: scheme.primaryContainer,
  },
  // Dopiska kotwicy pod tytułem startu: ta sama typografia co nagłówek,
  // tylko mniejsza i w kolorze primary — zero pigułek, zero tła.
  anchorSub: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 4,
    maxWidth: '100%',
  },
  anchorSubText: {
    ...type.labelMedium,
    fontWeight: '600',
    color: scheme.primary,
    flexShrink: 1,
  },
  anchorSubPlace: {
    fontWeight: '500',
    color: scheme.onSurfaceVariant,
  },
  // Cichy X bez kółka — dopiska ma wyglądać jak tekst, nie jak chip.
  anchorX: {
    width: 20,
    height: 20,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  // Nagłówek trasy w stylu One UI: bez tła, jedna linia.
  // Wysokość jak dawny box (~64), większy font, luźny oddech z boków.
  // Wiersz startuje od góry (flex-start), a obie kolumny mają ten sam
  // paddingTop — dzięki temu tytuły od→do stoją ZAWSZE w jednej linii,
  // także z dopiską kotwicy (ona rośnie w dół, nie rozpycha środków).
  // Matematyka jak stare centrowanie: tytuł od 21 px, strzałka od 16 px.
  routeHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    minHeight: 68,
    marginHorizontal: 2,
    marginTop: 4,
    marginBottom: 6,
    paddingVertical: 12,
    paddingHorizontal: 16,
  },
  routeSide: {
    flexShrink: 1,
    maxWidth: '42%',
    justifyContent: 'center',
    paddingTop: 9,
  },
  routeSideGrow: {
    flex: 1,
    justifyContent: 'center',
    paddingTop: 9,
  },
  // Wewnętrzny wrapper rolki tekstu — musi przenosić zwężanie, żeby długie
  // nazwy dalej ucinały się z elipsą w jednej linii.
  routeSlide: {
    flexShrink: 1,
  },
  routeText: {
    fontSize: 20,
    lineHeight: 26,
    fontWeight: '600',
    color: scheme.onSurfaceVariant,
  },
  routeTextStrong: {
    fontSize: 20,
    lineHeight: 26,
    fontWeight: '700',
    color: scheme.onSurface,
  },
  routeArrowBtn: {
    width: 36,
    height: 36,
    borderRadius: shape.full,
    alignItems: 'center',
    justifyContent: 'center',
    marginHorizontal: 8,
    marginTop: 4,
    flexShrink: 0,
  },

  countRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 8,
    paddingHorizontal: 4,
  },
  count: {
    ...type.labelMedium,
    color: scheme.onSurfaceVariant,
    flexShrink: 1,
  },
  list: {
    paddingHorizontal: 14,
    gap: 10,
  },
  footer: { paddingVertical: 18, alignItems: 'center', gap: 10 },
  footerText: { ...type.bodySmall, color: scheme.onSurfaceVariant, textAlign: 'center' },
  loading: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  loadingText: {
    ...type.titleMedium,
    color: scheme.onSurface,
  },
  emptyContainer: {
    padding: 32,
    alignItems: 'center',
    gap: 8,
  },
  emptyTitle: {
    ...type.titleMedium,
    color: scheme.onSurface,
  },
  emptySub: {
    ...type.bodyMedium,
    color: scheme.onSurfaceVariant,
    textAlign: 'center',
  },
  retryBtn: {
    backgroundColor: scheme.primary,
    borderRadius: shape.full,
    paddingHorizontal: 20,
    paddingVertical: 12,
    marginTop: 8,
  },
  retryBtnBusy: { opacity: 0.7 },
  retryText: {
    ...type.labelLarge,
    fontWeight: '700',
    color: scheme.onPrimary,
  },
  offlineChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    flexShrink: 0,
    backgroundColor: scheme.surfaceContainerHighest,
    borderRadius: shape.full,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  offlineDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: scheme.warning,
  },
  offlineText: {
    ...type.labelSmall,
    fontWeight: '700',
    color: scheme.onSurfaceVariant,
  },
});
