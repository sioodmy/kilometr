import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import Constants from 'expo-constants';
import * as Location from 'expo-location';
import {
  Bell,
  Briefcase,
  Check,
  ChevronLeft,
  ChevronRight,
  Database,
  Download,
  GraduationCap,
  Home,
  LocateFixed,
  MapPin,
  Search,
  TramFront,
  WifiOff,
  X,
} from 'lucide-react-native';
import Animated, { FadeIn, FadeOut, useReducedMotion } from 'react-native-reanimated';
import { scheme, shape, type } from '../src/theme/tokens';
import { useStrings } from '../src/i18n';
import { CITIES, type CityId } from '../src/cities';
import { useActiveCity } from '../src/services/cityStore';
import { suggestCityForGps } from '../src/services/serviceArea';
import { setOnboardingSeen } from '../src/services/onboarding';
import { suggestionDisplayTitle } from '../src/components/SuggestionRow';
import {
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

function StepProgress({ step }: { step: number }) {
  const s = useStrings();
  const steps = s.onboarding.steps;
  return (
    <View
      style={st.dots}
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={s.onboarding.stepOf(step + 1, steps.length, steps[step])}
      accessibilityValue={{ min: 1, max: steps.length, now: step + 1 }}
    >
      {steps.map((label, i) => (
        <View key={label} style={[st.dot, i === step && st.dotActive, i < step && st.dotDone]} />
      ))}
    </View>
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
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        st.primary,
        disabled && st.primaryDisabled,
        pressed && !disabled && { opacity: 0.88, transform: [{ scale: 0.99 }] },
      ]}
      accessibilityRole="button"
      accessibilityState={{ disabled: Boolean(disabled) }}
    >
      <Text style={[st.primaryText, disabled && st.primaryTextDisabled]}>{label}</Text>
      {icon}
    </Pressable>
  );
}

function GhostBtn({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [st.ghost, pressed && { opacity: 0.7 }]}
      accessibilityRole="button"
    >
      <Text style={st.ghostText}>{label}</Text>
    </Pressable>
  );
}

const NOTIF_SUPPORTED = Constants.appOwnership !== 'expo';

function usePermissionStates() {
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
        await Linking.openSettings();
        return;
      }
      const r = await Location.requestForegroundPermissionsAsync();
      setLoc(r.granted ? 'granted' : 'denied');
      setLocCanAskAgain(r.canAskAgain);
    } catch {
      setLoc('denied');
    } finally {
      setBusy(null);
    }
  }, [locCanAskAgain]);

  const requestNotif = useCallback(async () => {
    if (!NOTIF_SUPPORTED) return;
    setBusy('notif');
    try {
      if (notif === 'denied') {
        await Linking.openSettings();
        return;
      }
      setNotif((await ensureNotificationPermission()) ? 'granted' : 'denied');
    } catch {
      setNotif('denied');
    } finally {
      setBusy(null);
    }
  }, [notif]);

  return { loc, notif, busy, locCanAskAgain, requestLoc, requestNotif };
}

function useCitySuggestion(locGranted: boolean) {
  const { cityId, setCity } = useActiveCity();
  const [suggested, setSuggested] = useState<CityId | null>(null);
  const [switching, setSwitching] = useState(false);
  // 'idle' = jeszcze nie pytaliśmy, 'locating' = czekamy na fix,
  // 'nomatch' = GPS gdzieś, gdzie żadne miasto nie pasuje.
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
        // Brak fixa: wybór manualny z listy, bez zgadywania miasta.
        if (live) setStatus('nomatch');
      }
    })();
    return () => {
      live = false;
    };
  }, [locGranted]);

  const pick = useCallback(
    async (id: CityId) => {
      if (switching || id === cityId) return;
      setSwitching(true);
      try {
        await setCity(id);
      } finally {
        setSwitching(false);
      }
    },
    [cityId, setCity, switching],
  );

  return { cityId, pick, suggested, status, switching };
}

type SlotKey = 'home' | 'work' | 'school';

const SLOT_KEYS: readonly SlotKey[] = ['home', 'work', 'school'];

