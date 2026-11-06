import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';
import { Download, Train } from './icons';
import { scheme, shape, type } from '../theme/tokens';
import { useStrings } from '../i18n';
import {
  downloadNationalTimetable,
  getNationalTimetableState,
  nationalTimetableSizeMb,
  subscribeNationalTimetable,
  type NationalTimetableState,
} from '../services/nationalTimetable';

/**
 * Karta pobrania ogólnopolskiego rozkładu kolejowego: pojawia się w wynikach
 * wyszukiwania tras, gdy cel wymaga pociągu, a baza `polska` jej nie ma.
 * Po pobraniu znika (rodzic przeładowuje wyniki), a planer od razu liczy
 * nogę kolejową.
 */
export function IntercityDownloadCard({ onReady }: { onReady?: () => void }) {
  const s = useStrings();
  const [state, setState] = useState<NationalTimetableState>(getNationalTimetableState());
  const [sizeMb, setSizeMb] = useState<string | null>(null);

  useEffect(() => subscribeNationalTimetable(setState), []);

  useEffect(() => {
    let alive = true;
    void nationalTimetableSizeMb().then((mb) => {
      if (alive && mb) setSizeMb(mb);
    });
    return () => {
      alive = false;
    };
  }, []);

  // Gotowa baza: karta znika, rodzic dostaje sygnał do ponownego wyszukiwania.
  useEffect(() => {
    if (state.phase === 'ready') onReady?.();
  }, [state.phase, onReady]);

  if (state.phase === 'ready') return null;

  const downloading = state.phase === 'downloading';
  const failed = state.phase === 'error';
  const busy = state.phase === 'checking' || downloading;

  return (
    <Animated.View
      entering={FadeIn.duration(180)}
      exiting={FadeOut.duration(180)}
      style={styles.card}
      accessibilityRole="alert"
      accessibilityLabel={`${s.intercity.downloadTitle}. ${s.intercity.downloadBody}`}
    >
      <View style={styles.topRow}>
        <View style={styles.iconWrap}>
          <Train size={22} color={scheme.onSecondaryContainer} />
        </View>
        <View style={styles.titleWrap}>
          <Text style={styles.title}>{s.intercity.downloadTitle}</Text>
          {sizeMb && !downloading ? <Text style={styles.size}>{s.intercity.downloadSize(sizeMb)}</Text> : null}
        </View>
      </View>

      <Text style={styles.body}>{failed ? s.intercity.downloadFailed : s.intercity.downloadBody}</Text>

      {downloading ? (
        <View style={styles.progressWrap} accessibilityLabel={s.intercity.downloading}>
          <View style={styles.progressTrack}>
            <Animated.View
              style={[styles.progressFill, { width: `${Math.round(Math.max(0.02, state.progress) * 100)}%` }]}
            />
          </View>
          <Text style={styles.progressText}>
            {s.intercity.downloading} {Math.round(Math.max(0, state.progress) * 100)}%
          </Text>
        </View>
      ) : (
        <Pressable
          onPress={() => void downloadNationalTimetable()}
          disabled={busy}
          style={({ pressed }) => [styles.cta, pressed && { opacity: 0.85 }, busy && { opacity: 0.7 }]}
          accessibilityRole="button"
          accessibilityLabel={s.intercity.downloadCta}
        >
          {busy ? (
            <ActivityIndicator size="small" color={scheme.onPrimary} />
          ) : (
            <Download size={16} color={scheme.onPrimary} />
          )}
          <Text style={styles.ctaText}>{s.intercity.downloadCta}</Text>
        </Pressable>
      )}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  card: {
    marginTop: 12,
    padding: 18,
    gap: 14,
    backgroundColor: scheme.surfaceContainerLow,
    borderRadius: shape.extraLarge,
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  iconWrap: {
    width: 44,
    height: 44,
    borderRadius: shape.full,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: scheme.secondaryContainer,
  },
  titleWrap: {
    flex: 1,
    gap: 2,
  },
  title: {
    ...type.titleMedium,
    fontWeight: '500',
    color: scheme.onSurface,
  },
  size: {
    ...type.bodySmall,
    color: scheme.onSurfaceVariant,
  },
  body: {
    ...type.bodyMedium,
    color: scheme.onSurfaceVariant,
    lineHeight: 20,
  },
  progressWrap: {
    gap: 8,
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
  progressText: {
    ...type.bodySmall,
    color: scheme.onSurfaceVariant,
  },
  cta: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: scheme.primary,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: shape.full,
    minHeight: 44,
  },
  ctaText: {
    ...type.labelLarge,
    color: scheme.onPrimary,
    fontWeight: '600',
  },
});
