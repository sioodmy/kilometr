import { Platform } from 'react-native';
import {
  getNotifications,
  getTrackingNative,
  TRACKING_NOTIFICATION_ID,
  warnUnsupportedOnce,
} from './module';
import { TRACKING_CHANNEL_ID } from './channels';
import { TRIP_CATEGORY } from './categories';
import { tr } from '../../i18n';
import { buildLivePlanJson, buildTripCopy, tripNotificationData } from './content';
import { buildIOSLiveActivity } from './iosLiveActivity';
import { cancelScheduledAlerts, scheduleIOSTripAlerts } from './alerts';
import type { NotificationPreferences, TripProgress, TrackedTrip } from './types';

// Wywieszenie stanu podróży na powiadomieniu.
//
// Android dostaje natywne Live Update (`Notification.ProgressStyle` z
// segmentami podróży + serwis w pierwszym planie), a JS wysyła plan i nie
// dotyka go, dopóki planer nie zobaczy czegoś nowego. Licznik i pasek postępu
// tykają po stronie serwisu, więc powiadomienie żyje tak samo jak
// w nawigacji - także przy wyłączonym ekranie.
//
// `expo-notifications` zostaje wyłącznie jako wariant awaryjny: Expo Go,
// brak zgody na powiadomienia albo sytuacja, w której serwisu nie udało się
// podnieść. Wtedy pokazujemy zwykłe powiadomienie z tekstem - lepsze niż
// cisza.

/**
 * Ile zostawiamy „jesteś na miejscu" na ekranie blokady. Ten sam czas mierzy
 * `tripMonitor` zanim odetnie śledzenie - muszą się zgadzać, inaczej
 * powiadomienie zniknie w połowie komunikatu albo zostanie po nim.
 */
export { ARRIVED_LINGER_MS } from './content';

/**
 * Ostatni tekst bannera awaryjnego na iOS. Bez tego każdy tick (20-60 s)
 * robił dismiss + nowe powiadomienie i ten sam banner spadał na ekran
 * blokady w kółko.
 */
let lastFallbackText = '';

async function presentFallback(p: TripProgress, trip: TrackedTrip): Promise<void> {
  const N = getNotifications();
  if (!N) return;
  const copy = buildTripCopy(p, trip.connection, tr());
  const fallbackText = `${copy.title}\n${copy.subtitle ?? ''}\n${copy.body}`;
  if (Platform.OS === 'ios') {
    if (fallbackText === lastFallbackText) return;
    lastFallbackText = fallbackText;
  }
  try {
    if (Platform.OS === 'ios') await N.dismissNotificationAsync(TRACKING_NOTIFICATION_ID);
    // Android nadpisuje pozycję sam, więc zostawiamy Update - nie chcemy okna
    // bez powiadomienia między wywołaniami.
    await N.scheduleNotificationAsync({
      identifier: TRACKING_NOTIFICATION_ID,
      content: {
        title: copy.title,
        subtitle: copy.subtitle,
        body: copy.body,
        categoryIdentifier: TRIP_CATEGORY,
        sound: false,
        data: tripNotificationData(trip),
        sticky: true,
        ...(Platform.OS === 'android' ? { color: p.lineColor } : {}),
      },
      trigger: Platform.OS === 'android' ? { channelId: TRACKING_CHANNEL_ID } : null,
    });
  } catch (err) {
    console.warn('[Powiadomienia] nie udało się odświeżyć powiadomienia:', err);
  }
}

async function dismissFallback(): Promise<void> {
  const N = getNotifications();
  if (!N) return;
  lastFallbackText = '';
  try {
    await N.dismissNotificationAsync(TRACKING_NOTIFICATION_ID);
  } catch {
    // mogła nie istnieć
  }
  try {
    await N.cancelScheduledNotificationAsync(TRACKING_NOTIFICATION_ID);
  } catch {
    // jw.
  }
}

/** Wysyła plan podróży do natywnego Live Update. */
export async function presentTrip(
  trip: TrackedTrip,
  p: TripProgress,
  prefs: NotificationPreferences,
): Promise<void> {
  if (!prefs.trackingEnabled) {
    if (Platform.OS === 'ios') await cancelScheduledAlerts();
    await dismissTracking();
    return;
  }
  await scheduleIOSTripAlerts(p, trip).catch((error) => {
    console.warn('[Notifications] iOS schedule:', error);
  });

  const native = getTrackingNative();
  if (!native) {
    if (Platform.OS === 'android') warnUnsupportedOnce('Live Update');
    await presentFallback(p, trip);
    return;
  }

  if (await native.hasStopRequest?.()) return;

  // `liveProgressEnabled` wyłącza pasek postępu i licznik, ale nie samo
  // powiadomienie - zostaje wtedy zwykły banner z tekstem.
  if (!prefs.liveProgressEnabled && !trip.protectionEnabled) {
    try {
      await native.stopTrip();
    } catch {
      // jw.
    }
    await presentFallback(p, trip);
    return;
  }

  try {
    // Po przyjeździe serwis dostaje `stopAfterMs` i sam się wyłącza, więc
    // komunikat zostaje na ekranie blokady do końca, a nie znika z APK-iem.
    const json = Platform.OS === 'ios' ? buildIOSLiveActivity(p, trip, tr()) : buildLivePlanJson(p, trip.connection, trip, tr(), {
      alightAlertsEnabled: prefs.trackingEnabled,
      transferAlertsEnabled: prefs.disruptionAlertsEnabled,
    });
    if (await native.startTrip(json)) {
      await dismissFallback();
      return;
    }
  } catch (err) {
    console.warn('[Powiadomienia] natywne Live Update nie wystartowało:', err);
  }
  if (await native.hasStopRequest?.()) return;
  await presentFallback(p, trip);
}

/** Zdejmuje powiadomienie śledzące i zatrzymuje serwis. */
export async function dismissTracking(): Promise<void> {
  const native = getTrackingNative();
  if (native) {
    try {
      await native.stopTrip();
    } catch {
      // jw.
    }
  }
  await dismissFallback();
}
