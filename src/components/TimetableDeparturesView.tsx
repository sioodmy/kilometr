import { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Clock3, Flag } from './icons';
import { useStrings } from '../i18n';
import {
  findNextDeparture,
  getUpcomingDepartures,
  groupDeparturesByHour,
  timetableClock,
  type LineStop,
} from '../services/lineTimetable';
import { elev, scheme, shape, type } from '../theme/tokens';

export interface TimetableDeparturesViewProps {
  stop: LineStop;
  terminal: boolean;
  isToday: boolean;
  nowSec: number;
  railStroke: string;
  plannedDepartSec?: number | null;
}

/** Wspólny widok najbliższych odjazdów i siatki godzinowej dla arkusza oraz ekranu pełnego. */
export function TimetableDeparturesView({
  stop,
  terminal,
  isToday,
  nowSec,
  railStroke,
  plannedDepartSec,
}: TimetableDeparturesViewProps) {
  const s = useStrings();
  const t = s.lineTimetable;

  const hours = useMemo(() => groupDeparturesByHour(stop.departures), [stop.departures]);
  const nextDep = useMemo(
    () => findNextDeparture(stop.departures, nowSec, isToday),
    [stop.departures, nowSec, isToday],
  );
  const upcoming = useMemo(
    () => getUpcomingDepartures(stop.departures, nowSec, isToday, 3),
    [stop.departures, nowSec, isToday],
  );
  const nextHour = nextDep ? Math.floor(nextDep.seconds / 3600) : null;
  const plannedMatchSec = useMemo(() => {
    if (plannedDepartSec == null) return null;
    for (const sec of stop.departures) {
      if (Math.abs((sec % 86400) - (plannedDepartSec % 86400)) < 60) {
        return sec;
      }
    }
    return null;
  }, [stop.departures, plannedDepartSec]);

  if (terminal) {
    return (
      <View style={styles.terminalCard} accessibilityLiveRegion="polite">
        <View style={styles.terminalIconCircle}>
          <Flag size={24} color={scheme.onSecondaryContainer} />
        </View>
        <Text style={styles.terminalTitle}>{t.terminal}</Text>
        <Text style={styles.terminalHint}>{t.terminalHint}</Text>
      </View>
    );
  }

  return (
    <View style={styles.root}>
      {isToday && (
        <View style={styles.spotlightCard}>
          <View style={styles.spotlightHeader}>
            <Clock3 size={16} color={scheme.primary} />
            <Text style={styles.spotlightTitle}>{t.nextDepartures}</Text>
          </View>
          {upcoming.length > 0 ? (
            <View style={styles.upcomingRow}>
              {upcoming.map((sec, idx) => {
                const isFirst = idx === 0;
                const mins = Math.max(0, Math.round((sec - nowSec) / 60));
                const etaLabel = mins <= 0 ? s.common.departNow : s.common.departIn(mins);
                const dayOff = Math.floor(sec / 86400);
                return (
                  <View
                    key={sec}
                    style={[styles.upcomingChip, isFirst && styles.upcomingChipPrimary]}
                  >
                    <Text
                      style={[styles.upcomingTime, isFirst && styles.upcomingTimePrimary]}
                    >
                      {timetableClock(sec)}
                    </Text>
                    <Text
                      style={[styles.upcomingEta, isFirst && styles.upcomingEtaPrimary]}
                    >
                      {dayOff > 0 ? t.dayOffset(dayOff) : etaLabel}
                    </Text>
                  </View>
                );
              })}
            </View>
          ) : (
            <Text style={styles.noMoreText}>{t.noMoreToday}</Text>
          )}
        </View>
      )}

      <View style={styles.scheduleCard}>
        <View style={styles.scheduleHeader}>
          <View style={styles.scheduleTitleCol}>
            <Text style={styles.scheduleTitle} accessibilityRole="header">
              {t.fullSchedule}
            </Text>
            <Text style={styles.scheduleSubtitle}>{t.scheduled}</Text>
          </View>
          <View style={styles.countPill}>
            <Text style={styles.countPillText}>
              {t.departuresCount(stop.departures.length)}
            </Text>
          </View>
        </View>

        {plannedMatchSec != null && (
          <View style={styles.legendRow}>
            <View style={styles.plannedLegendPill}>
              <Text style={styles.plannedLegendText}>
                {t.plannedDeparture}: {timetableClock(plannedMatchSec)}
              </Text>
            </View>
          </View>
        )}

        <View style={styles.hoursList}>
          {hours.map((group, idx) => {
            const isNextHourRow = nextHour === group.hour;
            const rowA11y = group.minutes
              .map((entry) => {
                const time = timetableClock(entry.seconds);
                return group.dayOffset > 0 ? t.nextDayTime(time, group.dayOffset) : time;
              })
              .join(', ');
            return (
              <View
                key={group.hour}
                style={[styles.hourRow, idx > 0 && styles.hourRowDivider]}
                accessible
                accessibilityLabel={rowA11y}
              >
                <View style={styles.hourCol}>
                  <View style={styles.hourBadgeRow}>
                    <View
                      style={[
                        styles.hourAccentBar,
                        { backgroundColor: isNextHourRow ? scheme.primary : railStroke },
                        !isNextHourRow && styles.hourAccentBarMuted,
                      ]}
                    />
                    <Text style={[styles.hourText, isNextHourRow && styles.hourTextActive]}>
                      {String(group.displayHour).padStart(2, '0')}
                    </Text>
                  </View>
                  {group.dayOffset > 0 && (
                    <View style={styles.dayOffsetPill}>
                      <Text style={styles.dayOffsetText}>{t.dayOffset(group.dayOffset)}</Text>
                    </View>
                  )}
                </View>

                <View style={styles.minutesWrap}>
                  {group.minutes.map((entry) => {
                    const isNext = nextDep != null && entry.seconds === nextDep.seconds;
                    const isPlanned =
                      plannedMatchSec != null && entry.seconds === plannedMatchSec;
                    const isPast = isToday && entry.seconds < nowSec - 30;
                    return (
                      <View
                        key={entry.minute}
                        style={[
                          styles.minutePill,
                          isPast && styles.minutePillPast,
                          isPlanned && styles.minutePillPlanned,
                          isNext && styles.minutePillNext,
                        ]}
                      >
                        <Text
                          style={[
                            styles.minuteText,
                            isPast && styles.minuteTextPast,
                            isPlanned && styles.minuteTextPlanned,
                            isNext && styles.minuteTextNext,
                          ]}
                        >
                          {entry.minute}
                        </Text>
                      </View>
                    );
                  })}
                </View>
              </View>
            );
          })}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    gap: 14,
  },
  terminalCard: {
    backgroundColor: scheme.surfaceContainer,
    borderRadius: shape.extraLarge,
    borderWidth: 2,
    borderColor: scheme.outlineVariant,
    paddingHorizontal: 24,
    paddingVertical: 32,
    alignItems: 'center',
    gap: 10,
    ...elev.level1,
  },
  terminalIconCircle: {
    width: 52,
    height: 52,
    borderRadius: shape.full,
    backgroundColor: scheme.secondaryContainer,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  terminalTitle: {
    ...type.titleMedium,
    fontWeight: '800',
    color: scheme.onSurface,
    textAlign: 'center',
  },
  terminalHint: {
    ...type.bodyMedium,
    color: scheme.onSurfaceVariant,
    textAlign: 'center',
    maxWidth: 280,
  },
  spotlightCard: {
    backgroundColor: scheme.surfaceContainer,
    borderRadius: shape.extraLarge,
    borderWidth: 2,
    borderColor: scheme.outlineVariant,
    padding: 16,
    gap: 12,
    ...elev.level1,
  },
  spotlightHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
  },
  spotlightTitle: {
    ...type.labelLarge,
    fontWeight: '700',
    color: scheme.onSurface,
  },
  upcomingRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  upcomingChip: {
    minWidth: 92,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: shape.large,
    backgroundColor: scheme.surfaceContainerHigh,
    gap: 2,
  },
  upcomingChipPrimary: {
    backgroundColor: scheme.primaryContainer,
  },
  upcomingTime: {
    fontSize: 18,
    lineHeight: 22,
    fontWeight: '800',
    letterSpacing: -0.3,
    color: scheme.onSurface,
    fontVariant: ['tabular-nums'],
  },
  upcomingTimePrimary: {
    color: scheme.onPrimaryContainer,
  },
  upcomingEta: {
    ...type.labelSmall,
    fontWeight: '600',
    color: scheme.onSurfaceVariant,
    fontVariant: ['tabular-nums'],
  },
  upcomingEtaPrimary: {
    color: scheme.onPrimaryContainer,
  },
  noMoreText: {
    ...type.bodyMedium,
    color: scheme.onSurfaceVariant,
  },
  scheduleCard: {
    backgroundColor: scheme.surfaceContainer,
    borderRadius: shape.extraLarge,
    borderWidth: 2,
    borderColor: scheme.outlineVariant,
    padding: 16,
    gap: 12,
    ...elev.level1,
  },
  scheduleHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 10,
  },
  scheduleTitleCol: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  scheduleTitle: {
    ...type.titleSmall,
    fontSize: 15,
    fontWeight: '800',
    color: scheme.onSurface,
  },
  scheduleSubtitle: {
    ...type.bodySmall,
    color: scheme.onSurfaceVariant,
  },
  countPill: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: shape.full,
    backgroundColor: scheme.secondaryContainer,
  },
  countPillText: {
    ...type.labelSmall,
    fontWeight: '700',
    color: scheme.onSecondaryContainer,
    fontVariant: ['tabular-nums'],
  },
  legendRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  plannedLegendPill: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: shape.full,
    backgroundColor: scheme.tertiaryContainer,
  },
  plannedLegendText: {
    ...type.labelSmall,
    fontWeight: '700',
    color: scheme.onTertiaryContainer,
    fontVariant: ['tabular-nums'],
  },
  hoursList: {
    gap: 0,
  },
  hourRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    paddingVertical: 11,
  },
  hourRowDivider: {
    borderTopWidth: 2,
    borderTopColor: scheme.outlineVariant,
  },
  hourCol: {
    width: 54,
    flexShrink: 0,
    gap: 4,
    paddingTop: 2,
  },
  hourBadgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  hourAccentBar: {
    width: 3,
    height: 18,
    borderRadius: shape.full,
  },
  hourAccentBarMuted: {
    opacity: 0.45,
  },
  hourText: {
    fontSize: 20,
    lineHeight: 24,
    fontWeight: '800',
    letterSpacing: -0.4,
    color: scheme.onSurface,
    fontVariant: ['tabular-nums'],
    includeFontPadding: false,
  },
  hourTextActive: {
    color: scheme.primary,
  },
  dayOffsetPill: {
    alignSelf: 'flex-start',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: shape.extraSmall,
    backgroundColor: scheme.surfaceContainerHigh,
  },
  dayOffsetText: {
    fontSize: 10,
    lineHeight: 13,
    fontWeight: '700',
    color: scheme.onSurfaceVariant,
  },
  minutesWrap: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  minutePill: {
    minWidth: 38,
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: shape.small,
    backgroundColor: scheme.surfaceContainerHigh,
    alignItems: 'center',
    justifyContent: 'center',
  },
  minutePillPast: {
    backgroundColor: scheme.surfaceContainerLow,
  },
  minutePillPlanned: {
    backgroundColor: scheme.tertiaryContainer,
    borderWidth: 2,
    borderColor: scheme.tertiary,
  },
  minutePillNext: {
    backgroundColor: scheme.primaryContainer,
  },
  minuteText: {
    fontSize: 14,
    lineHeight: 18,
    fontWeight: '700',
    color: scheme.onSurface,
    fontVariant: ['tabular-nums'],
    includeFontPadding: false,
  },
  minuteTextPast: {
    fontWeight: '500',
    color: scheme.onSurfaceVariant,
  },
  minuteTextPlanned: {
    fontWeight: '800',
    color: scheme.onTertiaryContainer,
  },
  minuteTextNext: {
    fontWeight: '800',
    color: scheme.onPrimaryContainer,
  },
});
