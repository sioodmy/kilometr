import { gtfsStore } from './store';
import { filterParetoJourneys, runRaptor } from './raptor';
import { Connection, Leg, LegStop, RawJourney } from './types';
import { distanceMeters, secondsToTimeString } from '../../gtfs/geo';
import { liveTracker } from '../liveTracker';

// ────────────────────────────────────────────────────────────────────────────
// Parametry spacerowe (spójne z raptor.ts i store.ts)
// ────────────────────────────────────────────────────────────────────────────
const WALK_SPEED_MPS = 1.3;
const WALK_DETOUR_FACTOR = 1.3;
const MIN_WALK_LEG_METERS = 50;

/** Pełna sekwencja przystanków kursu (cała linia) z GTFS stop_times + stops. */
export async function buildTripStops(tripId: string): Promise<LegStop[]> {
  const mem = gtfsStore.stopTimes.get(tripId);
  const toLegStops = (times: { stop_id: string; arrival_sec: number; departure_sec: number; stop_sequence: number }[]) =>
    times.map((t) => {
      const s = gtfsStore.stops.get(t.stop_id);
      return {
        stopId: t.stop_id,
        name: s?.stop_name || t.stop_id,
        lat: s?.stop_lat,
        lon: s?.stop_lon,
        seq: t.stop_sequence,
        arriveSec: t.arrival_sec,
        departSec: t.departure_sec,
      };
    });
  if (mem && mem.length > 0) return toLegStops(mem);
  // Kurs spoza aktywnego wycinka (np. rozwinięcie starszego połączenia):
  // dociągnij z SQLite zamiast zwracać pustkę.
  try {
    const { getTripStopTimes } = await import('../gtfsDatabase');
    const rows = await getTripStopTimes(tripId);
    if (rows.length > 0) {
      return toLegStops(
        rows.map((r) => ({
          stop_id: r.stop_id,
          arrival_sec: r.arr_sec,
          departure_sec: r.dep_sec,
          stop_sequence: r.seq,
        })),
      );
    }
  } catch {
    // ignoruj — fallback niżej
  }
  return [];
}

/**
 * Rozgrzewka po starcie / imporcie: buduje wycinek na bieżącą porę w tle,
 * żeby pierwsze wyszukiwanie nie płaciło pełnego kosztu budowy indeksu.
 */
export async function warmupRouting(): Promise<void> {
  try {
    await gtfsStore.load();
    const now = new Date();
    const currentSec = now.getHours() * 3600 + now.getMinutes() * 60 + now.getSeconds();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, '0');
    const d = String(now.getDate()).padStart(2, '0');
    await gtfsStore.getDayIndexSlice(now.getDay(), `${y}${m}${d}`, currentSec - 1800, currentSec + 10800);
  } catch (err) {
    console.warn('[Routing] warmup failed:', err);
  }
}

/** Przystanki kursu TYLKO od boardStop do alightStop (to co użytkownik widzi). */
function buildLegStops(tripId: string, boardStopId: string, alightStopId: string): LegStop[] {
  // Legi pochodzą z aktywnego wycinka, więc kurs jest w pamięci (sync, bez IO).
  const times = gtfsStore.stopTimes.get(tripId);
  if (!times || times.length === 0) return [];
  const allStops: LegStop[] = times.map((t) => {
    const s = gtfsStore.stops.get(t.stop_id);
    return {
      stopId: t.stop_id,
      name: s?.stop_name || t.stop_id,
      lat: s?.stop_lat,
      lon: s?.stop_lon,
      seq: t.stop_sequence,
      arriveSec: t.arrival_sec,
      departSec: t.departure_sec,
    };
  });

  const boardIdx = allStops.findIndex((s) => s.stopId === boardStopId);
  const alightIdx = allStops.findIndex((s) => s.stopId === alightStopId);

  if (boardIdx < 0 || alightIdx < 0 || boardIdx >= alightIdx) return allStops;

  // Zwracamy przystanki od wsiadania do wysiadania (włącznie z obu)
  return allStops.slice(boardIdx, alightIdx + 1);
}

