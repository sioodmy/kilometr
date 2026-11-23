import { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Redirect, router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Bell, Download, History, MapPin, Settings2 } from '../../src/components/icons';
import { scheme, shape, type } from '../../src/theme/tokens';
import { useStrings } from '../../src/i18n';
import { homeFixture, type HomeDevScenario } from '../../src/dev/homeFixture';
import { DevNavHeader } from '../../src/dev/DevNavHeader';
import { SavedPlacesRow } from '../../src/components/SavedPlacesRow';
import { SmartHistoryList } from '../../src/components/SmartHistoryList';
import { HomeThumbBar } from '../../src/components/HomeThumbBar';
import { UnsupportedCityCard } from '../../src/components/UnsupportedCityCard';
import { SearchSheet } from '../../src/components/SearchSheet';
import { filterMockSearch, searchFixture } from '../../src/dev/searchFixture';

type RouteTarget = {
  id?: string;
  title: string;
  address?: string;
  lat: number;
  lon: number;
  kind?: string;
};

const SCENARIOS: Array<{ id: HomeDevScenario; label: string }> = [
  { id: 'standard', label: 'Standard' },
  { id: 'empty', label: 'Pusty stan' },
  { id: 'updateAvailable', label: 'Aktualizacja' },
  { id: 'downloading', label: 'Pobieranie' },
  { id: 'importing', label: 'Import GTFS' },
  { id: 'error', label: 'Błąd bazy' },
  { id: 'outsideGps', label: 'Poza strefą' },
  { id: 'customStart', label: 'Własny start' },
];

