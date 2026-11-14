// W zrzucie wideo nie nadpisujemy live z sieci: mock na Connection zostaje jak jest.
import type { Connection } from '../../src/types/models';

export function useRailLiveConnections(
  connections: Connection[],
  _tripDelays?: Map<string, number>,
  _enabled = true,
): Connection[] {
  return connections;
}
