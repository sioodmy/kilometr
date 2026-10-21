import React, { useEffect, useState, type ReactNode } from 'react';
import {
  LayoutChangeEvent,
  Pressable,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import Animated from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { elev, scheme, shape, type } from '../theme/tokens';

/** Odstęp pigułki od krawędzi ekranu (nad `bottom` z insetów). */
const BAR_EDGE_GAP = 10;
/** Wysokość początkowa, zanim `onLayout` zmierzy pasek. */
const BAR_MIN_HEIGHT = 58;
/** Dodatkowy oddech między paskiem a ostatnim elementem treści. */
const CONTENT_GAP = 12;

const measuredBarHeights = new Map<string, number>();
const insetListeners = new Map<string, Set<() => void>>();

/** Zapas treści pod paskiem; różne układy paska muszą używać osobnych kluczy. */
export function useThumbBarInset(measurementKey = 'default'): number {
  const insets = useSafeAreaInsets();
  const [barHeight, setBarHeight] = useState(
    () => measuredBarHeights.get(measurementKey) ?? BAR_MIN_HEIGHT,
  );

  useEffect(() => {
    const update = () => setBarHeight(measuredBarHeights.get(measurementKey) ?? BAR_MIN_HEIGHT);
    let listeners = insetListeners.get(measurementKey);
    if (!listeners) {
      listeners = new Set();
      insetListeners.set(measurementKey, listeners);
    }
    listeners.add(update);
    update();
    return () => {
      listeners.delete(update);
      if (listeners.size === 0) insetListeners.delete(measurementKey);
    };
  }, [measurementKey]);

  return Math.max(insets.bottom, BAR_EDGE_GAP) + BAR_EDGE_GAP + barHeight + CONTENT_GAP;
}

interface ThumbBarProps {
  children: ReactNode;
  /** Odstęp od dołu ekranu nad plikiem `bottom` (domyślnie 10 px). */
  bottom?: number;
  /** Dopasowanie szerokości przez `left`/`right`. */
  style?: StyleProp<ViewStyle>;
  contentStyle?: StyleProp<ViewStyle>;
  /** Wyłącza pływanie (np. gdy pasek siedzi już w kontenerze panelu). */
  inline?: boolean;
  measurementKey?: string;
}

export function ThumbBar({
  children,
  bottom = 10,
  style,
  contentStyle,
  inline,
  measurementKey = 'default',
}: ThumbBarProps) {
  const insets = useSafeAreaInsets();
  if (inline) {
    return <View style={[styles.bar, contentStyle]}>{children}</View>;
  }
  // Zawijanie etykiet zmienia wysokość paska i potrzebny zapas treści.
  const handleBarLayout = (e: LayoutChangeEvent) => {
    const h = e.nativeEvent.layout.height;
    if (h > 0 && Math.abs(h - (measuredBarHeights.get(measurementKey) ?? BAR_MIN_HEIGHT)) > 0.5) {
      measuredBarHeights.set(measurementKey, h);
      for (const listener of insetListeners.get(measurementKey) ?? []) listener();
    }
  };
  // Rodzic może ukrywać pasek przez useAnimatedStyle podczas przewijania.
  return (
    <Animated.View
      pointerEvents="box-none"
      style={[styles.wrapper, { bottom: Math.max(insets.bottom, 10) + bottom }, style]}
    >
      <View style={[styles.bar, contentStyle]} onLayout={handleBarLayout}>
        {children}
      </View>
    </Animated.View>
  );
}
interface ThumbBarItemProps {
  onPress: () => void;
  icon: ReactNode;
  /** Pusta etykieta = przycisk tylko z ikoną. */
  label: string;
  active?: boolean;
  /**
   * `vertical` (ikona nad etykietą, jak w M3 navigation bar) mieści 5–6 akcji
   * w jednej pigułce. `horizontal` zostawiamy tam, gdzie etykieta jest długa
   * i jest tylko jedna albo dwie (ekran startowy).
   */
  layout?: 'vertical' | 'horizontal';
  accessibilityLabel?: string;
  accessibilityState?: { selected?: boolean; disabled?: boolean; busy?: boolean };
  style?: StyleProp<ViewStyle>;
  labelStyle?: StyleProp<TextStyle>;
  /** Chwilowo niedostępny (np. trwa operacja) - przygaszony, nieklikalny. */
  disabled?: boolean;
}

export function ThumbBarItem({
  onPress,
  icon,
  label,
  active = false,
  layout = 'vertical',
  accessibilityLabel,
  accessibilityState,
  style,
  labelStyle,
}: ThumbBarItemProps) {
  return (
    <Pressable
      onPress={onPress}
      hitSlop={6}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={accessibilityState ?? { selected: active }}
      style={({ pressed }) => [
        styles.item,
        layout === 'horizontal' ? styles.itemRow : styles.itemColumn,
        active && styles.itemActive,
        pressed && styles.itemPressed,
        style,
      ]}
    >
      {icon}
      {label ? (
        <Text
          style={[
            styles.itemLabel,
            layout === 'vertical' && styles.itemLabelVertical,
            active && styles.itemLabelActive,
            labelStyle,
          ]}
          numberOfLines={1}
        >
          {label}
        </Text>
      ) : null}
    </Pressable>
  );
}

export function ThumbBarDivider() {
  return <View style={styles.divider} />;
}

const styles = StyleSheet.create({
  wrapper: {
    position: 'absolute',
    left: 12,
    right: 12,
    alignItems: 'center',
    zIndex: 99,
  },
  bar: {
    flexDirection: 'row',
    alignItems: 'stretch',
    backgroundColor: scheme.surfaceContainerHigh,
    borderRadius: shape.full,
    paddingHorizontal: 4,
    paddingVertical: 4,
    minHeight: 58,
    borderWidth: 1,
    borderColor: scheme.outlineVariant,
    maxWidth: 460,
    width: '100%',
    ...elev.level3,
  },
  // Ikona nad etykietą (jak w M3 navigation baru): mieści się 5–6 akcji w
  // jednej pigułce, a palec trafia w kolumnę, nie w wąski pasek.
  item: {
    justifyContent: 'center',
    gap: 2,
    paddingVertical: 6,
    paddingHorizontal: 2,
    borderRadius: shape.full,
    minHeight: 50,
  },
  itemColumn: {
    flex: 1,
    flexDirection: 'column',
    alignItems: 'center',
  },
  itemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
  },
  itemActive: {
    backgroundColor: scheme.primaryContainer,
  },
  itemPressed: {
    opacity: 0.72,
    transform: [{ scale: 0.96 }],
  },
  itemDisabled: {
    opacity: 0.45,
  },
  itemLabel: {
    ...type.labelSmall,
    lineHeight: 12,
    textAlign: 'center',
    color: scheme.onSurfaceVariant,
    fontWeight: '700',
  },
  itemLabelVertical: {
    fontSize: 10,
  },
  itemLabelActive: {
    color: scheme.onPrimaryContainer,
  },
  divider: {
    width: 1,
    alignSelf: 'center',
    marginVertical: 12,
    backgroundColor: scheme.outlineVariant,
    opacity: 0.5,
  },
});
