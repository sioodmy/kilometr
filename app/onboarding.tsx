import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
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
  Zap,
} from 'lucide-react-native';
import Animated, { FadeInRight, FadeOutLeft } from 'react-native-reanimated';
import { elev, scheme, shape, type } from '../src/theme/tokens';
import { setOnboardingSeen } from '../src/services/onboarding';
import { ensureNotificationPermission, hasNotificationPermission } from '../src/services/notifications';
import {
  FavoritesService,
  SearchService,
} from '../src/services';
import {
  getDataStatus,
  importGtfsFromNetwork,
  refreshDataStatus,
  subscribeDataStatus,
  type DataStatus,
} from '../src/services/dataManager';
import type { SavedPlace, Suggestion } from '../src/types/models';

const STEPS = ['Witaj', 'Uprawnienia', 'Rozkład', 'Miejsca'];

// ─── Małe klocki ─────────────────────────────────────────────────────────────

function Dots({ step }: { step: number }) {
  return (
    <View style={s.dots}>
      {STEPS.map((label, i) => (
        <View key={label} style={[s.dot, i === step && s.dotActive, i < step && s.dotDone]} />
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
        s.primary,
        disabled && s.primaryDisabled,
        pressed && !disabled && { opacity: 0.88, transform: [{ scale: 0.99 }] },
      ]}
      accessibilityRole="button"
    >
      <Text style={[s.primaryText, disabled && s.primaryTextDisabled]}>{label}</Text>
      {icon}
    </Pressable>
  );
}

function GhostBtn({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [s.ghost, pressed && { opacity: 0.7 }]}
      accessibilityRole="button"
    >
      <Text style={s.ghostText}>{label}</Text>
    </Pressable>
  );
}

// ─── Krok 1: uprawnienia ─────────────────────────────────────────────────────

