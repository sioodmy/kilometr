// Pozycje pojazdów prosto z MPK Wrocław — bez serwera pośredniczącego.
// Endpoint: POST https://mpk.wroc.pl/bus_position
// Body: busList[tram][]=4&busList[bus][]=K ... (form-urlencoded)
// Odpowiedź: [{ name, type, x (lat), y (lon), k (nr wozu) }]
//
// Dopasowanie do rozkładu (opóźnienia) dzieje się lokalnie w etapie 2
// (matcher na SQLite: kształt kursu + interpolacja czasu). Na razie zwracamy
// surowe pozycje z delaySec=0, żeby mapa/pojazdy działały od razu po
// imporcie przystanków — RAPTOR podmieni delaye gdy stop_times będą gotowe.

import { MPK } from './gtfsConfig';
import type { VehiclePosition } from '../types/models';

const TRAM_LINES = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12', '13', '14', '15', '16', '17', '18', '19', '20', '21', '22', '23'];
const BUS_LINES = [
  'A', 'C', 'D', 'K', 'N',
  '100', '101', '102', '103', '104', '105', '106', '107', '108', '109', '110',
  '111', '112', '113', '114', '115', '116', '118', '119', '120', '121', '122',
  '124', '125', '126', '127', '128', '129', '130', '131', '132', '133', '134',
  '136', '140', '142', '143', '144', '145', '146', '147', '148', '149', '150', '151', '152',
];

interface RawVehicleRow {
  name: string;
  type: string;
  x: number;
  y: number;
  k: number;
}

function buildBody(lines?: string[]): string {
  const body = new URLSearchParams();
  const wanted = lines && lines.length > 0 ? lines.map((l) => l.trim().toUpperCase()) : null;
  const trams = wanted ? TRAM_LINES.filter((t) => wanted.includes(t)) : TRAM_LINES;
  const buses = wanted ? BUS_LINES.filter((b) => wanted.includes(b)) : BUS_LINES;
  // Gdy użytkownik pyta o linię spoza sztywnej listy (np. nowa linia),
  // dopytujemy ją wprost — MPK ignoruje nieznane, a my nic nie tracimy.
  if (wanted) {
    for (const w of wanted) {
      if (!TRAM_LINES.includes(w) && !BUS_LINES.includes(w)) body.append('busList[bus][]', w);
    }
  }
  for (const t of trams) body.append('busList[tram][]', t);
  for (const b of buses) body.append('busList[bus][]', b);
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
    const out: VehiclePosition[] = [];
    for (const row of rows) {
      if (!row.x || !row.y || !row.name) continue;
      const lineName = row.name.trim().toUpperCase();
      if (want && lineName !== want) continue;
      out.push({
        vehicleId: `${lineName}-${row.k}`,
        line: lineName,
        lat: row.x,
        lon: row.y,
        delaySec: 0, // matcher (etap 2) nadpisze po imporcie stop_times
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
