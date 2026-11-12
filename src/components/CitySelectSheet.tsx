import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, BackHandler, Pressable, StyleSheet, Text, View } from 'react-native';
import BottomSheet, {
  BottomSheetBackdrop,
  type BottomSheetBackdropProps,
  BottomSheetFlatList,
  BottomSheetTextInput,
} from '@gorhom/bottom-sheet';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Check, MapPinOff, Search, X } from './icons';
import { scheme, shape, type } from '../theme/tokens';
import { getLocaleSync, useStrings } from '../i18n';
import { CITIES, type CityDef, type CityId } from '../cities';
import { normalizePolish } from '../gtfs/geo';

const CITY_ALIASES: Record<string, string[]> = {
  wroclaw: ['wrocław', 'wroclaw', 'dolny śląsk', 'dolnyslask', 'breslau'],
  krakow: ['kraków', 'krakow', 'małopolska', 'malopolska', 'wieliczka', 'skawina', 'cracow'],
  gzm: [
    'metropolia',
    'śląsk',
    'slask',
    'zagłębie',
    'zaglebie',
    'katowice',
    'sosnowiec',
    'gliwice',
    'zabrze',
    'bytom',
    'ruda śląska',
    'ruda slaska',
    'tychy',
    'dąbrowa górnicza',
    'dabrowa gornicza',
    'chorzów',
    'chorzow',
    'mysłowice',
    'myslowice',
    'tarnowskie góry',
    'tarnowskie gory',
    'piekary śląskie',
    'piekary slaskie',
    'będzin',
    'bedzin',
    'świętochłowice',
    'swietochlowice',
    'siemianowice śląskie',
    'siemianowice',
    'mikołów',
    'mikolow',
    'czeladź',
    'czeladz',
    'knurów',
    'knurow',
  ],
  warszawa: [
    'warszawa',
    'warsaw',
    'stolica',
    'pruszków',
    'piaseczno',
    'legionowo',
    'otwock',
    'wołomin',
    'ząbki',
  ],
  poznan: ['poznań', 'poznan', 'wielkopolska', 'swarzędz', 'luboń', 'kórnik'],
  trojmiasto: [
    'trójmiasto',
    'trojmiasto',
    'gdańsk',
    'gdansk',
    'gdynia',
    'sopot',
    'pomorze',
    'wejherowo',
    'rumia',
    'reda',
  ],
  lodz: ['łódź', 'lodz', 'zgierz', 'pabianice', 'aleksandrów łódzki', 'konstantynów łódzki'],
  szczecin: ['szczecin', 'pomorze zachodnie', 'police', 'dobra', 'gryfino', 'stargard', 'stettin'],
  kielce: [
    'kielce',
    'świętokrzyskie',
    'swietokrzyskie',
    'chęciny',
    'checiny',
    'morawica',
    'masłów',
    'maslow',
    'daleszyce',
    'zagnańsk',
    'zagnansk',
  ],
  olsztyn: ['olsztyn', 'warmia', 'mazury', 'allenstein', 'dywity', 'stawiguda', 'barczewo'],
  bialystok: [
    'białystok',
    'bialystok',
    'podlasie',
    'podlaskie',
    'wasilków',
    'wasilkow',
    'choroszcz',
    'supraśl',
    'suprasl',
    'zabłudów',
    'zabludow',
  ],
  opole: [
    'opole',
    'opolskie',
    'opolszczyzna',
    'oppeln',
    'komprachcice',
    'tarnów opolski',
    'tarnow opolski',
    'prószków',
    'proszkow',
  ],
  rzeszow: [
    'rzeszów',
    'rzeszow',
    'podkarpacie',
    'podkarpackie',
    'jasionka',
    'łańcut',
    'lancut',
    'krasne',
    'tyczyn',
    'boguchwała',
    'boguchwala',
    'głogów małopolski',
    'glogow malopolski',
  ],
  lublin: [
    'lublin',
    'lubelskie',
    'lubelszczyzna',
    'świdnik',
    'swidnik',
    'niemce',
    'konopnica',
    'głusk',
    'glusk',
    'jastków',
    'jastkow',
  ],
  radom: [
    'radom',
    'radomskie',
    'ziemia radomska',
    'pionki',
    'jedlnia',
    'iłża',
    'ilza',
    'skaryszew',
    'wolanów',
    'wolanow',
    'zakrzew',
  ],
  bydgoszcz: ['bydgoszcz', 'kujawy', 'kujawsko-pomorskie', 'zławieś wielka', 'zlawies wielka'],
  torun: ['toruń', 'torun', 'kujawy', 'kujawsko-pomorskie', 'thorn'],
  elblag: ['elbląg', 'elblag', 'elbing', 'żuławy', 'zulawy'],
  gorzow: ['gorzów wielkopolski', 'gorzow wielkopolski', 'gorzów', 'gorzow', 'lubuskie'],
  czestochowa: ['częstochowa', 'czestochowa', 'jura', 'województwo śląskie'],
  zielonagora: ['zielona góra', 'zielona gora', 'lubuskie', 'grünberg'],
  rybnik: ['rybnik', 'rybnicki', 'żory', 'zory', 'świerklany', 'swierklany'],
  slupsk: ['słupsk', 'slupsk', 'pomorze', 'słupski', 'slupski', 'stolp'],
  walbrzych: ['wałbrzych', 'walbrzych', 'dolny śląsk', 'dolnyslask', 'szczawno-zdrój', 'szczawno'],
  kalisz: [
    'kalisz',
    'kaliskie',
    'ostrow wielkopolski',
    'ostrowskie',
    'pleszew',
    'skalmierzyce',
    'opatówek',
  ],
  siedlce: ['siedlce', 'siedleckie', 'podlasie', 'podlaskie', 'mordy', 'suchożebry'],
  lomza: ['łomża', 'lomza', 'podlasie', 'podlaskie', 'łomżyńskie', 'lomzynskie'],
  krosno: ['krosno', 'krośnieńskie', 'krosnienskie', 'podkarpacie', 'podkarpackie'],
  jaslo: ['jasło', 'jaslo', 'jasielskie', 'podkarpacie', 'podkarpackie'],
  olkusz: ['olkusz', 'olkuski', 'bukowno', 'klucze'],
  chrzanow: ['chrzanów', 'chrzanow', 'trzebinia', 'libiąż', 'libiaz', 'chełmek', 'chelmek'],
  bochnia: ['bochnia', 'bocheńskie', 'bochenskie', 'małopolska', 'malopolska'],
  ilawa: ['iława', 'ilawa', 'iławskie', 'ilawskie', 'warmia', 'mazury'],
};