export interface PlanOptions {
  fromTitle: string;
  fromLat: number;
  fromLon: number;
  toTitle: string;
  toLat: number;
  toLon: number;
  toId?: string;
  departureTimeSec?: number;
  /** 0–3, default 2. 0 = tylko bezpośrednie. */
  maxTransfers?: number;
  /** sekundy, default 90. Minimalny czas na przesiadkę. */
  minTransferSec?: number;
  /** metry, default 800. Jak daleko wolno iść na przystanek / z przystanku. */
  maxWalkM?: number;
  /** m/s, default 1.3. Tempo chodzenia użytkownika. */
  walkSpeedMps?: number;
  /**
   * Preferowany przystanek startowy (kotwica). fromLat/fromLon to PRAWDZIWA
   * pozycja (GPS) — silnik liczy realny spacer do kotwicy i daje jej tylko
   * mały bonus rozstrzygający remisy, zamiast zerować koszt dojścia.
   */
  anchorStopId?: string;
  anchorStopLat?: number;
  anchorStopLon?: number;
}

/**
 * Odrzuca podróże, w których tramwaj/bus jest tylko ozdobnikiem:
 * jazda 0–1 przystanek, a potem długi spacer z buta. Taki wariant wygląda
 * absurdalnie ("wsiądź i od razu wysiądź") i przegrywa z samym spacerem
 * albo z dłuższą jazdą — więc w ogóle go nie proponujemy.
 */
function isPointlessShortRide(rj: RawJourney): boolean {
  const transitSegs = rj.segments.filter((s) => s.type === 'transit');
  for (const t of transitSegs) {
    if (t.stopsCount <= 0) return true;
  }
  if (transitSegs.length === 1 && transitSegs[0].stopsCount <= 1) {
    let totalWalkM = 0;
    for (const s of rj.segments) {
      if (s.type === 'walk') totalWalkM += s.walkMeters ?? 0;
    }
    const last = rj.segments[rj.segments.length - 1];
    const egressWalkM = last && last.type === 'walk' ? (last.walkMeters ?? 0) : 0;
    if (totalWalkM > 500 || egressWalkM > 350) return true;
  }
  return false;
}

