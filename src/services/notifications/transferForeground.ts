import type { Connection, Leg, LegStop } from '../../types/models';
import { RoutingService } from '../api';
import { getCurrentLocationSnapshot } from '../currentLocation';
import { liveTracker } from '../liveTracker';
import { getSettingsSync, profileWalkSpeedMps } from '../settings';
import { distanceMeters } from '../../gtfs/geo';
import { computeLegTimeline } from './tripProgress';
import {
  TransferRideEstimator,
  TransferRiskDecision,
} from './transferAssessment';

type RideEstimate = NonNullable<ReturnType<TransferRideEstimator['observe']>>;
import {
  isProtectedTrainLeg,
  type NextTrainInfo,
  type TransferAlternative,
  type TransferDelaySource,
  type TransferProtectionState,
  type TransferSegmentSummary,
} from './transferTypes';
import type { TrackedTrip } from './types';

interface Ride {
  legIndex: number;
  leg: Leg;
  stops: LegStop[];
  board: number;
  alight: number;
  scheduledDepartMs: number;
  scheduledArriveMs: number;
}

const MAX_ALTERNATIVES = 3;
const LIVE_FRESH_MS = 120_000;
const STALE_FIX_MS = 30_000;

function stopIdMatch(stop: LegStop, id?: string, name?: string): boolean {
  if (id && stop.stopId === id) return true;
  if (name && stop.name.trim().toLowerCase() === name.trim().toLowerCase()) return true;
  return false;
}

function buildFallbackStops(
  leg: Leg,
  departMs: number,
  arriveMs: number,
  baseMs: number,
): LegStop[] {
  const departSec = Math.round((departMs - baseMs) / 1000);
  const arriveSec = Math.max(departSec + 60, Math.round((arriveMs - baseMs) / 1000));
  return [
    {
      stopId: leg.fromStopId ?? `${leg.id}:from`,
      name: leg.fromStop,
      lat: leg.fromLat ?? 0,
      lon: leg.fromLon ?? 0,
      seq: 0,
      arriveSec: departSec,
      departSec,
    },
    {
      stopId: leg.toStopId ?? `${leg.id}:to`,
      name: leg.toStop,
      lat: leg.toLat ?? 0,
      lon: leg.toLon ?? 0,
      seq: 1,
      arriveSec,
      departSec: arriveSec,
    },
  ];
}

