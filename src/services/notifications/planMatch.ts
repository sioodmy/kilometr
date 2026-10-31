import {
  BinaryReader,
  BinaryWriter,
  CMD_PLAN_MATCH,
  invokeRustSync,
} from '../../../modules/kilometr-raptor';
import type { Connection } from '../../types/models';
import { normalizeName } from '../vehiclePosition';

// Dopasowanie świeżego planu do tego, co już śledzimy. Wydzielone z monitora,
// bo to czysta funkcja na danych z RAPTOR-a - dzięki temu da się ją
// przetestować bez react-native i bez bazy GTFS.

/** Ile przesunięcia odjazdu tolerujemy, gdy nie mamy trip_id do porównania. */
const LOOSE_WINDOW_SEC = 30 * 60;

/**
 * Ile przesunięcia uznajemy jeszcze za opóźnienie tego samego kursu.
 *
 * Odróżniamy dwie rzeczy, które wyglądają podobnie: tramwaj ten sam, który
 * spóźnił się o kilka minut, i tramwaj tej samej linii, który po prostu
 * odjeżdża później. Przy oknie 15 minut tramwaje o takcie 10-15 min
 * potrafiły przeskakiwać na następny odjazd (np. 10:35 spóźniony o 2 min
 * przeskakiwał na 10:50). Wąskie okno 5 minut chroni przed skokiem na kolejny
 * kurs w rozkładzie, gdy nie ma trip_id.
 */
const DELAY_WINDOW_SEC = 5 * 60;

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
 * każde przeliczenie potrafi „przeskoczyć” na inny kurs, a użytkownik co
 * minutę widzi inną liczbę przystanków i inny odjazd.
 */
export function matchTrackedConnection(
  conns: Connection[],
  committed: Connection,
  windowSec: number = LOOSE_WINDOW_SEC,
): Connection | null {
  if (conns.length === 0) return null;

  // 1. Te same trip_id we wszystkich odcinkach (gdy planer je ma) - 100% pewności.
  const committedTrips = tripIdsOf(committed);
  if (committedTrips.length > 0) {
    const exact = conns.find((c) => {
      const ids = tripIdsOf(c);
      return (
        ids.length === committedTrips.length &&
        ids.every((id, i) => id === committedTrips[i])
      );
    });
    if (exact) return exact;
  }

  // 2. Jeśli przynajmniej jeden wspólny odcinek ma ten sam trip_id (np. przesiadka
  // z jednym kursem niezmiennym) - to wciąż ten sam przejazd.
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
      .filter((c) => {
        if (tripSignature(c) !== signature) return false;
        const ids = tripIdsOf(c);
        // Jeśli oba plany mają znane trip_id i są różne, to na pewno różne kursy!
        if (committedTrips.length > 0 && ids.length > 0) {
          return ids.every((id) => committedTrips.includes(id));
        }
        return Math.abs(c.departureSec - committed.departureSec) <= windowSec;
      })
      .sort(
        (a, b) =>
          Math.abs(a.departureSec - committed.departureSec) -
          Math.abs(b.departureSec - committed.departureSec),
      );
    return sameShape[0] ?? null;
  }

  if (committedTrips.length === 0) {
    return conns.find((c) => c.departureSec === committed.departureSec) ?? null;
  }
  return null;
}

/** Kurs, którym właśnie jedziemy - gdy plan już go nie zawiera. */
function connectionInProgress(conns: Connection[], nowSec: number): Connection | null {
  const ongoing = conns.filter((c) => {
    const end = c.departureSec + c.durationMin * 60;
    return c.departureSec <= nowSec + 60 && end > nowSec;
  });
  if (ongoing.length === 0) return null;
  return ongoing.sort((a, b) => a.departureSec - b.departureSec)[0];
}

/**
 * Wybór kursu po odświeżeniu planu - cała polityka w jednym miejscu.
 *
 * Kolejność:
 *  1. ten sam kurs (`trip_id`, a w razie jego braku podpis w wąskim oknie) - zawsze wygrywa,
 *     dzięki temu opóźnienie nie zmienia pokazywanego odjazdu;
 *  2. dopóki śledzony odjazd nie minął, zostajemy przy nim, nawet jeśli planer
 *     go nie zwrócił. Bez tego powiadomienie co odświeżenie potrafiło przeskoczyć
 *     na inny kurs: użytkownik śledził Tramwaj 10 o 04:01, a planer odpowiadał
 *     tylko „najbliższym” 03:57, więc pysk zmieniał się z „Idź na przystanek”
 *     na „Czekaj na pojazd”, liczba przystanków skakała 4↔5, a godzina odjazdu
 *     w karcie nie zgadzała się z odliczanym licznikiem;
 *  3. po odjeździe (z grzecznością na wsiadanie): kurs, którym właśnie jedziemy na tej
 *     samej trasie / linii;
 *  4. w przeciwnym razie ZAWSZE zachowujemy śledzony kurs (committed) — nigdy
 *     nie przeskakujemy na kolejny odjazd w przyszłości!
 */
export function resolveTrackedConnection(
  conns: Connection[],
  committed: Connection,
  nowSec: number,
  graceSec: number,
): Connection | null {
  if (conns.length === 0) return null;

  const packed = new BinaryWriter(64 + conns.length * 48);
  packed
    .u8Val(1)
    .i32(nowSec | 0)
    .i32(graceSec | 0)
    .u8Val(1);
  packPlanConn(packed, committed, 0);
  packed.u32(conns.length);
  for (let i = 0; i < conns.length; i++) packPlanConn(packed, conns[i], i);
  const res = invokeRustSync(CMD_PLAN_MATCH, packed.finish());
  if (res && res.byteLength >= 5) {
    const r = new BinaryReader(res);
    const status = r.u8Val();
    const idx = r.u32();
    if (status === 1) return committed;
    if (status === 2) return conns[idx] ?? null;
    return null;
  }

  const stillAhead = committed.departureSec > nowSec - graceSec;

  const match = stillAhead
    ? matchTrackedConnection(conns, committed, DELAY_WINDOW_SEC)
    : matchTrackedConnection(conns, committed);
  if (match) return match;

  if (stillAhead) return committed;

  const inProgress = connectionInProgress(conns, nowSec);
  if (inProgress && tripSignature(inProgress) === tripSignature(committed)) {
    return inProgress;
  }

  return committed;
}

function packPlanConn(writer: BinaryWriter, c: Connection, idx: number): void {
  const dep = c.departureSec | 0;
  const dur = c.durationMin | 0;
  const signature = tripSignature(c) ?? '';
  const tripIds = tripIdsOf(c);

  writer.u32(idx);
  writer.i32(dep);
  writer.i32(dur);
  writer.str(signature);
  writer.u16(tripIds.length);
  for (const tid of tripIds) {
    writer.str(tid);
  }
}
