import { StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { ArrowRight, Clock3, M3SolidArrowDown, M3SolidArrowRight } from './icons';
import { useStrings, getLocaleSync } from '../i18n';
import { elev, scheme, shape, type } from '../theme/tokens';
import { formatShareTime, transferCount, type SharedConnection } from '../sharing/connection';
import { LineBadge, resolveLegBadgeColors } from './LineBadge';

export function JourneyShareCard({ journey }: { journey: SharedConnection }) {
  const { share: s, city } = useStrings();
  const { width, fontScale } = useWindowDimensions();
  const stacked = width / fontScale < 330;
  const date = new Intl.DateTimeFormat(getLocaleSync(), {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  }).format(new Date(`${journey.date}T12:00:00Z`));
  const arrivalDay = Math.floor(journey.arrival / 1440);
  const totalMin = Math.max(1, journey.arrival - journey.departure);
  const allWalk = journey.legs.every((leg) => leg.mode === 'walk');
  const transfersLabel = allWalk ? s.walk : s.transfers(transferCount(journey));

  return (
    <View style={styles.card}>
      <View style={styles.topBand}>
        <View style={styles.brandRow}>
          <View style={styles.brandDot} />
          <Text style={styles.brand}>{s.brand}</Text>
        </View>
        <Text style={styles.date} numberOfLines={1}>
          {city.name(journey.city)} {'\u00b7'} {date}
        </Text>
      </View>

      <View style={styles.body}>
        <View style={styles.kpiRow}>
          <View style={styles.transfersPill}>
            <Text style={styles.transfersText}>{transfersLabel}</Text>
          </View>
          <View style={styles.durationPill}>
            <Clock3 size={13} color={scheme.onSecondaryContainer} />
            <Text style={styles.durationText}>{s.duration(totalMin)}</Text>
          </View>
        </View>

        {stacked ? (
          <View style={styles.stackedWrap}>
            <View style={styles.stackedEndpoint}>
              <Text style={styles.tag}>{s.departure}</Text>
              <Text style={styles.time}>{formatShareTime(journey.departure)}</Text>
              <Text style={styles.place} numberOfLines={2}>
                {journey.from}
              </Text>
            </View>
            <M3SolidArrowDown size={18} color={scheme.primary} />
            <View style={styles.stackedEndpoint}>
              <Text style={[styles.tag, styles.tagAccent]}>{s.arrival}</Text>
              <View style={styles.arrivalInline}>
                <Text style={[styles.time, styles.timeAccent]}>
                  {formatShareTime(journey.arrival)}
                </Text>
                {arrivalDay > 0 && <Text style={styles.day}>{s.dayLater(arrivalDay)}</Text>}
              </View>
              <Text style={styles.place} numberOfLines={2}>
                {journey.to}
              </Text>
            </View>
          </View>
        ) : (
          <View style={styles.routeBlock}>
            <View style={styles.timesRow}>
              <View style={styles.colLeft}>
                <Text style={styles.tag}>{s.departure}</Text>
                <Text style={styles.time}>{formatShareTime(journey.departure)}</Text>
              </View>

              <View style={styles.arrowCol}>
                <M3SolidArrowRight size={22} width={36} color={scheme.primary} />
              </View>

              <View style={styles.colRight}>
                <Text style={[styles.tag, styles.tagAccent, styles.textRight]}>{s.arrival}</Text>
                <View style={styles.arrivalInline}>
                  {arrivalDay > 0 && <Text style={styles.day}>{s.dayLater(arrivalDay)}</Text>}
                  <Text style={[styles.time, styles.timeAccent, styles.textRight]}>
                    {formatShareTime(journey.arrival)}
                  </Text>
                </View>
              </View>
            </View>

            <View style={styles.placesRow}>
              <Text style={styles.placeLeft} numberOfLines={2}>
                {journey.from}
              </Text>
              <Text style={styles.placeRight} numberOfLines={2}>
                {journey.to}
              </Text>
            </View>
          </View>
        )}

        <View style={styles.stripSurface}>
          <View style={styles.lines}>
            {journey.legs.map((leg, index) => (
              <View key={index} style={styles.lineStep}>
                {index > 0 && <ArrowRight size={12} color={scheme.onSurfaceVariant} />}
                <LineBadge mode={leg.mode} line={leg.line} compact />
              </View>
            ))}
          </View>

          <View style={styles.barRow}>
            {journey.legs.map((leg, index) => {
              const segMin = Math.max(1, leg.arrival - leg.departure);
              const isWalk = leg.mode === 'walk';
              const bg = isWalk
                ? scheme.outlineVariant
                : resolveLegBadgeColors({
                    mode: leg.mode,
                    line: leg.line,
                    compact: true,
                    cityId: journey.city,
                  }).bg;
              return (
                <View
                  key={index}
                  style={[
                    styles.barSegment,
                    { flex: segMin, backgroundColor: bg },
                    isWalk && styles.barSegmentWalk,
                  ]}
                />
              );
            })}
          </View>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: shape.extraLarge,
    overflow: 'hidden',
    backgroundColor: scheme.surfaceContainer,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: scheme.outlineVariant,
    ...elev.level1,
  },
  topBand: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    paddingHorizontal: 18,
    paddingVertical: 12,
    backgroundColor: scheme.surfaceContainerHigh,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: scheme.outlineVariant,
  },
  brandRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
  },
  brandDot: {
    width: 9,
    height: 9,
    borderRadius: shape.full,
    backgroundColor: scheme.primary,
  },
  brand: {
    ...type.titleSmall,
    fontWeight: '800',
    color: scheme.onSurface,
    letterSpacing: -0.2,
  },
  date: {
    ...type.bodySmall,
    color: scheme.onSurfaceVariant,
    fontWeight: '600',
    flexShrink: 1,
  },
  body: {
    padding: 18,
    gap: 14,
  },
  kpiRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  transfersPill: {
    backgroundColor: scheme.surfaceContainerLow,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: scheme.outlineVariant,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: shape.full,
  },
  transfersText: {
    ...type.labelMedium,
    fontWeight: '600',
    color: scheme.onSurfaceVariant,
  },
  durationPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: scheme.secondaryContainer,
    paddingHorizontal: 11,
    paddingVertical: 5,
    borderRadius: shape.full,
  },
  durationText: {
    ...type.labelMedium,
    fontWeight: '800',
    color: scheme.onSecondaryContainer,
    fontVariant: ['tabular-nums'],
  },
  routeBlock: {
    gap: 8,
  },
  timesRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 10,
  },
  colLeft: {
    alignItems: 'flex-start',
    gap: 2,
  },
  colRight: {
    alignItems: 'flex-end',
    gap: 2,
  },
  arrowCol: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingBottom: 6,
  },
  tag: {
    fontSize: 11,
    lineHeight: 14,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    color: scheme.onSurfaceVariant,
  },
  tagAccent: {
    color: scheme.primary,
  },
  textRight: {
    textAlign: 'right',
  },
  time: {
    fontSize: 34,
    lineHeight: 38,
    fontWeight: '800',
    letterSpacing: -1.1,
    color: scheme.onSurface,
    fontVariant: ['tabular-nums'],
    includeFontPadding: false,
  },
  timeAccent: {
    color: scheme.primary,
  },
  arrivalInline: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 5,
  },
  day: {
    ...type.labelMedium,
    fontWeight: '800',
    color: scheme.primary,
  },
  placesRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 14,
  },
  placeLeft: {
    flex: 1,
    ...type.bodyMedium,
    fontWeight: '700',
    color: scheme.onSurface,
    lineHeight: 19,
  },
  placeRight: {
    flex: 1,
    ...type.bodyMedium,
    fontWeight: '700',
    color: scheme.onSurface,
    lineHeight: 19,
    textAlign: 'right',
  },
  stackedWrap: {
    gap: 10,
  },
  stackedEndpoint: {
    gap: 3,
  },
  place: {
    ...type.bodyMedium,
    fontWeight: '700',
    color: scheme.onSurface,
    lineHeight: 19,
  },
  stripSurface: {
    backgroundColor: scheme.surfaceContainerLow,
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: scheme.outlineVariant,
    padding: 10,
    gap: 8,
  },
  lines: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 6,
  },
  lineStep: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  barRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    height: 6,
  },
  barSegment: {
    height: 6,
    borderRadius: shape.full,
    minWidth: 10,
  },
  barSegmentWalk: {
    opacity: 0.65,
  },
});
