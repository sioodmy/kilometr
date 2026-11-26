import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  AppState,
  BackHandler,
  FlatList,
  Keyboard,
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
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import Constants from 'expo-constants';
import * as Location from 'expo-location';
import Animated, {
  FadeInDown,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';
import {
  Bell,
  Check,
  ChevronDown,
  ChevronUp,
  Download,
  LocateFixed,
  M3SolidArrowRight,
  MapPinOff,
  Search,
  X,
} from '../src/components/icons';
import { MorphingLoader } from '../src/components/MorphingLoader';
import { OnboardingMorphHero } from '../src/components/OnboardingMorphHero';
import { OnboardingProgressBar } from '../src/components/OnboardingProgressBar';
import { SpringPressable } from '../src/components/SpringPressable';
import { TimetableBackgroundPill } from '../src/components/TimetableBackgroundPill';
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
import {
  getDataStatus,
  importGtfsFromNetwork,
  refreshDataStatus,
  subscribeDataStatus,
  type DataStatus,
} from '../src/services/dataManager';

type StepIndex = 0 | 1 | 2;

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

const POPULAR_SET = new Set<CityId>(POPULAR_CITY_IDS);

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
  // Bez animacji opacity: po powrocie z tła Fabric potrafi scalić startowe propsy
  // animacji (bug Reanimated), a treść kroku musi pozostać widoczna.
  const translateX = useSharedValue(reduceMotion ? 0 : direction * 24);
  const scale = useSharedValue(reduceMotion ? 1 : 0.99);

  useEffect(() => {
    if (reduceMotion) {
      translateX.value = 0;
      scale.value = 1;
      return;
    }
    translateX.value = direction * 24;
    scale.value = 0.99;
    translateX.value = withSpring(0, motion.spring.spatialDefault);
    scale.value = withSpring(1, motion.spring.spatialDefault);
  }, [direction, reduceMotion, scale, step, translateX]);

  const animStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: translateX.value }, { scale: scale.value }],
  }));

  return <Animated.View style={[st.stepStage, animStyle]}>{children}</Animated.View>;
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
      <Text style={[st.primaryText, disabled && st.primaryTextDisabled]} numberOfLines={1}>
        {label}
      </Text>
      {icon}
    </SpringPressable>
  );
}

/** Kompaktowy, klikalny wiersz uprawnienia (cały wiersz jest strefą dotyku). */
function PermissionRow({
  icon,
  title,
  subtitle,
  footnote,
  granted,
  busy,
  disabled,
  actionLabel,
  onPress,
}: {
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  footnote?: string;
  granted: boolean;
  busy?: boolean;
  disabled?: boolean;
  actionLabel: string;
  onPress: () => void;
}) {
  const interactive = !granted && !disabled;

  return (
    <SpringPressable
      onPress={onPress}
      disabled={!interactive}
      haptic="selection"
      scaleDelta={0.015}
      style={[st.permRow, granted && st.permRowGranted]}
      accessibilityRole="button"
      accessibilityState={{ disabled: !interactive, busy: Boolean(busy), selected: granted }}
      accessibilityLabel={`${title}. ${subtitle}`}
    >
      <View style={[st.permIcon, granted && st.permIconGranted]}>
        {granted ? <Check size={20} color={scheme.onSuccessContainer} /> : icon}
      </View>

      <View style={st.permBody}>
        <Text style={st.permTitle} numberOfLines={2}>
          {title}
        </Text>
        <Text style={st.permSub} numberOfLines={2}>
          {subtitle}
        </Text>
        {footnote ? <Text style={st.permFootnote}>{footnote}</Text> : null}
      </View>

      {granted ? (
        <View style={st.permDoneBadge} accessible={false}>
          <Check size={16} color={scheme.onSuccessContainer} />
        </View>
      ) : (
        <View style={[st.permPill, disabled && st.permPillDisabled]} accessible={false}>
          {busy ? (
            <ActivityIndicator size="small" color={scheme.onPrimaryContainer} />
          ) : (
            <Text style={st.permPillText}>{actionLabel}</Text>
          )}
        </View>
      )}
    </SpringPressable>
  );
}

