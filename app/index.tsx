import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, AppState, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ChevronDown, LocateFixed, MapPin, Pencil, Bell, Settings2, X } from 'lucide-react-native';
import { elev, scheme, shape, type } from '../src/theme/tokens';
import { DEFAULT_LOCATION } from '../src/config';
import { FavoritesService, LocationService, RoutingService, SearchService, recordTripSearch } from '../src/services';
import { liveTracker } from '../src/services/liveTracker';
import {
  type DataStatus,
  getDataStatus,
  importGtfsFromNetwork,
  refreshDataStatus,
  subscribeDataStatus,
} from '../src/services/dataManager';
import { getSettingsSync } from '../src/services/settings';
import { getPinnedQuerySync } from '../src/services/pinnedConnection';
import {
  buildRoutesLink,
  connectionToWidgetNext,
  mergeWidgetSnapshot,
  pickNextConnection,
  writeWidgetSnapshot,
  type WidgetPinned,
  type WidgetQuickItem,
} from '../src/services/widgetSnapshot';
import type { Connection, SavedPlace, SmartDestination, Suggestion } from '../src/types/models';
import { SavedPlacesRow } from '../src/components/SavedPlacesRow';
import { SearchBar } from '../src/components/SearchBar';
import { SearchSheet } from '../src/components/SearchSheet';
import { SmartHistoryList } from '../src/components/SmartHistoryList';
import { AddPlaceSheet } from '../src/components/AddPlaceSheet';
import { ManagePlacesSheet } from '../src/components/ManagePlacesSheet';

const GPS_ITEM: Suggestion = {
  id: '__gps',
  title: 'Moja lokalizacja (GPS)',
  address: 'Bieżąca pozycja urządzenia',
  kind: 'history',
  lat: 0,
  lon: 0,
};