function useOnboardingPlaces() {
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
      const name = slotNames[slot];
      setSaving(true);
      try {
        await FavoritesService.addPlace({
          name,
          icon: slot,
          address: sug.address || sug.title,
          lat: sug.lat,
          lon: sug.lon,
        });
        await reload();
        setActiveSlot(null);
        setQuery('');
        setResults([]);
      } catch {
        Alert.alert(s.onboarding.saveFail, s.onboarding.saveFailBody);
      } finally {
        setSaving(false);
      }
    },
    [reload, s],
  );

  const remove = useCallback(
    async (id: string) => {
      await FavoritesService.deletePlace(id);
      await reload();
    },
    [reload],
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

export default function OnboardingScreen() {
  const s = useStrings();
  const router = useRouter();
  const { sharedTrip } = useLocalSearchParams<{ sharedTrip?: string }>();
  const { width, fontScale } = useWindowDimensions();
  const compact = width / fontScale < 360;
  const reduceMotion = useReducedMotion();
  const [step, setStep] = useState(0);
  const [leaving, setLeaving] = useState(false);
  const perms = usePermissionStates();
  const {
    cityId,
    pick,
    suggested,
    status: citySuggestionStatus,
    switching: switchingCity,
  } = useCitySuggestion(perms.loc === 'granted');
  const [dataStatus, setDataStatus] = useState<DataStatus>(() => getDataStatus());
  const [downloading, setDownloading] = useState(false);
  const slots = useOnboardingPlaces();
  const steps = s.onboarding.steps;
  const cityGen = s.city.gen(cityId);
  const cityFeeds = s.city.feeds(cityId);
  const placeSlots = [
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
  ];
  // Krok 3: przewijanie otwartego slotu nad klawiaturę.
  const step3Scroll = useRef<ScrollView>(null);
  const slotY = useRef<Record<string, number>>({});
  const scrollSlotIntoView = useCallback((key: string) => {
    const y = slotY.current[key] ?? 0;
    // Czekamy na animację klawiatury, inaczej scroll policzy się bez niej.
    setTimeout(() => {
      step3Scroll.current?.scrollTo({ y: Math.max(0, y - 70), animated: true });
    }, 150);
  }, []);

  useEffect(() => {
    void refreshDataStatus().catch(() => {});
    return subscribeDataStatus(setDataStatus);
  }, []);

  // Na kroku rozkładu od razu odśwież status.
  useEffect(() => {
    if (step === 3) void refreshDataStatus().catch(() => {});
  }, [step]);

  const finish = useCallback(async () => {
    if (leaving) return;
    setLeaving(true);
    await setOnboardingSeen();
    router.replace(sharedTrip ? { pathname: '/shared', params: { trip: sharedTrip } } : '/');
  }, [leaving, router, sharedTrip]);

  const next = useCallback(() => setStep((v) => Math.min(v + 1, steps.length - 1)), [steps.length]);
  const back = useCallback(() => setStep((v) => Math.max(v - 1, 0)), []);

  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (step === 0) return false;
      back();
      return true;
    });
    return () => sub.remove();
  }, [back, step]);

  const startDownload = useCallback(async () => {
    if (downloading) return;
    setDownloading(true);
    try {
      await importGtfsFromNetwork();
    } catch {
      // błąd pokazuje karta statusu (state 'error') z przyciskiem ponowienia
    } finally {
      setDownloading(false);
    }
  }, [downloading]);

  const busyGtfs =
    downloading || dataStatus.state === 'downloading' || dataStatus.state === 'importing';
  const gtfsReady = dataStatus.state === 'ready';
  const savedCount = slots.places.length;

  return (
    <SafeAreaView style={st.safe} edges={['top', 'bottom']}>
      <View style={st.top}>
        <View style={st.topRow}>
          <View style={st.topHeading}>
            {step > 0 && (
              <Pressable
                onPress={back}
                style={({ pressed }) => [st.back, pressed && st.backPressed]}
                accessibilityRole="button"
                accessibilityLabel={s.onboarding.backA11y}
              >
                <ChevronLeft size={24} color={scheme.onSurface} />
              </Pressable>
            )}
            <Text style={st.stepLabel}>{steps[step]}</Text>
          </View>
          <Text style={st.stepCount} accessible={false}>
            {s.onboarding.stepCount(step + 1, steps.length)}
          </Text>
        </View>
        <StepProgress step={step} />
      </View>

      <Animated.View
        key={step}
        entering={reduceMotion ? undefined : FadeIn.duration(200)}
        exiting={reduceMotion ? undefined : FadeOut.duration(120)}
        style={{ flex: 1 }}
      >
        {step === 0 && (
          <ScrollView
            contentContainerStyle={st.body}
            showsVerticalScrollIndicator={false}
            overScrollMode="never"
          >
            <View style={st.welcomeHero}>
              <View style={st.heroMark}>
                <TramFront size={48} color={scheme.onPrimaryContainer} strokeWidth={1.8} />
              </View>
              <Text style={[st.hero, compact && st.heroCompact]}>{s.onboarding.brand}</Text>
              <Text style={st.lead}>{s.onboarding.tagline}</Text>
            </View>
            <Text style={st.leadSmall}>{s.onboarding.intro}</Text>

            <View style={st.featList}>
              <View style={st.feat}>
                <View style={st.featIcon}>
                  <WifiOff size={20} color={scheme.onSurfaceVariant} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={st.featTitle}>{s.onboarding.fast}</Text>
                </View>
              </View>
              <View style={st.feat}>
                <View style={st.featIcon}>
                  <Check size={20} color={scheme.onSurfaceVariant} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={st.featTitle}>{s.onboarding.noAds}</Text>
                </View>
              </View>
              <View style={st.feat}>
                <View style={st.featIcon}>
                  <Check size={20} color={scheme.onSurfaceVariant} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={st.featTitle}>{s.onboarding.noPay}</Text>
                </View>
              </View>
            </View>
          </ScrollView>
        )}

        {step === 1 && (
          <ScrollView
            contentContainerStyle={st.body}
            showsVerticalScrollIndicator={false}
            overScrollMode="never"
          >
            <Text style={st.title}>{s.onboarding.permTitle}</Text>
            <Text style={st.leadSmall}>{s.onboarding.permSub}</Text>

            <View style={st.card}>
              <View style={st.cardHead}>
                <View style={st.cardIcon}>
                  <LocateFixed size={20} color={scheme.primary} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={st.cardTitle}>{s.onboarding.locTitle}</Text>
                </View>
              </View>
              <Text style={st.cardBody}>{s.onboarding.locBody}</Text>
              {perms.loc === 'denied' && (
                <Text style={st.fine}>{s.onboarding.permissionDenied}</Text>
              )}
              {perms.loc === 'granted' ? (
                <View style={st.doneRow}>
                  <Check size={16} color={scheme.success} />
                  <Text style={st.doneText}>{s.onboarding.locOn}</Text>
                </View>
              ) : (
                <Pressable
                  onPress={() => void perms.requestLoc()}
                  disabled={perms.busy !== null}
                  accessibilityRole="button"
                  accessibilityState={{ disabled: perms.busy !== null, busy: perms.busy === 'loc' }}
                  style={({ pressed }) => [st.allow, pressed && { opacity: 0.8 }]}
                >
                  {perms.busy === 'loc' ? (
                    <ActivityIndicator size="small" color={scheme.onPrimary} />
                  ) : (
                    <LocateFixed size={17} color={scheme.onPrimary} />
                  )}
                  <Text style={st.allowText}>
                    {perms.locCanAskAgain ? s.onboarding.locAllow : s.onboarding.openSettings}
                  </Text>
                </Pressable>
              )}
            </View>

            <View style={st.card}>
              <View style={st.cardHead}>
                <View style={st.cardIcon}>
                  <Bell size={20} color={scheme.primary} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={st.cardTitle}>{s.onboarding.notifTitle}</Text>
                </View>
              </View>
              <Text style={st.cardBody}>{s.onboarding.notifBody}</Text>
              {perms.notif === 'denied' && (
                <Text style={st.fine}>{s.onboarding.permissionDenied}</Text>
              )}
              {perms.notif === 'granted' ? (
                <View style={st.doneRow}>
                  <Check size={16} color={scheme.success} />
                  <Text style={st.doneText}>{s.onboarding.notifOn}</Text>
                </View>
              ) : !NOTIF_SUPPORTED ? (
                <Text style={st.fine}>{s.onboarding.notifExpoGo}</Text>
              ) : (
                <Pressable
                  onPress={() => void perms.requestNotif()}
                  disabled={perms.busy !== null}
                  accessibilityRole="button"
                  accessibilityState={{
                    disabled: perms.busy !== null,
                    busy: perms.busy === 'notif',
                  }}
                  style={({ pressed }) => [st.allow, pressed && { opacity: 0.8 }]}
                >
                  {perms.busy === 'notif' ? (
                    <ActivityIndicator size="small" color={scheme.onPrimary} />
                  ) : (
                    <Bell size={17} color={scheme.onPrimary} />
                  )}
                  <Text style={st.allowText}>
                    {perms.notif === 'denied' ? s.onboarding.openSettings : s.onboarding.notifAllow}
                  </Text>
                </Pressable>
              )}
            </View>
            <Pressable
              onPress={() => router.push('/privacy')}
              accessibilityRole="link"
              style={({ pressed }) => [st.privacyLink, pressed && { opacity: 0.7 }]}
            >
              <Text style={st.privacyText}>{s.landing.privacy.linkLabel}</Text>
            </Pressable>
          </ScrollView>
        )}

        {step === 2 && (
          <View style={st.cityStep}>
            <FlatList
              data={CITIES}
              keyExtractor={(c) => c.id}
              style={st.cityList}
              contentContainerStyle={st.cityListContent}
              ListHeaderComponent={
                <View style={st.cityHead}>
                  <Text style={st.title}>{s.onboarding.cityTitle}</Text>
                  <Text style={st.leadSmall}>{s.onboarding.cityBody}</Text>

                  {suggested ? (
                    <Text style={st.suggestNote}>
                      {s.onboarding.citySuggested(s.city.loc(suggested))}
                    </Text>
                  ) : perms.loc !== 'granted' ? (
                    <Text style={st.suggestNote}>{s.onboarding.cityNoGps}</Text>
                  ) : citySuggestionStatus === 'locating' ? (
                    <Text style={st.suggestNote}>{s.onboarding.cityLocating}</Text>
                  ) : citySuggestionStatus === 'nomatch' ? (
                    <Text style={st.suggestNote}>{s.onboarding.cityNoMatch}</Text>
                  ) : null}
                </View>
              }
              showsVerticalScrollIndicator
              overScrollMode="never"
              accessibilityRole="radiogroup"
              renderItem={({ item: c }) => {
                const active = cityId === c.id;
                const isSuggested = suggested === c.id;
                return (
                  <Pressable
                    onPress={() => void pick(c.id)}
                    disabled={switchingCity}
                    style={({ pressed }) => [
                      st.cityChip,
                      active && st.cityChipActive,
                      pressed && !active && { opacity: 0.75 },
                    ]}
                    accessibilityRole="radio"
                    accessibilityState={{ checked: active, disabled: switchingCity }}
                    // Etykieta opisuje wybór, nie podpowiedź GPS: TalkBack czyta „Proponowane
                    // miasto według GPS" jako nazwę przycisku, a stan i tak
                    // ogłasza przez accessibilityState.
                    accessibilityLabel={s.onboarding.cityPickA11y(s.city.name(c.id))}
                    accessibilityHint={
                      isSuggested ? s.onboarding.citySuggestedA11y(s.city.name(c.id)) : undefined
                    }
                  >
                    <View style={{ flex: 1 }}>
                      <Text style={[st.cityName, active && st.cityNameActive]}>
                        {s.city.name(c.id)}
                      </Text>
                      <Text style={[st.citySub, active && st.citySubActive]}>
                        {s.city.feeds(c.id)}
                      </Text>
                    </View>
                    <View style={[st.radio, active && st.radioActive]}>
                      {active && <Check size={16} color={scheme.onPrimary} />}
                    </View>
                  </Pressable>
                );
              }}
            />
          </View>
        )}

        {step === 3 && (
          <ScrollView
            contentContainerStyle={st.body}
            showsVerticalScrollIndicator={false}
            overScrollMode="never"
          >
            <View style={st.heroMarkSmall}>
              <Database size={30} color={scheme.onPrimaryContainer} />
            </View>
            <Text style={st.title}>{s.onboarding.dlTitle(cityGen)}</Text>
            <Text style={st.leadSmall}>{s.onboarding.dlBody(cityFeeds)}</Text>

            <View style={st.card}>
              {dataStatus.state === 'empty' && !busyGtfs && (
                <>
                  <View style={st.statRow}>
                    <WifiOff size={18} color={scheme.onSurfaceVariant} />
                    <Text style={st.statText}>{s.onboarding.dlEmpty}</Text>
                  </View>
                  <Text style={st.fine}>{s.onboarding.dlSize}</Text>
                </>
              )}

              {(dataStatus.state === 'downloading' || dataStatus.state === 'importing') && (
                <>
                  <View style={st.statRow}>
                    <ActivityIndicator size="small" color={scheme.primary} />
                    <Text style={st.statText}>
                      {dataStatus.state === 'downloading'
                        ? s.onboarding.dlProgress(Math.round(dataStatus.progress * 100))
                        : s.onboarding.dlStep(
                            dataStatus.step,
                            Math.round(dataStatus.progress * 100),
                          )}
                    </Text>
                  </View>
                  <View
                    style={st.bar}
                    accessibilityRole="progressbar"
                    accessibilityLabel={s.onboarding.dlProgress(
                      Math.round(dataStatus.progress * 100),
                    )}
                    accessibilityValue={{
                      min: 0,
                      max: 100,
                      now: Math.round(dataStatus.progress * 100),
                    }}
                  >
                    <View
                      style={[st.barFill, { width: `${Math.round(dataStatus.progress * 100)}%` }]}
                    />
                  </View>
                  <Text style={st.fine}>{s.onboarding.dlKeepOpen}</Text>
                </>
              )}

              {gtfsReady && (
                <>
                  <View style={st.successRow}>
                    <View style={st.successBadge}>
                      <Check size={22} color={scheme.onSuccessContainer} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={st.cardTitle}>{s.onboarding.dlDone}</Text>
                      <Text style={st.cardBody}>
                        {s.onboarding.dlDoneSub(dataStatus.stops, dataStatus.trips)}
                      </Text>
                    </View>
                  </View>
                </>
              )}

              {dataStatus.state === 'error' && (
                <>
                  <Text style={st.cardTitle}>{s.onboarding.dlFail}</Text>
                  <Text style={st.cardBody}>{s.onboarding.dlFailBody(dataStatus.message)}</Text>
                  <Pressable
                    onPress={() => void startDownload()}
                    disabled={busyGtfs}
                    accessibilityRole="button"
                    style={({ pressed }) => [st.allow, pressed && { opacity: 0.8 }]}
                  >
                    <Download size={17} color={scheme.onPrimary} />
                    <Text style={st.allowText}>{s.onboarding.footerRetry}</Text>
                  </Pressable>
                </>
              )}
            </View>
          </ScrollView>
        )}

        {step === 4 && (
          <KeyboardAvoidingView
            style={{ flex: 1 }}
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
            keyboardVerticalOffset={80}
          >
            <ScrollView
              ref={step3Scroll}
              contentContainerStyle={[st.body, { paddingBottom: 240 }]}
              showsVerticalScrollIndicator={false}
              overScrollMode="never"
              keyboardShouldPersistTaps="handled"
              keyboardDismissMode="on-drag"
            >
              <Text style={st.title}>{s.onboarding.placesTitle}</Text>
              <Text style={st.leadSmall}>{s.onboarding.placesBody}</Text>

              {placeSlots.map((slot) => {
                const Icon = slot.icon;
                const saved = slots.bySlot[slot.key];
                const open = slots.activeSlot === slot.key;
                return (
                  <View
                    key={slot.key}
                    style={st.card}
                    onLayout={(e) => {
                      slotY.current[slot.key] = e.nativeEvent.layout.y;
                    }}
                  >
                    <View style={[st.slotRow, compact && st.slotRowCompact]}>
                      <View style={st.cardIcon}>
                        <Icon size={20} color={scheme.primary} />
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={st.cardTitle}>{slot.name}</Text>
                        <Text style={st.cardWhy} numberOfLines={fontScale > 1.3 ? undefined : 2}>
                          {saved ? saved.address : slot.hint}
                        </Text>
                      </View>
                      {saved ? (
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                          <Check size={20} color={scheme.success} />
                          <Pressable
                            onPress={() => void slots.remove(saved.id)}
                            hitSlop={8}
                            style={st.miniX}
                            accessibilityLabel={s.onboarding.removeSlotA11y(slot.name)}
                            accessibilityRole="button"
                          >
                            <X size={15} color={scheme.onSurfaceVariant} />
                          </Pressable>
                        </View>
                      ) : (
                        <Pressable
                          onPress={() => {
                            slots.setActiveSlot(open ? null : slot.key);
                            slots.setQuery('');
                          }}
                          style={({ pressed }) => [st.addPill, pressed && { opacity: 0.75 }]}
                          accessibilityRole="button"
                        >
                          <Text style={st.addPillText}>
                            {open ? s.onboarding.closeAction : s.onboarding.addAction}
                          </Text>
                        </Pressable>
                      )}
                    </View>

                    {open && !saved && (
                      <View style={{ marginTop: 12, gap: 8 }}>
                        <View style={st.searchBox}>
                          <Search size={17} color={scheme.onSurfaceVariant} />
                          <TextInput
                            value={slots.query}
                            onChangeText={slots.setQuery}
                            onFocus={() => scrollSlotIntoView(slot.key)}
                            placeholder={s.onboarding.addressFor(slot.name)}
                            accessibilityLabel={s.onboarding.addressFor(slot.name)}
                            placeholderTextColor={scheme.onSurfaceVariant}
                            style={st.searchInput}
                            autoFocus
                            returnKeyType="search"
                          />
                          {slots.searching && (
                            <ActivityIndicator size="small" color={scheme.primary} />
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
                          <Pressable
                            key={r.id}
                            onPress={() => void slots.saveForSlot(slot.key, r)}
                            disabled={slots.saving}
                            accessibilityRole="button"
                            accessibilityState={{ disabled: slots.saving }}
                            style={({ pressed }) => [st.resultRow, pressed && { opacity: 0.7 }]}
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
                          </Pressable>
                        ))}
                      </View>
                    )}
                  </View>
                );
              })}
            </ScrollView>
          </KeyboardAvoidingView>
        )}
      </Animated.View>

      <View style={st.footer}>
        {step === 0 && (
          <>
            <PrimaryBtn label={s.onboarding.start} onPress={next} />
            <Pressable
              onPress={() => router.push('/privacy')}
              accessibilityRole="link"
              style={({ pressed }) => [st.privacyLink, pressed && { opacity: 0.7 }]}
            >
              <Text style={st.privacyText}>{s.landing.privacy.linkLabel}</Text>
            </Pressable>
          </>
        )}
        {step === 1 && (
          <PrimaryBtn
            label={s.onboarding.next}
            onPress={next}
            icon={<ChevronRight size={18} color={scheme.onPrimary} />}
          />
        )}
        {step === 2 && (
          <PrimaryBtn
            label={switchingCity ? s.city.switching : s.onboarding.next}
            onPress={next}
            disabled={switchingCity}
            icon={
              switchingCity ? (
                <ActivityIndicator size="small" color={scheme.onSurfaceVariant} />
              ) : (
                <ChevronRight size={18} color={scheme.onPrimary} />
              )
            }
          />
        )}
        {step === 3 && (
          <>
            <PrimaryBtn
              label={
                gtfsReady
                  ? s.onboarding.next
                  : dataStatus.state === 'error'
                    ? s.onboarding.footerRetry
                    : busyGtfs
                      ? s.onboarding.footerDownloading
                      : s.onboarding.footerDownload
              }
              disabled={busyGtfs && !gtfsReady}
              onPress={() => {
                if (gtfsReady) next();
                else void startDownload();
              }}
              icon={
                busyGtfs && !gtfsReady ? (
                  <ActivityIndicator size="small" color={scheme.onPrimary} />
                ) : (
                  <ChevronRight size={18} color={scheme.onPrimary} />
                )
              }
            />
            {!gtfsReady && <Text style={st.lockNote}>{s.onboarding.needTimetable}</Text>}
            {/* Bez tego kroku apka jest nie do przejścia: rozkład miasta może nie
                być na serwerze albo pobieranie może paść, a „Dalej" odblokowuje
                się dopiero po gotowej bazie. Użytkownik zostawałby w ekranie
                z „Spróbuj ponowić" w nieskończoność. */}
            {!gtfsReady && <GhostBtn label={s.onboarding.skipTimetable} onPress={next} />}
          </>
        )}
        {step === 4 && (
          <>
            <PrimaryBtn
              label={savedCount > 0 ? s.onboarding.doneCount(savedCount) : s.onboarding.donePlain}
              onPress={() => void finish()}
              disabled={leaving}
              icon={<Check size={18} color={scheme.onPrimary} />}
            />
            <GhostBtn label={s.onboarding.skip} onPress={() => void finish()} />
          </>
        )}
      </View>
    </SafeAreaView>
  );
}

