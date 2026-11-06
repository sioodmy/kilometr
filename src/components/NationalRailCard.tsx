import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { Download, Trash2, Train } from './icons';
import { scheme, shape, type } from '../theme/tokens';
import { useStrings } from '../i18n';
import {
  deleteNationalTimetable,
  downloadNationalTimetable,
  getNationalTimetableState,
  subscribeNationalTimetable,
  type NationalTimetableState,
} from '../services/nationalTimetable';

/** Czytelna data „ważny do” z klucza YYYYMMDD. */
function formatEndDate(endDate: string | null): string {
  if (!endDate || !/^\d{8}$/.test(endDate)) return '';
  return `${endDate.slice(6, 8)}.${endDate.slice(4, 6)}.${endDate.slice(0, 4)}`;
}

/**
 * Karta ogólnopolskiego rozkładu kolejowego w ustawieniach (sekcja offline):
 * status, pobieranie na żądanie i usuwanie pliku (zwalnia ~9 MB na dysku).
 */
export function NationalRailCard() {
  const s = useStrings();
  const [state, setState] = useState<NationalTimetableState>(getNationalTimetableState());

  useEffect(() => subscribeNationalTimetable(setState), []);

  const ready = state.phase === 'ready';
  const downloading = state.phase === 'downloading';
  const checking = state.phase === 'checking';
  const busy = downloading || checking;

  const handleDelete = () => {
    Alert.alert(s.settings.railDeleteTitle, s.settings.railDeleteBody, [
      { text: s.settings.railCancel, style: 'cancel' },
      { text: s.settings.railDeleteConfirm, style: 'destructive', onPress: () => void deleteNationalTimetable() },
    ]);
  };

  return (
    <View style={styles.card}>
      <View style={styles.titleRow}>
        <View style={styles.iconWrap}>
          <Train size={20} color={scheme.onSecondaryContainer} />
        </View>
        <View style={styles.titleWrap}>
          <Text style={styles.cardTitle}>{s.settings.railTitle}</Text>
          <Text style={styles.hint}>{s.settings.railHint}</Text>
        </View>
      </View>

      <Text style={styles.status}>
        {busy
          ? s.intercity.downloading
          : ready
            ? s.settings.railReady(formatEndDate(state.endDate))
            : state.phase === 'error'
              ? s.intercity.downloadFailed
              : s.settings.railEmpty}
      </Text>

      {downloading ? (
        <View style={styles.progressTrack} accessibilityLabel={s.intercity.downloading}>
          <View
            style={[styles.progressFill, { width: `${Math.round(Math.max(0.02, state.progress) * 100)}%` }]}
          />
        </View>
      ) : (
        <View style={styles.actions}>
          <Pressable
            onPress={() => void downloadNationalTimetable()}
            disabled={busy}
            accessibilityRole="button"
            accessibilityLabel={ready ? s.settings.railCheck : s.settings.railDownload}
            style={({ pressed }) => [styles.btn, pressed && { opacity: 0.85 }, busy && { opacity: 0.6 }]}
          >
            {busy ? (
              <ActivityIndicator size="small" color={scheme.onSecondaryContainer} />
            ) : (
              <Download size={18} color={scheme.onSecondaryContainer} />
            )}
            <Text style={styles.btnText}>
              {ready ? s.settings.railCheck : s.settings.railDownload}
            </Text>
          </Pressable>
          {ready && (
            <Pressable
              onPress={handleDelete}
              accessibilityRole="button"
              accessibilityLabel={s.settings.railDelete}
              style={({ pressed }) => [styles.btn, styles.deleteBtn, pressed && { opacity: 0.85 }]}
            >
              <Trash2 size={18} color={scheme.onSurfaceVariant} />
              <Text style={styles.deleteText}>{s.settings.railDelete}</Text>
            </Pressable>
          )}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    padding: 18,
    gap: 14,
    backgroundColor: scheme.surfaceContainerLow,
    borderRadius: shape.extraLarge,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  iconWrap: {
    width: 42,
    height: 42,
    borderRadius: shape.full,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: scheme.secondaryContainer,
  },
  titleWrap: {
    flex: 1,
    gap: 2,
  },
  cardTitle: {
    ...type.titleMedium,
    fontWeight: '500',
    color: scheme.onSurface,
  },
  hint: {
    ...type.bodySmall,
    color: scheme.onSurfaceVariant,
    lineHeight: 16,
  },
  status: {
    ...type.bodyMedium,
    color: scheme.onSurfaceVariant,
  },
  progressTrack: {
    height: 8,
    borderRadius: shape.full,
    backgroundColor: scheme.surfaceContainerHighest,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    borderRadius: shape.full,
    backgroundColor: scheme.primary,
  },
  actions: {
    flexDirection: 'row',
    gap: 10,
  },
  btn: {
    flex: 1,
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: scheme.secondaryContainer,
    borderRadius: shape.full,
    paddingHorizontal: 12,
  },
  btnText: {
    ...type.labelLarge,
    fontWeight: '600',
    color: scheme.onSecondaryContainer,
  },
  deleteBtn: {
    backgroundColor: scheme.surfaceContainerHighest,
  },
  deleteText: {
    ...type.labelLarge,
    fontWeight: '600',
    color: scheme.onSurfaceVariant,
  },
});
