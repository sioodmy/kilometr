// Karta „Mapa offline” w Ustawieniach: pobierz albo usuń zestaw kafelków
// aktywnego miasta. Bez pobrania mapa działa tylko online. Po udanym pobraniu
// nie ma przycisku „pobierz ponownie” (limit R2: raz na miesiąc, per miasto).

import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Download, MapPinned, Trash2 } from 'lucide-react-native';
import { elev, scheme, shape, type } from '../theme/tokens';
import { useStrings } from '../i18n';
import { useActiveCity } from '../services/cityStore';
import { getMapDownloadGate, remainingDays } from '../services/downloadLimits';
import {
  deleteOfflineMap,
  downloadOfflineMap,
  hasOfflineMap,
  type OfflineMapProgress,
} from '../services/offlineMap';

export function OfflineMapCard() {
  const s = useStrings();
  const { cityId } = useActiveCity();
  const cityName = s.city.name(cityId);
  // Dopełniacz ("mapy Krakowa", "na telefonie"), nie mianownik: te teksty
  // wchodzą w dopełnienie albo są rzeczownikiem w locacji.
  const cityGen = s.city.gen(cityId);
  const [ready, setReady] = useState<boolean | null>(null);
  const [cooldownMs, setCooldownMs] = useState(0);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);

  const refresh = useCallback(async () => {
    setReady(await hasOfflineMap(cityId));
    const gate = await getMapDownloadGate(cityId);
    setCooldownMs(gate.allowed ? 0 : gate.retryAfterMs);
  }, [cityId]);

  useEffect(() => {
    setReady(null);
    setBusy(false);
    setProgress(0);
    void refresh();
  }, [refresh]);

  const handleDownload = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    setProgress(0);
    try {
      const result = await downloadOfflineMap((p: OfflineMapProgress) => setProgress(p.progress), cityId);
      if (result.ok) {
        await refresh();
        return;
      }
      if (result.reason === 'cooldown') {
        Alert.alert(
          s.settings.offlineMapCooldownTitle,
          s.settings.offlineMapCooldownBody(remainingDays(result.retryAfterMs)),
        );
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
    Alert.alert(s.settings.offlineMapDeleteTitle, s.settings.offlineMapDeleteBody, [
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
    ]);
  }, [refresh, s, cityId]);

  const pct = Math.round(progress * 100);
  const blocked = !ready && cooldownMs > 0;

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
              : blocked
                ? s.settings.offlineMapCooldownBody(remainingDays(cooldownMs))
                : s.settings.offlineMapHint(cityGen)}
          </Text>
        </View>
      </View>

      {busy ? (
        <View style={styles.progressRow}>
          <ActivityIndicator size="small" color={scheme.primary} />
          <Text style={styles.progressText}>{s.settings.offlineMapDownloading(pct)}</Text>
        </View>
      ) : ready ? (
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
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: scheme.surfaceContainer,
    borderRadius: shape.large,
    padding: 16,
    gap: 12,
    ...elev.level1,
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
  hint: { ...type.bodySmall, color: scheme.onSurfaceVariant, lineHeight: 18 },
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
    borderRadius: shape.full,
    height: 44,
  },
  primaryText: { ...type.labelLarge, fontWeight: '700', color: scheme.onPrimary },
  deleteBtnWide: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    height: 44,
    borderRadius: shape.full,
    backgroundColor: scheme.surfaceContainerHighest,
  },
  deleteText: { ...type.labelLarge, fontWeight: '700', color: scheme.error },
});

export default OfflineMapCard;
