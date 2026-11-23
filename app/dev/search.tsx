import { useEffect, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Redirect, router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Search } from '../../src/components/icons';
import { scheme, shape, type } from '../../src/theme/tokens';
import { useStrings } from '../../src/i18n';
import { DevNavHeader } from '../../src/dev/DevNavHeader';
import { SearchSheet } from '../../src/components/SearchSheet';
import {
  filterMockSearch,
  searchFixture,
  type SearchDevScenario,
} from '../../src/dev/searchFixture';
import type { Suggestion } from '../../src/types/models';
import type { TransitLine } from '../../src/services/lineTimetable';

const SCENARIOS: Array<{ id: SearchDevScenario; label: string }> = [
  { id: 'initial', label: 'Podpowiedzi' },
  { id: 'results', label: 'Wyniki ("Rynek")' },
  { id: 'lines', label: 'Linie ("4")' },
  { id: 'loading', label: 'Ładowanie' },
  { id: 'noResults', label: 'Brak wyników' },
  { id: 'error', label: 'Błąd wyszukiwania' },
  { id: 'startMode', label: 'Wybór startu (Z:)' },
  { id: 'gpsNotice', label: 'Ostrzeżenie GPS' },
];

export default function DevSearchScreen() {
  if (!__DEV__) return <Redirect href="/" />;

  const s = useStrings();
  const [scenario, setScenario] = useState<SearchDevScenario>('initial');
  const [sheetOpen, setSheetOpen] = useState(true);

  const fixture = searchFixture(scenario);
  const [query, setQuery] = useState(fixture.query);
  const [loading, setLoading] = useState(fixture.loading);
  const [error, setError] = useState(fixture.error);
  const [notice, setNotice] = useState<string | undefined>(fixture.notice);
  const [originTitle, setOriginTitle] = useState<string | undefined>(fixture.originTitle);
  const [placeholder, setPlaceholder] = useState<string | undefined>(fixture.placeholder);

  // Synchronizacja przy zmianie scenariusza
  useEffect(() => {
    const f = searchFixture(scenario);
    setQuery(f.query);
    setLoading(f.loading);
    setError(f.error);
    setNotice(f.notice);
    setOriginTitle(f.originTitle);
    setPlaceholder(f.placeholder);
    setSheetOpen(true);
  }, [scenario]);

  // Dynamiczne wyniki podczas pisania przez użytkownika
  const dynamic = filterMockSearch(query);
  const effectiveResults = query ? dynamic.results : fixture.results;
  const effectiveError = dynamic.error ?? error;

  const handleSelect = (item: Suggestion) => {
    Alert.alert(
      'Wybrano pozycję (mock)',
      `Tytuł: ${item.title}\nAdres: ${item.address}\nTyp: ${item.kind}\nOdległość: ${item.distanceM ? `${item.distanceM} m` : 'Brak'}\n\nCo chcesz zrobić?`,
      [
        { text: 'Zostań', style: 'cancel' },
        {
          text: 'Szczegóły połączenia',
          onPress: () => router.push('/dev/transfer'),
        },
        {
          text: 'Ekran główny',
          onPress: () => router.push('/dev/home'),
        },
      ],
    );
  };

  const handleSelectLine = (line: TransitLine) => {
    Alert.alert(
      'Wybrano linię komunikacji',
      `Linia: ${line.shortName}\nTrasa: ${line.longName}\nŚrodek transportu: ${line.mode}`,
    );
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <DevNavHeader current="search" />

      {/* Scenarios bar */}
      <View style={styles.scenarioBar}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.scenarioList}
        >
          {SCENARIOS.map((item) => {
            const active = scenario === item.id;
            return (
              <Pressable
                key={item.id}
                onPress={() => setScenario(item.id)}
                style={({ pressed }) => [
                  styles.scenarioChip,
                  active && styles.scenarioChipActive,
                  pressed && !active && styles.scenarioChipPressed,
                ]}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
              >
                <Text
                  style={[
                    styles.scenarioChipLabel,
                    active && styles.scenarioChipLabelActive,
                  ]}
                >
                  {item.label}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>
      </View>

      {/* Background content when sheet is open or closed */}
      <View style={styles.background}>
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Wyszukiwarka połączeń (DEV MOCK)</Text>
          <Text style={styles.cardBody}>
            Testuj arkusz wyszukiwania na żywo w Expo Go bez bazy GTFS i bez GPS. Wpisz dowolny
            tekst w wyszukiwarkę (np. „Rynek”, „4”, „Dworzec”, „error”) lub przełącz scenariusz na
            górnym pasku.
          </Text>

          {!sheetOpen && (
            <Pressable
              style={({ pressed }) => [styles.openBtn, pressed && styles.openBtnPressed]}
              onPress={() => setSheetOpen(true)}
              accessibilityRole="button"
            >
              <Search size={18} color={scheme.onPrimary} />
              <Text style={styles.openBtnText}>Otwórz wyszukiwarkę</Text>
            </Pressable>
          )}
        </View>

        <View style={styles.hintsCard}>
          <Text style={styles.hintsTitle}>Szybkie testy zapytań:</Text>
          <View style={styles.queryPills}>
            {['Rynek', '4', 'Grunwald', 'Dworzec', 'Świdnicka', 'Zzzzz', 'error'].map((q) => (
              <Pressable
                key={q}
                onPress={() => {
                  setQuery(q);
                  setLoading(false);
                  setError(false);
                  setSheetOpen(true);
                }}
                style={styles.queryPill}
              >
                <Text style={styles.queryPillText}>{q}</Text>
              </Pressable>
            ))}
          </View>
        </View>
      </View>

      {/* SearchSheet interactive component */}
      {sheetOpen && (
        <SearchSheet
          query={query}
          loading={loading}
          error={effectiveError}
          results={effectiveResults}
          recent={fixture.recent}
          savedQuick={fixture.savedQuick}
          placeholder={placeholder ?? s.home.searchPlaceholderTo}
          originTitle={originTitle}
          notice={notice}
          onChangeOrigin={() => {
            setScenario('startMode');
          }}
          onQuery={setQuery}
          onSelectLine={handleSelectLine}
          onSelect={handleSelect}
          onClose={() => setSheetOpen(false)}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: scheme.surface,
  },
  scenarioBar: {
    paddingVertical: 8,
    backgroundColor: scheme.surfaceContainerLow,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: scheme.outlineVariant,
  },
  scenarioList: {
    paddingHorizontal: 16,
    gap: 6,
  },
  scenarioChip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: shape.full,
    backgroundColor: scheme.surfaceContainer,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  scenarioChipActive: {
    backgroundColor: scheme.primaryContainer,
    borderColor: scheme.primary,
  },
  scenarioChipPressed: {
    backgroundColor: scheme.surfaceContainerHigh,
  },
  scenarioChipLabel: {
    ...type.labelMedium,
    color: scheme.onSurfaceVariant,
  },
  scenarioChipLabelActive: {
    ...type.labelLarge,
    color: scheme.onPrimaryContainer,
    fontWeight: '700',
  },
  background: {
    flex: 1,
    padding: 20,
    gap: 16,
  },
  card: {
    padding: 18,
    borderRadius: shape.large,
    backgroundColor: scheme.surfaceContainerLow,
    gap: 10,
  },
  cardTitle: {
    ...type.titleMedium,
    color: scheme.onSurface,
    fontWeight: '700',
  },
  cardBody: {
    ...type.bodyMedium,
    color: scheme.onSurfaceVariant,
    lineHeight: 20,
  },
  openBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: shape.medium,
    backgroundColor: scheme.primary,
    marginTop: 6,
  },
  openBtnPressed: {
    opacity: 0.8,
  },
  openBtnText: {
    ...type.labelLarge,
    color: scheme.onPrimary,
    fontWeight: '700',
  },
  hintsCard: {
    padding: 16,
    borderRadius: shape.medium,
    backgroundColor: scheme.surfaceContainer,
    gap: 10,
  },
  hintsTitle: {
    ...type.labelMedium,
    color: scheme.onSurfaceVariant,
    fontWeight: '600',
  },
  queryPills: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  queryPill: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: shape.full,
    backgroundColor: scheme.surfaceContainerHigh,
  },
  queryPillText: {
    ...type.bodyMedium,
    color: scheme.onSurface,
  },
});