export default function HomeScreen() {
  const router = useRouter();
  const [saved, setSaved] = useState<SavedPlace[]>([]);
  const [smart, setSmart] = useState<SmartDestination[]>([]);
  const [sheetMode, setSheetMode] = useState<'destination' | 'start' | null>(null);
  const [returnToDestinationAfterStart, setReturnToDestinationAfterStart] = useState(false);
  const [gpsLocation, setGpsLocation] = useState<{ lat: number; lon: number; title: string } | null>(null);
  const [isCustomStart, setIsCustomStart] = useState(false);
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
  const [dataStatus, setDataStatus] = useState<DataStatus>(getDataStatus());
  const [newsAlert, setNewsAlert] = useState(false);

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

  useEffect(() => {
    refreshPlaces();
    SearchService.recent().then(setRecent);
    // Live GPS od startu (ticker w tle) — opóźnienia gotowe zanim user wyszuka trasę.
    liveTracker.start();

    LocationService.getCurrentLocation().then((l) => {
      setGpsLocation({ lat: l.lat, lon: l.lon, title: l.title });
      setLocTitle(l.title);
      const coords = { lat: l.lat, lon: l.lon };
      setCurrentCoords(coords);
      FavoritesService.smartFromOrigin(l.stopId || l.title, coords).then(setSmart);
    });
  }, []);

  // Po zakończeniu importu GTFS aktualizujemy odjazdy
  useEffect(() => {
    if (dataStatus.state === 'ready') {
      refreshPlaces();
      if (!isCustomStart) {
        LocationService.getCurrentLocation().then((l) => {
          const coords = { lat: l.lat, lon: l.lon };
          FavoritesService.smartFromOrigin(l.stopId || l.title, coords).then(setSmart);
        });
      } else {
        FavoritesService.smartFromOrigin(locTitle, currentCoords).then(setSmart);
      }
    }
  }, [dataStatus.state, isCustomStart, locTitle, currentCoords]);

  // Najszybszy odjazd do każdej częstej destynacji (z ustawieniami trasy użytkownika)
  useEffect(() => {
    if (smart.length === 0) {
      setNextDepart({});
      setFirstConns({});
      return;
    }
    let cancelled = false;
    const s = getSettingsSync();
    Promise.all(
      smart.map((d) =>
        RoutingService.getConnections({
          fromTitle: locTitle,
          fromLat: currentCoords.lat,
          fromLon: currentCoords.lon,
          toId: d.id,
          toTitle: d.title,
          toLat: d.lat,
          toLon: d.lon,
          maxTransfers: s.maxTransfers,
          minTransferSec: s.minTransferSec,
          maxWalkM: s.maxWalkM,
          walkSpeedMps: s.walkSpeedMps,
        })
          .then((conns) => ({ id: d.id, first: conns.length ? conns[0] : undefined }))
          .catch(() => ({ id: d.id, first: undefined as Connection | undefined })),
      ),
    ).then((rows) => {
      if (cancelled) return;
      const map: Record<string, number> = {};
      const conns: Record<string, Connection> = {};
      for (const r of rows) {
        if (r.first !== undefined) {
          map[r.id] = r.first.departInMin;
          conns[r.id] = r.first;
        }
      }
      setNextDepart(map);
      setFirstConns(conns);
    });
    return () => {
      cancelled = true;
    };
  }, [smart, currentCoords, locTitle]);

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

    const pinnedQuery = getPinnedQuerySync();
    const basePinned: WidgetPinned | null = pinnedQuery
      ? {
          fromTitle: pinnedQuery.fromTitle,
          toTitle: pinnedQuery.toTitle,
          deepLink: buildRoutesLink({
            fromTitle: pinnedQuery.fromTitle,
            fromLat: pinnedQuery.fromLat,
            fromLon: pinnedQuery.fromLon,
            toId: pinnedQuery.toId,
            toTitle: pinnedQuery.toTitle,
            toLat: pinnedQuery.toLat,
            toLon: pinnedQuery.toLon,
          }),
        }
      : null;

    // Bez przypięcia i bez połączeń nie ma czego zapisywać.
    if (!best && !basePinned && quick.length === 0) return;

    const next =
      best && bestDest ? connectionToWidgetNext(best, from, bestDest) : null;

    // Dociągnij godziny dla przypiętego (1 zapytanie, tylko gdy jest pin).
    const finish = (pinned: WidgetPinned | null) => {
      if (cancelled) return;
      void writeWidgetSnapshot({ updatedAt: Date.now(), next, pinned, quick });
    };
    if (basePinned && pinnedQuery) {
      const s = getSettingsSync();
      RoutingService.getConnections({
        fromTitle: pinnedQuery.fromTitle,
        fromLat: pinnedQuery.fromLat,
        fromLon: pinnedQuery.fromLon,
        toId: pinnedQuery.toId,
        toTitle: pinnedQuery.toTitle,
        toLat: pinnedQuery.toLat,
        toLon: pinnedQuery.toLon,
        maxTransfers: s.maxTransfers,
        minTransferSec: s.minTransferSec,
        maxWalkM: s.maxWalkM,
        walkSpeedMps: s.walkSpeedMps,
      })
        .then((conns) => {
          const first = pickNextConnection(conns);
          finish(
            first
              ? {
                  ...basePinned,
                  departAt: first.departAt,
                  arriveAt: first.arriveAt,
                  durationMin: first.durationMin,
                  delayMin: first.delayMin,
                  live: first.live,
                }
              : basePinned,
          );
        })
        .catch(() => finish(basePinned));
    } else {
      finish(basePinned);
    }
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

  const recentWithGps = useMemo(() => [GPS_ITEM, ...recentFromSmart], [recentFromSmart]);

  const resetToGps = async () => {
    setIsCustomStart(false);
    if (gpsLocation) {
      setLocTitle(gpsLocation.title);
      const coords = { lat: gpsLocation.lat, lon: gpsLocation.lon };
      setCurrentCoords(coords);
      FavoritesService.smartFromOrigin(gpsLocation.title, coords).then(setSmart);
    }
    try {
      const l = await LocationService.getCurrentLocation();
      setGpsLocation({ lat: l.lat, lon: l.lon, title: l.title });
      setLocTitle(l.title);
      const coords = { lat: l.lat, lon: l.lon };
      setCurrentCoords(coords);
      FavoritesService.smartFromOrigin(l.stopId || l.title, coords).then(setSmart);
    } catch (err) {
      console.warn('[resetToGps] błąd pobierania pozycji GPS:', err);
    }
  };

  const handleStartSelect = async (s: Suggestion) => {
    setQuery('');
    if (s.id === GPS_ITEM.id) {
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
    setLocTitle(s.title);
    const coords = { lat: s.lat, lon: s.lon };
    setCurrentCoords(coords);
    FavoritesService.smartFromOrigin(s.id || s.title, coords).then(setSmart);
    void SearchService.recordRecent(s).then(() => {
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
      SearchService.search(q, currentCoords)
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

  const goToRoutes = (to: { id: string; title: string; address?: string; lat: number; lon: number }) => {
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
        toId: to.id,
        toTitle: to.title,
        toLat: String(to.lat),
        toLon: String(to.lon),
      },
    });
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
        'Brak połączenia z bazą',
        'Nie udało się zapisać miejsca. Spróbuj ponownie.',
      );
      return;
    }
    refreshPlaces();
    FavoritesService.smartFromOrigin(locTitle, currentCoords).then(setSmart);
  };

  const handleDeletePlace = async (id: string) => {
    await FavoritesService.deletePlace(id);
    refreshPlaces();
    FavoritesService.smartFromOrigin(locTitle, currentCoords).then(setSmart);
  };

  return (
    <View style={styles.root}>
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} overScrollMode="never">
          <View style={styles.topBar}>
            <View style={[styles.loc, isCustomStart && styles.locCustom]}>
              <Pressable
                onPress={() => {
                  setReturnToDestinationAfterStart(false);
                  setQuery('');
                  setSheetMode('start');
                }}
                style={styles.locPressable}
                accessibilityRole="button"
                accessibilityLabel={
                  isCustomStart
                    ? `Początek trasy: ${locTitle}. Dotknij, aby zmienić.`
                    : `Lokalizacja: ${locTitle}. Dotknij, aby zmienić miejsce początkowe.`
                }
              >
                {isCustomStart ? (
                  <MapPin size={15} color={scheme.primary} />
                ) : (
                  <LocateFixed size={15} color={scheme.onSecondaryContainer} />
                )}
                <Text
                  style={[styles.locText, isCustomStart && styles.locTextCustom]}
                  numberOfLines={1}
                  ellipsizeMode="tail"
                >
                  {locTitle}
                </Text>
                {!isCustomStart && (
                  <ChevronDown
                    size={14}
                    color={scheme.onSecondaryContainer}
                    style={{ opacity: 0.6, marginLeft: 2 }}
                  />
                )}
              </Pressable>
              {isCustomStart && (
                <Pressable
                  hitSlop={8}
                  onPress={resetToGps}
                  accessibilityRole="button"
                  accessibilityLabel="Przywróć bieżącą lokalizację GPS"
                  style={styles.locResetBtn}
                >
                  <X size={14} color={scheme.onSurfaceVariant} />
                </Pressable>
              )}
            </View>
            <View style={styles.topActions}>
              <Pressable
                style={styles.iconBtn}
                hitSlop={10}
                onPress={() => {
                  setNewsAlert(false);
                  void import('../src/services/mpkNews').then(({ markNewsSeen }) => markNewsSeen());
                  router.push('/news');
                }}
                accessibilityLabel={newsAlert ? 'Aktualności MPK — nowe utrudnienia' : 'Aktualności MPK'}
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

          <Text style={styles.hero}>Gdzie jedziemy?</Text>

          {dataStatus.state === 'downloading' && (
            <View style={styles.importCard}>
              <ActivityIndicator size="small" color={scheme.primary} />
              <View style={{ flex: 1 }}>
                <Text style={styles.importTitle}>Pobieranie rozkładu Wrocławia…</Text>
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
              <Text style={styles.importTitleError}>Błąd pobierania rozkładu</Text>
              <Text style={styles.importSubError}>
                {dataStatus.message}. {dataStatus.hint ?? 'Dotknij, aby spróbować ponowić.'}
              </Text>
            </Pressable>
          )}

          <View style={{ height: 24 }} />
          <SearchBar
            onPress={() => {
              setReturnToDestinationAfterStart(false);
              setQuery('');
              setSheetMode('destination');
            }}
          />

          <View style={{ height: 20 }} />
          <View style={styles.sectionHeader}>
            <Text style={styles.section}>Zapisane miejsca</Text>
            <Pressable
              onPress={() => setManageSheetOpen(true)}
              accessibilityRole="button"
              accessibilityLabel="Zarządzaj zapisanymi miejscami"
              style={({ pressed }) => [styles.manageBtn, pressed && { opacity: 0.6 }]}
              hitSlop={8}
            >
              <Pencil size={14} color={scheme.onSurfaceVariant} />
            </Pressable>
          </View>

          <SavedPlacesRow
            places={saved}
            onSelect={(p) => goToRoutes({ id: p.placeId, title: p.name, lat: p.lat, lon: p.lon })}
            onAdd={() => {
              setEditingPlace(null);
              setAddPlaceOpen(true);
            }}
            onEdit={(p) => {
              setEditingPlace(p);
              setAddPlaceOpen(true);
            }}
          />

          <View style={{ height: 20 }} />
          <SmartHistoryList items={smart} departures={nextDepart} onSelect={(d) => goToRoutes(d)} />

          <View style={{ height: 90 }} />
        </ScrollView>
      </SafeAreaView>

      {sheetMode && (
        <SearchSheet
          query={query}
          loading={loading}
          results={results}
          recent={sheetMode === 'start' ? recentWithGps : recentFromSmart}
          savedQuick={quick}
          placeholder={sheetMode === 'start' ? 'Skąd wyruszasz?' : 'Dokąd jedziesz?'}
          originTitle={sheetMode === 'destination' ? locTitle : undefined}
          closeOnSelect={!(sheetMode === 'start' && returnToDestinationAfterStart)}
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
  body: { paddingHorizontal: 16, paddingTop: 6 },
  topBar: { flexDirection: 'row', alignItems: 'center', gap: 8, height: 44 },
  loc: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: scheme.secondaryContainer,
    borderRadius: shape.full,
    paddingLeft: 12,
    paddingRight: 10,
    height: 40,
    flex: 1,
    minWidth: 0,
  },
  locCustom: {
    backgroundColor: scheme.surfaceContainerHighest,
    borderWidth: 1,
    borderColor: scheme.primary,
  },
  locPressable: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flex: 1,
    minWidth: 0,
    height: '100%',
  },
  locText: { ...type.labelLarge, color: scheme.onSecondaryContainer, flexShrink: 1, minWidth: 0 },
  locTextCustom: { color: scheme.onSurface, fontWeight: '600' },
  locResetBtn: {
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 4,
    backgroundColor: scheme.surfaceContainerHigh,
  },
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
  hero: { ...type.displaySmall, color: scheme.onSurface, marginTop: 16 },
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
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  section: { ...type.titleMedium, color: scheme.onSurface },
  manageBtn: {
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: shape.full,
  },
});
