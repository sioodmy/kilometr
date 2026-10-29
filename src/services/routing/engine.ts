import { DayIndex, gtfsStore } from './store';
import { costParamsFor, isPointlessShortRide, mergeDayIndexes, runRaptorAsync, selectJourneys, warmupRaptorNet, type CostParams } from './raptor';
import { AllowedTransferModes, Connection, Leg, LegStop, RawJourney, RouteStyle, TransitModePreference } from './types';
import { distanceMeters, secondsToTimeString } from '../../gtfs/geo';
import { liveTracker } from '../liveTracker';
import { MAX_DELAY_SEC } from '../liveQuality';
import { emptyRoutingSnapshot, type RoutingSnapshot } from './reliability';
import { deduplicateConnections, stableConnectionId } from './connectionIdentity';
import { isFareBoundary } from '../../gtfs/fareBoundary';
import { refreshConnectionTimes, scheduledLegTimes } from './connectionTimes';

// ────────────────────────────────────────────────────────────────────────────
// Parametry spacerowe (spójne z raptor.ts i store.ts)
// ────────────────────────────────────────────────────────────────────────────
const WALK_SPEED_MPS = 1.34;
const WALK_DETOUR_FACTOR = 1.15;
/** Poniżej tego dystansu start i cel to praktycznie ten sam punkt (spacer, nie przejazd). */
const SAME_POINT_M = 40;
/**
 * Ile przystanków w zasięgu dojścia bierzemy pod uwagę. Dawne 12 najbliższych
 * w centrum sięgało ledwie 300 m, więc dalszy przystanek z tramwajem prosto
 * pod cel w ogóle nie był kandydatem, a planer dokładał spacer przez inny
 * słupek.
 */
const MAX_ACCESS_STOPS = 80;

/** Nocny indeks zunifikowany per para wycinków (dziś, wczoraj): kompilacja raz. */
const mergedCache = new WeakMap<DayIndex, WeakMap<DayIndex, { index: DayIndex; offsets: Map<string, number> }>>();
function mergedOvernight(today: DayIndex, yesterday: DayIndex) {
  let inner = mergedCache.get(today);
  if (!inner) {
    inner = new WeakMap();
    mergedCache.set(today, inner);
  }
  let hit = inner.get(yesterday);
  if (!hit) {
    hit = mergeDayIndexes(today, yesterday, 'y_', -86400);
    inner.set(yesterday, hit);
  }
  return hit;
}

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
    // ignoruj - fallback niżej
  }
  return [];
}

/** Wycinek (i nocny merge) na parametry wyszukiwania: jedno źródło prawdy */
interface SearchSlices {
  /** Porą dnia (bez przesunięcia dnia serwisowego). */
  departureSec: number;
  /** Sekundy od teraz co dzień docelowego (dodawane do wyników, nie do RAPTOR-a). */
  dayOffsetSec: number;
  searchStartSec: number;
  searchIndex: DayIndex;
  /** Offsets zegara nocnego (patternTimeOffsets w opcjach RAPTOR-a). */
  patternOffsets?: Map<string, number>;
}

/**
 * Buduje wycinek planera dla odjazdu (lub przyjazdu) o rawTargetSec - pełny
 * czas RAW (pora dnia + offset dni). planConnections i rozgrzewka idą przez
 * TEN SAM kod, żeby rozgrzany indeks był dokładnie tym, na który wyszukiwanie
 * zaraz wpadnie (w tym nocny merge przed 07:00).
 */
