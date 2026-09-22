import { Pressable, StyleSheet, Text, View } from 'react-native';
import {
  Church,
  Clock3,
  Dumbbell,
  Film,
  Fuel,
  GraduationCap,
  Hotel,
  Landmark,
  MapPin,
  Pill,
  ShoppingBag,
  BusFront,
  Store,
  Train,
  TreePine,
  Utensils,
} from 'lucide-react-native';
import { elev, scheme, shape, type } from '../theme/tokens';
import type { Suggestion, SuggestionKind } from '../types/models';
import { formatWalkTime } from '../services/settings';

const KIND_META: Record<string, { Icon: any; bg: string; fg: string }> = {
  stop:          { Icon: BusFront,      bg: scheme.secondaryContainer,       fg: scheme.onSecondaryContainer },
  address:       { Icon: MapPin,        bg: scheme.tertiaryContainer,        fg: scheme.onTertiaryContainer },
  history:       { Icon: Clock3,        bg: scheme.surfaceContainerHighest,  fg: scheme.onSurfaceVariant },
  // Nominatim category icons (M3 dark tonal containers):
  shop:          { Icon: Store,         bg: scheme.primaryContainer,         fg: scheme.onPrimaryContainer },
  restaurant:    { Icon: Utensils,      bg: '#4E2600',                       fg: '#FFB68F' },
  medical:       { Icon: Pill,          bg: '#0F381E',                       fg: '#81C784' },
  school:        { Icon: GraduationCap, bg: '#0D3559',                       fg: '#90CAF9' },
  entertainment: { Icon: Film,          bg: '#381A4C',                       fg: '#CE93D8' },
  fuel:          { Icon: Fuel,          bg: '#422C00',                       fg: '#FFD54F' },
  train:         { Icon: Train,         bg: '#00363A',                       fg: '#80DEEA' },
  tourism:       { Icon: Hotel,         bg: '#3E1C14',                       fg: '#FF8A65' },
  sport:         { Icon: Dumbbell,      bg: '#1A237E',                       fg: '#9FA8DA' },
  bank:          { Icon: Landmark,      bg: '#263238',                       fg: '#B0BEC5' },
  church:        { Icon: Church,        bg: '#333816',                       fg: '#DCE775' },
  place:         { Icon: ShoppingBag,   bg: scheme.primaryContainer,         fg: scheme.onPrimaryContainer },
};

export function SuggestionRow({ item, onPress }: { item: Suggestion; onPress: () => void }) {
  // Use category if available, otherwise fall back to kind
  const key = item.category || item.kind;
  const meta = KIND_META[key] || KIND_META['place'];
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
          {item.distanceM != null
            ? ` • ${formatWalkTime(Math.max(1, Math.round(item.distanceM / 80)))}`
            : ''}
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
