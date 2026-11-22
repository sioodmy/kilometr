import { useEffect, useMemo, useState } from 'react';
import { AppState, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { ChevronRight, Clock3, Footprints } from './icons';
import { useStrings } from '../i18n';
import { elev, scheme, shape, type } from '../theme/tokens';
import type { Connection, Leg } from '../types/models';
import { RollingTime } from './RollingTime';
import { LiveSensors } from './LiveDot';
import { LineBadge } from './LineBadge';
import { boardingDepartureSec } from '../services/routing/connectionTimes';
import { secondsToTimeString, timeStringToSeconds } from '../gtfs/geo';
import { nowSecOfDay } from '../services/vehiclePosition';
import { formatWalkTime, useWalkSpeedMps, walkMinutesFor } from '../services/settings';

function visibleSummaryLegs(legs: Leg[]): Leg[] {
  if (legs.length <= 1) return legs;
  return legs.filter((leg) => {
    if (leg.mode !== 'walk') return true;
    return (leg.walkM ?? 0) >= 80;
  });
}

export function ConnectionSummary({
  item,
  offline = false,
  availableWidth,
  showLegStrip = false,
}: {
  item: Connection;
  offline?: boolean;
  availableWidth?: number;
  showLegStrip?: boolean;
}) {
  const s = useStrings();
  const walkMps = useWalkSpeedMps();
  const { width, fontScale } = useWindowDimensions();
  const stacked = ((availableWidth ?? width - 28) - 44) / fontScale < 280;
  const boarding = useMemo(() => item.legs.filter((leg) => leg.mode !== 'walk'), [item.legs]);
  const stripLegs = useMemo(
    () => (showLegStrip ? visibleSummaryLegs(item.legs) : []),
    [showLegStrip, item.legs],
  );
  const firstVehicle = boarding[0];
  const lastVehicle = boarding[boarding.length - 1];
  const departureSec = boardingDepartureSec(item);
  const departure =
    item.boarded || !firstVehicle ? item.departAt : secondsToTimeString(departureSec);
  const departureDelay =
    !item.boarded && firstVehicle?.live && !offline
      ? Math.round((firstVehicle.delaySec ?? 0) / 60)
      : 0;
  const arrivalDelaySec =
    lastVehicle?.live && !offline ? (lastVehicle.arrivalDelaySec ?? lastVehicle.delaySec ?? 0) : 0;
  const arrivalDelay = Math.round(arrivalDelaySec / 60);

  // Odliczanie czasu do odjazdu pierwszego pojazdu (lub wyjścia)
  const [nowSec, setNowSec] = useState(() => nowSecOfDay());
  useEffect(() => {
    const timer = setInterval(() => setNowSec(nowSecOfDay()), 15_000);
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') setNowSec(nowSecOfDay());
    });
    return () => {
      clearInterval(timer);
      sub.remove();
    };
  }, []);

  const countdownLabel = useMemo(() => {
    if (item.boarded) return s.connection.inVehicleNow;
    const targetSec = firstVehicle ? departureSec : timeStringToSeconds(item.departAt);
    let diffSec = targetSec - nowSec;
    if (diffSec < -43200) diffSec += 86400;
    const diffMin = Math.round(diffSec / 60);
    if (diffMin < -2 || diffMin > 180) return null;
    if (diffMin <= 0) return s.common.departNow;
    return s.common.departIn(diffMin);
  }, [item.boarded, item.departAt, firstVehicle, departureSec, nowSec, s]);

  const transfersLabel =
    boarding.length === 0 ? s.connection.walkAll : s.connection.transfers(item.transfers);

  const departureTag = item.boarded
    ? s.connection.inVehicleNow
    : firstVehicle
      ? s.routeDetails.vehicleDeparture
      : s.routeDetails.departure;
  const departurePlace = item.boarded ? item.fromTitle : (firstVehicle?.fromStop ?? item.fromTitle);
  const showArrivalDelay =
    arrivalDelay !== 0 && (item.boarded || arrivalDelay !== departureDelay);

  const innerContent = (
    <>
      {/* 1. Górny pasek KPI: odliczanie live / status i całkowity czas podróży */}
      <View style={styles.topBar}>
        <View style={styles.topPillsLeft}>
          {countdownLabel ? (
            <View style={[styles.countdownPill, item.boarded && styles.countdownPillBoarded]}>
              {!offline && item.live ? (
                <LiveSensors
                  color={item.boarded ? scheme.onTertiaryContainer : scheme.onPrimaryContainer}
                  size={13}
                />
              ) : null}
              <Text
                style={[styles.countdownText, item.boarded && styles.countdownTextBoarded]}
                numberOfLines={1}
              >
                {countdownLabel}
              </Text>
            </View>
          ) : (
            <View style={styles.metaPill}>
              <Text style={styles.metaPillText} numberOfLines={1}>
                {transfersLabel}
              </Text>
            </View>
          )}
        </View>

        <View style={styles.durationPill}>
          <Clock3 size={14} color={scheme.onSecondaryContainer} />
          <Text style={styles.durationText}>{s.common.durMin(item.durationMin)}</Text>
        </View>
      </View>

      {/* 2. Czasy odjazdu i przyjazdu połączone poziomą osią podróży */}
      {stacked ? (
        <View style={styles.stackedWrap}>
          <View style={styles.stackedEndpoint}>
            <View style={styles.stackedTopRow}>
              <View style={styles.bridgeStartDot} />
              <Text style={styles.endpointTag} numberOfLines={1}>
                {departureTag}
              </Text>
            </View>
            <View style={styles.stackedTimeRow}>
              <RollingTime value={departure} style={styles.time} />
              {departureDelay !== 0 ? (
                <View
                  style={[
                    styles.delayBadge,
                    departureDelay > 0 ? styles.delayBadgeLate : styles.delayBadgeEarly,
                  ]}
                  accessibilityLiveRegion="polite"
                >
                  <Text
                    style={[
                      styles.delayBadgeText,
                      {
                        color:
                          departureDelay > 0
                            ? scheme.onErrorContainer
                            : scheme.onWarningContainer,
                      },
                    ]}
                    numberOfLines={1}
                  >
                    {departureDelay > 0
                      ? s.routeDetails.late(departureDelay)
                      : s.routeDetails.early(-departureDelay)}
                  </Text>
                </View>
              ) : null}
            </View>
            <Text style={styles.place} numberOfLines={2}>
              {departurePlace}
            </Text>
          </View>

          <View style={styles.stackedBridge}>
            <View style={styles.bridgeTrack} />
            <View style={styles.bridgePill}>
              <Text style={styles.bridgePillText} numberOfLines={1}>
                {transfersLabel}
              </Text>
            </View>
            <View style={styles.bridgeTrack} />
          </View>

          <View style={styles.stackedEndpoint}>
            <View style={styles.stackedTopRow}>
              <View style={styles.bridgeEndDot} />
              <Text style={styles.endpointTag} numberOfLines={1}>
                {s.routeDetails.arrival}
              </Text>
            </View>
            <View style={styles.stackedTimeRow}>
              <RollingTime value={item.arriveAt} style={styles.time} />
              {showArrivalDelay ? (
                <View
                  style={[
                    styles.delayBadge,
                    arrivalDelay > 0 ? styles.delayBadgeLate : styles.delayBadgeEarly,
                  ]}
                  accessibilityLiveRegion="polite"
                >
                  <Text
                    style={[
                      styles.delayBadgeText,
                      {
                        color:
                          arrivalDelay > 0
                            ? scheme.onErrorContainer
                            : scheme.onWarningContainer,
                      },
                    ]}
                    numberOfLines={1}
                  >
                    {arrivalDelay > 0
                      ? s.routeDetails.late(arrivalDelay)
                      : s.routeDetails.early(-arrivalDelay)}
                  </Text>
                </View>
              ) : null}
            </View>
            <Text style={styles.place} numberOfLines={2}>
              {item.toTitle}
            </Text>
          </View>
        </View>
      ) : (
        <View style={styles.heroBlock}>
          <View style={styles.timesRow}>
            <View style={styles.timeColLeft}>
              <Text style={styles.endpointTag} numberOfLines={1}>
                {departureTag}
              </Text>
              <RollingTime value={departure} style={styles.time} />
            </View>

            <View style={styles.bridgeCol}>
              <View style={styles.bridgeLineRow}>
                <View style={styles.bridgeStartDot} />
                <View style={styles.bridgeTrack} />
                <View style={styles.bridgeEndDot} />
              </View>
              {countdownLabel ? (
                <View style={styles.bridgePill}>
                  <Text style={styles.bridgePillText} numberOfLines={1}>
                    {transfersLabel}
                  </Text>
                </View>
              ) : null}
            </View>

            <View style={styles.timeColRight}>
              <Text style={[styles.endpointTag, styles.textRight]} numberOfLines={1}>
                {s.routeDetails.arrival}
              </Text>
              <RollingTime value={item.arriveAt} style={[styles.time, styles.textRight]} />
            </View>
          </View>

          {(departureDelay !== 0 || showArrivalDelay) ? (
            <View style={styles.delaysRow}>
              <View style={styles.delayColLeft}>
                {departureDelay !== 0 ? (
                  <View
                    style={[
                      styles.delayBadge,
                      departureDelay > 0 ? styles.delayBadgeLate : styles.delayBadgeEarly,
                    ]}
                    accessibilityLiveRegion="polite"
                  >
                    <Text
                      style={[
                        styles.delayBadgeText,
                        {
                          color:
                            departureDelay > 0
                              ? scheme.onErrorContainer
                              : scheme.onWarningContainer,
                        },
                      ]}
                      numberOfLines={1}
                    >
                      {departureDelay > 0
                        ? s.routeDetails.late(departureDelay)
                        : s.routeDetails.early(-departureDelay)}
                    </Text>
                  </View>
                ) : null}
              </View>

              <View style={styles.delayColRight}>
                {showArrivalDelay ? (
                  <View
                    style={[
                      styles.delayBadge,
                      arrivalDelay > 0 ? styles.delayBadgeLate : styles.delayBadgeEarly,
                    ]}
                    accessibilityLiveRegion="polite"
                  >
                    <Text
                      style={[
                        styles.delayBadgeText,
                        {
                          color:
                            arrivalDelay > 0
                              ? scheme.onErrorContainer
                              : scheme.onWarningContainer,
                        },
                      ]}
                      numberOfLines={1}
                    >
                      {arrivalDelay > 0
                        ? s.routeDetails.late(arrivalDelay)
                        : s.routeDetails.early(-arrivalDelay)}
                    </Text>
                  </View>
                ) : null}
              </View>
            </View>
          ) : null}

          <View style={styles.placesRow}>
            <Text style={styles.placeLeft} numberOfLines={2}>
              {departurePlace}
            </Text>
            <Text style={styles.placeRight} numberOfLines={2}>
              {item.toTitle}
            </Text>
          </View>
        </View>
      )}

      {/* 3. Pasek składu podróży: kolejne linie i dojścia na jednym rzucie oka */}
      {showLegStrip && stripLegs.length > 0 ? (
        <View style={styles.legStrip}>
          {stripLegs.map((leg, idx) => (
            <View key={`${leg.id}-${idx}`} style={styles.legStripItem}>
              {idx > 0 ? <ChevronRight size={13} color={scheme.outline} /> : null}
              {leg.mode === 'walk' ? (
                <View style={styles.walkChip}>
                  <Footprints size={12} color={scheme.onSurfaceVariant} />
                  <Text style={styles.walkChipText} numberOfLines={1}>
                    {formatWalkTime(walkMinutesFor(leg.walkM ?? 150, walkMps))}
                  </Text>
                </View>
              ) : (
                <LineBadge leg={leg} compact />
              )}
            </View>
          ))}
        </View>
      ) : null}
    </>
  );

  return (
    <View style={styles.summary}>
      <View style={styles.content}>{innerContent}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  summary: {
    padding: 16,
    backgroundColor: scheme.surfaceContainer,
    borderRadius: shape.extraLarge,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: scheme.outlineVariant,
    ...elev.level1,
  },
  content: {
    gap: 14,
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    flexWrap: 'wrap',
  },
  topPillsLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 6,
    flex: 1,
  },
  countdownPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: scheme.primaryContainer,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: shape.full,
  },
  countdownPillBoarded: {
    backgroundColor: scheme.tertiaryContainer,
  },
  countdownText: {
    ...type.labelMedium,
    fontWeight: '700',
    color: scheme.onPrimaryContainer,
    fontVariant: ['tabular-nums'],
  },
  countdownTextBoarded: {
    color: scheme.onTertiaryContainer,
  },
  metaPill: {
    backgroundColor: scheme.surfaceContainerLow,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: scheme.outlineVariant,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: shape.full,
  },
  metaPillText: {
    ...type.labelMedium,
    fontWeight: '600',
    color: scheme.onSurfaceVariant,
  },
  durationPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: scheme.secondaryContainer,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: shape.full,
  },
  durationText: {
    ...type.labelLarge,
    fontWeight: '800',
    color: scheme.onSecondaryContainer,
    fontVariant: ['tabular-nums'],
  },
  heroBlock: {
    gap: 8,
  },
  timesRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
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
  bridgeCol: {
    flex: 1,
    minWidth: 56,
    alignItems: 'center',
    justifyContent: 'flex-end',
    paddingBottom: 6,
    gap: 6,
  },
  bridgeLineRow: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
  },
  bridgeStartDot: {
    width: 9,
    height: 9,
    borderRadius: shape.full,
    borderWidth: 2,
    borderColor: scheme.primary,
    backgroundColor: scheme.surfaceContainer,
  },
  bridgeTrack: {
    flex: 1,
    height: 2,
    backgroundColor: scheme.outlineVariant,
    marginHorizontal: 3,
    borderRadius: 1,
  },
  bridgeEndDot: {
    width: 9,
    height: 9,
    borderRadius: shape.full,
    backgroundColor: scheme.primary,
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
  textRight: {
    textAlign: 'right',
  },
  time: {
    fontSize: 33,
    lineHeight: 37,
    fontWeight: '800',
    letterSpacing: -1.1,
    color: scheme.onSurface,
    fontVariant: ['tabular-nums'],
    includeFontPadding: false,
  },
  delaysRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  delayColLeft: {
    flex: 1,
    alignItems: 'flex-start',
  },
  delayColRight: {
    flex: 1,
    alignItems: 'flex-end',
  },
  delayBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: shape.full,
  },
  delayBadgeLate: {
    backgroundColor: scheme.errorContainer,
  },
  delayBadgeEarly: {
    backgroundColor: scheme.warningContainer,
  },
  delayBadgeText: {
    fontSize: 11,
    lineHeight: 14,
    fontWeight: '700',
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
  stackedTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
  },
  stackedTimeRow: {
    flexDirection: 'row',
    alignItems: 'center',
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
  legStrip: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 6,
    backgroundColor: scheme.surfaceContainerLow,
    borderRadius: 18,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: scheme.outlineVariant,
    paddingHorizontal: 11,
    paddingVertical: 9,
  },
  legStripItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  walkChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: scheme.surfaceContainerHigh,
    borderRadius: shape.full,
    paddingHorizontal: 7,
    paddingVertical: 3,
  },
  walkChipText: {
    fontSize: 11,
    lineHeight: 14,
    fontWeight: '700',
    color: scheme.onSurfaceVariant,
    fontVariant: ['tabular-nums'],
  },
});
