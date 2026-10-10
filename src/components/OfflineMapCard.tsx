// Karta „Mapa offline” w Ustawieniach: pobierz albo usuń zestaw kafelków
// Wrocławia. Bez pobrania mapa działa tylko online, więc karta jest opcjonalna,
// ale to jedyne miejsce, z którego użytkownik może włączyć tryb offline.

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
import {
  deleteOfflineMap,
  downloadOfflineMap,
  hasOfflineMap,
  type OfflineMapProgress,
} from '../services/offlineMap';

export function OfflineMapCard() {
  const s = useStrings();
  const [ready, setReady] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);

  const refresh = useCallback(async () => {
    setReady(await hasOfflineMap());
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const handleDownload = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    setProgress(0);
    try {
      const ok = await downloadOfflineMap((p: OfflineMapProgress) => setProgress(p.progress));
      if (!ok) Alert.alert(s.settings.offlineMapFailTitle, s.settings.offlineMapFailBody);
      await refresh();
    } catch {
      Alert.alert(s.settings.offlineMapFailTitle, s.settings.offlineMapFailBody);
    } finally {
      setBusy(false);
    }
  }, [busy, refresh, s]);

  const handleDelete = useCallback(() => {
    Alert.alert(s.settings.offlineMapDeleteTitle, s.settings.offlineMapDeleteBody, [
      { text: s.common.cancel, style: 'cancel' },
      {
        text: s.settings.offlineMapDelete,
        style: 'destructive',
        onPress: () => {
          void (async () => {
            await deleteOfflineMap();
            await refresh();
          })();
        },
      },
    ]);
  }, [refresh, s]);

  const pct = Math.round(progress * 100);

  return (
    <View style={styles.card}>
      <View style={styles.top}>
        <View style={styles.iconWrap}>
          <MapPinned size={18} color={scheme.primary} />
        </View>
        <View style={styles.titleWrap}>
          <Text style={styles.title}>{s.settings.offlineMapTitle}</Text>
          <Text style={styles.hint}>
            {ready ? s.settings.offlineMapReady : s.settings.offlineMapHint}
          </Text>
        </View>
      </View>

      {busy ? (
        <View style={styles.progressRow}>
          <ActivityIndicator size="small" color={scheme.primary} />
          <Text style={styles.progressText}>{s.settings.offlineMapDownloading(pct)}</Text>
        </View>
      ) : (
        <View style={styles.actions}>
          <Pressable
            onPress={() => void handleDownload()}
            style={({ pressed }) => [styles.primaryBtn, pressed && { opacity: 0.85 }]}
            accessibilityRole="button"
            accessibilityLabel={s.settings.offlineMapDownloadA11y}
          >
            <Download size={16} color={scheme.onPrimary} />
            <Text style={styles.primaryText}>
              {ready ? s.settings.offlineMapRefresh : s.settings.offlineMapDownload}
            </Text>
          </Pressable>
          {ready ? (
            <Pressable
              onPress={handleDelete}
              style={({ pressed }) => [styles.deleteBtn, pressed && { opacity: 0.85 }]}
              accessibilityRole="button"
              accessibilityLabel={s.settings.offlineMapDeleteA11y}
            >
              <Trash2 size={16} color={scheme.error} />
            </Pressable>
          ) : null}
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
  deleteBtn: {
    width: 44,
    height: 44,
    borderRadius: shape.full,
    backgroundColor: scheme.surfaceContainerHighest,
    alignItems: 'center',
    justifyContent: 'center',
  },
});

export default OfflineMapCard;