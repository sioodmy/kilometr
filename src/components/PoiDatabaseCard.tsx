import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { Download, MapPin, Trash2 } from './icons';
import { hasPoiDatabase } from '../cities';
import { useStrings } from '../i18n';
import { useActiveCity } from '../services/cityStore';
import {
  deleteCityPoiDb,
  downloadCityPoiDb,
  ensureCityPoiDb,
  getPoiDbState,
  subscribePoiDbState,
  type PoiDbState,
} from '../services/poiSync';
import { scheme, shape, type } from '../theme/tokens';

/**
 * Karta lokalnej bazy POI aktywnego miasta w Ustawieniach (sekcja offline):
 * pobieranie, sprawdzanie aktualizacji i usuwanie osobnej bazy miejsc z R2.
 */
export function PoiDatabaseCard({ deferLoad = false }: { deferLoad?: boolean } = {}) {
  const s = useStrings();
  const { cityId } = useActiveCity();
  const supported = hasPoiDatabase(cityId);
  const [state, setState] = useState<PoiDbState>(() => getPoiDbState(cityId));

  useEffect(() => {
    setState(getPoiDbState(cityId));
    const unsub = subscribePoiDbState((updatedCity, nextState) => {
      if (updatedCity === cityId) setState(nextState);
    });
    if (supported && !deferLoad) {
      void ensureCityPoiDb(cityId).catch(() => {});
    }
    return unsub;
  }, [cityId, deferLoad, supported]);

  const handleDelete = useCallback(() => {
    Alert.alert(s.settings.poiDbDeleteTitle, s.settings.poiDbDeleteBody, [
      { text: s.common.cancel, style: 'cancel' },
      {
        text: s.settings.poiDbDeleteConfirm,
        style: 'destructive',
        onPress: () => {
          void deleteCityPoiDb(cityId);
        },
      },
    ]);
  }, [cityId, s]);

  if (!supported) return null;

  const cityName = s.city.name(cityId);
  const cityGen = s.city.gen(cityId);
  const ready = state.phase === 'ready';
  const downloading = state.phase === 'downloading';
  const checking = state.phase === 'checking';
  const busy = downloading || checking;
  const pct = downloading ? Math.round(state.progress * 100) : 0;

  const statusText = downloading
    ? s.settings.poiDbDownloading(pct)
    : checking
      ? s.settings.poiDbChecking
      : ready
        ? `${s.settings.poiDbReady(state.count)}${state.sizeBytes ? ` (${Math.max(1, Math.round(state.sizeBytes / 1048576))} MB)` : ''}`
        : state.phase === 'error'
          ? s.settings.poiDbError
          : s.settings.poiDbEmpty;

  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <View style={styles.iconWrap}>
          <MapPin size={18} color={scheme.primary} />
        </View>
        <View style={styles.titleWrap}>
          <Text style={styles.cardTitle}>{s.settings.poiDbTitle(cityName)}</Text>
          <Text style={styles.settingHint}>{s.settings.poiDbHint(cityGen)}</Text>
        </View>
      </View>

      <Text style={[styles.statusText, state.phase === 'error' && styles.errorText]}>
        {statusText}
      </Text>

      {downloading && (
        <View style={styles.progressTrack} accessibilityLabel={s.settings.poiDbDownloading(pct)}>
          <View
            style={[
              styles.progressFill,
              { width: `${Math.round(Math.max(0.02, state.progress) * 100)}%` },
            ]}
          />
        </View>
      )}

      <View style={styles.actions}>
        <Pressable
          onPress={() => void downloadCityPoiDb(cityId)}
          disabled={busy}
          accessibilityRole="button"
          accessibilityLabel={ready ? s.settings.poiDbCheck : s.settings.poiDbDownload}
          accessibilityState={{ busy, disabled: busy }}
          style={({ pressed }) => [
            ready ? styles.checkBtn : styles.downloadBtn,
            styles.mainBtn,
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
              ? s.settings.poiDbDownloading(pct)
              : checking
                ? s.settings.poiDbChecking
                : ready
                  ? s.settings.poiDbCheck
                  : s.settings.poiDbDownload}
          </Text>
        </Pressable>

        {ready && !busy && (
          <Pressable
            onPress={handleDelete}
            accessibilityRole="button"
            accessibilityLabel={s.settings.poiDbDelete}
            style={({ pressed }) => [styles.deleteBtn, pressed && { opacity: 0.7 }]}
          >
            <Trash2 size={18} color={scheme.error} />
          </Pressable>
        )}
      </View>
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
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
  },
  iconWrap: {
    width: 36,
    height: 36,
    borderRadius: shape.medium,
    backgroundColor: scheme.surfaceContainerHigh,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
  },
  titleWrap: {
    flex: 1,
    gap: 4,
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
  errorText: {
    color: scheme.error,
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
    alignItems: 'center',
    gap: 10,
  },
  mainBtn: {
    flex: 1,
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
    paddingHorizontal: 14,
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
    paddingHorizontal: 14,
  },
  checkText: {
    ...type.labelLarge,
    color: scheme.onSurfaceVariant,
    fontWeight: '600',
    flexShrink: 1,
    textAlign: 'center',
  },
  deleteBtn: {
    width: 52,
    height: 52,
    borderRadius: shape.medium,
    backgroundColor: scheme.surfaceContainerHighest,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnDisabled: {
    backgroundColor: scheme.surfaceContainerHigh,
    opacity: 0.6,
  },
});
