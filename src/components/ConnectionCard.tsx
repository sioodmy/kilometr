import { memo, useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { ArrowRight, Footprints } from 'lucide-react-native';
import { elev, scheme, shape, type } from '../theme/tokens';
import type { Connection, Leg } from '../types/models';
import { getLineColors } from '../services/lineIdentity';
import { LineBadge } from './LineBadge';
import { LiveDot } from './LiveDot';
import { formatWalkTime, useWalkSpeedMps, walkMinutesFor } from '../services/settings';

import { tr } from '../i18n';

/** Poprawna odmiana liczby przesiadek (słownik i18n: 1 / 2–4 / 5+). */
export function transfersLabel(n: number): string {
  return tr().connection.transfers(n);
}

/** Poprawna odmiana liczby połączeń (słownik i18n: 1 / 2–4 / 5+). */
export function connectionsLabel(n: number): string {
  return tr().connection.connections(n);
}

/** Minuty od północy dla "teraz". */
function nowSec(): number {
  const d = new Date();
  return d.getHours() * 3600 + d.getMinutes() * 60 + d.getSeconds();
}

type SegmentItem =
  | { type: 'walk'; key: string; minutes: number }
  | { type: 'transit'; key: string; leg: Leg }
  | { type: 'arrow'; key: string };

function parseHMtoSec(hm: string): number | null {
  const m = /^(\d{1,2}):(\d{2})/.exec(hm || '');
  if (!m) return null;
  return Number(m[1]) * 3600 + Number(m[2]) * 60;
}

function getLegWalkMin(leg: Leg | undefined, walkMps: number): number {
  if (!leg) return 1;
  if (leg.walkM != null && leg.walkM > 0) {
    return walkMinutesFor(leg.walkM, walkMps);
  }
  const dep = parseHMtoSec(leg.departAt);
  const arr = parseHMtoSec(leg.arriveAt);
  if (dep != null && arr != null && arr > dep) {
    return Math.max(1, Math.round((arr - dep) / 60));
  }
  return 1;
}

function transitMinutes(leg: Leg): number {
  const dep = parseHMtoSec(leg.departAt);
  const arr = parseHMtoSec(leg.arriveAt);
  if (dep != null && arr != null && arr > dep) {
    return Math.max(1, Math.round((arr - dep) / 60));
  }
  return 3;
}

function buildLegSegments(legs: Leg[], walkMps: number): SegmentItem[] {
  const transitLegs = legs.filter((l) => l.mode !== 'walk');
  if (transitLegs.length === 0) {
    return [];
  }

  const items: SegmentItem[] = [];

  const firstTransitIdx = legs.findIndex((l) => l.mode !== 'walk');
  if (firstTransitIdx > 0) {
    const initialWalks = legs.slice(0, firstTransitIdx);
    const walkM = initialWalks.reduce((acc, l) => acc + (l.walkM ?? 0), 0);
    const min = walkM > 0 ? walkMinutesFor(walkM, walkMps) : getLegWalkMin(initialWalks[0], walkMps);
    if (min > 0) {
      items.push({ type: 'walk', key: 'walk-initial', minutes: min });
    }
  }

  for (let i = 0; i < transitLegs.length; i++) {
    const tLeg = transitLegs[i];
    items.push({ type: 'transit', key: `transit-${tLeg.id || i}`, leg: tLeg });

    if (i < transitLegs.length - 1) {
      const nextTLeg = transitLegs[i + 1];
      const curIdx = legs.indexOf(tLeg);
      const nextIdx = legs.indexOf(nextTLeg);

      let transferWalkMin = 0;
      if (curIdx >= 0 && nextIdx > curIdx + 1) {
        const intermediateWalks = legs.slice(curIdx + 1, nextIdx).filter((l) => l.mode === 'walk');
        const transferM = intermediateWalks.reduce((acc, l) => acc + (l.walkM ?? 0), 0);
        if (transferM > 0) {
          transferWalkMin = walkMinutesFor(transferM, walkMps);
        } else if (intermediateWalks.length > 0) {
          transferWalkMin = getLegWalkMin(intermediateWalks[0], walkMps);
        }
      }

      if (transferWalkMin > 0) {
        items.push({ type: 'walk', key: `walk-transfer-${tLeg.id || i}`, minutes: transferWalkMin });
      }

      items.push({ type: 'arrow', key: `arrow-${tLeg.id || i}` });
    }
  }

  const lastTransitIdx = legs.reduce((last, l, idx) => (l.mode !== 'walk' ? idx : last), -1);
  if (lastTransitIdx >= 0 && lastTransitIdx < legs.length - 1) {
    const finalWalks = legs.slice(lastTransitIdx + 1);
    const walkM = finalWalks.reduce((acc, l) => acc + (l.walkM ?? 0), 0);
    const min = walkM > 0 ? walkMinutesFor(walkM, walkMps) : getLegWalkMin(finalWalks[0], walkMps);
    if (min > 0) {
      items.push({ type: 'walk', key: 'walk-final', minutes: min });
    }
  }

  return items;
}

/** Nazwy przystanków przesiadkowych z pola interchange silnika. */
function interchangeStops(raw?: string): string[] {
  if (!raw) return [];
  const colon = raw.indexOf(':');
  const body = colon >= 0 ? raw.slice(colon + 1) : raw;
  return body
    .split('•')
    .map((s) => s.trim())
    .filter(Boolean);
}

const BADGE_H = 28;
const WALK_H = 18;
const STRIP_H = 43;
const STRIP_CELL_MIN_W = 54;

function JourneyStrip({ segments }: { segments: SegmentItem[] }) {
  const parts = segments.filter((s) => s.type === 'walk' || s.type === 'transit');
  if (parts.length === 0) return null;

  const weights = parts.map((p) =>
    p.type === 'walk' ? Math.max(p.minutes, 1) : transitMinutes(p.leg),
  );

  return (
    <View style={styles.strip} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {parts.map((part, i) => {
        const color =
          part.type === 'transit'
            ? getLineColors(part.leg.line, part.leg.mode).bg
            : scheme.outlineVariant;
        return (
          <View key={part.key} style={[styles.stripCell, { flex: weights[i] }]}>
            <View style={[styles.stripLine, { backgroundColor: color }]} />
            <View style={styles.stripBadge}>
              {part.type === 'walk' ? (
                <View style={[styles.walkPill, { marginTop: (BADGE_H - WALK_H) / 2 }]}>
                  <Footprints size={10} color={scheme.onSurfaceVariant} strokeWidth={2.4} />
                  <Text style={styles.walkPillText}>{part.minutes}m</Text>
                </View>
              ) : (
                <>
                  <LineBadge mode={part.leg.mode} line={part.leg.line} compact={parts.length > 4} />
                  <Text style={styles.stripDepart}>{part.leg.departAt}</Text>
                </>
              )}
            </View>
          </View>
        );
      })}
    </View>
  );
}

export const ConnectionCard = memo(function ConnectionCard({
  item,
  onPress,
  dimmed = false,
  tick = 0,
}: {
  item: Connection;
  onPress: (item: Connection) => void;
  /** historyczne (przeszłe) połączenie — przygaszony wygląd */
  dimmed?: boolean;
  /** Zmienia się co interwał, żeby odliczanie „za X min” nie zamarzło pod memo. */
  tick?: number;
}) {
  const walkMps = useWalkSpeedMps();
  const now = useMemo(() => nowSec(), [tick]);
  const boarding = useMemo(() => item.legs.filter((l) => l.mode !== 'walk'), [item.legs]);
  const walkOnly = boarding.length === 0;
  const segments = useMemo(() => buildLegSegments(item.legs, walkMps), [item.legs, walkMps]);
  const transfers = useMemo(() => interchangeStops(item.interchange), [item.interchange]);

  const minsAgo =
    item.departureSec > 0 ? Math.round((now - item.departureSec) / 60) : -1;
  const historical = minsAgo >= 1;

  let badgeBg: string = scheme.secondaryContainer;
  let badgeFg: string = scheme.onSecondaryContainer;
  let dotColor: string | null = null;
  const effectiveMin =
    item.departureSec > 0 ? Math.round((item.departureSec - now) / 60) : item.departInMin;

  if (item.live) {
    if (item.delayMin > 0) {
      badgeBg = scheme.errorContainer;
      badgeFg = scheme.onErrorContainer;
      dotColor = scheme.error;
    } else {
      badgeBg = scheme.successContainer;
      badgeFg = scheme.onSuccessContainer;
      dotColor = scheme.success;
    }
  }

  const walkM = walkOnly ? item.legs[0]?.walkM : undefined;
  const walkMin =
    item.durationMin || (walkM != null ? walkMinutesFor(walkM, walkMps) : 1);

  const departureText = historical
    ? minsAgo <= 1
      ? tr().common.departJustAgo
      : tr().common.departAgo(minsAgo)
    : walkOnly && walkM != null
      ? formatWalkTime(walkMin)
      : effectiveMin <= 1
        ? tr().common.departNow
        : effectiveMin > 59
          ? item.departAt
          : tr().common.departIn(effectiveMin);
  const departureColor = historical
    ? scheme.onSurfaceVariant
    : item.live && item.delayMin > 0
      ? scheme.error
      : scheme.onSurface;

  const linesSummary = boarding.map((b) => b.line).filter(Boolean).join(', ');
  const accessibilityDesc = tr().connection.cardA11y(
    departureText,
    item.durationMin,
    item.departAt,
    item.arriveAt,
    walkOnly ? tr().connection.walkRoute : transfersLabel(item.transfers),
    linesSummary,
  );

  // Przeszłe: zwarta linia zamiast pełnej karty, żeby kolejne odjazdy
  // były pierwszym, na co spada wzrok.
  if (historical || dimmed) {
    return (
      <Pressable
        onPress={() => onPress(item)}
        accessibilityRole="button"
        accessibilityLabel={accessibilityDesc}
        style={({ pressed }) => [
          styles.pastCard,
          pressed && { backgroundColor: scheme.surfaceContainerHigh },
        ]}
      >
        <Text style={styles.pastDepart} numberOfLines={1}>
          {departureText}
        </Text>
        <Text style={styles.pastHours} numberOfLines={1}>
          {item.departAt} → {item.arriveAt}
        </Text>
        <View style={styles.pastDur}>
          <Text style={styles.pastDurText}>{tr().common.durMin(item.durationMin)}</Text>
        </View>
        {boarding[0]?.line ? (
          <View style={styles.pastLine}>
            <LineBadge mode={boarding[0].mode} line={boarding[0].line} compact />
          </View>
        ) : null}
      </Pressable>
    );
  }

  return (
    <Pressable
      onPress={() => onPress(item)}
      accessibilityRole="button"
      accessibilityLabel={accessibilityDesc}
      style={({ pressed }) => [
        styles.card,
        pressed && { backgroundColor: scheme.surfaceContainerHigh },
      ]}
    >
      <View style={styles.top}>
        <View style={styles.topLeft}>
          <Text style={[styles.duration, { color: departureColor }]}>{departureText}</Text>
          <View style={styles.hoursRow}>
            <Text style={styles.hours}>{item.departAt}</Text>
            <ArrowRight size={11} color={scheme.onSurfaceVariant} strokeWidth={2.2} />
            <Text style={styles.hours}>{item.arriveAt}</Text>
            <Text style={styles.hoursDot}>·</Text>
            <Text style={styles.hours}>
              {walkOnly ? tr().connection.walkLeg : transfersLabel(item.transfers)}
            </Text>
          </View>
        </View>
        <View
          style={[
            styles.badge,
            { backgroundColor: badgeBg },
          ]}
        >
          {dotColor != null ? <LiveDot color={dotColor} size={7} pulse={false} /> : null}
          <Text style={[styles.badgeText, { color: badgeFg }]}>
            {tr().common.durMin(item.durationMin)}
          </Text>
        </View>
      </View>

      {walkOnly ? (
        <View style={styles.walkOnlyWrap}>
          <View style={styles.walkPill}>
            <Footprints size={12} color={scheme.onSurfaceVariant} strokeWidth={2.2} />
            <Text style={styles.walkPillText}>{walkMin}m</Text>
          </View>
          <Text style={styles.walkLabel}>{tr().connection.walkAll}</Text>
        </View>
      ) : segments.length > 0 ? (
        <JourneyStrip segments={segments} />
      ) : null}

      {transfers.length > 0 ? (
        <View style={styles.transferRow}>
          {transfers.map((stop) => (
            <View key={stop} style={styles.transferChip}>
              <Text style={styles.transferChipText} numberOfLines={1}>
                {stop}
              </Text>
            </View>
          ))}
        </View>
      ) : null}
    </Pressable>
  );
});

const styles = StyleSheet.create({
  card: {
    backgroundColor: scheme.surfaceContainer,
    borderRadius: shape.large,
    paddingVertical: 12,
    paddingHorizontal: 14,
    gap: 8,
    minHeight: 72,
    justifyContent: 'center',
    overflow: 'hidden',
    ...elev.level1,
  },
  pastCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: scheme.surfaceContainerLow,
    borderRadius: shape.medium,
    paddingVertical: 10,
    paddingHorizontal: 12,
    minHeight: 44,
  },
  pastDepart: {
    ...type.labelLarge,
    fontWeight: '600',
    color: scheme.onSurfaceVariant,
    minWidth: 84,
  },
  pastHours: {
    ...type.bodySmall,
    color: scheme.onSurfaceVariant,
    flex: 1,
    opacity: 0.85,
  },
  pastDur: {
    backgroundColor: scheme.surfaceContainerHighest,
    borderRadius: shape.full,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  pastDurText: {
    ...type.labelSmall,
    fontWeight: '600',
    color: scheme.onSurfaceVariant,
  },
  pastLine: {
    opacity: 0.7,
  },
  top: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12,
  },
  topLeft: {
    flex: 1,
    gap: 4,
    minWidth: 0,
  },
  duration: {
    ...type.titleLarge,
    fontWeight: '700',
    color: scheme.onSurface,
    letterSpacing: -0.3,
  },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: shape.full,
    paddingHorizontal: 12,
    paddingVertical: 6,
    marginTop: 2,
  },
  badgeText: {
    ...type.labelMedium,
    fontWeight: '700',
  },
  hoursRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    flexWrap: 'wrap',
  },
  hoursDot: {
    ...type.bodySmall,
    color: scheme.onSurfaceVariant,
  },
  hours: {
    ...type.bodyMedium,
    color: scheme.onSurfaceVariant,
  },
  strip: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    height: STRIP_H,
  },
  stripCell: {
    height: STRIP_H,
    minWidth: STRIP_CELL_MIN_W,
  },
  stripLine: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: 4,
    top: BADGE_H / 2 - 2,
  },
  stripBadge: {
    alignSelf: 'center',
    alignItems: 'center',
    height: STRIP_H,
  },
  stripDepart: {
    marginTop: 2,
    fontSize: 9,
    lineHeight: 11,
    fontWeight: '600',
    color: scheme.onSurfaceVariant,
    opacity: 0.72,
    fontVariant: ['tabular-nums'],
  },
  walkOnlyWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  walkPill: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 3,
    height: WALK_H,
    backgroundColor: scheme.outlineVariant,
    paddingHorizontal: 9,
    borderRadius: 999,
  },
  walkPillText: {
    fontSize: 10,
    lineHeight: 11,
    color: scheme.onSurface,
    fontWeight: '600',
  },
  walkLabel: {
    ...type.bodySmall,
    color: scheme.onSurfaceVariant,
  },
  transferRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  transferChip: {
    backgroundColor: scheme.surfaceContainerHighest,
    borderRadius: shape.small,
    paddingHorizontal: 8,
    paddingVertical: 4,
    maxWidth: '100%',
  },
  transferChipText: {
    ...type.labelSmall,
    color: scheme.onSurface,
    fontWeight: '500',
    opacity: 0.82,
  },
});
