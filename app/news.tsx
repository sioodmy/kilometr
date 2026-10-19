import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  ChevronLeft,
  Newspaper,
  RefreshCw,
  TriangleAlert,
} from 'lucide-react-native';
import { scheme, shape, type } from '../src/theme/tokens';
import { useStrings } from '../src/i18n';
import { LineBadge } from '../src/components/LineBadge';
import {
  fetchCityNews,
  getCachedNews,
  loadNewsCache,
  markNewsSeen,
  type MpkNewsItem,
} from '../src/services/mpkNews';
import { useActiveCity } from '../src/services/cityStore';
import {
  loadRecentRouteLines,
  newsTouchesLines,
} from '../src/services/recentRouteLines';

type NewsFilter = 'all' | 'myLines';

type Row =
  | { kind: 'head'; id: string; label: string }
  | { kind: 'item'; id: string; item: MpkNewsItem };

const NewsCard = memo(function NewsCard({
  item,
  operator,
  portal,
  onOpen,
}: {
  item: MpkNewsItem;
  operator: string;
  portal: string;
  onOpen: (item: MpkNewsItem) => void;
}) {
  const s = useStrings();
  return (
    <Pressable
      onPress={() => onOpen(item)}
      accessibilityRole="button"
      accessibilityLabel={item.title}
      android_ripple={{ color: scheme.outlineVariant }}
      style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
    >
      <View style={styles.metaRow}>
        <Text style={styles.sourceTag}>
          {item.source === 'mpk' ? s.news.sourceMpk(operator) : s.news.sourceCity(portal)}
        </Text>
        {item.dateLabel ? <Text style={styles.metaText}>{item.dateLabel}</Text> : null}
      </View>
      {item.urgent ? (
        <View style={styles.urgentLabel}>
          <TriangleAlert size={16} color={scheme.warning} />
          <Text style={styles.urgentText}>{s.news.chip}</Text>
        </View>
      ) : null}
      <Text style={styles.cardTitle}>{item.title}</Text>
      {item.lines.length > 0 ? (
        <View style={styles.linesRow}>
          {item.lines.slice(0, 8).map((line) => (
            <LineBadge key={line} line={line} compact />
          ))}
          {item.lines.length > 8 ? (
            <Text style={styles.moreLines}>+{item.lines.length - 8}</Text>
          ) : null}
        </View>
      ) : null}
      {item.source === 'city' && item.description ? (
        <Text style={styles.cardDesc} numberOfLines={2}>
          {item.description}
        </Text>
      ) : null}
    </Pressable>
  );
});

function SkeletonCard() {
  return (
    <View style={styles.card}>
      <View style={[styles.skel, { width: 110, height: 18 }]} />
      <View style={[styles.skel, { width: '92%', height: 14, marginTop: 10 }]} />
      <View style={[styles.skel, { width: '70%', height: 14, marginTop: 8 }]} />
    </View>
  );
}

