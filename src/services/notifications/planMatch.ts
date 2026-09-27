import type { Connection } from '../../types/models';
import { normalizeName } from '../vehiclePosition';

// Dopasowanie świeżego planu do tego, co już śledzimy. Wydzielone z monitora,
// bo to czysta funkcja na danych z RAPTOR-a — dzięki temu da się ją
// przetestować bez react-native i bez bazy GTFS.

/** Ile przesunięcia odjazdu tolerujemy, gdy nie mamy trip_id do porównania. */
const LOOSE_WINDOW_SEC = 30 * 60;

function tripIdsOf(c: Connection): string[] {
  return c.legs.filter((l) => l.tripId).map((l) => l.tripId as string);
}

function transitLegsOf(c: Connection) {
  return c.legs.filter((l) => l.mode !== 'walk');
}

/** Podpis kursu: linie + przystanek startowy. Odporny na opóźnienie. */
function tripSignature(c: Connection): string | null {
  const legs = transitLegsOf(c);
  if (legs.length === 0) return null;
  const lines = legs.map((l) => (l.line || '?').trim().toUpperCase()).join('|');
  const first = legs[0];
  const stopId = first.fromStopId || normalizeName(first.fromStop);
  return `${lines}@${stopId}`;
}

/**
 * Znajduje w świeżym planie to samo połączenie, które już śledzimy. Bez tego
 * każde przeliczenie potrafi „przeskoczyć" na inny kurs, a użytkownik co
 * minutę widzi inną liczbę przystanków i inny odjazd.
 *
 * Kolejność kryteriów:
 *  1. ten sam zestaw trip_id — jednoznaczne, RAPTOR daje je zawsze dla
 *     odcinków pojazdowych, więc to rozwiązuje zdecydowaną większość;
 *  2. ten sam podpis kursu (linie + przystanek startowy) w oknie pół godziny
 *     — łapie plan z cache albo renormalizację, gdzie trip_id zniknęło;
 *  3. dokładnie ten sam odjazd — tylko gdy podpisu nie mamy (brak danych).
 *
 * Świadomie NIE dopasowujemy po samym odjeździe: dwie linie mogą odjechać
 * w tej samej minucie, a przeskoczenie z „Tramwaj 4" na „Tramwaj 12" w
 * środku podróży jest gorsze niż brak dopasowania.
 */
export function matchTrackedConnection(
  conns: Connection[],
  committed: Connection,
): Connection | null {
  const committedTrips = tripIdsOf(committed);
  if (committedTrips.length > 0) {
    const sameTrip = conns.find((c) => {
      const ids = tripIdsOf(c);
      return ids.length > 0 && ids.every((id) => committedTrips.includes(id));
    });
    if (sameTrip) return sameTrip;
  }

  const signature = tripSignature(committed);
  if (signature) {
    const sameShape = conns
      .filter(
        (c) =>
          tripSignature(c) === signature &&
          Math.abs(c.departureSec - committed.departureSec) <= LOOSE_WINDOW_SEC,
      )
      .sort(
        (a, b) =>
          Math.abs(a.departureSec - committed.departureSec) -
          Math.abs(b.departureSec - committed.departureSec),
      );
    return sameShape[0] ?? null;
  }

  return conns.find((c) => c.departureSec === committed.departureSec) ?? null;
}

/** Kurs, którym właśnie jedziemy — gdy plan już go nie zawiera. */
export function connectionInProgress(conns: Connection[], nowSec: number): Connection | null {
  const ongoing = conns.filter((c) => {
    const end = c.departureSec + c.durationMin * 60;
    return c.departureSec <= nowSec + 60 && end > nowSec;
  });
  if (ongoing.length === 0) return null;
  return ongoing.sort((a, b) => a.departureSec - b.departureSec)[0];
}

/** Najbliższy odjazd, na który jeszcze zdążymy (z krótką grzecznością). */
export function nextDeparture(
  conns: Connection[],
  nowSec: number,
  graceSec: number,
): Connection | null {
  const future = conns
    .filter((c) => c.departureSec > nowSec - graceSec)
    .sort((a, b) => a.departureSec - b.departureSec);
  return future[0] ?? null;
}

/**
 * Wybór kursu po odświeżeniu planu — cała polityka w jednym miejscu.
 *
 * Kolejność:
 *  1. ten sam kurs (`trip_id`, a w razie jego braku podpis) — zawsze wygrywa,
 *     dzięki temu opóźnienie nie zmienia pokazywanego odjazdu;
 *  2. dopóki śledzony odjazd nie minął, zostajemy przy nim, nawet jeśli planer
 *     go nie zwrócił. Bez tego powiadomienie co odświeżenie potrafiło przeskoczyć
 *     na inny kurs: użytkownik śledził Tramwaj 10 o 04:01, a planer odpowiadał
 *     tylko „najbliższym" 03:57, więc pysk zmieniał się z „Idź na przystanek"
 *     na „Czekaj na pojazd", liczba przystanków skakała 4↔5, a godzina odjazdu
 *     w karcie nie zgadzała się z odliczanym licznikiem;
 *  3. po odjeździe (z grzecznością na wsiadanie): kurs, którym właśnie jedziemy,
 *     a dopiero gdy żadnego nie ma — następny.
 *
 * Świadomie zostajemy przy starym planie zamiast przeskakiwać: użytkownik
 * świadomie wcisnął „Śledź ten kurs", więc stabilność jest tu wartością, a
 * najbliższy kurs tylko ostatnim wyborem. Utracone odjazdy i tak kończą się
 * w `refresh()` po pół godziny od planowanego odjazdu.
 */
export function resolveTrackedConnection(
  conns: Connection[],
  committed: Connection,
  nowSec: number,
  graceSec: number,
): Connection | null {
  if (conns.length === 0) return null;

  const match = matchTrackedConnection(conns, committed);
  if (match) return match;

  if (committed.departureSec > nowSec - graceSec) return committed;

  return connectionInProgress(conns, nowSec) ?? nextDeparture(conns, nowSec, graceSec);
}
