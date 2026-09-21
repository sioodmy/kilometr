import { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Bell, LocateFixed } from 'lucide-react-native';
import { elev, scheme, shape, type } from '../src/theme/tokens';
import { CURRENT_LOCATION } from '../src/data/mocks';
import { FavoritesService, LocationService, SearchService } from '../src/services';
import type { SavedPlace, SmartDestination, Suggestion } from '../src/types/models';
import { LiveDot } from '../src/components/LiveDot';
import { SavedPlacesRow } from '../src/components/SavedPlacesRow';
import { SearchBar } from '../src/components/SearchBar';
import { SearchSheet } from '../src/components/SearchSheet';
import { SmartHistoryList } from '../src/components/SmartHistoryList';

export default function HomeScreen() {
  const router = useRouter();
  const [saved, setSaved] = useState<SavedPlace[]>([]);
  const [smart, setSmart] = useState<SmartDestination[]>([]);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Suggestion[]>([]);
  const [recent, setRecent] = useState<Suggestion[]>([]);
  const [loading, setLoading] = useState(false);
  const [locTitle, setLocTitle] = useState(CURRENT_LOCATION.title);

  useEffect(() => {
    FavoritesService.list().then(setSaved);
    FavoritesService.smartFromOrigin(CURRENT_LOCATION.stopId).then(setSmart);
    SearchService.recent().then(setRecent);
    LocationService.getCurrentLocation().then((l) => setLocTitle(l.title));
  }, []);

  // Debounced fuzzy search (backend: replace with Nominatim call here)
  useEffect(() => {
    if (!sheetOpen) return;
    const q = query.trim();
    if (!q) {
      setResults([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const t = setTimeout(() => {
      SearchService.search(q).then((r) => {
        setResults(r);
        setLoading(false);
      });
    }, 220);
    return () => clearTimeout(t);
  }, [query, sheetOpen]);

  const quick = useMemo(() => saved.slice(0, 3).map((s) => ({ id: s.id, title: s.name })), [saved]);

  const goToRoutes = (to: { id: string; title: string; lat: number; lon: number }) => {
    setSheetOpen(false);
    router.push({
      pathname: '/routes',
      params: { toId: to.id, toTitle: to.title, toLat: String(to.lat), toLon: String(to.lon) },
    });
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        <View style={styles.topBar}>
          {/* live position: pulsing dot shows tracking, no "GPS" label */}
          <View style={styles.loc}>
            <LocateFixed size={15} color={scheme.onSecondaryContainer} />
            <Text style={styles.locText} numberOfLines={1}>{locTitle}</Text>
            <LiveDot color={scheme.success} size={7} />
          </View>
          <Pressable style={styles.iconBtn} hitSlop={10}>
            <Bell size={20} color={scheme.onSurfaceVariant} />
            <View style={styles.badgeDot} />
          </Pressable>
        </View>

        <Text style={styles.hero}>Gdzie jedziemy?</Text>
        <Text style={styles.sub}>Wrocław • MPK</Text>

        <View style={{ height: 14 }} />
        <SearchBar onPress={() => setSheetOpen(true)} />

        <View style={{ height: 20 }} />
        <Text style={styles.section}>Zapisane miejsca</Text>
        <SavedPlacesRow
          places={saved}
          onSelect={(p) => goToRoutes({ id: p.placeId, title: p.name, lat: p.lat, lon: p.lon })}
          onAdd={() => setSheetOpen(true)}
        />

        <View style={{ height: 20 }} />
        <SmartHistoryList items={smart} onSelect={(d) => goToRoutes(d)} />

        <View style={{ height: 90 }} />
      </ScrollView>

      <SearchSheet
        open={sheetOpen}
        query={query}
        loading={loading}
        results={results}
        recent={recent}
        savedQuick={quick}
        onQuery={setQuery}
        onSelect={(s) => goToRoutes({ id: s.id, title: s.title, lat: s.lat, lon: s.lon })}
        onClose={() => setSheetOpen(false)}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: scheme.surface },
  body: { paddingHorizontal: 16, paddingTop: 8 },
  topBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  // M3 tonal chip for live position
  loc: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    backgroundColor: scheme.secondaryContainer,
    borderRadius: shape.full,
    paddingLeft: 12,
    paddingRight: 10,
    height: 40,
    maxWidth: '80%',
  },
  locText: { ...type.labelLarge, color: scheme.onSecondaryContainer },
  // M3 standard IconButton: tonal circle, badge dot for notifications
  iconBtn: { width: 44, height: 44, borderRadius: shape.full, backgroundColor: scheme.surfaceContainerHighest, alignItems: 'center', justifyContent: 'center' },
  badgeDot: { position: 'absolute', top: 11, right: 12, width: 8, height: 8, borderRadius: 99, backgroundColor: scheme.error },
  hero: { ...type.displaySmall, color: scheme.onSurface, marginTop: 16 },
  sub: { ...type.bodyLarge, color: scheme.onSurfaceVariant, marginTop: 2 },
  section: { ...type.titleMedium, color: scheme.onSurface, marginBottom: 10 },
});
