import { secondsToTimeString } from '../../gtfs/geo';
import type { Connection, Leg } from './types';

export function scheduledLegDepart(leg: Leg): string {
  if (leg.scheduledDepartureSec != null) {
    return secondsToTimeString(leg.scheduledDepartureSec);
  }
  return leg.departAt;
}

function scheduledLegArrive(leg: Leg): string {
  if (leg.scheduledArrivalSec != null) {
    return secondsToTimeString(leg.scheduledArrivalSec);
  }
  return leg.arriveAt;
}

function connectionIdentity(connection: Connection): string {
  const first = connection.legs[0];
  const last = connection.legs[connection.legs.length - 1];
  const rides = connection.legs.filter((leg) => leg.mode !== 'walk');
  const schedBaseSec =
    connection.departureSec - (connection.delayMin ? connection.delayMin * 60 : 0);
  return JSON.stringify([
    [first?.fromLat, first?.fromLon, connection.fromTitle],
    [last?.toLat, last?.toLon, connection.toTitle],
    Math.floor(schedBaseSec / 86400),
    rides.map((leg) => [
      leg.mode,
      leg.line || leg.routeId || leg.tripId,
      leg.fromStopId || leg.fromStop,
      leg.toStopId || leg.toStop,
      scheduledLegDepart(leg),
      scheduledLegArrive(leg),
    ]),
  ]);
}

export function stableConnectionId(connection: Connection): string {
  return `conn-${encodeURIComponent(connectionIdentity(connection))}`;
}

export function normalizeConnectionId(id: string): string {
  if (!id.startsWith('conn-')) return id;
  const rawPayload = id.slice(5);
  if (rawPayload.startsWith('[')) {
    return `conn-${encodeURIComponent(rawPayload)}`;
  }
  try {
    let current = rawPayload;
    for (let i = 0; i < 3; i++) {
      if (current.startsWith('[')) break;
      const next = decodeURIComponent(current);
      if (next === current) break;
      current = next;
    }
    if (current.startsWith('[')) {
      return `conn-${encodeURIComponent(current)}`;
    }
    return id;
  } catch {
    return id;
  }
}

// Kolejność kosztowa planera wybiera wariant, ID kursów GTFS nie rozróżnia duplikatów.
export function deduplicateConnections(connections: Connection[]): Connection[] {
  const seen = new Set<string>();
  return connections.filter((connection) => {
    const key = connectionIdentity(connection);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function mergeConnections(previous: Connection[], batch: Connection[]) {
  const list = deduplicateConnections([...previous, ...batch]);
  const added = list.length - deduplicateConnections(previous).length;
  list.sort((a, b) => a.departureSec - b.departureSec);
  return { list, added };
}
