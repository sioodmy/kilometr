import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator, AppState, BackHandler, Platform, Pressable, StyleSheet, Text,
  useWindowDimensions, View,
} from 'react-native';
import BottomSheet, { BottomSheetBackdrop, BottomSheetScrollView } from '@gorhom/bottom-sheet';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AlarmClock, Minus, Plus, Volume2, X } from './icons';
import { scheme, shape, type } from '../theme/tokens';
import { getLocaleSync, useStrings } from '../i18n';
import type { Connection } from '../types/models';
import {
  cancelDepartureAlarm, getAlarmPermissions, isDepartureAlarmSupported, openAlarmPermission,
  setDepartureAlarm, type AlarmPermissions, type DepartureAlarm,
} from '../services/departureAlarm';
import { departureAlarmTiming } from '../services/departureAlarmPlan';
import { clockFromMs } from '../services/notifications/format';
import { ensureNotificationPermission } from '../services/notifications';

// Budzik na podróż, montowany warunkowo na trasie. Konwencja jak ShareConnectionSheet:
// zamknięcie swipe/backdrop/back wywołuje onClose, przy busy zamykanie jest blokowane.
export function DepartureAlarmSheet({ connection, alarm, onClose }: {
  connection: Connection;
  alarm: DepartureAlarm | null;
  onClose: () => void;
}) {
  const s = useStrings();
  const a = s.alarm;
  const insets = useSafeAreaInsets();
  const sheet = useRef<BottomSheet>(null);
  const busyRef = useRef(false);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const { width, fontScale } = useWindowDimensions();
  const supported = isDepartureAlarmSupported();
  const current = alarm?.connectionId === connection.id ? alarm : null;
  const [reference] = useState(() => new Date(current?.referenceAt ?? Date.now()));
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
  const confirmationDisabled = busy || !supported || !permissions || expired;
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

  useEffect(() => {
    const back = BackHandler.addEventListener('hardwareBackPress', () => {
      if (!busyRef.current) sheet.current?.close();
      return true;
    });
    return () => back.remove();
  }, []);

  const changeMinutes = (value: number) => {
    setMinutes(Math.max(1, Math.min(60, value)));
    setError(null);
  };

  const submit = async () => {
    if (busyRef.current) return;
    busyRef.current = true;
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
      if (await setDepartureAlarm(connection, minutes, reference)) sheet.current?.close();
      else setError(timing && timing.at <= Date.now() ? a.tooLate : a.error);
    } catch { setError(a.error); }
    finally { busyRef.current = false; setBusy(false); }
  };

  const remove = async () => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    try { await cancelDepartureAlarm(); sheet.current?.close(); }
    catch { setError(a.error); }
    finally { busyRef.current = false; setBusy(false); }
  };

  return (
    <BottomSheet
      ref={sheet}
      index={0}
      snapPoints={['90%']}
      enableDynamicSizing={false}
      topInset={insets.top}
      enablePanDownToClose
      onClose={onCloseRef.current}
      backgroundStyle={styles.sheet}
      handleIndicatorStyle={styles.handle}
      backdropComponent={(props) => (
        <BottomSheetBackdrop
          {...props}
          appearsOnIndex={0}
          disappearsOnIndex={-1}
          accessibilityLabel={s.common.close}
        />
      )}
    >
      <View style={styles.header}>
        <Text style={styles.title} accessibilityRole="header">
          {a.title}
        </Text>
        <Pressable
          style={styles.close}
          onPress={() => { if (!busyRef.current) sheet.current?.close(); }}
          accessibilityRole="button"
          accessibilityLabel={s.common.close}
        >
          <X size={22} color={scheme.onSurface} />
        </Pressable>
      </View>
      <BottomSheetScrollView
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 24 }]}
      >
        <Text style={styles.question}>{a.question}</Text>
        <View style={[styles.stepper, compact && styles.stepperCompact]}>
          <Pressable
            accessibilityRole="button" accessibilityLabel={a.less}
            accessibilityState={{ disabled: busy || minutes <= 1 }}
            disabled={busy || minutes <= 1}
            onPress={() => changeMinutes(minutes - 1)}
            style={({ pressed }) => [styles.stepButton, pressed && styles.pressed,
              (busy || minutes <= 1) && styles.disabled]}
          >
            <Minus size={26} color={scheme.onSurface} />
          </Pressable>
          <View style={styles.amount} accessible
            accessibilityLabel={a.lead(minutes)} accessibilityLiveRegion="polite">
            <Text style={[styles.number, compact && styles.numberCompact]}>{minutes}</Text>
            <Text style={styles.unit}>{a.minutes(minutes)}</Text>
            <Text style={styles.before}>{a.before}</Text>
          </View>
          <Pressable
            accessibilityRole="button" accessibilityLabel={a.more}
            accessibilityState={{ disabled: busy || minutes >= 60 }}
            disabled={busy || minutes >= 60}
            onPress={() => changeMinutes(minutes + 1)}
            style={({ pressed }) => [styles.stepButton, pressed && styles.pressed,
              (busy || minutes >= 60) && styles.disabled]}
          >
            <Plus size={26} color={scheme.onSurface} />
          </Pressable>
        </View>
        <View style={[styles.presets, compact && styles.presetsCompact]}>
          {[5, 10, 15, 30].map((value) => (
            <Pressable
              key={value}
              accessibilityRole="button" accessibilityLabel={a.lead(value)}
              accessibilityState={{ disabled: busy, selected: minutes === value }}
              disabled={busy}
              onPress={() => changeMinutes(value)}
              style={({ pressed }) => [styles.preset, compact && styles.presetCompact,
                minutes === value && styles.presetSelected, pressed && styles.pressed]}
            >
              <Text style={[styles.presetText, minutes === value && styles.presetTextSelected]}>
                {s.common.durMin(value)}
              </Text>
            </Pressable>
          ))}
        </View>
        {timing && (
          <View style={styles.schedule}>
            <AlarmClock size={25} color={scheme.primary} />
            <View style={styles.scheduleText}>
              <Text style={styles.scheduleTitle}>{a.ringsAt(clockFromMs(timing.at))}</Text>
              <Text style={styles.scheduleDate}>{new Intl.DateTimeFormat(getLocaleSync(), {
                weekday: 'short', day: 'numeric', month: 'short',
              }).format(new Date(timing.at))} · {a.journeyAt(clockFromMs(timing.journeyAt))}</Text>
            </View>
          </View>
        )}
        <View style={styles.sound}>
          <Volume2 size={17} color={scheme.onSurfaceVariant} />
          <Text style={styles.noteText}>
            {Platform.OS === 'ios' ? s.ios.alarmHint : a.soundHint}
          </Text>
        </View>
        {alarm && !current && <Text style={styles.noteText}>{a.replace}</Text>}
        {!supported && <Text style={styles.noteText}>{a.unavailable}</Text>}
        {permissionHint && <Text style={styles.noteText}>{permissionHint}</Text>}
        {(error || expired) && (
          <Text style={styles.error} accessibilityRole="alert">
            {error ?? (timing && timing.journeyAt > now ? a.tooLate : a.past)}
          </Text>
        )}
        <Pressable
          onPress={() => void submit()}
          disabled={confirmationDisabled}
          accessibilityRole="button"
          accessibilityLabel={actionLabel}
          accessibilityState={{ busy, disabled: confirmationDisabled }}
          style={({ pressed }) => [styles.confirm, pressed && styles.pressed,
            confirmationDisabled && styles.disabled]}
        >
          {busy
            ? <ActivityIndicator color={scheme.onPrimary} />
            : <AlarmClock size={21} color={scheme.onPrimary} />}
          <Text style={styles.confirmText}>{actionLabel}</Text>
        </Pressable>
        {current && (
          <Pressable
            onPress={() => void remove()}
            disabled={busy}
            accessibilityRole="button"
            accessibilityLabel={a.remove}
            accessibilityState={{ disabled: busy }}
            style={({ pressed }) => [styles.remove, pressed && styles.pressed, busy && styles.disabled]}
          >
            <Text style={styles.removeText}>{a.remove}</Text>
          </Pressable>
        )}
      </BottomSheetScrollView>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  sheet: {
    backgroundColor: scheme.surfaceContainerLow,
    borderTopLeftRadius: 32,
    borderTopRightRadius: 32,
  },
  handle: { backgroundColor: scheme.outline, width: 36 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingLeft: 24,
    paddingRight: 12,
    paddingBottom: 8,
  },
  title: { ...type.titleLarge, fontWeight: '600', flex: 1, color: scheme.onSurface },
  close: {
    width: 48,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: shape.medium,
  },
  content: { paddingHorizontal: 20, gap: 16, width: '100%', maxWidth: 600, alignSelf: 'center' },
  question: { ...type.bodyLarge, color: scheme.onSurfaceVariant, lineHeight: 23 },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  stepperCompact: { gap: 0 },
  stepButton: {
    width: 52,
    height: 52,
    borderRadius: shape.extraLarge,
    backgroundColor: scheme.surfaceContainerHighest,
    alignItems: 'center',
    justifyContent: 'center',
  },
  amount: { flex: 1, minWidth: 0, alignItems: 'center', paddingVertical: 8 },
  number: {
    fontSize: 88,
    lineHeight: 96,
    fontWeight: '500',
    letterSpacing: -4,
    color: scheme.primary,
    fontVariant: ['tabular-nums'],
    includeFontPadding: false,
  },
  numberCompact: { fontSize: 64, lineHeight: 76, letterSpacing: -2 },
  unit: { ...type.titleMedium, color: scheme.onSurface },
  before: { ...type.bodyMedium, color: scheme.onSurfaceVariant, textAlign: 'center', marginTop: 4 },
  presets: { flexDirection: 'row', gap: 6 },
  presetsCompact: { flexWrap: 'wrap' },
  preset: {
    flex: 1,
    backgroundColor: scheme.surfaceContainerHigh,
    borderRadius: shape.medium,
    minHeight: 48,
    paddingHorizontal: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  presetCompact: { flexBasis: '45%' },
  presetSelected: { backgroundColor: scheme.primaryContainer },
  presetText: { ...type.labelLarge, color: scheme.onSurfaceVariant, textAlign: 'center' },
  presetTextSelected: { color: scheme.onPrimaryContainer, fontWeight: '700' },
  schedule: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingVertical: 18,
    paddingHorizontal: 16,
    backgroundColor: scheme.surfaceContainerHigh,
    borderRadius: shape.extraLarge,
  },
  scheduleText: { flex: 1, gap: 5 },
  scheduleTitle: { ...type.titleMedium, color: scheme.onSurface, fontWeight: '600', fontVariant: ['tabular-nums'] },
  scheduleDate: { ...type.bodySmall, lineHeight: 18, color: scheme.onSurfaceVariant },
  sound: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  noteText: { ...type.bodyMedium, color: scheme.onSurfaceVariant, lineHeight: 21, flexShrink: 1, flex: 1 },
  error: { ...type.bodyMedium, color: scheme.error, lineHeight: 21 },
  confirm: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    minHeight: 60,
    padding: 16,
    borderRadius: shape.extraLarge,
    backgroundColor: scheme.primary,
  },
  confirmText: { ...type.titleMedium, color: scheme.onPrimary, fontWeight: '700', flexShrink: 1, textAlign: 'center' },
  remove: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 48,
    paddingVertical: 12,
    borderRadius: shape.medium,
  },
  removeText: { ...type.labelLarge, color: scheme.error, flexShrink: 1, textAlign: 'center' },
  pressed: { opacity: 0.75 },
  disabled: { opacity: 0.5 },
});
