import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, AppState, PanResponder, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useSharedValue, withTiming } from 'react-native-reanimated';
import { Bell, History, Settings2 } from 'lucide-react-native';
import { elev, scheme, shape, type } from '../src/theme/tokens';
import { useStrings } from '../src/i18n';
import { DEFAULT_LOCATION } from '../src/config';
import { FavoritesService, LocationService, RoutingService, SearchService, recordTripSearch, type LocationResult } from '../src/services';
import { liveTracker } from '../src/services/liveTracker';
import { isOutsideServiceArea } from '../src/services/serviceArea';
import {
  type DataStatus,
  getDataStatus,
  importGtfsFromNetwork,
  refreshDataStatus,
  subscribeDataStatus,
} from '../src/services/dataManager';
import { getSettingsSync } from '../src/services/settings';
import { subscribeBackupApplied } from '../src/services/backup';
import { loadCachedSmartDestinations, loadTripHistory, saveCachedSmartDestinations, type TripHistoryItem } from '../src/services/smartRanker';

import {
  buildRoutesLink,
  connectionToWidgetNext,
  mergeWidgetSnapshot,
  type WidgetQuickItem,
} from '../src/services/widgetSnapshot';
import type { Connection, LegMode, SavedPlace, SmartDestination, Suggestion } from '../src/types/models';
import { SavedPlacesRow, SAVED_PLACE_ICONS } from '../src/components/SavedPlacesRow';
import { getSuggestionIconMeta, type SuggestionIconMeta } from '../src/components/SuggestionRow';
import { HomeThumbBar } from '../src/components/HomeThumbBar';
import { useThumbBarInset } from '../src/components/ThumbBar';
import {
  LAST_TRIP_ARM_1,
  LAST_TRIP_ARM_2,
  LAST_TRIP_DISARM_2,
  LAST_TRIP_MAX,
  LastTripPull,
  type LastTripOption,
} from '../src/components/LastTripPull';
import { SearchSheet } from '../src/components/SearchSheet';
import { SmartHistoryList } from '../src/components/SmartHistoryList';
import { AddPlaceSheet } from '../src/components/AddPlaceSheet';
import { ManagePlacesSheet } from '../src/components/ManagePlacesSheet';
import { UnsupportedCityCard } from '../src/components/UnsupportedCityCard';

