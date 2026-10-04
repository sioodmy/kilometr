import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  ArrowLeftRight,
  Check,
  ChevronLeft,
  Clock3,
  Database,
  Download,
  Footprints,
  Globe,
  LocateFixed,
  MapPin,
  Minus,
  Plus,
  RotateCcw,
  Activity,
  Anchor,
} from 'lucide-react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { elev, scheme, shape, type } from '../src/theme/tokens';
import { tr, useLocaleSetting, useStrings, type LocaleSetting } from '../src/i18n';
import { CITIES } from '../src/cities/registry';
import { detectCityFromGps } from '../src/cities/active';
import { switchCity } from '../src/cities/switch';
import { useActiveCity } from '../src/cities/useActiveCity';
import type { CityId } from '../src/cities/types';
import {
  SETTINGS_LIMITS,
  formatTransferTime,
  formatWalkDistance,
  formatWalkSpeed,
  walkSpeedLabel,
  useRoutingSettings,
} from '../src/services/settings';
import {
  getDataStatus,
  importGtfsFromNetwork,
  refreshDataStatus,
  subscribeDataStatus,
  type DataStatus,
} from '../src/services/dataManager';
import { transfersLabel } from '../src/components/ConnectionCard';
import { NotificationPrefsCard } from '../src/components/NotificationPrefsCard';

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

function Stepper({
  value,
  display,
  onMinus,
  onPlus,
  minusDisabled,
  plusDisabled,
}: {
  value: string;
  display?: string;
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
          pressed && !minusDisabled && { opacity: 0.7, transform: [{ scale: 0.94 }] },
        ]}
        hitSlop={8}
      >
        <Minus size={18} color={minusDisabled ? scheme.outline : scheme.onSecondaryContainer} />
      </Pressable>
      <View style={styles.stepValue}>
        <Text style={styles.stepValueText}>{value}</Text>
        {display ? <Text style={styles.stepValueSub}>{display}</Text> : null}
      </View>
      <Pressable
        onPress={onPlus}
        disabled={plusDisabled}
        style={({ pressed }) => [
          styles.stepBtn,
          plusDisabled && styles.stepBtnDisabled,
          pressed && !plusDisabled && { opacity: 0.7, transform: [{ scale: 0.94 }] },
        ]}
        hitSlop={8}
      >
        <Plus size={18} color={plusDisabled ? scheme.outline : scheme.onSecondaryContainer} />
      </Pressable>
    </View>
  );
}

const LANG_OPTIONS: { value: LocaleSetting; label: string }[] = [
  { value: 'system', label: '' }, // label systemowy z słownika (langSystem)
  { value: 'pl', label: 'Polski' },
  { value: 'en', label: 'English' },
  { value: 'de', label: 'Deutsch' },
  { value: 'uk', label: 'Українська' },
];

/**
 * Karta wyboru miasta.
 *
 * Miasto zmienia CAŁY zestaw danych (rozkład, przystanki, granice
 * wyszukiwania), więc przełączenie czyści stan i trzeba o nim uprzedzić
 * oraz podać rozmiar pobierania. Wykrywanie z GPS jest tu wyraźnym
 * żądaniem użytkownika (przycisk), a nie automatyczne — przy zwykłym
 * uruchomieniu aplikacji GPS nie jest w ogóle pytany.
 */
