import type { Connection } from '../../types/models';
import { mergeConnections } from './connectionIdentity';

/** Poszerza okno do początku dnia, gdy między kursami jest przerwa. */
export async function loadEarlierConnections(
  current: Connection[],
  load: (departureSec: number) => Promise<Connection[]>,
  isCancelled: () => boolean,
) {
  const beforeSec = Math.min(...current.map((item) => item.departureSec));
  if (!Number.isFinite(beforeSec) || beforeSec <= 0) return mergeConnections(current, []);

  for (let lookback = 1800; ; lookback *= 2) {
    if (isCancelled()) return null;
    const fromSec = Math.max(0, beforeSec - lookback);
    const batch = await load(fromSec);
    if (isCancelled()) return null;
    const earlier = batch.filter((item) => item.departureSec > 0 && item.departureSec < beforeSec);
    const result = mergeConnections(current, earlier);
    if (result.added > 0 || fromSec === 0) return result;
  }
}
