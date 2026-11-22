import { memo, useCallback, useState } from 'react';
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
  Utensils,
  type IconComponent,
} from './icons';
import { scheme, shape, type, type SchemeKey } from '../theme/tokens';
import type { Suggestion } from '../types/models';
import { formatDistance } from '../services/settings';
import { useStrings } from '../i18n';
import { normalizePolish } from '../gtfs/geo';

/**
 * Rodzaje wierszy z motywem aplikacji. Trzymamy tu nazwy ról, a nie same
 * kolory: na Androidzie 12+ paleta pochodzi z tapety i podmienia się po
 * imporcie modułu, więc kolory czytamy dopiero przy rysowaniu wiersza.
 */
const KIND_TONES: Record<string, { Icon: IconComponent; bg: SchemeKey; fg: SchemeKey }> = {
  stop: { Icon: BusFront, bg: 'secondaryContainer', fg: 'onSecondaryContainer' },
  address: { Icon: MapPin, bg: 'tertiaryContainer', fg: 'onTertiaryContainer' },
  history: { Icon: Clock3, bg: 'surfaceContainerHighest', fg: 'onSurfaceVariant' },
  shop: { Icon: Store, bg: 'primaryContainer', fg: 'onPrimaryContainer' },
  place: { Icon: ShoppingBag, bg: 'primaryContainer', fg: 'onPrimaryContainer' },
};

/** Kategorie Nominatim, kolory stałe poza skalą motywu. */
const KIND_LITERALS: Record<string, { Icon: IconComponent; bg: string; fg: string }> = {
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

/** Tytuł do wyświetlenia: przystanki w ALL CAPS odróżniają je od adresów i POI. */
export function suggestionDisplayTitle(item: Pick<Suggestion, 'title' | 'kind'>): string {
  return item.kind === 'stop' ? item.title.toUpperCase() : item.title;
}

export interface SuggestionIconMeta {
  Icon: IconComponent;
  bg: string;
  fg: string;
}

/** Ta sama ikonka co w wierszu wyszukiwarki: po kategorii, inaczej po rodzaju. */
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

/**
 * Zakresy tytułu pasujące do słów zapytania (bez polskich znaków, od początku
 * słowa, potem gdziekolwiek). normalizePolish zachowuje długość dla PL liter;
 * gdy nie zachowa (inne alfabety), nic nie podświetlamy.
 */
function highlightRanges(title: string, query: string): [number, number][] {
  const normT = normalizePolish(title);
  if (normT.length !== title.length) return [];
  const tokens = normalizePolish(query)
    .split(/[\s,./()\\-]+/)
    .filter((t) => t.length > 0);
  const ranges: [number, number][] = [];
  for (const tok of tokens) {
    let start = -1;
    for (let i = normT.indexOf(tok); i >= 0; i = normT.indexOf(tok, i + 1)) {
      if (i === 0 || !/[a-z0-9]/.test(normT[i - 1])) {
        start = i;
        break;
      }
    }
    if (start < 0) start = normT.indexOf(tok);
    if (start < 0) continue;
    ranges.push([start, start + tok.length]);
  }
  ranges.sort((a, b) => a[0] - b[0]);
  const merged: [number, number][] = [];
  for (const r of ranges) {
    const last = merged[merged.length - 1];
    if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]);
    else merged.push([r[0], r[1]]);
  }
  return merged;
}

function HighlightedTitle({
  text,
  query,
  prominent,
}: {
  text: string;
  query?: string;
  prominent?: boolean;
}) {
  const ranges = query ? highlightRanges(text, query) : [];
  if (!ranges.length) {
    return (
      <Text style={[styles.title, prominent && styles.titleProminent]} numberOfLines={2}>
        {text}
      </Text>
    );
  }
  const parts: React.ReactNode[] = [];
  let pos = 0;
  ranges.forEach(([a, b], i) => {
    if (a > pos) parts.push(text.slice(pos, a));
    parts.push(
      <Text key={i} style={[styles.match, prominent && styles.matchProminent]}>
        {text.slice(a, b)}
      </Text>,
    );
    pos = b;
  });
  if (pos < text.length) parts.push(text.slice(pos));
  return (
    <Text
      style={[styles.title, prominent ? styles.dimProminent : styles.dim]}
      numberOfLines={2}
    >
      {parts}
    </Text>
  );
}

