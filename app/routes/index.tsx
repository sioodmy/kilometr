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
  X,
} from 'lucide-react-native';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';
import { elev, scheme, shape, type } from '../../src/theme/tokens';
import { DEFAULT_LOCATION } from '../../src/config';
import {
  FavoritesService,
  LocationService,
  RoutingService,
  SearchService,
  findAnchorForLocation,
  type ActiveAnchor,
} from '../../src/services';
import { getSettingsSync, loadSettings } from '../../src/services/settings';
import {
  ensurePinPermissions,
  getPinnedQuerySync,
  isPinSupported,
  isSameQuery,
  pinConnection,
  subscribePinned,
  unpinConnection,
  type PinnedQuery,
} from '../../src/services/pinnedConnection';
import {
  loadConnections,
  pingBackend,
  rehydrateConnections,
} from '../../src/services/offlineCache';
import type { Connection, SavedPlace, Suggestion } from '../../src/types/models';
import { ConnectionCard } from '../../src/components/ConnectionCard';
import { DepartureTimeSheet } from '../../src/components/DepartureTimeSheet';
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
  }>();

  const [fromTitle, setFromTitle] = useState(params.fromTitle || DEFAULT_LOCATION.title);
  const [fromLat, setFromLat] = useState(Number(params.fromLat || DEFAULT_LOCATION.lat));
  const [fromLon, setFromLon] = useState(Number(params.fromLon || DEFAULT_LOCATION.lon));

  const [toTitle, setToTitle] = useState(String(params.toTitle ?? 'Cel'));
  const [toLat, setToLat] = useState(Number(params.toLat ?? 0));
  const [toLon, setToLon] = useState(Number(params.toLon ?? 0));
  const [toId, setToId] = useState(String(params.toId ?? ''));

  const [savedPlaces, setSavedPlaces] = useState<SavedPlace[]>([]);
  const [activeAnchor, setActiveAnchor] = useState<ActiveAnchor | null>(null);
  const dismissedAnchorsRef = useRef<Set<string>>(new Set());
  const initialAnchorCheckedRef = useRef(false);

  const handleDismissAnchor = () => {
    if (!activeAnchor) return;
    dismissedAnchorsRef.current.add(activeAnchor.placeId);
    const raw = activeAnchor.rawGps;
    setActiveAnchor(null);
    setFromTitle(raw.title);
    setFromLat(raw.lat);
    setFromLon(raw.lon);
  };

  const [items, setItems] = useState<Connection[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [offline, setOffline] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadingEarlier, setLoadingEarlier] = useState(false);
  const [noMoreEarlier, setNoMoreEarlier] = useState(false);
  const [noMoreLater, setNoMoreLater] = useState(false);
  // Sortowanie listy: 'fastest' = najwcześniejsze przybycie (domyślnie,
  // żeby jednym tapnięciem wrócić szybko do domu), 'earliest' = jak w
  // Jakdojade, od najwcześniejszego odjazdu. Magazyn (items) zawsze
  // posortowany po odjeździe — paginacja i hold-to-load na tym bazują.
  const [sortMode, setSortMode] = useState<'fastest' | 'earliest'>('fastest');

  const displayed = useMemo(() => {
    if (sortMode === 'earliest') return items;
    return [...items].sort(
      (a, b) =>
        a.departureSec + a.durationMin * 60 - (b.departureSec + b.durationMin * 60) ||
        a.departureSec - b.departureSec,
    );
  }, [items, sortMode]);

  // Przypięte połączenie (persistent notification)
  const [pinnedQuery, setPinnedQuery] = useState<PinnedQuery | null>(() => getPinnedQuerySync());
  useEffect(() => subscribePinned(setPinnedQuery), []);

  const currentQuery = useMemo(
    () => ({
      fromTitle,
      fromLat,
      fromLon,
      toId,
      toTitle,
      toLat,
      toLon,
    }),
    [fromTitle, fromLat, fromLon, toId, toTitle, toLat, toLon],
  );
  const isPinned = pinnedQuery != null && isSameQuery(pinnedQuery, currentQuery);

  const togglePin = async () => {
    if (isPinned) {
      await unpinConnection();
      return;
    }
    if (!isPinSupported()) {
      Alert.alert(
        'Pinezka niedostępna',
        'Przypięte powiadomienie wymaga builda deweloperskiego — Expo Go nie wspiera powiadomień.',
      );
      return;
    }
    const ok = await ensurePinPermissions();
    if (!ok) {
      Alert.alert(
        'Powiadomienia wyłączone',
        'Zezwól na powiadomienia w ustawieniach systemu, żeby przypiąć połączenie.',
      );
      return;
    }
    await pinConnection(currentQuery);
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
      departureTimeSec: depSec,
      maxTransfers: s.maxTransfers,
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
  const [savedQuick, setSavedQuick] = useState<{ id: string; title: string }[]>([]);

  useEffect(() => {
    SearchService.recent().then(setRecent);
    Promise.all([FavoritesService.list(), loadSettings()]).then(([places, currentSettings]) => {
      setSavedPlaces(places);
      setSavedQuick(places.slice(0, 3).map((s) => ({ id: s.id, title: s.name })));

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
          setActiveAnchor(anchor);
          setFromTitle(anchor.stopName);
          setFromLat(anchor.lat);
          setFromLon(anchor.lon);
        }
      }
    });
  }, []);

  // Debounced search (jak na głównym), bias wg aktualnego startu
  useEffect(() => {
    if (!sheetFor) return;
    const q = query.trim();
    if (!q) {
      setResults([]);
      setSearchLoading(false);
      return;
    }
    setSearchLoading(true);
    const t = setTimeout(() => {
      SearchService.search(q, { lat: fromLat, lon: fromLon }).then((r) => {
        setResults(r);
        setSearchLoading(false);
      });
    }, 220);
    return () => clearTimeout(t);
  }, [query, sheetFor, fromLat, fromLon]);

  const recentWithGps = useMemo(
    () => (sheetFor === 'from' ? [GPS_ITEM, ...recent] : recent),
    [sheetFor, recent],
  );

  const handleSuggestionSelect = async (s: Suggestion) => {
    if (s.id === GPS_ITEM.id) {
      // Start = aktualna pozycja GPS (nie zapisana wcześniej)
      setQuery('');
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
        setFromTitle(anchor.stopName);
        setFromLat(anchor.lat);
        setFromLon(anchor.lon);
      } else {
        setActiveAnchor(null);
        setFromTitle(l.title);
        setFromLat(l.lat);
        setFromLon(l.lon);
      }
      return;
    }
    setQuery('');
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
    if (!seamless) {
      setLoading(true);
    }
    setLoadError(false);
    setOffline(false);
    setNoMoreEarlier(false);
    setNoMoreLater(false);
    const depSec = targetDepSec !== undefined ? targetDepSec : departureTimeSec;
    try {
      const c = await RoutingService.getConnections(queryAt(depSec));
      setItems(applyLiveList(c, depSec));
    } catch {
      // Offline: ostatnie prawdziwe dane z cache (z przeliczonymi czasami).
      // W trybie seamless nie czyścimy listy ani nie migoczemy spinnerem.
      const cached = await loadConnections(queryAt(depSec));
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
      setLoading(false);
    }
  };

  /**
   * Cichy refresh BEZ spinnera i BEZ czyszczenia listy — podmiana jest
   * niewidoczna, gdy dane te same (stabilne klucze FlatList = brak flickeru).
   * Używany przy powrocie sieci i zmianie czasu w trybie offline.
   */
  const quietRefresh = async (targetDepSec?: number) => {
    const depSec = targetDepSec !== undefined ? targetDepSec : departureTimeSec;
    try {
      const c = await RoutingService.getConnections(queryAt(depSec));
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
      if (await pingBackend()) {
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

    try {
      const c = await RoutingService.getConnections(queryAt(nextDeparture));
      setItems((prev) => {
        const { list, added } = mergeSorted(prev, c);
        if (added === 0) setNoMoreLater(true);
        return list;
      });
    } catch {
      // po cichu — lista zostaje, spinner znika
    } finally {
      setLoadingMore(false);
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

    try {
      const c = await RoutingService.getConnections(queryAt(firstDeparture - 1800));
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
      setLoadingEarlier(false);
    }
  };

  // Góra listy: przytrzymaj chwilę na samej górze → dładuj wcześniejsze
  const handleScroll = (e: { nativeEvent: { contentOffset: { y: number } } }) => {
    const y = e.nativeEvent.contentOffset.y;
    scrollY.current = y;
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
      fetchRoutes(departureTimeSec);
    });
    return () => task.cancel();
  }, [fromLat, fromLon, toLat, toLon, fromTitle, toTitle]);

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
          onPress={togglePin}
          accessibilityRole="button"
          accessibilityLabel={isPinned ? 'Odepnij połączenie' : 'Przypnij najbliższe połączenie'}
          style={({ pressed }) => [
            styles.pinBtn,
            isPinned && styles.pinBtnActive,
            pressed && { opacity: 0.8 },
          ]}
          hitSlop={8}
        >
          <Pin
            size={17}
            color={isPinned ? scheme.onPrimaryContainer : scheme.onSecondaryContainer}
            fill={isPinned ? scheme.onPrimaryContainer : 'transparent'}
          />
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

      {/* 3. Sortowanie: najszybciej (przybycie) albo najwcześniej (odjazd) */}
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

      {/* 4. Lista połączeń */}
      {loading ? (
        <View style={styles.loading}>
          <ActivityIndicator size="large" color={scheme.primary} />
          <Text style={styles.loadingText}>Szukam połączeń…</Text>
        </View>
      ) : loadError ? (
        <View style={styles.emptyContainer}>
          <Text style={styles.emptyTitle}>Brak połączenia z serwerem</Text>
          <Text style={styles.emptySub}>
            Nie udało się pobrać połączeń MPK. Sprawdź internet i spróbuj ponownie.
          </Text>
          <Pressable
            onPress={() => fetchRoutes(departureTimeSec)}
            style={({ pressed }) => [styles.retryBtn, pressed && { opacity: 0.8 }]}
          >
            <Text style={styles.retryText}>Spróbuj ponownie</Text>
          </Pressable>
        </View>
      ) : (
        <FlatList
          ref={listRef}
          data={displayed}
          keyExtractor={(i) => i.id}
          contentContainerStyle={styles.list}
          showsVerticalScrollIndicator={false}
          overScrollMode="never"
          onEndReached={handleLoadMore}
          onEndReachedThreshold={0.5}
          onScroll={handleScroll}
          scrollEventThrottle={100}
          onContentSizeChange={handleContentSizeChange}
          maintainVisibleContentPosition={{ minIndexForVisible: 0 }}
          renderItem={({ item }) => {
            const d = new Date();
            const nowS = d.getHours() * 3600 + d.getMinutes() * 60 + d.getSeconds();
            const past = item.departureSec > 0 && item.departureSec < nowS - 60;
            return (
              <ConnectionCard
                item={item}
                dimmed={past}
                onPress={() => router.push({ pathname: '/routes/[id]', params: { id: item.id } })}
              />
            );
          }}
          ListHeaderComponent={
            <View>
              {loadingEarlier && (
                <View style={{ paddingVertical: 12, alignItems: 'center' }}>
                  <ActivityIndicator size="small" color={scheme.primary} />
                </View>
              )}
              <View style={styles.countRow}>
                <Text style={styles.count} numberOfLines={1}>
                  {items.length} połączenia • {isCustomTime ? `odjazd ${timeLabel}` : 'najbliższe odjazdy'}
                </Text>
                {offline && (
                  <Pressable
                    onPress={() => quietRefresh()}
                    style={({ pressed }) => [styles.offlineChip, pressed && { opacity: 0.7 }]}
                    hitSlop={6}
                  >
                    <View style={styles.offlineDot} />
                    <Text style={styles.offlineText}>offline</Text>
                  </Pressable>
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
              <Text style={styles.emptyTitle}>Nie znaleziono bezpośrednich połączeń</Text>
              <Text style={styles.emptySub}>
                Spróbuj wybrać inny cel lub sprawdź inną godzinę odjazdu.
              </Text>
            </View>
          }
        />
      )}

      {/* 4. Bottom sheet wyboru daty i godziny */}
      {timeSheetOpen && (
        <DepartureTimeSheet
          initialTimeSec={departureTimeSec}
          initialLabel={timeLabel}
          onClose={() => setTimeSheetOpen(false)}
          onSelect={handleTimeSelect}
        />
      )}

      {/* 5. Wyszukiwarka startu / celu — ta sama co na ekranie głównym */}
      {sheetFor && (
        <SearchSheet
          placeholder={sheetFor === 'from' ? 'Skąd wyruszasz?' : 'Dokąd jedziesz?'}
          query={query}
          loading={searchLoading}
          results={results}
          recent={recentWithGps}
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
  // Segmented: Najszybciej / Najwcześniej
  sortRow: {
    flexDirection: 'row',
    gap: 8,
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
