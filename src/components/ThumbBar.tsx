// Wspólny „pasek kciuka” — jedna wizualna baza dla całego dolnego menu.
// Wszystkie ekrany mają sterowanie w dolnej, naturalnej strefie kciuka,
// więc wygląd, wysokość dotyku i odległość od krawędzi są tu zdefiniowane raz.
//
// Dwie części:
//  - `ThumbBar`      — pływająca pigułka przyklejona do dołu ekranu,
//  - `ThumbBarItem`  — pojedynczy przycisk ikona + etykieta (>= 44 px,
//                      czyli próg dotyku dla palca w ruchu).

import React, { type ReactNode } from 'react';
import {
  Pressable,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { elev, scheme, shape, type } from '../theme/tokens';

interface ThumbBarProps {
  children: ReactNode;
  /** Odstęp od dołu ekranu nad plikiem `bottom` (domyślnie 10 px). */
  bottom?: number;
  /** Dopasowanie szerokości — np. `left`/`right` dla menu przypiętego do krawędzi. */
  style?: StyleProp<ViewStyle>;
  contentStyle?: StyleProp<ViewStyle>;
  /** Wyłącza pływanie (np. gdy pasek siedzi już w kontenerze panelu). */
  inline?: boolean;
}

export function ThumbBar({ children, bottom = 10, style, contentStyle, inline }: ThumbBarProps) {
  const insets = useSafeAreaInsets();
  if (inline) {
    return <View style={[styles.bar, contentStyle]}>{children}</View>;
  }
  return (
    <View
      pointerEvents="box-none"
      style={[styles.wrapper, { bottom: Math.max(insets.bottom, 10) + bottom }, style]}
    >
      <View style={[styles.bar, contentStyle]}>{children}</View>
    </View>
  );
}

interface ThumbBarItemProps {
  onPress: () => void;
  icon: ReactNode;
  /** Pusta etykieta = przycisk tylko z ikoną. */
  label: string;
  active?: boolean;
  accessibilityLabel?: string;
  accessibilityState?: { selected?: boolean; disabled?: boolean };
  style?: StyleProp<ViewStyle>;
  labelStyle?: StyleProp<ViewStyle>;
}

export function ThumbBarItem({
  onPress,
  icon,
  label,
  active = false,
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
        active && styles.itemActive,
        pressed && styles.itemPressed,
        style,
      ]}
    >
      {icon}
      {label ? (
        <Text
          style={[styles.itemLabel, active && styles.itemLabelActive, labelStyle]}
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
    alignItems: 'center',
    backgroundColor: scheme.surfaceContainerHigh,
    borderRadius: shape.full,
    paddingHorizontal: 6,
    paddingVertical: 5,
    minHeight: 54,
    borderWidth: 1,
    borderColor: scheme.outlineVariant,
    maxWidth: 460,
    width: '100%',
    ...elev.level3,
  },
  item: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 8,
    paddingHorizontal: 4,
    borderRadius: shape.full,
    minHeight: 44,
  },
  itemActive: {
    backgroundColor: scheme.primaryContainer,
  },
  itemPressed: {
    opacity: 0.72,
    transform: [{ scale: 0.96 }],
  },
  itemLabel: {
    ...type.labelMedium,
    color: scheme.onSurfaceVariant,
    fontWeight: '700',
  },
  itemLabelActive: {
    color: scheme.onPrimaryContainer,
  },
  divider: {
    width: 1,
    height: 22,
    backgroundColor: scheme.outlineVariant,
    opacity: 0.5,
  },
});
