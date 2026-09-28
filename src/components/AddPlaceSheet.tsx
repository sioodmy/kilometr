import { useEffect, useMemo, useRef, useState } from 'react';
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
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  Anchor,
  Baby,
  Beer,
  Bike,
  Briefcase,
  BusFront,
  CarFront,
  Check,
  ChevronLeft,
  Church,
  Clapperboard,
  Coffee,
  Compass,
  CreditCard,
  Dumbbell,
  Fuel,
  Gamepad2,
  GraduationCap,
  Heart,
  Home,
  Hospital,
  Landmark,
  Laptop,
  Library,
  MapPin,
  Mountain,
  Music,
  Package,
  PawPrint,
  Pencil,
  Pill,
  Pizza,
  Plane,
  Plus,
  Sandwich,
  Scissors,
  Search,
  Ship,
  ShoppingBag,
  ShoppingCart,
  Sparkles,
  Star,
  Stethoscope,
  Store,
  Tent,
  Theater,
  Ticket,
  Train,
  TramFront,
  Trash2,
  Trees,
  Trophy,
  University,
  Users,
  UtensilsCrossed,
  Waves,
  Wine,
  X,
} from 'lucide-react-native';
import { elev, scheme, shape, type } from '../theme/tokens';
import type { SavedPlace, SavedPlaceIcon, Suggestion } from '../types/models';
import { SearchService, fetchNearestStops, type NearestStop } from '../services';
import { SuggestionRow } from './SuggestionRow';
import { useStrings, type Strings } from '../i18n';

export type PlaceIconCategory =
  | 'all'
  | 'frequent'
  | 'transit'
  | 'food'
  | 'health'
  | 'culture'
  | 'sport'
  | 'services';

export interface PlaceIconItem {
  key: SavedPlaceIcon;
  label: string;
  icon: any;
  category: Exclude<PlaceIconCategory, 'all'>;
  keywords: string[];
}

const PLACE_ICON_CATEGORY_KEYS: PlaceIconCategory[] = [
  'all',
  'frequent',
  'transit',
  'food',
  'health',
  'culture',
  'sport',
  'services',
];

export function getPlaceIconCategories(s: Strings): { key: PlaceIconCategory; label: string }[] {
  return PLACE_ICON_CATEGORY_KEYS.map((key) => ({ key, label: s.places.iconCategories[key] }));
}

/** Zachowane dla kompatybilności (etykiety PL); UI używa getPlaceIconCategories(s). */
export const PLACE_ICON_CATEGORIES: { key: PlaceIconCategory; label: string }[] = [
  { key: 'all', label: 'Wszystkie' },
  { key: 'frequent', label: 'Częste' },
  { key: 'transit', label: 'Podróż' },
  { key: 'food', label: 'Jedzenie' },
  { key: 'health', label: 'Zdrowie' },
  { key: 'culture', label: 'Kultura' },
  { key: 'sport', label: 'Sport' },
  { key: 'services', label: 'Usługi' },
];