export async function buildSearchSlices(rawTargetSec: number, arrivalMode = false): Promise<SearchSlices> {
  const now = new Date();
  // departureTimeSec / arriveBySec mogą wskazywać jutro (DepartureTimeSheet
  // dodaje +86400). RAPTOR jeździ po porze dnia, a offset dokładamy do wyników.
  const dayOffsetSec = Math.floor(rawTargetSec / 86400) * 86400;
  let departureSec = rawTargetSec % 86400;
  if (departureSec < 0) departureSec += 86400;
  const targetDate = new Date(now);
  targetDate.setDate(targetDate.getDate() + Math.round(dayOffsetSec / 86400));
  const weekday = targetDate.getDay();
  const dateStr = toDateStr(targetDate);
  // Wycinek horyzontu zamiast pełnej doby: okna RAPTOR-a sięgają +3600 s,
  // a przesiadkowe nogi jeszcze dalej - bierzemy zapas do +3 h.
  // Przyjazd obejmuje też wyjście przed północą poprzedniego dnia.
  const searchStartSec = arrivalMode ? departureSec - 10800 : departureSec;
  const dayIndex = arrivalMode
    ? await gtfsStore.getDayIndexSlice(weekday, dateStr, searchStartSec - MAX_DELAY_SEC, departureSec + 600)
    : await gtfsStore.getDayIndexSlice(weekday, dateStr, departureSec - MAX_DELAY_SEC, departureSec + 10800);

  // Nocny indeks ZUNIFIKOWANY (mergeDayIndexes): po północy kursy 24:xx+
  // należą do wczorajszego dnia serwisowego, ale nogi z obu dni muszą łączyć
  // się w JEDNEJ podróży (np. 145 dziś + 255 wczoraj o 04:30).
  let searchIndex = dayIndex;
  let patternOffsets: Map<string, number> | undefined;
  if (searchStartSec < 7 * 3600) {
    const yDate = new Date(targetDate);
    yDate.setDate(yDate.getDate() - 1);
    const overnightIdx = await gtfsStore.getDayIndexSlice(
      yDate.getDay(),
      toDateStr(yDate),
      86400 + Math.min(-7200, searchStartSec - MAX_DELAY_SEC),
      86400 + (arrivalMode ? departureSec + 600 : departureSec + 10800),
    );
    const merged = mergedOvernight(dayIndex, overnightIdx);
    searchIndex = merged.index;
    patternOffsets = merged.offsets;
  }
  return { departureSec, dayOffsetSec, searchStartSec, searchIndex, patternOffsets };
}

/**
 * Rozgrzewka po starcie / imporcie: buduje wycinek na bieżącą porę w tle,
 * żeby pierwsze wyszukiwanie nie płaciło pełnego kosztu budowy indeksu.
 * Idzie przez buildSearchSlices, więc obejmuje też nocny merge przed 07:00.
 */
export async function warmupRouting(): Promise<void> {
  try {
    await gtfsStore.load();
    const now = new Date();
    const currentSec = now.getHours() * 3600 + now.getMinutes() * 60 + now.getSeconds();
    const slices = await buildSearchSlices(currentSec);
    await warmupRaptorNet(gtfsStore, slices.searchIndex, slices.patternOffsets);
  } catch (err) {
    console.warn('[Routing] warmup failed:', err);
  }
}