function CityCard() {
  const s = useStrings();
  const city = useActiveCity();
  const [detecting, setDetecting] = useState(false);
  const t = s.cities;

  const pick = useCallback(
    async (id: CityId) => {
      if (id === city.id) return;
      Alert.alert(t.switchConfirmTitle, t.switchConfirmBody(s.cities[id]), [
        { text: s.common.cancel, style: 'cancel' },
        {
          text: t.switchConfirmYes,
          onPress: () => {
            void switchCity(id).catch((err) => {
              console.warn('[Settings] city switch failed:', err);
            });
          },
        },
      ]);
    },
    [city.id, s, t],
  );

  const detect = useCallback(async () => {
    if (detecting) return;
    setDetecting(true);
    try {
      const found = await detectCityFromGps();
      if (!found) {
        // Brak pozwolenia albo punkt poza wszystkimi miastami — zostawiamy
        // wybór ręczny, bez zmiany ustawień.
        Alert.alert(t.sectionTitle, t.detectFailed);
        return;
      }
      await pick(found);
    } finally {
      setDetecting(false);
    }
  }, [detecting, pick, t]);

  return (
    <Animated.View entering={FadeInDown.duration(180)} style={styles.card}>
      <View style={styles.cardTop}>
        <MapPin size={18} color={scheme.primary} />
        <Text style={styles.cardTitle}>{t.sectionTitle}</Text>
      </View>
      <Text style={styles.cardHint}>{t.hint}</Text>
      <View style={styles.cityRow}>
        {CITIES.map((c) => {
          const active = c.id === city.id;
          return (
            <Pressable
              key={c.id}
              onPress={() => void pick(c.id)}
              style={({ pressed }) => [
                styles.cityChip,
                active && styles.cityChipActive,
                pressed && !active && { opacity: 0.7 },
              ]}
              accessibilityRole="radio"
              accessibilityState={{ checked: active }}
              accessibilityLabel={s.cities[c.nameKey]}
            >
              {active && <Check size={14} color={scheme.onPrimaryContainer} />}
              <Text style={[styles.cityChipText, active && styles.cityChipTextActive]}>
                {s.cities[c.nameKey]}
              </Text>
            </Pressable>
          );
        })}
      </View>
      <Pressable
        onPress={() => void detect()}
        disabled={detecting}
        style={({ pressed }) => [
          styles.detectBtn,
          detecting && styles.stepBtnDisabled,
          pressed && !detecting && { opacity: 0.7 },
        ]}
        accessibilityLabel={t.detectA11y}
      >
        {detecting ? (
          <ActivityIndicator size="small" color={scheme.onSecondaryContainer} />
        ) : (
          <LocateFixed size={16} color={scheme.onSecondaryContainer} />
        )}
        <Text style={styles.downloadText}>{detecting ? t.detecting : t.detectAction}</Text>
      </Pressable>
    </Animated.View>
  );
}


