import type { SharedConnection } from '../sharing/connection';
import { encodeSharedConnection } from '../sharing/connection';
import { loadSharedDetails, type SharedDetails } from '../sharing/remote';
import { kvGet, kvSet } from './storage';

const CACHE_KEY = 'kilometr.sharedDetails.v1';
interface CacheEntry extends SharedDetails {
  id: string;
}

/** Zachowuje ostatnie otwarte plany i geometrię do ponownego użycia offline. */
export async function getSharedJourneyData(
  journey: SharedConnection,
  signal: AbortSignal,
): Promise<SharedDetails> {
  const id = encodeSharedConnection(journey);
  let cached: CacheEntry[] = [];
  try {
    cached = JSON.parse((await kvGet(CACHE_KEY)) ?? '[]');
  } catch {
    /* Pusty cache. */
  }
  const hit = Array.isArray(cached) ? cached.find((entry) => entry.id === id) : undefined;
  if (hit?.journey.legs.every((leg) => leg.mode === 'walk' || leg.path)) return hit;
  try {
    const root = process.env.EXPO_PUBLIC_SHARE_TIMETABLE_URL ?? 'https://kilometr.app/timetables';
    const details = await loadSharedDetails(journey, root, signal);
    if (!signal.aborted) {
      const entries = Array.isArray(cached) ? cached.filter((entry) => entry.id !== id) : [];
      await kvSet(CACHE_KEY, JSON.stringify([...entries.slice(-7), { id, ...details }])).catch(
        () => {},
      );
    }
    return details;
  } catch (error) {
    if (hit) return hit;
    throw error;
  }
}
