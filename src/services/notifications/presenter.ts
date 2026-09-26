import { Platform } from 'react-native';
import {
  getNotifications,
  getTrackingNative,
  isNativeTrackingSupported,
  TRACKING_NOTIFICATION_ID,
} from './module';
import { TRACKING_CHANNEL_ID } from './channels';
import { TRIP_CATEGORY } from './categories';
import { buildActivityProps, buildNativeState, buildTripCopy, buildTripLink } from './content';
import {
  dismissTripActivity,
  isLiveActivitySupported,
  presentTripActivity,
} from './liveActivity/controller';
import type { NotificationPreferences, TripProgress, TrackedTrip } from './types';

// Wystawienie stanu podróży na wszystkich powierzchniach naraz. Wybór
// nośnika jest automatyczny, ale z jawnym powodem: na Androidzie preferujemy
// natywną powiadomienie (pasek postępu + chronometr liczony przez system),
// a expo-notifications zostaje jako awaryjny wariant; na iOS to Live Activity.

// ─── Awaryjne powiadomienie przez expo-notifications ──────────────────────
// Bez paska postępu i bez chronometru, ale z subtitle, wątkiem i kategorią —
// działa zawsze tam, gdzie zadziała natywny kod.

async function presentFallback(p: TripProgress, trip: TrackedTrip): Promise<void> {
  const N = getNotifications();
  if (!N) return;
  const copy = buildTripCopy(p, trip.connection);
  try {
    // iOS nie ma odpowiednika „update in place” dla lokalnych powiadomień —
    // kolejne wywołania z tym samym identyfikatorem kumulowałyby się w
    // Centrum powiadomień. Android nadpisuje pozycję sam, więc tam zostawiamy
    // Update, żeby nie było okna bez powiadomienia.
    if (Platform.OS === 'ios') {
      await N.dismissNotificationAsync(TRACKING_NOTIFICATION_ID);
    }
    await N.scheduleNotificationAsync({
      identifier: TRACKING_NOTIFICATION_ID,
      content: {
        title: copy.title,
        subtitle: copy.subtitle,
        body: copy.body,
        categoryIdentifier: TRIP_CATEGORY,
        // Wątek grupuje aktualizacje tej samej podróży zamiast mnożyć je
        // na liście w Centrum powiadomień.
        ...(Platform.OS === 'ios' ? { threadIdentifier: trip.id } : {}),
        // Bez dźwięku: kanał śledzenia ma LOW, a banery przy każdym ticku
        // odliczania byłyby upierkliwe.
        sound: false,
        data: { kind: 'trip', link: buildTripLink(trip) },
        sticky: true,
        ...(Platform.OS === 'android' ? { color: copy.accentColor } : {}),
      },
      // Android: kanał bierze się z triggera, a `trigger: null` wylądowałby na
      // domyślnym (głośnym) kanale „Miscellaneous”. Sekundowy interwał to
      // najkrótszy niepowtarzalny trigger — wystarczy, żeby powiadomienie
      // pokazało się od razu, ale w cichym kanale śledzenia.
      trigger:
        Platform.OS === 'android'
          ? ({
              type: N.SchedulableTriggerInputTypes.TIME_INTERVAL,
              seconds: 1,
              repeats: false,
              channelId: TRACKING_CHANNEL_ID,
            } as const)
          : null,
    });
  } catch (err) {
    console.warn('[Powiadomienia] nie udało się odświeżyć powiadomienia:', err);
  }
}

async function dismissFallback(): Promise<void> {
  const N = getNotifications();
  if (!N) return;
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

// ─── Publiczne API ─────────────────────────────────────────────────────────

/** Wystawia / aktualizuje trwałą powiadomienie oraz Live Activity. */
export async function presentTrip(
  trip: TrackedTrip,
  p: TripProgress,
  prefs: NotificationPreferences,
): Promise<void> {
  if (!prefs.trackingEnabled) {
    await dismissTracking();
    return;
  }

  const link = buildTripLink(trip);

  if (Platform.OS === 'android') {
    const native = getTrackingNative();
    if (native) {
      try {
        const ok = await native.present(
          buildNativeState(p, trip.connection, link, isNativeTrackingSupported()),
        );
        if (ok) return;
      } catch (err) {
        console.warn('[Powiadomienia] natywna powiadomienie nie wyszła:', err);
      }
    }
  }

  if (isLiveActivitySupported() && prefs.liveProgressEnabled) {
    presentTripActivity(buildActivityProps(p), link);
    return;
  }

  await presentFallback(p, trip);
}

/** Zdejmuje powiadomienie śledzącą i kończy Live Activity. */
export async function dismissTracking(lingerSec = 0): Promise<void> {
  const native = getTrackingNative();
  if (native) {
    try {
      await native.dismiss();
    } catch {
      // jw.
    }
  }
  if (isLiveActivitySupported()) {
    dismissTripActivity(undefined, lingerSec);
  }
  await dismissFallback();
}
