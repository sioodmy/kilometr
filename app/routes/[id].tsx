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
import { RoutingService } from '../../src/services';
import { liveTracker } from '../../src/services/liveTracker';
import type { Connection } from '../../src/types/models';
import { LegTimeline } from '../../src/components/LegTimeline';
import { LiveDot } from '../../src/components/LiveDot';
import { StopCompassCard } from '../../src/components/StopCompassCard';
import { ActiveTripCard } from '../../src/components/ActiveTripCard';
import { RouteDetailsThumbBar } from '../../src/components/RouteDetailsThumbBar';
import { useThumbBarInset } from '../../src/components/ThumbBar';
import {
  areNotificationsSupported,
  ensureNotificationPermission,
  permissionDeniedMessage,
  startTracking,
  stopTracking,
  useTrackedTrip,
  type TrackedTrip,
} from '../../src/services/notifications';

export default function RouteDetailsScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [item, setItem] = useState<Connection | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [offline, setOffline] = useState(false);
  // Zapas na dole liczony z zmierzonej wysokości pływającego paska, nie
  // wpisany na oko. Wcześniej było tu sztywne 90 px, przez co przycisk
  // „Mapa trasy” na dole karty lądował pod paskiem i nie dało się go nacisnąć.
  const thumbInset = useThumbBarInset();

  const { trip: trackedTrip, progress: trackedProgress } = useTrackedTrip();

  // Ten ekran pokazuje dokładnie ten kurs, który jest śledzony (albo żaden).
  const isTrackedThis = trackedTrip != null && trackedTrip.connection.id === String(id);

  /** Śledzimy właśnie ten kurs, nie całe zapytanie — patrz ekran połączeń. */
  const handleTrack = async () => {
    if (!item) return;
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

  const handleReverseRoute = () => {
    if (!item || item.legs.length === 0) return;
    const firstLeg = item.legs[0];
    const lastLeg = item.legs[item.legs.length - 1];

    const revFromLat = lastLeg.toLat != null ? String(lastLeg.toLat) : '';
    const revFromLon = lastLeg.toLon != null ? String(lastLeg.toLon) : '';
    const revToLat = firstLeg.fromLat != null ? String(firstLeg.fromLat) : '';
    const revToLon = firstLeg.fromLon != null ? String(firstLeg.fromLon) : '';

    router.push({
      pathname: '/routes',
      params: {
        fromTitle: item.toTitle,
        fromLat: revFromLat,
        fromLon: revFromLon,
        toId: '',
        toTitle: item.fromTitle,
        toLat: revToLat,
        toLon: revToLon,
      },
    });
  };

  if (loadFailed) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.header}>
          <Pressable onPress={() => router.back()} style={styles.iconBtn} hitSlop={10}>
            <ChevronLeft size={23} color={scheme.onSurface} />
          </Pressable>
          <Text style={styles.headerTitle}>Szczegóły połączenia</Text>
        </View>
        <View style={styles.loading}>
          <Text style={styles.loadingText}>Nie udało się wczytać połączenia.</Text>
          <Pressable
            onPress={() => router.back()}
            style={({ pressed }) => [styles.retryBtn, pressed && { opacity: 0.8 }]}
          >
            <Text style={styles.retryText}>Wróć do listy</Text>
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
          <Text style={styles.headerTitle}>Szczegóły połączenia</Text>
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
  const liveStale = liveTracker.getLiveState() !== 'fresh';

  // Treść komunikatu o źródle danych. Kolejność ma znaczenie: połączenie
  // wzięte z dysku jest starsze od czegokolwiek, co pokaże feed live.
  const dataNote = offline
    ? 'Z pamięci offline — czasy według rozkładu, bez danych live'
    : liveStale
      ? 'Brak danych live — czasy według rozkładu'
      : null;

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      {/* M3 small top app bar */}
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.iconBtn} hitSlop={10}>
          <ChevronLeft size={23} color={scheme.onSurface} />
        </Pressable>
        <Text style={styles.headerTitle}>Szczegóły połączenia</Text>
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
                {item.durationMin} min
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
                +{item.delayMin} min
              </Text>
            </View>
          ) : early ? (
            <View style={[styles.statusBadge, { backgroundColor: scheme.warningContainer }]}>
              <LiveDot color={scheme.warning} size={7} />
              <Text style={[styles.statusText, { color: scheme.onWarningContainer }]}>
                {item.delayMin} min
              </Text>
            </View>
          ) : onTime ? (
            <View style={[styles.statusBadge, { backgroundColor: scheme.successContainer }]}>
              <LiveDot color={scheme.success} size={7} />
              <Text style={[styles.statusText, { color: scheme.onSuccessContainer }]}>Na czas</Text>
            </View>
          ) : (
            <View style={[styles.statusBadge, { backgroundColor: scheme.surfaceContainerHighest }]}>
              <History size={12} color={scheme.onSurfaceVariant} />
              <Text style={[styles.statusText, { color: scheme.onSurfaceVariant }]}>
                {offline ? 'Rozkład z cache' : 'Rozkład'}
              </Text>
            </View>
          )}
        </View>

        {isTrackedThis && trackedProgress && trackedTrip ? (
          <View style={styles.trackSlot}>
            <ActiveTripCard
              trip={trackedTrip}
              progress={trackedProgress}
              onStop={() => void stopTracking()}
            />
          </View>
        ) : (
          <Pressable
            onPress={handleTrack}
            accessibilityRole="button"
            accessibilityLabel="Śledź to połączenie — odliczanie i postęp w powiadomieniu"
            style={({ pressed }) => [styles.trackCta, pressed && { opacity: 0.8 }]}
          >
            <Radio size={17} color={scheme.onPrimaryContainer} />
            <Text style={styles.trackCtaText}>Śledź to połączenie</Text>
          </Pressable>
        )}

        {noLegs ? (
          <View style={styles.emptyCard}>
            <RouteOff size={20} color={scheme.onSurfaceVariant} strokeWidth={2} />
            <Text style={styles.emptyTitle}>Brak przebiegu trasy</Text>
            <Text style={styles.emptyText}>
              To połączenie nie ma zapisanych przystanków, więc nie da się narysować
              trasy ani wskazać najbliższego przystanku. Wróć do listy i wybierz
              inne połączenie.
            </Text>
            <Pressable
              onPress={() => router.back()}
              style={({ pressed }) => [styles.retryBtn, pressed && { opacity: 0.8 }]}
            >
              <Text style={styles.retryText}>Wróć do listy</Text>
            </Pressable>
          </View>
        ) : (
          <>
            <LegTimeline legs={item.legs} />

            {/* Radar wraz z wejściem w mapę trasy siedzi na dole ekranu —
                tam, gdzie sięga kciuk, a nie na górze pod nagłówkiem. */}
            <StopCompassCard
              connection={item}
              onOpenMap={() => router.push({ pathname: '/map', params: { id: item.id } })}
            />
          </>
        )}

        <View style={{ height: thumbInset }} />
      </ScrollView>

      {/* Pływający dolny pasek kciuka: łatwy powrót i trasa powrotna */}
      <RouteDetailsThumbBar
        onBack={() => router.back()}
        onReverseRoute={handleReverseRoute}
      />
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
  trackSlot: { marginBottom: 12 },
  trackCta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: scheme.primaryContainer,
    borderRadius: shape.full,
    paddingVertical: 13,
    marginBottom: 12,
  },
  trackCtaText: { ...type.labelLarge, fontWeight: '700', color: scheme.onPrimaryContainer },
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
