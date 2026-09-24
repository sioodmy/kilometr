import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Linking,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { BellRing, ChevronLeft, ChevronRight, RefreshCw } from 'lucide-react-native';
import { scheme, shape, type } from '../src/theme/tokens';
import { fetchMpkNews, type MpkNewsItem } from '../src/services/mpkNews';

function NewsRow({ item, onOpen }: { item: MpkNewsItem; onOpen: (item: MpkNewsItem) => void }) {
  return (
    <Pressable
      onPress={() => onOpen(item)}
      accessibilityRole="link"
      accessibilityLabel={item.title}
      style={({ pressed }) => [styles.row, pressed && { opacity: 0.7 }]}
    >
      <View style={styles.rowText}>
        <Text style={styles.rowTitle} numberOfLines={2} ellipsizeMode="tail">
          {item.title}
        </Text>
        {item.description ? (
          <Text style={styles.rowDesc} numberOfLines={2} ellipsizeMode="tail">
            {item.description}
          </Text>
        ) : null}
        {item.dateLabel ? <Text style={styles.rowDate}>{item.dateLabel}</Text> : null}
      </View>
      <ChevronRight size={16} color={scheme.outline} style={styles.chev} />
    </Pressable>
  );
}

export default function NewsScreen() {
  const router = useRouter();
  const [items, setItems] = useState<MpkNewsItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    setError(null);
    try {
      const news = await fetchMpkNews();
      setItems(news);
    } catch {
      setError('Nie udało się pobrać aktualności. Sprawdź internet i spróbuj ponownie.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load(false);
  }, [load]);

  const openItem = useCallback((item: MpkNewsItem) => {
    if (!item.link) return;
    void Linking.openURL(item.link).catch(() => {});
  }, []);

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.back} hitSlop={10}>
          <ChevronLeft size={23} color={scheme.onSurface} />
        </Pressable>
        <Text style={styles.headerTitle}>Aktualności MPK</Text>
        <Pressable
          onPress={() => void load(true)}
          style={styles.iconBtn}
          hitSlop={10}
          accessibilityLabel="Odśwież aktualności"
        >
          <RefreshCw size={18} color={scheme.onSurfaceVariant} />
        </Pressable>
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="small" color={scheme.primary} />
          <Text style={styles.centerText}>Pobieranie komunikatów…</Text>
        </View>
      ) : error && items.length === 0 ? (
        <View style={styles.center}>
          <BellRing size={28} color={scheme.outline} />
          <Text style={styles.centerText}>{error}</Text>
          <Pressable onPress={() => void load(false)} style={styles.retryBtn}>
            <Text style={styles.retryText}>Spróbuj ponownie</Text>
          </Pressable>
        </View>
      ) : (
        <FlatList
          data={items}
          keyExtractor={(it) => it.id}
          contentContainerStyle={styles.list}
          showsVerticalScrollIndicator={false}
          overScrollMode="never"
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => void load(true)}
              tintColor={scheme.primary}
            />
          }
          renderItem={({ item }) => <NewsRow item={item} onOpen={openItem} />}
          ItemSeparatorComponent={() => <View style={styles.sep} />}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: scheme.surface },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  back: {
    width: 40,
    height: 40,
    borderRadius: shape.full,
    backgroundColor: scheme.surfaceContainerHigh,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconBtn: {
    width: 40,
    height: 40,
    borderRadius: shape.full,
    backgroundColor: scheme.surfaceContainerHigh,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: { flex: 1, ...type.titleMedium, fontWeight: '600', color: scheme.onSurface },
  list: { paddingHorizontal: 14, paddingTop: 8, paddingBottom: 40 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 10,
    paddingHorizontal: 2,
  },
  rowText: { flex: 1, gap: 3, minWidth: 0 },
  rowTitle: { ...type.titleSmall, color: scheme.onSurface, lineHeight: 18 },
  rowDesc: { ...type.bodySmall, color: scheme.onSurfaceVariant, lineHeight: 16 },
  rowDate: { ...type.labelSmall, color: scheme.outline, marginTop: 1 },
  chev: { flexShrink: 0 },
  sep: { height: 1, backgroundColor: scheme.outlineVariant, opacity: 0.5 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, padding: 24 },
  centerText: { ...type.bodySmall, color: scheme.onSurfaceVariant, textAlign: 'center' },
  retryBtn: {
    backgroundColor: scheme.secondaryContainer,
    borderRadius: shape.full,
    paddingVertical: 10,
    paddingHorizontal: 18,
  },
  retryText: { ...type.titleSmall, color: scheme.onSecondaryContainer },
});
