import { memo, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { ChevronRight, CircleCheck, TriangleAlert } from './icons';
import { scheme, shape, type } from '../theme/tokens';
import { useStrings } from '../i18n';
import { LineBadge } from './LineBadge';
import type { Connection } from '../types/models';
import {
  fetchCityNews,
  getCachedNews,
  loadNewsCache,
  type MpkNewsItem,
} from '../services/mpkNews';
import { linesFromConnections, newsTouchesLines } from '../services/recentRouteLines';

const MAX_ROWS = 3;

type Status = 'loading' | 'error' | 'ready';

function overlappingLines(item: MpkNewsItem, lineSet: Set<string>): string[] {
  const fromBadge = item.lines.filter((l) => lineSet.has(l.trim().toUpperCase()));
  if (fromBadge.length > 0) return fromBadge;
  return [...lineSet].filter((line) =>
    newsTouchesLines({ lines: [], title: item.title, description: item.description }, new Set([line])),
  );
}

// Brak pasujących komunikatów to brak karty: trasa bez utrudnień nie dostaje pustego bloku.
export const ConnectionLineAlerts = memo(function ConnectionLineAlerts({
  connection,
  lines: linesProp,
}: {
  connection?: Connection;
  lines?: string[];
}) {
  const s = useStrings();
  const router = useRouter();
  const lines = useMemo(
    () => linesProp ?? (connection ? linesFromConnections([connection]) : []),
    [connection, linesProp],
  );
  const lineSet = useMemo(() => new Set(lines), [lines]);
  const [news, setNews] = useState<MpkNewsItem[]>(() => getCachedNews() ?? []);
  const [status, setStatus] = useState<Status>(() =>
    (getCachedNews()?.length ?? 0) > 0 ? 'ready' : 'loading',
  );
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (lines.length === 0) {
      setStatus('ready');
      return;
    }
    let live = true;
    void (async () => {
      let hasData = (getCachedNews()?.length ?? 0) > 0;
      if (!hasData) {
        const cached = await loadNewsCache();
        if (live && cached && cached.length > 0) {
          setNews(cached);
          hasData = true;
        }
      }
      try {
        const fresh = await fetchCityNews();
        if (live) {
          setNews(fresh);
          setStatus('ready');
        }
      } catch {
        if (live) setStatus(hasData ? 'ready' : 'error');
      }
    })();
    return () => {
      live = false;
    };
  }, [lines.length, attempt]);

  const matched = useMemo(() => {
    if (lineSet.size === 0) return [];
    return news.filter((item) => newsTouchesLines(item, lineSet));
  }, [news, lineSet]);

  if (lineSet.size === 0) return null;

  if (status === 'loading') {
    return (
      <View style={styles.stateCard}>
        <ActivityIndicator size="small" color={scheme.primary} />
        <Text style={styles.stateText}>{s.routeDetails.lineAlertsLoading}</Text>
      </View>
    );
  }

  if (status === 'error') {
    return (
      <View style={styles.stateCard}>
        <Text style={styles.stateText}>{s.routeDetails.lineAlertsError}</Text>
        <Pressable
          onPress={() => {
            setStatus('loading');
            setAttempt((n) => n + 1);
          }}
          accessibilityRole="button"
          style={({ pressed }) => [styles.retry, pressed && { opacity: 0.85 }]}
        >
          <Text style={styles.retryText}>{s.common.retry}</Text>
        </Pressable>
      </View>
    );
  }

  if (matched.length === 0) return null;

  const openItem = (item: MpkNewsItem) => {
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
  };

  const shown = matched.slice(0, MAX_ROWS);

  return (
    <View style={styles.card}>
      <View style={styles.head}>
        <Text style={styles.title}>{s.routeDetails.lineAlertsTitle}</Text>
        <Text style={styles.count}>{s.routeDetails.lineAlertsCount(matched.length)}</Text>
      </View>

      <View style={styles.list}>
        {shown.map((item, index) => {
          const hitLines = overlappingLines(item, lineSet);
          const isResolved = Boolean(item.disruption?.is_resolved);
          const solution = item.disruption?.glance?.solution;

          return (
            <Pressable
              key={item.id}
              onPress={() => openItem(item)}
              accessibilityRole="button"
              accessibilityLabel={item.title}
              android_ripple={{ color: scheme.outlineVariant }}
              style={({ pressed }) => [
                styles.row,
                index === 0 && styles.rowFirst,
                pressed && { opacity: 0.85 },
              ]}
            >
              <View style={styles.rowBody}>
                <View style={styles.rowMeta}>
                  {isResolved ? (
                    <View style={styles.resolvedChip}>
                      <CircleCheck size={12} color={scheme.onPrimaryContainer} />
                      <Text style={styles.resolvedText}>{s.news.resolved}</Text>
                    </View>
                  ) : item.urgent ? (
                    <View style={styles.urgent}>
                      <TriangleAlert size={11} color={scheme.onWarningContainer} />
                      <Text style={styles.urgentText}>{s.news.chip}</Text>
                    </View>
                  ) : null}
                  {item.dateLabel ? <Text style={styles.meta}>{item.dateLabel}</Text> : null}
                </View>
                <Text
                  style={[styles.rowTitle, isResolved && styles.rowTitleResolved]}
                  numberOfLines={2}
                >
                  {item.title}
                </Text>
                {solution ? (
                  <View style={styles.solutionBox}>
                    <Text style={styles.solutionLabel}>{s.news.solutionLabel}</Text>
                    <Text style={styles.solutionText} numberOfLines={2}>
                      {solution}
                    </Text>
                  </View>
                ) : null}
                {hitLines.length > 0 ? (
                  <View style={styles.linesRow}>
                    {hitLines.map((line) => (
                      <LineBadge key={line} line={line} compact />
                    ))}
                  </View>
                ) : null}
              </View>
              <ChevronRight size={16} color={scheme.outline} />
            </Pressable>
          );
        })}
      </View>

      <Pressable
        onPress={() => router.push('/news')}
        accessibilityRole="button"
        accessibilityLabel={s.routeDetails.lineAlertsAll}
        android_ripple={{ color: scheme.outlineVariant }}
        style={styles.footer}
      >
        <Text style={styles.footerText}>{s.routeDetails.lineAlertsAll}</Text>
        <ChevronRight size={16} color={scheme.primary} />
      </Pressable>
    </View>
  );
});

