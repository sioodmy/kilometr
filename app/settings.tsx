import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  BusFront,
  BellRing,
  CableCar,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Coffee,
  Download,
  DatabaseBackup,
  ExternalLink,
  Footprints,
  MapPin,
  Languages,
  Navigation,
  Palette,
  Minus,
  Plus,
  ShieldCheck,
  Rabbit,
  RotateCcw,
  TrainFront,
  TramFront,
  Turtle,
} from 'lucide-react-native';
import type { RouteStyle, TransitVehicleMode } from '../src/services/routing/types';
import { scheme, shape, type } from '../src/theme/tokens';
import { tr, useLocaleSetting, useStrings, type LocaleSetting } from '../src/i18n';
import { type CityId } from '../src/cities';
import { CitySelectSheet } from '../src/components/CitySelectSheet';
import { useActiveCity } from '../src/services/cityStore';
import {
  SETTINGS_LIMITS,
  TRANSIT_MODES,
  WALK_PACE_DEFAULTS_MPS,
  formatTransferTime,
  formatWalkDistance,
  formatWalkSpeed,
  useRoutingSettings,
  useWalkSpeedMps,
  type WalkPaceProfile,
} from '../src/services/settings';
import {
  getDataStatus,
  importGtfsFromNetwork,
  refreshDataStatus,
  subscribeDataStatus,
  type DataStatus,
  type ImportOutcome,
} from '../src/services/dataManager';
import { getTimetableDownloadGate, remainingHours } from '../src/services/downloadLimits';
import { transfersLabel } from '../src/components/ConnectionCard';
import { NotificationPrefsCard } from '../src/components/NotificationPrefsCard';
import { BackupCard } from '../src/components/BackupCard';
import { DiagnosticsCard } from '../src/components/DiagnosticsCard';
import { OfflineMapCard } from '../src/components/OfflineMapCard';
import { PersonalizationCard } from '../src/components/PersonalizationCard';
import { useThemeSetting } from '../src/theme/personalization';
import { hasTrainRoutes } from '../src/services/gtfsDatabase';

function dataStatusLabel(status: DataStatus): string {
  const t = tr().settings;
  switch (status.state) {
    case 'empty':
      return t.dataEmpty;
    case 'downloading':
      return t.dataDownloading(Math.round(status.progress * 100));
    case 'importing':
      return t.dataStep(status.step, Math.round(status.progress * 100));
    case 'ready':
      return t.dataReady(status.stops, status.trips);
    case 'error':
      return t.dataError(status.message);
  }
}

function SectionLabel({ children }: { children: string }) {
  return (
    <Text style={styles.sectionLabel} accessibilityRole="header">
      {children}
    </Text>
  );
}

function Stepper({
  label,
  value,
  onMinus,
  onPlus,
  minusDisabled,
  plusDisabled,
}: {
  label: string;
  value: string;
  onMinus: () => void;
  onPlus: () => void;
  minusDisabled?: boolean;
  plusDisabled?: boolean;
}) {
  const s = useStrings();
  return (
    <View style={styles.stepper}>
      <Pressable
        onPress={onMinus}
        disabled={minusDisabled}
        accessibilityRole="button"
        accessibilityLabel={s.settings.decrease(label)}
        accessibilityState={{ disabled: !!minusDisabled }}
        style={({ pressed }) => [
          styles.stepBtn,
          minusDisabled && styles.stepBtnDisabled,
          pressed && !minusDisabled && { opacity: 0.7 },
        ]}
        hitSlop={8}
      >
        <Minus size={18} color={minusDisabled ? scheme.outline : scheme.onSecondaryContainer} />
      </Pressable>
      <Text style={styles.stepValue} accessibilityLiveRegion="polite">
        {value}
      </Text>
      <Pressable
        onPress={onPlus}
        disabled={plusDisabled}
        accessibilityRole="button"
        accessibilityLabel={s.settings.increase(label)}
        accessibilityState={{ disabled: !!plusDisabled }}
        style={({ pressed }) => [
          styles.stepBtn,
          plusDisabled && styles.stepBtnDisabled,
          pressed && !plusDisabled && { opacity: 0.7 },
        ]}
        hitSlop={8}
      >
        <Plus size={18} color={plusDisabled ? scheme.outline : scheme.onSecondaryContainer} />
      </Pressable>
    </View>
  );
}

function SettingRow({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <View style={styles.settingRow}>
      <View style={styles.settingText}>
        <Text style={styles.settingTitle}>{title}</Text>
        {hint ? <Text style={styles.settingHint}>{hint}</Text> : null}
      </View>
      {children}
    </View>
  );
}

