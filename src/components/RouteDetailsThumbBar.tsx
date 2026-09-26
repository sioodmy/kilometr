import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ArrowLeft, ArrowUpDown } from 'lucide-react-native';
import { elev, scheme, shape, type } from '../theme/tokens';

interface RouteDetailsThumbBarProps {
  onBack: () => void;
  onReverseRoute: () => void;
}

/**
 * Dolny pasek nawigacji w szczegółach połączenia (Route Details Thumb Bar).
 * Pozwala wygodnie jedną ręką:
 * - Wrócić do listy tras bez sięgania do lewego górnego rogu
 * - Błyskawicznie sprawdzić powrót (odwrócenie trasy)
 */
export function RouteDetailsThumbBar({
  onBack,
  onReverseRoute,
}: RouteDetailsThumbBarProps) {
  const insets = useSafeAreaInsets();

  return (
    <View
      pointerEvents="box-none"
      style={[styles.wrapper, { bottom: Math.max(insets.bottom, 10) + 10 }]}
    >
      <View style={styles.bar}>
        {/* Przycisk powrotu w strefie kciuka */}
        <Pressable
          onPress={onBack}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="Wróć do listy połączeń"
          style={({ pressed }) => [styles.btn, pressed && styles.btnPressed]}
        >
          <ArrowLeft size={18} color={scheme.onSurface} />
          <Text style={styles.btnLabel}>Wróć</Text>
        </Pressable>

        <View style={styles.divider} />

        {/* Trasa powrotna */}
        <Pressable
          onPress={onReverseRoute}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="Pokaż trasę powrotną"
          style={({ pressed }) => [
            styles.btn,
            styles.returnBtn,
            pressed && styles.btnPressed,
          ]}
        >
          <ArrowUpDown size={17} color={scheme.onPrimaryContainer} />
          <Text style={styles.returnLabel}>Trasa powrotna</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    position: 'absolute',
    left: 16,
    right: 16,
    alignItems: 'center',
    zIndex: 99,
  },
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: scheme.surfaceContainerHigh,
    borderRadius: shape.full,
    paddingHorizontal: 8,
    paddingVertical: 5,
    minHeight: 52,
    borderWidth: 1,
    borderColor: scheme.outlineVariant,
    maxWidth: 420,
    width: '100%',
    justifyContent: 'space-between',
    ...elev.level3,
  },
  btn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 9,
    paddingHorizontal: 12,
    borderRadius: shape.full,
    minHeight: 42,
  },
  returnBtn: {
    backgroundColor: scheme.primaryContainer,
  },
  btnLabel: {
    ...type.labelLarge,
    color: scheme.onSurface,
    fontWeight: '600',
  },
  returnLabel: {
    ...type.labelLarge,
    color: scheme.onPrimaryContainer,
    fontWeight: '700',
  },
  divider: {
    width: 1,
    height: 24,
    backgroundColor: scheme.outlineVariant,
    opacity: 0.5,
  },
  btnPressed: {
    opacity: 0.75,
    transform: [{ scale: 0.96 }],
  },
});
