import { useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ArrowDown, ArrowLeftRight, ArrowUp, ChevronLeft, Clock3 } from 'lucide-react-native';
import { elev, scheme, shape, type } from '../../src/theme/tokens';
import { CURRENT_LOCATION } from '../../src/data/mocks';
import { RoutingService } from '../../src/services';
import type { Connection } from '../../src/types/models';
import { ConnectionCard } from '../../src/components/ConnectionCard';

export default function RoutesScreen() {
  const router = useRouter();
  const { toId, toTitle, toLat, toLon } = useLocalSearchParams<{
    toId: string; toTitle: string; toLat: string; toLon: string;
  }>();
  const [items, setItems] = useState<Connection[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    RoutingService.getConnections({
      fromTitle: CURRENT_LOCATION.title,
      fromLat: CURRENT_LOCATION.lat,
      fromLon: CURRENT_LOCATION.lon,
      toId: String(toId ?? ''),
      toTitle: String(toTitle ?? 'Cel'),
      toLat: Number(toLat ?? 0),
      toLon: Number(toLon ?? 0),
    }).then((c) => {
      setItems(c);
      setLoading(false);
    });
  }, [toId, toTitle, toLat, toLon]);

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      {/* M3 top app bar + filled origin/destination card */}
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.back} hitSlop={10}>
          <ChevronLeft size={23} color={scheme.onSurface} />
        </Pressable>
        <View style={styles.odDo}>
          <View style={styles.odDoRow}>
            <ArrowUp size={14} color={scheme.success} />
            <Text style={styles.odDoText} numberOfLines={1}>{CURRENT_LOCATION.title}</Text>
          </View>
          <View style={styles.odDoRow}>
            <ArrowDown size={14} color={scheme.error} />
            <Text style={[styles.odDoText, styles.doText]} numberOfLines={1}>{toTitle ?? 'Cel'}</Text>
          </View>
          <View style={styles.swap}>
            <ArrowLeftRight size={13} color={scheme.onSurfaceVariant} />
          </View>
        </View>
        <View style={styles.timeChip}>
          <Clock3 size={14} color={scheme.onSecondaryContainer} />
          <Text style={styles.timeText}>Teraz</Text>
        </View>
      </View>

      {loading ? (
        <View style={styles.loading}>
          <ActivityIndicator size="large" color={scheme.primary} />
          <Text style={styles.loadingText}>Szukam połączeń…</Text>
        </View>
      ) : (
        <FlatList
          data={items}
          keyExtractor={(i) => i.id}
          contentContainerStyle={styles.list}
          showsVerticalScrollIndicator={false}
          renderItem={({ item }) => (
            <ConnectionCard
              item={item}
              onPress={() => router.push({ pathname: '/routes/[id]', params: { id: item.id } })}
            />
          )}
          ListHeaderComponent={
            <Text style={styles.count}>{items.length} połączenia • wg czasu odjazdu</Text>
          }
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: scheme.surface },
  header: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, paddingVertical: 10 },
  back: { width: 44, height: 44, borderRadius: shape.full, alignItems: 'center', justifyContent: 'center' },
  odDo: { flex: 1, backgroundColor: scheme.surfaceContainerHighest, borderRadius: shape.large, padding: 12, gap: 8, ...elev.level1 },
  odDoRow: { flexDirection: 'row', alignItems: 'center', gap: 9 },
  odDoText: { ...type.bodyMedium, color: scheme.onSurfaceVariant, flex: 1 },
  doText: { ...type.titleSmall, color: scheme.onSurface },
  swap: { position: 'absolute', right: 12, top: '50%', marginTop: -14, width: 28, height: 28, borderRadius: shape.full, backgroundColor: scheme.surfaceContainerHigh, alignItems: 'center', justifyContent: 'center' },
  timeChip: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: scheme.secondaryContainer, borderRadius: shape.small, paddingHorizontal: 10, paddingVertical: 9 },
  timeText: { ...type.labelLarge, color: scheme.onSecondaryContainer },
  count: { ...type.labelMedium, color: scheme.onSurfaceVariant, marginBottom: 10 },
  list: { paddingHorizontal: 12, paddingBottom: 30, gap: 10 },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10 },
  loadingText: { ...type.titleMedium, color: scheme.onSurface },
});
