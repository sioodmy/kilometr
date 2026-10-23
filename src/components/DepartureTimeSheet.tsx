import { useCallback, useEffect, useRef, useState } from 'react';
import {
  BackHandler,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import BottomSheet, {
  BottomSheetBackdrop,
  type BottomSheetBackdropProps,
} from '@gorhom/bottom-sheet';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Check, X } from 'lucide-react-native';
import { scheme, shape, type } from '../theme/tokens';
import { getLocaleSync, useStrings } from '../i18n';
import type { JourneyTimeMode } from '../services/routing/types';

export interface JourneyTimeSelection {
  timeSec: number | undefined;
  mode: JourneyTimeMode;
  label: string;
}

interface DepartureTimeSheetProps {
  initialTimeSec?: number;
  initialMode?: JourneyTimeMode;
  onClose: () => void;
  onSelect: (result: JourneyTimeSelection) => void;
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

const HOURS = Array.from({ length: 24 }, (_, i) => i);
const MINUTES = Array.from({ length: 60 }, (_, i) => i);
const HANDLE_HEIGHT = 24;

function SheetHandle() {
  return (
    <View style={styles.handleContainer}>
      <View style={styles.handle} />
    </View>
  );
}

function WheelPicker({
  values,
  selectedValue,
  onValueChange,
  label,
  itemHeight,
}: {
  values: number[];
  selectedValue: number;
  onValueChange: (val: number) => void;
  label: string;
  itemHeight: number;
}) {
  const scrollRef = useRef<ScrollView>(null);
  const isUserScrolling = useRef(false);

  useEffect(() => {
    const index = values.indexOf(selectedValue);
    if (index < 0 || isUserScrolling.current) return;
    const frame = requestAnimationFrame(() => {
      scrollRef.current?.scrollTo({ y: index * itemHeight, animated: false });
    });
    return () => cancelAnimationFrame(frame);
  }, [selectedValue, values, itemHeight]);

  const handleScrollEnd = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    isUserScrolling.current = false;
    const index = Math.max(
      0,
      Math.min(values.length - 1, Math.round(e.nativeEvent.contentOffset.y / itemHeight)),
    );
    onValueChange(values[index]);
  };

  return (
    <View
      style={styles.wheelCol}
      accessible
      accessibilityRole="adjustable"
      accessibilityLabel={label}
      accessibilityValue={{
        min: values[0],
        max: values[values.length - 1],
        now: selectedValue,
        text: pad(selectedValue),
      }}
      accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
      onAccessibilityAction={({ nativeEvent }) => {
        const step =
          nativeEvent.actionName === 'increment'
            ? 1
            : nativeEvent.actionName === 'decrement'
              ? -1
              : 0;
        if (step === 0) return;
        isUserScrolling.current = false;
        const index = Math.max(
          0,
          Math.min(values.length - 1, values.indexOf(selectedValue) + step),
        );
        onValueChange(values[index]);
      }}
    >
      <ScrollView
        ref={scrollRef}
        style={{ height: itemHeight * 3 }}
        showsVerticalScrollIndicator={false}
        snapToInterval={itemHeight}
        decelerationRate="fast"
        nestedScrollEnabled
        overScrollMode="never"
        contentOffset={{ x: 0, y: Math.max(0, values.indexOf(selectedValue)) * itemHeight }}
        contentContainerStyle={{ paddingVertical: itemHeight }}
        importantForAccessibility="no-hide-descendants"
        accessibilityElementsHidden
        onScrollBeginDrag={() => {
          isUserScrolling.current = true;
        }}
        onScrollEndDrag={(event) => {
          if (!event.nativeEvent.velocity?.y) handleScrollEnd(event);
        }}
        onMomentumScrollEnd={handleScrollEnd}
      >
        {values.map((value) => (
          <Pressable
            key={value}
            onPress={() => {
              isUserScrolling.current = false;
              onValueChange(value);
            }}
            style={({ pressed }) => [
              styles.wheelItem,
              { height: itemHeight },
              pressed && styles.pressed,
            ]}
          >
            <Text
              style={[styles.wheelItemText, value === selectedValue && styles.wheelItemTextActive]}
            >
              {pad(value)}
            </Text>
          </Pressable>
        ))}
      </ScrollView>
    </View>
  );
}

