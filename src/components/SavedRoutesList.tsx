import React, { memo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { ArrowRight, Clock3, Footprints, MapPinned, Pin, Ticket, X } from './icons';
import { LineBadge } from './LineBadge';
import { transfersLabel } from './ConnectionCard';
import { scheme, shape, type } from '../theme/tokens';
import type { SavedRoute } from '../types/models';
import { getLocaleSync, useStrings } from '../i18n';

export interface SavedRoutesListProps {
  routes: SavedRoute[];
  /** Id aktywnie śledzonego połączenia: karta oznaczona i zawsze pierwsza. */
  activeId?: string | null;
  /** Id połączeń z dołączonym biletem kolejowym (ikona biletu na karcie). */
  ticketIds?: ReadonlySet<string>;
  onSelect: (route: SavedRoute) => void;
  onRemove: (route: SavedRoute) => void;
  /** Otwiera pełnoekranowy podgląd biletu PDF do kontroli. */
  onOpenTicket: (route: SavedRoute) => void;
  /** Zatrzymuje śledzenie aktywnego kursu, trasa zostaje w historii. */
  onUnpin: (route: SavedRoute) => void;
}

const dateFormatters = new Map<string, Intl.DateTimeFormat>();

function routeDateFormatter(locale: string, utc: boolean): Intl.DateTimeFormat {
  const key = `${locale || 'pl'}:${utc ? 'utc' : 'local'}`;
  let fmt = dateFormatters.get(key);
  if (!fmt) {
    const opts: Intl.DateTimeFormatOptions = {
      weekday: 'long',
      day: 'numeric',
      month: 'numeric',
    };
    if (utc) opts.timeZone = 'UTC';
    try {
      fmt = new Intl.DateTimeFormat(locale || 'pl', opts);
    } catch {
      fmt = new Intl.DateTimeFormat('pl', opts);
    }
    dateFormatters.set(key, fmt);
  }
  return fmt;
}

/** „wtorek, 12.11”: data serwisowa połączenia, a w razie braku data zapisu trasy. */
function routeDateLabel(route: SavedRoute, locale: string): string {
  const iso = route.connection.serviceDate;
  if (iso) {
    const date = new Date(`${iso}T12:00:00Z`);
    if (!Number.isNaN(date.getTime())) return routeDateFormatter(locale, true).format(date);
  }
  const saved = new Date(route.savedAt);
  if (Number.isNaN(saved.getTime())) return '';
  return routeDateFormatter(locale, false).format(saved);
}

export const SavedRoutesList = memo(function SavedRoutesList({
  routes,
  activeId,
  ticketIds,
  onSelect,
  onRemove,
  onOpenTicket,
  onUnpin,
}: SavedRoutesListProps) {
  const s = useStrings();
  const locale = getLocaleSync();

  if (routes.length === 0) {
    return (
      <View style={styles.emptyCard}>
        <View style={styles.emptyIcon}>
          <MapPinned size={22} color={scheme.onSecondaryContainer} />
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
        const hasTicket = ticketIds?.has(route.id) ?? false;
        const active = route.id === activeId;
        const dateLabel = routeDateLabel(route, locale);

        return (
          <Pressable
            key={route.id || `${conn.fromTitle}-${conn.toTitle}-${index}`}
            onPress={() => onSelect(route)}
            accessibilityRole="button"
            accessibilityLabel={routeA11yLabel(conn, dateLabel, {
              active: active ? s.home.routeActive : null,
              ticket: hasTicket ? s.home.ticketAttachedA11y : null,
            })}
            style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
          >
            {/* Nagłówek: Skąd → Dokąd + akcje karty */}
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
              <View style={styles.actions}>
                {hasTicket && (
                  <Pressable
                    onPress={(e) => {
                      e.stopPropagation();
                      onOpenTicket(route);
                    }}
                    hitSlop={8}
                    accessibilityRole="button"
                    accessibilityLabel={s.railTickets.showTicket}
                    style={({ pressed }) => [
                      styles.actionBtn,
                      styles.actionAccent,
                      pressed && styles.actionPressed,
                    ]}
                  >
                    <Ticket size={16} color={scheme.onPrimaryContainer} />
                  </Pressable>
                )}
                {active ? (
                  <Pressable
                    onPress={(e) => {
                      e.stopPropagation();
                      onUnpin(route);
                    }}
                    hitSlop={8}
                    accessibilityRole="button"
                    accessibilityLabel={s.routes.stopTrackingTripA11y}
                    style={({ pressed }) => [
                      styles.actionBtn,
                      styles.actionAccent,
                      pressed && styles.actionPressed,
                    ]}
                  >
                    <Pin size={16} color={scheme.onPrimaryContainer} />
                  </Pressable>
                ) : !hasTicket ? (
                  <Pressable
                    onPress={(e) => {
                      e.stopPropagation();
                      onRemove(route);
                    }}
                    hitSlop={8}
                    accessibilityRole="button"
                    accessibilityLabel={s.home.removeRouteA11y(conn.toTitle)}
                    style={({ pressed }) => [
                      styles.actionBtn,
                      pressed && styles.actionPressed,
                    ]}
                  >
                    <X size={16} color={scheme.onSurfaceVariant} />
                  </Pressable>
                ) : null}
              </View>
            </View>

            {/* Linie (karta z biletem ma akcje biletu w prawym górnym rogu) */}
            <View style={styles.metaRow}>
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

            {/* Data, godziny, czas i przesiadki */}
            <View style={styles.footerRow}>
              {dateLabel ? (
                <Text style={styles.dateText} numberOfLines={1}>
                  {dateLabel}
                </Text>
              ) : null}
              <Text style={styles.timesText} numberOfLines={1}>
                {conn.departAt} – {conn.arriveAt}
              </Text>
              <View style={styles.durationChip}>
                <Clock3 size={13} color={scheme.onSurfaceVariant} />
                <Text style={styles.durationText}>{s.common.durMin(conn.durationMin)}</Text>
              </View>
              <Text style={styles.metaText} numberOfLines={1}>
                {transfersLabel(conn.transfers)}
              </Text>
            </View>
          </Pressable>
        );
      })}
    </View>
  );
});

