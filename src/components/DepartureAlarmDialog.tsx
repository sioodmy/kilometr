import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  AccessibilityInfo, ActivityIndicator, AppState, findNodeHandle, Modal, Pressable,
  ScrollView, StyleSheet, Text, useWindowDimensions, View, type StyleProp, type ViewStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useReducedMotion } from 'react-native-reanimated';
import { AlarmClock, Eye, Minus, Plus, Volume2, X } from 'lucide-react-native';
import { getLocaleSync, useStrings } from '../i18n';
import { scheme, type } from '../theme/tokens';
import type { Connection } from '../types/models';
import {
  cancelDepartureAlarm, getAlarmPermissions, isDepartureAlarmSupported, openAlarmPermission,
  previewDepartureAlarm, setDepartureAlarm, type AlarmPermissions, type DepartureAlarm,
} from '../services/departureAlarm';
import { departureAlarmTiming } from '../services/departureAlarmPlan';
import { clockFromMs } from '../services/notifications/format';
import { ensureNotificationPermission } from '../services/notifications';

function Action({ children, label, onPress, disabled = false, selected, style }: {
  children: ReactNode;
  label: string;
  onPress: () => void;
  disabled?: boolean;
  selected?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const [focused, setFocused] = useState(false);
  return <Pressable
    accessibilityRole="button" accessibilityLabel={label}
    accessibilityState={{ disabled, ...(selected !== undefined ? { selected } : {}) }}
    disabled={disabled} onPress={onPress}
    onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
    style={({ pressed }) => [styles.action, style, focused && styles.focused,
      pressed && styles.pressed, disabled && styles.disabled]}
  >{children}</Pressable>;
}

export function DepartureAlarmDialog({ connection, alarm, onClose }: {
  connection: Connection;
  alarm: DepartureAlarm | null;
  onClose: () => void;
}) {
  const s = useStrings();
  const a = s.alarm;
  const insets = useSafeAreaInsets();
  const { height, width, fontScale } = useWindowDimensions();
  const reduceMotion = useReducedMotion();
  const titleRef = useRef<Text>(null);
  const supported = isDepartureAlarmSupported();
  const current = alarm?.connectionId === connection.id ? alarm : null;
  const [reference] = useState(() => new Date());
  const initialTiming = departureAlarmTiming(connection, 1, reference);
  const availableMinutes = Math.floor(((initialTiming?.journeyAt ?? 0) - Date.now()) / 60_000);
  const [minutes, setMinutes] = useState(current?.leadMin ?? Math.max(1, Math.min(10, availableMinutes)));
  const [permissions, setPermissions] = useState<AlarmPermissions | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());
  const timing = departureAlarmTiming(connection, minutes, reference);
  const expired = !timing || timing.at <= now;
  const compact = width / fontScale < 340;
  const missing = permissions ? !permissions.notifications ? 'notifications'
    : !permissions.channel ? 'channel' : !permissions.exact ? 'exact'
      : !permissions.fullScreen ? 'fullScreen' : null : null;
  const permissionHint = missing === 'exact' ? a.exactHint : missing === 'fullScreen'
    ? a.fullScreenHint : missing ? a.notificationHint : null;
  const actionLabel = busy ? a.saving : missing === 'exact' ? a.exactAction
    : missing === 'fullScreen' ? a.fullScreenAction : missing ? a.notificationAction : a.save;

  useEffect(() => {
    let mounted = true;
    const refresh = () => {
      void getAlarmPermissions().then((value) => { if (mounted) setPermissions(value); })
        .catch(() => { if (mounted) setError(a.error); });
    };
    refresh();
    const sub = AppState.addEventListener('change', (state) => { if (state === 'active') refresh(); });
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => { mounted = false; sub.remove(); clearInterval(timer); };
  }, [a.error]);

  const changeMinutes = (value: number) => {
    setMinutes(Math.max(1, Math.min(60, value)));
    setError(null);
  };

  const submit = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      if (missing) {
        if (missing !== 'notifications' || !await ensureNotificationPermission()) {
          if (!await openAlarmPermission(missing)) setError(a.error);
        }
        setPermissions(await getAlarmPermissions());
        return;
      }
      if (await setDepartureAlarm(connection, minutes, reference)) onClose();
      else setError(timing && timing.at <= Date.now() ? a.tooLate : a.error);
    } catch { setError(a.error); }
    finally { setBusy(false); }
  };

  const remove = async () => {
    setBusy(true);
    try { await cancelDepartureAlarm(); onClose(); }
    catch { setError(a.error); }
    finally { setBusy(false); }
  };

  const preview = async () => {
    try {
      if (!await previewDepartureAlarm(connection, minutes, reference)) setError(a.error);
    } catch { setError(a.error); }
  };

  return <Modal transparent statusBarTranslucent navigationBarTranslucent
    animationType={reduceMotion ? 'none' : 'fade'}
    onRequestClose={() => { if (!busy) onClose(); }}
    onShow={() => {
      const tag = findNodeHandle(titleRef.current);
      if (tag) AccessibilityInfo.setAccessibilityFocus(tag);
    }}
  >
    <View style={[styles.overlay, { paddingTop: insets.top + 16, paddingBottom: insets.bottom + 16 }]}>
      <Pressable style={StyleSheet.absoluteFill} onPress={() => { if (!busy) onClose(); }}
        accessible={false} importantForAccessibility="no-hide-descendants" />
      <View style={[styles.dialog, { maxHeight: height - insets.top - insets.bottom - 32 }]}
        accessibilityViewIsModal importantForAccessibility="yes">
        <View style={styles.header}>
          <Text ref={titleRef} style={styles.title} accessibilityRole="header">{a.title}</Text>
          <Action label={s.common.close} onPress={onClose} disabled={busy} style={styles.close}>
            <X size={22} color={scheme.onSurfaceVariant} />
          </Action>
        </View>
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content} bounces={false}>
          <Text style={styles.question}>{a.question}</Text>
          <View style={[styles.stepper, compact && styles.stepperCompact]}>
            <Action label={a.less} disabled={busy || minutes <= 1} onPress={() => changeMinutes(minutes - 1)} style={styles.stepButton}>
              <Minus size={26} color={scheme.onSurface} />
            </Action>
            <View style={styles.amount} accessible accessibilityLabel={a.lead(minutes)} accessibilityLiveRegion="polite">
              <Text style={[styles.number, compact && styles.numberCompact]}>{minutes}</Text>
              <Text style={styles.unit}>{a.minutes(minutes)}</Text>
              <Text style={styles.before}>{a.before}</Text>
            </View>
            <Action label={a.more} disabled={busy || minutes >= 60} onPress={() => changeMinutes(minutes + 1)} style={styles.stepButton}>
              <Plus size={26} color={scheme.onSurface} />
            </Action>
          </View>
          <View style={[styles.presets, compact && styles.presetsCompact]}>
            {[5, 10, 15, 30].map((value) => <Action key={value} label={a.lead(value)}
              disabled={busy} selected={minutes === value} onPress={() => changeMinutes(value)}
              style={[styles.preset, compact && styles.presetCompact, minutes === value && styles.presetSelected]}>
              <Text style={[styles.presetText, minutes === value && styles.presetTextSelected]}>{s.common.durMin(value)}</Text>
            </Action>)}
          </View>
          {timing && <View style={styles.schedule}>
            <AlarmClock size={25} color={scheme.primary} />
            <View style={styles.scheduleText}>
              <Text style={styles.scheduleTitle}>{a.ringsAt(clockFromMs(timing.at))}</Text>
              <Text style={styles.scheduleDate}>{new Intl.DateTimeFormat(getLocaleSync(), {
                weekday: 'short', day: 'numeric', month: 'short',
              }).format(new Date(timing.at))} · {a.journeyAt(clockFromMs(timing.journeyAt))}</Text>
            </View>
          </View>}
          <View style={styles.sound}>
            <Volume2 size={17} color={scheme.onSurfaceVariant} />
            <Text style={styles.note}>{a.soundHint}</Text>
          </View>
          {supported && <Action label={a.preview} onPress={() => void preview()} disabled={busy} style={styles.preview}>
            <Eye size={18} color={scheme.primary} />
            <Text style={styles.previewText}>{a.preview}</Text>
          </Action>}
          {alarm && !current && <Text style={styles.note}>{a.replace}</Text>}
          {!supported && <Text style={styles.note}>{a.unavailable}</Text>}
          {permissionHint && <Text style={styles.note}>{permissionHint}</Text>}
          {(error || expired) && <Text style={styles.error} accessibilityRole="alert">
            {error ?? (timing && timing.journeyAt > now ? a.tooLate : a.past)}
          </Text>}
        </ScrollView>
        <View style={styles.footer}>
          <Action label={actionLabel} onPress={() => void submit()}
            disabled={busy || !supported || !permissions || expired} style={styles.confirm}>
            {busy ? <ActivityIndicator color={scheme.onPrimary} /> : <AlarmClock size={21} color={scheme.onPrimary} />}
            <Text style={styles.confirmText}>{actionLabel}</Text>
          </Action>
          {current && <Action label={a.remove} onPress={() => void remove()} disabled={busy}>
            <Text style={styles.removeText}>{a.remove}</Text>
          </Action>}
        </View>
      </View>
    </View>
  </Modal>;
}

