// Pozycje pojazdów prosto z MPK Wrocław — bez serwera pośredniczącego.
// Endpoint: POST https://mpk.wroc.pl/bus_position
// Body: busList[tram][]=4&busList[bus][]=K ... (form-urlencoded)
// Odpowiedź: [{ name, type, x (lat), y (lon), k (nr wozu) }]
//
// Dopasowanie do rozkładu (opóźnienia) robi liveTracker na lokalnym indeksie
// (najbliższy przystanek linii w oknie ±30 min); tutaj tylko dopinamy jego
// snapshot do świeżych pozycji per linia.

import { MPK, WROCLAW_BUS_LINES, WROCLAW_TRAM_LINES } from './gtfsConfig';
import type { VehiclePosition } from '../types/models';

export interface RawVehicleRow {
  name: string;
  type: string;
  x: number;
  y: number;
  k: number;
}

function buildBody(lines?: string[]): string {
  const body = new URLSearchParams();
  const wanted = lines && lines.length > 0 ? lines.map((l) => l.trim().toUpperCase()) : null;
  if (wanted) {
    for (const w of wanted) {
      const isTram = (WROCLAW_TRAM_LINES as readonly string[]).includes(w);
      const isBus = (WROCLAW_BUS_LINES as readonly string[]).includes(w);
      if (isTram) body.append('busList[tram][]', w);
      if (isBus) body.append('busList[bus][]', w);
      if (!isTram && !isBus) {
        body.append('busList[tram][]', w);
        body.append('busList[bus][]', w);
      }
    }
    return body.toString();
  }
  for (const t of WROCLAW_TRAM_LINES) body.append('busList[tram][]', t);
  for (const b of WROCLAW_BUS_LINES) body.append('busList[bus][]', b);
  return body.toString();
}

/** Jednorazowe pobranie pozycji (filtrowane po linii po stronie klienta). */
export async function fetchVehiclesDirect(line?: string): Promise<VehiclePosition[]> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), MPK.timeoutMs);
  try {
    const res = await fetch(MPK.busPositionUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        'User-Agent': 'Mozilla/5.0',
      },
      body: buildBody(line ? [line] : undefined),
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error(`MPK HTTP ${res.status}`);
    const rows = (await res.json()) as RawVehicleRow[];
    if (!Array.isArray(rows)) return [];
    const now = Date.now();
    const want = line?.trim().toUpperCase();
    // Dopnij dopasowania z globalnego snapshotu live (tripId/delay/stops),
    // żeby karta przejazdu od razu wiedziała KTÓRY to kurs.
    const { liveTracker } = await import('./liveTracker');
    const out: VehiclePosition[] = [];
    for (const row of rows) {
      if (!row.x || !row.y || !row.name) continue;
      const lineName = row.name.trim().toUpperCase();
      if (want && lineName !== want) continue;
      const vehicleId = `${lineName}-${row.k}`;
      let snap = liveTracker.lookup(vehicleId);
      if (!snap) {
        snap = (await liveTracker.matchSingle(row)) ?? undefined;
      }
      out.push({
        vehicleId,
        line: lineName,
        lat: row.x,
        lon: row.y,
        delaySec: snap?.delaySec ?? 0,
        matchedTripId: snap?.matchedTripId,
        currentStopName: snap?.currentStopName,
        nextStopName: snap?.nextStopName,
        updatedAt: now,
      });
    }
    return out;
  } catch (err) {
    console.warn('[RealtimeClient] MPK direct fetch failed:', err);
    return [];
  } finally {
    clearTimeout(timer);
  }
}

/** Polling z jednym lotem w danym momencie (jak serwerowy tracker). */
export function startVehiclePolling(
  onUpdate: (vehicles: VehiclePosition[]) => void,
  opts?: { line?: string; intervalMs?: number },
): () => void {
  let stopped = false;
  let inFlight = false;
  const interval = opts?.intervalMs ?? MPK.pollIntervalMs;
  const tick = async () => {
    if (stopped || inFlight) return;
    inFlight = true;
    try {
      const vehicles = await fetchVehiclesDirect(opts?.line);
      if (!stopped) onUpdate(vehicles);
    } finally {
      inFlight = false;
    }
  };
  void tick();
  const timer = setInterval(tick, interval);
  return () => {
    stopped = true;
    clearInterval(timer);
  };
}