export default function NewsScreen() {
  const s = useStrings();
  const router = useRouter();
  const { cityId } = useActiveCity();
  const operator = s.city.operator(cityId);
  const portal = s.city.portal(cityId);
  const cityName = s.city.name(cityId);
  const feedsLabel = s.city.newsSources(cityId);
  const [items, setItems] = useState<MpkNewsItem[]>(() => getCachedNews() ?? []);
  const [loading, setLoading] = useState(() => (getCachedNews()?.length ?? 0) === 0);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<NewsFilter>('all');
  const [myLines, setMyLines] = useState<string[]>([]);

  const refreshMyLines = useCallback(async () => {
    const lines = await loadRecentRouteLines();
    setMyLines(lines);
  }, []);

  const load = useCallback(
    async (isRefresh = false) => {
      if (isRefresh) setRefreshing(true);
      setError(null);
      try {
        const news = await fetchCityNews();
        setItems(news);
        void markNewsSeen(news);
        await refreshMyLines();
      } catch {
        setError(s.news.fetchFail);
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [s, refreshMyLines],
  );

  useEffect(() => {
    let live = true;
    void markNewsSeen();
    void (async () => {
      await refreshMyLines();
      if ((getCachedNews()?.length ?? 0) === 0) {
        const cached = await loadNewsCache();
        if (live && cached && cached.length > 0) {
          setItems(cached);
          setLoading(false);
        }
      }
      if (live) await load(false);
    })();
    return () => {
      live = false;
    };
  }, [load, refreshMyLines]);

  const openItem = useCallback(
    (item: MpkNewsItem) => {
      if (!item.link) return;
      router.push({
        pathname: '/article',
        params: {
          url: item.link,
          title: item.title,
          source: item.source,
          meta: item.dateLabel,
          lines: item.lines.join(','),
        },
      });
    },
    [router],
  );

  const myLineSet = useMemo(() => new Set(myLines), [myLines]);

  const visibleItems = useMemo(() => {
    if (filter !== 'myLines') return items;
    return items.filter((item) => newsTouchesLines(item, myLineSet));
  }, [filter, items, myLineSet]);

  const rows = useMemo(() => {
    const changes = visibleItems.filter((i) => i.source === 'mpk');
    const city = visibleItems.filter((i) => i.source !== 'mpk');
    const out: Row[] = [];
    if (changes.length) {
      out.push({ kind: 'head', id: 'h-mpk', label: s.news.sectionChanges });
      for (const item of changes) out.push({ kind: 'item', id: item.id, item });
    }
    if (city.length) {
      out.push({ kind: 'head', id: 'h-city', label: s.news.sectionCity });
      for (const item of city) out.push({ kind: 'item', id: item.id, item });
    }
    return out;
  }, [visibleItems, s]);

  const urgentCount = visibleItems.filter((i) => i.urgent).length;
  const filterEmpty =
    filter === 'myLines' && items.length > 0 && visibleItems.length === 0;

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <Pressable
          onPress={() => router.canGoBack() ? router.back() : router.replace('/')}
          style={styles.back}
          accessibilityRole="button"
          accessibilityLabel={s.map.backA11y}
        >
          <ChevronLeft size={23} color={scheme.onSurface} />
        </Pressable>
        <Text style={styles.headerCity}>{cityName}</Text>
        <Pressable
          onPress={() => void load(true)}
          style={styles.iconBtn}
          disabled={refreshing || loading}
          accessibilityRole="button"
          accessibilityState={{ disabled: refreshing || loading, busy: refreshing }}
          accessibilityLabel={s.news.refreshA11y}
        >
          {refreshing ? <ActivityIndicator size="small" color={scheme.primary} /> : <RefreshCw size={21} color={scheme.onSurface} />}
        </Pressable>
      </View>
      <View style={styles.headerText}>
        <Text style={styles.headerTitle} accessibilityRole="header">{s.news.title}</Text>
        <Text style={styles.headerSub}>
          {loading && items.length === 0
            ? s.news.sourceLoading(feedsLabel)
            : items.length === 0
              ? s.news.sourceEmpty(feedsLabel)
              : s.news.count(visibleItems.length, urgentCount)}
        </Text>
      </View>

      {items.length > 0 || myLines.length > 0 ? (
        <View style={styles.filterRow}>
          <Pressable
            onPress={() => setFilter('all')}
            style={[styles.filterChip, filter === 'all' && styles.filterChipOn]}
            accessibilityRole="button"
            accessibilityState={{ selected: filter === 'all' }}
          >
            <Text style={[styles.filterText, filter === 'all' && styles.filterTextOn]}>
              {s.news.filterAll}
            </Text>
          </Pressable>
          <Pressable
            onPress={() => setFilter('myLines')}
            style={[styles.filterChip, filter === 'myLines' && styles.filterChipOn]}
            accessibilityRole="button"
            accessibilityState={{ selected: filter === 'myLines' }}
            accessibilityLabel={s.news.filterMyLinesA11y}
          >
            <Text style={[styles.filterText, filter === 'myLines' && styles.filterTextOn]}>
              {s.news.filterMyLines}
            </Text>
          </Pressable>
        </View>
      ) : null}

      {loading && items.length === 0 ? (
        <ScrollView contentContainerStyle={styles.list}>
          <SkeletonCard />
          <SkeletonCard />
          <SkeletonCard />
          <View style={styles.loadingRow}>
            <ActivityIndicator size="small" color={scheme.primary} />
            <Text style={styles.stateText}>{s.news.loading}</Text>
          </View>
        </ScrollView>
      ) : error && items.length === 0 ? (
        <ScrollView contentContainerStyle={styles.center}>
          <View style={styles.stateIcon}>
            <Newspaper size={28} color={scheme.primary} />
          </View>
          <Text style={styles.stateTitle}>{s.news.noConnection}</Text>
          <Text style={styles.stateText}>{error}</Text>
          <Pressable
            onPress={() => { setLoading(true); void load(false); }}
            accessibilityRole="button"
            style={({ pressed }) => [styles.retryBtn, pressed && { opacity: 0.85 }]}
          >
            <Text style={styles.retryText}>{s.common.retry}</Text>
          </Pressable>
        </ScrollView>
      ) : (
        <FlatList
          data={rows}
          keyExtractor={(row) => row.id}
          contentContainerStyle={styles.list}
          showsVerticalScrollIndicator={false}
          overScrollMode="never"
          removeClippedSubviews={false}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => void load(true)}
              tintColor={scheme.primary}
              colors={[scheme.primary]}
            />
          }
          renderItem={({ item: row }) =>
            row.kind === 'head' ? (
              <Text style={styles.section} accessibilityRole="header">{row.label}</Text>
            ) : (
              <NewsCard item={row.item} operator={operator} portal={portal} onOpen={openItem} />
            )
          }
          ListEmptyComponent={
            <View style={styles.emptyWrap}>
              <View style={styles.stateIconMuted}>
                <Newspaper size={28} color={scheme.onSurfaceVariant} />
              </View>
              <Text style={styles.stateTitle}>
                {filterEmpty
                  ? myLines.length === 0
                    ? s.news.filterNoHistoryTitle
                    : s.news.filterEmptyTitle
                  : s.news.emptyTitle}
              </Text>
              <Text style={styles.stateText}>
                {filterEmpty
                  ? myLines.length === 0
                    ? s.news.filterNoHistoryBody
                    : s.news.filterEmptyBody
                  : s.news.emptyBody(cityName)}
              </Text>
            </View>
          }
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
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 16,
  },
  back: {
    width: 48,
    height: 48,
    borderRadius: 16,
    backgroundColor: scheme.surfaceContainerLow,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconBtn: {
    width: 48,
    height: 48,
    borderRadius: 16,
    backgroundColor: scheme.surfaceContainerLow,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerCity: { flex: 1, ...type.titleSmall, color: scheme.onSurfaceVariant },
  headerText: { paddingHorizontal: 24, paddingBottom: 24, gap: 6 },
  headerTitle: { ...type.displaySmall, fontSize: 32, lineHeight: 40, fontWeight: '500', color: scheme.onSurface },
  headerSub: { ...type.bodyMedium, color: scheme.onSurfaceVariant },
  filterRow: {
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: 20,
    paddingBottom: 12,
  },
  filterChip: {
    flex: 1,
    borderRadius: 16,
    backgroundColor: scheme.surfaceContainerLow,
    paddingHorizontal: 16,
    paddingVertical: 12,
    minHeight: 48,
    justifyContent: 'center',
    alignItems: 'center',
  },
  filterChipOn: { backgroundColor: scheme.secondaryContainer },
  filterText: { ...type.labelLarge, color: scheme.onSurfaceVariant, textAlign: 'center' },
  filterTextOn: { color: scheme.onSecondaryContainer, fontWeight: '600' },
  list: { paddingHorizontal: 20, paddingTop: 4, paddingBottom: 40, gap: 12 },
  section: {
    ...type.titleMedium,
    fontWeight: '500',
    color: scheme.onSurface,
    paddingTop: 16,
    paddingBottom: 4,
    paddingHorizontal: 4,
  },
  card: {
    backgroundColor: scheme.surfaceContainerLow,
    borderRadius: 28,
    padding: 20,
    gap: 12,
    overflow: 'hidden',
  },
  cardPressed: { opacity: 0.9 },
  metaRow: { flexDirection: 'row', alignItems: 'center', columnGap: 12, rowGap: 4, flexWrap: 'wrap', justifyContent: 'space-between' },
  metaText: { ...type.bodySmall, color: scheme.onSurfaceVariant, flexShrink: 1 },
  urgentLabel: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  urgentText: { ...type.labelMedium, fontWeight: '600', color: scheme.warning, flexShrink: 1 },
  sourceTag: { ...type.labelMedium, color: scheme.onSurfaceVariant, flexShrink: 1 },
  cardTitle: { ...type.titleLarge, fontSize: 20, lineHeight: 27, fontWeight: '500', color: scheme.onSurface },
  cardDesc: { ...type.bodyMedium, color: scheme.onSurfaceVariant },
  linesRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  moreLines: { ...type.labelSmall, color: scheme.onSurfaceVariant, alignSelf: 'center' },
  skel: { borderRadius: shape.small, backgroundColor: scheme.surfaceContainerHighest },
  loadingRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingTop: 8, flexWrap: 'wrap' },
  emptyWrap: { alignItems: 'center', gap: 12, paddingVertical: 40, paddingHorizontal: 12 },
  center: { flexGrow: 1, alignItems: 'center', justifyContent: 'center', gap: 12, padding: 24 },
  stateIcon: {
    width: 64,
    height: 64,
    borderRadius: 20,
    backgroundColor: scheme.secondaryContainer,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  stateIconMuted: {
    width: 64,
    height: 64,
    borderRadius: 20,
    backgroundColor: scheme.surfaceContainerHigh,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  stateTitle: { ...type.titleMedium, color: scheme.onSurface, textAlign: 'center' },
  stateText: { ...type.bodyMedium, color: scheme.onSurfaceVariant, textAlign: 'center' },
  retryBtn: {
    backgroundColor: scheme.primary,
    borderRadius: 16,
    minHeight: 48,
    justifyContent: 'center',
    paddingVertical: 12,
    paddingHorizontal: 24,
    marginTop: 8,
  },
  retryText: { ...type.titleSmall, fontWeight: '700', color: scheme.onPrimary },
});
