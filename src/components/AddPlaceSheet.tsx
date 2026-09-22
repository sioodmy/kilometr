import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  BackHandler,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import BottomSheet, { BottomSheetFlatList, BottomSheetScrollView } from '@gorhom/bottom-sheet';
import {
  Anchor,
  Bike,
  Briefcase,
  CarFront,
  Check,
  ChevronLeft,
  Church,
  Clapperboard,
  Coffee,
  Dumbbell,
  GraduationCap,
  Heart,
  Home,
  Landmark,
  Library,
  MapPin,
  Pencil,
  Pill,
  Plane,
  Search,
  ShoppingBag,
  Star,
  Store,
  Train,
  Trash2,
  Trees,
  Users,
  UtensilsCrossed,
  X,
} from 'lucide-react-native';
import { elev, scheme, shape, type } from '../theme/tokens';
import type { SavedPlace, SavedPlaceIcon, Suggestion } from '../types/models';
import { SearchService, fetchNearestStops, type NearestStop } from '../services';
import { SuggestionRow } from './SuggestionRow';

export const PLACE_ICON_OPTIONS: { key: SavedPlaceIcon; label: string; icon: any }[] = [
  { key: 'home', label: 'Dom', icon: Home },
  { key: 'work', label: 'Praca', icon: Briefcase },
  { key: 'school', label: 'Szkoła', icon: GraduationCap },
  { key: 'gym', label: 'Siłownia', icon: Dumbbell },
  { key: 'coffee', label: 'Kawiarnia', icon: Coffee },
  { key: 'shopping', label: 'Sklep', icon: ShoppingBag },
  { key: 'train', label: 'Dworzec', icon: Train },
  { key: 'restaurant', label: 'Restauracja', icon: UtensilsCrossed },
  { key: 'pharmacy', label: 'Apteka', icon: Pill },
  { key: 'market', label: 'Market', icon: Store },
  { key: 'park', label: 'Park', icon: Trees },
  { key: 'cinema', label: 'Kino', icon: Clapperboard },
  { key: 'culture', label: 'Muzeum', icon: Landmark },
  { key: 'library', label: 'Biblioteka', icon: Library },
  { key: 'friends', label: 'Znajomi', icon: Users },
  { key: 'church', label: 'Kościół', icon: Church },
  { key: 'car', label: 'Samochód', icon: CarFront },
  { key: 'bike', label: 'Rower', icon: Bike },
  { key: 'plane', label: 'Lotnisko', icon: Plane },
  { key: 'star', label: 'Ulubione', icon: Star },
  { key: 'heart', label: 'Ważne', icon: Heart },
  { key: 'mapPin', label: 'Inne', icon: MapPin },
];

