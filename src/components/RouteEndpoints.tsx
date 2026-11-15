import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { Easing, FadeIn, FadeOut } from 'react-native-reanimated';
import { Anchor, ArrowUpDown, X } from './icons';
import { LineBadge } from './LineBadge';
import { SpringPressable } from './SpringPressable';
import { useStrings } from '../i18n';
import { scheme, shape, type } from '../theme/tokens';
import type { BoardedTripOrigin } from '../types/models';

// Kotwica i GPS podmieniaja sie w tym samym polu: krotki crossfade, zero
// sprezyny. Spring tu sprezynowal cale pole przy kazdym wejsciu na ekran.
const SWAP_IN = FadeIn.duration(140).easing(Easing.out(Easing.quad));
const SWAP_OUT = FadeOut.duration(90).easing(Easing.in(Easing.quad));

export function RouteEndpoints({
  from,
  to,
  fromLabel,
  onFrom,
  onTo,
  onSwap,
  anchor,
  boarded,
}: {
  from: string;
  to: string;
  fromLabel: string;
  onFrom: () => void;
  onTo: () => void;
  onSwap: () => void;
  anchor?: { stopName: string; onDismiss: () => void; dismissA11y: string };
  boarded?: {
    line: string;
    mode: BoardedTripOrigin['mode'];
    onDismiss: () => void;
    dismissA11y: string;
  };
}) {
  const s = useStrings();
  return (
    <View style={styles.container}>
      <View style={styles.fields}>
        <Pressable
          onPress={onFrom}
          accessibilityRole="button"
          accessibilityLabel={fromLabel}
          style={({ pressed }) => [styles.field, pressed && styles.pressed]}
        >
          <Text style={styles.label}>{s.routeDetails.origin}</Text>
          {boarded ? (
            <Animated.View
              key="boarded"
              style={styles.anchorRow}
              entering={SWAP_IN}
              exiting={SWAP_OUT}
            >
              <LineBadge mode={boarded.mode} line={boarded.line} compact />
              <View style={styles.anchorSpacer} />
              <SpringPressable
                onPress={boarded.onDismiss}
                accessibilityRole="button"
                accessibilityLabel={boarded.dismissA11y}
                style={styles.anchorX}
                scaleDelta={0.05}
              >
                <X size={15} color={scheme.onSurfaceVariant} />
              </SpringPressable>
            </Animated.View>
          ) : anchor ? (
            // Kotwica JEST efektywnym startem: zajmuje pole originu zamiast
            // surowego GPS, wiec user widzi jedno, to co napedza wyszukiwanie.
            <Animated.View key="anchor" style={styles.anchorRow} entering={SWAP_IN} exiting={SWAP_OUT}>
              <Anchor size={13} color={scheme.primary} />
              <Text style={styles.originAnchor} numberOfLines={1}>
                {anchor.stopName}
              </Text>
              <SpringPressable
                onPress={anchor.onDismiss}
                accessibilityRole="button"
                accessibilityLabel={anchor.dismissA11y}
                style={styles.anchorX}
                scaleDelta={0.05}
              >
                <X size={15} color={scheme.onSurfaceVariant} />
              </SpringPressable>
            </Animated.View>
          ) : (
            // GPS wraca na swoje miejsce po usunieciu kotwicy.
            <Animated.View key="gps" entering={SWAP_IN} exiting={SWAP_OUT}>
              <Text style={styles.origin} numberOfLines={1}>
                {from}
              </Text>
            </Animated.View>
          )}
        </Pressable>
        <View style={styles.divider} />
        <Pressable
          onPress={onTo}
          accessibilityRole="button"
          accessibilityLabel={s.routes.changeToA11y(to)}
          style={({ pressed }) => [styles.field, pressed && styles.pressed]}
        >
          <Text style={styles.label}>{s.routeDetails.destination}</Text>
          <Text style={styles.destination}>{to}</Text>
        </Pressable>
      </View>
      <SpringPressable
        onPress={onSwap}
        accessibilityRole="button"
        accessibilityLabel={s.routes.swapA11y}
        style={styles.swap}
        scaleDelta={0.04}
      >
        <ArrowUpDown size={22} color={scheme.primary} />
      </SpringPressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: scheme.surfaceContainerLow,
    borderRadius: shape.extraLarge,
    padding: 16,
  },
  fields: { flex: 1, minWidth: 0 },
  field: { minHeight: 48, justifyContent: 'center', gap: 3, borderRadius: shape.small },
  label: { ...type.bodySmall, color: scheme.onSurfaceVariant },
  origin: { ...type.titleMedium, color: scheme.onSurface },
  destination: { ...type.titleMedium, fontWeight: '600', color: scheme.onSurface },
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: scheme.outlineVariant,
    marginVertical: 8,
  },
  swap: {
    width: 48,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: shape.medium,
    backgroundColor: scheme.surfaceContainerHigh,
  },
  pressed: { backgroundColor: scheme.surfaceContainerHighest },
  anchorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  originAnchor: {
    ...type.bodyMedium,
    fontWeight: '600',
    color: scheme.primary,
    flex: 1,
    minWidth: 0,
  },
  anchorSpacer: {
    flex: 1,
  },
  anchorX: {
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: scheme.surfaceContainerHighest,
  },
});
