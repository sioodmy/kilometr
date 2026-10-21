import { memo, useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { ChevronRight, TriangleAlert } from 'lucide-react-native';
import { elev, scheme, shape, type } from '../theme/tokens';
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

function overlappingLines(item: MpkNewsItem, lineSet: Set<string>): string[] {
  const fromBadge = item.lines.filter((l) => lineSet.has(l.trim().toUpperCase()));
  if (fromBadge.length > 0) return fromBadge;
  return [...lineSet].filter((line) =>
    newsTouchesLines({ lines: [], title: item.title, description: item.description }, new Set([line])),
  );
}

export const ConnectionLineAlerts = memo(function ConnectionLineAlerts({
  connection,
}: {
  connection: Connection;
}) {
  const s = useStrings();
  const router = useRouter();
  const lines = useMemo(() => linesFromConnections([connection]), [connection]);
  const lineSet = useMemo(() => new Set(lines), [lines]);
  const [news, setNews] = useState<MpkNewsItem[]>(() => getCachedNews() ?? []);
  const [ready, setReady] = useState(() => (getCachedNews()?.length ?? 0) > 0);

  useEffect(() => {
    if (lines.length === 0) {
      setReady(true);
      return;
    }
    let live = true;
    void (async () => {
      if ((getCachedNews()?.length ?? 0) === 0) {
        const cached = await loadNewsCache();
        if (live && cached && cached.length > 0) setNews(cached);
      }
      try {
        const fresh = await fetchCityNews();
        if (live) setNews(fresh);
      } catch {
        // zostaw cache
      } finally {
        if (live) setReady(true);
      }
    })();
    return () => {
      live = false;
    };
  }, [lines.length]);

  const matched = useMemo(() => {
    if (lineSet.size === 0) return [];
    return news.filter((item) => newsTouchesLines(item, lineSet));
  }, [news, lineSet]);

  // Bez zmian - zero UI. Spinner/placeholder też nie, żeby nie migał pustą kartą.
  if (!ready || matched.length === 0) return null;

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
              <View style={item.urgent ? styles.urgentBar : styles.quietBar} />
              <View style={styles.rowBody}>
                <View style={styles.rowMeta}>
                  {item.urgent ? (
                    <View style={styles.urgent}>
                      <TriangleAlert size={11} color={scheme.onWarningContainer} />
                      <Text style={styles.urgentText}>{s.news.chip}</Text>
                    </View>
                  ) : null}
                  {item.dateLabel ? <Text style={styles.meta}>{item.dateLabel}</Text> : null}
                </View>
                <Text style={styles.rowTitle} numberOfLines={2}>
                  {item.title}
                </Text>
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
        style={({ pressed }) => [styles.footer, pressed && { opacity: 0.85 }]}
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
    borderRadius: shape.large,
    paddingTop: 14,
    paddingBottom: 10,
    paddingHorizontal: 4,
    gap: 4,
    ...elev.level1,
  },
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
    paddingRight: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: scheme.outlineVariant,
  },
  rowFirst: { borderTopWidth: 0 },
  urgentBar: {
    width: 3,
    alignSelf: 'stretch',
    marginLeft: 10,
    borderRadius: 2,
    backgroundColor: scheme.warning,
  },
  quietBar: { width: 3, marginLeft: 10 },
  rowBody: { flex: 1, minWidth: 0, gap: 5 },
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
  meta: { ...type.labelSmall, color: scheme.onSurfaceVariant },
  rowTitle: { ...type.bodyMedium, color: scheme.onSurface, fontWeight: '500' },
  linesRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingTop: 6,
    paddingBottom: 4,
  },
  footerText: { ...type.titleSmall, color: scheme.primary, fontWeight: '600' },
});
