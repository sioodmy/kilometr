import type { Connection } from '../../types/models';
import { mergeConnections } from './connectionIdentity';
import { yieldToUiFrame } from './yieldFrame';

/** Poszerza okno do początku dnia, gdy między kursami jest przerwa. */
export async function loadEarlierConnections(
  current: Connection[],
  load: (departureSec: number, searchAheadSec: number) => Promise<Connection[]>,
  isCancelled: () => boolean,
) {
  const beforeSec = Math.min(...current.map((item) => item.departureSec));
  if (!Number.isFinite(beforeSec) || beforeSec <= 0) return mergeConnections(current, []);

  for (let lookback = 1800; ; lookback *= 2) {
    if (isCancelled()) return null;
    const fromSec = Math.max(0, beforeSec - lookback);
    // Horyzont nie musi sięgać daleko za najwcześniejszy już znany kurs:
    // tnie niepotrzebne okna RAPTOR-a i zmniejsza rozmiar wycinka z SQLite.
    const searchAheadSec = Math.min(Math.max(beforeSec - fromSec + 300, 1800), 3600);
    const batch = await load(fromSec, searchAheadSec);
    if (isCancelled()) return null;
    const earlier = batch.filter((item) => item.departureSec > 0 && item.departureSec < beforeSec);
    const candidates = mergeConnections(current, earlier);
    const nearest = candidates.list.filter((item) => item.departureSec < beforeSec).slice(-3);
    const result = mergeConnections(current, nearest);
    if (result.added > 0 || fromSec === 0) return result;
    await yieldToUiFrame();
  }
}
