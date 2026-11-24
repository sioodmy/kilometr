import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  AppState,
  BackHandler,
  FlatList,
  KeyboardAvoidingView,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
  type ListRenderItem,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import Constants from 'expo-constants';
import * as Location from 'expo-location';
import Animated, {
  FadeIn,
  FadeInDown,
  LinearTransition,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import {
  Bell,
  Briefcase,
  Check,
  ChevronRight,
  Download,
  GraduationCap,
  Home,
  LocateFixed,
  M3SolidArrowRight,
  MapPin,
  MapPinOff,
  Search,
  X,
} from '../src/components/icons';
import { MorphingLoader } from '../src/components/MorphingLoader';
import { HERO_LOGO_SIZE, OnboardingMorphHero } from '../src/components/OnboardingMorphHero';
import { OnboardingProgressBar } from '../src/components/OnboardingProgressBar';
import { SpringPressable } from '../src/components/SpringPressable';
import { TimetableBackgroundPill } from '../src/components/TimetableBackgroundPill';
import { suggestionDisplayTitle } from '../src/components/SuggestionRow';
import { useWebLayout } from '../src/theme/layout';
import { motion } from '../src/theme/motion';
import { elev, scheme, shape, type } from '../src/theme/tokens';
import { useStrings } from '../src/i18n';
import type { CityId } from '../src/cities';
import { useActiveCity } from '../src/services/cityStore';
import {
  POPULAR_CITY_IDS,
  filterCityEntries,
  getCityEntries,
  type CityEntry,
} from '../src/services/citySearch';
import { suggestCityForGps } from '../src/services/serviceArea';
import { setOnboardingSeen } from '../src/services/onboarding';
import {
  areNotificationsSupported,
  ensureNotificationPermission,
  hasNotificationPermission,
} from '../src/services/notifications';
import { FavoritesService, SearchService } from '../src/services';
import {
  getDataStatus,
  importGtfsFromNetwork,
  refreshDataStatus,
  subscribeDataStatus,
  type DataStatus,
} from '../src/services/dataManager';
import type { SavedPlace, Suggestion } from '../src/types/models';

type StepIndex = 0 | 1 | 2 | 3;

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

const NOTIF_SUPPORTED =
  Platform.OS === 'web' ? areNotificationsSupported() : Constants.appOwnership !== 'expo';

function detectDefaultPwaPlatform(): 'ios' | 'android' {
  if (typeof navigator !== 'undefined' && /iPad|iPhone|iPod/i.test(navigator.userAgent)) {
    return 'ios';
  }
  return 'android';
}

function isRunningStandaloneWeb(): boolean {
  if (Platform.OS !== 'web' || typeof window === 'undefined') return false;
  const nav = window.navigator as Navigator & { standalone?: boolean };
  return (
    window.matchMedia?.('(display-mode: standalone)').matches === true || nav.standalone === true
  );
}

/** Śledzi wysokość wirtualnej klawiatury w przeglądarkach mobilnych (visualViewport). */
function useWebKeyboardInset(): number {
  const [inset, setInset] = useState(0);

  useEffect(() => {
    if (Platform.OS !== 'web' || typeof window === 'undefined' || !window.visualViewport) return;
    const vv = window.visualViewport;
    const update = () => {
      const diff = Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop));
      setInset(diff > 60 ? diff : 0);
    };
    update();
    vv.addEventListener('resize', update);
    vv.addEventListener('scroll', update);
    return () => {
      vv.removeEventListener('resize', update);
      vv.removeEventListener('scroll', update);
    };
  }, []);

  return inset;
}

/** Kierunkowe przejście M3 Expressive (Shared Axis X) między krokami onboardingu. */
function StepStage({
  step,
  direction,
  children,
}: {
  step: StepIndex;
  direction: 1 | -1;
  children: React.ReactNode;
}) {
  const reduceMotion = useReducedMotion();
  const translateX = useSharedValue(reduceMotion ? 0 : direction * 28);
  const opacity = useSharedValue(reduceMotion ? 1 : 0);
  const scale = useSharedValue(reduceMotion ? 1 : 0.985);

  useEffect(() => {
    if (reduceMotion) {
      translateX.value = 0;
      opacity.value = 1;
      scale.value = 1;
      return;
    }
    translateX.value = direction * 28;
    opacity.value = 0;
    scale.value = 0.985;
    translateX.value = withSpring(0, motion.spring.spatialDefault);
    scale.value = withSpring(1, motion.spring.spatialDefault);
    opacity.value = withTiming(1, { duration: 220, easing: motion.enter.easing });
  }, [direction, opacity, reduceMotion, scale, step, translateX]);

  const animStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ translateX: translateX.value }, { scale: scale.value }],
  }));

  return <Animated.View style={[st.stepStage, animStyle]}>{children}</Animated.View>;
}

/** Animowany nagłówek dla kroków 1..3 siedzący po lewej stronie morfującego medalionu. */
function AnimatedStepHeader({
  step,
  direction,
  title,
  subtitle,
  onMeasured,
}: {
  step: StepIndex;
  direction: 1 | -1;
  title: string;
  subtitle: string;
  onMeasured: (height: number) => void;
}) {
  const reduceMotion = useReducedMotion();
  const tx = useSharedValue(reduceMotion ? 0 : direction * 18);
  const op = useSharedValue(reduceMotion ? 1 : 0);

  useEffect(() => {
    if (reduceMotion) {
      tx.value = 0;
      op.value = 1;
      return;
    }
    tx.value = direction * 18;
    op.value = 0;
    tx.value = withSpring(0, motion.spring.spatialDefault);
    op.value = withTiming(1, { duration: 200, easing: motion.enter.easing });
  }, [direction, op, reduceMotion, step, tx]);

  const animStyle = useAnimatedStyle(() => ({
    opacity: op.value,
    transform: [{ translateX: tx.value }],
  }));

  return (
    <Animated.View
      style={[st.compactHeaderBox, animStyle]}
      onLayout={(e) => {
        const h = Math.ceil(e.nativeEvent.layout.height);
        if (h > 0) onMeasured(Math.max(76, h + 6));
      }}
    >
      <Text style={st.stepTitle}>{title}</Text>
      <Text style={st.stepSubtitle}>{subtitle}</Text>
    </Animated.View>
  );
}

function PrimaryBtn({
  label,
  onPress,
  disabled,
  icon,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  icon?: React.ReactNode;
}) {
  return (
    <SpringPressable
      onPress={onPress}
      disabled={disabled}
      haptic="light"
      scaleDelta={0.02}
      style={[st.primary, disabled && st.primaryDisabled]}
      accessibilityRole="button"
      accessibilityState={{ disabled: Boolean(disabled) }}
    >
      <Text style={[st.primaryText, disabled && st.primaryTextDisabled]}>{label}</Text>
      {icon}
    </SpringPressable>
  );
}

