import { getNotifications } from './module';
import { isStopAction } from './categories';

// Odpowiedź konsumujemy raz. Wiek powiadomienia nie określa czasu tapnięcia.

const LINK_KEYS = ['fromTitle', 'fromLat', 'fromLon', 'toId', 'toTitle', 'toLat', 'toLon', 'open'];

export interface TripResponse {
  /** Dane do nawigacji - null, gdy to nie powiadomienie podróży. */
  link: Record<string, string> | null;
  /** Użytkownik wcisnął „Zakończ śledzenie”. */
  stop: boolean;
  /** Który alert: 'lead' | 'imminent' | 'disruption' | 'arrived' | null. */
  alert: string | null;
}

const EMPTY: TripResponse = { link: null, stop: false, alert: null };

function parseData(data: unknown, actionIdentifier: string | undefined): TripResponse {
  if (!data || typeof data !== 'object') return EMPTY;
  const d = data as Record<string, unknown>;
  if (d.kind !== 'trip') return EMPTY;
  const stop = isStopAction(actionIdentifier);

  const link: Record<string, string> = {};
  for (const k of LINK_KEYS) {
    const v = d[k];
    if (typeof v === 'string') link[k] = v;
  }
  return {
    link: link.toLat && link.toLon ? link : null,
    stop,
    alert: typeof d.alert === 'string' ? d.alert : null,
  };
}

const handledResponses = new Set<string>();

function consumeResponse(res: import('expo-notifications').NotificationResponse): TripResponse {
  const key = `${res.notification.request.identifier}:${res.notification.date}:${res.actionIdentifier}`;
  if (handledResponses.has(key)) return EMPTY;
  handledResponses.add(key);
  return parseData(res.notification.request.content.data, res.actionIdentifier);
}

/** Ostatnia odpowiedź (cold start po tapsięciu powiadomienia). */
export async function getLastTripResponse(): Promise<TripResponse> {
  const N = getNotifications();
  if (!N) return EMPTY;
  try {
    const res = await N.getLastNotificationResponseAsync();
    if (!res) return EMPTY;
    const parsed = consumeResponse(res);
    await N.clearLastNotificationResponseAsync();
    return parsed;
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
      cb(consumeResponse(res));
      void N.clearLastNotificationResponseAsync().catch(() => {});
    });
    return () => sub.remove();
  } catch {
    return () => {};
  }
}
