// Pływający pionowy pasek akcji dla map pełnoekranowych w stylu M3 Expressive:
// przyciski dotykowe 48x48dp z animacją sprężynową, haptyką i stanem aktywnym.

import React, { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import type { IconComponent } from './icons';
import { SpringPressable } from './SpringPressable';
import { elev, scheme, shape } from '../theme/tokens';

export interface MapActionItem {
  id: string;
  icon: IconComponent;
  accessibilityLabel: string;
  onPress: () => void;
  active?: boolean;
  tone?: 'surface' | 'primary' | 'secondary';
  disabled?: boolean;
}

interface MapActionRailProps {
  /** Górna grupa akcji (np. warstwy, kadrowanie, śledzenie). */
  actions: MapActionItem[];
  /** Opcjonalna dolna kapsułka połączonych przycisków (np. zoom + / -). */
  zoomPair?: [MapActionItem, MapActionItem];
  /** Opcjonalny wyróżniony przycisk główny (np. moja lokalizacja GPS). */
  primaryAction?: MapActionItem;
}

function ActionButton({
  item,
  grouped = false,
}: {
  item: MapActionItem;
  grouped?: boolean;
}) {
  const [focused, setFocused] = useState(false);
  const Icon = item.icon;
  const isPrimary = item.tone === 'primary' || item.active;
  const isSecondary = item.tone === 'secondary' && !item.active;

  const iconColor = item.disabled
    ? scheme.onSurfaceVariant
    : isPrimary
      ? scheme.onPrimaryContainer
      : isSecondary
        ? scheme.onSecondaryContainer
        : scheme.onSurface;

  return (
    <SpringPressable
      onPress={item.onPress}
      disabled={item.disabled}
      haptic="selection"
      scaleDelta={0.055}
      accessibilityRole="button"
      accessibilityLabel={item.accessibilityLabel}
      accessibilityState={{ selected: Boolean(item.active), disabled: Boolean(item.disabled) }}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      style={[
        grouped ? styles.groupedBtn : styles.soloBtn,
        !grouped && isPrimary && styles.soloBtnActive,
        !grouped && isSecondary && styles.soloBtnSecondary,
        grouped && isPrimary && styles.groupedBtnActive,
        item.disabled && styles.btnDisabled,
        focused && styles.focused,
      ]}
    >
      <Icon size={21} color={iconColor} />
    </SpringPressable>
  );
}

/** Pionowa szyna pływających kontrolek M3 Expressive po prawej krawędzi mapy. */
export function MapActionRail({ actions, zoomPair, primaryAction }: MapActionRailProps) {
  return (
    <View style={styles.rail} pointerEvents="box-none">
      {actions.map((item) => (
        <ActionButton key={item.id} item={item} />
      ))}

      {zoomPair && (
        <View style={styles.zoomGroup}>
          <ActionButton item={zoomPair[0]} grouped />
          <View style={styles.zoomDivider} />
          <ActionButton item={zoomPair[1]} grouped />
        </View>
      )}

      {primaryAction && <ActionButton item={primaryAction} />}
    </View>
  );
}

const styles = StyleSheet.create({
  rail: {
    alignItems: 'center',
    gap: 10,
  },
  soloBtn: {
    width: 48,
    height: 48,
    borderRadius: 18,
    backgroundColor: scheme.surfaceContainerHigh,
    borderWidth: 2,
    borderColor: scheme.outlineVariant,
    alignItems: 'center',
    justifyContent: 'center',
    ...elev.level2,
  },
  soloBtnActive: {
    borderRadius: shape.full,
    backgroundColor: scheme.primaryContainer,
    borderWidth: 1.5,
    borderColor: scheme.primary,
  },
  soloBtnSecondary: {
    backgroundColor: scheme.secondaryContainer,
    borderColor: scheme.outlineVariant,
  },
  zoomGroup: {
    borderRadius: 18,
    backgroundColor: scheme.surfaceContainerHigh,
    borderWidth: 2,
    borderColor: scheme.outlineVariant,
    overflow: 'hidden',
    ...elev.level2,
  },
  groupedBtn: {
    width: 48,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  groupedBtnActive: {
    backgroundColor: scheme.primaryContainer,
  },
  zoomDivider: {
    height: StyleSheet.hairlineWidth,
    marginHorizontal: 10,
    backgroundColor: scheme.outlineVariant,
  },
  btnDisabled: {
    opacity: 0.48,
  },
  focused: {
    borderWidth: 2,
    borderColor: scheme.primary,
  },
});
