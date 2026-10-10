import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, View, InteractionManager } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  ArrowRight,
  ChevronLeft,
  CloudOff,
  History,
  Radio,
  RouteOff,
} from 'lucide-react-native';
import { elev, scheme, shape, type } from '../../src/theme/tokens';
import { DEFAULT_LOCATION } from '../../src/config';
import { useStrings } from '../../src/i18n';
import { RoutingService } from '../../src/services';
import { liveTracker } from '../../src/services/liveTracker';
import type { Connection } from '../../src/types/models';
import { LegTimeline } from '../../src/components/LegTimeline';
import { LiveDot } from '../../src/components/LiveDot';
import { StopCompassCard } from '../../src/components/StopCompassCard';
import {
  areNotificationsSupported,
  ensureNotificationPermission,
  getTrackedTripSync,
  permissionDeniedMessage,
  startTracking,
  stopTracking,
  useTrackedTrip,
  type TrackedTrip,
} from '../../src/services/notifications';

export default function RouteDetailsScreen() {
  const s = useStrings();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [item, setItem] = useState<Connection | null>(null);
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

  const handleToggleTrack = async () => {
    if (isTrackedThis) {
      await stopTracking();
      return;
    }
    await handleTrack();
  };

  /** Śledzimy właśnie ten kurs, nie całe zapytanie — patrz ekran połączeń. */
  const handleTrack = async () => {
    if (!item) return;
    if (!areNotificationsSupported()) {
      Alert.alert(
        s.routes.pinUnsupportedTitle,
        s.routes.pinUnsupportedBody,
      );
      return;
    }
    const ok = await ensureNotificationPermission();
    if (!ok) {
      Alert.alert(s.routes.notifOffTitle, permissionDeniedMessage());
      return;
    }
    // Współrzędne bierzemy z odcinków (Leg ma from/to lat/lon); fallback to
    // domyślnego miejsca, bo planer i tak zakotwiczy się do najbliższego
    // przystanku wokół tych współrzędnych.
    const firstLeg = item.legs[0];
    const lastLeg = item.legs[item.legs.length - 1];
    const track: TrackedTrip = {
      id: item.id,
      fromTitle: item.fromTitle,
      fromLat: firstLeg?.fromLat ?? DEFAULT_LOCATION.lat,
      fromLon: firstLeg?.fromLon ?? DEFAULT_LOCATION.lon,
      toId: item.toTitle,
      toTitle: item.toTitle,
      toLat: lastLeg?.toLat ?? DEFAULT_LOCATION.lat,
      toLon: lastLeg?.toLon ?? DEFAULT_LOCATION.lon,
      connection: item,
      startedAt: Date.now(),
    };
    await startTracking(track);
  };

  useEffect(() => {
    // Brak id to nie „wczytujemy” — inaczej ekran zostawał ze spinnerem w nieskończoność.
    if (!id) {
      setLoadFailed(true);
      return;
    }
    setLoadFailed(false);
    setOffline(false);
    let cancelled = false;
    const task = InteractionManager.runAfterInteractions(() => {
      // .catch jest konieczny: getConnectionById i findCachedConnection rzucają,
      // a wcześniejsza wersja zostawiała spinner na ekranie na zawsze.
      const load = async () => {
        try {
          // Przycisk „Trasa” pod powiadomieniem ma otwierać Szczegóły kursu,
          // który właśnie śledzimy — a ten plan po odjeździe nie wraca już
          // z planera (śledzenie jest zablokowane) i po północy w ogóle
          // wypada z bazy. Bez tego cofnięcie na ekran listy wyglądało jak
          // awaria. Dane śledzonej podróży mamy w pamięci, więc najpierw
          // sprawdzamy je, a dopiero potem idziemy po plan i dysk.
          const trackedHit = getTrackedTripSync();
          if (trackedHit && trackedHit.connection.id === String(id)) {
            if (cancelled) return;
            setItem(trackedHit.connection);
            setOffline(false);
            return;
          }
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
    });
    return () => {
      cancelled = true;
      task.cancel();
    };
  }, [id]);

  if (loadFailed) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.header}>
          <Pressable onPress={() => router.back()} style={styles.iconBtn} hitSlop={10}>
            <ChevronLeft size={23} color={scheme.onSurface} />
          </Pressable>
          <Text style={styles.headerTitle}>{s.routeDetails.title}</Text>
        </View>
        <View style={styles.loading}>
          <Text style={styles.loadingText}>{s.routeDetails.loadFail}</Text>
          <Pressable
            onPress={() => router.back()}
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
          <Pressable onPress={() => router.back()} style={styles.iconBtn} hitSlop={10}>
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

  const late = item.live && item.delayMin > 0;
  const early = item.live && item.delayMin < 0;
  const onTime = item.live && item.delayMin === 0;
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
      {/* M3 small top app bar */}
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.iconBtn} hitSlop={10}>
          <ChevronLeft size={23} color={scheme.onSurface} />
        </Pressable>
        <Text style={styles.headerTitle} numberOfLines={1}>
          {s.routeDetails.title}
        </Text>
        <Pressable
          onPress={() => void handleToggleTrack()}
          accessibilityRole="button"
          accessibilityState={{ selected: isTrackedThis }}
          accessibilityLabel={
            isTrackedThis ? s.routeDetails.stopTrackingA11y : s.routeDetails.trackA11y
          }
          style={({ pressed }) => [
            styles.headerTrackBtn,
            isTrackedThis && styles.headerTrackBtnActive,
            pressed && { opacity: 0.7 },
          ]}
          hitSlop={8}
        >
          <Radio
            size={14}
            color={isTrackedThis ? scheme.onPrimaryContainer : scheme.onSurfaceVariant}
          />
          <Text
            style={[
              styles.headerTrackText,
              isTrackedThis && styles.headerTrackTextActive,
            ]}
            numberOfLines={1}
          >
            {isTrackedThis ? s.routeDetails.tracking : s.routeDetails.trackCourse}
          </Text>
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false} overScrollMode="never">
        {/* Skąd pochodzą dane. Lista połączeń ma taki komunikat od dawna,
            ekran szczegółów milczał — a pokazywał te same czasy bez opóźnień,
            jakby pochodziły z MPK na żywo. */}
        {dataNote && (
          <View style={styles.offlineBanner}>
            <CloudOff size={15} color={scheme.onWarningContainer} strokeWidth={2.2} />
            <Text style={styles.offlineBannerText}>{dataNote}</Text>
          </View>
        )}
        {/* M3 filled summary card + tonal status banner */}
        <View style={styles.summary}>
          <View style={styles.timeRow}>
            <View style={styles.times}>
              <Text style={styles.timeBig} numberOfLines={1}>
                {item.departAt}
              </Text>
              <View style={styles.timeArrowWrap}>
                <ArrowRight size={18} color={scheme.primary} strokeWidth={2.5} />
              </View>
              <Text style={styles.timeBig} numberOfLines={1}>
                {item.arriveAt}
              </Text>
            </View>
            <View style={styles.durationPill}>
              <Text style={styles.durationText} numberOfLines={1}>
                {s.common.durMin(item.durationMin)}
              </Text>
            </View>
          </View>
          <View style={styles.routeRow}>
            {/* Dwie linie: nazwy przystanków bywają długie („DWORZEC GŁÓWNY
                (Dworcowa)”) i przy jednej linii ucinały się obie naraz —
                widać było „Twoja lokaliz...” → „DWORZEC GŁÓWNY (Dwo...”. */}
            <Text style={styles.routeStop} numberOfLines={2}>
              {item.fromTitle}
            </Text>
            <View style={styles.routeArrowWrap}>
              <ArrowRight size={14} color={scheme.onSurfaceVariant} strokeWidth={2.2} />
            </View>
            <Text style={styles.routeStop} numberOfLines={2}>
              {item.toTitle}
            </Text>
          </View>
          {/* kompaktowy badge statusu */}
          {late ? (
            <View style={[styles.statusBadge, { backgroundColor: scheme.errorContainer }]}>
              <LiveDot color={scheme.error} size={7} />
              <Text style={[styles.statusText, { color: scheme.onErrorContainer }]}>
                +{s.common.durMin(item.delayMin)}
              </Text>
            </View>
          ) : early ? (
            <View style={[styles.statusBadge, { backgroundColor: scheme.warningContainer }]}>
              <LiveDot color={scheme.warning} size={7} />
              <Text style={[styles.statusText, { color: scheme.onWarningContainer }]}>
                {s.common.durMin(item.delayMin)}
              </Text>
            </View>
          ) : onTime ? (
            <View style={[styles.statusBadge, { backgroundColor: scheme.successContainer }]}>
              <LiveDot color={scheme.success} size={7} />
              <Text style={[styles.statusText, { color: scheme.onSuccessContainer }]}>{s.routeDetails.onTime}</Text>
            </View>
          ) : (
            <View style={[styles.statusBadge, { backgroundColor: scheme.surfaceContainerHighest }]}>
              <History size={12} color={scheme.onSurfaceVariant} />
              <Text style={[styles.statusText, { color: scheme.onSurfaceVariant }]}>
                {offline ? s.routeDetails.scheduleCache : s.routeDetails.schedule}
              </Text>
            </View>
          )}
        </View>

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

            {/* Nawigacja do przystanku siedzi na dole ekranu, tam, gdzie
                sięga kciuk. Cały widget jest klikalny i otwiera pełną
                mapę trasy. */}
            <StopCompassCard
              connection={item}
              onOpenMap={() => router.push({ pathname: '/map', params: { id: item.id } })}
            />
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
  headerTrackBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    height: 36,
    borderRadius: shape.full,
    backgroundColor: scheme.surfaceContainerHigh,
    flexShrink: 0,
  },
  headerTrackBtnActive: {
    backgroundColor: scheme.primaryContainer,
  },
  headerTrackText: {
    ...type.labelMedium,
    color: scheme.onSurfaceVariant,
    fontWeight: '600',
  },
  headerTrackTextActive: {
    color: scheme.onPrimaryContainer,
    fontWeight: '700',
  },
  header: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, paddingVertical: 8 },
  iconBtn: { width: 40, height: 40, borderRadius: shape.full, backgroundColor: scheme.surfaceContainerHigh, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { flex: 1, ...type.titleMedium, fontWeight: '600', color: scheme.onSurface },
  body: { paddingHorizontal: 14, gap: 12, paddingBottom: 24 },
  summary: { backgroundColor: scheme.surfaceContainer, borderRadius: shape.large, padding: 16, gap: 8, ...elev.level1 },
  timeRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  times: { flexDirection: 'row', alignItems: 'center', gap: 8, flexShrink: 1 },
  timeBig: {
    fontSize: 28,
    fontWeight: '800',
    color: scheme.onSurface,
    fontVariant: ['tabular-nums'],
    letterSpacing: 0.5,
    includeFontPadding: false,
  },
  timeArrowWrap: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  durationPill: {
    backgroundColor: scheme.secondaryContainer,
    borderRadius: shape.full,
    paddingHorizontal: 14,
    paddingVertical: 8,
    flexShrink: 0,
  },
  durationText: { ...type.titleSmall, fontWeight: '700', color: scheme.onSecondaryContainer },
  routeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 2,
  },
  routeStop: {
    ...type.bodyLarge,
    color: scheme.onSurfaceVariant,
    flexShrink: 1,
  },
  routeArrowWrap: {
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 6,
    borderRadius: shape.full,
    paddingHorizontal: 10,
    paddingVertical: 4,
    marginTop: 4,
  },
  statusText: { ...type.labelSmall, fontWeight: '700' },
  offlineBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: scheme.warningContainer,
    borderRadius: shape.large,
    paddingHorizontal: 14,
    paddingVertical: 11,
  },
  offlineBannerText: { ...type.labelMedium, color: scheme.onWarningContainer, flex: 1 },
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
