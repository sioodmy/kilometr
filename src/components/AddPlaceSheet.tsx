import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  BackHandler,
  Dimensions,
  Keyboard,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import BottomSheet, {
  BottomSheetBackdrop,
  type BottomSheetBackdropProps,
  BottomSheetFlatList,
  BottomSheetScrollView,
  BottomSheetTextInput,
  useBottomSheetSpringConfigs,
} from '@gorhom/bottom-sheet';
import Animated, {
  FadeIn,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSequence,
  withSpring,
} from 'react-native-reanimated';
// W arkuszu poziome listy wymagają ScrollView z gesture-handlera.
import { ScrollView } from 'react-native-gesture-handler';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  Anchor,
  Check,
  ChevronLeft,
  ChevronRight,
  MapPin,
  Pencil,
  Search,
  Trash2,
  TriangleAlert,
  X,
} from './icons';
import { SpringPressable } from './SpringPressable';
import { SAVED_PLACE_ICONS } from './SavedPlacesRow';
import { getSuggestionIconMeta, SuggestionRow } from './SuggestionRow';
import { motion } from '../theme/motion';
import { DesktopSheetTopSpacer, getDesktopSheetProps, useEscapeKey, useWebLayout } from '../theme/layout';
import { elev, scheme, shape, type } from '../theme/tokens';
import type { SavedPlace, SavedPlaceIcon, Suggestion } from '../types/models';
import { SearchService, fetchNearestStops, type NearestStop } from '../services';
import { getCurrentLocationSnapshot } from '../services/currentLocation';
import {
  buildQuickIcons,
  filterPlaceIcons,
  PLACE_ICON_CATALOG,
  PLACE_ICON_CATEGORY_KEYS,
  placeIconTone,
  suggestPlaceIcon,
  type PlaceIconCategory,
  type PlaceIconMeta,
} from '../services/placeIcons';
import { useStrings } from '../i18n';

type SheetView = 'form' | 'location' | 'icon' | 'anchor';

function segmentFor(index: number, total: number): 'single' | 'first' | 'middle' | 'last' {
  if (total <= 1) return 'single';
  if (index === 0) return 'first';
  if (index === total - 1) return 'last';
  return 'middle';
}

/**
 * Arkusz dodawania i edycji zapisanego miejsca w stylu M3 Expressive.
 * Automatycznie proponuje ikonę z lokalizacji/nazwy bez prefillowania pola nazwy.
 */
