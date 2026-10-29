// Karta diagnostyki na ekranie Ustawień: szybki health check bazy GTFS.
// Sama sprawdza (tylko odczyty), wynik mieści się na jednym ekranie,
// a przy problemie daje kopiowanie raportu i ponowne pobranie rozkładu.

import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import {
  CircleCheck,
  CircleX,
  Copy,
  Download,
  Stethoscope,
  TriangleAlert,
} from './icons';
import { scheme, shape, type } from '../theme/tokens';
import { useStrings } from '../i18n';
import {
  copyReportToClipboard,
  diagOverall,
  runDiagnostics,
  type DiagItem,
  type DiagLevel,
  type DiagResult,
} from '../services/diagnostics';
import {
  importGtfsFromNetwork,
  refreshDataStatus,
  subscribeDataStatus,
  type DataStatus,
} from '../services/dataManager';

function levelColor(level: DiagLevel): string {
  return level === 'ok' ? scheme.success : level === 'warn' ? scheme.warning : scheme.error;
}

function levelWord(item: DiagItem, t: ReturnType<typeof useStrings>['settings']): string {
  return item.level === 'ok' ? t.diagOk : item.level === 'warn' ? t.diagWarn : t.diagError;
}

function LevelIcon({ level }: { level: DiagLevel }) {
  const color = levelColor(level);
  if (level === 'ok') return <CircleCheck size={20} color={color} />;
  if (level === 'warn') return <TriangleAlert size={20} color={color} />;
  return <CircleX size={20} color={color} />;
}

