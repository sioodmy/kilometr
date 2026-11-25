import React, { memo } from 'react';
import { StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { ChevronRight, History } from './icons';
import { SpringPressable } from './SpringPressable';
import { elev, scheme, shape, type } from '../theme/tokens';
import type { LegMode, SmartDestination } from '../types/models';
import type { SuggestionIconMeta } from './SuggestionRow';
import { LineBadge } from './LineBadge';
import { useStrings, type Strings } from '../i18n';

export interface SmartLineBadge {
  mode?: LegMode;
  line?: string;
}

type SegmentPosition = 'single' | 'first' | 'middle' | 'last';

function resolveSegment(index: number, total: number): SegmentPosition {
  if (total <= 1) return 'single';
  if (index === 0) return 'first';
  if (index === total - 1) return 'last';
  return 'middle';
}

interface SmartHistoryRowProps {
  item: SmartDestination;
  segment: SegmentPosition;
  compact: boolean;
  departInMin?: number;
  badge?: SmartLineBadge;
  meta?: SuggestionIconMeta;
  onSelect: (d: SmartDestination) => void;
  onOpenConnection?: (d: SmartDestination) => void;
}

/** Pojedynczy wiersz historii M3 Expressive w zgrupowanym kontenerze segmentowym. */
const SmartHistoryRow = memo(function SmartHistoryRow({
  item,
  segment,
  compact,
  departInMin,
  badge,
  meta,
  onSelect,
  onOpenConnection,
}: SmartHistoryRowProps) {
  const s = useStrings();
  const departLabel = formatDepartIn(departInMin, s);
  const urgent = departInMin !== undefined && departInMin >= 0 && departInMin <= 5;
  const Icon = meta?.Icon ?? History;

  const cardRadii = [
    (segment === 'first' || segment === 'single') && styles.cardTop,
    (segment === 'last' || segment === 'single') && styles.cardBottom,
    compact && styles.cardCompact,
  ];

  const mainContent = (
    <>
      <View style={styles.iconSlide}>
        <View style={[styles.icon, { backgroundColor: meta?.bg ?? scheme.secondaryContainer }]}>
          <Icon size={20} color={meta?.fg ?? scheme.onSecondaryContainer} />
        </View>
      </View>

      <View style={styles.mid}>
        <Text style={styles.title} numberOfLines={compact ? undefined : 1}>
          {item.title}
        </Text>
        <Text style={styles.sub} numberOfLines={compact ? undefined : 1}>
          {item.address}
        </Text>
      </View>
    </>
  );

  // Dwa sąsiednie przyciski w jednym kontenerze zamiast zagnieżdżonego <button> w <button> na Web.
  if (departLabel) {
    return (
      <View style={[styles.card, styles.cardSplit, ...cardRadii]}>
        <SpringPressable
          onPress={() => onSelect(item)}
          accessibilityRole="button"
          accessibilityLabel={s.home.searchToA11y(item.title)}
          scaleDelta={0.016}
          opacityDelta={0.05}
          haptic="selection"
          style={styles.cardMainAction}
        >
          {mainContent}
        </SpringPressable>

        <View style={[styles.rightSlide, compact && styles.rightSlideCompact]}>
          <SpringPressable
            onPress={() => {
              if (onOpenConnection) onOpenConnection(item);
              else onSelect(item);
            }}
            accessibilityRole="button"
            accessibilityLabel={s.home.openConnA11y(item.title, departLabel)}
            hitSlop={4}
            scaleDelta={0.04}
            haptic="light"
            style={[
              styles.departPill,
              urgent && styles.departPillUrgent,
              compact && styles.departPillCompact,
            ]}
          >
            {badge?.line ? <LineBadge mode={badge.mode} line={badge.line} compact /> : null}
            <Text style={[styles.depart, urgent && styles.departUrgent]} numberOfLines={1}>
              {departLabel}
            </Text>
            <ChevronRight
              size={14}
              color={urgent ? scheme.onPrimaryContainer : scheme.onSurfaceVariant}
            />
          </SpringPressable>
        </View>
      </View>
    );
  }

  return (
    <SpringPressable
      onPress={() => onSelect(item)}
      accessibilityRole="button"
      accessibilityLabel={s.home.searchToA11y(item.title)}
      scaleDelta={0.016}
      opacityDelta={0.05}
      haptic="selection"
      style={[styles.card, ...cardRadii]}
    >
      {mainContent}
      {!compact && (
        <View style={styles.rightSlide}>
          <View style={styles.rightPlaceholder}>
            <ChevronRight size={17} color={scheme.onSurfaceVariant} />
          </View>
        </View>
      )}
    </SpringPressable>
  );
});

export const SmartHistoryList = memo(function SmartHistoryList({
  items,
  departures,
  lineBadges,
  onSelect,
  onOpenConnection,
  hideHeader,
  icons,
}: {
  items: SmartDestination[];
  /** Najszybszy odjazd do celu w minutach, kluczem id destynacji. */
  departures?: Record<string, number | undefined>;
  /** pierwsza linia tranzytowa (tramwaj/autobus) do celu; brak wpisu = sam tekst „za x min” */
  lineBadges?: Record<string, SmartLineBadge | undefined>;
  onSelect: (d: SmartDestination) => void;
  /** Tap w prawą część (badge + „za x min”): od razu do ekranu tego połączenia. */
  onOpenConnection?: (d: SmartDestination) => void;
  /** Czysty widok bez nagłówka „Ostatnie miejsca” (nagłówek żyje gdzie indziej). */
  hideHeader?: boolean;
  /** Ikonki jak w wyszukiwarce, kluczem id destynacji. */
  icons?: Record<string, SuggestionIconMeta | undefined>;
}) {
  const s = useStrings();
  const { width, fontScale } = useWindowDimensions();
  const compact = width / fontScale < 300;
  if (items.length === 0) return null;

  return (
    <View style={styles.wrap}>
      {!hideHeader && (
        <View style={styles.header}>
          <History size={16} color={scheme.primary} />
          <Text style={styles.headerText}>{s.home.historyTitle}</Text>
        </View>
      )}
      <View style={styles.list}>
        {items.map((d, idx) => (
          <SmartHistoryRow
            key={d.id}
            item={d}
            segment={resolveSegment(idx, items.length)}
            compact={compact}
            departInMin={departures?.[d.id]}
            badge={lineBadges?.[d.id]}
            meta={icons?.[d.id]}
            onSelect={onSelect}
            onOpenConnection={onOpenConnection}
          />
        ))}
      </View>
    </View>
  );
});

/**
 * „za X min” do najszybszego połączenia; powyżej 59 min pokazuje pełną godzinę
 * odjazdu (np. „13:20”), a wartości ujemne określają, ile minut temu coś odjechało.
 * Ujemne bez tej gałęzi obcinały się do zera i raportowały „za chwilę”.
 */
export function formatDepartIn(departInMin: number | undefined, s: Strings): string | null {
  if (departInMin === undefined || !Number.isFinite(departInMin)) return null;
  const m = Math.round(departInMin);
  if (m > 180) return null;
  if (m < -180) return null;
  if (m < 0) return m >= -1 ? s.common.departJustAgo : s.common.departAgo(-m);
  if (m > 59) {
    const target = new Date(Date.now() + m * 60 * 1000);
    const hh = String(target.getHours()).padStart(2, '0');
    const mm = String(target.getMinutes()).padStart(2, '0');
    return `${hh}:${mm}`;
  }
  if (m <= 0) return s.common.departNow;
  return s.common.departIn(m);
}

const styles = StyleSheet.create({
  wrap: { gap: 10 },
  list: { gap: 3 },
  cardCompact: { flexWrap: 'wrap' },
  rightSlideCompact: { width: '100%', maxWidth: '100%', paddingLeft: 58, alignItems: 'flex-start' },
  hidden: { display: 'none' },
  header: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 4, marginBottom: 2 },
  headerText: { ...type.titleMedium, fontWeight: '700', color: scheme.onSurface },
  iconSlide: { flexShrink: 0, justifyContent: 'center' },
  rightSlide: { flexShrink: 0, maxWidth: '48%', justifyContent: 'center', alignItems: 'flex-end' },
  rightPlaceholder: {
    width: 30,
    height: 30,
    borderRadius: shape.full,
    backgroundColor: scheme.surfaceContainerLow,
    alignItems: 'center',
    justifyContent: 'center',
  },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 13,
    backgroundColor: scheme.surfaceContainer,
    borderWidth: 2,
    borderColor: scheme.outlineVariant,
    borderRadius: 8,
    paddingVertical: 14,
    paddingHorizontal: 14,
    minHeight: 76,
    ...elev.level1,
  },
  cardSplit: {
    paddingVertical: 0,
    paddingLeft: 0,
    paddingRight: 14,
    gap: 8,
  },
  cardMainAction: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 13,
    paddingVertical: 14,
    paddingLeft: 14,
    paddingRight: 4,
    minHeight: 76,
  },
  cardTop: {
    borderTopLeftRadius: shape.extraLarge,
    borderTopRightRadius: shape.extraLarge,
  },
  cardBottom: {
    borderBottomLeftRadius: shape.extraLarge,
    borderBottomRightRadius: shape.extraLarge,
  },
  icon: {
    width: 44,
    height: 44,
    borderRadius: 16,
    backgroundColor: scheme.secondaryContainer,
    alignItems: 'center',
    justifyContent: 'center',
  },
  mid: { flex: 1, justifyContent: 'center', gap: 3, minWidth: 0 },
  title: {
    ...type.bodyLarge,
    fontWeight: '700',
    letterSpacing: -0.2,
    color: scheme.onSurface,
  },
  sub: { ...type.bodySmall, color: scheme.onSurfaceVariant },
  departPill: {
    minHeight: 46,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingLeft: 10,
    paddingRight: 8,
    paddingVertical: 8,
    borderRadius: shape.full,
    backgroundColor: scheme.surfaceContainerHigh,
    borderWidth: 2,
    borderColor: scheme.outlineVariant,
  },
  departPillUrgent: {
    backgroundColor: scheme.primaryContainer,
    borderColor: scheme.primary,
  },
  departPillCompact: {
    alignSelf: 'flex-start',
  },
  depart: {
    ...type.labelMedium,
    fontWeight: '700',
    color: scheme.onSurface,
    fontVariant: ['tabular-nums'],
    flexShrink: 1,
  },
  departUrgent: {
    color: scheme.onPrimaryContainer,
  },
});