const styles = StyleSheet.create({
  card: {
    backgroundColor: scheme.surfaceContainer,
    borderRadius: shape.extraLarge,
    paddingTop: 14,
    paddingBottom: 6,
    paddingHorizontal: 4,
    gap: 4,
  },
  stateCard: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 10,
    backgroundColor: scheme.surfaceContainer,
    borderRadius: shape.extraLarge,
    padding: 16,
  },
  stateText: { ...type.bodyMedium, color: scheme.onSurfaceVariant, flexShrink: 1 },
  retry: {
    minHeight: 48,
    justifyContent: 'center',
    paddingHorizontal: 20,
    borderRadius: shape.full,
    backgroundColor: scheme.secondaryContainer,
  },
  retryText: { ...type.labelLarge, fontWeight: '600', color: scheme.onSecondaryContainer },
  head: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: 8,
    paddingHorizontal: 12,
    marginBottom: 4,
  },
  title: { ...type.titleSmall, fontWeight: '600', color: scheme.onSurface, flex: 1 },
  count: { ...type.labelSmall, color: scheme.onSurfaceVariant },
  list: {},
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: scheme.outlineVariant,
  },
  rowFirst: { borderTopWidth: 0 },
  rowBody: { flex: 1, minWidth: 0, gap: 6 },
  rowMeta: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  urgent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: scheme.warningContainer,
    borderRadius: shape.full,
    paddingHorizontal: 7,
    paddingVertical: 2,
  },
  urgentText: { ...type.labelSmall, fontWeight: '700', color: scheme.onWarningContainer },
  resolvedChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: scheme.primaryContainer,
    borderRadius: shape.full,
    paddingHorizontal: 7,
    paddingVertical: 2,
  },
  resolvedText: { ...type.labelSmall, fontWeight: '700', color: scheme.onPrimaryContainer },
  solutionBox: {
    backgroundColor: scheme.surfaceContainerLowest,
    borderRadius: shape.large,
    padding: 10,
    gap: 2,
  },
  solutionLabel: { ...type.labelSmall, fontWeight: '600', color: scheme.onSurfaceVariant },
  solutionText: { ...type.bodyMedium, color: scheme.onSurface },
  meta: { ...type.labelSmall, color: scheme.onSurfaceVariant },
  rowTitle: { ...type.bodyLarge, fontWeight: '500', color: scheme.onSurface },
  rowTitleResolved: { color: scheme.onSurfaceVariant },
  linesRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 48,
    paddingHorizontal: 12,
  },
  footerText: { ...type.titleSmall, color: scheme.primary, fontWeight: '600' },
});
