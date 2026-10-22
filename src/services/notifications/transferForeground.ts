import { AppState } from 'react-native';
import type { Connection, Leg, LegStop } from '../../types/models';
import { RoutingService } from '../api';
import { getCurrentLocationSnapshot } from '../currentLocation';
import { distanceMeters } from '../../gtfs/geo';
import { getSettingsSync, profileWalkSpeedMps } from '../settings';
import { liveTracker } from '../liveTracker';
import { computeLegTimeline } from './tripProgress';
import { formatClock, parseClock } from './format';
import { TransferRideEstimator, TransferRiskDecision } from './transferAssessment';
import type { TransferAlternative, TransferProtectionState } from './transferTypes';
import type { TrackedTrip } from './types';

interface Ride {
  leg: Leg;
  index: number;
  stops: LegStop[];
  board: number;
  alight: number;
  baseMs: number;
  estimator: TransferRideEstimator;
}

export class ForegroundTransferProtection {
  private rides: Ride[] = [];
  private rideIndex = 0;
  private decision = new TransferRiskDecision();
  private lastSearch = 0;
  private alternative: TransferAlternative | undefined;
  private loading: Promise<void> | null = null;

  constructor(private readonly trip: TrackedTrip) {}

  private load(): Promise<void> {
    if (this.loading) return this.loading;
    this.loading = (async () => {
      const timeline = computeLegTimeline(this.trip.connection, new Date(this.trip.startedAt));
      this.rides = (
        await Promise.all(
          timeline.map(async ({ leg, departMs }, index) => {
            if (leg.mode === 'walk' || !leg.tripId) return null;
            const stops = leg.intermediateStops?.length
              ? leg.intermediateStops
              : await RoutingService.getTripStops(leg.tripId);
            const board = stops.findIndex((stop) => stop.stopId === leg.fromStopId);
            const alight = stops.findIndex((stop, i) => i > board && stop.stopId === leg.toStopId);
            const scheduled = stops[board]?.departSec;
            if (board < 0 || alight <= board || scheduled == null) return null;
            const plannedDelay = ((parseClock(leg.departAt)! - scheduled + 129600) % 86400) - 43200;
            return {
              leg,
              index,
              stops,
              board,
              alight,
              baseMs: departMs - (scheduled + plannedDelay) * 1000,
              estimator: new TransferRideEstimator(),
            };
          }),
        )
      ).filter((ride): ride is Ride => ride != null);
      if (
        this.rides.length !== this.trip.connection.legs.filter((leg) => leg.mode !== 'walk').length
      ) {
        this.rides = [];
        throw new Error('Missing transfer timetable');
      }
      this.rideIndex = Math.max(
        0,
        this.rides.findIndex((ride) => ride.index === this.trip.transfer?.activeLegIndex),
      );
    })().catch((error) => {
      this.loading = null;
      throw error;
    });
    return this.loading;
  }

  async refresh(now = Date.now()): Promise<TransferProtectionState> {
    const state: TransferProtectionState = {
      tripId: this.trip.id,
      revision: this.trip.transferRevision ?? 0,
      updatedAt: now,
      status: 'waiting',
      scope: 'foreground',
    };
    if (AppState.currentState !== 'active')
      return { ...state, status: 'unavailable', reason: 'location' };
    await this.load();
    const ride = this.rides[this.rideIndex];
    if (!ride) return { ...state, status: 'unavailable', reason: 'routing' };
    const fix = getCurrentLocationSnapshot().location;
    if (!fix) return { ...state, status: 'unavailable', reason: 'location' };
    const next = this.rides[this.rideIndex + 1];
    if (
      next &&
      now >= next.baseMs + (next.stops[next.board].departSec ?? 0) * 1000 - 60_000 &&
      next.estimator.observe(next.stops, next.board, next.baseMs, fix, now)
    ) {
      this.rideIndex++;
      this.decision = new TransferRiskDecision();
      this.alternative = undefined;
      return this.refresh(now);
    }
    const estimate = ride.estimator.observe(ride.stops, ride.board, ride.baseMs, fix, now);
    if (!estimate)
      return {
        ...state,
        status:
          now < ride.baseMs + (ride.stops[ride.board].departSec ?? 0) * 1000 + 300_000
            ? 'waiting'
            : 'unavailable',
        reason: 'location',
      };
    if (!next)
      return {
        ...state,
        status: 'complete',
        activeLegIndex: ride.index,
        delaySec: estimate.delaySec,
        arrivalAtMs:
          ride.baseMs + ((ride.stops[ride.alight].arriveSec ?? 0) + estimate.delaySec) * 1000,
      };
    const settings = getSettingsSync();
    const walkSpeed = profileWalkSpeedMps(settings.walkPace);
    const transferWalk = this.trip.connection.legs
      .slice(ride.index + 1, next.index)
      .reduce((sum, leg) => sum + ((leg.walkM ?? 0) * 1.15) / walkSpeed, 0);
    const vehicle = liveTracker
      .snapshot()
      .find(
        (v) =>
          v.matchedTripId === next.leg.tripId &&
          now - v.updatedAt >= 0 &&
          now - v.updatedAt <= 120_000,
      );
    const arrivalAtMs =
      ride.baseMs + ((ride.stops[ride.alight].arriveSec ?? 0) + estimate.delaySec) * 1000;
    const departureAtMs =
      next.baseMs + ((next.stops[next.board].departSec ?? 0) + (vehicle?.delaySec ?? 0)) * 1000;
    const buffer = Math.max(
      60,
      next.leg.mode === 'train' ? settings.trainMinTransferSec : settings.minTransferSec,
    );
    const physicalSlack = (departureAtMs - arrivalAtMs) / 1000 - transferWalk;
    const assessment = this.decision.assess(
      estimate.position > ride.alight + 0.3 ? -120 : physicalSlack,
      buffer,
      now,
    );
    Object.assign(state, {
      activeLegIndex: ride.index,
      delaySec: estimate.delaySec,
      slackSec: Math.round(physicalSlack - buffer),
      nextLine: next.leg.line,
      currentLine: ride.leg.line,
      transferStop: ride.leg.toStop,
      arrivalAtMs,
      departureAtMs,
      departureSource: vehicle?.delaySec != null ? 'live' : 'schedule',
    });
    if (this.alternative && now >= this.alternative.validUntil) this.alternative = undefined;
    if (assessment === 'safe') this.alternative = undefined;
    if (assessment === 'missed' && now - this.lastSearch >= 60_000) {
      this.lastSearch = now;
      this.alternative = await this.findAlternative(ride, estimate, now);
    }
    return {
      ...state,
      status: this.alternative
        ? 'alternative'
        : assessment === 'missed'
          ? 'noAlternative'
          : assessment,
      alternative: this.alternative,
    };
  }

