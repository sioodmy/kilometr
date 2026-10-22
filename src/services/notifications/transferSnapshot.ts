import { Directory, File, Paths } from 'expo-file-system';
import { getActiveCitySync } from '../cityStore';
import { getSettingsSync, profileWalkSpeedMps } from '../settings';
import { liveTracker } from '../liveTracker';
import { buildSearchSlices } from '../routing/engine';
import { getRaptorNet, packRaptorNet } from '../routing/network';
import { costParamsFor, mergeDayIndexes } from '../routing/raptor';
import { gtfsStore } from '../routing/store';
import { computeLegTimeline } from './tripProgress';
import { getTransferNativeCopy } from './transferCopy';
import type { TrackedTrip } from './types';

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
  const destinations = gtfsStore
    .findNearestStops(trip.toLat, trip.toLon, settings.maxWalkM, 80)
    .flatMap(({ stop, distanceM }) => {
      const stopIndex = net.base.stopIndex.get(stop.stop_id);
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
  if (!destinations.length) throw new Error('No destination stops');
  const city = getActiveCitySync();
  const dir = new Directory(Paths.document, 'transfer-protection', `${trip.startedAt}`);
  dir.create({ intermediates: true, idempotent: true });
  const network = new File(dir, 'network.bin');
  network.write(packRaptorNet(net));
  const file = new File(dir, 'context.json');
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
        cost: costParamsFor(settings.routeStyle),
      },
      destination: { name: trip.toTitle, lat: trip.toLat, lon: trip.toLon },
      liveUrl: `https://zbiorkom.live/api6-open/${city.zbiorkomSlug}/positions/${city.zbiorkomBbox}`,
      delays: liveTracker
        .snapshot()
        .filter((v) => v.matchedTripId && v.delaySec != null)
        .map((v) => ({ tripId: v.matchedTripId, delaySec: v.delaySec, at: v.updatedAt })),
      copy: getTransferNativeCopy(),
    }),
  );
  return file.uri;
}

export function removeTransferSnapshot(path: string): void {
  const dir = new File(path).parentDirectory;
  if (dir.exists) dir.delete();
}
