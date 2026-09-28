import { useEffect } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { History } from 'lucide-react-native';
import { elev, scheme, shape, type } from '../theme/tokens';
import type { LegMode, SmartDestination } from '../types/models';
import type { SuggestionIconMeta } from './SuggestionRow';
import { LineBadge } from './LineBadge';

export interface SmartLineBadge {
  mode?: LegMode;
  line?: string;
}

/**
 * Mały slide-in: start spod labelu (x = +distance, opacity 0) → 0/1.
 * Montuje się dopiero gdy dane (ikonka / trasa) dotrą, więc sam mount
 * jest animacją wejścia — przyciski renderują się od razu bez ikon.
 */
function SlideIn({
  children,
  style,
  distance = 28,
  delay = 0,
}: {
  children: React.ReactNode;
  style?: any;
  distance?: number;
  delay?: number;
}) {
  const tx = useSharedValue(distance);
  const op = useSharedValue(0);
  useEffect(() => {
    tx.value =
      delay > 0 ? withDelay(delay, withSpring(0, { damping: 24, stiffness: 300 })) : withSpring(0, { damping: 24, stiffness: 300 });
    op.value = delay > 0 ? withDelay(delay, withTiming(1, { duration: 220 })) : withTiming(1, { duration: 220 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const anim = useAnimatedStyle(() => ({
    transform: [{ translateX: tx.value }],
    opacity: op.value,
  }));
  return <Animated.View style={[style, anim]}>{children}</Animated.View>;
}

// M3 filled list cards with tonal icon + supporting text on the trailing side.
export function SmartHistoryList({
  items,
  departures,
  lineBadges,
  onSelect,
  onOpenConnection,
  hideHeader,
  icons,
}: {
  items: SmartDestination[];
  /** najszybszy odjazd do celu w minutach, kluczem id destynacji; brak wpisu = wiersz bez prawej strony (dociągnie się z animacją) */
  departures?: Record<string, number | undefined>;
  /** pierwsza linia tranzytowa (tramwaj/autobus) do celu; brak wpisu = sam tekst „za x min” */
  lineBadges?: Record<string, SmartLineBadge | undefined>;
  onSelect: (d: SmartDestination) => void;
  /** Tap w prawą część (badge + „za x min”) — od razu do ekranu tego połączenia. */
  onOpenConnection?: (d: SmartDestination) => void;
  /** Czysty widok bez nagłówka „Ostatnie miejsca” (nagłówek żyje gdzie indziej). */
  hideHeader?: boolean;
  /** Ikonki jak w wyszukiwarce, kluczem id destynacji; brak wpisu = brak ikonki (dociągnie się z animacją slide-left) */
  icons?: Record<string, SuggestionIconMeta | undefined>;
}) {
  // Nagłówek bez treści to martwy szum — przy pustej historii sekcja znika.
  if (items.length === 0) return null;

  return (
    <View style={{ gap: 8 }}>
      {!hideHeader && (
        <View style={styles.header}>
          <History size={16} color={scheme.primary} />
          <Text style={styles.headerText}>Ostatnie miejsca</Text>
        </View>
      )}
      {items.map((d) => {
        const departInMin = departures?.[d.id];
        const departLabel = formatDepartIn(departInMin);
        const meta = icons?.[d.id];
        const Icon = meta?.Icon;
        const badge = lineBadges?.[d.id];
        // Klucz stabilny po id (bez indeksu): przy zamianie cache → świeży
        // ranking React godzi wiersze w miejscu zamiast je przemontowywać —
        // zero flickeru. Bez layout-animacji na wierszach: każdy doklejony
        // odjazd robił relayout i sprężynował całą listę (pływanie przy scrollu).
        return (
          <Pressable key={d.id} onPress={() => onSelect(d)} style={({ pressed }) => [styles.card, pressed && { backgroundColor: scheme.surfaceContainerHighest }]}>
            {Icon ? (
              <SlideIn distance={30} style={styles.iconSlide}>
                <View style={[styles.icon, { backgroundColor: meta?.bg ?? scheme.secondaryContainer }]}>
                  <Icon size={19} color={meta?.fg ?? scheme.onSecondaryContainer} />
                </View>
              </SlideIn>
            ) : null}
            <View style={styles.mid}>
              <Text style={styles.title} numberOfLines={1}>{d.title}</Text>
              <Text style={styles.sub} numberOfLines={1}>{d.address}</Text>
            </View>
            {departLabel ? (
              <SlideIn distance={22} style={styles.rightSlide}>
                <Pressable
                  onPress={(e) => {
                    e.stopPropagation();
                    if (onOpenConnection) onOpenConnection(d);
                    else onSelect(d);
                  }}
                  accessibilityRole="button"
                  accessibilityLabel={`Otwórz połączenie do ${d.title}, ${departLabel}`}
                  hitSlop={8}
                  style={({ pressed }) => [styles.rightTouch, pressed && { opacity: 0.6 }]}
                >
                  <View style={styles.right}>
                    {badge?.line ? (
                      <LineBadge mode={badge.mode} line={badge.line} />
                    ) : null}
                    <Text style={styles.depart} numberOfLines={1}>{departLabel}</Text>
                  </View>
                </Pressable>
              </SlideIn>
            ) : null}
          </Pressable>
        );
      })}
    </View>
  );
}

/**
 * „za X min” do najszybszego połączenia; powyżej 59 min pokazuje pełną godzinę
 * odjazdu (np. „13:20”), a wartości ujemne — ile minut temu coś odjechało.
 * Ujemne bez tej gałęzi obcinały się do zera i raportowały „za chwilę”.
 */
export function formatDepartIn(departInMin: number | undefined): string | null {
  if (departInMin === undefined || !Number.isFinite(departInMin)) return null;
  const m = Math.round(departInMin);
  if (m > 180) return null;
  if (m < -180) return null;
  if (m < 0) return m >= -1 ? 'przed chwilą' : `${-m} min temu`;
  if (m > 59) {
    const target = new Date(Date.now() + m * 60 * 1000);
    const hh = String(target.getHours()).padStart(2, '0');
    const mm = String(target.getMinutes()).padStart(2, '0');
    return `${hh}:${mm}`;
  }
  if (m <= 1) return 'za chwilę';
  return `za ${m} min`;
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 4, marginBottom: 2 },
  headerText: { ...type.titleSmall, color: scheme.onSurface },
  iconSlide: { flexShrink: 0, justifyContent: 'center' },
  rightSlide: { flexShrink: 0, maxWidth: '40%', justifyContent: 'center' },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    backgroundColor: scheme.surfaceContainer,
    borderRadius: shape.large,
    paddingVertical: 10,
    paddingHorizontal: 14,
    minHeight: 72,
    overflow: 'hidden',
    ...elev.level1,
  },
  icon: {
    width: 42,
    height: 42,
    borderRadius: shape.full,
    backgroundColor: scheme.secondaryContainer,
    alignItems: 'center',
    justifyContent: 'center',
  },
  mid: { flex: 1, justifyContent: 'center', gap: 2, minWidth: 0 },
  title: { ...type.bodyLarge, color: scheme.onSurface },
  sub: { ...type.bodyMedium, color: scheme.onSurfaceVariant },
  // Prawa kolumna: badge na górze, „za x min” pod nim — wszystko wyśrodkowane
  // w pionie karty i w osi własnej kolumny.
  rightTouch: { justifyContent: 'center', alignItems: 'center' },
  right: { flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 3, flexShrink: 0 },
  depart: { ...type.titleSmall, color: scheme.onSurface, flexShrink: 0, textAlign: 'center' },
});
