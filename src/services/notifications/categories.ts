import { getNotifications } from './module';

// Kategorie powiadomień = przyciski akcji (iOS) oraz app actions (Android).
// Dzięki nim użytkownik nie musi otwierać aplikacji, żeby zakończyć
// śledzenie albo zobaczyć trasę — to najczęstsze reakcje na alert odjazdu.

export const TRIP_CATEGORY = 'kilometr.trip';
export const ALERT_CATEGORY = 'kilometr.alert';

export const ACTION_STOP = 'kilometr.action.stop';
export const ACTION_OPEN_ROUTES = 'kilometr.action.routes';

export const DEFAULT_ACTION = 'default';

/** Czy akcja pochodzi z powiadomienia (a nie zwykłego tapnięcia). */
export function isStopAction(actionIdentifier: string | undefined): boolean {
  return actionIdentifier === ACTION_STOP;
}

export function isOpenRoutesAction(actionIdentifier: string | undefined): boolean {
  return actionIdentifier === ACTION_OPEN_ROUTES || actionIdentifier === DEFAULT_ACTION;
}

export async function setupNotificationCategories(): Promise<void> {
  const N = getNotifications();
  if (!N) return;
  // Android też umie akcje w powiadomieniu (trzyma je w SharedPreferences
  // i dokłada jako app actions), więc rejestrujemy na obu platformach.
  try {
    await N.setNotificationCategoryAsync(TRIP_CATEGORY, [
      {
        identifier: ACTION_STOP,
        buttonTitle: 'Zakończ śledzenie',
        options: { isDestructive: true },
      },
      {
        identifier: ACTION_OPEN_ROUTES,
        buttonTitle: 'Pokaż trasę',
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
        buttonTitle: 'Pokaż połączenia',
      },
    ]);
  } catch {
    // jw.
  }
}