export default function SettingsScreen() {
  const router = useRouter();
  const { settings, update, reset } = useRoutingSettings();
  const s = useStrings();
  const city = useActiveCity();
  const { setting: langSetting, setSetting: setLang } = useLocaleSetting();

  const activeCityName = s.cities[city.nameKey];
  const maxT = SETTINGS_LIMITS.maxTransfers;
  const minT = SETTINGS_LIMITS.minTransferSec;
  const walk = SETTINGS_LIMITS.maxWalkM;
  const speed = SETTINGS_LIMITS.walkSpeedMps;
  const anchor = SETTINGS_LIMITS.anchorRadiusM;
  const [dataStatus, setDataStatus] = useState<DataStatus>(() => getDataStatus());
  const [importing, setImporting] = useState(false);

  useEffect(() => {
    refreshDataStatus().then(setDataStatus);
    return subscribeDataStatus(setDataStatus);
  }, []);

  const busy = importing || dataStatus.state === 'downloading' || dataStatus.state === 'importing';

  const handleDownload = async () => {
    if (busy) return;
    setImporting(true);
    try {
      await importGtfsFromNetwork();
    } catch (err) {
      // Powód z importu (w języku użytkownika) zamiast zawsze tego samego „sprawdź internet".
      const reason = err instanceof Error ? err.message : s.settings.downloadFailFallback;
      Alert.alert(
        s.settings.downloadFailTitle,
        s.cities.downloadFailBody(reason),
      );
    } finally {
      setImporting(false);
    }
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.back} hitSlop={10}>
          <ChevronLeft size={23} color={scheme.onSurface} />
        </Pressable>
        <Text style={styles.headerTitle}>{s.settings.title}</Text>
        <Pressable onPress={() => reset()} style={styles.iconBtn} hitSlop={10} accessibilityLabel={s.settings.resetA11y}>
          <RotateCcw size={18} color={scheme.onSurfaceVariant} />
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false} overScrollMode="never">
        <CityCard />

        <Animated.View entering={FadeInDown.delay(10).duration(180)} style={styles.card}>
          <View style={styles.cardTop}>
            <Database size={18} color={scheme.primary} />
            <Text style={styles.cardTitle}>{s.settings.dataTitle}</Text>
          </View>
          <Text style={styles.cardHint}>
            {s.cities.dataForCity(activeCityName)}
          </Text>
          <Text style={styles.stepValueText}>{dataStatusLabel(dataStatus)}</Text>
          <Pressable
            onPress={handleDownload}
            disabled={busy}
            style={({ pressed }) => [
              styles.downloadBtn,
              busy && styles.stepBtnDisabled,
              pressed && !busy && { opacity: 0.7 },
            ]}
            accessibilityLabel={s.cities.dataDownloadA11y}
          >
            <Download size={18} color={scheme.onSecondaryContainer} />
            <Text style={styles.downloadText}>
              {dataStatus.state === 'ready' ? s.settings.downloadReady : s.settings.downloadEmpty}
            </Text>
          </Pressable>
        </Animated.View>

        <Animated.View entering={FadeInDown.delay(20).duration(180)} style={styles.card}>
          <View style={styles.cardTop}>
            <Globe size={18} color={scheme.primary} />
            <Text style={styles.cardTitle}>{s.settings.langTitle}</Text>
          </View>
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
                  <Text style={[styles.langChipText, active && styles.langChipTextActive]}>
                    {label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </Animated.View>

        <Animated.View entering={FadeInDown.delay(20).duration(180)} style={styles.card}>
          <View style={styles.cardTop}>
            <ArrowLeftRight size={18} color={scheme.primary} />
            <Text style={styles.cardTitle}>{s.settings.transfersTitle}</Text>
          </View>
          <Text style={styles.cardHint}>
            {s.settings.transfersHint}
          </Text>
          <Stepper
            value={settings.maxTransfers === 0 ? s.settings.directValue : transfersLabel(settings.maxTransfers)}
            onMinus={() => update({ maxTransfers: settings.maxTransfers - maxT.step })}
            onPlus={() => update({ maxTransfers: settings.maxTransfers + maxT.step })}
            minusDisabled={settings.maxTransfers <= maxT.min}
            plusDisabled={settings.maxTransfers >= maxT.max}
          />
        </Animated.View>

        <Animated.View entering={FadeInDown.delay(40).duration(180)} style={styles.card}>
          <View style={styles.cardTop}>
            <Clock3 size={18} color={scheme.primary} />
            <Text style={styles.cardTitle}>{s.settings.transferTimeTitle}</Text>
          </View>
          <Text style={styles.cardHint}>
            {s.settings.transferTimeHint}
          </Text>
          <Stepper
            value={formatTransferTime(settings.minTransferSec)}
            onMinus={() => update({ minTransferSec: settings.minTransferSec - minT.step })}
            onPlus={() => update({ minTransferSec: settings.minTransferSec + minT.step })}
            minusDisabled={settings.minTransferSec <= minT.min}
            plusDisabled={settings.minTransferSec >= minT.max}
          />
        </Animated.View>

        <Animated.View entering={FadeInDown.delay(80).duration(180)} style={styles.card}>
          <View style={styles.cardTop}>
            <Footprints size={18} color={scheme.primary} />
            <Text style={styles.cardTitle}>{s.settings.walkTitle}</Text>
          </View>
          <Text style={styles.cardHint}>
            {s.settings.walkHint}
          </Text>
          <Stepper
            value={formatWalkDistance(settings.maxWalkM, settings.walkSpeedMps)}
            onMinus={() => update({ maxWalkM: settings.maxWalkM - walk.step })}
            onPlus={() => update({ maxWalkM: settings.maxWalkM + walk.step })}
            minusDisabled={settings.maxWalkM <= walk.min}
            plusDisabled={settings.maxWalkM >= walk.max}
          />
        </Animated.View>

        <Animated.View entering={FadeInDown.delay(120).duration(180)} style={styles.card}>
          <View style={styles.cardTop}>
            <Activity size={18} color={scheme.primary} />
            <Text style={styles.cardTitle}>{s.settings.speedTitle}</Text>
          </View>
          <Text style={styles.cardHint}>
            {s.settings.speedHint}
          </Text>
          <Stepper
            value={walkSpeedLabel(settings.walkSpeedMps)}
            display={formatWalkSpeed(settings.walkSpeedMps)}
            onMinus={() => update({ walkSpeedMps: settings.walkSpeedMps - speed.step })}
            onPlus={() => update({ walkSpeedMps: settings.walkSpeedMps + speed.step })}
            minusDisabled={settings.walkSpeedMps <= speed.min}
            plusDisabled={settings.walkSpeedMps >= speed.max}
          />
        </Animated.View>

        <Animated.View entering={FadeInDown.delay(160).duration(180)} style={styles.card}>
          <View style={styles.cardTop}>
            <Anchor size={18} color={scheme.primary} />
            <Text style={styles.cardTitle}>{s.settings.anchorTitle}</Text>
          </View>
          <Text style={styles.cardHint}>
            {s.settings.anchorHint}
          </Text>
          <Stepper
            value={`${settings.anchorRadiusM} m`}
            onMinus={() => update({ anchorRadiusM: settings.anchorRadiusM - anchor.step })}
            onPlus={() => update({ anchorRadiusM: settings.anchorRadiusM + anchor.step })}
            minusDisabled={settings.anchorRadiusM <= anchor.min}
            plusDisabled={settings.anchorRadiusM >= anchor.max}
          />
        </Animated.View>

        <Text style={styles.foot}>
          {s.settings.foot}
        </Text>

        <View style={styles.sectionLabel}>
          <Text style={styles.sectionLabelText}>Powiadomienia i śledzenie</Text>
        </View>
        <NotificationPrefsCard />

        <Text style={styles.foot}>
          Powiadomienia działają w buildzie deweloperskim. Expo Go ich nie obsługuje.
        </Text>
        <View style={{ height: 40 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: scheme.surface },
  header: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, paddingVertical: 8 },
  back: { width: 40, height: 40, borderRadius: shape.full, backgroundColor: scheme.surfaceContainerHigh, alignItems: 'center', justifyContent: 'center' },
  iconBtn: { width: 40, height: 40, borderRadius: shape.full, backgroundColor: scheme.surfaceContainerHigh, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { flex: 1, ...type.titleMedium, fontWeight: '600', color: scheme.onSurface },
  body: { paddingHorizontal: 14, paddingTop: 8, gap: 12 },
  card: { backgroundColor: scheme.surfaceContainer, borderRadius: shape.large, padding: 16, gap: 10, ...elev.level1 },
  cardTop: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  cardTitle: { ...type.titleSmall, color: scheme.onSurface },
  cardHint: { ...type.bodySmall, color: scheme.onSurfaceVariant, lineHeight: 18 },
  stepper: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: scheme.surfaceContainerHighest, borderRadius: shape.full, padding: 6 },
  stepBtn: { width: 44, height: 44, borderRadius: shape.full, backgroundColor: scheme.secondaryContainer, alignItems: 'center', justifyContent: 'center' },
  stepBtnDisabled: { backgroundColor: scheme.surfaceContainerHigh, opacity: 0.6 },
  stepValue: { alignItems: 'center' },
  stepValueText: { ...type.titleMedium, color: scheme.onSurface },
  stepValueSub: { ...type.bodySmall, color: scheme.onSurfaceVariant },
  downloadBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: scheme.secondaryContainer, borderRadius: shape.full, paddingVertical: 12 },
  downloadText: { ...type.titleSmall, color: scheme.onSecondaryContainer },
  langRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  langChip: { flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: shape.full, backgroundColor: scheme.surfaceContainerHighest, paddingHorizontal: 14, paddingVertical: 10 },
  langChipActive: { backgroundColor: scheme.primaryContainer },
  langChipText: { ...type.labelMedium, color: scheme.onSurfaceVariant, fontWeight: '600' },
  langChipTextActive: { color: scheme.onPrimaryContainer, fontWeight: '700' },
  cityRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  cityChip: { flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: shape.full, backgroundColor: scheme.surfaceContainerHighest, paddingHorizontal: 16, paddingVertical: 11 },
  cityChipActive: { backgroundColor: scheme.primaryContainer },
  cityChipText: { ...type.labelLarge, color: scheme.onSurfaceVariant, fontWeight: '600' },
  cityChipTextActive: { color: scheme.onPrimaryContainer, fontWeight: '700' },
  detectBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: scheme.secondaryContainer, borderRadius: shape.full, paddingVertical: 11 },
  foot: { ...type.bodySmall, color: scheme.onSurfaceVariant, textAlign: 'center', paddingHorizontal: 16 },
  sectionLabel: { marginTop: 10 },
  sectionLabelText: { ...type.titleSmall, color: scheme.onSurfaceVariant, fontWeight: '600' },
});
