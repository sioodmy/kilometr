import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import * as Location from 'expo-location';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  ChevronLeft,
  AlarmClock,
  CloudOff,
  Pin,
  RouteOff,
  Share2,
} from 'lucide-react-native';
import { scheme, shape, type } from '../../src/theme/tokens';
import { defaultLocationForCity } from '../../src/config';
import { getActiveCityIdSync } from '../../src/services/cityStore';
import { useStrings } from '../../src/i18n';
import { RoutingService } from '../../src/services';
import { getPlannedConnection } from '../../src/services/api';
import { normalizeConnectionId } from '../../src/services/routing/connectionIdentity';
import { applyLiveDelays } from '../../src/services/routing/engine';
import { liveTracker } from '../../src/services/liveTracker';
import type { Connection } from '../../src/types/models';
import { ConnectionLineAlerts } from '../../src/components/ConnectionLineAlerts';
import { LegTimeline } from '../../src/components/LegTimeline';
import { ConnectionSummary } from '../../src/components/ConnectionSummary';
import { ShareConnectionSheet } from '../../src/components/ShareConnectionSheet';
import { RouteMapCard } from '../../src/components/RouteMapCard';
import { TransferProtectionCard } from '../../src/components/TransferProtectionCard';
import { useTransferProtection } from '../../src/components/TransferProtectionProvider';
import { hasTransfer } from '../../src/services/notifications/transferTypes';
import { DepartureAlarmDialog } from '../../src/components/DepartureAlarmDialog';
import { getDepartureAlarmSync, useDepartureAlarm } from '../../src/services/departureAlarm';
import {
  areNotificationsSupported,
  ensureNotificationPermission,
  getTrackedTripSync,
  permissionDeniedMessage,
  startTracking,
  stopTracking,
  useTrackedTrip,
  isTransferProtectionSupported,
} from '../../src/services/notifications';

