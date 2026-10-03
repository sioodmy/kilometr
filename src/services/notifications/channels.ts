import { Platform } from 'react-native';
import { tr } from '../../i18n';
import { getNotifications } from './module';

// Kanały powiadomień na Androidzie.
//
// Kanał to decyzja użytkownika raz na zawsze: system zapisuje ważność przy
// pierwszym utworzeniu i później jej nie zmienia. Dlatego rozdzielamy
// „śledzenie podróży” (cicha, trwała aktualizacja w trayu) od „alertów”
// (głośne, przerywające) — inaczej użytkownik musiałby wybrać między
// przydatnym odliczaniem a słyszeniem, kiedy wychodzić.
//
// Identyfikator `TRACKING_CHANNEL_ID` jest też używany po stronie natywnej
// (`LiveUpdateFactory.CHANNEL_ID`) — ten sam kanał dla powiadomienia z
// serwisu i dla wariantu awaryjnego z expo-notifications.

export const TRACKING_CHANNEL_ID = 'kilometr.tracking';
export const ALERTS_CHANNEL_ID = 'kilometr.alerts';

/**
 * Kanały muszą istnieć ZANIM poprosimy o pozwolenie — na Androidzie 13+
 * prompt o powiadomienia pojawia się dopiero po utworzeniu pierwszego kanału.
 * Stąd wołanie z `app/_layout` przy starcie, a nie przy przypięciu trasy.
 */
export async function setupNotificationChannels(): Promise<void> {
  const N = getNotifications();
  if (!N || Platform.OS !== 'android') return;
  const s = tr().notification;
  try {
    await N.setNotificationChannelAsync(TRACKING_CHANNEL_ID, {
      name: s.channelTracking,
      description: s.channelTrackingDesc,
      importance: N.AndroidImportance.LOW,
      lockscreenVisibility: N.AndroidNotificationVisibility.PUBLIC,
      showBadge: false,
      enableVibrate: false,
      lightColor: '#5CDBBE',
    });
  } catch {
    // kanał opcjonalny — powiadomienie pokaże się i tak na domyślnym
  }
  try {
    await N.setNotificationChannelAsync(ALERTS_CHANNEL_ID, {
      name: s.channelAlerts,
      description: s.channelAlertsDesc,
      importance: N.AndroidImportance.HIGH,
      lockscreenVisibility: N.AndroidNotificationVisibility.PUBLIC,
      showBadge: true,
      enableVibrate: true,
      vibrationPattern: [0, 220, 160, 220],
      lightColor: '#FFB957',
    });
  } catch {
    // jw.
  }
}