export const PLACE_ICON_OPTIONS: PlaceIconItem[] = [
  // Codzienne / Częste
  { key: 'home', label: 'Dom', icon: Home, category: 'frequent', keywords: ['dom', 'mieszkanie', 'pokój', 'chata', 'house'] },
  { key: 'work', label: 'Praca', icon: Briefcase, category: 'frequent', keywords: ['praca', 'biuro', 'firma', 'robota', 'office', 'job'] },
  { key: 'school', label: 'Szkoła', icon: GraduationCap, category: 'frequent', keywords: ['szkoła', 'liceum', 'technikum', 'podstawówka', 'edukacja'] },
  { key: 'university', label: 'Uczelnia', icon: University, category: 'frequent', keywords: ['uczelnia', 'studia', 'uniwersytet', 'politechnika', 'akademia', 'wydział', 'kampus'] },
  { key: 'gym', label: 'Siłownia', icon: Dumbbell, category: 'sport', keywords: ['siłownia', 'fitness', 'trening', 'sport', 'crossfit', 'siłka'] },
  { key: 'coffee', label: 'Kawiarnia', icon: Coffee, category: 'food', keywords: ['kawiarnia', 'kawa', 'cafe', 'espresso', 'herbata', 'ciastko'] },
  { key: 'shopping', label: 'Sklep', icon: ShoppingBag, category: 'frequent', keywords: ['sklep', 'zakupy', 'galeria', 'mall', 'butik'] },
  { key: 'star', label: 'Ulubione', icon: Star, category: 'frequent', keywords: ['ulubione', 'gwiazdka', 'top', 'ważne'] },
  { key: 'heart', label: 'Ważne', icon: Heart, category: 'frequent', keywords: ['ważne', 'serce', 'rodzina', 'partner', 'miłość'] },
  { key: 'friends', label: 'Znajomi', icon: Users, category: 'frequent', keywords: ['znajomi', 'przyjaciele', 'ekipa', 'ludzie'] },

  // Podróż i transport
  { key: 'train', label: 'Dworzec PKP', icon: Train, category: 'transit', keywords: ['pociąg', 'dworzec', 'pkp', 'kolej', 'stacja', 'intercity', 'polregio'] },
  { key: 'tram', label: 'Tramwaj', icon: TramFront, category: 'transit', keywords: ['tramwaj', 'mpk', 'przystanek', 'szyny', 'pętla'] },
  { key: 'bus', label: 'Autobus', icon: BusFront, category: 'transit', keywords: ['autobus', 'mpk', 'przystanek', 'dworzec', 'pks'] },
  { key: 'plane', label: 'Lotnisko', icon: Plane, category: 'transit', keywords: ['lotnisko', 'samolot', 'terminal', 'airport'] },
  { key: 'bike', label: 'Rower', icon: Bike, category: 'transit', keywords: ['rower', 'ścieżka', 'stacja rowerowa', 'wr'] },
  { key: 'car', label: 'Samochód', icon: CarFront, category: 'transit', keywords: ['samochód', 'auto', 'parking', 'garaż'] },
  { key: 'fuel', label: 'Stacja paliw', icon: Fuel, category: 'transit', keywords: ['stacja', 'paliwo', 'orlen', 'shell', 'benzyna', 'diesel'] },
  { key: 'ship', label: 'Prom / Port', icon: Ship, category: 'transit', keywords: ['prom', 'statek', 'odra', 'port', 'przystań', 'kajaki'] },
  { key: 'compass', label: 'Orientacja', icon: Compass, category: 'transit', keywords: ['orientacja', 'punkt', 'kompas', 'cel'] },

  // Jedzenie i napoje
  { key: 'restaurant', label: 'Restauracja', icon: UtensilsCrossed, category: 'food', keywords: ['restauracja', 'jedzenie', 'obiad', 'lunch', 'kolacja'] },
  { key: 'pizza', label: 'Pizzeria', icon: Pizza, category: 'food', keywords: ['pizza', 'włoska', 'pizzeria', 'jedzenie'] },
  { key: 'sandwich', label: 'Bistro', icon: Sandwich, category: 'food', keywords: ['bistro', 'kanapka', 'piekarnia', 'śniadanie', 'fastfood'] },
  { key: 'beer', label: 'Pub / Piwo', icon: Beer, category: 'food', keywords: ['pub', 'piwo', 'bar', 'browar', 'kraft'] },
  { key: 'wine', label: 'Bar / Wino', icon: Wine, category: 'food', keywords: ['wino', 'bar', 'drinki', 'klub', 'cocktail'] },
  { key: 'market', label: 'Rynek / Targ', icon: Store, category: 'food', keywords: ['rynek', 'targ', 'hala', 'bazar', 'warzywniak', 'market'] },
  { key: 'cart', label: 'Supermarket', icon: ShoppingCart, category: 'food', keywords: ['supermarket', 'market', 'biedronka', 'lidl', 'dino', 'auchan', 'koszyk'] },

  // Zdrowie i uroda
  { key: 'pharmacy', label: 'Apteka', icon: Pill, category: 'health', keywords: ['apteka', 'leki', 'farmacja', 'zdrowie', 'recepta'] },
  { key: 'hospital', label: 'Szpital', icon: Hospital, category: 'health', keywords: ['szpital', 'sor', 'klinika', 'zdrowie', 'pogotowie'] },
  { key: 'doctor', label: 'Przychodnia', icon: Stethoscope, category: 'health', keywords: ['lekarz', 'przychodnia', 'doktor', 'badania', 'medycyna', 'nfz'] },
  { key: 'scissors', label: 'Fryzjer', icon: Scissors, category: 'health', keywords: ['fryzjer', 'barber', 'salon', 'włosy', 'strzyżenie'] },
  { key: 'sparkles', label: 'Uroda / Spa', icon: Sparkles, category: 'health', keywords: ['uroda', 'spa', 'kosmetyczka', 'paznokcie', 'relaks', 'masaż'] },

  // Kultura i rozrywka
  { key: 'cinema', label: 'Kino', icon: Clapperboard, category: 'culture', keywords: ['kino', 'film', 'seans', 'cinema', 'multikino', 'helios'] },
  { key: 'theater', label: 'Teatr', icon: Theater, category: 'culture', keywords: ['teatr', 'spektakl', 'opera', 'filharmonia', 'sztuka'] },
  { key: 'culture', label: 'Muzeum', icon: Landmark, category: 'culture', keywords: ['muzeum', 'galeria', 'wystawa', 'sztuka', 'zabytek'] },
  { key: 'library', label: 'Biblioteka', icon: Library, category: 'culture', keywords: ['biblioteka', 'książki', 'czytelnia', 'nauka'] },
  { key: 'music', label: 'Muzyka', icon: Music, category: 'culture', keywords: ['muzyka', 'koncert', 'klub', 'festiwal', 'zespół'] },
  { key: 'ticket', label: 'Wydarzenie', icon: Ticket, category: 'culture', keywords: ['wydarzenie', 'bilet', 'impreza', 'targi', 'koncert'] },
  { key: 'gamepad', label: 'Rozrywka', icon: Gamepad2, category: 'culture', keywords: ['gry', 'vr', 'arcade', 'kręgle', 'bilard', 'planszówki'] },

  // Sport i rekreacja
  { key: 'park', label: 'Park', icon: Trees, category: 'sport', keywords: ['park', 'las', 'drzewa', 'spacer', 'zieleń', 'ogród'] },
  { key: 'mountain', label: 'Góry', icon: Mountain, category: 'sport', keywords: ['góry', 'szlak', 'wspinaczka', 'wycieczka', 'tatry', 'karkonosze'] },
  { key: 'tent', label: 'Kemping', icon: Tent, category: 'sport', keywords: ['kemping', 'namiot', 'biwak', 'las', 'ognisko'] },
  { key: 'trophy', label: 'Stadion', icon: Trophy, category: 'sport', keywords: ['stadion', 'mecz', 'zawody', 'hala', 'boisko', 'turniej'] },
  { key: 'swimming', label: 'Basen / Plaża', icon: Waves, category: 'sport', keywords: ['basen', 'aquapark', 'plaża', 'pływanie', 'woda'] },

  // Społeczność i usługi
  { key: 'church', label: 'Kościół', icon: Church, category: 'services', keywords: ['kościół', 'parafia', 'msza', 'kaplica', 'katedra'] },
  { key: 'baby', label: 'Przedszkole', icon: Baby, category: 'services', keywords: ['przedszkole', 'żłobek', 'dzieci', 'dziecko', 'maluch'] },
  { key: 'pet', label: 'Zwierzak', icon: PawPrint, category: 'services', keywords: ['zwierzak', 'pies', 'kot', 'pupil', 'weterynarz'] },
  { key: 'hotel', label: 'Hotel', icon: Landmark, category: 'services', keywords: ['hotel', 'hostel', 'nocleg', 'apartament', 'pokoje'] },
  { key: 'bank', label: 'Bank / Bankomat', icon: CreditCard, category: 'services', keywords: ['bank', 'bankomat', 'pieniądze', 'karta', 'finanse', 'wpłatomat'] },
  { key: 'post', label: 'Poczta / Paczka', icon: Package, category: 'services', keywords: ['poczta', 'inpost', 'paczkomat', 'kurier', 'paczka', 'list'] },
  { key: 'laptop', label: 'Coworking', icon: Laptop, category: 'services', keywords: ['coworking', 'biuro', 'komputer', 'praca zdalna', 'desk'] },
  { key: 'mapPin', label: 'Inne', icon: MapPin, category: 'services', keywords: ['inne', 'punkt', 'adres', 'miejsce', 'cel'] },
];

