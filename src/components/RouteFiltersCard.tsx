import { Pressable, StyleSheet, Text, View } from 'react-native';
import {
  ArrowLeftRight,
  BusFront,
  Check,
  Route as RouteIcon,
  TramFront,
} from 'lucide-react-native';
import { elev, scheme, shape, type } from '../theme/tokens';
import { M3Switch } from './M3Switch';

// ─── Jednorazowe filtry wyszukiwania (M3) ────────────────────────────────────
// To NIE są ustawienia systemowe (te zostają w /settings). Karta grupuje dwa
// szybkie filtry "na raz", tylko dla bieżącego ekranu wyników:
// 1. "Tylko bezpośrednie" — wymusza maxTransfers=0.
// 2. Segmenty pojazdów — RAPTOR wsiada tylko do kursów danego typu.
// Stan nie jest persistowany.

export type ModePreference = 'all' | 'tram' | 'bus';

const MODES: { key: ModePreference; label: string; Icon: typeof RouteIcon }[] = [
  { key: 'all', label: 'Wszystkie', Icon: RouteIcon },
  { key: 'tram', label: 'Tramwaje', Icon: TramFront },
  { key: 'bus', label: 'Autobusy', Icon: BusFront },
];

export function RouteFiltersCard({
  directOnly,
  onDirectChange,
  mode,
  onModeChange,
}: {
  directOnly: boolean;
  onDirectChange: (next: boolean) => void;
  mode: ModePreference;
  onModeChange: (next: ModePreference) => void;
}) {
  return (
    <View style={styles.card}>
      {/* Rząd 1: przełącznik bezpośrednich */}
      <Pressable
        onPress={() => onDirectChange(!directOnly)}
        accessibilityRole="switch"
        accessibilityState={{ checked: directOnly }}
        accessibilityLabel={
          directOnly
            ? 'Tylko bezpośrednie — włączone. Dotknij, aby pokazać połączenia z przesiadkami.'
            : 'Tylko bezpośrednie — wyłączone. Dotknij, aby pokazać tylko połączenia bez przesiadek.'
        }
        style={({ pressed }) => [styles.directRow, pressed && { opacity: 0.85 }]}
      >
        <View style={[styles.iconCircle, directOnly && styles.iconCircleActive]}>
          <ArrowLeftRight size={18} color={directOnly ? scheme.onPrimary : scheme.onSurfaceVariant} />
        </View>
        <View style={styles.texts}>
          <Text style={[styles.title, directOnly && styles.titleActive]} numberOfLines={1}>
            Tylko bezpośrednie
          </Text>
          <Text style={[styles.sub, directOnly && styles.subActive]} numberOfLines={1}>
            {directOnly ? 'Bez przesiadek • tylko na teraz' : 'Pokaż kursy bez przesiadek'}
          </Text>
        </View>
        <M3Switch value={directOnly} onChange={onDirectChange} label="Tylko bezpośrednie" />
      </Pressable>

      <View style={styles.divider} />

      {/* Rząd 2: segmenty pojazdów (M3 segmented buttons, pojedynczy wybór) */}
      <View style={styles.modesBlock}>
        <Text style={styles.modesLabel}>Pojazdy</Text>
        <View
          style={styles.segmented}
          accessibilityRole="radiogroup"
          accessibilityLabel="Wybierz pojazdy"
        >
          {MODES.map((m, i) => {
            const selected = mode === m.key;
            const neighborSelected =
              (i > 0 && mode === MODES[i - 1].key) || selected;
            const Icon = selected ? Check : m.Icon;
            return (
              <View key={m.key} style={styles.segmentWrap}>
                {i > 0 && !neighborSelected && <View style={styles.segDivider} />}
                <Pressable
                  onPress={() => onModeChange(m.key)}
                  accessibilityRole="radio"
                  accessibilityState={{ selected }}
                  accessibilityLabel={`${m.label}${selected ? ' — wybrano' : ''}`}
                  style={({ pressed }) => [
                    styles.segment,
                    selected && styles.segmentSelected,
                    pressed && { opacity: 0.8 },
                  ]}
                >
                  <Icon
                    size={16}
                    color={selected ? scheme.onSecondaryContainer : scheme.onSurfaceVariant}
                  />
                  <Text
                    style={[styles.segmentText, selected && styles.segmentTextSelected]}
                    numberOfLines={1}
                  >
                    {m.label}
                  </Text>
                </Pressable>
              </View>
            );
          })}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: scheme.surfaceContainerHigh,
    borderRadius: shape.large,
    padding: 12,
    gap: 12,
    ...elev.level1,
  },
  directRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
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
    color: scheme.onSurface,
    fontWeight: '700',
  },
  sub: {
    ...type.bodySmall,
    color: scheme.onSurfaceVariant,
  },
  subActive: {
    color: scheme.onSurfaceVariant,
    opacity: 0.85,
  },
  divider: {
    height: 1,
    backgroundColor: scheme.outlineVariant,
    opacity: 0.7,
  },
  modesBlock: {
    gap: 8,
  },
  modesLabel: {
    ...type.labelMedium,
    color: scheme.onSurfaceVariant,
  },
  // M3 segmented buttons: połączona "pigułka" z ramką outline.
  segmented: {
    flexDirection: 'row',
    alignItems: 'stretch',
    borderWidth: 1,
    borderColor: scheme.outline,
    borderRadius: shape.full,
    overflow: 'hidden',
    minHeight: 40,
  },
  segmentWrap: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'stretch',
  },
  segDivider: {
    width: 1,
    marginVertical: 8,
    backgroundColor: scheme.outlineVariant,
  },
  segment: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingHorizontal: 4,
    paddingVertical: 9,
  },
  segmentSelected: {
    backgroundColor: scheme.secondaryContainer,
  },
  segmentText: {
    ...type.labelMedium,
    color: scheme.onSurfaceVariant,
    flexShrink: 1,
  },
  segmentTextSelected: {
    color: scheme.onSecondaryContainer,
    fontWeight: '700',
  },
});
