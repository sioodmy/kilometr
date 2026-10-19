import { getNotifications, warnUnsupportedOnce } from './module';
import { setupNotificationCategories } from './categories';
import { setupNotificationChannels } from './channels';

// Jednorazowa konfiguracja powiadomień przy starcie aplikacji. Wołana z
// `app/_layout` — kanały MUSZĄ istnieć przed prośbą o pozwolenie (Android 13+
// pokazuje prompt dopiero po utworzeniu pierwszego kanału), więc nie czekamy
// na moment przypięcia trasy.

export function setupNotificationHandler(): void {
  const N = getNotifications();
  if (!N) return;
  try {
    N.setNotificationHandler({
      handleNotification: async (notification) => ({
        shouldPlaySound:
          notification.request.content.data?.kind === 'trip' &&
          typeof notification.request.content.data?.alert === 'string',
        shouldSetBadge: false,
        shouldShowBanner: true,
        shouldShowList: true,
      }),
    });
  } catch {
    // ignoruj — brak handlera oznacza tylko brak banerów w foregroundzie
  }
}

export async function setupNotifications(): Promise<void> {
  const N = getNotifications();
  if (!N) {
    warnUnsupportedOnce('Powiadomienia');
    return;
  }
  setupNotificationHandler();
  await setupNotificationCategories();
  await setupNotificationChannels();
}

export { setupNotificationCategories, setupNotificationChannels };
