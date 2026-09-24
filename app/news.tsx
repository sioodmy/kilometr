import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Linking,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  ArrowUpRight,
  ChevronLeft,
  Clock3,
  Newspaper,
  RefreshCw,
  TriangleAlert,
} from 'lucide-react-native';
import { elev, scheme, shape, type } from '../src/theme/tokens';
import { fetchMpkNews, type MpkNewsItem } from '../src/services/mpkNews';

function NewsCard({ item, onOpen }: { item: MpkNewsItem; onOpen: (item: MpkNewsItem) => void }) {
  const urgent = item.urgent;
  return (
    <Pressable
      onPress={() => onOpen(item)}
      accessibilityRole="link"
      accessibilityLabel={item.title}
      android_ripple={{ color: scheme.outlineVariant, borderless: false }}
      style={({ pressed }) => [styles.card, pressed && { opacity: 0.85 }]}
    >
      <View style={styles.cardBody}>
        <View style={styles.chipRow}>
          {item.dateLabel ? (
            <View style={styles.timeChip}>
              <Clock3 size={11} color={scheme.onSurfaceVariant} />
              <Text style={styles.timeText}>{item.dateLabel}</Text>
            </View>
          ) : null}
          {urgent ? (
            <View style={styles.urgentChip}>
              <TriangleAlert size={11} color={scheme.onErrorContainer} />
              <Text style={styles.urgentText}>Utrudnienia</Text>
            </View>
          ) : null}
          <View style={styles.spacer} />
          <ArrowUpRight size={15} color={scheme.outline} />
        </View>
        <Text style={styles.cardTitle} numberOfLines={2} ellipsizeMode="tail">
          {item.title}
        </Text>
        {item.description ? (
          <Text style={styles.cardDesc} numberOfLines={2} ellipsizeMode="tail">
            {item.description}
          </Text>
        ) : null}
      </View>
    </Pressable>
  );
}

function SkeletonCard() {
  return (
    <View style={styles.card}>
      <View style={styles.cardBody}>
        <View style={[styles.skelLine, { width: 90 }]} />
        <View style={[styles.skelLine, { width: '95%' }]} />
        <View style={[styles.skelLine, { width: '80%' }]} />
      </View>
    </View>
  );
}

export default function NewsScreen() {
  const router = useRouter();
  const [items, setItems] = useState<MpkNewsItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    setError(null);
    try {
      const news = await fetchMpkNews();
      setItems(news);
    } catch {
      setError('Nie udało się pobrać aktualności. Sprawdź internet i spróbuj ponownie.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load(false);
  }, [load]);

  const openItem = useCallback((item: MpkNewsItem) => {
    if (!item.link) return;
    void Linking.openURL(item.link).catch(() => {});
  }, []);

  const urgentCount = items.filter((i) => i.urgent).length;

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.back} hitSlop={10}>
          <ChevronLeft size={23} color={scheme.onSurface} />
        </Pressable>
        <View style={styles.headerText}>
          <Text style={styles.headerTitle}>Aktualności</Text>
          <Text style={styles.headerSub}>
            {loading
              ? 'MPK Wrocław'
              : items.length === 0
                ? 'MPK Wrocław • wroclaw.pl'
                : `${items.length} wiadomości${urgentCount ? ` • ${urgentCount} pilne` : ''}`}
          </Text>
        </View>
        <Pressable
          onPress={() => void load(true)}
          style={styles.iconBtn}
          hitSlop={10}
          accessibilityLabel="Odśwież aktualności"
        >
          <RefreshCw size={18} color={scheme.onSurfaceVariant} />
        </Pressable>
      </View>

      {loading ? (
        <View style={styles.list}>
          <SkeletonCard />
          <SkeletonCard />
          <SkeletonCard />
          <SkeletonCard />
          <View style={styles.loadingRow}>
            <ActivityIndicator size="small" color={scheme.primary} />
            <Text style={styles.loadingText}>Pobieranie komunikatów…</Text>
          </View>
        </View>
      ) : error && items.length === 0 ? (
        <View style={styles.center}>
          <View style={styles.stateIcon}>
            <Newspaper size={28} color={scheme.primary} />
          </View>
          <Text style={styles.stateTitle}>Brak połączenia</Text>
          <Text style={styles.stateText}>{error}</Text>
          <Pressable
            onPress={() => void load(false)}
            style={({ pressed }) => [styles.retryBtn, pressed && { opacity: 0.8 }]}
          >
            <Text style={styles.retryText}>Spróbuj ponownie</Text>
          </Pressable>
        </View>
      ) : (
        <FlatList
          data={items}
          keyExtractor={(it) => it.id}
          contentContainerStyle={styles.list}
          showsVerticalScrollIndicator={false}
          overScrollMode="never"
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => void load(true)}
              tintColor={scheme.primary}
              colors={[scheme.primary]}
            />
          }
          renderItem={({ item }) => <NewsCard item={item} onOpen={openItem} />}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: scheme.surface },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
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
  iconBtn: {
    width: 40,
    height: 40,
    borderRadius: shape.full,
    backgroundColor: scheme.surfaceContainerHigh,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerText: { flex: 1, minWidth: 0 },
  headerTitle: { ...type.titleMedium, fontWeight: '600', color: scheme.onSurface },
  headerSub: { ...type.labelSmall, color: scheme.onSurfaceVariant, marginTop: 1 },
  list: { paddingHorizontal: 14, paddingTop: 8, paddingBottom: 40, gap: 12 },
  // M3 elevated card
  card: {
    backgroundColor: scheme.surfaceContainer,
    borderRadius: 20,
    padding: 14,
    overflow: 'hidden',
    ...elev.level1,
  },
  cardBody: { flex: 1, minWidth: 0, gap: 4 },
  chipRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  spacer: { flex: 1 },
  timeChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: scheme.surfaceContainerHighest,
    borderRadius: shape.full,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  timeText: { ...type.labelSmall, color: scheme.onSurfaceVariant },
  urgentChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: scheme.errorContainer,
    borderRadius: shape.full,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  urgentText: { ...type.labelSmall, fontWeight: '700', color: scheme.onErrorContainer },
  cardTitle: { ...type.titleSmall, fontWeight: '600', color: scheme.onSurface, lineHeight: 18 },
  cardDesc: { ...type.bodySmall, color: scheme.onSurfaceVariant, lineHeight: 17 },
  // loading / empty / error (M3 tonal)
  loadingRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  loadingText: { ...type.bodySmall, color: scheme.onSurfaceVariant },
  skelLine: { height: 10, borderRadius: 5, backgroundColor: scheme.surfaceContainerHighest },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8, padding: 24 },
  stateIcon: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: scheme.secondaryContainer,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  stateTitle: { ...type.titleMedium, color: scheme.onSurface },
  stateText: { ...type.bodySmall, color: scheme.onSurfaceVariant, textAlign: 'center' },
  retryBtn: {
    backgroundColor: scheme.primary,
    borderRadius: shape.full,
    paddingVertical: 12,
    paddingHorizontal: 24,
    marginTop: 8,
  },
  retryText: { ...type.titleSmall, fontWeight: '700', color: scheme.onPrimary },
});
