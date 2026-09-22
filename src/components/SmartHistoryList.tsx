import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Clock3, History } from 'lucide-react-native';
import { elev, scheme, shape, type } from '../theme/tokens';
import type { SmartDestination } from '../types/models';

// M3 filled list cards with tonal icon + supporting text on the trailing side.
export function SmartHistoryList({
  items,
  departures,
  onSelect,
}: {
  items: SmartDestination[];
  /** najszybszy odjazd do celu w minutach, kluczem id destynacji; brak wpisu = nie pokazuj labelu */
  departures?: Record<string, number | undefined>;
  onSelect: (d: SmartDestination) => void;
}) {
  return (
    <View style={{ gap: 8 }}>
      <View style={styles.header}>
        <History size={16} color={scheme.primary} />
        <Text style={styles.headerText}>Ostatnie miejsca</Text>
      </View>
      {items.map((d, index) => {
        const departLabel = formatDepartIn(departures?.[d.id]);
        return (
          <Pressable key={`${d.id}-${index}`} onPress={() => onSelect(d)} style={({ pressed }) => [styles.card, pressed && { backgroundColor: scheme.surfaceContainerHighest }]}>
            <View style={styles.icon}>
              <Clock3 size={19} color={scheme.onSecondaryContainer} />
            </View>
            <View style={styles.mid}>
              <Text style={styles.title} numberOfLines={1}>{d.title}</Text>
              <Text style={styles.sub} numberOfLines={1}>{d.address}</Text>
            </View>
            <View style={styles.right}>
              <Text style={styles.time}>~{d.avgDurationMin} min</Text>
              {departLabel ? <Text style={styles.depart}>{departLabel}</Text> : null}
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}

/** "za X min" do najszybszego połączenia; powyżej 59 min pokazuje pełną godzinę odjazdu (np. "13:20"). */
export function formatDepartIn(departInMin: number | undefined): string | null {
  if (departInMin === undefined || !Number.isFinite(departInMin)) return null;
  const m = Math.max(0, Math.round(departInMin));
  if (m > 180) return null;
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
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    backgroundColor: scheme.surfaceContainer,
    borderRadius: shape.large,
    paddingVertical: 12,
    paddingHorizontal: 14,
    minHeight: 68,
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
  mid: { flex: 1, justifyContent: 'center', gap: 2 },
  title: { ...type.bodyLarge, color: scheme.onSurface },
  sub: { ...type.bodyMedium, color: scheme.onSurfaceVariant },
  right: { alignItems: 'flex-end', justifyContent: 'center', gap: 2 },
  time: { ...type.titleMedium, color: scheme.onSurface },
  depart: { ...type.bodySmall, color: scheme.onSurfaceVariant },
});
