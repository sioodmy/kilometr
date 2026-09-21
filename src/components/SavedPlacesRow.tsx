import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Briefcase, Dumbbell, GraduationCap, Heart, Home, Plus, Star } from 'lucide-react-native';
import { elev, scheme, shape, type } from '../theme/tokens';
import type { SavedPlace, SavedPlaceIcon } from '../types/models';

const ICONS: Record<SavedPlaceIcon, any> = {
  home: Home,
  school: GraduationCap,
  work: Briefcase,
  gym: Dumbbell,
  star: Star,
  heart: Heart,
  plus: Plus,
};

// M3 filled cards: tonal icon container, no borders, shape large.
export function SavedPlacesRow({
  places,
  onSelect,
  onAdd,
}: {
  places: SavedPlace[];
  onSelect: (p: SavedPlace) => void;
  onAdd: () => void;
}) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
      {places.map((p) => {
        const Icon = ICONS[p.icon] ?? Star;
        return (
          <Pressable key={p.id} onPress={() => onSelect(p)} style={({ pressed }) => [styles.card, pressed && { backgroundColor: scheme.surfaceContainerHighest }]}>
            <View style={styles.icon}>
              <Icon size={20} color={scheme.onSecondaryContainer} />
            </View>
            <Text style={styles.name} numberOfLines={1}>{p.name}</Text>
            <Text style={styles.addr} numberOfLines={1}>{p.address.split(',')[0]}</Text>
          </Pressable>
        );
      })}
      {/* M3 outlined "add" card */}
      <Pressable onPress={onAdd} style={({ pressed }) => [styles.card, styles.add, pressed && { backgroundColor: scheme.surfaceContainerHighest }]}>
        <View style={[styles.icon, styles.addIcon]}>
          <Plus size={20} color={scheme.primary} />
        </View>
        <Text style={styles.name}>Dodaj</Text>
        <Text style={styles.addr}>własne miejsce</Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  row: { gap: 10, paddingVertical: 4 },
  card: {
    width: 112,
    backgroundColor: scheme.surfaceContainer,
    borderRadius: shape.large,
    padding: 12,
    gap: 6,
    ...elev.level1,
  },
  add: { backgroundColor: 'transparent', borderWidth: 1, borderColor: scheme.outlineVariant, borderStyle: 'dashed', elevation: 0 },
  icon: { width: 40, height: 40, borderRadius: shape.full, backgroundColor: scheme.secondaryContainer, alignItems: 'center', justifyContent: 'center' },
  addIcon: { backgroundColor: scheme.primaryContainer },
  name: { ...type.titleSmall, color: scheme.onSurface },
  addr: { ...type.bodySmall, color: scheme.onSurfaceVariant },
});
