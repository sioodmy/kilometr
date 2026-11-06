// Alerty konkretnego pociągu ogólnopolskiego (strumień SSE zbiorkomu),
// współdzielone między kartą połączenia (kompaktowy chip) a ekranem
// szczegółów (karta). Cache per pojazd (5 min) + deduplikacja w locie,
// więc lista 8 połączeń nie otwiera 8 strumieni naraz.

import type { Connection, Leg } from '../types/models';
import {
  fetchZbVehicleAlerts,
  vehicleCandidatesForLeg,
  type ZbVehicleAlert,
} from '../services/nationalRailLive';

export interface TrainAlerts {
  leg: Leg;
  alerts: ZbVehicleAlert[];
}

const inFlight = new Map<string, Promise<ZbVehicleAlert[]>>();
const results = new Map<string, { at: number; alerts: ZbVehicleAlert[] }>();
const TTL_MS = 5 * 60 * 1000;

/**
 * Alerty dla nogi kolejowej: próbujemy kandydatów pojazdu zbiorkomu
 * (oba warianty numeru), aż któryś zwróci niepustą listę. Pusta lista
 * = brak utrudnień (legalny wynik, cache go trzyma - nie siejemy zapytań).
 */
function alertsForLeg(leg: Leg): Promise<ZbVehicleAlert[]> {
  const candidates = vehicleCandidatesForLeg(leg);
  if (candidates.length === 0) return Promise.resolve([]);
  const key = candidates.join('|');
  const hit = results.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return Promise.resolve(hit.alerts);
  const pending = inFlight.get(key);
  if (pending) return pending;
  const promise = (async () => {
    for (const vehicle of candidates) {
      const alerts = await fetchZbVehicleAlerts(vehicle);
      if (alerts.length > 0) {
        results.set(key, { at: Date.now(), alerts });
        return alerts;
      }
    }
    results.set(key, { at: Date.now(), alerts: [] });
    return [] as ZbVehicleAlert[];
  })().finally(() => {
    inFlight.delete(key);
  });
  inFlight.set(key, promise);
  return promise;
}

/**
 * Alerty per połączenie: jedna noga kolejowa = jedna karta/chip. Zwraca
 * pustą listę, gdy pociąg nie ma utrudnień albo danych nie udało się
 * pobrać - alerty są dodatkiem, nie mogą blokować listy wyników.
 */
export async function alertsForConnection(connection: Connection): Promise<TrainAlerts[]> {
  const legs = connection.legs.filter((l) => l.mode === 'train' && l.tripId?.startsWith('pl:'));
  if (legs.length === 0) return [];
  const out: TrainAlerts[] = [];
  for (const leg of legs.slice(0, 2)) {
    const alerts = await alertsForLeg(leg).catch(() => [] as ZbVehicleAlert[]);
    if (alerts.length > 0) out.push({ leg, alerts });
  }
  return out;
}