/** Memoizowany wiersz podpowiedzi bez per-item layout entering, dla pełnej płynności listy. */
export const SuggestionRow = memo(function SuggestionRow({
  item,
  onPress,
  onSelect,
  query,
  segment,
  prominent = false,
}: {
  item: Suggestion;
  onPress?: () => void;
  /** Stabilny callback z przekazanym obiektem, unika tworzenia domknięć w renderItem. */
  onSelect?: (item: Suggestion) => void;
  /** Zapytanie do podświetlenia pasującego fragmentu tytułu. */
  query?: string;
  segment?: 'first' | 'middle' | 'last' | 'single';
  prominent?: boolean;
}) {
  const [focused, setFocused] = useState(false);
  const s = useStrings();
  const meta = getSuggestionIconMeta(item);
  const Icon = meta.Icon;
  const iconBg = prominent ? scheme.primaryContainer : meta.bg;
  const iconFg = prominent ? scheme.onPrimaryContainer : meta.fg;

  const handlePress = useCallback(() => {
    if (onSelect) onSelect(item);
    else onPress?.();
  }, [item, onPress, onSelect]);

  // Oczyszczenie adresu z ewentualnych pozostałości numeru słupka (np. z pamięci podręcznej).
  let cleanAddress = (item.address || '')
    .replace(/\s*•\s*słup[a-ząćęłńóśźż.]*\s*\d+/gi, '')
    .replace(/\s*słup[a-ząćęłńóśźż.]*\s*\d+/gi, '')
    .trim();

  if (item.kind === 'stop' && (!cleanAddress || cleanAddress === 'Przystanek')) {
    cleanAddress = s.suggestion.stopFallback;
  }

  const distanceText = item.distanceM != null ? formatDistance(item.distanceM) : '';
  const subtitle = [cleanAddress, distanceText].filter(Boolean).join(' • ');
  const displayTitle = suggestionDisplayTitle(item);

  return (
    <Pressable
      onPress={handlePress}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      accessibilityRole="button"
      accessibilityLabel={`${displayTitle}${subtitle ? `, ${subtitle}` : ''}`}
      style={({ pressed }) => [
        styles.row,
        segment && styles.segment,
        (segment === 'first' || segment === 'single') && styles.segmentTop,
        (segment === 'last' || segment === 'single') && styles.segmentBottom,
        prominent && styles.prominent,
        pressed && (prominent ? styles.pressedProminent : styles.pressed),
        focused && styles.focused,
      ]}
    >
      <View style={[styles.icon, { backgroundColor: iconBg }, segment && styles.segmentIcon]}>
        <Icon size={20} color={iconFg} />
      </View>
      <View style={styles.mid}>
        <HighlightedTitle text={displayTitle} query={query} prominent={prominent} />
        {(segment ? cleanAddress : subtitle) ? (
          <Text
            style={[styles.sub, prominent && styles.subProminent]}
            numberOfLines={segment ? 2 : 1}
          >
            {segment ? cleanAddress : subtitle}
          </Text>
        ) : null}
      </View>
      {segment && distanceText ? (
        <View style={[styles.distancePill, prominent && styles.distancePillProminent]}>
          <Text
            style={[styles.distance, prominent && styles.distanceProminent]}
            numberOfLines={1}
          >
            {distanceText}
          </Text>
        </View>
      ) : null}
    </Pressable>
  );
});

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: shape.large,
    minHeight: 60,
    borderWidth: 1.5,
    borderColor: 'transparent',
  },
  icon: {
    width: 44,
    height: 44,
    borderRadius: shape.full,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  segment: {
    borderRadius: 6,
    backgroundColor: scheme.surfaceContainer,
    minHeight: 74,
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 13,
  },
  segmentTop: { borderTopLeftRadius: 24, borderTopRightRadius: 24 },
  segmentBottom: { borderBottomLeftRadius: 24, borderBottomRightRadius: 24 },
  segmentIcon: { borderRadius: 16 },
  prominent: {
    backgroundColor: scheme.secondaryContainer,
  },
  pressed: {
    backgroundColor: scheme.surfaceContainerHigh,
    transform: [{ scale: 0.988 }],
  },
  pressedProminent: {
    opacity: 0.88,
    transform: [{ scale: 0.988 }],
  },
  focused: { borderColor: scheme.primary },
  distancePill: {
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: shape.full,
    backgroundColor: scheme.surfaceContainerHigh,
    flexShrink: 0,
  },
  distancePillProminent: {
    backgroundColor: scheme.surfaceContainerLow,
  },
  distance: {
    ...type.labelSmall,
    fontWeight: '700',
    color: scheme.onSurfaceVariant,
    fontVariant: ['tabular-nums'],
  },
  distanceProminent: {
    color: scheme.onSurface,
  },
  mid: { flex: 1, minWidth: 0, gap: 3 },
  title: {
    ...type.bodyLarge,
    fontWeight: '600',
    letterSpacing: -0.15,
    color: scheme.onSurface,
  },
  titleProminent: {
    fontWeight: '700',
    color: scheme.onSecondaryContainer,
  },
  dim: { color: scheme.onSurfaceVariant, fontWeight: '500' },
  dimProminent: { color: scheme.onSecondaryContainer, fontWeight: '500' },
  match: { color: scheme.onSurface, fontWeight: '800' },
  matchProminent: { color: scheme.onSecondaryContainer, fontWeight: '800' },
  sub: { ...type.bodySmall, color: scheme.onSurfaceVariant, lineHeight: 17 },
  subProminent: { color: scheme.onSecondaryContainer },
});
