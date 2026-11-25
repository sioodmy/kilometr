// Flaga ukończenia onboardingu startowego (witaj, miasto z pobieraniem w tle,
// dostęp aplikacji, zapisane miejsca). Dopiero po niej _layout puszcza
// użytkownika na ekran główny.
import { kvGet, kvSet } from './storage';

const KEY = 'kilometr.onboardingSeen.v1';

export async function hasSeenOnboarding(): Promise<boolean> {
  try {
    return (await kvGet(KEY)) === '1';
  } catch {
    return false;
  }
}

export async function setOnboardingSeen(): Promise<void> {
  try {
    await kvSet(KEY, '1');
  } catch {
    // flaga opcjonalna - najgorszy wypadek to powtórka onboardingu
  }
}