const st = StyleSheet.create({
  safe: { flex: 1, backgroundColor: scheme.surface },
  top: {
    paddingHorizontal: 24,
    paddingTop: 8,
    paddingBottom: 16,
    gap: 12,
  },
  topRow: { flexDirection: 'row', alignItems: 'center', gap: 16, minHeight: 48 },
  topHeading: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 12, minWidth: 0 },
  back: {
    width: 48,
    height: 48,
    borderRadius: shape.full,
    backgroundColor: scheme.surfaceContainerHigh,
    alignItems: 'center',
    justifyContent: 'center',
  },
  backPressed: { backgroundColor: scheme.surfaceContainerHighest },
  dots: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  dot: { flex: 1, height: 8, borderRadius: shape.full, backgroundColor: scheme.outline },
  dotActive: { flex: 2, backgroundColor: scheme.primary, height: 12 },
  dotDone: { backgroundColor: scheme.secondary },
  stepLabel: { ...type.titleMedium, color: scheme.onSurface, flexShrink: 1 },
  stepCount: { ...type.labelLarge, color: scheme.onSurfaceVariant, fontVariant: ['tabular-nums'] },
  body: { paddingHorizontal: 24, paddingTop: 12, paddingBottom: 24, gap: 24, flexGrow: 1 },
  welcomeHero: { gap: 16, paddingTop: 12 },
  heroMark: {
    width: 96,
    height: 96,
    borderRadius: 36,
    borderBottomRightRadius: 12,
    backgroundColor: scheme.primaryContainer,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  heroMarkSmall: {
    width: 72,
    height: 72,
    borderRadius: 22,
    backgroundColor: scheme.primaryContainer,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 8,
  },
  hero: { fontSize: 56, fontWeight: '700', color: scheme.onSurface, letterSpacing: -2 },
  heroCompact: { fontSize: 44, letterSpacing: -1 },
  title: {
    fontSize: 32,
    fontWeight: '600',
    color: scheme.onSurface,
    letterSpacing: -0.5,
    lineHeight: 40,
  },
  lead: { fontSize: 28, lineHeight: 36, fontWeight: '500', color: scheme.onSurface },
  leadSmall: { ...type.bodyLarge, lineHeight: 24, color: scheme.onSurfaceVariant },
  featList: {
    gap: 12,
    marginTop: 4,
  },
  feat: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  featIcon: {
    width: 28,
    height: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  featTitle: { ...type.bodyLarge, color: scheme.onSurface },
  card: {
    backgroundColor: scheme.surfaceContainerLow,
    borderRadius: 28,
    borderTopRightRadius: 12,
    padding: 20,
    gap: 16,
  },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  cardIcon: {
    width: 44,
    height: 44,
    borderRadius: shape.large,
    backgroundColor: scheme.secondaryContainer,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardTitle: { ...type.titleLarge, fontWeight: '500', color: scheme.onSurface },
  cardWhy: { ...type.bodyMedium, color: scheme.onSurfaceVariant, marginTop: 4 },
  cardBody: { ...type.bodyMedium, color: scheme.onSurfaceVariant },
  suggestNote: { ...type.bodyMedium, color: scheme.primary, fontWeight: '600' },
  cityStep: { flex: 1 },
  cityHead: { gap: 16, marginBottom: 16 },
  cityList: { flex: 1, marginTop: 4 },
  cityListContent: { paddingHorizontal: 24, paddingTop: 12, gap: 4, paddingBottom: 24 },
  cityChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: scheme.surfaceContainerLow,
    borderRadius: shape.small,
    padding: 20,
    minHeight: 80,
  },
  cityChipActive: { backgroundColor: scheme.primaryContainer, borderRadius: shape.extraLarge },
  cityName: { ...type.titleMedium, color: scheme.onSurface },
  cityNameActive: { color: scheme.onPrimaryContainer, fontWeight: '500' },
  citySub: { ...type.bodySmall, color: scheme.onSurfaceVariant, marginTop: 1 },
  citySubActive: { color: scheme.onPrimaryContainer },
  radio: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: scheme.outline,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioActive: { backgroundColor: scheme.primary, borderColor: scheme.primary },
  allow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: scheme.primary,
    borderRadius: shape.full,
    minHeight: 52,
    padding: 16,
    marginTop: 2,
  },
  allowText: {
    ...type.labelLarge,
    fontWeight: '500',
    color: scheme.onPrimary,
    flexShrink: 1,
    textAlign: 'center',
  },
  doneRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 6 },
  doneText: { ...type.bodyMedium, color: scheme.success, fontWeight: '500', flex: 1 },
  statRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  statText: { ...type.bodyMedium, color: scheme.onSurface, fontWeight: '600', flex: 1 },
  bar: {
    height: 10,
    borderRadius: 5,
    backgroundColor: scheme.surfaceContainerHighest,
    overflow: 'hidden',
  },
  barFill: { height: '100%', backgroundColor: scheme.primary, borderRadius: 5 },
  fine: { ...type.bodySmall, color: scheme.onSurfaceVariant },
  successRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  successBadge: {
    width: 48,
    height: 48,
    borderRadius: shape.medium,
    backgroundColor: scheme.successContainer,
    alignItems: 'center',
    justifyContent: 'center',
  },
  slotRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  slotRowCompact: { flexDirection: 'column', alignItems: 'stretch' },
  addPill: {
    backgroundColor: scheme.secondaryContainer,
    borderRadius: shape.medium,
    paddingHorizontal: 14,
    paddingVertical: 8,
    minHeight: 48,
    justifyContent: 'center',
  },
  addPillText: { ...type.labelMedium, color: scheme.onSecondaryContainer, fontWeight: '700' },
  miniX: {
    width: 48,
    height: 48,
    borderRadius: shape.medium,
    backgroundColor: scheme.surfaceContainerHigh,
    alignItems: 'center',
    justifyContent: 'center',
  },
  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: scheme.surfaceContainerHigh,
    borderRadius: shape.medium,
    paddingHorizontal: 12,
    minHeight: 56,
  },
  searchInput: {
    flex: 1,
    minWidth: 0,
    ...type.bodyLarge,
    color: scheme.onSurface,
    paddingVertical: 14,
  },
  resultRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: scheme.surfaceContainerHigh,
    borderRadius: shape.medium,
    padding: 16,
    minHeight: 64,
  },
  resultTitle: { ...type.titleSmall, color: scheme.onSurface },
  resultSub: { ...type.bodySmall, color: scheme.onSurfaceVariant },
  noResults: {
    padding: 12,
    borderRadius: shape.medium,
    backgroundColor: scheme.surfaceContainerHigh,
  },
  noResultsText: { ...type.bodySmall, color: scheme.onSurfaceVariant, lineHeight: 18 },
  footer: {
    paddingHorizontal: 24,
    paddingBottom: 12,
    paddingTop: 12,
    gap: 8,
    backgroundColor: scheme.surface,
  },
  primary: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: scheme.primary,
    borderRadius: shape.full,
    minHeight: 64,
    padding: 20,
  },
  primaryDisabled: { backgroundColor: scheme.surfaceContainerHighest, elevation: 0 },
  primaryText: {
    ...type.labelLarge,
    fontSize: 18,
    fontWeight: '600',
    color: scheme.onPrimary,
    flexShrink: 1,
    textAlign: 'center',
  },
  primaryTextDisabled: { color: scheme.onSurfaceVariant },
  privacyLink: {
    minHeight: 48,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 12,
  },
  privacyText: {
    ...type.labelLarge,
    color: scheme.onSurfaceVariant,
    textDecorationLine: 'underline',
    textAlign: 'center',
  },
  ghost: { alignItems: 'center', justifyContent: 'center', paddingVertical: 12, minHeight: 48 },
  ghostText: {
    ...type.labelLarge,
    color: scheme.onSurfaceVariant,
    fontWeight: '500',
    textAlign: 'center',
  },
  lockNote: {
    ...type.labelSmall,
    color: scheme.onSurfaceVariant,
    textAlign: 'center',
    paddingTop: 2,
  },
});