export default function HomeScreen() {
  const s = useStrings();
  const router = useRouter();
  const GPS_ITEM: Suggestion = {
    id: '__gps',
    title: s.home.gpsTitle,
    address: s.home.gpsAddressHome,
    kind: 'history',
    lat: 0,
    lon: 0,
  };
  const [saved, setSaved] = useState<SavedPlace[]>([]);
  const [smart, setSmart] = useState<SmartDestination[]>([]);
  // Prawdziwa pustka vs ładowanie: pusty stan pokazujemy dopiero, gdy świeży
  // ranking (albo błąd GPS) potwierdzi brak danych — inaczej migałby przed GPS.
  const [smartReady, setSmartReady] = useState(false);
  const [sheetMode, setSheetMode] = useState<'destination' | 'start' | null>(null);
  const [returnToDestinationAfterStart, setReturnToDestinationAfterStart] = useState(false);
  // Zapas na dole zamiast wpisanych 90 px — wysokość paska kciuka mierzy się
  // w trakcie layoutu, a na telefonach z paskiem nawigacji jest wyższy.
  const thumbInset = useThumbBarInset();
  const [gpsLocation, setGpsLocation] = useState<{ lat: number; lon: number; title: string; city?: string | null } | null>(null);
  const [isCustomStart, setIsCustomStart] = useState(false);
  // Ref dla asynchronicznych fixów GPS: nie mogą nadpisać ręcznie wybranego startu.
  const isCustomStartRef = useRef(isCustomStart);
  isCustomStartRef.current = isCustomStart;
  // GPS poza strefą (> 15 km od Wrocławia): tras z GPS nie liczymy,
  // start trzeba wybrać ręcznie. Miasto z reverse-geocode do komunikatu.
  const [gpsUnsupported, setGpsUnsupported] = useState(false);
  const [gpsCity, setGpsCity] = useState<string | null>(null);
  const [addPlaceOpen, setAddPlaceOpen] = useState(false);
  const [manageSheetOpen, setManageSheetOpen] = useState(false);
  const [editingPlace, setEditingPlace] = useState<SavedPlace | null>(null);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Suggestion[]>([]);
  const [recent, setRecent] = useState<Suggestion[]>([]);
  const [loading, setLoading] = useState(false);
  const [locTitle, setLocTitle] = useState(DEFAULT_LOCATION.title);
  const [currentCoords, setCurrentCoords] = useState<{ lat: number; lon: number }>({
    lat: DEFAULT_LOCATION.lat,
    lon: DEFAULT_LOCATION.lon,
  });
  const [nextDepart, setNextDepart] = useState<Record<string, number>>({});
  const [firstConns, setFirstConns] = useState<Record<string, Connection>>({});
  const [firstLegs, setFirstLegs] = useState<Record<string, { mode?: LegMode; line?: string }>>({});
  // Generacja wyszukiwania tras w tle — przerwanie (np. użytkownik zaczął
  // własną trasę) to po prostu podbicie licznika, pętla sama się zatrzyma.
  const routeSearchGen = useRef(0);
  // Ostatni origin dogrzewania — reset prawych stron tylko przy jego zmianie.
  const lastOriginRef = useRef<string | null>(null);
  const [dataStatus, setDataStatus] = useState<DataStatus>(getDataStatus());
  const [newsAlert, setNewsAlert] = useState(false);

  // Szybki skrót pull-to-refresh do ostatniego połączenia: pełna obsługa
  // gestem, zero klikalnych elementów. pullOption żyje w stanie (oduswitch
  // tekstu/strzałki), wysokość reveal w shared value (płynnie, bez rerenderów).
  const [lastTrip, setLastTrip] = useState<TripHistoryItem | null>(null);
  const [pullOption, setPullOption] = useState<LastTripOption>(0);
  const [scrollLocked, setScrollLocked] = useState(false);
  const pullHeight = useSharedValue(0);
  const atTopRef = useRef(true);
  const optionRef = useRef<LastTripOption>(0);
  const lastTripRef = useRef<TripHistoryItem | null>(null);
  lastTripRef.current = lastTrip;
  const sheetsOpenRef = useRef(false);
  sheetsOpenRef.current = sheetMode !== null || manageSheetOpen || addPlaceOpen;

  useEffect(() => {
    return subscribeDataStatus(setDataStatus);
  }, []);

  // Badge na dzwonku: dzisiejsze pilne utrudnienie MPK (RSS wroclaw.pl).
  // Sprawdzamy przy starcie i powrocie na foreground — bez interwału, żeby nie spamować feedu.
  useEffect(() => {
    let cancelled = false;
    const checkNews = async () => {
      try {
        const { fetchMpkNews, shouldShowNewsAlert } = await import('../src/services/mpkNews');
        const news = await fetchMpkNews();
        const alert = await shouldShowNewsAlert(news);
        if (!cancelled) setNewsAlert(alert);
      } catch {
        // brak internetu / błąd RSS — badge po prostu znika, bez krzykliwego błędu
      }
    };
    void checkNews();
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') void checkNews();
    });
    return () => {
      cancelled = true;
      sub.remove();
    };
  }, []);

  // Weryfikacja badge'a przy powrocie na ekran główny (np. po wyjściu z sekcji newsów)
  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      const verify = async () => {
        try {
          const { getCachedNews, shouldShowNewsAlert } = await import('../src/services/mpkNews');
          const cached = getCachedNews();
          if (cached) {
            const alert = await shouldShowNewsAlert(cached);
            if (!cancelled) setNewsAlert(alert);
          }
        } catch {}
      };
      void verify();
      return () => {
        cancelled = true;
      };
    }, [])
  );

  // Status danych: przy starcie, powrocie na foreground i co 30 s.
  // refreshDataStatus ładuje status lokalnego GTFS — jeśli pusty, automatycznie
  // uruchamiamy pobieranie rozkładu, aby aplikacja działała bez serwera dev.
  useEffect(() => {
    let cancelled = false;
    const check = async () => {
      const st = await refreshDataStatus().catch(() => ({ state: 'empty' } as const));
      if (st.state === 'empty') {
        void importGtfsFromNetwork().catch((e) => console.warn('Auto import GTFS failed:', e));
      }
    };
    void check();
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') void check();
    });
    const timer = setInterval(check, 30000);
    return () => {
      cancelled = true;
      sub.remove();
      clearInterval(timer);
    };
  }, []);

  const refreshPlaces = () => {
    FavoritesService.list().then(setSaved);
  };

  // Świeży ranking zapisujemy do cache, żeby następny start namalował
  // gołe ostatnie miejsca natychmiast (bez czekania na GPS).
  const applySmart = useCallback((list: SmartDestination[]) => {
    setSmart(list);
    setSmartReady(true);
    void saveCachedSmartDestinations(list);
  }, []);

  useEffect(() => {
    refreshPlaces();
    SearchService.recent().then(setRecent);
    loadTripHistory().then((h) => {
      if (h.length > 0) setLastTrip(h[0]);
    });
    // Instant: gołe ostatnie miejsca z cache malujemy od razu, zanim GPS
    // w ogóle odpowie. Świeży ranking zamieni je w miejscu (stabilne klucze
    // + layout-animacja w liście — bez flickeru).
    loadCachedSmartDestinations().then((cached) => {
      if (cached.length > 0) setSmart(cached);
    });
    // Live GPS od startu (ticker w tle) — opóźnienia gotowe zanim user wyszuka trasę.
    liveTracker.start();

    // Jeden sposób aplikowania fixu: pierwszy szybki odczyt i każdy późniejszy
    // (dokładniejszy w tle) przechodzą tędy, żeby ranking i start tras zawsze
    // używały najlepszej znanej pozycji.
    const applyGpsFix = (l: LocationResult) => {
      const outside = isOutsideServiceArea(l.lat, l.lon);
      const city = l.city ?? null;
      setGpsLocation({ lat: l.lat, lon: l.lon, title: l.title, city });
      if (outside) {
        // Poza Wrocławiem: GPS zostaje tylko jako informacja do karty,
        // a ranking i trasy liczymy z centrum — start i tak trzeba
        // wybrać ręcznie, więc nie podstawiamy pozycji spoza strefy.
        setGpsUnsupported(true);
        setGpsCity(city);
        if (!isCustomStartRef.current) {
          FavoritesService.smartFromOrigin(DEFAULT_LOCATION.title, {
            lat: DEFAULT_LOCATION.lat,
            lon: DEFAULT_LOCATION.lon,
          }).then(applySmart);
        }
        return;
      }
      setGpsUnsupported(false);
      setGpsCity(null);
      if (isCustomStartRef.current) return;
      setLocTitle(l.title);
      const coords = { lat: l.lat, lon: l.lon };
      setCurrentCoords(coords);
      FavoritesService.smartFromOrigin(l.stopId || l.title, coords).then(applySmart);
    };

    LocationService.getCurrentLocation().then(applyGpsFix).catch(() => {
      // Brak GPS (brak zgody / emulator): lista zostaje z cache, a flaga
      // gotowości pozwala pokazać uczciwy pusty stan zamiast wiecznej dziury.
      setSmartReady(true);
    });
    const unsubscribeGps = LocationService.subscribe(applyGpsFix);
    // eslint-disable-next-line react-hooks/exhaustive-deps
    return () => unsubscribeGps();
  }, []);

  // Po zakończeniu importu GTFS aktualizujemy odjazdy
  useEffect(() => {
    if (dataStatus.state === 'ready') {
      refreshPlaces();
      if (!isCustomStart) {
        LocationService.getCurrentLocation().then((l) => {
          if (isOutsideServiceArea(l.lat, l.lon)) return;
          const coords = { lat: l.lat, lon: l.lon };
          FavoritesService.smartFromOrigin(l.stopId || l.title, coords).then(applySmart);
        });
      } else {
        FavoritesService.smartFromOrigin(locTitle, currentCoords).then(applySmart);
      }
    }
  }, [dataStatus.state, isCustomStart, locTitle, currentCoords]);

  // Po jednej trasie do każdego ostatniego miejsca, sekwencyjnie od góry do dołu
  // (kolejność = kolejność wyświetlania, najlepszy na górze). Każdy wynik
  // doklejamy od razu — prawa strona wiersza pojawia się z animacją.
  // Przerwanie własnym szukaniem: podbicie routeSearchGen unieważnia pętlę.
  useEffect(() => {
    if (smart.length === 0) {
      setNextDepart({});
      setFirstConns({});
      setFirstLegs({});
      return;
    }
    const gen = ++routeSearchGen.current;
    let cancelled = false;
    // Prawe strony czyścimy TYLKO przy zmianie originu (inne współrzędne /
    // tytuł startu) — żeby stare odjazdy nie wisiały przy nowej lokalizacji.
    // Przy samej zamianie listy (cache → świeży ranking, reorder) przycinamy
    // jedynie wpisy znikniętych celów, a reszta dokleja się po kolei bez
    // mrugnięcia całością naraz.
    const originKey = `${locTitle}|${currentCoords.lat},${currentCoords.lon}`;
    if (lastOriginRef.current !== originKey) {
      lastOriginRef.current = originKey;
      setNextDepart({});
      setFirstConns({});
      setFirstLegs({});
    } else {
      const ids = new Set(smart.map((d) => d.id));
      const prune = <T,>(prev: Record<string, T>): Record<string, T> => {
        let changed = false;
        const next = { ...prev };
        for (const k of Object.keys(next)) {
          if (!ids.has(k)) {
            delete next[k];
            changed = true;
          }
        }
        return changed ? next : prev;
      };
      setNextDepart(prune);
      setFirstConns(prune);
      setFirstLegs(prune);
    }
    const s = getSettingsSync();
    void (async () => {
      for (const d of smart) {
        if (cancelled || routeSearchGen.current !== gen) return;
        try {
          const conns = await RoutingService.getConnections({
            fromTitle: locTitle,
            fromLat: currentCoords.lat,
            fromLon: currentCoords.lon,
            toId: d.id,
            toTitle: d.title,
            toLat: d.lat,
            toLon: d.lon,
            maxTransfers: s.maxTransfers,
            minTransferSec: s.minTransferSec,
            trainsEnabled: s.trainsEnabled,
            trainMinTransferSec: s.trainMinTransferSec,
            maxWalkM: s.maxWalkM,
            walkSpeedMps: s.walkSpeedMps,
          });
          if (cancelled || routeSearchGen.current !== gen) return;
          const first = conns.length ? conns[0] : undefined;
          if (!first) continue;
          setNextDepart((prev) =>
            prev[d.id] === first.departInMin ? prev : { ...prev, [d.id]: first.departInMin },
          );
          setFirstConns((prev) => ({ ...prev, [d.id]: first }));
          const transitLeg = first.legs.find((l) => l.mode !== 'walk' && l.line);
          if (transitLeg?.line) {
            const badge = { mode: transitLeg.mode, line: transitLeg.line };
            setFirstLegs((prev) => ({ ...prev, [d.id]: badge }));
          }
        } catch {
          // Brak trasy do tego celu — wiersz zostaje bez prawej strony.
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [smart, currentCoords, locTitle]);

  // Użytkownik zaczął szukać własnej trasy — tniemy dogrzewanie ostatnich
  // miejsc i skupiamy silnik tylko na trasie wybranej przez użytkownika.
  useEffect(() => {
    if (sheetMode !== null) routeSearchGen.current++;
  }, [sheetMode]);

  // Snapshot dla widgetów z ekranu głównego (next / szybkie cele / przypięte).
  useEffect(() => {
    if (isCustomStart) return;
    let cancelled = false;
    const from = { title: locTitle, lat: currentCoords.lat, lon: currentCoords.lon };
    const withConns = smart.filter((d) => firstConns[d.id]);
    const ranked = [...withConns].sort(
      (a, b) => (firstConns[a.id].departureSec - firstConns[b.id].departureSec),
    );
    const best = ranked.length ? firstConns[ranked[0].id] : null;
    const bestDest = ranked[0];
    const quick: WidgetQuickItem[] = ranked.slice(0, 3).map((d) => ({
      id: d.id,
      title: d.title,
      departInMin: firstConns[d.id].departInMin,
      deepLink: buildRoutesLink({
        fromTitle: from.title,
        fromLat: from.lat,
        fromLon: from.lon,
        toId: d.id,
        toTitle: d.title,
        toLat: d.lat,
        toLon: d.lon,
      }),
    }));

    // Sekcję `pinned` w snapshocie widgetów pisze teraz monitor podróży
    // (src/services/notifications) — ma już przeliczony plan i godziny, więc
    // nie dublujemy tu zapytania do RAPTOR-a. Home odpowiada tylko za `next`
    // i `quick`, i robi to merge'em, żeby go nie wyzerować.
    if (cancelled) return;
    void mergeWidgetSnapshot({
      next: best && bestDest ? connectionToWidgetNext(best, from, bestDest) : null,
      quick,
    });
    return () => {
      cancelled = true;
    };
    // firstConns zmienia referencję razem z nextDepart — snapshot po świeżych danych.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [firstConns, locTitle]);

  // Ostatnie przejazdy w identycznej kolejności co na ekranie głównym (smart history)
  const recentFromSmart: Suggestion[] = useMemo(() => {
    const list: Suggestion[] = smart.map((s) => ({
      id: s.id,
      title: s.title,
      address: s.address,
      kind: 'history',
      lat: s.lat,
      lon: s.lon,
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
  // `smart` z rankera jest już posortowane malejąco po wyniku — nie odwracamy.
  const smartOrdered = smart;

  // Ikonki jak w wyszukiwarce: zapisane miejsce → jego ikona,
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

  // GPS spoza strefy nie może być startem trasy — zamiast nawigacji
  // pokazujemy wyjaśnienie i otwieramy ręczny wybór punktu startowego.
  const blockGpsStart = () => {
    Alert.alert(
      s.home.gpsBlockedTitle,
      gpsCity ? s.home.gpsBlockedBody(gpsCity) : s.home.gpsBlockedBodyUnknown,
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
  };

  const resetToGps = async () => {
    if (gpsUnsupported) {
      blockGpsStart();
      return;
    }
    setIsCustomStart(false);
    if (gpsLocation) {
      setLocTitle(gpsLocation.title);
      const coords = { lat: gpsLocation.lat, lon: gpsLocation.lon };
      setCurrentCoords(coords);
      FavoritesService.smartFromOrigin(gpsLocation.title, coords).then(applySmart);
    }
    try {
      const l = await LocationService.getCurrentLocation({ force: true });
      const outside = isOutsideServiceArea(l.lat, l.lon);
      const city = (l as { city?: string | null }).city ?? null;
      setGpsLocation({ lat: l.lat, lon: l.lon, title: l.title, city });
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
      FavoritesService.smartFromOrigin(l.stopId || l.title, coords).then(applySmart);
    } catch (err) {
      console.warn('[resetToGps] błąd pobierania pozycji GPS:', err);
    }
  };

  const handleStartSelect = async (sel: Suggestion) => {
    setQuery('');
    if (sel.id === GPS_ITEM.id) {
      if (gpsUnsupported) {
        // Pozycja GPS spoza strefy: nie zamykamy arkusza, żeby użytkownik
        // od razu wybrał punkt ręcznie; sam alert by go wyrzucał z flow.
        Alert.alert(
          s.home.gpsBlockedTitle,
          gpsCity ? s.home.gpsBlockedBody(gpsCity) : s.home.gpsBlockedBodyUnknown,
        );
        setQuery('');
        return;
      }
      await resetToGps();
      if (returnToDestinationAfterStart) {
        setReturnToDestinationAfterStart(false);
        setSheetMode('destination');
      } else {
        setSheetMode(null);
      }
      return;
    }

    setIsCustomStart(true);
    setLocTitle(sel.title);
    const coords = { lat: sel.lat, lon: sel.lon };
    setCurrentCoords(coords);
    FavoritesService.smartFromOrigin(sel.id || sel.title, coords).then(applySmart);
    void SearchService.recordRecent(sel).then(() => {
      SearchService.recent().then(setRecent);
    });

    if (returnToDestinationAfterStart) {
      setReturnToDestinationAfterStart(false);
      setSheetMode('destination');
    } else {
      setSheetMode(null);
    }
  };

  // Debounced search. searchSeq unieważnia odpowiedzi starszych zapytań
  // w momencie zmiany tekstu — inaczej wolniejsze „d” kasowało wynik „dw”.
  const searchSeq = useRef(0);
  useEffect(() => {
    if (!sheetMode) return;
    const q = query.trim();
    const seq = ++searchSeq.current;
    if (!q) {
      setResults([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const t = setTimeout(() => {
      SearchService.search(q, currentCoords, 'home-sheet')
        .then((r) => {
          if (seq !== searchSeq.current) return;
          setResults(r);
          setLoading(false);
        })
        .catch(() => {
          // Przerwane zapytanie albo błąd — nowsze zapytanie ogarnie stan.
          if (seq === searchSeq.current) setLoading(false);
        });
    }, 220);
    return () => clearTimeout(t);
  }, [query, sheetMode, currentCoords]);

  const quick = useMemo<Suggestion[]>(
    () =>
      saved.slice(0, 3).map((s) => ({
        id: s.placeId,
        title: s.name,
        address: s.address,
        kind: 'history',
        lat: s.lat,
        lon: s.lon,
      })),
    [saved],
  );

  // Tap w prawą część wiersza: od razu do ekranu tego konkretnego połączenia
  // (detail czyta je z podręcznego cache RoutingService — ten sam proces).
  const goToConnection = (d: SmartDestination) => {
    const conn = firstConns[d.id];
    routeSearchGen.current++;
    if (conn) {
      void recordTripSearch(currentCoords.lat, currentCoords.lon, locTitle, d);
      router.push({ pathname: '/routes/[id]', params: { id: conn.id } });
      return;
    }
    goToRoutes(d);
  };

  const goToRoutes = (to: { id: string; title: string; address?: string; lat: number; lon: number }) => {
    // GPS spoza strefy nie może być startem: zamiast puszczać trasę
    // z pozycji spoza Wrocławia prosimy o ręczny wybór startu.
    if (gpsUnsupported && !isCustomStart) {
      blockGpsStart();
      return;
    }
    // Własna trasa użytkownika ma priorytet — stopujemy dogrzewanie reszty.
    routeSearchGen.current++;
    void recordTripSearch(currentCoords.lat, currentCoords.lon, locTitle, to);
    void SearchService.recordRecent(to as Suggestion).then(() => {
      SearchService.recent().then(setRecent);
    });
    router.push({
      pathname: '/routes',
      params: {
        fromTitle: locTitle,
        fromLat: String(currentCoords.lat),
        fromLon: String(currentCoords.lon),
        // Start z GPS: ekran tras może go po cichu podmienić na dokładniejszy fix.
        fromGps: isCustomStart ? '0' : '1',
        toId: to.id,
        toTitle: to.title,
        toLat: String(to.lat),
        toLon: String(to.lon),
      },
    });
  };

  // Otwarcie ostatniego połączenia z pulla: start bierzemy z zapisanej
  // trasy (nie z bieżącego GPS), żeby skrót odtwarzał dokładnie to połączenie.
  const openLastTrip = useCallback(
    (reversed: boolean) => {
      const t = lastTripRef.current;
      if (!t) return;
      routeSearchGen.current++;
      const fromTitle = reversed ? t.dest_title : t.origin_title;
      const fromLat = reversed ? t.dest_lat : t.origin_lat;
      const fromLon = reversed ? t.dest_lon : t.origin_lon;
      const to = reversed
        ? { id: t.origin_title, title: t.origin_title, lat: t.origin_lat, lon: t.origin_lon }
        : { id: t.dest_id, title: t.dest_title, address: t.dest_address, lat: t.dest_lat, lon: t.dest_lon };
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

  // Pull jak na Twitterze, ale zamiast spinnera: ostatnie połączenie + toggle.
  // Capture (rodzic pierwszy), żeby ScrollView nie zabrał gestu; bierzemy tylko
  // zdecydowane pociągnięcia w dół z samej góry, przy zamkniętych arkuszach.
  const pullResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponderCapture: (_, g) =>
        !sheetsOpenRef.current &&
        lastTripRef.current != null &&
        atTopRef.current &&
        g.dy > 12 &&
        Math.abs(g.dy) > Math.abs(g.dx) * 1.4,
      onPanResponderGrant: () => setScrollLocked(true),
      onPanResponderMove: (_, g) => {
        const h = Math.max(0, Math.min(LAST_TRIP_MAX, g.dy));
        pullHeight.value = h;
        const cur = optionRef.current;
        let next: LastTripOption = cur;
        if (h >= LAST_TRIP_ARM_2) next = 2;
        else if (cur === 2) next = h >= LAST_TRIP_DISARM_2 ? 2 : h >= LAST_TRIP_ARM_1 ? 1 : 0;
        else next = h >= LAST_TRIP_ARM_1 ? 1 : 0;
        if (next !== cur) {
          optionRef.current = next;
          setPullOption(next);
        }
      },
      onPanResponderTerminationRequest: () => false,
      onPanResponderRelease: () => {
        const opt = optionRef.current;
        optionRef.current = 0;
        setPullOption(0);
        pullHeight.value = withTiming(0, { duration: 220 });
        setScrollLocked(false);
        if (opt === 1) openLastTrip(false);
        else if (opt === 2) openLastTrip(true);
      },
      onPanResponderTerminate: () => {
        optionRef.current = 0;
        setPullOption(0);
        pullHeight.value = withTiming(0, { duration: 220 });
        setScrollLocked(false);
      },
    }),
  ).current;

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
  }) => {
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
      Alert.alert(
        s.home.saveFailTitle,
        s.home.saveFailBody,
      );
      return;
    }
    refreshPlaces();
    FavoritesService.smartFromOrigin(locTitle, currentCoords).then(applySmart);
  };

  const handleDeletePlace = async (id: string) => {
    await FavoritesService.deletePlace(id);
    refreshPlaces();
    FavoritesService.smartFromOrigin(locTitle, currentCoords).then(applySmart);
  };

// Ostatnie połączenie świeże po powrocie (pull może odpalić nową trasę).
  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      loadTripHistory().then((h) => {
        if (!cancelled && h.length > 0) setLastTrip(h[0]);
      });
      return () => {
        cancelled = true;
      };
    }, [])
  );

  // Wczytanie kopii zapasowej podmienia miejsca i historię w KV, ale `saved`
  // i `smart` to useState — bez tego powiadomienia ekran pokazywałby stan
  // sprzed importu aż do restartu aplikacji.
  useEffect(() => subscribeBackupApplied(() => {
    refreshPlaces();
    // Ranking liczymy tylko przy znanej pozycji: `smartFromOrigin` i tak
    // podpada pod DEFAULT_LOCATION, a „ostatnie miejsca" z innego miasta
    // to kłamstwo.
    if (currentCoords) {
      FavoritesService.smartFromOrigin(locTitle, currentCoords).then(applySmart);
    }
  }), [currentCoords, locTitle, applySmart]);

  return (
    <View style={styles.root} {...pullResponder.panHandlers}>
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScrollView
          contentContainerStyle={styles.body}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          overScrollMode="never"
          scrollEnabled={!scrollLocked}
          scrollEventThrottle={16}
          onScroll={(e) => {
            atTopRef.current = e.nativeEvent.contentOffset.y <= 1;
          }}
        >
          {lastTrip && <LastTripPull trip={lastTrip} option={pullOption} height={pullHeight} />}
          <View style={styles.topBar}>
            <Text style={styles.headerTitle}>{s.home.title}</Text>
            <View style={styles.topActions}>
              <Pressable
                style={styles.iconBtn}
                hitSlop={10}
                onPress={() => {
                  setNewsAlert(false);
                  void import('../src/services/mpkNews').then(({ markNewsSeen }) => markNewsSeen());
                  router.push('/news');
                }}
                accessibilityLabel={newsAlert ? s.home.newsAlertA11y : s.home.newsA11y}
                accessibilityRole="button"
              >
                <Bell size={20} color={scheme.onSurfaceVariant} />
                {newsAlert && (
                  <View style={styles.alertBadge}>
                    <Text style={styles.alertMark}>!</Text>
                  </View>
                )}
              </Pressable>
              <Pressable style={styles.iconBtn} hitSlop={10} onPress={() => router.push('/settings')}>
                <Settings2 size={20} color={scheme.onSurfaceVariant} />
              </Pressable>
            </View>
          </View>

          {dataStatus.state === 'downloading' && (
            <View style={styles.importCard}>
              <ActivityIndicator size="small" color={scheme.primary} />
              <View style={{ flex: 1 }}>
                <Text style={styles.importTitle}>{s.home.importingTitle}</Text>
                <Text style={styles.importSub}>{Math.round(dataStatus.progress * 100)}%</Text>
              </View>
            </View>
          )}

          {dataStatus.state === 'importing' && (
            <View style={styles.importCard}>
              <ActivityIndicator size="small" color={scheme.primary} />
              <View style={{ flex: 1 }}>
                <Text style={styles.importTitle}>{dataStatus.step}</Text>
                <Text style={styles.importSub}>{Math.round(dataStatus.progress * 100)}%</Text>
              </View>
            </View>
          )}

          {dataStatus.state === 'error' && (
            <Pressable style={styles.importCardError} onPress={() => void importGtfsFromNetwork()}>
              <Text style={styles.importTitleError}>{s.home.importErrorTitle}</Text>
              <Text style={styles.importSubError}>
                {dataStatus.message}. {dataStatus.hint ?? s.home.importErrorRetry}
              </Text>
            </Pressable>
          )}

          {gpsUnsupported && (
            <UnsupportedCityCard
              city={gpsCity}
              onPickStart={() => {
                setReturnToDestinationAfterStart(false);
                setQuery('');
                setSheetMode('start');
              }}
            />
          )}

          {/* Listy tuż pod nagłówkiem, bez wypychania na dół. */}
          <View style={{ height: 12 }} />

          {/* Wyszukiwarka celu jest tylko w dolnym menu pod kciukiem —
              drugi raz na górze ekranu to ta sama akcja w dwóch miejscach. */}
          {smartOrdered.length === 0 && smartReady ? (
            <View style={styles.emptyCard}>
              <View style={styles.emptyIcon}>
                <History size={20} color={scheme.primary} />
              </View>
              <Text style={styles.emptyTitle}>{s.home.historyEmptyTitle}</Text>
              <Text style={styles.emptyBody}>{s.home.historyEmptyBody}</Text>
              <Pressable
                style={({ pressed }) => [styles.emptyCta, pressed && { opacity: 0.7 }]}
                accessibilityRole="button"
                onPress={() => {
                  setReturnToDestinationAfterStart(false);
                  setQuery('');
                  setSheetMode('destination');
                }}
              >
                <Text style={styles.emptyCtaText}>{s.home.historyEmptyAction}</Text>
              </Pressable>
            </View>
          ) : (
            <SmartHistoryList items={smartOrdered} departures={nextDepart} lineBadges={firstLegs} onSelect={(d) => goToRoutes(d)} onOpenConnection={goToConnection} icons={smartIcons} />
          )}

          <View style={{ height: 20 }} />
          <View style={styles.sectionHeader}>
            <Text style={styles.section}>{s.home.savedTitle}</Text>
          </View>
          <SavedPlacesRow
            places={saved}
            onSelect={(p) => goToRoutes({ id: p.placeId, title: p.name, lat: p.lat, lon: p.lon })}
            onManage={() => setManageSheetOpen(true)}
            onEdit={(p) => {
              setEditingPlace(p);
              setAddPlaceOpen(true);
            }}
          />

          <View style={{ height: thumbInset }} />
        </ScrollView>
      </SafeAreaView>

      {!sheetMode && !manageSheetOpen && !addPlaceOpen && (
        <HomeThumbBar
          onOpenSearch={() => {
            setReturnToDestinationAfterStart(false);
            setQuery('');
            setSheetMode('destination');
          }}
          startTitle={locTitle}
          isCustomStart={isCustomStart}
          onOpenStart={() => {
            setReturnToDestinationAfterStart(false);
            setQuery('');
            setSheetMode('start');
          }}
          onResetStart={() => void resetToGps()}
          gpsUnsupported={gpsUnsupported}
        />
      )}

      {sheetMode && (
        <SearchSheet
          query={query}
          loading={loading}
          results={results}
          recent={sheetMode === 'start' ? recentWithGps : recentFromSmart}
          savedQuick={quick}
          placeholder={sheetMode === 'start' ? s.home.searchPlaceholderFrom : s.home.searchPlaceholderTo}
          originTitle={sheetMode === 'destination' ? locTitle : undefined}
          closeOnSelect={!(sheetMode === 'start' && returnToDestinationAfterStart)}
          notice={sheetMode === 'start' && gpsUnsupported ? s.search.gpsOutsideNotice : undefined}
          onChangeOrigin={
            sheetMode === 'destination'
              ? () => {
                  setReturnToDestinationAfterStart(true);
                  setQuery('');
                  setSheetMode('start');
                }
              : undefined
          }
          onQuery={setQuery}
          onSelect={(s) => {
            if (sheetMode === 'start') {
              handleStartSelect(s);
            } else {
              setSheetMode(null);
              setQuery('');
              goToRoutes({ id: s.id, title: s.title, address: s.address, lat: s.lat, lon: s.lon });
            }
          }}
          onClose={() => {
            setSheetMode(null);
            setReturnToDestinationAfterStart(false);
            setQuery('');
          }}
        />
      )}

      {manageSheetOpen && (
        <ManagePlacesSheet
          places={saved}
          onClose={() => setManageSheetOpen(false)}
          onSelectPlace={(p) => {
            setManageSheetOpen(false);
            goToRoutes({ id: p.placeId, title: p.name, address: p.address, lat: p.lat, lon: p.lon });
          }}
          onEditPlace={(p) => {
            setManageSheetOpen(false);
            setEditingPlace(p);
            setAddPlaceOpen(true);
          }}
          onDeletePlace={handleDeletePlace}
          onAddNew={() => {
            setManageSheetOpen(false);
            setEditingPlace(null);
            setAddPlaceOpen(true);
          }}
        />
      )}

      {addPlaceOpen && (
        <AddPlaceSheet
          initialPlace={editingPlace}
          onClose={() => {
            setAddPlaceOpen(false);
            setEditingPlace(null);
          }}
          onSave={handleSavePlace}
          onDelete={handleDeletePlace}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: scheme.surface },
  safe: { flex: 1 },
  body: { paddingHorizontal: 16, paddingTop: 6, flexGrow: 1 },
  topBar: { flexDirection: 'row', alignItems: 'center', gap: 8, height: 44 },
  topActions: { flexDirection: 'row', alignItems: 'center', gap: 8, marginLeft: 'auto' },
  iconBtn: {
    width: 40,
    height: 40,
    borderRadius: shape.full,
    backgroundColor: scheme.surfaceContainerHigh,
    alignItems: 'center',
    justifyContent: 'center',
  },
  alertBadge: {
    position: 'absolute',
    top: -3,
    right: -3,
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: scheme.error,
    borderWidth: 2,
    borderColor: scheme.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  alertMark: { fontSize: 11, fontWeight: '800', color: scheme.onError, lineHeight: 13 },
  // Nagłówek: pytanie o cel nad wolnym powietrzem.
  headerTitle: { ...type.headlineSmall, fontWeight: '700', color: scheme.onSurface, flex: 1 },
  sectionHeader: {
    marginBottom: 10,
  },
  section: { ...type.titleMedium, color: scheme.onSurface },
  emptyCard: {
    gap: 8,
    marginTop: 12,
    padding: 16,
    backgroundColor: scheme.surfaceContainer,
    borderRadius: shape.large,
    ...elev.level1,
  },
  emptyIcon: {
    width: 44,
    height: 44,
    borderRadius: shape.full,
    backgroundColor: scheme.secondaryContainer,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyTitle: { ...type.titleMedium, color: scheme.onSurface },
  emptyBody: { ...type.bodyMedium, color: scheme.onSurfaceVariant },
  emptyCta: {
    marginTop: 6,
    paddingVertical: 11,
    borderRadius: shape.full,
    backgroundColor: scheme.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyCtaText: { ...type.labelLarge, color: scheme.onPrimary, fontWeight: '700' },
  importCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginTop: 12,
    padding: 12,
    backgroundColor: scheme.surfaceContainerHigh,
    borderRadius: shape.medium,
    ...elev.level1,
  },
  importTitle: {
    ...type.bodyMedium,
    color: scheme.onSurface,
    fontWeight: '600',
  },
  importSub: {
    ...type.labelSmall,
    color: scheme.primary,
    fontWeight: '700',
  },
  importCardError: {
    marginTop: 12,
    padding: 12,
    backgroundColor: scheme.errorContainer,
    borderRadius: shape.medium,
  },
  importTitleError: {
    ...type.bodyMedium,
    color: scheme.onErrorContainer,
    fontWeight: '700',
  },
  importSubError: {
    ...type.labelSmall,
    color: scheme.onErrorContainer,
    marginTop: 2,
  },
});