/** Formatuj datę do YYYYMMDD (dla calendar_dates.txt). */
function toDateStr(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}${m}${d}`;
}

export async function planConnections(options: PlanOptions): Promise<Connection[]> {
  await gtfsStore.load();

  const now = new Date();
  const currentSec = now.getHours() * 3600 + now.getMinutes() * 60 + now.getSeconds();

  // departureTimeSec może wskazywać jutro (DepartureTimeSheet dodaje +86400).
  // RAPTOR jeździ po porze dnia, a offset dokładamy do wyników.
  const rawDep = Math.max(0, Math.round(options.departureTimeSec ?? currentSec));
  const dayOffsetSec = Math.floor(rawDep / 86400) * 86400;
  const departureSec = rawDep % 86400;
  const dayOffsetDays = Math.round(dayOffsetSec / 86400);
  const targetDate = new Date(now);
  targetDate.setDate(targetDate.getDate() + dayOffsetDays);
  const weekday = targetDate.getDay();
  const dateStr = toDateStr(targetDate);
  // Wycinek horyzontu zamiast pełnej doby: okna RAPTOR-a sięgają +3600 s,
  // a przesiadkowe nogi jeszcze dalej — bierzemy zapas do +3 h.
  const dayIndex = await gtfsStore.getDayIndexSlice(weekday, dateStr, departureSec - 1800, departureSec + 10800);

  const maxTransfers = Math.max(0, Math.min(3, Math.round(options.maxTransfers ?? 2)));
  const minTransferSec = Math.max(0, Math.min(600, Math.round(options.minTransferSec ?? 90)));
  const maxWalkM = Math.max(100, Math.min(2000, Math.round(options.maxWalkM ?? 800)));
  const userWalkSpeed = Math.max(0.8, Math.min(2.0, options.walkSpeedMps ?? WALK_SPEED_MPS));

  // 1. Resolve candidate boarding stops near origin.
  // Celowo szerzej (do maxWalkM, do 12 słupków): dalszy przystanek z bezpośrednim
  // odjazdem wygrywa z najbliższym słupkiem wymagającym 3 przesiadek.
  // fromLat/fromLon to PRAWDZIWA pozycja (GPS/home) — NIE współrzędne kotwicy.
  const originNearby = gtfsStore.findNearestStops(options.fromLat, options.fromLon, maxWalkM, 12);
  const origins = originNearby.map((n) => {
    const effectiveDist = n.distanceM * WALK_DETOUR_FACTOR;
    return {
      stopId: n.stop.stop_id,
      walkM: n.distanceM,
      walkSec: Math.max(30, Math.round(effectiveDist / userWalkSpeed)),
    };
  });

  // Kotwica jako UŁATWIENIE, nie żelazna zasada: upewniamy się, że preferowany
  // przystanek jest w kandydatach (nawet tuż za limitem), z PRAWDZIWYM dystansem
  // liczonym od fromLat/fromLon. Mały bonus -30 s rozstrzyga remisy przy
  // chybotaniu GPS, ale nie zeruje kosztu dojścia (stary błąd: origin
  // przepisywany na współrzędne przystanku dawał walkSec ~30 s i premiował
  // absurdalne "wsiądź na 1 przystanek, resztę idź z buta").
  if (
    (options.anchorStopId || (options.anchorStopLat !== undefined && options.anchorStopLon !== undefined)) &&
    Number.isFinite(options.fromLat) && Number.isFinite(options.fromLon)
  ) {
    let anchorStop: { stop_id: string; stop_lat: number; stop_lon: number } | undefined;
    if (options.anchorStopId) {
      const byId = gtfsStore.stops.get(options.anchorStopId);
      if (byId) anchorStop = { stop_id: byId.stop_id, stop_lat: byId.stop_lat, stop_lon: byId.stop_lon };
    }
    if (!anchorStop && options.anchorStopLat !== undefined && options.anchorStopLon !== undefined) {
      const near = gtfsStore.findNearestStops(options.anchorStopLat, options.anchorStopLon, 400, 1);
      if (near.length > 0) {
        anchorStop = { stop_id: near[0].stop.stop_id, stop_lat: near[0].stop.stop_lat, stop_lon: near[0].stop.stop_lon };
      }
    }
    if (anchorStop) {
      const trueDistM = Math.round(
        distanceMeters(options.fromLat, options.fromLon, anchorStop.stop_lat, anchorStop.stop_lon)
      );
      const trueWalkSec = Math.max(30, Math.round((trueDistM * WALK_DETOUR_FACTOR) / userWalkSpeed));
      const bonusWalkSec = Math.max(30, trueWalkSec - 30);
      const existing = origins.find((o) => o.stopId === anchorStop!.stop_id);
      if (existing) {
        existing.walkSec = Math.min(existing.walkSec, bonusWalkSec);
      } else {
        origins.push({ stopId: anchorStop.stop_id, walkM: trueDistM, walkSec: bonusWalkSec });
      }
    }
  }

  // 2. Resolve candidate alighting stops near destination
  const destNearby = gtfsStore.findNearestStops(options.toLat, options.toLon, maxWalkM, 12);
  const destinations = destNearby.map((n) => {
    const effectiveDist = n.distanceM * WALK_DETOUR_FACTOR;
    return {
      stopId: n.stop.stop_id,
      walkM: n.distanceM,
      walkSec: Math.max(30, Math.round(effectiveDist / userWalkSpeed)),
    };
  });

  if (!origins.length || !destinations.length) {
    return [];
  }

  // 3. Run RAPTOR (z limitami z ustawień, na rozkładzie właściwego dnia).
  // Więcej okien czasowych niż poprzednio → RAPTOR widzi kursy do ~60 min w przód
  // (jak Jakdojade). Gęstsze okna blisko „teraz", rzadsze dalej.
  // tripDelays: RAPTOR wsiada wg czasów efektywnych (rozkład + GPS), więc
  // opóźniony kurs da się jeszcze złapać — czasy w segmentach są już finalne.
  // Tracker odświeża się w tle (cache ≤30 s); planowanie nigdy nie czeka na sieć.
  await liveTracker.ensureFresh();
  const tripDelays = liveTracker.getTripDelays();
  const rawJourneys: RawJourney[] = [];
  const timeWindows = [0, 300, 600, 900, 1200, 1800, 2700, 3600];

  for (const offsetSec of timeWindows) {
    const batch = runRaptor(gtfsStore, origins, destinations, departureSec + offsetSec, {
      maxTransfers,
      minTransferSec,
      dayIndex,
      tripDelays,
    });
    for (const j of batch) {
      if (j.transfers <= maxTransfers) rawJourneys.push(j);
    }
  }

  // Jedna wspólna selekcja Pareto + różnorodność na CAŁYM zbiorze
  // (osobno na okno dublowałyby się te same kursy).
  const filtered = filterParetoJourneys(rawJourneys, departureSec);

  // 4. Map into Connection model
  const connections: Connection[] = [];

  for (let idx = 0; idx < filtered.length; idx++) {
    const rj = filtered[idx];
    // Kotwica nie może wymuszać bezsensu: "wsiądź i wysiądź po 1 przystanku,
    // resztę idź z buta" odrzucamy niezależnie od preferencji startu.
    if (isPointlessShortRide(rj)) continue;
    const legs: Leg[] = [];
    let overallLive = false;
    let maxDelayMin = 0;

    for (let lIdx = 0; lIdx < rj.segments.length; lIdx++) {
      const seg = rj.segments[lIdx];
      let legLive = false;
      let legDelayMin = 0;

      if (seg.type === 'transit') {
        // Ten sam snapshot opóźnień co w RAPTOR-ze: czasy segmentów są już
        // efektywne (NIE dodajemy opóźnienia drugi raz). Tu tylko flaga live
        // i wartość do wyświetlenia.
        const dSec = tripDelays.get(seg.tripId ?? '');
        if (dSec !== undefined) {
          legLive = true;
          legDelayMin = Math.round(dSec / 60);
          overallLive = true;
          if (Math.abs(legDelayMin) > Math.abs(maxDelayMin)) {
            maxDelayMin = legDelayMin;
          }
        }
      }

      // Czasy już finalne (efektywne) — prosto z segmentów.
      const adjDepartSec = seg.departSec;
      const adjArriveSec = seg.arriveSec;
      // Ostatnia noga piesza do celu dziedziczy nazwę celu podróży.
      const toName =
        seg.toStopId === 'destination' ? options.toTitle : seg.toStopName;
      const fromName =
        seg.fromStopId === 'origin' ? options.fromTitle : seg.fromStopName;

      const fromStopObj = gtfsStore.stops.get(seg.fromStopId);
      const toStopObj = gtfsStore.stops.get(seg.toStopId);

      const fromLat = seg.fromStopId === 'origin' ? options.fromLat : fromStopObj?.stop_lat;
      const fromLon = seg.fromStopId === 'origin' ? options.fromLon : fromStopObj?.stop_lon;
      const toLat = seg.toStopId === 'destination' ? options.toLat : toStopObj?.stop_lat;
      const toLon = seg.toStopId === 'destination' ? options.toLon : toStopObj?.stop_lon;

      // Intermediate stops: TYLKO board→alight, nie cały kurs
      const intermediateStops =
        seg.type === 'transit' && seg.tripId && seg.fromStopId && seg.toStopId
          ? buildLegStops(seg.tripId, seg.fromStopId, seg.toStopId)
          : undefined;

      legs.push({
        id: `c${idx + 1}l${lIdx + 1}`,
        mode: seg.type === 'walk' ? 'walk' : seg.mode || 'bus',
        line: seg.line,
        direction: seg.direction,
        fromStop: fromName,
        toStop: toName,
        fromStopId: seg.fromStopId,
        toStopId: seg.toStopId,
        fromLat,
        fromLon,
        toLat,
        toLon,
        platformCode: fromStopObj?.stop_code,
        departAt: secondsToTimeString(adjDepartSec),
        arriveAt: secondsToTimeString(adjArriveSec),
        stopsCount: seg.stopsCount,
        walkM: seg.walkMeters,
        live: legLive,
        tripId: seg.type === 'transit' ? seg.tripId : undefined,
        routeId: seg.type === 'transit' ? seg.routeId : undefined,
        intermediateStops,
      });
    }

    const transitLegs = legs.filter((l) => l.mode !== 'walk');
    if (transitLegs.length === 0) continue;

    // Czasy z RAPTOR-a są już efektywne (z opóźnieniami GPS) — dokładamy
    // tylko offset dnia (zapytanie o jutro): RAPTOR liczył porą dnia.
    const adjDepartureSec = rj.departureSec + dayOffsetSec;
    const adjArrivalSec = rj.arrivalSec + dayOffsetSec;
    const durationMin = Math.max(1, Math.round((adjArrivalSec - adjDepartureSec) / 60));
    const departInMin = Math.max(0, Math.round((adjDepartureSec - currentSec) / 60));

    // Interchange description if transfers exist
    let interchange: string | undefined;
    if (rj.transfers > 0) {
      const via = Array.from(new Set(transitLegs.slice(0, -1).map((l) => l.toStop)));
      if (via.length > 0) {
        interchange = via.length === 1 ? `Przesiadka: ${via[0]}` : `Przesiadki: ${via.join(' • ')}`;
      }
    }

    connections.push({
      id: `conn-${idx + 1}-${rj.departureSec + dayOffsetSec}`,
      fromTitle: options.fromTitle,
      toTitle: options.toTitle,
      departInMin,
      departureSec: adjDepartureSec,
      departAt: secondsToTimeString(adjDepartureSec),
      arriveAt: secondsToTimeString(adjArrivalSec),
      durationMin,
      transfers: rj.transfers,
      delayMin: maxDelayMin,
      live: overallLive,
      legs,
      interchange,
    });
  }

  // Opcja "na piechotę" dla bliskich celów (jak w Jakdojade) — jeśli prosto
  // jest w zasięgu spaceru z ustawień, dokładamy ją do listy.
  const directM = Math.round(
    distanceMeters(options.fromLat, options.fromLon, options.toLat, options.toLon)
  );
  if (directM <= maxWalkM && directM > 0) {
    const effectiveDist = directM * WALK_DETOUR_FACTOR;
    const walkSec = Math.max(60, Math.round(effectiveDist / userWalkSpeed));
    const walkDepSec = departureSec + dayOffsetSec;
    const walkArrSec = walkDepSec + walkSec;
    const walkInMin = Math.max(0, Math.round((walkDepSec - currentSec) / 60));
    connections.push({
      id: `walk-only-${walkDepSec}`,
      fromTitle: options.fromTitle,
      toTitle: options.toTitle,
      departInMin: walkInMin,
      departureSec: walkDepSec,
      departAt: secondsToTimeString(walkDepSec),
      arriveAt: secondsToTimeString(walkArrSec),
      durationMin: Math.max(1, Math.round(walkSec / 60)),
      transfers: 0,
      delayMin: 0,
      live: false,
      legs: [
        {
          id: 'walk-only-l1',
          mode: 'walk',
          fromStop: options.fromTitle,
          toStop: options.toTitle,
          fromStopId: 'origin',
          toStopId: 'destination',
          fromLat: options.fromLat,
          fromLon: options.fromLon,
          toLat: options.toLat,
          toLon: options.toLon,
          departAt: secondsToTimeString(walkDepSec),
          arriveAt: secondsToTimeString(walkArrSec),
          stopsCount: 0,
          walkM: directM,
          live: false,
        },
      ],
    });
  }

  // Sortowanie po koszcie uogólnionym: door-to-door + 10 min kary za przesiadkę.
  const TRANSFER_PENALTY_MIN = 10;
  connections.sort((a, b) => {
    const costA = a.departInMin + a.durationMin + a.transfers * TRANSFER_PENALTY_MIN;
    const costB = b.departInMin + b.durationMin + b.transfers * TRANSFER_PENALTY_MIN;
    if (costA !== costB) return costA - costB;
    return a.departInMin - b.departInMin;
  });
  return connections;
}
