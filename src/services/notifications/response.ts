import { Linking } from 'react-native';
import { getNotifications } from './module';
import { ACTION_OPEN_ROUTES, ACTION_STOP, isStopAction } from './categories';

// Reakcja na tapnięcie powiadomienia i na przyciski akcji. Trzy zdarzenia:
// otwarcie trasy (domyślne), „zakończ śledzenie” oraz powiadomienie
// przyszłe (po restarcie procesu), którego tap musi jeszcze zrobić własne
// zapytanie o `getLastNotificationResponseAsync`.

export interface TripResponse {
  /** Dane do nawigacji — null, gdy to nie powiadomienie podróży. */
  link: Record<string, string> | null;
  /** Użytkownik wcisnął „Zakończ śledzenie”. */
  stop: boolean;
  /** Który alert: 'lead' | 'imminent' | 'disruption' | 'arrived' | null. */
  alert: string | null;
}

const EMPTY: TripResponse = { link: null, stop: false, alert: null };

function parseData(data: unknown, actionIdentifier: string | undefined): TripResponse {
  if (!data || typeof data !== 'object') {
    return { ...EMPTY, stop: isStopAction(actionIdentifier) };
  }
  const d = data as Record<string, unknown>;
  if (d.kind !== 'trip') return { ...EMPTY, stop: isStopAction(actionIdentifier) };

  const link: Record<string, string> = {};
  for (const k of ['fromTitle', 'fromLat', 'fromLon', 'toId', 'toTitle', 'toLat', 'toLon']) {
    const v = d[k];
    if (typeof v === 'string') link[k] = v;
  }
  return {
    link: link.toLat && link.toLon ? link : null,
    stop: isStopAction(actionIdentifier),
    alert: typeof d.alert === 'string' ? d.alert : null,
  };
}

/** Ostatnia odpowiedź (cold start po tapsięciu powiadomienia). */
export async function getLastTripResponse(): Promise<TripResponse> {
  const N = getNotifications();
  if (!N) return EMPTY;
  try {
    const res = await N.getLastNotificationResponseAsync();
    if (!res) return EMPTY;
    return parseData(res.notification.request.content.data, res.actionIdentifier);
  } catch {
    return EMPTY;
  }
}

/** Subskrypcja reakcji. Zwraca funkcję odsubskrybującą. */
export function addTripResponseListener(cb: (res: TripResponse) => void): () => void {
  const N = getNotifications();
  if (!N) return () => {};
  try {
    const sub = N.addNotificationResponseReceivedListener((res) => {
      cb(parseData(res.notification.request.content.data, res.actionIdentifier));
    });
    return () => sub.remove();
  } catch {
    return () => {};
  }
}

/** Otwiera deep link z powiadomienia (Live Activity też raportuje się tak). */
export async function openTripLink(link: Record<string, string> | null): Promise<boolean> {
  if (!link) return false;
  const q = new URLSearchParams(link).toString();
  try {
    await Linking.openURL(`kilometr://routes?${q}`);
    return true;
  } catch {
    return false;
  }
}

export { ACTION_OPEN_ROUTES, ACTION_STOP };
