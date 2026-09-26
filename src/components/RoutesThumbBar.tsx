import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  ArrowUpDown,
  BusFront,
  Clock3,
  Layers,
  RotateCw,
  TramFront,
  Zap,
} from 'lucide-react-native';
import { elev, scheme, shape, type } from '../theme/tokens';
import type { ModePreference } from './RouteFiltersCard';

export interface RoutesThumbBarProps {
  onSwap: () => void;
  directOnly: boolean;
  onToggleDirect: () => void;
  timeLabel: string;
  isCustomTime: boolean;
  onOpenTimeSheet: () => void;
  modeFilter: ModePreference;
  onCycleMode: () => void;
  onRefresh?: () => void;
  refreshing?: boolean;
}

/**
 * Pływający pasek szybkiej obsługi jedną ręką w tramwaju (Thumb Zone).
 * Umieszczony w dolnej, naturalnej strefie kciuka:
 * - Szybkie odwrócenie trasy (powrót)
 * - Przełącznik połączeń bezpośrednich (bez przesiadek)
 * - Szybki wybór czasu odjazdu / powrót do „Teraz”
 * - Cykl filtrowania pojazdów (tramwaj / autobus / wszystkie)
 */
export function RoutesThumbBar({
  onSwap,
  directOnly,
  onToggleDirect,
  timeLabel,
  isCustomTime,
  onOpenTimeSheet,
  modeFilter,
  onCycleMode,
  onRefresh,
  refreshing,
}: RoutesThumbBarProps) {
  const insets = useSafeAreaInsets();

  const renderModeIcon = () => {
    const color = modeFilter !== 'all' ? scheme.onPrimaryContainer : scheme.onSurfaceVariant;
    if (modeFilter === 'tram') return <TramFront size={16} color={color} />;
    if (modeFilter === 'bus') return <BusFront size={16} color={color} />;
    return <Layers size={16} color={color} />;
  };

  const modeLabel =
    modeFilter === 'tram' ? 'Tramwaje' : modeFilter === 'bus' ? 'Autobusy' : 'Pojazdy';

  return (
    <View
      pointerEvents="box-none"
      style={[styles.floatingWrapper, { bottom: Math.max(insets.bottom, 10) + 10 }]}
    >
      <View style={styles.bar}>
        {/* Odwrócenie trasy (powrót) */}
        <Pressable
          onPress={onSwap}
          hitSlop={6}
          accessibilityRole="button"
          accessibilityLabel="Odwróć trasę: zamień punkt startowy z docelowym"
          style={({ pressed }) => [styles.btn, pressed && styles.btnPressed]}
        >
          <View style={styles.iconCircle}>
            <ArrowUpDown size={15} color={scheme.primary} />
          </View>
          <Text style={styles.btnLabel}>Odwróć</Text>
        </Pressable>

        <View style={styles.divider} />

        {/* Filtr: tylko bezpośrednie */}
        <Pressable
          onPress={onToggleDirect}
          hitSlop={6}
          accessibilityRole="button"
          accessibilityLabel={
            directOnly
              ? 'Filtr połączeń bezpośrednich: aktywny. Dotknij, aby pokazać wszystkie.'
              : 'Filtr połączeń bezpośrednich: nieaktywny. Dotknij, aby włączyć.'
          }
          style={({ pressed }) => [
            styles.btn,
            directOnly && styles.btnActive,
            pressed && styles.btnPressed,
          ]}
        >
          <Zap
            size={15}
            color={directOnly ? scheme.onPrimaryContainer : scheme.onSurfaceVariant}
            fill={directOnly ? scheme.onPrimaryContainer : 'transparent'}
          />
          <Text style={[styles.btnLabel, directOnly && styles.btnLabelActive]}>
            Bezpośr.
          </Text>
        </Pressable>

        <View style={styles.divider} />

        {/* Czas odjazdu */}
        <Pressable
          onPress={onOpenTimeSheet}
          hitSlop={6}
          accessibilityRole="button"
          accessibilityLabel={`Czas odjazdu: ${timeLabel}. Dotknij, aby zmienić.`}
          style={({ pressed }) => [
            styles.btn,
            isCustomTime && styles.btnActive,
            pressed && styles.btnPressed,
          ]}
        >
          <Clock3
            size={15}
            color={isCustomTime ? scheme.onPrimaryContainer : scheme.onSurfaceVariant}
          />
          <Text
            style={[styles.btnLabel, isCustomTime && styles.btnLabelActive]}
            numberOfLines={1}
          >
            {timeLabel}
          </Text>
        </Pressable>

        <View style={styles.divider} />

        {/* Tryb pojazdu: Tram / Autobus / Wszystkie */}
        <Pressable
          onPress={onCycleMode}
          hitSlop={6}
          accessibilityRole="button"
          accessibilityLabel={`Filtruj środek transportu: aktualnie ${modeLabel}. Dotknij, aby zmienić.`}
          style={({ pressed }) => [
            styles.btn,
            modeFilter !== 'all' && styles.btnActive,
            pressed && styles.btnPressed,
          ]}
        >
          {renderModeIcon()}
          <Text
            style={[styles.btnLabel, modeFilter !== 'all' && styles.btnLabelActive]}
            numberOfLines={1}
          >
            {modeLabel}
          </Text>
        </Pressable>

        {/* Opcjonalny przycisk szybkiego odświeżenia live */}
        {onRefresh ? (
          <>
            <View style={styles.divider} />
            <Pressable
              onPress={onRefresh}
              hitSlop={6}
              accessibilityRole="button"
              accessibilityLabel="Odśwież rozkłady i pozycje na żywo"
              style={({ pressed }) => [
                styles.iconOnlyBtn,
                pressed && styles.btnPressed,
              ]}
            >
              <RotateCw
                size={16}
                color={refreshing ? scheme.primary : scheme.onSurfaceVariant}
              />
            </Pressable>
          </>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  floatingWrapper: {
    position: 'absolute',
    left: 14,
    right: 14,
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
    maxWidth: 440,
    width: '100%',
    justifyContent: 'space-between',
    ...elev.level3,
  },
  btn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    paddingVertical: 8,
    paddingHorizontal: 6,
    borderRadius: shape.full,
    minHeight: 42,
  },
  btnActive: {
    backgroundColor: scheme.primaryContainer,
  },
  btnPressed: {
    opacity: 0.75,
    transform: [{ scale: 0.96 }],
  },
  iconCircle: {
    width: 22,
    height: 22,
    borderRadius: shape.full,
    backgroundColor: scheme.secondaryContainer,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnLabel: {
    ...type.labelMedium,
    color: scheme.onSurface,
    fontWeight: '600',
  },
  btnLabelActive: {
    color: scheme.onPrimaryContainer,
    fontWeight: '700',
  },
  divider: {
    width: 1,
    height: 20,
    backgroundColor: scheme.outlineVariant,
    opacity: 0.5,
  },
  iconOnlyBtn: {
    width: 38,
    height: 38,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: shape.full,
  },
});
