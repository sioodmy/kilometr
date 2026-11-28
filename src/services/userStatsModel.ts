// Czysty model statystyk uzytkownika (bez natywnych modulow, testowany przez tsx).
// Agreguje sledzone przejazdy, aktualne zapisane trasy, historie celow,
// zapisane miejsca oraz bilety kolejowe.

import { distanceMeters, normalizePolish, timeStringToSeconds } from '../gtfs/geo';
import type { CityId } from '../cities';
import type { Connection, Leg, LegMode, SavedPlace, SavedRoute } from '../types/models';
import { tripUses, type TripHistoryItem } from './smartRanking';
import { normalizeLineName } from './lineIdentity';
import { inferRailAgency, railBadgeLine } from './railIdentity';

// 'saved' i 'viewed' zostaja tylko dla starych kopii zapasowych. Statystyki
// licza sledzone przejazdy oraz aktualna liste "Twoich tras".
export type JourneyLogSource = 'tracked' | 'saved' | 'viewed';

export interface JourneyLogLeg {
  mode: LegMode;
  line?: string;
  railAgency?: string;
  distanceM: number;
  durationMin: number;
  stopsCount: number;
}

export interface JourneyLogEntry {
  id: string;
  ts: number;
  cityId: CityId;
  durationMin: number;
  distanceM: number;
  walkM: number;
  stopsCount: number;
  destTitle?: string;
  legs: JourneyLogLeg[];
  source: JourneyLogSource;
}

export interface RailTicketSummaryInput {
  id: string;
  connectionId?: string;
  addedAt: number;
  trainNumber?: string;
  fromStation?: string;
  toStation?: string;
}

export interface UserStatsInput {
  journeyLog: JourneyLogEntry[];
  savedRoutes: { city: CityId; items: SavedRoute[] }[];
  tripHistory: { city: CityId; items: TripHistoryItem[] }[];
  places: { city: CityId; items: SavedPlace[] }[];
  railTickets?: RailTicketSummaryInput[];
  fallbackCityId?: CityId;
}

export interface TopLineItem {
  key: string;
  line: string;
  mode: LegMode;
  count: number;
  share: number;
  distanceKm: number;
  cityId: CityId;
  railAgency?: string;
}

interface TopDestinationItem {
  key: string;
  title: string;
  address: string;
  count: number;
  share: number;
  avgDurationMin: number;
  cityId: CityId;
}

interface ModeBreakdownItem {
  mode: LegMode;
  trips: number;
  legs: number;
  distanceKm: number;
  durationMin: number;
  share: number;
}

interface RailStats {
  trips: number;
  distanceKm: number;
  durationMin: number;
  ticketsCount: number;
  topAgency: string | null;
}

type TravelerArchetype =
  | 'rail_express'
  | 'tram_regular'
  | 'bus_rider'
  | 'metro_commuter'
  | 'city_walker'
  | 'multi_city'
  | 'explorer';

/**
 * Zestaw pol dopuszczonych na karcie do udostepniania w social media.
 * Celowo nie zawiera zadnych celow podrozy, przystankow, nazw miast ani numerow linii.
 */
export interface WrappedSafeSummary {
  year: number;
  totalTrips: number;
  totalDistanceKm: number;
  totalTransitKm: number;
  totalWalkKm: number;
  totalDurationMin: number;
  totalStops: number;
  citiesCount: number;
  railTrips: number;
  railDistanceKm: number;
  estimatedCo2SavedKg: number;
  archetype: TravelerArchetype;
  modes: {
    mode: LegMode;
    share: number;
    distanceKm: number;
    trips: number;
  }[];
}

export interface UserDataStats {
  totalTrips: number;
  totalDistanceKm: number;
  totalTransitKm: number;
  totalWalkKm: number;
  totalDurationMin: number;
  totalStops: number;
  citiesCount: number;
  savedPlacesCount: number;
  savedRoutesCount: number;
  tripHistoryCount: number;
  topLines: TopLineItem[];
  totalLineOccurrences: number;
  topDestinations: TopDestinationItem[];
  modes: ModeBreakdownItem[];
  rail: RailStats;
  archetype: TravelerArchetype;
  estimatedCo2SavedKg: number;
  activeSinceTs: number | null;
  hasAnyData: boolean;
  hasDetailedLines: boolean;
  wrapped: WrappedSafeSummary;
}