function WebPwaInstallCard({ onInstalled }: { onInstalled: () => void }) {
  const s = useStrings();
  const [tab, setTab] = useState<'ios' | 'android'>(() => detectDefaultPwaPlatform());
  const [standalone, setStandalone] = useState(() => isRunningStandaloneWeb());
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);

  useEffect(() => {
    if (Platform.OS !== 'web' || typeof window === 'undefined') return;
    setStandalone(isRunningStandaloneWeb());
    const onPrompt = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
    };
    const handleInstalled = () => {
      setStandalone(true);
      setDeferredPrompt(null);
      onInstalled();
    };
    window.addEventListener('beforeinstallprompt', onPrompt);
    window.addEventListener('appinstalled', handleInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt);
      window.removeEventListener('appinstalled', handleInstalled);
    };
  }, [onInstalled]);

  const stepsList =
    tab === 'ios'
      ? [s.onboarding.pwaIos1, s.onboarding.pwaIos2, s.onboarding.pwaIos3]
      : [s.onboarding.pwaAndroid1, s.onboarding.pwaAndroid2, s.onboarding.pwaAndroid3];

  if (standalone) {
    return (
      <View style={[st.card, st.cardGranted]}>
        <View style={st.cardHead}>
          <View style={[st.cardIcon, st.cardIconSuccess]}>
            <Check size={20} color={scheme.onSuccessContainer} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={st.cardTitle}>{s.onboarding.pwaTitle}</Text>
            <Text style={st.doneText}>{s.onboarding.pwaInstalled}</Text>
          </View>
        </View>
      </View>
    );
  }

  return (
    <View style={st.card}>
      <View style={st.cardHead}>
        <View style={st.cardIcon}>
          <Download size={20} color={scheme.onSecondaryContainer} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={st.cardTitle}>{s.onboarding.pwaTitle}</Text>
        </View>
      </View>
      <Text style={st.cardBody}>{s.onboarding.pwaSub}</Text>

      {deferredPrompt && (
        <SpringPressable
          onPress={async () => {
            try {
              await deferredPrompt.prompt();
              const choice = await deferredPrompt.userChoice;
              if (choice.outcome === 'accepted') {
                setStandalone(true);
                setDeferredPrompt(null);
                onInstalled();
              }
            } catch {}
          }}
          haptic="light"
          accessibilityRole="button"
          style={st.allow}
        >
          <Download size={17} color={scheme.onPrimary} />
          <Text style={st.allowText}>{s.onboarding.pwaInstallBtn}</Text>
        </SpringPressable>
      )}

      <View style={st.pwaTabs} accessibilityRole="tablist">
        <Pressable
          onPress={() => setTab('android')}
          accessibilityRole="tab"
          accessibilityState={{ selected: tab === 'android' }}
          style={[st.pwaTab, tab === 'android' && st.pwaTabActive]}
        >
          <Text style={[st.pwaTabText, tab === 'android' && st.pwaTabTextActive]}>
            {s.onboarding.pwaTabAndroid}
          </Text>
        </Pressable>
        <Pressable
          onPress={() => setTab('ios')}
          accessibilityRole="tab"
          accessibilityState={{ selected: tab === 'ios' }}
          style={[st.pwaTab, tab === 'ios' && st.pwaTabActive]}
        >
          <Text style={[st.pwaTabText, tab === 'ios' && st.pwaTabTextActive]}>
            {s.onboarding.pwaTabIos}
          </Text>
        </Pressable>
      </View>

      <View style={st.pwaStepList}>
        {stepsList.map((text, idx) => (
          <View key={idx} style={st.pwaStepRow}>
            <View style={st.pwaStepBadge}>
              <Text style={st.pwaStepNum}>{idx + 1}</Text>
            </View>
            <Text style={st.pwaStepText}>{text}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

function usePermissionStates(onGranted: () => void) {
  const [loc, setLoc] = useState<'unknown' | 'granted' | 'denied'>('unknown');
  const [notif, setNotif] = useState<'unknown' | 'granted' | 'denied'>('unknown');
  const [busy, setBusy] = useState<'loc' | 'notif' | null>(null);
  const [locCanAskAgain, setLocCanAskAgain] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const l = await Location.getForegroundPermissionsAsync();
      setLoc(l.granted ? 'granted' : l.status === 'denied' ? 'denied' : 'unknown');
      setLocCanAskAgain(l.canAskAgain);
    } catch {
      setLoc('unknown');
    }
    try {
      if (!NOTIF_SUPPORTED) {
        setNotif('unknown');
        return;
      }
      const granted = await hasNotificationPermission();
      setNotif((previous) => (granted ? 'granted' : previous === 'denied' ? 'denied' : 'unknown'));
    } catch {
      setNotif('unknown');
    }
  }, []);

  useEffect(() => {
    void refresh();
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') void refresh();
    });
    return () => subscription.remove();
  }, [refresh]);

  const requestLoc = useCallback(async () => {
    setBusy('loc');
    try {
      if (!locCanAskAgain) {
        if (Platform.OS !== 'web') await Linking.openSettings();
        return false;
      }
      const r = await Location.requestForegroundPermissionsAsync();
      const ok = r.granted;
      setLoc(ok ? 'granted' : 'denied');
      setLocCanAskAgain(r.canAskAgain);
      if (ok) onGranted();
      return ok;
    } catch {
      setLoc('denied');
      return false;
    } finally {
      setBusy(null);
    }
  }, [locCanAskAgain, onGranted]);

  const requestNotif = useCallback(async () => {
    if (!NOTIF_SUPPORTED) return false;
    setBusy('notif');
    try {
      if (notif === 'denied') {
        if (Platform.OS !== 'web') await Linking.openSettings();
        return false;
      }
      const ok = await ensureNotificationPermission();
      setNotif(ok ? 'granted' : 'denied');
      if (ok) onGranted();
      return ok;
    } catch {
      setNotif('denied');
      return false;
    } finally {
      setBusy(null);
    }
  }, [notif, onGranted]);

  return { loc, notif, busy, locCanAskAgain, requestLoc, requestNotif };
}

function useCitySuggestion(locGranted: boolean) {
  const [suggested, setSuggested] = useState<CityId | null>(null);
  const [status, setStatus] = useState<'idle' | 'locating' | 'nomatch'>('idle');

  useEffect(() => {
    if (!locGranted) {
      setSuggested(null);
      setStatus('idle');
      return;
    }
    let live = true;
    setStatus('locating');
    void (async () => {
      try {
        const pos = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Balanced,
        });
        const hit = suggestCityForGps(pos.coords.latitude, pos.coords.longitude);
        if (!live) return;
        if (hit) {
          setSuggested(hit.id);
          setStatus('idle');
        } else {
          setStatus('nomatch');
        }
      } catch {
        if (live) setStatus('nomatch');
      }
    })();
    return () => {
      live = false;
    };
  }, [locGranted]);

  return { suggested, status };
}

type SlotKey = 'home' | 'work' | 'school';
const SLOT_KEYS: readonly SlotKey[] = ['home', 'work', 'school'];

