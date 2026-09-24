import { Pressable, StyleSheet, Text, View } from 'react-native';
import { ArrowLeftRight } from 'lucide-react-native';
import { elev, scheme, shape, type } from '../theme/tokens';
import { M3Switch } from './M3Switch';

// ─── Jednorazowy filtr "Tylko bezpośrednie" (M3) ─────────────────────────────
// To NIE jest ustawienie systemowe (to zostaje w /settings → max przesiadki).
// Ten przełącznik to szybkie "na raz": wymusza maxTransfers=0 tylko dla
// bieżącego ekranu wyników. Stan nie jest persistowany.

export function DirectOnlyFilter({
  value,
  onChange,
}: {
  value: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <Pressable
      onPress={() => onChange(!value)}
      accessibilityRole="switch"
      accessibilityState={{ checked: value }}
      accessibilityLabel={
        value
          ? 'Tylko bezpośrednie — włączone. Dotknij, aby pokazać połączenia z przesiadkami.'
          : 'Tylko bezpośrednie — wyłączone. Dotknij, aby pokazać tylko połączenia bez przesiadek.'
      }
      style={({ pressed }) => [
        styles.card,
        value && styles.cardActive,
        pressed && { opacity: 0.92, transform: [{ scale: 0.99 }] },
      ]}
    >
      <View style={[styles.iconCircle, value && styles.iconCircleActive]}>
        <ArrowLeftRight size={18} color={value ? scheme.onPrimary : scheme.onSurfaceVariant} />
      </View>
      <View style={styles.texts}>
        <Text style={[styles.title, value && styles.titleActive]} numberOfLines={1}>
          Tylko bezpośrednie
        </Text>
        <Text style={[styles.sub, value && styles.subActive]} numberOfLines={1}>
          {value ? 'Bez przesiadek • tylko na teraz' : 'Pokaż kursy bez przesiadek'}
        </Text>
      </View>
      <M3Switch value={value} onChange={onChange} label="Tylko bezpośrednie" />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: scheme.surfaceContainerHigh,
    borderRadius: shape.large,
    paddingVertical: 10,
    paddingLeft: 12,
    paddingRight: 14,
    ...elev.level1,
  },
  cardActive: {
    backgroundColor: scheme.primaryContainer,
  },
  iconCircle: {
    width: 40,
    height: 40,
    borderRadius: shape.full,
    backgroundColor: scheme.surfaceContainerHighest,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  iconCircleActive: {
    backgroundColor: scheme.primary,
  },
  texts: {
    flex: 1,
    minWidth: 0,
    gap: 1,
  },
  title: {
    ...type.labelLarge,
    fontWeight: '600',
    color: scheme.onSurface,
  },
  titleActive: {
    color: scheme.onPrimaryContainer,
    fontWeight: '700',
  },
  sub: {
    ...type.bodySmall,
    color: scheme.onSurfaceVariant,
  },
  subActive: {
    color: scheme.onPrimaryContainer,
    opacity: 0.8,
  },
});
