import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { BellRing, ChevronLeft, History, Share2, Star } from 'lucide-react-native';
import { elev, scheme, shape, type } from '../../src/theme/tokens';
import { RoutingService } from '../../src/services';
import type { Connection } from '../../src/types/models';
import { LegTimeline } from '../../src/components/LegTimeline';
import { LiveDot } from '../../src/components/LiveDot';

export default function RouteDetailsScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [item, setItem] = useState<Connection | null>(null);

  useEffect(() => {
    if (id) RoutingService.getConnectionById(String(id)).then((c) => setItem(c ?? null));
  }, [id]);

  if (!item) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.loading}>
          <ActivityIndicator color={scheme.primary} />
          <Text style={styles.loadingText}>Wczytuję szczegóły…</Text>
        </View>
      </SafeAreaView>
    );
  }

  const late = item.live && item.delayMin > 0;
  const early = item.live && item.delayMin < 0;
  const onTime = item.live && item.delayMin === 0;

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      {/* M3 small top app bar */}
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.iconBtn} hitSlop={10}>
          <ChevronLeft size={23} color={scheme.onSurface} />
        </Pressable>
        <Text style={styles.headerTitle}>Szczegóły połączenia</Text>
        <Pressable style={styles.iconBtn} hitSlop={10}>
          <Share2 size={19} color={scheme.onSurfaceVariant} />
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
        {/* M3 filled summary card + tonal status banner */}
        <View style={styles.summary}>
          <View style={styles.sumTop}>
            <Text style={styles.big}>{item.durationMin} min</Text>
            <Text style={styles.hours}>{item.departAt} → {item.arriveAt}</Text>
          </View>
          <Text style={styles.route}>{item.fromTitle} → {item.toTitle}</Text>
          {/* status shown with icon + dot, no "GPS" wording */}
          {late ? (
            <View style={[styles.banner, { backgroundColor: scheme.errorContainer }]}>
              <LiveDot color={scheme.error} size={8} />
              <Text style={[styles.bannerText, { color: scheme.onErrorContainer }]}>
                Opóźnienie {item.delayMin} min
              </Text>
            </View>
          ) : early ? (
            <View style={[styles.banner, { backgroundColor: scheme.warningContainer }]}>
              <LiveDot color={scheme.warning} size={8} />
              <Text style={[styles.bannerText, { color: scheme.onWarningContainer }]}>
                {Math.abs(item.delayMin)} min przed czasem
              </Text>
            </View>
          ) : onTime ? (
            <View style={[styles.banner, { backgroundColor: scheme.successContainer }]}>
              <LiveDot color={scheme.success} size={8} />
              <Text style={[styles.bannerText, { color: scheme.onSuccessContainer }]}>Na czas</Text>
            </View>
          ) : (
            <View style={[styles.banner, { backgroundColor: scheme.surfaceContainerHighest }]}>
              <History size={15} color={scheme.onSurfaceVariant} />
              <Text style={[styles.bannerText, { color: scheme.onSurfaceVariant }]}>Według rozkładu</Text>
            </View>
          )}
        </View>

        <LegTimeline legs={item.legs} />

        <View style={{ height: 110 }} />
      </ScrollView>

      {/* M3 filled button + tonal icon button */}
      <View style={styles.ctaWrap}>
        <Pressable style={styles.ctaMain}>
          <BellRing size={19} color={scheme.onPrimary} />
          <Text style={styles.ctaText}>
            {item.departInMin <= 1 ? 'Odjazd teraz' : `Odjazd za ${item.departInMin} min`}
          </Text>
        </Pressable>
        <Pressable style={styles.ctaTonal}>
          <Star size={19} color={scheme.onSecondaryContainer} />
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: scheme.surface },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8 },
  loadingText: { ...type.bodyMedium, color: scheme.onSurfaceVariant },
  header: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 6 },
  iconBtn: { width: 44, height: 44, borderRadius: shape.full, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { flex: 1, ...type.titleLarge, color: scheme.onSurface },
  body: { paddingHorizontal: 12, gap: 12 },
  summary: { backgroundColor: scheme.surfaceContainer, borderRadius: shape.large, padding: 16, gap: 6, ...elev.level1 },
  sumTop: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' },
  big: { ...type.displaySmall, color: scheme.onSurface },
  hours: { ...type.titleMedium, color: scheme.onSurfaceVariant },
  route: { ...type.bodyLarge, color: scheme.onSurface },
  banner: { flexDirection: 'row', alignItems: 'center', gap: 10, borderRadius: shape.medium, padding: 12, marginTop: 6 },
  bannerText: { ...type.titleSmall, flex: 1 },
  ctaWrap: { position: 'absolute', left: 16, right: 16, bottom: 22, flexDirection: 'row', gap: 10 },
  ctaMain: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, backgroundColor: scheme.primary, borderRadius: shape.full, height: 56, ...elev.level2 },
  ctaText: { ...type.titleSmall, color: scheme.onPrimary },
  ctaTonal: { width: 56, height: 56, borderRadius: shape.medium, backgroundColor: scheme.secondaryContainer, alignItems: 'center', justifyContent: 'center' },
});
