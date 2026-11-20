import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  AppState,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import * as Location from 'expo-location';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  AlarmClock,
  ChevronLeft,
  ChevronRight,
  CloudOff,
  Pin,
  RouteOff,
  Share2,
} from '../../src/components/icons';
import { elev, scheme, shape, type } from '../../src/theme/tokens';
import { defaultLocationForCity } from '../../src/config';
import { getActiveCityIdSync } from '../../src/services/cityStore';
import { useStrings } from '../../src/i18n';
import { RoutingService, subscribeSavedRoutes } from '../../src/services';
import * as Haptics from 'expo-haptics';
import { getPlannedConnection } from '../../src/services/api';
import {
  normalizeConnectionId,
  stableConnectionId,
} from '../../src/services/routing/connectionIdentity';
import { useRailLiveConnections } from '../../src/services/useRailLiveConnections';
import { liveTracker } from '../../src/services/liveTracker';
import type { Connection } from '../../src/types/models';
import { ConnectionLineAlerts } from '../../src/components/ConnectionLineAlerts';
import { LegTimeline } from '../../src/components/LegTimeline';
import { ConnectionSummary } from '../../src/components/ConnectionSummary';
import { SpringPressable } from '../../src/components/SpringPressable';
import { ShareConnectionSheet } from '../../src/components/ShareConnectionSheet';
import { RouteMapCard } from '../../src/components/RouteMapCard';
import { RouteTravelDeck } from '../../src/components/RouteTravelDeck';
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
  const { id: routeId, action: routeAction, fromY } = useLocalSearchParams<{
    id: string;
    action?: string;
    fromY?: string;
  }>();
  const cardFromY = fromY ? Number(fromY) : undefined;
  const id = normalizeConnectionId(routeId ?? '');
  const openTicket = routeAction === 'ticket';
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

  const matchesRouteId = useCallback(
    (candidateId?: string | null) => {
      if (!candidateId) return false;
      return candidateId === id || normalizeConnectionId(candidateId) === id;
    },
    [id],
  );

  const immediateItem =
    matchesRouteId(cachedItem?.id)
      ? cachedItem
      : matchesRouteId(alarmItem?.id)
        ? alarmItem
        : getPlannedConnection(String(id));
  const [loadedItem, setItem] = useState<Connection | null>(() => immediateItem ?? null);
  const [offline, setOffline] = useState(false);
  const [liveStale, setLiveStale] = useState(
    () => liveTracker.supportsLive() && liveTracker.getLiveState() !== 'fresh',
  );
  const rawItem =
    isTrackedThis && trackedTrip
      ? trackedTrip.connection
      : matchesRouteId(loadedItem?.id)
        ? loadedItem
        : (immediateItem ?? null);

  // Opóźnienia z feedu żyją niezależnie od zamrożonego połączenia.
  const [liveTick, setLiveTick] = useState(0);
  const lastLiveOk = useRef(0);
  useEffect(() => {
    const check = () => {
      setLiveStale(liveTracker.supportsLive() && liveTracker.getLiveState() !== 'fresh');
      const ok = liveTracker.getLastOk();
      if (ok !== lastLiveOk.current) {
        lastLiveOk.current = ok;
        setLiveTick(ok);
      }
    };
    check();
    const unsub = liveTracker.subscribe(check);
    const t = setInterval(check, 30000);
    return () => {
      unsub();
      clearInterval(t);
    };
  }, []);

  // Po wejściu na ekran lub powrocie z uśpienia wymuszamy świeży poll live.
  useFocusEffect(
    useCallback(() => {
      liveTracker.acquire();
      void liveTracker.refresh();
      const sub = AppState.addEventListener('change', (state) => {
        if (state === 'active') {
          void liveTracker.refresh();
        }
      });
      return () => {
        sub.remove();
        liveTracker.release();
      };
    }, []),
  );
  const rawItems = useMemo(() => (rawItem ? [rawItem] : []), [rawItem]);
  const tripDelays = useMemo(
    () => (offline || liveStale ? new Map<string, number>() : liveTracker.getTripDelays()),
    [offline, liveStale, liveTick],
  );
  const liveItems = useRailLiveConnections(rawItems, tripDelays, !offline);
  const item = liveItems[0] ?? null;
  const [trackingBusy, setTrackingBusy] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [alarmOpen, setAlarmOpen] = useState(false);
  const [alarmFocused, setAlarmFocused] = useState(false);
  const alarm = useDepartureAlarm();
  const currentAlarm = alarm?.connectionId === id ? alarm : null;

  useEffect(() => {
    if (isTrackedThis && trackedTrip?.connection && loadedItem?.id !== trackedTrip.connection.id) {
      setItem(trackedTrip.connection);
    }
  }, [isTrackedThis, trackedTrip?.connection, loadedItem?.id]);

  const hasTransfers = item != null && hasTransfer(item);
  const [isSavedRoute, setIsSavedRoute] = useState(false);

  useEffect(() => {
    if (!item?.id) return;
    let cancelled = false;
    const checkSaved = () => {
      RoutingService.isRouteSaved(item.id)
        .then((saved) => {
          if (!cancelled) setIsSavedRoute(saved);
        })
        .catch(() => {});
    };
    checkSaved();
    const unsub = subscribeSavedRoutes(checkSaved);
    return () => {
      cancelled = true;
      unsub();
    };
  }, [item?.id]);

  const isPinned = isSavedRoute || isTrackedThis;

  const togglePin = async () => {
    if (!item || trackingBusy) return;
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    if (isPinned) {
      try {
        await RoutingService.deleteSavedRoute(item.id);
        setIsSavedRoute(false);
        if (isTrackedThis) {
          await stopTracking();
        }
      } catch (err) {
        console.warn('Failed to unpin route:', err);
      }
    } else {
      try {
        await RoutingService.saveRoute(item);
        setIsSavedRoute(true);
        if (!isTrackedThis && areNotificationsSupported()) {
          void toggleTracking();
        }
      } catch (err) {
        console.warn('Failed to pin route:', err);
      }
    }
  };

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
      Alert.alert(s.routes.trackFailTitle, s.routes.trackFailBody);
    } finally {
      setTrackingBusy(false);
    }
  };

  useEffect(() => {
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
  }, [id, immediateItem]);

  if (loadFailed) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.header}>
          <Pressable
            onPress={goBack}
            style={({ pressed }) => [styles.backBtn, pressed && styles.pressed]}
            accessibilityRole="button"
            accessibilityLabel={s.map.backA11y}
          >
            <ChevronLeft size={22} color={scheme.onSurface} />
          </Pressable>
          <Text style={styles.headerTitle} numberOfLines={1}>
            {s.routeDetails.title}
          </Text>
        </View>
        <View style={styles.stateWrap}>
          <View style={styles.emptyCard}>
            <View style={styles.emptyIconCircle}>
              <RouteOff size={24} color={scheme.onSecondaryContainer} />
            </View>
            <Text style={styles.emptyTitle}>{s.routeDetails.loadFail}</Text>
            <Pressable
              onPress={goBack}
              accessibilityRole="button"
              style={({ pressed }) => [styles.retryBtn, pressed && styles.pressed]}
            >
              <Text style={styles.retryText}>{s.routeDetails.backToList}</Text>
            </Pressable>
          </View>
        </View>
      </SafeAreaView>
    );
  }

  if (!item) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <View style={styles.header}>
          <Pressable
            onPress={goBack}
            style={({ pressed }) => [styles.backBtn, pressed && styles.pressed]}
            accessibilityRole="button"
            accessibilityLabel={s.map.backA11y}
          >
            <ChevronLeft size={22} color={scheme.onSurface} />
          </Pressable>
          <Text style={styles.headerTitle} numberOfLines={1}>
            {s.routeDetails.title}
          </Text>
        </View>
        <View style={styles.stateWrap}>
          <ActivityIndicator size="large" color={scheme.primary} />
        </View>
      </SafeAreaView>
    );
  }

  const noLegs = item.legs.length === 0;
  const hasTransitLeg = item.legs.some((leg) => leg.mode !== 'walk');
  const hasHeaderActions = !noLegs || hasTransitLeg;

  const dataNote = offline
    ? s.routeDetails.offlineNote
    : liveStale && !item.live
      ? s.routeDetails.noLiveNote
      : null;

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View
        style={styles.screen}
        importantForAccessibility={sharing || alarmOpen ? 'no-hide-descendants' : 'auto'}
        accessibilityElementsHidden={sharing || alarmOpen}
      >
        <View style={styles.header}>
          <SpringPressable
            onPress={goBack}
            scaleDelta={0.06}
            style={styles.backBtn}
            accessibilityRole="button"
            accessibilityLabel={s.map.backA11y}
          >
            <ChevronLeft size={22} color={scheme.onSurface} />
          </SpringPressable>

          <Text
            style={styles.headerTitle}
            accessibilityRole="header"
            numberOfLines={1}
            adjustsFontSizeToFit
            minimumFontScale={0.85}
          >
            {s.routeDetails.title}
          </Text>

          {hasHeaderActions && (
            <View style={styles.actionCluster}>
              {!noLegs && (
                <SpringPressable
                  onPress={() => setSharing(true)}
                  scaleDelta={0.06}
                  haptic="selection"
                  accessibilityRole="button"
                  accessibilityLabel={s.share.title}
                  style={styles.clusterBtn}
                  hitSlop={4}
                >
                  <Share2 size={19} color={scheme.onSurface} />
                </SpringPressable>
              )}

              {hasTransitLeg && (
                <SpringPressable
                  onPress={() => setAlarmOpen(true)}
                  scaleDelta={0.06}
                  haptic="selection"
                  accessibilityRole="button"
                  onFocus={() => setAlarmFocused(true)}
                  onBlur={() => setAlarmFocused(false)}
                  accessibilityState={{ selected: currentAlarm != null }}
                  accessibilityLabel={
                    currentAlarm
                      ? `${s.alarm.edit}. ${s.alarm.ringsAt(currentAlarm.time)}`
                      : s.alarm.set
                  }
                  style={[
                    styles.clusterBtn,
                    currentAlarm && styles.clusterBtnActive,
                    alarmFocused && styles.alarmFocused,
                  ]}
                  hitSlop={4}
                >
                  <AlarmClock
                    size={19}
                    color={currentAlarm ? scheme.onPrimaryContainer : scheme.onSurface}
                  />
                </SpringPressable>
              )}

              {!noLegs && (
                <SpringPressable
                  onPress={() => void togglePin()}
                  disabled={trackingBusy}
                  scaleDelta={0.06}
                  haptic="light"
                  accessibilityRole="button"
                  accessibilityState={{ selected: isPinned }}
                  accessibilityLabel={
                    isPinned
                      ? s.home.unpinRouteA11y(item.toTitle)
                      : s.home.pinRouteA11y(item.toTitle)
                  }
                  style={[styles.clusterBtn, isPinned && styles.clusterBtnActive]}
                  hitSlop={4}
                >
                  <Pin
                    size={19}
                    color={isPinned ? scheme.onPrimaryContainer : scheme.onSurface}
                  />
                </SpringPressable>
              )}
            </View>
          )}
        </View>

        <ScrollView
          contentContainerStyle={styles.body}
          showsVerticalScrollIndicator={false}
          overScrollMode="never"
        >
          <ConnectionSummary item={item} offline={offline} fromY={cardFromY} showLegStrip />

          {currentAlarm && (
            <SpringPressable
              onPress={() => setAlarmOpen(true)}
              scaleDelta={0.02}
              haptic="selection"
              accessibilityRole="button"
              accessibilityLabel={`${s.alarm.edit}. ${s.alarm.ringsAt(currentAlarm.time)}`}
              style={styles.alarmBanner}
            >
              <View style={styles.alarmIconWrap}>
                <AlarmClock size={18} color={scheme.onPrimaryContainer} />
              </View>
              <View style={styles.alarmTextCol}>
                <Text style={styles.alarmEyebrow} numberOfLines={1}>
                  {s.alarm.title}
                </Text>
                <Text style={styles.alarmTimeText} numberOfLines={1}>
                  {s.alarm.ringsAt(currentAlarm.time)}
                </Text>
              </View>
              <ChevronRight size={17} color={scheme.onPrimaryContainer} />
            </SpringPressable>
          )}

          {dataNote && (
            <View style={styles.offlineBanner}>
              <View style={styles.offlineIconWrap}>
                <CloudOff size={16} color={scheme.onSecondaryContainer} />
              </View>
              <Text style={styles.offlineBannerText}>{dataNote}</Text>
            </View>
          )}

          {noLegs ? (
            <View style={styles.emptyCard}>
              <View style={styles.emptyIconCircle}>
                <RouteOff size={24} color={scheme.onSecondaryContainer} />
              </View>
              <Text style={styles.emptyTitle}>{s.routeDetails.noTrip}</Text>
              <Text style={styles.emptyText}>{s.routeDetails.noTripBody}</Text>
              <Pressable
                onPress={goBack}
                accessibilityRole="button"
                style={({ pressed }) => [styles.retryBtn, pressed && styles.pressed]}
              >
                <Text style={styles.retryText}>{s.routeDetails.backToList}</Text>
              </Pressable>
            </View>
          ) : (
            <View style={styles.detailsContent}>
              <RouteTravelDeck
                connection={item}
                hasTransfers={hasTransfers}
                transferState={isTrackedThis && trackedTrip ? trackedTrip.transfer : undefined}
                transferActive={isTrackedThis && trackedTrip?.protectionEnabled === true}
                trackingBusy={trackingBusy}
                autoInspectTicket={openTicket}
                onTransferPress={() => {
                  if (isTrackedThis && trackedTrip?.protectionEnabled) {
                    openTransferProtection();
                  } else {
                    void toggleTracking(true);
                  }
                }}
              />
              <LegTimeline
                legs={item.legs}
                boardedDepartAt={item.boarded ? item.departAt : undefined}
              />
              <RouteMapCard
                connection={item}
                onOpenMap={(stageId) =>
                  router.push({
                    pathname: '/map',
                    params: stageId ? { id: item.id, stageId } : { id: item.id },
                  })
                }
              />
              <ConnectionLineAlerts connection={item} />
            </View>
          )}

          <View style={{ height: 24 }} />
        </ScrollView>
      </View>
      {sharing && <ShareConnectionSheet connection={item} onClose={() => setSharing(false)} />}
      {alarmOpen && (
        <DepartureAlarmSheet connection={item} alarm={alarm} onClose={() => setAlarmOpen(false)} />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: scheme.surface,
  },
  screen: {
    flex: 1,
  },
  stateWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 20,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  backBtn: {
    width: 44,
    height: 44,
    borderRadius: shape.full,
    backgroundColor: scheme.surfaceContainer,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: scheme.outlineVariant,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    flex: 1,
    fontSize: 17,
    lineHeight: 22,
    fontWeight: '800',
    letterSpacing: -0.3,
    color: scheme.onSurface,
  },
  actionCluster: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    padding: 3,
    borderRadius: shape.full,
    backgroundColor: scheme.surfaceContainer,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: scheme.outlineVariant,
  },
  clusterBtn: {
    width: 40,
    height: 40,
    borderRadius: shape.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  clusterBtnActive: {
    backgroundColor: scheme.primaryContainer,
  },
  alarmFocused: {
    borderWidth: 2,
    borderColor: scheme.primary,
  },
  pressed: {
    opacity: 0.78,
    transform: [{ scale: 0.97 }],
  },
  body: {
    paddingHorizontal: 14,
    paddingTop: 4,
    gap: 14,
    paddingBottom: 40,
  },
  alarmBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    minHeight: 56,
    backgroundColor: scheme.primaryContainer,
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 10,
    ...elev.level1,
  },
  alarmIconWrap: {
    width: 34,
    height: 34,
    borderRadius: 12,
    backgroundColor: scheme.primary + '26',
    alignItems: 'center',
    justifyContent: 'center',
  },
  alarmTextCol: {
    flex: 1,
    minWidth: 0,
    gap: 1,
  },
  alarmEyebrow: {
    fontSize: 11,
    lineHeight: 14,
    fontWeight: '700',
    color: scheme.onPrimaryContainer,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  alarmTimeText: {
    fontSize: 14.5,
    lineHeight: 19,
    fontWeight: '800',
    color: scheme.onPrimaryContainer,
    fontVariant: ['tabular-nums'],
  },
  offlineBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: scheme.surfaceContainer,
    borderRadius: 20,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: scheme.outlineVariant,
    paddingHorizontal: 14,
    paddingVertical: 11,
  },
  offlineIconWrap: {
    width: 32,
    height: 32,
    borderRadius: 11,
    backgroundColor: scheme.secondaryContainer,
    alignItems: 'center',
    justifyContent: 'center',
  },
  offlineBannerText: {
    ...type.bodySmall,
    color: scheme.onSurfaceVariant,
    flex: 1,
    lineHeight: 18,
  },
  emptyCard: {
    width: '100%',
    alignItems: 'center',
    gap: 10,
    backgroundColor: scheme.surfaceContainer,
    borderRadius: shape.extraLarge,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: scheme.outlineVariant,
    padding: 24,
    ...elev.level1,
  },
  emptyIconCircle: {
    width: 52,
    height: 52,
    borderRadius: shape.full,
    backgroundColor: scheme.secondaryContainer,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 2,
  },
  emptyTitle: {
    ...type.titleMedium,
    fontWeight: '800',
    color: scheme.onSurface,
    textAlign: 'center',
  },
  emptyText: {
    ...type.bodyMedium,
    color: scheme.onSurfaceVariant,
    textAlign: 'center',
    lineHeight: 20,
  },
  retryBtn: {
    minHeight: 48,
    minWidth: 160,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: scheme.primary,
    borderRadius: shape.full,
    paddingHorizontal: 24,
    paddingVertical: 12,
    marginTop: 6,
  },
  retryText: {
    ...type.labelLarge,
    fontWeight: '700',
    color: scheme.onPrimary,
  },
  detailsContent: {
    gap: 14,
  },
});
