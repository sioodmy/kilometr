import { memo, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, {
  ReduceMotion,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';
import { useRouter } from 'expo-router';
import { BusFront, ChevronRight, CircleCheck, Clock3, RouteOff, TriangleAlert } from './icons';
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

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);


function getTransitActionLabel(item: MpkNewsItem, s: ReturnType<typeof useStrings>): string {
  const solutionText = (item.disruption?.glance?.solution || "").toLowerCase();
  const hasReplacement =
    solutionText.includes("zastępcz") ||
    solutionText.includes("za tramwaj") ||
    solutionText.includes("za autobus") ||
    solutionText.includes("replacement") ||
    solutionText.includes("ersatz");
  const hasDetour =
    solutionText.includes("objazd") ||
    solutionText.includes("objazdem") ||
    solutionText.includes("objazdy") ||
    solutionText.includes("zmienion") ||
    solutionText.includes("detour") ||
    solutionText.includes("umleitung");

  if (hasReplacement && hasDetour) {
    return s.news.detourAndReplacement;
  }
  if (hasReplacement) {
    return s.news.replacementBus;
  }
  return s.news.detourLabel;
}

function overlappingLines(item: MpkNewsItem, lineSet: Set<string>): string[] {
  const fromBadge = item.lines.filter((l) => lineSet.has(l.trim().toUpperCase()));
  if (fromBadge.length > 0) return fromBadge;
  return [...lineSet].filter((line) =>
    newsTouchesLines({ lines: [], title: item.title, description: item.description }, new Set([line])),
  );
}

/**
 * Karta pojedynczego utrudnienia w stylu Material 3 Expressive:
 * - Asymetryczne lub mocno zaokrąglone narożniki kontenera
 * - Dedykowany tonalny boks na inteligentne rozwiązanie / objazd (AI glance solution)
 * - Tonalny status chip (ruch przywrócony / pilne utrudnienie / planowana zmiana)
 * - Wyróżnienie linii z bieżącego połączenia oraz komunikacji zastępczej
 * - Reaktywna animacja naciśnięcia ze sprężystością (spring)
 */
const AlertSubCard = memo(function AlertSubCard({
  item,
  hitLines,
  onPress,
}: {
  item: MpkNewsItem;
  hitLines: string[];
  onPress: () => void;
}) {
  const s = useStrings();
  const isResolved = Boolean(item.disruption?.is_resolved);
  const isUrgent = Boolean((item.disruption?.is_emergency || item.urgent) && !isResolved);
  const headline = item.disruption?.headline || item.title;
  const problem = item.disruption?.glance?.problem;
  const solution = item.disruption?.glance?.solution;
  const timeframe = item.disruption?.glance?.timeframe || item.dateLabel;

  // Znajdź ew. komunikację zastępczą dla linii z tego połączenia
  const replacementLine = useMemo(() => {
    if (!item.disruption?.impacted_lines) return null;
    const hitSet = new Set(hitLines);
    for (const imp of item.disruption.impacted_lines) {
      if ((!imp.line || hitSet.has(imp.line)) && imp.replacement_line) {
        return imp.replacement_line;
      }
    }
    return null;
  }, [item.disruption?.impacted_lines, hitLines]);

  // Znajdź pomijane przystanki
  const omittedStops = useMemo(() => {
    if (!item.disruption?.impacted_lines) return [];
    const hitSet = new Set(hitLines);
    const set = new Set<string>();
    for (const imp of item.disruption.impacted_lines) {
      if ((!imp.line || hitSet.has(imp.line)) && imp.omitted_stops) {
        for (const st of imp.omitted_stops) set.add(st);
      }
    }
    return [...set];
  }, [item.disruption?.impacted_lines, hitLines]);

  const press = useSharedValue(0);
  const animatedCardStyle = useAnimatedStyle(() => ({
    transform: [{ scale: 1 - press.value * 0.015 }],
  }));

  const setPress = (val: number) => {
    press.value = withSpring(val, {
      damping: 22,
      stiffness: 400,
      reduceMotion: ReduceMotion.System,
    });
  };

  return (
    <AnimatedPressable
      onPress={onPress}
      onPressIn={() => setPress(1)}
      onPressOut={() => setPress(0)}
      accessibilityRole="button"
      accessibilityLabel={`${headline}. ${solution ?? ''}`}
      android_ripple={{ color: scheme.outlineVariant }}
      style={[
        styles.alertCard,
        isUrgent
          ? styles.alertCardUrgent
          : isResolved
            ? styles.alertCardResolved
            : styles.alertCardNormal,
        animatedCardStyle,
      ]}
    >
      {/* Pasek statusu i metadanych */}
      <View style={styles.alertHeaderRow}>
        <View style={styles.alertBadgesGroup}>
          {isResolved ? (
            <View style={styles.resolvedBadge}>
              <CircleCheck size={12} color={scheme.onPrimaryContainer} />
              <Text style={styles.resolvedBadgeText}>{s.news.resolved}</Text>
            </View>
          ) : isUrgent ? (
            <View style={styles.urgentBadge}>
              <TriangleAlert size={12} color={scheme.onWarningContainer} />
              <Text style={styles.urgentBadgeText}>{s.news.urgentChip}</Text>
            </View>
          ) : (
            <View style={styles.infoBadge}>
              <Clock3 size={12} color={scheme.onSecondaryContainer} />
              <Text style={styles.infoBadgeText}>{s.news.plannedChip}</Text>
            </View>
          )}

          {hitLines.length > 0 && (
            <View style={styles.lineBadgesRow}>
              {hitLines.map((line) => (
                <LineBadge key={line} line={line} compact />
              ))}
            </View>
          )}
        </View>

        <View style={styles.alertHeaderRight}>
          {timeframe ? (
            <Text style={styles.timeframeText} numberOfLines={1}>
              {timeframe}
            </Text>
          ) : null}
          <ChevronRight size={16} color={scheme.onSurfaceVariant} />
        </View>
      </View>

      {/* Nagłówek utrudnienia (Smart AI Headline) */}
      <Text
        style={[
          styles.headlineText,
          isResolved && styles.headlineResolved,
        ]}
        numberOfLines={2}
      >
        {headline}
      </Text>

      {/* Kontekst problemu (Smart AI Glance Problem), jeśli wnosi coś poza samym nagłówkiem */}
      {problem && problem.trim() !== headline.trim() ? (
        <Text style={styles.problemText} numberOfLines={2}>
          {problem}
        </Text>
      ) : null}

      {/* Inteligentny boks rozwiązania (Smart AI Glance Solution) */}
      {solution ? (
        <View style={styles.solutionBox}>
          <View style={styles.solutionHeader}>
            <BusFront
              size={14}
              color={isUrgent ? scheme.warning : scheme.primary}
            />
            <Text
              style={[
                styles.solutionLabel,
                { color: isUrgent ? scheme.warning : scheme.primary },
              ]}
            >
              {getTransitActionLabel(item, s)}
            </Text>
          </View>
          <Text style={styles.solutionText} numberOfLines={3}>
            {solution}
          </Text>
        </View>
      ) : null}

      {/* Pigułka komunikacji zastępczej */}
      {replacementLine ? (
        <View style={styles.replacementRow}>
          <BusFront size={13} color={scheme.primary} />
          <Text style={styles.replacementText} numberOfLines={1}>
            {replacementLine}
          </Text>
        </View>
      ) : null}

      {/* Pomijane przystanki */}
      {omittedStops.length > 0 ? (
        <View style={styles.omittedRow}>
          <RouteOff size={13} color={scheme.onSurfaceVariant} />
          <Text style={styles.omittedText} numberOfLines={1}>
            {s.news.omittedStopsPrefix} {omittedStops.join(', ')}
          </Text>
        </View>
      ) : null}
    </AnimatedPressable>
  );
});

// Brak pasujących komunikatów to brak karty: trasa bez utrudnień nie dostaje pustego bloku.
export const ConnectionLineAlerts = memo(function ConnectionLineAlerts({
  connection,
  lines: propLines,
}: {
  connection?: Connection | null;
  lines?: string[];
}) {
  const s = useStrings();
  const router = useRouter();
  const [news, setNews] = useState<MpkNewsItem[]>(() => getCachedNews() ?? []);
  const [status, setStatus] = useState<Status>(() => (getCachedNews() ? 'ready' : 'loading'));
  const [attempt, setAttempt] = useState(0);

  const routeLines = useMemo(() => {
    if (propLines && propLines.length > 0) {
      return propLines;
    }
    if (!connection) return [];
    return linesFromConnections([connection]);
  }, [connection, propLines]);

  const lineSet = useMemo(() => {
    return new Set(routeLines.map((l) => l.trim().toUpperCase()));
  }, [routeLines]);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      if (lineSet.size === 0) return;
      const mem = getCachedNews();
      if (mem && mem.length > 0) {
        setNews(mem);
        setStatus('ready');
        return;
      }

      const disk = await loadNewsCache();
      if (cancelled) return;
      if (disk && disk.length > 0) {
        setNews(disk);
        setStatus('ready');
      } else {
        setStatus('loading');
      }

      try {
        const fresh = await fetchCityNews();
        if (cancelled) return;
        setNews(fresh);
        setStatus('ready');
      } catch {
        if (cancelled) return;
        if (!disk && !mem) setStatus('error');
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [lineSet, attempt]);

  const matched = useMemo(() => {
    if (lineSet.size === 0) return [];
    return news.filter((item) => overlappingLines(item, lineSet).length > 0);
  }, [news, lineSet]);

  if (lineSet.size === 0) return null;

  if (status === 'loading') {
    return (
      <View style={styles.stateContainer}>
        <ActivityIndicator size="small" color={scheme.primary} />
        <Text style={styles.stateText}>{s.routeDetails.lineAlertsLoading}</Text>
      </View>
    );
  }

  if (status === 'error') {
    return (
      <View style={styles.stateContainer}>
        <Text style={styles.stateText}>{s.routeDetails.lineAlertsError}</Text>
        <Pressable
          onPress={() => {
            setStatus('loading');
            setAttempt((n) => n + 1);
          }}
          accessibilityRole="button"
          style={({ pressed }) => [styles.retryBtn, pressed && { opacity: 0.85 }]}
        >
          <Text style={styles.retryBtnText}>{s.common.retry}</Text>
        </Pressable>
      </View>
    );
  }

  if (matched.length === 0) return null;

  const hasUrgent = matched.some(
    (item) => (item.disruption?.is_emergency || item.urgent) && !item.disruption?.is_resolved,
  );

  const openItem = (item: MpkNewsItem) => {
    if (!item.link) return;
    router.push({
      pathname: '/article',
      params: {
        url: item.link,
        title: item.disruption?.headline || item.title,
        source: item.source,
        meta: item.dateLabel,
        lines: item.lines.join(','),
      },
    });
  };

  const shown = matched.slice(0, MAX_ROWS);

  return (
    <View style={styles.container}>
      {/* Nagłówek sekcji z M3 Expressive pill badge */}
      <View style={styles.sectionHeader}>
        <View style={styles.headerTitleGroup}>
          <View
            style={[
              styles.headerIconBadge,
              hasUrgent ? styles.headerIconBadgeUrgent : styles.headerIconBadgeNormal,
            ]}
          >
            <TriangleAlert
              size={16}
              color={hasUrgent ? scheme.onWarningContainer : scheme.onSecondaryContainer}
            />
          </View>
          <Text style={styles.sectionTitle}>{s.routeDetails.lineAlertsTitle}</Text>
        </View>

        <View style={styles.counterPill}>
          <Text style={styles.counterText}>
            {s.routeDetails.lineAlertsCount(matched.length)}
          </Text>
        </View>
      </View>

      {/* Lista kart utrudnień */}
      <View style={styles.cardsList}>
        {shown.map((item) => {
          const hitLines = overlappingLines(item, lineSet);
          return (
            <AlertSubCard
              key={item.id}
              item={item}
              hitLines={hitLines}
              onPress={() => openItem(item)}
            />
          );
        })}
      </View>

      {/* Dolny przycisk M3 Expressive do wszystkich aktualności */}
      <Pressable
        onPress={() => router.push('/news')}
        accessibilityRole="button"
        accessibilityLabel={s.routeDetails.lineAlertsAll}
        android_ripple={{ color: scheme.outlineVariant }}
        style={({ pressed }) => [styles.allNewsBtn, pressed && { opacity: 0.85 }]}
      >
        <Text style={styles.allNewsBtnText}>{s.routeDetails.lineAlertsAll}</Text>
        <ChevronRight size={18} color={scheme.primary} />
      </Pressable>
    </View>
  );
});

const styles = StyleSheet.create({
  container: {
    backgroundColor: scheme.surfaceContainer,
    borderRadius: shape.extraLarge,
    padding: 16,
    gap: 14,
  },
  stateContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    backgroundColor: scheme.surfaceContainer,
    borderRadius: shape.extraLarge,
    padding: 18,
  },
  stateText: {
    ...type.bodyMedium,
    color: scheme.onSurfaceVariant,
    flexShrink: 1,
  },
  retryBtn: {
    minHeight: 48,
    minWidth: 48,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 20,
    borderRadius: shape.full,
    backgroundColor: scheme.secondaryContainer,
  },
  retryBtnText: {
    ...type.labelLarge,
    fontWeight: '700',
    color: scheme.onSecondaryContainer,
  },

  // Nagłówek sekcji
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  headerTitleGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flex: 1,
  },
  headerIconBadge: {
    width: 32,
    height: 32,
    borderRadius: shape.medium,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerIconBadgeUrgent: {
    backgroundColor: scheme.warningContainer,
  },
  headerIconBadgeNormal: {
    backgroundColor: scheme.secondaryContainer,
  },
  sectionTitle: {
    ...type.titleSmall,
    fontWeight: '700',
    color: scheme.onSurface,
    flex: 1,
  },
  counterPill: {
    backgroundColor: scheme.surfaceContainerHigh,
    borderRadius: shape.full,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  counterText: {
    ...type.labelSmall,
    fontWeight: '600',
    color: scheme.onSurfaceVariant,
  },

  // Karty utrudnień
  cardsList: {
    gap: 12,
  },
  alertCard: {
    borderRadius: shape.large,
    padding: 14,
    gap: 10,
  },
  alertCardUrgent: {
    backgroundColor: scheme.surfaceContainerHigh,
    borderWidth: 1.5,
    borderColor: scheme.warning + '55',
  },
  alertCardResolved: {
    backgroundColor: scheme.surfaceContainerLow,
    borderWidth: 1,
    borderColor: scheme.outlineVariant + '35',
  },
  alertCardNormal: {
    backgroundColor: scheme.surfaceContainerHigh,
    borderWidth: 1,
    borderColor: scheme.outlineVariant + '35',
  },

  // Wiersz statusu w karcie
  alertHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  alertBadgesGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexWrap: 'wrap',
    flex: 1,
  },
  alertHeaderRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  urgentBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: scheme.warningContainer,
    borderRadius: shape.full,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  urgentBadgeText: {
    ...type.labelSmall,
    fontWeight: '700',
    color: scheme.onWarningContainer,
  },
  resolvedBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: scheme.primaryContainer,
    borderRadius: shape.full,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  resolvedBadgeText: {
    ...type.labelSmall,
    fontWeight: '700',
    color: scheme.onPrimaryContainer,
  },
  infoBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: scheme.secondaryContainer,
    borderRadius: shape.full,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  infoBadgeText: {
    ...type.labelSmall,
    fontWeight: '700',
    color: scheme.onSecondaryContainer,
  },
  lineBadgesRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  timeframeText: {
    ...type.labelSmall,
    color: scheme.onSurfaceVariant,
    maxWidth: 130,
  },

  // Teksty w karcie
  headlineText: {
    ...type.titleSmall,
    fontSize: 15.5,
    lineHeight: 21,
    fontWeight: '600',
    color: scheme.onSurface,
  },
  headlineResolved: {
    color: scheme.onSurfaceVariant,
  },
  problemText: {
    ...type.bodySmall,
    fontSize: 13,
    lineHeight: 18,
    color: scheme.onSurfaceVariant,
  },

  // Inteligentny boks rozwiązania (Glance Solution)
  solutionBox: {
    backgroundColor: scheme.surfaceContainerHighest,
    borderRadius: shape.medium,
    padding: 12,
    gap: 6,
    borderWidth: 1,
    borderColor: scheme.outlineVariant + "30",
  },
  solutionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  solutionLabel: {
    ...type.labelSmall,
    fontWeight: '700',
    letterSpacing: 0.2,
  },
  solutionText: {
    ...type.bodyMedium,
    fontSize: 13.5,
    lineHeight: 19,
    color: scheme.onSurface,
  },

  // Komunikacja zastępcza i pomijane przystanki
  replacementRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: scheme.surfaceContainerHighest,
    borderRadius: shape.small,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: scheme.primary + "30",
  },
  replacementText: {
    ...type.labelMedium,
    color: scheme.primary,
    fontWeight: '600',
    flex: 1,
  },
  omittedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 4,
  },
  omittedText: {
    ...type.bodySmall,
    fontSize: 12,
    color: scheme.onSurfaceVariant,
    flex: 1,
  },

  // Przycisk "Wszystkie aktualności"
  allNewsBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    minHeight: 48,
    backgroundColor: scheme.surfaceContainerHigh,
    borderRadius: shape.full,
    paddingHorizontal: 16,
  },
  allNewsBtnText: {
    ...type.labelLarge,
    color: scheme.primary,
    fontWeight: '700',
  },
});
