import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, AppState, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LocateFixed, Pencil, Settings2 } from 'lucide-react-native';
import { elev, scheme, shape, type } from '../src/theme/tokens';
import { DEFAULT_LOCATION } from '../src/config';
import { FavoritesService, LocationService, RoutingService, SearchService } from '../src/services';
import { pingBackend } from '../src/services/offlineCache';
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

export default function HomeScreen() {
  const router = useRouter();
  const [saved, setSaved] = useState<SavedPlace[]>([]);
  const [smart, setSmart] = useState<SmartDestination[]>([]);
  const [sheetOpen, setSheetOpen] = useState(false);
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
  const [offline, setOffline] = useState(false);
  const [dataStatus, setDataStatus] = useState<DataStatus>(getDataStatus());

  useEffect(() => {
    return subscribeDataStatus(setDataStatus);
  }, []);

  // Status sieci: ping przy starcie, powrocie na foreground i co 30 s.
  // refreshDataStatus ładuje status lokalnego GTFS — jeśli pusty, automatycznie
  // uruchamiamy pobieranie rozkładu, aby aplikacja działała bez serwera dev.
  useEffect(() => {
    let cancelled = false;
    const check = async () => {
      const st = await refreshDataStatus().catch(() => ({ state: 'empty' } as const));
      if (st.state === 'empty') {
        void importGtfsFromNetwork().catch((e) => console.warn('Auto import GTFS failed:', e));
      }
      const online = await pingBackend();
      if (!cancelled) setOffline(!online);
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

    LocationService.getCurrentLocation().then((l) => {
      setLocTitle(l.title);
      const coords = { lat: l.lat, lon: l.lon };
      setCurrentCoords(coords);
      FavoritesService.smartFromOrigin(l.stopId || l.title, coords).then(setSmart);
    });
  }, []);

  // Po zakończeniu importu GTFS aktualizujemy odjazdy i zdejmujemy badge offline
  useEffect(() => {
    if (dataStatus.state === 'ready') {
      setOffline(false);
      refreshPlaces();
      LocationService.getCurrentLocation().then((l) => {
        const coords = { lat: l.lat, lon: l.lon };
        FavoritesService.smartFromOrigin(l.stopId || l.title, coords).then(setSmart);
      });
    }
  }, [dataStatus.state]);

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

  // Debounced search
  useEffect(() => {
    if (!sheetOpen) return;
    const q = query.trim();
    if (!q) {
      setResults([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const t = setTimeout(() => {
      SearchService.search(q, currentCoords).then((r) => {
        setResults(r);
        setLoading(false);
      });
    }, 220);
    return () => clearTimeout(t);
  }, [query, sheetOpen, currentCoords]);

  const quick = useMemo(() => saved.slice(0, 3).map((s) => ({ id: s.id, title: s.name })), [saved]);

  const goToRoutes = (to: { id: string; title: string; lat: number; lon: number }) => {
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
            <View style={styles.loc}>
              <LocateFixed size={15} color={scheme.onSecondaryContainer} />
              <Text style={styles.locText} numberOfLines={1} ellipsizeMode="tail">{locTitle}</Text>
            </View>
            {offline && (
              <View style={styles.offlinePill}>
                <View style={styles.offlineDot} />
                <Text style={styles.offlineText}>Offline</Text>
              </View>
            )}
            <View style={styles.topActions}>
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
              <Text style={styles.importSubError}>{dataStatus.message}. Dotknij, aby ponowić.</Text>
            </Pressable>
          )}

          <View style={{ height: 24 }} />
          <SearchBar onPress={() => setSheetOpen(true)} />

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

      {sheetOpen && (
        <SearchSheet
          query={query}
          loading={loading}
          results={results}
          recent={recent}
          savedQuick={quick}
          onQuery={setQuery}
          onSelect={(s) => {
            goToRoutes({ id: s.id, title: s.title, lat: s.lat, lon: s.lon });
          }}
          onClose={() => setSheetOpen(false)}
        />
      )}

      {manageSheetOpen && (
        <ManagePlacesSheet
          places={saved}
          onClose={() => setManageSheetOpen(false)}
          onSelectPlace={(p) => {
            setManageSheetOpen(false);
            goToRoutes({ id: p.placeId, title: p.name, lat: p.lat, lon: p.lon });
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
    gap: 8,
    backgroundColor: scheme.secondaryContainer,
    borderRadius: shape.full,
    paddingLeft: 12,
    paddingRight: 12,
    height: 40,
    flex: 1,
    minWidth: 0,
  },
  locText: { ...type.labelLarge, color: scheme.onSecondaryContainer, flexShrink: 1, minWidth: 0 },
  offlinePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flexShrink: 0,
    backgroundColor: scheme.surfaceContainerHighest,
    borderRadius: shape.full,
    paddingHorizontal: 10,
    height: 32,
  },
  offlineDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: scheme.warning,
  },
  offlineText: { ...type.labelSmall, fontWeight: '700', color: scheme.onSurfaceVariant },
  topActions: { flexDirection: 'row', alignItems: 'center', gap: 8, marginLeft: 'auto' },
  iconBtn: {
    width: 40,
    height: 40,
    borderRadius: shape.full,
    backgroundColor: scheme.surfaceContainerHigh,
    alignItems: 'center',
    justifyContent: 'center',
  },
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
