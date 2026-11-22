import { useMemo, useRef, useState, type ReactNode } from 'react';
import {
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { ChevronLeft, Compass, MapPin, RefreshCw } from '../src/components/icons';
import { LegTimeline } from '../src/components/LegTimeline';
import { MorphingLoader } from '../src/components/MorphingLoader';
import { getLineColors, mapLineColor } from '../src/components/LineBadge';
import { SharedJourneyHero } from '../src/components/SharedJourneyHero';
import { SharedJourneyMapCard } from '../src/components/SharedJourneyMapCard';
import { getCity } from '../src/cities';
import { getLocaleSync, useStrings } from '../src/i18n';
import type { MapVehicle } from '../src/map/types';
import { useActiveCity } from '../src/services/cityStore';
import { ensureActiveCityTimetable } from '../src/services/dataManager';
import {
  areNotificationsSupported,
  ensureNotificationPermission,
  permissionDeniedMessage,
  startTracking,
  stopTracking,
  useTrackedTrip,
} from '../src/services/notifications';
import { getNotificationPreferencesSync } from '../src/services/notifications/preferences';
import { computeTripProgress } from '../src/services/notifications/tripProgress';
import { buildMapRoute } from '../src/services/routeGeometry';
import { useSharedJourney } from '../src/sharing/useSharedJourney';
import { scheme, shape, type } from '../src/theme/tokens';

function ActionButton({
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

const sharedDateFormatters = new Map<string, Intl.DateTimeFormat>();

function getSharedDateFormatter(locale: string): Intl.DateTimeFormat {
  const key = locale || 'pl';
  let formatter = sharedDateFormatters.get(key);
  if (!formatter) {
    const opts: Intl.DateTimeFormatOptions = {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      timeZone: 'UTC',
    };
    try {
      formatter = new Intl.DateTimeFormat(key, opts);
    } catch {
      formatter = new Intl.DateTimeFormat('pl', opts);
    }
    sharedDateFormatters.set(key, formatter);
  }
  return formatter;
}

export default function SharedJourneyScreen() {
  const s = useStrings();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { trip: param } = useLocalSearchParams<{ trip?: string }>();
  const encoded = typeof param === 'string' ? param : '';
  const { base, journey, connection, match, sameCity, now, loading, failed, retry } =
    useSharedJourney(encoded);

  const formattedDate = useMemo(() => {
    if (!journey?.date) return '';
    return getSharedDateFormatter(getLocaleSync()).format(new Date(`${journey.date}T12:00:00Z`));
  }, [journey?.date, s]);

  const { setCity } = useActiveCity();
  const { trip: tracked } = useTrackedTrip();
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [error, setError] = useState(false);
  const [backFocused, setBackFocused] = useState(false);

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

  const delayFingerprint = useMemo(
    () =>
      connection
        ? connection.legs
            .map((leg) => `${leg.id}:${leg.delaySec ?? 0}:${leg.arrivalDelaySec ?? 0}`)
            .join(',')
        : '',
    [connection],
  );

  const pingKey = useMemo(() => {
    if (match?.vehicle.updatedAt) return match.vehicle.updatedAt;
    if (connection?.live) return delayFingerprint;
    return 0;
  }, [match?.vehicle.updatedAt, connection?.live, delayFingerprint]);

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
    } else {
      void follow();
    }
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <Pressable
          onPress={goBack}
          onFocus={() => setBackFocused(true)}
          onBlur={() => setBackFocused(false)}
          style={({ pressed }) => [
            styles.back,
            backFocused && styles.focused,
            pressed && styles.pressed,
          ]}
          accessibilityRole="button"
          accessibilityLabel={s.map.backA11y}
        >
          <ChevronLeft size={24} color={scheme.onSurface} />
        </Pressable>
        <View style={styles.headerText}>
          <Text style={styles.headerTitle} accessibilityRole="header" numberOfLines={1}>
            {s.share.pageTitle}
          </Text>
          {journey && (
            <Text style={styles.headerSubtitle} numberOfLines={1}>
              {s.city.name(journey.city)} · {formattedDate}
            </Text>
          )}
        </View>
      </View>

      {!journey || !connection ? (
        <View style={styles.emptyWrap}>
          <View style={styles.emptyCard}>
            <View style={styles.emptyIconBadge}>
              <MapPin size={28} color={scheme.onPrimaryContainer} />
            </View>
            <Text style={styles.emptyTitle} accessibilityRole="header">
              {s.share.invalidTitle}
            </Text>
            <Text style={styles.emptyBody}>{s.share.invalidBody}</Text>
            <ActionButton title={s.map.backA11y} onPress={goBack} />
          </View>
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 28 }]}
          showsVerticalScrollIndicator={false}
        >
          <SharedJourneyHero
            journey={journey}
            connection={connection}
            progress={progress}
            hasVehicle={!!vehicle}
            pingKey={pingKey}
            sameCity={sameCity}
            following={following}
            followBusy={busy}
            onFollowPress={requestFollow}
          />

          {!sameCity ? (
            <View style={styles.cityCard}>
              <View style={styles.cityCardHeader}>
                <View style={styles.cityIconWrap}>
                  <Compass size={20} color={scheme.onSecondaryContainer} />
                </View>
                <Text style={styles.cityCardText}>{s.share.switchCityHint}</Text>
              </View>
              <ActionButton
                title={s.share.switchCity(s.city.name(journey.city))}
                disabled={busy}
                onPress={() => {
                  if (busyRef.current) return;
                  busyRef.current = true;
                  setBusy(true);
                  setError(false);
                  void setCity(journey.city)
                    .then(() => {
                      void ensureActiveCityTimetable();
                    })
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
              <SharedJourneyMapCard
                mapRoute={mapRoute}
                vehicle={vehicle}
                ended={ended}
                loading={loading}
                onRetryData={retry}
              />

              <View style={styles.itinerarySection}>
                <View style={styles.itineraryHeader}>
                  <Text style={styles.itineraryTitle} accessibilityRole="header">
                    {s.share.itinerary}
                  </Text>
                  {loading && (
                    <View style={styles.loadingChip} accessibilityLiveRegion="polite">
                      <MorphingLoader size={16} color={scheme.primary} />
                      <Text style={styles.loadingText} numberOfLines={1}>
                        {s.share.loading}
                      </Text>
                    </View>
                  )}
                </View>

                <LegTimeline legs={connection.legs} observeOnly />

                {failed && (
                  <View style={styles.retryCard}>
                    <Text style={styles.retryText}>{s.share.stopsUnavailable}</Text>
                    <ActionButton
                      title={s.share.retry}
                      tonal
                      onPress={retry}
                      disabled={loading}
                      icon={<RefreshCw size={18} color={scheme.onSecondaryContainer} />}
                    />
                  </View>
                )}
              </View>
            </>
          )}

          {error && (
            <View style={styles.errorBanner} accessibilityRole="alert">
              <Text style={styles.errorText}>{s.share.trackError}</Text>
            </View>
          )}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: scheme.surface,
  },
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
    borderWidth: 2,
    borderColor: 'transparent',
  },
  headerText: {
    flex: 1,
    minWidth: 0,
    gap: 1,
  },
  headerTitle: {
    ...type.titleMedium,
    fontWeight: '700',
    color: scheme.onSurface,
  },
  headerSubtitle: {
    ...type.bodySmall,
    color: scheme.onSurfaceVariant,
  },
  content: {
    paddingHorizontal: 16,
    paddingTop: 6,
    gap: 18,
    width: '100%',
    maxWidth: 640,
    alignSelf: 'center',
  },
  emptyWrap: {
    flex: 1,
    justifyContent: 'center',
    padding: 20,
  },
  emptyCard: {
    borderRadius: shape.extraLarge,
    backgroundColor: scheme.surfaceContainerLow,
    padding: 24,
    gap: 14,
    alignItems: 'stretch',
    maxWidth: 440,
    width: '100%',
    alignSelf: 'center',
  },
  emptyIconBadge: {
    width: 56,
    height: 56,
    borderRadius: shape.full,
    backgroundColor: scheme.primaryContainer,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'center',
    marginBottom: 4,
  },
  emptyTitle: {
    ...type.titleLarge,
    fontWeight: '700',
    color: scheme.onSurface,
    textAlign: 'center',
  },
  emptyBody: {
    ...type.bodyMedium,
    color: scheme.onSurfaceVariant,
    textAlign: 'center',
    lineHeight: 21,
  },
  cityCard: {
    borderRadius: shape.extraLarge,
    backgroundColor: scheme.surfaceContainerHigh,
    padding: 20,
    gap: 14,
  },
  cityCardHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
  },
  cityIconWrap: {
    width: 40,
    height: 40,
    borderRadius: shape.full,
    backgroundColor: scheme.secondaryContainer,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cityCardText: {
    ...type.bodyMedium,
    color: scheme.onSurface,
    lineHeight: 21,
    flex: 1,
    minWidth: 0,
  },
  itinerarySection: {
    gap: 12,
  },
  itineraryHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: 8,
    paddingHorizontal: 4,
  },
  itineraryTitle: {
    ...type.titleMedium,
    fontWeight: '700',
    color: scheme.onSurface,
  },
  loadingChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    maxWidth: '100%',
  },
  loadingText: {
    ...type.bodySmall,
    color: scheme.onSurfaceVariant,
    flexShrink: 1,
  },
  retryCard: {
    borderRadius: shape.large,
    backgroundColor: scheme.surfaceContainerLow,
    padding: 16,
    gap: 12,
  },
  retryText: {
    ...type.bodyMedium,
    color: scheme.onSurfaceVariant,
    lineHeight: 20,
  },
  action: {
    minHeight: 50,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 18,
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
  tonal: {
    backgroundColor: scheme.secondaryContainer,
  },
  tonalText: {
    color: scheme.onSecondaryContainer,
  },
  errorBanner: {
    borderRadius: shape.large,
    backgroundColor: scheme.errorContainer,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  errorText: {
    ...type.bodyMedium,
    color: scheme.onErrorContainer,
  },
  focused: {
    borderColor: scheme.onSurface,
  },
  pressed: {
    opacity: 0.78,
  },
  disabled: {
    opacity: 0.5,
  },
});