export function DepartureTimeSheet({
  initialTimeSec,
  initialMode = 'departure',
  onClose,
  onSelect,
}: DepartureTimeSheetProps) {
  const s = useStrings();
  const insets = useSafeAreaInsets();
  const { height, width, fontScale } = useWindowDimensions();
  const itemHeight = Math.max(56, Math.ceil(48 * fontScale));
  const compact = width / fontScale < 300;
  const sheetHeight = Math.min(
    height - insets.top - insets.bottom - 16,
    724 + Math.max(0, fontScale - 1) * 420,
  );
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      closeRef.current();
      return true;
    });
    return () => sub.remove();
  }, []);

  const [openedAt] = useState(() => new Date());
  const [mode, setMode] = useState(initialMode);
  const initialSeconds = initialTimeSec ?? openedAt.getHours() * 3600 + openedAt.getMinutes() * 60;
  const [isNow, setIsNow] = useState(initialTimeSec === undefined && initialMode === 'departure');
  const [day, setDay] = useState<'today' | 'tomorrow'>(
    initialSeconds >= 86400 ? 'tomorrow' : 'today',
  );
  const [hour, setHour] = useState(Math.floor(initialSeconds / 3600) % 24);
  const [minute, setMinute] = useState(Math.floor((initialSeconds % 3600) / 60));

  const handleQuickAdd = (addMinutes: number) => {
    const now = new Date();
    const baseSec = isNow
      ? now.getHours() * 3600 + now.getMinutes() * 60
      : (day === 'tomorrow' ? 86400 : 0) + hour * 3600 + minute * 60;
    const totalSec = Math.min(2 * 86400 - 60, baseSec + addMinutes * 60);
    setIsNow(false);
    setHour(Math.floor(totalSec / 3600) % 24);
    setMinute(Math.floor((totalSec % 3600) / 60));
    setDay(totalSec >= 86400 ? 'tomorrow' : 'today');
  };

  const handleSetNow = () => {
    const now = new Date();
    setIsNow(mode === 'departure');
    setDay('today');
    setHour(now.getHours());
    setMinute(now.getMinutes());
  };

  const dayLabel = day === 'today' ? s.common.today : s.common.tomorrow;
  const selection =
    isNow && mode === 'departure'
      ? s.common.now
      : mode === 'arrival'
        ? s.timeSheet.selectedArrival(dayLabel, pad(hour), pad(minute))
        : s.timeSheet.selectedDeparture(dayLabel, pad(hour), pad(minute));
  const handleConfirm = () => {
    onSelect({
      timeSec:
        isNow && mode === 'departure'
          ? undefined
          : (day === 'tomorrow' ? 86400 : 0) + hour * 3600 + minute * 60,
      mode,
      label: selection,
    });
    onClose();
  };

  const renderBackdrop = useCallback(
    (props: BottomSheetBackdropProps) => (
      <BottomSheetBackdrop
        {...props}
        appearsOnIndex={0}
        disappearsOnIndex={-1}
        opacity={0.55}
        pressBehavior="close"
        accessibilityLabel={s.common.close}
        accessibilityRole="button"
      />
    ),
    [s.common.close],
  );

  const dateFormat = new Intl.DateTimeFormat(getLocaleSync(), { day: 'numeric', month: 'short' });
  const tomorrow = new Date(openedAt);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const days = [
    { value: 'today' as const, label: s.timeSheet.dayToday, date: dateFormat.format(openedAt) },
    {
      value: 'tomorrow' as const,
      label: s.timeSheet.dayTomorrow,
      date: dateFormat.format(tomorrow),
    },
  ];

  return (
    <BottomSheet
      index={0}
      snapPoints={[sheetHeight]}
      handleComponent={SheetHandle}
      bottomInset={insets.bottom}
      enableDynamicSizing={false}
      enablePanDownToClose
      enableContentPanningGesture={false}
      onClose={onClose}
      backdropComponent={renderBackdrop}
      backgroundStyle={styles.sheet}
    >
      <View style={{ height: sheetHeight - HANDLE_HEIGHT }} accessibilityViewIsModal>
        <View style={styles.header}>
          <Text style={styles.title} accessibilityRole="header">
            {s.timeSheet.title}
          </Text>
          <Pressable
            onPress={onClose}
            accessibilityRole="button"
            accessibilityLabel={s.common.close}
            style={({ pressed }) => [styles.closeBtn, pressed && styles.pressed]}
          >
            <X size={22} color={scheme.onSurfaceVariant} />
          </Pressable>
        </View>

        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.content}
          showsVerticalScrollIndicator={false}
          nestedScrollEnabled
          overScrollMode="never"
        >
          <View
            style={[styles.modeSelector, compact && styles.modeSelectorCompact]}
            accessibilityRole="tablist"
          >
            {(
              [
                { value: 'departure', label: s.timeSheet.modeDeparture },
                { value: 'arrival', label: s.timeSheet.modeArrival },
              ] as const
            ).map((option) => {
              const active = mode === option.value;
              return (
                <Pressable
                  key={option.value}
                  accessibilityRole="tab"
                  accessibilityState={{ selected: active }}
                  onPress={() => {
                    setMode(option.value);
                    if (option.value === 'arrival') setIsNow(false);
                  }}
                  style={({ pressed }) => [
                    styles.modeTab,
                    active && styles.modeTabActive,
                    pressed && styles.pressed,
                  ]}
                >
                  {active && (
                    <Check size={18} color={scheme.onPrimaryContainer} accessible={false} />
                  )}
                  <Text style={[styles.modeText, active && styles.presetTextActive]}>
                    {option.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
          <View style={[styles.presetsRow, compact && styles.presetsCompact]}>
            {[
              { label: s.common.now, action: handleSetNow, active: isNow },
              { label: s.common.add15, action: () => handleQuickAdd(15), active: false },
              { label: s.common.add30, action: () => handleQuickAdd(30), active: false },
              { label: s.common.add60, action: () => handleQuickAdd(60), active: false },
            ].map((preset) => (
              <Pressable
                key={preset.label}
                onPress={preset.action}
                accessibilityRole="button"
                accessibilityState={{ selected: preset.active }}
                style={({ pressed }) => [
                  styles.preset,
                  compact && styles.presetCompact,
                  preset.active && styles.presetActive,
                  pressed && styles.pressed,
                ]}
              >
                <Text style={[styles.presetText, preset.active && styles.presetTextActive]}>
                  {preset.label}
                </Text>
              </Pressable>
            ))}
          </View>

          <View style={[styles.daySelector, compact && styles.daySelectorCompact]}>
            {days.map((option) => {
              const active = day === option.value;
              return (
                <Pressable
                  key={option.value}
                  onPress={() => {
                    setDay(option.value);
                    setIsNow(false);
                  }}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                  style={({ pressed }) => [
                    styles.dayTab,
                    active && styles.dayTabActive,
                    pressed && styles.pressed,
                  ]}
                >
                  <Text style={[styles.dayLabel, active && styles.dayLabelActive]}>
                    {option.label}
                  </Text>
                  <Text style={[styles.dayDate, active && styles.dayDateActive]}>
                    {option.date}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          <View style={styles.timePicker}>
            <View style={styles.labelsRow}>
              <Text style={styles.wheelColLabel}>{s.timeSheet.hourLabel}</Text>
              <View style={styles.colonSpace} />
              <Text style={styles.wheelColLabel}>{s.timeSheet.minuteLabel}</Text>
            </View>
            <View style={styles.wheelsRow}>
              <View
                pointerEvents="none"
                style={[styles.wheelHighlight, { top: itemHeight, height: itemHeight }]}
              />
              <WheelPicker
                values={HOURS}
                selectedValue={hour}
                label={s.timeSheet.hourLabel}
                itemHeight={itemHeight}
                onValueChange={(value) => {
                  setIsNow(false);
                  setHour(value);
                }}
              />
              <Text style={styles.wheelColon} importantForAccessibility="no">
                :
              </Text>
              <WheelPicker
                values={MINUTES}
                selectedValue={minute}
                label={s.timeSheet.minuteLabel}
                itemHeight={itemHeight}
                onValueChange={(value) => {
                  setIsNow(false);
                  setMinute(value);
                }}
              />
            </View>
          </View>

          <View style={[styles.presetsRow, compact && styles.presetsCompact]}>
            {[0, 15, 30, 45].map((value) => {
              const active = !isNow && minute === value;
              return (
                <Pressable
                  key={value}
                  onPress={() => {
                    setIsNow(false);
                    setMinute(value);
                  }}
                  accessibilityRole="button"
                  accessibilityLabel={s.timeSheet.minutePreset(pad(value))}
                  accessibilityState={{ selected: active }}
                  style={({ pressed }) => [
                    styles.minutePreset,
                    compact && styles.presetCompact,
                    active && styles.minutePresetActive,
                    pressed && styles.pressed,
                  ]}
                >
                  <Text style={[styles.minutePresetText, active && styles.presetTextActive]}>
                    :{pad(value)}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </ScrollView>

        <View style={styles.footer}>
          <Text style={styles.selection} accessibilityLiveRegion="polite">
            {selection}
          </Text>
          <Pressable
            onPress={handleConfirm}
            accessibilityRole="button"
            accessibilityLabel={s.timeSheet.confirmAction}
            accessibilityHint={selection}
            style={({ pressed }) => [styles.confirmBtn, pressed && { opacity: 0.85 }]}
          >
            <Text style={styles.confirmText}>{s.timeSheet.confirmAction}</Text>
          </Pressable>
        </View>
      </View>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  sheet: {
    borderTopLeftRadius: shape.extraLarge,
    borderTopRightRadius: shape.extraLarge,
    backgroundColor: scheme.surfaceContainerLow,
  },
  handleContainer: { height: HANDLE_HEIGHT, alignItems: 'center', justifyContent: 'center' },
  handle: { backgroundColor: scheme.outlineVariant, width: 36, height: 4, borderRadius: 2 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingLeft: 24,
    paddingRight: 14,
    paddingBottom: 12,
  },
  title: { ...type.titleLarge, fontWeight: '500', color: scheme.onSurface, flex: 1 },
  closeBtn: {
    width: 48,
    height: 48,
    borderRadius: shape.medium,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pressed: { backgroundColor: scheme.surfaceContainerHighest },
  scroll: { flex: 1 },
  content: { paddingHorizontal: 24, paddingBottom: 24, gap: 24 },
  modeSelector: {
    flexDirection: 'row',
    padding: 4,
    gap: 4,
    borderRadius: shape.large,
    backgroundColor: scheme.surfaceContainerHigh,
  },
  modeSelectorCompact: { flexDirection: 'column' },
  modeTab: {
    flex: 1,
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderRadius: shape.medium,
  },
  modeTabActive: { backgroundColor: scheme.primaryContainer },
  modeText: {
    ...type.labelLarge,
    color: scheme.onSurfaceVariant,
    textAlign: 'center',
    flexShrink: 1,
  },
  presetsRow: { flexDirection: 'row', gap: 8 },
  presetsCompact: { flexWrap: 'wrap' },
  preset: {
    flex: 1,
    minHeight: 48,
    borderRadius: shape.medium,
    backgroundColor: scheme.surfaceContainerHigh,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 6,
    paddingVertical: 10,
  },
  presetCompact: { flexBasis: '45%', flexGrow: 1 },
  presetActive: { backgroundColor: scheme.primaryContainer },
  presetText: {
    ...type.labelLarge,
    fontWeight: '500',
    color: scheme.onSurfaceVariant,
    textAlign: 'center',
  },
  presetTextActive: { color: scheme.onPrimaryContainer },
  daySelector: { flexDirection: 'row', gap: 10 },
  daySelectorCompact: { flexDirection: 'column' },
  dayTab: {
    flex: 1,
    minHeight: 76,
    borderRadius: shape.large,
    backgroundColor: scheme.surfaceContainer,
    padding: 16,
    gap: 4,
  },
  dayTabActive: { backgroundColor: scheme.primaryContainer },
  dayLabel: { ...type.titleMedium, fontWeight: '500', color: scheme.onSurface },
  dayLabelActive: { color: scheme.onPrimaryContainer },
  dayDate: { ...type.bodyMedium, color: scheme.onSurfaceVariant },
  dayDateActive: { color: scheme.onPrimaryContainer },
  timePicker: { gap: 8 },
  labelsRow: { flexDirection: 'row', alignItems: 'center' },
  wheelColLabel: {
    flex: 1,
    ...type.bodyMedium,
    color: scheme.onSurfaceVariant,
    textAlign: 'center',
  },
  colonSpace: { width: 24 },
  wheelsRow: { flexDirection: 'row', alignItems: 'center' },
  wheelCol: { flex: 1, minWidth: 0 },
  wheelHighlight: {
    position: 'absolute',
    left: 0,
    right: 0,
    backgroundColor: scheme.surfaceContainerHigh,
    borderRadius: shape.large,
  },
  wheelItem: { alignItems: 'center', justifyContent: 'center', borderRadius: shape.medium },
  wheelItemText: {
    fontSize: 22,
    fontWeight: '400',
    color: scheme.onSurfaceVariant,
    fontVariant: ['tabular-nums'],
    includeFontPadding: false,
  },
  wheelItemTextActive: {
    fontSize: 40,
    fontWeight: '600',
    color: scheme.onSurface,
    letterSpacing: -1,
  },
  wheelColon: {
    width: 24,
    fontSize: 32,
    fontWeight: '500',
    color: scheme.onSurfaceVariant,
    textAlign: 'center',
    includeFontPadding: false,
  },
  minutePreset: {
    flex: 1,
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
    borderRadius: shape.medium,
  },
  minutePresetActive: { backgroundColor: scheme.primaryContainer },
  minutePresetText: {
    ...type.bodyMedium,
    color: scheme.onSurfaceVariant,
    fontVariant: ['tabular-nums'],
    textAlign: 'center',
  },
  footer: {
    paddingHorizontal: 24,
    paddingTop: 16,
    paddingBottom: 16,
    gap: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: scheme.outlineVariant,
  },
  selection: { ...type.bodyMedium, color: scheme.onSurfaceVariant, textAlign: 'center' },
  confirmBtn: {
    minHeight: 56,
    paddingHorizontal: 20,
    paddingVertical: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: scheme.primary,
    borderRadius: shape.large,
  },
  confirmText: {
    ...type.labelLarge,
    fontWeight: '600',
    color: scheme.onPrimary,
    textAlign: 'center',
  },
});