export default function DevHomeScreen() {
  if (!__DEV__) return <Redirect href="/" />;

  const s = useStrings();
  const [scenario, setScenario] = useState<HomeDevScenario>('standard');
  const [sheetMode, setSheetMode] = useState<'destination' | 'start' | null>(null);
  const [searchQuery, setSearchQuery] = useState('');

  const fixture = homeFixture(scenario);
  const searchMock = searchFixture(sheetMode === 'start' ? 'startMode' : 'initial');
  const dynamicSearch = filterMockSearch(searchQuery);

  const handleSelectDestination = (target: RouteTarget) => {
    Alert.alert(
      'Wybrano cel podróży (mock)',
      `Dokąd: ${target.title}\nAdres: ${target.address ?? 'Brak'}\n\nCzy chcesz przejść do widoku przesiadek?`,
      [
        { text: 'Zostań', style: 'cancel' },
        {
          text: 'Idź do przesiadek',
          onPress: () => router.push('/dev/transfer'),
        },
      ],
    );
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <DevNavHeader current="home" />

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

      <ScrollView
        contentContainerStyle={styles.body}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {/* Top bar (City, Notifications, Settings) */}
        <View style={styles.topBar}>
          <Pressable
            style={({ pressed }) => [styles.cityContext, pressed && { opacity: 0.7 }]}
            onPress={() => Alert.alert('Wybór miasta', 'W mocku aktywne jest miasto Wrocław.')}
            accessibilityRole="button"
          >
            <MapPin size={16} color={scheme.primary} />
            <Text style={styles.cityName}>{s.city.name(fixture.cityId)}</Text>
          </Pressable>
          <View style={styles.topActions}>
            <Pressable
              style={styles.iconBtn}
              onPress={() => Alert.alert('Komunikaty MPK', 'Brak nowych komunikatów')}
              accessibilityRole="button"
            >
              <Bell size={20} color={scheme.onSurfaceVariant} />
              {fixture.newsAlert && (
                <View style={styles.alertBadge}>
                  <Text style={styles.alertMark}>!</Text>
                </View>
              )}
            </Pressable>
            <Pressable
              style={styles.iconBtn}
              onPress={() => Alert.alert('Ustawienia', 'Mock ekranu ustawień')}
              accessibilityRole="button"
            >
              <Settings2 size={20} color={scheme.onSurfaceVariant} />
            </Pressable>
          </View>
        </View>

        <Text style={styles.headerTitle} accessibilityRole="header">
          {s.home.title}
        </Text>

        {/* Timetable update card */}
        {fixture.timetableUpdate && fixture.dataStatus.state === 'ready' && (
          <Pressable
            style={({ pressed }) => [styles.updateCard, pressed && styles.updateCardPressed]}
            onPress={() => Alert.alert('Aktualizacja', 'Rozpoczęto aktualizację rozkładu jazdy')}
            accessibilityRole="button"
          >
            <View style={styles.updateText}>
              <Text style={styles.updateTitle}>{s.home.timetableUpdateTitle}</Text>
              <Text style={styles.updateBody}>{s.home.timetableUpdateBody}</Text>
            </View>
            <Download size={20} color={scheme.primary} />
          </Pressable>
        )}

        {/* Downloading banner */}
        {fixture.dataStatus.state === 'downloading' && (
          <View style={styles.importCard}>
            <ActivityIndicator size="small" color={scheme.primary} />
            <View style={{ flex: 1 }}>
              <Text style={styles.importTitle}>Pobieranie rozkładu jazdy...</Text>
              <Text style={styles.importSub}>
                {Math.round(fixture.dataStatus.progress * 100)}%
              </Text>
            </View>
          </View>
        )}

        {/* Importing banner */}
        {fixture.dataStatus.state === 'importing' && (
          <View style={styles.importCard}>
            <ActivityIndicator size="small" color={scheme.primary} />
            <View style={{ flex: 1 }}>
              <Text style={styles.importTitle}>{fixture.dataStatus.step}</Text>
              <Text style={styles.importSub}>
                {Math.round(fixture.dataStatus.progress * 100)}%
              </Text>
            </View>
          </View>
        )}

        {/* Error banner */}
        {fixture.dataStatus.state === 'error' && (
          <Pressable
            style={styles.importCardError}
            onPress={() => Alert.alert('Ponawianie', 'Ponowna próba pobierania...')}
            accessibilityRole="button"
          >
            <Text style={styles.importTitleError}>{s.home.importErrorTitle}</Text>
            <Text style={styles.importSubError}>
              {fixture.dataStatus.message}. {fixture.dataStatus.hint ?? s.home.importErrorRetry}
            </Text>
          </Pressable>
        )}

        {/* GPS outside city banner */}
        {fixture.gpsUnsupported && (
          <UnsupportedCityCard
            city={fixture.gpsCity}
            coords={fixture.gpsLocation}
            activeCity={s.city.name(fixture.cityId)}
            activeCityId={fixture.cityId}
            onPickStart={() => {
              setSearchQuery('');
              setSheetMode('start');
            }}
            onSwitchCity={(newCityId) => {
              Alert.alert('Zmiana miasta', `Przełączono na ${newCityId}`);
            }}
            onNearestStation={() => {
              Alert.alert('Najbliższa stacja', 'Wyszukiwanie pociągów z najbliższej stacji');
            }}
          />
        )}

        {/* Saved places section */}
        <View style={styles.savedSection}>
          <View style={styles.sectionHeader}>
            <Text style={styles.section} accessibilityRole="header">
              {s.home.savedTitle}
            </Text>
            {fixture.saved.length > 0 && (
              <Pressable
                onPress={() => Alert.alert('Zarządzanie miejscami', 'Edycja zapisanych miejsc')}
                style={({ pressed }) => [styles.editSaved, pressed && styles.editSavedPressed]}
                accessibilityRole="button"
              >
                <Text style={styles.editSavedLabel}>{s.home.editCard}</Text>
              </Pressable>
            )}
          </View>
          <SavedPlacesRow
            places={fixture.saved}
            onSelect={(p) =>
              handleSelectDestination({
                id: p.placeId,
                title: p.name,
                lat: p.lat,
                lon: p.lon,
              })
            }
            onAdd={() => Alert.alert('Dodaj miejsce', 'Otwórz arkusz dodawania')}
            onEdit={(p) => Alert.alert('Edycja miejsca', `Edycja: ${p.name}`)}
          />
        </View>

        <View style={{ height: 24 }} />

        {/* Smart destinations or empty history */}
        {fixture.smart.length === 0 ? (
          <View style={styles.emptyCard}>
            <View style={styles.emptyIcon}>
              <History size={20} color={scheme.onSecondaryContainer} />
            </View>
            <View style={styles.emptyText}>
              <Text style={styles.emptyTitle}>{s.home.historyEmptyTitle}</Text>
              <Text style={styles.emptyBody}>{s.home.historyEmptyBody}</Text>
            </View>
          </View>
        ) : (
          <SmartHistoryList
            items={fixture.smart}
            departures={fixture.liveDepartures}
            lineBadges={fixture.firstLegs}
            onSelect={handleSelectDestination}
            onOpenConnection={() => router.push('/dev/transfer')}
          />
        )}
      </ScrollView>

      {/* Docked HomeThumbBar */}
      {!sheetMode && (
        <HomeThumbBar
          onOpenSearch={() => {
            setSearchQuery('');
            setSheetMode('destination');
          }}
          startTitle={fixture.locTitle}
          isCustomStart={fixture.isCustomStart}
          onOpenStart={() => {
            setSearchQuery('');
            setSheetMode('start');
          }}
          onResetStart={() => {
            Alert.alert('Reset startu', 'Przywrócono pozycję GPS');
            setScenario('standard');
          }}
          gpsUnsupported={fixture.gpsUnsupported}
        />
      )}

      {/* SearchSheet interactive integration */}
      {sheetMode && (
        <SearchSheet
          query={searchQuery}
          loading={false}
          error={false}
          results={searchQuery ? dynamicSearch.results : []}
          recent={sheetMode === 'start' ? searchMock.recent : searchMock.recent.filter((i) => i.id !== '__gps')}
          savedQuick={searchMock.savedQuick}
          placeholder={
            sheetMode === 'start' ? s.home.searchPlaceholderFrom : s.home.searchPlaceholderTo
          }
          originTitle={sheetMode === 'destination' ? fixture.locTitle : undefined}
          notice={
            sheetMode === 'start' && fixture.gpsUnsupported
              ? s.search.gpsOutsideNotice
              : undefined
          }
          onChangeOrigin={
            sheetMode === 'destination'
              ? () => {
                  setSearchQuery('');
                  setSheetMode('start');
                }
              : undefined
          }
          onQuery={setSearchQuery}
          onSelectLine={(line) => {
            setSheetMode(null);
            Alert.alert('Wybrano linię', `Linia ${line.shortName} (${line.longName})`);
          }}
          onSelect={(item) => {
            setSheetMode(null);
            handleSelectDestination(item);
          }}
          onClose={() => setSheetMode(null)}
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
  body: {
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 110,
    flexGrow: 1,
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    minHeight: 52,
    marginBottom: 8,
  },
  cityContext: {
    flex: 1,
    minWidth: 0,
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
  },
  cityName: {
    ...type.bodyMedium,
    color: scheme.onSurfaceVariant,
    flexShrink: 1,
  },
  topActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginLeft: 'auto',
  },
  iconBtn: {
    width: 44,
    height: 44,
    borderRadius: shape.medium,
    backgroundColor: scheme.surfaceContainerLow,
    alignItems: 'center',
    justifyContent: 'center',
  },
  alertBadge: {
    position: 'absolute',
    top: -2,
    right: -2,
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: scheme.error,
    borderWidth: 2,
    borderColor: scheme.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  alertMark: {
    fontSize: 10,
    fontWeight: '800',
    color: scheme.onError,
    lineHeight: 12,
  },
  headerTitle: {
    fontSize: 32,
    fontWeight: '500',
    color: scheme.onSurface,
    letterSpacing: -0.8,
  },
  updateCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginTop: 12,
    padding: 14,
    minHeight: 64,
    backgroundColor: scheme.surfaceContainerHigh,
    borderRadius: shape.medium,
  },
  updateCardPressed: {
    backgroundColor: scheme.surfaceContainerHighest,
  },
  updateText: {
    flex: 1,
    gap: 2,
    minWidth: 0,
  },
  updateTitle: {
    ...type.bodyMedium,
    color: scheme.onSurface,
    fontWeight: '600',
  },
  updateBody: {
    ...type.labelSmall,
    color: scheme.onSurfaceVariant,
  },
  savedSection: {
    marginTop: 20,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    minHeight: 44,
    marginBottom: 4,
  },
  section: {
    ...type.titleMedium,
    fontWeight: '500',
    color: scheme.onSurface,
    flex: 1,
  },
  editSaved: {
    minWidth: 64,
    minHeight: 40,
    paddingHorizontal: 12,
    justifyContent: 'center',
    borderRadius: shape.medium,
  },
  editSavedPressed: {
    backgroundColor: scheme.surfaceContainerHigh,
  },
  editSavedLabel: {
    ...type.labelLarge,
    color: scheme.primary,
  },
  emptyCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    padding: 20,
    backgroundColor: scheme.surfaceContainerLow,
    borderRadius: shape.extraLarge,
  },
  emptyText: {
    flex: 1,
    gap: 6,
  },
  emptyIcon: {
    width: 44,
    height: 44,
    borderRadius: shape.full,
    backgroundColor: scheme.secondaryContainer,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyTitle: {
    ...type.titleMedium,
    color: scheme.onSurface,
  },
  emptyBody: {
    ...type.bodyMedium,
    color: scheme.onSurfaceVariant,
  },
  importCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginTop: 12,
    padding: 12,
    backgroundColor: scheme.surfaceContainerHigh,
    borderRadius: shape.medium,
  },
  importTitle: {
    ...type.bodyMedium,
    color: scheme.onSurface,
    fontWeight: '600',
  },
  importSub: {
    ...type.labelSmall,
    color: scheme.onSurfaceVariant,
  },
  importCardError: {
    marginTop: 12,
    padding: 14,
    backgroundColor: scheme.errorContainer,
    borderRadius: shape.medium,
    gap: 4,
  },
  importTitleError: {
    ...type.bodyMedium,
    color: scheme.onErrorContainer,
    fontWeight: '600',
  },
  importSubError: {
    ...type.labelSmall,
    color: scheme.onErrorContainer,
  },
});
