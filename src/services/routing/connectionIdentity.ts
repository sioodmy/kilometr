import type { Connection } from './types';

export function connectionIdentity(connection: Connection): string {
  const first = connection.legs[0];
  const last = connection.legs[connection.legs.length - 1];
  const rides = connection.legs.filter((leg) => leg.mode !== 'walk');
  return JSON.stringify([
    [first?.fromLat, first?.fromLon, connection.fromTitle],
    [last?.toLat, last?.toLon, connection.toTitle],
    Math.floor(connection.departureSec / 86400),
    rides.map((leg) => [
      leg.mode,
      leg.line || leg.routeId || leg.tripId,
      leg.fromStopId || leg.fromStop,
      leg.toStopId || leg.toStop,
      leg.departAt,
      leg.arriveAt,
    ]),
  ]);
}

export function stableConnectionId(connection: Connection): string {
  return `conn-${encodeURIComponent(connectionIdentity(connection))}`;
}

/** Expo Router odkodowuje parametry, ale cache przechowuje ID z zakodowanym JSON-em. */
export function normalizeConnectionId(id: string): string {
  return id.startsWith('conn-[') ? `conn-${encodeURIComponent(id.slice(5))}` : id;
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