/** Wariant z etykietami w języku użytkownika (UI); keywords zostają wielojęzyczne jak wyżej. */
export function getPlaceIconOptions(s: Strings): PlaceIconItem[] {
  return PLACE_ICON_OPTIONS.map((o) => ({ ...o, label: s.places.iconName[o.key] ?? o.label }));
}

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
  // Formularz kończy się przyciskiem „Zapisz”; bez insetu jest pod paskiem
  // nawigacji i w dolnej połowie nie reaguje na dotknięcie.
  const insets = useSafeAreaInsets();
  const isEditing = Boolean(initialPlace);
  const s = useStrings();
  // Katalog ikon i kategorii w języku użytkownika (etykiety ze słownika).
  const iconOptions = useMemo(() => getPlaceIconOptions(s), [s]);
  const iconCategories = useMemo(() => getPlaceIconCategories(s), [s]);

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
  // Debounce musi trzymać uchwyt do timera: `return () => clearTimeout(t)`
  // w obsłudze zdarzenia nic nie czyści, więc każda litera odpalała osobne
  // wyszukiwanie, a wynik ostatniego bywał nadpisywany pustą listą.
  const locSearchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const locSearchSeq = useRef(0);
  const anchorSearchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const anchorSearchSeq = useRef(0);

  useEffect(() => {
    return () => {
      if (locSearchTimer.current) clearTimeout(locSearchTimer.current);
      if (anchorSearchTimer.current) clearTimeout(anchorSearchTimer.current);
    };
  }, []);

  // Expanded icon browser state
  const [isPickingIcon, setIsPickingIcon] = useState(false);
  const [iconQuery, setIconQuery] = useState('');
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
      : null
  );
  const [isPickingAnchor, setIsPickingAnchor] = useState(false);
  const [anchorQuery, setAnchorQuery] = useState('');
  const [anchorSuggestions, setAnchorSuggestions] = useState<Suggestion[]>([]);
  const [nearestStops, setNearestStops] = useState<NearestStop[]>([]);
  const [searchingAnchor, setSearchingAnchor] = useState(false);

  // Android back / gest wstecz
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (isPickingIcon) {
        setIsPickingIcon(false);
        setIconQuery('');
        return true;
      }
      if (isPickingAnchor) {
        setIsPickingAnchor(false);
        setAnchorQuery('');
        return true;
      }
      closeRef.current();
      return true;
    });
    return () => sub.remove();
  }, [isPickingIcon, isPickingAnchor]);

  // Gdy zmienia się lokalizacja miejsca, pobierz najbliższe przystanki
  useEffect(() => {
    if (selectedLoc) {
      fetchNearestStops(selectedLoc.lat, selectedLoc.lon, 6).then((stops) => {
        setNearestStops(stops);
      });
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
    if (locSearchTimer.current) clearTimeout(locSearchTimer.current);
    const seq = ++locSearchSeq.current;
    if (!text.trim()) {
      setSuggestions([]);
      setSearching(false);
      return;
    }
    setSearching(true);
    locSearchTimer.current = setTimeout(() => {
      SearchService.search(text, undefined, 'add-place-address')
        .then((res) => {
          if (seq !== locSearchSeq.current) return;
          setSuggestions(res);
        })
        .catch(() => {
          // Zapytanie przerwane nowszym albo błąd — stan ogarnia kolejne.
          if (seq === locSearchSeq.current) setSuggestions([]);
        })
        .finally(() => {
          if (seq === locSearchSeq.current) setSearching(false);
        });
    }, 220);
  };

  const handleAnchorQueryChange = (text: string) => {
    setAnchorQuery(text);
    if (anchorSearchTimer.current) clearTimeout(anchorSearchTimer.current);
    const seq = ++anchorSearchSeq.current;
    if (!text.trim()) {
      setAnchorSuggestions([]);
      setSearchingAnchor(false);
      return;
    }
    setSearchingAnchor(true);
    anchorSearchTimer.current = setTimeout(() => {
      SearchService.search(
        text,
        selectedLoc ? { lat: selectedLoc.lat, lon: selectedLoc.lon } : undefined,
        'add-place-anchor',
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
    }, 220);
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

  // Curated quick icons for horizontal row
  const quickIconOptions = useMemo(() => {
    const primaryKeys: SavedPlaceIcon[] = [
      'home',
      'work',
      'school',
      'university',
      'gym',
      'coffee',
      'restaurant',
      'shopping',
      'train',
      'tram',
      'bus',
      'star',
    ];
    const items = primaryKeys
      .map((k) => iconOptions.find((opt) => opt.key === k))
      .filter(Boolean) as PlaceIconItem[];

    // If currently selected icon is outside the top 12, prepend it so user sees it highlighted
    if (selectedIcon && !primaryKeys.includes(selectedIcon)) {
      const custom = iconOptions.find((opt) => opt.key === selectedIcon);
      if (custom) {
        return [custom, ...items];
      }
    }
    return items;
  }, [selectedIcon, iconOptions]);

  // Filtered icons for full picker
  const filteredCatalogIcons = useMemo(() => {
    const q = iconQuery.trim().toLowerCase();
    return iconOptions.filter((item) => {
      if (selectedIconCategory !== 'all' && item.category !== selectedIconCategory) {
        return false;
      }
      if (!q) return true;
      return (
        item.label.toLowerCase().includes(q) ||
        item.key.toLowerCase().includes(q) ||
        item.keywords.some((k) => k.toLowerCase().includes(q))
      );
    });
  }, [iconQuery, selectedIconCategory, iconOptions]);

  return (
    <BottomSheet
      ref={sheetRef}
      index={isEditing ? 0 : 1}
      snapPoints={['65%', '92%']}
      bottomInset={insets.bottom}
      enableDynamicSizing={false}
      enablePanDownToClose
      onChange={(idx) => {
        if (idx === -1) onClose();
      }}
      backgroundStyle={styles.sheet}
      handleIndicatorStyle={styles.handle}
    >
      <View style={styles.container}>
        {/* VIEW 1: EXPANDED ICON PICKER */}
        {isPickingIcon ? (
          <View style={{ flex: 1 }}>
            <View style={styles.header}>
              <Pressable
                onPress={() => {
                  setIsPickingIcon(false);
                  setIconQuery('');
                }}
                hitSlop={10}
                style={styles.backBtn}
              >
                <ChevronLeft size={22} color={scheme.onSurface} />
              </Pressable>
              <View style={styles.headerLeft}>
                <Text style={styles.title}>{s.places.chooseIcon}</Text>
                <Text style={styles.subtitle}>
                  {s.places.iconFor(name.trim() || s.places.iconForFallback)}
                </Text>
              </View>
              <Pressable
                onPress={() => {
                  setIsPickingIcon(false);
                  setIconQuery('');
                }}
                hitSlop={10}
                style={styles.closeBtn}
              >
                <X size={20} color={scheme.onSurfaceVariant} />
              </Pressable>
            </View>

            {/* Icon Search Box */}
            <View style={styles.searchBox}>
              <Search size={18} color={scheme.onSurfaceVariant} />
              <TextInput
                value={iconQuery}
                onChangeText={setIconQuery}
                placeholder={s.places.searchIcon}
                placeholderTextColor={scheme.onSurfaceVariant}
                style={styles.searchInput}
                autoFocus
              />
              {iconQuery ? (
                <Pressable onPress={() => setIconQuery('')} hitSlop={10}>
                  <X size={17} color={scheme.onSurfaceVariant} />
                </Pressable>
              ) : null}
            </View>

            {/* Category Filter Pills */}
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              nestedScrollEnabled
              style={styles.categoryScroll}
              contentContainerStyle={styles.categoryRow}
            >
              {iconCategories.map((cat) => {
                const isSelected = selectedIconCategory === cat.key;
                return (
                  <Pressable
                    key={cat.key}
                    onPress={() => setSelectedIconCategory(cat.key)}
                    style={({ pressed }) => [
                      styles.categoryPill,
                      isSelected && styles.categoryPillSelected,
                      pressed && { opacity: 0.8 },
                    ]}
                  >
                    <Text
                      style={[
                        styles.categoryPillText,
                        isSelected && styles.categoryPillTextSelected,
                      ]}
                    >
                      {cat.label}
                    </Text>
                  </Pressable>
                );
              })}
            </ScrollView>

            {/* Grid of Icons */}
            <BottomSheetFlatList
              data={filteredCatalogIcons}
              numColumns={4}
              keyExtractor={(item: PlaceIconItem) => item.key}
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={styles.iconGridContent}
              renderItem={({ item }: { item: PlaceIconItem }) => {
                const IconComp = item.icon;
                const isSelected = selectedIcon === item.key;
                return (
                  <Pressable
                    onPress={() => {
                      setSelectedIcon(item.key);
                      setIsPickingIcon(false);
                      setIconQuery('');
                    }}
                    style={({ pressed }) => [
                      styles.gridItem,
                      isSelected && styles.gridItemSelected,
                      pressed && { opacity: 0.8, transform: [{ scale: 0.96 }] },
                    ]}
                  >
                    <View
                      style={[
                        styles.gridIconWrap,
                        isSelected && styles.gridIconWrapSelected,
                      ]}
                    >
                      <IconComp
                        size={20}
                        color={isSelected ? scheme.onPrimaryContainer : scheme.onSurface}
                      />
                    </View>
                    <Text
                      numberOfLines={1}
                      style={[
                        styles.gridItemLabel,
                        isSelected && styles.gridItemLabelSelected,
                      ]}
                    >
                      {item.label}
                    </Text>
                  </Pressable>
                );
              }}
            />
          </View>
        ) : isPickingAnchor ? (
          /* VIEW 2: PICK ANCHOR STOP */
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
                <Text style={styles.title}>{s.places.anchorTitle}</Text>
                <Text style={styles.subtitle}>
                  {s.places.anchorFor(name || s.places.iconForFallback)}
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
                placeholder={s.places.searchStop}
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
                    ? s.places.nearStops
                    : s.places.typeStopAbove}
                </Text>
                {nearestStops.map((stop) => (
                  <Pressable
                    key={stop.id}
                    onPress={() => {
                      setAnchorStop({
                        id: stop.id,
                        name: stop.name,
                        lat: stop.lat,
                        lon: stop.lon,
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
                        {stop.name}
                      </Text>
                      <Text style={styles.nearestStopDist}>
                        {s.places.metersAway(stop.distanceM)}
                      </Text>
                    </View>
                    <View style={styles.selectPill}>
                      <Text style={styles.selectPillText}>{s.places.choose}</Text>
                    </View>
                  </Pressable>
                ))}
              </BottomSheetScrollView>
            )}
          </View>
        ) : isChangingLoc && suggestions.length > 0 ? (
          /* VIEW 3: LOCATION SEARCH RESULTS */
          <View style={{ flex: 1 }}>
            <View style={styles.header}>
              <View style={styles.headerLeft}>
                <Text style={styles.title}>
                  {isEditing ? s.places.editPlace : s.places.newPlace}
                </Text>
                <Text style={styles.subtitle}>
                  {s.places.chooseTarget}
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

            <View style={styles.searchBox}>
              <Search size={18} color={scheme.onSurfaceVariant} />
              <TextInput
                value={query}
                onChangeText={handleQueryChange}
                placeholder={s.places.queryHint}
                placeholderTextColor={scheme.onSurfaceVariant}
                style={styles.searchInput}
                autoFocus
              />
              {searching && <ActivityIndicator size="small" color={scheme.primary} />}
              {query ? (
                <Pressable onPress={() => setQuery('')} hitSlop={10}>
                  <X size={17} color={scheme.onSurfaceVariant} />
                </Pressable>
              ) : null}
            </View>

            <BottomSheetFlatList
              data={suggestions}
              keyExtractor={(i: Suggestion) => i.id}
              overScrollMode="never"
              keyboardShouldPersistTaps="handled"
              style={{ flex: 1, marginTop: 10 }}
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
          </View>
        ) : (
          /* VIEW 4: MAIN FORM WRAPPED IN BottomSheetScrollView FOR COMPLETE SCROLLABILITY */
          <BottomSheetScrollView
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={styles.formScrollContent}
          >
            {/* Header */}
            <View style={styles.header}>
              <View style={styles.headerLeft}>
                <Text style={styles.title}>
                  {isEditing ? s.places.editPlace : s.places.newPlace}
                </Text>
                <Text style={styles.subtitle}>
                  {isEditing ? s.places.editHint : s.places.newHint}
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
              <Text style={styles.fieldLabel}>{s.places.nameLabel}</Text>
              <TextInput
                value={name}
                onChangeText={setName}
                placeholder={s.places.nameHint}
                placeholderTextColor={scheme.onSurfaceVariant}
                style={styles.nameInput}
                returnKeyType="done"
              />
            </View>

            {/* Icon Picker Row */}
            <View style={styles.iconSection}>
              <View style={styles.sectionHeaderRow}>
                <Text style={styles.fieldLabel}>{s.places.chooseIcon}</Text>
                <Pressable
                  onPress={() => {
                    setIsPickingIcon(true);
                    sheetRef.current?.snapToIndex(1);
                  }}
                  hitSlop={8}
                  style={({ pressed }) => [styles.moreIconsLink, pressed && { opacity: 0.7 }]}
                >
                  <Sparkles size={13} color={scheme.primary} />
                  <Text style={styles.moreIconsLinkText}>
                    {s.places.moreIcons(iconOptions.length)}
                  </Text>
                </Pressable>
              </View>

              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                nestedScrollEnabled
                overScrollMode="never"
                contentContainerStyle={styles.iconRow}
              >
                {quickIconOptions.map((item) => {
                  const IconComp = item.icon;
                  const isSelected = selectedIcon === item.key;
                  return (
                    <Pressable
                      key={item.key}
                      onPress={() => setSelectedIcon(item.key)}
                      style={({ pressed }) => [
                        styles.iconChip,
                        isSelected && styles.iconChipSelected,
                        pressed && { opacity: 0.8, transform: [{ scale: 0.98 }] },
                      ]}
                    >
                      <IconComp
                        size={17}
                        color={isSelected ? scheme.onPrimaryContainer : scheme.onSurfaceVariant}
                      />
                      <Text
                        style={[
                          styles.iconLabel,
                          isSelected && styles.iconLabelSelected,
                        ]}
                      >
                        {item.label}
                      </Text>
                    </Pressable>
                  );
                })}

                {/* More Icons Pill Button */}
                <Pressable
                  onPress={() => {
                    setIsPickingIcon(true);
                    sheetRef.current?.snapToIndex(1);
                  }}
                  style={({ pressed }) => [
                    styles.moreIconChip,
                    pressed && { opacity: 0.75, transform: [{ scale: 0.98 }] },
                  ]}
                >
                  <Sparkles size={15} color={scheme.primary} />
                  <Text style={styles.moreIconChipText}>{s.places.moreIconsShort}</Text>
                </Pressable>
              </ScrollView>
            </View>

            {/* Location Section */}
            <View style={styles.locSection}>
              <Text style={styles.fieldLabel}>{s.places.addressLabel}</Text>
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
                    <Text style={styles.changeBtnText}>{s.places.changeBtn}</Text>
                  </Pressable>
                </View>
              ) : (
                <View style={styles.searchBox}>
                  <Search size={18} color={scheme.onSurfaceVariant} />
                  <TextInput
                    value={query}
                    onChangeText={handleQueryChange}
                    placeholder={s.places.queryHint}
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

            {/* Anchor Stop Section */}
            {!isChangingLoc && selectedLoc && (
              <View style={styles.anchorSection}>
                <View style={styles.anchorSectionHeader}>
                  <Text style={styles.fieldLabel}>{s.places.anchorOptional}</Text>
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
                        {s.places.anchorHint}
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
                    <Text style={styles.addAnchorBtnText}>{s.places.assignAnchor}</Text>
                  </Pressable>
                )}
              </View>
            )}

            {/* Action Buttons */}
            {!isChangingLoc && (
              <View style={styles.bottomActions}>
                {isEditing && confirmDelete ? (
                  <View style={styles.confirmDeleteBox}>
                    <View style={styles.confirmDeleteTextGroup}>
                      <Trash2 size={18} color={scheme.error} />
                      <Text style={styles.confirmDeleteText}>{s.places.removeGeneric}</Text>
                    </View>
                    <View style={styles.confirmDeleteBtns}>
                      <Pressable
                        onPress={() => setConfirmDelete(false)}
                        style={({ pressed }) => [styles.cancelDeleteBtn, pressed && { opacity: 0.8 }]}
                      >
                        <Text style={styles.cancelDeleteText}>{s.common.cancel}</Text>
                      </Pressable>
                      <Pressable
                        onPress={handleDelete}
                        style={({ pressed }) => [styles.confirmDeleteBtn, pressed && { opacity: 0.8 }]}
                      >
                        <Text style={styles.confirmDeleteBtnText}>{s.common.yesRemove}</Text>
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
                        color={!name.trim() || !selectedLoc ? scheme.onSurfaceVariant : scheme.onPrimary}
                      />
                      <Text
                        style={[
                          styles.saveActionText,
                          (!name.trim() || !selectedLoc) && styles.saveActionTextDisabled,
                        ]}
                      >
                        {isEditing ? s.places.saveChanges : s.places.savePlace}
                      </Text>
                    </Pressable>
                  </View>
                )}
              </View>
            )}
          </BottomSheetScrollView>
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
  formScrollContent: {
    paddingBottom: 40,
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
  sectionHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  moreIconsLink: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 2,
    paddingHorizontal: 6,
  },
  moreIconsLinkText: {
    ...type.labelSmall,
    color: scheme.primary,
    fontWeight: '600',
  },
  inputWrap: {
    marginBottom: 14,
  },
  nameInput: {
    backgroundColor: scheme.surfaceContainerHigh,
    borderRadius: shape.large,
    borderWidth: 1,
    borderColor: scheme.outlineVariant,
    paddingHorizontal: 14,
    height: 48,
    ...type.bodyLarge,
    color: scheme.onSurface,
  },
  iconSection: {
    marginBottom: 14,
  },
  iconRow: {
    gap: 8,
    paddingVertical: 4,
    paddingHorizontal: 1,
  },
  // Modernized pill chip
  iconChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: shape.full,
    backgroundColor: scheme.surfaceContainerHigh,
    borderWidth: 1,
    borderColor: scheme.outlineVariant,
  },
  iconChipSelected: {
    backgroundColor: scheme.primaryContainer,
    borderColor: scheme.primary,
    borderWidth: 1.5,
  },
  iconLabel: {
    ...type.labelSmall,
    color: scheme.onSurfaceVariant,
  },
  iconLabelSelected: {
    color: scheme.onPrimaryContainer,
    fontWeight: '600',
  },
  moreIconChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: shape.full,
    backgroundColor: scheme.surfaceContainerHigh,
    borderWidth: 1,
    borderColor: scheme.primary,
    borderStyle: 'dashed',
  },
  moreIconChipText: {
    ...type.labelSmall,
    color: scheme.primary,
    fontWeight: '600',
  },
  locSection: {
    marginBottom: 14,
  },
  selectedCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: scheme.surfaceContainerHigh,
    borderRadius: shape.large,
    borderWidth: 1,
    borderColor: scheme.outlineVariant,
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
    borderWidth: 1,
    borderColor: scheme.outlineVariant,
    paddingHorizontal: 14,
    height: 48,
  },
  searchInput: {
    flex: 1,
    ...type.bodyMedium,
    color: scheme.onSurface,
  },
  suggestionsList: {
    paddingBottom: 24,
  },
  bottomActions: {
    width: '100%',
    marginTop: 8,
    paddingTop: 8,
    paddingBottom: 16,
  },
  mainActionRow: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  deleteActionBtn: {
    width: 50,
    height: 50,
    borderRadius: shape.full,
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
    height: 50,
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
    backgroundColor: scheme.surfaceContainerLow,
    borderRadius: shape.large,
    paddingVertical: 12,
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
  // Icon Picker Browser styles
  categoryScroll: {
    flexGrow: 0,
    marginVertical: 10,
  },
  categoryRow: {
    gap: 8,
    paddingVertical: 6,
    paddingHorizontal: 2,
    alignItems: 'center',
  },
  categoryPill: {
    paddingHorizontal: 18,
    paddingVertical: 14,
    minHeight: 46,
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: shape.full,
    backgroundColor: scheme.surfaceContainerHigh,
    borderWidth: 1,
    borderColor: scheme.outlineVariant,
  },
  categoryPillSelected: {
    backgroundColor: scheme.primaryContainer,
    borderColor: scheme.primary,
  },
  categoryPillText: {
    ...type.labelMedium,
    fontSize: 13,
    lineHeight: 18,
    includeFontPadding: false,
    color: scheme.onSurfaceVariant,
  },
  categoryPillTextSelected: {
    color: scheme.onPrimaryContainer,
    fontWeight: '700',
  },
  iconGridContent: {
    paddingBottom: 28,
    paddingTop: 4,
    gap: 10,
  },
  gridItem: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    margin: 4,
    paddingVertical: 10,
    paddingHorizontal: 4,
    borderRadius: shape.medium,
    backgroundColor: scheme.surfaceContainerHigh,
    borderWidth: 1,
    borderColor: scheme.outlineVariant,
  },
  gridItemSelected: {
    backgroundColor: scheme.primaryContainer,
    borderColor: scheme.primary,
    borderWidth: 1.5,
  },
  gridIconWrap: {
    width: 38,
    height: 38,
    borderRadius: shape.full,
    backgroundColor: scheme.surfaceContainerHighest,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 6,
  },
  gridIconWrapSelected: {
    backgroundColor: scheme.secondaryContainer,
  },
  gridItemLabel: {
    ...type.labelSmall,
    fontSize: 11,
    color: scheme.onSurfaceVariant,
    textAlign: 'center',
  },
  gridItemLabelSelected: {
    color: scheme.onPrimaryContainer,
    fontWeight: '600',
  },
});
