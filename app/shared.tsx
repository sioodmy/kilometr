import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  BackHandler,
  Linking,
  Platform,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  Bell,
  BellOff,
  BellRing,
  Check,
  ChevronLeft,
  Compass,
  RefreshCw,
  RouteOff,
  Share2,
} from '../src/components/icons';
import { LegTimeline } from '../src/components/LegTimeline';
import { MorphingLoader } from '../src/components/MorphingLoader';
import { getLineColors, mapLineColor } from '../src/components/LineBadge';
import { SharedJourneyHero } from '../src/components/SharedJourneyHero';
import { SharedJourneyMapCard } from '../src/components/SharedJourneyMapCard';
import { SpringPressable } from '../src/components/SpringPressable';
import { getCity } from '../src/cities';
import { useScreenTransitionSettled } from '../src/hooks/useScreenTransitionSettled';
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
import { buildShareUrl, shareMessage } from '../src/sharing/connection';
import { useSharedJourney } from '../src/sharing/useSharedJourney';
import { useWebLayout } from '../src/theme/layout';
import { elev, scheme, shape, type } from '../src/theme/tokens';

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
  const webLayout = useWebLayout();
  const transitionSettled = useScreenTransitionSettled();
  const { trip: param } = useLocalSearchParams<{ trip?: string }>();
  const encoded = typeof param === 'string' ? param : '';
  const { base, journey, connection, match, sameCity, now, loading, failed, retry } =
    useSharedJourney(encoded);

  // Wejście z linku /t zostawia ten ekran jako korzeń stosu: wstecz wraca do domu, nie zamyka aplikacji.
  useFocusEffect(
    useCallback(() => {
      const sub = BackHandler.addEventListener('hardwareBackPress', () => {
        if (router.canGoBack()) return false;
        router.replace('/');
        return true;
      });
      return () => sub.remove();
    }, [router]),
  );

  const formattedDate = useMemo(() => {
    if (!journey?.date) return '';
    return getSharedDateFormatter(getLocaleSync()).format(new Date(`${journey.date}T12:00:00Z`));
  }, [journey?.date, s]);

  const { setCity } = useActiveCity();
  const { trip: tracked } = useTrackedTrip();
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [error, setError] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 2400);
    return () => clearTimeout(timer);
  }, [copied]);

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

  const shareUrl = useMemo(() => {
    if (!journey) return '';
    try {
      return buildShareUrl(journey, getLocaleSync());
    } catch {
      return '';
    }
  }, [journey]);

  const goBack = () => (router.canGoBack() ? router.back() : router.replace('/'));

  async function shareForward() {
    if (!journey || !shareUrl) return;
    void Haptics.selectionAsync().catch(() => {});
    const message = `${shareMessage(journey, s.share)}\n${shareUrl}`;
    if (Platform.OS === 'web') {
      if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
        try {
          await navigator.share({ title: s.share.pageTitle, text: message, url: shareUrl });
          return;
        } catch (err) {
          if (err instanceof Error && err.name === 'AbortError') return;
        }
      }
      await Clipboard.setStringAsync(shareUrl).catch(() => {});
      setCopied(true);
      return;
    }
    try {
      await Share.share({ title: s.share.pageTitle, message });
    } catch {
      await Clipboard.setStringAsync(shareUrl).catch(() => {});
      setCopied(true);
    }
  }

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
    if (Platform.OS === 'web') {
      Alert.alert(s.routeDetails.fullAppOnlyTitle, s.routeDetails.fullAppOnlyBody, [
        { text: s.common.close, style: 'cancel' },
        {
          text: s.routeDetails.fullAppDownload,
          onPress: () => void Linking.openURL('https://kilometr.app'),
        },
      ]);
      return;
    }
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    if (tracked && !following) {
      Alert.alert(s.share.replaceTitle, s.share.replaceBody, [
        { text: s.common.cancel, style: 'cancel' },
        { text: s.share.follow, onPress: () => void follow() },
      ]);
    } else {
      void follow();
    }
  }

  function switchCity() {
    if (!journey || busyRef.current) return;
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
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
  }

  const desktopTwoCol = webLayout.isDesktop && Boolean(journey && connection && sameCity);
  const leftColWidth = webLayout.isWide ? 520 : 440;
  const heroAvailableWidth = desktopTwoCol
    ? leftColWidth
    : webLayout.isMedium
      ? Math.min(740, webLayout.contentWidth) - 28
      : undefined;

  const showFollowCard =
    Boolean(journey && connection && sameCity) && (!ended || following) && Platform.OS !== 'web';
  const showFollowAction = Boolean(journey && connection && sameCity) && (!ended || following);

  const headerContent = (
    <>
      <SpringPressable
        onPress={goBack}
        scaleDelta={0.06}
        style={styles.backBtn}
        accessibilityRole="button"
        accessibilityLabel={s.map.backA11y}
      >
        <ChevronLeft size={22} color={scheme.onSurface} />
      </SpringPressable>

      <View style={styles.headerText}>
        <Text
          style={styles.headerTitle}
          accessibilityRole="header"
          numberOfLines={1}
          adjustsFontSizeToFit
          minimumFontScale={0.85}
        >
          {s.share.pageTitle}
        </Text>
        {journey && (
          <Text style={styles.headerSubtitle} numberOfLines={1}>
            {s.city.name(journey.city)} {'\u00b7'} {formattedDate}
          </Text>
        )}
      </View>

      {journey && connection && (
        <View style={styles.actionCluster}>
          {shareUrl ? (
            <SpringPressable
              onPress={() => void shareForward()}
              scaleDelta={0.06}
              haptic="selection"
              accessibilityRole="button"
              accessibilityLabel={copied ? s.share.copied : s.share.share}
              style={[styles.clusterBtn, copied && styles.clusterBtnActive]}
              hitSlop={4}
            >
              {copied ? (
                <Check size={19} color={scheme.onPrimaryContainer} />
              ) : (
                <Share2 size={19} color={scheme.onSurface} />
              )}
            </SpringPressable>
          ) : null}

          {showFollowAction && (
            <SpringPressable
              onPress={requestFollow}
              disabled={busy}
              scaleDelta={0.06}
              haptic="light"
              accessibilityRole="button"
              accessibilityState={{
                selected: following,
                disabled: Platform.OS === 'web' || busy,
              }}
              accessibilityLabel={following ? s.share.following : s.share.follow}
              style={[
                styles.clusterBtn,
                Platform.OS === 'web' && styles.clusterBtnLocked,
                following && styles.clusterBtnActive,
              ]}
              hitSlop={4}
            >
              {following ? (
                <BellRing size={19} color={scheme.onPrimaryContainer} />
              ) : (
                <Bell size={19} color={scheme.onSurface} />
              )}
            </SpringPressable>
          )}
        </View>
      )}
    </>
  );

  const followCard = showFollowCard ? (
    <SpringPressable
      onPress={requestFollow}
      disabled={busy}
      scaleDelta={0.015}
      accessibilityRole="button"
      accessibilityState={{ disabled: busy, selected: following }}
      accessibilityLabel={following ? s.share.following : s.share.follow}
      style={[styles.followCard, following && styles.followCardActive, busy && styles.disabled]}
    >
      <View style={[styles.followIconWrap, following && styles.followIconWrapActive]}>
        {busy ? (
          <ActivityIndicator
            size="small"
            color={following ? scheme.onPrimaryContainer : scheme.onSecondaryContainer}
          />
        ) : following ? (
          <BellRing size={19} color={scheme.onPrimaryContainer} />
        ) : (
          <Bell size={19} color={scheme.onSecondaryContainer} />
        )}
      </View>

      <View style={styles.followCopy}>
        <Text style={styles.followTitle} numberOfLines={1}>
          {following ? s.share.followActiveTitle : s.share.follow}
        </Text>
        <Text style={styles.followBody} numberOfLines={2}>
          {following ? s.share.followActiveHint : s.share.followHint}
        </Text>
      </View>

      <View style={[styles.followChip, following && styles.followChipActive]}>
        {following ? (
          <BellOff size={15} color={scheme.onSecondaryContainer} />
        ) : (
          <Bell size={15} color={scheme.onPrimary} />
        )}
        <Text style={[styles.followChipText, following && styles.followChipTextActive]}>
          {following ? s.share.stopFollowShort : s.share.followShort}
        </Text>
      </View>
    </SpringPressable>
  ) : null;

  const itineraryBlock = connection ? (
    <View style={styles.itinerarySection}>
      <View style={styles.itineraryHeader}>
        <Text style={styles.itineraryTitle} accessibilityRole="header">
          {s.share.itinerary}
        </Text>
        {loading && (
          <View style={styles.loadingChip} accessibilityLiveRegion="polite">
            <MorphingLoader size={15} color={scheme.primary} />
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
          <SpringPressable
            onPress={retry}
            disabled={loading}
            haptic="selection"
            accessibilityRole="button"
            style={[styles.tonalBtn, loading && styles.disabled]}
          >
            <RefreshCw size={17} color={scheme.onSecondaryContainer} />
            <Text style={styles.tonalBtnText}>{s.share.retry}</Text>
          </SpringPressable>
        </View>
      )}
    </View>
  ) : null;

  const errorBanner = error ? (
    <View style={styles.errorBanner} accessibilityRole="alert">
      <Text style={styles.errorText}>{s.share.trackError}</Text>
    </View>
  ) : null;

  return (
    <View style={[styles.safe, { paddingTop: insets.top }]}>
      <View style={[styles.screen, desktopTwoCol && styles.desktopContainer]}>
        {!journey || !connection ? (
          <>
            <View style={[styles.header, webLayout.isMedium && styles.mediumConstrained]}>
              {headerContent}
            </View>
            <View style={[styles.emptyWrap, webLayout.isMedium && styles.mediumConstrained]}>
              <View style={styles.emptyCard}>
                <View style={styles.emptyIconBadge}>
                  <RouteOff size={26} color={scheme.onSecondaryContainer} />
                </View>
                <Text style={styles.emptyTitle} accessibilityRole="header">
                  {s.share.invalidTitle}
                </Text>
                <Text style={styles.emptyBody}>{s.share.invalidBody}</Text>
                <SpringPressable
                  onPress={goBack}
                  haptic="selection"
                  accessibilityRole="button"
                  style={styles.primaryBtn}
                >
                  <Text style={styles.primaryBtnText}>{s.map.backA11y}</Text>
                </SpringPressable>
              </View>
            </View>
          </>
        ) : desktopTwoCol ? (
          <>
            <View style={styles.desktopHeader}>{headerContent}</View>
            <View style={styles.desktopSplit}>
              <ScrollView
                style={{ width: leftColWidth, flexGrow: 0, flexShrink: 0 }}
                contentContainerStyle={[
                  styles.desktopLeftContent,
                  { paddingBottom: insets.bottom + 24 },
                ]}
                showsVerticalScrollIndicator={false}
                overScrollMode="never"
              >
                <SharedJourneyHero
                  journey={journey}
                  connection={connection}
                  progress={progress}
                  hasVehicle={!!vehicle}
                  pingKey={pingKey}
                  availableWidth={heroAvailableWidth}
                />
                {followCard}
                {itineraryBlock}
                {errorBanner}
              </ScrollView>

              <View style={styles.desktopRightCol}>
                {transitionSettled ? (
                  <SharedJourneyMapCard
                    desktopFill
                    connection={connection}
                    mapRoute={mapRoute}
                    vehicle={vehicle}
                    ended={ended}
                    loading={loading}
                    onRetryData={retry}
                  />
                ) : (
                  <View
                    style={{
                      flex: 1,
                      minHeight: 380,
                      borderRadius: 22,
                      backgroundColor: scheme.surfaceContainerLow,
                    }}
                  />
                )}
              </View>
            </View>
          </>
        ) : (
          <>
            <View style={[styles.header, webLayout.isMedium && styles.mediumConstrained]}>
              {headerContent}
            </View>

            <ScrollView
              contentContainerStyle={[
                styles.content,
                webLayout.isMedium && styles.mediumConstrained,
                { paddingBottom: insets.bottom + 28 },
              ]}
              showsVerticalScrollIndicator={false}
              overScrollMode="never"
            >
              <SharedJourneyHero
                journey={journey}
                connection={connection}
                progress={progress}
                hasVehicle={!!vehicle}
                pingKey={pingKey}
                availableWidth={heroAvailableWidth}
              />

              {!sameCity ? (
                <View style={styles.cityCard}>
                  <View style={styles.cityCardHeader}>
                    <View style={styles.cityIconWrap}>
                      <Compass size={20} color={scheme.onPrimaryContainer} />
                    </View>
                    <View style={styles.cityTextCol}>
                      <Text style={styles.cityCardTitle}>
                        {s.city.name(journey.city)}
                      </Text>
                      <Text style={styles.cityCardText}>{s.share.switchCityHint}</Text>
                    </View>
                  </View>
                  <SpringPressable
                    onPress={switchCity}
                    disabled={busy}
                    haptic="light"
                    accessibilityRole="button"
                    style={[styles.primaryBtn, busy && styles.disabled]}
                  >
                    {busy ? (
                      <ActivityIndicator size="small" color={scheme.onPrimary} />
                    ) : (
                      <Text style={styles.primaryBtnText}>
                        {s.share.switchCity(s.city.name(journey.city))}
                      </Text>
                    )}
                  </SpringPressable>
                </View>
              ) : (
                <>
                  {followCard}
                  {transitionSettled ? (
                    <SharedJourneyMapCard
                      connection={connection}
                      mapRoute={mapRoute}
                      vehicle={vehicle}
                      ended={ended}
                      loading={loading}
                      onRetryData={retry}
                    />
                  ) : (
                    <View
                      style={{
                        height: 276,
                        borderRadius: 22,
                        backgroundColor: scheme.surfaceContainerLow,
                      }}
                    />
                  )}
                  {itineraryBlock}
                </>
              )}

              {errorBanner}
            </ScrollView>
          </>
        )}
      </View>
    </View>
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
  mediumConstrained: {
    width: '100%',
    maxWidth: 740,
    alignSelf: 'center',
  },
  desktopContainer: {
    width: '100%',
    maxWidth: 1320,
    alignSelf: 'center',
    paddingHorizontal: 28,
    paddingTop: 16,
    paddingBottom: 20,
    gap: 14,
  },
  desktopHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  desktopSplit: {
    flex: 1,
    flexDirection: 'row',
    gap: 24,
    minHeight: 0,
  },
  desktopLeftContent: {
    gap: 14,
  },
  desktopRightCol: {
    flex: 1,
    minWidth: 0,
    minHeight: 0,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  backBtn: {
    width: 44,
    height: 44,
    borderRadius: 14,
    backgroundColor: scheme.surfaceContainerHigh,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: scheme.outlineVariant,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerText: {
    flex: 1,
    minWidth: 0,
    gap: 1,
  },
  headerTitle: {
    fontSize: 18,
    lineHeight: 22,
    fontWeight: '800',
    letterSpacing: -0.3,
    color: scheme.onSurface,
  },
  headerSubtitle: {
    ...type.bodySmall,
    color: scheme.onSurfaceVariant,
  },
  actionCluster: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    padding: 4,
    borderRadius: 18,
    backgroundColor: scheme.surfaceContainerHigh,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: scheme.outlineVariant,
  },
  clusterBtn: {
    width: 40,
    height: 40,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  clusterBtnActive: {
    backgroundColor: scheme.primaryContainer,
  },
  clusterBtnLocked: {
    opacity: 0.48,
  },
  content: {
    paddingHorizontal: 14,
    paddingTop: 4,
    gap: 14,
  },
  followCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 14,
    borderRadius: 22,
    backgroundColor: scheme.surfaceContainer,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: scheme.outlineVariant,
    ...elev.level1,
  },
  followCardActive: {
    backgroundColor: scheme.surfaceContainerHigh,
    borderColor: scheme.primary,
  },
  followIconWrap: {
    width: 42,
    height: 42,
    borderRadius: 14,
    backgroundColor: scheme.secondaryContainer,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  followIconWrapActive: {
    backgroundColor: scheme.primaryContainer,
  },
  followCopy: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  followTitle: {
    ...type.titleSmall,
    fontWeight: '700',
    color: scheme.onSurface,
  },
  followBody: {
    ...type.bodySmall,
    color: scheme.onSurfaceVariant,
    lineHeight: 17,
  },
  followChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    minHeight: 38,
    paddingHorizontal: 13,
    borderRadius: shape.full,
    backgroundColor: scheme.primary,
    flexShrink: 0,
  },
  followChipActive: {
    backgroundColor: scheme.secondaryContainer,
  },
  followChipText: {
    ...type.labelMedium,
    fontWeight: '700',
    color: scheme.onPrimary,
  },
  followChipTextActive: {
    color: scheme.onSecondaryContainer,
  },
  emptyWrap: {
    flex: 1,
    justifyContent: 'center',
    padding: 20,
  },
  emptyCard: {
    borderRadius: shape.extraLarge,
    backgroundColor: scheme.surfaceContainer,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: scheme.outlineVariant,
    padding: 24,
    gap: 12,
    alignItems: 'center',
    maxWidth: 420,
    width: '100%',
    alignSelf: 'center',
    ...elev.level1,
  },
  emptyIconBadge: {
    width: 56,
    height: 56,
    borderRadius: 18,
    backgroundColor: scheme.secondaryContainer,
    alignItems: 'center',
    justifyContent: 'center',
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
    backgroundColor: scheme.surfaceContainer,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: scheme.outlineVariant,
    padding: 18,
    gap: 14,
    ...elev.level1,
  },
  cityCardHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
  },
  cityIconWrap: {
    width: 44,
    height: 44,
    borderRadius: 14,
    backgroundColor: scheme.primaryContainer,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  cityTextCol: {
    flex: 1,
    minWidth: 0,
    gap: 3,
  },
  cityCardTitle: {
    ...type.titleMedium,
    fontWeight: '700',
    color: scheme.onSurface,
  },
  cityCardText: {
    ...type.bodyMedium,
    color: scheme.onSurfaceVariant,
    lineHeight: 20,
  },
  itinerarySection: {
    gap: 10,
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
    fontSize: 16,
    lineHeight: 20,
    fontWeight: '800',
    letterSpacing: -0.2,
    color: scheme.onSurface,
  },
  loadingChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: shape.full,
    backgroundColor: scheme.surfaceContainer,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: scheme.outlineVariant,
    maxWidth: '100%',
  },
  loadingText: {
    ...type.labelSmall,
    color: scheme.onSurfaceVariant,
    fontWeight: '600',
    flexShrink: 1,
  },
  retryCard: {
    borderRadius: shape.extraLarge,
    backgroundColor: scheme.surfaceContainer,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: scheme.outlineVariant,
    padding: 16,
    gap: 12,
  },
  retryText: {
    ...type.bodyMedium,
    color: scheme.onSurfaceVariant,
    lineHeight: 20,
  },
  primaryBtn: {
    minHeight: 48,
    paddingHorizontal: 22,
    paddingVertical: 12,
    borderRadius: shape.full,
    backgroundColor: scheme.primary,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    alignSelf: 'stretch',
  },
  primaryBtnText: {
    ...type.labelLarge,
    fontWeight: '700',
    color: scheme.onPrimary,
    textAlign: 'center',
  },
  tonalBtn: {
    minHeight: 46,
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: shape.full,
    backgroundColor: scheme.secondaryContainer,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  tonalBtnText: {
    ...type.labelLarge,
    fontWeight: '700',
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
  disabled: {
    opacity: 0.55,
  },
});
