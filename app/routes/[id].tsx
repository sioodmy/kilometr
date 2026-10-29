import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
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
} from '../../src/components/icons';
import { scheme, shape, type } from '../../src/theme/tokens';
import { defaultLocationForCity } from '../../src/config';
import { getActiveCityIdSync } from '../../src/services/cityStore';
import { useStrings } from '../../src/i18n';
import { RoutingService } from '../../src/services';
import { getPlannedConnection } from '../../src/services/api';
import {
  normalizeConnectionId,
  stableConnectionId,
} from '../../src/services/routing/connectionIdentity';
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
import { DepartureAlarmSheet } from '../../src/components/DepartureAlarmSheet';
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
  const goBack = () => (router.canGoBack() ? router.back() : router.replace('/routes'));
  const { id: routeId } = useLocalSearchParams<{ id: string }>();
  const id = normalizeConnectionId(routeId ?? '');
  const { trip: trackedTrip } = useTrackedTrip();
  const cachedItem = getTrackedTripSync()?.connection;
  const alarmItem = getDepartureAlarmSync()?.connection;

  const isTrackedThis = useMemo(() => {
    if (!trackedTrip) return false;
    const trackedId = trackedTrip.id ? normalizeConnectionId(trackedTrip.id) : '';
    const trackedConnId = trackedTrip.connection.id
      ? normalizeConnectionId(trackedTrip.connection.id)
      : '';
    if (trackedId === id || trackedConnId === id) return true;
    try {
      if (normalizeConnectionId(stableConnectionId(trackedTrip.connection)) === id) return true;
    } catch {
      // ignore
    }
    return false;
  }, [trackedTrip, id]);

  const immediateItem =
    cachedItem?.id === id
      ? cachedItem
      : alarmItem?.id === id
        ? alarmItem
        : getPlannedConnection(String(id));
  const [loadedItem, setItem] = useState<Connection | null>(() => immediateItem ?? null);
  const [offline, setOffline] = useState(false);
  const [liveStale, setLiveStale] = useState(() => liveTracker.getLiveState() !== 'fresh');
  const rawItem = isTrackedThis
    ? trackedTrip.connection
    : loadedItem?.id === id
      ? loadedItem
      : (immediateItem ?? null);
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
    () =>
      rawItem
        ? (applyLiveDelays(
            [rawItem],
            offline || liveStale ? new Map() : liveTracker.getTripDelays(),
          )[0] ?? null)
        : null,
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

  useEffect(() => {
    if (isTrackedThis && trackedTrip?.connection) {
      setItem(trackedTrip.connection);
    }
  }, [isTrackedThis, trackedTrip?.connection]);

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
      const ok = !areNotificationsSupported() || (await ensureNotificationPermission());
      if (!ok) {
        Alert.alert(s.routes.notifOffTitle, permissionDeniedMessage());
        return;
      }
      let protectionEnabled = hasTransfers && isTransferProtectionSupported();
      if (protectionEnabled) {
        let permission = await Location.getForegroundPermissionsAsync();
        if (!permission.granted) permission = await Location.requestForegroundPermissionsAsync();
        protectionEnabled =
          permission.granted &&
          permission.android?.accuracy !== 'coarse' &&
          permission.ios?.accuracy !== 'reduced';
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
        anchorStopId: firstLeg?.fromStopId,
        anchorStopLat: firstLeg?.fromLat,
        anchorStopLon: firstLeg?.fromLon,
        connection: item,
        startedAt: Date.now(),
        protectionEnabled,
      });
    } catch {
      Alert.alert(s.transferGuard.title, s.transferGuard.routingError);
    } finally {
      setTrackingBusy(false);
    }
  };

  // Cache po id po\u0142\u0105czenia z wyszukiwania
  useEffect(() => {
    if (immediateItem) return;
    RoutingService.getCachedConnection(id)
      .then((c) => {
        if (c) {
          setItem(c);
        } else {
          setLoadFailed(true);
        }
      })
      .catch(() => {
        setOffline(true);
        setLoadFailed(true);
      });
  }, [id, immediateItem]);

  const noLegs = item && (!item.legs || item.legs.length === 0);
  const dataNote = useMemo(() => {
    if (offline) return s.offline.cachedBadge;
    if (liveStale) return s.connectionCard.liveFeedStale;
    return null;
  }, [offline, liveStale, s]);

  if (loadFailed && !item) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.header}>
          <Pressable
            onPress={goBack}
            accessibilityRole="button"
            accessibilityLabel={s.common.back}
            style={styles.backBtn}
          >
            <ChevronLeft size={24} color={scheme.onSurface} />
          </Pressable>
          <Text style={styles.headerTitle}>{s.routeDetails.title}</Text>
          <View style={styles.headerRight} />
        </View>
        <View style={styles.center}>
          <RouteOff size={48} color={scheme.onSurfaceVariant} />
          <Text style={styles.errorTitle}>{s.routeDetails.routeNotFound}</Text>
          <Text style={styles.errorText}>
            {offline ? s.routeDetails.routeNotFoundOffline : s.routeDetails.routeNotFoundOnline}
          </Text>
          <Pressable onPress={goBack} style={styles.retryBtn}>
            <Text style={styles.retryText}>{s.routeDetails.backToList}</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  if (!item) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.header}>
          <Pressable
            onPress={goBack}
            accessibilityRole="button"
            accessibilityLabel={s.common.back}
            style={styles.backBtn}
          >
            <ChevronLeft size={24} color={scheme.onSurface} />
          </Pressable>
          <Text style={styles.headerTitle}>{s.routeDetails.title}</Text>
          <View style={styles.headerRight} />
        </View>
        <View style={styles.center}>
          <ActivityIndicator size="large" color={scheme.primary} />
          <Text style={styles.loadingText}>{s.routeDetails.loading}</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Pressable
          onPress={goBack}
          accessibilityRole="button"
          accessibilityLabel={s.common.back}
          style={({ pressed }) => [styles.backBtn, pressed && { opacity: 0.7 }]}
          hitSlop={8}
        >
          <ChevronLeft size={24} color={scheme.onSurface} />
        </Pressable>
        <Text style={styles.headerTitle} numberOfLines={1}>
          {s.routeDetails.title}
        </Text>
        <View style={styles.headerRight}>
          {item && (
            <Pressable
              onPress={() => setSharing(true)}
              accessibilityRole="button"
              accessibilityLabel={s.share.title}
              style={({ pressed }) => [styles.trackBtn, pressed && { opacity: 0.7 }]}
            >
              <Share2 size={21} color={scheme.onSurfaceVariant} />
            </Pressable>
          )}
          {item.legs.some((leg) => leg.mode !== 'walk') && (
            <Pressable
              onPress={() => setAlarmOpen(true)}
              accessibilityRole="button"
              onFocus={() => setAlarmFocused(true)}
              onBlur={() => setAlarmFocused(false)}
              accessibilityState={{ selected: currentAlarm != null }}
              accessibilityLabel={
                currentAlarm
                  ? `${s.alarm.edit}. ${s.alarm.ringsAt(currentAlarm.time)}`
                  : s.alarm.set
              }
              style={({ pressed }) => [
                styles.trackBtn,
                currentAlarm && styles.trackBtnActive,
                pressed && { opacity: 0.75 },
                alarmFocused && styles.alarmFocused,
              ]}
            >
              <AlarmClock
                size={21}
                color={currentAlarm ? scheme.onPrimaryContainer : scheme.onSurfaceVariant}
              />
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
            />
          </Pressable>
        </View>
      </View>

      <ScrollView
        contentContainerStyle={styles.body}
        showsVerticalScrollIndicator={false}
        overScrollMode="never"
      >
        <ConnectionSummary item={item} offline={offline} />
        {dataNote && (
          <View style={styles.offlineBanner}>
            <CloudOff size={16} color={scheme.onSurfaceVariant} />
            <Text style={styles.offlineBannerText}>{dataNote}</Text>
          </View>
        )}

        {noLegs ? (
          <View style={styles.emptyCard}>
            <RouteOff size={20} color={scheme.onSurfaceVariant} />
            <Text style={styles.emptyTitle}>{s.routeDetails.noTrip}</Text>
            <Text style={styles.emptyText}>{s.routeDetails.noTripBody}</Text>
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
              <TransferProtectionCard
                state={isTrackedThis ? trackedTrip.transfer : undefined}
                active={isTrackedThis && trackedTrip.protectionEnabled === true}
                busy={trackingBusy}
                onToggle={(val) => void toggleTracking(val)}
                onOpenDetails={openTransferProtection}
              />
            )}
            <ConnectionLineAlerts
              lines={item.legs.map((l) => l.line).filter(Boolean) as string[]}
            />
          </>
        )}
      </ScrollView>
      {item && (
        <ShareConnectionSheet
          connection={item}
          visible={sharing}
          onClose={() => setSharing(false)}
        />
      )}
      {item && (
        <DepartureAlarmSheet
          connection={item}
          visible={alarmOpen}
          onClose={() => setAlarmOpen(false)}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: scheme.surface,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 8,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: scheme.outlineVariant,
  },
  headerTitle: {
    flex: 1,
    textAlign: 'center',
    fontSize: type.titleMedium.fontSize,
    fontFamily: type.titleMedium.fontFamily,
    color: scheme.onSurface,
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  backBtn: {
    padding: 8,
    borderRadius: shape.cornerFull,
  },
  trackBtn: {
    padding: 8,
    borderRadius: shape.cornerFull,
  },
  trackBtnActive: {
    backgroundColor: scheme.primaryContainer,
  },
  alarmFocused: {
    outlineWidth: 2,
    outlineColor: scheme.primary,
  },
  body: {
    padding: 16,
    gap: 16,
  },
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
    gap: 12,
  },
  loadingText: {
    fontSize: type.bodyMedium.fontSize,
    fontFamily: type.bodyMedium.fontFamily,
    color: scheme.onSurfaceVariant,
  },
  errorTitle: {
    fontSize: type.titleMedium.fontSize,
    fontFamily: type.titleMedium.fontFamily,
    color: scheme.onSurface,
    textAlign: 'center',
  },
  errorText: {
    fontSize: type.bodyMedium.fontSize,
    fontFamily: type.bodyMedium.fontFamily,
    color: scheme.onSurfaceVariant,
    textAlign: 'center',
  },
  retryBtn: {
    backgroundColor: scheme.primary,
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: shape.cornerFull,
    marginTop: 8,
  },
  retryText: {
    color: scheme.onPrimary,
    fontSize: type.labelLarge.fontSize,
    fontFamily: type.labelLarge.fontFamily,
  },
  emptyCard: {
    padding: 24,
    alignItems: 'center',
    backgroundColor: scheme.surfaceContainer,
    borderRadius: shape.cornerMedium,
    gap: 8,
  },
  emptyTitle: {
    fontSize: type.titleMedium.fontSize,
    fontFamily: type.titleMedium.fontFamily,
    color: scheme.onSurface,
  },
  emptyText: {
    fontSize: type.bodyMedium.fontSize,
    fontFamily: type.bodyMedium.fontFamily,
    color: scheme.onSurfaceVariant,
    textAlign: 'center',
  },
  offlineBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    padding: 12,
    backgroundColor: scheme.surfaceContainerHigh,
    borderRadius: shape.cornerMedium,
  },
  offlineBannerText: {
    fontSize: type.bodySmall.fontSize,
    fontFamily: type.bodySmall.fontFamily,
    color: scheme.onSurfaceVariant,
    flex: 1,
  },
});