function usePermissionStates() {
  const [loc, setLoc] = useState<'unknown' | 'granted' | 'denied'>('unknown');
  const [notif, setNotif] = useState<'unknown' | 'granted' | 'denied'>('unknown');
  const [busy, setBusy] = useState<'loc' | 'notif' | null>(null);

  const refresh = useCallback(async () => {
    try {
      const l = await Location.getForegroundPermissionsAsync();
      setLoc(l.granted ? 'granted' : l.status === 'denied' ? 'denied' : 'unknown');
    } catch {
      setLoc('unknown');
    }
    try {
      // Przez serwis powiadomień: ma guard na Expo Go (bezpośredni import
      // expo-notifications potrafi wywalić ewaluację modułu).
      setNotif((await hasNotificationPermission()) ? 'granted' : 'unknown');
    } catch {
      setNotif('unknown');
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const requestLoc = useCallback(async () => {
    setBusy('loc');
    try {
      const r = await Location.requestForegroundPermissionsAsync();
      setLoc(r.granted ? 'granted' : 'denied');
      if (r.granted) {
        try {
          await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
        } catch {}
      }
    } catch {
      setLoc('denied');
    } finally {
      setBusy(null);
    }
  }, []);

  const requestNotif = useCallback(async () => {
    setBusy('notif');
    try {
      setNotif((await ensureNotificationPermission()) ? 'granted' : 'denied');
    } catch {
      setNotif('denied');
    } finally {
      setBusy(null);
    }
  }, []);

  return { loc, notif, busy, requestLoc, requestNotif };
}

function StatusPill({ v }: { v: 'unknown' | 'granted' | 'denied' }) {
  if (v === 'granted')
    return (
      <View style={[s.pill, s.pillOk]}>
        <Check size={12} color={scheme.onSuccessContainer} />
        <Text style={[s.pillText, { color: scheme.onSuccessContainer }]}>Włączone</Text>
      </View>
    );
  if (v === 'denied')
    return (
      <View style={[s.pill, s.pillOff]}>
        <Text style={[s.pillText, { color: scheme.onSurfaceVariant }]}>Wyłączone</Text>
      </View>
    );
  return (
    <View style={s.pill}>
      <Text style={s.pillText}>Do włączenia</Text>
    </View>
  );
}

// ─── Krok 3: zapisane miejsca ────────────────────────────────────────────────

const PLACE_SLOTS = [
  { key: 'home', name: 'Dom', icon: Home, hint: 'np. Swojczycka 41' },
  { key: 'work', name: 'Praca', icon: Briefcase, hint: 'np. Sky Tower' },
  { key: 'school', name: 'Uczelnia', icon: GraduationCap, hint: 'np. Politechnika' },
] as const;

type SlotKey = (typeof PLACE_SLOTS)[number]['key'];

function useOnboardingPlaces() {
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
    if (!activeSlot) return;
    const q = query.trim();
    const seq = ++searchSeq.current;
    if (!q) {
      setResults([]);
      setSearching(false);
      return;
    }
    setSearching(true);
    const t = setTimeout(() => {
      SearchService.search(q)
        .then((r) => {
          if (seq === searchSeq.current) setResults(r);
        })
        .catch(() => {
          if (seq === searchSeq.current) setResults([]);
        })
        .finally(() => {
          if (seq === searchSeq.current) setSearching(false);
        });
    }, 250);
    return () => clearTimeout(t);
  }, [query, activeSlot]);

  const bySlot = useMemo(() => {
    const map = {} as Record<SlotKey, SavedPlace | undefined>;
    for (const slot of PLACE_SLOTS) {
      map[slot.key] =
        places.find((p) => p.icon === slot.key) ??
        places.find((p) => p.name.toLowerCase() === slot.name.toLowerCase());
    }
    return map;
  }, [places]);

  const saveForSlot = useCallback(
    async (slot: SlotKey, sug: Suggestion) => {
      const meta = PLACE_SLOTS.find((x) => x.key === slot)!;
      setSaving(true);
      try {
        await FavoritesService.addPlace({
          name: meta.name,
          icon: slot,
          address: sug.address || sug.title,
          lat: sug.lat,
          lon: sug.lon,
        });
        await reload();
        setActiveSlot(null);
        setQuery('');
        setResults([]);
      } finally {
        setSaving(false);
      }
    },
    [reload],
  );

  const remove = useCallback(
    async (id: string) => {
      await FavoritesService.deletePlace(id);
      await reload();
    },
    [reload],
  );

  return { places, bySlot, activeSlot, setActiveSlot, query, setQuery, results, searching, saving, saveForSlot, remove };
}

// ─── Ekran ───────────────────────────────────────────────────────────────────

export default function OnboardingScreen() {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [leaving, setLeaving] = useState(false);
  const perms = usePermissionStates();
  const [dataStatus, setDataStatus] = useState<DataStatus>(() => getDataStatus());
  const [downloading, setDownloading] = useState(false);
  const slots = useOnboardingPlaces();
  const startedDownload = useRef(false);
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
    if (step === 2) void refreshDataStatus().catch(() => {});
  }, [step ]);

  const finish = useCallback(async () => {
    if (leaving) return;
    setLeaving(true);
    await setOnboardingSeen();
    router.replace('/');
  }, [leaving, router]);

  const next = useCallback(() => setStep((v) => Math.min(v + 1, STEPS.length - 1)), []);
  const back = useCallback(() => setStep((v) => Math.max(v - 1, 0)), []);

  const startDownload = useCallback(async () => {
    if (downloading) return;
    startedDownload.current = true;
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
    <SafeAreaView style={s.safe} edges={['top', 'bottom']}>
      {/* Pasek postępu */}
      <View style={s.top}>
        {step > 0 ? (
          <Pressable onPress={back} hitSlop={10} style={s.back} accessibilityLabel="Wstecz">
            <ChevronLeft size={22} color={scheme.onSurface} />
          </Pressable>
        ) : (
          <View style={s.back} />
        )}
        <View style={{ flex: 1, alignItems: 'center', gap: 6 }}>
          <Dots step={step} />
          <Text style={s.stepLabel}>
            Krok {step + 1} z {STEPS.length} • {STEPS[step]}
          </Text>
        </View>
        <View style={s.back} />
      </View>

      <Animated.View
        key={step}
        entering={FadeInRight.duration(260)}
        exiting={FadeOutLeft.duration(180)}
        style={{ flex: 1 }}
      >
        {/* ── 0 · Powitanie ─────────────────────────────────────────── */}
        {step === 0 && (
          <ScrollView
            contentContainerStyle={s.body}
            showsVerticalScrollIndicator={false}
            overScrollMode="never"
          >
            <View style={s.heroMark}>
              <View style={s.heroGlow} />
              <TramFront size={44} color={scheme.onPrimaryContainer} />
            </View>
            <Text style={s.hero}>Kilometr</Text>
            <Text style={s.lead}>Tym razem dojedziesz.</Text>

            <View style={s.featList}>
              <View style={s.feat}>
                <View style={s.featIcon}>
                  <Zap size={18} color={scheme.primary} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={s.featTitle}>Szybko</Text>
                </View>
              </View>
              <View style={s.feat}>
                <View style={s.featIcon}>
                  <X size={18} color={scheme.primary} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={s.featTitle}>Bez reklam</Text>
                </View>
              </View>
              <View style={s.feat}>
                <View style={s.featIcon}>
                  <Check size={18} color={scheme.primary} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={s.featTitle}>Bez mikropłatności</Text>
                </View>
              </View>
            </View>
          </ScrollView>
        )}

        {/* ── 1 · Dostępy ───────────────────────────────────────────── */}
        {step === 1 && (
          <ScrollView
            contentContainerStyle={s.body}
            showsVerticalScrollIndicator={false}
            overScrollMode="never"
          >
            <Text style={s.title}>Uprawnienia</Text>
            <Text style={s.leadSmall}>Lokalizacja i powiadomienia. Oba opcjonalne.</Text>

            <View style={s.card}>
              <View style={s.cardHead}>
                <View style={s.cardIcon}>
                  <LocateFixed size={20} color={scheme.primary} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={s.cardTitle}>Lokalizacja</Text>
                </View>
                <StatusPill v={perms.loc} />
              </View>
              <Text style={s.cardBody}>
                Służy do ustawienia punktu startowego i sortowania przystanków według odległości.
                Przetwarzana lokalnie na urządzeniu.
              </Text>
              {perms.loc === 'granted' ? (
                <View style={s.doneRow}>
                  <Check size={16} color={scheme.success} />
                  <Text style={s.doneText}>Lokalizacja włączona.</Text>
                </View>
              ) : (
                <Pressable
                  onPress={() => void perms.requestLoc()}
                  disabled={perms.busy !== null}
                  style={({ pressed }) => [s.allow, pressed && { opacity: 0.8 }]}
                >
                  {perms.busy === 'loc' ? (
                    <ActivityIndicator size="small" color={scheme.onPrimary} />
                  ) : (
                    <LocateFixed size={17} color={scheme.onPrimary} />
                  )}
                  <Text style={s.allowText}>Zezwól na lokalizację</Text>
                </Pressable>
              )}
            </View>

            <View style={s.card}>
              <View style={s.cardHead}>
                <View style={s.cardIcon}>
                  <Bell size={20} color={scheme.primary} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={s.cardTitle}>Powiadomienia</Text>
                </View>
                <StatusPill v={perms.notif} />
              </View>
              <Text style={s.cardBody}>
                Służą do wyświetlania przypiętego połączenia i alertów o utrudnieniach.
              </Text>
              {perms.notif === 'granted' ? (
                <View style={s.doneRow}>
                  <Check size={16} color={scheme.success} />
                  <Text style={s.doneText}>Powiadomienia włączone.</Text>
                </View>
              ) : (
                <Pressable
                  onPress={() => void perms.requestNotif()}
                  disabled={perms.busy !== null}
                  style={({ pressed }) => [s.allow, pressed && { opacity: 0.8 }]}
                >
                  {perms.busy === 'notif' ? (
                    <ActivityIndicator size="small" color={scheme.onPrimary} />
                  ) : (
                    <Bell size={17} color={scheme.onPrimary} />
                  )}
                  <Text style={s.allowText}>Włącz powiadomienia</Text>
                </Pressable>
              )}
            </View>
          </ScrollView>
        )}

        {/* ── 2 · Rozkład ───────────────────────────────────────────── */}
        {step === 2 && (
          <ScrollView
            contentContainerStyle={s.body}
            showsVerticalScrollIndicator={false}
            overScrollMode="never"
          >
            <View style={s.heroMarkSmall}>
              <Database size={30} color={scheme.onPrimaryContainer} />
            </View>
            <Text style={s.title}>Pobierz rozkład{'\n'}Wrocławia</Text>
            <Text style={s.leadSmall}>
              Pełny rozkład MPK z Open Data Wrocław. Pobierany raz. Działa offline.
            </Text>

            <View style={s.card}>
              {dataStatus.state === 'empty' && !busyGtfs && (
                <>
                  <View style={s.statRow}>
                    <WifiOff size={18} color={scheme.onSurfaceVariant} />
                    <Text style={s.statText}>Brak danych offline.</Text>
                  </View>
                  <Pressable
                    onPress={() => void startDownload()}
                    style={({ pressed }) => [s.allow, pressed && { opacity: 0.8 }]}
                  >
                    <Download size={17} color={scheme.onPrimary} />
                    <Text style={s.allowText}>Pobierz pełny rozkład</Text>
                  </Pressable>
                  <Text style={s.fine}>~40–60 MB • kilka minut • tylko raz</Text>
                </>
              )}

              {(dataStatus.state === 'downloading' || dataStatus.state === 'importing') && (
                <>
                  <View style={s.statRow}>
                    <ActivityIndicator size="small" color={scheme.primary} />
                    <Text style={s.statText}>
                      {dataStatus.state === 'downloading'
                        ? `Pobieranie… ${Math.round(dataStatus.progress * 100)}%`
                        : `${dataStatus.step} ${Math.round(dataStatus.progress * 100)}%`}
                    </Text>
                  </View>
                  <View style={s.bar}>
                    <View style={[s.barFill, { width: `${Math.round(dataStatus.progress * 100)}%` }]} />
                  </View>
                  <Text style={s.fine}>Nie zamykaj aplikacji w trakcie pobierania.</Text>
                </>
              )}

              {gtfsReady && (
                <>
                  <View style={s.successRow}>
                    <View style={s.successBadge}>
                      <Check size={22} color={scheme.onSuccessContainer} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={s.cardTitle}>Rozkład gotowy.</Text>
                      <Text style={s.cardBody}>
                        {dataStatus.stops} przystanków • {dataStatus.trips} kursów.
                      </Text>
                    </View>
                  </View>
                </>
              )}

              {dataStatus.state === 'error' && (
                <>
                  <Text style={s.cardTitle}>Coś poszło nie tak</Text>
                  <Text style={s.cardBody}>{dataStatus.message}. Sprawdź internet i spróbuj ponownie.</Text>
                  <Pressable
                    onPress={() => void startDownload()}
                    disabled={busyGtfs}
                    style={({ pressed }) => [s.allow, pressed && { opacity: 0.8 }]}
                  >
                    <Download size={17} color={scheme.onPrimary} />
                    <Text style={s.allowText}>Spróbuj ponownie</Text>
                  </Pressable>
                </>
              )}
            </View>
          </ScrollView>
        )}

        {/* ── 3 · Miejsca (pomijalne) ───────────────────────────────── */}
        {step === 3 && (
          <KeyboardAvoidingView
            style={{ flex: 1 }}
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
            keyboardVerticalOffset={80}
          >
          <ScrollView
            ref={step3Scroll}
            contentContainerStyle={[s.body, { paddingBottom: 240 }]}
            showsVerticalScrollIndicator={false}
            overScrollMode="never"
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="on-drag"
          >
            <Text style={s.title}>Gdzie bywasz{'\n'}najczęściej?</Text>
            <Text style={s.leadSmall}>
              Zapisane miejsca przyspieszają wyszukiwanie. Ten krok można pominąć.
            </Text>

            {PLACE_SLOTS.map((slot) => {
              const Icon = slot.icon;
              const saved = slots.bySlot[slot.key];
              const open = slots.activeSlot === slot.key;
              return (
                <View
                  key={slot.key}
                  style={s.card}
                  onLayout={(e) => {
                    slotY.current[slot.key] = e.nativeEvent.layout.y;
                  }}
                >
                  <View style={s.slotRow}>
                    <View style={s.cardIcon}>
                      <Icon size={20} color={scheme.primary} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={s.cardTitle}>{slot.name}</Text>
                      <Text style={s.cardWhy} numberOfLines={1}>
                        {saved ? saved.address : slot.hint}
                      </Text>
                    </View>
                    {saved ? (
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                        <View style={[s.pill, s.pillOk]}>
                          <Check size={12} color={scheme.onSuccessContainer} />
                          <Text style={[s.pillText, { color: scheme.onSuccessContainer }]}>Dodane</Text>
                        </View>
                        <Pressable
                          onPress={() => void slots.remove(saved.id)}
                          hitSlop={8}
                          style={s.miniX}
                          accessibilityLabel={`Usuń ${slot.name}`}
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
                        style={({ pressed }) => [s.addPill, pressed && { opacity: 0.75 }]}
                      >
                        <Text style={s.addPillText}>{open ? 'Zamknij' : '+ Dodaj'}</Text>
                      </Pressable>
                    )}
                  </View>

                  {open && !saved && (
                    <View style={{ marginTop: 12, gap: 8 }}>
                      <View style={s.searchBox}>
                        <Search size={17} color={scheme.onSurfaceVariant} />
                        <TextInput
                          value={slots.query}
                          onChangeText={slots.setQuery}
                          onFocus={() => scrollSlotIntoView(slot.key)}
                          placeholder={`Adres dla: ${slot.name}…`}
                          placeholderTextColor={scheme.onSurfaceVariant}
                          style={s.searchInput}
                          autoFocus
                          returnKeyType="search"
                        />
                        {slots.searching && <ActivityIndicator size="small" color={scheme.primary} />}
                      </View>
                      {/* Bez tego użytkownik widział pole z wpisanym tekstem
                          i nic więcej — bez informacji, czy szukanie w ogóle
                          działa. Adresy wymagają internetu, przystanki nie. */}
                      {slots.results.length === 0 &&
                        !slots.searching &&
                        slots.query.trim().length >= 2 && (
                          <View style={s.noResults}>
                            <Text style={s.noResultsText}>
                              Brak wyników dla „{slots.query.trim()}”. Przystanki
                              szukamy offline, adresy wymagają internetu.
                            </Text>
                          </View>
                        )}
                      {slots.results.map((r) => (
                        <Pressable
                          key={r.id}
                          onPress={() => void slots.saveForSlot(slot.key, r)}
                          disabled={slots.saving}
                          style={({ pressed }) => [s.resultRow, pressed && { opacity: 0.7 }]}
                        >
                          <MapPin size={16} color={scheme.primary} />
                          <View style={{ flex: 1 }}>
                            <Text style={s.resultTitle} numberOfLines={1}>
                              {r.title}
                            </Text>
                            <Text style={s.resultSub} numberOfLines={1}>
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

      {/* Stopka */}
      <View style={s.footer}>
        {step === 0 && (
          <PrimaryBtn
            label="Zaczynamy"
            onPress={next}
            icon={<ChevronRight size={18} color={scheme.onPrimary} />}
          />
        )}
        {step === 1 && (
          <>
            <PrimaryBtn label="Dalej" onPress={next} icon={<ChevronRight size={18} color={scheme.onPrimary} />} />
            <GhostBtn label="Później" onPress={next} />
          </>
        )}
        {step === 2 && (
          <>
            <PrimaryBtn
              label={
                gtfsReady
                  ? 'Dalej'
                  : dataStatus.state === 'error'
                    ? 'Spróbuj ponownie'
                    : busyGtfs
                      ? 'Pobieranie…'
                      : 'Pobierz rozkład'
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
            {!gtfsReady && (
              <Text style={s.lockNote}>Bez rozkładu nie da się wyszukać połączeń.</Text>
            )}
          </>
        )}
        {step === 3 && (
          <>
            <PrimaryBtn
              label={savedCount > 0 ? `Gotowe (${savedCount})` : 'Gotowe'}
              onPress={() => void finish()}
              icon={<Check size={18} color={scheme.onPrimary} />}
            />
            <GhostBtn label="Pomiń na razie" onPress={() => void finish()} />
          </>
        )}
      </View>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: scheme.surface },
  top: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingTop: 8, minHeight: 56 },
  back: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  dots: { flexDirection: 'row', gap: 6 },
  dot: { width: 22, height: 5, borderRadius: 3, backgroundColor: scheme.surfaceContainerHighest },
  dotActive: { width: 34, backgroundColor: scheme.primary },
  dotDone: { backgroundColor: scheme.primaryContainer },
  stepLabel: { ...type.labelSmall, color: scheme.onSurfaceVariant },
  body: { paddingHorizontal: 20, paddingTop: 10, paddingBottom: 16, gap: 12 },
  heroMark: {
    width: 104,
    height: 104,
    borderRadius: 32,
    backgroundColor: scheme.primaryContainer,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 12,
    alignSelf: 'center',
    overflow: 'hidden',
    ...elev.level2,
  },
  heroGlow: {
    position: 'absolute',
    width: 150,
    height: 150,
    borderRadius: 75,
    backgroundColor: scheme.primary,
    opacity: 0.18,
  },
  heroMarkSmall: {
    width: 72,
    height: 72,
    borderRadius: 22,
    backgroundColor: scheme.primaryContainer,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 8,
    ...elev.level1,
  },
  hero: { fontSize: 52, fontWeight: '700', color: scheme.onSurface, textAlign: 'center', letterSpacing: -1 },
  title: { fontSize: 34, fontWeight: '700', color: scheme.onSurface, letterSpacing: -0.5, lineHeight: 40 },
  lead: { ...type.bodyLarge, color: scheme.onSurfaceVariant, textAlign: 'center', lineHeight: 24, paddingHorizontal: 8 },
  leadSmall: { ...type.bodyMedium, color: scheme.onSurfaceVariant, lineHeight: 21 },
  featList: { gap: 10, marginTop: 6 },
  feat: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: scheme.surfaceContainer,
    borderRadius: shape.large,
    padding: 14,
    ...elev.level1,
  },
  featIcon: {
    width: 40,
    height: 40,
    borderRadius: shape.full,
    backgroundColor: scheme.secondaryContainer,
    alignItems: 'center',
    justifyContent: 'center',
  },
  featTitle: { ...type.titleSmall, color: scheme.onSurface },
  card: {
    backgroundColor: scheme.surfaceContainer,
    borderRadius: shape.large,
    padding: 16,
    gap: 10,
    ...elev.level1,
  },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  cardIcon: {
    width: 44,
    height: 44,
    borderRadius: shape.full,
    backgroundColor: scheme.secondaryContainer,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardTitle: { ...type.titleMedium, color: scheme.onSurface },
  cardWhy: { ...type.bodySmall, color: scheme.primary, marginTop: 1 },
  cardBody: { ...type.bodySmall, color: scheme.onSurfaceVariant, lineHeight: 18 },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: scheme.surfaceContainerHighest,
    borderRadius: shape.full,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  pillOk: { backgroundColor: scheme.successContainer },
  pillOff: { opacity: 0.8 },
  pillText: { ...type.labelSmall, color: scheme.onSurfaceVariant, fontWeight: '700' },
  allow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: scheme.primary,
    borderRadius: shape.full,
    paddingVertical: 13,
    marginTop: 2,
  },
  allowText: { ...type.labelLarge, fontWeight: '700', color: scheme.onPrimary },
  doneRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 6 },
  doneText: { ...type.bodyMedium, color: scheme.success, fontWeight: '600' },
  statRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  statText: { ...type.bodyMedium, color: scheme.onSurface, fontWeight: '600', flex: 1 },
  bar: { height: 10, borderRadius: 5, backgroundColor: scheme.surfaceContainerHighest, overflow: 'hidden' },
  barFill: { height: '100%', backgroundColor: scheme.primary, borderRadius: 5 },
  fine: { ...type.labelSmall, color: scheme.onSurfaceVariant, textAlign: 'center' },
  successRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  successBadge: {
    width: 48,
    height: 48,
    borderRadius: shape.full,
    backgroundColor: scheme.successContainer,
    alignItems: 'center',
    justifyContent: 'center',
  },
  slotRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  addPill: {
    backgroundColor: scheme.secondaryContainer,
    borderRadius: shape.full,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  addPillText: { ...type.labelMedium, color: scheme.onSecondaryContainer, fontWeight: '700' },
  miniX: {
    width: 30,
    height: 30,
    borderRadius: 15,
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
    borderWidth: 1,
    borderColor: scheme.outlineVariant,
    paddingHorizontal: 12,
    height: 46,
  },
  searchInput: { flex: 1, ...type.bodyMedium, color: scheme.onSurface },
  resultRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: scheme.surfaceContainerHigh,
    borderRadius: shape.medium,
    padding: 10,
  },
  resultTitle: { ...type.titleSmall, color: scheme.onSurface },
  resultSub: { ...type.bodySmall, color: scheme.onSurfaceVariant },
  noResults: {
    padding: 12,
    borderRadius: shape.medium,
    backgroundColor: scheme.surfaceContainerHigh,
  },
  noResultsText: { ...type.bodySmall, color: scheme.onSurfaceVariant, lineHeight: 18 },
  footer: { paddingHorizontal: 20, paddingBottom: 10, paddingTop: 8, gap: 6 },
  primary: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: scheme.primary,
    borderRadius: shape.full,
    height: 54,
    ...elev.level2,
  },
  primaryDisabled: { backgroundColor: scheme.surfaceContainerHighest, elevation: 0 },
  primaryText: { ...type.labelLarge, fontSize: 16, fontWeight: '700', color: scheme.onPrimary },
  primaryTextDisabled: { color: scheme.onSurfaceVariant },
  ghost: { alignItems: 'center', justifyContent: 'center', paddingVertical: 10 },
  ghostText: { ...type.labelLarge, color: scheme.onSurfaceVariant, fontWeight: '600' },
  lockNote: { ...type.labelSmall, color: scheme.onSurfaceVariant, textAlign: 'center', paddingTop: 2 },
});
