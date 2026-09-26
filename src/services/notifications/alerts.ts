import { Platform } from 'react-native';
import { kvGet, kvRemove, kvSet } from '../storage';
import { getNotifications, warnUnsupportedOnce } from './module';
import { ALERT_CATEGORY } from './categories';
import { ALERTS_CHANNEL_ID } from './channels';
import { buildTripLink, buildTripCopy } from './content';
import { delayText, minutesText, plural } from './format';import type { NotificationPreferences, TripProgress, TrackedTrip } from './types';

// Alerty odjazdu — odpowiednik tego, co Mapy Google robią przed trasą:
// „wyjdź za 5 minut”, potem „wyjdź teraz”, plus ostrzeżenie, gdy kurs się
// posypał. Kluczowe: harmonogram ustawiamy z wyprzedzeniem (DateTriggerInput),
// więc alarm zadzwoni nawet jeśli aplikacja jest w tle albo uśpiona —
// to, czego nie da się osiągnąć samym odświeżaniem co minutę.

const ALERT_IDS_KEY = 'kilometr.alertIds.v1';

/** Ile wyprzedzenia odprawiamy przed każdym odjazdem — w sekundach. */
const IMMINENT_LEAD_SEC = 90;
/** Minimalnie ile musi zostać do odjazdu, żeby w ogóle zaplanować alert. */
const MIN_SCHEDULE_AHEAD_SEC = 20;
/** Opóźnienie musi wzrosnąć o tyle, żeby obudzić użytkownika. */
const DELAY_ALERT_STEP_MIN = 3;

type AlertKind = 'lead' | 'imminent' | 'arrived' | 'disruption';

function alertId(kind: AlertKind, tripId: string): string {
  return `kilometr.alert.${kind}.${tripId}`;
}

async function readAlertIds(): Promise<string[]> {
  try {
    const raw = await kvGet(ALERT_IDS_KEY);
    if (raw) return JSON.parse(raw) as string[];
  } catch {
    // brak zapisu
  }
  return [];
}

async function writeAlertIds(ids: string[]): Promise<void> {
  try {
    await kvSet(ALERT_IDS_KEY, JSON.stringify(ids.slice(-12)));
  } catch {
    // ignorujemy — wycieki identyfikatorów kosztują tylko banner po restarcie
  }
}

/** Usuwa wszystkie zaplanowane alerty podróży (też po restarcie aplikacji). */
export async function cancelScheduledAlerts(): Promise<void> {
  const N = getNotifications();
  const ids = await readAlertIds();
  if (N && ids.length > 0) {
    for (const id of ids) {
      try {
        await N.cancelScheduledNotificationAsync(id);
      } catch {
        // mógł już zniknąć
      }
    }
  }
  await kvRemove(ALERT_IDS_KEY);
}

async function cancelOne(id: string): Promise<void> {
  const N = getNotifications();
  if (!N) return;
  try {
    await N.cancelScheduledNotificationAsync(id);
  } catch {
    // jw.
  }
}

/**
 * Wyzwalacz daty. Na Androidzie trzeba wskazać kanał, bo bez niego
 * powiadomienie trafiłoby do „Miscellaneous” (głośnego) zamiast na kanał
 * alertów. Kategorie (przyciski akcji) to już czysto iOS.
 */
function alertTrigger(atMs: number) {
  const N = getNotifications();
  if (!N) return null;
  const base = { type: N.SchedulableTriggerInputTypes.DATE, date: new Date(atMs) } as const;
  return Platform.OS === 'android' ? { ...base, channelId: ALERTS_CHANNEL_ID } : base;
}

/** Zawartość alertu „wyjdź”. Świadomie krótka — to banner na ekranie blokady. */
function leaveContent(p: TripProgress, trip: TrackedTrip, imminent: boolean, leadMin: number) {
  const copy = buildTripCopy(p, trip.connection);
  const title = imminent
    ? `Wyjdź teraz • ${p.line || 'pojazd'} ${p.departAt}`
    : `Wyjdź za ${leadMin} ${plural(leadMin, 'minutę', 'minuty', 'minut')} • ${p.line} ${p.departAt}`;
  const walk =
    p.walkMeters != null && p.walkMeters > 0
      ? `${Math.round(p.walkMeters)} ${p.walkMeters < 1000 ? 'm' : 'km'} do przystanku`
      : null;
  return {
    title,
    body: [p.leg ? `przystanek ${p.leg.fromStop}` : null, walk, copy.subtitle]
      .filter(Boolean)
      .join(' • '),
    data: {
      kind: 'trip',
      alert: imminent ? 'imminent' : 'lead',
      link: buildTripLink(trip),
    },
  };
}