/**
 * Wpis listy z indeksem wyszukiwania policzonym raz na język. Normalizacja
 * nazw, feedów i aliasów w trakcie pisania była wąskim gardłem przy 33 miastach.
 */
type CityEntry = {
  city: CityDef;
  name: string;
  feeds: string;
  nameNorm: string;
  searchText: string;
};

const keyExtractor = (item: CityEntry) => item.city.id;

/** Wiersz z własną memoizacją: wpisy są stabilne, więc scroll i pisanie nie przerenderowują całej listy. */
const CityRow = memo(function CityRow({
  entry,
  active,
  switching,
  disabled,
  onPress,
}: {
  entry: CityEntry;
  active: boolean;
  switching: boolean;
  disabled: boolean;
  onPress: (city: CityDef) => void;
}) {
  const { city, name, feeds } = entry;
  return (
    <Pressable
      onPress={() => onPress(city)}
      disabled={disabled}
      style={({ pressed }) => [
        styles.cityItem,
        active && styles.cityItemActive,
        disabled && !active && styles.cityItemDisabled,
        pressed && !disabled && { opacity: 0.75 },
      ]}
      accessibilityRole="radio"
      accessibilityState={{ checked: active, disabled }}
      accessibilityLabel={`${name}, ${feeds}`}
    >
      <View style={styles.cityItemContent}>
        <Text style={[styles.cityName, active && styles.cityNameActive]}>{name}</Text>
        <Text style={[styles.cityFeeds, active && styles.cityFeedsActive]}>{feeds}</Text>
      </View>

      {switching ? (
        <ActivityIndicator size="small" color={scheme.primary} />
      ) : active ? (
        <Check size={22} color={scheme.onPrimaryContainer} />
      ) : (
        <View style={styles.radioOutline} />
      )}
    </Pressable>
  );
});

export interface CitySelectSheetProps {
  selectedCityId: CityId;
  onSelectCity: (id: CityId) => void;
  onClose: () => void;
  switchingCity?: boolean;
  switchingCityId?: CityId | null;
}

