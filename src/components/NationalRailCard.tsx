import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { Download } from './icons';
import { scheme, shape, type } from '../theme/tokens';
import { useStrings } from '../i18n';
import {
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
 * status i pobieranie / sprawdzanie aktualizacji na żądanie.
 * Wygląd spójny z kartą miejskiego rozkładu jazdy.
 */
export function NationalRailCard() {
  const s = useStrings();
  const [state, setState] = useState<NationalTimetableState>(getNationalTimetableState());

  useEffect(() => subscribeNationalTimetable(setState), []);

  const ready = state.phase === 'ready';
  const downloading = state.phase === 'downloading';
  const checking = state.phase === 'checking';
  const busy = downloading || checking;

  const statusText = downloading
    ? s.intercity.downloading
    : checking
      ? s.settings.railChecking
      : ready
        ? s.settings.railReady(formatEndDate(state.endDate))
        : state.phase === 'error'
          ? s.intercity.downloadFailed
          : s.settings.railEmpty;

  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>{s.settings.railTitle}</Text>
      <Text style={styles.settingHint}>{s.settings.railHint}</Text>
      <Text style={styles.statusText}>{statusText}</Text>

      {downloading && (
        <View style={styles.progressTrack} accessibilityLabel={s.intercity.downloading}>
          <View
            style={[styles.progressFill, { width: `${Math.round(Math.max(0.02, state.progress) * 100)}%` }]}
          />
        </View>
      )}

      <Pressable
        onPress={() => void downloadNationalTimetable()}
        disabled={busy}
        accessibilityRole="button"
        accessibilityLabel={ready ? s.settings.railCheck : s.settings.railDownload}
        accessibilityState={{ busy, disabled: busy }}
        style={({ pressed }) => [
          ready ? styles.checkBtn : styles.downloadBtn,
          busy && styles.btnDisabled,
          pressed && !busy && { opacity: 0.7 },
        ]}
      >
        {busy ? (
          <ActivityIndicator
            size="small"
            color={ready ? scheme.onSurfaceVariant : scheme.onSecondaryContainer}
          />
        ) : (
          <Download
            size={18}
            color={ready ? scheme.onSurfaceVariant : scheme.onSecondaryContainer}
          />
        )}
        <Text style={ready ? styles.checkText : styles.downloadText}>
          {downloading
            ? s.intercity.downloading
            : checking
              ? s.settings.railChecking
              : ready
                ? s.settings.railCheck
                : s.settings.railDownload}
        </Text>
      </Pressable>
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
  cardTitle: {
    ...type.titleMedium,
    color: scheme.onSurface,
    fontWeight: '500',
  },
  settingHint: {
    ...type.bodyMedium,
    color: scheme.onSurfaceVariant,
    lineHeight: 21,
  },
  statusText: {
    ...type.bodyMedium,
    color: scheme.onSurface,
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
  checkText: {
    ...type.labelLarge,
    color: scheme.onSurfaceVariant,
    fontWeight: '600',
  },
  btnDisabled: {
    backgroundColor: scheme.surfaceContainerHigh,
    opacity: 0.6,
  },
});
