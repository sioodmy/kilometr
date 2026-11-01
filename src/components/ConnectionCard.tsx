import { memo, useCallback, useMemo, useState } from 'react';
import * as Haptics from 'expo-haptics';
import { Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { ArrowDown, ArrowRight, ChevronRight, Clock3, Footprints } from './icons';
import { scheme, shape, type } from '../theme/tokens';
import type { Connection, Leg } from '../types/models';
import { LineBadge } from './LineBadge';
import { DirectionsWalk } from './DirectionsWalk';
import { ConnectionPeekTarget, type ConnectionPeekHandlers } from './ConnectionPeek';
import { formatWalkTime, useWalkSpeedMps, walkMinutesFor } from '../services/settings';

import { tr, useStrings } from '../i18n';
import { boardingDepartureMs, boardingDepartureSec, scheduledLegTimes } from '../services/routing/connectionTimes';
import { reliabilityNotice } from './reliabilityNotice';
import { secondsToTimeString } from '../gtfs/geo';

export interface CardLayoutInfo {
  y: number;
  height: number;
}

/** Poprawna odmiana liczby przesiadek (słownik i18n: 1 / 2-4 / 5+). */
export function transfersLabel(n: number): string {
  return tr().connection.transfers(n);
}

/** Poprawna odmiana liczby połączeń (słownik i18n: 1 / 2-4 / 5+). */
export function connectionsLabel(n: number): string {
  return tr().connection.connections(n);
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
    initialWalkMin =
      walkM > 0 ? walkMinutesFor(walkM, walkMps) : getLegWalkMin(initialWalks[0], walkMps);
  }

  let finalWalkMin = 0;
  const lastTransitIdx = transitIndices[transitIndices.length - 1];
  if (lastTransitIdx < legs.length - 1) {
    const finalWalks = legs.slice(lastTransitIdx + 1);
    const walkM = finalWalks.reduce((acc, l) => acc + (l.walkM ?? 0), 0);
    finalWalkMin =
      walkM > 0 ? walkMinutesFor(walkM, walkMps) : getLegWalkMin(finalWalks[0], walkMps);
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

function JourneyStrip({ data, muted }: { data: JourneyStripData; muted: boolean }) {
  const s = useStrings();
  const { width } = useWindowDimensions();
  if (data.transitLegs.length === 0) return null;

  const steps: ({ key: string; leg: Leg } | { key: string; walkMin: number })[] = [];
  if (data.initialWalkMin > 0) {
    steps.push({ key: 'initial-walk', walkMin: data.initialWalkMin });
  }
  for (const item of data.transitLegs) {
    steps.push({ key: item.key, leg: item.leg });
    if (item.transferWalkMinAfter > 0) {
      steps.push({ key: `${item.key}-walk`, walkMin: item.transferWalkMinAfter });
    }
  }
  if (data.finalWalkMin > 0) {
    steps.push({ key: 'final-walk', walkMin: data.finalWalkMin });
  }

  return (
    <ScrollView
      horizontal
      style={styles.strip}
      contentContainerStyle={styles.stripContent}
      showsHorizontalScrollIndicator={false}
      nestedScrollEnabled
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      {steps.map((step, i) => {
        const leg = 'leg' in step ? step.leg : undefined;
        return (
          <View key={step.key} style={styles.stripCell}>
            {i > 0 && <ChevronRight size={12} color={scheme.onSurfaceVariant} />}
            {leg ? (
              <LineBadge mode={leg.mode} line={leg.line} maxWidth={width - 96} muted={muted} />
            ) : (
              <View style={styles.walkStep}>
                <DirectionsWalk size={15} color={scheme.onSurfaceVariant} />
                <Text style={styles.walkMinutes}>
                  {'walkMin' in step ? s.common.durMin(step.walkMin) : ''}
                </Text>
              </View>
            )}
          </View>
        );
      })}
    </ScrollView>
  );
}

export const ConnectionCard = memo(function ConnectionCard({
  item,
  onPress,
  dimmed = false,
  tick = 0,
  peek,
}: {
  item: Connection;
  onPress: (item: Connection, sourceLayout?: CardLayoutInfo) => void;
  /** historyczne (przyszłe) połączenie - przygaszony wygląd */
  dimmed?: boolean;
  /** Zmienia się co interwał, żeby odliczanie „za X min” nie zamarzło pod memo. */
  tick?: number;
  peek?: ConnectionPeekHandlers;
}) {
  const s = useStrings();
  const { width, fontScale } = useWindowDimensions();
  const [focused, setFocused] = useState(false);
  const verticalTimes = (width - 60) / fontScale < 140;
  const Direction = verticalTimes ? ArrowDown : ArrowRight;
  const walkMps = useWalkSpeedMps();
  const now = useMemo(() => new Date(), [tick]);
  const boarding = useMemo(() => item.legs.filter((l) => l.mode !== 'walk'), [item.legs]);
  const walkOnly = boarding.length === 0;
  const stripData = useMemo(() => buildJourneyStripData(item.legs, walkMps), [item.legs, walkMps]);
  const transfers = useMemo(() => interchangeStops(item.interchange), [item.interchange]);

  const departureMs = boardingDepartureMs(item, now);
  const departAt = walkOnly ? item.departAt : secondsToTimeString(boardingDepartureSec(item));
  const firstVehicle = boarding[0];
  const notice = reliabilityNotice(boarding, s);
  const scheduledDeparture = firstVehicle?.live && Math.round((firstVehicle.delaySec ?? 0) / 60) === item.delayMin
    ? scheduledLegTimes(firstVehicle, boardingDepartureSec(item)).departure : undefined;
  const minsAgo = item.departureSec > 0 ? Math.floor((now.getTime() - departureMs) / 60000) : -1;
  const historical = minsAgo >= 1;

  const effectiveMin =
    item.departureSec > 0 ? Math.max(0, Math.ceil((departureMs - now.getTime()) / 60000)) : item.departInMin;

  const walkM = walkOnly ? item.legs[0]?.walkM : undefined;
  const walkMin = item.durationMin || (walkM != null ? walkMinutesFor(walkM, walkMps) : 1);

  const departureText = historical
    ? minsAgo <= 1
      ? tr().common.departJustAgo
      : tr().common.departAgo(minsAgo)
    : walkOnly && walkM != null
      ? formatWalkTime(walkMin)
      : effectiveMin <= 0
        ? tr().common.departNow
        : effectiveMin > 59
          ? departAt
          : tr().common.departIn(effectiveMin);
  const departureColor =
    dimmed || historical
      ? scheme.onSurfaceVariant
      : item.live && item.delayMin > 0
        ? scheme.error
        : scheme.primary;

  const linesSummary = boarding
    .map((b) => b.line)
    .filter(Boolean)
    .join(', ');
  const transferText = [
    walkOnly ? s.connection.walkLeg : transfersLabel(item.transfers),
    ...transfers,
  ].join(' • ');
  const accessibilityDesc = tr().connection.cardA11y(
    departureText,
    item.durationMin,
    departAt,
    item.arriveAt,
    walkOnly ? tr().connection.walkRoute : transferText,
    linesSummary,
  );

  const handlePress = useCallback(() => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    onPress(item);
  }, [item, onPress]);

  return (
    <ConnectionPeekTarget item={item} handlers={peek}>
      <Pressable
        collapsable={false}
        onPress={handlePress}
        accessibilityRole="button"
        accessibilityLabel={[accessibilityDesc, notice].filter(Boolean).join('. ')}
        accessibilityHint={peek ? s.connection.previewHint : undefined}
        accessibilityActions={
          peek
            ? [{ name: 'activate' }, { name: 'longpress', label: s.connection.previewTitle }]
            : undefined
        }
        onAccessibilityTap={handlePress}
        onAccessibilityAction={(event) => {
          if (event.nativeEvent.actionName === 'longpress') peek?.show(item, true);
          if (event.nativeEvent.actionName === 'activate') handlePress();
        }}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        style={({ pressed }) => [
          styles.card,
          dimmed && styles.pastCard,
          focused && styles.focused,
          pressed && styles.pressed,
        ]}
      >
        <View style={styles.schedule}>
          <Text style={[styles.departure, { color: departureColor }]}>
            {walkOnly ? s.connection.walkRoute : departureText}
          </Text>
          <View style={[styles.duration, dimmed && styles.mutedDuration]}>
            <Clock3
              size={14}
              color={dimmed ? scheme.onSurfaceVariant : scheme.onSecondaryContainer}
            />
            <Text style={[styles.durationText, dimmed && styles.mutedText]}>
              {s.common.durMin(item.durationMin)}
            </Text>
          </View>
        </View>

        <View style={[styles.journeyMeta, fontScale > 1.3 && styles.journeyMetaStacked]}>
          <View style={[styles.timeRange, verticalTimes && styles.timeRangeStacked]}>
            <Text style={styles.hours}>{departAt}</Text>
            <Direction size={14} color={scheme.onSurfaceVariant} />
            <Text style={[styles.hours, styles.arrival]}>{item.arriveAt}</Text>
          </View>
          <Text style={styles.metaText} numberOfLines={fontScale > 1.3 ? undefined : 1}>
            {transferText}
          </Text>
        </View>

        {walkOnly ? (
          <View style={styles.walkOnlyWrap}>
            <Footprints size={18} color={scheme.onSurfaceVariant} />
            <Text style={styles.walkLabel}>{s.connection.walkAll}</Text>
          </View>
        ) : stripData.transitLegs.length > 0 ? (
          <JourneyStrip data={stripData} muted={dimmed} />
        ) : null}

        {!notice && item.live && item.delayMin !== 0 && (
          <Text
            style={[
              styles.delay,
              { color: dimmed ? scheme.onSurfaceVariant : item.delayMin > 0 ? scheme.error : scheme.warning },
            ]}
          >
            {scheduledDeparture != null && `${s.routeDetails.scheduledTime(secondsToTimeString(scheduledDeparture))} • `}
            {item.delayMin > 0
              ? s.routeDetails.late(item.delayMin)
              : s.routeDetails.early(-item.delayMin)}
          </Text>
        )}
        {notice && <Text style={[styles.delay, { color: scheme.onSurfaceVariant }]}>{notice}</Text>}
      </Pressable>
    </ConnectionPeekTarget>
  );
});

const styles = StyleSheet.create({
  card: {
    backgroundColor: scheme.surfaceContainer,
    borderRadius: shape.extraLarge,
    borderWidth: 2,
    borderColor: 'transparent',
    padding: 12,
    gap: 10,
  },
  pastCard: { backgroundColor: scheme.surfaceContainerLow },
  mutedDuration: { backgroundColor: scheme.surfaceContainerHighest },
  mutedText: { color: scheme.onSurfaceVariant },
  schedule: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'space-between',
    columnGap: 10,
    rowGap: 4,
  },
  departure: {
    fontSize: 22,
    lineHeight: 28,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
    includeFontPadding: false,
    maxWidth: '100%',
  },
  metaText: { ...type.bodySmall, color: scheme.onSurfaceVariant, flexShrink: 1, minWidth: 0 },
  duration: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingVertical: 6,
    paddingHorizontal: 8,
    borderRadius: shape.medium,
    backgroundColor: scheme.secondaryContainer,
    maxWidth: '100%',
  },
  durationText: {
    ...type.labelLarge,
    fontWeight: '700',
    color: scheme.onSecondaryContainer,
  },
  journeyMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  journeyMetaStacked: {
    flexDirection: 'column',
    alignItems: 'flex-start',
  },
  timeRange: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  timeRangeStacked: {
    flexDirection: 'column',
    alignItems: 'flex-start',
    gap: 2,
  },
  hours: {
    ...type.titleSmall,
    fontVariant: ['tabular-nums'],
    color: scheme.onSurface,
  },
  arrival: {
    color: scheme.onSurfaceVariant,
  },
  walkOnlyWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 4,
  },
  walkLabel: {
    ...type.bodyMedium,
    color: scheme.onSurfaceVariant,
  },
  strip: {
    marginTop: 2,
  },
  stripContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  stripCell: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  walkStep: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 6,
    paddingVertical: 4,
    borderRadius: shape.small,
    backgroundColor: scheme.surfaceContainerHigh,
  },
  walkMinutes: {
    ...type.labelSmall,
    color: scheme.onSurfaceVariant,
    fontVariant: ['tabular-nums'],
  },
  delay: {
    ...type.labelSmall,
    fontWeight: '700',
  },
  pressed: {
    opacity: 0.9,
    transform: [{ scale: 0.985 }],
  },
  focused: {
    borderColor: scheme.primary,
  },
});
