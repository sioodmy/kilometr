import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, BackHandler, Pressable, StyleSheet, Text, View } from 'react-native';
import BottomSheet, {
  BottomSheetBackdrop,
  type BottomSheetBackdropProps,
  BottomSheetFlatList,
  BottomSheetTextInput,
} from '@gorhom/bottom-sheet';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Check, MapPin, MapPinOff, Search, X } from 'lucide-react-native';
import { elev, scheme, shape, type } from '../theme/tokens';
import { useStrings } from '../i18n';
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
};

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

  const renderBackdrop = useCallback(
    (props: BottomSheetBackdropProps) => (
      <BottomSheetBackdrop
        {...props}
        disappearsOnIndex={-1}
        appearsOnIndex={0}
        opacity={0.6}
        pressBehavior="close"
      />
    ),
    [],
  );

  const filteredCities = useMemo(() => {
    const norm = normalizePolish(query);
    if (!norm) {
      return [...CITIES].sort((a, b) => s.city.name(a.id).localeCompare(s.city.name(b.id), 'pl'));
    }

    return [...CITIES]
      .filter((c) => {
        const name = normalizePolish(s.city.name(c.id));
        const id = normalizePolish(c.id);
        const feeds = normalizePolish(s.city.feeds(c.id));
        const op = normalizePolish(s.city.operator(c.id));
        const aliases = CITY_ALIASES[c.id] ?? [];

        if (name.includes(norm) || id.includes(norm) || feeds.includes(norm) || op.includes(norm)) {
          return true;
        }
        return aliases.some((alias) => normalizePolish(alias).includes(norm));
      })
      .sort((a, b) => {
        const aName = normalizePolish(s.city.name(a.id));
        const bName = normalizePolish(s.city.name(b.id));
        const aStarts = aName.startsWith(norm);
        const bStarts = bName.startsWith(norm);
        if (aStarts && !bStarts) return -1;
        if (!aStarts && bStarts) return 1;
        return aName.localeCompare(bName, 'pl');
      });
  }, [query, s]);

  const handleCityPress = (city: CityDef) => {
    if (switchingCity) return;
    if (city.id === selectedCityId) {
      handleClose();
      return;
    }
    onSelectCity(city.id);
    handleClose();
  };

  return (
    <BottomSheet
      ref={sheetRef}
      index={0}
      snapPoints={['75%', '92%']}
      bottomInset={insets.bottom}
      enableDynamicSizing={false}
      enablePanDownToClose
      backdropComponent={renderBackdrop}
      onChange={(idx) => {
        if (idx === -1) onClose();
      }}
      backgroundStyle={styles.sheet}
      handleIndicatorStyle={styles.handle}
    >
      <View style={styles.container}>
        <View style={styles.header}>
          <View style={styles.headerText}>
            <Text style={styles.title}>{s.city.selectTitle}</Text>
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
          keyExtractor={(item: CityDef) => item.id}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          overScrollMode="never"
          style={styles.list}
          contentContainerStyle={styles.listContent}
          renderItem={({ item }: { item: CityDef }) => {
            const active = item.id === selectedCityId;
            const isSwitchingThis = switchingCity && switchingCityId === item.id;
            const cityName = s.city.name(item.id);
            const feeds = s.city.feeds(item.id);

            return (
              <Pressable
                onPress={() => handleCityPress(item)}
                disabled={switchingCity}
                style={({ pressed }) => [
                  styles.cityItem,
                  active && styles.cityItemActive,
                  switchingCity && !active && styles.cityItemDisabled,
                  pressed && !switchingCity && { opacity: 0.75 },
                ]}
                accessibilityRole="radio"
                accessibilityState={{ checked: active, disabled: switchingCity }}
                accessibilityLabel={`${cityName}, ${feeds}`}
              >
                <View style={[styles.cityItemIcon, active && styles.cityItemIconActive]}>
                  <MapPin size={20} color={active ? scheme.onPrimaryContainer : scheme.primary} />
                </View>

                <View style={styles.cityItemContent}>
                  <View style={styles.cityNameRow}>
                    <Text style={[styles.cityName, active && styles.cityNameActive]}>
                      {cityName}
                    </Text>
                    {active ? (
                      <View style={styles.cityActiveBadge}>
                        <Text style={styles.cityActiveBadgeText}>{s.city.cityActiveBadge}</Text>
                      </View>
                    ) : null}
                  </View>
                  <Text
                    style={[styles.cityFeeds, active && styles.cityFeedsActive]}
                    numberOfLines={2}
                  >
                    {feeds}
                  </Text>
                </View>

                {isSwitchingThis ? (
                  <ActivityIndicator size="small" color={scheme.primary} />
                ) : active ? (
                  <Check size={20} color={scheme.onPrimaryContainer} />
                ) : null}
              </Pressable>
            );
          }}
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
    backgroundColor: scheme.surfaceContainer,
    ...elev.level3,
  },
  handle: {
    backgroundColor: scheme.outlineVariant,
    width: 44,
  },
  container: {
    flex: 1,
    paddingHorizontal: 16,
    paddingTop: 4,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    marginBottom: 12,
    gap: 12,
  },
  headerText: {
    flex: 1,
    minWidth: 0,
  },
  title: {
    ...type.titleMedium,
    color: scheme.onSurface,
    fontWeight: '700',
  },
  subtitle: {
    ...type.bodySmall,
    color: scheme.onSurfaceVariant,
    lineHeight: 18,
    marginTop: 2,
  },
  closeBtn: {
    width: 36,
    height: 36,
    borderRadius: shape.full,
    backgroundColor: scheme.surfaceContainerHigh,
    alignItems: 'center',
    justifyContent: 'center',
  },
  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: scheme.surfaceContainerHighest,
    borderRadius: shape.full,
    paddingHorizontal: 14,
    minHeight: 44,
    gap: 8,
    marginBottom: 12,
  },
  searchInput: {
    flex: 1,
    ...type.bodyMedium,
    color: scheme.onSurface,
    paddingVertical: 8,
  },
  searchClearBtn: {
    padding: 4,
  },
  list: {
    flex: 1,
  },
  listContent: {
    paddingBottom: 24,
    gap: 8,
  },
  cityItem: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: scheme.surfaceContainerHigh,
    borderRadius: shape.large,
    paddingHorizontal: 14,
    paddingVertical: 12,
    minHeight: 64,
    gap: 12,
  },
  cityItemActive: {
    backgroundColor: scheme.primaryContainer,
  },
  cityItemDisabled: {
    opacity: 0.5,
  },
  cityItemIcon: {
    width: 40,
    height: 40,
    borderRadius: shape.medium,
    backgroundColor: scheme.surfaceContainerHighest,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cityItemIconActive: {
    backgroundColor: scheme.surfaceContainerHighest,
  },
  cityItemContent: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  cityNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  cityName: {
    ...type.titleSmall,
    color: scheme.onSurface,
    fontWeight: '700',
  },
  cityNameActive: {
    color: scheme.onPrimaryContainer,
  },
  cityActiveBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: shape.full,
    backgroundColor: scheme.surfaceContainerHighest,
  },
  cityActiveBadgeText: {
    ...type.labelSmall,
    color: scheme.onPrimaryContainer,
    fontWeight: '700',
  },
  cityFeeds: {
    ...type.bodySmall,
    color: scheme.onSurfaceVariant,
    lineHeight: 16,
  },
  cityFeedsActive: {
    color: scheme.onPrimaryContainer,
    opacity: 0.85,
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
