import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Clock3, MapPin, ShoppingBag, Signpost } from 'lucide-react-native';
import { scheme, shape, type } from '../theme/tokens';
import type { Suggestion } from '../types/models';

// M3 list item: two-line, tonal leading container, chevron-free (tap = go).
const KIND_META = {
  stop: { Icon: Signpost, bg: scheme.secondaryContainer, fg: scheme.onSecondaryContainer },
  address: { Icon: MapPin, bg: scheme.tertiaryContainer, fg: scheme.onTertiaryContainer },
  place: { Icon: ShoppingBag, bg: scheme.primaryContainer, fg: scheme.onPrimaryContainer },
  history: { Icon: Clock3, bg: scheme.surfaceContainerHighest, fg: scheme.onSurfaceVariant },
} as const;

export function SuggestionRow({ item, onPress }: { item: Suggestion; onPress: () => void }) {
  const meta = KIND_META[item.kind];
  const Icon = meta.Icon;
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.row, pressed && { backgroundColor: scheme.surfaceContainerHighest }]}
    >
      <View style={[styles.icon, { backgroundColor: meta.bg }]}>
        <Icon size={19} color={meta.fg} />
      </View>
      <View style={styles.mid}>
        <Text style={styles.title} numberOfLines={1}>{item.title}</Text>
        <Text style={styles.sub} numberOfLines={1}>
          {item.address}
          {item.distanceM != null ? ` • ${item.distanceM >= 1000 ? `${(item.distanceM / 1000).toFixed(1)} km` : `${item.distanceM} m`}` : ''}
        </Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 10, paddingHorizontal: 16, borderRadius: shape.large },
  icon: { width: 44, height: 44, borderRadius: shape.full, alignItems: 'center', justifyContent: 'center' },
  mid: { flex: 1, gap: 1 },
  title: { ...type.bodyLarge, color: scheme.onSurface },
  sub: { ...type.bodyMedium, color: scheme.onSurfaceVariant },
});