const SPEED_MPS_BY_MODE: Record<LegMode, number> = {
  train: 15.5,
  subway: 9.0,
  tram: 5.0,
  bus: 5.6,
  trolleybus: 5.2,
  cable: 3.8,
  walk: 1.25,
};

// Srednia roznica emisji miedzy autem osobowym (~170 g/km) a transportem zbiorowym (~50 g/km).
const CO2_SAVED_KG_PER_TRANSIT_KM = 0.12;
const ROAD_DETOUR_FACTOR = 1.22;
const MAX_REASONABLE_TRIP_M = 1_200_000;
const MIN_REASONABLE_TRIP_M = 80;

function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

function legDurationMin(leg: Leg): number {
  if (isFiniteNumber(leg.scheduledDepartureSec) && isFiniteNumber(leg.scheduledArrivalSec)) {
    const diff = leg.scheduledArrivalSec - leg.scheduledDepartureSec;
    if (diff > 0 && diff < 24 * 3600) return Math.max(1, Math.round(diff / 60));
  }
  const dep = timeStringToSeconds(leg.departAt);
  let arr = timeStringToSeconds(leg.arriveAt);
  if (arr < dep) arr += 24 * 3600;
  const diff = arr - dep;
  if (diff > 0 && diff < 24 * 3600) return Math.max(1, Math.round(diff / 60));
  if (leg.mode === 'walk' && isFiniteNumber(leg.walkM) && leg.walkM > 0) {
    return Math.max(1, Math.round(leg.walkM / 75));
  }
  return Math.max(1, leg.stopsCount > 0 ? leg.stopsCount * 2 : 5);
}

/**
 * Szacuje dystans odcinka w metrach z najdokladniejszego dostepnego zrodla:
 * walkM -> kolejne przystanki intermediateStops -> para wspolrzednych -> czas i predkosc trybu.
 */
export function estimateLegDistanceM(leg: Leg): number {
  if (leg.mode === 'walk' && isFiniteNumber(leg.walkM) && leg.walkM > 0) {
    return Math.round(Math.min(leg.walkM, 40_000));
  }
  if (Array.isArray(leg.intermediateStops) && leg.intermediateStops.length >= 2) {
    let sum = 0;
    let validSegments = 0;
    for (let i = 1; i < leg.intermediateStops.length; i++) {
      const prev = leg.intermediateStops[i - 1];
      const curr = leg.intermediateStops[i];
      if (
        isFiniteNumber(prev.lat) &&
        isFiniteNumber(prev.lon) &&
        isFiniteNumber(curr.lat) &&
        isFiniteNumber(curr.lon)
      ) {
        const seg = distanceMeters(prev.lat, prev.lon, curr.lat, curr.lon);
        if (seg > 0 && seg < 400_000) {
          sum += seg;
          validSegments++;
        }
      }
    }
    if (validSegments > 0 && sum > 0) {
      return Math.round(Math.min(sum * 1.06, MAX_REASONABLE_TRIP_M));
    }
  }
  if (
    isFiniteNumber(leg.fromLat) &&
    isFiniteNumber(leg.fromLon) &&
    isFiniteNumber(leg.toLat) &&
    isFiniteNumber(leg.toLon) &&
    (leg.fromLat !== 0 || leg.fromLon !== 0) &&
    (leg.toLat !== 0 || leg.toLon !== 0)
  ) {
    const direct = distanceMeters(leg.fromLat, leg.fromLon, leg.toLat, leg.toLon);
    if (direct >= MIN_REASONABLE_TRIP_M && direct < MAX_REASONABLE_TRIP_M) {
      return Math.round(Math.min(direct * ROAD_DETOUR_FACTOR, MAX_REASONABLE_TRIP_M));
    }
  }
  const durMin = legDurationMin(leg);
  const speed = SPEED_MPS_BY_MODE[leg.mode] ?? 5.0;
  return Math.round(Math.min(durMin * 60 * speed, MAX_REASONABLE_TRIP_M));
}

