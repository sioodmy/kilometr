import React, { memo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { ArrowRight, Clock3, Footprints, Pin } from './icons';
import { LineBadge } from './LineBadge';
import { transfersLabel } from './ConnectionCard';
import { scheme, shape, type } from '../theme/tokens';
import type { SavedRoute } from '../types/models';
import { useStrings } from '../i18n';

export interface SavedRoutesListProps {
  routes: SavedRoute[];
  onSelect: (route: SavedRoute) => void;
  onUnpin: (route: SavedRoute) => void;
}

export const SavedRoutesList = memo(function SavedRoutesList({
  routes,
  onSelect,
  onUnpin,
}: SavedRoutesListProps) {
  const s = useStrings();

  if (routes.length === 0) {
    return (
      <View style={styles.emptyCard}>
        <View style={styles.emptyIcon}>
          <Pin size={22} color={scheme.onSecondaryContainer} />
        </View>
        <View style={styles.emptyText}>
          <Text style={styles.emptyTitle}>{s.home.savedRoutesEmptyTitle}</Text>
          <Text style={styles.emptyBody}>{s.home.savedRoutesEmptyBody}</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.list}>
      {routes.map((route, index) => {
        const conn = route.connection;
        const transitLegs = conn.legs.filter((l) => l.mode !== 'walk' && l.line);
        const walkOnly = transitLegs.length === 0;

        return (
          <Pressable
            key={route.id || `${conn.fromTitle}-${conn.toTitle}-${index}`}
            onPress={() => onSelect(route)}
            accessibilityRole="button"
            accessibilityLabel={`${conn.fromTitle} → ${conn.toTitle}, ${conn.departAt} – ${conn.arriveAt}, ${conn.durationMin} min`}
            style={({ pressed }) => [
              styles.card,
              pressed && { backgroundColor: scheme.surfaceContainerHighest },
            ]}
          >
            {/* Header row: From -> To and Unpin button */}
            <View style={styles.headerRow}>
              <View style={styles.endpoints}>
                <Text style={styles.endpointText} numberOfLines={1}>
                  {conn.fromTitle}
                </Text>
                <ArrowRight size={14} color={scheme.onSurfaceVariant} style={styles.arrow} />
                <Text style={styles.endpointText} numberOfLines={1}>
                  {conn.toTitle}
                </Text>
              </View>
              <Pressable
                onPress={(e) => {
                  e.stopPropagation();
                  onUnpin(route);
                }}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel={s.home.unpinRouteA11y(conn.toTitle)}
                style={({ pressed }) => [
                  styles.unpinBtn,
                  pressed && { opacity: 0.7 },
                ]}
              >
                <Pin size={17} color={scheme.onPrimaryContainer} />
              </Pressable>
            </View>

            {/* Transit line badges */}
            <View style={styles.transitRow}>
              {walkOnly ? (
                <View style={styles.walkRow}>
                  <Footprints size={16} color={scheme.onSurfaceVariant} />
                  <Text style={styles.walkText}>{s.connection.walkRoute}</Text>
                </View>
              ) : (
                <View style={styles.badgeRow}>
                  {transitLegs.map((leg, legIdx) => (
                    <View key={`${leg.line}-${legIdx}`} style={styles.badgeWrap}>
                      <LineBadge mode={leg.mode} line={leg.line} />
                    </View>
                  ))}
                </View>
              )}
            </View>

            {/* Timing, duration, and transfers */}
            <View style={styles.footerRow}>
              <Text style={styles.timesText}>
                {conn.departAt} – {conn.arriveAt}
              </Text>
              <Text style={styles.dotSeparator}>•</Text>
              <View style={styles.durationChip}>
                <Clock3 size={13} color={scheme.onSurfaceVariant} />
                <Text style={styles.durationText}>
                  {s.common.durMin(conn.durationMin)}
                </Text>
              </View>
              <Text style={styles.dotSeparator}>•</Text>
              <Text style={styles.transfersText}>
                {transfersLabel(conn.transfers)}
              </Text>
            </View>
          </Pressable>
        );
      })}
    </View>
  );
});

const styles = StyleSheet.create({
  list: {
    gap: 10,
  },
  card: {
    backgroundColor: scheme.surfaceContainerLow,
    borderRadius: shape.extraLarge,
    padding: 16,
    gap: 12,
    borderWidth: 1,
    borderColor: scheme.outlineVariant,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  endpoints: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    minWidth: 0,
  },
  endpointText: {
    ...type.titleMedium,
    fontWeight: '600',
    color: scheme.onSurface,
    flexShrink: 1,
  },
  arrow: {
    flexShrink: 0,
  },
  unpinBtn: {
    width: 36,
    height: 36,
    borderRadius: shape.full,
    backgroundColor: scheme.primaryContainer,
    alignItems: 'center',
    justifyContent: 'center',
  },
  transitRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  badgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 6,
  },
  badgeWrap: {
    justifyContent: 'center',
  },
  walkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  walkText: {
    ...type.bodyMedium,
    color: scheme.onSurfaceVariant,
  },
  footerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 6,
  },
  timesText: {
    ...type.bodyMedium,
    fontWeight: '600',
    color: scheme.onSurface,
  },
  dotSeparator: {
    ...type.bodySmall,
    color: scheme.outline,
  },
  durationChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  durationText: {
    ...type.bodySmall,
    color: scheme.onSurfaceVariant,
  },
  transfersText: {
    ...type.bodySmall,
    color: scheme.onSurfaceVariant,
  },
  emptyCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    padding: 20,
    backgroundColor: scheme.surfaceContainerLow,
    borderRadius: shape.extraLarge,
    borderWidth: 1,
    borderColor: scheme.outlineVariant,
  },
  emptyIcon: {
    width: 48,
    height: 48,
    borderRadius: shape.full,
    backgroundColor: scheme.secondaryContainer,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  emptyText: {
    flex: 1,
    gap: 4,
  },
  emptyTitle: {
    ...type.titleSmall,
    fontWeight: '600',
    color: scheme.onSurface,
  },
  emptyBody: {
    ...type.bodySmall,
    color: scheme.onSurfaceVariant,
    lineHeight: 18,
  },
});
