// Karta „Kilometr Contributor" na Ustawieniach: ręczne zbieranie telemetrii,
// eksport ZIP, wysyłka na serwer testowy i sprzątanie danych.
//
// Renderuje się tylko poza kanałem prod (`isContributorAvailable`), więc na
// buildach testera jest realną sekcją, a w wersji sklepowej jej w ogóle nie ma.

import { useCallback, useEffect, useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { CloudUpload, FileDown, Play, Radar, Square, Trash2 } from 'lucide-react-native';
import { elev, scheme, shape, type } from '../theme/tokens';
import { useStrings } from '../i18n';
import { PrefsToggle } from './NotificationPrefsCard';
import {
  contributorVersion,
  getContributorSettingsSync,
  loadContributorSettings,
  saveContributorSettings,
} from '../services/contributor/config';
import { BYTES_PER_SAMPLE, clearAll, stats, type StatsResult } from '../services/contributor/store';
import {
  metaFromTracked,
  requestBackgroundLocationPermission,
  setNativeNotificationCopy,
  startCollection,
  stopCollection,
  subscribeCollectorState,
  getCollectorState,
  type CollectorState,
} from '../services/contributor/collector';
import { writeContributorZip } from '../services/contributor/export';
import { uploadContributorSessions } from '../services/contributor/upload';
import { getTrackedTripSync } from '../services/notifications/tripMonitor';
import { getActiveCitySync } from '../services/cityStore';

function mbString(bytes: number): string {
  return (bytes / 1_000_000).toFixed(1);
}

export function ContributorCard() {
  const s = useStrings();
  const b = s.settings;
  const [state, setState] = useState<CollectorState>(() => getCollectorState());
  const [autoFollow, setAutoFollow] = useState<boolean>(
    () => getContributorSettingsSync().autoFollow,
  );
  const [usage, setUsage] = useState<StatsResult | null>(null);
  const [busy, setBusy] = useState<
    'start' | 'stop' | 'export' | 'upload' | 'delete' | 'toggle' | null
  >(null);

  useEffect(() => {
    let alive = true;
    void (async () => {
      const settings = await loadContributorSettings();
      if (alive) setAutoFollow(settings.autoFollow);
    })();
    // Teksty powiadomienia natywnego ustala karta: ona ma dostępny słownik,
    // a serwis Androida wyświetla je nawet gdy JS już nie żyje.
    setNativeNotificationCopy({
      title: b.contribNotifTitle,
      text: b.contribNotifText,
      channelName: b.contribNotifChannelName,
      channelDescription: b.contribNotifChannelDescription,
    });
    const unsub = subscribeCollectorState(() => {
      if (alive) setState(getCollectorState());
    });
    void (async () => {
      const row = await stats();
      if (alive) setUsage(row);
    })();
    return () => {
      alive = false;
      unsub();
    };
  }, [b.contribNotifText, b.contribNotifTitle]);

  const refreshUsage = useCallback(() => {
    void (async () => {
      const row = await stats();
      setUsage(row);
    })();
  }, []);

  const handleToggleAuto = (next: boolean) => {
    setBusy('toggle');
    const prev = autoFollow;
    setAutoFollow(next);
    void saveContributorSettings({ ...getContributorSettingsSync(), autoFollow: next })
      .catch(() => setAutoFollow(prev))
      .finally(() => setBusy(null));
  };

  const handleStart = async () => {
    setBusy('start');
    try {
      // Poproś o foreground + tło jedną operacją: natywny serwis i tak
      // jest bez tła bezużyteczny, a droga JS-owa tła nie potrzebuje.
      const granted = await requestBackgroundLocationPermission();
      if (!granted) {
        Alert.alert(b.contribTitle, b.contribPermissionNeeded);
        return;
      }
      const trip = getTrackedTripSync();
      if (trip) {
        const sessionMeta = metaFromTracked(trip);
        const ok = await startCollection({ ...sessionMeta }, 'manual');
        if (!ok) Alert.alert(b.contribTitle, b.contribPermissionNeeded);
        return;
      }
      await startCollection({ city: getActiveCitySync().id }, 'manual');
    } finally {
      setBusy(null);
      refreshUsage();
    }
  };

  const handleStop = async () => {
    setBusy('stop');
    try {
      await stopCollection();
    } finally {
      setBusy(null);
      refreshUsage();
    }
  };

  const handleExport = async () => {
    setBusy('export');
    try {
      const result = await writeContributorZip(contributorVersion());
      Alert.alert(b.contribExportDoneTitle, b.contribExportDoneBody(result.path));
    } catch (err) {
      const reason = err instanceof Error ? err.message : b.contribExportFailFallback;
      Alert.alert(b.contribExportFailTitle, b.contribExportFailBody(reason));
    } finally {
      setBusy(null);
    }
  };

  const handleUpload = async () => {
    setBusy('upload');
    try {
      const result = await uploadContributorSessions();
      if (!result) {
        Alert.alert(b.contribUploadDoneTitle, b.contribUploadNothing);
        return;
      }
      Alert.alert(b.contribUploadDoneTitle, b.contribUploadDoneBody(mbString(result.bytes)));
    } catch {
      Alert.alert(b.contribUploadFailTitle, b.contribUploadFailBody);
    } finally {
      setBusy(null);
      refreshUsage();
    }
  };

  const confirmDelete = () => {
    Alert.alert(b.contribDeleteConfirmTitle, b.contribDeleteConfirmBody, [
      { text: s.common.cancel, style: 'cancel' },
      {
        text: b.contribDeleteAction,
        style: 'destructive',
        onPress: () => {
          setBusy('delete');
          void (async () => {
            try {
              await stopCollection();
              await clearAll();
            } finally {
              setBusy(null);
              refreshUsage();
            }
          })();
        },
      },
    ]);
  };

  const statusText =
    state === 'native'
      ? b.contribStatusNative
      : state === 'js'
        ? b.contribStatusForeground
        : b.contribStatusIdle;

  const runningLine =
    usage && usage.sessions > 0
      ? `${b.contribSessionsCount(usage.sessions)} • ${b.contribSize(mbString(usage.samples * BYTES_PER_SAMPLE))}`
      : null;

  return (
    <View style={styles.card}>
      <View style={styles.cardTop}>
        <Radar size={18} color={scheme.primary} />
        <Text style={styles.cardTitle}>{b.contribTitle}</Text>
      </View>
      <Text style={styles.hint}>{b.contribHint}</Text>

      <View style={styles.divider} />
      <View style={styles.toggleRow}>
        <View style={styles.toggleTextWrap}>
          <Text style={styles.rowTitle}>{b.contribAutoToggle}</Text>
        </View>
        <PrefsToggle
          value={autoFollow}
          onChange={handleToggleAuto}
          disabled={busy !== null}
          label={b.contribAutoToggle}
          hint={b.contribAutoToggleA11y}
          onText={s.notificationPrefs.on}
          offText={s.notificationPrefs.off}
        />
      </View>

      <View style={styles.divider} />
      <Text style={[styles.hint, state === 'idle' && styles.hintMuted]}>{statusText}</Text>
      {runningLine ? <Text style={styles.summary}>{runningLine}</Text> : null}

      <View style={styles.row}>
        {state === 'idle' ? (
          <Pressable
            onPress={() => void handleStart()}
            disabled={busy !== null}
            accessibilityLabel={b.contribStartNowA11y}
            style={({ pressed }) => [
              styles.btn,
              busy !== null && styles.btnDisabled,
              pressed && busy === null && { opacity: 0.7 },
            ]}
          >
            <Play size={18} color={scheme.onSecondaryContainer} />
            <Text style={styles.btnText}>{b.contribStartNow}</Text>
          </Pressable>
        ) : (
          <Pressable
            onPress={() => void handleStop()}
            disabled={busy !== null}
            accessibilityLabel={b.contribStopNowA11y}
            style={({ pressed }) => [
              styles.btn,
              styles.btnStop,
              busy !== null && styles.btnDisabled,
              pressed && busy === null && { opacity: 0.7 },
            ]}
          >
            <Square size={18} color={scheme.onErrorContainer} />
            <Text style={[styles.btnText, styles.btnStopText]}>{b.contribStopNow}</Text>
          </Pressable>
        )}
      </View>

      <View style={styles.row}>
        <Pressable
          onPress={() => void handleExport()}
          disabled={busy !== null}
          accessibilityLabel={b.contribExportA11y}
          style={({ pressed }) => [
            styles.btn,
            busy !== null && styles.btnDisabled,
            pressed && busy === null && { opacity: 0.7 },
          ]}
        >
          <FileDown size={18} color={scheme.onSecondaryContainer} />
          <Text style={styles.btnText}>{b.contribExport}</Text>
        </Pressable>
        <Pressable
          onPress={() => void handleUpload()}
          disabled={busy !== null}
          accessibilityLabel={b.contribUploadA11y}
          style={({ pressed }) => [
            styles.btn,
            busy !== null && styles.btnDisabled,
            pressed && busy === null && { opacity: 0.7 },
          ]}
        >
          <CloudUpload size={18} color={scheme.onSecondaryContainer} />
          <Text style={styles.btnText}>{b.contribUpload}</Text>
        </Pressable>
        <Pressable
          onPress={confirmDelete}
          disabled={busy !== null}
          accessibilityLabel={b.contribDeleteA11y}
          style={({ pressed }) => [
            styles.btn,
            styles.btnDanger,
            busy !== null && styles.btnDisabled,
            pressed && busy === null && { opacity: 0.7 },
          ]}
        >
          <Trash2 size={18} color={scheme.error} />
          <Text style={[styles.btnText, styles.btnDangerText]}>{b.contribDelete}</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: scheme.surfaceContainer,
    borderRadius: shape.large,
    padding: 16,
    gap: 10,
    ...elev.level1,
  },
  cardTop: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  cardTitle: { ...type.titleSmall, color: scheme.onSurface },
  hint: { ...type.bodySmall, color: scheme.onSurfaceVariant, lineHeight: 18 },
  hintMuted: { color: scheme.outline },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: scheme.outlineVariant },
  toggleRow: { flexDirection: 'row', alignItems: 'flex-start' },
  toggleTextWrap: { flex: 1, paddingRight: 8 },
  rowTitle: { ...type.bodyMedium, color: scheme.onSurface },
  summary: { ...type.labelLarge, color: scheme.primary },
  row: { flexDirection: 'row', gap: 8, marginTop: 2 },
  btn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: scheme.secondaryContainer,
    borderRadius: shape.full,
    paddingVertical: 12,
    paddingHorizontal: 8,
  },
  btnStop: { backgroundColor: scheme.errorContainer },
  btnStopText: { color: scheme.onErrorContainer },
  btnDanger: { flex: 0.6 },
  btnDangerText: { color: scheme.error },
  btnDisabled: { opacity: 0.55 },
  btnText: { ...type.titleSmall, color: scheme.onSecondaryContainer },
});
