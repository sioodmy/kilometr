import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View, InteractionManager } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ArrowRight, ChevronLeft, History } from 'lucide-react-native';
import { elev, scheme, shape, type } from '../../src/theme/tokens';
import { RoutingService } from '../../src/services';
import { findCachedConnection, rehydrateConnections } from '../../src/services/offlineCache';
import type { Connection } from '../../src/types/models';
import { LegTimeline } from '../../src/components/LegTimeline';
import { LiveDot } from '../../src/components/LiveDot';
import { StopCompassCard } from '../../src/components/StopCompassCard';
import { RouteDetailsThumbBar } from '../../src/components/RouteDetailsThumbBar';

export default function RouteDetailsScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [item, setItem] = useState<Connection | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [offline, setOffline] = useState(false);

  useEffect(() => {
    if (id) {
      setLoadFailed(false);
      setOffline(false);
      const task = InteractionManager.runAfterInteractions(() => {
        RoutingService.getConnectionById(String(id)).then(async (c) => {
          if (c) {
            setItem(c);
          } else {
            // Offline: szczegóły z cache (pełne legs + intermediateStops).
            const cached = await findCachedConnection(String(id));
            if (cached) {
              setItem(rehydrateConnections([cached])[0]);
              setOffline(true);
            } else {
              setLoadFailed(true);
            }
          }
        });
      });
      return () => task.cancel();
    }
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
            <Text style={styles.routeStop} numberOfLines={1}>
              {item.fromTitle}
            </Text>
            <View style={styles.routeArrowWrap}>
              <ArrowRight size={14} color={scheme.onSurfaceVariant} strokeWidth={2.2} />
            </View>
            <Text style={styles.routeStop} numberOfLines={1}>
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
              <Text style={[styles.statusText, { color: scheme.onSurfaceVariant }]}>Rozkład</Text>
            </View>
          )}
        </View>

        <LegTimeline legs={item.legs} />

        {/* Radar wraz z wejściem w mapę trasy siedzi na dole ekranu —
            tam, gdzie sięga kciuk, a nie na górze pod nagłówkiem. */}
        <StopCompassCard
          connection={item}
          onOpenMap={() => router.push({ pathname: '/map', params: { id: item.id } })}
        />

        <View style={{ height: 90 }} />
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
});