export default function RouteDetailsScreen() {
  const s = useStrings();
  const router = useRouter();
  const openTransferProtection = useTransferProtection();
  const goBack = () => router.canGoBack() ? router.back() : router.replace('/routes');
  const { id: routeId } = useLocalSearchParams<{ id: string }>();
  const id = normalizeConnectionId(routeId ?? '');
  const { trip: trackedTrip } = useTrackedTrip();
  const cachedItem = getTrackedTripSync()?.connection;
  const alarmItem = getDepartureAlarmSync()?.connection;
  const immediateItem = cachedItem?.id === id ? cachedItem : alarmItem?.id === id ? alarmItem : getPlannedConnection(String(id));
  const [loadedItem, setItem] = useState<Connection | null>(() => immediateItem ?? null);
  const [offline, setOffline] = useState(false);
  const [liveStale, setLiveStale] = useState(() => liveTracker.getLiveState() !== 'fresh');
  const rawItem = trackedTrip?.connection.id === id ? trackedTrip.connection : loadedItem?.id === id ? loadedItem : immediateItem ?? null;
  // Opóźnienia z feedu żyją niezależnie od zamrożonego połączenia: bez
  // tickera karta pokazywałaby wartości z chwili wyszukiwania.
  const [liveTick, setLiveTick] = useState(0);
  const lastLiveOk = useRef(0);
  useEffect(() => {
    const t = setInterval(() => {
      const ok = liveTracker.getLastOk();
      if (ok !== lastLiveOk.current) {
        lastLiveOk.current = ok;
        setLiveTick(ok);
      }
    }, 5000);
    return () => clearInterval(t);
  }, []);
  const item = useMemo(
    () => (rawItem ? (applyLiveDelays([rawItem], offline || liveStale ? new Map() : liveTracker.getTripDelays())[0] ?? null) : null),
    // liveTick wymusza przemapowanie po każdym nowym polli trackera.
    [rawItem, liveTick, offline, liveStale],
  );
  const [trackingBusy, setTrackingBusy] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [alarmOpen, setAlarmOpen] = useState(false);
  const [alarmFocused, setAlarmFocused] = useState(false);
  const alarm = useDepartureAlarm();
  const currentAlarm = alarm?.connectionId === id ? alarm : null;
  // Stan feedu live zmienia się w tle, a ten ekran nie odświeża się sam z
  // powodu danych. Bez tickera baner „brak danych” był zamrożony w stanie z
  // chwili renderu i pojawiał się dopiero przy jakiejś przypadkowej
  // przerysowie całego ekranu.
  useEffect(() => {
    const check = () => setLiveStale(liveTracker.getLiveState() !== 'fresh');
    const t = setInterval(check, 15000);
    return () => clearInterval(t);
  }, []);

  const isTrackedThis = trackedTrip != null && trackedTrip.connection.id === String(id);
  const hasTransfers = item != null && hasTransfer(item);

  // Nagłówek przełącza śledzenie, karta włącza ochronę. Monitor trzyma jedną podróż.
  const toggleTracking = async (enableProtection = false) => {
    if (!item || trackingBusy) return;
    if (isTrackedThis && !enableProtection) {
      await stopTracking();
      return;
    }
    setTrackingBusy(true);
    try {
      if (!areNotificationsSupported() && !hasTransfers) {
        Alert.alert(s.routes.trackUnsupportedTitle, s.routes.trackUnsupportedBody);
        return;
      }
      const ok = !areNotificationsSupported() || await ensureNotificationPermission();
      if (!ok) {
        Alert.alert(s.routes.notifOffTitle, permissionDeniedMessage());
        return;
      }
      let protectionEnabled = hasTransfers && isTransferProtectionSupported();
      if (protectionEnabled) {
        let permission = await Location.getForegroundPermissionsAsync();
        if (!permission.granted) permission = await Location.requestForegroundPermissionsAsync();
        protectionEnabled = permission.granted && permission.android?.accuracy !== 'coarse' && permission.ios?.accuracy !== 'reduced';
        if (!protectionEnabled) {
          Alert.alert(s.transferGuard.title, s.transferGuard.locationRequired, [
            { text: s.common.cancel, style: 'cancel' },
            { text: s.compass.openSettingsA11y, onPress: () => void Linking.openSettings() },
          ]);
          return;
        }
      }
      const firstLeg = item.legs[0];
      const lastLeg = item.legs[item.legs.length - 1];
      const fallback = defaultLocationForCity(getActiveCityIdSync());
      await startTracking({
        id: item.id,
        fromTitle: item.fromTitle,
        fromLat: firstLeg?.fromLat ?? fallback.lat,
        fromLon: firstLeg?.fromLon ?? fallback.lon,
        toId: item.toTitle,
        toTitle: item.toTitle,
        toLat: lastLeg?.toLat ?? fallback.lat,
        toLon: lastLeg?.toLon ?? fallback.lon,
        connection: item,
        startedAt: Date.now(),
        protectionEnabled,
      });
    } catch {
      Alert.alert(s.transferGuard.title, s.transferGuard.routingError);
    } finally { setTrackingBusy(false); }
  };

  useEffect(() => {
    if (trackedTrip?.connection.id === id) setItem(trackedTrip.connection);
  }, [id, trackedTrip?.connection]);

  useEffect(() => {
    // Brak id to nie „wczytujemy” - inaczej ekran zostawał ze spinnerem w nieskończoność.
    if (!id) {
      setLoadFailed(true);
      return;
    }
    setLoadFailed(false);
    setOffline(false);
    if (immediateItem) {
      setItem(immediateItem);
      return;
    }
    let cancelled = false;
    const load = async () => {
      try {
        const hit = await RoutingService.getConnectionById(String(id));
        if (cancelled) return;
        if (hit) {
          setItem(hit.connection);
          setOffline(hit.source === 'cache');
          return;
        }
        setLoadFailed(true);
      } catch (err) {
        console.warn('[RouteDetails] load failed:', err);
        if (!cancelled) setLoadFailed(true);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [id]);

  if (loadFailed) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.header}>
          <Pressable onPress={goBack} style={styles.iconBtn} accessibilityRole="button" accessibilityLabel={s.map.backA11y}>
            <ChevronLeft size={23} color={scheme.onSurface} />
          </Pressable>
          <Text style={styles.headerTitle}>{s.routeDetails.title}</Text>
        </View>
        <View style={styles.loading}>
          <Text style={styles.loadingText}>{s.routeDetails.loadFail}</Text>
          <Pressable
            onPress={goBack}
            accessibilityRole="button"
            style={({ pressed }) => [styles.retryBtn, pressed && { opacity: 0.8 }]}
          >
            <Text style={styles.retryText}>{s.routeDetails.backToList}</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  if (!item) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <View style={styles.header}>
          <Pressable onPress={goBack} style={styles.iconBtn} accessibilityRole="button" accessibilityLabel={s.map.backA11y}>
            <ChevronLeft size={23} color={scheme.onSurface} />
          </Pressable>
          <Text style={styles.headerTitle}>{s.routeDetails.title}</Text>
        </View>
        <View style={styles.loading}>
          <ActivityIndicator color={scheme.primary} />
        </View>
      </SafeAreaView>
    );
  }

  const noLegs = item.legs.length === 0;

  // Treść komunikatu o źródle danych. Kolejność ma znaczenie: połączenie
  // wzięte z dysku jest starsze od czegokolwiek, co pokaże feed live.
  const dataNote = offline
    ? s.routeDetails.offlineNote
    : liveStale
      ? s.routeDetails.noLiveNote
      : null;

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.screen} importantForAccessibility={sharing || alarmOpen ? 'no-hide-descendants' : 'auto'} accessibilityElementsHidden={sharing || alarmOpen}>
      <View style={styles.header}>
        <Pressable onPress={goBack} style={styles.iconBtn} accessibilityRole="button" accessibilityLabel={s.map.backA11y}>
          <ChevronLeft size={23} color={scheme.onSurface} />
        </Pressable>
        <Text style={styles.headerTitle} accessibilityRole="header">
          {s.routeDetails.title}
        </Text>
        {!noLegs && (
          <Pressable onPress={() => setSharing(true)} accessibilityRole="button"
            accessibilityLabel={s.share.title}
            style={({ pressed }) => [styles.trackBtn, pressed && { opacity: 0.7 }]}>
            <Share2 size={21} color={scheme.onSurfaceVariant} />
          </Pressable>
        )}
        {item.legs.some((leg) => leg.mode !== 'walk') && (
          <Pressable onPress={() => setAlarmOpen(true)} accessibilityRole="button"
            onFocus={() => setAlarmFocused(true)} onBlur={() => setAlarmFocused(false)}
            accessibilityState={{ selected: currentAlarm != null }}
            accessibilityLabel={currentAlarm ? `${s.alarm.edit}. ${s.alarm.ringsAt(currentAlarm.time)}` : s.alarm.set}
            style={({ pressed }) => [styles.trackBtn, currentAlarm && styles.trackBtnActive,
              pressed && { opacity: 0.75 }, alarmFocused && styles.alarmFocused]}>
            <AlarmClock size={21} color={currentAlarm ? scheme.onPrimaryContainer : scheme.onSurfaceVariant} />
          </Pressable>
        )}
        <Pressable
          onPress={() => void toggleTracking()}
          disabled={trackingBusy}
          accessibilityRole="button"
          accessibilityState={{ selected: isTrackedThis }}
          accessibilityLabel={
            isTrackedThis ? s.routes.stopTrackingTripA11y : s.routes.trackTripA11y
          }
          style={({ pressed }) => [
            styles.trackBtn,
            isTrackedThis && styles.trackBtnActive,
            pressed && { opacity: 0.7 },
          ]}
          hitSlop={8}
        >
          <Pin
            size={21}
            color={isTrackedThis ? scheme.onPrimaryContainer : scheme.onSurfaceVariant}
            fill={isTrackedThis ? scheme.onPrimaryContainer : 'transparent'}
          />
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false} overScrollMode="never">
        <ConnectionSummary item={item} offline={offline} />
        {dataNote && (
          <View style={styles.offlineBanner}>
            <CloudOff size={16} color={scheme.onSurfaceVariant} strokeWidth={2} />
            <Text style={styles.offlineBannerText}>{dataNote}</Text>
          </View>
        )}

        {noLegs ? (
          <View style={styles.emptyCard}>
            <RouteOff size={20} color={scheme.onSurfaceVariant} strokeWidth={2} />
            <Text style={styles.emptyTitle}>{s.routeDetails.noTrip}</Text>
            <Text style={styles.emptyText}>
              {s.routeDetails.noTripBody}
            </Text>
            <Pressable
              onPress={() => router.back()}
              style={({ pressed }) => [styles.retryBtn, pressed && { opacity: 0.8 }]}
            >
              <Text style={styles.retryText}>{s.routeDetails.backToList}</Text>
            </Pressable>
          </View>
        ) : (
          <>
            <LegTimeline legs={item.legs} />
            <RouteMapCard
              connection={item}
              onOpenMap={() => router.push({ pathname: '/map', params: { id: item.id } })}
            />
            {hasTransfers && (
              <TransferProtectionCard state={isTrackedThis ? trackedTrip.transfer : undefined}
                active={isTrackedThis && trackedTrip.protectionEnabled === true} busy={trackingBusy}
                onPress={() => { if (isTrackedThis && trackedTrip.protectionEnabled) openTransferProtection(); else void toggleTracking(true); }} />
            )}

            <ConnectionLineAlerts connection={item} />
          </>
        )}

        <View style={{ height: 24 }} />
      </ScrollView>
      </View>
      {sharing && <ShareConnectionSheet connection={item} onClose={() => setSharing(false)} />}
      {alarmOpen && <DepartureAlarmDialog connection={item} alarm={alarm} onClose={() => setAlarmOpen(false)} />}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: scheme.surface },
  screen: { flex: 1 },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8 },
  loadingText: { ...type.bodyMedium, color: scheme.onSurfaceVariant },
  retryBtn: {
    backgroundColor: scheme.primary,
    borderRadius: shape.full,
    paddingHorizontal: 20,
    paddingVertical: 12,
    marginTop: 8,
  },
  retryText: { ...type.labelLarge, fontWeight: '700', color: scheme.onPrimary },
  header: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, paddingVertical: 8 },
  iconBtn: { width: 48, height: 48, borderRadius: shape.medium, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { flex: 1, ...type.titleMedium, fontWeight: '500', color: scheme.onSurface },
  trackBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    width: 48,
    height: 48,
    borderRadius: shape.medium,
    backgroundColor: scheme.surfaceContainer,
  },
  trackBtnActive: { backgroundColor: scheme.primaryContainer },
  body: { paddingHorizontal: 16, gap: 18, paddingBottom: 40 },
  alarmFocused: { borderWidth: 2, borderColor: scheme.primary },
  offlineBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: scheme.surfaceContainerLow,
    borderRadius: shape.medium,
    paddingHorizontal: 14,
    paddingVertical: 11,
  },
  offlineBannerText: { ...type.bodySmall, color: scheme.onSurfaceVariant, flex: 1 },
  emptyCard: {
    alignItems: 'center',
    gap: 8,
    backgroundColor: scheme.surfaceContainer,
    borderRadius: shape.large,
    padding: 20,
  },
  emptyTitle: { ...type.titleSmall, fontWeight: '700', color: scheme.onSurface },
  emptyText: { ...type.bodyMedium, color: scheme.onSurfaceVariant, textAlign: 'center' },
});
