// Karta „Mapa offline” w Ustawieniach: pobierz albo usuń zestaw kafelków
// aktywnego miasta. Bez pobrania mapa działa tylko online. Po udanym pobraniu
// nie ma przycisku „pobierz ponownie” (limit R2: raz na miesiąc, per miasto).
// Pakiety innych miast są niżej, z osobnym usuwaniem.

import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { Download, MapPinned, Trash2 } from './icons';
import { scheme, shape, type } from '../theme/tokens';
import { useStrings } from '../i18n';
import { useActiveCity } from '../services/cityStore';
import { getMapDownloadGate, remainingDays } from '../services/downloadLimits';
import {
  deleteOfflineMap,
  downloadOfflineMap,
  getOfflineMapState,
  listDownloadedMaps,
  type DownloadedMap,
  type OfflineMapProgress,
  type OfflineMapState,
} from '../services/offlineMap';

export function OfflineMapCard() {
  const s = useStrings();
  const { cityId, city } = useActiveCity();
  const cityName = s.city.name(cityId);
  // Dopełniacz ("mapy Krakowa", "na telefonie"), nie mianownik: te teksty
  // wchodzą w dopełnienie albo są rzeczownikiem w locacji.
  const cityGen = s.city.gen(cityId);
  const [state, setState] = useState<OfflineMapState | null>(null);
  const [otherMaps, setOtherMaps] = useState<DownloadedMap[]>([]);
  const [cooldownMs, setCooldownMs] = useState(0);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);

  const refresh = useCallback(async () => {
    const [mapState, others, gate] = await Promise.all([
      getOfflineMapState(cityId),
      listDownloadedMaps(cityId),
      getMapDownloadGate(cityId),
    ]);
    setState(mapState);
    setOtherMaps(others);
    setCooldownMs(gate.allowed ? 0 : gate.retryAfterMs);
  }, [cityId]);

  useEffect(() => {
    setState(null);
    setBusy(false);
    setProgress(0);
    void refresh();
  }, [refresh]);

  const handleDownload = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    setProgress(0);
    try {
      const result = await downloadOfflineMap(
        (p: OfflineMapProgress) => setProgress(p.progress),
        cityId,
      );
      if (result.ok) {
        await refresh();
        return;
      }
      if (result.reason === 'cooldown') {
        Alert.alert(
          s.settings.offlineMapCooldownTitle,
          s.settings.offlineMapCooldownBody(remainingDays(result.retryAfterMs)),
        );
      } else if (result.reason === 'invalid') {
        Alert.alert(s.settings.offlineMapFailTitle, s.settings.offlineMapInvalidDownload);
      } else {
        Alert.alert(s.settings.offlineMapFailTitle, s.settings.offlineMapFailBody);
      }
      await refresh();
    } catch {
      Alert.alert(s.settings.offlineMapFailTitle, s.settings.offlineMapFailBody);
    } finally {
      setBusy(false);
    }
  }, [busy, refresh, s, cityId]);

  const handleDelete = useCallback(() => {
    const invalid = state === 'invalid';
    Alert.alert(
      s.settings.offlineMapDeleteTitle,
      s.settings.offlineMapDeleteBody(city.tilePackMB, invalid),
      [
        { text: s.common.cancel, style: 'cancel' },
        {
          text: s.settings.offlineMapDelete,
          style: 'destructive',
          onPress: () => {
            void (async () => {
              await deleteOfflineMap(cityId);
              await refresh();
            })();
          },
        },
      ],
    );
  }, [city.tilePackMB, cityId, refresh, s, state]);

  const handleDeleteOther = useCallback(
    (entry: DownloadedMap) => {
      Alert.alert(
        s.settings.offlineMapDeleteTitle,
        s.settings.offlineMapDeleteBody(entry.sizeMB, entry.invalid),
        [
          { text: s.common.cancel, style: 'cancel' },
          {
            text: s.settings.offlineMapDelete,
            style: 'destructive',
            onPress: () => {
              void (async () => {
                await deleteOfflineMap(entry.cityId);
                await refresh();
              })();
            },
          },
        ],
      );
    },
    [refresh, s],
  );

  const pct = Math.round(progress * 100);
  const ready = state === 'ready';
  const invalid = state === 'invalid';
  const blocked = !ready && !invalid && cooldownMs > 0;

  return (
    <View style={styles.card}>
      <View style={styles.top}>
        <View style={styles.iconWrap}>
          <MapPinned size={18} color={scheme.primary} />
        </View>
        <View style={styles.titleWrap}>
          <Text style={styles.title}>{s.settings.offlineMapTitle(cityName)}</Text>
          <Text style={styles.hint}>
            {ready
              ? s.settings.offlineMapReady(cityGen)
              : invalid
                ? s.settings.offlineMapInvalid(cityGen)
                : blocked
                  ? s.settings.offlineMapCooldownBody(remainingDays(cooldownMs))
                  : s.settings.offlineMapHint(cityGen, city.tilePackMB)}
          </Text>
        </View>
      </View>

      {busy ? (
        <View style={styles.progressRow}>
          <ActivityIndicator size="small" color={scheme.primary} />
          <Text style={styles.progressText}>{s.settings.offlineMapDownloading(pct)}</Text>
        </View>
      ) : ready || invalid ? (
        <View style={styles.actions}>
          <Pressable
            onPress={handleDelete}
            style={({ pressed }) => [styles.deleteBtnWide, pressed && { opacity: 0.85 }]}
            accessibilityRole="button"
            accessibilityLabel={s.settings.offlineMapDeleteA11y}
          >
            <Trash2 size={16} color={scheme.error} />
            <Text style={styles.deleteText}>{s.settings.offlineMapDelete}</Text>
          </Pressable>
        </View>
      ) : blocked ? null : (
        <View style={styles.actions}>
          <Pressable
            onPress={() => void handleDownload()}
            style={({ pressed }) => [styles.primaryBtn, pressed && { opacity: 0.85 }]}
            accessibilityRole="button"
            accessibilityLabel={s.settings.offlineMapDownloadA11y(cityGen)}
          >
            <Download size={16} color={scheme.onPrimary} />
            <Text style={styles.primaryText}>{s.settings.offlineMapDownload}</Text>
          </Pressable>
        </View>
      )}

      {otherMaps.length > 0 ? (
        <View style={styles.others}>
          <Text style={styles.othersTitle}>{s.settings.offlineMapOthersTitle}</Text>
          <Text style={styles.othersHint}>{s.settings.offlineMapOthersHint}</Text>
          {otherMaps.map((entry) => {
            const name = s.city.name(entry.cityId);
            return (
              <View key={entry.cityId} style={styles.otherRow}>
                <View style={styles.otherInfo}>
                  <Text style={styles.otherName} numberOfLines={1}>
                    {name}
                  </Text>
                  <Text style={[styles.otherMeta, entry.invalid && styles.otherInvalid]}>
                    {entry.invalid
                      ? s.settings.offlineMapInvalidShort
                      : s.settings.offlineMapSize(entry.sizeMB)}
                  </Text>
                </View>
                <Pressable
                  onPress={() => handleDeleteOther(entry)}
                  style={({ pressed }) => [styles.otherDelete, pressed && { opacity: 0.85 }]}
                  accessibilityRole="button"
                  accessibilityLabel={s.settings.offlineMapDeleteCityA11y(name)}
                >
                  <Trash2 size={16} color={scheme.error} />
                </Pressable>
              </View>
            );
          })}
        </View>
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
  top: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  iconWrap: {
    width: 36,
    height: 36,
    borderRadius: shape.full,
    backgroundColor: scheme.secondaryContainer,
    alignItems: 'center',
    justifyContent: 'center',
  },
  titleWrap: { flex: 1, minWidth: 0 },
  title: { ...type.titleSmall, color: scheme.onSurface },
  hint: { ...type.bodyMedium, color: scheme.onSurfaceVariant, lineHeight: 21 },
  progressRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  progressText: { ...type.labelMedium, color: scheme.onSurfaceVariant },
  actions: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  primaryBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: scheme.primary,
    borderRadius: shape.medium,
    minHeight: 52,
    padding: 14,
  },
  primaryText: {
    ...type.labelLarge,
    fontWeight: '500',
    color: scheme.onPrimary,
    flexShrink: 1,
    textAlign: 'center',
  },
  deleteBtnWide: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    minHeight: 52,
    padding: 14,
    borderRadius: shape.medium,
    backgroundColor: scheme.surfaceContainerHighest,
  },
  deleteText: {
    ...type.labelLarge,
    fontWeight: '500',
    color: scheme.error,
    flexShrink: 1,
    textAlign: 'center',
  },
  others: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: scheme.outlineVariant,
    paddingTop: 14,
    gap: 4,
  },
  othersTitle: { ...type.labelLarge, color: scheme.onSurface },
  othersHint: { ...type.bodySmall, color: scheme.onSurfaceVariant, lineHeight: 18 },
  otherRow: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 52 },
  otherInfo: { flex: 1, minWidth: 0 },
  otherName: { ...type.bodyMedium, color: scheme.onSurface },
  otherMeta: { ...type.labelSmall, color: scheme.onSurfaceVariant },
  otherInvalid: { color: scheme.error },
  otherDelete: {
    width: 44,
    height: 44,
    borderRadius: shape.full,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: scheme.surfaceContainerHighest,
  },
});
