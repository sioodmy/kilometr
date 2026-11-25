import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  Platform,
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
  useBottomSheetSpringConfigs,
} from '@gorhom/bottom-sheet';
import * as Haptics from 'expo-haptics';
import Animated, {
  FadeIn,
  FadeOut,
  LinearTransition,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AlertCircle, Clock3, Flag, X } from './icons';
import { SpringPressable } from './SpringPressable';
import { motion } from '../theme/motion';
import { useSheetBackHandler } from '../hooks/useSheetBackHandler';
import {
  DESKTOP_SHEET_TOP_SPACER_HEIGHT,
  DesktopSheetTopSpacer,
  getDesktopSheetProps,
  useEscapeKey,
  useWebLayout,
} from '../theme/layout';
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
const SPRING_FAST = motion.spring.spatialFast;

const timeSheetDateFormatters = new Map<string, Intl.DateTimeFormat>();

function getTimeSheetDateFormatter(locale: string): Intl.DateTimeFormat {
  const key = locale || 'pl';
  let formatter = timeSheetDateFormatters.get(key);
  if (!formatter) {
    try {
      formatter = new Intl.DateTimeFormat(key, { day: 'numeric', month: 'short' });
    } catch {
      formatter = new Intl.DateTimeFormat('pl', { day: 'numeric', month: 'short' });
    }
    timeSheetDateFormatters.set(key, formatter);
  }
  return formatter;
}

function SheetHandle() {
  return (
    <View style={styles.handleContainer}>
      <View style={styles.handle} />
    </View>
  );
}