export function DiagnosticsCard() {
  const s = useStrings();
  const t = s.settings;
  const [result, setResult] = useState<DiagResult | null>(null);
  const [running, setRunning] = useState(false);
  const [fixing, setFixing] = useState(false);
  const [copying, setCopying] = useState(false);
  const [copied, setCopied] = useState<'ok' | 'fail' | null>(null);
  const [dlBusy, setDlBusy] = useState(false);

  useEffect(
    () =>
      subscribeDataStatus((st: DataStatus) => {
        setDlBusy(st.state === 'downloading' || st.state === 'importing');
      }),
    [],
  );

  const busy = running || fixing || copying || dlBusy;

  const handleRun = async () => {
    if (running || fixing || dlBusy) return;
    setRunning(true);
    setCopied(null);
    try {
      setResult(await runDiagnostics());
    } finally {
      setRunning(false);
    }
  };

  const handleCopy = async () => {
    if (!result || copying) return;
    setCopying(true);
    try {
      setCopied((await copyReportToClipboard(result)) ? 'ok' : 'fail');
    } finally {
      setCopying(false);
    }
  };

  const handleFix = async () => {
    if (busy) return;
    setFixing(true);
    setCopied(null);
    try {
      await importGtfsFromNetwork();
      await refreshDataStatus().catch(() => {});
      setResult(await runDiagnostics());
    } catch (err) {
      const reason = err instanceof Error ? err.message : t.downloadFailFallback;
      Alert.alert(t.downloadFailTitle, t.downloadFailBody(reason));
    } finally {
      setFixing(false);
    }
  };

  const overall = result ? diagOverall(result) : null;
  const needsFix = result != null && overall !== 'ok';

  return (
    <View style={styles.card}>
      <View style={styles.head}>
        <View style={styles.icon}>
          <Stethoscope size={20} color={scheme.onSecondaryContainer} />
        </View>
        <View style={styles.headText}>
          <Text style={styles.title}>{t.diagTitle}</Text>
          <Text style={styles.hint}>{t.diagHint}</Text>
        </View>
      </View>

      {result ? (
        <View accessibilityLabel={t.diagTitle}>
          {result.items.map((item) => (
            <View
              key={item.id}
              style={styles.row}
              accessibilityLabel={`${levelWord(item, t)}: ${item.title}${item.detail ? `. ${item.detail}` : ''}`}
            >
              <LevelIcon level={item.level} />
              <View style={styles.rowText}>
                <Text style={styles.rowTitle}>{item.title}</Text>
                {item.detail ? (
                  <Text style={styles.rowDetail} numberOfLines={3}>
                    {item.detail}
                  </Text>
                ) : null}
              </View>
              <Text style={[styles.level, { color: levelColor(item.level) }]}>
                {levelWord(item, t)}
              </Text>
            </View>
          ))}
        </View>
      ) : null}

      {running || fixing ? (
        <View style={styles.progressRow}>
          <ActivityIndicator size="small" color={scheme.primary} />
          <Text style={styles.progressText}>{t.diagRunning}</Text>
        </View>
      ) : null}

      <View style={styles.actions}>
        <Pressable
          onPress={() => void handleRun()}
          disabled={busy}
          style={({ pressed }) => [
            styles.runBtn,
            busy && styles.btnDisabled,
            pressed && !busy && { opacity: 0.7 },
          ]}
          accessibilityRole="button"
          accessibilityLabel={t.diagRunA11y}
          accessibilityState={{ busy: running, disabled: busy }}
        >
          <Text style={styles.runText}>{result ? t.diagRerun : t.diagRun}</Text>
        </Pressable>
        {result ? (
          <View style={styles.actionRow}>
            {needsFix ? (
              <Pressable
                onPress={() => void handleFix()}
                disabled={busy}
                style={({ pressed }) => [
                  styles.ghostBtn,
                  busy && styles.btnDisabled,
                  pressed && !busy && { opacity: 0.7 },
                ]}
                accessibilityRole="button"
                accessibilityLabel={t.diagFixA11y}
                accessibilityState={{ busy: fixing, disabled: busy }}
              >
                {fixing ? (
                  <ActivityIndicator size="small" color={scheme.onSurfaceVariant} />
                ) : (
                  <Download size={18} color={scheme.onSurfaceVariant} />
                )}
                <Text style={styles.ghostText}>{t.diagFix}</Text>
              </Pressable>
            ) : null}
            <Pressable
              onPress={() => void handleCopy()}
              disabled={busy}
              style={({ pressed }) => [
                styles.ghostBtn,
                busy && styles.btnDisabled,
                pressed && !busy && { opacity: 0.7 },
              ]}
              accessibilityRole="button"
              accessibilityLabel={t.diagCopyA11y}
              accessibilityState={{ busy: copying, disabled: busy }}
            >
              {copying ? (
                <ActivityIndicator size="small" color={scheme.onSurfaceVariant} />
              ) : (
                <Copy size={18} color={scheme.onSurfaceVariant} />
              )}
              <Text style={styles.ghostText}>{t.diagCopy}</Text>
            </Pressable>
          </View>
        ) : null}
      </View>

      {copied === 'ok' ? (
        <Text style={styles.copiedText} accessibilityLiveRegion="polite">
          {t.diagCopied}
        </Text>
      ) : copied === 'fail' ? (
        <Text style={styles.failText} accessibilityLiveRegion="polite">
          {t.diagCopyFail}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: scheme.surfaceContainerLow,
    borderRadius: shape.extraLarge,
    padding: 20,
    gap: 18,
  },
  head: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  icon: {
    width: 40,
    height: 40,
    borderRadius: shape.medium,
    backgroundColor: scheme.secondaryContainer,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headText: { flex: 1, minWidth: 0, gap: 2 },
  title: { ...type.titleSmall, color: scheme.onSurface, fontWeight: '700' },
  hint: { ...type.bodyMedium, color: scheme.onSurfaceVariant, lineHeight: 21 },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, paddingVertical: 7 },
  rowText: { flex: 1, minWidth: 0, gap: 1 },
  rowTitle: { ...type.bodyMedium, color: scheme.onSurface, fontWeight: '600' },
  rowDetail: { ...type.bodySmall, color: scheme.onSurfaceVariant, lineHeight: 17 },
  level: { ...type.labelSmall, fontWeight: '700', paddingTop: 2 },
  progressRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  progressText: { ...type.bodySmall, color: scheme.onSurfaceVariant },
  actions: { gap: 8 },
  actionRow: { gap: 8 },
  runBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: scheme.secondaryContainer,
    borderRadius: shape.medium,
    minHeight: 44,
    paddingVertical: 12,
    paddingHorizontal: 16,
  },
  runText: { ...type.titleSmall, color: scheme.onSecondaryContainer },
  ghostBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: scheme.surfaceContainerHighest,
    borderRadius: shape.medium,
    minHeight: 44,
    paddingVertical: 12,
    paddingHorizontal: 16,
  },
  ghostText: {
    ...type.labelLarge,
    color: scheme.onSurfaceVariant,
    fontWeight: '600',
    textAlign: 'center',
    flexShrink: 1,
  },
  btnDisabled: { opacity: 0.6 },
  copiedText: { ...type.bodySmall, color: scheme.success, lineHeight: 18 },
  failText: { ...type.bodySmall, color: scheme.error, lineHeight: 18 },
});
