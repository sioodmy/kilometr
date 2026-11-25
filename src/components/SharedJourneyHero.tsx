import { useMemo } from 'react';
import { StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import {
  CircleCheck,
  Clock3,
  Footprints,
  M3SolidArrowDown,
  M3SolidArrowRight,
} from './icons';
import { analyzeConnection } from './connectionInsights';
import { JourneyStrip } from './ConnectionCard';
import { LineBadge } from './LineBadge';
import { LiveSensors } from './LiveDot';
import { RollingTime } from './RollingTime';
import { secondsToTimeString } from '../gtfs/geo';
import { useStrings } from '../i18n';
import { boardingDepartureSec, scheduledLegTimes } from '../services/routing/connectionTimes';
import type { TripProgress } from '../services/notifications/types';
import {
  useTransferThresholds,
  useWalkSpeedMps,
} from '../services/settings';
import type { SharedConnection } from '../sharing/connection';
import { elev, scheme, shape, type } from '../theme/tokens';
import type { Connection } from '../types/models';

export function SharedJourneyHero({
  journey,
  connection,
  progress,
  hasVehicle,
  pingKey,
  availableWidth,
}: {
  journey: SharedConnection;
  connection: Connection;
  progress: TripProgress | null;
  hasVehicle: boolean;
  pingKey: number | string;
  availableWidth?: number;
}) {
  const s = useStrings();
  const walkMps = useWalkSpeedMps();
  const thresholds = useTransferThresholds();
  const { width, fontScale } = useWindowDimensions();
  const stacked = ((availableWidth ?? width - 28) - 40) / fontScale < 280;

  const boarding = useMemo(
    () => connection.legs.filter((leg) => leg.mode !== 'walk'),
    [connection.legs],
  );
  const insights = useMemo(
    () => analyzeConnection(connection, walkMps, thresholds),
    [connection, walkMps, thresholds],
  );

  const firstVehicle = boarding[0];
  const lastVehicle = boarding[boarding.length - 1];
  const departureSec = boardingDepartureSec(connection);
  const departureDisplay = firstVehicle ? secondsToTimeString(departureSec) : connection.departAt;
  const scheduledDeparture = firstVehicle
    ? scheduledLegTimes(firstVehicle, departureSec).departure
    : undefined;
  const departureDelay = firstVehicle?.live ? Math.round((firstVehicle.delaySec ?? 0) / 60) : 0;
  const arrivalDelaySec = lastVehicle?.live
    ? (lastVehicle.arrivalDelaySec ?? lastVehicle.delaySec ?? 0)
    : 0;
  const arrivalDelay = Math.round(arrivalDelaySec / 60);
  const scheduledArrival =
    connection.arrivalSec != null ? connection.arrivalSec - arrivalDelaySec : undefined;

  const ended = progress?.phase === 'arrived';
  const started = !!progress && progress.departInSec <= 0 && !ended;
  const hasLive = hasVehicle || connection.live;
  const arrivalDay = Math.floor(journey.arrival / 1440);
  const displayDelay = arrivalDelay !== 0 ? arrivalDelay : connection.delayMin;

  const etaMin = progress ? Math.max(1, Math.round(progress.etaMin)) : 0;
  const departInMin = progress ? Math.round(progress.departInSec / 60) : 0;
  const showEta = started && !ended && etaMin >= 1;
  const showDepart = !started && !ended && departInMin >= 1 && departInMin <= 180;

  const transfersLabel =
    boarding.length === 0 ? s.connection.walkAll : s.share.transfers(connection.transfers);
  const totalWalkM = useMemo(
    () => connection.legs.reduce((sum, leg) => sum + (leg.mode === 'walk' ? (leg.walkM ?? 0) : 0), 0),
    [connection.legs],
  );

  const statusText = ended
    ? s.share.finished
    : showDepart
      ? s.share.departsInMin(departInMin)
      : hasVehicle
        ? s.share.vehicleLive
        : started
          ? s.share.inProgress
          : connection.live
            ? s.share.vehicleLive
            : s.share.planned;

  let stepText = '';
  if (started && !ended && progress) {
    if (progress.phase === 'riding') {
      const stopPart = progress.nextStop
        ? s.share.nextStopLabel(progress.nextStop)
        : progress.direction
          ? s.share.direction(progress.direction)
          : s.share.inProgress;
      const leftPart =
        progress.stopsLeft != null && progress.stopsLeft > 0
          ? ` \u00b7 ${s.share.stopsToGo(progress.stopsLeft)}`
          : '';
      stepText = `${stopPart}${leftPart}`;
    } else if (progress.phase === 'transfer') {
      stepText = s.share.transferAtStop(progress.interchange ?? progress.stopName);
    } else if (progress.phase === 'waiting') {
      stepText = s.share.waitingAtStop(progress.stopName);
    } else if (progress.phase === 'walking') {
      stepText = s.share.walkingToStop(progress.stopName);
    }
  }

  const showStepBadge =
    started &&
    !ended &&
    progress &&
    progress.phase !== 'walking' &&
    progress.leg &&
    progress.leg.mode !== 'walk';

  const statusPillVariant = ended
    ? 'ended'
    : started
      ? 'active'
      : showDepart || hasLive
        ? 'upcoming'
        : 'planned';

  const statusTextColor =
    statusPillVariant === 'active'
      ? scheme.onTertiaryContainer
      : statusPillVariant === 'upcoming'
        ? scheme.onPrimaryContainer
        : scheme.onSurfaceVariant;

  const progressPct = progress ? Math.max(4, Math.min(100, Math.round(progress.progress * 100))) : 0;

  return (
    <View style={styles.card}>
      {/* Górny pasek statusu podróży, opóźnienia i całkowitego czasu */}
      <View style={styles.topBar}>
        <View style={styles.topLeft}>
          <View
            style={[
              styles.statusPill,
              statusPillVariant === 'active' && styles.statusPillActive,
              statusPillVariant === 'upcoming' && styles.statusPillUpcoming,
              statusPillVariant === 'ended' && styles.statusPillEnded,
            ]}
          >
            {hasLive && !ended ? (
              <LiveSensors color={statusTextColor} size={13} pingKey={pingKey} />
            ) : ended ? (
              <CircleCheck size={14} color={statusTextColor} />
            ) : (
              <Clock3 size={13} color={statusTextColor} />
            )}
            <Text style={[styles.statusText, { color: statusTextColor }]} numberOfLines={1}>
              {statusText}
            </Text>
          </View>

          {displayDelay !== 0 && !ended && (
            <View
              style={[
                styles.delayPill,
                displayDelay > 0 ? styles.delayLate : styles.delayEarly,
              ]}
              accessibilityLiveRegion="polite"
            >
              <Text
                style={[
                  styles.delayPillText,
                  displayDelay > 0 ? styles.delayLateText : styles.delayEarlyText,
                ]}
                numberOfLines={1}
              >
                {s.share.liveDelay(displayDelay)}
              </Text>
            </View>
          )}
        </View>

        <View style={styles.durationPill}>
          <Clock3 size={14} color={scheme.onSecondaryContainer} />
          <Text style={styles.durationText}>{s.share.duration(connection.durationMin)}</Text>
        </View>
      </View>

      {/* Główna oś podróży: odjazd -> przyjazd */}
      {stacked ? (
        <View style={styles.stackedWrap}>
          <View style={styles.stackedEndpoint}>
            <View style={styles.stackedTagRow}>
              <View style={styles.startDot} />
              <Text style={styles.endpointTag} numberOfLines={1}>
                {s.share.departure}
              </Text>
            </View>
            <View style={styles.stackedTimeRow}>
              <RollingTime value={departureDisplay} style={styles.time} />
              {departureDelay !== 0 && scheduledDeparture != null && (
                <Text style={styles.scheduledStrike}>
                  {secondsToTimeString(scheduledDeparture)}
                </Text>
              )}
            </View>
            <Text style={styles.place} numberOfLines={fontScale > 1.3 ? undefined : 2}>
              {connection.fromTitle}
            </Text>
          </View>

          <View style={styles.stackedBridge}>
            <M3SolidArrowDown size={20} color={ended ? scheme.outline : scheme.primary} />
            <View style={styles.bridgePill}>
              <Text style={styles.bridgePillText} numberOfLines={1}>
                {transfersLabel}
              </Text>
            </View>
          </View>

          <View style={styles.stackedEndpoint}>
            <View style={styles.stackedTagRow}>
              <View style={[styles.endDot, ended && styles.endDotEnded]} />
              <Text style={[styles.endpointTag, !ended && styles.endpointTagPrimary]} numberOfLines={1}>
                {s.share.arrival}
              </Text>
            </View>
            <View style={styles.stackedTimeRow}>
              <RollingTime
                value={connection.arriveAt}
                style={[styles.time, !ended && styles.arrivalTimeAccent]}
              />
              {arrivalDay > 0 && (
                <Text style={styles.dayBadge}>{s.share.dayLater(arrivalDay)}</Text>
              )}
              {arrivalDelay !== 0 && scheduledArrival != null && (
                <Text style={styles.scheduledStrike}>
                  {secondsToTimeString(scheduledArrival)}
                </Text>
              )}
            </View>
            <Text style={styles.place} numberOfLines={fontScale > 1.3 ? undefined : 2}>
              {connection.toTitle}
            </Text>
          </View>
        </View>
      ) : (
        <View style={styles.heroBlock}>
          <View style={styles.timesRow}>
            <View style={styles.timeColLeft}>
              <Text style={styles.endpointTag} numberOfLines={1}>
                {s.share.departure}
              </Text>
              <View style={styles.timeInline}>
                <RollingTime value={departureDisplay} style={styles.time} />
              </View>
              {departureDelay !== 0 && scheduledDeparture != null && (
                <Text style={styles.scheduledStrike}>
                  {s.share.scheduledTime(secondsToTimeString(scheduledDeparture))}
                </Text>
              )}
            </View>

            <View style={styles.bridgeCol}>
              <M3SolidArrowRight
                size={24}
                width={38}
                color={ended ? scheme.outline : scheme.primary}
              />
              <View style={styles.bridgePill}>
                <Text style={styles.bridgePillText} numberOfLines={1}>
                  {transfersLabel}
                </Text>
              </View>
            </View>

            <View style={styles.timeColRight}>
              <Text
                style={[styles.endpointTag, styles.textRight, !ended && styles.endpointTagPrimary]}
                numberOfLines={1}
              >
                {s.share.arrival}
              </Text>
              <View style={[styles.timeInline, styles.timeInlineRight]}>
                {arrivalDay > 0 && (
                  <Text style={styles.dayBadge}>{s.share.dayLater(arrivalDay)}</Text>
                )}
                <RollingTime
                  value={connection.arriveAt}
                  style={[styles.time, styles.textRight, !ended && styles.arrivalTimeAccent]}
                />
              </View>
              {arrivalDelay !== 0 && scheduledArrival != null && (
                <Text style={[styles.scheduledStrike, styles.textRight]}>
                  {s.share.scheduledTime(secondsToTimeString(scheduledArrival))}
                </Text>
              )}
            </View>
          </View>

          <View style={styles.placesRow}>
            <Text style={styles.placeLeft} numberOfLines={fontScale > 1.3 ? undefined : 2}>
              {connection.fromTitle}
            </Text>
            <Text style={styles.placeRight} numberOfLines={fontScale > 1.3 ? undefined : 2}>
              {connection.toTitle}
            </Text>
          </View>
        </View>
      )}

      {/* Bieżący postęp w trakcie podróży */}
      {started && !ended && progress && (
        <View style={styles.progressBox} accessibilityLiveRegion="polite">
          <View style={styles.progressTop}>
            <View style={styles.stepLeft}>
              {showStepBadge && progress.leg ? (
                <LineBadge leg={progress.leg} compact />
              ) : (
                <View style={styles.stepWalkBadge}>
                  <Footprints size={13} color={scheme.onSecondaryContainer} />
                </View>
              )}
              <Text
                style={styles.stepText}
                numberOfLines={fontScale > 1.3 ? undefined : 2}
              >
                {stepText || s.share.inProgress}
              </Text>
            </View>

            {showEta && (
              <View style={styles.etaPill}>
                <Text style={styles.etaPillText}>{s.share.etaInMin(etaMin)}</Text>
              </View>
            )}
          </View>

          <View style={styles.progressTrackWrap}>
            <View style={styles.progressTrack}>
              <View style={[styles.progressFill, { width: `${progressPct}%` }]} />
            </View>
          </View>
        </View>
      )}

      {/* Proporcjonalny pasek składu podróży (jak w ConnectionSummary / kartach wyników) */}
      {boarding.length > 0 ? (
        <JourneyStrip insights={insights} dimmed={ended} />
      ) : (
        <View style={styles.walkOnlyStrip}>
          <Footprints size={15} color={scheme.onSurfaceVariant} />
          <Text style={styles.walkOnlyText}>
            {totalWalkM > 0 ? s.share.walkDistance(totalWalkM) : s.share.walk}
          </Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    padding: 16,
    gap: 14,
    backgroundColor: scheme.surfaceContainer,
    borderRadius: shape.extraLarge,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: scheme.outlineVariant,
    ...elev.level1,
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    flexWrap: 'wrap',
  },
  topLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 6,
    flex: 1,
    minWidth: 0,
  },
  statusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: scheme.surfaceContainerLow,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: scheme.outlineVariant,
    paddingHorizontal: 11,
    paddingVertical: 6,
    borderRadius: shape.full,
    maxWidth: '100%',
  },
  statusPillActive: {
    backgroundColor: scheme.tertiaryContainer,
    borderColor: 'transparent',
  },
  statusPillUpcoming: {
    backgroundColor: scheme.primaryContainer,
    borderColor: 'transparent',
  },
  statusPillEnded: {
    backgroundColor: scheme.surfaceContainerHigh,
    borderColor: 'transparent',
  },
  statusText: {
    ...type.labelMedium,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
    flexShrink: 1,
  },
  delayPill: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: shape.full,
  },
  delayLate: {
    backgroundColor: scheme.errorContainer,
  },
  delayEarly: {
    backgroundColor: scheme.warningContainer,
  },
  delayPillText: {
    ...type.labelMedium,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  delayLateText: {
    color: scheme.onErrorContainer,
  },
  delayEarlyText: {
    color: scheme.onWarningContainer,
  },
  durationPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: scheme.secondaryContainer,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: shape.full,
  },
  durationText: {
    ...type.labelLarge,
    fontWeight: '800',
    color: scheme.onSecondaryContainer,
    fontVariant: ['tabular-nums'],
  },
  heroBlock: {
    gap: 10,
  },
  timesRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
  },
  timeColLeft: {
    alignItems: 'flex-start',
    gap: 2,
    flexShrink: 0,
  },
  timeColRight: {
    alignItems: 'flex-end',
    gap: 2,
    flexShrink: 0,
  },
  timeInline: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 5,
  },
  timeInlineRight: {
    justifyContent: 'flex-end',
  },
  bridgeCol: {
    flex: 1,
    minWidth: 48,
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 14,
    gap: 5,
  },
  bridgePill: {
    backgroundColor: scheme.surfaceContainerLow,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: scheme.outlineVariant,
    paddingHorizontal: 9,
    paddingVertical: 3,
    borderRadius: shape.full,
    maxWidth: '100%',
  },
  bridgePillText: {
    fontSize: 11,
    lineHeight: 14,
    fontWeight: '700',
    color: scheme.onSurfaceVariant,
  },
  endpointTag: {
    fontSize: 11,
    lineHeight: 14,
    fontWeight: '700',
    color: scheme.onSurfaceVariant,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  endpointTagPrimary: {
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
  arrivalTimeAccent: {
    color: scheme.primary,
  },
  dayBadge: {
    ...type.labelMedium,
    fontWeight: '800',
    color: scheme.primary,
  },
  scheduledStrike: {
    ...type.bodySmall,
    color: scheme.onSurfaceVariant,
    textDecorationLine: 'line-through',
    fontVariant: ['tabular-nums'],
  },
  placesRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 16,
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
  stackedTagRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
  },
  startDot: {
    width: 9,
    height: 9,
    borderRadius: shape.full,
    borderWidth: 2,
    borderColor: scheme.primary,
    backgroundColor: scheme.surfaceContainer,
  },
  endDot: {
    width: 9,
    height: 9,
    borderRadius: shape.full,
    backgroundColor: scheme.primary,
  },
  endDotEnded: {
    backgroundColor: scheme.outline,
  },
  stackedTimeRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    flexWrap: 'wrap',
    gap: 8,
  },
  stackedBridge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  place: {
    ...type.bodyMedium,
    fontWeight: '700',
    color: scheme.onSurface,
    lineHeight: 19,
  },
  progressBox: {
    backgroundColor: scheme.surfaceContainerLow,
    borderRadius: 18,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: scheme.outlineVariant,
    padding: 12,
    gap: 10,
  },
  progressTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  stepLeft: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  stepWalkBadge: {
    width: 26,
    height: 26,
    borderRadius: shape.small,
    backgroundColor: scheme.secondaryContainer,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepText: {
    ...type.bodySmall,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '600',
    color: scheme.onSurface,
    flex: 1,
    minWidth: 0,
  },
  etaPill: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: shape.full,
    backgroundColor: scheme.primary,
    flexShrink: 0,
  },
  etaPillText: {
    ...type.labelMedium,
    fontWeight: '800',
    color: scheme.onPrimary,
    fontVariant: ['tabular-nums'],
  },
  progressTrackWrap: {
    paddingVertical: 2,
  },
  progressTrack: {
    height: 6,
    borderRadius: shape.full,
    backgroundColor: scheme.surfaceContainerHighest,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    borderRadius: shape.full,
    backgroundColor: scheme.primary,
  },
  walkOnlyStrip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: scheme.surfaceContainerLow,
    borderRadius: shape.large,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  walkOnlyText: {
    ...type.bodySmall,
    fontWeight: '600',
    color: scheme.onSurfaceVariant,
  },
});