function cleanLineLabel(leg: Leg, cityId: CityId): { line?: string; railAgency?: string } {
  if (leg.mode === 'walk') return {};
  const agency = leg.mode === 'train' ? inferRailAgency(leg, cityId) : undefined;
  const raw = leg.mode === 'train' ? railBadgeLine(leg) : leg.line;
  const normalized = normalizeLineName(raw, leg.mode, false) || raw?.trim() || '';
  if (!normalized) return agency ? { railAgency: agency } : {};
  return { line: normalized, ...(agency ? { railAgency: agency } : {}) };
}

export function connectionToJourneyLogEntry(
  connection: Connection,
  cityId: CityId,
  source: JourneyLogSource,
  ts: number = Date.now(),
): JourneyLogEntry | null {
  if (!connection || !Array.isArray(connection.legs) || connection.legs.length === 0) return null;
  const legs: JourneyLogLeg[] = [];
  let distanceM = 0;
  let walkM = 0;
  let stopsCount = 0;

  for (const leg of connection.legs) {
    const legDist = estimateLegDistanceM(leg);
    const dur = legDurationMin(leg);
    const stops = Math.max(0, Math.round(leg.stopsCount || 0));
    distanceM += legDist;
    if (leg.mode === 'walk') {
      walkM += legDist;
    } else {
      stopsCount += stops;
    }
    const { line, railAgency } = cleanLineLabel(leg, cityId);
    legs.push({
      mode: leg.mode,
      ...(line ? { line } : {}),
      ...(railAgency ? { railAgency } : {}),
      distanceM: legDist,
      durationMin: dur,
      stopsCount: stops,
    });
  }

  const durationMin =
    isFiniteNumber(connection.durationMin) && connection.durationMin > 0
      ? Math.round(connection.durationMin)
      : legs.reduce((sum, l) => sum + l.durationMin, 0);

  return {
    id: connection.id || `j-${ts}`,
    ts,
    cityId,
    durationMin: Math.max(1, durationMin),
    distanceM,
    walkM,
    stopsCount,
    destTitle: connection.toTitle?.trim() || undefined,
    legs,
    source,
  };
}

function normalizeTripKey(id: string): string {
  return id.replace(/\|d=\d{4}-\d{2}-\d{2}/, '').trim();
}

function normalizeDestKey(title: string): string {
  return normalizePolish(title)
    .replace(/\s+/g, ' ')
    .replace(/,\s*wroclaw|,\s*krakow|,\s*warszawa|,\s*gdansk|,\s*poznan/g, '')
    .trim();
}

function chooseArchetype(params: {
  totalTrips: number;
  citiesCount: number;
  totalWalkKm: number;
  totalDistanceKm: number;
  railDistanceKm: number;
  railTrips: number;
  modes: ModeBreakdownItem[];
}): TravelerArchetype {
  const {
    totalTrips,
    citiesCount,
    totalWalkKm,
    totalDistanceKm,
    railDistanceKm,
    railTrips,
    modes,
  } = params;
  if (totalTrips === 0) return 'explorer';
  if (railTrips >= 2 && (railDistanceKm >= totalDistanceKm * 0.35 || railTrips >= totalTrips * 0.3)) {
    return 'rail_express';
  }
  if (citiesCount >= 3) return 'multi_city';
  const transitModes = modes.filter((m) => m.mode !== 'walk');
  const topMode = transitModes[0];
  if (topMode && topMode.share >= 0.45) {
    if (topMode.mode === 'train') return 'rail_express';
    if (topMode.mode === 'subway') return 'metro_commuter';
    if (topMode.mode === 'tram') return 'tram_regular';
    if (topMode.mode === 'bus' || topMode.mode === 'trolleybus') return 'bus_rider';
  }
  if (totalDistanceKm > 0 && totalWalkKm / totalDistanceKm >= 0.35) {
    return 'city_walker';
  }
  return 'explorer';
}