export function CitySelectSheet({
  selectedCityId,
  onSelectCity,
  onClose,
  switchingCity,
  switchingCityId,
}: CitySelectSheetProps) {
  const sheetRef = useRef<BottomSheet>(null);
  const [query, setQuery] = useState('');
  const s = useStrings();
  const insets = useSafeAreaInsets();

  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const selectRef = useRef(onSelectCity);
  selectRef.current = onSelectCity;
  const selectedRef = useRef(selectedCityId);
  selectedRef.current = selectedCityId;
  const switchingRef = useRef(switchingCity);
  switchingRef.current = switchingCity;

  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      closeRef.current();
      return true;
    });
    return () => sub.remove();
  }, []);

  const handleClose = useCallback(() => {
    sheetRef.current?.close();
  }, []);

  const entries = useMemo(() => {
    const locale = getLocaleSync();
    return CITIES.map((city) => {
      const name = s.city.name(city.id);
      const feeds = s.city.feeds(city.id);
      const aliases = (CITY_ALIASES[city.id] ?? []).join(' ');
      return {
        city,
        name,
        feeds,
        nameNorm: normalizePolish(name),
        searchText: normalizePolish(
          `${name} ${city.id} ${feeds} ${s.city.operator(city.id)} ${aliases}`,
        ),
      };
    }).sort((a, b) => a.name.localeCompare(b.name, locale));
  }, [s]);

  // Aktywne miasto pierwsze, ale dopiero po posortowaniu: sort na każdy render
  // z localeCompare był odczuwalny przy otwieraniu arkusza.
  const orderedEntries = useMemo(() => {
    const index = entries.findIndex((entry) => entry.city.id === selectedCityId);
    if (index <= 0) return entries;
    const active = entries[index];
    return [active, ...entries.slice(0, index), ...entries.slice(index + 1)];
  }, [entries, selectedCityId]);

  const normQuery = useMemo(() => normalizePolish(query), [query]);

  const filteredCities = useMemo(() => {
    if (!normQuery) return orderedEntries;
    const prefixed: CityEntry[] = [];
    const rest: CityEntry[] = [];
    for (const entry of entries) {
      if (!entry.searchText.includes(normQuery)) continue;
      if (entry.nameNorm.startsWith(normQuery)) prefixed.push(entry);
      else rest.push(entry);
    }
    if (prefixed.length === 0) return rest;
    if (rest.length === 0) return prefixed;
    return [...prefixed, ...rest];
  }, [entries, normQuery, orderedEntries]);

  const handleCityPress = useCallback((city: CityDef) => {
    if (switchingRef.current) return;
    if (city.id === selectedRef.current) {
      sheetRef.current?.close();
      return;
    }
    selectRef.current(city.id);
    sheetRef.current?.close();
  }, []);

  const renderItem = useCallback(
    ({ item }: { item: CityEntry }) => (
      <CityRow
        entry={item}
        active={item.city.id === selectedCityId}
        switching={Boolean(switchingCity) && switchingCityId === item.city.id}
        disabled={Boolean(switchingCity)}
        onPress={handleCityPress}
      />
    ),
    [handleCityPress, selectedCityId, switchingCity, switchingCityId],
  );

  const listContentStyle = useMemo(
    () => [styles.listContent, { paddingBottom: 24 + insets.bottom }],
    [insets.bottom],
  );

  const renderBackdrop = useCallback(
    (props: BottomSheetBackdropProps) => (
      <BottomSheetBackdrop
        {...props}
        disappearsOnIndex={-1}
        appearsOnIndex={0}
        opacity={0.6}
        pressBehavior="close"
        accessibilityRole="button"
        accessibilityLabel={s.city.closeSheetA11y}
      />
    ),
    [s.city.closeSheetA11y],
  );

  return (
    <BottomSheet
      ref={sheetRef}
      index={0}
      snapPoints={['92%']}
      topInset={insets.top}
      bottomInset={insets.bottom}
      enableDynamicSizing={false}
      enablePanDownToClose
      keyboardBehavior="interactive"
      keyboardBlurBehavior="restore"
      android_keyboardInputMode="adjustResize"
      backdropComponent={renderBackdrop}
      onClose={onClose}
      backgroundStyle={styles.sheet}
      handleIndicatorStyle={styles.handle}
    >
      <View style={styles.container} accessibilityViewIsModal>
        <View style={styles.header}>
          <View style={styles.headerText}>
            <Text style={styles.title} accessibilityRole="header">
              {s.city.selectTitle}
            </Text>
            <Text style={styles.subtitle}>{s.city.selectSub}</Text>
          </View>
          <Pressable
            onPress={handleClose}
            hitSlop={8}
            style={({ pressed }) => [styles.closeBtn, pressed && { opacity: 0.7 }]}
            accessibilityRole="button"
            accessibilityLabel={s.city.closeSheetA11y}
          >
            <X size={20} color={scheme.onSurfaceVariant} />
          </Pressable>
        </View>

        <View style={styles.searchBox}>
          <Search size={18} color={scheme.onSurfaceVariant} />
          <BottomSheetTextInput
            value={query}
            onChangeText={setQuery}
            placeholder={s.city.searchPlaceholder}
            accessibilityLabel={s.city.searchPlaceholder}
            placeholderTextColor={scheme.onSurfaceVariant}
            style={styles.searchInput}
            autoCorrect={false}
            clearButtonMode="never"
          />
          {query.length > 0 ? (
            <Pressable
              onPress={() => setQuery('')}
              hitSlop={8}
              style={styles.searchClearBtn}
              accessibilityRole="button"
              accessibilityLabel={s.city.searchClearA11y}
            >
              <X size={16} color={scheme.onSurfaceVariant} />
            </Pressable>
          ) : null}
        </View>

        <BottomSheetFlatList
          data={filteredCities}
          keyExtractor={keyExtractor}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          overScrollMode="never"
          initialNumToRender={8}
          maxToRenderPerBatch={8}
          updateCellsBatchingPeriod={50}
          windowSize={7}
          style={styles.list}
          contentContainerStyle={listContentStyle}
          renderItem={renderItem}
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              <MapPinOff size={28} color={scheme.onSurfaceVariant} />
              <Text style={styles.emptyTitle}>{s.city.noSearchResults(query.trim())}</Text>
              <Text style={styles.emptySub}>{s.city.searchEmptyHint}</Text>
            </View>
          }
        />
      </View>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  sheet: {
    borderTopLeftRadius: shape.extraLarge,
    borderTopRightRadius: shape.extraLarge,
    backgroundColor: scheme.surfaceContainerLow,
  },
  handle: {
    backgroundColor: scheme.outlineVariant,
    width: 36,
  },
  container: {
    flex: 1,
    paddingHorizontal: 20,
    paddingTop: 8,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    marginBottom: 20,
    gap: 12,
  },
  headerText: {
    flex: 1,
    minWidth: 0,
  },
  title: {
    ...type.titleLarge,
    color: scheme.onSurface,
    fontWeight: '500',
  },
  subtitle: {
    ...type.bodyMedium,
    color: scheme.onSurfaceVariant,
    lineHeight: 21,
    marginTop: 6,
  },
  closeBtn: {
    width: 48,
    height: 48,
    borderRadius: shape.medium,
    alignItems: 'center',
    justifyContent: 'center',
  },
  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: scheme.surfaceContainerHigh,
    borderRadius: shape.large,
    paddingLeft: 16,
    paddingRight: 4,
    minHeight: 56,
    gap: 10,
    marginBottom: 20,
  },
  searchInput: {
    flex: 1,
    ...type.bodyLarge,
    color: scheme.onSurface,
    paddingVertical: 14,
  },
  searchClearBtn: {
    width: 48,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  list: {
    flex: 1,
  },
  listContent: {
    gap: 4,
  },
  cityItem: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: scheme.surfaceContainerLow,
    borderRadius: shape.large,
    paddingHorizontal: 18,
    paddingVertical: 18,
    minHeight: 84,
    gap: 12,
  },
  cityItemActive: {
    backgroundColor: scheme.primaryContainer,
  },
  cityItemDisabled: {
    opacity: 0.5,
  },
  cityItemContent: {
    flex: 1,
    minWidth: 0,
    gap: 6,
  },
  cityName: {
    ...type.titleMedium,
    color: scheme.onSurface,
    fontWeight: '500',
  },
  cityNameActive: {
    color: scheme.onPrimaryContainer,
  },
  radioOutline: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 1.5,
    borderColor: scheme.outline,
  },
  cityFeeds: {
    ...type.bodySmall,
    color: scheme.onSurfaceVariant,
    lineHeight: 19,
  },
  cityFeedsActive: {
    color: scheme.onPrimaryContainer,
  },
  emptyContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 36,
    gap: 8,
    paddingHorizontal: 20,
  },
  emptyTitle: {
    ...type.titleSmall,
    color: scheme.onSurface,
    fontWeight: '600',
    textAlign: 'center',
  },
  emptySub: {
    ...type.bodySmall,
    color: scheme.onSurfaceVariant,
    textAlign: 'center',
    lineHeight: 18,
  },
});
