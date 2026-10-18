import { useEffect, useState } from 'react';
import { Alert, Pressable, StyleSheet, Switch, Text, View } from 'react-native';
import { Activity, BellRing, Clock, Minus, Navigation, Plus } from 'lucide-react-native';
import { scheme, shape, type } from '../theme/tokens';
import { useStrings } from '../i18n';
import {
  areNotificationsSupported,
  canShowLiveUpdates,
  ensureNotificationPermission,
  isNativeTrackingSupported,
  isLiveUpdatesSupported,
  openNotificationSettings,
  permissionDeniedMessage,
  useNotificationPreferences,
} from '../services/notifications';

const LEAD_MIN = [1, 3, 5, 10, 15];

function leadIndex(min: number): number {
  const i = LEAD_MIN.indexOf(min);
  return i >= 0 ? i : LEAD_MIN.indexOf(5);
}

export function PrefsToggle({
  value,
  onChange,
  disabled,
  label,
  hint,
}: {
  value: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
  label: string;
  hint?: string;
}) {
  return (
    <Switch
      value={value}
      onValueChange={onChange}
      disabled={disabled}
      accessibilityRole="switch"
      accessibilityLabel={label}
      accessibilityHint={hint}
      accessibilityState={{ checked: value, disabled: !!disabled }}
      hitSlop={8}
      trackColor={{ false: scheme.outlineVariant, true: scheme.primary }}
      thumbColor={value ? scheme.onPrimary : scheme.onSurfaceVariant}
      style={styles.switch}
    />
  );
}

function ToggleRow({
  icon,
  title,
  hint,
  value,
  onChange,
  disabled,
}: {
  icon: React.ReactNode;
  title: string;
  hint: string;
  value: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <View style={[styles.row, disabled && styles.rowDisabled]}>
      <View style={styles.rowIcon}>{icon}</View>
      <View style={styles.rowText}>
        <Text style={styles.rowTitle}>{title}</Text>
        <Text style={styles.rowHint}>{hint}</Text>
      </View>
      <PrefsToggle
        value={value}
        onChange={onChange}
        disabled={disabled}
        label={title}
        hint={hint}
      />
    </View>
  );
}

