import { Platform } from 'react-native';
import { tr } from '../../i18n';
import { kvGet, kvRemove, kvSet } from '../storage';
import { getNotifications, warnUnsupportedOnce } from './module';
import { ALERT_CATEGORY } from './categories';
import { ALERTS_CHANNEL_ID } from './channels';
import { buildTripCopy, tripNotificationData } from './content';
import { formatDistance } from './format';
import type { NotificationPreferences, TripProgress, TrackedTrip } from './types';

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

/**
 * Ids alertów trzymamy też w pamięci. Ten serwis woła planowanie przy każdym
 * odświeżeniu (co 20–30 s), więc czytanie i pisanie kv przy każdym ticku to
 * cztery operacje I/O na minutę bez żadnej korzyści.
 */
const memoryAlertIds = new Set<string>();
let alertIdsLoaded = false;

async function readAlertIds(): Promise<string[]> {
  if (alertIdsLoaded) return Array.from(memoryAlertIds);
  alertIdsLoaded = true;
  try {
    const raw = await kvGet(ALERT_IDS_KEY);
    if (raw) {
      for (const id of JSON.parse(raw) as string[]) memoryAlertIds.add(id);
    }
  } catch {
    // brak zapisu
  }
  return Array.from(memoryAlertIds);
}

async function writeAlertIds(ids: string[]): Promise<void> {
  memoryAlertIds.clear();
  for (const id of ids) memoryAlertIds.add(id);
  try {
    await kvSet(ALERT_IDS_KEY, JSON.stringify(ids.slice(-12)));
  } catch {
    // ignorujemy — wycieki identyfikatorów kosztują tylko banner po restarcie
  }
}

/**
 * Usuwa wszystkie alerty podróży: i te zaplanowane, i te, które już się
 * pokazały. samo `cancelScheduledNotificationAsync` wystarcza tylko dla
 * oczekujących — po „Wyjdź teraz" baner zostaje na ekranie blokady, a użytkownik
 * właśnie zakończył śledzenie i nie powinien dostawać przypomnień o kursie,
 * który go nie dotyczy.
 */
export async function cancelScheduledAlerts(): Promise<void> {
  const N = getNotifications();
  const ids = await readAlertIds();
  if (N) {
    for (const id of ids) {
      try {
        await N.cancelScheduledNotificationAsync(id);
      } catch {
        // mógł już zniknąć
      }
      try {
        await N.dismissNotificationAsync(id);
      } catch {
        // nie zdążył się pokazać
      }
    }
  }
  await kvRemove(ALERT_IDS_KEY);
  memoryAlertIds.clear();
  scheduledAt.clear();
  alertIdsLoaded = true;
}

/**
 * Ostatnio zaplanowany czas dla danego alertu. Planowanie wołujemy przy każdym
 * odświeżeniu, a godzina odjazdu zmienia się rzadko — bez tego pchaliśmy
 * cancel + schedule dwa razy co 20 s niepotrzebnie.
 */
const scheduledAt = new Map<string, number>();

function alreadyScheduled(id: string, atMs: number): boolean {
  return scheduledAt.get(id) === atMs;
}

function forgetSchedule(id: string): void {
  scheduledAt.delete(id);
}

async function cancelOne(id: string): Promise<void> {
  forgetSchedule(id);
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
  const s = tr();
  const n = s.notification;
  const copy = buildTripCopy(p, trip.connection, s);
  const service = p.line || n.modeTram;
  const title = imminent
    ? n.leaveNow(service, p.departAt)
    : n.leaveIn(leadMin, service, p.departAt);
  const walk =
    p.walkMeters != null && p.walkMeters > 0
      ? n.walkToStop(formatDistance(p.walkMeters))
      : null;
  return {
    title,
    body: [p.leg ? n.stopHere(p.leg.fromStop) : null, walk, copy.subtitle]
      .filter(Boolean)
      .join(' • '),
    data: tripNotificationData(trip, imminent ? 'imminent' : 'lead'),
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
  // Dźwięk na Androidzie pochodzi z kanału (alertów), więc `sound` ma znaczenie
  // tylko na iOS. Różnicujemy natomiast pilność: uprzedzenie to zwykłe
  // „aktywne" powiadomienie, a „wyjdź teraz" jest czasowo wrażliwe i ma
  // przebić się przez tryb „nie przeszkadzać" — kurs zaraz odjeżdża.
  const timeSensitive = kind === 'imminent';
  try {
    await N.scheduleNotificationAsync({
      identifier: id,
      content: {
        title: content.title,
        body: content.body,
        data: content.data,
        sound: 'default',
        categoryIdentifier: ALERT_CATEGORY,
        ...(Platform.OS === 'ios'
          ? { interruptionLevel: timeSensitive ? ('timeSensitive' as const) : ('active' as const) }
          : {}),
        ...(Platform.OS === 'android' ? { priority: 'high' as const, sticky: false } : {}),
      },
      trigger,
    });
    const ids = await readAlertIds();
    await writeAlertIds([...ids.filter((x) => x !== id), id]);
    scheduledAt.set(id, atMs);
  } catch (err) {
    console.warn('[Powiadomienia] nie udało się zaplanować alertu:', err);
  }
}

/**
 * Planuje alerty „wyjdź” na podstawie aktualnego stanu podróży. Wołane po
 * każdym odświeżeniu, ale przelicza się tylko wtedy, gdy coś się zmieniło:
 * godzina odjazdu (opóźnienie), wyprzedzenie w Ustawieniach albo pozycja
 * względem progu 20 s. W przeciwnym razie dwa razy co 20 s kasowalibyśmy
 * i od nowa planowali te same alerty.
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
  const wanted: { kind: AlertKind; atMs: number }[] = [
    { kind: 'lead', atMs: p.boardAtMs - leadSec * 1000 },
    { kind: 'imminent', atMs: p.boardAtMs - IMMINENT_LEAD_SEC * 1000 },
  ];

  for (const { kind, atMs } of wanted) {
    const id = alertId(kind, trip.id);
    const soon = atMs - nowMs > MIN_SCHEDULE_AHEAD_SEC * 1000;
    // Alert poza horyzontem, alert wyłączony albo identyczny z zaplanowanym
    // wcześniej — nie ruszamy niczego.
    if (!soon || (kind === 'imminent' && !prefs.imminentAlert) || alreadyScheduled(id, atMs)) {
      if (!soon) forgetSchedule(id);
      continue;
    }
    await schedule(p, trip, kind, atMs, prefs);
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
  const n = tr().notification;
  const body = [
    p.leg ? n.stopHere(p.leg.fromStop) : null,
    n.newDeparture(p.departAt),
    p.delayMin >= 2 ? n.delayLate(p.delayMin) : '',
  ]
    .filter(Boolean)
    .join(' • ');
  try {
    await N.scheduleNotificationAsync({
      identifier: alertId('disruption', trip.id),
      content: {
        title: n.delayTitle(p.line, tr().common.durMin(Math.max(1, p.departInSec / 60))),
        body,
        data: tripNotificationData(trip, 'disruption'),
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
  const s = tr();
  const copy = buildTripCopy(p, trip.connection, s);
  try {
    await N.scheduleNotificationAsync({
      identifier: alertId('arrived', trip.id),
      content: {
        title: copy.title,
        body: [copy.subtitle, copy.body].filter(Boolean).join(' • '),
        data: tripNotificationData(trip, 'arrived'),
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
