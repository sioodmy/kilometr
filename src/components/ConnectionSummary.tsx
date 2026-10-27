import { StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { ArrowDown, ArrowRight, Check, Clock3 } from 'lucide-react-native';
import { useStrings } from '../i18n';
import { scheme, shape, type } from '../theme/tokens';
import type { Connection } from '../types/models';
import { LineBadge } from './LineBadge';
import { RollingTime } from './RollingTime';
import { boardingDepartureSec, scheduledLegTimes } from '../services/routing/connectionTimes';
import { secondsToTimeString } from '../gtfs/geo';

export function ConnectionSummary({
  item,
  offline = false,
  availableWidth,
}: {
  item: Connection;
  offline?: boolean;
  availableWidth?: number;
}) {
  const s = useStrings();
  const { width, fontScale } = useWindowDimensions();
  const stacked = ((availableWidth ?? width - 32) - 44) / fontScale < 280;
  const boarding = item.legs.filter((leg) => leg.mode !== 'walk');
  const firstVehicle = boarding[0];
  const departureSec = boardingDepartureSec(item);
  const departure = firstVehicle ? secondsToTimeString(departureSec) : item.departAt;
  const scheduled = firstVehicle
    ? scheduledLegTimes(firstVehicle, departureSec).departure
    : undefined;
  const departureDelay =
    firstVehicle?.live && !offline ? Math.round((firstVehicle.delaySec ?? 0) / 60) : 0;
  const hasApproach = item.legs[0]?.mode === 'walk' && firstVehicle != null;
  const live = item.live && !offline;
  const statusColor =
    live && item.delayMin > 0
      ? scheme.error
      : live && item.delayMin < 0
        ? scheme.warning
        : scheme.onSurfaceVariant;
  const status = !live
    ? offline
      ? s.routeDetails.scheduleCache
      : s.routeDetails.schedule
    : item.delayMin > 0
      ? s.routeDetails.late(item.delayMin)
      : item.delayMin < 0
        ? s.routeDetails.early(-item.delayMin)
        : s.routeDetails.onTime;
  const Direction = stacked ? ArrowDown : ArrowRight;

  return (
    <View style={styles.summary}>
      <View style={[styles.endpoints, stacked && styles.endpointsStacked]}>
        <View style={styles.endpoint}>
          <Text style={styles.label}>
            {firstVehicle ? s.routeDetails.vehicleDeparture : s.routeDetails.departure}
          </Text>
          <RollingTime value={departure} style={styles.time} />
          {departureDelay !== 0 && scheduled != null && (
            <View style={styles.delayDetails} accessibilityLiveRegion="polite">
              <Text style={styles.label}>
                {s.routeDetails.scheduledTime(secondsToTimeString(scheduled))}
              </Text>
              <Text
                style={[
                  styles.status,
                  { color: departureDelay > 0 ? scheme.error : scheme.warning },
                ]}
              >
                {departureDelay > 0
                  ? s.routeDetails.late(departureDelay)
                  : s.routeDetails.early(-departureDelay)}
              </Text>
            </View>
          )}
          <Text style={styles.place}>{firstVehicle?.fromStop ?? item.fromTitle}</Text>
        </View>
        <View style={[styles.direction, stacked && styles.directionStacked]}>
          <Direction size={22} color={scheme.primary} strokeWidth={1.8} />
        </View>
        <View style={styles.endpoint}>
          <Text style={styles.label}>{s.routeDetails.arrival}</Text>
          <RollingTime value={item.arriveAt} style={styles.time} />
          <Text style={styles.place}>{item.toTitle}</Text>
        </View>
      </View>
      {hasApproach && (
        <Text style={styles.label}>
          {s.routeDetails.walkDeparture(item.departAt, item.fromTitle)}
        </Text>
      )}
      <View style={styles.facts}>
        <View style={styles.fact}>
          <Clock3 size={17} color={scheme.primary} />
          <Text style={styles.duration}>{s.common.durMin(item.durationMin)}</Text>
        </View>
        <Text style={styles.label}>
          {boarding.length === 0 ? s.connection.walkAll : s.connection.transfers(item.transfers)}
        </Text>
      </View>
      <View style={styles.footer}>
        {boarding.length > 0 && (
          <View style={styles.lines}>
            {boarding.map((leg, index) => (
              <LineBadge key={`${leg.id}-${index}`} line={leg.line} mode={leg.mode} compact />
            ))}
          </View>
        )}
        {(!live || departureDelay === 0 || item.delayMin !== departureDelay) && (
          <View style={styles.fact}>
            {live && item.delayMin === 0 && <Check size={16} color={scheme.primary} />}
            <Text style={[styles.status, { color: statusColor }]}>{status}</Text>
          </View>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  summary: {
    padding: 22,
    gap: 22,
    backgroundColor: scheme.surfaceContainerLow,
    borderRadius: shape.extraLarge,
  },
  endpoints: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  endpointsStacked: { flexDirection: 'column' },
  endpoint: { flex: 1, minWidth: 0, gap: 6 },
  delayDetails: { gap: 4 },
  label: { ...type.bodyMedium, color: scheme.onSurfaceVariant },
  time: {
    fontSize: 38,
    fontWeight: '600',
    letterSpacing: -1.5,
    color: scheme.onSurface,
    fontVariant: ['tabular-nums'],
    includeFontPadding: false,
  },
  place: { ...type.bodyLarge, fontWeight: '500', color: scheme.onSurface, lineHeight: 23 },
  direction: { paddingTop: 35 },
  directionStacked: { paddingTop: 0 },
  facts: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', columnGap: 18, rowGap: 8 },
  fact: { flexDirection: 'row', alignItems: 'center', gap: 7, flexShrink: 1 },
  duration: { ...type.titleMedium, fontWeight: '600', color: scheme.onSurface },
  footer: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: scheme.outlineVariant,
    paddingTop: 16,
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  lines: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, flexShrink: 1 },
  status: { ...type.bodySmall, flexShrink: 1 },
});
