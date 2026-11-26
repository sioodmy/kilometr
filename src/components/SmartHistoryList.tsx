import React, { memo } from 'react';
import { StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { ChevronRight, History } from './icons';
import { SpringPressable } from './SpringPressable';
import { elev, scheme, shape, type } from '../theme/tokens';
import type { SmartDestination } from '../types/models';
import type { SuggestionIconMeta } from './SuggestionRow';
import { useStrings } from '../i18n';

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
  meta?: SuggestionIconMeta;
  onSelect: (d: SmartDestination) => void;
}

/** Pojedynczy wiersz historii M3 Expressive w zgrupowanym kontenerze segmentowym. */
const SmartHistoryRow = memo(function SmartHistoryRow({
  item,
  segment,
  compact,
  meta,
  onSelect,
}: SmartHistoryRowProps) {
  const s = useStrings();
  const Icon = meta?.Icon ?? History;

  const cardRadii = [
    (segment === 'first' || segment === 'single') && styles.cardTop,
    (segment === 'last' || segment === 'single') && styles.cardBottom,
    compact && styles.cardCompact,
  ];

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
  onSelect,
  hideHeader,
  icons,
}: {
  items: SmartDestination[];
  onSelect: (d: SmartDestination) => void;
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
            meta={icons?.[d.id]}
            onSelect={onSelect}
          />
        ))}
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  wrap: { gap: 10 },
  list: { gap: 3 },
  cardCompact: { flexWrap: 'wrap' },
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
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: scheme.outlineVariant,
    borderRadius: 8,
    paddingVertical: 14,
    paddingHorizontal: 14,
    minHeight: 76,
    ...elev.level1,
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
});