function routeA11yLabel(
  conn: SavedRoute['connection'],
  dateLabel: string,
  marks: { active: string | null; ticket: string | null },
): string {
  const parts = [
    `${conn.fromTitle} → ${conn.toTitle}`,
    dateLabel,
    `${conn.departAt} – ${conn.arriveAt}`,
    `${conn.durationMin} min`,
  ];
  if (marks.active) parts.push(marks.active);
  if (marks.ticket) parts.push(marks.ticket);
  return parts.filter(Boolean).join(', ');
}

const styles = StyleSheet.create({
  list: {
    gap: 10,
  },
  card: {
    backgroundColor: scheme.surfaceContainerHigh,
    borderRadius: shape.extraLarge,
    padding: 16,
    gap: 12,
  },
  cardPressed: {
    backgroundColor: scheme.surfaceContainerHighest,
    transform: [{ scale: 0.98 }],
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
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flexShrink: 0,
  },
  actionBtn: {
    width: 36,
    height: 36,
    borderRadius: shape.full,
    backgroundColor: scheme.surfaceContainerHighest,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionAccent: {
    backgroundColor: scheme.primaryContainer,
  },
  actionPressed: {
    opacity: 0.6,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  badgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 6,
    flexShrink: 1,
  },
  badgeWrap: {
    justifyContent: 'center',
  },
  walkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flexShrink: 1,
  },
  walkText: {
    ...type.bodyMedium,
    color: scheme.onSurfaceVariant,
  },
  footerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    columnGap: 8,
    rowGap: 4,
  },
  dateText: {
    ...type.bodySmall,
    fontWeight: '600',
    color: scheme.onSurfaceVariant,
  },
  timesText: {
    ...type.bodySmall,
    fontWeight: '600',
    color: scheme.onSurface,
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
  metaText: {
    ...type.bodySmall,
    color: scheme.onSurfaceVariant,
  },
  emptyCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    padding: 20,
    backgroundColor: scheme.surfaceContainerHigh,
    borderRadius: shape.extraLarge,
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
