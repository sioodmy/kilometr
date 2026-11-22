import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  BackHandler,
  FlatList,
  Keyboard,
  KeyboardAvoidingView,
  type LayoutChangeEvent,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  cancelAnimation,
  runOnJS,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Check, MapPinOff, Search, X } from './icons';
import { SpringPressable } from './SpringPressable';
import { motion } from '../theme/motion';
import { scheme, shape, type } from '../theme/tokens';
import { getLocaleSync, type Strings, useStrings } from '../i18n';
import { CITIES, type CityDef, type CityId } from '../cities';
import { normalizePolish } from '../gtfs/geo';

const MAX_RUBBER_UP = 18;

const CITY_ALIASES: Record<string, string[]> = {
  wroclaw: ['wrocław', 'wroclaw', 'dolny śląsk', 'dolnyslask', 'breslau'],
  krakow: ['kraków', 'krakow', 'małopolska', 'malopolska', 'skawina', 'cracow'],
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
    'piaseczno',
    'legionowo',
    'wołomin',
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
  lodz: ['łódź', 'lodz', 'aleksandrów łódzki', 'konstantynów łódzki'],
  szczecin: ['szczecin', 'pomorze zachodnie', 'police', 'dobra', 'gryfino', 'stettin'],
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
  bielskobiala: ["bielsko-biała","bielsko-biala","bielsko","bielsko biala","beskidy","podbeskidzie"],
  koszalin: ["koszalin"],
  piotrkow: ["piotrków trybunalski","piotrkow trybunalski","piotrków","piotrkow"],
  tomaszow: ["tomaszów mazowiecki","tomaszow mazowiecki","tomaszów","tomaszow"],
  skarzysko: ["skarżysko-kamienna","skarzysko-kamienna","skarżysko","skarzysko"],
  oswiecim: ["oświęcim","oswiecim"],
  swinoujscie: ["świnoujście","swinoujscie","uznam","wolin"],
  zakopane: ["zakopane","tatry","podhale"],
  plock: ["płock","plock"],
  tarnow: ["tarnów","tarnow"],
  legnica: ["legnica"],
  jastrzebie: ["jastrzębie-zdrój","jastrzebie-zdroj","jastrzębie","jastrzebie"],
  pila: ["piła","pila"],
  konin: ["konin"],
  suwalki: ["suwałki","suwalki"],
  ostrowiec: ["ostrowiec świętokrzyski","ostrowiec swietokrzyski","ostrowiec","świętokrzyskie","swietokrzyskie"],
  stalowawola: ["stalowa wola","podkarpacie"],
  przemysl: ["przemyśl","przemysl"],
  elk: ["ełk","elk"],
  leszno: ["leszno"],
  chelm: ["chełm","chelm"],
  mielec: ["mielec"],
  tczew: ["tczew"],
  ostroleka: ["ostrołęka","ostroleka"],
  starachowice: ["starachowice"],
  kutno: ["kutno"],
  kolobrzeg: ["kołobrzeg","kolobrzeg"],
  radomsko: ["radomsko"],
  boleslawiec: ["bolesławiec","boleslawiec"],
  cieszyn: ["cieszyn"],
  zywiec: ["żywiec","zywiec"],
  krasnik: ["kraśnik","krasnik"],
  grodzisk: ["grodzisk mazowiecki","grodzisk","milanówek","milanowek","brwinów","brwinow","podkowa leśna","podkowa lesna","gpa"],
  pruszkow: ["pruszków","pruszkow"],
  sochaczew: ["sochaczew"],
  minskmazowiecki: ["mińsk mazowiecki","minsk mazowiecki"],
  otwock: ["otwock"],
  nowydwormaz: ["nowy dwór mazowiecki","nowy dwor mazowiecki","modlin","lotnisko modlin","nowy dwor"],
  zabki: ["ząbki","zabki"],
  pabianice: ["pabianice"],
  zgierz: ["zgierz"],
  grudziadz: ["grudziądz","grudziadz"],
  jaworzno: ["jaworzno"],
  stargard: ["stargard"],
  gniezno: ["gniezno"],
  zamosc: ["zamość","zamosc"],
  kedzierzynkozle: ["kędzierzyn-koźle","kedzierzyn-kozle","kędzierzyn","kedzierzyn","koźle","kozle"],
  belchatow: ["bełchatów","belchatow"],
  raciborz: ["racibórz","raciborz"],
  tarnobrzeg: ["tarnobrzeg","podkarpacie"],
  skierniewice: ["skierniewice"],
  starogard: ["starogard gdański","starogard gdanski","starogard","kociewie"],
  zawiercie: ["zawiercie"],
  nysa: ["nysa"],
  zdunskawola: ["zduńska wola","zdunska wola"],
  sieradz: ["sieradz"],
  malbork: ["malbork"],
  szczecinek: ["szczecinek"],
  nowasol: ["nowa sól","nowa sol","lubuskie"],
  olesnica: ["oleśnica","olesnica"],
  czechowicedziedzice: ["czechowice-dziedzice","czechowice","dziedzice"],
  ostroda: ["ostróda","ostroda"],
  nowytarg: ["nowy targ","podhale"],
  augustow: ["augustów","augustow"],
  ketrzyn: ["kętrzyn","ketrzyn"],
  gorlice: ["gorlice"],
  zgorzelec: ["zgorzelec"],
  jarocin: ["jarocin"],
  polkowice: ["polkowice"],
  zagan: ["żagań","zagan"],
  wrzesnia: ["września","wrzesnia"],
  walcz: ["wałcz","walcz"],
  gizycko: ["giżycko","gizycko"],
  krotoszyn: ["krotoszyn"],
  koscierzyna: ["kościerzyna","koscierzyna"],
  sandomierz: ["sandomierz"],
  bartoszyce: ["bartoszyce"],
  wielun: ["wieluń","wielun"],
  mragowo: ["mrągowo","mragowo"],
  wagrowiec: ["wągrowiec","wagrowiec"],
  swiecie: ["świecie","swiecie"],
  dzialdowo: ["działdowo","dzialdowo"],
  bielskpodlaski: ["bielsk podlaski","bielsk","podlasie"],
  gostyn: ["gostyń","gostyn"],
  brzesko: ["brzesko"],
  lidzbarkwarminski: ["lidzbark warmiński","lidzbark warminski","lidzbark"],
  chodziez: ["chodzież","chodziez"],
  pszczyna: ["pszczyna"],
  wodzislaw: ["wodzisław śląski","wodzislaw slaski","wodzisław","wodzislaw"],
  zabkowice: ["ząbkowice śląskie","zabkowice slaskie","ząbkowice","zabkowice"],
  strzelin: ["strzelin"],
  srodaslaska: ["środa śląska","sroda slaska"],
  jedrzejow: ["jędrzejów","jedrzejow"],
  kozienice: ["kozienice"],
  oborniki: ["oborniki"],
  wieliczka: ["wieliczka"],
  myszkow: ["myszków","myszkow"],
  kartuzy: ["kartuzy"],
  slubice: ["słubice","slubice"],
};

