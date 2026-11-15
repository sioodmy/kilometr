import { useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import {
  ArrowRight,
  Bell,
  BellOff,
  CircleCheck,
  Clock3,
  Footprints,
} from './icons';
import { LineBadge } from './LineBadge';
import { LiveSensors } from './LiveDot';
import { RollingTime } from './RollingTime';
import { secondsToTimeString } from '../gtfs/geo';
import { useStrings } from '../i18n';
import { boardingDepartureSec, scheduledLegTimes } from '../services/routing/connectionTimes';
import type { TripProgress } from '../services/notifications/types';
import type { SharedConnection } from '../sharing/connection';
import { scheme, shape, type } from '../theme/tokens';
import type { Connection } from '../types/models';

export function SharedJourneyHero({
  journey,
  connection,
  progress,
  hasVehicle,
  pingKey,
  sameCity,
  following,
  followBusy,
  onFollowPress,
}: {
  journey: SharedConnection;
  connection: Connection;
  progress: TripProgress | null;
  hasVehicle: boolean;
  pingKey: number | string;
  sameCity: boolean;
  following: boolean;
  followBusy: boolean;
  onFollowPress: () => void;
}) {
  const s = useStrings();
  const { width, fontScale } = useWindowDimensions();
  const compact = width / fontScale < 340;
  const [followFocused, setFollowFocused] = useState(false);

  const boarding = connection.legs.filter((leg) => leg.mode !== 'walk');
  const firstVehicle = boarding[0];
  const lastVehicle = boarding[boarding.length - 1];
  const departureSec = boardingDepartureSec(connection);
  const departureDisplay = firstVehicle ? secondsToTimeString(departureSec) : connection.departAt;
  const scheduledDeparture = firstVehicle
    ? scheduledLegTimes(firstVehicle, departureSec).departure
    : undefined;
  const departureDelay =
    firstVehicle?.live ? Math.round((firstVehicle.delaySec ?? 0) / 60) : 0;
  const arrivalDelaySec =
    lastVehicle?.live ? (lastVehicle.arrivalDelaySec ?? lastVehicle.delaySec ?? 0) : 0;
  const arrivalDelay = Math.round(arrivalDelaySec / 60);
  const scheduledArrival =
    connection.arrivalSec != null ? connection.arrivalSec - arrivalDelaySec : undefined;

  const ended = progress?.phase === 'arrived';
  const started = !!progress && progress.departInSec <= 0 && !ended;
  const hasLive = hasVehicle || connection.live;
  const arrivalDay = Math.floor(journey.arrival / 1440);
  const displayDelay = arrivalDelay !== 0 ? arrivalDelay : connection.delayMin;

  const etaMin = progress ? Math.round(progress.etaMin) : 0;
  const departInMin = progress ? Math.round(progress.departInSec / 60) : 0;
  const showEtaPill = started && !ended && etaMin >= 1;
  const showDepartPill = !started && !ended && departInMin >= 1 && departInMin <= 180;

  const heroFg = ended ? scheme.onSurface : scheme.onPrimaryContainer;
  const heroSub = ended ? scheme.onSurfaceVariant : scheme.onPrimaryContainer;

  const statusText = ended
    ? s.share.finished
    : hasVehicle
      ? s.share.vehicleLive
      : started
        ? s.share.inProgress
        : connection.live
          ? s.share.vehicleLive
          : s.share.upcoming;

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
          ? ` · ${s.share.stopsToGo(progress.stopsLeft)}`
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

  return (
    <View style={styles.card}>
      <View style={[styles.hero, ended && styles.heroEnded]}>
        <View style={styles.statusRow}>
          <View style={styles.statusLeft}>
            {hasLive && !ended ? (
              <LiveSensors color={heroFg} size={15} pingKey={pingKey} />
            ) : ended ? (
              <CircleCheck size={16} color={scheme.onSurfaceVariant} />
            ) : (
              <Clock3 size={15} color={heroFg} />
            )}
            <Text style={[styles.statusLabel, { color: heroSub }]} numberOfLines={2}>
              {statusText}
            </Text>
          </View>
          {displayDelay !== 0 && !ended && (
            <View
              style={[
                styles.delayPill,
                displayDelay > 0 ? styles.delayLate : styles.delayEarly,
              ]}
            >
              <Text
                style={[
                  styles.delayPillText,
                  displayDelay > 0 ? styles.delayLateText : styles.delayEarlyText,
                ]}
              >
                {s.share.liveDelay(displayDelay)}
              </Text>
            </View>
          )}
        </View>

        <View style={styles.arrivalBlock}>
          <Text style={[styles.arrivalLabel, { color: heroSub }]}>{s.share.arrival}</Text>
          <View style={styles.arrivalRow}>
            <RollingTime
              value={connection.arriveAt}
              style={[styles.arrivalTime, compact && styles.arrivalTimeCompact, { color: heroFg }]}
            />
            {arrivalDay > 0 && (
              <Text style={[styles.dayBadge, { color: heroSub }]}>
                {s.share.dayLater(arrivalDay)}
              </Text>
            )}
            {showEtaPill && (
              <View style={styles.etaPill}>
                <Text style={styles.etaPillText}>{s.share.etaInMin(etaMin)}</Text>
              </View>
            )}
            {showDepartPill && (
              <View style={styles.departPill}>
                <Text style={styles.departPillText}>{s.share.departsInMin(departInMin)}</Text>
              </View>
            )}
          </View>
          {arrivalDelay !== 0 && scheduledArrival != null && (
            <Text style={[styles.scheduledDelta, { color: heroSub }]}>
              {s.routeDetails.scheduledTime(secondsToTimeString(scheduledArrival))}
            </Text>
          )}
          <Text
            style={[styles.destination, { color: heroFg }]}
            numberOfLines={fontScale > 1.3 ? undefined : 2}
          >
            {connection.toTitle}
          </Text>
        </View>

        {started && !ended && progress && (
          <View style={styles.progressSection} accessibilityLiveRegion="polite">
            <View style={styles.progressTrack}>
              <View
                style={[
                  styles.progressFill,
                  { width: `${Math.max(4, Math.round(progress.progress * 100))}%` },
                ]}
              />
            </View>
            {stepText ? (
              <View style={styles.stepRow}>
                {showStepBadge && progress.leg ? (
                  <LineBadge leg={progress.leg} compact />
                ) : (
                  <Footprints size={15} color={heroFg} />
                )}
                <Text
                  style={[styles.stepText, { color: heroFg }]}
                  numberOfLines={fontScale > 1.3 ? undefined : 2}
                >
                  {stepText}
                </Text>
              </View>
            ) : null}
          </View>
        )}
      </View>

      <View style={styles.body}>
        <View style={[styles.metaRow, compact && styles.metaRowStacked]}>
          <View style={styles.originCol}>
            <Text style={styles.metaLabel}>
              {s.share.departure} · {departureDisplay}
              {departureDelay !== 0 && departureDelay !== arrivalDelay && scheduledDeparture != null
                ? ` (${s.routeDetails.scheduledTime(secondsToTimeString(scheduledDeparture))})`
                : ''}
            </Text>
            <Text style={styles.originName}>{connection.fromTitle}</Text>
          </View>
          <View style={[styles.factsCol, compact && styles.factsColStacked]}>
            <Text style={styles.durationText}>{s.share.duration(connection.durationMin)}</Text>
            <Text style={styles.metaLabel}>
              {boarding.length === 0
                ? s.connection.walkAll
                : s.share.transfers(connection.transfers)}
            </Text>
          </View>
        </View>

        <View style={styles.lines}>
          {connection.legs.map((leg, index) => (
            <View key={leg.id} style={styles.lineStep}>
              {index > 0 && <ArrowRight size={13} color={scheme.onSurfaceVariant} />}
              <LineBadge leg={leg} compact />
            </View>
          ))}
        </View>

        {sameCity && (!ended || following) && (
          <View style={styles.followFooter}>
            <Pressable
              onPress={onFollowPress}
              disabled={followBusy}
              accessibilityRole="button"
              accessibilityState={{ disabled: followBusy, selected: following }}
              accessibilityLabel={following ? s.share.following : s.share.follow}
              onFocus={() => setFollowFocused(true)}
              onBlur={() => setFollowFocused(false)}
              style={({ pressed }) => [
                styles.followBtn,
                following && styles.followBtnActive,
                followFocused && styles.followBtnFocused,
                pressed && styles.pressed,
                followBusy && styles.disabled,
              ]}
            >
              {followBusy ? (
                <ActivityIndicator
                  color={following ? scheme.onSecondaryContainer : scheme.onPrimary}
                />
              ) : following ? (
                <BellOff size={20} color={scheme.onSecondaryContainer} />
              ) : (
                <Bell size={20} color={scheme.onPrimary} />
              )}
              <Text style={[styles.followBtnText, following && styles.followBtnTextActive]}>
                {following ? s.share.following : s.share.follow}
              </Text>
            </Pressable>
            <Text style={styles.followHint}>
              {following ? s.share.followActiveHint : s.share.followHint}
            </Text>
          </View>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: shape.extraLarge,
    overflow: 'hidden',
    backgroundColor: scheme.surfaceContainerLow,
  },
  hero: {
    backgroundColor: scheme.primaryContainer,
    paddingHorizontal: 22,
    paddingTop: 18,
    paddingBottom: 20,
    gap: 14,
  },
  heroEnded: {
    backgroundColor: scheme.surfaceContainerHigh,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: 8,
  },
  statusLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexShrink: 1,
    minWidth: 0,
  },
  statusLabel: {
    ...type.labelLarge,
    fontWeight: '600',
    flexShrink: 1,
  },
  delayPill: {
    paddingHorizontal: 10,
    paddingVertical: 4,
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
  },
  delayLateText: {
    color: scheme.onErrorContainer,
  },
  delayEarlyText: {
    color: scheme.onWarningContainer,
  },
  arrivalBlock: {
    gap: 4,
  },
  arrivalLabel: {
    ...type.bodyMedium,
    fontWeight: '500',
  },
  arrivalRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 10,
  },
  arrivalTime: {
    fontSize: 48,
    fontWeight: '700',
    letterSpacing: -1.5,
    fontVariant: ['tabular-nums'],
    includeFontPadding: false,
  },
  arrivalTimeCompact: {
    fontSize: 40,
  },
  dayBadge: {
    ...type.titleMedium,
    fontWeight: '700',
  },
  etaPill: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: shape.full,
    backgroundColor: scheme.primary,
  },
  etaPillText: {
    ...type.labelLarge,
    fontWeight: '700',
    color: scheme.onPrimary,
  },
  departPill: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: shape.full,
    backgroundColor: scheme.surfaceContainerLow,
  },
  departPillText: {
    ...type.labelLarge,
    fontWeight: '600',
    color: scheme.onSurface,
  },
  scheduledDelta: {
    ...type.bodySmall,
  },
  destination: {
    ...type.titleLarge,
    fontWeight: '700',
    marginTop: 2,
  },
  progressSection: {
    gap: 10,
    marginTop: 2,
  },
  progressTrack: {
    height: 4,
    borderRadius: shape.full,
    backgroundColor: scheme.surfaceContainerLowest,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    borderRadius: shape.full,
    backgroundColor: scheme.primary,
  },
  stepRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  stepText: {
    ...type.bodyMedium,
    fontWeight: '600',
    flex: 1,
    minWidth: 0,
  },
  body: {
    padding: 20,
    gap: 16,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12,
  },
  metaRowStacked: {
    flexDirection: 'column',
  },
  originCol: {
    flex: 1,
    minWidth: 0,
    gap: 4,
  },
  factsCol: {
    alignItems: 'flex-end',
    gap: 4,
  },
  factsColStacked: {
    alignItems: 'flex-start',
  },
  metaLabel: {
    ...type.bodyMedium,
    color: scheme.onSurfaceVariant,
  },
  originName: {
    ...type.titleMedium,
    fontWeight: '600',
    color: scheme.onSurface,
  },
  durationText: {
    ...type.titleMedium,
    fontWeight: '700',
    color: scheme.onSurface,
  },
  lines: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 8,
  },
  lineStep: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  followFooter: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: scheme.outlineVariant,
    paddingTop: 16,
    gap: 10,
  },
  followBtn: {
    minHeight: 50,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 18,
    backgroundColor: scheme.primary,
    borderWidth: 2,
    borderColor: 'transparent',
  },
  followBtnActive: {
    backgroundColor: scheme.secondaryContainer,
  },
  followBtnFocused: {
    borderColor: scheme.onSurface,
  },
  followBtnText: {
    ...type.labelLarge,
    fontWeight: '700',
    color: scheme.onPrimary,
    flexShrink: 1,
    textAlign: 'center',
  },
  followBtnTextActive: {
    color: scheme.onSecondaryContainer,
  },
  followHint: {
    ...type.bodySmall,
    color: scheme.onSurfaceVariant,
    lineHeight: 18,
    textAlign: 'center',
  },
  pressed: {
    opacity: 0.78,
  },
  disabled: {
    opacity: 0.5,
  },
});
