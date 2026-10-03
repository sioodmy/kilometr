import { useEffect, useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { BellRing, Check, Minus, Navigation, Plus } from 'lucide-react-native';
import { elev, scheme, shape, type } from '../theme/tokens';
import { useStrings } from '../i18n';
import {
  areNotificationsSupported,
  canShowLiveUpdates,
  ensureNotificationPermission,
  isNativeTrackingSupported,
  isTrackingPlatform,
  permissionDeniedMessage,
  useNotificationPreferences,
} from '../services/notifications';

// Ustawienia powiadomień. Świadomie wyjaśniamy DLACZEGO coś jest włączone:
// „pasek postępu" brzmi dla użytkownika jak gadżet, a to jest realna,
// mierzalna rzecz — odliczanie liczone przez system, które działa, gdy
// aplikacja jest zamknięta.
//
// Przełącznik to naciskany pill, nie M3 Switch — w dolnym menu aplikacji
// (i przy okazji na ekranie tras) zrezygnowano z przełączników na rzecz
// przycisków, więc nie wprowadzamy ich z powrotem w Ustawieniach.

const LEAD_MIN = [1, 3, 5, 10, 15];

function leadIndex(min: number): number {
  const i = LEAD_MIN.indexOf(min);
  return i >= 0 ? i : LEAD_MIN.indexOf(5);
}

function Toggle({
  value,
  onChange,
  disabled,
  label,
  onText,
  offText,
}: {
  value: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
  label: string;
  onText: string;
  offText: string;
}) {
  return (
    <Pressable
      onPress={() => onChange(!value)}
      disabled={disabled}
      accessibilityRole="switch"
      accessibilityLabel={label}
      accessibilityState={{ checked: value, disabled: !!disabled }}
      hitSlop={8}
      style={({ pressed }) => [
        styles.toggle,
        value && styles.toggleOn,
        disabled && styles.toggleDisabled,
        pressed && !disabled && { opacity: 0.7 },
      ]}
    >
      {value ? (
        <Check size={14} color={scheme.onPrimaryContainer} strokeWidth={2.6} />
      ) : (
        <Minus size={14} color={scheme.onSurfaceVariant} strokeWidth={2.6} />
      )}
      <Text style={[styles.toggleText, value && styles.toggleTextOn]}>
        {value ? onText : offText}
      </Text>
    </Pressable>
  );
}

function ToggleRow({
  icon,
  title,
  hint,
  hintExtra,
  value,
  onChange,
  disabled,
  onText,
  offText,
}: {
  icon: React.ReactNode;
  title: string;
  hint: string;
  hintExtra?: string | null;
  value: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
  onText: string;
  offText: string;
}) {
  return (
    <View style={styles.row}>
      {icon}
      <View style={styles.rowText}>
        <Text style={styles.rowTitle}>{title}</Text>
        <Text style={styles.rowHint}>{hint}</Text>
        {hintExtra ? <Text style={styles.rowHintExtra}>{hintExtra}</Text> : null}
      </View>
      <Toggle
        value={value}
        onChange={onChange}
        disabled={disabled}
        label={title}
        onText={onText}
        offText={offText}
      />
    </View>
  );
}

export function NotificationPrefsCard() {
  const s = useStrings();
  const p = s.notificationPrefs;
  const { prefs, update } = useNotificationPreferences();
  const supported = areNotificationsSupported();
  // `null` = jeszcze nie wiadomo (odpytywanie jest asynchroniczne), więc
  // podpowiedzi o braku promocji nie pokazujemy, zanim nie zajdzie potrzeba.
  const [promotable, setPromotable] = useState<boolean | null>(null);

  useEffect(() => {
    let alive = true;
    void (async () => {
      const ok = await canShowLiveUpdates();
      if (alive) setPromotable(ok);
    })();
    return () => {
      alive = false;
    };
  }, []);

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

  const guarded = (patch: Parameters<typeof update>[0]) => async (next: boolean) => {
    if (!(await requirePermission(next))) return;
    await update(patch);
  };

  const leadIdx = leadIndex(prefs.departureAlertLeadMin);

  return (
    <View style={styles.card}>
      <View style={styles.cardTop}>
        <BellRing size={18} color={scheme.primary} />
        <Text style={styles.cardTitle}>{p.title}</Text>
      </View>

      {!supported ? <Text style={styles.warn}>{p.devBuildWarn}</Text> : null}

      <ToggleRow
        icon={<Navigation size={17} color={scheme.onSurfaceVariant} />}
        title={p.trackTitle}
        hint={p.trackHint}
        value={prefs.trackingEnabled}
        onChange={guarded({ trackingEnabled: true })}
        disabled={!supported}
        onText={p.on}
        offText={p.off}
      />

      <ToggleRow
        icon={<Navigation size={17} color={scheme.onSurfaceVariant} />}
        title={p.liveTitle}
        hint={isNativeTrackingSupported() ? p.liveHint : p.liveHintBasic}
        hintExtra={
          isTrackingPlatform() && promotable === false ? p.livePromoteHint : null
        }
        value={prefs.liveProgressEnabled}
        onChange={guarded({ liveProgressEnabled: true })}
        disabled={!supported}
        onText={p.on}
        offText={p.off}
      />

      <ToggleRow
        icon={<BellRing size={17} color={scheme.onSurfaceVariant} />}
        title={p.leaveTitle}
        hint={p.leaveHint}
        value={prefs.departureAlertsEnabled}
        onChange={guarded({ departureAlertsEnabled: true })}
        disabled={!supported}
        onText={p.on}
        offText={p.off}
      />

      {prefs.departureAlertsEnabled ? (
        <View style={styles.row}>
          <View style={styles.spacerIcon} />
          <View style={styles.rowText}>
            <Text style={styles.rowTitle}>{p.leadTitle}</Text>
            <Text style={styles.rowHint}>{p.leadHint}</Text>
          </View>
          <View style={styles.stepper}>
            <Pressable
              onPress={() =>
                update({ departureAlertLeadMin: LEAD_MIN[Math.max(0, leadIdx - 1)] })
              }
              disabled={leadIdx <= 0}
              style={({ pressed }) => [
                styles.stepBtn,
                leadIdx <= 0 && styles.stepBtnDisabled,
                pressed && { opacity: 0.7 },
              ]}
              hitSlop={6}
              accessibilityLabel={p.leadLessA11y}
            >
              <Minus size={15} color={scheme.onSecondaryContainer} />
            </Pressable>
            <Text style={styles.stepValue}>{s.common.durMin(prefs.departureAlertLeadMin)}</Text>
            <Pressable
              onPress={() =>
                update({ departureAlertLeadMin: LEAD_MIN[Math.min(LEAD_MIN.length - 1, leadIdx + 1)] })
              }
              disabled={leadIdx >= LEAD_MIN.length - 1}
              style={({ pressed }) => [
                styles.stepBtn,
                leadIdx >= LEAD_MIN.length - 1 && styles.stepBtnDisabled,
                pressed && { opacity: 0.7 },
              ]}
              hitSlop={6}
              accessibilityLabel={p.leadMoreA11y}
            >
              <Plus size={15} color={scheme.onSecondaryContainer} />
            </Pressable>
          </View>
        </View>
      ) : null}

      <ToggleRow
        icon={<BellRing size={17} color={scheme.onSurfaceVariant} />}
        title={p.disruptionTitle}
        hint={p.disruptionHint}
        value={prefs.disruptionAlertsEnabled}
        onChange={guarded({ disruptionAlertsEnabled: true })}
        disabled={!supported}
        onText={p.on}
        offText={p.off}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: scheme.surfaceContainer,
    borderRadius: shape.large,
    padding: 14,
    gap: 12,
    ...elev.level1,
  },
  cardTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  cardTitle: {
    ...type.titleMedium,
    fontWeight: '700',
    color: scheme.onSurface,
  },
  warn: {
    ...type.bodySmall,
    color: scheme.onWarningContainer,
    backgroundColor: scheme.warningContainer,
    borderRadius: shape.small,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  rowText: {
    flex: 1,
    gap: 2,
  },
  rowTitle: {
    ...type.bodyLarge,
    color: scheme.onSurface,
    fontWeight: '500',
  },
  rowHint: {
    ...type.bodySmall,
    color: scheme.onSurfaceVariant,
  },
  // Podpowiedź o tym, czego powiadomienie NIE potrafi — inaczej użytkownik
  // nie ma jak zrozumieć, dlaczego nic nie widać na ekranie blokady.
  rowHintExtra: {
    ...type.bodySmall,
    color: scheme.onWarningContainer,
    backgroundColor: scheme.warningContainer,
    borderRadius: shape.small,
    paddingHorizontal: 8,
    paddingVertical: 5,
    marginTop: 3,
  },
  spacerIcon: {
    width: 17,
  },
  toggle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: scheme.surfaceContainerHighest,
    borderRadius: shape.full,
    paddingHorizontal: 11,
    height: 34,
  },
  toggleOn: {
    backgroundColor: scheme.primaryContainer,
  },
  toggleDisabled: {
    opacity: 0.35,
  },
  toggleText: {
    ...type.labelMedium,
    color: scheme.onSurfaceVariant,
    fontWeight: '600',
  },
  toggleTextOn: {
    color: scheme.onPrimaryContainer,
  },
  stepper: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    backgroundColor: scheme.secondaryContainer,
    borderRadius: shape.full,
    paddingHorizontal: 4,
    height: 34,
  },
  stepBtn: {
    width: 28,
    height: 28,
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
    minWidth: 48,
    textAlign: 'center',
    fontVariant: ['tabular-nums'],
  },
});
