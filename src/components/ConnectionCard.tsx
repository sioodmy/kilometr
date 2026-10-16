import { Fragment, memo, useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { ArrowRight, Footprints } from 'lucide-react-native';
import { elev, scheme, shape, type } from '../theme/tokens';
import type { Connection, Leg } from '../types/models';
import { getLineColors } from '../services/lineIdentity';
import { LineBadge } from './LineBadge';
import { LiveDot } from './LiveDot';
import { formatWalkTime, useWalkSpeedMps, walkMinutesFor } from '../services/settings';

import { tr } from '../i18n';

/** Poprawna odmiana liczby przesiadek (słownik i18n: 1 / 2-4 / 5+). */
export function transfersLabel(n: number): string {
  return tr().connection.transfers(n);
}

/** Poprawna odmiana liczby połączeń (słownik i18n: 1 / 2-4 / 5+). */
export function connectionsLabel(n: number): string {
  return tr().connection.connections(n);
}

/** Minuty od północy dla "teraz". */
function nowSec(): number {
  const d = new Date();
  return d.getHours() * 3600 + d.getMinutes() * 60 + d.getSeconds();
}

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

interface TransitLegItem {
  key: string;
  leg: Leg;
  transferWalkMinAfter: number;
}

interface JourneyStripData {
  initialWalkMin: number;
  transitLegs: TransitLegItem[];
  finalWalkMin: number;
}

function buildJourneyStripData(legs: Leg[], walkMps: number): JourneyStripData {
  const transitLegs: Leg[] = [];
  const transitIndices: number[] = [];

  for (let i = 0; i < legs.length; i++) {
    if (legs[i].mode !== 'walk') {
      transitLegs.push(legs[i]);
      transitIndices.push(i);
    }
  }

  if (transitLegs.length === 0) {
    return { initialWalkMin: 0, transitLegs: [], finalWalkMin: 0 };
  }

  let initialWalkMin = 0;
  const firstTransitIdx = transitIndices[0];
  if (firstTransitIdx > 0) {
    const initialWalks = legs.slice(0, firstTransitIdx);
    const walkM = initialWalks.reduce((acc, l) => acc + (l.walkM ?? 0), 0);
    initialWalkMin = walkM > 0 ? walkMinutesFor(walkM, walkMps) : getLegWalkMin(initialWalks[0], walkMps);
  }

  let finalWalkMin = 0;
  const lastTransitIdx = transitIndices[transitIndices.length - 1];
  if (lastTransitIdx < legs.length - 1) {
    const finalWalks = legs.slice(lastTransitIdx + 1);
    const walkM = finalWalks.reduce((acc, l) => acc + (l.walkM ?? 0), 0);
    finalWalkMin = walkM > 0 ? walkMinutesFor(walkM, walkMps) : getLegWalkMin(finalWalks[0], walkMps);
  }

  const items: TransitLegItem[] = [];
  for (let i = 0; i < transitLegs.length; i++) {
    const leg = transitLegs[i];
    let transferWalkMinAfter = 0;

    if (i < transitLegs.length - 1) {
      const curIdx = transitIndices[i];
      const nextIdx = transitIndices[i + 1];
      if (nextIdx > curIdx + 1) {
        const intermediateWalks = legs.slice(curIdx + 1, nextIdx).filter((l) => l.mode === 'walk');
        const transferM = intermediateWalks.reduce((acc, l) => acc + (l.walkM ?? 0), 0);
        if (transferM > 0) {
          transferWalkMinAfter = walkMinutesFor(transferM, walkMps);
        } else if (intermediateWalks.length > 0) {
          transferWalkMinAfter = getLegWalkMin(intermediateWalks[0], walkMps);
        }
      }
    }

    items.push({
      key: `transit-${leg.id || i}`,
      leg,
      transferWalkMinAfter,
    });
  }

  return { initialWalkMin, transitLegs: items, finalWalkMin };
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
const STRIP_H = 43;

function JourneyStrip({ data }: { data: JourneyStripData }) {
  if (data.transitLegs.length === 0) return null;

  const count = data.transitLegs.length;
  const isCompact = count >= 3;

  return (
    <View style={styles.strip} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {data.initialWalkMin > 0 ? (
        <View style={styles.stripEdgeWalk}>
          <View style={styles.walkPill}>
            <Footprints size={9} color={scheme.onSurfaceVariant} strokeWidth={2.2} />
            <Text style={styles.walkPillText}>{data.initialWalkMin}m</Text>
          </View>
          <View style={styles.stripEdgeConnectorLine} />
        </View>
      ) : null}

      {data.transitLegs.map((item, i) => {
        const color = getLineColors(item.leg.line, item.leg.mode).bg;
        const isLast = i === count - 1;

        return (
          <Fragment key={item.key}>
            <View style={styles.stripCell}>
              <View style={[styles.stripLine, { backgroundColor: color }]} />
              <View style={styles.stripBadge}>
                <LineBadge
                  mode={item.leg.mode}
                  line={item.leg.line}
                  compact={count > 1}
                />
                <Text style={styles.stripDepart}>{item.leg.departAt}</Text>
              </View>
            </View>

            {!isLast ? (
              <View style={[styles.stripConnector, isCompact && styles.stripConnectorCompact]}>
                <View style={styles.stripConnectorLine} />
                {item.transferWalkMinAfter > 0 ? (
                  <View style={[styles.transferWalkPill, isCompact && styles.transferWalkPillCompact]}>
                    <Footprints size={8} color={scheme.onSurfaceVariant} strokeWidth={2.2} />
                    <Text style={styles.transferWalkText}>{item.transferWalkMinAfter}m</Text>
                  </View>
                ) : (
                  <View style={styles.transferDirectPill}>
                    <ArrowRight size={9} color={scheme.onSurfaceVariant} strokeWidth={2.4} />
                  </View>
                )}
              </View>
            ) : null}
          </Fragment>
        );
      })}

      {data.finalWalkMin > 0 ? (
        <View style={styles.stripEdgeWalk}>
          <View style={styles.stripEdgeConnectorLine} />
          <View style={styles.walkPill}>
            <Footprints size={9} color={scheme.onSurfaceVariant} strokeWidth={2.2} />
            <Text style={styles.walkPillText}>{data.finalWalkMin}m</Text>
          </View>
        </View>
      ) : null}
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
  /** historyczne (przeszłe) połączenie - przygaszony wygląd */
  dimmed?: boolean;
  /** Zmienia się co interwał, żeby odliczanie „za X min” nie zamarzło pod memo. */
  tick?: number;
}) {
  const walkMps = useWalkSpeedMps();
  const now = useMemo(() => nowSec(), [tick]);
  const boarding = useMemo(() => item.legs.filter((l) => l.mode !== 'walk'), [item.legs]);
  const walkOnly = boarding.length === 0;
  const stripData = useMemo(() => buildJourneyStripData(item.legs, walkMps), [item.legs, walkMps]);
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
      ) : stripData.transitLegs.length > 0 ? (
        <JourneyStrip data={stripData} />
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
    width: '100%',
  },
  stripCell: {
    flex: 1,
    height: STRIP_H,
    minWidth: 40,
    alignItems: 'center',
    justifyContent: 'flex-start',
  },
  stripLine: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: 3,
    top: Math.round(BADGE_H / 2 - 1.5),
  },
  stripBadge: {
    alignItems: 'center',
    height: STRIP_H,
    zIndex: 1,
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
  stripConnector: {
    width: 36,
    height: BADGE_H,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stripConnectorCompact: {
    width: 30,
  },
  stripConnectorLine: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: 2,
    top: Math.round(BADGE_H / 2 - 1),
    backgroundColor: scheme.outlineVariant,
  },
  transferWalkPill: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
    height: 18,
    backgroundColor: scheme.surfaceContainerHighest,
    paddingHorizontal: 5,
    borderRadius: shape.full,
    borderWidth: 1,
    borderColor: scheme.outlineVariant,
    zIndex: 1,
  },
  transferWalkPillCompact: {
    paddingHorizontal: 4,
    gap: 1,
  },
  transferWalkText: {
    fontSize: 9,
    lineHeight: 11,
    color: scheme.onSurfaceVariant,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  transferDirectPill: {
    alignItems: 'center',
    justifyContent: 'center',
    width: 18,
    height: 18,
    borderRadius: shape.full,
    backgroundColor: scheme.surfaceContainerHighest,
    borderWidth: 1,
    borderColor: scheme.outlineVariant,
    zIndex: 1,
  },
  stripEdgeWalk: {
    flexDirection: 'row',
    alignItems: 'center',
    height: BADGE_H,
  },
  stripEdgeConnectorLine: {
    width: 8,
    height: 2,
    backgroundColor: scheme.outlineVariant,
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
    height: 18,
    backgroundColor: scheme.outlineVariant,
    paddingHorizontal: 8,
    borderRadius: shape.full,
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