export function AddPlaceSheet({
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
  }) => Promise<boolean>;
  onDelete?: (id: string) => void;
}) {
  const sheetRef = useRef<BottomSheet>(null);
  const insets = useSafeAreaInsets();
  const reduceMotion = useReducedMotion();
  const webLayout = useWebLayout();
  const { width, fontScale } = useWindowDimensions();
  // Stała wysokość zapobiega przesuwaniu arkusza przez klawiaturę Androida.
  const [sheetWindowHeight] = useState(() => Dimensions.get('window').height);
  const effectiveWindowHeight = webLayout.isWeb ? webLayout.height : sheetWindowHeight;
  const desktopHeight = Math.min(effectiveWindowHeight - 96, 700);
  const sheetProps = getDesktopSheetProps(webLayout, insets.bottom, 580, desktopHeight);
  useEscapeKey(true, () => sheetRef.current?.close());
  const effectiveWidth = webLayout.isMedium ? sheetProps.innerWidth : width;
  const compact = effectiveWidth / fontScale < 330;

  // Liczba kolumn w katalogu ikon dostosowana do szerokości i rozmiaru czcionki.
  const iconColumns = Math.max(3, Math.min(4, Math.floor((effectiveWidth - 40 + 8) / (86 * Math.max(1, fontScale * 0.92)))));
  const iconGridGap = 8;
  const iconTileWidth = Math.floor((effectiveWidth - 40 - iconGridGap * (iconColumns - 1)) / iconColumns);
  const isEditing = Boolean(initialPlace);
  const s = useStrings();

  const [view, setView] = useState<SheetView>(initialPlace ? 'form' : 'location');
  const [name, setName] = useState(initialPlace?.name ?? '');
  const [nameFocused, setNameFocused] = useState(false);
  const [selectedIcon, setSelectedIcon] = useState<SavedPlaceIcon>(initialPlace?.icon ?? 'mapPin');
  const [iconPickedManually, setIconPickedManually] = useState(Boolean(initialPlace));

  const [query, setQuery] = useState('');
  const [locSearchFocused, setLocSearchFocused] = useState(false);
  const [searching, setSearching] = useState(false);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [nearbyCurrentStops, setNearbyCurrentStops] = useState<NearestStop[]>([]);
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
      : null,
  );

  const [iconQuery, setIconQuery] = useState('');
  const [iconSearchFocused, setIconSearchFocused] = useState(false);
  const [selectedIconCategory, setSelectedIconCategory] = useState<PlaceIconCategory>('all');

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
      : null,
  );
  const [anchorQuery, setAnchorQuery] = useState('');
  const [anchorSearchFocused, setAnchorSearchFocused] = useState(false);
  const [anchorSuggestions, setAnchorSuggestions] = useState<Suggestion[]>([]);
  const [nearestStops, setNearestStops] = useState<NearestStop[]>([]);
  const [searchingAnchor, setSearchingAnchor] = useState(false);

  const [confirmDelete, setConfirmDelete] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const savingRef = useRef(false);

  // Lokalny indeks odpowiada od razu; numery zapytań odrzucają stare odpowiedzi.
  const locSearchSeq = useRef(0);
  const anchorSearchSeq = useRef(0);

  // Delikatny spring na Hero Badge przy zmianie wybranej ikony.
  const badgeScale = useSharedValue(1);
  const prevIconRef = useRef<SavedPlaceIcon>(selectedIcon);
  useEffect(() => {
    if (prevIconRef.current !== selectedIcon) {
      prevIconRef.current = selectedIcon;
      if (!reduceMotion) {
        badgeScale.value = withSequence(
          withSpring(0.88, motion.spring.spatialFast),
          withSpring(1, motion.spring.spatialFast),
        );
      }
    }
  }, [badgeScale, reduceMotion, selectedIcon]);

  const heroBadgeAnimStyle = useAnimatedStyle(() => ({
    transform: [{ scale: badgeScale.value }],
  }));

  useEffect(() => {
    return () => {
      ++locSearchSeq.current;
      ++anchorSearchSeq.current;
      SearchService.cancel('add-place-address');
      SearchService.cancel('add-place-anchor');
    };
  }, []);

  // Przystanki wokół obecnej pozycji GPS jako punkt startowy przy wyborze adresu.
  useEffect(() => {
    if (view !== 'location') return;
    const snap = getCurrentLocationSnapshot();
    if (snap.state !== 'ok' || !snap.location) return;
    let live = true;
    fetchNearestStops(snap.location.lat, snap.location.lon, 5)
      .then((stops) => {
        if (live) setNearbyCurrentStops(stops);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [view]);

  // Automatyczna propozycja ikony z wpisanej nazwy lub wybranej lokalizacji.
  const iconSuggestion = useMemo(
    () => suggestPlaceIcon({ name, location: selectedLoc }),
    [name, selectedLoc],
  );

  useEffect(() => {
    if (iconPickedManually) return;
    const nextIcon: SavedPlaceIcon = iconSuggestion?.icon ?? 'mapPin';
    setSelectedIcon(nextIcon);
  }, [iconPickedManually, iconSuggestion]);

  const isAutoSuggestedIcon = !iconPickedManually && Boolean(iconSuggestion);

  const iconCategories = useMemo(
    () => PLACE_ICON_CATEGORY_KEYS.map((key) => ({ key, label: s.places.iconCategories[key] })),
    [s.places.iconCategories],
  );

  const quickIconKeys = useMemo(
    () => buildQuickIcons(selectedIcon, iconSuggestion?.icon ?? null),
    [selectedIcon, iconSuggestion?.icon],
  );

  const filteredCatalogIcons = useMemo(
    () => filterPlaceIcons(iconQuery, selectedIconCategory, s.places.iconName),
    [iconQuery, selectedIconCategory, s.places.iconName],
  );

  // Szybkie podpowiedzi nazwy wyświetlane tylko gdy pole jest puste (bez prefillu!).
  const quickNameChips = useMemo(() => {
    if (name.trim() || !selectedLoc) return [];
    const chips: string[] = [];
    const addUnique = (label: string) => {
      const clean = label.trim();
      if (!clean) return;
      if (chips.some((c) => c.toLowerCase() === clean.toLowerCase())) return;
      chips.push(clean);
    };
    if (selectedLoc.kind !== 'address' && selectedLoc.title.trim()) {
      addUnique(selectedLoc.title);
    }
    addUnique(s.places.iconName.home);
    addUnique(s.places.iconName.work);
    if (selectedLoc.kind === 'address') {
      addUnique(s.places.iconName.university);
      addUnique(s.places.iconName.gym);
    }
    return chips.slice(0, 4);
  }, [name, selectedLoc, s.places.iconName]);

  const snapPoints = useMemo(
    () => (webLayout.isMedium ? [desktopHeight] : ['84%', '96%']),
    [desktopHeight, webLayout.isMedium],
  );
  const animationConfigs = useBottomSheetSpringConfigs(motion.sheet);
  const renderBackdrop = useCallback(
    (props: BottomSheetBackdropProps) => (
      <BottomSheetBackdrop
        {...props}
        appearsOnIndex={0}
        disappearsOnIndex={-1}
        opacity={0.54}
        pressBehavior="close"
        accessibilityLabel={s.common.close}
      />
    ),
    [s.common.close],
  );

  // Android back / gest wstecz.
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (view === 'icon') {
        Keyboard.dismiss();
        setView('form');
        setIconQuery('');
        return true;
      }
      if (view === 'anchor') {
        Keyboard.dismiss();
        setView('form');
        setAnchorQuery('');
        setAnchorSuggestions([]);
        return true;
      }
      if (view === 'location' && selectedLoc) {
        Keyboard.dismiss();
        setView('form');
        setQuery('');
        setSuggestions([]);
        return true;
      }
      if (confirmDelete) {
        setConfirmDelete(false);
        return true;
      }
      sheetRef.current?.close();
      return true;
    });
    return () => sub.remove();
  }, [confirmDelete, selectedLoc, view]);

  // Gdy zmienia się lokalizacja miejsca, pobierz najbliższe przystanki pod kotwicę.
  useEffect(() => {
    let live = true;
    if (selectedLoc) {
      fetchNearestStops(selectedLoc.lat, selectedLoc.lon, 6)
        .then((stops) => {
          if (live) setNearestStops(stops);
        })
        .catch(() => {});
      if (selectedLoc.kind === 'stop' && !anchorStop) {
        setAnchorStop({
          id: selectedLoc.id,
          name: selectedLoc.title,
          lat: selectedLoc.lat,
          lon: selectedLoc.lon,
        });
      }
    }
    return () => {
      live = false;
    };
  }, [selectedLoc?.id]);

  const handleClose = useCallback(() => {
    Keyboard.dismiss();
    sheetRef.current?.close();
  }, []);

  const handleSelectLocation = useCallback((item: Suggestion) => {
    Keyboard.dismiss();
    setSelectedLoc(item);
    setView('form');
    setQuery('');
    setSuggestions([]);
    // Celowo nie prefillujemy pola nazwy: użytkownik sam nazywa miejsce albo wybiera 1-tapowy chip.
  }, []);

  const handlePickIcon = useCallback((key: SavedPlaceIcon, closePicker: boolean) => {
    setSelectedIcon(key);
    setIconPickedManually(true);
    if (closePicker) {
      Keyboard.dismiss();
      setView('form');
      setIconQuery('');
    }
  }, []);

  const handleQueryChange = useCallback((text: string) => {
    setQuery(text);
    SearchService.cancel('add-place-address');
    const seq = ++locSearchSeq.current;
    if (!text.trim()) {
      setSuggestions([]);
      setSearching(false);
      return;
    }
    setSearching(true);
    const snap = getCurrentLocationSnapshot();
    const coords =
      snap.state === 'ok' && snap.location
        ? { lat: snap.location.lat, lon: snap.location.lon }
        : undefined;
    SearchService.search(text, coords, 'add-place-address', (partial) => {
      if (seq === locSearchSeq.current) setSuggestions(partial);
    })
      .then((res) => {
        if (seq !== locSearchSeq.current) return;
        setSuggestions(res);
      })
      .catch(() => {
        if (seq === locSearchSeq.current) setSuggestions([]);
      })
      .finally(() => {
        if (seq === locSearchSeq.current) setSearching(false);
      });
  }, []);

  const handleAnchorQueryChange = useCallback(
    (text: string) => {
      setAnchorQuery(text);
      SearchService.cancel('add-place-anchor');
      const seq = ++anchorSearchSeq.current;
      if (!text.trim()) {
        setAnchorSuggestions([]);
        setSearchingAnchor(false);
        return;
      }
      setSearchingAnchor(true);
      SearchService.search(
        text,
        selectedLoc ? { lat: selectedLoc.lat, lon: selectedLoc.lon } : undefined,
        'add-place-anchor',
        (partial) => {
          if (seq === anchorSearchSeq.current) setAnchorSuggestions(partial);
        },
      )
        .then((res) => {
          if (seq !== anchorSearchSeq.current) return;
          setAnchorSuggestions(res);
        })
        .catch(() => {
          if (seq === anchorSearchSeq.current) setAnchorSuggestions([]);
        })
        .finally(() => {
          if (seq === anchorSearchSeq.current) setSearchingAnchor(false);
        });
    },
    [selectedLoc],
  );

  const handleSave = async () => {
    if (savingRef.current || !name.trim() || !selectedLoc) return;
    Keyboard.dismiss();
    savingRef.current = true;
    setSaving(true);
    setSaveError(null);
    let saved = false;
    try {
      saved = await onSave({
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
      if (saved) {
        handleClose();
      } else {
        setSaveError(s.places.saveFail);
      }
    } catch {
      setSaveError(s.places.saveFail);
    } finally {
      if (!saved) {
        savingRef.current = false;
        setSaving(false);
      }
    }
  };

  const handleDelete = () => {
    if (initialPlace && onDelete) {
      onDelete(initialPlace.id);
      handleClose();
    }
  };

  const SelectedIconComp = SAVED_PLACE_ICONS[selectedIcon] ?? MapPin;
  const selectedTone = placeIconTone(selectedIcon);
  const selectedIconLabel = s.places.iconName[selectedIcon] ?? s.places.iconName.mapPin;
  const canSave = Boolean(name.trim() && selectedLoc && !saving);
  const locIconMeta = selectedLoc ? getSuggestionIconMeta(selectedLoc) : null;
  const LocIconComp = locIconMeta?.Icon ?? MapPin;

  const viewEntering = reduceMotion ? undefined : FadeIn.duration(160);

  return (
    <View
      pointerEvents="box-none"
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        height: effectiveWindowHeight,
      }}
    >
      <BottomSheet
        ref={sheetRef}
        index={webLayout.isMedium ? 0 : 1}
        snapPoints={snapPoints}
        animationConfigs={animationConfigs}
        topInset={insets.top}
        bottomInset={sheetProps.bottomInset}
        detached={sheetProps.detached}
        style={sheetProps.sheetStyle}
        enableDynamicSizing={false}
        enablePanDownToClose={!webLayout.isMedium}
        android_keyboardInputMode="adjustPan"
        keyboardBehavior="extend"
        onChange={(idx) => {
          if (idx === -1) onClose();
        }}
        backdropComponent={renderBackdrop}
        backgroundStyle={[styles.sheet, sheetProps.backgroundExtraStyle]}
        handleComponent={webLayout.isMedium ? DesktopSheetTopSpacer : undefined}
        handleIndicatorStyle={styles.handle}
      >
        <View style={styles.container} accessibilityViewIsModal>
          {view === 'icon' ? (
            <Animated.View key="icon" entering={viewEntering} style={styles.viewFill}>
              <View style={styles.header}>
                <SpringPressable
                  onPress={() => {
                    Keyboard.dismiss();
                    setView('form');
                    setIconQuery('');
                  }}
                  haptic="selection"
                  style={styles.roundNavBtn}
                  accessibilityRole="button"
                  accessibilityLabel={s.map.backA11y}
                >
                  <ChevronLeft size={22} color={scheme.onSurface} />
                </SpringPressable>
                <View style={styles.headerLeft}>
                  <Text style={styles.title} accessibilityRole="header">
                    {s.places.chooseIcon}
                  </Text>
                  <Text style={styles.subtitle} numberOfLines={1}>
                    {s.places.iconFor(name.trim() || selectedLoc?.title || s.places.iconForFallback)}
                  </Text>
                </View>
                <View
                  style={[styles.headerPreviewBadge, { backgroundColor: scheme[selectedTone.bg] }]}
                  accessible={false}
                >
                  <SelectedIconComp size={20} color={scheme[selectedTone.fg]} />
                </View>
              </View>

              <View style={[styles.searchPill, iconSearchFocused && styles.inputFocused]}>
                <Search size={18} color={scheme.onSurfaceVariant} />
                <BottomSheetTextInput
                  value={iconQuery}
                  onChangeText={setIconQuery}
                  onFocus={() => setIconSearchFocused(true)}
                  onBlur={() => setIconSearchFocused(false)}
                  placeholder={s.places.searchIcon}
                  accessibilityLabel={s.places.searchIcon}
                  placeholderTextColor={scheme.onSurfaceVariant}
                  style={styles.searchInput}
                  returnKeyType="search"
                />
                {iconQuery ? (
                  <Pressable
                    onPress={() => setIconQuery('')}
                    style={styles.clearBtn}
                    accessibilityRole="button"
                    accessibilityLabel={s.search.clearA11y}
                  >
                    <X size={18} color={scheme.onSurfaceVariant} />
                  </Pressable>
                ) : null}
              </View>

              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                nestedScrollEnabled
                overScrollMode="never"
                style={styles.categoryScroll}
                contentContainerStyle={styles.categoryRow}
              >
                {iconCategories.map((cat) => {
                  const active = selectedIconCategory === cat.key;
                  return (
                    <SpringPressable
                      key={cat.key}
                      onPress={() => setSelectedIconCategory(cat.key)}
                      haptic="selection"
                      accessibilityRole="button"
                      accessibilityState={{ selected: active }}
                      style={[styles.categoryChip, active && styles.categoryChipActive]}
                    >
                      {active ? <Check size={15} color={scheme.onSecondaryContainer} /> : null}
                      <Text
                        style={[styles.categoryChipText, active && styles.categoryChipTextActive]}
                      >
                        {cat.label}
                      </Text>
                    </SpringPressable>
                  );
                })}
              </ScrollView>

              <BottomSheetFlatList
                key={iconColumns}
                data={filteredCatalogIcons}
                numColumns={iconColumns}
                keyExtractor={(item: PlaceIconMeta) => item.key}
                keyboardShouldPersistTaps="handled"
                overScrollMode="never"
                columnWrapperStyle={styles.iconGridRow}
                contentContainerStyle={styles.iconGridContent}
                ListHeaderComponent={
                  !iconQuery.trim() && selectedIconCategory === 'all' && iconSuggestion ? (
                    (() => {
                      const sugKey = iconSuggestion.icon;
                      const SugIcon = SAVED_PLACE_ICONS[sugKey] ?? MapPin;
                      const sugTone = placeIconTone(sugKey);
                      const sugLabel = s.places.iconName[sugKey] ?? sugKey;
                      const isCurrent = selectedIcon === sugKey;
                      return (
                        <SpringPressable
                          onPress={() => handlePickIcon(sugKey, true)}
                          haptic="selection"
                          accessibilityRole="button"
                          accessibilityLabel={`${s.places.suggestedIconTitle}: ${sugLabel}`}
                          accessibilityState={{ selected: isCurrent }}
                          style={[styles.suggestedBanner, isCurrent && styles.suggestedBannerActive]}
                        >
                          <View style={[styles.suggestedLeaf, { backgroundColor: scheme[sugTone.bg] }]}>
                            <SugIcon size={22} color={scheme[sugTone.fg]} />
                          </View>
                          <View style={styles.suggestedBannerTexts}>
                            <Text style={styles.suggestedBannerEyebrow}>
                              {s.places.suggestedIconTitle}
                            </Text>
                            <Text style={styles.suggestedBannerName}>{sugLabel}</Text>
                          </View>
                          <View
                            style={[
                              styles.suggestedBannerPill,
                              isCurrent && styles.suggestedBannerPillActive,
                            ]}
                          >
                            {isCurrent ? (
                              <Check size={16} color={scheme.onPrimary} />
                            ) : (
                              <Text style={styles.suggestedBannerPillText}>{s.places.choose}</Text>
                            )}
                          </View>
                        </SpringPressable>
                      );
                    })()
                  ) : null
                }
                ListEmptyComponent={
                  <View style={styles.emptyStateBox}>
                    <View style={styles.emptyStateIcon}>
                      <Search size={22} color={scheme.onSurfaceVariant} />
                    </View>
                    <Text style={styles.emptyStateText}>
                      {s.search.noResultsFor(iconQuery.trim())}
                    </Text>
                    <SpringPressable
                      onPress={() => {
                        setIconQuery('');
                        setSelectedIconCategory('all');
                      }}
                      haptic="selection"
                      accessibilityRole="button"
                      style={styles.emptyStateBtn}
                    >
                      <Text style={styles.emptyStateBtnText}>{s.places.clearSearch}</Text>
                    </SpringPressable>
                  </View>
                }
                renderItem={({ item }: { item: PlaceIconMeta }) => {
                  const IconComp = SAVED_PLACE_ICONS[item.key] ?? MapPin;
                  const tone = placeIconTone(item.key);
                  const label = s.places.iconName[item.key] ?? item.key;
                  const isSelected = selectedIcon === item.key;
                  return (
                    <SpringPressable
                      onPress={() => handlePickIcon(item.key, true)}
                      haptic="selection"
                      accessibilityRole="button"
                      accessibilityLabel={label}
                      accessibilityState={{ selected: isSelected }}
                      style={[
                        styles.gridTile,
                        { width: iconTileWidth },
                        isSelected && {
                          backgroundColor: scheme[tone.bg],
                          borderColor: scheme.primary,
                          borderWidth: 1.5,
                        },
                      ]}
                    >
                      {isSelected ? (
                        <View style={styles.gridCheckBadge}>
                          <Check size={12} color={scheme.onPrimary} />
                        </View>
                      ) : null}
                      <View
                        style={[
                          styles.gridIconCircle,
                          isSelected
                            ? styles.gridIconLeafSelected
                            : { backgroundColor: scheme.surfaceContainerHigh },
                        ]}
                      >
                        <IconComp
                          size={isSelected ? 26 : 22}
                          color={isSelected ? scheme[tone.fg] : scheme.onSurface}
                        />
                      </View>
                      <Text
                        numberOfLines={2}
                        style={[
                          styles.gridTileLabel,
                          isSelected && { color: scheme[tone.fg], fontWeight: '700' },
                        ]}
                      >
                        {label}
                      </Text>
                    </SpringPressable>
                  );
                }}
              />
            </Animated.View>
          ) : view === 'anchor' ? (
            <Animated.View key="anchor" entering={viewEntering} style={styles.viewFill}>
              <View style={styles.header}>
                <SpringPressable
                  onPress={() => {
                    Keyboard.dismiss();
                    setView('form');
                    setAnchorQuery('');
                    setAnchorSuggestions([]);
                  }}
                  haptic="selection"
                  style={styles.roundNavBtn}
                  accessibilityRole="button"
                  accessibilityLabel={s.map.backA11y}
                >
                  <ChevronLeft size={22} color={scheme.onSurface} />
                </SpringPressable>
                <View style={styles.headerLeft}>
                  <Text style={styles.title} accessibilityRole="header">
                    {s.places.anchorTitle}
                  </Text>
                  <Text style={styles.subtitle} numberOfLines={1}>
                    {s.places.anchorFor(name.trim() || selectedLoc?.title || s.places.iconForFallback)}
                  </Text>
                </View>
              </View>

              <View style={[styles.searchPill, anchorSearchFocused && styles.inputFocused]}>
                <Search size={18} color={scheme.onSurfaceVariant} />
                <BottomSheetTextInput
                  value={anchorQuery}
                  onChangeText={handleAnchorQueryChange}
                  onFocus={() => setAnchorSearchFocused(true)}
                  onBlur={() => setAnchorSearchFocused(false)}
                  placeholder={s.places.searchStop}
                  accessibilityLabel={s.places.searchStop}
                  placeholderTextColor={scheme.onSurfaceVariant}
                  style={styles.searchInput}
                  returnKeyType="search"
                />
                {searchingAnchor ? <ActivityIndicator size="small" color={scheme.primary} /> : null}
                {anchorQuery ? (
                  <Pressable
                    onPress={() => {
                      setAnchorQuery('');
                      setAnchorSuggestions([]);
                    }}
                    accessibilityRole="button"
                    accessibilityLabel={s.search.clearA11y}
                    style={styles.clearBtn}
                  >
                    <X size={18} color={scheme.onSurfaceVariant} />
                  </Pressable>
                ) : null}
              </View>

              {anchorSuggestions.length > 0 ? (
                <BottomSheetFlatList
                  data={anchorSuggestions}
                  keyExtractor={(i: Suggestion) => i.id}
                  overScrollMode="never"
                  keyboardShouldPersistTaps="handled"
                  style={styles.listSpacing}
                  contentContainerStyle={styles.suggestionsList}
                  renderItem={({ item, index }: { item: Suggestion; index: number }) => (
                    <SuggestionRow
                      item={item}
                      query={anchorQuery}
                      segment={segmentFor(index, anchorSuggestions.length)}
                      onPress={() => {
                        Keyboard.dismiss();
                        setAnchorStop({
                          id: item.id,
                          name: item.title,
                          lat: item.lat,
                          lon: item.lon,
                        });
                        setView('form');
                        setAnchorQuery('');
                        setAnchorSuggestions([]);
                      }}
                    />
                  )}
                />
              ) : anchorQuery.trim().length >= 2 && !searchingAnchor ? (
                <View style={styles.emptyStateBox}>
                  <Text style={styles.emptyStateText} accessibilityRole="alert">
                    {s.search.noResultsFor(anchorQuery.trim())}
                  </Text>
                </View>
              ) : (
                <BottomSheetScrollView
                  style={styles.listSpacing}
                  contentContainerStyle={styles.suggestionsList}
                  keyboardShouldPersistTaps="handled"
                  overScrollMode="never"
                >
                  <Text style={styles.sectionCaption}>
                    {nearestStops.length > 0 ? s.places.nearStops : s.places.typeStopAbove}
                  </Text>
                  <View style={styles.segmentGroup}>
                    {nearestStops.map((stop, idx) => {
                      const seg = segmentFor(idx, nearestStops.length);
                      const isCurrent = anchorStop?.id === stop.id;
                      return (
                        <SpringPressable
                          key={stop.id}
                          onPress={() => {
                            Keyboard.dismiss();
                            setAnchorStop({
                              id: stop.id,
                              name: stop.name,
                              lat: stop.lat,
                              lon: stop.lon,
                            });
                            setView('form');
                            setAnchorQuery('');
                            setAnchorSuggestions([]);
                          }}
                          haptic="selection"
                          accessibilityRole="button"
                          style={[
                            styles.stopOptionRow,
                            (seg === 'first' || seg === 'single') && styles.segmentTop,
                            (seg === 'last' || seg === 'single') && styles.segmentBottom,
                            isCurrent && styles.stopOptionRowActive,
                          ]}
                        >
                          <View style={styles.stopOptionIcon}>
                            <Anchor size={18} color={scheme.onTertiaryContainer} />
                          </View>
                          <View style={styles.stopOptionTexts}>
                            <Text style={styles.stopOptionName} numberOfLines={1}>
                              {stop.name}
                            </Text>
                            <Text style={styles.stopOptionDist}>
                              {s.places.metersAway(stop.distanceM)}
                            </Text>
                          </View>
                          <View style={[styles.tonalPill, isCurrent && styles.tonalPillActive]}>
                            <Text
                              style={[
                                styles.tonalPillText,
                                isCurrent && styles.tonalPillTextActive,
                              ]}
                            >
                              {s.places.choose}
                            </Text>
                          </View>
                        </SpringPressable>
                      );
                    })}
                  </View>
                </BottomSheetScrollView>
              )}
            </Animated.View>
          ) : view === 'location' ? (
            <Animated.View key="location" entering={viewEntering} style={styles.viewFill}>
              <View style={styles.header}>
                {selectedLoc ? (
                  <SpringPressable
                    onPress={() => {
                      Keyboard.dismiss();
                      setView('form');
                      setQuery('');
                      setSuggestions([]);
                    }}
                    haptic="selection"
                    style={styles.roundNavBtn}
                    accessibilityRole="button"
                    accessibilityLabel={s.map.backA11y}
                  >
                    <ChevronLeft size={22} color={scheme.onSurface} />
                  </SpringPressable>
                ) : null}
                <View style={styles.headerLeft}>
                  <Text style={styles.title} accessibilityRole="header">
                    {isEditing ? s.places.editPlace : s.places.newPlace}
                  </Text>
                  <Text style={styles.subtitle}>{s.places.chooseTarget}</Text>
                </View>
                <SpringPressable
                  onPress={handleClose}
                  haptic="selection"
                  style={styles.roundNavBtn}
                  accessibilityRole="button"
                  accessibilityLabel={s.common.close}
                >
                  <X size={20} color={scheme.onSurfaceVariant} />
                </SpringPressable>
              </View>

              <View style={[styles.searchPill, locSearchFocused && styles.inputFocused]}>
                <Search size={18} color={scheme.onSurfaceVariant} />
                <BottomSheetTextInput
                  value={query}
                  onChangeText={handleQueryChange}
                  onFocus={() => setLocSearchFocused(true)}
                  onBlur={() => setLocSearchFocused(false)}
                  placeholder={s.places.queryHint}
                  accessibilityLabel={s.places.addressLabel}
                  placeholderTextColor={scheme.onSurfaceVariant}
                  style={styles.searchInput}
                  autoFocus
                  returnKeyType="search"
                />
                {searching ? <ActivityIndicator size="small" color={scheme.primary} /> : null}
                {query ? (
                  <Pressable
                    onPress={() => handleQueryChange('')}
                    style={styles.clearBtn}
                    accessibilityRole="button"
                    accessibilityLabel={s.search.clearA11y}
                  >
                    <X size={18} color={scheme.onSurfaceVariant} />
                  </Pressable>
                ) : null}
              </View>

              {query.trim().length >= 2 && !searching && suggestions.length === 0 ? (
                <View style={styles.emptyStateBox}>
                  <View style={styles.emptyStateIcon}>
                    <Search size={22} color={scheme.onSurfaceVariant} />
                  </View>
                  <Text style={styles.emptyStateText} accessibilityRole="alert">
                    {s.search.noResultsFor(query.trim())}
                  </Text>
                </View>
              ) : query.trim().length > 0 ? (
                <BottomSheetFlatList
                  data={suggestions}
                  keyExtractor={(i: Suggestion) => i.id}
                  overScrollMode="never"
                  keyboardShouldPersistTaps="handled"
                  style={styles.listSpacing}
                  contentContainerStyle={styles.suggestionsList}
                  renderItem={({ item, index }: { item: Suggestion; index: number }) => (
                    <SuggestionRow
                      item={item}
                      query={query}
                      segment={segmentFor(index, suggestions.length)}
                      onPress={() => handleSelectLocation(item)}
                    />
                  )}
                />
              ) : (
                <BottomSheetScrollView
                  style={styles.listSpacing}
                  contentContainerStyle={styles.suggestionsList}
                  keyboardShouldPersistTaps="handled"
                  overScrollMode="never"
                >
                  {nearbyCurrentStops.length > 0 ? (
                    <>
                      <Text style={styles.sectionCaption}>{s.places.nearbyStopsTitle}</Text>
                      <View style={styles.segmentGroup}>
                        {nearbyCurrentStops.map((stop, idx) => (
                          <SuggestionRow
                            key={stop.id}
                            segment={segmentFor(idx, nearbyCurrentStops.length)}
                            item={{
                              id: stop.id,
                              title: stop.name,
                              address: s.suggestion.stopFallback,
                              lat: stop.lat,
                              lon: stop.lon,
                              kind: 'stop',
                              distanceM: stop.distanceM,
                            }}
                            onPress={() =>
                              handleSelectLocation({
                                id: stop.id,
                                title: stop.name,
                                address: s.suggestion.stopFallback,
                                lat: stop.lat,
                                lon: stop.lon,
                                kind: 'stop',
                                distanceM: stop.distanceM,
                              })
                            }
                          />
                        ))}
                      </View>
                    </>
                  ) : (
                    <View style={styles.promptHintBox}>
                      <View style={styles.promptHintIcon}>
                        <MapPin size={22} color={scheme.onPrimaryContainer} />
                      </View>
                      <Text style={styles.promptHintText}>{s.places.searchPromptHint}</Text>
                    </View>
                  )}
                </BottomSheetScrollView>
              )}
            </Animated.View>
          ) : (
            <Animated.View key="form" entering={viewEntering} style={styles.viewFill}>
              <View style={styles.header}>
                <View style={styles.headerLeft}>
                  <Text style={styles.title} accessibilityRole="header">
                    {isEditing ? s.places.editPlace : s.places.newPlace}
                  </Text>
                  <Text style={styles.subtitle}>
                    {isEditing ? s.places.editHint : s.places.newHint}
                  </Text>
                </View>
                <SpringPressable
                  onPress={handleClose}
                  haptic="selection"
                  style={styles.roundNavBtn}
                  accessibilityRole="button"
                  accessibilityLabel={s.common.close}
                >
                  <X size={20} color={scheme.onSurfaceVariant} />
                </SpringPressable>
              </View>

              <BottomSheetScrollView
                showsVerticalScrollIndicator={false}
                keyboardShouldPersistTaps="handled"
                overScrollMode="never"
                style={styles.formScroll}
                contentContainerStyle={styles.formScrollContent}
              >
                {/* Karta tożsamości: liściasty badge ikony + pole nazwy bez prefillu */}
                <View style={styles.identityCard}>
                  <View style={[styles.identityTopRow, compact && styles.identityTopRowCompact]}>
                    <SpringPressable
                      onPress={() => {
                        Keyboard.dismiss();
                        setView('icon');
                        sheetRef.current?.snapToIndex(1);
                      }}
                      haptic="selection"
                      accessibilityRole="button"
                      accessibilityLabel={s.places.changeIconA11y(selectedIconLabel)}
                      style={styles.heroBadgeTrigger}
                    >
                      <Animated.View
                        style={[
                          styles.heroIconLeaf,
                          { backgroundColor: scheme[selectedTone.bg] },
                          heroBadgeAnimStyle,
                        ]}
                      >
                        <SelectedIconComp size={30} color={scheme[selectedTone.fg]} />
                      </Animated.View>
                      <View style={styles.heroEditPip}>
                        <Pencil size={11} color={scheme.onSurface} />
                      </View>
                    </SpringPressable>

                    <View style={styles.nameColumn}>
                      <Text style={styles.inlineFieldLabel}>{s.places.nameLabel}</Text>
                      <View style={[styles.nameInputBox, nameFocused && styles.inputFocused]}>
                        <BottomSheetTextInput
                          value={name}
                          onChangeText={setName}
                          onFocus={() => setNameFocused(true)}
                          onBlur={() => setNameFocused(false)}
                          placeholder={s.places.nameHint}
                          accessibilityLabel={s.places.nameLabel}
                          placeholderTextColor={scheme.onSurfaceVariant}
                          style={styles.nameInput}
                          returnKeyType="done"
                        />
                        {name.length > 0 ? (
                          <Pressable
                            onPress={() => setName('')}
                            style={styles.nameClearBtn}
                            accessibilityRole="button"
                            accessibilityLabel={s.search.clearA11y}
                          >
                            <X size={16} color={scheme.onSurfaceVariant} />
                          </Pressable>
                        ) : null}
                      </View>
                    </View>
                  </View>

                  {quickNameChips.length > 0 ? (
                    <ScrollView
                      horizontal
                      showsHorizontalScrollIndicator={false}
                      nestedScrollEnabled
                      overScrollMode="never"
                      style={styles.quickNamesScroll}
                      contentContainerStyle={styles.quickNamesRow}
                    >
                      {quickNameChips.map((chip) => (
                        <SpringPressable
                          key={chip}
                          onPress={() => setName(chip)}
                          haptic="selection"
                          accessibilityRole="button"
                          accessibilityLabel={s.places.quickNameA11y(chip)}
                          style={styles.quickNameChip}
                        >
                          <Text style={styles.quickNameChipText} numberOfLines={1}>
                            {chip}
                          </Text>
                        </SpringPressable>
                      ))}
                    </ScrollView>
                  ) : null}
                </View>

                {/* Szybki pasek ekspresyjnych kafli ikony + wejście do pełnego katalogu */}
                <View style={styles.iconDockSection}>
                  <View style={styles.sectionHeaderRow}>
                    <View style={styles.sectionHeaderTexts}>
                      <Text style={styles.sectionTitle}>{s.places.chooseIcon}</Text>
                      {isAutoSuggestedIcon ? (
                        <Text style={styles.autoHintText}>{s.places.autoPickedIcon}</Text>
                      ) : null}
                    </View>
                    <SpringPressable
                      onPress={() => {
                        Keyboard.dismiss();
                        setView('icon');
                        sheetRef.current?.snapToIndex(1);
                      }}
                      haptic="selection"
                      accessibilityRole="button"
                      style={styles.allIconsPill}
                    >
                      <Text style={styles.allIconsPillText}>
                        {s.places.allIcons(PLACE_ICON_CATALOG.length)}
                      </Text>
                      <ChevronRight size={16} color={scheme.onSecondaryContainer} />
                    </SpringPressable>
                  </View>

                  <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    nestedScrollEnabled
                    overScrollMode="never"
                    style={styles.quickIconsScroll}
                    contentContainerStyle={styles.quickIconsRow}
                  >
                    {quickIconKeys.map((key) => {
                      const IconComp = SAVED_PLACE_ICONS[key] ?? MapPin;
                      const tone = placeIconTone(key);
                      const label = s.places.iconName[key] ?? key;
                      const isSelected = selectedIcon === key;
                      return (
                        <SpringPressable
                          key={key}
                          onPress={() => handlePickIcon(key, false)}
                          haptic="selection"
                          accessibilityRole="button"
                          accessibilityLabel={label}
                          accessibilityState={{ selected: isSelected }}
                          style={styles.quickIconTile}
                        >
                          <View style={styles.quickIconBoxWrap}>
                            <View
                              style={[
                                styles.quickIconBox,
                                isSelected
                                  ? [
                                      styles.quickIconBoxSelected,
                                      { backgroundColor: scheme[tone.bg] },
                                    ]
                                  : null,
                              ]}
                            >
                              <IconComp
                                size={22}
                                color={isSelected ? scheme[tone.fg] : scheme.onSurfaceVariant}
                              />
                            </View>
                            {isSelected ? (
                              <View style={styles.quickCheckBadge}>
                                <Check size={11} color={scheme.onPrimary} />
                              </View>
                            ) : null}
                          </View>
                          <Text
                            numberOfLines={1}
                            style={[
                              styles.quickIconLabel,
                              isSelected && styles.quickIconLabelSelected,
                            ]}
                          >
                            {label}
                          </Text>
                        </SpringPressable>
                      );
                    })}

                    <SpringPressable
                      onPress={() => {
                        Keyboard.dismiss();
                        setView('icon');
                        sheetRef.current?.snapToIndex(1);
                      }}
                      haptic="selection"
                      accessibilityRole="button"
                      accessibilityLabel={s.places.allIcons(PLACE_ICON_CATALOG.length)}
                      style={styles.quickIconTile}
                    >
                      <View style={styles.quickIconBoxWrap}>
                        <View style={[styles.quickIconBox, styles.quickIconBoxMore]}>
                          <Search size={20} color={scheme.onSecondaryContainer} />
                        </View>
                      </View>
                      <Text numberOfLines={1} style={styles.quickIconLabel}>
                        {s.places.moreShort}
                      </Text>
                    </SpringPressable>
                  </ScrollView>
                </View>

                {/* Zgrupowana sekcja M3 Expressive: Lokalizacja + Preferowany przystanek */}
                {selectedLoc ? (
                  <View style={styles.segmentGroup}>
                    <View
                      style={[
                        styles.groupedCard,
                        styles.segmentTop,
                        compact && styles.groupedCardCompact,
                      ]}
                    >
                      <View
                        style={[
                          styles.rowIconBadge,
                          { backgroundColor: locIconMeta?.bg ?? scheme.secondaryContainer },
                        ]}
                      >
                        <LocIconComp
                          size={19}
                          color={locIconMeta?.fg ?? scheme.onSecondaryContainer}
                        />
                      </View>
                      <View style={styles.groupedTexts}>
                        <Text style={styles.groupedEyebrow}>{s.places.addressLabel}</Text>
                        <Text
                          style={styles.groupedTitle}
                          numberOfLines={fontScale > 1.3 ? undefined : 2}
                        >
                          {selectedLoc.title}
                        </Text>
                        {selectedLoc.address && selectedLoc.address !== selectedLoc.title ? (
                          <Text
                            style={styles.groupedSub}
                            numberOfLines={fontScale > 1.3 ? undefined : 2}
                          >
                            {selectedLoc.address}
                          </Text>
                        ) : null}
                      </View>
                      <SpringPressable
                        onPress={() => {
                          Keyboard.dismiss();
                          setView('location');
                          setQuery('');
                          setSuggestions([]);
                          sheetRef.current?.snapToIndex(1);
                        }}
                        haptic="selection"
                        style={styles.tonalActionBtn}
                        accessibilityRole="button"
                      >
                        <Text style={styles.tonalActionText}>{s.places.changeBtn}</Text>
                      </SpringPressable>
                    </View>

                    {anchorStop ? (
                      <View
                        style={[
                          styles.groupedCard,
                          styles.segmentBottom,
                          compact && styles.groupedCardCompact,
                        ]}
                      >
                        <View
                          style={[
                            styles.rowIconBadge,
                            { backgroundColor: scheme.tertiaryContainer },
                          ]}
                        >
                          <Anchor size={19} color={scheme.onTertiaryContainer} />
                        </View>
                        <View style={styles.groupedTexts}>
                          <Text style={styles.groupedEyebrow}>{s.places.anchorOptional}</Text>
                          <Text style={styles.groupedTitle} numberOfLines={2}>
                            {anchorStop.name}
                          </Text>
                          <Text style={styles.groupedSub} numberOfLines={2}>
                            {s.places.anchorHint}
                          </Text>
                        </View>
                        <View style={styles.anchorBtnGroup}>
                          <SpringPressable
                            onPress={() => {
                              Keyboard.dismiss();
                              setAnchorQuery('');
                              setAnchorSuggestions([]);
                              setView('anchor');
                              sheetRef.current?.snapToIndex(1);
                            }}
                            haptic="selection"
                            style={styles.tonalActionBtn}
                            accessibilityRole="button"
                          >
                            <Text style={styles.tonalActionText}>{s.places.changeBtn}</Text>
                          </SpringPressable>
                          <SpringPressable
                            onPress={() => setAnchorStop(null)}
                            haptic="selection"
                            style={styles.clearAnchorBtn}
                            accessibilityRole="button"
                            accessibilityLabel={s.places.clearAnchorA11y}
                          >
                            <X size={17} color={scheme.onSurfaceVariant} />
                          </SpringPressable>
                        </View>
                      </View>
                    ) : (
                      <SpringPressable
                        onPress={() => {
                          Keyboard.dismiss();
                          setAnchorQuery('');
                          setAnchorSuggestions([]);
                          setView('anchor');
                          sheetRef.current?.snapToIndex(1);
                        }}
                        haptic="selection"
                        accessibilityRole="button"
                        style={[styles.groupedCard, styles.segmentBottom]}
                      >
                        <View
                          style={[
                            styles.rowIconBadge,
                            { backgroundColor: scheme.surfaceContainerHighest },
                          ]}
                        >
                          <Anchor size={19} color={scheme.onSurfaceVariant} />
                        </View>
                        <View style={styles.groupedTexts}>
                          <Text style={styles.groupedEyebrow}>{s.places.anchorOptional}</Text>
                          <Text style={styles.groupedTitle}>{s.places.assignAnchor}</Text>
                          <Text style={styles.groupedSub} numberOfLines={2}>
                            {s.places.anchorHint}
                          </Text>
                        </View>
                        <ChevronRight size={20} color={scheme.onSurfaceVariant} />
                      </SpringPressable>
                    )}
                  </View>
                ) : null}
              </BottomSheetScrollView>

              {/* Przypięty pasek akcji na dole arkusza */}
              <View style={styles.stickyFooter}>
                {saveError ? (
                  <View style={styles.saveError} accessibilityRole="alert">
                    <TriangleAlert size={16} color={scheme.onErrorContainer} />
                    <Text style={styles.saveErrorText}>{saveError}</Text>
                  </View>
                ) : null}

                {isEditing && confirmDelete ? (
                  <View style={styles.confirmDeleteBox}>
                    <View style={styles.confirmDeleteTextGroup}>
                      <Trash2 size={18} color={scheme.onErrorContainer} />
                      <Text style={styles.confirmDeleteText}>{s.places.removeGeneric}</Text>
                    </View>
                    <View style={styles.confirmDeleteBtns}>
                      <SpringPressable
                        onPress={() => setConfirmDelete(false)}
                        haptic="selection"
                        style={styles.cancelDeleteBtn}
                        accessibilityRole="button"
                      >
                        <Text style={styles.cancelDeleteText}>{s.common.cancel}</Text>
                      </SpringPressable>
                      <SpringPressable
                        onPress={handleDelete}
                        haptic="light"
                        style={styles.confirmDeleteBtn}
                        accessibilityRole="button"
                      >
                        <Text style={styles.confirmDeleteBtnText}>{s.common.yesRemove}</Text>
                      </SpringPressable>
                    </View>
                  </View>
                ) : (
                  <View style={styles.mainActionRow}>
                    {isEditing && onDelete ? (
                      <SpringPressable
                        onPress={() => setConfirmDelete(true)}
                        haptic="selection"
                        style={styles.deleteActionBtn}
                        accessibilityRole="button"
                        accessibilityLabel={s.places.removeA11y(initialPlace!.name)}
                      >
                        <Trash2 size={20} color={scheme.error} />
                      </SpringPressable>
                    ) : null}
                    <SpringPressable
                      onPress={() => void handleSave()}
                      disabled={!canSave}
                      haptic="light"
                      accessibilityRole="button"
                      accessibilityState={{ disabled: !canSave, busy: saving }}
                      style={[styles.saveActionBtn, !canSave && styles.saveActionDisabled]}
                    >
                      {saving ? (
                        <ActivityIndicator size="small" color={scheme.onPrimary} />
                      ) : (
                        <Check
                          size={20}
                          color={canSave ? scheme.onPrimary : scheme.onSurfaceVariant}
                        />
                      )}
                      <Text
                        style={[
                          styles.saveActionText,
                          !canSave && styles.saveActionTextDisabled,
                        ]}
                      >
                        {isEditing ? s.places.saveChanges : s.places.savePlace}
                      </Text>
                    </SpringPressable>
                  </View>
                )}
              </View>
            </Animated.View>
          )}
        </View>
      </BottomSheet>
    </View>
  );
}