/** Przystanki kursu TYLKO od boardStop do alightStop (to co użytkownik widzi). */
export function buildLegStops(
  tripId: string,
  boardStopId: string,
  alightStopId: string,
  departSec?: number,
  arriveSec?: number,
): LegStop[] {
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

  let boardIdx = -1;
  if (departSec !== undefined) {
    boardIdx = allStops.findIndex(
      (s) => s.stopId === boardStopId && s.departSec !== undefined && Math.abs(s.departSec - departSec) <= 120,
    );
  }
  if (boardIdx < 0) {
    boardIdx = allStops.findIndex((s) => s.stopId === boardStopId);
  }

  let alightIdx = -1;
  if (arriveSec !== undefined && boardIdx >= 0) {
    alightIdx = allStops.findIndex(
      (s, idx) =>
        idx > boardIdx &&
        s.stopId === alightStopId &&
        s.arriveSec !== undefined &&
        Math.abs(s.arriveSec - arriveSec) <= 120,
    );
  }
  if (alightIdx < 0 && boardIdx >= 0) {
    alightIdx = allStops.findIndex((s, idx) => idx > boardIdx && s.stopId === alightStopId);
  }
  if (alightIdx < 0) {
    alightIdx = allStops.findIndex((s) => s.stopId === alightStopId);
  }

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
  /** Przyjazd najpóźniej o tej godzinie. RAPTOR szuka wstecz od celu. */
  arriveBySec?: number;
  /** 0–3, default 2. 0 = tylko bezpośrednie. */
  maxTransfers?: number;
  /** Jednorazowy filtr pojazdów, default 'all'. Wpuszczane tylko kursy danego typu. */
  modes?: TransitModePreference;
  /** Pociągi KD w trybie 'all' (default true). Szybki filtr ich nie rusza. */
  trainsEnabled?: boolean;
  /** Koleje linowe (Polinka) w trybie 'all' (default true). Jak trainsEnabled. */
  cableEnabled?: boolean;
  /**
   * Na które pojazdy wolno się przesiadać (default wszystko true).
   * Wyłączony środek nie pojawia się w wynikach wcale.
   */
  allowedTransferModes?: Partial<AllowedTransferModes>;
  /** sekundy, default 300. Minimalny zapas na wsiadanie do pociągu po przesiadce. */
  trainMinTransferSec?: number;
  /** Minimalny czas na przesiadkę, domyślnie 120 s. */
  minTransferSec?: number;
  /** metry, default 800. Jak daleko wolno iść na przystanek / z przystanku. */
  maxWalkM?: number;
  /** m/s, default 1.34. Tempo chodzenia użytkownika (dojścia i przesiadki). */
  walkSpeedMps?: number;
  /** Styl trasy: wagi spaceru i przesiadek. Default 'balanced'. */
  routeStyle?: RouteStyle;
  /**
   * Preferowany przystanek startowy (kotwica). fromLat/fromLon to PRAWDZIWA
   * pozycja (GPS) - silnik liczy realny spacer do kotwicy i daje jej tylko
   * mały bonus rozstrzygający remisy, zamiast zerować koszt dojścia.
   */
  anchorStopId?: string;
  anchorStopLat?: number;
  anchorStopLon?: number;
  /**
   * Progresywne oddawanie wyników: wywoływane po każdym oknie czasowym
   * RAPTOR-a z połączeniami policzonymi dotąd. UI podmienia listę na
   * bieżąco ("po kolei"), zamiast trzymać pełny spinner do samego końca.
   */
  onProgress?: (partial: Connection[]) => void;
}

