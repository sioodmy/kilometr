import { Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import {
  Baby,
  Beer,
  Bike,
  Briefcase,
  BusFront,
  CarFront,
  Church,
  Clapperboard,
  Coffee,
  Compass,
  CreditCard,
  Dumbbell,
  Fuel,
  Gamepad2,
  GraduationCap,
  Heart,
  Home,
  Hospital,
  Landmark,
  Laptop,
  Library,
  MapPin,
  Mountain,
  Music,
  Package,
  PawPrint,
  Pencil,
  Pill,
  Pizza,
  Plane,
  Plus,
  Sandwich,
  Scissors,
  Ship,
  ShoppingBag,
  ShoppingCart,
  Sparkles,
  Star,
  Stethoscope,
  Store,
  Tent,
  Theater,
  Ticket,
  Train,
  TramFront,
  Trees,
  Trophy,
  University,
  Users,
  UtensilsCrossed,
  Waves,
  Wine,
} from 'lucide-react-native';
import { scheme, shape, type } from '../theme/tokens';
import type { SavedPlace, SavedPlaceIcon } from '../types/models';
import { useStrings } from '../i18n';

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
  restaurant: UtensilsCrossed,
  pharmacy: Pill,
  park: Trees,
  cinema: Clapperboard,
  culture: Landmark,
  library: Library,
  friends: Users,
  church: Church,
  car: CarFront,
  bike: Bike,
  plane: Plane,
  market: Store,
  university: University,
  tram: TramFront,
  bus: BusFront,
  fuel: Fuel,
  ship: Ship,
  compass: Compass,
  pizza: Pizza,
  sandwich: Sandwich,
  beer: Beer,
  wine: Wine,
  cart: ShoppingCart,
  hospital: Hospital,
  doctor: Stethoscope,
  scissors: Scissors,
  sparkles: Sparkles,
  theater: Theater,
  music: Music,
  ticket: Ticket,
  gamepad: Gamepad2,
  mountain: Mountain,
  tent: Tent,
  trophy: Trophy,
  swimming: Waves,
  baby: Baby,
  pet: PawPrint,
  hotel: Landmark,
  bank: CreditCard,
  post: Package,
  laptop: Laptop,
};

export function SavedPlacesRow({
  places,
  onSelect,
  onManage,
  onEdit,
}: {
  places: SavedPlace[];
  onSelect: (p: SavedPlace) => void;
  /** Ostatnia karta otwiera menu edycji (tam też dodawanie). */
  onManage: () => void;
  onEdit?: (p: SavedPlace) => void;
}) {
  const s = useStrings();
  const { width, fontScale } = useWindowDimensions();
  const cardWidth = Math.min(width - 40, 156 * Math.max(1, fontScale));
  return (
    <ScrollView
      style={styles.scroller}
      horizontal
      showsHorizontalScrollIndicator={false}
      overScrollMode="never"
      contentContainerStyle={styles.row}
    >
      {places.map((p) => {
        const Icon = SAVED_PLACE_ICONS[p.icon] ?? Star;
        return (
          <Pressable
            key={p.id}
            onPress={() => onSelect(p)}
            accessibilityRole="button"
            accessibilityLabel={s.home.searchToA11y(p.name)}
            accessibilityHint={onEdit ? s.home.editPlaceHint : undefined}
            onLongPress={() => onEdit?.(p)}
            delayLongPress={300}
            style={({ pressed }) => [
              styles.card,
              { width: cardWidth },
              pressed && { backgroundColor: scheme.surfaceContainerHighest },
            ]}
          >
            <View style={styles.icon}>
              <Icon size={20} color={scheme.onSecondaryContainer} />
            </View>
            <View style={styles.textContainer}>
              <Text style={styles.name} numberOfLines={fontScale > 1.3 ? undefined : 2}>
                {p.name}
              </Text>
              <Text style={styles.addr} numberOfLines={fontScale > 1.3 ? undefined : 2}>
                {p.address.split(',')[0]}
              </Text>
            </View>
          </Pressable>
        );
      })}
      <Pressable
        onPress={onManage}
        accessibilityRole="button"
        accessibilityLabel={s.home.editSavedA11y}
        style={({ pressed }) => [
          styles.card,
          styles.manageCard,
          { width: cardWidth },
          pressed && { backgroundColor: scheme.surfaceContainerHighest },
        ]}
      >
        <View style={[styles.icon, styles.addIcon]}>
          <Pencil size={20} color={scheme.primary} />
        </View>
        <View style={styles.textContainer}>
          <Text style={styles.name}>{s.home.editCard}</Text>
          <Text style={styles.addr}>{s.home.editCardSub}</Text>
        </View>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroller: { flexGrow: 0, flexShrink: 0 },
  row: { gap: 12, paddingVertical: 4, alignItems: 'stretch' },
  card: {
    minHeight: 156,
    backgroundColor: scheme.surfaceContainerLow,
    borderRadius: shape.extraLarge,
    padding: 18,
    gap: 20,
    justifyContent: 'space-between',
  },
  manageCard: { backgroundColor: scheme.surfaceContainer },
  icon: {
    width: 40,
    height: 40,
    borderRadius: shape.medium,
    backgroundColor: scheme.secondaryContainer,
    alignItems: 'center',
    justifyContent: 'center',
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
