import { useEffect, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ArrowLeftRight, ChevronLeft, Clock3, Database, Download, Footprints, Minus, Plus, RotateCcw, Activity, Anchor } from 'lucide-react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { elev, scheme, shape, type } from '../src/theme/tokens';
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

function dataStatusLabel(s: DataStatus): string {
  switch (s.state) {
    case 'empty':
      return 'Brak danych — pobierz rozkład MPK';
    case 'downloading':
      return `Pobieranie… ${Math.round(s.progress * 100)}%`;
    case 'importing':
      return `${s.step} ${Math.round(s.progress * 100)}%`;
    case 'ready':
      return `Pełny rozkład: ${s.stops} przystanków, ${s.trips} kursów`;
    case 'error':
      return `Błąd: ${s.message}`;
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

export default function SettingsScreen() {
  const router = useRouter();
  const { settings, update, reset } = useRoutingSettings();

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
    } catch {
      Alert.alert(
        'Nie udało się pobrać rozkładu',
        'Sprawdź połączenie z internetem i spróbuj ponownie. Aplikacja pobiera dane prosto z Open Data Wrocław.',
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
        <Text style={styles.headerTitle}>Ustawienia trasy</Text>
        <Pressable onPress={() => reset()} style={styles.iconBtn} hitSlop={10} accessibilityLabel="Przywróć domyślne">
          <RotateCcw size={18} color={scheme.onSurfaceVariant} />
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false} overScrollMode="never">
        <Animated.View entering={FadeInDown.duration(180)} style={styles.card}>
          <View style={styles.cardTop}>
            <Database size={18} color={scheme.primary} />
            <Text style={styles.cardTitle}>Dane offline (MPK Wrocław)</Text>
          </View>
          <Text style={styles.cardHint}>
            Pełny rozkład prosto z Open Data Wrocław — pobierany raz, działa offline bez pośredniego serwera.
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
            accessibilityLabel="Pobierz rozkład MPK"
          >
            <Download size={18} color={scheme.onSecondaryContainer} />
            <Text style={styles.downloadText}>
              {dataStatus.state === 'ready' ? 'Odśwież rozkład' : 'Pobierz pełny rozkład'}
            </Text>
          </Pressable>
        </Animated.View>

        <Animated.View entering={FadeInDown.delay(20).duration(180)} style={styles.card}>
          <View style={styles.cardTop}>
            <ArrowLeftRight size={18} color={scheme.primary} />
            <Text style={styles.cardTitle}>Maks. liczba przesiadek</Text>
          </View>
          <Text style={styles.cardHint}>
            Mniej przesiadek = wygodniej. Planer dolicza ~10 min „kary” za każdą przesiadkę, więc spacer 300 m do
            przystanku z bezpośrednim kursem wygrywa z 3 przesiadkami z najbliższego słupka.
          </Text>
          <Stepper
            value={settings.maxTransfers === 0 ? 'Bezpośrednie' : transfersLabel(settings.maxTransfers)}
            onMinus={() => update({ maxTransfers: settings.maxTransfers - maxT.step })}
            onPlus={() => update({ maxTransfers: settings.maxTransfers + maxT.step })}
            minusDisabled={settings.maxTransfers <= maxT.min}
            plusDisabled={settings.maxTransfers >= maxT.max}
          />
        </Animated.View>

        <Animated.View entering={FadeInDown.delay(40).duration(180)} style={styles.card}>
          <View style={styles.cardTop}>
            <Clock3 size={18} color={scheme.primary} />
            <Text style={styles.cardTitle}>Minimalny czas na przesiadkę</Text>
          </View>
          <Text style={styles.cardHint}>
            Ile czasu rezerwujemy między wysiadką a kolejnym odjazdem. Większa wartość odrzuca ryzykowne,
            minutowe przesiadki.
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
            <Text style={styles.cardTitle}>Maks. dystans pieszo</Text>
          </View>
          <Text style={styles.cardHint}>
            Jak daleko możesz podejść na przystanek początkowy i z końcowego do celu. Dalszy przystanek z
            bezpośrednim tramwajem często bije najbliższy słupek.
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
            <Text style={styles.cardTitle}>Tempo chodzenia</Text>
          </View>
          <Text style={styles.cardHint}>
            Dostosuj prędkość, aby lepiej obliczać czas przesiadek pieszych i dojścia do celu.
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
            <Text style={styles.cardTitle}>Promień kotwiczenia</Text>
          </View>
          <Text style={styles.cardHint}>
            Gdy jesteś w tym promieniu od zapisanego miejsca (np. Dom), nawigacja automatycznie zakotwiczy punkt startowy do przypisanego przystanku, niwelując niedokładności GPS.
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
          Ustawienia zapisują się automatycznie i dotyczą kolejnych wyszukiwań połączeń.
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
  foot: { ...type.bodySmall, color: scheme.onSurfaceVariant, textAlign: 'center', paddingHorizontal: 16 },
});
