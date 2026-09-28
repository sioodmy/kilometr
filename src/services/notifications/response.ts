import { getNotifications } from './module';
import { isStopAction } from './categories';

// Reakcja na tapnięcie powiadomienia i na przyciski akcji.
//
// `getLastNotificationResponseAsync` zwraca ostatnią odpowiedź w CAŁEJ
// historii procesu, nie „ostatnią w ciągu minuty" — a proces po restarcie
// telefonu bywa żywy godzinami. Dlatego każde powiadomienie podróży nosi
// znacznik czasu i starsze odpowiedzi ignorujemy, zamiast otwierać ekran
// połączeń na starcie aplikacji.

/** Po tym czasie odpowiedź uznajemy za nieaktualną. */
const RESPONSE_TTL_MS = 5 * 60 * 1000;

const LINK_KEYS = ['fromTitle', 'fromLat', 'fromLon', 'toId', 'toTitle', 'toLat', 'toLon'];

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
  const stop = isStopAction(actionIdentifier);
  if (!data || typeof data !== 'object') return { ...EMPTY, stop };
  const d = data as Record<string, unknown>;
  if (d.kind !== 'trip') return { ...EMPTY, stop };

  const at = typeof d.at === 'number' ? d.at : 0;
  if (!at || Date.now() - at > RESPONSE_TTL_MS) return { ...EMPTY, stop };

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
