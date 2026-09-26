import React, { useEffect, useRef, useState } from 'react';
import {
  BackHandler,
  NativeScrollEvent,
  NativeSyntheticEvent,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import BottomSheet from '@gorhom/bottom-sheet';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  Calendar,
  Check,
  Clock,
  Sparkles,
  X,
} from 'lucide-react-native';
import { elev, scheme, shape, type } from '../theme/tokens';

interface DepartureTimeSheetProps {
  initialTimeSec?: number;
  initialLabel?: string;
  onClose: () => void;
  onSelect: (result: { departureTimeSec: number | undefined; label: string }) => void;
}

function pad(n: number): string {
  return n < 10 ? `0${n}` : `${n}`;
}

const ITEM_HEIGHT = 44;
const HOURS = Array.from({ length: 24 }, (_, i) => i);
const MINUTES = Array.from({ length: 60 }, (_, i) => i);

function WheelPicker({
  values,
  selectedValue,
  onValueChange,
}: {
  values: number[];
  selectedValue: number;
  onValueChange: (val: number) => void;
}) {
  const scrollRef = useRef<ScrollView>(null);
  const isUserScrolling = useRef(false);

  useEffect(() => {
    const idx = values.indexOf(selectedValue);
    if (idx >= 0 && !isUserScrolling.current) {
      scrollRef.current?.scrollTo({ y: idx * ITEM_HEIGHT, animated: true });
    }
  }, [selectedValue, values]);

  useEffect(() => {
    const idx = values.indexOf(selectedValue);
    if (idx >= 0) {
      const timer = setTimeout(() => {
        scrollRef.current?.scrollTo({ y: idx * ITEM_HEIGHT, animated: false });
      }, 50);
      return () => clearTimeout(timer);
    }
  }, []);

  const handleScrollEnd = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    isUserScrolling.current = false;
    const y = e.nativeEvent.contentOffset.y;
    const index = Math.round(y / ITEM_HEIGHT);
    const clamped = Math.max(0, Math.min(values.length - 1, index));
    if (values[clamped] !== undefined && values[clamped] !== selectedValue) {
      onValueChange(values[clamped]);
    }
  };

  const initialIndex = Math.max(0, values.indexOf(selectedValue));

  return (
    <View style={styles.wheelCol}>
      <View style={[styles.wheelContainer, { height: ITEM_HEIGHT * 3 }]}>
        <View pointerEvents="none" style={[styles.wheelHighlight, { top: ITEM_HEIGHT, height: ITEM_HEIGHT }]} />

        <ScrollView
          ref={scrollRef}
          showsVerticalScrollIndicator={false}
          snapToInterval={ITEM_HEIGHT}
          snapToAlignment="center"
          decelerationRate="fast"
          nestedScrollEnabled={true}
          overScrollMode="never"
          contentOffset={{ x: 0, y: initialIndex * ITEM_HEIGHT }}
          contentContainerStyle={{ paddingVertical: ITEM_HEIGHT }}
          onScrollBeginDrag={() => {
            isUserScrolling.current = true;
          }}
          onScrollEndDrag={handleScrollEnd}
          onMomentumScrollEnd={handleScrollEnd}
        >
          {values.map((val, idx) => {
            const isSelected = val === selectedValue;
            return (
              <Pressable
                key={val}
                onPress={() => {
                  isUserScrolling.current = false;
                  scrollRef.current?.scrollTo({ y: idx * ITEM_HEIGHT, animated: true });
                  onValueChange(val);
                }}
                style={[styles.wheelItem, { height: ITEM_HEIGHT }]}
              >
                <Text
                  style={[
                    styles.wheelItemText,
                    isSelected ? styles.wheelItemTextActive : styles.wheelItemTextInactive,
                  ]}
                >
                  {pad(val)}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>
      </View>
    </View>
  );
}

export function DepartureTimeSheet({
  initialTimeSec,
  onClose,
  onSelect,
}: DepartureTimeSheetProps) {
  // Android back / gest wstecz zamyka sheet zamiast wyjścia z apki
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      closeRef.current();
      return true;
    });
    return () => sub.remove();
  }, []);

  const now = new Date();
  const currentHour = now.getHours();
  const currentMinute = now.getMinutes();
  // Android z paskiem nawigacji zasłania dolną część arkusza (edge-to-edge),
  // więc bez tego insetu przycisk „Zastosuj” był w dole martwym polem.
  const insets = useSafeAreaInsets();

  // Oblicz początkowe wartości
  const initialIsNow = initialTimeSec === undefined;
  let initDay: 'today' | 'tomorrow' = 'today';
  let initHour = currentHour;
  let initMin = Math.ceil(currentMinute / 5) * 5;
  if (initMin >= 60) {
    initMin = 0;
    initHour = (initHour + 1) % 24;
  }

  if (initialTimeSec !== undefined) {
    if (initialTimeSec >= 86400) {
      initDay = 'tomorrow';
      const secInDay = initialTimeSec - 86400;
      initHour = Math.floor(secInDay / 3600) % 24;
      initMin = Math.floor((secInDay % 3600) / 60);
    } else {
      initDay = 'today';
      initHour = Math.floor(initialTimeSec / 3600) % 24;
      initMin = Math.floor((initialTimeSec % 3600) / 60);
    }
  }

  const [isNow, setIsNow] = useState(initialIsNow);
  const [day, setDay] = useState<'today' | 'tomorrow'>(initDay);
  const [hour, setHour] = useState(initHour);
  const [minute, setMinute] = useState(initMin);

  const handleQuickAdd = (addMinutes: number) => {
    setIsNow(false);
    const target = new Date(Date.now() + addMinutes * 60 * 1000);
    setHour(target.getHours());
    setMinute(target.getMinutes());
    // Jeśli po dodaniu przeskoczyło na kolejny dzień kalendarzowy
    if (target.getDate() !== now.getDate()) {
      setDay('tomorrow');
    } else {
      setDay('today');
    }
  };

  const handleSetNow = () => {
    setIsNow(true);
    setDay('today');
    setHour(currentHour);
    setMinute(currentMinute);
  };

  const setMinutePreset = (m: number) => {
    setIsNow(false);
    setMinute(m);
  };

  const handleConfirm = () => {
    if (isNow) {
      onSelect({
        departureTimeSec: undefined,
        label: 'Teraz',
      });
    } else {
      const baseSec = hour * 3600 + minute * 60;
      const totalSec = day === 'tomorrow' ? baseSec + 86400 : baseSec;
      const dayLabel = day === 'today' ? 'Dziś' : 'Jutro';
      onSelect({
        departureTimeSec: totalSec,
        label: `${dayLabel}, ${pad(hour)}:${pad(minute)}`,
      });
    }
    onClose();
  };

  return (
    <BottomSheet
      index={0}
      snapPoints={['64%']}
      bottomInset={insets.bottom}
      enableDynamicSizing={false}
      enablePanDownToClose
      enableContentPanningGesture={false}
      onChange={(idx) => {
        if (idx === -1) onClose();
      }}
      backgroundStyle={styles.sheet}
      handleIndicatorStyle={styles.handle}
    >
      <View style={styles.container}>
        {/* Nagłówek */}
        <View style={styles.header}>
          <View style={styles.titleRow}>
            <Clock size={20} color={scheme.primary} />
            <Text style={styles.title}>Czas odjazdu</Text>
          </View>
          <Pressable onPress={onClose} style={styles.closeBtn} hitSlop={10}>
            <X size={20} color={scheme.onSurfaceVariant} />
          </Pressable>
        </View>

        {/* Szybkie presety */}
        <View style={styles.presetsRow}>
          <Pressable
            onPress={handleSetNow}
            style={[styles.presetChip, isNow && styles.presetChipActive]}
          >
            <Sparkles size={14} color={isNow ? scheme.onPrimaryContainer : scheme.onSurfaceVariant} />
            <Text style={[styles.presetText, isNow && styles.presetTextActive]}>Teraz</Text>
          </Pressable>

          <Pressable
            onPress={() => handleQuickAdd(15)}
            style={styles.presetChip}
          >
            <Text style={styles.presetText}>+15 min</Text>
          </Pressable>

          <Pressable
            onPress={() => handleQuickAdd(30)}
            style={styles.presetChip}
          >
            <Text style={styles.presetText}>+30 min</Text>
          </Pressable>

          <Pressable
            onPress={() => handleQuickAdd(60)}
            style={styles.presetChip}
          >
            <Text style={styles.presetText}>+1 godz.</Text>
          </Pressable>
        </View>

        {/* Wybór dnia */}
        <View style={styles.daySelector}>
          <Pressable
            onPress={() => {
              setDay('today');
              setIsNow(false);
            }}
            style={[styles.dayTab, day === 'today' && !isNow && styles.dayTabActive]}
          >
            <Calendar size={14} color={day === 'today' && !isNow ? scheme.onSecondaryContainer : scheme.onSurfaceVariant} />
            <Text style={[styles.dayTabText, day === 'today' && !isNow && styles.dayTabTextActive]}>
              Dzisiaj
            </Text>
          </Pressable>

          <Pressable
            onPress={() => {
              setDay('tomorrow');
              setIsNow(false);
            }}
            style={[styles.dayTab, day === 'tomorrow' && !isNow && styles.dayTabActive]}
          >
            <Calendar size={14} color={day === 'tomorrow' && !isNow ? scheme.onSecondaryContainer : scheme.onSurfaceVariant} />
            <Text style={[styles.dayTabText, day === 'tomorrow' && !isNow && styles.dayTabTextActive]}>
              Jutro
            </Text>
          </Pressable>
        </View>

        {/* Panel zegara przesuwany (Wheel Picker) */}
        <View style={styles.clockCard}>
          <View style={styles.labelsRow}>
            <Text style={styles.wheelColLabel}>godzina</Text>
            <View style={{ width: 24 }} />
            <Text style={styles.wheelColLabel}>minuta</Text>
          </View>

          <View style={styles.wheelsRow}>
            <WheelPicker
              values={HOURS}
              selectedValue={hour}
              onValueChange={(h) => {
                setIsNow(false);
                setHour(h);
              }}
            />

            <View style={styles.wheelColonWrap}>
              <Text style={styles.wheelColon}>:</Text>
            </View>

            <WheelPicker
              values={MINUTES}
              selectedValue={minute}
              onValueChange={(m) => {
                setIsNow(false);
                setMinute(m);
              }}
            />
          </View>

          {/* Szybkie skróty minut */}
          <View style={styles.minuteShortcuts}>
            {[0, 15, 30, 45].map((m) => {
              const active = !isNow && minute === m;
              return (
                <Pressable
                  key={m}
                  onPress={() => setMinutePreset(m)}
                  style={[styles.minChip, active && styles.minChipActive]}
                >
                  <Text style={[styles.minChipText, active && styles.minChipTextActive]}>
                    :{pad(m)}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>

        {/* Przycisk potwierdzenia */}
        <Pressable
          onPress={handleConfirm}
          style={({ pressed }) => [styles.confirmBtn, pressed && { opacity: 0.88 }]}
        >
          <Check size={19} color={scheme.onPrimary} />
          <Text style={styles.confirmText}>
            {isNow
              ? 'Wyszukaj od teraz'
              : `Zastosuj: ${day === 'today' ? 'dziś' : 'jutro'}, ${pad(hour)}:${pad(minute)}`}
          </Text>
        </Pressable>
      </View>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  sheet: {
    borderTopLeftRadius: shape.extraLarge,
    borderTopRightRadius: shape.extraLarge,
    backgroundColor: scheme.surfaceContainer,
    ...elev.level3,
  },
  handle: {
    backgroundColor: scheme.outlineVariant,
    width: 44,
  },
  container: {
    flex: 1,
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 24,
    justifyContent: 'space-between',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  title: {
    ...type.titleMedium,
    fontWeight: '700',
    color: scheme.onSurface,
  },
  closeBtn: {
    width: 36,
    height: 36,
    borderRadius: shape.full,
    backgroundColor: scheme.surfaceContainerHigh,
    alignItems: 'center',
    justifyContent: 'center',
  },
  presetsRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 6,
  },
  presetChip: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    height: 36,
    borderRadius: shape.full,
    backgroundColor: scheme.surfaceContainerHighest,
  },
  presetChipActive: {
    backgroundColor: scheme.primaryContainer,
  },
  presetText: {
    ...type.labelMedium,
    color: scheme.onSurfaceVariant,
    fontWeight: '600',
  },
  presetTextActive: {
    color: scheme.onPrimaryContainer,
    fontWeight: '700',
  },
  daySelector: {
    flexDirection: 'row',
    gap: 10,
    backgroundColor: scheme.surfaceContainerHigh,
    padding: 4,
    borderRadius: shape.medium,
  },
  dayTab: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    height: 34,
    borderRadius: shape.small,
  },
  dayTabActive: {
    backgroundColor: scheme.secondaryContainer,
  },
  dayTabText: {
    ...type.labelMedium,
    color: scheme.onSurfaceVariant,
  },
  dayTabTextActive: {
    color: scheme.onSecondaryContainer,
    fontWeight: '700',
  },
  clockCard: {
    backgroundColor: scheme.surfaceContainerHigh,
    borderRadius: shape.large,
    paddingVertical: 10,
    paddingHorizontal: 16,
    alignItems: 'center',
    gap: 8,
  },
  labelsRow: {
    flexDirection: 'row',
    width: '100%',
    justifyContent: 'space-around',
    paddingHorizontal: 20,
  },
  wheelsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    width: '100%',
  },
  wheelCol: {
    flex: 1,
    alignItems: 'center',
  },
  wheelColLabel: {
    ...type.labelSmall,
    color: scheme.onSurfaceVariant,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  wheelContainer: {
    width: '100%',
    position: 'relative',
    overflow: 'hidden',
  },
  wheelHighlight: {
    position: 'absolute',
    left: 12,
    right: 12,
    backgroundColor: scheme.surfaceContainerHighest,
    borderRadius: shape.medium,
    borderWidth: 1,
    borderColor: scheme.primary + '35',
  },
  wheelItem: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  wheelItemText: {
    fontVariant: ['tabular-nums'],
    includeFontPadding: false,
    textAlign: 'center',
  },
  wheelItemTextActive: {
    ...type.displaySmall,
    fontSize: 28,
    fontWeight: '800',
    color: scheme.onSurface,
  },
  wheelItemTextInactive: {
    ...type.titleMedium,
    fontSize: 18,
    fontWeight: '500',
    color: scheme.onSurfaceVariant,
    opacity: 0.35,
  },
  wheelColonWrap: {
    alignItems: 'center',
    justifyContent: 'center',
    width: 24,
    height: ITEM_HEIGHT * 3,
  },
  wheelColon: {
    fontSize: 28,
    fontWeight: '800',
    color: scheme.primary,
    fontVariant: ['tabular-nums'],
    includeFontPadding: false,
    textAlign: 'center',
  },
  minuteShortcuts: {
    flexDirection: 'row',
    gap: 8,
  },
  minChip: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: shape.small,
    backgroundColor: scheme.surfaceContainerHighest,
  },
  minChipActive: {
    backgroundColor: scheme.primary,
  },
  minChipText: {
    ...type.labelSmall,
    color: scheme.onSurfaceVariant,
    fontWeight: '600',
  },
  minChipTextActive: {
    color: scheme.onPrimary,
    fontWeight: '700',
  },
  confirmBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: scheme.primary,
    borderRadius: shape.full,
    height: 52,
    ...elev.level2,
  },
  confirmText: {
    ...type.labelLarge,
    fontWeight: '700',
    color: scheme.onPrimary,
  },
});