/** Wiersz instalacji PWA na webie: natywny prompt 1 kliknięciem lub rozwijana instrukcja. */
function WebPwaInstallRow() {
  const s = useStrings();
  const [tab, setTab] = useState<'ios' | 'android'>(() => detectDefaultPwaPlatform());
  const [standalone, setStandalone] = useState(() => isRunningStandaloneWeb());
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [expanded, setExpanded] = useState(false);

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
      setExpanded(false);
    };
    window.addEventListener('beforeinstallprompt', onPrompt);
    window.addEventListener('appinstalled', handleInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt);
      window.removeEventListener('appinstalled', handleInstalled);
    };
  }, []);

  if (standalone) {
    return (
      <PermissionRow
        icon={<Download size={20} color={scheme.onSurfaceVariant} />}
        title={s.onboarding.pwaTitle}
        subtitle={s.onboarding.pwaInstalled}
        granted
        actionLabel={s.onboarding.pwaInstallShort}
        onPress={() => {}}
      />
    );
  }

  if (deferredPrompt) {
    return (
      <PermissionRow
        icon={<Download size={20} color={scheme.primary} />}
        title={s.onboarding.pwaTitle}
        subtitle={s.onboarding.pwaShortBody}
        granted={false}
        actionLabel={s.onboarding.pwaInstallShort}
        onPress={() => {
          void (async () => {
            try {
              await deferredPrompt.prompt();
              const choice = await deferredPrompt.userChoice;
              if (choice.outcome === 'accepted') {
                setStandalone(true);
                setDeferredPrompt(null);
              }
            } catch {}
          })();
        }}
      />
    );
  }

  const stepsList =
    tab === 'ios'
      ? [s.onboarding.pwaIos1, s.onboarding.pwaIos2, s.onboarding.pwaIos3]
      : [s.onboarding.pwaAndroid1, s.onboarding.pwaAndroid2, s.onboarding.pwaAndroid3];

  return (
    <View style={st.pwaCard}>
      <SpringPressable
        onPress={() => setExpanded((v) => !v)}
        haptic="selection"
        scaleDelta={0.015}
        style={st.pwaHeaderRow}
        accessibilityRole="button"
        accessibilityState={{ expanded }}
      >
        <View style={st.permIcon}>
          <Download size={20} color={scheme.primary} />
        </View>
        <View style={st.permBody}>
          <Text style={st.permTitle} numberOfLines={2}>
            {s.onboarding.pwaTitle}
          </Text>
          <Text style={st.permSub} numberOfLines={2}>
            {s.onboarding.pwaShortBody}
          </Text>
        </View>
        <View style={st.pwaTogglePill}>
          <Text style={st.pwaToggleText}>{s.onboarding.pwaHowTo}</Text>
          {expanded ? (
            <ChevronUp size={16} color={scheme.onSurfaceVariant} />
          ) : (
            <ChevronDown size={16} color={scheme.onSurfaceVariant} />
          )}
        </View>
      </SpringPressable>

      {expanded && (
        <View style={st.pwaDrawer}>
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
      )}
    </View>
  );
}

function usePermissionStates() {
  const [loc, setLoc] = useState<'unknown' | 'granted' | 'denied'>('unknown');
  const [notif, setNotif] = useState<'unknown' | 'granted' | 'denied'>('unknown');
  const [busy, setBusy] = useState<'loc' | 'notif' | null>(null);
  const [locCanAskAgain, setLocCanAskAgain] = useState(true);
  const [locAttempted, setLocAttempted] = useState(false);
  const [notifAttempted, setNotifAttempted] = useState(false);

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
    setLocAttempted(true);
    try {
      if (!locCanAskAgain) {
        if (Platform.OS !== 'web') await Linking.openSettings();
        return false;
      }
      const r = await Location.requestForegroundPermissionsAsync();
      const ok = r.granted;
      setLoc(ok ? 'granted' : 'denied');
      setLocCanAskAgain(r.canAskAgain);
      return ok;
    } catch {
      setLoc('denied');
      return false;
    } finally {
      setBusy(null);
    }
  }, [locCanAskAgain]);

  const requestNotif = useCallback(async () => {
    if (!NOTIF_SUPPORTED) return false;
    setBusy('notif');
    setNotifAttempted(true);
    try {
      if (notif === 'denied') {
        if (Platform.OS !== 'web') await Linking.openSettings();
        return false;
      }
      const ok = await ensureNotificationPermission();
      setNotif(ok ? 'granted' : 'denied');
      return ok;
    } catch {
      setNotif('denied');
      return false;
    } finally {
      setBusy(null);
    }
  }, [notif]);

  return { loc, notif, busy, locCanAskAgain, locAttempted, notifAttempted, requestLoc, requestNotif };
}

