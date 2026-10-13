import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  ChevronLeft,
  Clock3,
  Newspaper,
  RefreshCw,
  TriangleAlert,
} from 'lucide-react-native';
import { elev, scheme, shape, type } from '../src/theme/tokens';
import { useStrings } from '../src/i18n';
import { LineBadge } from '../src/components/LineBadge';
import {
  fetchMpkNews,
  getCachedNews,
  loadNewsCache,
  markNewsSeen,
  type MpkNewsItem,
} from '../src/services/mpkNews';
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
  onOpen,
}: {
  item: MpkNewsItem;
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
        {item.dateLabel ? (
          <View style={styles.metaChip}>
            <Clock3 size={11} color={scheme.onSurfaceVariant} />
            <Text style={styles.metaText}>{item.dateLabel}</Text>
          </View>
        ) : null}
        {item.urgent ? (
          <View style={styles.urgentChip}>
            <TriangleAlert size={11} color={scheme.onWarningContainer} />
            <Text style={styles.urgentText}>{s.news.chip}</Text>
          </View>
        ) : null}
        <View style={styles.spacer} />
        <Text style={styles.sourceTag}>
          {item.source === 'mpk' ? s.news.sourceMpk : s.news.sourceCity}
        </Text>
      </View>
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
        const news = await fetchMpkNews();
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
        <Pressable onPress={() => router.back()} style={styles.back} hitSlop={10}>
          <ChevronLeft size={23} color={scheme.onSurface} />
        </Pressable>
        <View style={styles.headerText}>
          <Text style={styles.headerTitle}>{s.news.title}</Text>
          <Text style={styles.headerSub}>
            {loading && items.length === 0
              ? s.news.sourceLoading
              : items.length === 0
                ? s.news.sourceEmpty
                : s.news.count(visibleItems.length, urgentCount)}
          </Text>
        </View>
        <Pressable
          onPress={() => void load(true)}
          style={styles.iconBtn}
          hitSlop={10}
          accessibilityLabel={s.news.refreshA11y}
        >
          <RefreshCw size={18} color={scheme.onSurfaceVariant} />
        </Pressable>
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
              {myLines.length > 0 ? ` · ${myLines.length}` : ''}
            </Text>
          </Pressable>
        </View>
      ) : null}

      {loading && items.length === 0 ? (
        <View style={styles.list}>
          <SkeletonCard />
          <SkeletonCard />
          <SkeletonCard />
          <View style={styles.loadingRow}>
            <ActivityIndicator size="small" color={scheme.primary} />
            <Text style={styles.stateText}>{s.news.loading}</Text>
          </View>
        </View>
      ) : error && items.length === 0 ? (
        <View style={styles.center}>
          <View style={styles.stateIcon}>
            <Newspaper size={28} color={scheme.primary} />
          </View>
          <Text style={styles.stateTitle}>{s.news.noConnection}</Text>
          <Text style={styles.stateText}>{error}</Text>
          <Pressable
            onPress={() => void load(false)}
            style={({ pressed }) => [styles.retryBtn, pressed && { opacity: 0.85 }]}
          >
            <Text style={styles.retryText}>{s.common.retry}</Text>
          </Pressable>
        </View>
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
              <Text style={styles.section}>{row.label}</Text>
            ) : (
              <NewsCard item={row.item} onOpen={openItem} />
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
                  : s.news.emptyBody}
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
  filterRow: {
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: 14,
    paddingBottom: 8,
  },
  filterChip: {
    borderRadius: shape.full,
    backgroundColor: scheme.surfaceContainerHigh,
    paddingHorizontal: 14,
    paddingVertical: 8,
    minHeight: 36,
    justifyContent: 'center',
  },
  filterChipOn: { backgroundColor: scheme.secondaryContainer },
  filterText: { ...type.labelLarge, color: scheme.onSurfaceVariant },
  filterTextOn: { color: scheme.onSecondaryContainer, fontWeight: '600' },
  list: { paddingHorizontal: 14, paddingTop: 4, paddingBottom: 40, gap: 10 },
  section: {
    ...type.labelMedium,
    color: scheme.onSurfaceVariant,
    paddingTop: 10,
    paddingBottom: 2,
    paddingHorizontal: 2,
  },
  card: {
    backgroundColor: scheme.surfaceContainer,
    borderRadius: shape.large,
    padding: 14,
    gap: 8,
    ...elev.level1,
  },
  cardPressed: { opacity: 0.9 },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  spacer: { flex: 1, minWidth: 8 },
  metaChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: scheme.surfaceContainerHighest,
    borderRadius: shape.full,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  metaText: { ...type.labelSmall, color: scheme.onSurfaceVariant },
  urgentChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: scheme.warningContainer,
    borderRadius: shape.full,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  urgentText: { ...type.labelSmall, fontWeight: '700', color: scheme.onWarningContainer },
  sourceTag: { ...type.labelSmall, color: scheme.outline },
  cardTitle: { ...type.titleSmall, fontWeight: '600', color: scheme.onSurface, lineHeight: 20 },
  cardDesc: { ...type.bodySmall, color: scheme.onSurfaceVariant, lineHeight: 17 },
  linesRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  moreLines: { ...type.labelSmall, color: scheme.onSurfaceVariant, alignSelf: 'center' },
  skel: { borderRadius: shape.small, backgroundColor: scheme.surfaceContainerHighest },
  loadingRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingTop: 8 },
  emptyWrap: { alignItems: 'center', gap: 10, paddingTop: 72, paddingHorizontal: 24 },
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
  stateIconMuted: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: scheme.surfaceContainerHigh,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  stateTitle: { ...type.titleMedium, color: scheme.onSurface, textAlign: 'center' },
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
