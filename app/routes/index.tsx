import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View, InteractionManager, type NativeScrollEvent, type NativeSyntheticEvent } from 'react-native';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  Anchor,
  ChevronUp,
  ChevronLeft,
  CloudOff,
  X,
} from 'lucide-react-native';
import {
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { elev, scheme, shape, type } from '../../src/theme/tokens';
import { motion } from '../../src/theme/motion';
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
import {
  stopTracking,
} from '../../src/services/notifications';
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
import { deduplicateConnections, mergeConnections } from '../../src/services/routing/connectionIdentity';
import { loadEarlierConnections } from '../../src/services/routing/earlierConnections';
import { applyLiveDelays, sortConnectionsByCost } from '../../src/services/routing/engine';
import { boardingDepartureMs } from '../../src/services/routing/connectionTimes';
import { costParamsFor } from '../../src/services/routing/raptor';
import type { JourneyTimeMode } from '../../src/services/routing/types';
import { isOutsideServiceArea } from '../../src/services/serviceArea';
import type { Connection, SavedPlace, Suggestion } from '../../src/types/models';
import { ConnectionCard, connectionsLabel } from '../../src/components/ConnectionCard';
import { ConnectionPeek, type ConnectionPeekHandlers } from '../../src/components/ConnectionPeek';
import { RouteEndpoints } from '../../src/components/RouteEndpoints';
import { DepartureTimeSheet, type JourneyTimeSelection } from '../../src/components/DepartureTimeSheet';
import {
  RoutesThumbBar,
  type ModePreference,
} from '../../src/components/RoutesThumbBar';
import { useThumbBarInset } from '../../src/components/ThumbBar';
import { SearchSheet } from '../../src/components/SearchSheet';
import { useStrings } from '../../src/i18n';

// Stabilna referencja: nowa funkcja na każdym renderze zmuszałaby
// VirtualizedList do przeliczenia komórek od zera przy każdej aktualizacji.
const connectionKey = (item: Connection) => item.id;

export default function RoutesScreen() {
  const s = useStrings();
  const { cityId } = useActiveCity();
  const cityDef = defaultLocationForCity(cityId);
  const cityGen = s.city.gen(cityId);
  const operator = s.city.operator(cityId);
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
    /** '1', gdy start pochodzi z GPS; wtedy wolno go doprecyzować fixem w tle. */
    fromGps?: string;
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
  // Czy start nadal jest GPS-em (a nie ręcznie wybranym punktem). Zmiana na
  // custom wyłącza doprecyzowanie w tle i odwrotnie.
  const [gpsOrigin, setGpsOrigin] = useState(params.fromGps === '1');

  const [toTitle, setToTitle] = useState(String(params.toTitle ?? s.routes.destFallback));
  const [toLat, setToLat] = useState(Number(params.toLat ?? 0));
  const [toLon, setToLon] = useState(Number(params.toLon ?? 0));
  const [toId, setToId] = useState(String(params.toId ?? ''));
  // Ten sam punkt po obu stronach: nie ma czego planować, a silnik sam z siebie
  // potrafi tu wygenerować przejazd w kółko.
  const samePlace = distanceMeters(fromLat, fromLon, toLat, toLon) <= 40;

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
  // śledzonego kursu. Listę połączeń użytkownik już widział - teraz chce
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
    router.push({ pathname: '/routes/[id]', params: { id: String(id) } });
  }, [params.open, router]);

  const [savedPlaces, setSavedPlaces] = useState<SavedPlace[]>([]);
  const [activeAnchor, setActiveAnchor] = useState<ActiveAnchor | null>(null);
  const dismissedAnchorsRef = useRef<Set<string>>(new Set());
  const fetchSeq = useRef(0);
  const initialAnchorCheckedRef = useRef(false);
  // Podmiana originu na dokładniejszy fix odpala się raz na wybór startu.
  const refineAppliedRef = useRef(false);
  const originCoordsRef = useRef({ lat: fromLat, lon: fromLon });
  originCoordsRef.current = { lat: fromLat, lon: fromLon };
  const activeAnchorRef = useRef<ActiveAnchor | null>(activeAnchor);
  activeAnchorRef.current = activeAnchor;

  const handleDismissAnchor = () => {
    if (!activeAnchor) return;
    dismissedAnchorsRef.current.add(activeAnchor.placeId);
    // Pozycja już jest prawdziwym GPS (kotwica to tylko preferencja
    // w zapytaniu) - dismiss czyści samą preferencję i odświeża listę.
    setActiveAnchor(null);
  };

  const [items, setItems] = useState<Connection[]>([]);
  const [timeSheetOpen, setTimeSheetOpen] = useState(false);
  const [targetTimeSec, setTargetTimeSec] = useState<number | undefined>(undefined);
  const [timeMode, setTimeMode] = useState<JourneyTimeMode>('departure');
  const arrivalMode = timeMode === 'arrival';
  const timeLabel = targetTimeSec === undefined
    ? s.routes.now
    : (arrivalMode ? s.timeSheet.selectedArrival : s.timeSheet.selectedDeparture)(
        targetTimeSec >= 86400 ? s.common.tomorrow : s.common.today,
        String(Math.floor(targetTimeSec / 3600) % 24).padStart(2, '0'),
        String(Math.floor(targetTimeSec % 3600 / 60)).padStart(2, '0'),
      );
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [offline, setOffline] = useState(false);
  const [preview, setPreview] = useState<{ item: Connection; sticky: boolean } | null>(null);
  const [previewReady, setPreviewReady] = useState(false);
  const previewId = useRef<string | null>(null);
  const closePreview = useCallback(() => {
    previewId.current = null;
    setPreview(null);
    setPreviewReady(false);
  }, []);
  useFocusEffect(useCallback(() => closePreview, [closePreview]));
  // Rozkład trzymany na telefonie: bez niego RAPTOR nie ma czym liczyć, więc
  // pusty wynik to nie „brak serwera", tylko brak danych offline.
  const [dataStatus, setDataStatus] = useState<DataStatus>(() => getDataStatus());
  useEffect(() => subscribeDataStatus(setDataStatus), []);
  const timetableBusy =
    dataStatus.state === 'downloading' || dataStatus.state === 'importing';
  const timetableReady = dataStatus.state === 'ready';
  // Brak sieci = brak opóźnień z MPK. Bez komunikatu użytkownik myśli,
  // że planer po prostu nie umie opóźnień.
  // `unknown` też oznacza brak danych: przed pierwszym udanym pollem (albo przy
  // starcie apki) nie mamy żadnego opóźnienia, więc cisza była kłamstwem.
  const [liveStale, setLiveStale] = useState(false);
  // Tick przerysowujący opóźnienia: wyplanowane połączenia mają flagi live
  // z chwili wyszukiwania, bez tickera byłyby zamrożone od wyszukania.
  const [liveTick, setLiveTick] = useState(0);
  const lastLiveOk = useRef(0);
  useEffect(() => {
    const check = () => {
      setLiveStale(liveTracker.getLiveState() !== 'fresh');
      const ok = liveTracker.getLastOk();
      if (ok !== lastLiveOk.current) {
        lastLiveOk.current = ok;
        setLiveTick(ok);
      }
    };
    check();
    const t = setInterval(check, 5000);
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
  const [earlierFailed, setEarlierFailed] = useState(false);
  const [earlierFocused, setEarlierFocused] = useState(false);
  const earlierRequest = useRef(false);
  const [noMoreLater, setNoMoreLater] = useState(false);
  // Doładowanie potrafi paść (baza w trakcie importu, pusty dzień) i wtedy
  // lista po cichu przestawała się dociągać. Bez tego użytkownik scrollował
  // do końca i nie dostawał żadnej odpowiedzi.
  const [loadMoreFailed, setLoadMoreFailed] = useState(false);
  // Filtry mieszkają w dolnym menu (RoutesThumbBar) - na górze ekranu nie ma
  // ich wcale, żeby nic nie powtarzać się w dwóch miejscach. To wciąż
  // filtry jednorazowe, NIE ustawienia systemowe (maxTransfers w /settings
  // zostaje nietknięte): toggle wymusza maxTransfers=0, a typ pojazdu
  // ogranicza RAPTOR-a do kursów danego rodzaju.
  const [directOnly, setDirectOnly] = useState(params.directOnly === '1');
  const [modeFilter, setModeFilter] = useState<ModePreference>(
    params.modes === 'tram' || params.modes === 'bus' ? params.modes : 'all',
  );

  const displayed = useMemo(() => {
    let list = applyLiveDelays(items, offline || liveStale ? new Map() : liveTracker.getTripDelays());
    if (directOnly) {
      list = list.filter((c) => c.transfers === 0);
    }
    if (modeFilter !== 'all') {
      list = list.filter((c) => c.legs.every((leg) =>
        leg.mode === 'walk' || leg.mode === modeFilter || (modeFilter === 'bus' && leg.mode === 'trolleybus'),
      ));
    }
    const cfg = getSettingsSync();
    return sortConnectionsByCost(
      [...list], costParamsFor(cfg.routeStyle), profileWalkSpeedMps(cfg.walkPace),
      arrivalMode ? targetTimeSec : undefined,
    );
  }, [items, directOnly, modeFilter, arrivalMode, targetTimeSec, liveTick, offline, liveStale]);

  // Dock przesuwa się nad listą bez zmiany wysokości jej viewportu.
  const dockProgress = useSharedValue(1);
  // Zapas pod listą liczony z zmierzonej wysokości docka - wpisane wcześniej
  // 96 px nie wystarczało i ostatnia karta chowała się pod paskiem.
  const thumbInset = useThumbBarInset();

  const animatedDockStyle = useAnimatedStyle(() => {
    const p = dockProgress.value;
    return {
      opacity: interpolate(p, [0, 1], [0, 1]),
      transform: [
        { translateY: interpolate(p, [0, 1], [thumbInset, 0]) },
      ],
    };
  });

  const listRef = useRef<FlatList<Connection>>(null);
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

  const queryAt = (depSec: number | undefined) => {
    const cfg = getSettingsSync();
    return {
      fromTitle,
      fromLat,
      fromLon,
      toId,
      toTitle,
      toLat,
      toLon,
      // Kotwica to preferencja startowa - pozycja zostaje prawdziwym GPS,
      // silnik liczy realny spacer do kotwicy (ułatwienie, nie sztywna zasada).
      anchorStopId: activeAnchor?.stopId,
      anchorStopLat: activeAnchor?.lat,
      anchorStopLon: activeAnchor?.lon,
      departureTimeSec: arrivalMode ? undefined : depSec,
      arriveBySec: arrivalMode ? depSec : undefined,
      // Jednorazowe filtry nadpisują systemowe maxTransfers / typ pojazdów.
      maxTransfers: directOnly ? 0 : cfg.maxTransfers,
      modes: modeFilter,
      minTransferSec: cfg.minTransferSec,
      trainsEnabled: cfg.trainsEnabled,
      cableEnabled: cfg.cableEnabled,
      allowedTransferModes: cfg.allowedModes,
      trainMinTransferSec: cfg.trainMinTransferSec,
      maxWalkM: cfg.maxWalkM,
      // Tempo z profilu wybranego w ustawieniach (wolno/normalnie/szybko).
      walkSpeedMps: profileWalkSpeedMps(cfg.walkPace),
      routeStyle: cfg.routeStyle,
    };
  };

  // Wyszukiwarka startu / celu - ta sama co na ekranie głównym
  const [sheetFor, setSheetFor] = useState<'from' | 'to' | null>(null);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Suggestion[]>([]);
  const [recent, setRecent] = useState<Suggestion[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState(false);
  const [savedQuick, setSavedQuick] = useState<Suggestion[]>([]);
  // GPS spoza strefy aktywnego miasta nie może być startem trasy.
  const [gpsOutside, setGpsOutside] = useState(false);

  useEffect(() => {
    SearchService.recent().then(setRecent);
    Promise.all([FavoritesService.list(), loadSettings()]).then(([places, currentSettings]) => {
      setSavedPlaces(places);
      setSavedQuick(
        places.map((p) => ({
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

  // Start z GPS bez kotwicy liczy się z fixu, który mógł być słaby (Balanced
  // potrafi trafić o setki metrów i wybrać przystanek po złej stronie osiedla).
  // Po wyszukaniu bierzemy dokładniejszy fix w tle; gdy pozycja faktycznie się
  // przesunęła, podmieniamy origin, a lista odświeża się seamless, bez spinnera.
  useEffect(() => {
    if (!gpsOrigin || activeAnchor) return;
    let cancelled = false;
    const apply = (loc: LocationResult) => {
      if (cancelled || refineAppliedRef.current || activeAnchorRef.current) return;
      if (isOutsideServiceArea(loc.lat, loc.lon)) return;
      const origin = originCoordsRef.current;
      if (distanceMeters(loc.lat, loc.lon, origin.lat, origin.lon) < LOCATION_REFINE_DELTA_M) return;
      refineAppliedRef.current = true;
      setFromTitle(loc.title);
      setFromLat(loc.lat);
      setFromLon(loc.lon);
    };
    const unsubscribe = LocationService.subscribe(apply);
    void LocationService.refineLocation().then((loc) => {
      if (loc) apply(loc);
    });
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [gpsOrigin, activeAnchor]);

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
    () =>
      sheetFor === 'from'
        ? gpsOutside
          ? recent
          : [gpsItem, ...recent]
        : recent,
    [sheetFor, recent, gpsItem, gpsOutside],
  );

  const handleSuggestionSelect = async (sug: Suggestion) => {
    setQuery('');
    setSheetFor(null);
    if (sug.id === gpsItem.id) {
      // Start = aktualna pozycja GPS (nie zapisana wcześniej)
      try {
        const l = await LocationService.getCurrentLocation();
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
      if (sug.lat !== fromLat || sug.lon !== fromLon || sug.title !== fromTitle) {
        setItems([]);
        setLoading(true);
      }
      setGpsOrigin(false);
      setActiveAnchor(null);
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
    // Default: tylko aktualne i przyszłe - bez historycznych.
    // Wcześniejsze odjazdy użytkownik wczytuje gestem lub przyciskiem.
    // Przy jawnie wybranej godzinie (np. z przeszłości) pokazuj wszystko jak jest.
    let list = deduplicateConnections(c).sort((a, b) => a.departureSec - b.departureSec);
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
      const c = await RoutingService.getConnections(q);
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
   * Cichy refresh BEZ spinnera i BEZ czyszczenia listy - podmiana jest
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

  // Heartbeat offline: co 15 s sprawdzamy powrót sieci i cicho podmieniamy
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

  // Starsze (historyczne, już odjechane) - dokładane Z GÓRY
  const handleLoadEarlier = async () => {
    if (arrivalMode) return;
    if (loading || loadingMore || earlierRequest.current || items.length === 0 || noMoreEarlier || offline) return;
    const firstDeparture = items[0].departureSec;
    if (!firstDeparture || firstDeparture <= 0) return;

    earlierRequest.current = true;
    setLoadingEarlier(true);
    setEarlierFailed(false);
    const seq = ++fetchSeq.current;

    try {
      const result = await loadEarlierConnections(
        items,
        (at) => RoutingService.getConnections(queryAt(at)),
        () => seq !== fetchSeq.current,
      );
      if (!result) return;
      setNoMoreEarlier(result.added === 0);
      setItems(result.list);
    } catch {
      if (seq === fetchSeq.current) setEarlierFailed(true);
    } finally {
      // Jak w handleLoadMore: spinner gaśnie nawet gdy zapytanie zostało
      // unieważnione przez nowszy fetchSeq.
      earlierRequest.current = false;
      setLoadingEarlier(false);
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
  // scrollu (patrz handleScrollEndDrag / handleMomentumScrollEnd) - 80 px
  // to jedno świadome przejście, a nie drgnięcie palcem.
  const HIDE_THRESHOLD = 80;
  const SHOW_THRESHOLD = 40;
  // Pauza po zmianie stanu: dwa przeciwstawne gesty w krótkim czasie
  // nie mogą się zbić w serię szarpnięć docka.
  const DOCK_COOLDOWN_MS = 450;
  // Ile czekamy po puszczeniu palca na sprawdzenie, czy zaczęło się
  // „rzucanie” listy (momentum). Jeśli tak, decyzja zapada po nim.
  const SCROLL_SETTLE_MS = 120;

  // Jedno miejsce do zmiany stanu docka. Przeskok stanu jest możliwy tylko
  // raz na DOCK_COOLDOWN_MS - szarpnięcia się nie zbiją w serię, a gest
  // nie ginie: jeśli pauza trwa, oczekujący stan zostaje dopalony tuż po
  // niej (pendingDockState). `force` omija pauzę - przy powrocie na samą
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
    dockProgress.value = withTiming(visible ? 1 : 0, motion.state);
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
  // przeciągania dock tylko liczy deltę - animacja leci na wątku UI
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

  const handleScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const y = e.nativeEvent.contentOffset.y;
    const dy = y - lastScrollY.current;
    lastScrollY.current = y;

    // 1. Na samej górze listy (y <= 12) - dock wraca od razu, bez
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

  useEffect(() => {
    if (samePlace) {
      setItems([]);
      setLoading(false);
      setLoadError(false);
      return;
    }
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
  }, [fromLat, fromLon, toLat, toLon, fromTitle, toTitle, samePlace, activeAnchor, directOnly, modeFilter, timetableReady, targetTimeSec, timeMode]);

  // Gest i przycisk dokładają wcześniejsze odjazdy do tej samej listy.
  const handlePullEarlier = () => {
    void loadEarlierRef.current();
  };

  const handleCycleMode = () => {
    if (modeFilter === 'all') setModeFilter('tram');
    else if (modeFilter === 'tram') setModeFilter('bus');
    else setModeFilter('all');
  };

  const handleSwap = () => {
    if (samePlace || (fromLat === toLat && fromLon === toLon && fromTitle === toTitle)) return;
    setItems([]);
    setLoading(true);
    // Wyniki po swapie to zupełnie nowa lista - wracamy na górę.
    listRef.current?.scrollToOffset({ offset: 0, animated: false });
    // Start = stary cel (ręczny punkt), więc doprecyzowanie GPS już nie dotyczy.
    setGpsOrigin(false);
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

  const handleTimeSelect = (result: JourneyTimeSelection) => {
    if (targetTimeSec === result.timeSec && timeMode === result.mode) return;
    fetchSeq.current++;
    setItems([]);
    setLoading(true);
    setTargetTimeSec(result.timeSec);
    setTimeMode(result.mode);
    listRef.current?.scrollToOffset({ offset: 0, animated: false });
  };

  const isCustomTime = targetTimeSec !== undefined;
  const earlierDisabled = loading || loadingMore || loadingEarlier || noMoreEarlier;

  const openConnection = useCallback(
    (item: Connection) => {
      closePreview();
      router.push({ pathname: '/routes/[id]', params: { id: item.id } });
    },
    [closePreview, router],
  );

  const peek = useMemo<ConnectionPeekHandlers>(() => ({
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
  }), [closePreview, openConnection]);

  const renderConnection = useCallback(
    ({ item }: { item: Connection }) => {
      // Granica "przeszłość" liczona przy każdym rysunku: ref zaczepiony przy
      // zamontowaniu ekranu zmroził nam style dłużej niż minute, bo nowy
      // "tick" dziecka odświeżał napis, a karta zostawała jasna.
      const past = item.departureSec > 0 && boardingDepartureMs(item) < Date.now() - 60000;
      return (
        <ConnectionCard
          item={item}
          dimmed={past}
          onPress={openConnection}
          peek={peek}
          tick={nowTick}
        />
      );
    },
    [openConnection, nowTick, peek],
  );

  const routeHeader = (
    <View style={styles.routeHeader}>
      <RouteEndpoints
        from={fromTitle}
        to={toTitle}
        onFrom={() => setSheetFor('from')}
        onTo={() => setSheetFor('to')}
        onSwap={handleSwap}
        fromLabel={activeAnchor
          ? s.routes.changeFromAnchorA11y(fromTitle, activeAnchor.stopName)
          : s.routes.changeFromA11y(fromTitle)}
        accessory={activeAnchor && (
          <View style={styles.anchorSub}>
            <Anchor size={12} color={scheme.primary} />
            <Text style={styles.anchorSubText} numberOfLines={1}>
              {activeAnchor.stopName}
              <Text style={styles.anchorSubPlace}> · {activeAnchor.placeName}</Text>
            </Text>
            <Pressable
              onPress={handleDismissAnchor}
              style={({ pressed }) => [styles.anchorX, pressed && { opacity: 0.6 }]}
              accessibilityRole="button"
              accessibilityLabel={s.routes.dismissAnchorA11y}
            >
              <X size={12} color={scheme.onSurfaceVariant} strokeWidth={2.5} />
            </Pressable>
          </View>
        )}
      />
    </View>
  );

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.topBar}>
        {/* Deep link z widgetu światkuje główny ekran; wstecz wtedy wraca do niego zamiast nic nie robić. */}
        <Pressable
          onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))}
          style={styles.back}
          accessibilityRole="button"
          accessibilityLabel={s.map.backA11y}
        >
          <ChevronLeft size={23} color={scheme.onSurface} />
        </Pressable>

        <Text style={styles.screenTitle} numberOfLines={1}>
          {s.routes.title(operator)}
        </Text>
      </View>

      {/* 3. Lista połączeń */}
      {/* Ten sam punkt startu i celu: zamiast przejazdów w kółko mówimy
          wprost, że cel jest na miejscu. */}
      {samePlace ? (
        <ScrollView contentContainerStyle={{ flexGrow: 1, paddingHorizontal: 16, paddingBottom: thumbInset }}>
          {routeHeader}
          <View style={styles.emptyContainer}>
            <Text style={styles.emptyTitle}>{s.routes.samePlaceTitle}</Text>
            <Text style={styles.emptySub}>{s.routes.samePlaceBody}</Text>
          </View>
        </ScrollView>
      ) : loading && items.length === 0 ? (
        <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: thumbInset }}>
        {routeHeader}
        <View style={styles.skeletonList}>
          <Text style={styles.loadingText}>{s.routes.searching}</Text>
          <View style={styles.skelCard}>
            <View style={styles.skelRow}>
              <View style={[styles.skel, { width: 96, height: 22 }]} />
              <View style={[styles.skel, { width: 56, height: 24, borderRadius: shape.full }]} />
            </View>
            <View style={[styles.skel, { width: '70%', height: 12, marginTop: 10 }]} />
            <View style={[styles.skel, { width: '100%', height: 4, marginTop: 12, borderRadius: 2 }]} />
            <View style={[styles.skel, { width: '55%', height: 28, marginTop: 12, borderRadius: shape.small }]} />
          </View>
          <View style={styles.skelCard}>
            <View style={styles.skelRow}>
              <View style={[styles.skel, { width: 84, height: 22 }]} />
              <View style={[styles.skel, { width: 56, height: 24, borderRadius: shape.full }]} />
            </View>
            <View style={[styles.skel, { width: '62%', height: 12, marginTop: 10 }]} />
            <View style={[styles.skel, { width: '100%', height: 4, marginTop: 12, borderRadius: 2 }]} />
            <View style={[styles.skel, { width: '72%', height: 28, marginTop: 12, borderRadius: shape.small }]} />
          </View>
          <View style={[styles.skelCard, { opacity: 0.55 }]}>
            <View style={styles.skelRow}>
              <View style={[styles.skel, { width: 72, height: 22 }]} />
              <View style={[styles.skel, { width: 56, height: 24, borderRadius: shape.full }]} />
            </View>
            <View style={[styles.skel, { width: '50%', height: 12, marginTop: 10 }]} />
          </View>
        </View>
        </ScrollView>
      ) : loadError ? (
        <ScrollView contentContainerStyle={{ flexGrow: 1, paddingHorizontal: 16, paddingBottom: thumbInset }}>
        {routeHeader}
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
              onPress={() => fetchRoutes(targetTimeSec)}
              style={({ pressed }) => [styles.retryBtn, pressed && { opacity: 0.8 }]}
            >
              <Text style={styles.retryText}>{s.common.retry}</Text>
            </Pressable>
          )}
        </View>
        </ScrollView>
      ) : (
        <FlatList
          ref={listRef}
          accessibilityState={{ busy: loading }}
          pointerEvents={loading ? 'none' : 'auto'}
          refreshControl={
            arrivalMode || noMoreEarlier || offline ? undefined :
            <RefreshControl
              refreshing={loadingEarlier}
              onRefresh={handlePullEarlier}
              enabled={!loading && !loadingMore && !noMoreEarlier && !offline}
              title={s.routes.earlierAction}
              titleColor={scheme.onSurfaceVariant}
              tintColor={scheme.primary}
              colors={[scheme.primary]}
              progressBackgroundColor={scheme.surfaceContainerHigh}
            />
          }
          data={displayed}
          maintainVisibleContentPosition={{ minIndexForVisible: 0, autoscrollToTopThreshold: 80 }}
          alwaysBounceVertical={!arrivalMode}
          initialNumToRender={8}
          maxToRenderPerBatch={8}
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
          renderItem={renderConnection}
          ListHeaderComponent={
            <>
            {routeHeader}
            <View style={styles.countRow}>
              {loading && <ActivityIndicator size="small" color={scheme.primary} accessibilityLabel={s.routes.searching} />}
              <Text style={styles.count} numberOfLines={1}>
                {connectionsLabel(displayed.length)} • {isCustomTime ? (arrivalMode ? timeLabel : s.routes.countDepart(timeLabel)) : s.routes.countNearest}
                {directOnly ? s.routes.countDirect : ''}
                {modeFilter === 'tram' ? s.routes.countTram : modeFilter === 'bus' ? s.routes.countBus : ''}
              </Text>
              {offline && (
                <Pressable
                  onPress={() => quietRefresh()}
                  style={({ pressed }) => [styles.offlineChip, pressed && { opacity: 0.7 }]}
                  hitSlop={6}
                  accessibilityRole="button"
                  accessibilityLabel={s.routes.offlineTapA11y}
                >
                  <CloudOff size={14} color={scheme.onSurfaceVariant} />
                  <Text style={styles.offlineText}>{s.routes.offlineChip}</Text>
                </Pressable>
              )}
              {liveStale && !offline && (
                <View style={styles.offlineChip}>
                  <CloudOff size={14} color={scheme.onSurfaceVariant} />
                  <Text style={styles.offlineText}>{s.routes.noLiveChip}</Text>
                </View>
              )}
            </View>
            {!arrivalMode && !offline && (
              <Pressable
                onPress={handlePullEarlier}
                onFocus={() => setEarlierFocused(true)}
                onBlur={() => setEarlierFocused(false)}
                disabled={earlierDisabled}
                accessibilityRole="button"
                accessibilityState={{ busy: loadingEarlier, disabled: earlierDisabled }}
                style={({ pressed }) => [
                  styles.earlierButton,
                  earlierFocused && styles.earlierFocused,
                  pressed && { opacity: 0.75 },
                ]}
              >
                {loadingEarlier ? (
                  <ActivityIndicator size="small" color={scheme.onSurfaceVariant} />
                ) : !noMoreEarlier ? (
                  <ChevronUp size={18} color={scheme.onSurfaceVariant} />
                ) : null}
                <Text style={styles.earlierText} accessibilityLiveRegion="polite">
                  {loadingEarlier
                    ? s.routes.earlierLoading
                    : noMoreEarlier
                      ? s.routes.earlierEmpty
                      : earlierFailed
                        ? s.routes.earlierRetry
                        : s.routes.earlierAction}
                </Text>
              </Pressable>
            )}
            </>
          }
          // Stopka mówi wprost, co się dzieje na końcu listy: trwa doładowanie,
          // nic więcej nie ma albo doładowanie padło. Wcześniej jedyne co było
          // widać, to spinner, a po błędzie - nic, czyli lista po cichu
          // przestawała się dociągać.
          // Stopka niczego nie dokłada, dopóki nie ma czego powiedzieć-
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
                  <Text style={styles.footerText}>{arrivalMode ? s.routes.noMoreArrival : s.routes.noMore}</Text>
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
                      : arrivalMode ? s.routes.emptyArrival : s.routes.emptyPlain}
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
          initialTimeSec={targetTimeSec}
          initialMode={timeMode}
          onClose={() => setTimeSheetOpen(false)}
          onSelect={handleTimeSelect}
        />
      )}

      {/* 5. Wyszukiwarka startu / celu - ta sama co na ekranie głównym */}
      {sheetFor && (
        <SearchSheet
          placeholder={sheetFor === 'from' ? s.home.searchPlaceholderFrom : s.home.searchPlaceholderTo}
          query={query}
          loading={searchLoading}
          error={searchError}
          results={results}
          recent={sheetFor === 'from' ? recentWithGps : recent}
          savedQuick={savedQuick}
          notice={sheetFor === 'from' && gpsOutside ? s.search.gpsOutsideNotice : undefined}
          onQuery={setQuery}
          onSelect={handleSuggestionSelect}
          onClose={() => {
            setSheetFor(null);
            setQuery('');
          }}
        />
      )}

      {/* 6. Dolne menu - filtry i akcje pod kciukiem (swap, bezpośr.,
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
          arrivalMode={arrivalMode}
          onOpenTimeSheet={() => setTimeSheetOpen(true)}
          modeFilter={modeFilter}
          onCycleMode={handleCycleMode}
        />
      )}
      {preview && <ConnectionPeek
        item={preview.item}
        sticky={preview.sticky}
        ready={previewReady}
        offline={offline || liveStale}
        onClose={closePreview}
        onOpen={() => openConnection(preview.item)}
      />}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  earlierButton: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    padding: 12,
    borderRadius: shape.medium,
    borderWidth: 2,
    borderColor: 'transparent',
    marginBottom: 8,
  },
  earlierFocused: { borderColor: scheme.primary },
  earlierText: {
    ...type.labelLarge,
    color: scheme.onSurfaceVariant,
    flexShrink: 1,
    textAlign: 'center',
  },
  safe: { flex: 1, backgroundColor: scheme.surface },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  back: {
    width: 48,
    height: 48,
    borderRadius: shape.medium,
    alignItems: 'center',
    justifyContent: 'center',
  },
  screenTitle: {
    flex: 1,
    ...type.titleMedium,
    fontWeight: '500',
    color: scheme.onSurface,
  },
  // Karta aktywnej podróży nad listą połączeń
  activeTripSlot: { paddingHorizontal: 14, paddingBottom: 12 },
  // Dopiska kotwicy pod tytułem startu: ta sama typografia co nagłówek,
  // tylko mniejsza i w kolorze primary - zero pigułek, zero tła.
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
  // Cichy X bez kółka - dopiska ma wyglądać jak tekst, nie jak chip.
  anchorX: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  routeHeader: {
    marginTop: 4,
    marginBottom: 16,
  },

  countRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 8,
    marginBottom: 12,
    paddingHorizontal: 4,
  },
  count: {
    ...type.labelMedium,
    color: scheme.onSurfaceVariant,
    flexShrink: 1,
  },
  list: {
    paddingHorizontal: 16,
    gap: 12,
  },
  footer: { paddingVertical: 18, alignItems: 'center', gap: 10 },
  footerText: { ...type.bodySmall, color: scheme.onSurfaceVariant, textAlign: 'center' },
  skeletonList: {
    flex: 1,
    paddingHorizontal: 14,
    paddingTop: 8,
    gap: 10,
  },
  skelCard: {
    backgroundColor: scheme.surfaceContainer,
    borderRadius: shape.large,
    padding: 14,
    ...elev.level1,
  },
  skelRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  skel: {
    backgroundColor: scheme.surfaceContainerHighest,
    borderRadius: shape.small,
  },
  loadingText: {
    ...type.labelLarge,
    fontWeight: '600',
    color: scheme.onSurfaceVariant,
    marginBottom: 4,
    paddingHorizontal: 4,
  },
  emptyContainer: {
    paddingHorizontal: 28,
    paddingVertical: 40,
    alignItems: 'center',
    gap: 10,
  },
  emptyTitle: {
    ...type.titleMedium,
    fontWeight: '700',
    color: scheme.onSurface,
    textAlign: 'center',
  },
  emptySub: {
    ...type.bodyMedium,
    color: scheme.onSurfaceVariant,
    textAlign: 'center',
    lineHeight: 20,
    maxWidth: 320,
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
    minHeight: 44,
    flexShrink: 1,
  },
  offlineText: {
    ...type.bodySmall,
    color: scheme.onSurfaceVariant,
  },
});