async function schedule(
  p: TripProgress,
  trip: TrackedTrip,
  kind: AlertKind,
  atMs: number,
  prefs: NotificationPreferences,
): Promise<void> {
  const N = getNotifications();
  if (!N) {
    warnUnsupportedOnce('Alerty odjazdu');
    return;
  }
  const id = alertId(kind, trip.id);
  await cancelOne(id);
  const trigger = alertTrigger(atMs);
  if (!trigger) return;
  const content = leaveContent(p, trip, kind === 'imminent', prefs.departureAlertLeadMin);
  try {
    await N.scheduleNotificationAsync({
      identifier: id,
      content: {
        title: content.title,
        body: content.body,
        data: content.data,
        sound: kind === 'imminent' ? 'default' : 'default',
        categoryIdentifier: ALERT_CATEGORY,
        // Czas wrażliwy: bus/tramwaj odjeżdża, użytkownik musi to zobaczyć
        // nawet przy włączonym trybie „nie przeszkadzać” od czasu do czasu.
        ...(Platform.OS === 'ios' ? { interruptionLevel: 'timeSensitive' as const } : {}),
        ...(Platform.OS === 'android' ? { priority: 'high' as const, sticky: false } : {}),
      },
      trigger,
    });
    const ids = await readAlertIds();
    await writeAlertIds([...ids.filter((x) => x !== id), id]);
  } catch (err) {
    console.warn('[Powiadomienia] nie udało się zaplanować alertu:', err);
  }
}

/**
 * Planuje alerty „wyjdź” na podstawie aktualnego stanu podróży. Wołane po
 * każdym odświeżeniu — poprzednie alerty są najpierw kasowane, więc nie
 * nakłada się ich na siebie przy kolejnych przeliczeniach trasy.
 */
export async function scheduleDepartureAlerts(
  p: TripProgress,
  trip: TrackedTrip,
  prefs: NotificationPreferences,
): Promise<void> {
  if (!prefs.departureAlertsEnabled) {
    await cancelScheduledAlerts();
    return;
  }

  const nowMs = Date.now();
  const leadSec = prefs.departureAlertLeadMin * 60;
  const leadAt = p.boardAtMs - leadSec * 1000;
  const imminentAt = p.boardAtMs - IMMINENT_LEAD_SEC * 1000;

  if (leadAt - nowMs > MIN_SCHEDULE_AHEAD_SEC * 1000) {
    await schedule(p, trip, 'lead', leadAt, prefs);
  } else {
    await cancelOne(alertId('lead', trip.id));
  }

  if (prefs.imminentAlert && imminentAt - nowMs > MIN_SCHEDULE_AHEAD_SEC * 1000) {
    await schedule(p, trip, 'imminent', imminentAt, prefs);
  } else {
    await cancelOne(alertId('imminent', trip.id));
  }
}

/** Wysyła alert natychmiast (nie harmonogramowany) — np. o dużym opóźnieniu. */
export async function sendDisruptionAlert(
  p: TripProgress,
  trip: TrackedTrip,
  prefs: NotificationPreferences,
): Promise<boolean> {
  if (!prefs.disruptionAlertsEnabled) return false;
  const N = getNotifications();
  if (!N) return false;
  const body = [
    p.leg ? `przystanek ${p.leg.fromStop}` : null,
    `nowy odjazd ${p.departAt}`,
    p.delayMin >= 1 ? delayText(p.delayMin) : null,
  ]
    .filter(Boolean)
    .join(' • ');
  try {
    await N.scheduleNotificationAsync({
      identifier: alertId('disruption', trip.id),
      content: {
        title: `Opóźnienie • ${p.line} ${minutesText(Math.max(1, p.departInSec / 60))}`,
        body,
        data: { kind: 'trip', alert: 'disruption', link: buildTripLink(trip) },
        sound: 'default',
        categoryIdentifier: ALERT_CATEGORY,
        ...(Platform.OS === 'ios' ? { interruptionLevel: 'timeSensitive' as const } : {}),
        ...(Platform.OS === 'android' ? { priority: 'high' as const } : {}),
      },
      trigger: null,
    });
    return true;
  } catch (err) {
    console.warn('[Powiadomienia] alert o opóźnieniu nie wyszedł:', err);
    return false;
  }
}

/** Komunikat o zakończeniu podróży — zostawiamy go chwilę na ekranie blokady. */
export async function sendArrivedNotification(
  p: TripProgress,
  trip: TrackedTrip,
): Promise<void> {
  const N = getNotifications();
  if (!N) return;
  const copy = buildTripCopy(p, trip.connection);
  try {
    await N.scheduleNotificationAsync({
      identifier: alertId('arrived', trip.id),
      content: {
        title: copy.title,
        body: `${copy.subtitle} • ${copy.body}`,
        data: { kind: 'trip', alert: 'arrived', link: buildTripLink(trip) },
        sound: 'default',
        categoryIdentifier: ALERT_CATEGORY,
        ...(Platform.OS === 'ios' ? { interruptionLevel: 'active' as const } : {}),
        ...(Platform.OS === 'android' ? { priority: 'high' as const } : {}),
      },
      trigger: {
        type: N.SchedulableTriggerInputTypes.TIME_INTERVAL,
        seconds: 1,
        ...(Platform.OS === 'android' ? { channelId: ALERTS_CHANNEL_ID } : {}),
      },
    });
  } catch {
    // best-effort
  }
}

/** Czy opóźnienie wzrosło na tyle, że warto przerwać użytkownika. */
export function shouldAlertDelay(previousDelayMin: number, currentDelayMin: number): boolean {
  if (currentDelayMin < DELAY_ALERT_STEP_MIN) return false;
  return currentDelayMin - previousDelayMin >= DELAY_ALERT_STEP_MIN;
}