function useCitySuggestion(enabled: boolean, retryToken: number) {
  const [suggested, setSuggested] = useState<CityId | null>(null);
  const [status, setStatus] = useState<'idle' | 'locating' | 'nomatch'>('idle');

  useEffect(() => {
    if (!enabled) {
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
  }, [enabled, retryToken]);

  return { suggested, status };
}

const CityListRow = memo(function CityListRow({
  entry,
  active,
  disabled,
  showHint,
  isFirst,
  isLast,
  pickA11y,
  onSelect,
}: {
  entry: CityEntry;
  active: boolean;
  disabled: boolean;
  showHint: boolean;
  isFirst: boolean;
  isLast: boolean;
  pickA11y: string;
  onSelect: (id: CityId) => void;
}) {
  const handlePress = useCallback(() => onSelect(entry.city.id), [entry.city.id, onSelect]);

  return (
    <SpringPressable
      onPress={handlePress}
      disabled={disabled}
      haptic="selection"
      scaleDelta={0.01}
      style={[
        st.listRow,
        isFirst && st.listRowFirst,
        isLast && st.listRowLast,
        !isLast && !active && st.listRowDivider,
        active && st.listRowActive,
      ]}
      accessibilityRole="radio"
      accessibilityState={{ checked: active, disabled }}
      accessibilityLabel={pickA11y}
    >
      <View style={st.listRowTextWrap}>
        <Text style={[st.listRowName, active && st.listRowNameActive]} numberOfLines={1}>
          {entry.name}
        </Text>
        {showHint ? (
          <Text style={[st.listRowHint, active && st.listRowHintActive]} numberOfLines={1}>
            {entry.feeds}
          </Text>
        ) : null}
      </View>
      {active ? <Check size={18} color={scheme.onPrimaryContainer} /> : null}
    </SpringPressable>
  );
});

const cityKeyExtractor = (entry: CityEntry) => entry.city.id;

export default function OnboardingScreen() {
  const s = useStrings();
  const router = useRouter();
  const webLayout = useWebLayout();
  const { sharedTrip } = useLocalSearchParams<{ sharedTrip?: string }>();
  const { width, fontScale } = useWindowDimensions();
  const compact = width / fontScale < 360;
  const reduceMotion = useReducedMotion();
  const webKeyboardInset = useWebKeyboardInset();

  const [step, setStep] = useState<StepIndex>(0);
  const [direction, setDirection] = useState<1 | -1>(1);
  const [leaving, setLeaving] = useState(false);

  const perms = usePermissionStates();
  const { cityId, setCity } = useActiveCity();
  // Brak domyślnego zaznaczenia Wrocławia: użytkownik świadomie wybiera miasto lub wykrywa je GPS-em.
  const [pickedCityId, setPickedCityId] = useState<CityId | null>(null);
  const [switchingCity, setSwitchingCity] = useState(false);
  const [cityQuery, setCityQuery] = useState('');
  const [gpsNotice, setGpsNotice] = useState<'denied' | null>(null);
  const [gpsAttempt, setGpsAttempt] = useState(0);

  const shouldLocate = step >= 1 && perms.loc === 'granted';
  const { suggested, status: citySuggestionStatus } = useCitySuggestion(shouldLocate, gpsAttempt);

  const [dataStatus, setDataStatus] = useState<DataStatus>(() => getDataStatus());
  const [checkingTimetable, setCheckingTimetable] = useState(false);
  const manualCityPickedRef = useRef(false);
  const prefetchedCityRef = useRef<CityId | null>(null);

  const activeCityId = pickedCityId ?? cityId;
  const cityGen = s.city.gen(activeCityId);

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
      // Status błędu pokaże TimetableBackgroundPill na ostatnim kroku.
    } finally {
      setCheckingTimetable(false);
    }
  }, []);

  const selectCity = useCallback(
    async (id: CityId, source: 'manual' | 'gps' = 'manual') => {
      if (source === 'manual') {
        manualCityPickedRef.current = true;
        Keyboard.dismiss();
      }
      if (switchingCity) return;
      setGpsNotice(null);
      setPickedCityId(id);
      if (id === cityId) {
        void prefetchTimetable(id);
        return;
      }
      setSwitchingCity(true);
      try {
        await setCity(id);
        void prefetchTimetable(id, true);
      } finally {
        setSwitchingCity(false);
      }
    },
    [cityId, prefetchTimetable, setCity, switchingCity],
  );

  // Gdy GPS wykryje miasto i użytkownik jeszcze nie wybrał innego, ustawiamy je automatycznie.
  useEffect(() => {
    if (!suggested || step < 1 || manualCityPickedRef.current) return;
    void selectCity(suggested, 'gps');
  }, [selectCity, step, suggested]);

  const handleDetectGps = useCallback(async () => {
    setGpsNotice(null);
    if (perms.loc === 'granted') {
      manualCityPickedRef.current = false;
      setGpsAttempt((n) => n + 1);
      return;
    }
    const ok = await perms.requestLoc();
    if (ok) {
      manualCityPickedRef.current = false;
      setGpsAttempt((n) => n + 1);
    } else {
      setGpsNotice('denied');
    }
  }, [perms]);

  const goTo = useCallback((nextStep: StepIndex) => {
    setStep((prev) => {
      if (prev === nextStep) return prev;
      setDirection(nextStep > prev ? 1 : -1);
      return nextStep;
    });
  }, []);

  const next = useCallback(() => {
    if (step === 1) {
      if (!pickedCityId) return;
      void prefetchTimetable(pickedCityId);
    }
    if (step < 2) goTo((step + 1) as StepIndex);
  }, [goTo, pickedCityId, prefetchTimetable, step]);

  const back = useCallback(() => {
    if (step > 0) goTo((step - 1) as StepIndex);
  }, [goTo, step]);

  const finish = useCallback(async () => {
    if (leaving) return;
    setLeaving(true);
    void prefetchTimetable(activeCityId);
    await setOnboardingSeen();
    router.replace(sharedTrip ? { pathname: '/shared', params: { trip: sharedTrip } } : '/');
  }, [activeCityId, leaving, prefetchTimetable, router, sharedTrip]);

  const handleOpenPrivacy = useCallback(() => {
    router.push('/privacy');
  }, [router]);

  const retryPrefetch = useCallback(() => {
    void prefetchTimetable(activeCityId, true);
  }, [activeCityId, prefetchTimetable]);

  useFocusEffect(
    useCallback(() => {
      const sub = BackHandler.addEventListener('hardwareBackPress', () => {
        if (step === 0) return false;
        back();
        return true;
      });
      return () => sub.remove();
    }, [back, step]),
  );

  const cityEntries = useMemo(() => getCityEntries(s), [s]);
  const trimmedQuery = cityQuery.trim();
  const isSearching = trimmedQuery.length > 0;

  const listCities = useMemo(() => {
    if (isSearching) {
      return filterCityEntries(cityEntries, trimmedQuery, pickedCityId ? [pickedCityId] : []);
    }
    return cityEntries.filter((e) => !POPULAR_SET.has(e.city.id));
  }, [cityEntries, isSearching, pickedCityId, trimmedQuery]);

  const pickedNonPopular = useMemo(() => {
    if (!pickedCityId || POPULAR_SET.has(pickedCityId) || isSearching) return null;
    return cityEntries.find((e) => e.city.id === pickedCityId) ?? null;
  }, [cityEntries, isSearching, pickedCityId]);

  const renderCityItem = useCallback<ListRenderItem<CityEntry>>(
    ({ item, index }) => {
      const active = pickedCityId === item.city.id;
      const showHint = isSearching && !item.nameNorm.startsWith(trimmedQuery.toLowerCase());
      return (
        <CityListRow
          entry={item}
          active={active}
          disabled={switchingCity}
          showHint={showHint}
          isFirst={index === 0}
          isLast={index === listCities.length - 1}
          pickA11y={s.onboarding.cityPickA11y(item.name)}
          onSelect={(id) => void selectCity(id, 'manual')}
        />
      );
    },
    [isSearching, listCities.length, pickedCityId, s, selectCity, switchingCity, trimmedQuery],
  );

  const cityListHeader = useMemo(() => {
    if (isSearching) return null;
    return (
      <View style={st.citySections}>
        {pickedNonPopular ? (
          <View style={st.sectionBlock}>
            <Text style={st.sectionLabel}>{s.onboarding.citySelectedLabel}</Text>
            <SpringPressable
              onPress={() => void selectCity(pickedNonPopular.city.id, 'manual')}
              disabled={switchingCity}
              haptic="selection"
              scaleDelta={0.015}
              style={st.selectedBanner}
              accessibilityRole="radio"
              accessibilityState={{ checked: true }}
            >
              <Text style={st.selectedBannerName} numberOfLines={1}>
                {pickedNonPopular.name}
              </Text>
              <Check size={18} color={scheme.onPrimaryContainer} />
            </SpringPressable>
          </View>
        ) : null}

        <View style={st.sectionBlock}>
          <Text style={st.sectionLabel}>{s.onboarding.cityPopularSection}</Text>
          <View style={st.popularGrid} accessibilityRole="radiogroup">
            {POPULAR_CITY_IDS.map((id) => {
              const active = pickedCityId === id;
              return (
                <SpringPressable
                  key={id}
                  onPress={() => void selectCity(id, 'manual')}
                  disabled={switchingCity}
                  haptic="selection"
                  scaleDelta={0.03}
                  style={[st.popularTile, active && st.popularTileActive]}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: active, disabled: switchingCity }}
                  accessibilityLabel={s.onboarding.cityPickA11y(s.city.name(id))}
                >
                  <Text
                    style={[st.popularTileText, active && st.popularTileTextActive]}
                    numberOfLines={1}
                  >
                    {s.city.name(id)}
                  </Text>
                  {active ? <Check size={16} color={scheme.onPrimaryContainer} /> : null}
                </SpringPressable>
              );
            })}
          </View>
        </View>

        <Text style={st.allSectionLabel}>{s.onboarding.cityAllSection}</Text>
      </View>
    );
  }, [isSearching, pickedCityId, pickedNonPopular, s, selectCity, switchingCity]);

  const gpsBusy = perms.busy === 'loc' || citySuggestionStatus === 'locating';

  const gpsFeedbackText =
    gpsNotice === 'denied'
      ? s.onboarding.cityNoGps
      : citySuggestionStatus === 'nomatch'
        ? s.onboarding.cityNoMatch
        : null;

  const step1CtaLabel = switchingCity
    ? s.city.switching
    : pickedCityId
      ? s.onboarding.cityNextWith(s.city.name(pickedCityId))
      : s.onboarding.cityPickPrompt;

  return (
    <SafeAreaView
      style={[st.safe, webLayout.isMedium && st.safeDesktop]}
      edges={['top', 'bottom']}
    >
      <View style={[st.shell, webLayout.isMedium && st.shellDesktop]}>
        <OnboardingProgressBar step={step} onBack={back} />

        <View style={st.workspace}>
          {step === 0 && (
            <StepStage step={step} direction={direction}>
              <ScrollView
                contentContainerStyle={st.welcomeBody}
                showsVerticalScrollIndicator={false}
                overScrollMode="never"
              >
                <View style={st.welcomeGroup}>
                  <OnboardingMorphHero />

                  <Animated.View
                    entering={reduceMotion ? undefined : FadeInDown.duration(280).delay(220)}
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

          {step === 1 && (
            <StepStage step={step} direction={direction}>
              <View style={st.cityStep}>
                <View style={st.stepHeader}>
                  <Text style={st.stepTitle}>{s.onboarding.cityTitle}</Text>
                </View>

                <View style={st.searchWrap}>
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
                    {cityQuery.length > 0 ? (
                      <Pressable
                        onPress={() => setCityQuery('')}
                        hitSlop={6}
                        style={st.clearBtn}
                        accessibilityRole="button"
                        accessibilityLabel={s.onboarding.cityClearSearchA11y}
                      >
                        <X size={16} color={scheme.onSurfaceVariant} />
                      </Pressable>
                    ) : (
                      <SpringPressable
                        onPress={() => void handleDetectGps()}
                        disabled={gpsBusy}
                        haptic="selection"
                        scaleDelta={0.04}
                        style={st.gpsPill}
                        accessibilityRole="button"
                        accessibilityState={{ busy: gpsBusy, disabled: gpsBusy }}
                        accessibilityLabel={s.onboarding.detectGpsAction}
                      >
                        {gpsBusy ? (
                          <MorphingLoader size={15} color={scheme.onPrimaryContainer} />
                        ) : (
                          <LocateFixed size={15} color={scheme.onPrimaryContainer} />
                        )}
                        <Text style={st.gpsPillText}>
                          {gpsBusy ? s.onboarding.detectGpsLocating : s.onboarding.detectGpsShort}
                        </Text>
                      </SpringPressable>
                    )}
                  </View>

                  {gpsFeedbackText ? (
                    <Text style={st.gpsFeedback}>{gpsFeedbackText}</Text>
                  ) : null}
                </View>

                <FlatList
                  data={listCities}
                  keyExtractor={cityKeyExtractor}
                  style={st.cityList}
                  contentContainerStyle={st.cityListContent}
                  showsVerticalScrollIndicator={false}
                  overScrollMode="never"
                  keyboardShouldPersistTaps="handled"
                  keyboardDismissMode="on-drag"
                  accessibilityRole="radiogroup"
                  ListHeaderComponent={cityListHeader}
                  renderItem={renderCityItem}
                  ListEmptyComponent={
                    <View style={st.emptyCity}>
                      <MapPinOff size={24} color={scheme.onSurfaceVariant} />
                      <Text style={st.emptyCityText}>
                        {s.onboarding.cityNoSearchMatch(trimmedQuery)}
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
                contentContainerStyle={st.permScroll}
                showsVerticalScrollIndicator={false}
                overScrollMode="never"
              >
                <View style={st.stepHeaderInline}>
                  <Text style={st.stepTitle}>{s.onboarding.permTitle}</Text>
                  <Text style={st.stepSubtitle}>
                    {Platform.OS === 'web' ? s.onboarding.permSubWeb : s.onboarding.permSub}
                  </Text>
                </View>

                <View style={st.permList}>
                  <PermissionRow
                    icon={<LocateFixed size={20} color={scheme.primary} />}
                    title={s.onboarding.locTitle}
                    subtitle={
                      perms.loc === 'granted' ? s.onboarding.locOn : s.onboarding.locShortBody
                    }
                    footnote={
                      perms.loc === 'denied' && (perms.locAttempted || !perms.locCanAskAgain)
                        ? s.onboarding.permissionDenied
                        : undefined
                    }
                    granted={perms.loc === 'granted'}
                    busy={perms.busy === 'loc'}
                    disabled={perms.busy !== null}
                    actionLabel={
                      perms.locCanAskAgain ? s.onboarding.permEnable : s.onboarding.openSettings
                    }
                    onPress={() => void perms.requestLoc()}
                  />

                  {Platform.OS !== 'web' ? (
                    <PermissionRow
                      icon={<Bell size={20} color={scheme.primary} />}
                      title={s.onboarding.notifTitle}
                      subtitle={
                        perms.notif === 'granted'
                          ? s.onboarding.notifOn
                          : s.onboarding.notifShortBody
                      }
                      footnote={
                        !NOTIF_SUPPORTED
                          ? s.onboarding.notifExpoGo
                          : perms.notif === 'denied' && perms.notifAttempted
                            ? s.onboarding.permissionDenied
                            : undefined
                      }
                      granted={perms.notif === 'granted'}
                      busy={perms.busy === 'notif'}
                      disabled={perms.busy !== null || !NOTIF_SUPPORTED}
                      actionLabel={
                        perms.notif === 'denied'
                          ? s.onboarding.openSettings
                          : s.onboarding.permEnable
                      }
                      onPress={() => void perms.requestNotif()}
                    />
                  ) : (
                    <WebPwaInstallRow />
                  )}
                </View>

                <View style={st.disclosureBlock}>
                  <Text style={st.disclosureText}>{s.onboarding.locDisclosure}</Text>
                  <Pressable
                    onPress={handleOpenPrivacy}
                    accessibilityRole="link"
                    style={({ pressed }) => [st.privacyLinkLeft, pressed && { opacity: 0.7 }]}
                  >
                    <Text style={st.privacyText}>{s.landing.privacy.linkLabel}</Text>
                  </Pressable>
                </View>
              </ScrollView>
            </StepStage>
          )}
        </View>

        <View
          style={[
            st.footer,
            webKeyboardInset > 0 && { paddingBottom: Math.max(12, webKeyboardInset + 8) },
          ]}
        >
          {step === 2 && (
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
              label={step1CtaLabel}
              onPress={next}
              disabled={!pickedCityId || switchingCity}
              icon={
                switchingCity ? (
                  <ActivityIndicator size="small" color={scheme.onSurfaceVariant} />
                ) : pickedCityId ? (
                  <M3SolidArrowRight size={18} color={scheme.onPrimary} />
                ) : undefined
              }
            />
          )}

          {step === 2 && (
            <PrimaryBtn
              label={s.onboarding.startUsing}
              onPress={() => void finish()}
              disabled={leaving}
              icon={<M3SolidArrowRight size={18} color={scheme.onPrimary} />}
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
    maxWidth: 500,
    maxHeight: 760,
    borderRadius: 32,
    backgroundColor: scheme.surface,
    borderWidth: 1,
    borderColor: scheme.outlineVariant,
    ...elev.level3,
  },
  workspace: {
    flex: 1,
    overflow: 'hidden',
  },
  stepStage: {
    flex: 1,
  },
  // Krok 0: Witaj
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
    gap: 28,
  },
  welcomeCopy: {
    alignItems: 'center',
    gap: 6,
  },
  brandHero: {
    fontSize: 42,
    fontWeight: '700',
    color: scheme.onSurface,
    letterSpacing: -1.4,
    textAlign: 'center',
  },
  brandHeroCompact: {
    fontSize: 36,
    letterSpacing: -1.1,
  },
  tagline: {
    fontSize: 19,
    lineHeight: 26,
    fontWeight: '600',
    color: scheme.primary,
    textAlign: 'center',
  },
  welcomeIntro: {
    ...type.bodyLarge,
    fontSize: 15,
    color: scheme.onSurfaceVariant,
    textAlign: 'center',
    lineHeight: 22,
    maxWidth: 320,
    marginTop: 6,
  },
  // Wspólne nagłówki kroków 1 i 2
  stepHeader: {
    paddingHorizontal: 20,
    paddingTop: 4,
    paddingBottom: 14,
    gap: 4,
  },
  stepHeaderInline: {
    gap: 6,
    marginBottom: 20,
  },
  stepTitle: {
    fontSize: 28,
    fontWeight: '700',
    color: scheme.onSurface,
    letterSpacing: -0.7,
    lineHeight: 34,
  },
  stepSubtitle: {
    ...type.bodyMedium,
    fontSize: 15,
    color: scheme.onSurfaceVariant,
    lineHeight: 21,
  },
  // Krok 1: Miasto
  cityStep: {
    flex: 1,
  },
  searchWrap: {
    paddingHorizontal: 20,
    paddingBottom: 12,
    gap: 8,
  },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: scheme.surfaceContainerHigh,
    borderRadius: shape.full,
    paddingLeft: 16,
    paddingRight: 5,
    paddingVertical: 5,
    minHeight: 54,
  },
  searchBarInput: {
    flex: 1,
    minWidth: 0,
    ...type.bodyLarge,
    color: scheme.onSurface,
    paddingVertical: 8,
  },
  clearBtn: {
    width: 44,
    height: 44,
    borderRadius: shape.full,
    backgroundColor: scheme.surfaceContainerHighest,
    alignItems: 'center',
    justifyContent: 'center',
  },
  gpsPill: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    minHeight: 44,
    paddingHorizontal: 14,
    borderRadius: shape.full,
    backgroundColor: scheme.primaryContainer,
  },
  gpsPillText: {
    ...type.labelLarge,
    fontSize: 13,
    fontWeight: '600',
    color: scheme.onPrimaryContainer,
  },
  gpsFeedback: {
    ...type.bodySmall,
    color: scheme.onSurfaceVariant,
    paddingHorizontal: 6,
  },
  cityList: {
    flex: 1,
  },
  cityListContent: {
    paddingHorizontal: 20,
    paddingBottom: 20,
  },
  citySections: {
    gap: 20,
    marginBottom: 8,
  },
  sectionBlock: {
    gap: 10,
  },
  sectionLabel: {
    ...type.labelMedium,
    color: scheme.onSurfaceVariant,
    fontWeight: '600',
    paddingHorizontal: 2,
  },
  allSectionLabel: {
    ...type.labelMedium,
    color: scheme.onSurfaceVariant,
    fontWeight: '600',
    paddingHorizontal: 2,
    marginTop: 2,
  },
  selectedBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    minHeight: 52,
    paddingHorizontal: 16,
    borderRadius: 16,
    backgroundColor: scheme.primaryContainer,
    borderWidth: 1.5,
    borderColor: scheme.primary,
  },
  selectedBannerName: {
    ...type.titleMedium,
    fontWeight: '700',
    color: scheme.onPrimaryContainer,
    flex: 1,
  },
  popularGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  popularTile: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 6,
    width: '48.5%',
    flexGrow: 1,
    minHeight: 52,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 16,
    backgroundColor: scheme.surfaceContainerLow,
    borderWidth: 1.5,
    borderColor: 'transparent',
  },
  popularTileActive: {
    backgroundColor: scheme.primaryContainer,
    borderColor: scheme.primary,
  },
  popularTileText: {
    ...type.titleMedium,
    fontSize: 15,
    fontWeight: '600',
    color: scheme.onSurface,
    flexShrink: 1,
  },
  popularTileTextActive: {
    color: scheme.onPrimaryContainer,
    fontWeight: '700',
  },
  listRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    minHeight: 52,
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: scheme.surfaceContainerLow,
  },
  listRowFirst: {
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
  },
  listRowLast: {
    borderBottomLeftRadius: 20,
    borderBottomRightRadius: 20,
  },
  listRowDivider: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: scheme.outlineVariant,
  },
  listRowActive: {
    backgroundColor: scheme.primaryContainer,
  },
  listRowTextWrap: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  listRowName: {
    ...type.bodyLarge,
    fontSize: 15,
    fontWeight: '500',
    color: scheme.onSurface,
  },
  listRowNameActive: {
    color: scheme.onPrimaryContainer,
    fontWeight: '700',
  },
  listRowHint: {
    ...type.bodySmall,
    color: scheme.onSurfaceVariant,
  },
  listRowHintActive: {
    color: scheme.onPrimaryContainer,
    opacity: 0.85,
  },
  emptyCity: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 44,
    gap: 10,
  },
  emptyCityText: {
    ...type.bodyMedium,
    color: scheme.onSurfaceVariant,
    textAlign: 'center',
  },
  // Krok 2: Uprawnienia
  permScroll: {
    paddingHorizontal: 20,
    paddingTop: 4,
    paddingBottom: 24,
  },
  permList: {
    gap: 10,
  },
  permRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    backgroundColor: scheme.surfaceContainerLow,
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 15,
    minHeight: 76,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  permRowGranted: {
    borderColor: `${scheme.success}44`,
  },
  permIcon: {
    width: 44,
    height: 44,
    borderRadius: 14,
    backgroundColor: scheme.surfaceContainerHigh,
    alignItems: 'center',
    justifyContent: 'center',
  },
  permIconGranted: {
    backgroundColor: scheme.successContainer,
  },
  permBody: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  permTitle: {
    ...type.titleMedium,
    fontSize: 16,
    fontWeight: '600',
    color: scheme.onSurface,
  },
  permSub: {
    ...type.bodySmall,
    fontSize: 13,
    lineHeight: 18,
    color: scheme.onSurfaceVariant,
  },
  permFootnote: {
    ...type.bodySmall,
    color: scheme.onSurfaceVariant,
    opacity: 0.85,
    marginTop: 4,
    lineHeight: 16,
  },
  permPill: {
    minHeight: 36,
    paddingHorizontal: 14,
    borderRadius: shape.full,
    backgroundColor: scheme.primaryContainer,
    alignItems: 'center',
    justifyContent: 'center',
  },
  permPillDisabled: {
    opacity: 0.5,
  },
  permPillText: {
    ...type.labelMedium,
    fontSize: 13,
    fontWeight: '700',
    color: scheme.onPrimaryContainer,
  },
  permDoneBadge: {
    width: 32,
    height: 32,
    borderRadius: shape.full,
    backgroundColor: scheme.successContainer,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pwaCard: {
    backgroundColor: scheme.surfaceContainerLow,
    borderRadius: 20,
    overflow: 'hidden',
  },
  pwaHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingHorizontal: 16,
    paddingVertical: 15,
    minHeight: 76,
  },
  pwaTogglePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    minHeight: 36,
    paddingHorizontal: 12,
    borderRadius: shape.full,
    backgroundColor: scheme.surfaceContainerHigh,
  },
  pwaToggleText: {
    ...type.labelMedium,
    fontSize: 13,
    fontWeight: '600',
    color: scheme.onSurfaceVariant,
  },
  pwaDrawer: {
    paddingHorizontal: 16,
    paddingBottom: 16,
    gap: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: scheme.outlineVariant,
    paddingTop: 14,
  },
  pwaTabs: {
    flexDirection: 'row',
    backgroundColor: scheme.surfaceContainerHigh,
    borderRadius: shape.full,
    padding: 3,
    gap: 4,
  },
  pwaTab: {
    flex: 1,
    minHeight: 44,
    borderRadius: shape.full,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 10,
  },
  pwaTabActive: {
    backgroundColor: scheme.primaryContainer,
  },
  pwaTabText: {
    ...type.labelMedium,
    fontSize: 13,
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
    width: 22,
    height: 22,
    borderRadius: shape.full,
    backgroundColor: scheme.primaryContainer,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 1,
  },
  pwaStepNum: {
    ...type.labelSmall,
    color: scheme.onPrimaryContainer,
    fontWeight: '700',
  },
  pwaStepText: {
    ...type.bodySmall,
    fontSize: 13,
    color: scheme.onSurface,
    lineHeight: 19,
    flex: 1,
  },
  disclosureBlock: {
    marginTop: 18,
    paddingHorizontal: 4,
    gap: 2,
  },
  disclosureText: {
    ...type.bodySmall,
    color: scheme.onSurfaceVariant,
    opacity: 0.78,
    lineHeight: 17,
  },
  // Stopka
  footer: {
    paddingHorizontal: 20,
    paddingTop: 10,
    paddingBottom: 14,
    gap: 10,
    backgroundColor: scheme.surface,
  },
  primary: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: scheme.primary,
    borderRadius: shape.full,
    minHeight: 56,
    paddingHorizontal: 24,
    paddingVertical: 15,
  },
  primaryDisabled: {
    backgroundColor: scheme.surfaceContainerHigh,
  },
  primaryText: {
    ...type.labelLarge,
    fontSize: 16,
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
  },
  privacyLinkLeft: {
    minHeight: 44,
    justifyContent: 'center',
    alignSelf: 'flex-start',
  },
  privacyText: {
    ...type.labelMedium,
    color: scheme.onSurfaceVariant,
    textAlign: 'center',
  },
});
