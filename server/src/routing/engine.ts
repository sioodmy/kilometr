import { gtfsStore } from '../gtfs/store';
import { filterParetoJourneys, isPointlessShortRide, mergeDayIndexes, runRaptor } from './raptor';
import { Connection, Leg, LegStop, RawJourney, TransitModePreference } from './types';
import { distanceMeters, secondsToTimeString, utcDateStr, warsawNow } from '../gtfs/geo';
import { vehicleTracker } from '../realtime/tracker';

// ────────────────────────────────────────────────────────────────────────────
// Parametry spacerowe (spójne z raptor.ts i store.ts)
// ────────────────────────────────────────────────────────────────────────────
const WALK_SPEED_MPS = 1.45;
const WALK_DETOUR_FACTOR = 1.15;
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
  /** Jednorazowy filtr pojazdów, default 'all'. Wpuszczane tylko kursy danego typu. */
  modes?: TransitModePreference;
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

export async function planConnections(options: PlanOptions): Promise<Connection[]> {
  await gtfsStore.load();

  // Czas i dzień tygodnia liczone w strefie Wrocławia, niezależnie od TZ serwera.
  const clock = warsawNow();
  const currentSec = clock.sec;

  // departureTimeSec może wskazywać jutro (DepartureTimeSheet dodaje +86400).
  // RAPTOR jeździ po porze dnia, a offset dokładamy do wyników.
  const rawDep = Math.max(0, Math.round(options.departureTimeSec ?? currentSec));
  const dayOffsetSec = Math.floor(rawDep / 86400) * 86400;
  const departureSec = rawDep % 86400;
  const dayOffsetDays = Math.round(dayOffsetSec / 86400);
  // Baza "dziś" w Warszawie jako UTC-midnight, żeby przesunięcie o dni i
  // wyliczenie dnia tygodnia nie zależały od lokalnego TZ procesu.
  const baseUtc = Date.UTC(clock.year, clock.month - 1, clock.day);
  const targetUtc = new Date(baseUtc + dayOffsetDays * 86400000);
  const weekday = targetUtc.getUTCDay();
  const dateStr = utcDateStr(targetUtc);
  const dayIndex = gtfsStore.getDayIndex(weekday, dateStr);

  const maxTransfers = Math.max(0, Math.min(3, Math.round(options.maxTransfers ?? 2)));
  const modes: TransitModePreference =
    options.modes === 'tram' || options.modes === 'bus' ? options.modes : 'all';
  const minTransferSec = Math.max(0, Math.min(600, Math.round(options.minTransferSec ?? 60)));
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
  // chybotaniu GPS, ale nie zeruje kosztu dojścia.
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
    // Brak przystanków w zasięgu: RAPTOR nie ma czego liczyć, ale blisko
    // położony cel nadal zasługuje na opcję "na piechotę" (dodawaną niżej).
    const walkM = Math.round(
      distanceMeters(options.fromLat, options.fromLon, options.toLat, options.toLon),
    );
    if (!(walkM <= maxWalkM && walkM > 0)) return [];
  }

  // 3. Run RAPTOR (z limitami z ustawień, na rozkładzie właściwego dnia).
  // Więcej okien czasowych niż poprzednio → RAPTOR widzi kursy do ~60 min w przód
  // (jak Jakdojade). Gęstsze okna blisko „teraz", rzadsze dalej.
  // tripDelays: RAPTOR wsiada wg czasów efektywnych (rozkład + GPS), więc
  // opóźniony kurs da się jeszcze złapać — czasy w segmentach są już finalne.
  const tripDelays = vehicleTracker.getTripDelays();
  const rawJourneys: RawJourney[] = [];
  const timeWindows = [0, 300, 600, 900, 1200, 1800, 2700, 3600];

  // Nocny indeks ZUNIFIKOWANY (mergeDayIndexes): po północy (do ~07:00)
  // kursy 24:xx+ należą do wczorajszego dnia serwisowego, ale nogi z obu dni
  // muszą łączyć się w JEDNEJ podróży (np. 145 dziś + 255 wczoraj o 04:30).
  // Dawne dwa osobne przebiegi tego nie potrafiły.
  let searchIndex = dayIndex;
  let patternOffsets: Map<string, number> | undefined;
  if (departureSec < 7 * 3600) {
    const yUtc = new Date(targetUtc.getTime() - 86400000);
    const merged = mergeDayIndexes(
      dayIndex,
      gtfsStore.getDayIndex(yUtc.getUTCDay(), utcDateStr(yUtc)),
      'y_',
      -86400,
    );
    searchIndex = merged.index;
    patternOffsets = merged.offsets;
  }

  for (const offsetSec of timeWindows) {
    const batch = runRaptor(gtfsStore, origins, destinations, departureSec + offsetSec, {
      maxTransfers,
      minTransferSec,
      dayIndex: searchIndex,
      tripDelays,
      allowedModes: modes,
      patternTimeOffsets: patternOffsets,
    });
    for (const j of batch) {
      if (j.transfers <= maxTransfers) rawJourneys.push(j);
    }
  }

  // Brak górnego limitu wsiadania w RAPTOR-ze: „pierwszy kurs po przybyciu"
  // bywa wiele godzin później (np. zapytanie 07:20 → wsiadanie 23:29, bo to
  // pierwszy kurs danego wzorca na tym przystanku). Wszystko ponad +2 h od
  // zapytania to nie propozycja dla użytkownika — wyrzucamy przed Pareto,
  // żeby takie kursy nie psuły listy wariantów.
  const MAX_BOARD_AHEAD_SEC = 7200;
  const journeysInHorizon = rawJourneys.filter(
    (j) => j.departureSec <= departureSec + MAX_BOARD_AHEAD_SEC,
  );

  // Siatka bezpieczeństwa: gdyby klasyfikacja na poziomie segmentu rozjechała
  // się z klasyfikacją wzorca, odrzuć podróże z niedozwolonym pojazdem.
  const modeJourneys =
    modes === 'all'
      ? journeysInHorizon
      : journeysInHorizon.filter((j) =>
          j.segments
            .filter((s) => s.type === 'transit')
            .every((s) => s.mode === modes),
        );

  // Jedna wspólna selekcja Pareto + różnorodność na CAŁYM zbiorze
  // (osobno na okno dublowałyby się te same kursy).
  const filtered = filterParetoJourneys(modeJourneys, departureSec);

  // 4. Map into Connection model
  const connections: Connection[] = [];
  // Klucz zapytania w ID: poprzednio `conn-${idx}-${dep}` powtarzało się między
  // wyszukiwaniami i zapis trasy z jednego zapytania nadpisywał inną trasę.
  const queryKey = `${Math.round(options.fromLat * 1e4)}_${Math.round(options.fromLon * 1e4)}_${Math.round(
    options.toLat * 1e4,
  )}_${Math.round(options.toLon * 1e4)}`;

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
      id: `conn-${queryKey}-${adjDepartureSec}-${idx + 1}`,
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
      id: `walk-only-${queryKey}-${walkDepSec}`,
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
