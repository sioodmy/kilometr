// Flaga ukończenia onboardingu startowego (witaj, miasto z pobieraniem w tle,
// dostęp aplikacji). Dopiero po niej _layout puszcza użytkownika na ekran główny.
import { kvGet, kvSet } from './storage';

const KEY = 'kilometr.onboardingSeen.v1';
let seenCache: boolean | null = null;

/** Synchroniczny stan ukończenia onboardingu (null przed pierwszym odczytem z KV). */
export function hasSeenOnboardingSync(): boolean | null {
  return seenCache;
}

export async function hasSeenOnboarding(): Promise<boolean> {
  try {
    const seen = (await kvGet(KEY)) === '1';
    seenCache = seen;
    return seen;
  } catch {
    return false;
  }
}

export async function setOnboardingSeen(): Promise<void> {
  seenCache = true;
  try {
    await kvSet(KEY, '1');
  } catch {
    // flaga opcjonalna - najgorszy wypadek to powtórka onboardingu
  }
}
