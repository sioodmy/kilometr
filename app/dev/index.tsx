import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Redirect, router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ChevronRight } from '../../src/components/icons';
import { scheme, shape, type } from '../../src/theme/tokens';
import { DevNavHeader } from '../../src/dev/DevNavHeader';

const SCREENS = [
  {
    path: '/dev/home' as const,
    icon: '🏠',
    title: 'Ekran główny',
    subtitle: 'Zapisane miejsca, odjazdy na żywo, pull-to-refresh, aktualizacja rozkładu, GPS',
    scenarios: '8 scenariuszy (Standard, Pusty stan, Aktualizacja, Pobieranie, Import, Błąd, Poza GPS, Własny start)',
  },
  {
    path: '/dev/search' as const,
    icon: '🔍',
    title: 'Wyszukiwarka',
    subtitle: 'Arkusz wyszukiwania, linie komunikacji, podpowiedzi, kategorie POI, stan ładowania',
    scenarios: '8 scenariuszy (Podpowiedzi, Wyniki, Linie, Ładowanie, Brak wyników, Błąd, Tryb startu, Baner GPS)',
  },
  {
    path: '/dev/transfer' as const,
    icon: '🔄',
    title: 'Szczegóły połączenia i przesiadki',
    subtitle: 'Ochrona przesiadek, oś czasu etapów, karty ryzyka, alternatywne trasy, panel pasażera',
    scenarios: '6 trybów (Oczekiwanie, Bezpieczna, Ryzyko, Alternatywa, Brak alternatywy, Niedostępna)',
  },
];

export default function DevIndexScreen() {
  if (!__DEV__) return <Redirect href="/" />;

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <DevNavHeader current="index" />

      <ScrollView contentContainerStyle={styles.container}>
        <View style={styles.hero}>
          <Text style={styles.heroTitle}>Ekrany deweloperskie UI</Text>
          <Text style={styles.heroBody}>
            Makiety do testowania interfejsu na telefonie w Expo Go bez potrzeby bazy GTFS,
            działającego backendu i sygnału GPS.
          </Text>
        </View>

        <View style={styles.list}>
          {SCREENS.map((item) => (
            <Pressable
              key={item.path}
              onPress={() => router.push(item.path)}
              style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
              accessibilityRole="button"
            >
              <View style={styles.iconCircle}>
                <Text style={styles.iconText}>{item.icon}</Text>
              </View>
              <View style={styles.cardInfo}>
                <Text style={styles.cardTitle}>{item.title}</Text>
                <Text style={styles.cardSubtitle}>{item.subtitle}</Text>
                <View style={styles.badge}>
                  <Text style={styles.badgeText}>{item.scenarios}</Text>
                </View>
              </View>
              <ChevronRight size={20} color={scheme.onSurfaceVariant} />
            </Pressable>
          ))}
        </View>

        <View style={styles.cliBox}>
          <Text style={styles.cliTitle}>Szybki start z terminala (ADB + Expo Go):</Text>
          <Text style={styles.cliCode}>npm run phone:home</Text>
          <Text style={styles.cliCode}>npm run phone:search</Text>
          <Text style={styles.cliCode}>npm run phone:transfer</Text>
          <Text style={styles.cliCode}>npm run phone:dev</Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: scheme.surface,
  },
  container: {
    padding: 20,
    gap: 20,
    paddingBottom: 40,
  },
  hero: {
    gap: 8,
  },
  heroTitle: {
    fontSize: 26,
    fontWeight: '700',
    color: scheme.onSurface,
  },
  heroBody: {
    ...type.bodyMedium,
    color: scheme.onSurfaceVariant,
    lineHeight: 20,
  },
  list: {
    gap: 12,
  },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    padding: 16,
    borderRadius: shape.large,
    backgroundColor: scheme.surfaceContainerLow,
    borderWidth: 1,
    borderColor: scheme.outlineVariant,
  },
  cardPressed: {
    backgroundColor: scheme.surfaceContainerHigh,
  },
  iconCircle: {
    width: 48,
    height: 48,
    borderRadius: shape.full,
    backgroundColor: scheme.surfaceContainerHigh,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconText: {
    fontSize: 22,
  },
  cardInfo: {
    flex: 1,
    gap: 4,
  },
  cardTitle: {
    ...type.titleMedium,
    fontWeight: '700',
    color: scheme.onSurface,
  },
  cardSubtitle: {
    ...type.bodyMedium,
    fontSize: 12,
    color: scheme.onSurfaceVariant,
    lineHeight: 16,
  },
  badge: {
    alignSelf: 'flex-start',
    marginTop: 4,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: shape.small,
    backgroundColor: scheme.surfaceContainerHighest,
  },
  badgeText: {
    ...type.labelSmall,
    color: scheme.primary,
    fontWeight: '600',
  },
  cliBox: {
    padding: 16,
    borderRadius: shape.medium,
    backgroundColor: scheme.surfaceContainerLowest,
    borderWidth: 1,
    borderColor: scheme.outlineVariant,
    gap: 6,
  },
  cliTitle: {
    ...type.labelLarge,
    color: scheme.onSurfaceVariant,
    fontWeight: '700',
    marginBottom: 4,
  },
  cliCode: {
    fontSize: 13,
    fontFamily: 'monospace',
    color: scheme.primary,
  },
});
