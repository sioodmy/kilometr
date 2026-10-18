import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  ChevronLeft,
  CloudOff,
  Pin,
  RouteOff,
} from 'lucide-react-native';
import { scheme, shape, type } from '../../src/theme/tokens';
import { defaultLocationForCity } from '../../src/config';
import { getActiveCityIdSync } from '../../src/services/cityStore';
import { useStrings } from '../../src/i18n';
import { RoutingService } from '../../src/services';
import { getPlannedConnection } from '../../src/services/api';
import { liveTracker } from '../../src/services/liveTracker';
import type { Connection } from '../../src/types/models';
import { ConnectionLineAlerts } from '../../src/components/ConnectionLineAlerts';
import { LegTimeline } from '../../src/components/LegTimeline';
import { ConnectionSummary } from '../../src/components/ConnectionSummary';
import { StopCompassCard } from '../../src/components/StopCompassCard';
import {
  areNotificationsSupported,
  ensureNotificationPermission,
  getTrackedTripSync,
  permissionDeniedMessage,
  startTracking,
  stopTracking,
  useTrackedTrip,
} from '../../src/services/notifications';

export default function RouteDetailsScreen() {
  const s = useStrings();
  const router = useRouter();
  const goBack = () => router.canGoBack() ? router.back() : router.replace('/routes');
  const { id } = useLocalSearchParams<{ id: string }>();
  const cachedItem = getTrackedTripSync()?.connection;
  const immediateItem = cachedItem?.id === id ? cachedItem : getPlannedConnection(String(id));
  const [loadedItem, setItem] = useState<Connection | null>(() => immediateItem ?? null);
  const item = loadedItem?.id === id ? loadedItem : immediateItem ?? null;
  const [loadFailed, setLoadFailed] = useState(false);
  const [offline, setOffline] = useState(false);
  // Stan feedu live zmienia się w tle, a ten ekran nie odświeża się sam z
  // powodu danych. Bez tickera baner „brak danych” był zamrożony w stanie z
  // chwili renderu i pojawiał się dopiero przy jakiejś przypadkowej
  // przerysowie całego ekranu.
  const [liveStale, setLiveStale] = useState(() => liveTracker.getLiveState() !== 'fresh');
  useEffect(() => {
    const check = () => setLiveStale(liveTracker.getLiveState() !== 'fresh');
    const t = setInterval(check, 15000);
    return () => clearInterval(t);
  }, []);

  const { trip: trackedTrip } = useTrackedTrip();

  const isTrackedThis = trackedTrip != null && trackedTrip.connection.id === String(id);

  // Śledzenie odpala się tylko przyciskiem w nagłówku. Jedno śledzenie
  // na raz: start nowego kursu podmienia poprzedni w tripMonitor.
  const toggleTracking = async () => {
    if (!item) return;
    if (isTrackedThis) {
      await stopTracking();
      return;
    }
    if (!areNotificationsSupported()) {
      Alert.alert(s.routes.trackUnsupportedTitle, s.routes.trackUnsupportedBody);
      return;
    }
    const ok = await ensureNotificationPermission();
    if (!ok) {
      Alert.alert(s.routes.notifOffTitle, permissionDeniedMessage());
      return;
    }
    const firstLeg = item.legs[0];
    const lastLeg = item.legs[item.legs.length - 1];
    const fallback = defaultLocationForCity(getActiveCityIdSync());
    await startTracking({
      id: item.id,
      fromTitle: item.fromTitle,
      fromLat: firstLeg?.fromLat ?? fallback.lat,
      fromLon: firstLeg?.fromLon ?? fallback.lon,
      toId: item.toTitle,
      toTitle: item.toTitle,
      toLat: lastLeg?.toLat ?? fallback.lat,
      toLon: lastLeg?.toLon ?? fallback.lon,
      connection: item,
      startedAt: Date.now(),
    });
  };

  useEffect(() => {
    // Brak id to nie „wczytujemy” — inaczej ekran zostawał ze spinnerem w nieskończoność.
    if (!id) {
      setLoadFailed(true);
      return;
    }
    setLoadFailed(false);
    setOffline(false);
    if (immediateItem) {
      setItem(immediateItem);
      return;
    }
    let cancelled = false;
    const load = async () => {
      try {
        const hit = await RoutingService.getConnectionById(String(id));
        if (cancelled) return;
        if (hit) {
          setItem(hit.connection);
          setOffline(hit.source === 'cache');
          return;
        }
        setLoadFailed(true);
      } catch (err) {
        console.warn('[RouteDetails] load failed:', err);
        if (!cancelled) setLoadFailed(true);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [id]);

  if (loadFailed) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.header}>
          <Pressable onPress={goBack} style={styles.iconBtn} accessibilityRole="button" accessibilityLabel={s.map.backA11y}>
            <ChevronLeft size={23} color={scheme.onSurface} />
          </Pressable>
          <Text style={styles.headerTitle}>{s.routeDetails.title}</Text>
        </View>
        <View style={styles.loading}>
          <Text style={styles.loadingText}>{s.routeDetails.loadFail}</Text>
          <Pressable
            onPress={goBack}
            accessibilityRole="button"
            style={({ pressed }) => [styles.retryBtn, pressed && { opacity: 0.8 }]}
          >
            <Text style={styles.retryText}>{s.routeDetails.backToList}</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  if (!item) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <View style={styles.header}>
          <Pressable onPress={goBack} style={styles.iconBtn} accessibilityRole="button" accessibilityLabel={s.map.backA11y}>
            <ChevronLeft size={23} color={scheme.onSurface} />
          </Pressable>
          <Text style={styles.headerTitle}>{s.routeDetails.title}</Text>
        </View>
        <View style={styles.loading}>
          <ActivityIndicator color={scheme.primary} />
        </View>
      </SafeAreaView>
    );
  }

  const noLegs = item.legs.length === 0;

  // Treść komunikatu o źródle danych. Kolejność ma znaczenie: połączenie
  // wzięte z dysku jest starsze od czegokolwiek, co pokaże feed live.
  const dataNote = offline
    ? s.routeDetails.offlineNote
    : liveStale
      ? s.routeDetails.noLiveNote
      : null;

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <Pressable onPress={goBack} style={styles.iconBtn} accessibilityRole="button" accessibilityLabel={s.map.backA11y}>
          <ChevronLeft size={23} color={scheme.onSurface} />
        </Pressable>
        <Text style={styles.headerTitle} accessibilityRole="header">
          {s.routeDetails.title}
        </Text>
        <Pressable
          onPress={() => void toggleTracking()}
          accessibilityRole="button"
          accessibilityState={{ selected: isTrackedThis }}
          accessibilityLabel={
            isTrackedThis ? s.routes.stopTrackingTripA11y : s.routes.trackTripA11y
          }
          style={({ pressed }) => [
            styles.trackBtn,
            isTrackedThis && styles.trackBtnActive,
            pressed && { opacity: 0.7 },
          ]}
          hitSlop={8}
        >
          <Pin
            size={21}
            color={isTrackedThis ? scheme.onPrimaryContainer : scheme.onSurfaceVariant}
            fill={isTrackedThis ? scheme.onPrimaryContainer : 'transparent'}
          />
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false} overScrollMode="never">
        <ConnectionSummary item={item} offline={offline} />
        {dataNote && (
          <View style={styles.offlineBanner}>
            <CloudOff size={16} color={scheme.onSurfaceVariant} strokeWidth={2} />
            <Text style={styles.offlineBannerText}>{dataNote}</Text>
          </View>
        )}

        {noLegs ? (
          <View style={styles.emptyCard}>
            <RouteOff size={20} color={scheme.onSurfaceVariant} strokeWidth={2} />
            <Text style={styles.emptyTitle}>{s.routeDetails.noTrip}</Text>
            <Text style={styles.emptyText}>
              {s.routeDetails.noTripBody}
            </Text>
            <Pressable
              onPress={() => router.back()}
              style={({ pressed }) => [styles.retryBtn, pressed && { opacity: 0.8 }]}
            >
              <Text style={styles.retryText}>{s.routeDetails.backToList}</Text>
            </Pressable>
          </View>
        ) : (
          <>
            <LegTimeline legs={item.legs} />

            {/* Nawigacja do przystanku jest klikalna i otwiera pełną
                mapę trasy. */}
            <StopCompassCard
              connection={item}
              onOpenMap={() => router.push({ pathname: '/map', params: { id: item.id } })}
            />

            <ConnectionLineAlerts connection={item} />
          </>
        )}

        <View style={{ height: 24 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: scheme.surface },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8 },
  loadingText: { ...type.bodyMedium, color: scheme.onSurfaceVariant },
  retryBtn: {
    backgroundColor: scheme.primary,
    borderRadius: shape.full,
    paddingHorizontal: 20,
    paddingVertical: 12,
    marginTop: 8,
  },
  retryText: { ...type.labelLarge, fontWeight: '700', color: scheme.onPrimary },
  header: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, paddingVertical: 8 },
  iconBtn: { width: 48, height: 48, borderRadius: shape.medium, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { flex: 1, ...type.titleMedium, fontWeight: '500', color: scheme.onSurface },
  trackBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    width: 48,
    height: 48,
    borderRadius: shape.medium,
    backgroundColor: scheme.surfaceContainer,
  },
  trackBtnActive: { backgroundColor: scheme.primaryContainer },
  body: { paddingHorizontal: 16, gap: 18, paddingBottom: 40 },
  offlineBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: scheme.surfaceContainerLow,
    borderRadius: shape.medium,
    paddingHorizontal: 14,
    paddingVertical: 11,
  },
  offlineBannerText: { ...type.bodySmall, color: scheme.onSurfaceVariant, flex: 1 },
  emptyCard: {
    alignItems: 'center',
    gap: 8,
    backgroundColor: scheme.surfaceContainer,
    borderRadius: shape.large,
    padding: 20,
  },
  emptyTitle: { ...type.titleSmall, fontWeight: '700', color: scheme.onSurface },
  emptyText: { ...type.bodyMedium, color: scheme.onSurfaceVariant, textAlign: 'center' },
});
