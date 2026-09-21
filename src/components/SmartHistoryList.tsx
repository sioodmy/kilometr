import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Clock3, TrendingUp } from 'lucide-react-native';
import { elev, scheme, shape, type } from '../theme/tokens';
import type { SmartDestination } from '../types/models';

// M3 filled list cards with tonal icon + supporting text on the trailing side.
export function SmartHistoryList({
  items,
  onSelect,
}: {
  items: SmartDestination[];
  onSelect: (d: SmartDestination) => void;
}) {
  return (
    <View style={{ gap: 8 }}>
      <View style={styles.header}>
        <TrendingUp size={16} color={scheme.primary} />
        <Text style={styles.headerText}>Częste z tej lokalizacji</Text>
      </View>
      {items.map((d) => (
        <Pressable key={d.id} onPress={() => onSelect(d)} style={({ pressed }) => [styles.card, pressed && { backgroundColor: scheme.surfaceContainerHighest }]}>
          <View style={styles.icon}>
            <Clock3 size={19} color={scheme.onSecondaryContainer} />
          </View>
          <View style={styles.mid}>
            <Text style={styles.title} numberOfLines={1}>{d.title}</Text>
            <Text style={styles.sub} numberOfLines={1}>{d.address}</Text>
          </View>
          <View style={styles.right}>
            <Text style={styles.freq}>{d.frequency}× / tydz.</Text>
            <Text style={styles.time}>~{d.avgDurationMin} min</Text>
          </View>
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 4 },
  headerText: { ...type.titleSmall, color: scheme.onSurface },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    backgroundColor: scheme.surfaceContainer,
    borderRadius: shape.large,
    padding: 12,
    ...elev.level1,
  },
  icon: { width: 44, height: 44, borderRadius: shape.full, backgroundColor: scheme.secondaryContainer, alignItems: 'center', justifyContent: 'center' },
  mid: { flex: 1, gap: 1 },
  title: { ...type.bodyLarge, color: scheme.onSurface },
  sub: { ...type.bodyMedium, color: scheme.onSurfaceVariant },
  right: { alignItems: 'flex-end', gap: 2 },
  freq: { ...type.labelMedium, color: scheme.primary },
  time: { ...type.bodySmall, color: scheme.onSurfaceVariant },
});
