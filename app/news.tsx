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
import Animated, {
  ReduceMotion,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';
import {
  Check,
  ChevronLeft,
  CircleCheck,
  Newspaper,
  RefreshCw,
  TriangleAlert,
} from '../src/components/icons';
import { scheme, shape, type } from '../src/theme/tokens';
import { useStrings } from '../src/i18n';
import { LineBadge } from '../src/components/LineBadge';
import {
  fetchCityNews,
  getCachedNews,
  loadNewsCache,
  markNewsSeen,
  formatNewsDate,
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

type Tone = 'urgent' | 'resolved' | 'quiet';

function toneColors(tone: Tone) {
  if (tone === 'urgent') {
    return {
      card: scheme.warningContainer,
      ink: scheme.onWarningContainer,
      muted: scheme.onWarningContainer,
    };
  }
  if (tone === 'resolved') {
    return { card: scheme.surfaceContainerLowest, ink: scheme.onSurfaceVariant, muted: scheme.outline };
  }
  return { card: scheme.surfaceContainerLow, ink: scheme.onSurface, muted: scheme.onSurfaceVariant };
}

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

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
  const resolved = Boolean(item.disruption?.is_resolved);
  const tone: Tone = resolved ? 'resolved' : item.urgent ? 'urgent' : 'quiet';
  const c = toneColors(tone);
  const solution = item.disruption?.glance?.solution;
  const press = useSharedValue(0);
  const animated = useAnimatedStyle(() => ({
    borderRadius: 28 - press.value * 8,
    transform: [{ scale: 1 - press.value * 0.015 }],
  }));
  const setPress = (value: number) => {
    press.value = withSpring(value, {
      damping: 22,
      stiffness: 400,
      reduceMotion: ReduceMotion.System,
    });
  };
  return (
    <AnimatedPressable
      onPress={() => onOpen(item)}
      onPressIn={() => setPress(1)}
      onPressOut={() => setPress(0)}
      accessibilityRole="button"
      accessibilityLabel={item.title}
      android_ripple={{ color: scheme.outlineVariant }}
      style={[styles.card, { backgroundColor: c.card }, animated]}
    >
      <View style={styles.metaRow}>
        <Text style={[styles.sourceTag, { color: c.muted }]}>
          {item.source === 'mpk' ? s.news.sourceMpk(operator) : s.news.sourceCity(portal)}
        </Text>
        {item.pubDate ? (
          <Text style={[styles.metaText, { color: c.muted }]}>{formatNewsDate(item.pubDate)}</Text>
        ) : item.dateLabel ? (
          <Text style={[styles.metaText, { color: c.muted }]}>{item.dateLabel}</Text>
        ) : null}
      </View>
      {resolved ? (
        <View style={styles.resolvedLabel}>
          <CircleCheck size={14} color={scheme.onPrimaryContainer} />
          <Text style={styles.resolvedText}>{s.news.resolved}</Text>
        </View>
      ) : item.urgent ? (
        <View style={styles.urgentLabel}>
          <TriangleAlert size={16} color={c.ink} />
          <Text style={[styles.urgentText, { color: c.ink }]}>{s.news.chip}</Text>
        </View>
      ) : null}
      <Text style={[styles.cardTitle, { color: c.ink }]}>{item.title}</Text>
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
      {item.disruption?.glance?.problem ? (
        <Text style={[styles.cardDesc, { color: c.muted }]} numberOfLines={2}>
          {item.disruption.glance.problem}
        </Text>
      ) : item.source === 'city' && item.description ? (
        <Text style={[styles.cardDesc, { color: c.muted }]} numberOfLines={2}>
          {item.description}
        </Text>
      ) : null}
      {solution ? (
        <View
          style={[
            styles.solutionBox,
            tone === 'urgent' && { backgroundColor: scheme.onWarningContainer + '1F' },
          ]}
        >
          <Text style={[styles.solutionLabel, { color: c.muted }]}>{s.news.solutionLabel}</Text>
          <Text style={[styles.cardSolution, { color: c.ink }]} numberOfLines={3}>
            {solution}
          </Text>
        </View>
      ) : null}
    </AnimatedPressable>
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
          meta: item.pubDate ? formatNewsDate(item.pubDate) : item.dateLabel,
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
        <View style={styles.segment}>
          <Pressable
            onPress={() => setFilter('all')}
            style={[styles.segmentItem, filter === 'all' && styles.segmentItemOn]}
            accessibilityRole="button"
            accessibilityState={{ selected: filter === 'all' }}
          >
            {filter === 'all' ? <Check size={16} color={scheme.onSecondaryContainer} /> : null}
            <Text style={[styles.segmentText, filter === 'all' && styles.segmentTextOn]}>
              {s.news.filterAll}
            </Text>
          </Pressable>
          <Pressable
            onPress={() => setFilter('myLines')}
            style={[styles.segmentItem, filter === 'myLines' && styles.segmentItemOn]}
            accessibilityRole="button"
            accessibilityState={{ selected: filter === 'myLines' }}
            accessibilityLabel={s.news.filterMyLinesA11y}
          >
            {filter === 'myLines' ? (
              <Check size={16} color={scheme.onSecondaryContainer} />
            ) : null}
            <Text style={[styles.segmentText, filter === 'myLines' && styles.segmentTextOn]}>
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
    borderRadius: shape.full,
    backgroundColor: scheme.surfaceContainerLow,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconBtn: {
    width: 48,
    height: 48,
    borderRadius: shape.full,
    backgroundColor: scheme.surfaceContainerLow,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerCity: { flex: 1, ...type.titleSmall, color: scheme.onSurfaceVariant },
  headerText: { paddingHorizontal: 24, paddingBottom: 24, gap: 6 },
  headerTitle: {
    ...type.displaySmall,
    fontSize: 34,
    lineHeight: 40,
    fontWeight: '600',
    letterSpacing: -0.4,
    color: scheme.onSurface,
  },
  headerSub: { ...type.bodyMedium, color: scheme.onSurfaceVariant },
  segment: {
    flexDirection: 'row',
    gap: 4,
    marginHorizontal: 20,
    marginBottom: 12,
    padding: 4,
    borderRadius: shape.full,
    backgroundColor: scheme.surfaceContainerHighest,
  },
  segmentItem: {
    flex: 1,
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingHorizontal: 12,
    borderRadius: shape.full,
  },
  segmentItemOn: { backgroundColor: scheme.secondaryContainer },
  segmentText: { ...type.labelLarge, color: scheme.onSurfaceVariant },
  segmentTextOn: { color: scheme.onSecondaryContainer, fontWeight: '600' },
  list: { paddingHorizontal: 20, paddingTop: 4, paddingBottom: 40, gap: 12 },
  section: {
    ...type.titleMedium,
    fontWeight: '600',
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
  metaRow: { flexDirection: 'row', alignItems: 'center', columnGap: 12, rowGap: 4, flexWrap: 'wrap', justifyContent: 'space-between' },
  metaText: { ...type.bodySmall, flexShrink: 1 },
  urgentLabel: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  urgentText: { ...type.labelMedium, fontWeight: '600', flexShrink: 1 },
  resolvedLabel: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: scheme.primaryContainer,
    borderRadius: shape.full,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  resolvedText: { ...type.labelMedium, fontWeight: '700', color: scheme.onPrimaryContainer },
  solutionBox: {
    backgroundColor: scheme.surface,
    borderRadius: shape.large,
    padding: 12,
    gap: 4,
  },
  solutionLabel: { ...type.labelMedium, fontWeight: '600' },
  cardSolution: { ...type.bodyMedium, lineHeight: 20 },
  sourceTag: { ...type.labelMedium, flexShrink: 1 },
  cardTitle: { ...type.titleLarge, fontSize: 20, lineHeight: 27, fontWeight: '500' },
  cardDesc: { ...type.bodyMedium },
  linesRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  moreLines: { ...type.labelSmall, color: scheme.onSurfaceVariant, alignSelf: 'center' },
  skel: { borderRadius: shape.small, backgroundColor: scheme.surfaceContainerHighest },
  loadingRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingTop: 8, flexWrap: 'wrap' },
  emptyWrap: { alignItems: 'center', gap: 12, paddingVertical: 40, paddingHorizontal: 12 },
  center: { flexGrow: 1, alignItems: 'center', justifyContent: 'center', gap: 12, padding: 24 },
  stateIcon: {
    width: 64,
    height: 64,
    borderRadius: 24,
    backgroundColor: scheme.secondaryContainer,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  stateIconMuted: {
    width: 64,
    height: 64,
    borderRadius: 24,
    backgroundColor: scheme.surfaceContainerHigh,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  stateTitle: { ...type.titleMedium, color: scheme.onSurface, textAlign: 'center' },
  stateText: { ...type.bodyMedium, color: scheme.onSurfaceVariant, textAlign: 'center' },
  retryBtn: {
    backgroundColor: scheme.primary,
    borderRadius: shape.full,
    minHeight: 48,
    justifyContent: 'center',
    paddingVertical: 12,
    paddingHorizontal: 24,
    marginTop: 8,
  },
  retryText: { ...type.titleSmall, fontWeight: '700', color: scheme.onPrimary },
});
