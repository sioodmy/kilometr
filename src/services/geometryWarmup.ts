// Rozgrzewanie geometrii tras w tle.
//
// Ekran mapy dociąga przebieg ulic dopiero, gdy użytkownik otworzy trasę.
// Dzięki temu plik jest gotowy natychmiast, ale offline dopiero po pierwszym
// wejściu. Ten serwis robi to zawczasu: po wyszukaniu pobiera i przypina
// geometrię kilku najlepszych połączeń, więc ostatnie trasy działają bez sieci.
//
// Świadomie tylko kilka pozycji i jedna kolejka naraz: publiczne routery
// (OSRM, routing.openstreetmap.de) mają limity, a zysk z dalszych pozycji
// na liście maleje.

import type { Connection } from '../types/models';
import { buildMapRoute, warmRouteGeometry } from './routeGeometry';

/** Ile najwyżej połączeń z jednego wyszukania rozgrzewamy. */
const WARM_LIMIT = 5;

let running = false;

/** Pobiera i przypina geometrię kilku połączeń. Odporne na błędy sieci. */
export async function warmConnections(connections: Connection[]): Promise<void> {
  if (running || connections.length === 0) return;
  running = true;
  try {
    for (const c of connections.slice(0, WARM_LIMIT)) {
      await warmRouteGeometry(buildMapRoute(c)).catch(() => 0);
    }
  } catch {
    // Best-effort: brak sieci albo limit serwera nie może psuć wyszukiwania.
  } finally {
    running = false;
  }
}