function useOnboardingPlaces(onSaved: () => void) {
  const s = useStrings();
  const [places, setPlaces] = useState<SavedPlace[]>([]);
  const [activeSlot, setActiveSlot] = useState<SlotKey | null>(null);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Suggestion[]>([]);
  const [searching, setSearching] = useState(false);
  const searchSeq = useRef(0);
  const [saving, setSaving] = useState(false);

  const reload = useCallback(async () => {
    try {
      setPlaces(await FavoritesService.list());
    } catch {
      setPlaces([]);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  useEffect(() => {
    const seq = ++searchSeq.current;
    if (!activeSlot) return;
    const q = query.trim();
    if (!q) {
      setResults([]);
      setSearching(false);
      return;
    }
    setSearching(true);
    SearchService.search(q, undefined, 'onboarding', (partial) => {
      if (seq === searchSeq.current) setResults(partial);
    })
      .then((r) => {
        if (seq === searchSeq.current) setResults(r);
      })
      .catch(() => {
        if (seq === searchSeq.current) setResults([]);
      })
      .finally(() => {
        if (seq === searchSeq.current) setSearching(false);
      });
    return () => {
      ++searchSeq.current;
      SearchService.cancel('onboarding');
    };
  }, [query, activeSlot]);

  const bySlot = useMemo(() => {
    const slotNames: Record<SlotKey, string> = {
      home: s.onboarding.slotHome,
      work: s.onboarding.slotWork,
      school: s.onboarding.slotUni,
    };
    const map = {} as Record<SlotKey, SavedPlace | undefined>;
    for (const key of SLOT_KEYS) {
      map[key] =
        places.find((p) => p.icon === key) ??
        places.find((p) => p.name.toLowerCase() === slotNames[key].toLowerCase());
    }
    return map;
  }, [places, s]);

  const saveForSlot = useCallback(
    async (slot: SlotKey, sug: Suggestion) => {
      const slotNames: Record<SlotKey, string> = {
        home: s.onboarding.slotHome,
        work: s.onboarding.slotWork,
        school: s.onboarding.slotUni,
      };
      setSaving(true);
      try {
        await FavoritesService.addPlace({
          name: slotNames[slot],
          icon: slot,
          address: sug.address || sug.title,
          lat: sug.lat,
          lon: sug.lon,
        });
        await reload();
        setActiveSlot(null);
        setQuery('');
        setResults([]);
        onSaved();
      } catch {
        Alert.alert(s.onboarding.saveFail, s.onboarding.saveFailBody);
      } finally {
        setSaving(false);
      }
    },
    [onSaved, reload, s],
  );

  const remove = useCallback(
    async (id: string) => {
      try {
        await FavoritesService.deletePlace(id);
      } catch (err) {
        console.warn('[onboarding remove error]', err);
        Alert.alert(s.common.storageFailTitle, s.common.storageFailBody);
        return;
      }
      await reload();
    },
    [reload, s],
  );

  return {
    places,
    bySlot,
    activeSlot,
    setActiveSlot,
    query,
    setQuery,
    results,
    searching,
    saving,
    saveForSlot,
    remove,
  };
}

const CityRowItem = memo(function CityRowItem({
  entry,
  active,
  isSuggested,
  disabled,
  gpsBadgeLabel,
  pickA11y,
  suggestedA11y,
  onSelect,
}: {
  entry: CityEntry;
  active: boolean;
  isSuggested: boolean;
  disabled: boolean;
  gpsBadgeLabel: string;
  pickA11y: string;
  suggestedA11y?: string;
  onSelect: (id: CityId) => void;
}) {
  const handlePress = useCallback(() => onSelect(entry.city.id), [entry.city.id, onSelect]);

  return (
    <SpringPressable
      onPress={handlePress}
      disabled={disabled}
      haptic="selection"
      scaleDelta={0.015}
      style={[st.cityRow, active && st.cityRowActive]}
      accessibilityRole="radio"
      accessibilityState={{ checked: active, disabled }}
      accessibilityLabel={pickA11y}
      accessibilityHint={suggestedA11y}
    >
      <View style={st.cityRowBody}>
        <View style={st.cityNameLine}>
          <Text style={[st.cityName, active && st.cityNameActive]} numberOfLines={1}>
            {entry.name}
          </Text>
          {isSuggested && (
            <View style={[st.gpsTag, active && st.gpsTagActive]}>
              <LocateFixed
                size={11}
                color={active ? scheme.onPrimary : scheme.onPrimaryContainer}
              />
              <Text style={[st.gpsTagText, active && st.gpsTagTextActive]}>{gpsBadgeLabel}</Text>
            </View>
          )}
        </View>
        <Text style={[st.citySub, active && st.citySubActive]} numberOfLines={1}>
          {entry.feeds}
        </Text>
      </View>
      <View style={[st.radio, active && st.radioActive]}>
        {active && <Check size={14} color={scheme.onPrimary} />}
      </View>
    </SpringPressable>
  );
});

const cityKeyExtractor = (entry: CityEntry) => entry.city.id;

export default function OnboardingScreen() {
  const s = useStrings();
  const router = useRouter();
  const webLayout = useWebLayout();
  const { sharedTrip } = useLocalSearchParams<{ sharedTrip?: string }>();
  const { width, height, fontScale } = useWindowDimensions();
  const compact = width / fontScale < 360;
  const reduceMotion = useReducedMotion();
  const webKeyboardInset = useWebKeyboardInset();

  const [step, setStep] = useState<StepIndex>(0);
  const [direction, setDirection] = useState<1 | -1>(1);
  const [pulseKey, setPulseKey] = useState(0);
  const [workspaceWidth, setWorkspaceWidth] = useState(() => Math.min(width, 560));
  const [workspaceHeight, setWorkspaceHeight] = useState(() => Math.max(360, height - 200));
  const [welcomeGroupHeight, setWelcomeGroupHeight] = useState(276);
  const [compactHeaderHeight, setCompactHeaderHeight] = useState(86);
  const [leaving, setLeaving] = useState(false);

  const bumpPulse = useCallback(() => setPulseKey((k) => k + 1), []);

  const perms = usePermissionStates(bumpPulse);
  const { cityId, setCity } = useActiveCity();
  const [switchingCity, setSwitchingCity] = useState(false);
  const [cityQuery, setCityQuery] = useState('');
  const { suggested, status: citySuggestionStatus } = useCitySuggestion(perms.loc === 'granted');

  const [dataStatus, setDataStatus] = useState<DataStatus>(() => getDataStatus());
  const [timetableTouched, setTimetableTouched] = useState(false);
  const [checkingTimetable, setCheckingTimetable] = useState(false);
  const manualCityPickedRef = useRef(false);
  const prefetchedCityRef = useRef<CityId | null>(null);

  const slots = useOnboardingPlaces(bumpPulse);
  const cityGen = s.city.gen(cityId);
  const savedCount = slots.places.length;

  useEffect(() => {
    return subscribeDataStatus(setDataStatus);
  }, []);

  /** Ciche pobranie rozkładu wybranego miasta w tle bez osobnego ekranu ładowania. */
  const prefetchTimetable = useCallback(async (targetCityId: CityId, force = false) => {
    if (!force && prefetchedCityRef.current === targetCityId) {
      const cur = getDataStatus();
      if (cur.state !== 'empty' && cur.state !== 'error') return;
    }
    prefetchedCityRef.current = targetCityId;
    setTimetableTouched(true);
    setCheckingTimetable(true);
    try {
      const stNow = await refreshDataStatus(targetCityId);
      if (stNow.state === 'empty') {
        await importGtfsFromNetwork(targetCityId);
      }
      void import('../src/services/nationalTimetable')
        .then((m) => m.ensureNationalTimetable())
        .catch(() => {});
    } catch {
      // Status błędu pokaże TimetableBackgroundPill z przyciskiem ponowienia.
    } finally {
      setCheckingTimetable(false);
    }
  }, []);

  const selectCity = useCallback(
    async (id: CityId, source: 'manual' | 'gps' = 'manual') => {
      if (source === 'manual') manualCityPickedRef.current = true;
      if (switchingCity) return;
      if (id === cityId) {
        bumpPulse();
        void prefetchTimetable(id);
        return;
      }
      setSwitchingCity(true);
      try {
        await setCity(id);
        bumpPulse();
        void prefetchTimetable(id, true);
      } finally {
        setSwitchingCity(false);
      }
    },
    [bumpPulse, cityId, prefetchTimetable, setCity, switchingCity],
  );

  // Gdy GPS wykryje miasto na kroku wyboru i użytkownik sam jeszcze nie wybrał innego,
  // od razu je ustawiamy i cicho zaczynamy pobierać rozkład w tle.
  useEffect(() => {
    if (!suggested || step < 1 || manualCityPickedRef.current) return;
    void selectCity(suggested, 'gps');
  }, [selectCity, step, suggested]);

  const goTo = useCallback((nextStep: StepIndex) => {
    setStep((prev) => {
      if (prev === nextStep) return prev;
      setDirection(nextStep > prev ? 1 : -1);
      return nextStep;
    });
  }, []);

  const next = useCallback(() => {
    if (step === 1) {
      // Upewniamy się, że rozkład wybranego miasta pobiera się w tle przy wyjściu z wyboru miasta.
      void prefetchTimetable(cityId);
    }
    if (step < 3) goTo((step + 1) as StepIndex);
  }, [cityId, goTo, prefetchTimetable, step]);

  const back = useCallback(() => {
    if (step > 0) goTo((step - 1) as StepIndex);
  }, [goTo, step]);

  const finish = useCallback(async () => {
    if (leaving) return;
    setLeaving(true);
    void prefetchTimetable(cityId);
    await setOnboardingSeen();
    router.replace(sharedTrip ? { pathname: '/shared', params: { trip: sharedTrip } } : '/');
  }, [cityId, leaving, prefetchTimetable, router, sharedTrip]);

  const handleOpenPrivacy = useCallback(() => {
    router.push('/privacy');
  }, [router]);

  const retryPrefetch = useCallback(() => {
    void prefetchTimetable(cityId, true);
  }, [cityId, prefetchTimetable]);

  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (step === 0) return false;
      back();
      return true;
    });
    return () => sub.remove();
  }, [back, step]);

  const cityEntries = useMemo(() => getCityEntries(s), [s]);
  const filteredCities = useMemo(
    () => filterCityEntries(cityEntries, cityQuery, [suggested, cityId]),
    [cityEntries, cityId, cityQuery, suggested],
  );

  const renderCityItem = useCallback<ListRenderItem<CityEntry>>(
    ({ item }) => {
      const active = cityId === item.city.id;
      const isSuggested = suggested === item.city.id;
      return (
        <CityRowItem
          entry={item}
          active={active}
          isSuggested={isSuggested}
          disabled={switchingCity}
          gpsBadgeLabel={s.onboarding.detectGpsBadge}
          pickA11y={s.onboarding.cityPickA11y(item.name)}
          suggestedA11y={isSuggested ? s.onboarding.citySuggestedA11y(item.name) : undefined}
          onSelect={(id) => void selectCity(id, 'manual')}
        />
      );
    },
    [cityId, s, selectCity, suggested, switchingCity],
  );

  const placeSlots = useMemo(
    () => [
      {
        key: 'home' as SlotKey,
        name: s.onboarding.slotHome,
        icon: Home,
        hint: s.onboarding.slotHomeHint(cityId),
      },
      {
        key: 'work' as SlotKey,
        name: s.onboarding.slotWork,
        icon: Briefcase,
        hint: s.onboarding.slotWorkHint(cityId),
      },
      {
        key: 'school' as SlotKey,
        name: s.onboarding.slotUni,
        icon: GraduationCap,
        hint: s.onboarding.slotUniHint(cityId),
      },
    ],
    [cityId, s],
  );

  const placesScroll = useRef<ScrollView>(null);
  const slotY = useRef<Record<string, number>>({});
  const scrollSlotIntoView = useCallback((key: string) => {
    const y = slotY.current[key] ?? 0;
    setTimeout(() => {
      placesScroll.current?.scrollTo({ y: Math.max(0, y - 56), animated: true });
    }, 150);
  }, []);

  const compactHeaderMeta = useMemo(() => {
    if (step === 1) {
      return { title: s.onboarding.cityTitle, subtitle: s.onboarding.citySubtitleAuto };
    }
    if (step === 2) {
      return {
        title: s.onboarding.permTitle,
        subtitle: Platform.OS === 'web' ? s.onboarding.permSubWeb : s.onboarding.permSub,
      };
    }
    return { title: s.onboarding.placesTitle, subtitle: s.onboarding.placesBody };
  }, [s, step]);

  const showBackgroundPill = step >= 2 || (step === 1 && timetableTouched);

  // Środek Y loga na kroku powitalnym: idealnie w centrum całej kolumny (logo + teksty).
  const welcomeCenterY = Math.max(
    HERO_LOGO_SIZE / 2 + 12,
    (workspaceHeight - welcomeGroupHeight) / 2 + HERO_LOGO_SIZE / 2,
  );

  return (
    <SafeAreaView
      style={[st.safe, webLayout.isMedium && st.safeDesktop]}
      edges={['top', 'bottom']}
    >
      <View style={[st.shell, webLayout.isMedium && st.shellDesktop]}>
        <OnboardingProgressBar step={step} onBack={back} />

        <View
          style={st.workspace}
          onLayout={(e) => {
            const { width: w, height: h } = e.nativeEvent.layout;
            if (w > 0 && Math.abs(w - workspaceWidth) > 1) setWorkspaceWidth(Math.round(w));
            if (h > 0 && Math.abs(h - workspaceHeight) > 1) setWorkspaceHeight(Math.round(h));
          }}
        >
          {step === 0 && (
            <StepStage step={step} direction={direction}>
              <ScrollView
                contentContainerStyle={st.welcomeBody}
                showsVerticalScrollIndicator={false}
                overScrollMode="never"
              >
                <View
                  style={st.welcomeGroup}
                  onLayout={(e) => {
                    const h = Math.ceil(e.nativeEvent.layout.height);
                    if (h > 0 && Math.abs(h - welcomeGroupHeight) > 1) setWelcomeGroupHeight(h);
                  }}
                >
                  {/* Puste gniazdo, w którym spoczywa animowane logo z warstwy OnboardingMorphHero. */}
                  <View style={st.logoPlaceholder} />

                  <Animated.View
                    entering={reduceMotion ? undefined : FadeInDown.duration(300).delay(320)}
                    style={st.welcomeCopy}
                  >
                    <Text style={[st.brandHero, compact && st.brandHeroCompact]}>
                      {s.onboarding.brand}
                    </Text>
                    <Text style={st.tagline}>{s.onboarding.tagline}</Text>
                    <Text style={st.welcomeIntro}>{s.onboarding.intro}</Text>
                  </Animated.View>
                </View>
              </ScrollView>
            </StepStage>
          )}

          {step > 0 && (
            <View style={st.stepShell}>
              <View style={st.compactHeaderRow}>
                <AnimatedStepHeader
                  step={step}
                  direction={direction}
                  title={compactHeaderMeta.title}
                  subtitle={compactHeaderMeta.subtitle}
                  onMeasured={setCompactHeaderHeight}
                />
              </View>

              <View style={st.contentArea}>

          {step === 1 && (
            <StepStage step={step} direction={direction}>
              <View style={st.cityStep}>
                {/* Kontekstowa karta GPS: prosi o lokalizację dokładnie tam, gdzie oszczędza czas. */}
                <View style={st.cityControls}>
                  {perms.loc !== 'granted' ? (
                    <SpringPressable
                      onPress={() => void perms.requestLoc()}
                      disabled={perms.busy !== null}
                      haptic="selection"
                      style={st.gpsCard}
                      accessibilityRole="button"
                      accessibilityState={{
                        disabled: perms.busy !== null,
                        busy: perms.busy === 'loc',
                      }}
                    >
                      <View style={st.gpsIconCircle}>
                        {perms.busy === 'loc' ? (
                          <MorphingLoader size={18} color={scheme.onPrimaryContainer} />
                        ) : (
                          <LocateFixed size={19} color={scheme.onPrimaryContainer} />
                        )}
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={st.gpsCardTitle}>
                          {perms.locCanAskAgain
                            ? s.onboarding.detectGpsAction
                            : s.onboarding.openSettings}
                        </Text>
                        <Text style={st.gpsCardSub} numberOfLines={2}>
                          {!perms.locCanAskAgain
                            ? s.onboarding.cityNoGps
                            : s.onboarding.detectGpsHint}
                        </Text>
                      </View>
                      <ChevronRight size={18} color={scheme.primary} />
                    </SpringPressable>
                  ) : citySuggestionStatus === 'locating' ? (
                    <View style={st.gpsStatusRow}>
                      <MorphingLoader size={16} color={scheme.primary} />
                      <Text style={st.gpsStatusText}>{s.onboarding.cityLocating}</Text>
                    </View>
                  ) : suggested ? (
                    <SpringPressable
                      onPress={() => void selectCity(suggested, 'manual')}
                      haptic="selection"
                      style={[st.gpsStatusRow, st.gpsStatusMatched]}
                      accessibilityRole="button"
                    >
                      <LocateFixed size={15} color={scheme.primary} />
                      <Text style={st.gpsStatusText} numberOfLines={1}>
                        {s.onboarding.citySuggested(s.city.loc(suggested))}
                      </Text>
                      {suggested === cityId && <Check size={15} color={scheme.primary} />}
                    </SpringPressable>
                  ) : citySuggestionStatus === 'nomatch' ? (
                    <View style={st.gpsStatusRow}>
                      <MapPinOff size={15} color={scheme.onSurfaceVariant} />
                      <Text style={st.gpsStatusMuted}>{s.onboarding.cityNoMatch}</Text>
                    </View>
                  ) : null}

                  {/* Wyszukiwarka 132 miast z obsługą aliasów (np. Gdańsk -> Trójmiasto, Katowice -> GZM). */}
                  <View style={st.searchBar}>
                    <Search size={18} color={scheme.onSurfaceVariant} />
                    <TextInput
                      value={cityQuery}
                      onChangeText={setCityQuery}
                      placeholder={s.onboarding.citySearchPlaceholder}
                      placeholderTextColor={scheme.onSurfaceVariant}
                      accessibilityLabel={s.onboarding.citySearchPlaceholder}
                      style={st.searchBarInput}
                      returnKeyType="search"
                      autoCorrect={false}
                    />
                    {cityQuery.length > 0 && (
                      <Pressable
                        onPress={() => setCityQuery('')}
                        hitSlop={8}
                        style={st.clearBtn}
                        accessibilityRole="button"
                        accessibilityLabel={s.onboarding.cityClearSearchA11y}
                      >
                        <X size={16} color={scheme.onSurfaceVariant} />
                      </Pressable>
                    )}
                  </View>

                  {/* Szybkie chipy największych sieci, gdy pole wyszukiwania jest puste. */}
                  {cityQuery.trim().length === 0 && (
                    <ScrollView
                      horizontal
                      showsHorizontalScrollIndicator={false}
                      contentContainerStyle={st.popularRow}
                      keyboardShouldPersistTaps="handled"
                    >
                      {POPULAR_CITY_IDS.map((id) => {
                        const active = cityId === id;
                        return (
                          <SpringPressable
                            key={id}
                            onPress={() => void selectCity(id, 'manual')}
                            disabled={switchingCity}
                            haptic="selection"
                            scaleDelta={0.04}
                            style={[st.popularChip, active && st.popularChipActive]}
                            accessibilityRole="radio"
                            accessibilityState={{ checked: active }}
                          >
                            <Text style={[st.popularChipText, active && st.popularChipTextActive]}>
                              {s.city.name(id)}
                            </Text>
                          </SpringPressable>
                        );
                      })}
                    </ScrollView>
                  )}
                </View>

                <FlatList
                  data={filteredCities}
                  keyExtractor={cityKeyExtractor}
                  style={st.cityList}
                  contentContainerStyle={st.cityListContent}
                  showsVerticalScrollIndicator={false}
                  overScrollMode="never"
                  keyboardShouldPersistTaps="handled"
                  keyboardDismissMode="on-drag"
                  accessibilityRole="radiogroup"
                  renderItem={renderCityItem}
                  ListEmptyComponent={
                    <View style={st.emptyCity}>
                      <MapPinOff size={24} color={scheme.onSurfaceVariant} />
                      <Text style={st.emptyCityText}>
                        {s.onboarding.cityNoSearchMatch(cityQuery.trim())}
                      </Text>
                    </View>
                  }
                />
              </View>
            </StepStage>
          )}

          {step === 2 && (
            <StepStage step={step} direction={direction}>
              <ScrollView
                contentContainerStyle={st.stepScroll}
                showsVerticalScrollIndicator={false}
                overScrollMode="never"
              >
                {Platform.OS === 'web' && <WebPwaInstallCard onInstalled={bumpPulse} />}

                <View style={[st.card, perms.loc === 'granted' && st.cardGranted]}>
                  <View style={st.cardHead}>
                    <View
                      style={[st.cardIcon, perms.loc === 'granted' && st.cardIconSuccess]}
                    >
                      {perms.loc === 'granted' ? (
                        <Check size={20} color={scheme.onSuccessContainer} />
                      ) : (
                        <LocateFixed size={20} color={scheme.onSecondaryContainer} />
                      )}
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={st.cardTitle}>{s.onboarding.locTitle}</Text>
                      {perms.loc === 'granted' && (
                        <Text style={st.doneText}>{s.onboarding.locOn}</Text>
                      )}
                    </View>
                  </View>

                  {perms.loc !== 'granted' && (
                    <>
                      <Text style={st.cardBody}>{s.onboarding.locBody}</Text>
                      {perms.loc === 'denied' && (
                        <Text style={st.fine}>{s.onboarding.permissionDenied}</Text>
                      )}
                      <SpringPressable
                        onPress={() => void perms.requestLoc()}
                        disabled={perms.busy !== null}
                        haptic="selection"
                        accessibilityRole="button"
                        accessibilityState={{
                          disabled: perms.busy !== null,
                          busy: perms.busy === 'loc',
                        }}
                        style={st.allow}
                      >
                        {perms.busy === 'loc' ? (
                          <ActivityIndicator size="small" color={scheme.onPrimary} />
                        ) : (
                          <LocateFixed size={17} color={scheme.onPrimary} />
                        )}
                        <Text style={st.allowText}>
                          {perms.locCanAskAgain
                            ? s.onboarding.locAllow
                            : s.onboarding.openSettings}
                        </Text>
                      </SpringPressable>
                    </>
                  )}
                </View>

                {Platform.OS !== 'web' && (
                  <View style={[st.card, perms.notif === 'granted' && st.cardGranted]}>
                    <View style={st.cardHead}>
                      <View
                        style={[st.cardIcon, perms.notif === 'granted' && st.cardIconSuccess]}
                      >
                        {perms.notif === 'granted' ? (
                          <Check size={20} color={scheme.onSuccessContainer} />
                        ) : (
                          <Bell size={20} color={scheme.onSecondaryContainer} />
                        )}
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={st.cardTitle}>{s.onboarding.notifTitle}</Text>
                        {perms.notif === 'granted' && (
                          <Text style={st.doneText}>{s.onboarding.notifOn}</Text>
                        )}
                      </View>
                    </View>

                    {perms.notif !== 'granted' && (
                      <>
                        <Text style={st.cardBody}>{s.onboarding.notifBody}</Text>
                        {perms.notif === 'denied' && (
                          <Text style={st.fine}>{s.onboarding.permissionDenied}</Text>
                        )}
                        {!NOTIF_SUPPORTED ? (
                          <Text style={st.fine}>{s.onboarding.notifExpoGo}</Text>
                        ) : (
                          <SpringPressable
                            onPress={() => void perms.requestNotif()}
                            disabled={perms.busy !== null}
                            haptic="selection"
                            accessibilityRole="button"
                            accessibilityState={{
                              disabled: perms.busy !== null,
                              busy: perms.busy === 'notif',
                            }}
                            style={st.allow}
                          >
                            {perms.busy === 'notif' ? (
                              <ActivityIndicator size="small" color={scheme.onPrimary} />
                            ) : (
                              <Bell size={17} color={scheme.onPrimary} />
                            )}
                            <Text style={st.allowText}>
                              {perms.notif === 'denied'
                                ? s.onboarding.openSettings
                                : s.onboarding.notifAllow}
                            </Text>
                          </SpringPressable>
                        )}
                      </>
                    )}
                  </View>
                )}

                <Pressable
                  onPress={handleOpenPrivacy}
                  accessibilityRole="link"
                  style={({ pressed }) => [st.privacyLink, pressed && { opacity: 0.7 }]}
                >
                  <Text style={st.privacyText}>{s.landing.privacy.linkLabel}</Text>
                </Pressable>
              </ScrollView>
            </StepStage>
          )}

          {step === 3 && (
            <StepStage step={step} direction={direction}>
              <KeyboardAvoidingView
                style={{ flex: 1 }}
                behavior={Platform.OS === 'ios' ? 'padding' : undefined}
                keyboardVerticalOffset={80}
              >
                <ScrollView
                  ref={placesScroll}
                  contentContainerStyle={[
                    st.stepScroll,
                    { paddingBottom: 180 + webKeyboardInset },
                  ]}
                  showsVerticalScrollIndicator={false}
                  overScrollMode="never"
                  keyboardShouldPersistTaps="handled"
                  keyboardDismissMode="on-drag"
                >
                  {placeSlots.map((slot) => {
                    const Icon = slot.icon;
                    const saved = slots.bySlot[slot.key];
                    const open = slots.activeSlot === slot.key;
                    return (
                      <Animated.View
                        key={slot.key}
                        layout={
                          reduceMotion
                            ? undefined
                            : LinearTransition.springify().damping(24).stiffness(300)
                        }
                        style={[st.card, saved && st.cardGranted, open && st.cardFocused]}
                        onLayout={(e) => {
                          slotY.current[slot.key] = e.nativeEvent.layout.y;
                        }}
                      >
                        <View style={[st.slotRow, compact && st.slotRowCompact]}>
                          <View style={[st.cardIcon, saved && st.cardIconSuccess]}>
                            {saved ? (
                              <Check size={20} color={scheme.onSuccessContainer} />
                            ) : (
                              <Icon size={20} color={scheme.onSecondaryContainer} />
                            )}
                          </View>
                          <View style={{ flex: 1 }}>
                            <Text style={st.cardTitle}>{slot.name}</Text>
                            <Text
                              style={st.cardWhy}
                              numberOfLines={fontScale > 1.3 ? undefined : 2}
                            >
                              {saved ? saved.address : slot.hint}
                            </Text>
                          </View>
                          {saved ? (
                            <SpringPressable
                              onPress={() => void slots.remove(saved.id)}
                              haptic="selection"
                              hitSlop={8}
                              style={st.miniX}
                              accessibilityLabel={s.onboarding.removeSlotA11y(slot.name)}
                              accessibilityRole="button"
                            >
                              <X size={16} color={scheme.onSurfaceVariant} />
                            </SpringPressable>
                          ) : (
                            <SpringPressable
                              onPress={() => {
                                slots.setActiveSlot(open ? null : slot.key);
                                slots.setQuery('');
                              }}
                              haptic="selection"
                              style={[st.addPill, open && st.addPillOpen]}
                              accessibilityRole="button"
                            >
                              <Text style={[st.addPillText, open && st.addPillTextOpen]}>
                                {open ? s.onboarding.closeAction : s.onboarding.addAction}
                              </Text>
                            </SpringPressable>
                          )}
                        </View>

                        {open && !saved && (
                          <Animated.View
                            entering={reduceMotion ? undefined : FadeIn.duration(180)}
                            style={st.slotSearchArea}
                          >
                            <View style={st.searchBar}>
                              <Search size={17} color={scheme.onSurfaceVariant} />
                              <TextInput
                                value={slots.query}
                                onChangeText={slots.setQuery}
                                onFocus={() => scrollSlotIntoView(slot.key)}
                                placeholder={s.onboarding.addressFor(slot.name)}
                                accessibilityLabel={s.onboarding.addressFor(slot.name)}
                                placeholderTextColor={scheme.onSurfaceVariant}
                                style={st.searchBarInput}
                                autoFocus
                                returnKeyType="search"
                              />
                              {slots.searching && (
                                <MorphingLoader size={16} color={scheme.primary} />
                              )}
                            </View>

                            {slots.results.length === 0 &&
                              !slots.searching &&
                              slots.query.trim().length >= 2 && (
                                <View style={st.noResults}>
                                  <Text style={st.noResultsText}>
                                    {s.onboarding.noResults(slots.query.trim())}
                                  </Text>
                                </View>
                              )}

                            {slots.results.map((r) => (
                              <SpringPressable
                                key={r.id}
                                onPress={() => void slots.saveForSlot(slot.key, r)}
                                disabled={slots.saving}
                                haptic="selection"
                                accessibilityRole="button"
                                accessibilityState={{ disabled: slots.saving }}
                                style={st.resultRow}
                              >
                                <MapPin size={16} color={scheme.primary} />
                                <View style={{ flex: 1 }}>
                                  <Text
                                    style={st.resultTitle}
                                    numberOfLines={fontScale > 1.3 ? undefined : 2}
                                  >
                                    {suggestionDisplayTitle(r)}
                                  </Text>
                                  <Text
                                    style={st.resultSub}
                                    numberOfLines={fontScale > 1.3 ? undefined : 2}
                                  >
                                    {r.address}
                                  </Text>
                                </View>
                                {slots.saving ? (
                                  <ActivityIndicator size="small" color={scheme.primary} />
                                ) : (
                                  <ChevronRight size={16} color={scheme.onSurfaceVariant} />
                                )}
                              </SpringPressable>
                            ))}
                          </Animated.View>
                        )}
                      </Animated.View>
                    );
                  })}
                </ScrollView>
              </KeyboardAvoidingView>
            </StepStage>
          )}
              </View>
            </View>
          )}

          {/* Wspólna warstwa logo -> morfujący medalion transportowy na krokach 0..3. */}
          <OnboardingMorphHero
            step={step}
            workspaceWidth={workspaceWidth}
            welcomeCenterY={welcomeCenterY}
            compactHeaderHeight={compactHeaderHeight}
            pulseKey={pulseKey}
          />
        </View>

        <View
          style={[
            st.footer,
            webKeyboardInset > 0 && { paddingBottom: Math.max(12, webKeyboardInset + 8) },
          ]}
        >
          {showBackgroundPill && (
            <TimetableBackgroundPill
              cityGen={cityGen}
              status={dataStatus}
              checking={checkingTimetable}
              onRetry={retryPrefetch}
            />
          )}

          {step === 0 && (
            <>
              <PrimaryBtn
                label={s.onboarding.start}
                onPress={next}
                icon={<M3SolidArrowRight size={18} color={scheme.onPrimary} />}
              />
              <Pressable
                onPress={handleOpenPrivacy}
                accessibilityRole="link"
                style={({ pressed }) => [st.privacyLink, pressed && { opacity: 0.7 }]}
              >
                <Text style={st.privacyText}>{s.landing.privacy.linkLabel}</Text>
              </Pressable>
            </>
          )}

          {step === 1 && (
            <PrimaryBtn
              label={switchingCity ? s.city.switching : s.onboarding.next}
              onPress={next}
              disabled={switchingCity}
              icon={
                switchingCity ? (
                  <ActivityIndicator size="small" color={scheme.onSurfaceVariant} />
                ) : (
                  <M3SolidArrowRight size={18} color={scheme.onPrimary} />
                )
              }
            />
          )}

          {step === 2 && (
            <PrimaryBtn
              label={s.onboarding.next}
              onPress={next}
              icon={<M3SolidArrowRight size={18} color={scheme.onPrimary} />}
            />
          )}

          {step === 3 && (
            <PrimaryBtn
              label={
                savedCount > 0 ? s.onboarding.doneCount(savedCount) : s.onboarding.startUsing
              }
              onPress={() => void finish()}
              disabled={leaving}
              icon={
                savedCount > 0 ? (
                  <Check size={19} color={scheme.onPrimary} />
                ) : (
                  <M3SolidArrowRight size={18} color={scheme.onPrimary} />
                )
              }
            />
          )}
        </View>
      </View>
    </SafeAreaView>
  );
}

