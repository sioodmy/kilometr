import { gtfsStore } from './store';
import { filterParetoJourneys, runRaptor } from './raptor';
import { Connection, Leg, LegStop, RawJourney } from './types';
import { distanceMeters, secondsToTimeString } from '../../gtfs/geo';
import { vehicleTracker } from './mockTracker';

// ────────────────────────────────────────────────────────────────────────────
// Parametry spacerowe (spójne z raptor.ts i store.ts)
// ────────────────────────────────────────────────────────────────────────────
const WALK_SPEED_MPS = 1.3;
const WALK_DETOUR_FACTOR = 1.3;
const MIN_WALK_LEG_METERS = 50;

/** Pełna sekwencja przystanków kursu (cała linia) z GTFS stop_times + stops. */
export function buildTripStops(tripId: string): LegStop[] {
  const times = gtfsStore.stopTimes.get(tripId);
  if (!times || times.length === 0) return [];
  return times.map((t) => {
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
}

/** Przystanki kursu TYLKO od boardStop do alightStop (to co użytkownik widzi). */
function buildLegStops(tripId: string, boardStopId: string, alightStopId: string): LegStop[] {
  const allStops = buildTripStops(tripId);
  if (allStops.length === 0) return [];

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
  const dayIndex = await gtfsStore.getDayIndex(weekday, dateStr);

  const maxTransfers = Math.max(0, Math.min(3, Math.round(options.maxTransfers ?? 2)));
  const minTransferSec = Math.max(0, Math.min(600, Math.round(options.minTransferSec ?? 90)));
  const maxWalkM = Math.max(100, Math.min(2000, Math.round(options.maxWalkM ?? 800)));
  const userWalkSpeed = Math.max(0.8, Math.min(2.0, options.walkSpeedMps ?? WALK_SPEED_MPS));

  // 1. Resolve candidate boarding stops near origin.
  // Celowo szerzej (do maxWalkM, do 12 słupków): dalszy przystanek z bezpośrednim
  // odjazdem wygrywa z najbliższym słupkiem wymagającym 3 przesiadek.
  const originNearby = gtfsStore.findNearestStops(options.fromLat, options.fromLon, maxWalkM, 12);
  const origins = originNearby.map((n) => {
    const effectiveDist = n.distanceM * WALK_DETOUR_FACTOR;
    return {
      stopId: n.stop.stop_id,
      walkM: n.distanceM,
      walkSec: Math.max(30, Math.round(effectiveDist / userWalkSpeed)),
    };
  });

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
  const tripDelays = vehicleTracker.getTripDelays();
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
