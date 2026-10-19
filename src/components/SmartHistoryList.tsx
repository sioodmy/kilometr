import { Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { History } from 'lucide-react-native';
import { scheme, shape, type } from '../theme/tokens';
import type { LegMode, SmartDestination } from '../types/models';
import type { SuggestionIconMeta } from './SuggestionRow';
import { LineBadge } from './LineBadge';
import { useStrings, tr } from '../i18n';

export interface SmartLineBadge {
  mode?: LegMode;
  line?: string;
}

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
  /** Najszybszy odjazd do celu w minutach, kluczem id destynacji. */
  departures?: Record<string, number | undefined>;
  /** pierwsza linia tranzytowa (tramwaj/autobus) do celu; brak wpisu = sam tekst „za x min” */
  lineBadges?: Record<string, SmartLineBadge | undefined>;
  onSelect: (d: SmartDestination) => void;
  /** Tap w prawą część (badge + „za x min”) — od razu do ekranu tego połączenia. */
  onOpenConnection?: (d: SmartDestination) => void;
  /** Czysty widok bez nagłówka „Ostatnie miejsca” (nagłówek żyje gdzie indziej). */
  hideHeader?: boolean;
  /** Ikonki jak w wyszukiwarce, kluczem id destynacji. */
  icons?: Record<string, SuggestionIconMeta | undefined>;
}) {
  const s = useStrings();
  const { width, fontScale } = useWindowDimensions();
  const compact = width / fontScale < 300;
  if (items.length === 0) return null;

  return (
    <View style={{ gap: 12 }}>
      {!hideHeader && (
        <View style={styles.header}>
          <History size={16} color={scheme.primary} />
          <Text style={styles.headerText}>{s.home.historyTitle}</Text>
        </View>
      )}
      <View style={styles.list}>
        {items.map((d, index) => {
          const departInMin = departures?.[d.id];
          const departLabel = formatDepartIn(departInMin);
          const meta = icons?.[d.id];
          const Icon = meta?.Icon ?? History;
          const badge = lineBadges?.[d.id];
          // Stałe sloty zapobiegają przesuwaniu tekstu po wczytaniu ikon i odjazdów.
          return (
            <Pressable
              key={d.id}
              onPress={() => onSelect(d)}
              accessibilityRole="button"
              accessibilityLabel={s.home.searchToA11y(d.title)}
              style={({ pressed }) => [
                styles.card,
                compact && styles.cardCompact,
                index > 0 && styles.cardDivider,
                pressed && { backgroundColor: scheme.surfaceContainerHighest },
              ]}
            >
              <View style={styles.iconSlide}>
                <View
                  style={[styles.icon, { backgroundColor: meta?.bg ?? scheme.secondaryContainer }]}
                >
                  <Icon size={19} color={meta?.fg ?? scheme.onSecondaryContainer} />
                </View>
              </View>
              <View style={styles.mid}>
                <Text style={styles.title} numberOfLines={compact ? undefined : 2}>
                  {d.title}
                </Text>
                <Text style={styles.sub} numberOfLines={compact ? undefined : 2}>
                  {d.address}
                </Text>
              </View>
              <View
                style={[
                  styles.rightSlide,
                  compact && styles.rightSlideCompact,
                  compact && !departLabel && styles.hidden,
                ]}
              >
                {departLabel ? (
                  <Pressable
                    onPress={(e) => {
                      e.stopPropagation();
                      if (onOpenConnection) onOpenConnection(d);
                      else onSelect(d);
                    }}
                    accessibilityRole="button"
                    accessibilityLabel={s.home.openConnA11y(d.title, departLabel)}
                    hitSlop={8}
                    style={({ pressed }) => [styles.rightTouch, pressed && { opacity: 0.6 }]}
                  >
                    <View style={[styles.right, compact && styles.rightCompact]}>
                      <View style={styles.badgeSlot}>
                        {badge?.line ? <LineBadge mode={badge.mode} line={badge.line} /> : null}
                      </View>
                      <Text style={styles.depart}>{departLabel}</Text>
                    </View>
                  </Pressable>
                ) : (
                  <View style={styles.rightPlaceholder} />
                )}
              </View>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

/**
 * „za X min” do najszybszego połączenia; powyżej 59 min pokazuje pełną godzinę
 * odjazdu (np. „13:20”), a wartości ujemne — ile minut temu coś odjechało.
 * Ujemne bez tej gałęzi obcinały się do zera i raportowały „za chwilę”.
 */
function formatDepartIn(departInMin: number | undefined): string | null {
  if (departInMin === undefined || !Number.isFinite(departInMin)) return null;
  const m = Math.round(departInMin);
  if (m > 180) return null;
  if (m < -180) return null;
  if (m < 0) return m >= -1 ? tr().common.departJustAgo : tr().common.departAgo(-m);
  if (m > 59) {
    const target = new Date(Date.now() + m * 60 * 1000);
    const hh = String(target.getHours()).padStart(2, '0');
    const mm = String(target.getMinutes()).padStart(2, '0');
    return `${hh}:${mm}`;
  }
  if (m <= 1) return tr().common.departNow;
  return tr().common.departIn(m);
}

const styles = StyleSheet.create({
  list: {
    backgroundColor: scheme.surfaceContainerLow,
    borderRadius: shape.extraLarge,
    paddingHorizontal: 4,
  },
  cardDivider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: scheme.outlineVariant },
  cardCompact: { flexWrap: 'wrap' },
  rightSlideCompact: { width: '100%', maxWidth: '100%', paddingLeft: 56 },
  rightCompact: { flexDirection: 'row', justifyContent: 'flex-start', gap: 12 },
  hidden: { display: 'none' },
  header: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 4, marginBottom: 2 },
  headerText: { ...type.titleMedium, fontWeight: '500', color: scheme.onSurface },
  iconSlide: { flexShrink: 0, justifyContent: 'center' },
  rightSlide: { flexShrink: 0, width: '32%', maxWidth: '40%', justifyContent: 'center' },
  rightPlaceholder: { minHeight: 44 },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderRadius: shape.large,
    paddingVertical: 16,
    paddingHorizontal: 12,
    minHeight: 84,
  },
  icon: {
    width: 42,
    height: 42,
    borderRadius: shape.medium,
    backgroundColor: scheme.secondaryContainer,
    alignItems: 'center',
    justifyContent: 'center',
  },
  mid: { flex: 1, justifyContent: 'center', gap: 4, minWidth: 0 },
  title: { ...type.bodyLarge, fontWeight: '500', color: scheme.onSurface },
  sub: { ...type.bodySmall, color: scheme.onSurfaceVariant },
  rightTouch: { minHeight: 44, justifyContent: 'center', alignItems: 'center' },
  right: {
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 3,
    minWidth: 0,
    width: '100%',
  },
  badgeSlot: { height: 28, alignItems: 'center', justifyContent: 'center' },
  depart: {
    ...type.titleSmall,
    lineHeight: 20,
    color: scheme.onSurface,
    flexShrink: 1,
    textAlign: 'center',
  },
});