/** Formatuj datę do YYYYMMDD (dla calendar_dates.txt). */
function toDateStr(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}${m}${d}`;
}

interface MapCtx {
  currentSec: number;
  dayOffsetSec: number;
  tripDelays: Map<string, number>;
  confidence: RoutingSnapshot['confidence'];
}

/** Stosuje wagi RAPTOR-a także na liście: czas, marsz i przesiadki.
 * Dla przyjazdu premiuje późniejsze wyjście przed terminem. */
export function sortConnectionsByCost(connections: Connection[], cost: CostParams, walkSpeedMps: number, arriveBySec?: number): Connection[] {
  const extraWalk = Math.max(0, cost.walkReluctance - 1);
  const costOf = (c: Connection) => {
    let walkM = 0;
    for (const l of c.legs) if (l.mode === 'walk') walkM += l.walkM ?? 0;
    return (
      (arriveBySec !== undefined ? arriveBySec - c.departureSec : (c.arrivalSec ?? c.departureSec + c.durationMin * 60)) +
      (extraWalk * walkM * WALK_DETOUR_FACTOR) / walkSpeedMps +
      c.transfers * cost.transferPenaltySec +
      c.legs.reduce((sum, leg) => sum + (leg.delayConfidence === 'estimated' || leg.delayConfidence === 'untracked' ? 120 : 0), 0)
    );
  };
  const costs = new Map(connections.map((c) => [c, costOf(c)]));
  connections.sort((a, b) => {
    const d = costs.get(a)! - costs.get(b)!;
    if (Math.abs(d) > 1e-6) return d;
    if (a.transfers !== b.transfers) return a.transfers - b.transfers;
    return arriveBySec !== undefined ? b.departureSec - a.departureSec : a.departureSec - b.departureSec;
  });
  return connections;
}

/**
 * Mapowanie RawJourney → Connection (legi, flagi live, czasy finalne).
 * Bez opcji "na piechotę" - tę dokłada wywołujący na samym końcu.
 * Używane i dla emisji progresywnych (po każdym oknie), i dla wyniku finalnego.
 */
function mapJourneysToConnections(
  journeys: RawJourney[],
  options: PlanOptions,
  ctx: MapCtx,
): Connection[] {
  const connections: Connection[] = [];

  for (let idx = 0; idx < journeys.length; idx++) {
    const rj = journeys[idx];
    // Kotwica nie może wymuszać bezsensu: "wsiądź i wysiądź po 1 przystanku,
    // resztę idź z buta" odrzucamy niezależnie od preferencji startu.
    if (isPointlessShortRide(rj)) continue;
    // Przejazd w jedną stronę i z powrotem (ten sam przystanek dwa razy)
    // nic nie daje, a RAPTOR potrafi go zaproponować przy bliskim celu.
    if (revisitsStops(rj)) continue;
    const legs: Leg[] = [];
    let overallLive = false;
    let maxDelayMin = 0;

    for (let lIdx = 0; lIdx < rj.segments.length; lIdx++) {
      const seg = rj.segments[lIdx];
      let legLive = false;

      if (seg.type === 'transit') {
        // Ten sam snapshot opóźnień co w RAPTOR-ze: czasy segmentów są już
        // efektywne (NIE dodajemy opóźnienia drugi raz). Tu tylko flaga live
        // i wartość do wyświetlenia.
        const dSec = ctx.tripDelays.get(seg.tripId ?? '');
        if (dSec !== undefined && ctx.confidence.get(seg.tripId ?? '') === 'live') {
          legLive = true;
          overallLive = true;
        }
      }

      // Czasy już finalne (efektywne) - prosto z segmentów.
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
          ? buildLegStops(seg.tripId, seg.fromStopId, seg.toStopId, seg.departSec, seg.arriveSec)
          : undefined;

      const leg: Leg = {
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
        delayConfidence: seg.type === 'transit' ? (ctx.confidence.get(seg.tripId ?? '') ?? 'scheduled') : undefined,
        tripId: seg.type === 'transit' ? seg.tripId : undefined,
        routeId: seg.type === 'transit' ? seg.routeId : undefined,
        intermediateStops,
      };
      if (seg.type === 'transit') {
        const scheduled = scheduledLegTimes(leg, adjDepartSec + ctx.dayOffsetSec);
        leg.scheduledDepartureSec = scheduled.departure;
        leg.scheduledArrivalSec = scheduled.arrival;
        leg.delaySec = scheduled.departure == null ? undefined : adjDepartSec + ctx.dayOffsetSec - scheduled.departure;
        leg.arrivalDelaySec = scheduled.arrival == null ? undefined : adjArriveSec + ctx.dayOffsetSec - scheduled.arrival;
        const delayMin = Math.round((leg.delaySec ?? ctx.tripDelays.get(seg.tripId ?? '') ?? 0) / 60);
        if (Math.abs(delayMin) > Math.abs(maxDelayMin)) maxDelayMin = delayMin;
      }
      legs.push(leg);
    }

    const transitLegs = legs.filter((l) => l.mode !== 'walk');
    if (transitLegs.length === 0) continue;

    // Czasy z RAPTOR-a są już efektywne (z opóźnieniami GPS) - dokładamy
    // tylko offset dnia (zapytanie o jutro): RAPTOR liczył porą dnia.
    const adjDepartureSec = rj.departureSec + ctx.dayOffsetSec;
    const adjArrivalSec = rj.arrivalSec + ctx.dayOffsetSec;
    const durationMin = Math.max(1, Math.round((adjArrivalSec - adjDepartureSec) / 60));
    const departInMin = Math.max(0, Math.round((adjDepartureSec - ctx.currentSec) / 60));

    // Interchange description if transfers exist
    let interchange: string | undefined;
    if (rj.transfers > 0) {
      const via = Array.from(new Set(transitLegs.slice(0, -1).map((l) => l.toStop)));
      if (via.length > 0) {
        interchange = via.length === 1 ? `Przesiadka: ${via[0]}` : `Przesiadki: ${via.join(' • ')}`;
      }
    }

    connections.push({
      id: `conn-${idx + 1}-${rj.departureSec + ctx.dayOffsetSec}`,
      fromTitle: options.fromTitle,
      toTitle: options.toTitle,
      departInMin,
      departureSec: adjDepartureSec,
      arrivalSec: adjArrivalSec,
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

  for (const connection of connections) {
    connection.id = stableConnectionId(connection);
  }
  return deduplicateConnections(connections);
}

/** Odświeża godziny i flagi live. Niezmienione połączenia zachowują referencje. */
export function applyLiveDelays(connections: Connection[], tripDelays: Map<string, number>): Connection[] {
  const snapshot = tripDelays.size > 0 ? liveTracker.getRoutingSnapshot() : emptyRoutingSnapshot();
  const delays = new Map([...tripDelays, ...snapshot.delays]);
  const updated = connections.map((connection) => refreshConnectionTimes(connection, delays, new Date(), snapshot.confidence));
  return updated.every((connection, index) => connection === connections[index]) ? connections : updated;
}

/**
 * Wyznacza kandydatów przystanków początkowych (origins) wokół pozycji startu.
 * Celowo szeroko (wszystko do maxWalkM): dalszy przystanek z bezpośrednim
 * odjazdem wygrywa z najbliższym słupkiem wymagającym 3 przesiadek.
 * Kotwica jako ułatwienie może wyjść minimalnie poza limit (do +20%),
 * ale odległa kotwica (np. 1+ km) nie może wypierać bliższych przystanków.
 */
export function resolveCandidateOrigins(
  fromLat: number,
  fromLon: number,
  maxWalkM: number,
  userWalkSpeed: number,
  anchor?: { stopId?: string; lat?: number; lon?: number },
): Array<{ stopId: string; walkM: number; walkSec: number }> {
  const originNearby = gtfsStore.findNearestStops(fromLat, fromLon, maxWalkM, MAX_ACCESS_STOPS);
  const origins = originNearby.map((n) => {
    const effectiveDist = n.distanceM * WALK_DETOUR_FACTOR;
    return {
      stopId: n.stop.stop_id,
      walkM: n.distanceM,
      walkSec: Math.max(30, Math.round(effectiveDist / userWalkSpeed)),
    };
  });

  if (
    (anchor?.stopId || (anchor?.lat !== undefined && anchor?.lon !== undefined)) &&
    Number.isFinite(fromLat) && Number.isFinite(fromLon)
  ) {
    let anchorStop: { stop_id: string; stop_lat: number; stop_lon: number } | undefined;
    if (anchor?.stopId) {
      const byId = gtfsStore.stops.get(anchor.stopId);
      if (byId && !isFareBoundary(byId.stop_name ?? '')) anchorStop = { stop_id: byId.stop_id, stop_lat: byId.stop_lat, stop_lon: byId.stop_lon };
    }
    if (!anchorStop && anchor?.lat !== undefined && anchor?.lon !== undefined) {
      const near = gtfsStore.findNearestStops(anchor.lat, anchor.lon, 400, 1);
      if (near.length > 0) {
        anchorStop = { stop_id: near[0].stop.stop_id, stop_lat: near[0].stop.stop_lat, stop_lon: near[0].stop.stop_lon };
      }
    }
    if (anchorStop) {
      const trueDistM = Math.round(
        distanceMeters(fromLat, fromLon, anchorStop.stop_lat, anchorStop.stop_lon)
      );
      if (trueDistM <= maxWalkM * 1.2) {
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
  }

  return origins;
}

/**
 * Podróż wraca po własnych śladach: ten sam przystanek dwa razy, np. kurs
 * w jedną stronę i z powrotem, żeby dojść pieszo. Takie warianty tylko
 * marnują czas, więc odrzucamy je przed mapowaniem na UI.
 */
function revisitsStops(rj: RawJourney): boolean {
  const seen = new Set<string>();
  let prev = '';
  for (const seg of rj.segments) {
    if (seg.type !== 'transit') continue;
    for (const id of [seg.fromStopId, seg.toStopId]) {
      if (!id || id === prev) continue;
      if (seen.has(id)) return true;
      seen.add(id);
      prev = id;
    }
  }
  return false;
}

/** Pojedyncza noga piesza jako połączenie. Używane też dla startu = celu. */
function buildWalkOnlyConnection(
  options: PlanOptions,
  directM: number,
  walkDepSec: number,
  walkArrSec: number,
  walkSec: number,
  currentSec: number,
): Connection {
  const walkInMin = Math.max(0, Math.round((walkDepSec - currentSec) / 60));
  return {
    id: `walk-only-${walkDepSec}`,
    fromTitle: options.fromTitle,
    toTitle: options.toTitle,
    departInMin: walkInMin,
    departureSec: walkDepSec,
    arrivalSec: walkArrSec,
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
  };
}

export async function planConnections(options: PlanOptions): Promise<Connection[]> {
  await gtfsStore.load();

  const now = new Date();
  const currentSec = now.getHours() * 3600 + now.getMinutes() * 60 + now.getSeconds();

  // Wycinek dnia (+ nocny merge) przez SHARED buildSearchSlices: rozgrzewka
  // uruchamiana tym samym kodem, co samo wyszukiwanie.
  const arrivalTarget = options.arriveBySec;
  const arrivalMode = arrivalTarget !== undefined && Number.isFinite(arrivalTarget);
  const rawTarget = Math.max(
    -86400 * 2,
    Math.round(arrivalMode ? arrivalTarget : (options.departureTimeSec ?? currentSec)),
  );
  const slices = await buildSearchSlices(rawTarget, arrivalMode);
  const { departureSec, dayOffsetSec, searchStartSec, searchIndex, patternOffsets } = slices;
  const earliestDepartureSec = arrivalMode && rawTarget >= currentSec
    ? Math.max(searchStartSec, currentSec - dayOffsetSec)
    : searchStartSec;

  const maxTransfers = Math.max(0, Math.min(3, Math.round(options.maxTransfers ?? 2)));
  const modes: TransitModePreference =
    options.modes === 'tram' || options.modes === 'bus' ? options.modes : 'all';
  const minTransferSec = Math.max(0, Math.min(600, Math.round(options.minTransferSec ?? 120)));
  // Pille z ustawień wygrywają ze starymi przełącznikami: jawny wpis w
  // allowedTransferModes nadpisuje trainsEnabled i cableEnabled.
  const allow = options.allowedTransferModes;
  const trainsEnabled = allow?.train ?? options.trainsEnabled ?? true;
  const cableEnabled = allow?.cable ?? options.cableEnabled ?? true;
  const trainMinTransferSec = Math.max(0, Math.min(1200, Math.round(options.trainMinTransferSec ?? 300)));
  const maxWalkM = Math.max(100, Math.min(2000, Math.round(options.maxWalkM ?? 800)));
  const userWalkSpeed = Math.max(0.8, Math.min(2.0, options.walkSpeedMps ?? WALK_SPEED_MPS));
  const cost = costParamsFor(options.routeStyle);

  // Start i cel w tym samym miejscu: RAPTOR umie tu wymyślić przejazd w jedną
  // stronę i z powrotem, a to zwykły spacer. Jedna noga piesza i koniec.
  const directM = Math.round(
    distanceMeters(options.fromLat, options.fromLon, options.toLat, options.toLon)
  );
  const directWalkSec = Math.max(60, Math.round((directM * WALK_DETOUR_FACTOR) / userWalkSpeed));
  const walkArrSec = arrivalMode ? rawTarget : departureSec + dayOffsetSec + directWalkSec;
  const walkDepSec = walkArrSec - directWalkSec;
  if (directM <= SAME_POINT_M) {
    return [buildWalkOnlyConnection(options, directM, walkDepSec, walkArrSec, directWalkSec, currentSec)];
  }

  // 1. Resolve candidate boarding stops near origin.
  const origins = resolveCandidateOrigins(
    options.fromLat,
    options.fromLon,
    maxWalkM,
    userWalkSpeed,
    {
      stopId: options.anchorStopId,
      lat: options.anchorStopLat,
      lon: options.anchorStopLon,
    },
  );

  // 2. Resolve candidate alighting stops near destination
  const destNearby = gtfsStore.findNearestStops(options.toLat, options.toLon, maxWalkM, MAX_ACCESS_STOPS);
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

  // 3. Range RAPTOR (z limitami z ustawień, na rozkładzie właściwego dnia).
  // Opóźnienia GPS tylko dla dzisiejszych kursów: ten sam trip_id jutro to
  // inny kurs. Tracker odświeża się w tle; planowanie nigdy nie czeka na sieć.
  await liveTracker.ensureFresh();
  const snapshot = dayOffsetSec === 0 ? liveTracker.getRoutingSnapshot(searchIndex, patternOffsets) : emptyRoutingSnapshot();
  const tripDelays = snapshot.delays;
  const uncertaintyPenalty = new Map([...snapshot.transferBuffers.keys()].map(id => [id, 120]));
  const rawJourneys: RawJourney[] = [];
  // Przyjazdy: ostatnia godzina przed celem. Odjazdy: dwa okna do przodu.
  const timeWindows: [number, number][] = arrivalMode
    ? [[0, 3600]]
    : [
        [0, 900],
        [900, 2700],
      ];

  // Siatka bezpieczeństwa: gdyby klasyfikacja na poziomie segmentu rozjechała
  // się z klasyfikacją wzorca, odrzuć podróże z niedozwolonym pojazdem.
  // Pociągi (mode 'train') i metro (mode 'subway') wypadają z wąskich filtrów
  // same, bo nigdy nie są równe 'tram' ani 'bus'. Trolejbus jedzie z filtrem
  // autobusowym.
  // Pille z ustawień odcinają zbanowane środki na poziomie podróży: wyłączony
  // pojazd nie pojawia się w wynikach wcale (ani na start, ani na przesiadce).
  const isBanned = (mode: string | undefined): boolean => {
    if (!mode || mode === 'walk') return false;
    if (mode === 'train') return !trainsEnabled;
    if (mode === 'cable') return !cableEnabled;
    const v = (allow as Record<string, boolean | undefined> | undefined)?.[mode];
    return v === false;
  };
  const applyModeFilter = (list: RawJourney[]) =>
    list.filter((j) => {
      const transit = j.segments.filter((s) => s.type === 'transit');
      if (transit.some((s) => isBanned(s.mode))) return false;
      if (modes === 'all') return true;
      return transit.every((s) => s.mode === modes || (modes === 'bus' && s.mode === 'trolleybus'));
    });
  const mapCtx: MapCtx = { currentSec, dayOffsetSec, tripDelays, confidence: snapshot.confidence };
  const sortPartial = (list: Connection[]) =>
    sortConnectionsByCost(list, cost, userWalkSpeed, arrivalMode ? rawTarget : undefined);
  const select = (list: RawJourney[]) =>
    selectJourneys(applyModeFilter(list), searchStartSec, {
      cost,
      uncertaintyPenalty,
      arriveBySec: arrivalMode ? departureSec : undefined,
    });

  // Brak górnego limitu wsiadania w RAPTOR-ze: „pierwszy kurs po przybyciu"
  // bywa wiele godzin później (np. zapytanie 07:20 → wsiadanie 23:29, bo to
  // pierwszy kurs danego wzorca na tym przystanku). Wszystko ponad +2 h od
  // startu wyszukiwania to nie propozycja dla użytkownika - odrzucamy od razu,
  // żeby takie kursy nie psuły listy wariantów (też częściowej w onProgress).
  const MAX_BOARD_AHEAD_SEC = 7200;

  for (const [offsetSec, windowSec] of timeWindows) {
    const batch = await runRaptorAsync(gtfsStore, origins, destinations, (arrivalMode ? departureSec : searchStartSec) + offsetSec, {
      maxTransfers,
      minTransferSec,
      trainsEnabled,
      cableEnabled,
      trainMinTransferSec,
      dayIndex: searchIndex,
      tripDelays,
      transferBuffers: snapshot.transferBuffers,
      nowSec: currentSec,
      allowedModes: modes,
      patternTimeOffsets: patternOffsets,
      windowSec,
      walkSpeedMps: userWalkSpeed,
      maxTransferWalkM: maxWalkM,
      cost,
      latestArrivalSec: arrivalMode ? departureSec : undefined,
      arriveBy: arrivalMode,
    });
    for (const j of batch) {
      const inWindow = arrivalMode
        ? j.arrivalSec <= departureSec && j.departureSec >= earliestDepartureSec
        : j.departureSec <= searchStartSec + MAX_BOARD_AHEAD_SEC;
      if (j.transfers <= maxTransfers && inWindow) {
        rawJourneys.push(j);
      }
    }
    // Progres: po każdym oknie wydaj to, co mamy - UI dokłada wiersze
    // "po kolei" zamiast czekać na całość. await ustępuje wątek JS,
    // żeby FlatList zdążyła się przemalować między oknami.
    if (options.onProgress && rawJourneys.length > 0) {
      const partial = sortPartial(
        mapJourneysToConnections(select(rawJourneys), options, mapCtx),
      );
      if (partial.length > 0) {
        options.onProgress(partial);
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
      }
    }
  }

  // Jedna wspólna selekcja (dominacja + różnorodność) na CAŁYM zbiorze
  // (osobno na okno dublowałyby się te same kursy).
  const filtered = select(rawJourneys);

  // 4. Map into Connection model
  const connections = mapJourneysToConnections(filtered, options, mapCtx);

  // Opcja "na piechotę" dla bliskich celów (jak w Jakdojade) - jeśli prosto
  // jest w zasięgu spaceru z ustawień, dokładamy ją do listy.
  const canStartWalk = !arrivalMode || walkDepSec >= earliestDepartureSec + dayOffsetSec;
  const walkAdded = directM > 0 && directM <= maxWalkM && canStartWalk;
  if (walkAdded) {
    connections.push(buildWalkOnlyConnection(options, directM, walkDepSec, walkArrSec, directWalkSec, currentSec));
  }

  // Marsz bije przesiadki: gdy pieszo docierasz równie szybko jak wariantem
  // z przesiadką, taki wariant jest tylko stratą czasu (typowy przypadek:
  // cel o jeden przystanek, a RAPTOR proponuje jazdę tam i z powrotem).
  if (walkAdded) {
    for (let i = connections.length - 1; i >= 0; i--) {
      const c = connections[i];
      if (c.id.startsWith('walk-only-') || c.transfers === 0) continue;
      const arrivalSec = c.arrivalSec ?? c.departureSec + c.durationMin * 60;
      const worse = arrivalMode ? c.departureSec <= walkDepSec : arrivalSec >= walkArrSec;
      if (worse) connections.splice(i, 1);
    }
  }

  sortPartial(connections);
  for (const connection of connections) {
    connection.id = stableConnectionId(connection);
  }
  return deduplicateConnections(connections);
}