const LANG_OPTIONS: {
  value: LocaleSetting;
  label: 'langSystem' | 'langPolish' | 'langEnglish' | 'langGerman' | 'langUkrainian';
}[] = [
  { value: 'system', label: 'langSystem' },
  { value: 'pl', label: 'langPolish' },
  { value: 'en', label: 'langEnglish' },
  { value: 'de', label: 'langGerman' },
  { value: 'uk', label: 'langUkrainian' },
];

type SettingsSection = 'routing' | 'offline' | 'app' | 'personalization' | 'notifications' | 'backup';

function SettingsLink({
  title,
  detail,
  icon: Icon,
  onPress,
}: {
  title: string;
  detail: string;
  icon: typeof MapPin;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      style={({ pressed }) => [styles.menuRow, pressed && styles.menuRowPressed]}
    >
      <View style={styles.menuIcon}>
        <Icon size={22} color={scheme.onSurfaceVariant} />
      </View>
      <View style={styles.settingText}>
        <Text style={styles.menuTitle}>{title}</Text>
        <Text style={styles.menuDetail}>{detail}</Text>
      </View>
      <ChevronRight size={18} color={scheme.onSurfaceVariant} />
    </Pressable>
  );
}

export default function SettingsScreen() {
  const router = useRouter();
  const { section } = useLocalSearchParams<{ section?: string }>();
  const insets = useSafeAreaInsets();
  const { width, fontScale } = useWindowDimensions();
  const compact = width / fontScale < 330;
  const { settings, update, reset } = useRoutingSettings();
  const s = useStrings();
  const themeSetting = useThemeSetting();
  const { cityId, setCity } = useActiveCity();
  const operatorShort = s.city.operatorShort(cityId);
  const feeds = s.city.feeds(cityId);
  const { setting: langSetting, setSetting: setLang } = useLocaleSetting();
  const walkMps = useWalkSpeedMps();
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const sectionTitles: Record<SettingsSection, string> = {
    routing: s.settings.planningTitle,
    offline: s.settings.offlineTitle,
    app: s.settings.sectionApp,
    personalization: s.personalization.title,
    notifications: s.notificationPrefs.title,
    backup: s.settings.backupTitle,
  };
  const activeSection =
    section && Object.hasOwn(sectionTitles, section)
      ? (section as SettingsSection)
      : null;
  const openSection = (value: SettingsSection) =>
    router.push({ pathname: '/settings', params: { section: value } });
  const goBack = () =>
    router.canGoBack() ? router.back() : router.replace(activeSection ? '/settings' : '/');

  const paceOptions: {
    value: WalkPaceProfile;
    icon: typeof Turtle;
    label: string;
    desc: string;
  }[] = [
    { value: 'slow', icon: Turtle, label: s.settings.paceSlow, desc: s.settings.paceSlowDesc },
    {
      value: 'normal',
      icon: Footprints,
      label: s.settings.paceNormal,
      desc: s.settings.paceNormalDesc,
    },
    { value: 'fast', icon: Rabbit, label: s.settings.paceFast, desc: s.settings.paceFastDesc },
  ];
  const styleOptions: { value: RouteStyle; label: string; desc: string }[] = [
    { value: 'fastest', label: s.settings.styleFastest, desc: s.settings.styleFastestDesc },
    { value: 'balanced', label: s.settings.styleBalanced, desc: s.settings.styleBalancedDesc },
    {
      value: 'lessWalking',
      label: s.settings.styleLessWalking,
      desc: s.settings.styleLessWalkingDesc,
    },
    {
      value: 'fewerTransfers',
      label: s.settings.styleFewerTransfers,
      desc: s.settings.styleFewerTransfersDesc,
    },
  ];
  const modePills: { value: TransitVehicleMode; icon: typeof TramFront; label: string }[] = [
    { value: 'tram', icon: TramFront, label: s.settings.modeTram },
    { value: 'bus', icon: BusFront, label: s.settings.modeBus },
    { value: 'trolleybus', icon: BusFront, label: s.settings.modeTrolleybus },
    { value: 'subway', icon: TrainFront, label: s.settings.modeSubway },
    { value: 'train', icon: TrainFront, label: s.settings.modeTrain },
    { value: 'cable', icon: CableCar, label: s.settings.modeCable },
  ];
  const enabledModes = TRANSIT_MODES.filter((m) => settings.allowedModes[m]);

  const maxT = SETTINGS_LIMITS.maxTransfers;
  const minT = SETTINGS_LIMITS.minTransferSec;
  const trainBuf = SETTINGS_LIMITS.trainMinTransferSec;
  const walk = SETTINGS_LIMITS.maxWalkM;
  const anchor = SETTINGS_LIMITS.anchorRadiusM;
  const [dataStatus, setDataStatus] = useState<DataStatus>(() => getDataStatus());
  const [importing, setImporting] = useState(false);
  const [switchingCity, setSwitchingCity] = useState(false);
  const [switchingCityId, setSwitchingCityId] = useState<CityId | null>(null);
  const [citySheetOpen, setCitySheetOpen] = useState(false);
  const [justSwitched, setJustSwitched] = useState<CityId | null>(null);
  const [outcome, setOutcome] = useState<ImportOutcome | null>(null);
  const [hasTrains, setHasTrains] = useState(true);
  const [reloadKey, setReloadKey] = useState(0);
  const [cooldownHours, setCooldownHours] = useState(1);

  useEffect(() => {
    refreshDataStatus()
      .then(setDataStatus)
      .catch(() => {});
    return subscribeDataStatus(setDataStatus);
  }, [cityId]);

  useEffect(() => {
    let alive = true;
    hasTrainRoutes()
      .then((v) => {
        if (alive) setHasTrains(v);
      })
      .catch(() => {
        if (alive) setHasTrains(false);
      });
    return () => {
      alive = false;
    };
  }, [dataStatus.state, reloadKey]);

  const busy = importing || dataStatus.state === 'downloading' || dataStatus.state === 'importing';
  const hasTimetable = dataStatus.state === 'ready';

  const handleCityChange = async (id: CityId) => {
    if (id === cityId || switchingCity || busy) return;
    setSwitchingCity(true);
    setSwitchingCityId(id);
    setJustSwitched(null);
    setOutcome(null);
    try {
      await setCity(id);
      await refreshDataStatus()
        .then(setDataStatus)
        .catch(() => {});
      // Potwierdzenie zostaje na ekranie po zakończeniu zmiany. Wcześniej
      // znikało razem ze spinnerem, więc użytkownik nie dostawał żadnego
      // znaku, że przełączenie w ogóle się udało.
      setJustSwitched(id);
    } finally {
      setSwitchingCity(false);
      setSwitchingCityId(null);
      setReloadKey((k) => k + 1);
    }
  };

  const handleDownload = async () => {
    if (busy) return;
    setImporting(true);
    setOutcome(null);
    try {
      const result = await importGtfsFromNetwork();
      if (result === 'cooldown') {
        const gate = await getTimetableDownloadGate();
        setCooldownHours(gate.allowed ? 1 : remainingHours(gate.retryAfterMs));
      }
      setOutcome(result);
    } catch (err) {
      const reason = err instanceof Error ? err.message : s.settings.downloadFailFallback;
      Alert.alert(s.settings.downloadFailTitle, s.settings.downloadFailBody(reason));
    } finally {
      setImporting(false);
      setReloadKey((k) => k + 1);
    }
  };

  const outcomeLabel =
    outcome === 'updated'
      ? s.settings.downloadDone
      : outcome === 'upToDate'
        ? s.settings.downloadUpToDate
        : outcome === 'keptLocal'
          ? s.settings.downloadKeptLocal
          : outcome === 'cooldown'
            ? s.settings.downloadCooldown(cooldownHours)
            : null;

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <Pressable
          onPress={goBack}
          style={styles.back}
          accessibilityRole="button"
          accessibilityLabel={s.map.backA11y}
        >
          <ChevronLeft size={23} color={scheme.onSurface} />
        </Pressable>
        <Text style={styles.headerTitle} accessibilityRole="header">
          {activeSection ? sectionTitles[activeSection] : s.settings.title}
        </Text>
      </View>

      <ScrollView
        key={activeSection ?? 'index'}
        contentContainerStyle={[styles.body, { paddingBottom: insets.bottom + 32 }]}
        showsVerticalScrollIndicator={false}
        overScrollMode="never"
      >
        {!activeSection && (
          <>
            <View style={styles.cityPanel}>
              <Pressable
                onPress={() => setCitySheetOpen(true)}
                disabled={switchingCity || busy}
                style={({ pressed }) => [
                  styles.cityTile,
                  (switchingCity || busy) && { opacity: 0.6 },
                  pressed && !(switchingCity || busy) && { opacity: 0.8 },
                ]}
                accessibilityRole="button"
                accessibilityState={{ disabled: switchingCity || busy }}
                accessibilityLabel={`${s.city.name(cityId)}, ${s.city.changeAction}`}
                accessibilityHint={s.city.settingsHint}
              >
                <View style={styles.cityTileIconWrap}>
                  <MapPin size={22} color={scheme.primary} />
                </View>
                <View style={styles.cityTileInfo}>
                  <View style={styles.cityTileHeaderRow}>
                    <Text style={styles.cityLabel}>{s.city.section}</Text>
                  </View>
                  <Text style={styles.cityTileName}>{s.city.name(cityId)}</Text>
                  <Text style={styles.cityTileFeeds}>{s.city.feeds(cityId)}</Text>
                </View>
                <ChevronRight size={22} color={scheme.primary} />
              </Pressable>
              {switchingCity ? (
                <View style={styles.switchRow}>
                  <ActivityIndicator size="small" color={scheme.primary} />
                  <Text style={styles.switchText}>{s.city.switching}</Text>
                </View>
              ) : justSwitched ? (
                <View style={styles.switchRow}>
                  <Check size={16} color={scheme.primary} />
                  <Text style={styles.switchText}>{s.city.changed(s.city.name(justSwitched))}</Text>
                </View>
              ) : null}
              {busy && !switchingCity && (
                <Text style={styles.warnHint}>{s.city.blockedByDownload}</Text>
              )}
              {!busy && !switchingCity && dataStatus.state === 'empty' ? (
                <Text style={styles.warnHint}>{s.city.needDownload}</Text>
              ) : null}
            </View>

            <View style={styles.menuGroup}>
              <SettingsLink
                icon={Navigation}
                title={s.settings.planningTitle}
                detail={s.settings.planningSummary(
                  styleOptions.find((option) => option.value === settings.routeStyle)?.label ?? '',
                  paceOptions.find((option) => option.value === settings.walkPace)?.label ?? '',
                )}
                onPress={() => openSection('routing')}
              />
              <View style={styles.menuDivider} />
              <SettingsLink
                icon={BellRing}
                title={s.notificationPrefs.title}
                detail={s.settings.notificationsSummary}
                onPress={() => openSection('notifications')}
              />
              <View style={styles.menuDivider} />
              <SettingsLink
                icon={Palette}
                title={s.personalization.title}
                detail={s.personalization.summary(s.personalization[themeSetting])}
                onPress={() => openSection('personalization')}
              />
              <View style={styles.menuDivider} />
              <SettingsLink
                icon={Languages}
                title={s.settings.sectionApp}
                detail={s.settings.languageSummary(
                  s.settings[
                    LANG_OPTIONS.find((option) => option.value === langSetting)?.label ??
                      'langSystem'
                  ],
                )}
                onPress={() => openSection('app')}
              />
            </View>
            <View style={styles.menuGroup}>
              <SettingsLink
                icon={Download}
                title={s.settings.offlineTitle}
                detail={dataStatusLabel(dataStatus)}
                onPress={() => openSection('offline')}
              />
              <View style={styles.menuDivider} />
              <SettingsLink
                icon={DatabaseBackup}
                title={s.settings.backupTitle}
                detail={s.settings.backupSummary}
                onPress={() => openSection('backup')}
              />
              <View style={styles.menuDivider} />
              <SettingsLink
                icon={ShieldCheck}
                title={s.landing.privacy.linkLabel}
                detail={s.landing.privacy.locationTitle}
                onPress={() => router.push('/privacy')}
              />
            </View>
            <Pressable
              onPress={() => void Linking.openURL('https://ko-fi.com/sioodmy').catch(() => {})}
              accessibilityRole="link"
              accessibilityLabel={s.settings.supportA11y}
              style={({ pressed }) => [styles.supportLink, pressed && styles.menuRowPressed]}
            >
              <Coffee size={20} color={scheme.onSurfaceVariant} />
              <View style={styles.settingText}>
                <Text style={styles.settingTitle}>{s.settings.supportTitle}</Text>
                <Text style={styles.settingHint}>{s.settings.supportHint}</Text>
              </View>
              <ExternalLink size={18} color={scheme.onSurfaceVariant} />
            </Pressable>
          </>
        )}

        {activeSection === 'offline' && (
          <>
            <SectionLabel>{s.settings.sectionOffline}</SectionLabel>
            <View style={styles.card}>
              <Text style={styles.cardTitle}>{s.settings.dataTitle(operatorShort)}</Text>
              <Text style={styles.settingHint}>{s.settings.dataHint(feeds)}</Text>
              <Text style={styles.statusText}>{dataStatusLabel(dataStatus)}</Text>
              <Pressable
                onPress={handleDownload}
                disabled={busy}
                style={({ pressed }) => [
                  hasTimetable ? styles.checkBtn : styles.downloadBtn,
                  busy && styles.stepBtnDisabled,
                  pressed && !busy && { opacity: 0.7 },
                ]}
                accessibilityLabel={
                  hasTimetable ? s.settings.downloadCheckA11y : s.settings.downloadA11y
                }
                accessibilityState={{ busy, disabled: busy }}
              >
                {busy ? (
                  <ActivityIndicator
                    size="small"
                    color={hasTimetable ? scheme.onSurfaceVariant : scheme.onSecondaryContainer}
                  />
                ) : (
                  <Download
                    size={18}
                    color={hasTimetable ? scheme.onSurfaceVariant : scheme.onSecondaryContainer}
                  />
                )}
                <Text style={hasTimetable ? styles.checkText : styles.downloadText}>
                  {busy
                    ? dataStatusLabel(dataStatus)
                    : hasTimetable
                      ? s.settings.downloadReady
                      : s.settings.downloadEmpty}
                </Text>
              </Pressable>
              {outcomeLabel ? (
                <Text
                  style={[
                    styles.outcomeText,
                    (outcome === 'keptLocal' || outcome === 'cooldown') && {
                      color: scheme.warning,
                    },
                  ]}
                >
                  {outcomeLabel}
                </Text>
              ) : null}
            </View>
            <OfflineMapCard />
            <DiagnosticsCard />
          </>
        )}

        {activeSection === 'personalization' && <PersonalizationCard />}

        {activeSection === 'app' && (
          <>
            <View style={styles.card}>
              <Text style={styles.cardTitle}>{s.settings.langTitle}</Text>
              <View style={styles.languageList}>
                {LANG_OPTIONS.map((opt) => {
                  const active = langSetting === opt.value;
                  const label = s.settings[opt.label];
                  return (
                    <Pressable
                      key={opt.value}
                      onPress={() => setLang(opt.value)}
                      style={({ pressed }) => [
                        styles.languageOption,
                        active && styles.langChipActive,
                        pressed && !active && { opacity: 0.7 },
                      ]}
                      accessibilityRole="radio"
                      accessibilityState={{ checked: active }}
                      accessibilityLabel={label}
                    >
                      <Text style={[styles.languageText, active && styles.langChipTextActive]}>
                        {label}
                      </Text>
                      {active && <Check size={20} color={scheme.onPrimaryContainer} />}
                    </Pressable>
                  );
                })}
              </View>
            </View>
          </>
        )}

        {activeSection === 'routing' && (
          <>
            <SectionLabel>{s.settings.sectionRoute}</SectionLabel>
            <View style={styles.card}>
              <Text style={styles.cardTitle}>{s.settings.routeStyleTitle}</Text>
              <View style={styles.styleGrid}>
                {styleOptions.map((opt) => {
                  const active = settings.routeStyle === opt.value;
                  return (
                    <Pressable
                      key={opt.value}
                      onPress={() => update({ routeStyle: opt.value })}
                      style={({ pressed }) => [
                        styles.styleOpt,
                        active && styles.optActive,
                        pressed && !active && { opacity: 0.7 },
                      ]}
                      accessibilityRole="radio"
                      accessibilityState={{ checked: active }}
                      accessibilityLabel={`${opt.label}, ${opt.desc}`}
                    >
                      <View style={styles.optionText}>
                        <Text style={[styles.styleLabel, active && styles.optLabelActive]}>
                          {opt.label}
                        </Text>
                        <Text style={[styles.styleDesc, active && styles.optDescActive]}>
                          {opt.desc}
                        </Text>
                      </View>
                      {active && <Check size={20} color={scheme.onPrimaryContainer} />}
                    </Pressable>
                  );
                })}
              </View>

              <View style={styles.divider} />

              <SettingRow title={s.settings.transfersTitle} hint={s.settings.transfersHintShort}>
                <Stepper
                  label={s.settings.transfersTitle}
                  value={
                    settings.maxTransfers === 0
                      ? s.settings.directValue
                      : transfersLabel(settings.maxTransfers)
                  }
                  onMinus={() => update({ maxTransfers: settings.maxTransfers - maxT.step })}
                  onPlus={() => update({ maxTransfers: settings.maxTransfers + maxT.step })}
                  minusDisabled={settings.maxTransfers <= maxT.min}
                  plusDisabled={settings.maxTransfers >= maxT.max}
                />
              </SettingRow>

              <SettingRow title={s.settings.walkTitle} hint={s.settings.walkHintShort}>
                <Stepper
                  label={s.settings.walkTitle}
                  value={formatWalkDistance(settings.maxWalkM, walkMps)}
                  onMinus={() => update({ maxWalkM: settings.maxWalkM - walk.step })}
                  onPlus={() => update({ maxWalkM: settings.maxWalkM + walk.step })}
                  minusDisabled={settings.maxWalkM <= walk.min}
                  plusDisabled={settings.maxWalkM >= walk.max}
                />
              </SettingRow>

              <View style={styles.divider} />

              <Text style={styles.subTitle}>{s.settings.speedTitle}</Text>
              <View style={[styles.paceRow, compact && styles.paceRowCompact]}>
                {paceOptions.map((opt) => {
                  const active = settings.walkPace === opt.value;
                  const Icon = opt.icon;
                  const a11y = `${opt.label}, ${opt.desc}, ${formatWalkSpeed(WALK_PACE_DEFAULTS_MPS[opt.value])}`;
                  return (
                    <Pressable
                      key={opt.value}
                      onPress={() => update({ walkPace: opt.value })}
                      style={({ pressed }) => [
                        styles.paceOpt,
                        active && styles.optActive,
                        pressed && !active && { opacity: 0.7 },
                      ]}
                      accessibilityRole="radio"
                      accessibilityState={{ checked: active }}
                      accessibilityLabel={a11y}
                    >
                      <Icon
                        size={20}
                        color={active ? scheme.onPrimaryContainer : scheme.onSurfaceVariant}
                      />
                      <Text style={[styles.paceLabel, active && styles.optLabelActive]}>
                        {opt.label}
                      </Text>
                      <Text style={[styles.paceKmh, active && styles.optDescActive]}>
                        {formatWalkSpeed(WALK_PACE_DEFAULTS_MPS[opt.value])}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>

            <SectionLabel>{s.settings.sectionTransport}</SectionLabel>
            <View style={styles.card}>
              <Text style={styles.cardTitle}>{s.settings.allowTransferTitle}</Text>
              <Text style={styles.settingHint}>{s.settings.allowTransferHint}</Text>
              <View style={styles.langRow}>
                {modePills.map((pill) => {
                  const active = settings.allowedModes[pill.value];
                  const lastEnabled = active && enabledModes.length === 1;
                  const Icon = pill.icon;
                  return (
                    <Pressable
                      key={pill.value}
                      onPress={() =>
                        update({
                          allowedModes: { ...settings.allowedModes, [pill.value]: !active },
                        })
                      }
                      disabled={lastEnabled}
                      style={({ pressed }) => [
                        styles.transportOption,
                        compact && styles.transportOptionCompact,
                        active && styles.langChipActive,
                        lastEnabled && styles.langChipDisabled,
                        pressed && !active && { opacity: 0.7 },
                      ]}
                      accessibilityRole="checkbox"
                      accessibilityState={{ checked: active, disabled: lastEnabled }}
                      accessibilityLabel={pill.label}
                      accessibilityHint={s.settings.allowTransferHint}
                    >
                      <Icon
                        size={16}
                        color={active ? scheme.onPrimaryContainer : scheme.onSurfaceVariant}
                      />
                      <Text style={[styles.transportText, active && styles.langChipTextActive]}>
                        {pill.label}
                      </Text>
                      {active && <Check size={14} color={scheme.onPrimaryContainer} />}
                    </Pressable>
                  );
                })}
              </View>
              {!hasTrains ? <Text style={styles.warnHint}>{s.settings.trainNoData}</Text> : null}
              {settings.allowedModes.train && hasTrains ? (
                <>
                  <View style={styles.divider} />
                  <SettingRow title={s.settings.trainBufferTitle}>
                    <Stepper
                      label={s.settings.trainBufferTitle}
                      value={formatTransferTime(settings.trainMinTransferSec)}
                      onMinus={() =>
                        update({
                          trainMinTransferSec: settings.trainMinTransferSec - trainBuf.step,
                        })
                      }
                      onPlus={() =>
                        update({
                          trainMinTransferSec: settings.trainMinTransferSec + trainBuf.step,
                        })
                      }
                      minusDisabled={settings.trainMinTransferSec <= trainBuf.min}
                      plusDisabled={settings.trainMinTransferSec >= trainBuf.max}
                    />
                  </SettingRow>
                </>
              ) : null}
            </View>

            <Pressable
              onPress={() => setAdvancedOpen((v) => !v)}
              style={({ pressed }) => [styles.advancedToggle, pressed && { opacity: 0.75 }]}
              accessibilityRole="button"
              accessibilityState={{ expanded: advancedOpen }}
              accessibilityLabel={advancedOpen ? s.settings.advancedHide : s.settings.advancedShow}
            >
              <Text style={styles.advancedToggleText}>
                {advancedOpen ? s.settings.advancedHide : s.settings.advancedShow}
              </Text>
              {advancedOpen ? (
                <ChevronUp size={18} color={scheme.onSurfaceVariant} />
              ) : (
                <ChevronDown size={18} color={scheme.onSurfaceVariant} />
              )}
            </Pressable>

            {advancedOpen ? (
              <View style={styles.card}>
                <SettingRow
                  title={s.settings.transferTimeTitle}
                  hint={s.settings.transferTimeHintShort}
                >
                  <Stepper
                    label={s.settings.transferTimeTitle}
                    value={formatTransferTime(settings.minTransferSec)}
                    onMinus={() => update({ minTransferSec: settings.minTransferSec - minT.step })}
                    onPlus={() => update({ minTransferSec: settings.minTransferSec + minT.step })}
                    minusDisabled={settings.minTransferSec <= minT.min}
                    plusDisabled={settings.minTransferSec >= minT.max}
                  />
                </SettingRow>
                <View style={styles.divider} />
                <SettingRow title={s.settings.anchorTitle} hint={s.settings.anchorHintShort}>
                  <Stepper
                    label={s.settings.anchorTitle}
                    value={`${settings.anchorRadiusM} m`}
                    onMinus={() => update({ anchorRadiusM: settings.anchorRadiusM - anchor.step })}
                    onPlus={() => update({ anchorRadiusM: settings.anchorRadiusM + anchor.step })}
                    minusDisabled={settings.anchorRadiusM <= anchor.min}
                    plusDisabled={settings.anchorRadiusM >= anchor.max}
                  />
                </SettingRow>
              </View>
            ) : null}

            <Text style={styles.foot}>{s.settings.foot}</Text>
            <Pressable
              onPress={() =>
                Alert.alert(s.settings.resetRoutes, s.settings.resetRoutesBody, [
                  { text: s.common.cancel, style: 'cancel' },
                  { text: s.settings.resetA11y, onPress: () => reset() },
                ])
              }
              accessibilityRole="button"
              style={({ pressed }) => [styles.resetButton, pressed && styles.menuRowPressed]}
            >
              <RotateCcw size={18} color={scheme.onSurfaceVariant} />
              <Text style={styles.resetText}>{s.settings.resetRoutes}</Text>
            </Pressable>
          </>
        )}

        {activeSection === 'notifications' && <NotificationPrefsCard />}
        {activeSection === 'backup' && <BackupCard />}
      </ScrollView>

      {citySheetOpen && (
        <CitySelectSheet
          selectedCityId={cityId}
          onSelectCity={(id) => {
            void handleCityChange(id);
          }}
          onClose={() => setCitySheetOpen(false)}
          switchingCity={switchingCity}
          switchingCityId={switchingCityId}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: scheme.surface },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  back: {
    width: 48,
    height: 48,
    borderRadius: shape.medium,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: { flex: 1, ...type.titleLarge, fontWeight: '500', color: scheme.onSurface },
  body: { paddingHorizontal: 16, paddingTop: 12, gap: 18 },
  sectionLabel: {
    ...type.labelLarge,
    color: scheme.onSurfaceVariant,
    fontWeight: '600',
    marginTop: 10,
    marginBottom: 2,
    paddingHorizontal: 2,
  },
  card: {
    backgroundColor: scheme.surfaceContainerLow,
    borderRadius: shape.extraLarge,
    padding: 20,
    gap: 18,
  },
  cardTitle: { ...type.titleMedium, color: scheme.onSurface, fontWeight: '500' },
  subTitle: { ...type.labelLarge, color: scheme.onSurface, fontWeight: '600' },
  statusText: { ...type.bodyMedium, color: scheme.onSurface },
  settingRow: { gap: 10 },
  settingText: { flex: 1, minWidth: 0, gap: 2 },
  settingTitle: { ...type.bodyLarge, color: scheme.onSurface, fontWeight: '500' },
  settingHint: { ...type.bodyMedium, color: scheme.onSurfaceVariant, lineHeight: 21 },
  warnHint: { ...type.bodySmall, color: scheme.warning, lineHeight: 17 },
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  switchText: { ...type.bodySmall, color: scheme.onSurfaceVariant },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: scheme.outlineVariant },
  stepper: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: scheme.surfaceContainer,
    borderRadius: shape.large,
    padding: 4,
    gap: 4,
  },
  stepBtn: {
    width: 48,
    height: 48,
    borderRadius: shape.medium,
    backgroundColor: scheme.secondaryContainer,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepBtnDisabled: { backgroundColor: scheme.surfaceContainerHigh, opacity: 0.6 },
  stepValue: {
    flex: 1,
    ...type.labelLarge,
    color: scheme.onSurface,
    textAlign: 'center',
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
    paddingHorizontal: 4,
  },
  downloadBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: scheme.secondaryContainer,
    borderRadius: shape.medium,
    minHeight: 52,
    paddingVertical: 12,
  },
  downloadText: {
    ...type.titleSmall,
    color: scheme.onSecondaryContainer,
    flexShrink: 1,
    textAlign: 'center',
  },
  checkBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: scheme.surfaceContainerHighest,
    borderRadius: shape.medium,
    minHeight: 52,
    paddingVertical: 12,
  },
  checkText: { ...type.labelLarge, color: scheme.onSurfaceVariant, fontWeight: '600' },
  outcomeText: { ...type.bodySmall, color: scheme.onSurfaceVariant, lineHeight: 18 },
  langRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  langChipActive: { backgroundColor: scheme.primaryContainer },
  // Niedostępny chip musi wyglądać niedostępny: bez tego przycisk gasł się
  // bez żadnej informacji, a niżej w karcie jechał pasek postępu pobierania.
  langChipDisabled: { opacity: 0.45 },
  langChipTextActive: { color: scheme.onPrimaryContainer, fontWeight: '700' },
  cityTile: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: scheme.surfaceContainerLow,
    borderRadius: shape.extraLarge,
    paddingHorizontal: 20,
    paddingVertical: 24,
    minHeight: 64,
  },
  cityTileIconWrap: {
    width: 44,
    height: 44,
    borderRadius: shape.medium,
    backgroundColor: scheme.primaryContainer,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cityTileInfo: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  cityTileHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  cityTileName: {
    ...type.headlineSmall,
    color: scheme.onSurface,
    fontWeight: '500',
  },
  cityTileFeeds: {
    ...type.bodySmall,
    color: scheme.onSurfaceVariant,
    lineHeight: 16,
  },
  styleGrid: { gap: 10 },
  styleOpt: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderRadius: shape.medium,
    backgroundColor: scheme.surfaceContainer,
    paddingHorizontal: 16,
    paddingVertical: 16,
    minHeight: 64,
  },
  styleLabel: { ...type.bodyLarge, color: scheme.onSurface, fontWeight: '500' },
  styleDesc: { ...type.bodyMedium, color: scheme.onSurfaceVariant, lineHeight: 20 },
  paceRow: { flexDirection: 'row', gap: 8 },
  paceOpt: {
    flex: 1,
    alignItems: 'center',
    gap: 4,
    borderRadius: shape.medium,
    backgroundColor: scheme.surfaceContainerHighest,
    paddingHorizontal: 6,
    paddingVertical: 12,
    minHeight: 88,
  },
  paceLabel: {
    ...type.labelLarge,
    color: scheme.onSurfaceVariant,
    fontWeight: '700',
    textAlign: 'center',
  },
  paceKmh: { ...type.labelMedium, color: scheme.onSurfaceVariant, fontWeight: '600' },
  optActive: { backgroundColor: scheme.primaryContainer },
  optLabelActive: { color: scheme.onPrimaryContainer },
  optDescActive: { color: scheme.onPrimaryContainer },
  advancedToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    minHeight: 44,
    paddingVertical: 8,
  },
  advancedToggleText: {
    ...type.labelLarge,
    color: scheme.onSurfaceVariant,
    fontWeight: '600',
    flexShrink: 1,
  },
  cityPanel: { gap: 12 },
  cityLabel: { ...type.bodySmall, color: scheme.primary },
  menuGroup: {
    backgroundColor: scheme.surfaceContainerLow,
    borderRadius: shape.extraLarge,
    padding: 6,
  },
  menuRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 14,
    minHeight: 84,
    borderRadius: shape.large,
  },
  menuRowPressed: { backgroundColor: scheme.surfaceContainerHigh },
  menuIcon: { width: 32, alignItems: 'center', justifyContent: 'center' },
  menuTitle: { ...type.bodyLarge, color: scheme.onSurface, fontWeight: '500' },
  menuDetail: { ...type.bodySmall, color: scheme.onSurfaceVariant, lineHeight: 19 },
  menuDivider: {
    height: StyleSheet.hairlineWidth,
    marginLeft: 58,
    marginRight: 14,
    backgroundColor: scheme.outlineVariant,
  },
  supportLink: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    padding: 16,
    borderRadius: shape.large,
    minHeight: 72,
  },
  languageList: { gap: 8 },
  languageOption: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    minHeight: 56,
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderRadius: shape.medium,
    backgroundColor: scheme.surfaceContainer,
  },
  languageText: { flex: 1, ...type.bodyLarge, color: scheme.onSurface },
  optionText: { flex: 1, gap: 4 },
  paceRowCompact: { flexDirection: 'column' },
  transportOption: {
    flexBasis: '45%',
    flexGrow: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    padding: 14,
    minHeight: 56,
    borderRadius: shape.medium,
    backgroundColor: scheme.surfaceContainer,
  },
  transportText: { flex: 1, ...type.bodyMedium, color: scheme.onSurfaceVariant },
  transportOptionCompact: { flexBasis: '100%' },
  foot: { ...type.bodySmall, color: scheme.onSurfaceVariant, paddingHorizontal: 8, lineHeight: 19 },
  resetButton: {
    minHeight: 52,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    padding: 16,
    borderRadius: shape.large,
  },
  resetText: { ...type.labelLarge, color: scheme.onSurfaceVariant, flexShrink: 1 },
});
