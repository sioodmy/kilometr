// Karta „Twoje dane" na ekranie Ustawień: eksport i import kopii zapasowej.
//
// Dwie ścieżki z dwoma różnymi charakterystykami ryzyka, stąd dwie różne
// reakcje na błąd. Eksport tylko zapisuje nowy plik — nic nie psuje, więc przy
// błędzie nie blokujemy przyciskiem. Import czyje dane, więc najpierw
// wybieramy plik, pokazujemy co jest w środku i dopiero po potwierdzeniu
// zapisujemy (Alert, nie własny modal — spójnie z resztą Ustawień).

import { useEffect, useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { DatabaseBackup, FileDown, FileUp } from 'lucide-react-native';
import Constants from 'expo-constants';
import { elev, scheme, shape, type } from '../theme/tokens';
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

/** `Miejsca: 4 • Przejazdy: 12`. Bez własnych reguł liczby mnogiej —
 *  formatowanie (wraz z nim ewentualne liczby mnogie) żyje w słowniku. */
function summarize(counts: BackupCounts, t: Strings['settings']): string {
  return t.backupCurrent(counts.places, counts.savedRoutes, counts.tripHistory);
}

export function BackupCard() {
  const s = useStrings();
  const b = s.settings;
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
      // Okno udostępniania samo w sobie jest potwierdzeniem („wysłałeś
      // plik"). Ścieżkę pokazujemy tylko gdy go nie było — wtedy plik naprawdę
      // zostaje w pamięci telefonu i warto wiedzieć, gdzie go szukać.
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
          // `applyBackup` zapisuje do KV, więc wyjątek tu znaczy „coś się
          // nie udało", a nie „użytkownik się rozmyślił" — stąd `catch`.
          void applyBackup(data)
            .then((applied) => {
              setCounts(applied);
              onDone(applied);
            })
            .catch((err) => {
              console.warn('[Backup] import failed:', err);
              Alert.alert(b.backupImportConfirmTitle, failMessage('unreadable'));
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
      // Ścieżka importu jest dwuetapowa, więc `busy` zdejmujemy przed
      // potwierdzeniem — `Alert` nie ma własnego stanu zajętości, a przycisk
      // musi dać się dostać do reszty ekranu.
      setIdle();
      confirmImport(summarize(picked.counts, b), picked.envelope.data, (applied) => {
        Alert.alert(b.backupImportDoneTitle, b.backupImportDoneBody(summarize(applied, b)));
      });
    } finally {
      setIdle();
    }
  };

  // Pustą kopię wyeksportujemy tylko wtedy, gdy naprawdę nie ma nic — ale
// przycisk zostaje aktywny, bo sama kopia (ustawienia, język) coś wnosi.
const empty =
  counts !== null && counts.places === 0 && counts.savedRoutes === 0 && counts.tripHistory === 0;

  return (
    <View style={styles.card}>
      <View style={styles.cardTop}>
        <DatabaseBackup size={18} color={scheme.primary} />
        <Text style={styles.cardTitle}>{b.backupTitle}</Text>
      </View>
      <Text style={styles.hint}>{b.backupHint}</Text>
      <Text style={styles.hintMuted}>{b.backupExcludeHint}</Text>
      {counts && !empty ? <Text style={styles.summary}>{summarize(counts, b)}</Text> : null}
      {empty ? <Text style={styles.hintMuted}>{b.backupEmpty}</Text> : null}

      <View style={styles.row}>
        <Pressable
          onPress={handleExport}
          disabled={busy !== null}
          accessibilityLabel={b.backupExportA11y}
          style={({ pressed }) => [
            styles.btn,
            busy !== null && styles.btnDisabled,
            pressed && busy === null && { opacity: 0.7 },
          ]}
        >
          <FileDown size={18} color={scheme.onSecondaryContainer} />
          <Text style={styles.btnText}>{b.backupExport}</Text>
        </Pressable>
        <Pressable
          onPress={handleImport}
          disabled={busy !== null}
          accessibilityLabel={b.backupImportA11y}
          style={({ pressed }) => [
            styles.btn,
            busy !== null && styles.btnDisabled,
            pressed && busy === null && { opacity: 0.7 },
          ]}
        >
          <FileUp size={18} color={scheme.onSecondaryContainer} />
          <Text style={styles.btnText}>{b.backupImport}</Text>
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
  hintMuted: { ...type.bodySmall, color: scheme.outline, lineHeight: 18 },
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
  btnDisabled: { opacity: 0.55 },
  btnText: { ...type.titleSmall, color: scheme.onSecondaryContainer },
});