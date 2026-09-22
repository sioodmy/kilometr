import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import {
  Briefcase,
  Coffee,
  Dumbbell,
  GraduationCap,
  Heart,
  Home,
  MapPin,
  Plus,
  ShoppingBag,
  Star,
  Train,
} from 'lucide-react-native';
import { elev, scheme, shape, type } from '../theme/tokens';
import type { SavedPlace, SavedPlaceIcon } from '../types/models';

export const SAVED_PLACE_ICONS: Record<SavedPlaceIcon, any> = {
  home: Home,
  school: GraduationCap,
  work: Briefcase,
  gym: Dumbbell,
  star: Star,
  heart: Heart,
  coffee: Coffee,
  shopping: ShoppingBag,
  train: Train,
  mapPin: MapPin,
  plus: Plus,
};

// M3 filled cards: tonal icon container, no borders, shape large.
export function SavedPlacesRow({
  places,
  onSelect,
  onAdd,
  onEdit,
}: {
  places: SavedPlace[];
  onSelect: (p: SavedPlace) => void;
  onAdd: () => void;
  onEdit?: (p: SavedPlace) => void;
}) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} overScrollMode="never" contentContainerStyle={styles.row}>
      {places.map((p) => {
        const Icon = SAVED_PLACE_ICONS[p.icon] ?? Star;
        return (
          <Pressable 
            key={p.id} 
            onPress={() => onSelect(p)} 
            onLongPress={() => onEdit?.(p)}
            delayLongPress={300}
            style={({ pressed }) => [styles.card, pressed && { backgroundColor: scheme.surfaceContainerHighest, transform: [{ scale: 0.98 }] }]}
          >
            <View style={styles.icon}>
              <Icon size={20} color={scheme.onSecondaryContainer} />
            </View>
            <View style={styles.textContainer}>
              <Text style={styles.name} numberOfLines={1}>{p.name}</Text>
              <Text style={styles.addr} numberOfLines={1}>{p.address.split(',')[0]}</Text>
            </View>
          </Pressable>
        );
      })}
      {/* M3 outlined "add" card */}
      <Pressable
        onPress={onAdd}
        style={({ pressed }) => [
          styles.card,
          styles.add,
          pressed && { backgroundColor: scheme.surfaceContainerHighest, transform: [{ scale: 0.98 }] },
        ]}
      >
        <View style={[styles.icon, styles.addIcon]}>
          <Plus size={20} color={scheme.primary} />
        </View>
        <View style={styles.textContainer}>
          <Text style={styles.name}>Dodaj</Text>
          <Text style={styles.addr}>własne miejsce</Text>
        </View>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  row: { gap: 10, paddingVertical: 4 },
  card: {
    width: 114,
    minHeight: 116,
    backgroundColor: scheme.surfaceContainer,
    borderRadius: shape.large,
    padding: 12,
    justifyContent: 'space-between',
    ...elev.level1,
  },
  add: {
    backgroundColor: 'transparent',
    borderWidth: 1.5,
    borderColor: scheme.outlineVariant,
    borderStyle: 'dashed',
    elevation: 0,
  },
  icon: {
    width: 40,
    height: 40,
    borderRadius: shape.full,
    backgroundColor: scheme.secondaryContainer,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  addIcon: {
    backgroundColor: scheme.primaryContainer,
  },
  textContainer: {
    gap: 2,
  },
  name: { ...type.titleSmall, color: scheme.onSurface },
  addr: { ...type.bodySmall, color: scheme.onSurfaceVariant },
});