const st = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: scheme.surface,
  },
  safeDesktop: {
    backgroundColor: scheme.surfaceContainerLowest,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  shell: {
    flex: 1,
    width: '100%',
    maxWidth: 560,
    alignSelf: 'center',
    overflow: 'hidden',
  },
  shellDesktop: {
    maxWidth: 540,
    maxHeight: 780,
    borderRadius: 32,
    backgroundColor: scheme.surface,
    borderWidth: 1,
    borderColor: scheme.outlineVariant,
    ...elev.level3,
  },
  workspace: {
    flex: 1,
    position: 'relative',
    overflow: 'hidden',
  },
  stepShell: {
    flex: 1,
  },
  compactHeaderRow: {
    paddingLeft: 24,
    paddingRight: 96,
  },
  compactHeaderBox: {
    gap: 4,
    paddingVertical: 4,
  },
  stepTitle: {
    fontSize: 26,
    fontWeight: '700',
    color: scheme.onSurface,
    letterSpacing: -0.6,
    lineHeight: 32,
  },
  stepSubtitle: {
    ...type.bodyMedium,
    color: scheme.onSurfaceVariant,
    lineHeight: 20,
  },
  contentArea: {
    flex: 1,
    overflow: 'hidden',
  },
  stepStage: {
    flex: 1,
  },
  welcomeBody: {
    flexGrow: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 28,
    paddingVertical: 16,
  },
  welcomeGroup: {
    width: '100%',
    alignItems: 'center',
  },
  logoPlaceholder: {
    width: HERO_LOGO_SIZE,
    height: HERO_LOGO_SIZE,
    marginBottom: 28,
  },
  welcomeCopy: {
    alignItems: 'center',
    gap: 8,
  },
  brandHero: {
    fontSize: 46,
    fontWeight: '700',
    color: scheme.onSurface,
    letterSpacing: -1.8,
    textAlign: 'center',
  },
  brandHeroCompact: {
    fontSize: 38,
    letterSpacing: -1.2,
  },
  tagline: {
    fontSize: 21,
    lineHeight: 28,
    fontWeight: '600',
    color: scheme.primary,
    textAlign: 'center',
  },
  welcomeIntro: {
    ...type.bodyLarge,
    color: scheme.onSurfaceVariant,
    textAlign: 'center',
    lineHeight: 23,
    maxWidth: 300,
    marginTop: 6,
  },
  cityStep: {
    flex: 1,
  },
  cityControls: {
    paddingHorizontal: 24,
    paddingTop: 8,
    gap: 10,
  },
  gpsCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: scheme.surfaceContainerLow,
    borderRadius: shape.large,
    borderWidth: 1,
    borderColor: `${scheme.primary}44`,
    paddingHorizontal: 14,
    paddingVertical: 11,
    minHeight: 56,
  },
  gpsIconCircle: {
    width: 38,
    height: 38,
    borderRadius: shape.full,
    backgroundColor: scheme.primaryContainer,
    alignItems: 'center',
    justifyContent: 'center',
  },
  gpsCardTitle: {
    ...type.titleSmall,
    fontWeight: '600',
    color: scheme.onSurface,
  },
  gpsCardSub: {
    ...type.bodySmall,
    color: scheme.onSurfaceVariant,
    marginTop: 1,
  },
  gpsStatusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: scheme.surfaceContainerLow,
    borderRadius: shape.large,
    paddingHorizontal: 14,
    paddingVertical: 10,
    minHeight: 44,
  },
  gpsStatusMatched: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: `${scheme.primary}55`,
  },
  gpsStatusText: {
    ...type.labelLarge,
    color: scheme.primary,
    flex: 1,
  },
  gpsStatusMuted: {
    ...type.bodySmall,
    color: scheme.onSurfaceVariant,
    flex: 1,
  },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: scheme.surfaceContainerHigh,
    borderRadius: shape.full,
    paddingHorizontal: 16,
    minHeight: 48,
  },
  searchBarInput: {
    flex: 1,
    minWidth: 0,
    ...type.bodyLarge,
    color: scheme.onSurface,
    paddingVertical: 11,
  },
  clearBtn: {
    width: 32,
    height: 32,
    borderRadius: shape.full,
    backgroundColor: scheme.surfaceContainerHighest,
    alignItems: 'center',
    justifyContent: 'center',
  },
  popularRow: {
    gap: 8,
    paddingVertical: 2,
  },
  popularChip: {
    paddingHorizontal: 14,
    minHeight: 38,
    borderRadius: shape.full,
    backgroundColor: scheme.surfaceContainerLow,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: scheme.outlineVariant,
    alignItems: 'center',
    justifyContent: 'center',
  },
  popularChipActive: {
    backgroundColor: scheme.primaryContainer,
    borderColor: scheme.primary,
  },
  popularChipText: {
    ...type.labelMedium,
    color: scheme.onSurface,
    fontWeight: '500',
  },
  popularChipTextActive: {
    color: scheme.onPrimaryContainer,
    fontWeight: '700',
  },
  cityList: {
    flex: 1,
    marginTop: 8,
  },
  cityListContent: {
    paddingHorizontal: 24,
    paddingBottom: 16,
    gap: 6,
  },
  cityRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: scheme.surfaceContainerLow,
    borderRadius: 18,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'transparent',
    paddingHorizontal: 16,
    paddingVertical: 14,
    minHeight: 66,
  },
  cityRowActive: {
    backgroundColor: scheme.primaryContainer,
    borderColor: scheme.primary,
    borderRadius: 22,
  },
  cityRowBody: {
    flex: 1,
    gap: 2,
    minWidth: 0,
  },
  cityNameLine: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  cityName: {
    ...type.titleMedium,
    color: scheme.onSurface,
    flexShrink: 1,
  },
  cityNameActive: {
    color: scheme.onPrimaryContainer,
    fontWeight: '700',
  },
  citySub: {
    ...type.bodySmall,
    color: scheme.onSurfaceVariant,
  },
  citySubActive: {
    color: scheme.onPrimaryContainer,
    opacity: 0.88,
  },
  gpsTag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: shape.full,
    backgroundColor: scheme.primaryContainer,
  },
  gpsTagActive: {
    backgroundColor: scheme.primary,
  },
  gpsTagText: {
    ...type.labelSmall,
    color: scheme.onPrimaryContainer,
    fontWeight: '700',
  },
  gpsTagTextActive: {
    color: scheme.onPrimary,
  },
  radio: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: scheme.outline,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioActive: {
    backgroundColor: scheme.primary,
    borderColor: scheme.primary,
  },
  emptyCity: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 40,
    gap: 10,
  },
  emptyCityText: {
    ...type.bodyMedium,
    color: scheme.onSurfaceVariant,
    textAlign: 'center',
  },
  stepScroll: {
    paddingHorizontal: 24,
    paddingTop: 10,
    paddingBottom: 24,
    gap: 14,
  },
  card: {
    backgroundColor: scheme.surfaceContainerLow,
    borderRadius: 24,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: scheme.outlineVariant,
    padding: 18,
    gap: 14,
  },
  cardGranted: {
    borderColor: `${scheme.success}55`,
  },
  cardFocused: {
    borderColor: `${scheme.primary}77`,
  },
  cardHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  cardIcon: {
    width: 44,
    height: 44,
    borderRadius: shape.large,
    backgroundColor: scheme.secondaryContainer,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardIconSuccess: {
    backgroundColor: scheme.successContainer,
  },
  cardTitle: {
    ...type.titleMedium,
    fontSize: 17,
    fontWeight: '600',
    color: scheme.onSurface,
  },
  cardWhy: {
    ...type.bodySmall,
    color: scheme.onSurfaceVariant,
    marginTop: 2,
  },
  cardBody: {
    ...type.bodyMedium,
    color: scheme.onSurfaceVariant,
    lineHeight: 21,
  },
  doneText: {
    ...type.bodySmall,
    color: scheme.success,
    fontWeight: '600',
    marginTop: 2,
  },
  fine: {
    ...type.bodySmall,
    color: scheme.onSurfaceVariant,
    lineHeight: 18,
  },
  allow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: scheme.primary,
    borderRadius: shape.full,
    minHeight: 48,
    paddingHorizontal: 18,
    paddingVertical: 12,
  },
  allowText: {
    ...type.labelLarge,
    fontWeight: '600',
    color: scheme.onPrimary,
    flexShrink: 1,
    textAlign: 'center',
  },
  slotRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  slotRowCompact: {
    flexDirection: 'column',
    alignItems: 'stretch',
  },
  slotSearchArea: {
    gap: 8,
  },
  addPill: {
    backgroundColor: scheme.secondaryContainer,
    borderRadius: shape.full,
    paddingHorizontal: 16,
    minHeight: 44,
    justifyContent: 'center',
    alignItems: 'center',
  },
  addPillOpen: {
    backgroundColor: scheme.surfaceContainerHigh,
  },
  addPillText: {
    ...type.labelMedium,
    color: scheme.onSecondaryContainer,
    fontWeight: '700',
  },
  addPillTextOpen: {
    color: scheme.onSurface,
  },
  miniX: {
    width: 44,
    height: 44,
    borderRadius: shape.full,
    backgroundColor: scheme.surfaceContainerHigh,
    alignItems: 'center',
    justifyContent: 'center',
  },
  resultRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: scheme.surfaceContainerHigh,
    borderRadius: shape.large,
    padding: 14,
    minHeight: 56,
  },
  resultTitle: {
    ...type.titleSmall,
    color: scheme.onSurface,
  },
  resultSub: {
    ...type.bodySmall,
    color: scheme.onSurfaceVariant,
  },
  noResults: {
    padding: 12,
    borderRadius: shape.large,
    backgroundColor: scheme.surfaceContainerHigh,
  },
  noResultsText: {
    ...type.bodySmall,
    color: scheme.onSurfaceVariant,
    lineHeight: 18,
  },
  footer: {
    paddingHorizontal: 24,
    paddingTop: 10,
    paddingBottom: 12,
    gap: 10,
    backgroundColor: scheme.surface,
  },
  primary: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    backgroundColor: scheme.primary,
    borderRadius: shape.full,
    minHeight: 58,
    paddingHorizontal: 24,
    paddingVertical: 16,
  },
  primaryDisabled: {
    backgroundColor: scheme.surfaceContainerHighest,
  },
  primaryText: {
    ...type.labelLarge,
    fontSize: 17,
    fontWeight: '700',
    color: scheme.onPrimary,
    flexShrink: 1,
    textAlign: 'center',
  },
  primaryTextDisabled: {
    color: scheme.onSurfaceVariant,
  },
  privacyLink: {
    minHeight: 44,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 8,
  },
  privacyText: {
    ...type.labelMedium,
    color: scheme.onSurfaceVariant,
    textDecorationLine: 'underline',
    textAlign: 'center',
  },
  pwaTabs: {
    flexDirection: 'row',
    backgroundColor: scheme.surfaceContainerHigh,
    borderRadius: shape.full,
    padding: 4,
    gap: 4,
  },
  pwaTab: {
    flex: 1,
    minHeight: 40,
    borderRadius: shape.full,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  pwaTabActive: {
    backgroundColor: scheme.primaryContainer,
  },
  pwaTabText: {
    ...type.labelLarge,
    color: scheme.onSurfaceVariant,
    fontWeight: '600',
  },
  pwaTabTextActive: {
    color: scheme.onPrimaryContainer,
    fontWeight: '700',
  },
  pwaStepList: {
    gap: 10,
  },
  pwaStepRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
  },
  pwaStepBadge: {
    width: 26,
    height: 26,
    borderRadius: shape.full,
    backgroundColor: scheme.primaryContainer,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 1,
  },
  pwaStepNum: {
    ...type.labelMedium,
    color: scheme.onPrimaryContainer,
    fontWeight: '700',
  },
  pwaStepText: {
    ...type.bodyMedium,
    color: scheme.onSurface,
    lineHeight: 20,
    flex: 1,
  },
});
