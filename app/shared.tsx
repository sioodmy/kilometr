import { useCallback, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Bell, BellOff, ChevronLeft, LocateFixed, MapPin, RefreshCw } from 'lucide-react-native';
import { useStrings, getLocaleSync } from '../src/i18n';
import { getCity } from '../src/cities';
import { scheme, shape, type } from '../src/theme/tokens';
import { useActiveCity } from '../src/services/cityStore';
import { useSharedJourney } from '../src/sharing/useSharedJourney';
import { RouteMap, type RouteMapHandle } from '../src/components/RouteMap';
import { ConnectionSummary } from '../src/components/ConnectionSummary';
import { LegTimeline } from '../src/components/LegTimeline';
import { buildMapRoute, resolveGeometry } from '../src/services/routeGeometry';
import { acquireMapServer } from '../src/services/mapServerLease';
import { mapLineColor, getLineColors } from '../src/components/LineBadge';
import type { MapVehicle } from '../src/map/types';
import { computeTripProgress } from '../src/services/notifications/tripProgress';
import {
  areNotificationsSupported,
  ensureNotificationPermission,
  permissionDeniedMessage,
  startTracking,
  stopTracking,
  useTrackedTrip,
} from '../src/services/notifications';
import { getNotificationPreferencesSync } from '../src/services/notifications/preferences';

function Action({
  title,
  onPress,
  disabled,
  tonal,
  icon,
}: {
  title: string;
  onPress: () => void;
  disabled?: boolean;
  tonal?: boolean;
  icon?: ReactNode;
}) {
  const [focused, setFocused] = useState(false);
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityState={{ disabled: !!disabled }}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      style={({ pressed }) => [
        styles.action,
        tonal && styles.tonal,
        focused && styles.focused,
        pressed && styles.pressed,
        disabled && styles.disabled,
      ]}
    >
      {icon}
      <Text style={[styles.actionText, tonal && styles.tonalText]}>{title}</Text>
    </Pressable>
  );
}

