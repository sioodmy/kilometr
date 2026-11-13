import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import Animated, { FadeIn, FadeInDown, useReducedMotion } from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import { ChevronDown, ChevronLeft, ChevronUp, ExternalLink } from '../src/components/icons';
import { scheme, shape, type } from '../src/theme/tokens';
import { useStrings } from '../src/i18n';
import { useActiveCity } from '../src/services/cityStore';
import { LineBadge } from '../src/components/LineBadge';
import { DisruptionDetailView } from '../src/components/DisruptionDetailView';
import {
  fetchArticle,
  findNewsItemForDetail,
  getCachedNews,
  normalizeArticleUrl,
  type ArticleBlock,
  type DisruptionAlert,
} from '../src/services/mpkNews';

export default function ArticleScreen() {
  const s = useStrings();
  const { cityId } = useActiveCity();
  const router = useRouter();
  const goBack = () => (router.canGoBack() ? router.back() : router.replace('/news'));
  const params = useLocalSearchParams<{
    id?: string;
    url?: string;
    title?: string;
    source?: string;
    meta?: string;
    lines?: string;
  }>();

  const itemId = typeof params.id === 'string' ? params.id : '';
  const url = typeof params.url === 'string' ? params.url : '';
  // Feed jest danymi z zewnątrz: pobieramy i otwieramy tylko sprawdzony link.
  const safeUrl = useMemo(() => normalizeArticleUrl(url), [url]);
  const title = typeof params.title === 'string' ? params.title : '';
  const meta = typeof params.meta === 'string' ? params.meta : '';
  const rawSource = typeof params.source === 'string' ? params.source : 'city';

  const lines = useMemo(
    () =>
      (typeof params.lines === 'string' ? params.lines : '')
        .split(',')
        .map((x) => x.trim())
        .filter(Boolean),
    [params.lines],
  );

  const [disruption, setDisruption] = useState<DisruptionAlert | null>(() => {
    const mem = getCachedNews();
    if (!mem) return null;
    const hit = mem.find(
      (i) =>
        (itemId && i.id === itemId) ||
        (safeUrl && (normalizeArticleUrl(i.link) || i.link) === safeUrl),
    );
    return hit?.disruption ?? null;
  });

  const [showOriginal, setShowOriginal] = useState(false);
  const [blocks, setBlocks] = useState<ArticleBlock[]>([]);
  const [loading, setLoading] = useState(() => !disruption);
  const [empty, setEmpty] = useState(false);
  const [retryCount, setRetryCount] = useState(0);
  const reduceMotion = useReducedMotion();

  useEffect(() => {
    let live = true;
    void findNewsItemForDetail(itemId, safeUrl || url).then((found) => {
      if (live && found?.disruption) {
        setDisruption(found.disruption);
      }
    });
    return () => {
      live = false;
    };
  }, [itemId, safeUrl, url]);

  const shouldFetchArticle = Boolean(safeUrl && (!disruption || showOriginal));

  useEffect(() => {
    if (!safeUrl) {
      setLoading(false);
      setEmpty(true);
      return;
    }
    if (!shouldFetchArticle) {
      setLoading(false);
      return;
    }
    if (blocks.length > 0 && retryCount === 0) {
      setLoading(false);
      return;
    }

    let live = true;
    setLoading(true);
    setEmpty(false);
    void (async () => {
      try {
        const next = await fetchArticle(safeUrl);
        if (!live) return;
        setBlocks(next);
        setEmpty(next.length === 0);
      } catch {
        if (live) setEmpty(true);
      } finally {
        if (live) setLoading(false);
      }
    })();
    return () => {
      live = false;
    };
  }, [safeUrl, shouldFetchArticle, retryCount]);

  const openBrowser = useCallback(() => {
    if (!safeUrl) return;
    void Linking.openURL(safeUrl).catch(() => {});
  }, [safeUrl]);

  const sourceLabel =
    rawSource === 'mpk'
      ? s.news.sourceMpk(s.city.operator(cityId))
      : rawSource === 'city' || !rawSource
        ? s.news.sourceCity(s.city.portal(cityId))
        : rawSource;

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <Pressable
          onPress={goBack}
          style={({ pressed }) => [
            styles.back,
            pressed && { opacity: 0.75, transform: [{ scale: 0.94 }] },
          ]}
          hitSlop={10}
          accessibilityLabel={s.map.backA11y}
          accessibilityRole="button"
        >
          <ChevronLeft size={23} color={scheme.onSurface} />
        </Pressable>
        <Text style={styles.source} numberOfLines={1}>
          {sourceLabel}
        </Text>
      </View>

      <ScrollView
        contentContainerStyle={styles.body}
        showsVerticalScrollIndicator={false}
        overScrollMode="never"
      >
        {disruption ? (
          <>
            <DisruptionDetailView
              alert={disruption}
              fallbackTitle={title}
              fallbackMeta={meta}
              fallbackLines={lines}
            />

            {safeUrl ? (
              <View style={styles.originalSection}>
                <Pressable
                  onPress={() => {
                    void Haptics.selectionAsync().catch(() => {});
                    setShowOriginal((prev) => !prev);
                  }}
                  accessibilityRole="button"
                  accessibilityState={{ expanded: showOriginal }}
                  style={({ pressed }) => [
                    styles.originalToggle,
                    pressed && { opacity: 0.85 },
                  ]}
                >
                  <Text style={styles.originalToggleText}>
                    {showOriginal
                      ? s.news.detail.originalNoticeHide
                      : s.news.detail.originalNoticeShow}
                  </Text>
                  {showOriginal ? (
                    <ChevronUp size={20} color={scheme.onSurfaceVariant} />
                  ) : (
                    <ChevronDown size={20} color={scheme.onSurfaceVariant} />
                  )}
                </Pressable>

                {showOriginal ? (
                  loading ? (
                    <View style={styles.loadingBlock}>
                      <ActivityIndicator color={scheme.primary} />
                      <Text style={styles.loadingLabel}>{s.news.loading}</Text>
                    </View>
                  ) : empty ? (
                    <View style={styles.failBlock}>
                      <Text style={styles.fail}>{s.news.articleFail}</Text>
                      <Text style={styles.failSub}>{s.news.articleEmpty}</Text>
                    </View>
                  ) : (
                    <View style={styles.originalBodyCard}>
                      {blocks.map((block, i) =>
                        block.kind === 'h' ? (
                          <Text key={i} style={styles.heading}>
                            {block.text}
                          </Text>
                        ) : (
                          <Text key={i} style={styles.para}>
                            {block.text}
                          </Text>
                        ),
                      )}
                    </View>
                  )
                ) : null}
              </View>
            ) : null}
          </>
        ) : (
          <>
            <Animated.View entering={reduceMotion ? undefined : FadeIn.duration(200)}>
              <Text style={styles.title}>{title}</Text>
              {meta ? <Text style={styles.meta}>{meta}</Text> : null}
              {lines.length > 0 ? (
                <View style={styles.linesRow}>
                  {lines.map((line) => (
                    <LineBadge key={line} line={line} compact />
                  ))}
                </View>
              ) : null}
            </Animated.View>

            {loading ? (
              <View style={styles.loadingBlock}>
                <ActivityIndicator color={scheme.primary} />
                <Text style={styles.loadingLabel}>{s.news.loading}</Text>
                <View style={[styles.skel, { width: '100%' }]} />
                <View style={[styles.skel, { width: '94%' }]} />
                <View style={[styles.skel, { width: '78%' }]} />
              </View>
            ) : empty ? (
              <View style={styles.failBlock}>
                <Text style={styles.fail}>{s.news.articleFail}</Text>
                <Text style={styles.failSub}>{s.news.articleEmpty}</Text>
                {safeUrl ? (
                  <Pressable
                    onPress={() => setRetryCount((n) => n + 1)}
                    accessibilityRole="button"
                    style={({ pressed }) => [
                      styles.retryBtn,
                      pressed && { opacity: 0.85 },
                    ]}
                  >
                    <Text style={styles.retryBtnText}>{s.common.retry}</Text>
                  </Pressable>
                ) : null}
              </View>
            ) : (
              <Animated.View
                entering={reduceMotion ? undefined : FadeInDown.duration(240)}
                style={styles.article}
              >
                {blocks.map((block, i) =>
                  block.kind === 'h' ? (
                    <Text key={i} style={styles.heading}>
                      {block.text}
                    </Text>
                  ) : (
                    <Text key={i} style={styles.para}>
                      {block.text}
                    </Text>
                  ),
                )}
              </Animated.View>
            )}
          </>
        )}

        {safeUrl ? (
          <Pressable
            onPress={() => {
              void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
              openBrowser();
            }}
            accessibilityRole="link"
            accessibilityLabel={s.news.openBrowser}
            style={({ pressed }) => [
              !disruption && empty ? styles.browserStrong : styles.browserSoft,
              pressed && { opacity: 0.85, transform: [{ scale: 0.98 }] },
            ]}
          >
            <ExternalLink
              size={16}
              color={!disruption && empty ? scheme.onSecondaryContainer : scheme.primary}
            />
            <Text style={!disruption && empty ? styles.browserStrongText : styles.browserSoftText}>
              {s.news.openBrowser}
            </Text>
          </Pressable>
        ) : null}
      </ScrollView>
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
    width: 48,
    height: 48,
    borderRadius: shape.full,
    backgroundColor: scheme.surfaceContainerHigh,
    alignItems: 'center',
    justifyContent: 'center',
  },
  source: { ...type.labelMedium, color: scheme.onSurfaceVariant, flex: 1 },
  body: { paddingHorizontal: 18, paddingBottom: 40 },
  title: {
    ...type.headlineSmall,
    fontWeight: '600',
    letterSpacing: -0.2,
    color: scheme.onSurface,
    marginTop: 4,
    lineHeight: 32,
  },
  meta: { ...type.labelMedium, color: scheme.onSurfaceVariant, marginTop: 10 },
  linesRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 14 },
  loadingBlock: { marginTop: 20, gap: 10, alignItems: 'flex-start' },
  loadingLabel: { ...type.bodySmall, color: scheme.onSurfaceVariant },
  skel: {
    height: 12,
    borderRadius: shape.small,
    backgroundColor: scheme.surfaceContainerHighest,
    marginTop: 4,
  },
  article: { marginTop: 20 },
  originalSection: {
    marginTop: 28,
    gap: 12,
  },
  originalToggle: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: shape.large,
    backgroundColor: scheme.surfaceContainerLow,
  },
  originalToggleText: {
    ...type.titleSmall,
    color: scheme.onSurface,
    flex: 1,
  },
  originalBodyCard: {
    backgroundColor: scheme.surfaceContainerLowest,
    borderRadius: shape.large,
    padding: 16,
  },
  heading: {
    ...type.titleMedium,
    fontWeight: '600',
    color: scheme.onSurface,
    marginTop: 14,
    marginBottom: 8,
  },
  para: {
    ...type.bodyLarge,
    lineHeight: 24,
    color: scheme.onSurface,
    marginBottom: 12,
  },
  failBlock: { marginTop: 20, gap: 8, alignItems: 'flex-start' },
  fail: { ...type.bodyLarge, color: scheme.onSurface },
  failSub: { ...type.bodySmall, color: scheme.onSurfaceVariant },
  retryBtn: {
    marginTop: 8,
    minHeight: 48,
    justifyContent: 'center',
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: shape.full,
    backgroundColor: scheme.secondaryContainer,
  },
  retryBtnText: {
    ...type.labelLarge,
    fontWeight: '700',
    color: scheme.onSecondaryContainer,
  },
  browserStrong: {
    marginTop: 24,
    minHeight: 48,
    alignSelf: 'stretch',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: scheme.secondaryContainer,
    borderRadius: shape.full,
    paddingVertical: 14,
    paddingHorizontal: 18,
  },
  browserStrongText: {
    ...type.titleSmall,
    fontWeight: '600',
    color: scheme.onSecondaryContainer,
  },
  browserSoft: {
    marginTop: 20,
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    minHeight: 48,
    paddingVertical: 10,
    paddingHorizontal: 4,
  },
  browserSoftText: { ...type.titleSmall, color: scheme.primary },
});
