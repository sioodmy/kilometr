// Sekcja kopii zapasowej (eksport i import pliku JSON) w ramach widoku „Twoje dane".

import { useEffect, useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import Constants from 'expo-constants';
import { FileDown, FileUp } from './icons';
import { scheme, shape, type } from '../theme/tokens';
import { useStrings, type Strings } from '../i18n';
import {
  applyBackup,
  exportBackupToFile,
  pickBackupFile,
  previewBackupCounts,
  type BackupCounts,
  type BackupData,
  type BackupParseFailure,
} from '../services/backup';

function AppVersion(): string | null {
  try {
    const v = Constants.expoConfig?.version;
    return typeof v === 'string' ? v : null;
  } catch {
    return null;
  }
}

function summarize(counts: BackupCounts, t: Strings['settings']): string {
  return t.backupCurrent(counts.places, counts.savedRoutes, counts.tripHistory);
}

export function BackupCard({ onDataChanged }: { onDataChanged?: () => void }) {
  const s = useStrings();
  const b = s.settings;
  const y = s.yourData;
  const { width } = useWindowDimensions();
  const sideBySide = width >= 460;
  const [counts, setCounts] = useState<BackupCounts | null>(null);
  const [busy, setBusy] = useState<'export' | 'import' | null>(null);
  const setIdle = () => setBusy(null);

  useEffect(() => {
    let alive = true;
    void (async () => {
      const c = await previewBackupCounts();
      if (alive) setCounts(c);
    })();
    return () => {
      alive = false;
    };
  }, []);

  const failMessage = (reason: BackupParseFailure): string => {
    switch (reason) {
      case 'noFile':
        return b.backupFailNoFile;
      case 'unreadable':
        return b.backupFailUnreadable;
      case 'notBackup':
        return b.backupFailNotBackup;
      case 'schemaTooNew':
        return b.backupFailSchemaTooNew;
    }
  };

  const handleExport = async () => {
    if (busy) return;
    setBusy('export');
    try {
      const { path, shared } = await exportBackupToFile(AppVersion());
      if (!shared) Alert.alert(b.backupExportDoneTitle, b.backupExportDoneBody(path));
    } catch (err) {
      const reason = err instanceof Error ? err.message : b.backupExportFailFallback;
      Alert.alert(b.backupExportFailTitle, b.backupExportFailBody(reason));
    } finally {
      setIdle();
    }
  };

  const confirmImport = (summary: string, data: BackupData, onDone: (c: BackupCounts) => void) => {
    Alert.alert(b.backupImportConfirmTitle, b.backupImportConfirmBody(summary), [
      { text: b.backupImportCancel, style: 'cancel' },
      {
        text: b.backupImportAction,
        onPress: () => {
          setBusy('import');
          void applyBackup(data)
            .then((applied) => {
              setCounts(applied);
              onDataChanged?.();
              onDone(applied);
            })
            .catch((err) => {
              console.warn('[Backup] import failed:', err);
              Alert.alert(s.common.storageFailTitle, s.common.storageFailBody);
            })
            .finally(setIdle);
        },
      },
    ]);
  };

  const handleImport = async () => {
    if (busy) return;
    setBusy('import');
    try {
      const picked = await pickBackupFile();
      if (!picked) return;
      if (!picked.ok) {
        Alert.alert(b.backupImportConfirmTitle, failMessage(picked.reason));
        return;
      }
      if (picked.empty) {
        Alert.alert(b.backupImportConfirmTitle, b.backupImportNothing);
        return;
      }
      setIdle();
      confirmImport(summarize(picked.counts, b), picked.envelope.data, (applied) => {
        Alert.alert(b.backupImportDoneTitle, b.backupImportDoneBody(summarize(applied, b)));
      });
    } finally {
      setIdle();
    }
  };

  const empty =
    counts !== null && counts.places === 0 && counts.savedRoutes === 0 && counts.tripHistory === 0;

  return (
    <View style={styles.card}>
      <Text style={styles.sectionTitle} accessibilityRole="header">
        {y.backupSectionTitle}
      </Text>
      <Text style={styles.hint}>{b.backupHint}</Text>

      {counts && !empty ? (
        <View style={styles.pillsRow}>
          <View style={styles.countChip}>
            <Text style={styles.countValue}>{counts.places}</Text>
            <Text style={styles.countLabel}>{y.placesShort}</Text>
          </View>
          <View style={styles.countChip}>
            <Text style={styles.countValue}>{counts.savedRoutes}</Text>
            <Text style={styles.countLabel}>{y.routesShort}</Text>
          </View>
          <View style={styles.countChip}>
            <Text style={styles.countValue}>{counts.tripHistory}</Text>
            <Text style={styles.countLabel}>{y.historyShort}</Text>
          </View>
        </View>
      ) : null}

      {empty ? <Text style={styles.hintMuted}>{b.backupEmpty}</Text> : null}

      <View style={[styles.row, sideBySide && styles.rowHorizontal]}>
        <Pressable
          onPress={handleExport}
          accessibilityRole="button"
          disabled={busy !== null}
          accessibilityLabel={b.backupExportA11y}
          style={({ pressed }) => [
            styles.btn,
            sideBySide && styles.btnFlex,
            busy !== null && styles.btnDisabled,
            pressed && busy === null && { opacity: 0.72 },
          ]}
        >
          <FileDown size={18} color={scheme.onSecondaryContainer} />
          <Text style={styles.btnText}>{b.backupExport}</Text>
        </Pressable>
        <Pressable
          onPress={handleImport}
          accessibilityRole="button"
          disabled={busy !== null}
          accessibilityLabel={b.backupImportA11y}
          style={({ pressed }) => [
            styles.btn,
            styles.btnOutlined,
            sideBySide && styles.btnFlex,
            busy !== null && styles.btnDisabled,
            pressed && busy === null && { opacity: 0.72 },
          ]}
        >
          <FileUp size={18} color={scheme.onSurface} />
          <Text style={styles.btnOutlinedText}>{b.backupImport}</Text>
        </Pressable>
      </View>

      <Text style={styles.hintMuted}>{b.backupExcludeHint}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: scheme.surfaceContainerLow,
    borderRadius: shape.extraLarge,
    padding: 20,
    gap: 14,
  },
  sectionTitle: {
    ...type.titleMedium,
    fontWeight: '600',
    color: scheme.onSurface,
  },
  hint: {
    ...type.bodyMedium,
    color: scheme.onSurfaceVariant,
    lineHeight: 20,
  },
  hintMuted: {
    ...type.bodySmall,
    color: scheme.onSurfaceVariant,
    lineHeight: 18,
  },
  pillsRow: {
    flexDirection: 'row',
    gap: 8,
  },
  countChip: {
    flex: 1,
    backgroundColor: scheme.surfaceContainer,
    borderRadius: shape.large,
    paddingVertical: 10,
    paddingHorizontal: 10,
    alignItems: 'center',
    gap: 2,
  },
  countValue: {
    ...type.titleMedium,
    fontWeight: '700',
    color: scheme.primary,
    fontVariant: ['tabular-nums'],
  },
  countLabel: {
    ...type.labelSmall,
    color: scheme.onSurfaceVariant,
    textAlign: 'center',
  },
  row: {
    gap: 10,
    marginTop: 2,
  },
  rowHorizontal: {
    flexDirection: 'row',
  },
  btn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: scheme.secondaryContainer,
    borderRadius: shape.medium,
    minHeight: 48,
    paddingVertical: 12,
    paddingHorizontal: 12,
  },
  btnOutlined: {
    backgroundColor: scheme.surfaceContainerHigh,
    borderWidth: 2,
    borderColor: scheme.outlineVariant,
  },
  btnFlex: {
    flex: 1,
  },
  btnDisabled: {
    opacity: 0.55,
  },
  btnText: {
    ...type.titleSmall,
    color: scheme.onSecondaryContainer,
    flexShrink: 1,
    textAlign: 'center',
  },
  btnOutlinedText: {
    ...type.titleSmall,
    color: scheme.onSurface,
    flexShrink: 1,
    textAlign: 'center',
  },
});
