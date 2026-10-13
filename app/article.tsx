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
import { ChevronLeft, ExternalLink } from 'lucide-react-native';
import { scheme, shape, type } from '../src/theme/tokens';
import { useStrings } from '../src/i18n';
import { LineBadge } from '../src/components/LineBadge';
import { fetchArticle, type ArticleBlock, type NewsSource } from '../src/services/mpkNews';

export default function ArticleScreen() {
  const s = useStrings();
  const router = useRouter();
  const params = useLocalSearchParams<{
    url?: string;
    title?: string;
    source?: string;
    meta?: string;
    lines?: string;
  }>();
  const url = typeof params.url === 'string' ? params.url : '';
  const title = typeof params.title === 'string' ? params.title : '';
  const meta = typeof params.meta === 'string' ? params.meta : '';
  const source: NewsSource = params.source === 'mpk' ? 'mpk' : 'city';
  const lines = useMemo(
    () =>
      (typeof params.lines === 'string' ? params.lines : '')
        .split(',')
        .map((x) => x.trim())
        .filter(Boolean),
    [params.lines],
  );
  const [blocks, setBlocks] = useState<ArticleBlock[]>([]);
  const [loading, setLoading] = useState(true);
  const [empty, setEmpty] = useState(false);

  useEffect(() => {
    if (!url) {
      setLoading(false);
      setEmpty(true);
      return;
    }
    let live = true;
    void (async () => {
      try {
        const next = await fetchArticle(url);
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
  }, [url]);

  const openBrowser = useCallback(() => {
    if (!url) return;
    void Linking.openURL(url).catch(() => {});
  }, [url]);

  const sourceLabel = source === 'mpk' ? s.news.sourceMpk : s.news.sourceCity;

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <Pressable
          onPress={() => router.back()}
          style={styles.back}
          hitSlop={10}
          accessibilityLabel={s.map.backA11y}
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
        <Text style={styles.title}>{title}</Text>
        {meta ? <Text style={styles.meta}>{meta}</Text> : null}
        {lines.length > 0 ? (
          <View style={styles.linesRow}>
            {lines.map((line) => (
              <LineBadge key={line} line={line} compact />
            ))}
          </View>
        ) : null}

        {loading ? (
          <View style={styles.loadingBlock}>
            <ActivityIndicator color={scheme.primary} />
            <View style={[styles.skel, { width: '100%' }]} />
            <View style={[styles.skel, { width: '94%' }]} />
            <View style={[styles.skel, { width: '78%' }]} />
          </View>
        ) : empty ? (
          <View style={styles.failBlock}>
            <Text style={styles.fail}>{s.news.articleFail}</Text>
            <Text style={styles.failSub}>{s.news.articleEmpty}</Text>
          </View>
        ) : (
          <View style={styles.article}>
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
        )}

        {url ? (
          <Pressable
            onPress={openBrowser}
            accessibilityRole="link"
            accessibilityLabel={s.news.openBrowser}
            style={({ pressed }) => [
              empty ? styles.browserStrong : styles.browserSoft,
              pressed && { opacity: 0.85 },
            ]}
          >
            <ExternalLink
              size={16}
              color={empty ? scheme.onSecondaryContainer : scheme.primary}
            />
            <Text style={empty ? styles.browserStrongText : styles.browserSoftText}>
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
    width: 40,
    height: 40,
    borderRadius: shape.full,
    backgroundColor: scheme.surfaceContainerHigh,
    alignItems: 'center',
    justifyContent: 'center',
  },
  source: { ...type.labelSmall, color: scheme.onSurfaceVariant, flex: 1 },
  body: { paddingHorizontal: 18, paddingBottom: 40 },
  title: {
    ...type.titleLarge,
    fontWeight: '600',
    color: scheme.onSurface,
    marginTop: 4,
    lineHeight: 28,
  },
  meta: { ...type.labelMedium, color: scheme.onSurfaceVariant, marginTop: 10 },
  linesRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 14 },
  loadingBlock: { marginTop: 28, gap: 10, alignItems: 'flex-start' },
  skel: {
    height: 12,
    borderRadius: shape.small,
    backgroundColor: scheme.surfaceContainerHighest,
    marginTop: 4,
  },
  article: { marginTop: 20 },
  heading: {
    ...type.titleMedium,
    fontWeight: '600',
    color: scheme.onSurface,
    marginTop: 18,
    marginBottom: 8,
  },
  para: {
    ...type.bodyLarge,
    lineHeight: 24,
    color: scheme.onSurface,
    marginBottom: 14,
  },
  failBlock: { marginTop: 24, gap: 8 },
  fail: { ...type.bodyLarge, color: scheme.onSurface },
  failSub: { ...type.bodySmall, color: scheme.onSurfaceVariant },
  browserStrong: {
    marginTop: 28,
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
    marginTop: 28,
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 10,
  },
  browserSoftText: { ...type.titleSmall, color: scheme.primary },
});
