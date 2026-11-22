import { Directory, File, Paths } from 'expo-file-system';
import { getActiveCitySync } from '../cityStore';
import { getSettingsSync, profileWalkSpeedMps } from '../settings';
import { liveTracker } from '../liveTracker';
import { buildSearchSlices } from '../routing/engine';
import { getRaptorNet, packRaptorNet } from '../routing/network';
import { DEFAULT_COST, mergeDayIndexes } from '../routing/raptor';
import { gtfsStore } from '../routing/store';
import { computeLegTimeline } from './tripProgress';
import { getTransferNativeCopy } from './transferCopy';
import { isProtectedTrainLeg } from './transferTypes';
import type { TrackedTrip } from './types';

function resolveLocalDestinations(
  trip: TrackedTrip,
  stopIndexMap: Map<string, number>,
  maxWalkM: number,
  walkSpeedMps: number,
): { stopIndex: number; walkM: number; walkSec: number }[] {
  const mapNearest = (lat: number, lon: number) =>
    gtfsStore.findNearestStops(lat, lon, maxWalkM, 80).flatMap(({ stop, distanceM }) => {
      const stopIndex = stopIndexMap.get(stop.stop_id);
      return stopIndex === undefined
        ? []
        : [
            {
              stopIndex,
              walkM: Math.round(distanceM),
              walkSec: Math.max(0, Math.round((distanceM * 1.15) / walkSpeedMps)),
            },
          ];
    });

  const primary = mapNearest(trip.toLat, trip.toLon);
  if (primary.length > 0) return primary;

  // Trasa mieszana (np. tramwaj -> pociąg Intercity poza miastem): cel miejski to dworzec przesiadkowy.
  const lastUrban = [...trip.connection.legs]
    .reverse()
    .find((leg) => leg.mode !== 'walk' && !isProtectedTrainLeg(leg));
  if (lastUrban) {
    if (lastUrban.toStopId) {
      const exactIdx = stopIndexMap.get(lastUrban.toStopId);
      if (exactIdx !== undefined) {
        return [{ stopIndex: exactIdx, walkM: 0, walkSec: 0 }];
      }
    }
    if (lastUrban.toLat != null && lastUrban.toLon != null) {
      const nearStation = mapNearest(lastUrban.toLat, lastUrban.toLon);
      if (nearStation.length > 0) return nearStation;
    }
  }
  return [];
}

/** Przygotowuje lokalny snapshot sieci i parametrów podróży dla natywnej ochrony w tle. */
export async function prepareTransferSnapshot(trip: TrackedTrip): Promise<string> {
  await gtfsStore.load();
  const settings = getSettingsSync();
  const timeline = computeLegTimeline(trip.connection, new Date(trip.startedAt));
  const first = timeline.find((entry) => entry.leg.mode !== 'walk');
  if (!first) throw new Error('No transit leg');
  const date = new Date(first.departMs);
  date.setHours(0, 0, 0, 0);
  const baseMs = date.getTime();
  const departureSec = Math.round((first.departMs - baseMs) / 1000);
  const today = new Date(trip.startedAt);
  today.setHours(0, 0, 0, 0);
  const rawTarget = departureSec + Math.round((baseMs - today.getTime()) / 86_400_000) * 86400;
  const slices = await buildSearchSlices(rawTarget);
  let index = slices.searchIndex;
  let offsets = slices.patternOffsets;
  const endSec = Math.round(((timeline.at(-1)?.arriveMs ?? first.arriveMs) - baseMs) / 1000);
  const horizonSec = Math.max(departureSec + 10800, endSec + 3600);
  if (horizonSec >= 86400) {
    const tomorrow = new Date(baseMs);
    tomorrow.setDate(tomorrow.getDate() + 1);
    const dateKey = `${tomorrow.getFullYear()}${String(tomorrow.getMonth() + 1).padStart(2, '0')}${String(tomorrow.getDate()).padStart(2, '0')}`;
    const next = await gtfsStore.getDayIndexSlice(
      tomorrow.getDay(),
      dateKey,
      0,
      horizonSec - 86400,
    );
    const merged = mergeDayIndexes(index, next, 'next_', 86400);
    index = merged.index;
    offsets = new Map([...merged.offsets, ...(offsets ?? [])]);
  }
  const net = getRaptorNet(gtfsStore, index, offsets);
  const walkSpeedMps = profileWalkSpeedMps(settings.walkPace);
  const destinations = resolveLocalDestinations(
    trip,
    net.base.stopIndex,
    settings.maxWalkM,
    walkSpeedMps,
  );
  const city = getActiveCitySync();
  const dir = new Directory(
    Paths.document,
    'transfer-protection',
    `${trip.startedAt}-${Date.now()}`,
  );
  dir.create({ intermediates: true, idempotent: true });
  const network = new File(dir, 'network.bin');
  network.write(packRaptorNet(net));
  const file = new File(dir, 'context.json');
  const liveUrl =
    city.zbiorkomSlug && city.zbiorkomBbox
      ? `https://zbiorkom.live/api6-open/${city.zbiorkomSlug}/positions/${city.zbiorkomBbox}`
      : '';
  file.write(
    JSON.stringify({
      version: 1,
      tripId: trip.id,
      baseMs,
      validUntilMs: baseMs + horizonSec * 1000,
      networkPath: network.uri,
      connection: trip.connection,
      activeLegIndex: trip.transfer?.activeLegIndex ?? 0,
      timeline: timeline.map(({ departMs, arriveMs }) => ({ departMs, arriveMs })),
      destinations,
      stops: net.base.stopIds.map((id) => {
        const stop = gtfsStore.stops.get(id);
        return {
          id,
          name: stop?.stop_name ?? id,
          lat: stop?.stop_lat,
          lon: stop?.stop_lon,
          code: stop?.stop_code,
        };
      }),
      patterns: net.patterns.map((pattern) => ({
        routeId: pattern.routeId,
        mode: pattern.kind,
        line: gtfsStore.routes.get(pattern.routeId)?.route_short_name ?? '',
        trips: pattern.tripIds,
        directions: pattern.tripIds.map((id) => gtfsStore.trips.get(id)?.trip_headsign ?? ''),
      })),
      options: {
        maxTransfers: Math.max(settings.maxTransfers, trip.connection.transfers),
        minTransferSec: settings.minTransferSec,
        trainMinTransferSec: settings.trainMinTransferSec,
        walkSpeedMps,
        maxWalkM: settings.maxWalkM,
        allowedModes: settings.allowedModes,
        cost: DEFAULT_COST,
      },
      destination: { name: trip.toTitle, lat: trip.toLat, lon: trip.toLon },
      liveUrl,
      delays: liveTracker
        .snapshot()
        .filter((v) => v.matchedTripId && v.delaySec != null)
        .map((v) => ({ tripId: v.matchedTripId, delaySec: v.delaySec, at: v.updatedAt })),
      copy: getTransferNativeCopy(),
    }),
  );
  return file.uri;
}

export function removeTransferSnapshot(contextPath: string): void {
  const file = new File(contextPath);
  const dir = file.parentDirectory;
  if (dir.exists) dir.delete();
}
