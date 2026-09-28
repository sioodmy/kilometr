import { Platform } from 'react-native';
import { getNotifications } from './module';

// Kanały powiadomień na Androidzie.
//
// Kanał to decyzja użytkownika raz na zawsze: system zapisuje ważność przy
// pierwszym utworzeniu i później jej nie zmienia. Dlatego rozdzielamy
// „śledzenie podróży” (cicha, trwała aktualizacja w trayu) od „alertów”
// (głośne, przerywające) — inaczej użytkownik musiałby wybrać między
// przydatnym odliczaniem a słyszeniem, kiedy wychodzić.

export const TRACKING_CHANNEL_ID = 'kilometr.tracking';
export const ALERTS_CHANNEL_ID = 'kilometr.alerts';

const TRACKING_CHANNEL_NAME = 'Śledzenie podróży';
const ALERTS_CHANNEL_NAME = 'Alerty odjazdu';

/**
 * Kanały muszą istnieć ZANIM poprosimy o pozwolenie — na Androidzie 13+
 * prompt o powiadomienia pojawia się dopiero po utworzeniu pierwszego kanału.
 * Stąd wołanie z `app/_layout` przy starcie, a nie przy przypięciu trasy.
 */
export async function setupNotificationChannels(): Promise<void> {
  const N = getNotifications();
  if (!N || Platform.OS !== 'android') return;
  try {
    await N.setNotificationChannelAsync(TRACKING_CHANNEL_ID, {
      name: TRACKING_CHANNEL_NAME,
      description: 'Odliczanie do odjazdu i postęp podróży. Bez dźwięku.',
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
      name: ALERTS_CHANNEL_NAME,
      description: '„Wyjdź teraz”, opóźnienia i zmiany kursu. Z dźwiękiem.',
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
