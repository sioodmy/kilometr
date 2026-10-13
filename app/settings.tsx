import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  CableCar,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronUp,
  Coffee,
  Download,
  ExternalLink,
  Footprints,
  Minus,
  Plus,
  Rabbit,
  RotateCcw,
  TrainFront,
  Turtle,
} from 'lucide-react-native';
import type { RouteStyle } from '../src/services/routing/types';
import { elev, scheme, shape, type } from '../src/theme/tokens';
import { tr, useLocaleSetting, useStrings, type LocaleSetting } from '../src/i18n';
import {
  SETTINGS_LIMITS,
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
import { NotificationPrefsCard, PrefsToggle } from '../src/components/NotificationPrefsCard';
import { BackupCard } from '../src/components/BackupCard';
import { OfflineMapCard } from '../src/components/OfflineMapCard';
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
  value,
  onMinus,
  onPlus,
  minusDisabled,
  plusDisabled,
}: {
  value: string;
  onMinus: () => void;
  onPlus: () => void;
  minusDisabled?: boolean;
  plusDisabled?: boolean;
}) {
  return (
    <View style={styles.stepper}>
      <Pressable
        onPress={onMinus}
        disabled={minusDisabled}
        style={({ pressed }) => [
          styles.stepBtn,
          minusDisabled && styles.stepBtnDisabled,
          pressed && !minusDisabled && { opacity: 0.7 },
        ]}
        hitSlop={8}
      >
        <Minus size={18} color={minusDisabled ? scheme.outline : scheme.onSecondaryContainer} />
      </Pressable>
      <Text style={styles.stepValue} numberOfLines={1}>
        {value}
      </Text>
      <Pressable
        onPress={onPlus}
        disabled={plusDisabled}
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

const LANG_OPTIONS: { value: LocaleSetting; label: string }[] = [
  { value: 'system', label: '' },
  { value: 'pl', label: 'Polski' },
  { value: 'en', label: 'English' },
  { value: 'de', label: 'Deutsch' },
  { value: 'uk', label: 'Українська' },
];

export default function SettingsScreen() {
  const router = useRouter();
  const { settings, update, reset } = useRoutingSettings();
  const s = useStrings();
  const { setting: langSetting, setSetting: setLang } = useLocaleSetting();
  const walkMps = useWalkSpeedMps();
  const [advancedOpen, setAdvancedOpen] = useState(false);

  const paceOptions: { value: WalkPaceProfile; icon: typeof Turtle; label: string; desc: string }[] = [
    { value: 'slow', icon: Turtle, label: s.settings.paceSlow, desc: s.settings.paceSlowDesc },
    { value: 'normal', icon: Footprints, label: s.settings.paceNormal, desc: s.settings.paceNormalDesc },
    { value: 'fast', icon: Rabbit, label: s.settings.paceFast, desc: s.settings.paceFastDesc },
  ];
  const styleOptions: { value: RouteStyle; label: string; desc: string }[] = [
    { value: 'fastest', label: s.settings.styleFastest, desc: s.settings.styleFastestDesc },
    { value: 'balanced', label: s.settings.styleBalanced, desc: s.settings.styleBalancedDesc },
    { value: 'lessWalking', label: s.settings.styleLessWalking, desc: s.settings.styleLessWalkingDesc },
    { value: 'fewerTransfers', label: s.settings.styleFewerTransfers, desc: s.settings.styleFewerTransfersDesc },
  ];

  const maxT = SETTINGS_LIMITS.maxTransfers;
  const minT = SETTINGS_LIMITS.minTransferSec;
  const trainBuf = SETTINGS_LIMITS.trainMinTransferSec;
  const walk = SETTINGS_LIMITS.maxWalkM;
  const anchor = SETTINGS_LIMITS.anchorRadiusM;
  const [dataStatus, setDataStatus] = useState<DataStatus>(() => getDataStatus());
  const [importing, setImporting] = useState(false);
  const [outcome, setOutcome] = useState<ImportOutcome | null>(null);
  const [hasTrains, setHasTrains] = useState(true);
  const [reloadKey, setReloadKey] = useState(0);
  const [cooldownHours, setCooldownHours] = useState(1);

  useEffect(() => {
    refreshDataStatus().then(setDataStatus).catch(() => {});
    return subscribeDataStatus(setDataStatus);
  }, []);

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
        <Pressable onPress={() => router.back()} style={styles.back} hitSlop={10}>
          <ChevronLeft size={23} color={scheme.onSurface} />
        </Pressable>
        <Text style={styles.headerTitle}>{s.settings.title}</Text>
        <Pressable
          onPress={() => reset()}
          style={styles.iconBtn}
          hitSlop={10}
          accessibilityLabel={s.settings.resetA11y}
        >
          <RotateCcw size={18} color={scheme.onSurfaceVariant} />
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false} overScrollMode="never">
        <SectionLabel>{s.settings.sectionSupport}</SectionLabel>
        <View style={styles.card}>
          <View style={styles.supportHead}>
            <View style={styles.supportIcon}>
              <Coffee size={20} color={scheme.onSecondaryContainer} />
            </View>
            <View style={styles.settingText}>
              <Text style={styles.cardTitle}>{s.settings.supportTitle}</Text>
              <Text style={styles.settingHint}>{s.settings.supportHint}</Text>
            </View>
          </View>
          <Pressable
            onPress={() => {
              void Linking.openURL('https://ko-fi.com/sioodmy').catch(() => {});
            }}
            style={({ pressed }) => [styles.downloadBtn, pressed && { opacity: 0.7 }]}
            accessibilityRole="link"
            accessibilityLabel={s.settings.supportA11y}
          >
            <ExternalLink size={18} color={scheme.onSecondaryContainer} />
            <Text style={styles.downloadText}>{s.settings.supportButton}</Text>
          </Pressable>
        </View>

        <SectionLabel>{s.settings.sectionOffline}</SectionLabel>
        <View style={styles.card}>
          <Text style={styles.cardTitle}>{s.settings.dataTitle}</Text>
          <Text style={styles.statusText}>{dataStatusLabel(dataStatus)}</Text>
          <Pressable
            onPress={handleDownload}
            disabled={busy}
            style={({ pressed }) => [
              hasTimetable ? styles.checkBtn : styles.downloadBtn,
              busy && styles.stepBtnDisabled,
              pressed && !busy && { opacity: 0.7 },
            ]}
            accessibilityLabel={hasTimetable ? s.settings.downloadCheckA11y : s.settings.downloadA11y}
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
                (outcome === 'keptLocal' || outcome === 'cooldown') && { color: scheme.warning },
              ]}
            >
              {outcomeLabel}
            </Text>
          ) : null}
        </View>
        <OfflineMapCard />

        <SectionLabel>{s.settings.sectionApp}</SectionLabel>
        <View style={styles.card}>
          <Text style={styles.cardTitle}>{s.settings.langTitle}</Text>
          <View style={styles.langRow}>
            {LANG_OPTIONS.map((opt) => {
              const active = langSetting === opt.value;
              const label = opt.value === 'system' ? s.settings.langSystem : opt.label;
              return (
                <Pressable
                  key={opt.value}
                  onPress={() => setLang(opt.value)}
                  style={({ pressed }) => [
                    styles.langChip,
                    active && styles.langChipActive,
                    pressed && !active && { opacity: 0.7 },
                  ]}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: active }}
                  accessibilityLabel={label}
                >
                  {active && <Check size={14} color={scheme.onPrimaryContainer} />}
                  <Text style={[styles.langChipText, active && styles.langChipTextActive]}>{label}</Text>
                </Pressable>
              );
            })}
          </View>
        </View>

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
                  <Text style={[styles.styleLabel, active && styles.optLabelActive]}>{opt.label}</Text>
                  <Text style={[styles.styleDesc, active && styles.optDescActive]} numberOfLines={2}>
                    {opt.desc}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          <View style={styles.divider} />

          <SettingRow title={s.settings.transfersTitle} hint={s.settings.transfersHintShort}>
            <Stepper
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
              value={formatWalkDistance(settings.maxWalkM, walkMps)}
              onMinus={() => update({ maxWalkM: settings.maxWalkM - walk.step })}
              onPlus={() => update({ maxWalkM: settings.maxWalkM + walk.step })}
              minusDisabled={settings.maxWalkM <= walk.min}
              plusDisabled={settings.maxWalkM >= walk.max}
            />
          </SettingRow>

          <View style={styles.divider} />

          <Text style={styles.subTitle}>{s.settings.speedTitle}</Text>
          <View style={styles.paceRow}>
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
                  <Icon size={20} color={active ? scheme.onPrimaryContainer : scheme.onSurfaceVariant} />
                  <Text style={[styles.paceLabel, active && styles.optLabelActive]}>{opt.label}</Text>
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
          <View style={styles.toggleBlock}>
            <View style={styles.toggleHead}>
              <TrainFront size={18} color={scheme.onSurfaceVariant} />
              <Text style={[styles.settingTitle, styles.settingText]}>{s.settings.trainTitle}</Text>
              <PrefsToggle
                value={settings.trainsEnabled}
                onChange={(v) => update({ trainsEnabled: v })}
                disabled={!hasTrains}
                label={s.settings.trainTitle}
                hint={s.settings.trainHintShort}
                onText={s.notificationPrefs.on}
                offText={s.notificationPrefs.off}
              />
            </View>
            {!hasTrains ? <Text style={styles.warnHint}>{s.settings.trainNoData}</Text> : null}
            {settings.trainsEnabled && hasTrains ? (
              <SettingRow title={s.settings.trainBufferTitle}>
                <Stepper
                  value={formatTransferTime(settings.trainMinTransferSec)}
                  onMinus={() =>
                    update({ trainMinTransferSec: settings.trainMinTransferSec - trainBuf.step })
                  }
                  onPlus={() =>
                    update({ trainMinTransferSec: settings.trainMinTransferSec + trainBuf.step })
                  }
                  minusDisabled={settings.trainMinTransferSec <= trainBuf.min}
                  plusDisabled={settings.trainMinTransferSec >= trainBuf.max}
                />
              </SettingRow>
            ) : null}
          </View>

          <View style={styles.divider} />

          <View style={styles.toggleHead}>
            <CableCar size={18} color={scheme.onSurfaceVariant} />
            <Text style={[styles.settingTitle, styles.settingText]}>{s.settings.cableTitle}</Text>
            <PrefsToggle
              value={settings.cableEnabled}
              onChange={(v) => update({ cableEnabled: v })}
              label={s.settings.cableTitle}
              hint={s.settings.cableHintShort}
              onText={s.notificationPrefs.on}
              offText={s.notificationPrefs.off}
            />
          </View>
        </View>

        <Pressable
          onPress={() => setAdvancedOpen((v) => !v)}
          style={({ pressed }) => [styles.advancedToggle, pressed && { opacity: 0.75 }]}
          accessibilityRole="button"
          accessibilityState={{ expanded: advancedOpen }}
          accessibilityLabel={
            advancedOpen ? s.settings.advancedHide : s.settings.advancedShow
          }
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
            <SettingRow title={s.settings.transferTimeTitle} hint={s.settings.transferTimeHintShort}>
              <Stepper
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
                value={`${settings.anchorRadiusM} m`}
                onMinus={() => update({ anchorRadiusM: settings.anchorRadiusM - anchor.step })}
                onPlus={() => update({ anchorRadiusM: settings.anchorRadiusM + anchor.step })}
                minusDisabled={settings.anchorRadiusM <= anchor.min}
                plusDisabled={settings.anchorRadiusM >= anchor.max}
              />
            </SettingRow>
          </View>
        ) : null}

        <NotificationPrefsCard />
        <BackupCard />

        <View style={{ height: 40 }} />
      </ScrollView>
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
    width: 40,
    height: 40,
    borderRadius: shape.full,
    backgroundColor: scheme.surfaceContainerHigh,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconBtn: {
    width: 40,
    height: 40,
    borderRadius: shape.full,
    backgroundColor: scheme.surfaceContainerHigh,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: { flex: 1, ...type.titleMedium, fontWeight: '600', color: scheme.onSurface },
  body: { paddingHorizontal: 14, paddingTop: 4, gap: 10, paddingBottom: 8 },
  sectionLabel: {
    ...type.labelLarge,
    color: scheme.onSurfaceVariant,
    fontWeight: '600',
    marginTop: 10,
    marginBottom: 2,
    paddingHorizontal: 2,
  },
  card: {
    backgroundColor: scheme.surfaceContainer,
    borderRadius: shape.large,
    padding: 16,
    gap: 12,
    ...elev.level1,
  },
  cardTitle: { ...type.titleSmall, color: scheme.onSurface, fontWeight: '700' },
  subTitle: { ...type.labelLarge, color: scheme.onSurface, fontWeight: '600' },
  statusText: { ...type.bodyMedium, color: scheme.onSurface },
  supportHead: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  supportIcon: {
    width: 40,
    height: 40,
    borderRadius: shape.medium,
    backgroundColor: scheme.secondaryContainer,
    alignItems: 'center',
    justifyContent: 'center',
  },
  settingRow: { gap: 10 },
  settingText: { flex: 1, minWidth: 0, gap: 2 },
  settingTitle: { ...type.bodyLarge, color: scheme.onSurface, fontWeight: '500' },
  settingHint: { ...type.bodySmall, color: scheme.onSurfaceVariant, lineHeight: 17 },
  warnHint: { ...type.bodySmall, color: scheme.warning, lineHeight: 17 },
  toggleBlock: { gap: 12 },
  toggleHead: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: scheme.outlineVariant },
  stepper: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: scheme.surfaceContainerHighest,
    borderRadius: shape.medium,
    padding: 4,
    gap: 4,
  },
  stepBtn: {
    width: 44,
    height: 44,
    borderRadius: shape.full,
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
    minHeight: 44,
    paddingVertical: 12,
  },
  downloadText: { ...type.titleSmall, color: scheme.onSecondaryContainer },
  checkBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: scheme.surfaceContainerHighest,
    borderRadius: shape.medium,
    minHeight: 44,
    paddingVertical: 12,
  },
  checkText: { ...type.labelLarge, color: scheme.onSurfaceVariant, fontWeight: '600' },
  outcomeText: { ...type.bodySmall, color: scheme.onSurfaceVariant, lineHeight: 18 },
  langRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  langChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderRadius: shape.medium,
    backgroundColor: scheme.surfaceContainerHighest,
    paddingHorizontal: 14,
    paddingVertical: 10,
    minHeight: 44,
  },
  langChipActive: { backgroundColor: scheme.primaryContainer },
  langChipText: { ...type.labelMedium, color: scheme.onSurfaceVariant, fontWeight: '600' },
  langChipTextActive: { color: scheme.onPrimaryContainer, fontWeight: '700' },
  styleGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  styleOpt: {
    flexBasis: '45%',
    flexGrow: 1,
    gap: 2,
    borderRadius: shape.medium,
    backgroundColor: scheme.surfaceContainerHighest,
    paddingHorizontal: 12,
    paddingVertical: 12,
    minHeight: 64,
  },
  styleLabel: { ...type.labelLarge, color: scheme.onSurfaceVariant, fontWeight: '700' },
  styleDesc: { ...type.bodySmall, color: scheme.onSurfaceVariant, lineHeight: 16 },
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
  paceLabel: { ...type.labelLarge, color: scheme.onSurfaceVariant, fontWeight: '700', textAlign: 'center' },
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
  },
});