const styles = StyleSheet.create({
  sheet: {
    backgroundColor: scheme.surfaceContainerLow,
    borderTopLeftRadius: shape.extraLarge,
    borderTopRightRadius: shape.extraLarge,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderColor: scheme.outlineVariant,
  },
  handle: {
    backgroundColor: scheme.outlineVariant,
    width: 38,
    height: 4,
    borderRadius: 2,
  },
  container: {
    flex: 1,
    paddingHorizontal: 20,
    paddingTop: 6,
  },
  viewFill: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 16,
    gap: 12,
  },
  headerLeft: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  title: {
    fontSize: 22,
    lineHeight: 28,
    fontWeight: '700',
    letterSpacing: -0.35,
    color: scheme.onSurface,
  },
  subtitle: {
    ...type.bodySmall,
    color: scheme.onSurfaceVariant,
  },
  roundNavBtn: {
    width: 44,
    height: 44,
    borderRadius: shape.full,
    backgroundColor: scheme.surfaceContainerHigh,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: scheme.outlineVariant,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  headerPreviewBadge: {
    width: 42,
    height: 42,
    borderRadius: 18,
    borderTopRightRadius: 8,
    borderBottomLeftRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },

  // Formularz główny
  formScroll: {
    flex: 1,
  },
  formScrollContent: {
    paddingBottom: 20,
    gap: 18,
  },
  identityCard: {
    backgroundColor: scheme.surfaceContainerHigh,
    borderRadius: shape.extraLarge,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: scheme.outlineVariant,
    padding: 16,
    gap: 14,
    ...elev.level1,
  },
  identityTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  identityTopRowCompact: {
    flexDirection: 'column',
    alignItems: 'stretch',
  },
  heroBadgeTrigger: {
    alignSelf: 'center',
    position: 'relative',
  },
  heroIconLeaf: {
    width: 64,
    height: 64,
    borderRadius: 26,
    borderTopRightRadius: 10,
    borderBottomLeftRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroEditPip: {
    position: 'absolute',
    right: -3,
    bottom: -3,
    width: 24,
    height: 24,
    borderRadius: shape.full,
    backgroundColor: scheme.surfaceContainerHighest,
    borderWidth: 2,
    borderColor: scheme.surfaceContainerHigh,
    alignItems: 'center',
    justifyContent: 'center',
  },
  nameColumn: {
    flex: 1,
    minWidth: 0,
    gap: 6,
  },
  inlineFieldLabel: {
    ...type.labelMedium,
    color: scheme.onSurfaceVariant,
    paddingLeft: 2,
  },
  nameInputBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: scheme.surfaceContainerLow,
    borderRadius: shape.large,
    borderWidth: 1.5,
    borderColor: scheme.outlineVariant,
    paddingLeft: 14,
    paddingRight: 4,
    minHeight: 52,
  },
  inputFocused: {
    borderColor: scheme.primary,
  },
  nameInput: {
    flex: 1,
    minWidth: 0,
    ...type.bodyLarge,
    fontWeight: '600',
    color: scheme.onSurface,
    paddingVertical: 12,
  },
  nameClearBtn: {
    width: 44,
    height: 44,
    borderRadius: shape.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  quickNamesScroll: {
    flexGrow: 0,
    marginHorizontal: -4,
  },
  quickNamesRow: {
    gap: 8,
    paddingHorizontal: 4,
  },
  quickNameChip: {
    minHeight: 44,
    maxWidth: 210,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: shape.full,
    backgroundColor: scheme.surfaceContainerHighest,
    justifyContent: 'center',
  },
  quickNameChipText: {
    ...type.labelMedium,
    color: scheme.onSurface,
    fontWeight: '600',
  },

  // Pasek szybkiego wyboru ikon
  iconDockSection: {
    gap: 10,
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  sectionHeaderTexts: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  sectionTitle: {
    ...type.titleSmall,
    fontWeight: '700',
    color: scheme.onSurface,
  },
  autoHintText: {
    ...type.labelSmall,
    color: scheme.primary,
    fontWeight: '600',
  },
  allIconsPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    minHeight: 44,
    paddingLeft: 14,
    paddingRight: 10,
    borderRadius: shape.full,
    backgroundColor: scheme.secondaryContainer,
  },
  allIconsPillText: {
    ...type.labelMedium,
    color: scheme.onSecondaryContainer,
    fontWeight: '700',
  },
  quickIconsScroll: {
    flexGrow: 0,
    marginHorizontal: -20,
  },
  quickIconsRow: {
    gap: 8,
    paddingHorizontal: 20,
    paddingVertical: 4,
  },
  quickIconTile: {
    width: 72,
    alignItems: 'center',
    gap: 6,
    paddingVertical: 4,
  },
  quickIconBoxWrap: {
    position: 'relative',
  },
  quickIconBox: {
    width: 52,
    height: 52,
    borderRadius: shape.large,
    backgroundColor: scheme.surfaceContainerHigh,
    alignItems: 'center',
    justifyContent: 'center',
  },
  quickIconBoxSelected: {
    borderRadius: 22,
    borderTopRightRadius: 8,
    borderBottomLeftRadius: 8,
    borderWidth: 2,
    borderColor: scheme.primary,
  },
  quickIconBoxMore: {
    borderRadius: shape.full,
    backgroundColor: scheme.secondaryContainer,
  },
  quickCheckBadge: {
    position: 'absolute',
    top: -4,
    right: -4,
    width: 20,
    height: 20,
    borderRadius: shape.full,
    backgroundColor: scheme.primary,
    borderWidth: 2,
    borderColor: scheme.surfaceContainerLow,
    alignItems: 'center',
    justifyContent: 'center',
  },
  quickIconLabel: {
    ...type.labelSmall,
    color: scheme.onSurfaceVariant,
    textAlign: 'center',
  },
  quickIconLabelSelected: {
    color: scheme.onSurface,
    fontWeight: '700',
  },

  // Zgrupowane wiersze lokalizacji i kotwicy (M3 Expressive segmented cards)
  segmentGroup: {
    gap: 3,
  },
  groupedCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: scheme.surfaceContainer,
    borderRadius: shape.small,
    padding: 14,
    gap: 12,
    minHeight: 72,
  },
  groupedCardCompact: {
    flexDirection: 'column',
    alignItems: 'stretch',
  },
  segmentTop: {
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
  },
  segmentBottom: {
    borderBottomLeftRadius: 22,
    borderBottomRightRadius: 22,
  },
  rowIconBadge: {
    width: 42,
    height: 42,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  groupedTexts: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  groupedEyebrow: {
    ...type.labelSmall,
    color: scheme.onSurfaceVariant,
  },
  groupedTitle: {
    ...type.bodyLarge,
    fontWeight: '600',
    color: scheme.onSurface,
  },
  groupedSub: {
    ...type.bodySmall,
    color: scheme.onSurfaceVariant,
  },
  tonalActionBtn: {
    minHeight: 44,
    paddingHorizontal: 14,
    borderRadius: shape.full,
    backgroundColor: scheme.surfaceContainerHighest,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  tonalActionText: {
    ...type.labelMedium,
    color: scheme.primary,
    fontWeight: '700',
  },
  anchorBtnGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  clearAnchorBtn: {
    width: 44,
    height: 44,
    borderRadius: shape.full,
    backgroundColor: scheme.surfaceContainerHigh,
    alignItems: 'center',
    justifyContent: 'center',
  },

  // Przypięty pasek dolny
  stickyFooter: {
    paddingTop: 12,
    paddingBottom: 14,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: scheme.outlineVariant,
    backgroundColor: scheme.surfaceContainerLow,
    gap: 10,
  },
  saveError: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: shape.large,
    backgroundColor: scheme.errorContainer,
  },
  saveErrorText: {
    ...type.bodySmall,
    color: scheme.onErrorContainer,
    flex: 1,
  },
  mainActionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  deleteActionBtn: {
    width: 56,
    height: 56,
    borderRadius: shape.full,
    backgroundColor: scheme.surfaceContainerHigh,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: scheme.outlineVariant,
    alignItems: 'center',
    justifyContent: 'center',
  },
  saveActionBtn: {
    flex: 1,
    minHeight: 56,
    paddingHorizontal: 20,
    borderRadius: shape.full,
    backgroundColor: scheme.primary,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  saveActionDisabled: {
    backgroundColor: scheme.surfaceContainerHighest,
  },
  saveActionText: {
    ...type.labelLarge,
    fontWeight: '700',
    color: scheme.onPrimary,
    textAlign: 'center',
    flexShrink: 1,
  },
  saveActionTextDisabled: {
    color: scheme.onSurfaceVariant,
  },
  confirmDeleteBox: {
    backgroundColor: scheme.errorContainer,
    borderRadius: 22,
    padding: 14,
    gap: 12,
  },
  confirmDeleteTextGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  confirmDeleteText: {
    ...type.titleSmall,
    color: scheme.onErrorContainer,
    fontWeight: '700',
    flex: 1,
  },
  confirmDeleteBtns: {
    flexDirection: 'row',
    gap: 10,
  },
  cancelDeleteBtn: {
    flex: 1,
    minHeight: 46,
    borderRadius: shape.full,
    backgroundColor: scheme.surfaceContainerHigh,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cancelDeleteText: {
    ...type.labelLarge,
    color: scheme.onSurface,
    fontWeight: '600',
  },
  confirmDeleteBtn: {
    flex: 1,
    minHeight: 46,
    borderRadius: shape.full,
    backgroundColor: scheme.error,
    alignItems: 'center',
    justifyContent: 'center',
  },
  confirmDeleteBtnText: {
    ...type.labelLarge,
    fontWeight: '700',
    color: scheme.onError,
  },

  // Wyszukiwarka (lokalizacja / ikony / kotwica)
  searchPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: scheme.surfaceContainerHigh,
    borderRadius: shape.full,
    borderWidth: 1.5,
    borderColor: scheme.outlineVariant,
    paddingLeft: 16,
    paddingRight: 4,
    minHeight: 52,
  },
  searchInput: {
    flex: 1,
    minWidth: 0,
    ...type.bodyLarge,
    color: scheme.onSurface,
    paddingVertical: 12,
  },
  clearBtn: {
    width: 44,
    height: 44,
    borderRadius: shape.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  listSpacing: {
    flex: 1,
    marginTop: 12,
  },
  suggestionsList: {
    paddingBottom: 28,
  },
  sectionCaption: {
    ...type.labelMedium,
    color: scheme.onSurfaceVariant,
    marginBottom: 8,
    paddingLeft: 4,
  },
  promptHintBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    backgroundColor: scheme.surfaceContainer,
    borderRadius: 22,
    padding: 16,
    marginTop: 4,
  },
  promptHintIcon: {
    width: 44,
    height: 44,
    borderRadius: 18,
    borderTopRightRadius: 8,
    borderBottomLeftRadius: 8,
    backgroundColor: scheme.primaryContainer,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  promptHintText: {
    ...type.bodyMedium,
    color: scheme.onSurfaceVariant,
    flex: 1,
    lineHeight: 20,
  },

  // Pełny katalog ikon
  categoryScroll: {
    flexGrow: 0,
    flexShrink: 0,
    marginHorizontal: -20,
    marginTop: 12,
    marginBottom: 8,
  },
  categoryRow: {
    gap: 8,
    paddingHorizontal: 20,
    paddingVertical: 2,
    alignItems: 'center',
  },
  categoryChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    minHeight: 44,
    paddingHorizontal: 16,
    borderRadius: shape.full,
    backgroundColor: scheme.surfaceContainerHigh,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: scheme.outlineVariant,
  },
  categoryChipActive: {
    backgroundColor: scheme.secondaryContainer,
    borderColor: scheme.secondaryContainer,
  },
  categoryChipText: {
    ...type.labelLarge,
    color: scheme.onSurfaceVariant,
  },
  categoryChipTextActive: {
    color: scheme.onSecondaryContainer,
    fontWeight: '700',
  },
  suggestedBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: scheme.surfaceContainerHigh,
    borderRadius: 22,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: scheme.outlineVariant,
    padding: 12,
    marginBottom: 12,
  },
  suggestedBannerActive: {
    borderColor: scheme.primary,
    borderWidth: 1.5,
  },
  suggestedLeaf: {
    width: 46,
    height: 46,
    borderRadius: 20,
    borderTopRightRadius: 8,
    borderBottomLeftRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  suggestedBannerTexts: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  suggestedBannerEyebrow: {
    ...type.labelSmall,
    color: scheme.primary,
    fontWeight: '600',
  },
  suggestedBannerName: {
    ...type.titleSmall,
    fontWeight: '700',
    color: scheme.onSurface,
  },
  suggestedBannerPill: {
    minHeight: 36,
    minWidth: 36,
    paddingHorizontal: 14,
    borderRadius: shape.full,
    backgroundColor: scheme.secondaryContainer,
    alignItems: 'center',
    justifyContent: 'center',
  },
  suggestedBannerPillActive: {
    paddingHorizontal: 10,
    backgroundColor: scheme.primary,
  },
  suggestedBannerPillText: {
    ...type.labelMedium,
    color: scheme.onSecondaryContainer,
    fontWeight: '700',
  },
  iconGridContent: {
    paddingTop: 4,
    paddingBottom: 32,
  },
  iconGridRow: {
    gap: 8,
    marginBottom: 8,
  },
  gridTile: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 96,
    paddingVertical: 12,
    paddingHorizontal: 6,
    borderRadius: 20,
    backgroundColor: scheme.surfaceContainer,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: scheme.outlineVariant,
    gap: 8,
    position: 'relative',
  },
  gridCheckBadge: {
    position: 'absolute',
    top: 7,
    right: 7,
    width: 20,
    height: 20,
    borderRadius: shape.full,
    backgroundColor: scheme.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  gridIconCircle: {
    width: 44,
    height: 44,
    borderRadius: shape.large,
    alignItems: 'center',
    justifyContent: 'center',
  },
  gridIconLeafSelected: {
    backgroundColor: 'transparent',
  },
  gridTileLabel: {
    ...type.labelSmall,
    color: scheme.onSurfaceVariant,
    textAlign: 'center',
    lineHeight: 15,
  },

  // Przystanki kotwiczenia
  stopOptionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: scheme.surfaceContainer,
    borderRadius: shape.small,
    padding: 14,
    minHeight: 68,
  },
  stopOptionRowActive: {
    backgroundColor: scheme.surfaceContainerHigh,
    borderWidth: 1.5,
    borderColor: scheme.primary,
  },
  stopOptionIcon: {
    width: 40,
    height: 40,
    borderRadius: 16,
    backgroundColor: scheme.tertiaryContainer,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stopOptionTexts: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  stopOptionName: {
    ...type.bodyLarge,
    fontWeight: '600',
    color: scheme.onSurface,
  },
  stopOptionDist: {
    ...type.bodySmall,
    color: scheme.onSurfaceVariant,
  },
  tonalPill: {
    minHeight: 36,
    paddingHorizontal: 14,
    borderRadius: shape.full,
    backgroundColor: scheme.secondaryContainer,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tonalPillActive: {
    backgroundColor: scheme.primary,
  },
  tonalPillText: {
    ...type.labelMedium,
    color: scheme.onSecondaryContainer,
    fontWeight: '700',
  },
  tonalPillTextActive: {
    color: scheme.onPrimary,
  },

  // Pusty stan wyszukiwania
  emptyStateBox: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 32,
    paddingHorizontal: 16,
    gap: 12,
  },
  emptyStateIcon: {
    width: 48,
    height: 48,
    borderRadius: shape.full,
    backgroundColor: scheme.surfaceContainerHigh,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyStateText: {
    ...type.bodyMedium,
    color: scheme.onSurfaceVariant,
    textAlign: 'center',
  },
  emptyStateBtn: {
    minHeight: 44,
    paddingHorizontal: 18,
    borderRadius: shape.full,
    backgroundColor: scheme.secondaryContainer,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyStateBtnText: {
    ...type.labelLarge,
    color: scheme.onSecondaryContainer,
    fontWeight: '700',
  },
});