function clockFromMs(ms: number): string {
  const date = new Date(ms);
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

function departureMsOf(connection: Connection, fallbackMs: number): number {
  const timeline = computeLegTimeline(connection, new Date(fallbackMs));
  return timeline[0]?.departMs ?? fallbackMs;
}

function arrivalMsOf(connection: Connection, fallbackMs: number): number {
  const timeline = computeLegTimeline(connection, new Date(fallbackMs));
  return timeline.at(-1)?.arriveMs ?? fallbackMs;
}

function walkBetweenLegs(
  legs: Leg[],
  fromLegIndex: number,
  toLegIndex: number,
  fromStop: LegStop,
  toStop: LegStop,
  walkSpeedMps: number,
): { walkSec: number; walkM: number } {
  let walkM = 0;
  let explicitWalk = false;
  for (let i = fromLegIndex + 1; i < toLegIndex; i++) {
    const mid = legs[i];
    if (mid?.mode === 'walk') {
      explicitWalk = true;
      walkM += Math.max(0, mid.walkM ?? 0);
    }
  }
  if (!explicitWalk) {
    const hasCoords =
      fromStop.lat != null &&
      fromStop.lon != null &&
      toStop.lat != null &&
      toStop.lon != null &&
      Number.isFinite(fromStop.lat) &&
      Number.isFinite(fromStop.lon) &&
      Number.isFinite(toStop.lat) &&
      Number.isFinite(toStop.lon) &&
      (fromStop.lat !== 0 || fromStop.lon !== 0) &&
      (toStop.lat !== 0 || toStop.lon !== 0);
    walkM = hasCoords
      ? Math.round(distanceMeters(fromStop.lat!, fromStop.lon!, toStop.lat!, toStop.lon!))
      : 0;
  }
  const walkSec = walkM <= 25 ? 0 : Math.max(45, Math.round((walkM * 1.15) / walkSpeedMps));
  return { walkSec, walkM };
}

/** Ochrona przesiadek w trakcie działania aplikacji (GPS + live feed + szybka wymiana miejska). */
export class ForegroundTransferProtection {
  private readonly trip: TrackedTrip;
  private readonly baseMs: number;
  private readonly firstDepartureMs: number;
  private readonly plannedArrivalMs: number;
  private rides: Ride[] = [];
  private loaded = false;
  private loadFailed = false;
  private rideIndex = 0;
  private estimator = new TransferRideEstimator();
  private nextEstimator = new TransferRideEstimator();
  private decision = new TransferRiskDecision();
  private alternatives: TransferAlternative[] = [];
  private lastSearch = 0;
  private lastSearchDelaySec = 0;
  private lastPosition = -1;
  private nextTrain: NextTrainInfo | undefined;
  private nextTrainSearched = false;
  private revision = 0;

  constructor(trip: TrackedTrip) {
    this.trip = trip;
    const timeline = computeLegTimeline(trip.connection, new Date(trip.startedAt));
    const first = timeline.find((entry) => entry.leg.mode !== 'walk');
    const date = new Date(first?.departMs ?? trip.startedAt);
    date.setHours(0, 0, 0, 0);
    this.baseMs = date.getTime();
    this.firstDepartureMs = timeline[0]?.departMs ?? trip.startedAt;
    this.plannedArrivalMs = timeline.at(-1)?.arriveMs ?? trip.startedAt;
  }

  /** Wymusza natychmiastowe ponowne wyszukanie propozycji przy najbliższym odświeżeniu. */
  resetSearchCooldown(): void {
    this.lastSearch = 0;
    this.nextTrainSearched = false;
  }

  private async load(): Promise<void> {
    if (this.loaded) return;
    this.loaded = true;
    const timeline = computeLegTimeline(this.trip.connection, new Date(this.trip.startedAt));
    const transitLegs = this.trip.connection.legs
      .map((leg, legIndex) => ({ leg, legIndex }))
      .filter(({ leg }) => leg.mode !== 'walk');
    const loadedRides: Ride[] = [];

    for (const { leg, legIndex } of transitLegs) {
      const entry = timeline[legIndex];
      const scheduledDepartMs = entry?.departMs ?? this.trip.startedAt;
      const scheduledArriveMs = entry?.arriveMs ?? scheduledDepartMs + 60_000;
      let stops: LegStop[] = [];
      if (leg.intermediateStops && leg.intermediateStops.length >= 2) {
        stops = leg.intermediateStops;
      } else if (leg.tripId) {
        try {
          stops = await RoutingService.getTripStops(leg.tripId);
        } catch {
          stops = [];
        }
      }
      if (stops.length < 2) {
        stops = buildFallbackStops(leg, scheduledDepartMs, scheduledArriveMs, this.baseMs);
      }

      let board = stops.findIndex((stop) => stopIdMatch(stop, leg.fromStopId, leg.fromStop));
      let alight = stops.findIndex(
        (stop, idx) => idx > Math.max(board, 0) && stopIdMatch(stop, leg.toStopId, leg.toStop),
      );
      if (board < 0) board = 0;
      if (alight <= board) alight = stops.length - 1;
      if (alight <= board) {
        stops = buildFallbackStops(leg, scheduledDepartMs, scheduledArriveMs, this.baseMs);
        board = 0;
        alight = 1;
      }

      loadedRides.push({
        legIndex,
        leg,
        stops,
        board,
        alight,
        scheduledDepartMs,
        scheduledArriveMs,
      });
    }

    this.rides = loadedRides;
    this.loadFailed = loadedRides.length < 2;
    const active = this.trip.transfer?.activeLegIndex;
    if (active !== undefined) {
      const index = this.rides.findIndex((ride) => ride.legIndex >= active);
      if (index >= 0) this.rideIndex = index;
    }
  }

  private freshLiveDelay(tripId: string | undefined, now: number): number | undefined {
    if (!tripId) return undefined;
    const vehicles = liveTracker.snapshot();
    const match = vehicles.find(
      (vehicle) =>
        vehicle.matchedTripId === tripId &&
        vehicle.delaySec != null &&
        now - vehicle.updatedAt >= 0 &&
        now - vehicle.updatedAt <= LIVE_FRESH_MS,
    );
    return match?.delaySec ?? undefined;
  }

  private rideTimes(ride: Ride): { departMs: number; arriveMs: number } {
    const boardStop = ride.stops[ride.board];
    const alightStop = ride.stops[ride.alight];
    const departMs =
      boardStop?.departSec != null
        ? this.baseMs + boardStop.departSec * 1000
        : ride.scheduledDepartMs;
    const arriveMs =
      alightStop?.arriveSec != null
        ? this.baseMs + alightStop.arriveSec * 1000
        : alightStop?.departSec != null
          ? this.baseMs + alightStop.departSec * 1000
          : ride.scheduledArriveMs;
    return { departMs, arriveMs };
  }

  private buildTransferSummaries(
    now: number,
    activeDelaySec: number,
    walkSpeedMps: number,
  ): TransferSegmentSummary[] {
    const out: TransferSegmentSummary[] = [];
    for (let i = 0; i < this.rides.length - 1; i++) {
      const curr = this.rides[i];
      const next = this.rides[i + 1];
      const currTimes = this.rideTimes(curr);
      const nextTimes = this.rideTimes(next);
      const currDelay =
        i === this.rideIndex
          ? activeDelaySec
          : (this.freshLiveDelay(curr.leg.tripId, now) ?? curr.leg.delaySec ?? 0);
      const nextDelay = this.freshLiveDelay(next.leg.tripId, now) ?? next.leg.delaySec ?? 0;
      const arrivalAtMs = currTimes.arriveMs + currDelay * 1000;
      const departureAtMs = nextTimes.departMs + nextDelay * 1000;
      const { walkSec, walkM } = walkBetweenLegs(
        this.trip.connection.legs,
        curr.legIndex,
        next.legIndex,
        curr.stops[curr.alight],
        next.stops[next.board],
        walkSpeedMps,
      );
      const slackSec = Math.round((departureAtMs - arrivalAtMs) / 1000) - walkSec;
      out.push({
        legIndex: curr.legIndex,
        nextLegIndex: next.legIndex,
        fromLine: curr.leg.line ?? '',
        fromMode: curr.leg.mode,
        toLine: next.leg.line ?? '',
        toMode: next.leg.mode,
        transferStop: curr.stops[curr.alight]?.name ?? curr.leg.toStop,
        walkM,
        walkSec,
        arrivalAtMs,
        departureAtMs,
        slackSec,
        state: i < this.rideIndex ? 'passed' : i === this.rideIndex ? 'active' : 'upcoming',
        isTrainNext: isProtectedTrainLeg(next.leg),
      });
    }
    return out;
  }

  async refresh(): Promise<TransferProtectionState> {
    const now = Date.now();
    try {
      await this.load();
    } catch {
      return this.state('unavailable', now, { reason: 'routing' });
    }
    if (this.loadFailed) {
      return this.state('unavailable', now, { reason: 'routing' });
    }

    const ride = this.rides[this.rideIndex];
    const next = this.rides[this.rideIndex + 1];
    if (!ride || !next) {
      return this.state('complete', now, {
        activeLegIndex: ride?.legIndex,
        currentLine: ride?.leg.line,
        currentMode: ride?.leg.mode,
        transfers: this.buildTransferSummaries(
          now,
          0,
          profileWalkSpeedMps(getSettingsSync().walkPace),
        ),
      });
    }

    const settings = getSettingsSync();
    const walkSpeedMps = profileWalkSpeedMps(settings.walkPace);
    const { departMs: rideDepartMs, arriveMs: rideArriveMs } = this.rideTimes(ride);
    const { departMs: nextScheduledDepartMs } = this.rideTimes(next);
    const nextLiveDelay = this.freshLiveDelay(next.leg.tripId, now);
    const nextDelaySec = nextLiveDelay ?? next.leg.delaySec ?? 0;
    const departureAtMs = nextScheduledDepartMs + nextDelaySec * 1000;
    const departureSource: 'live' | 'schedule' =
      nextLiveDelay !== undefined || next.leg.live ? 'live' : 'schedule';

    const { walkSec, walkM } = walkBetweenLegs(
      this.trip.connection.legs,
      ride.legIndex,
      next.legIndex,
      ride.stops[ride.alight],
      next.stops[next.board],
      walkSpeedMps,
    );
    const baseBuffer = isProtectedTrainLeg(next.leg)
      ? Math.max(60, settings.trainMinTransferSec)
      : Math.max(60, settings.minTransferSec);
    const transferStopName = ride.stops[ride.alight]?.name ?? ride.leg.toStop;

    const fix = getCurrentLocationSnapshot()?.location;
    const fixFresh = !!fix && now - fix.timestamp >= 0 && now - fix.timestamp <= STALE_FIX_MS;

    // 1) Sprawdź czy pasażer już wsiadł do kolejnego pojazdu.
    if (fixFresh && this.nextEstimator.observe(next.stops, next.board, this.baseMs, fix, now)) {
      this.rideIndex++;
      this.estimator = this.nextEstimator;
      this.nextEstimator = new TransferRideEstimator();
      this.decision = new TransferRiskDecision();
      this.alternatives = [];
      this.lastSearch = 0;
      this.lastPosition = -1;
      this.nextTrain = undefined;
      this.nextTrainSearched = false;
      this.revision++;
      return this.refresh();
    }

    // 2) Obserwacja GPS na bieżącym pojeździe.
    const gpsEstimate = fix
      ? this.estimator.observe(ride.stops, ride.board, this.baseMs, fix, now)
      : null;

    // 3) Telemetria live z feedu (działa również przed wejściem do pojazdu i w korku).
    const currentLiveDelay = this.freshLiveDelay(ride.leg.tripId, now);

    // 4) Pasażer na przystanku przesiadkowym czekający na kolejny kurs nie wpada w offRoute.
    const transferStop = ride.stops[ride.alight];
    const atTransferStop =
      fixFresh &&
      transferStop &&
      transferStop.lat != null &&
      transferStop.lon != null &&
      distanceMeters(fix.lat, fix.lon, transferStop.lat, transferStop.lon) <= 130 &&
      now >= rideArriveMs - 90_000 &&
      now <= departureAtMs + 300_000;

    let delaySec: number;
    let delaySource: TransferDelaySource;
    let effectiveEstimate: RideEstimate | null = gpsEstimate;

    if (gpsEstimate) {
      delaySec = gpsEstimate.delaySec;
      delaySource = 'gps';
      this.lastPosition = gpsEstimate.position;
    } else if (currentLiveDelay !== undefined) {
      delaySec = currentLiveDelay;
      delaySource = 'live';
      effectiveEstimate = {
        position: Math.max(ride.board, this.lastPosition),
        delaySec: currentLiveDelay,
      };
    } else if (atTransferStop) {
      delaySec = Math.max(0, Math.round((now - rideArriveMs) / 1000));
      delaySource = 'gps';
      const arrivalAtMs = Math.max(now, rideArriveMs);
      const slackSec = Math.round((departureAtMs - arrivalAtMs) / 1000) - walkSec;
      const transfers = this.buildTransferSummaries(now, delaySec, walkSpeedMps);
      return this.state(slackSec >= 0 ? 'safe' : 'risk', now, {
        activeLegIndex: ride.legIndex,
        currentLine: ride.leg.line,
        currentMode: ride.leg.mode,
        nextLine: next.leg.line,
        nextMode: next.leg.mode,
        transferStop: transferStopName,
        delaySec,
        slackSec,
        walkSec,
        walkM,
        bufferSec: baseBuffer,
        arrivalAtMs,
        departureAtMs,
        departureSource,
        delaySource,
        transfers,
      });
    } else {
      this.alternatives = [];
      const waiting = now < rideDepartMs + 300_000;
      const scheduledArrivalAtMs = rideArriveMs + (ride.leg.delaySec ?? 0) * 1000;
      const scheduledSlackSec =
        Math.round((departureAtMs - scheduledArrivalAtMs) / 1000) - walkSec;
      const transfers = this.buildTransferSummaries(now, ride.leg.delaySec ?? 0, walkSpeedMps);
      return this.state(waiting ? 'waiting' : 'unavailable', now, {
        activeLegIndex: ride.legIndex,
        currentLine: ride.leg.line,
        currentMode: ride.leg.mode,
        nextLine: next.leg.line,
        nextMode: next.leg.mode,
        transferStop: transferStopName,
        delaySec: ride.leg.delaySec ?? 0,
        slackSec: scheduledSlackSec,
        walkSec,
        walkM,
        bufferSec: baseBuffer,
        arrivalAtMs: scheduledArrivalAtMs,
        departureAtMs,
        departureSource,
        delaySource: 'schedule',
        reason: waiting ? undefined : 'offRoute',
        transfers,
      });
    }

    const arrivalAtMs = rideArriveMs + delaySec * 1000;
    const slackSec = Math.round((departureAtMs - arrivalAtMs) / 1000) - walkSec;
    const assessment = this.decision.assess(slackSec, baseBuffer, now);
    const transfers = this.buildTransferSummaries(now, delaySec, walkSpeedMps);

    const common: Partial<TransferProtectionState> = {
      activeLegIndex: ride.legIndex,
      currentLine: ride.leg.line,
      currentMode: ride.leg.mode,
      nextLine: next.leg.line,
      nextMode: next.leg.mode,
      transferStop: transferStopName,
      delaySec,
      slackSec,
      walkSec,
      walkM,
      bufferSec: baseBuffer,
      arrivalAtMs,
      departureAtMs,
      departureSource,
      delaySource,
      transfers,
    };

    if (assessment === 'safe') {
      this.alternatives = [];
      return this.state('safe', now, common);
    }

    // Przesiadka na pociąg (krajowy pl: lub kolejowy): nigdy nie wymieniamy pociągów.
    const nextIsTrain = isProtectedTrainLeg(next.leg);
    if (nextIsTrain && assessment === 'missed') {
      if (!this.nextTrainSearched) {
        this.nextTrainSearched = true;
        this.nextTrain = await this.findNextTrain(next, arrivalAtMs + walkSec * 1000);
      }
      return this.state('conductor', now, { ...common, nextTrain: this.nextTrain });
    }

    this.alternatives = this.alternatives.filter((item) => item.validUntil > now);

    const delayWorsened = delaySec - this.lastSearchDelaySec >= 90;
    const searchDue =
      this.alternatives.length === 0
        ? now - this.lastSearch >= 30_000
        : now - this.lastSearch >= 60_000 || delayWorsened;

    if (assessment === 'missed' && searchDue) {
      this.lastSearch = now;
      this.lastSearchDelaySec = delaySec;
      this.alternatives = await this.findAlternatives(
        ride,
        next,
        effectiveEstimate!,
        walkSec,
        baseBuffer,
        walkSpeedMps,
        now,
      );
    } else if (
      assessment === 'risk' &&
      slackSec < baseBuffer &&
      !nextIsTrain &&
      this.alternatives.length === 0 &&
      now - this.lastSearch >= 45_000 &&
      delaySource === 'live'
    ) {
      this.lastSearch = now;
      this.lastSearchDelaySec = delaySec;
      this.alternatives = await this.findAlternatives(
        ride,
        next,
        effectiveEstimate!,
        walkSec,
        baseBuffer,
        walkSpeedMps,
        now,
      );
    }

    if (assessment === 'risk' && this.alternatives.length === 0) {
      return this.state('risk', now, common);
    }

    const best = this.alternatives[0];
    if (best && best.validUntil > now) {
      return this.state('alternative', now, {
        ...common,
        alternative: best,
        alternatives: this.alternatives,
      });
    }

    return this.state(assessment === 'risk' ? 'risk' : 'noAlternative', now, common);
  }

  private async findNextTrain(next: Ride, afterMs: number): Promise<NextTrainInfo | undefined> {
    try {
      const from = next.stops[next.board];
      if (!from || from.lat == null || from.lon == null) return undefined;
      const results = await RoutingService.getConnections({
        fromId: from.stopId,
        fromTitle: from.name,
        fromLat: from.lat,
        fromLon: from.lon,
        toId: this.trip.toId,
        toTitle: this.trip.toTitle,
        toLat: this.trip.toLat,
        toLon: this.trip.toLon,
        departureTimeSec: Math.max(0, Math.floor((afterMs - this.baseMs) / 1000)),
        trainsEnabled: true,
      });
      for (const conn of results) {
        const trainLeg = conn.legs.find((l) => isProtectedTrainLeg(l));
        if (!trainLeg) continue;
        const depMs = departureMsOf(conn, afterMs);
        if (depMs <= afterMs) continue;
        const label = trainLeg.line ?? trainLeg.trainNumber ?? '';
        if (!label) continue;
        return {
          label,
          trainName: trainLeg.trainName,
          departAtMs: depMs,
        };
      }
      return undefined;
    } catch {
      return undefined;
    }
  }

  /**
   * Łączy szybką wymianę kolejnego odcinka miejskiego (legAlternatives)
   * z pełnym przeplanowaniem RAPTOR (stayOn / sameStop). Pociągów nigdy nie wymienia.
   */
  private async findAlternatives(
    ride: Ride,
    next: Ride,
    estimate: RideEstimate,
    walkSec: number,
    bufferSec: number,
    walkSpeedMps: number,
    now: number,
  ): Promise<TransferAlternative[]> {
    const candidates: TransferAlternative[] = [];
    const seenKeys = new Set<string>();
    const addCandidate = (alt: TransferAlternative) => {
      const key = `${alt.kind}|${alt.nextLine}|${alt.transferStop}|${Math.round(alt.departureAtMs / 60_000)}|${Math.round(alt.arrivalAtMs / 60_000)}`;
      if (seenKeys.has(key)) return;
      seenKeys.add(key);
      candidates.push(alt);
    };

    const delayedArriveMs = this.rideTimes(ride).arriveMs + estimate.delaySec * 1000;

    if (!isProtectedTrainLeg(next.leg)) {
      const urbanSwaps = await this.findUrbanLegSwapAlternatives(
        ride,
        next,
        delayedArriveMs,
        estimate.delaySec,
        walkSec,
        bufferSec,
        walkSpeedMps,
        now,
      );
      for (const alt of urbanSwaps) addCandidate(alt);
    }

    const groupAlts = this.findGroupAlternatives(
      ride,
      estimate,
      bufferSec,
      walkSpeedMps,
      now,
    );
    for (const alt of groupAlts) addCandidate(alt);

    const raptorAlts = await this.findRaptorAlternatives(
      ride,
      estimate,
      bufferSec,
      walkSpeedMps,
      now,
    );
    for (const alt of raptorAlts) addCandidate(alt);

    candidates.sort((a, b) => {
      const directBonusA = a.source === 'group' && a.connection.transfers === 0 ? -120_000 : 0;
      const directBonusB = b.source === 'group' && b.connection.transfers === 0 ? -120_000 : 0;
      const scoreA = a.arrivalAtMs + (a.kind === 'sameStop' ? 0 : 180_000) + directBonusA;
      const scoreB = b.arrivalAtMs + (b.kind === 'sameStop' ? 0 : 180_000) + directBonusB;
      return scoreA - scoreB;
    });

    return candidates.slice(0, MAX_ALTERNATIVES);
  }

  /** Sprawdza rodzeństwo z tej samej grupy pierwszego kursu (np. wariant bezpośredni). */
  private findGroupAlternatives(
    ride: Ride,
    estimate: RideEstimate,
    bufferSec: number,
    walkSpeedMps: number,
    now: number,
  ): TransferAlternative[] {
    const siblings = this.trip.groupAlternatives;
    if (!siblings?.length || !ride.leg.tripId) return [];

    const out: TransferAlternative[] = [];
    const currentPos = Math.floor(estimate.position);

    for (const sibling of siblings) {
      const transitEntries = sibling.legs
        .map((leg, idx) => ({ leg, idx }))
        .filter(({ leg }) => leg.mode !== 'walk');
      if (transitEntries.length === 0) continue;

      const firstEntry = transitEntries[0];
      if (firstEntry.leg.tripId !== ride.leg.tripId) continue;

      const targetStop = ride.stops.find(
        (s, idx) =>
          idx > currentPos &&
          stopIdMatch(s, firstEntry.leg.toStopId, firstEntry.leg.toStop),
      );
      if (!targetStop && transitEntries.length > 1) continue;

      if (transitEntries.length === 1 || sibling.transfers === 0) {
        const baseStopArrMs =
          targetStop?.arriveSec != null
            ? this.baseMs + targetStop.arriveSec * 1000
            : targetStop?.departSec != null
              ? this.baseMs + targetStop.departSec * 1000
              : arrivalMsOf(sibling, this.firstDepartureMs);
        const rideArriveMs = baseStopArrMs + estimate.delaySec * 1000;
        const lastWalk =
          sibling.legs[sibling.legs.length - 1]?.mode === 'walk'
            ? sibling.legs[sibling.legs.length - 1]
            : undefined;
        const tailWalkM = lastWalk?.walkM ?? 0;
        const tailWalkSec =
          tailWalkM <= 25 ? 0 : Math.max(45, Math.round((tailWalkM * 1.15) / walkSpeedMps));
        const finalArrMs = rideArriveMs + tailWalkSec * 1000;
        if (finalArrMs < now + 30_000) continue;

        const updatedLegs = sibling.legs.map((leg, idx) => {
          if (idx === firstEntry.idx) {
            return {
              ...leg,
              arriveAt: clockFromMs(rideArriveMs),
              delaySec: estimate.delaySec,
              arrivalDelaySec: estimate.delaySec,
              live: true,
            };
          }
          if (lastWalk && idx === sibling.legs.length - 1) {
            return {
              ...leg,
              departAt: clockFromMs(rideArriveMs),
              arriveAt: clockFromMs(finalArrMs),
            };
          }
          return leg;
        });

        const updatedConnection: Connection = {
          ...sibling,
          legs: updatedLegs,
          arriveAt: clockFromMs(finalArrMs),
          durationMin: Math.max(1, Math.ceil((finalArrMs - this.firstDepartureMs) / 60_000)),
          delayMin: Math.round(estimate.delaySec / 60),
          live: true,
        };

        out.push({
          id: `group-direct-${sibling.id}`,
          connection: updatedConnection,
          activeLegIndex: ride.legIndex,
          nextLine: ride.leg.line ?? firstEntry.leg.line ?? '',
          nextMode: ride.leg.mode,
          transferStop: firstEntry.leg.toStop,
          departureAtMs: this.rideTimes(ride).departMs + estimate.delaySec * 1000,
          arrivalAtMs: finalArrMs,
          validUntil: Math.max(now + 45_000, rideArriveMs - 30_000),
          kind: 'stayOn',
          source: 'group',
          deltaArrivalMin: Math.round((finalArrMs - this.plannedArrivalMs) / 60_000),
          walkM: 0,
        });
        continue;
      }

      if (!targetStop) continue;
      const alightIdx = ride.stops.indexOf(targetStop);
      const stopArriveMs =
        targetStop.arriveSec != null
          ? this.baseMs + targetStop.arriveSec * 1000
          : targetStop.departSec != null
            ? this.baseMs + targetStop.departSec * 1000
            : this.rideTimes(ride).arriveMs;
      const transferArriveMs = stopArriveMs + estimate.delaySec * 1000;
      if (transferArriveMs < now + 30_000) continue;

      const nextEntry = transitEntries[1];
      if (isProtectedTrainLeg(nextEntry.leg)) continue;

      const sibTimeline = computeLegTimeline(sibling, new Date(this.firstDepartureMs));
      const nextScheduledDepMs =
        sibTimeline[nextEntry.idx]?.departMs ?? this.firstDepartureMs;
      const nextDelaySec =
        this.freshLiveDelay(nextEntry.leg.tripId, now) ?? nextEntry.leg.delaySec ?? 0;
      const nextDepMs = nextScheduledDepMs + nextDelaySec * 1000;

      const { walkSec: sibWalkSec, walkM: sibWalkM } = walkBetweenLegs(
        sibling.legs,
        firstEntry.idx,
        nextEntry.idx,
        targetStop,
        {
          stopId: nextEntry.leg.fromStopId ?? '',
          name: nextEntry.leg.fromStop,
          lat: nextEntry.leg.fromLat,
          lon: nextEntry.leg.fromLon,
          seq: 0,
        },
        walkSpeedMps,
      );

      const sibSlackSec = Math.round((nextDepMs - transferArriveMs) / 1000) - sibWalkSec;
      if (sibSlackSec < bufferSec) continue;

      const finalArrMs = arrivalMsOf(sibling, this.firstDepartureMs);
      const updatedLegs = sibling.legs.map((leg, idx) =>
        idx === firstEntry.idx
          ? {
              ...leg,
              arriveAt: clockFromMs(transferArriveMs),
              delaySec: estimate.delaySec,
              arrivalDelaySec: estimate.delaySec,
              live: true,
            }
          : leg,
      );
      const updatedConnection: Connection = {
        ...sibling,
        legs: updatedLegs,
        delayMin: Math.round(estimate.delaySec / 60),
        live: true,
      };

      out.push({
        id: `group-alt-${sibling.id}`,
        connection: updatedConnection,
        activeLegIndex: ride.legIndex,
        nextLine: nextEntry.leg.line ?? '',
        nextMode: nextEntry.leg.mode,
        transferStop: firstEntry.leg.toStop,
        departureAtMs: nextDepMs,
        arrivalAtMs: finalArrMs,
        validUntil: Math.max(now + 45_000, transferArriveMs - 30_000),
        kind: alightIdx === ride.alight ? 'sameStop' : 'stayOn',
        source: 'group',
        deltaArrivalMin: Math.round((finalArrMs - this.plannedArrivalMs) / 60_000),
        slackSec: sibSlackSec,
        walkM: sibWalkM,
      });
    }

    return out;
  }

  private async findUrbanLegSwapAlternatives(
    ride: Ride,
    next: Ride,
    delayedArriveMs: number,
    delaySec: number,
    walkSec: number,
    bufferSec: number,
    walkSpeedMps: number,
    now: number,
  ): Promise<TransferAlternative[]> {
    try {
      const {
        applyLegSwapToConnection,
        isSwappableUrbanLeg,
        loadLegAlternatives,
        materializeAlternativeLeg,
      } = await import('../routing/legAlternatives');

      const delayedConnection: Connection = {
        ...this.trip.connection,
        legs: this.trip.connection.legs.map((l, idx) =>
          idx === ride.legIndex
            ? {
                ...l,
                arriveAt: clockFromMs(delayedArriveMs),
                delaySec,
                arrivalDelaySec: delaySec,
                live: true,
              }
            : l,
        ),
        delayMin: Math.round(delaySec / 60),
        live: true,
      };

      if (!isSwappableUrbanLeg(delayedConnection, next.legIndex)) return [];

      const nowSec = Math.round((now - this.baseMs) / 1000);
      const tripDelays = liveTracker.getTripDelays();
      const loaded = await loadLegAlternatives(delayedConnection, next.legIndex, {
        lookbackSec: 0,
        lookaheadSec: 5400,
        tripDelays,
        nowSec,
      });
      if (!loaded) return [];

      const delayedArriveSec = Math.round((delayedArriveMs - this.baseMs) / 1000);
      const results: TransferAlternative[] = [];
      for (const candidate of loaded.alternatives) {
        if (candidate.isCurrent || candidate.tripId === next.leg.tripId) continue;
        const requiredWalk = candidate.boardWalkSec || walkSec;
        if (candidate.effectiveDepartureSec < delayedArriveSec + requiredWalk + bufferSec) continue;

        const materialized = materializeAlternativeLeg(candidate, next.leg, undefined, nowSec);
        const swapped = applyLegSwapToConnection(delayedConnection, next.legIndex, materialized, {
          boardWalkM: candidate.boardWalkM,
          boardWalkSec: candidate.boardWalkSec,
          alightWalkM: candidate.alightWalkM,
          alightWalkSec: candidate.alightWalkSec,
          walkSpeedMps,
          nowSec,
        });
        const departureAtMs = this.baseMs + candidate.effectiveDepartureSec * 1000;
        const arrivalAtMs = arrivalMsOf(swapped, departureAtMs);
        const slackSec = Math.round((departureAtMs - delayedArriveMs) / 1000) - requiredWalk;
        results.push({
          id: `swap-${ride.legIndex}-${candidate.tripId}-${candidate.effectiveDepartureSec}`,
          connection: swapped,
          activeLegIndex: ride.legIndex,
          nextLine: candidate.line,
          nextMode: candidate.mode,
          transferStop: candidate.fromStop,
          departureAtMs,
          arrivalAtMs,
          validUntil: Math.max(now + 45_000, Math.min(delayedArriveMs, departureAtMs) - 30_000),
          kind: 'sameStop',
          source: 'legSwap',
          deltaArrivalMin: Math.round((arrivalAtMs - this.plannedArrivalMs) / 60_000),
          slackSec,
          walkM: candidate.boardWalkM,
        });
        if (results.length >= 2) break;
      }
      return results;
    } catch {
      return [];
    }
  }

  private async findRaptorAlternatives(
    ride: Ride,
    estimate: RideEstimate,
    bufferSec: number,
    walkSpeedMps: number,
    now: number,
  ): Promise<TransferAlternative[]> {
    const first = Math.max(ride.board + 1, Math.floor(estimate.position) + 1);
    const indexes = [
      ...new Set(
        [
          ride.alight,
          ...Array.from(
            { length: Math.max(0, Math.min(ride.stops.length - 1, first + 3) - first + 1) },
            (_, i) => first + i,
          ),
        ].filter((i) => i >= first && i < ride.stops.length),
      ),
    ];

    const out: TransferAlternative[] = [];
    for (const alight of indexes) {
      const stop = ride.stops[alight];
      const stopArriveMs =
        stop.arriveSec != null
          ? this.baseMs + stop.arriveSec * 1000
          : stop.departSec != null
            ? this.baseMs + stop.departSec * 1000
            : this.rideTimes(ride).arriveMs;
      const arrivalAtMs = stopArriveMs + estimate.delaySec * 1000;
      if (arrivalAtMs < now + 60_000 || stop.lat == null || stop.lon == null) continue;

      let connections: Connection[];
      try {
        connections = await RoutingService.getConnections({
          fromId: stop.stopId,
          fromTitle: stop.name,
          fromLat: stop.lat,
          fromLon: stop.lon,
          toId: this.trip.toId,
          toTitle: this.trip.toTitle,
          toLat: this.trip.toLat,
          toLon: this.trip.toLon,
          departureTimeSec: Math.max(
            0,
            Math.floor((arrivalAtMs + bufferSec * 1000 - this.baseMs) / 1000),
          ),
          trainsEnabled: false,
        });
      } catch {
        continue;
      }

      const tail = connections.find((item) => item.legs.some((leg) => leg.mode !== 'walk'));
      const firstNext = tail?.legs.find((leg) => leg.mode !== 'walk');
      if (!tail || !firstNext) continue;

      const current: Leg = {
        ...ride.leg,
        toStop: stop.name,
        toStopId: stop.stopId,
        toLat: stop.lat,
        toLon: stop.lon,
        arriveAt: clockFromMs(arrivalAtMs),
        stopsCount: alight - ride.board,
        intermediateStops: ride.stops.slice(ride.board, alight + 1),
      };
      const legs = [...this.trip.connection.legs.slice(0, ride.legIndex), current, ...tail.legs];
      const finalArrivalMs = arrivalMsOf(tail, arrivalAtMs);
      const nextDepMs = departureMsOf(tail, arrivalAtMs);
      const firstWalk = tail.legs[0]?.mode === 'walk' ? tail.legs[0] : undefined;
      const walkM = firstWalk?.walkM ?? 0;
      const walkSec = walkM <= 25 ? 0 : Math.max(45, Math.round((walkM * 1.15) / walkSpeedMps));
      const slackSec = Math.round((nextDepMs - arrivalAtMs) / 1000) - walkSec;
      const connection: Connection = {
        ...this.trip.connection,
        legs,
        arriveAt: tail.arriveAt,
        durationMin: Math.ceil((finalArrivalMs - this.firstDepartureMs) / 60_000),
        transfers: Math.max(0, legs.filter((leg) => leg.mode !== 'walk').length - 1),
        delayMin: Math.round(estimate.delaySec / 60),
        live: true,
        interchange: stop.name,
      };
      const kind: TransferAlternative['kind'] = alight === ride.alight ? 'sameStop' : 'stayOn';
      out.push({
        id: `${this.trip.id}-${alight}-${tail.departureSec}-${firstNext.line ?? ''}`,
        connection,
        activeLegIndex: ride.legIndex,
        nextLine: firstNext.line ?? '',
        nextMode: firstNext.mode,
        transferStop: stop.name,
        departureAtMs: nextDepMs,
        arrivalAtMs: finalArrivalMs,
        validUntil: Math.max(now + 45_000, arrivalAtMs - 30_000),
        kind,
        source: 'raptor',
        deltaArrivalMin: Math.round((finalArrivalMs - this.plannedArrivalMs) / 60_000),
        slackSec,
        walkM,
      });
    }

    return out;
  }

  private state(
    status: TransferProtectionState['status'],
    updatedAt: number,
    extra: Partial<TransferProtectionState> = {},
  ): TransferProtectionState {
    return {
      tripId: this.trip.id,
      status,
      updatedAt,
      revision: this.revision,
      scope: 'foreground',
      ...extra,
    };
  }
}
