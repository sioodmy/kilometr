import React, { memo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { ArrowRight, Clock3, Footprints, MapPinned, Pin, Ticket, X } from './icons';
import { SpringPressable } from './SpringPressable';
import { LineBadge } from './LineBadge';
import { transfersLabel } from './ConnectionCard';
import { scheme, shape, type } from '../theme/tokens';
import type { SavedRoute } from '../types/models';
import { getLocaleSync, useStrings } from '../i18n';
import type { Strings } from '../i18n/pl';

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

type SegmentPosition = 'single' | 'first' | 'middle' | 'last';

function resolveSegment(index: number, total: number): SegmentPosition {
  if (total <= 1) return 'single';
  if (index === 0) return 'first';
  if (index === total - 1) return 'last';
  return 'middle';
}

interface SavedRouteCardProps {
  route: SavedRoute;
  segment: SegmentPosition;
  active: boolean;
  hasTicket: boolean;
  locale: string;
  onSelect: (route: SavedRoute) => void;
  onRemove: (route: SavedRoute) => void;
  onOpenTicket: (route: SavedRoute) => void;
  onUnpin: (route: SavedRoute) => void;
}

/** Karta zapisanej trasy w zgrupowanym układzie M3 Expressive. */
const SavedRouteCard = memo(function SavedRouteCard({
  route,
  segment,
  active,
  hasTicket,
  locale,
  onSelect,
  onRemove,
  onOpenTicket,
  onUnpin,
}: SavedRouteCardProps) {
  const s = useStrings();
  const conn = route.connection;
  const transitLegs = conn.legs.filter((l) => l.mode !== 'walk' && l.line);
  const walkOnly = transitLegs.length === 0;
  const dateLabel = routeDateLabel(route, locale);

  return (
    <SpringPressable
      onPress={() => onSelect(route)}
      accessibilityRole="button"
      accessibilityLabel={routeA11yLabel(
        conn,
        dateLabel,
        {
          active: active ? s.home.routeActive : null,
          ticket: hasTicket ? s.home.ticketAttachedA11y : null,
        },
        s,
      )}
      scaleDelta={0.018}
      opacityDelta={0.05}
      style={[
        styles.card,
        (segment === 'first' || segment === 'single') && styles.cardTop,
        (segment === 'last' || segment === 'single') && styles.cardBottom,
        active && styles.cardActive,
      ]}
    >
      {/* Nagłówek: Skąd -> Dokąd + akcje karty */}
      <View style={styles.headerRow}>
        <View style={styles.endpoints}>
          <Text style={styles.endpointFrom} numberOfLines={1}>
            {conn.fromTitle}
          </Text>
          <ArrowRight size={15} color={scheme.primary} style={styles.arrow} />
          <Text style={styles.endpointTo} numberOfLines={1}>
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
          ) : (
            <Pressable
              onPress={(e) => {
                e.stopPropagation();
                onRemove(route);
              }}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel={s.home.removeRouteA11y(conn.toTitle)}
              style={({ pressed }) => [styles.actionBtn, pressed && styles.actionPressed]}
            >
              <X size={16} color={scheme.onSurfaceVariant} />
            </Pressable>
          )}
        </View>
      </View>

      {/* Linie + status aktywnej trasy */}
      <View style={styles.metaRow}>
        {active && (
          <View style={styles.activePill}>
            <View style={styles.activeDot} />
            <Text style={styles.activeText}>{s.home.routeActive}</Text>
          </View>
        )}
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
        <View style={styles.timesPill}>
          <Text style={styles.timesText} numberOfLines={1}>
            {conn.departAt} – {conn.arriveAt}
          </Text>
        </View>
        <View style={styles.durationChip}>
          <Clock3 size={13} color={scheme.onSurfaceVariant} />
          <Text style={styles.durationText}>{s.common.durMin(conn.durationMin)}</Text>
        </View>
        <Text style={styles.metaText} numberOfLines={1}>
          {transfersLabel(conn.transfers)}
        </Text>
        {dateLabel ? (
          <Text style={styles.dateText} numberOfLines={1}>
            {dateLabel}
          </Text>
        ) : null}
      </View>
    </SpringPressable>
  );
});

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
      {routes.map((route, index) => (
        <SavedRouteCard
          key={route.id || `${route.connection.fromTitle}-${route.connection.toTitle}-${index}`}
          route={route}
          segment={resolveSegment(index, routes.length)}
          active={route.id === activeId}
          hasTicket={ticketIds?.has(route.id) ?? false}
          locale={locale}
          onSelect={onSelect}
          onRemove={onRemove}
          onOpenTicket={onOpenTicket}
          onUnpin={onUnpin}
        />
      ))}
    </View>
  );
});

function routeA11yLabel(
  conn: SavedRoute['connection'],
  dateLabel: string,
  marks: { active: string | null; ticket: string | null },
  s: Strings,
): string {
  const parts = [
    `${conn.fromTitle} → ${conn.toTitle}`,
    dateLabel,
    `${conn.departAt} – ${conn.arriveAt}`,
    s.common.durMin(conn.durationMin),
  ];
  if (marks.active) parts.push(marks.active);
  if (marks.ticket) parts.push(marks.ticket);
  return parts.filter(Boolean).join(', ');
}

const styles = StyleSheet.create({
  list: {
    gap: 4,
  },
  card: {
    backgroundColor: scheme.surfaceContainer,
    borderRadius: shape.small,
    padding: 16,
    gap: 12,
    borderWidth: 1.5,
    borderColor: 'transparent',
  },
  cardTop: {
    borderTopLeftRadius: shape.extraLarge,
    borderTopRightRadius: shape.extraLarge,
  },
  cardBottom: {
    borderBottomLeftRadius: shape.extraLarge,
    borderBottomRightRadius: shape.extraLarge,
  },
  cardActive: {
    backgroundColor: scheme.surfaceContainerHigh,
    borderColor: scheme.primaryContainer,
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
  endpointFrom: {
    ...type.titleMedium,
    fontWeight: '600',
    color: scheme.onSurfaceVariant,
    flexShrink: 1,
  },
  endpointTo: {
    ...type.titleMedium,
    fontWeight: '700',
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
    opacity: 0.65,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 8,
  },
  activePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: shape.full,
    backgroundColor: scheme.primaryContainer,
  },
  activeDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: scheme.primary,
  },
  activeText: {
    ...type.labelSmall,
    fontWeight: '700',
    color: scheme.onPrimaryContainer,
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
    columnGap: 10,
    rowGap: 4,
  },
  timesPill: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: shape.small,
    backgroundColor: scheme.surfaceContainerHigh,
  },
  timesText: {
    ...type.labelMedium,
    fontWeight: '700',
    color: scheme.onSurface,
  },
  durationChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  durationText: {
    ...type.bodySmall,
    fontWeight: '600',
    color: scheme.onSurfaceVariant,
  },
  metaText: {
    ...type.bodySmall,
    color: scheme.onSurfaceVariant,
  },
  dateText: {
    ...type.bodySmall,
    color: scheme.onSurfaceVariant,
    marginLeft: 'auto',
  },
  emptyCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    padding: 20,
    backgroundColor: scheme.surfaceContainer,
    borderRadius: shape.extraLarge,
  },
  emptyIcon: {
    width: 48,
    height: 48,
    borderRadius: shape.large,
    borderTopRightRadius: shape.small,
    borderBottomLeftRadius: shape.small,
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
    ...type.titleMedium,
    fontWeight: '700',
    color: scheme.onSurface,
  },
  emptyBody: {
    ...type.bodySmall,
    color: scheme.onSurfaceVariant,
    lineHeight: 18,
  },
});
