import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { Easing, FadeIn, FadeOut } from 'react-native-reanimated';
import { Anchor, ArrowUpDown, X } from './icons';
import { useStrings } from '../i18n';
import { scheme, shape, type } from '../theme/tokens';

// Kotwica i GPS podmieniają się w tym samym polu: krótki crossfade, zero
// sprężyny. Spring tu sprężynował całe pole przy każdym wejściu na ekran.
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
}: {
  from: string;
  to: string;
  fromLabel: string;
  onFrom: () => void;
  onTo: () => void;
  onSwap: () => void;
  anchor?: { stopName: string; onDismiss: () => void; dismissA11y: string };
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
          {anchor ? (
            // Kotwica JEST efektywnym startem: zajmuje pole originu zamiast
            // surowego GPS, więc user widzi jedno, to co napędza wyszukiwanie.
            <Animated.View key="anchor" style={styles.anchorRow} entering={SWAP_IN} exiting={SWAP_OUT}>
              <Anchor size={13} color={scheme.primary} />
              <Text style={styles.originAnchor} numberOfLines={1}>
                {anchor.stopName}
              </Text>
              <Pressable
                onPress={anchor.onDismiss}
                accessibilityRole="button"
                accessibilityLabel={anchor.dismissA11y}
                style={styles.anchorX}
                hitSlop={10}
              >
                <X size={13} color={scheme.onSurfaceVariant} />
              </Pressable>
            </Animated.View>
          ) : (
            // GPS wraca na swoje miejsce po usunięciu kotwicy.
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
      <Pressable
        onPress={onSwap}
        accessibilityRole="button"
        accessibilityLabel={s.routes.swapA11y}
        style={({ pressed }) => [styles.swap, pressed && styles.pressed]}
      >
        <ArrowUpDown size={22} color={scheme.primary} />
      </Pressable>
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
  // Kotwica w linii z nazwą: rząd wygląda jak tekst pola, nie jak chip.
  anchorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    flexShrink: 1,
    minWidth: 0,
  },
  originAnchor: {
    ...type.titleMedium,
    fontWeight: '600',
    color: scheme.primary,
    flexShrink: 1,
  },
  anchorX: {
    width: 28,
    height: 28,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: shape.full,
  },
});