export function NotificationPrefsCard() {
  const s = useStrings();
  const p = s.notificationPrefs;
  const { prefs, update } = useNotificationPreferences();
  const supported = areNotificationsSupported();
  const nativeTrackingSupported = isNativeTrackingSupported();
  const liveUpdatesSupported = isLiveUpdatesSupported();
  const [promotable, setPromotable] = useState<boolean | null>(null);

  useEffect(() => {
    if (!liveUpdatesSupported) {
      setPromotable(null);
      return;
    }
    let alive = true;
    void (async () => {
      const ok = await canShowLiveUpdates();
      if (alive) setPromotable(ok);
    })();
    return () => {
      alive = false;
    };
  }, [liveUpdatesSupported]);

  const openSystemNotificationSettings = async () => {
    const opened = await openNotificationSettings();
    if (!opened) Alert.alert(p.title, p.livePromoteHint);
  };

  const requirePermission = async (next: boolean): Promise<boolean> => {
    if (!next) return true;
    if (!supported) {
      Alert.alert(p.unsupportedTitle, p.unsupportedBody);
      return false;
    }
    const ok = await ensureNotificationPermission();
    if (!ok) Alert.alert(p.title, permissionDeniedMessage());
    return ok;
  };

  const guarded =
    (makePatch: (next: boolean) => Parameters<typeof update>[0]) => async (next: boolean) => {
      if (!(await requirePermission(next))) return;
      await update(makePatch(next));
    };

  const leadIdx = leadIndex(prefs.departureAlertLeadMin);

  return (
    <View style={styles.card}>

      {!supported ? <Text style={styles.warn}>{p.devBuildWarn}</Text> : null}

      <View style={styles.trackingGroup}>
        <ToggleRow
          icon={<Navigation size={18} color={scheme.onSurfaceVariant} />}
          title={p.trackTitle}
          hint={p.trackHint}
          value={prefs.trackingEnabled}
          onChange={guarded((v) => ({ trackingEnabled: v }))}
          disabled={!supported}
        />

        <View style={styles.liveGroup}>
          {nativeTrackingSupported ? (
            <ToggleRow
              icon={<Activity size={18} color={scheme.onSurfaceVariant} />}
              title={p.liveTitle}
              hint={p.liveHint}
              value={prefs.liveProgressEnabled}
              onChange={guarded((v) => ({ liveProgressEnabled: v }))}
              disabled={!supported || !prefs.trackingEnabled}
            />
          ) : (
            <View style={styles.row}>
              <View style={styles.rowIcon}>
                <Activity size={18} color={scheme.onSurfaceVariant} />
              </View>
              <View style={styles.rowText}>
                <Text style={styles.rowTitle}>{p.liveTitle}</Text>
                <Text style={styles.rowHint}>{p.liveHintBasic}</Text>
              </View>
            </View>
          )}
        </View>

        {liveUpdatesSupported && promotable === false ? (
          <View style={styles.liveWarning}>
            <Text style={styles.liveWarningText}>{p.livePromoteHint}</Text>
            <Pressable
              onPress={openSystemNotificationSettings}
              style={({ pressed }) => [styles.settingsAction, pressed && { opacity: 0.75 }]}
              accessibilityRole="button"
              accessibilityLabel={p.openNotificationSettings}
            >
              <Text style={styles.settingsActionText}>{p.openNotificationSettings}</Text>
            </Pressable>
          </View>
        ) : null}
      </View>

      <View style={styles.divider} />
      <Text style={styles.groupTitle}>{p.alertsTitle}</Text>

      <ToggleRow
        icon={<BellRing size={18} color={scheme.onSurfaceVariant} />}
        title={p.leaveTitle}
        hint={p.leaveHint}
        value={prefs.departureAlertsEnabled}
        onChange={guarded((v) => ({ departureAlertsEnabled: v }))}
        disabled={!supported}
      />

      {prefs.departureAlertsEnabled ? (
        <View style={styles.leadSetting}>
          <View style={styles.row}>
            <View style={styles.rowIcon}>
              <Clock size={18} color={scheme.onSurfaceVariant} />
            </View>
            <View style={styles.rowText}>
              <Text style={styles.rowTitle}>{p.leadTitle}</Text>
              <Text style={styles.rowHint}>{p.leadHint}</Text>
            </View>
          </View>
          <View style={styles.stepper}>
            <Pressable
              onPress={() => update({ departureAlertLeadMin: LEAD_MIN[Math.max(0, leadIdx - 1)] })}
              disabled={leadIdx <= 0}
              style={({ pressed }) => [
                styles.stepBtn,
                leadIdx <= 0 && styles.stepBtnDisabled,
                pressed && leadIdx > 0 && { opacity: 0.7 },
              ]}
              accessibilityRole="button"
              accessibilityState={{ disabled: leadIdx <= 0 }}
              accessibilityLabel={p.leadLessA11y}
            >
              <Minus
                size={18}
                color={leadIdx <= 0 ? scheme.outline : scheme.onSecondaryContainer}
              />
            </Pressable>
            <Text style={styles.stepValue}>{s.common.durMin(prefs.departureAlertLeadMin)}</Text>
            <Pressable
              onPress={() =>
                update({
                  departureAlertLeadMin: LEAD_MIN[Math.min(LEAD_MIN.length - 1, leadIdx + 1)],
                })
              }
              disabled={leadIdx >= LEAD_MIN.length - 1}
              style={({ pressed }) => [
                styles.stepBtn,
                leadIdx >= LEAD_MIN.length - 1 && styles.stepBtnDisabled,
                pressed && leadIdx < LEAD_MIN.length - 1 && { opacity: 0.7 },
              ]}
              accessibilityRole="button"
              accessibilityState={{ disabled: leadIdx >= LEAD_MIN.length - 1 }}
              accessibilityLabel={p.leadMoreA11y}
            >
              <Plus
                size={18}
                color={
                  leadIdx >= LEAD_MIN.length - 1 ? scheme.outline : scheme.onSecondaryContainer
                }
              />
            </Pressable>
          </View>
        </View>
      ) : null}

      <ToggleRow
        icon={<BellRing size={18} color={scheme.onSurfaceVariant} />}
        title={p.disruptionTitle}
        hint={p.disruptionHint}
        value={prefs.disruptionAlertsEnabled}
        onChange={guarded((v) => ({ disruptionAlertsEnabled: v }))}
        disabled={!supported}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: scheme.surfaceContainerLow,
    borderRadius: shape.extraLarge,
    padding: 20,
    gap: 22,
  },
  warn: {
    ...type.bodySmall,
    color: scheme.onWarningContainer,
    backgroundColor: scheme.warningContainer,
    borderRadius: shape.small,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  trackingGroup: {
    gap: 12,
  },
  liveGroup: {
    backgroundColor: scheme.surfaceContainer,
    borderRadius: shape.medium,
    padding: 10,
  },
  liveWarning: {
    gap: 10,
    backgroundColor: scheme.warningContainer,
    borderRadius: shape.medium,
    padding: 12,
  },
  liveWarningText: {
    ...type.bodySmall,
    color: scheme.onWarningContainer,
    lineHeight: 18,
  },
  settingsAction: {
    maxWidth: '100%',
    minHeight: 44,
    alignSelf: 'flex-start',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: scheme.secondaryContainer,
    borderRadius: shape.medium,
    paddingHorizontal: 14,
  },
  settingsActionText: {
    ...type.labelMedium,
    color: scheme.onSecondaryContainer,
    fontWeight: '700',
    flexShrink: 1,
    textAlign: 'center',
  },
  divider: {
    height: 1,
    backgroundColor: scheme.outlineVariant,
    marginVertical: 2,
  },
  groupTitle: {
    ...type.titleSmall,
    color: scheme.onSurface,
    fontWeight: '700',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  rowDisabled: {
    opacity: 1,
  },
  rowIcon: {
    width: 20,
    alignItems: 'center',
  },
  rowText: {
    flex: 1,
    minWidth: 0,
    gap: 3,
  },
  rowTitle: {
    ...type.bodyLarge,
    color: scheme.onSurface,
    fontWeight: '500',
  },
  rowHint: {
    ...type.bodyMedium,
    color: scheme.onSurfaceVariant,
    lineHeight: 21,
  },
  switch: { minHeight: 48, minWidth: 52 },
  stepper: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: scheme.secondaryContainer,
    borderRadius: shape.medium,
    padding: 6,
    minHeight: 56,
    gap: 6,
  },
  leadSetting: {
    gap: 10,
    marginLeft: 32,
  },
  stepBtn: {
    width: 44,
    height: 44,
    borderRadius: shape.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepBtnDisabled: {
    opacity: 0.35,
  },
  stepValue: {
    ...type.labelLarge,
    color: scheme.onSecondaryContainer,
    flex: 1,
    textAlign: 'center',
    fontVariant: ['tabular-nums'],
  },
});
