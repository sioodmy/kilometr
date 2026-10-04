// Pozycje pojazdów prosto z operatora — bez serwera pośredniczącego.
//
// Dziś obsługujemy WROCŁAW: endpoint POST https://mpk.wroc.pl/bus_position
// Body: busList[tram][]=4&busList[bus][]=K ... (form-urlencoded)
// Odpowiedź: [{ name, type, x (lat), y (lon), k (nr wozu) }]
//
// Endpoint i listy linii należą do definicji miasta (`src/cities`), bo są
// własnością konkretnego operatora. Miasto bez obsługi pozycji na żywo (Kraków
// ma GTFS-RT, którego jeszcze nie parsujemy) dostaje pustą listę zamiast
// odpytania cudzego endpointu.
//
// Dopasowanie do rozkładu (opóźnienia) robi liveTracker na lokalnym indeksie
// (najbliższy przystanek linii w oknie ±30 min); tutaj tylko dopinamy jego
// snapshot do świeżych pozycji per linia.

import { activeRealtime } from './gtfsConfig';
import type { VehiclePosition } from '../types/models';

export interface RawVehicleRow {
  name: string;
  type: string;
  x: number;
  y: number;
  k: number;
}

/**
 * Konfiguracja źródła pozycji, które wymaga POST-a formularzowego.
 * `null`, gdy aktywne miasto go nie ma — wtedy nie odpytujemy niczego.
 */
function mpkForm(): { endpoint: string; tramLines: readonly string[]; busLines: readonly string[]; timeoutMs: number; pollIntervalMs: number } | null {
  const rt = activeRealtime();
  if (!rt || rt.kind !== 'mpk-form') return null;
  return rt;
}

function buildBody(src: NonNullable<ReturnType<typeof mpkForm>>, lines?: string[]): string {
  const body = new URLSearchParams();
  const wanted = lines && lines.length > 0 ? lines.map((l) => l.trim().toUpperCase()) : null;
  if (wanted) {
    for (const w of wanted) {
      const isTram = src.tramLines.includes(w);
      const isBus = src.busLines.includes(w);
      if (isTram) body.append('busList[tram][]', w);
      if (isBus) body.append('busList[bus][]', w);
      if (!isTram && !isBus) {
        // Linia spoza obu list (np. dopisana poza terminem aktualizacji
        // definicji): pytamy o nią w obu kategoriach, inaczej wraca zero
        // pojazdów i linia wygląda na nieobsługiwaną.
        body.append('busList[tram][]', w);
        body.append('busList[bus][]', w);
      }
    }
    return body.toString();
  }
  for (const t of src.tramLines) body.append('busList[tram][]', t);
  for (const b of src.busLines) body.append('busList[bus][]', b);
  return body.toString();
}

/** Jednorazowe pobranie pozycji (filtrowane po linii po stronie klienta). */
export async function fetchVehiclesDirect(line?: string): Promise<VehiclePosition[]> {
  const src = mpkForm();
  // Miasto bez źródła na żywo: pusta lista, bez błędu i bez próby sieciowej.
  if (!src) return [];
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), src.timeoutMs);
  try {
    const res = await fetch(src.endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        'User-Agent': 'Mozilla/5.0',
      },
      body: buildBody(src, line ? [line] : undefined),
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error(`realtime HTTP ${res.status}`);
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
        // Brak dopasowania do kursu to nie „na czas”, tylko brak pomiaru.
        delaySec: snap?.delaySec ?? null,
        matchedTripId: snap?.matchedTripId,
        currentStopName: snap?.currentStopName,
        nextStopName: snap?.nextStopName,
        updatedAt: now,
      });
    }
    return out;
  } catch (err) {
    console.warn('[RealtimeClient] direct fetch failed:', err);
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
  const src = mpkForm();
  // Bez źródła na żywo nie zakładamy timera wcale — nie ma po co co 12 s
  // budzić telefon dla odpowiedzi, która z definicji będzie pusta.
  if (!src) {
    onUpdate([]);
    return () => {
      stopped = true;
    };
  }
  const interval = opts?.intervalMs ?? src.pollIntervalMs;
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
