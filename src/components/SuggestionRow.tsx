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
  LocateFixed,
  MapPin,
  Pill,
  ShoppingBag,
  BusFront,
  Store,
  Train,
  TreePine,
  Utensils,
} from 'lucide-react-native';
import { elev, scheme, shape, type, type SchemeKey } from '../theme/tokens';
import type { Suggestion, SuggestionKind } from '../types/models';
import { formatDistance } from '../services/settings';
import { useStrings } from '../i18n';

/**
 * Rodzaje wierszy z motywem aplikacji. Trzymamy tu **nazwy ról**, a nie same
 * kolory: na Androidzie 12+ paleta pochodzi z tapety i podmienia się po
 * imporcie modułu, więc kolory czytamy dopiero przy rysowaniu wiersza.
 */
const KIND_TONES: Record<string, { Icon: any; bg: SchemeKey; fg: SchemeKey }> = {
  stop: { Icon: BusFront, bg: 'secondaryContainer', fg: 'onSecondaryContainer' },
  address: { Icon: MapPin, bg: 'tertiaryContainer', fg: 'onTertiaryContainer' },
  history: { Icon: Clock3, bg: 'surfaceContainerHighest', fg: 'onSurfaceVariant' },
  // Nominatim category icons (M3 dark tonal containers)
  shop: { Icon: Store, bg: 'primaryContainer', fg: 'onPrimaryContainer' },
  place: { Icon: ShoppingBag, bg: 'primaryContainer', fg: 'onPrimaryContainer' },
};

/** Kategorie Nominatim — kolory stałe, bo są poza skalą motywu. */
const KIND_LITERALS: Record<string, { Icon: any; bg: string; fg: string }> = {
  restaurant: { Icon: Utensils, bg: '#4E2600', fg: '#FFB68F' },
  medical: { Icon: Pill, bg: '#0F381E', fg: '#81C784' },
  school: { Icon: GraduationCap, bg: '#0D3559', fg: '#90CAF9' },
  entertainment: { Icon: Film, bg: '#381A4C', fg: '#CE93D8' },
  fuel: { Icon: Fuel, bg: '#422C00', fg: '#FFD54F' },
  train: { Icon: Train, bg: '#00363A', fg: '#80DEEA' },
  tourism: { Icon: Hotel, bg: '#3E1C14', fg: '#FF8A65' },
  sport: { Icon: Dumbbell, bg: '#1A237E', fg: '#9FA8DA' },
  bank: { Icon: Landmark, bg: '#263238', fg: '#B0BEC5' },
  church: { Icon: Church, bg: '#333816', fg: '#DCE775' },
};

/** Tytuł do wyświetlenia: przystanki w ALL CAPS (odróżnia je od adresów/POI). */
export function suggestionDisplayTitle(item: Pick<Suggestion, 'title' | 'kind'>): string {
  return item.kind === 'stop' ? item.title.toUpperCase() : item.title;
}

export interface SuggestionIconMeta { Icon: any; bg: string; fg: string; }

/** Ta sama ikonka co w wierszu wyszukiwarki — po kategorii, inaczej po rodzaju. */
export function getSuggestionIconMeta(
  item: Pick<Suggestion, 'id' | 'kind'> & { category?: string },
): SuggestionIconMeta {
  if (item.id === '__gps') {
    return { Icon: LocateFixed, bg: scheme.primaryContainer, fg: scheme.onPrimaryContainer };
  }
  const key = item.category || item.kind;
  const toned = KIND_TONES[key];
  if (toned) return { Icon: toned.Icon, bg: scheme[toned.bg], fg: scheme[toned.fg] };
  const literal = KIND_LITERALS[key];
  if (literal) return { Icon: literal.Icon, bg: literal.bg, fg: literal.fg };
  return { Icon: ShoppingBag, bg: scheme.primaryContainer, fg: scheme.onPrimaryContainer };
}

export function SuggestionRow({ item, onPress }: { item: Suggestion; onPress: () => void }) {
  const s = useStrings();
  const meta = getSuggestionIconMeta(item);
  const Icon = meta.Icon;
  const iconBg = meta.bg;
  const iconFg = meta.fg;

  // Oczyszczenie adresu z ewentualnych pozostałości numeru słupka (np. z pamięci podręcznej)
  let cleanAddress = (item.address || '')
    .replace(/\s*•\s*słup[a-ząćęłńóśźż.]*\s*\d+/gi, '')
    .replace(/\s*słup[a-ząćęłńóśźż.]*\s*\d+/gi, '')
    .trim();

  if (!cleanAddress && item.kind === 'stop') {
    cleanAddress = s.suggestion.stopFallback;
  }

  const distanceText = item.distanceM != null ? formatDistance(item.distanceM) : '';
  const subtitle = [cleanAddress, distanceText].filter(Boolean).join(' • ');
  const displayTitle = suggestionDisplayTitle(item);

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${displayTitle}${subtitle ? `, ${subtitle}` : ''}`}
      style={({ pressed }) => [
        styles.row,
        pressed && { backgroundColor: scheme.surfaceContainerHighest, opacity: 0.9 },
      ]}
    >
      <View style={[styles.icon, { backgroundColor: iconBg }]}>
        <Icon size={19} color={iconFg} />
      </View>
      <View style={styles.mid}>
        <Text style={styles.title} numberOfLines={1}>{displayTitle}</Text>
        {subtitle ? (
          <Text style={styles.sub} numberOfLines={1}>
            {subtitle}
          </Text>
        ) : null}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: shape.large,
    minHeight: 56,
  },
  icon: { width: 44, height: 44, borderRadius: shape.full, alignItems: 'center', justifyContent: 'center' },
  mid: { flex: 1, gap: 1 },
  title: { ...type.bodyLarge, color: scheme.onSurface },
  sub: { ...type.bodyMedium, color: scheme.onSurfaceVariant },
});
