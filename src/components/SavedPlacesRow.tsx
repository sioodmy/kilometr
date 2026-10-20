import { useState } from 'react';
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
  onAdd,
  onEdit,
}: {
  places: SavedPlace[];
  onSelect: (p: SavedPlace) => void;
  onAdd: () => void;
  onEdit?: (p: SavedPlace) => void;
}) {
  const s = useStrings();
  const { width, fontScale } = useWindowDimensions();
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const cardWidth = Math.min(width - 64, 160 * Math.max(1, fontScale));
  const textLines = fontScale > 1.3 ? undefined : 2;

  if (places.length === 0) {
    return (
      <Pressable
        onPress={onAdd}
        onFocus={() => setFocusedId('add')}
        onBlur={() => setFocusedId(null)}
        accessibilityRole="button"
        style={({ pressed }) => [
          styles.emptyCard,
          focusedId === 'add' && styles.focused,
          pressed && styles.pressed,
        ]}
      >
        <View style={styles.icon}>
          <Plus size={24} color={scheme.onSecondaryContainer} />
        </View>
        <View style={styles.emptyText}>
          <Text style={styles.emptyTitle}>{s.places.addNew}</Text>
          <Text style={styles.emptyBody}>{s.places.emptyBody}</Text>
        </View>
      </Pressable>
    );
  }

  return (
    <ScrollView
      style={styles.scroller}
      horizontal
      showsHorizontalScrollIndicator={false}
      overScrollMode="never"
      contentContainerStyle={styles.row}
      snapToInterval={cardWidth + 8}
      decelerationRate="fast"
      snapToAlignment="start"
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
            accessibilityActions={
              onEdit ? [{ name: 'edit', label: s.places.editA11y(p.name) }] : undefined
            }
            onAccessibilityAction={(event) => {
              if (event.nativeEvent.actionName === 'edit') onEdit?.(p);
            }}
            onFocus={() => setFocusedId(p.id)}
            onBlur={() => setFocusedId(null)}
            style={({ pressed }) => [
              styles.card,
              { width: cardWidth },
              focusedId === p.id && styles.focused,
              pressed && styles.pressed,
            ]}
          >
            <View style={styles.icon}>
              <Icon size={24} color={scheme.onSecondaryContainer} />
            </View>
            <View style={styles.textContainer}>
              <Text style={styles.name} numberOfLines={textLines}>
                {p.name}
              </Text>
              <Text style={styles.addr} numberOfLines={textLines}>
                {p.address.split(',')[0]}
              </Text>
            </View>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroller: { flexGrow: 0, flexShrink: 0, marginHorizontal: -20 },
  row: { gap: 8, paddingHorizontal: 20, paddingVertical: 4, alignItems: 'stretch' },
  card: {
    minHeight: 156,
    backgroundColor: scheme.surfaceContainerHigh,
    borderRadius: shape.extraLarge,
    borderWidth: 2,
    borderColor: 'transparent',
    padding: 16,
    gap: 20,
    justifyContent: 'space-between',
  },
  icon: {
    width: 48,
    height: 48,
    borderRadius: shape.extraLarge,
    borderTopRightRadius: shape.medium,
    borderBottomLeftRadius: shape.medium,
    backgroundColor: scheme.secondaryContainer,
    alignItems: 'center',
    justifyContent: 'center',
  },
  textContainer: { gap: 6 },
  name: { ...type.titleLarge, fontWeight: '600', letterSpacing: -0.4, color: scheme.onSurface },
  addr: { ...type.bodySmall, color: scheme.onSurfaceVariant },
  emptyCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    padding: 18,
    borderWidth: 2,
    borderColor: 'transparent',
    borderRadius: shape.extraLarge,
    backgroundColor: scheme.surfaceContainerHigh,
  },
  emptyText: { flex: 1, gap: 6 },
  emptyTitle: { ...type.titleMedium, color: scheme.onSurface },
  emptyBody: { ...type.bodySmall, color: scheme.onSurfaceVariant },
  focused: { borderColor: scheme.primary },
  pressed: { transform: [{ scale: 0.97 }], borderRadius: shape.large },
});