function ModeSegment({
  mode,
  compact,
  departureLabel,
  arrivalLabel,
  onSelect,
}: {
  mode: JourneyTimeMode;
  compact: boolean;
  departureLabel: string;
  arrivalLabel: string;
  onSelect: (next: JourneyTimeMode) => void;
}) {
  const reduceMotion = useReducedMotion();
  const containerWidth = useSharedValue(0);
  const activeIndex = mode === 'arrival' ? 1 : 0;
  const progress = useSharedValue(activeIndex);

  useEffect(() => {
    progress.value = reduceMotion ? activeIndex : withSpring(activeIndex, SPRING_FAST);
  }, [activeIndex, progress, reduceMotion]);

  const indicatorStyle = useAnimatedStyle(() => {
    const w = containerWidth.value > 0 ? (containerWidth.value - 10) / 2 : 0;
    return {
      width: w,
      transform: [{ translateX: progress.value * w }],
      opacity: w > 0 ? 1 : 0,
    };
  });

  const options = [
    { value: 'departure' as const, label: departureLabel, Icon: Clock3 },
    { value: 'arrival' as const, label: arrivalLabel, Icon: Flag },
  ];

  if (compact) {
    return (
      <View style={styles.modeSelectorCompact} accessibilityRole="tablist">
        {options.map(({ value, label, Icon }) => {
          const active = mode === value;
          return (
            <SpringPressable
              key={value}
              accessibilityRole="tab"
              accessibilityState={{ selected: active }}
              haptic="selection"
              scaleDelta={0.02}
              onPress={() => onSelect(value)}
              style={[styles.modeTabCompact, active && styles.modeTabCompactActive]}
            >
              <Icon
                size={17}
                color={active ? scheme.onPrimaryContainer : scheme.onSurfaceVariant}
              />
              <Text style={[styles.modeText, active && styles.modeTextActive]}>{label}</Text>
            </SpringPressable>
          );
        })}
      </View>
    );
  }

  return (
    <View
      style={styles.modeSelector}
      accessibilityRole="tablist"
      onLayout={(e) => {
        containerWidth.value = e.nativeEvent.layout.width;
      }}
    >
      <Animated.View style={[styles.modeIndicator, indicatorStyle]} />
      {options.map(({ value, label, Icon }) => {
        const active = mode === value;
        return (
          <Pressable
            key={value}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            onPress={() => {
              void Haptics.selectionAsync().catch(() => {});
              onSelect(value);
            }}
            style={styles.modeTab}
          >
            <Icon
              size={17}
              color={active ? scheme.onPrimaryContainer : scheme.onSurfaceVariant}
            />
            <Text style={[styles.modeText, active && styles.modeTextActive]} numberOfLines={1}>
              {label}
            </Text>
          </Pressable>
        );
      })}
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
  const reduceMotion = useReducedMotion();
  const scrollRef = useRef<ScrollView>(null);
  const isUserScrolling = useRef(false);
  const didMount = useRef(false);
  const webScrollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (webScrollTimer.current) clearTimeout(webScrollTimer.current);
    },
    [],
  );

  useEffect(() => {
    const index = values.indexOf(selectedValue);
    if (index < 0 || isUserScrolling.current) return;
    const animateScroll = didMount.current && !reduceMotion;
    didMount.current = true;
    const frame = requestAnimationFrame(() => {
      scrollRef.current?.scrollTo({ y: index * itemHeight, animated: animateScroll });
    });
    return () => cancelAnimationFrame(frame);
  }, [selectedValue, values, itemHeight, reduceMotion]);

  const commitOffset = (offsetY: number) => {
    isUserScrolling.current = false;
    const index = Math.max(
      0,
      Math.min(values.length - 1, Math.round(offsetY / itemHeight)),
    );
    const next = values[index];
    if (next !== selectedValue) {
      void Haptics.selectionAsync().catch(() => {});
    }
    onValueChange(next);
  };

  const handleScrollEnd = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    commitOffset(e.nativeEvent.contentOffset.y);
  };

  // Na Web RNW nie wywołuje onMomentumScrollEnd, więc zatwierdzamy pozycję po ustaniu scrolla.
  const handleWebScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    if (Platform.OS !== 'web') return;
    const y = e.nativeEvent.contentOffset.y;
    isUserScrolling.current = true;
    if (webScrollTimer.current) clearTimeout(webScrollTimer.current);
    webScrollTimer.current = setTimeout(() => {
      commitOffset(y);
    }, 90);
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
        style={[
          { height: itemHeight * 3 },
          Platform.OS === 'web'
            ? ({
                scrollSnapType: 'y mandatory',
                scrollbarWidth: 'none',
              } as unknown as Record<string, string>)
            : null,
        ]}
        showsVerticalScrollIndicator={false}
        snapToInterval={itemHeight}
        decelerationRate="fast"
        nestedScrollEnabled
        overScrollMode="never"
        scrollEventThrottle={16}
        contentOffset={{ x: 0, y: Math.max(0, values.indexOf(selectedValue)) * itemHeight }}
        contentContainerStyle={{ paddingVertical: itemHeight }}
        importantForAccessibility="no-hide-descendants"
        accessibilityElementsHidden
        onScroll={Platform.OS === 'web' ? handleWebScroll : undefined}
        onScrollBeginDrag={() => {
          isUserScrolling.current = true;
        }}
        onScrollEndDrag={(event) => {
          if (!event.nativeEvent.velocity?.y) handleScrollEnd(event);
        }}
        onMomentumScrollEnd={handleScrollEnd}
      >
        {values.map((value) => {
          const active = value === selectedValue;
          return (
            <Pressable
              key={value}
              onPress={() => {
                isUserScrolling.current = false;
                if (value !== selectedValue) {
                  void Haptics.selectionAsync().catch(() => {});
                }
                onValueChange(value);
              }}
              style={({ pressed }) => [
                styles.wheelItem,
                { height: itemHeight },
                Platform.OS === 'web'
                  ? ({ scrollSnapAlign: 'center' } as unknown as Record<string, string>)
                  : null,
                pressed && !active && styles.wheelItemPressed,
              ]}
            >
              <Text style={[styles.wheelItemText, active && styles.wheelItemTextActive]}>
                {pad(value)}
              </Text>
            </Pressable>
          );
        })}
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
  const reduceMotion = useReducedMotion();
  const { height, width, fontScale } = useWindowDimensions();
  const webLayout = useWebLayout();
  const itemHeight = Math.max(54, Math.ceil(46 * fontScale));
  const sheetHeight = webLayout.isMedium
    ? Math.min(height - 72, 704 + Math.max(0, fontScale - 1) * 220)
    : Math.min(
        height - insets.top - insets.bottom - 16,
        696 + Math.max(0, fontScale - 1) * 380,
      );
  const sheetProps = getDesktopSheetProps(webLayout, insets.bottom, 520, sheetHeight);
  const effectiveWidth = webLayout.isMedium ? sheetProps.innerWidth : width;
  const compact = effectiveWidth / fontScale < 300;
  const sheetRef = useRef<BottomSheet>(null);
  useEscapeKey(true, () => sheetRef.current?.close());
  const dayScrollRef = useRef<ScrollView>(null);
  const snapPoints = useMemo(() => [sheetHeight], [sheetHeight]);
  const animationConfigs = useBottomSheetSpringConfigs(motion.sheet);

  const requestClose = useCallback(() => {
    sheetRef.current?.close();
  }, []);

  const { onSheetChange } = useSheetBackHandler(sheetRef, onClose);

  const [openedAt] = useState(() => new Date());
  const [mode, setMode] = useState(initialMode);
  const initialSeconds = initialTimeSec ?? openedAt.getHours() * 3600 + openedAt.getMinutes() * 60;
  const [isNow, setIsNow] = useState(initialTimeSec === undefined && initialMode === 'departure');
  const [dayOffset, setDayOffset] = useState(() => Math.floor(initialSeconds / 86400));
  const [hour, setHour] = useState(Math.floor(initialSeconds / 3600) % 24);
  const [minute, setMinute] = useState(Math.floor((initialSeconds % 3600) / 60));
  const [maxDayOffset, setMaxDayOffset] = useState(13);

  const initialDayOffsetRef = useRef(dayOffset);
  useEffect(() => {
    const startOffset = initialDayOffsetRef.current;
    if (startOffset <= 1) return;
    const frame = requestAnimationFrame(() => {
      dayScrollRef.current?.scrollTo({ x: Math.max(0, (startOffset - 1) * 86), animated: false });
    });
    return () => cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    let alive = true;
    (async () => {
      const ends: Array<string | null> = [];
      try {
        const { getTimetableEndDate } = await import('../services/gtfsDatabase');
        ends.push(await getTimetableEndDate());
      } catch {}
      try {
        const { hasNationalDb, getNationalTimetableEndDate } = await import(
          '../services/gtfsDatabase'
        );
        if (await hasNationalDb()) ends.push(await getNationalTimetableEndDate());
      } catch {}
      const valid = ends.filter((d): d is string => !!d && /^\d{8}$/.test(d));
      if (!alive || valid.length === 0) return;
      valid.sort();
      const end = valid[0];
      const endDate = new Date(
        Number(end.slice(0, 4)),
        Number(end.slice(4, 6)) - 1,
        Number(end.slice(6, 8)),
        23,
        59,
        59,
        999,
      );
      const daysLeft = Math.ceil((endDate.getTime() - Date.now()) / 86400000);
      setMaxDayOffset(Math.max(1, Math.min(13, daysLeft)));
    })();
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (dayOffset > maxDayOffset) setDayOffset(0);
  }, [dayOffset, maxDayOffset]);

  const now = new Date();
  const nowSec = now.getHours() * 3600 + now.getMinutes() * 60;
  const selectedSec = hour * 3600 + minute * 60;
  const isPast = !isNow && dayOffset === 0 && selectedSec < nowSec;
  const isCustomState = !isNow || mode !== 'departure';

  const handleQuickAdd = (addMinutes: number) => {
    const current = new Date();
    const baseSec = isNow
      ? current.getHours() * 3600 + current.getMinutes() * 60
      : dayOffset * 86400 + hour * 3600 + minute * 60;
    const totalSec = Math.min(maxDayOffset * 86400 + 86340, baseSec + addMinutes * 60);
    setIsNow(false);
    setHour(Math.floor(totalSec / 3600) % 24);
    setMinute(Math.floor((totalSec % 3600) / 60));
    setDayOffset(Math.floor(totalSec / 86400));
  };

  const handleSetNow = () => {
    const current = new Date();
    setMode('departure');
    setIsNow(true);
    setDayOffset(0);
    setHour(current.getHours());
    setMinute(current.getMinutes());
    dayScrollRef.current?.scrollTo({ x: 0, animated: !reduceMotion });
  };

  const handleModeChange = (nextMode: JourneyTimeMode) => {
    setMode(nextMode);
    if (nextMode === 'arrival') {
      setIsNow(false);
      if (dayOffset === 0 && hour * 3600 + minute * 60 <= nowSec) {
        const targetSec = nowSec + 30 * 60;
        setHour(Math.floor(targetSec / 3600) % 24);
        setMinute(Math.floor((targetSec % 3600) / 60));
        if (targetSec >= 86400) setDayOffset(1);
      }
    }
  };

  const dayLabel =
    dayOffset === 0
      ? s.common.today
      : dayOffset === 1
        ? s.common.tomorrow
        : (() => {
            const d = new Date(openedAt);
            d.setDate(d.getDate() + dayOffset);
            return getTimeSheetDateFormatter(getLocaleSync()).format(d);
          })();

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
          : dayOffset * 86400 + hour * 3600 + minute * 60,
      mode,
      label: selection,
    });
    requestClose();
  };

  const renderBackdrop = useCallback(
    (props: BottomSheetBackdropProps) => (
      <BottomSheetBackdrop
        {...props}
        appearsOnIndex={0}
        disappearsOnIndex={-1}
        opacity={0.58}
        pressBehavior="close"
        accessibilityLabel={s.common.close}
        accessibilityRole="button"
      />
    ),
    [s.common.close],
  );

  const days = useMemo(() => {
    const locale = getLocaleSync();
    const dateFormat = getTimeSheetDateFormatter(locale);
    let weekdayFormat: Intl.DateTimeFormat | null = null;
    try {
      weekdayFormat = new Intl.DateTimeFormat(locale, { weekday: 'short' });
    } catch {
      weekdayFormat = null;
    }
    return Array.from({ length: maxDayOffset + 1 }, (_, i) => {
      const d = new Date(openedAt);
      d.setDate(d.getDate() + i);
      return {
        value: i,
        label:
          i === 0
            ? s.timeSheet.dayToday
            : i === 1
              ? s.timeSheet.dayTomorrow
              : (weekdayFormat?.format(d) ?? dateFormat.format(d)),
        date: dateFormat.format(d),
      };
    });
  }, [openedAt, s, maxDayOffset]);

  const ModeIcon = mode === 'arrival' ? Flag : Clock3;

  return (
    <BottomSheet
      ref={sheetRef}
      index={0}
      snapPoints={snapPoints}
      animationConfigs={animationConfigs}
      handleComponent={webLayout.isMedium ? DesktopSheetTopSpacer : SheetHandle}
      bottomInset={sheetProps.bottomInset}
      detached={sheetProps.detached}
      style={sheetProps.sheetStyle}
      enableDynamicSizing={false}
      enablePanDownToClose={!webLayout.isMedium}
      enableContentPanningGesture={false}
      onChange={onSheetChange}
      onClose={onClose}
      backdropComponent={renderBackdrop}
      backgroundStyle={[styles.sheet, sheetProps.backgroundExtraStyle]}
    >
      <View
        style={{ height: sheetHeight - (webLayout.isMedium ? DESKTOP_SHEET_TOP_SPACER_HEIGHT : HANDLE_HEIGHT) }}
        accessibilityViewIsModal
      >
        <View style={styles.header}>
          <View style={styles.headerTitleGroup}>
            <View style={styles.headerIconBadge}>
              <ModeIcon size={18} color={scheme.onPrimaryContainer} />
            </View>
            <Text style={styles.title} accessibilityRole="header" numberOfLines={1}>
              {s.timeSheet.title}
            </Text>
          </View>

          <View style={styles.headerActions}>
            {isCustomState && (
              <Animated.View
                entering={reduceMotion ? undefined : FadeIn.duration(140)}
                exiting={reduceMotion ? undefined : FadeOut.duration(100)}
              >
                <SpringPressable
                  onPress={handleSetNow}
                  scaleDelta={0.04}
                  haptic="selection"
                  accessibilityRole="button"
                  accessibilityLabel={s.common.now}
                  hitSlop={4}
                  style={styles.resetNowBtn}
                >
                  <Text style={styles.resetNowText}>{s.common.now}</Text>
                </SpringPressable>
              </Animated.View>
            )}

            <SpringPressable
              onPress={requestClose}
              scaleDelta={0.06}
              haptic="selection"
              accessibilityRole="button"
              accessibilityLabel={s.common.close}
              style={styles.closeBtn}
            >
              <X size={20} color={scheme.onSurface} />
            </SpringPressable>
          </View>
        </View>

        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.content}
          showsVerticalScrollIndicator={false}
          nestedScrollEnabled
          overScrollMode="never"
        >
          <ModeSegment
            mode={mode}
            compact={compact}
            departureLabel={s.timeSheet.modeDeparture}
            arrivalLabel={s.timeSheet.modeArrival}
            onSelect={handleModeChange}
          />

          <View style={[styles.presetsRow, compact && styles.presetsCompact]}>
            {(mode === 'departure'
              ? [
                  { label: s.common.now, action: handleSetNow, active: isNow },
                  { label: s.common.add15, action: () => handleQuickAdd(15), active: false },
                  { label: s.common.add30, action: () => handleQuickAdd(30), active: false },
                  { label: s.common.add60, action: () => handleQuickAdd(60), active: false },
                ]
              : [
                  { label: s.common.add15, action: () => handleQuickAdd(15), active: false },
                  { label: s.common.add30, action: () => handleQuickAdd(30), active: false },
                  { label: s.common.add45, action: () => handleQuickAdd(45), active: false },
                  { label: s.common.add60, action: () => handleQuickAdd(60), active: false },
                ]
            ).map((preset) => (
              <SpringPressable
                key={preset.label}
                onPress={preset.action}
                scaleDelta={0.035}
                haptic="selection"
                accessibilityRole="button"
                accessibilityState={{ selected: preset.active }}
                style={[
                  styles.preset,
                  compact && styles.presetCompact,
                  preset.active && styles.presetActive,
                ]}
              >
                <Text style={[styles.presetText, preset.active && styles.presetTextActive]}>
                  {preset.label}
                </Text>
              </SpringPressable>
            ))}
          </View>

          <ScrollView
            ref={dayScrollRef}
            horizontal
            showsHorizontalScrollIndicator={false}
            overScrollMode="never"
            style={
              Platform.OS === 'web'
                ? ({ scrollbarWidth: 'none' } as unknown as Record<string, string>)
                : undefined
            }
            contentContainerStyle={styles.daySelector}
          >
            {days.map((option) => {
              const active = dayOffset === option.value;
              return (
                <SpringPressable
                  key={option.value}
                  onPress={() => {
                    setDayOffset(option.value);
                    setIsNow(false);
                  }}
                  scaleDelta={0.035}
                  haptic="selection"
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                  style={[styles.dayTab, active && styles.dayTabActive]}
                >
                  <Text
                    style={[styles.dayLabel, active && styles.dayLabelActive]}
                    numberOfLines={1}
                  >
                    {option.label}
                  </Text>
                  <Text style={[styles.dayDate, active && styles.dayDateActive]} numberOfLines={1}>
                    {option.date}
                  </Text>
                </SpringPressable>
              );
            })}
          </ScrollView>

          <View style={styles.wheelCard}>
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

            <View style={[styles.minutePresetsRow, compact && styles.presetsCompact]}>
              {[0, 15, 30, 45].map((value) => {
                const active = !isNow && minute === value;
                return (
                  <SpringPressable
                    key={value}
                    onPress={() => {
                      setIsNow(false);
                      setMinute(value);
                    }}
                    scaleDelta={0.035}
                    haptic="selection"
                    accessibilityRole="button"
                    accessibilityLabel={s.timeSheet.minutePreset(pad(value))}
                    accessibilityState={{ selected: active }}
                    style={[
                      styles.minutePreset,
                      compact && styles.presetCompact,
                      active && styles.minutePresetActive,
                    ]}
                  >
                    <Text
                      style={[styles.minutePresetText, active && styles.minutePresetTextActive]}
                    >
                      :{pad(value)}
                    </Text>
                  </SpringPressable>
                );
              })}
            </View>
          </View>
        </ScrollView>

        <Animated.View
          style={styles.footer}
          layout={reduceMotion ? undefined : LinearTransition.springify().damping(24).stiffness(320)}
        >
          {isPast ? (
            <Animated.View
              key="past"
              entering={reduceMotion ? undefined : FadeIn.duration(160)}
              exiting={reduceMotion ? undefined : FadeOut.duration(120)}
              style={styles.warningBox}
            >
              <View style={styles.warningLeft}>
                <AlertCircle size={17} color={scheme.onWarningContainer} />
                <Text style={styles.warningText}>{s.timeSheet.pastWarning}</Text>
              </View>
              <SpringPressable
                onPress={() => {
                  setDayOffset(1);
                  setIsNow(false);
                }}
                scaleDelta={0.04}
                haptic="selection"
                accessibilityRole="button"
                accessibilityLabel={s.timeSheet.switchTomorrow}
                style={styles.warningAction}
              >
                <Text style={styles.warningActionText}>{s.timeSheet.switchTomorrow}</Text>
              </SpringPressable>
            </Animated.View>
          ) : (
            <Animated.View
              key="summary"
              entering={reduceMotion ? undefined : FadeIn.duration(140)}
              exiting={reduceMotion ? undefined : FadeOut.duration(100)}
              style={styles.selectionPill}
            >
              <ModeIcon size={15} color={scheme.primary} />
              <Text style={styles.selection} accessibilityLiveRegion="polite" numberOfLines={1}>
                {selection}
              </Text>
            </Animated.View>
          )}

          <SpringPressable
            onPress={handleConfirm}
            scaleDelta={0.02}
            haptic="light"
            accessibilityRole="button"
            accessibilityLabel={s.timeSheet.confirmAction}
            accessibilityHint={selection}
            style={styles.confirmBtn}
          >
            <Text style={styles.confirmText}>{s.timeSheet.confirmAction}</Text>
          </SpringPressable>
        </Animated.View>
      </View>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  sheet: {
    borderTopLeftRadius: shape.extraLarge,
    borderTopRightRadius: shape.extraLarge,
    backgroundColor: scheme.surfaceContainer,
    borderTopWidth: 2,
    borderColor: scheme.outlineVariant,
  },
  handleContainer: {
    height: HANDLE_HEIGHT,
    alignItems: 'center',
    justifyContent: 'center',
  },
  handle: {
    backgroundColor: scheme.outlineVariant,
    width: 36,
    height: 4,
    borderRadius: 2,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    paddingLeft: 20,
    paddingRight: 16,
    paddingBottom: 14,
  },
  headerTitleGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flex: 1,
    minWidth: 0,
  },
  headerIconBadge: {
    width: 34,
    height: 34,
    borderRadius: 12,
    backgroundColor: scheme.primaryContainer,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    fontSize: 20,
    lineHeight: 26,
    fontWeight: '800',
    letterSpacing: -0.3,
    color: scheme.onSurface,
    flexShrink: 1,
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  resetNowBtn: {
    minHeight: 38,
    paddingHorizontal: 14,
    borderRadius: shape.full,
    backgroundColor: scheme.secondaryContainer,
    alignItems: 'center',
    justifyContent: 'center',
  },
  resetNowText: {
    ...type.labelMedium,
    fontWeight: '700',
    color: scheme.onSecondaryContainer,
  },
  closeBtn: {
    width: 44,
    height: 44,
    borderRadius: shape.full,
    backgroundColor: scheme.surfaceContainerHigh,
    borderWidth: 2,
    borderColor: scheme.outlineVariant,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scroll: {
    flex: 1,
  },
  content: {
    paddingHorizontal: 20,
    paddingBottom: 20,
    gap: 16,
  },
  modeSelector: {
    flexDirection: 'row',
    padding: 4,
    borderRadius: shape.full,
    backgroundColor: scheme.surfaceContainerLow,
    borderWidth: 2,
    borderColor: scheme.outlineVariant,
    overflow: 'hidden',
  },
  modeIndicator: {
    position: 'absolute',
    top: 4,
    left: 4,
    bottom: 4,
    borderRadius: shape.full,
    backgroundColor: scheme.primaryContainer,
    zIndex: 0,
  },
  modeTab: {
    flex: 1,
    minHeight: 46,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    paddingHorizontal: 12,
    borderRadius: shape.full,
    zIndex: 1,
  },
  modeSelectorCompact: {
    flexDirection: 'column',
    gap: 8,
  },
  modeTabCompact: {
    minHeight: 46,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingHorizontal: 14,
    borderRadius: shape.full,
    backgroundColor: scheme.surfaceContainerLow,
    borderWidth: 2,
    borderColor: scheme.outlineVariant,
  },
  modeTabCompactActive: {
    backgroundColor: scheme.primaryContainer,
    borderColor: scheme.primary,
  },
  modeText: {
    ...type.labelLarge,
    fontWeight: '600',
    color: scheme.onSurfaceVariant,
    textAlign: 'center',
    flexShrink: 1,
  },
  modeTextActive: {
    color: scheme.onPrimaryContainer,
    fontWeight: '800',
  },
  presetsRow: {
    flexDirection: 'row',
    gap: 8,
  },
  presetsCompact: {
    flexWrap: 'wrap',
  },
  preset: {
    flex: 1,
    minHeight: 44,
    borderRadius: shape.full,
    backgroundColor: scheme.surfaceContainerLow,
    borderWidth: 2,
    borderColor: scheme.outlineVariant,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 8,
  },
  presetCompact: {
    flexBasis: '45%',
    flexGrow: 1,
  },
  presetActive: {
    backgroundColor: scheme.primaryContainer,
    borderColor: scheme.primary,
  },
  presetText: {
    ...type.labelLarge,
    fontWeight: '600',
    color: scheme.onSurfaceVariant,
    fontVariant: ['tabular-nums'],
    textAlign: 'center',
  },
  presetTextActive: {
    color: scheme.onPrimaryContainer,
    fontWeight: '800',
  },
  daySelector: {
    flexDirection: 'row',
    gap: 8,
    paddingVertical: 2,
  },
  dayTab: {
    minWidth: 78,
    minHeight: 62,
    borderRadius: 18,
    backgroundColor: scheme.surfaceContainerLow,
    borderWidth: 2,
    borderColor: scheme.outlineVariant,
    paddingHorizontal: 12,
    paddingVertical: 9,
    gap: 3,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dayTabActive: {
    backgroundColor: scheme.primaryContainer,
    borderColor: scheme.primary,
  },
  dayLabel: {
    ...type.labelLarge,
    fontWeight: '700',
    color: scheme.onSurface,
  },
  dayLabelActive: {
    color: scheme.onPrimaryContainer,
    fontWeight: '800',
  },
  dayDate: {
    ...type.bodySmall,
    color: scheme.onSurfaceVariant,
    fontVariant: ['tabular-nums'],
  },
  dayDateActive: {
    color: scheme.onPrimaryContainer,
    fontWeight: '600',
  },
  wheelCard: {
    backgroundColor: scheme.surfaceContainerLow,
    borderRadius: 22,
    borderWidth: 2,
    borderColor: scheme.outlineVariant,
    paddingHorizontal: 12,
    paddingTop: 10,
    paddingBottom: 12,
    gap: 10,
  },
  labelsRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  wheelColLabel: {
    flex: 1,
    ...type.labelSmall,
    fontWeight: '700',
    color: scheme.onSurfaceVariant,
    textAlign: 'center',
    letterSpacing: 0.3,
  },
  colonSpace: {
    width: 24,
  },
  wheelsRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  wheelCol: {
    flex: 1,
    minWidth: 0,
  },
  wheelHighlight: {
    position: 'absolute',
    left: 0,
    right: 0,
    backgroundColor: scheme.primaryContainer,
    borderRadius: 16,
    borderWidth: 2,
    borderColor: scheme.primary + '55',
  },
  wheelItem: {
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 14,
  },
  wheelItemPressed: {
    backgroundColor: scheme.surfaceContainerHigh,
  },
  wheelItemText: {
    fontSize: 22,
    fontWeight: '500',
    color: scheme.onSurfaceVariant,
    opacity: 0.72,
    fontVariant: ['tabular-nums'],
    includeFontPadding: false,
  },
  wheelItemTextActive: {
    fontSize: 34,
    fontWeight: '800',
    color: scheme.onPrimaryContainer,
    opacity: 1,
    letterSpacing: -0.8,
  },
  wheelColon: {
    width: 24,
    fontSize: 28,
    fontWeight: '800',
    color: scheme.onPrimaryContainer,
    textAlign: 'center',
    includeFontPadding: false,
  },
  minutePresetsRow: {
    flexDirection: 'row',
    gap: 8,
    paddingTop: 4,
    borderTopWidth: 2,
    borderTopColor: scheme.outlineVariant,
  },
  minutePreset: {
    flex: 1,
    minHeight: 42,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: shape.full,
    backgroundColor: scheme.surfaceContainerHigh,
  },
  minutePresetActive: {
    backgroundColor: scheme.secondaryContainer,
  },
  minutePresetText: {
    ...type.labelLarge,
    fontWeight: '600',
    color: scheme.onSurfaceVariant,
    fontVariant: ['tabular-nums'],
    textAlign: 'center',
  },
  minutePresetTextActive: {
    color: scheme.onSecondaryContainer,
    fontWeight: '800',
  },
  footer: {
    paddingHorizontal: 20,
    paddingTop: 14,
    paddingBottom: 16,
    gap: 12,
    borderTopWidth: 2,
    borderTopColor: scheme.outlineVariant,
  },
  selectionPill: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    alignSelf: 'center',
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: shape.full,
    backgroundColor: scheme.surfaceContainerLow,
    borderWidth: 2,
    borderColor: scheme.outlineVariant,
  },
  selection: {
    ...type.labelLarge,
    fontWeight: '700',
    color: scheme.onSurface,
    fontVariant: ['tabular-nums'],
  },
  warningBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: scheme.warningContainer,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 18,
    justifyContent: 'space-between',
  },
  warningLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flex: 1,
  },
  warningText: {
    ...type.bodySmall,
    color: scheme.onWarningContainer,
    fontWeight: '600',
    flex: 1,
  },
  warningAction: {
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 14,
    borderRadius: shape.full,
    backgroundColor: scheme.surfaceContainer,
  },
  warningActionText: {
    ...type.labelMedium,
    color: scheme.onSurface,
    fontWeight: '700',
  },
  confirmBtn: {
    minHeight: 54,
    paddingHorizontal: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: scheme.primary,
    borderRadius: shape.full,
  },
  confirmText: {
    ...type.labelLarge,
    fontSize: 15,
    fontWeight: '800',
    color: scheme.onPrimary,
    textAlign: 'center',
  },
});
