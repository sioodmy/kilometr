import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { ArrowUpDown } from 'lucide-react-native';
import { useStrings } from '../i18n';
import { scheme, shape, type } from '../theme/tokens';

export function RouteEndpoints({
  from,
  to,
  fromLabel,
  onFrom,
  onTo,
  onSwap,
  accessory,
}: {
  from: string;
  to: string;
  fromLabel: string;
  onFrom: () => void;
  onTo: () => void;
  onSwap: () => void;
  accessory?: ReactNode;
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
          <Text style={styles.origin}>{from}</Text>
        </Pressable>
        {accessory}
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
        <ArrowUpDown size={22} color={scheme.primary} strokeWidth={1.8} />
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
});
