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
  type TextStyle,
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
  labelStyle?: StyleProp<TextStyle>;
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
      ) : null}    </Pressable>
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
    flex: 1,
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
    paddingVertical: 6,
    paddingHorizontal: 2,
    borderRadius: shape.full,
    minHeight: 50,
  },
  itemActive: {
    backgroundColor: scheme.primaryContainer,
  },
  itemPressed: {
    opacity: 0.72,
    transform: [{ scale: 0.96 }],
  },
  itemLabel: {
    ...type.labelSmall,
    fontSize: 10,
    lineHeight: 12,
    textAlign: 'center',
    color: scheme.onSurfaceVariant,
    fontWeight: '700',
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
