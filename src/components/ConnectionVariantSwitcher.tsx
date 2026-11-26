import { memo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Check, ShieldCheck } from './icons';
import { useStrings } from '../i18n';
import { normalizeConnectionId } from '../services/routing/connectionIdentity';
import type { ConnectionGroupOption } from '../services/routing/connectionGroups';
import { elev, scheme, shape, type } from '../theme/tokens';
import type { Connection } from '../types/models';
import { LineBadge } from './LineBadge';
import { SpringPressable } from './SpringPressable';
import { VariantLegChain } from './VariantLegChain';

export interface ConnectionVariantSwitcherProps {
  options: ConnectionGroupOption[];
  selectedId: string;
  onSelect: (connection: Connection) => void;
  trackedConnectionId?: string;
  transferProtectionActive?: boolean;
}

/**
 * Segmentowy przełącznik wariantów podróży z tego samego pierwszego kursu
 * w szczegółach połączenia (bezpośredni albo kolejne przesiadki).
 */
export const ConnectionVariantSwitcher = memo(function ConnectionVariantSwitcher({
  options,
  selectedId,
  onSelect,
  trackedConnectionId,
  transferProtectionActive = false,
}: ConnectionVariantSwitcherProps) {
  const s = useStrings();
  if (options.length < 2) return null;

  const normalizedSelected = normalizeConnectionId(selectedId);
  const normalizedTracked = trackedConnectionId
    ? normalizeConnectionId(trackedConnectionId)
    : null;

  return (
    <View
      style={styles.stack}
      accessibilityRole="radiogroup"
      accessibilityLabel={s.connection.variantSwitcherA11y}
    >
      {options.map((opt, idx) => {
        const normId = normalizeConnectionId(opt.connection.id);
        const isSelected = normId === normalizedSelected;
        const isFirst = idx === 0;
        const isLast = idx === options.length - 1;
        const isDirect = opt.transitSteps.length <= 1 && opt.connection.transfers === 0;
        const isTrackedOption =
          transferProtectionActive && normalizedTracked !== null && normId === normalizedTracked;

        const directStep = opt.transitSteps[0];
        const firstVehicle =
          directStep?.leg ?? opt.connection.legs.find((leg) => leg.mode !== 'walk');
        const directMeta = firstVehicle?.toStop
          ? s.connection.exitStopLabel(firstVehicle.toStop)
          : s.common.durMin(opt.connection.durationMin);

        const transferStops: string[] = [];
        for (const st of opt.transitSteps.slice(0, -1)) {
          const stopName = st.leg.toStop;
          if (stopName && !transferStops.includes(stopName)) {
            transferStops.push(stopName);
          }
        }
        const subMain = isDirect
          ? directMeta
          : transferStops.join(' · ') ||
            opt.firstTransferStop ||
            s.common.durMin(opt.connection.durationMin);
        const transferSlackLabel =
          !isDirect && opt.firstTransferStop && opt.safety === 'safe' && opt.minSlackSec != null
            ? s.connection.variantSlackShort(Math.floor(opt.minSlackSec / 60))
            : null;

        const durationText = s.common.durMin(opt.connection.durationMin);
        const chainLabel = isDirect
          ? `${firstVehicle?.line || firstVehicle?.mode || ''} ${s.connection.variantDirect}`.trim()
          : opt.transitSteps
              .map((st) => st.leg.line || st.leg.mode)
              .filter(Boolean)
              .join(', ');
        const a11yLabel = s.connection.variantOptionSelectedA11y(
          chainLabel,
          opt.connection.arriveAt,
          durationText,
        );

        return (
          <SpringPressable
            key={opt.connection.id}
            onPress={() => {
              if (!isSelected) onSelect(opt.connection);
            }}
            scaleDelta={0.015}
            haptic="selection"
            accessibilityRole="radio"
            accessibilityState={{ checked: isSelected, selected: isSelected }}
            accessibilityLabel={a11yLabel}
            style={[
              styles.row,
              isFirst && styles.rowFirst,
              isLast && styles.rowLast,
              isSelected && styles.rowSelected,
            ]}
          >
            <View style={[styles.radio, isSelected && styles.radioSelected]}>
              {isSelected && <Check size={13} color={scheme.onPrimary} />}
            </View>

            <View style={styles.center}>
              <View style={styles.topLine}>
                {isDirect ? (
                  <>
                    {directStep && <LineBadge leg={directStep.leg} compact />}
                    <Text style={[styles.primaryTitle, isSelected && styles.primaryTitleSelected]}>
                      {s.connection.variantDirect}
                    </Text>
                  </>
                ) : (
                  <VariantLegChain steps={opt.transitSteps} />
                )}
              </View>

              <View style={styles.subLine}>
                <Text style={styles.subText} numberOfLines={1}>
                  {subMain}
                </Text>
                {transferSlackLabel && (
                  <Text style={styles.subSuffix} numberOfLines={1}>
                    {`· ${transferSlackLabel}`}
                  </Text>
                )}
                {isTrackedOption && <ShieldCheck size={13} color={scheme.primary} />}
              </View>
            </View>

            <View style={styles.right}>
              <Text style={[styles.arriveClock, isSelected && styles.arriveClockSelected]}>
                {opt.connection.arriveAt}
              </Text>
              <Text style={styles.deltaNeutral} numberOfLines={1}>
                {durationText}
              </Text>
            </View>
          </SpringPressable>
        );
      })}
    </View>
  );
});

const styles = StyleSheet.create({
  stack: {
    gap: 4,
  },
  row: {
    minHeight: 56,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    backgroundColor: scheme.surfaceContainer,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: scheme.outlineVariant,
    borderRadius: 8,
    ...elev.level1,
  },
  rowFirst: {
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
  },
  rowLast: {
    borderBottomLeftRadius: 22,
    borderBottomRightRadius: 22,
  },
  rowSelected: {
    borderRadius: 22,
    backgroundColor: scheme.primaryContainer + '42',
    borderWidth: 1.5,
    borderColor: scheme.primary,
  },
  radio: {
    width: 20,
    height: 20,
    borderRadius: shape.full,
    borderWidth: 1.5,
    borderColor: scheme.outline,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  radioSelected: {
    borderColor: scheme.primary,
    backgroundColor: scheme.primary,
  },
  center: {
    flex: 1,
    minWidth: 0,
    gap: 3,
  },
  topLine: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 6,
  },
  primaryTitle: {
    fontSize: 14,
    lineHeight: 19,
    fontWeight: '700',
    color: scheme.onSurface,
  },
  primaryTitleSelected: {
    color: scheme.onSurface,
    fontWeight: '800',
  },
  subLine: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  subText: {
    ...type.bodySmall,
    fontSize: 12,
    lineHeight: 16,
    color: scheme.onSurfaceVariant,
    flexShrink: 1,
  },
  subSuffix: {
    ...type.bodySmall,
    fontSize: 12,
    lineHeight: 16,
    color: scheme.onSurfaceVariant,
    flexShrink: 0,
    fontVariant: ['tabular-nums'],
  },
  right: {
    alignItems: 'flex-end',
    gap: 3,
    flexShrink: 0,
  },
  arriveClock: {
    fontSize: 15.5,
    lineHeight: 20,
    fontWeight: '700',
    color: scheme.onSurface,
    fontVariant: ['tabular-nums'],
  },
  arriveClockSelected: {
    fontWeight: '800',
  },
  deltaNeutral: {
    ...type.labelSmall,
    color: scheme.onSurfaceVariant,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
  },
});
