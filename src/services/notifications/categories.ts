import { tr } from '../../i18n';
import { getNotifications } from './module';

// Kategorie powiadomień = przyciski akcji (iOS) oraz app actions (Android).
// Dzięki nim użytkownik nie musi otwierać aplikacji, żeby zakończyć
// śledzenie albo zobaczyć trasę — to najczęstsze reakcje na alert odjazdu.
//
// Na Androidzie te przyciski są wariantem awaryjnym: natywne Live Update
// dostaje własne akcje w `LiveUpdateFactory` (i obsługuje „Zakończ" bez
// otwierania aplikacji), a te katalogi obsługują expo-notifications.

export const TRIP_CATEGORY = 'kilometr.trip';
export const ALERT_CATEGORY = 'kilometr.alert';

export const ACTION_STOP = 'kilometr.action.stop';
export const ACTION_OPEN_ROUTES = 'kilometr.action.routes';

/** Czy użytkownik wcisnął „Zakończ śledzenie", a nie po prostu tapnął. */
export function isStopAction(actionIdentifier: string | undefined): boolean {
  return actionIdentifier === ACTION_STOP;
}

export async function setupNotificationCategories(): Promise<void> {
  const N = getNotifications();
  if (!N) return;
  const s = tr();
  // Android też umie akcje w powiadomieniu (trzyma je w SharedPreferences
  // i dokłada jako app actions), więc rejestrujemy na obu platformach.
  try {
    await N.setNotificationCategoryAsync(TRIP_CATEGORY, [
      {
        identifier: ACTION_STOP,
        buttonTitle: s.notification.actionStop,
        options: { isDestructive: true },
      },
      {
        identifier: ACTION_OPEN_ROUTES,
        buttonTitle: s.notification.actionRoute,
        options: { isDestructive: false },
      },
    ]);
  } catch {
    // kategorie są best-effort — bez nich powiadomienie nadal działa
  }
  try {
    await N.setNotificationCategoryAsync(ALERT_CATEGORY, [
      {
        identifier: ACTION_OPEN_ROUTES,
        buttonTitle: s.notification.showRoutes,
      },
    ]);
  } catch {
    // jw.
  }
}