const styles = StyleSheet.create({
  overlay: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 20, backgroundColor: '#00000099' },
  dialog: { width: '100%', maxWidth: 440, backgroundColor: scheme.surfaceContainer, borderRadius: 36, paddingTop: 16, flexShrink: 1, overflow: 'hidden' },
  header: { paddingLeft: 24, paddingRight: 12, flexDirection: 'row', alignItems: 'center', gap: 4 },
  title: { fontSize: 24, fontWeight: '600', letterSpacing: -0.6, color: scheme.onSurface, flex: 1 },
  action: { minHeight: 48, minWidth: 48, borderWidth: 2, borderColor: 'transparent', alignItems: 'center', justifyContent: 'center', borderRadius: 16, flexDirection: 'row', gap: 10, paddingHorizontal: 8, paddingVertical: 10 },
  focused: { borderColor: scheme.primary },
  pressed: { opacity: 0.72, transform: [{ scale: 0.97 }] },
  disabled: { opacity: 0.45 },
  close: { width: 48, height: 48 },
  content: { paddingHorizontal: 24, paddingBottom: 8, gap: 20 },
  question: { ...type.bodyLarge, color: scheme.onSurfaceVariant, lineHeight: 23, paddingTop: 8 },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 8 },
  stepperCompact: { gap: 0 },
  stepButton: { width: 52, height: 52, borderRadius: 20, backgroundColor: scheme.surfaceContainerHighest },
  amount: { flex: 1, minWidth: 0, alignItems: 'center', paddingVertical: 8 },
  number: { fontSize: 88, lineHeight: 96, fontWeight: '500', letterSpacing: -4, color: scheme.primary, fontVariant: ['tabular-nums'], includeFontPadding: false },
  numberCompact: { fontSize: 64, lineHeight: 76, letterSpacing: -2 },
  unit: { ...type.titleMedium, color: scheme.onSurface },
  before: { ...type.bodyMedium, color: scheme.onSurfaceVariant, textAlign: 'center', marginTop: 4 },
  presets: { flexDirection: 'row', gap: 6 },
  presetsCompact: { flexWrap: 'wrap' },
  preset: { flex: 1, backgroundColor: scheme.surfaceContainerHigh, borderRadius: 14, minHeight: 48, paddingHorizontal: 2 },
  presetCompact: { flexBasis: '45%' },
  presetSelected: { backgroundColor: scheme.primaryContainer, borderColor: scheme.primary },
  presetText: { ...type.labelLarge, color: scheme.onSurfaceVariant, textAlign: 'center' },
  presetTextSelected: { color: scheme.onPrimaryContainer, fontWeight: '700' },
  schedule: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 18, paddingHorizontal: 16, backgroundColor: scheme.surfaceContainerHigh, borderRadius: 20 },
  scheduleText: { flex: 1, gap: 5 },
  scheduleTitle: { ...type.titleMedium, color: scheme.onSurface, fontWeight: '600', fontVariant: ['tabular-nums'] },
  scheduleDate: { ...type.bodySmall, lineHeight: 18, color: scheme.onSurfaceVariant },
  sound: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  note: { ...type.bodyMedium, color: scheme.onSurfaceVariant, lineHeight: 21, flexShrink: 1 },
  preview: { alignSelf: 'center', marginTop: -10 },
  previewText: { ...type.labelLarge, color: scheme.primary, flexShrink: 1, textAlign: 'center' },
  error: { ...type.bodyMedium, color: scheme.error, lineHeight: 21 },
  footer: { paddingHorizontal: 24, paddingTop: 12, paddingBottom: 24, gap: 4 },
  confirm: { backgroundColor: scheme.primary, minHeight: 60, borderRadius: 24, paddingHorizontal: 16 },
  confirmText: { ...type.titleMedium, color: scheme.onPrimary, fontWeight: '700', flexShrink: 1, textAlign: 'center' },
  removeText: { ...type.labelLarge, color: scheme.error, flexShrink: 1, textAlign: 'center' },
});
