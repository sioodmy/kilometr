// Interaktywny wykres pierscieniowy (donut) najczestszych linii w SVG.

import { useMemo, useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import Svg, { Circle, G, Path } from 'react-native-svg';
import { useStrings } from '../i18n';
import { resolveLineBadgeIdentity } from '../services/lineIdentity';
import type { TopLineItem } from '../services/userStatsModel';
import { scheme, shape, type } from '../theme/tokens';
import { LineBadge } from './LineBadge';

interface Slice {
  key: string;
  label: string;
  count: number;
  share: number;
  color: string;
  item: TopLineItem | null;
}

function polarToCartesian(cx: number, cy: number, r: number, angleDeg: number) {
  const rad = ((angleDeg - 90) * Math.PI) / 180;
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
}

function donutArcPath(
  cx: number,
  cy: number,
  outerR: number,
  innerR: number,
  startDeg: number,
  endDeg: number,
): string {
  const sweep = endDeg - startDeg;
  const largeArc = sweep > 180 ? 1 : 0;
  const outerStart = polarToCartesian(cx, cy, outerR, startDeg);
  const outerEnd = polarToCartesian(cx, cy, outerR, endDeg);
  const innerEnd = polarToCartesian(cx, cy, innerR, endDeg);
  const innerStart = polarToCartesian(cx, cy, innerR, startDeg);
  return [
    `M ${outerStart.x.toFixed(2)} ${outerStart.y.toFixed(2)}`,
    `A ${outerR} ${outerR} 0 ${largeArc} 1 ${outerEnd.x.toFixed(2)} ${outerEnd.y.toFixed(2)}`,
    `L ${innerEnd.x.toFixed(2)} ${innerEnd.y.toFixed(2)}`,
    `A ${innerR} ${innerR} 0 ${largeArc} 0 ${innerStart.x.toFixed(2)} ${innerStart.y.toFixed(2)}`,
    'Z',
  ].join(' ');
}

export function LinesPieChart({
  lines,
  totalOccurrences,
}: {
  lines: TopLineItem[];
  totalOccurrences: number;
}) {
  const s = useStrings();
  const y = s.yourData;
  const { width } = useWindowDimensions();
  const sideBySide = width >= 560;
  const [selectedKey, setSelectedKey] = useState<string | null>(null);

  const slices = useMemo<Slice[]>(() => {
    const visible = lines.slice(0, 5);
    const shownCount = visible.reduce((sum, item) => sum + item.count, 0);
    const total = Math.max(totalOccurrences, shownCount, 1);
    const out: Slice[] = visible.map((item) => {
      const identity = resolveLineBadgeIdentity({
        mode: item.mode,
        line: item.line,
        cityId: item.cityId,
        railAgencyOverride: item.railAgency,
      });
      return {
        key: item.key,
        label: item.line,
        count: item.count,
        share: item.count / total,
        color: identity.bg,
        item,
      };
    });
    const otherCount = Math.max(0, total - shownCount);
    if (otherCount > 0) {
      out.push({
        key: '__other__',
        label: y.topLinesOther,
        count: otherCount,
        share: otherCount / total,
        color: scheme.outline,
        item: null,
      });
    }
    return out;
  }, [lines, totalOccurrences, y.topLinesOther]);

  const activeSlice = slices.find((sl) => sl.key === selectedKey) ?? null;

  const size = 188;
  const cx = size / 2;
  const cy = size / 2;
  const baseOuterR = 80;
  const innerR = 52;
  const gapDeg = slices.length > 1 ? 2.6 : 0;

  const segments = useMemo(() => {
    let cursor = 0;
    return slices.map((slice) => {
      const span = slice.share * 360;
      const start = cursor;
      const end = cursor + span;
      cursor = end;
      return { slice, start, end, span };
    });
  }, [slices]);

  const toggleSelect = (key: string) => {
    setSelectedKey((prev) => (prev === key ? null : key));
  };

  return (
    <View style={[styles.wrap, sideBySide && styles.wrapRow]}>
      <View style={styles.chartBox}>
        <Svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
          <Circle
            cx={cx}
            cy={cy}
            r={(baseOuterR + innerR) / 2}
            stroke={scheme.surfaceContainerHigh}
            strokeWidth={baseOuterR - innerR}
            fill="none"
          />
          <G>
            {segments.map(({ slice, start, end, span }) => {
              const selected = activeSlice?.key === slice.key;
              const dimmed = activeSlice !== null && !selected;
              const outerR = selected ? baseOuterR + 6 : baseOuterR;
              // react-native-svg przekazuje natywne handlery respondera do DOM na Webie (React 19 warning).
              const pressProps =
                Platform.OS === 'web'
                  ? ({ onClick: () => toggleSelect(slice.key) } as Record<string, unknown>)
                  : { onPress: () => toggleSelect(slice.key) };
              if (span >= 359.5) {
                return (
                  <Circle
                    key={slice.key}
                    cx={cx}
                    cy={cy}
                    r={(outerR + innerR) / 2}
                    stroke={slice.color}
                    strokeWidth={outerR - innerR}
                    fill="none"
                    opacity={dimmed ? 0.35 : 1}
                    {...pressProps}
                  />
                );
              }
              const pad = Math.min(gapDeg / 2, span * 0.25);
              const d = donutArcPath(cx, cy, outerR, innerR, start + pad, end - pad);
              return (
                <Path
                  key={slice.key}
                  d={d}
                  fill={slice.color}
                  opacity={dimmed ? 0.32 : 1}
                  {...pressProps}
                />
              );
            })}
          </G>
        </Svg>
        <View style={styles.centerOverlay} pointerEvents="none">
          {activeSlice ? (
            <>
              <Text style={styles.centerValue} numberOfLines={1}>
                {Math.max(1, Math.round(activeSlice.share * 100))}%
              </Text>
              <Text style={styles.centerLabel} numberOfLines={1}>
                {activeSlice.label}
              </Text>
              <Text style={styles.centerSub} numberOfLines={1}>
                {y.lineTrips(activeSlice.count)}
              </Text>
            </>
          ) : (
            <>
              <Text style={styles.centerValue} numberOfLines={1}>
                {totalOccurrences}
              </Text>
              <Text style={styles.centerLabel} numberOfLines={1}>
                {y.topLinesTotal}
              </Text>
            </>
          )}
        </View>
      </View>

      <View style={styles.legend}>
        {slices.map((slice) => {
          const selected = activeSlice?.key === slice.key;
          const pct = Math.max(1, Math.round(slice.share * 100));
          return (
            <Pressable
              key={slice.key}
              onPress={() => toggleSelect(slice.key)}
              accessibilityRole="button"
              accessibilityState={{ selected }}
              style={({ pressed }) => [
                styles.legendRow,
                selected && styles.legendRowSelected,
                pressed && styles.legendRowPressed,
              ]}
            >
              <View style={[styles.dot, { backgroundColor: slice.color }]} />
              {slice.item ? (
                <LineBadge
                  mode={slice.item.mode}
                  line={slice.item.line}
                  compact
                  maxWidth={78}
                />
              ) : (
                <View style={styles.otherChip}>
                  <Text style={styles.otherChipText}>{slice.label}</Text>
                </View>
              )}
              <View style={styles.legendBarTrack}>
                <View
                  style={[
                    styles.legendBarFill,
                    {
                      width: `${Math.max(6, Math.round(slice.share * 100))}%`,
                      backgroundColor: slice.color,
                    },
                  ]}
                />
              </View>
              <View style={styles.legendStats}>
                <Text style={styles.legendPct}>{pct}%</Text>
                <Text style={styles.legendCount}>{y.lineTrips(slice.count)}</Text>
              </View>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    gap: 18,
    alignItems: 'center',
  },
  wrapRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 24,
  },
  chartBox: {
    width: 188,
    height: 188,
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  centerOverlay: {
    position: 'absolute',
    width: 96,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 1,
  },
  centerValue: {
    ...type.headlineSmall,
    fontWeight: '700',
    color: scheme.onSurface,
    fontVariant: ['tabular-nums'],
  },
  centerLabel: {
    ...type.labelMedium,
    color: scheme.onSurfaceVariant,
  },
  centerSub: {
    ...type.labelSmall,
    color: scheme.primary,
  },
  legend: {
    flex: 1,
    alignSelf: 'stretch',
    gap: 6,
  },
  legendRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    minHeight: 44,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: shape.medium,
  },
  legendRowSelected: {
    backgroundColor: scheme.surfaceContainerHigh,
  },
  legendRowPressed: {
    opacity: 0.78,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    flexShrink: 0,
  },
  otherChip: {
    backgroundColor: scheme.surfaceContainerHighest,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: shape.small,
  },
  otherChipText: {
    ...type.labelSmall,
    color: scheme.onSurfaceVariant,
  },
  legendBarTrack: {
    flex: 1,
    height: 6,
    borderRadius: 3,
    backgroundColor: scheme.surfaceContainerHigh,
    overflow: 'hidden',
  },
  legendBarFill: {
    height: 6,
    borderRadius: 3,
  },
  legendStats: {
    alignItems: 'flex-end',
    minWidth: 56,
  },
  legendPct: {
    ...type.labelLarge,
    fontWeight: '700',
    color: scheme.onSurface,
    fontVariant: ['tabular-nums'],
  },
  legendCount: {
    ...type.labelSmall,
    color: scheme.onSurfaceVariant,
  },
});