export default function SharedJourneyScreen() {
  const s = useStrings();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { trip: param } = useLocalSearchParams<{ trip?: string }>();
  const encoded = typeof param === 'string' ? param : '';
  const { base, journey, connection, match, sameCity, now, loading, failed, retry } =
    useSharedJourney(encoded);
  const { setCity } = useActiveCity();
  const { trip: tracked } = useTrackedTrip();
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [error, setError] = useState(false);
  const [offlineBase, setOfflineBase] = useState<string | null>(null);
  const [mapFailed, setMapFailed] = useState(false);
  const map = useRef<RouteMapHandle>(null);
  const mapRoute = useMemo(() => {
    if (!base || !sameCity) return null;
    const route = buildMapRoute(base);
    for (const leg of route.legs) {
      if (!leg.geometry && leg.mode !== 'walk' && leg.stops.length < 3) leg.geometry = [];
    }
    route.id += `:${route.legs.map((leg) => `${leg.geometry?.length ?? 0}:${leg.stops.map((stop) => `${stop.lat},${stop.lon}`).join(';')}`).join('|')}`;
    return route.legs.some((leg) => (leg.geometry?.length ?? 0) >= 2 || leg.stops.length > 2)
      ? route
      : null;
  }, [base, sameCity]);

  useFocusEffect(
    useCallback(() => {
      if (!sameCity) return;
      let cancelled = false;
      let release = () => {};
      void acquireMapServer().then((lease) => {
        if (cancelled) {
          lease.release();
          return;
        }
        release = lease.release;
        setOfflineBase(lease.base);
      });
      return () => {
        cancelled = true;
        release();
      };
    }, [sameCity]),
  );

  const resolveMap = useCallback(() => {
    if (!mapRoute) return;
    setMapFailed(false);
    void resolveGeometry(mapRoute, (legId, coords) =>
      map.current?.setGeometry(legId, coords),
    ).catch(() => {});
    map.current?.fit();
  }, [mapRoute]);

  const vehicle: MapVehicle | null =
    match && match.leg.mode !== 'walk'
      ? {
          ...match.vehicle,
          legId: match.leg.id,
          mode: match.leg.mode,
          heading: 0,
          delaySec: match.vehicle.delaySec ?? 0,
          color: mapLineColor(getLineColors(match.leg.line, match.leg.mode).bg),
        }
      : null;
  const progress = connection
    ? computeTripProgress(connection, { now, vehicle: match?.vehicle })
    : null;
  const ended = progress?.phase === 'arrived';
  const following = !!tracked && tracked.sharedJourney === encoded;
  const goBack = () => (router.canGoBack() ? router.back() : router.replace('/'));

  async function follow() {
    if (!connection || !journey || busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError(false);
    try {
      if (following) {
        await stopTracking();
        return;
      }
      if (!areNotificationsSupported()) {
        Alert.alert(s.routes.trackUnsupportedTitle, s.routes.trackUnsupportedBody);
        return;
      }
      if (!getNotificationPreferencesSync().trackingEnabled) {
        Alert.alert(s.routes.notifOffTitle, s.share.followHint, [
          { text: s.common.cancel, style: 'cancel' },
          { text: s.compass.openSettingsA11y, onPress: () => router.push('/settings') },
        ]);
        return;
      }
      if (!(await ensureNotificationPermission())) {
        Alert.alert(s.routes.notifOffTitle, permissionDeniedMessage());
        return;
      }
      const first = connection.legs[0];
      const last = connection.legs.at(-1);
      const center = getCity(journey.city).center;
      await startTracking({
        id: connection.id,
        sharedJourney: encoded,
        connection,
        startedAt: Date.now(),
        fromTitle: connection.fromTitle,
        toTitle: connection.toTitle,
        toId: connection.toTitle,
        fromLat: first?.fromLat ?? center.lat,
        fromLon: first?.fromLon ?? center.lon,
        toLat: last?.toLat ?? center.lat,
        toLon: last?.toLon ?? center.lon,
        protectionEnabled: false,
      });
    } catch {
      setError(true);
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  function requestFollow() {
    if (tracked && !following) {
      Alert.alert(s.share.replaceTitle, s.share.replaceBody, [
        { text: s.common.cancel, style: 'cancel' },
        { text: s.share.follow, onPress: () => void follow() },
      ]);
    } else void follow();
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <Pressable
          onPress={goBack}
          style={({ pressed }) => [styles.back, pressed && styles.pressed]}
          accessibilityRole="button"
          accessibilityLabel={s.map.backA11y}
        >
          <ChevronLeft size={24} color={scheme.onSurface} />
        </Pressable>
        <Text style={styles.headerTitle} accessibilityRole="header">
          {s.share.pageTitle}
        </Text>
      </View>
      {!journey || !connection ? (
        <View style={styles.empty}>
          <MapPin size={32} color={scheme.onSurfaceVariant} />
          <Text style={styles.title} accessibilityRole="header">
            {s.share.invalidTitle}
          </Text>
          <Text style={styles.note}>{s.share.invalidBody}</Text>
          <Action title={s.map.backA11y} onPress={goBack} />
        </View>
      ) : (
        <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 24 }]}>
          <Text style={styles.date}>
            {new Intl.DateTimeFormat(getLocaleSync(), {
              weekday: 'long',
              day: 'numeric',
              month: 'long',
              year: 'numeric',
              timeZone: 'UTC',
            }).format(new Date(`${journey.date}T12:00:00Z`))}
          </Text>
          <ConnectionSummary item={connection} />
          {!sameCity ? (
            <View style={styles.section}>
              <Text style={styles.note}>{s.share.switchCityHint}</Text>
              <Action
                title={s.share.switchCity(s.city.name(journey.city))}
                disabled={busy}
                onPress={() => {
                  if (busyRef.current) return;
                  busyRef.current = true;
                  setBusy(true);
                  void setCity(journey.city)
                    .catch(() => setError(true))
                    .finally(() => {
                      busyRef.current = false;
                      setBusy(false);
                    });
                }}
              />
            </View>
          ) : (
            <>
              <View style={styles.section}>
                <View style={styles.sectionHeader}>
                  <Text style={styles.title} accessibilityRole="header">
                    {s.share.map}
                  </Text>
                  {mapRoute && (
                    <Pressable
                      onPress={() => map.current?.fit()}
                      style={styles.back}
                      accessibilityRole="button"
                      accessibilityLabel={s.share.fitMap}
                    >
                      <LocateFixed size={23} color={scheme.primary} />
                    </Pressable>
                  )}
                </View>
                {mapRoute ? (
                  <View style={styles.map}>
                    <RouteMap
                      ref={map}
                      route={mapRoute}
                      vehicle={vehicle}
                      offlineBase={offlineBase}
                      paddingTop={28}
                      paddingBottom={28}
                      onReady={resolveMap}
                      onError={() => setMapFailed(true)}
                      onTilesStatus={(ok) => setMapFailed(!ok)}
                    />
                  </View>
                ) : (
                  <View style={styles.mapEmpty}>
                    {loading && <ActivityIndicator color={scheme.primary} />}
                    <Text style={styles.note}>
                      {loading ? s.share.geometryLoading : s.share.mapUnavailable}
                    </Text>
                  </View>
                )}
                {mapFailed && (
                  <View style={styles.section}>
                    <Text style={styles.note} accessibilityRole="alert">
                      {s.share.mapError}
                    </Text>
                    <Action
                      title={s.share.retryMap}
                      tonal
                      onPress={() => {
                        setMapFailed(false);
                        map.current?.reload();
                      }}
                    />
                  </View>
                )}
                <Text style={[styles.status, vehicle && { color: scheme.primary }]}>
                  {ended ? s.share.finished : vehicle ? s.share.vehicleLive : s.share.planned}
                </Text>
                {!vehicle && !ended && <Text style={styles.note}>{s.share.noVehicle}</Text>}
                {mapRoute?.legs.some((leg) => leg.approx) && (
                  <Text style={styles.caption}>{s.share.approximateGeometry}</Text>
                )}
                <Text style={styles.caption}>{s.share.vehicleOnly}</Text>
                {!loading && !mapRoute && <Action title={s.share.retryMap} tonal onPress={retry} />}
              </View>
              {(!ended || following) && (
                <View style={styles.follow}>
                  <Action
                    title={following ? s.share.following : s.share.follow}
                    disabled={busy}
                    tonal={following}
                    onPress={requestFollow}
                    icon={
                      busy ? (
                        <ActivityIndicator color={scheme.onPrimary} />
                      ) : following ? (
                        <BellOff size={22} color={scheme.onSecondaryContainer} />
                      ) : (
                        <Bell size={22} color={scheme.onPrimary} />
                      )
                    }
                  />
                  <Text style={styles.note}>{s.share.followHint}</Text>
                </View>
              )}
              <Text style={styles.title} accessibilityRole="header">
                {s.share.itinerary}
              </Text>
              <LegTimeline legs={connection.legs} observeOnly />
              {loading && (
                <Text style={styles.note} accessibilityLiveRegion="polite">
                  {s.share.loading}
                </Text>
              )}
              {failed && (
                <View style={styles.section}>
                  <Text style={styles.note}>{s.share.stopsUnavailable}</Text>
                  <Action
                    title={s.share.retry}
                    tonal
                    onPress={retry}
                    disabled={loading}
                    icon={<RefreshCw size={20} color={scheme.onSecondaryContainer} />}
                  />
                </View>
              )}
            </>
          )}
          {error && (
            <Text style={styles.error} accessibilityRole="alert">
              {s.share.trackError}
            </Text>
          )}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: scheme.surface },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  back: {
    width: 48,
    height: 48,
    borderRadius: shape.medium,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: { ...type.titleMedium, flex: 1, color: scheme.onSurface },
  content: { paddingHorizontal: 16, gap: 20, width: '100%', maxWidth: 640, alignSelf: 'center' },
  date: { ...type.bodyMedium, color: scheme.onSurfaceVariant, marginTop: 6 },
  section: { gap: 12 },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  title: { ...type.titleLarge, fontWeight: '600', color: scheme.onSurface, flexShrink: 1 },
  map: { height: 300, borderRadius: shape.extraLarge, overflow: 'hidden' },
  mapEmpty: {
    padding: 24,
    gap: 12,
    backgroundColor: scheme.surfaceContainerLow,
    borderRadius: shape.extraLarge,
  },
  note: { ...type.bodyMedium, color: scheme.onSurfaceVariant, lineHeight: 21 },
  caption: { ...type.bodySmall, color: scheme.onSurfaceVariant, lineHeight: 18 },
  status: { ...type.titleMedium, color: scheme.onSurface },
  follow: {
    gap: 12,
    padding: 18,
    borderRadius: shape.extraLarge,
    backgroundColor: scheme.surfaceContainerLow,
  },
  action: {
    minHeight: 56,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderRadius: 20,
    backgroundColor: scheme.primary,
    borderWidth: 2,
    borderColor: 'transparent',
  },
  actionText: {
    ...type.labelLarge,
    fontWeight: '700',
    color: scheme.onPrimary,
    flexShrink: 1,
    textAlign: 'center',
  },
  tonal: { backgroundColor: scheme.secondaryContainer },
  tonalText: { color: scheme.onSecondaryContainer },
  focused: { borderColor: scheme.onSurface },
  pressed: { opacity: 0.75 },
  disabled: { opacity: 0.5 },
  empty: { flex: 1, justifyContent: 'center', gap: 20, padding: 24 },
  error: { ...type.bodyMedium, color: scheme.error },
});
