import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { BellRing, Minus, Navigation, Plus } from 'lucide-react-native';
import { elev, scheme, shape, type } from '../theme/tokens';
import { M3Switch } from './M3Switch';
import {
  areNotificationsSupported,
  isDynamicIslandPlatform,
  isNativeTrackingSupported,
  permissionDeniedMessage,
  ensureNotificationPermission,
  useNotificationPreferences,
} from '../services/notifications';

// Ustawienia powiadomień. Świadomie wyjaśniamy DLACZEGO coś jest włączone:
// „pasek postępu" i „Dynamic Island" brzmią dla użytkownika jak gadżet,
// a to są realne, mierzalne rzeczy (odliczanie bez budzenia aplikacji).

const LEAD_MIN = [1, 3, 5, 10, 15];

function leadIndex(min: number): number {
  const i = LEAD_MIN.indexOf(min);
  return i >= 0 ? i : LEAD_MIN.indexOf(5);
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
    <View style={styles.row}>
      {icon}
      <View style={styles.rowText}>
        <Text style={styles.rowTitle}>{title}</Text>
        <Text style={styles.rowHint}>{hint}</Text>
      </View>
      <M3Switch value={value} onChange={onChange} disabled={disabled} label={title} />
    </View>
  );
}

export function NotificationPrefsCard() {
  const { prefs, update } = useNotificationPreferences();
  const supported = areNotificationsSupported();

  const requirePermission = async (next: boolean): Promise<boolean> => {
    if (!next) return true;
    if (!supported) {
      Alert.alert(
        'Powiadomienia niedostępne',
        'Śledzenie podróży wymaga builda deweloperskiego — Expo Go nie wspiera powiadomień.',
      );
      return false;
    }
    const ok = await ensureNotificationPermission();
    if (!ok) Alert.alert('Powiadomienia wyłączone', permissionDeniedMessage());
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
        <Text style={styles.cardTitle}>Powiadomienia</Text>
      </View>

      {!supported ? (
        <Text style={styles.warn}>
          Wymaga builda deweloperskiego. W Expo Go powiadomienia nie działają.
        </Text>
      ) : null}

      <ToggleRow
        icon={<Navigation size={17} color={scheme.onSurfaceVariant} />}
        title="Śledzenie podróży"
        hint="Trwała powiadomienie z odliczaniem do odjazdu i postępem podróży."
        value={prefs.trackingEnabled}
        onChange={guarded({ trackingEnabled: true })}
        disabled={!supported}
      />

      <ToggleRow
        icon={<Navigation size={17} color={scheme.onSurfaceVariant} />}
        title="Pasek postępu i licznik"
        hint={
          isDynamicIslandPlatform()
            ? 'Dynamic Island na ekranie blokady — licznik działa nawet przy uśpionej aplikacji.'
            : isNativeTrackingSupported()
              ? 'Pasek postępu i odliczanie liczone przez system, bez budzenia aplikacji.'
              : 'Postęp i odliczanie w treści powiadomienia.'
        }
        value={prefs.liveProgressEnabled}
        onChange={guarded({ liveProgressEnabled: true })}
        disabled={!supported}
      />

      <ToggleRow
        icon={<BellRing size={17} color={scheme.onSurfaceVariant} />}
        title="Alert „wyjdź”"
        hint="Głośny przypomnienie przed odjazdem. Planowane z wyprzedzeniem, więc działa też w tle."
        value={prefs.departureAlertsEnabled}
        onChange={guarded({ departureAlertsEnabled: true })}
        disabled={!supported}
      />

      {prefs.departureAlertsEnabled ? (
        <View style={styles.row}>
          <View style={styles.spacerIcon} />
          <View style={styles.rowText}>
            <Text style={styles.rowTitle}>Ile wcześniej ostrzec</Text>
            <Text style={styles.rowHint}>Ile minut przed odjazdem zadzwoni przypomnienie.</Text>
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
              accessibilityLabel="Mniej minut ostrzeżenia"
            >
              <Minus size={15} color={scheme.onSecondaryContainer} />
            </Pressable>
            <Text style={styles.stepValue}>{prefs.departureAlertLeadMin} min</Text>
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
              accessibilityLabel="Więcej minut ostrzeżenia"
            >
              <Plus size={15} color={scheme.onSecondaryContainer} />
            </Pressable>
          </View>
        </View>
      ) : null}

      <ToggleRow
        icon={<BellRing size={17} color={scheme.onSurfaceVariant} />}
        title="Ostrzeżenie o opóźnieniu"
        hint="Gdy kurs spóźnia się wyraźnie ponad to, co pokazywał poprzednio."
        value={prefs.disruptionAlertsEnabled}
        onChange={guarded({ disruptionAlertsEnabled: true })}
        disabled={!supported}
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
  spacerIcon: {
    width: 17,
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