type CityEntry = {
  city: CityDef;
  name: string;
  feeds: string;
  nameNorm: string;
  searchText: string;
};

// Cache po instancji słownika: unikamy ponownej normalizacji 132 miast i tworzenia
// Intl.Collator przy każdym otwarciu arkusza.
const cachedEntriesByStrings = new WeakMap<Strings, CityEntry[]>();

function getCityEntries(s: Strings): CityEntry[] {
  const cached = cachedEntriesByStrings.get(s);
  if (cached) return cached;

  const collator = new Intl.Collator(getLocaleSync());
  const entries = CITIES.map((city) => {
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
  }).sort((a, b) => collator.compare(a.name, b.name));

  cachedEntriesByStrings.set(s, entries);
  return entries;
}

const keyExtractor = (item: CityEntry) => item.city.id;

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
  const handlePress = useCallback(() => onPress(city), [onPress, city]);
  return (
    <Pressable
      onPress={handlePress}
      disabled={disabled}
      style={({ pressed }) => [
        styles.cityItem,
        active && styles.cityItemActive,
        disabled && !active && styles.cityItemDisabled,
        pressed && !disabled && styles.cityItemPressed,
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

/**
 * Arkusz wyboru miasta M3 Expressive: sprężyste wejście i wyjście, a gest
 * zamykania siedzi na uchwycie i nagłówku, żeby FlatList przewijał się natywnie.
 */
export function CitySelectSheet({
  selectedCityId,
  onSelectCity,
  onClose,
  switchingCity,
  switchingCityId,
}: CitySelectSheetProps) {
  const [query, setQuery] = useState('');
  const s = useStrings();
  const insets = useSafeAreaInsets();
  const reduceMotion = useReducedMotion();
  const { height: windowHeight } = useWindowDimensions();

  const [overlayHeight, setOverlayHeight] = useState(windowHeight);
  const maxOverlayHeightRef = useRef(windowHeight);
  const [androidKeyboardHeight, setAndroidKeyboardHeight] = useState(0);

  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const selectRef = useRef(onSelectCity);
  selectRef.current = onSelectCity;
  const selectedRef = useRef(selectedCityId);
  selectedRef.current = selectedCityId;
  const switchingRef = useRef(switchingCity);
  switchingRef.current = switchingCity;
  const closingRef = useRef(false);

  const baseHeight = Math.max(windowHeight, maxOverlayHeightRef.current);
  const effectiveHeight = Platform.OS === 'web' ? overlayHeight : baseHeight;
  const targetSheetHeight = Math.max(
    Platform.OS === 'web' ? 180 : 320,
    Math.round((effectiveHeight - insets.top) * 0.92),
  );
  const targetHeightRef = useRef(targetSheetHeight);
  targetHeightRef.current = targetSheetHeight;

  const translateY = useSharedValue(reduceMotion ? 0 : targetSheetHeight);
  const backdropProgress = useSharedValue(reduceMotion ? 1 : 0);

  useEffect(() => {
    if (reduceMotion) {
      translateY.value = 0;
      backdropProgress.value = 1;
      return;
    }
    translateY.value = withSpring(0, motion.spring.spatialDefault);
    backdropProgress.value = withSpring(1, motion.spring.effectsDefault);
  }, [backdropProgress, reduceMotion, translateY]);

  const finishClose = useCallback(() => {
    closeRef.current();
  }, []);

  const requestClose = useCallback(
    (immediate = false) => {
      if (closingRef.current) return;
      closingRef.current = true;
      Keyboard.dismiss();
      if (immediate || reduceMotion) {
        finishClose();
        return;
      }
      cancelAnimation(translateY);
      cancelAnimation(backdropProgress);
      backdropProgress.value = withTiming(0, motion.exit);
      translateY.value = withTiming(targetHeightRef.current, motion.exit, () => {
        runOnJS(finishClose)();
      });
    },
    [backdropProgress, finishClose, reduceMotion, translateY],
  );

  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      requestClose();
      return true;
    });
    return () => sub.remove();
  }, [requestClose]);

  useEffect(() => {
    if (Platform.OS !== 'android') return;
    const showSub = Keyboard.addListener('keyboardDidShow', (e) => {
      setAndroidKeyboardHeight(e.endCoordinates?.height ?? 0);
    });
    const hideSub = Keyboard.addListener('keyboardDidHide', () => {
      setAndroidKeyboardHeight(0);
    });
    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, []);

  const handleOverlayLayout = useCallback((e: LayoutChangeEvent) => {
    const h = e.nativeEvent.layout.height;
    if (h > maxOverlayHeightRef.current) {
      maxOverlayHeightRef.current = h;
    }
    setOverlayHeight((prev) => (Math.abs(prev - h) > 1 ? h : prev));
  }, []);

  const windowShrank = maxOverlayHeightRef.current - overlayHeight > androidKeyboardHeight * 0.5;
  const extraKeyboardInset =
    Platform.OS === 'android' && androidKeyboardHeight > 0 && !windowShrank
      ? androidKeyboardHeight
      : 0;

  const dismissPanGesture = useMemo(
    () =>
      Gesture.Pan()
        .activeOffsetY(8)
        .failOffsetX([-20, 20])
        .onUpdate((e) => {
          'worklet';
          if (e.translationY >= 0) {
            translateY.value = e.translationY;
          } else {
            translateY.value = -Math.min(MAX_RUBBER_UP, Math.sqrt(-e.translationY) * 2.2);
          }
        })
        .onEnd((e) => {
          'worklet';
          if (e.translationY > 96 || e.velocityY > 760) {
            if (reduceMotion) {
              runOnJS(requestClose)(true);
              return;
            }
            const remaining = Math.max(0, targetSheetHeight - Math.max(0, translateY.value));
            const speed = Math.max(1200, e.velocityY);
            const duration = Math.max(100, Math.min(180, Math.round((remaining / speed) * 1000)));
            backdropProgress.value = withTiming(0, { duration, easing: motion.exit.easing });
            translateY.value = withTiming(
              targetSheetHeight,
              { duration, easing: motion.exit.easing },
              (finished) => {
                if (finished) runOnJS(requestClose)(true);
              },
            );
          } else {
            translateY.value = withSpring(0, {
              ...motion.spring.spatialDefault,
              velocity: e.velocityY,
            });
          }
        }),
    [backdropProgress, reduceMotion, requestClose, targetSheetHeight, translateY],
  );

  const sheetAnimatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: translateY.value }],
  }));

  const backdropAnimatedStyle = useAnimatedStyle(() => {
    const dragFactor =
      1 - Math.min(1, Math.max(0, translateY.value) / Math.max(1, targetSheetHeight * 0.72));
    return { opacity: backdropProgress.value * dragFactor * 0.58 };
  });

  const entries = useMemo(() => getCityEntries(s), [s]);

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

  const handleCityPress = useCallback(
    (city: CityDef) => {
      if (switchingRef.current) return;
      if (city.id === selectedRef.current) {
        requestClose();
        return;
      }
      selectRef.current(city.id);
      requestClose();
    },
    [requestClose],
  );

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

  const emptyComponent = useMemo(
    () => (
      <View style={styles.emptyContainer}>
        <MapPinOff size={28} color={scheme.onSurfaceVariant} />
        <Text style={styles.emptyTitle}>{s.city.noSearchResults(query.trim())}</Text>
        <Text style={styles.emptySub}>{s.city.searchEmptyHint}</Text>
      </View>
    ),
    [query, s],
  );

  return (
    <View
      style={[
        StyleSheet.absoluteFill,
        styles.overlay,
        { paddingTop: insets.top, paddingBottom: extraKeyboardInset },
      ]}
      onLayout={handleOverlayLayout}
      accessibilityViewIsModal
    >
      <Animated.View style={[StyleSheet.absoluteFill, styles.backdrop, backdropAnimatedStyle]}>
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={() => requestClose()}
          accessibilityRole="button"
          accessibilityLabel={s.city.closeSheetA11y}
        />
      </Animated.View>

      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.kav}
        pointerEvents="box-none"
      >
        <Animated.View style={[styles.sheet, { height: targetSheetHeight }, sheetAnimatedStyle]}>
          <View style={styles.container}>
            <GestureDetector gesture={dismissPanGesture}>
              <View collapsable={false}>
                <View style={styles.handleRow}>
                  <View style={styles.handle} />
                </View>
                <View style={styles.header}>
                  <View style={styles.headerText}>
                    <Text style={styles.title} accessibilityRole="header">
                      {s.city.selectTitle}
                    </Text>
                    <Text style={styles.subtitle}>{s.city.selectSub}</Text>
                  </View>
                </View>
              </View>
            </GestureDetector>

            <SpringPressable
              onPress={() => requestClose()}
              hitSlop={8}
              scaleDelta={0.06}
              style={styles.closeBtn}
              accessibilityRole="button"
              accessibilityLabel={s.city.closeSheetA11y}
            >
              <X size={20} color={scheme.onSurfaceVariant} />
            </SpringPressable>

            <View style={styles.searchBox}>
              <Search size={18} color={scheme.onSurfaceVariant} />
              <TextInput
                value={query}
                onChangeText={setQuery}
                placeholder={s.city.searchPlaceholder}
                accessibilityLabel={s.city.searchPlaceholder}
                placeholderTextColor={scheme.onSurfaceVariant}
                style={styles.searchInput}
                autoCorrect={false}
                autoCapitalize="none"
                returnKeyType="search"
                clearButtonMode="never"
                onSubmitEditing={() => {
                  if (filteredCities.length > 0) {
                    handleCityPress(filteredCities[0].city);
                  }
                }}
              />
              {query.length > 0 ? (
                <SpringPressable
                  onPress={() => setQuery('')}
                  hitSlop={8}
                  scaleDelta={0.06}
                  haptic="selection"
                  style={styles.searchClearBtn}
                  accessibilityRole="button"
                  accessibilityLabel={s.city.searchClearA11y}
                >
                  <X size={16} color={scheme.onSurfaceVariant} />
                </SpringPressable>
              ) : null}
            </View>

            <FlatList
              data={filteredCities}
              keyExtractor={keyExtractor}
              keyboardShouldPersistTaps="handled"
              keyboardDismissMode="on-drag"
              overScrollMode="never"
              showsVerticalScrollIndicator
              removeClippedSubviews={Platform.OS === 'android'}
              initialNumToRender={12}
              maxToRenderPerBatch={12}
              updateCellsBatchingPeriod={16}
              windowSize={9}
              style={styles.list}
              contentContainerStyle={listContentStyle}
              renderItem={renderItem}
              ListEmptyComponent={emptyComponent}
            />
          </View>
        </Animated.View>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    zIndex: 100,
    elevation: 24,
  },
  backdrop: {
    backgroundColor: '#000000',
  },
  kav: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  sheet: {
    maxHeight: '100%',
    borderTopLeftRadius: shape.extraLarge,
    borderTopRightRadius: shape.extraLarge,
    backgroundColor: scheme.surfaceContainerLow,
    overflow: 'hidden',
  },
  container: {
    flex: 1,
    paddingHorizontal: 20,
  },
  handleRow: {
    alignItems: 'center',
    paddingTop: 12,
    paddingBottom: 14,
  },
  handle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: scheme.outlineVariant,
  },
  header: {
    paddingRight: 56,
    marginBottom: 20,
  },
  headerText: {
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
    position: 'absolute',
    top: 22,
    right: 20,
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
  cityItemPressed: {
    backgroundColor: scheme.surfaceContainerHigh,
    transform: [{ scale: 0.992 }],
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
