import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, Pressable, StyleSheet, Text, View, InteractionManager } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  Anchor,
  ArrowUpDown,
  ChevronDown,
  ChevronLeft,
  Clock3,
  Pin,
  Radio,
  X,
} from 'lucide-react-native';
import Animated, {
  Easing,
  FadeIn,
  FadeOut,
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { elev, scheme, shape, type } from '../../src/theme/tokens';
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
import { ActiveTripCard } from '../../src/components/ActiveTripCard';
import { DepartureTimeSheet } from '../../src/components/DepartureTimeSheet';
import { RouteFiltersCard, type ModePreference } from '../../src/components/RouteFiltersCard';
import { SearchSheet } from '../../src/components/SearchSheet';

const GPS_ITEM: Suggestion = {
  id: '__gps',
  title: 'Moja lokalizacja (GPS)',
  address: 'Użyj aktualnej pozycji',
  kind: 'history',
  lat: 0,
  lon: 0,
};

export default function RoutesScreen() {
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

  const [toTitle, setToTitle] = useState(String(params.toTitle ?? 'Cel'));
  const [toLat, setToLat] = useState(Number(params.toLat ?? 0));
  const [toLon, setToLon] = useState(Number(params.toLon ?? 0));
  const [toId, setToId] = useState(String(params.toId ?? ''));

  // Przycisk „Zakończ” w powiadomieniu to deep link z parametrem action=stop.
  // Ref zamiast stanu, żeby reakcja na deep link nie wchodziła w cykl renderów.
  const stopFromLinkRef = useRef(params.action === 'stop');
  useEffect(() => {
    if (!stopFromLinkRef.current) return;
    stopFromLinkRef.current = false;
    void stopTracking();
  }, []);

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
  // Sortowanie listy: 'fastest' = najwcześniejsze przybycie (domyślnie,
  // żeby jednym tapnięciem wrócić szybko do domu), 'earliest' = jak w
  // Jakdojade, od najwcześniejszego odjazdu. Magazyn (items) zawsze
  // posortowany po odjeździe — paginacja i hold-to-load na tym bazują.
  const [sortMode, setSortMode] = useState<'fastest' | 'earliest'>('fastest');
  // Jednorazowe filtry — NIE są to ustawienia systemowe (maxTransfers
  // w /settings zostaje nietknięte). Toggle wymusza maxTransfers=0, a segmenty
  // pojazdów ograniczają RAPTOR-a do kursów danego typu. Tylko dla bieżącego
  // ekranu wyników, stan nie jest persistowany.
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

  // Animacja płynnego chowania/pokazywania filtrów przy scrollowaniu
  const filterProgress = useSharedValue(1);
  const measuredFiltersHeight = useSharedValue(200);

  const animatedFilterStyle = useAnimatedStyle(() => {
    const p = filterProgress.value;
    const h = measuredFiltersHeight.value;
    return {
      opacity: p,
      maxHeight: interpolate(p, [0, 1], [0, h]),
      transform: [
        {
          translateY: interpolate(p, [0, 1], [-8, 0]),
        },
      ],
      overflow: 'hidden',
    };
  });

  // Aktywna podróż: ta sama karta, która zasila powiadomienie i Live Activity.
  const { trip: trackedTrip, progress: trackedProgress } = useTrackedTrip();

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
  const isTrackingThisRoute =
    trackedTrip != null && isSameQuery(trackedTrip, currentQuery);
  /**
   * Śledzenie konkretnego kursu, a nie całego zapytania. Użytkownik widzi
   * na liście godziny i linie — jeśli przypniemy zapytanie, powiadomienie
   * mogłoby w międzyczasie przeskoczyć na inny kurs i kłamać.
   */
  const startTrackingConnection = async (conn: Connection) => {
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
  };

  /**
   * Przycisk w pasku: śledzimy najbliższe połączenie z listy. Ten sam
   * przycisk zdejmuje śledzenie, jeśli dotyczy już tej trasy.
   */
  const toggleTracking = async () => {
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
  };

  // Refs pod utrzymanie pozycji scrolla przy dokładaniu z góry
  const listRef = useRef<FlatList<Connection>>(null);
  const scrollY = useRef(0);
  const contentH = useRef(0);
  const pendingAdjust = useRef<number | null>(null);
  const topHoldTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (topHoldTimer.current) clearTimeout(topHoldTimer.current);
    };
  }, []);

  const queryAt = (depSec: number | undefined) => {
    const s = getSettingsSync();
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
      departureTimeSec: depSec,
      // Jednorazowe filtry nadpisują systemowe maxTransfers / typ pojazdów.
      maxTransfers: directOnly ? 0 : s.maxTransfers,
      modes: modeFilter,
      minTransferSec: s.minTransferSec,
      maxWalkM: s.maxWalkM,
      walkSpeedMps: s.walkSpeedMps,
    };
  };

  const mergeSorted = (prev: Connection[], batch: Connection[]): { list: Connection[]; added: number } => {
    const existingIds = new Set(prev.map((p) => p.id));
    const fresh = batch.filter((item) => !existingIds.has(item.id));
    const list = [...prev, ...fresh].sort((a, b) => a.departureSec - b.departureSec);
    return { list, added: fresh.length };
  };

  // Stan wyboru godziny/daty odjazdu
  const [timeSheetOpen, setTimeSheetOpen] = useState(false);
  const [departureTimeSec, setDepartureTimeSec] = useState<number | undefined>(undefined);
  const [timeLabel, setTimeLabel] = useState('Teraz');

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
        places.slice(0, 3).map((s) => ({
          id: s.placeId,
          title: s.name,
          address: s.address,
          kind: 'history' as const,
          lat: s.lat,
          lon: s.lon,
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
      SearchService.search(q, { lat: fromLat, lon: fromLon })
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
    () => (sheetFor === 'from' ? [GPS_ITEM, ...recent] : recent),
    [sheetFor, recent],
  );

  const handleSuggestionSelect = async (s: Suggestion) => {
    setQuery('');
    setSheetFor(null);
    if (s.id === GPS_ITEM.id) {
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
          'Błąd lokalizacji',
          'Nie udało się pobrać aktualnej pozycji GPS. Upewnij się, że lokalizacja w telefonie jest włączona.'
        );
      }
      return;
    }

    void SearchService.recordRecent(s).then(() => {
      SearchService.recent().then(setRecent);
    });

    if (sheetFor === 'from') {
      setActiveAnchor(null);
      setFromTitle(s.title);
      setFromLat(s.lat);
      setFromLon(s.lon);
    } else {
      setToId(s.id);
      setToTitle(s.title);
      setToLat(s.lat);
      setToLon(s.lon);
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

  const fetchRoutes = async (targetDepSec?: number, seamless = false) => {
    const seq = ++fetchSeq.current;
    if (!seamless) {
      setLoading(true);
    }
    setLoadError(false);
    setOffline(false);
    setNoMoreEarlier(false);
    setNoMoreLater(false);
    const depSec = targetDepSec !== undefined ? targetDepSec : departureTimeSec;
    try {
      const q = queryAt(depSec);
      const c = await RoutingService.getConnections(q);
      if (seq !== fetchSeq.current) return;
      // Bez rozkładu planer zwraca pustkę, a nie błąd — bez tego stanu
      // użytkownik widzi „nie znaleziono połączeń” zamiast prośby o dane.
      if (getDataStatus().state !== 'ready') {
        setItems([]);
        setLoadError(true);
        return;
      }
      setItems(applyLiveList(c, depSec));
      void recordTripSearch(q.fromLat, q.fromLon, q.fromTitle, {
        id: q.toId || q.toTitle,
        title: q.toTitle,
        lat: q.toLat,
        lon: q.toLon,
      });
    } catch {
      if (seq !== fetchSeq.current) return;
      // Offline: ostatnie prawdziwe dane z cache (z przeliczonymi czasami).
      // W trybie seamless nie czyścimy listy ani nie migoczemy spinnerem.
      const cached = await loadConnections(queryAt(depSec));
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
    const lastDeparture = items[items.length - 1].departureSec;
    const nextDeparture = lastDeparture + 60;
    const seq = ++fetchSeq.current;

    try {
      const c = await RoutingService.getConnections(queryAt(nextDeparture));
      if (seq !== fetchSeq.current) return;
      setItems((prev) => {
        const { list, added } = mergeSorted(prev, c);
        if (added === 0) setNoMoreLater(true);
        return list;
      });
    } catch {
      // po cichu — lista zostaje, spinner znika
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
    // Zapamiętaj wysokość kontentu, żeby po prependzie cofnąć offset (brak skoku)
    pendingAdjust.current = contentH.current;
    const seq = ++fetchSeq.current;

    try {
      const c = await RoutingService.getConnections(queryAt(firstDeparture - 1800));
      if (seq !== fetchSeq.current) {
        pendingAdjust.current = null;
        return;
      }
      setItems((prev) => {
        const { list, added } = mergeSorted(prev, c);
        if (added === 0) {
          setNoMoreEarlier(true);
          pendingAdjust.current = null;
        }
        return list;
      });
    } catch {
      pendingAdjust.current = null;
    } finally {
      if (seq === fetchSeq.current) {
        setLoadingEarlier(false);
      }
    }
  };

  const lastScrollY = useRef(0);
  const isFiltersVisible = useRef(true);
  const accumulatedDelta = useRef(0);

  const HIDE_THRESHOLD = 45;
  const SHOW_THRESHOLD = 30;

  // Góra listy: przytrzymaj chwilę na samej górze → dładuj wcześniejsze; detekcja kierunku dla filtrów z histerezą
  const handleScroll = (e: { nativeEvent: { contentOffset: { y: number } } }) => {
    const y = e.nativeEvent.contentOffset.y;
    const dy = y - lastScrollY.current;
    lastScrollY.current = y;
    scrollY.current = y;

    // 1. Na samej górze listy (y <= 12) — zawsze natychmiast pokazuj filtry
    if (y <= 12) {
      accumulatedDelta.current = 0;
      if (!isFiltersVisible.current) {
        isFiltersVisible.current = true;
        filterProgress.value = withTiming(1, {
          duration: 250,
          easing: Easing.out(Easing.cubic),
        });
      }
    } else if (dy > 0) {
      // Scrollowanie W DÓŁ
      if (accumulatedDelta.current < 0) {
        accumulatedDelta.current = 0;
      }
      accumulatedDelta.current += dy;

      // Schowaj filtry dopiero po przewinięciu co najmniej HIDE_THRESHOLD w dół
      if (accumulatedDelta.current >= HIDE_THRESHOLD && isFiltersVisible.current && y > 30) {
        isFiltersVisible.current = false;
        filterProgress.value = withTiming(0, {
          duration: 220,
          easing: Easing.out(Easing.cubic),
        });
      }
    } else if (dy < 0) {
      // Scrollowanie W GÓRĘ
      if (accumulatedDelta.current > 0) {
        accumulatedDelta.current = 0;
      }
      accumulatedDelta.current += dy;

      // Pokaż filtry dopiero po przewinięciu co najmniej SHOW_THRESHOLD w górę
      if (accumulatedDelta.current <= -SHOW_THRESHOLD && !isFiltersVisible.current) {
        isFiltersVisible.current = true;
        filterProgress.value = withTiming(1, {
          duration: 250,
          easing: Easing.out(Easing.cubic),
        });
      }
    }

    if (topHoldTimer.current) {
      clearTimeout(topHoldTimer.current);
      topHoldTimer.current = null;
    }
    if (y <= 80 && !loading && !loadingEarlier && items.length > 0 && !noMoreEarlier) {
      topHoldTimer.current = setTimeout(() => {
        topHoldTimer.current = null;
        handleLoadEarlier();
      }, 350);
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
  }, [fromLat, fromLon, toLat, toLon, fromTitle, toTitle, activeAnchor, directOnly, modeFilter]);

  const handleSwap = () => {
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

  const handleTimeSelect = (result: { departureTimeSec: number | undefined; label: string }) => {
    setDepartureTimeSec(result.departureTimeSec);
    setTimeLabel(result.label);
    // Lista już jest → zmiana czasu bez czyszczenia ekranu (seamless).
    fetchRoutes(result.departureTimeSec, items.length > 0);
  };

  const isCustomTime = departureTimeSec !== undefined;

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      {/* 1. Górny pasek: Wstecz + Tytuł + Interaktywny przycisk Czasu */}
      <View style={styles.topBar}>
        <Pressable onPress={() => router.back()} style={styles.back} hitSlop={10}>
          <ChevronLeft size={23} color={scheme.onSurface} />
        </Pressable>

        <Text style={styles.screenTitle} numberOfLines={1}>
          Połączenia MPK
        </Text>

        <Pressable
          onPress={() => setTimeSheetOpen(true)}
          style={({ pressed }) => [
            styles.timeChip,
            isCustomTime && styles.timeChipActive,
            pressed && { opacity: 0.8 },
          ]}
          hitSlop={8}
        >
          <Clock3
            size={14}
            color={isCustomTime ? scheme.onPrimaryContainer : scheme.onSecondaryContainer}
          />
          <Text
            style={[styles.timeText, isCustomTime && styles.timeTextActive]}
            numberOfLines={1}
          >
            {timeLabel}
          </Text>
          <ChevronDown
            size={13}
            color={isCustomTime ? scheme.onPrimaryContainer : scheme.onSecondaryContainer}
          />
        </Pressable>

        <Pressable
          onPress={toggleTracking}
          accessibilityRole="button"
          accessibilityState={{ selected: isTrackingThisRoute }}
          accessibilityLabel={
            isTrackingThisRoute ? 'Zatrzymaj śledzenie podróży' : 'Śledź najbliższe połączenie'
          }
          style={({ pressed }) => [
            styles.pinBtn,
            isTrackingThisRoute && styles.pinBtnActive,
            pressed && { opacity: 0.8 },
          ]}
          hitSlop={8}
        >
          {isTrackingThisRoute ? (
            <Radio size={17} color={scheme.onPrimaryContainer} />
          ) : (
            <Pin size={17} color={scheme.onSecondaryContainer} />
          )}
        </Pressable>
      </View>

      {/* 2. Karta trasy: klikalny Start / Cel + wyśrodkowany przycisk zamiany */}
      <View style={styles.routeCard}>
        <View style={styles.endpoints}>
          {/* Start */}
          <Pressable
            onPress={() => setSheetFor('from')}
            accessibilityRole="button"
            accessibilityLabel={`Zmień miejsce startowe, obecnie ${fromTitle}`}
            style={({ pressed }) => [styles.endpointRow, pressed && { opacity: 0.7 }]}
            hitSlop={6}
          >
            <View style={[styles.indicatorDot, { backgroundColor: scheme.success }]} />
            {activeAnchor ? (
              <Animated.View
                entering={FadeIn.duration(160)}
                exiting={FadeOut.duration(120)}
                style={styles.anchorBadge}
              >
                <Anchor size={13} color={scheme.primary} />
                <Text style={styles.anchorStopText} numberOfLines={1}>
                  {activeAnchor.stopName}
                </Text>
                <View style={styles.anchorPlaceTag}>
                  <Text style={styles.anchorPlaceText} numberOfLines={1}>
                    {activeAnchor.placeName}
                  </Text>
                </View>
                <Pressable
                  onPress={(e) => {
                    e.stopPropagation();
                    handleDismissAnchor();
                  }}
                  hitSlop={10}
                  style={({ pressed }) => [
                    styles.anchorCloseBtn,
                    pressed && { opacity: 0.6, transform: [{ scale: 0.88 }] },
                  ]}
                  accessibilityRole="button"
                  accessibilityLabel="Usuń zakotwiczenie przystanku i szukaj z GPS"
                >
                  <X size={12} color={scheme.onSurfaceVariant} strokeWidth={2.5} />
                </Pressable>
              </Animated.View>
            ) : (
              <Text style={styles.fromText} numberOfLines={1}>
                {fromTitle}
              </Text>
            )}
          </Pressable>

          {/* Łącznik pionowy */}
          <View style={styles.connector} />

          {/* Cel */}
          <Pressable
            onPress={() => setSheetFor('to')}
            accessibilityRole="button"
            accessibilityLabel={`Zmień cel, obecnie ${toTitle}`}
            style={({ pressed }) => [styles.endpointRow, pressed && { opacity: 0.7 }]}
            hitSlop={6}
          >
            <View style={[styles.indicatorDot, { backgroundColor: scheme.error }]} />
            <Text style={styles.toText} numberOfLines={1}>
              {toTitle}
            </Text>
          </Pressable>
        </View>

        {/* Idealnie wyśrodkowany przycisk SWAP */}
        <Pressable
          onPress={handleSwap}
          style={({ pressed }) => [
            styles.swapBtn,
            pressed && { backgroundColor: scheme.secondaryContainer, transform: [{ scale: 0.93 }] },
          ]}
          hitSlop={10}
        >
          <ArrowUpDown size={17} color={scheme.primary} />
        </Pressable>
      </View>

      {/* 3 i 4. Płynnie zwijane filtry i sortowanie przy scrollowaniu */}
      <Animated.View style={[styles.collapsibleFiltersWrap, animatedFilterStyle]}>
        <View
          onLayout={(e) => {
            const h = e.nativeEvent.layout.height;
            if (h > 60 && Math.abs(measuredFiltersHeight.value - h) > 2) {
              measuredFiltersHeight.value = h;
            }
          }}
        >
          {/* 3. Jednorazowe filtry: bezpośrednie + pojazdy (nie ruszają ustawień) */}
          <View style={styles.filtersWrap}>
            <RouteFiltersCard
              directOnly={directOnly}
              onDirectChange={setDirectOnly}
              mode={modeFilter}
              onModeChange={setModeFilter}
            />
          </View>

          {/* 4. Sortowanie: najszybciej (przybycie) albo najwcześniej (odjazd) */}
          <View style={styles.sortRow}>
            {(
              [
                { key: 'fastest', label: 'Najszybciej' },
                { key: 'earliest', label: 'Najwcześniej' },
              ] as const
            ).map((opt) => {
              const active = sortMode === opt.key;
              return (
                <Pressable
                  key={opt.key}
                  onPress={() => setSortMode(opt.key)}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                  style={({ pressed }) => [
                    styles.sortPill,
                    active && styles.sortPillActive,
                    pressed && { opacity: 0.8 },
                  ]}
                >
                  <Text style={[styles.sortText, active && styles.sortTextActive]}>
                    {opt.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>
      </Animated.View>

      {/* 5. Lista połączeń */}
      {loading ? (
        <View style={styles.loading}>
          <ActivityIndicator size="large" color={scheme.primary} />
          <Text style={styles.loadingText}>Szukam połączeń…</Text>
        </View>
      ) : loadError ? (
        <View style={styles.emptyContainer}>
          <Text style={styles.emptyTitle}>
            {timetableReady ? 'Nie udało się policzyć połączeń' : 'Brak rozkładu MPK'}
          </Text>
          <Text style={styles.emptySub}>
            {timetableReady
              ? 'Planer liczy trasy na telefonie. Spróbuj ponownie — jeśli powtarza się to zawsze, odśwież rozkład w ustawieniach.'
              : 'Aplikacja liczy trasy na telefonie z pełnego rozkładu MPK. Bez niego nie ma połączeń — pobierz go raz, potem działa offline.'}
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
              accessibilityLabel="Pobierz rozkład MPK"
            >
              {timetableBusy ? (
                <Text style={styles.retryText}>
                  {dataStatus.state === 'downloading'
                    ? `Pobieranie… ${Math.round(dataStatus.progress * 100)}%`
                    : dataStatus.state === 'importing'
                      ? `${dataStatus.step} ${Math.round(dataStatus.progress * 100)}%`
                      : 'Pobieranie…'}
                </Text>
              ) : (
                <Text style={styles.retryText}>Pobierz rozkład</Text>
              )}
            </Pressable>
          )}
          {timetableReady && (
            <Pressable
              onPress={() => fetchRoutes(departureTimeSec)}
              style={({ pressed }) => [styles.retryBtn, pressed && { opacity: 0.8 }]}
            >
              <Text style={styles.retryText}>Spróbuj ponownie</Text>
            </Pressable>
          )}
        </View>
      ) : (
        <FlatList
          ref={listRef}
          data={displayed}
          // wymusza przeliczenie etykiet „za X min” bez refetchu
          extraData={nowTick}
          keyExtractor={(i) => i.id}
          contentContainerStyle={styles.list}
          showsVerticalScrollIndicator={false}
          overScrollMode="never"
          onEndReached={handleLoadMore}
          onEndReachedThreshold={0.5}
          onScroll={handleScroll}
          scrollEventThrottle={16}
          onContentSizeChange={handleContentSizeChange}
          maintainVisibleContentPosition={{ minIndexForVisible: 0 }}
          renderItem={({ item }) => {
            const d = new Date();
            const nowS = d.getHours() * 3600 + d.getMinutes() * 60 + d.getSeconds();
            const past = item.departureSec > 0 && item.departureSec < nowS - 60;
            const isTracked =
              trackedTrip?.connection.id === item.id && isTrackingThisRoute;
            return (
              <View>
                <ConnectionCard
                  item={item}
                  dimmed={past}
                  onPress={() =>
                    router.push({ pathname: '/routes/[id]', params: { id: item.id } })
                  }
                />
                {/* Śledzimy konkretny kurs, nie całe zapytanie — inaczej
                    powiadomienie potrafiłoby przeskoczyć na inną godzinę. */}
                {!past && !isTracked ? (
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
                {isTracked ? (
                  <View style={styles.trackActive}>
                    <Radio size={13} color={scheme.primary} />
                    <Text style={styles.trackActiveText}>Śledzone</Text>
                  </View>
                ) : null}
              </View>
            );
          }}
          ListHeaderComponent={
            <View>
              {trackedTrip && trackedProgress ? (
                <View style={styles.activeTripSlot}>
                  <ActiveTripCard
                    trip={trackedTrip}
                    progress={trackedProgress}
                    onStop={() => void stopTracking()}
                    onOpen={() =>
                      router.push({
                        pathname: '/routes/[id]',
                        params: { id: trackedTrip.connection.id },
                      })
                    }
                  />
                </View>
              ) : null}
              {loadingEarlier && (
                <View style={{ paddingVertical: 12, alignItems: 'center' }}>
                  <ActivityIndicator size="small" color={scheme.primary} />
                </View>
              )}
              <View style={styles.countRow}>
                <Text style={styles.count} numberOfLines={1}>
                  {connectionsLabel(items.length)} • {isCustomTime ? `odjazd ${timeLabel}` : 'najbliższe odjazdy'}
                  {directOnly ? ' • tylko bezpośrednie' : ''}
                  {modeFilter === 'tram' ? ' • tramwaje' : modeFilter === 'bus' ? ' • autobusy' : ''}
                </Text>
                {offline && (
                  <Pressable
                    onPress={() => quietRefresh()}
                    style={({ pressed }) => [styles.offlineChip, pressed && { opacity: 0.7 }]}
                    hitSlop={6}
                    accessibilityRole="button"
                    accessibilityLabel="Ostatnie dane z cache. Dotknij, aby odświeżyć."
                  >
                    <View style={styles.offlineDot} />
                    <Text style={styles.offlineText}>offline</Text>
                  </Pressable>
                )}
                {liveStale && !offline && (
                  <View style={styles.offlineChip}>
                    <View style={styles.offlineDot} />
                    <Text style={styles.offlineText}>brak danych live</Text>
                  </View>
                )}
              </View>
            </View>
          }
          ListFooterComponent={
            loadingMore ? (
              <View style={{ paddingVertical: 16, alignItems: 'center' }}>
                <ActivityIndicator size="small" color={scheme.primary} />
              </View>
            ) : null
          }
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              <Text style={styles.emptyTitle}>
                {directOnly || modeFilter !== 'all'
                  ? 'Brak połączeń dla wybranych filtrów'
                  : 'Nie znaleziono połączeń'}
              </Text>
              <Text style={styles.emptySub}>
                {directOnly && modeFilter !== 'all'
                  ? `Na tej trasie nie ma teraz kursu ${modeFilter === 'tram' ? 'tramwajem' : 'autobusem'} bez przesiadek. Poluzuj filtry albo sprawdź inną godzinę.`
                  : directOnly
                    ? 'Na tej trasie nie ma teraz kursu bez przesiadek. Wyłącz filtr „Tylko bezpośrednie”, aby zobaczyć połączenia z przesiadkami, albo sprawdź inną godzinę.'
                    : modeFilter !== 'all'
                      ? `Na tej trasie nie ma teraz kursu ${modeFilter === 'tram' ? 'tramwajem' : 'autobusem'}. Przełącz na „Wszystkie”, aby zobaczyć resztę połączeń.`
                      : 'Spróbuj wybrać inny cel lub sprawdź inną godzinę odjazdu.'}
              </Text>
              {directOnly && (
                <Pressable
                  onPress={() => setDirectOnly(false)}
                  style={({ pressed }) => [styles.retryBtn, pressed && { opacity: 0.8 }]}
                  accessibilityRole="button"
                  accessibilityLabel="Pokaż połączenia z przesiadkami"
                >
                  <Text style={styles.retryText}>Pokaż z przesiadkami</Text>
                </Pressable>
              )}
              {modeFilter !== 'all' && (
                <Pressable
                  onPress={() => setModeFilter('all')}
                  style={({ pressed }) => [styles.retryBtn, pressed && { opacity: 0.8 }]}
                  accessibilityRole="button"
                  accessibilityLabel="Pokaż wszystkie pojazdy"
                >
                  <Text style={styles.retryText}>Pokaż wszystkie pojazdy</Text>
                </Pressable>
              )}
            </View>
          }
        />
      )}

      {/* 6. Bottom sheet wyboru daty i godziny */}
      {timeSheetOpen && (
        <DepartureTimeSheet
          initialTimeSec={departureTimeSec}
          initialLabel={timeLabel}
          onClose={() => setTimeSheetOpen(false)}
          onSelect={handleTimeSelect}
        />
      )}

      {/* 7. Wyszukiwarka startu / celu — ta sama co na ekranie głównym */}
      {sheetFor && (
        <SearchSheet
          placeholder={sheetFor === 'from' ? 'Skąd wyruszasz?' : 'Dokąd jedziesz?'}
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
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: scheme.surface },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
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
  },
  timeChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: scheme.secondaryContainer,
    borderRadius: shape.full,
    height: 38,
    paddingHorizontal: 12,
  },
  timeChipActive: {
    backgroundColor: scheme.primaryContainer,
  },
  timeText: {
    ...type.labelMedium,
    color: scheme.onSecondaryContainer,
    fontWeight: '600',
  },
  timeTextActive: {
    color: scheme.onPrimaryContainer,
    fontWeight: '700',
  },
  pinBtn: {
    width: 38,
    height: 38,
    borderRadius: shape.full,
    backgroundColor: scheme.secondaryContainer,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pinBtnActive: {
    backgroundColor: scheme.primaryContainer,
  },
  // Karta aktywnej podróży nad listą połączeń
  activeTripSlot: {
    paddingHorizontal: 14,
    paddingBottom: 12,
  },
  // Akcja „Śledź ten kurs" pod kartą połączenia
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
  trackBtnText: {
    ...type.labelMedium,
    color: scheme.onSurfaceVariant,
    fontWeight: '600',
  },
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
  trackActiveText: {
    ...type.labelMedium,
    color: scheme.primary,
    fontWeight: '700',
  },
  // Karta trasy z dedykowanymi kolumnami
  routeCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: scheme.surfaceContainerHigh,
    borderRadius: shape.large,
    marginHorizontal: 14,
    marginBottom: 10,
    paddingVertical: 10,
    paddingLeft: 14,
    paddingRight: 10,
    gap: 12,
    ...elev.level1,
  },
  endpoints: {
    flex: 1,
    gap: 3,
    justifyContent: 'center',
  },
  endpointRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  indicatorDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  connector: {
    width: 2,
    height: 10,
    backgroundColor: scheme.outlineVariant,
    marginLeft: 3,
  },
  fromText: {
    ...type.bodyMedium,
    color: scheme.onSurfaceVariant,
    flex: 1,
  },
  anchorBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: scheme.surfaceContainerHighest,
    borderRadius: shape.full,
    paddingLeft: 8,
    paddingRight: 6,
    paddingVertical: 3,
    borderWidth: 1,
    borderColor: scheme.outlineVariant,
    maxWidth: '92%',
  },
  anchorStopText: {
    ...type.labelMedium,
    fontWeight: '700',
    color: scheme.onSurface,
    maxWidth: 130,
  },
  anchorPlaceTag: {
    backgroundColor: scheme.secondaryContainer,
    paddingHorizontal: 6,
    paddingVertical: 1.5,
    borderRadius: shape.full,
  },
  anchorPlaceText: {
    ...type.labelSmall,
    color: scheme.onSecondaryContainer,
    fontWeight: '600',
    fontSize: 11,
    maxWidth: 60,
  },
  anchorCloseBtn: {
    width: 20,
    height: 20,
    borderRadius: shape.full,
    backgroundColor: scheme.surfaceContainerHigh,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 2,
  },
  toText: {
    ...type.titleSmall,
    fontWeight: '700',
    color: scheme.onSurface,
    flex: 1,
  },
  // Wyśrodkowany przycisk zamiany
  swapBtn: {
    width: 40,
    height: 40,
    borderRadius: shape.full,
    backgroundColor: scheme.surfaceContainerHighest,
    alignItems: 'center',
    justifyContent: 'center',
  },
  collapsibleFiltersWrap: {
    overflow: 'hidden',
  },
  // Segmented: Najszybciej / Najwcześniej
  sortRow: {
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: 14,
    marginBottom: 10,
  },
  filtersWrap: {
    paddingHorizontal: 14,
    marginBottom: 10,
  },
  sortPill: {
    flex: 1,
    alignItems: 'center',
    borderRadius: shape.full,
    paddingVertical: 9,
    backgroundColor: scheme.surfaceContainerHigh,
  },
  sortPillActive: {
    backgroundColor: scheme.secondaryContainer,
  },
  sortText: {
    ...type.labelLarge,
    color: scheme.onSurfaceVariant,
  },
  sortTextActive: {
    color: scheme.onSecondaryContainer,
    fontWeight: '700',
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
    paddingBottom: 36,
    gap: 10,
  },
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