export function AddPlaceSheet({
  open = true,
  initialPlace,
  onClose,
  onSave,
  onDelete,
}: {
  open?: boolean;
  initialPlace?: SavedPlace | null;
  onClose: () => void;
  onSave: (place: {
    id?: string;
    name: string;
    icon: SavedPlaceIcon;
    address: string;
    lat: number;
    lon: number;
    anchorStopId?: string | null;
    anchorStopName?: string | null;
    anchorStopLat?: number | null;
    anchorStopLon?: number | null;
  }) => void;
  onDelete?: (id: string) => void;
}) {
  const sheetRef = useRef<BottomSheet>(null);
  const isEditing = Boolean(initialPlace);

  // Android back / gest wstecz zamyka sheet zamiast wyjścia z apki
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      closeRef.current();
      return true;
    });
    return () => sub.remove();
  }, []);
  const [name, setName] = useState(initialPlace?.name || '');
  const [selectedIcon, setSelectedIcon] = useState<SavedPlaceIcon>(initialPlace?.icon || 'home');
  const [query, setQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [selectedLoc, setSelectedLoc] = useState<Suggestion | null>(
    initialPlace
      ? {
          id: initialPlace.placeId || initialPlace.id,
          title: initialPlace.name,
          address: initialPlace.address,
          lat: initialPlace.lat,
          lon: initialPlace.lon,
          kind: 'address',
        }
      : null
  );
  const [isChangingLoc, setIsChangingLoc] = useState(!initialPlace);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const [anchorStop, setAnchorStop] = useState<{
    id?: string;
    name?: string;
    lat?: number;
    lon?: number;
  } | null>(
    initialPlace?.anchorStopName
      ? {
          id: initialPlace.anchorStopId,
          name: initialPlace.anchorStopName,
          lat: initialPlace.anchorStopLat,
          lon: initialPlace.anchorStopLon,
        }
      : null
  );
  const [isPickingAnchor, setIsPickingAnchor] = useState(false);
  const [anchorQuery, setAnchorQuery] = useState('');
  const [anchorSuggestions, setAnchorSuggestions] = useState<Suggestion[]>([]);
  const [nearestStops, setNearestStops] = useState<NearestStop[]>([]);
  const [searchingAnchor, setSearchingAnchor] = useState(false);

  // Gdy zmienia się lokalizacja miejsca, pobierz najbliższe przystanki
  useEffect(() => {
    if (selectedLoc) {
      fetchNearestStops(selectedLoc.lat, selectedLoc.lon, 6).then((stops) => {
        setNearestStops(stops);
      });
      // Jeśli użytkownik wybrał bezpośrednio przystanek MPK i nie ma jeszcze przypisanego kotwiczenia
      if (selectedLoc.kind === 'stop' && !anchorStop) {
        setAnchorStop({
          id: selectedLoc.id,
          name: selectedLoc.title,
          lat: selectedLoc.lat,
          lon: selectedLoc.lon,
        });
      }
    }
  }, [selectedLoc?.id]);

  const handleClose = () => {
    sheetRef.current?.close();
  };

  const handleQueryChange = (text: string) => {
    setQuery(text);
    if (!text.trim()) {
      setSuggestions([]);
      setSearching(false);
      return;
    }
    setSearching(true);
    const t = setTimeout(() => {
      SearchService.search(text).then((res) => {
        setSuggestions(res);
        setSearching(false);
      });
    }, 220);
    return () => clearTimeout(t);
  };

  const handleAnchorQueryChange = (text: string) => {
    setAnchorQuery(text);
    if (!text.trim()) {
      setAnchorSuggestions([]);
      setSearchingAnchor(false);
      return;
    }
    setSearchingAnchor(true);
    const t = setTimeout(() => {
      SearchService.search(text, selectedLoc ? { lat: selectedLoc.lat, lon: selectedLoc.lon } : undefined).then((res) => {
        setAnchorSuggestions(res);
        setSearchingAnchor(false);
      });
    }, 220);
    return () => clearTimeout(t);
  };

  const handleSave = () => {
    if (!name.trim() || !selectedLoc) return;
    onSave({
      id: initialPlace?.id,
      name: name.trim(),
      icon: selectedIcon,
      address: selectedLoc.address,
      lat: selectedLoc.lat,
      lon: selectedLoc.lon,
      anchorStopId: anchorStop ? (anchorStop.id ?? null) : null,
      anchorStopName: anchorStop ? (anchorStop.name ?? null) : null,
      anchorStopLat: anchorStop ? (anchorStop.lat ?? null) : null,
      anchorStopLon: anchorStop ? (anchorStop.lon ?? null) : null,
    });
    handleClose();
  };

  const handleDelete = () => {
    if (initialPlace && onDelete) {
      onDelete(initialPlace.id);
      handleClose();
    }
  };

  return (
    <BottomSheet
      ref={sheetRef}
      index={isEditing ? 0 : 1}
      snapPoints={['65%', '92%']}
      enableDynamicSizing={false}
      enablePanDownToClose
      onChange={(idx) => {
        console.log('[AddPlaceSheet] onChange idx:', idx);
        if (idx === -1) onClose();
      }}
      backgroundStyle={styles.sheet}
      handleIndicatorStyle={styles.handle}
    >
      <View style={styles.container}>
        {isPickingAnchor ? (
          /* Widok wyboru / wyszukiwania przystanku kotwiczenia */
          <View style={{ flex: 1 }}>
            <View style={styles.header}>
              <Pressable
                onPress={() => {
                  setIsPickingAnchor(false);
                  setAnchorQuery('');
                  setAnchorSuggestions([]);
                }}
                hitSlop={10}
                style={styles.backBtn}
              >
                <ChevronLeft size={22} color={scheme.onSurface} />
              </Pressable>
              <View style={styles.headerLeft}>
                <Text style={styles.title}>Przystanek kotwiczenia</Text>
                <Text style={styles.subtitle}>
                  Wybierz przystanek odjazdu dla: {name || 'tego miejsca'}
                </Text>
              </View>
              <Pressable
                onPress={() => {
                  setIsPickingAnchor(false);
                  setAnchorQuery('');
                  setAnchorSuggestions([]);
                }}
                hitSlop={10}
                style={styles.closeBtn}
              >
                <X size={20} color={scheme.onSurfaceVariant} />
              </Pressable>
            </View>

            <View style={styles.searchBox}>
              <Search size={18} color={scheme.onSurfaceVariant} />
              <TextInput
                value={anchorQuery}
                onChangeText={handleAnchorQueryChange}
                placeholder="Szukaj przystanku MPK…"
                placeholderTextColor={scheme.onSurfaceVariant}
                style={styles.searchInput}
                autoFocus
              />
              {searchingAnchor && <ActivityIndicator size="small" color={scheme.primary} />}
              {anchorQuery ? (
                <Pressable
                  onPress={() => {
                    setAnchorQuery('');
                    setAnchorSuggestions([]);
                  }}
                  hitSlop={10}
                  style={({ pressed }) => [pressed && { opacity: 0.7 }]}
                >
                  <X size={17} color={scheme.onSurfaceVariant} />
                </Pressable>
              ) : null}
            </View>

            {anchorSuggestions.length > 0 ? (
              <BottomSheetFlatList
                data={anchorSuggestions}
                keyExtractor={(i: Suggestion) => i.id}
                overScrollMode="never"
                keyboardShouldPersistTaps="handled"
                style={{ flex: 1, marginTop: 10 }}
                contentContainerStyle={styles.suggestionsList}
                renderItem={({ item }: { item: Suggestion }) => (
                  <SuggestionRow
                    item={item}
                    onPress={() => {
                      setAnchorStop({
                        id: item.id,
                        name: item.title,
                        lat: item.lat,
                        lon: item.lon,
                      });
                      setIsPickingAnchor(false);
                      setAnchorQuery('');
                      setAnchorSuggestions([]);
                    }}
                  />
                )}
              />
            ) : (
              <BottomSheetScrollView
                style={{ flex: 1, marginTop: 12 }}
                contentContainerStyle={styles.suggestionsList}
                keyboardShouldPersistTaps="handled"
              >
                <Text style={styles.sectionHint}>
                  {nearestStops.length > 0
                    ? 'Najbliższe przystanki wokół wybranego adresu:'
                    : 'Wpisz nazwę przystanku powyżej, aby wyszukać.'}
                </Text>
                {nearestStops.map((s) => (
                  <Pressable
                    key={s.id}
                    onPress={() => {
                      setAnchorStop({
                        id: s.id,
                        name: s.name,
                        lat: s.lat,
                        lon: s.lon,
                      });
                      setIsPickingAnchor(false);
                      setAnchorQuery('');
                      setAnchorSuggestions([]);
                    }}
                    style={({ pressed }) => [styles.nearestStopRow, pressed && { opacity: 0.7 }]}
                  >
                    <View style={styles.nearestStopIcon}>
                      <Anchor size={17} color={scheme.primary} />
                    </View>
                    <View style={{ flex: 1, gap: 2 }}>
                      <Text style={styles.nearestStopName} numberOfLines={1}>
                        {s.name}
                      </Text>
                      <Text style={styles.nearestStopDist}>
                        {s.distanceM} m od wybranego miejsca
                      </Text>
                    </View>
                    <View style={styles.selectPill}>
                      <Text style={styles.selectPillText}>Wybierz</Text>
                    </View>
                  </Pressable>
                ))}
              </BottomSheetScrollView>
            )}
          </View>
        ) : (
          /* Główny formularz lub wyszukiwanie lokalizacji */
          <>
            {/* Header */}
            <View style={styles.header}>
              <View style={styles.headerLeft}>
                <Text style={styles.title}>
                  {isEditing ? 'Edytuj miejsce' : 'Nowe zapisane miejsce'}
                </Text>
                <Text style={styles.subtitle}>
                  {isEditing ? 'Zmień nazwę, ikonę lub adres' : 'Wybierz cel i dodaj do szybkich tras'}
                </Text>
              </View>
              <Pressable
                onPress={handleClose}
                hitSlop={10}
                style={({ pressed }) => [styles.closeBtn, pressed && { opacity: 0.7 }]}
              >
                <X size={20} color={scheme.onSurfaceVariant} />
              </Pressable>
            </View>

            {/* Place Name Input */}
            <View style={styles.inputWrap}>
              <Text style={styles.fieldLabel}>Nazwa miejsca</Text>
              <TextInput
                value={name}
                onChangeText={setName}
                placeholder="np. Dom, Uczelnia, Praca, Siłownia"
                placeholderTextColor={scheme.onSurfaceVariant}
                style={styles.nameInput}
                returnKeyType="done"
              />
            </View>

            {/* Icon Picker */}
            <View style={styles.iconSection}>
              <Text style={styles.fieldLabel}>Wybierz ikonę</Text>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                overScrollMode="never"
                contentContainerStyle={styles.iconRow}
              >
                {PLACE_ICON_OPTIONS.map((item) => {
                  const IconComp = item.icon;
                  const isSelected = selectedIcon === item.key;
                  return (
                    <Pressable
                      key={item.key}
                      onPress={() => setSelectedIcon(item.key)}
                      style={({ pressed }) => [
                        styles.iconChip,
                        isSelected && styles.iconChipSelected,
                        pressed && { opacity: 0.8 },
                      ]}
                    >
                      <IconComp
                        size={20}
                        color={isSelected ? scheme.onPrimaryContainer : scheme.onSurfaceVariant}
                      />
                      <Text
                        style={[
                          styles.iconLabel,
                          isSelected && { color: scheme.onPrimaryContainer, fontWeight: '600' },
                        ]}
                      >
                        {item.label}
                      </Text>
                    </Pressable>
                  );
                })}
              </ScrollView>
            </View>

            {/* Location Section */}
            <View style={styles.locSection}>
              <Text style={styles.fieldLabel}>Adres lub przystanek</Text>
              {selectedLoc && !isChangingLoc ? (
                <View style={styles.selectedCard}>
                  <View style={styles.selectedIconWrap}>
                    <MapPin size={18} color={scheme.primary} />
                  </View>
                  <View style={styles.selectedTexts}>
                    <Text style={styles.selectedTitle} numberOfLines={1}>
                      {selectedLoc.title}
                    </Text>
                    <Text style={styles.selectedSub} numberOfLines={1}>
                      {selectedLoc.address}
                    </Text>
                  </View>
                  <Pressable
                    onPress={() => {
                      setIsChangingLoc(true);
                      setQuery('');
                      sheetRef.current?.snapToIndex(1);
                    }}
                    style={({ pressed }) => [styles.changeBtn, pressed && { opacity: 0.8 }]}
                  >
                    <Pencil size={14} color={scheme.primary} />
                    <Text style={styles.changeBtnText}>Zmień</Text>
                  </Pressable>
                </View>
              ) : (
                <View style={styles.searchBox}>
                  <Search size={18} color={scheme.onSurfaceVariant} />
                  <TextInput
                    value={query}
                    onChangeText={handleQueryChange}
                    placeholder="Wpisz ulicę, przystanek lub obiekt…"
                    placeholderTextColor={scheme.onSurfaceVariant}
                    style={styles.searchInput}
                  />
                  {searching && <ActivityIndicator size="small" color={scheme.primary} />}
                  {query ? (
                    <Pressable
                      onPress={() => setQuery('')}
                      hitSlop={10}
                      style={({ pressed }) => [pressed && { opacity: 0.7 }]}
                    >
                      <X size={17} color={scheme.onSurfaceVariant} />
                    </Pressable>
                  ) : null}
                </View>
              )}
            </View>

            {/* Search suggestions list if searching for location */}
            {isChangingLoc && suggestions.length > 0 ? (
              <BottomSheetFlatList
                data={suggestions}
                keyExtractor={(i: Suggestion) => i.id}
                overScrollMode="never"
                keyboardShouldPersistTaps="handled"
                style={{ flex: 1 }}
                contentContainerStyle={styles.suggestionsList}
                renderItem={({ item }: { item: Suggestion }) => (
                  <SuggestionRow
                    item={item}
                    onPress={() => {
                      setSelectedLoc(item);
                      setIsChangingLoc(false);
                      if (!name.trim()) setName(item.title);
                    }}
                  />
                )}
              />
            ) : !isChangingLoc ? (
              /* Zakotwiczony przystanek odjazdu */
              <View style={styles.anchorSection}>
                <View style={styles.anchorSectionHeader}>
                  <Text style={styles.fieldLabel}>Przystanek kotwiczenia (opcjonalnie)</Text>
                </View>
                {anchorStop ? (
                  <View style={styles.selectedCard}>
                    <View style={[styles.selectedIconWrap, { backgroundColor: scheme.primaryContainer }]}>
                      <Anchor size={18} color={scheme.primary} />
                    </View>
                    <View style={styles.selectedTexts}>
                      <Text style={styles.selectedTitle} numberOfLines={1}>
                        {anchorStop.name}
                      </Text>
                      <Text style={styles.selectedSub} numberOfLines={1}>
                        Odjazdy z tego przystanku, gdy jesteś blisko
                      </Text>
                    </View>
                    <Pressable
                      onPress={() => {
                        setAnchorQuery('');
                        setAnchorSuggestions([]);
                        setIsPickingAnchor(true);
                        sheetRef.current?.snapToIndex(1);
                      }}
                      style={({ pressed }) => [styles.changeBtn, pressed && { opacity: 0.8 }]}
                    >
                      <Pencil size={14} color={scheme.primary} />
                      <Text style={styles.changeBtnText}>Zmień</Text>
                    </Pressable>
                    <Pressable
                      onPress={() => setAnchorStop(null)}
                      hitSlop={8}
                      style={({ pressed }) => [styles.clearAnchorBtn, pressed && { opacity: 0.6 }]}
                    >
                      <X size={16} color={scheme.onSurfaceVariant} />
                    </Pressable>
                  </View>
                ) : (
                  <Pressable
                    onPress={() => {
                      setAnchorQuery('');
                      setAnchorSuggestions([]);
                      setIsPickingAnchor(true);
                      sheetRef.current?.snapToIndex(1);
                    }}
                    style={({ pressed }) => [styles.addAnchorBtn, pressed && { opacity: 0.8 }]}
                  >
                    <Anchor size={16} color={scheme.primary} />
                    <Text style={styles.addAnchorBtnText}>+ Przypisz przystanek odjazdu</Text>
                  </Pressable>
                )}
              </View>
            ) : null}

            {/* Action Buttons */}
            {!isChangingLoc && (
              <View style={styles.bottomActions}>
                {isEditing && confirmDelete ? (
                  /* Inline Delete Confirmation */
                  <View style={styles.confirmDeleteBox}>
                    <View style={styles.confirmDeleteTextGroup}>
                      <Trash2 size={18} color={scheme.error} />
                      <Text style={styles.confirmDeleteText}>Usunąć to miejsce?</Text>
                    </View>
                    <View style={styles.confirmDeleteBtns}>
                      <Pressable
                        onPress={() => setConfirmDelete(false)}
                        style={({ pressed }) => [styles.cancelDeleteBtn, pressed && { opacity: 0.8 }]}
                      >
                        <Text style={styles.cancelDeleteText}>Anuluj</Text>
                      </Pressable>
                      <Pressable
                        onPress={handleDelete}
                        style={({ pressed }) => [styles.confirmDeleteBtn, pressed && { opacity: 0.8 }]}
                      >
                        <Text style={styles.confirmDeleteBtnText}>Tak, usuń</Text>
                      </Pressable>
                    </View>
                  </View>
                ) : (
                  <View style={styles.mainActionRow}>
                    {isEditing && (
                      <Pressable
                        onPress={() => setConfirmDelete(true)}
                        style={({ pressed }) => [styles.deleteActionBtn, pressed && { opacity: 0.8 }]}
                      >
                        <Trash2 size={19} color={scheme.error} />
                      </Pressable>
                    )}
                    <Pressable
                      onPress={handleSave}
                      disabled={!name.trim() || !selectedLoc}
                      style={({ pressed }) => [
                        styles.saveActionBtn,
                        (!name.trim() || !selectedLoc) && styles.saveActionDisabled,
                        pressed && { opacity: 0.85 },
                      ]}
                    >
                      <Check
                        size={19}
                        color={(!name.trim() || !selectedLoc) ? scheme.onSurfaceVariant : scheme.onPrimary}
                      />
                      <Text
                        style={[
                          styles.saveActionText,
                          (!name.trim() || !selectedLoc) && styles.saveActionTextDisabled,
                        ]}
                      >
                        {isEditing ? 'Zapisz zmiany' : 'Zapisz miejsce'}
                      </Text>
                    </Pressable>
                  </View>
                )}
              </View>
            )}
          </>
        )}
      </View>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  sheet: {
    backgroundColor: scheme.surfaceContainer,
    borderTopLeftRadius: shape.extraLarge,
    borderTopRightRadius: shape.extraLarge,
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
  },
  headerLeft: {
    flex: 1,
    gap: 2,
  },
  title: {
    ...type.titleLarge,
    color: scheme.onSurface,
    fontWeight: '600',
  },
  subtitle: {
    ...type.bodySmall,
    color: scheme.onSurfaceVariant,
  },
  closeBtn: {
    width: 36,
    height: 36,
    borderRadius: shape.full,
    backgroundColor: scheme.surfaceContainerHigh,
    alignItems: 'center',
    justifyContent: 'center',
  },
  fieldLabel: {
    ...type.labelMedium,
    color: scheme.onSurfaceVariant,
    marginBottom: 6,
  },
  inputWrap: {
    marginBottom: 14,
  },
  nameInput: {
    backgroundColor: scheme.surfaceContainerHigh,
    borderRadius: shape.large,
    paddingHorizontal: 14,
    height: 50,
    ...type.bodyLarge,
    color: scheme.onSurface,
  },
  iconSection: {
    marginBottom: 14,
  },
  iconRow: {
    gap: 8,
    paddingVertical: 2,
  },
  iconChip: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: shape.large,
    backgroundColor: scheme.surfaceContainerHigh,
    minWidth: 72,
  },
  iconChipSelected: {
    backgroundColor: scheme.primaryContainer,
    borderWidth: 1.5,
    borderColor: scheme.primary,
  },
  iconLabel: {
    ...type.labelSmall,
    color: scheme.onSurfaceVariant,
  },
  locSection: {
    marginBottom: 14,
  },
  selectedCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: scheme.surfaceContainerHigh,
    borderRadius: shape.large,
    padding: 12,
    gap: 10,
  },
  selectedIconWrap: {
    width: 36,
    height: 36,
    borderRadius: shape.full,
    backgroundColor: scheme.secondaryContainer,
    alignItems: 'center',
    justifyContent: 'center',
  },
  selectedTexts: {
    flex: 1,
    gap: 2,
  },
  selectedTitle: {
    ...type.titleSmall,
    color: scheme.onSurface,
  },
  selectedSub: {
    ...type.bodySmall,
    color: scheme.onSurfaceVariant,
  },
  changeBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: scheme.secondaryContainer,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: shape.small,
  },
  changeBtnText: {
    ...type.labelSmall,
    color: scheme.primary,
    fontWeight: '600',
  },
  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: scheme.surfaceContainerHigh,
    borderRadius: shape.large,
    paddingHorizontal: 14,
    height: 50,
  },
  searchInput: {
    flex: 1,
    ...type.bodyMedium,
    color: scheme.onSurface,
  },
  suggestionsList: {
    paddingBottom: 20,
  },
  bottomActions: {
    width: '100%',
    marginTop: 16,
    paddingTop: 8,
    paddingBottom: 24,
  },
  mainActionRow: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  deleteActionBtn: {
    width: 52,
    height: 52,
    borderRadius: shape.large,
    backgroundColor: scheme.errorContainer,
    alignItems: 'center',
    justifyContent: 'center',
  },
  saveActionBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: scheme.primary,
    height: 52,
    borderRadius: shape.full,
    ...elev.level2,
  },
  saveActionDisabled: {
    backgroundColor: scheme.surfaceContainerHigh,
    elevation: 0,
  },
  saveActionText: {
    ...type.labelLarge,
    fontWeight: '700',
    color: scheme.onPrimary,
  },
  saveActionTextDisabled: {
    color: scheme.onSurfaceVariant,
  },
  // Inline Delete Confirmation
  confirmDeleteBox: {
    backgroundColor: scheme.surfaceContainerHigh,
    borderRadius: shape.large,
    borderWidth: 1,
    borderColor: scheme.error,
    padding: 12,
    gap: 12,
  },
  confirmDeleteTextGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  confirmDeleteText: {
    ...type.titleSmall,
    color: scheme.error,
    fontWeight: '600',
  },
  confirmDeleteBtns: {
    flexDirection: 'row',
    gap: 10,
  },
  cancelDeleteBtn: {
    flex: 1,
    height: 42,
    borderRadius: shape.full,
    backgroundColor: scheme.surfaceContainerHighest,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cancelDeleteText: {
    ...type.labelMedium,
    color: scheme.onSurface,
  },
  confirmDeleteBtn: {
    flex: 1,
    height: 42,
    borderRadius: shape.full,
    backgroundColor: scheme.error,
    alignItems: 'center',
    justifyContent: 'center',
  },
  confirmDeleteBtnText: {
    ...type.labelMedium,
    fontWeight: '700',
    color: scheme.onError,
  },
  // Anchor section styles
  anchorSection: {
    marginBottom: 14,
  },
  anchorSectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  addAnchorBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: scheme.surfaceContainerHigh,
    borderRadius: shape.large,
    paddingVertical: 13,
    borderWidth: 1,
    borderColor: scheme.outlineVariant,
    borderStyle: 'dashed',
  },
  addAnchorBtnText: {
    ...type.labelMedium,
    color: scheme.primary,
    fontWeight: '600',
  },
  clearAnchorBtn: {
    width: 32,
    height: 32,
    borderRadius: shape.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  backBtn: {
    width: 36,
    height: 36,
    borderRadius: shape.full,
    backgroundColor: scheme.surfaceContainerHigh,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 6,
  },
  sectionHint: {
    ...type.labelSmall,
    color: scheme.onSurfaceVariant,
    marginBottom: 10,
    marginTop: 4,
  },
  nearestStopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: scheme.outlineVariant,
  },
  nearestStopIcon: {
    width: 36,
    height: 36,
    borderRadius: shape.full,
    backgroundColor: scheme.secondaryContainer,
    alignItems: 'center',
    justifyContent: 'center',
  },
  nearestStopName: {
    ...type.titleSmall,
    color: scheme.onSurface,
  },
  nearestStopDist: {
    ...type.bodySmall,
    color: scheme.onSurfaceVariant,
  },
  selectPill: {
    backgroundColor: scheme.primaryContainer,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: shape.full,
  },
  selectPillText: {
    ...type.labelSmall,
    color: scheme.onPrimaryContainer,
    fontWeight: '600',
  },
});