export function computeUserDataStats(
  input: UserStatsInput,
  now: Date = new Date(),
): UserDataStats {
  const citiesUsed = new Set<CityId>();
  let activeSinceTs: number | null = null;
  const markTs = (ts: number | undefined) => {
    if (!isFiniteNumber(ts) || ts <= 1_500_000_000_000) return;
    if (activeSinceTs === null || ts < activeSinceTs) activeSinceTs = ts;
  };

  // 1. Przejazdy liczymy z aktualnych zapisanych tras ("Twoje trasy") i
  // sledzonych podrozy. Podglad trasy ani stary wpis 'saved' nie sa dowodem
  // przejazdu, wiec dziennik przyjmuje tylko wpisy 'tracked'.
  const detailedTrips: JourneyLogEntry[] = [];
  const seenTripKeys = new Set<string>();
  const seenConnectionIds = new Set<string>();

  const sortedLog = [...input.journeyLog].sort((a, b) => b.ts - a.ts);
  for (const entry of sortedLog) {
    markTs(entry?.ts);
    if (!entry || entry.source !== 'tracked') continue;
    if (!Array.isArray(entry.legs) || entry.legs.length === 0) continue;
    const normId = normalizeTripKey(entry.id);
    const key = `${normId}@${Math.floor(entry.ts / (6 * 3600 * 1000))}`;
    if (seenTripKeys.has(key)) continue;
    seenTripKeys.add(key);
    seenConnectionIds.add(normId);
    detailedTrips.push(entry);
    citiesUsed.add(entry.cityId);
  }

  let savedRoutesCount = 0;
  for (const section of input.savedRoutes) {
    savedRoutesCount += section.items.length;
    if (section.items.length > 0) citiesUsed.add(section.city);
    for (const saved of section.items) {
      markTs(saved.savedAt);
      const entry = connectionToJourneyLogEntry(
        saved.connection,
        section.city,
        'saved',
        saved.savedAt,
      );
      if (!entry) continue;
      const looseKey = normalizeTripKey(entry.id);
      const key = `${looseKey}@${Math.floor(entry.ts / (6 * 3600 * 1000))}`;
      if (seenTripKeys.has(key) || seenConnectionIds.has(looseKey)) continue;
      seenTripKeys.add(key);
      seenConnectionIds.add(looseKey);
      detailedTrips.push(entry);
    }
  }

  let savedPlacesCount = 0;
  for (const section of input.places) {
    savedPlacesCount += section.items.length;
  }

  // 2. Agregacja linii i srodkow transportu ze szczegolowych przejazdow.
  const lineMap = new Map<
    string,
    {
      line: string;
      mode: LegMode;
      count: number;
      distanceM: number;
      cityId: CityId;
      railAgency?: string;
    }
  >();
  const modeMap = new Map<
    LegMode,
    { trips: number; legs: number; distanceM: number; durationMin: number }
  >();
  const agencyCount = new Map<string, number>();

  let detailedDistanceM = 0;
  let detailedWalkM = 0;
  let detailedDurationMin = 0;
  let totalStops = 0;
  let railTrips = 0;
  let railDistanceM = 0;
  let railDurationMin = 0;

  const addModeLeg = (mode: LegMode, distanceM: number, durationMin: number) => {
    const curr = modeMap.get(mode) ?? { trips: 0, legs: 0, distanceM: 0, durationMin: 0 };
    curr.legs += 1;
    curr.distanceM += distanceM;
    curr.durationMin += durationMin;
    modeMap.set(mode, curr);
  };

  for (const trip of detailedTrips) {
    detailedDistanceM += trip.distanceM;
    detailedWalkM += trip.walkM;
    detailedDurationMin += trip.durationMin;
    totalStops += trip.stopsCount;

    const tripModes = new Set<LegMode>();
    let hasRail = false;

    for (const leg of trip.legs) {
      tripModes.add(leg.mode);
      addModeLeg(leg.mode, leg.distanceM, leg.durationMin);

      if (leg.mode === 'train') {
        hasRail = true;
        railDistanceM += leg.distanceM;
        railDurationMin += leg.durationMin;
        if (leg.railAgency) {
          agencyCount.set(leg.railAgency, (agencyCount.get(leg.railAgency) ?? 0) + 1);
        }
      }

      if (leg.mode !== 'walk' && leg.line) {
        const lineKey = `${leg.mode}:${leg.line.toUpperCase()}`;
        const existing = lineMap.get(lineKey);
        if (existing) {
          existing.count += 1;
          existing.distanceM += leg.distanceM;
        } else {
          lineMap.set(lineKey, {
            line: leg.line,
            mode: leg.mode,
            count: 1,
            distanceM: leg.distanceM,
            cityId: trip.cityId,
            railAgency: leg.railAgency,
          });
        }
      }
    }

    for (const m of tripModes) {
      const curr = modeMap.get(m);
      if (curr) curr.trips += 1;
    }
    if (hasRail) railTrips += 1;
  }

  // 3. Bilety kolejowe (dodaja przejazdy kolejowe, jesli nie sa juz w sledzonych
  // albo zapisanych trasach). Bilet to realna podroz, a nie samo wyszukiwanie.
  const tickets = input.railTickets ?? [];
  const ticketsCount = tickets.length;
  let ticketTrips = 0;
  for (const ticket of tickets) {
    markTs(ticket.addedAt);
    const connKey = ticket.connectionId ? normalizeTripKey(ticket.connectionId) : '';
    if (connKey && seenConnectionIds.has(connKey)) continue;
    ticketTrips += 1;
    railTrips += 1;
    const curr = modeMap.get('train') ?? { trips: 0, legs: 0, distanceM: 0, durationMin: 0 };
    curr.trips += 1;
    curr.legs += 1;
    modeMap.set('train', curr);
  }

  // 4. Historia wyszukiwan (tripHistory) sluzy juz tylko do rankingu celow.
  // Liczba sprawdzen i prostoliniowy dystans nie sa dowodem przejazdu, wiec
  // nie trafiaja do kursow, kilometrow ani czasu w trasie.
  let tripHistoryCount = 0;

  const destMap = new Map<
    string,
    {
      key: string;
      title: string;
      address: string;
      count: number;
      durationSum: number;
      cityId: CityId;
    }
  >();

  for (const section of input.tripHistory) {
    tripHistoryCount += section.items.length;
    for (const item of section.items) {
      markTs(item.timestamp);
      const uses = tripUses(item);
      const dur = isFiniteNumber(item.duration_min) && item.duration_min > 0 ? item.duration_min : 0;

      const title = item.dest_title?.trim();
      if (title) {
        const key = normalizeDestKey(title) || item.dest_id;
        const prev = destMap.get(key);
        if (prev) {
          prev.count += uses;
          prev.durationSum += dur * uses;
          if (!prev.address && item.dest_address) prev.address = item.dest_address;
        } else {
          destMap.set(key, {
            key,
            title,
            address: item.dest_address?.trim() || '',
            count: uses,
            durationSum: dur * uses,
            cityId: section.city,
          });
        }
      }
    }
  }

  // Jesli historia celow jest pusta, uzupelniamy cele z detailedTrips (zapisane / sledzone).
  if (destMap.size === 0) {
    for (const trip of detailedTrips) {
      const title = trip.destTitle?.trim();
      if (!title) continue;
      const key = normalizeDestKey(title);
      if (!key) continue;
      const prev = destMap.get(key);
      if (prev) {
        prev.count += 1;
        prev.durationSum += trip.durationMin;
      } else {
        destMap.set(key, {
          key,
          title,
          address: '',
          count: 1,
          durationSum: trip.durationMin,
          cityId: trip.cityId,
        });
      }
    }
  }

  // 6. Bilans globalny to wylacznie realne przejazdy: sledzone podroze,
  // zapisane trasy i kupione bilety. Wyszukiwania nie podbijaja licznikow.
  const totalTrips = detailedTrips.length + ticketTrips;
  const totalDistanceM = detailedDistanceM;
  const totalDurationMin = detailedDurationMin;
  const totalWalkM = detailedWalkM;
  const totalTransitM = Math.max(0, totalDistanceM - totalWalkM);

  const totalDistanceKm = round1(totalDistanceM / 1000);
  const totalTransitKm = round1(totalTransitM / 1000);
  const totalWalkKm = round1(totalWalkM / 1000);

  // 7. Ranking top linii (do wykresu kolowego).
  const allLines = [...lineMap.values()].sort(
    (a, b) => b.count - a.count || b.distanceM - a.distanceM || a.line.localeCompare(b.line),
  );
  const totalLineOccurrences = allLines.reduce((sum, l) => sum + l.count, 0);
  const topLines: TopLineItem[] = allLines.slice(0, 6).map((l) => ({
    key: `${l.mode}:${l.line}`,
    line: l.line,
    mode: l.mode,
    count: l.count,
    share: totalLineOccurrences > 0 ? l.count / totalLineOccurrences : 0,
    distanceKm: round1(l.distanceM / 1000),
    cityId: l.cityId,
    railAgency: l.railAgency,
  }));

  // 8. Ranking najczestszych celow.
  const allDests = [...destMap.values()].sort(
    (a, b) => b.count - a.count || a.title.localeCompare(b.title),
  );
  const totalDestUses = allDests.reduce((sum, d) => sum + d.count, 0);
  const topDestinations: TopDestinationItem[] = allDests.slice(0, 4).map((d) => ({
    key: d.key,
    title: d.title,
    address: d.address,
    count: d.count,
    share: totalDestUses > 0 ? d.count / totalDestUses : 0,
    avgDurationMin: d.count > 0 ? Math.round(d.durationSum / d.count) : 0,
    cityId: d.cityId,
  }));

  // 9. Podzial srodkow transportu (udzial liczony po liczbie odcinkow albo dystansie).
  const rawModes = [...modeMap.entries()].map(([mode, stats]) => ({
    mode,
    trips: stats.trips || stats.legs,
    legs: stats.legs,
    distanceKm: round1(stats.distanceM / 1000),
    durationMin: stats.durationMin,
  }));
  const transitModeDistSum = rawModes
    .filter((m) => m.mode !== 'walk')
    .reduce((sum, m) => sum + m.distanceKm, 0);
  const transitModeLegsSum = rawModes
    .filter((m) => m.mode !== 'walk')
    .reduce((sum, m) => sum + m.legs, 0);

  const modes: ModeBreakdownItem[] = rawModes
    .filter((m) => m.mode !== 'walk' && (m.legs > 0 || m.trips > 0))
    .map((m) => ({
      ...m,
      share:
        transitModeDistSum > 0
          ? m.distanceKm / transitModeDistSum
          : transitModeLegsSum > 0
            ? m.legs / transitModeLegsSum
            : 0,
    }))
    .sort((a, b) => b.share - a.share || b.legs - a.legs);

  let topAgency: string | null = null;
  let topAgencyCount = 0;
  for (const [agency, count] of agencyCount) {
    if (count > topAgencyCount) {
      topAgency = agency;
      topAgencyCount = count;
    }
  }

  const rail: RailStats = {
    trips: railTrips,
    distanceKm: round1(railDistanceM / 1000),
    durationMin: railDurationMin,
    ticketsCount,
    topAgency,
  };

  const citiesCount = citiesUsed.size;
  const estimatedCo2SavedKg = round1(totalTransitKm * CO2_SAVED_KG_PER_TRANSIT_KM);
  const archetype = chooseArchetype({
    totalTrips,
    citiesCount,
    totalWalkKm,
    totalDistanceKm,
    railDistanceKm: rail.distanceKm,
    railTrips: rail.trips,
    modes,
  });

  const hasAnyData =
    totalTrips > 0 ||
    savedPlacesCount > 0 ||
    savedRoutesCount > 0 ||
    topLines.length > 0 ||
    ticketsCount > 0;

  const wrapped: WrappedSafeSummary = {
    year: now.getFullYear(),
    totalTrips,
    totalDistanceKm,
    totalTransitKm,
    totalWalkKm,
    totalDurationMin,
    totalStops,
    citiesCount: Math.max(citiesCount, hasAnyData ? 1 : 0),
    railTrips: rail.trips,
    railDistanceKm: rail.distanceKm,
    estimatedCo2SavedKg,
    archetype,
    modes: modes.slice(0, 4).map((m) => ({
      mode: m.mode,
      share: m.share,
      distanceKm: m.distanceKm,
      trips: m.trips,
    })),
  };

  return {
    totalTrips,
    totalDistanceKm,
    totalTransitKm,
    totalWalkKm,
    totalDurationMin,
    totalStops,
    citiesCount,
    savedPlacesCount,
    savedRoutesCount,
    tripHistoryCount,
    topLines,
    totalLineOccurrences,
    topDestinations,
    modes,
    rail,
    archetype,
    estimatedCo2SavedKg,
    activeSinceTs,
    hasAnyData,
    hasDetailedLines: topLines.length > 0,
    wrapped,
  };
}