  private async findAlternative(
    ride: Ride,
    estimate: { position: number; delaySec: number },
    now: number,
  ) {
    const settings = getSettingsSync();
    const fix = getCurrentLocationSnapshot().location;
    if (!fix) return undefined;
    const alightStop = ride.stops[ride.alight];
    const onPlatform =
      alightStop.lat != null &&
      alightStop.lon != null &&
      distanceMeters(fix.lat, fix.lon, alightStop.lat, alightStop.lon) <= 45 &&
      (fix.speed ?? 0) < 2.2;
    const first = Math.max(ride.board + 1, Math.floor(estimate.position) + 1);
    const indices = onPlatform
      ? [ride.alight]
      : [...new Set([ride.alight, first, first + 1, first + 2])].filter(
          (index) => index >= first && index < ride.stops.length,
        );
    let best: TransferAlternative | undefined;
    for (const index of indices) {
      const stop = ride.stops[index];
      if (stop.lat == null || stop.lon == null || stop.arriveSec == null) continue;
      const at = onPlatform ? now : ride.baseMs + (stop.arriveSec + estimate.delaySec) * 1000;
      const originalAt = ride.baseMs + ((alightStop.arriveSec ?? 0) + estimate.delaySec) * 1000;
      const validUntil = onPlatform ? now + 60_000 : Math.min(at, originalAt) - 60_000;
      if (validUntil <= now) continue;
      const day = new Date(now);
      day.setHours(0, 0, 0, 0);
      const connections = await RoutingService.getConnections({
        fromTitle: stop.name,
        fromLat: stop.lat,
        fromLon: stop.lon,
        anchorStopId: stop.stopId,
        toId: this.trip.toId,
        toTitle: this.trip.toTitle,
        toLat: this.trip.toLat,
        toLon: this.trip.toLon,
        departureTimeSec:
          Math.ceil((at - day.getTime()) / 1000) + Math.max(60, settings.minTransferSec),
        maxTransfers: Math.max(0, settings.maxTransfers - this.rideIndex - 1),
        minTransferSec: settings.minTransferSec,
        trainMinTransferSec: settings.trainMinTransferSec,
        allowedTransferModes: settings.allowedModes,
        maxWalkM: Math.min(800, settings.maxWalkM),
        walkSpeedMps: profileWalkSpeedMps(settings.walkPace),
        routeStyle: settings.routeStyle,
      });
      for (const tail of connections) {
        const timeline = computeLegTimeline(tail, new Date(now));
        const boarding = timeline.find(({ leg }) => leg.mode !== 'walk');
        const end = timeline.at(-1)?.arriveMs;
        if (!boarding || !end || boarding.leg.tripId === ride.leg.tripId || boarding.departMs <= at)
          continue;
        const prefix = onPlatform
          ? []
          : [
              ...this.trip.connection.legs.slice(0, ride.index),
              {
                ...ride.leg,
                toStop: stop.name,
                toStopId: stop.stopId,
                toLat: stop.lat,
                toLon: stop.lon,
                arriveAt: formatClock((at - day.getTime()) / 1000),
                stopsCount: index - ride.board,
                intermediateStops: ride.stops,
              },
            ];
        const connection: Connection = {
          ...this.trip.connection,
          legs: [...prefix, ...tail.legs],
          arriveAt: tail.arriveAt,
          durationMin: Math.ceil(
            (end -
              computeLegTimeline(this.trip.connection, new Date(this.trip.startedAt))[0].departMs) /
              60_000,
          ),
          transfers: prefix.filter((leg) => leg.mode !== 'walk').length + tail.transfers,
          ...(onPlatform
            ? {
                fromTitle: tail.fromTitle,
                departureSec: tail.departureSec,
                departAt: tail.departAt,
              }
            : {}),
        };
        const candidate: TransferAlternative = {
          id: `${ride.index}:${stop.stopId}:${boarding.leg.tripId}:${boarding.departMs}`,
          connection,
          activeLegIndex: onPlatform ? 0 : ride.index,
          nextLine: boarding.leg.line ?? '',
          transferStop: stop.name,
          departureAtMs: boarding.departMs,
          arrivalAtMs: end,
          validUntil: Math.min(validUntil, boarding.departMs - 60_000),
          kind: onPlatform ? 'fromHere' : index === ride.alight ? 'sameStop' : 'stayOn',
        };
        if (candidate.validUntil <= Date.now()) continue;
        const score = candidate.arrivalAtMs + (candidate.kind === 'stayOn' ? 180_000 : 0);
        if (!best || score < best.arrivalAtMs + (best.kind === 'stayOn' ? 180_000 : 0))
          best = candidate;
      }
    }
    return best;
  }
}
