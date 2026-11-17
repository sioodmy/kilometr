/**
 * Snapshot liczb dla sekcji pokrycia na landingu.
 *
 * Odpytuje zbiorkom.live (pojazdy live), publiczny Worker danych
 * (komunikaty, stop-hints, manifest z liczbą przystanków) i zapisuje
 * `landing/src/data/coverageStats.json`. Deploy Pages uruchamia skrypt przed
 * buildem, więc strona dostaje świeży snapshot. Commitowany plik jest
 * fallbackiem, gdy źródła nie odpowiadają.
 *
 * Uruchomienie: npx tsx scripts/collect-coverage-stats.ts
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { CITIES, type CityId } from '../src/cities';

const ZBIORKOM_BASE = 'https://api.zbiorkom.live';
const DATA_BASE = 'https://data.kilometr.app';
const OUTPUT = resolve(
  process.env.COVERAGE_STATS_OUTPUT ??
    join(__dirname, '../landing/src/data/coverageStats.json'),
);

/**
 * Ten sam filtr agencji co `src/services/zbiorkom.ts`: te miasta mają w feedzie
 * też przewoźników podmiejskich, których aplikacja nie pokazuje.
 */
const ZBIORKOM_AGENCIES: Partial<Record<CityId, string>> = {
  warszawa: 'default',
  poznan: 'default,PKSPOZNAN',
  lodz: 'default',
  olsztyn: 'default',
  bialystok: 'default',
  rzeszow: 'default',
  rybnik: 'default',
};

interface LiveStats {
  available: boolean;
  vehicles: number | null;
}

interface NewsStats {
  available: boolean;
  alerts: number | null;
}

interface StopHintsStats {
  available: boolean;
  stops: number | null;
}

interface CityStats {
  live: LiveStats;
  news: NewsStats;
  stopHints: StopHintsStats;
  stops: number | null;
}

interface StatsFile {
  generatedAt: string;
  cities: Record<string, CityStats>;
}

async function getJson(url: string, timeoutMs = 12_000): Promise<unknown | null> {
  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(timeoutMs),
      headers: { 'User-Agent': 'kilometr-landing-stats/1.0' },
    });
    if (!response.ok) return null;
    return (await response.json()) as unknown;
  } catch {
    return null;
  }
}

async function fetchLiveVehicles(city: (typeof CITIES)[number]): Promise<number | null> {
  const agencies = ZBIORKOM_AGENCIES[city.id];
  const url =
    `${ZBIORKOM_BASE}/api6-open/${city.zbiorkomSlug}/positions/${city.zbiorkomBbox}` +
    (agencies ? `?agencies=${encodeURIComponent(agencies)}` : '');
  const data = await getJson(url);
  if (!data || typeof data !== 'object') return null;
  const positions = (data as { positions?: unknown }).positions;
  return Array.isArray(positions) ? positions.length : null;
}

async function fetchNews(cityId: string): Promise<NewsStats> {
  const data = await getJson(`${DATA_BASE}/${cityId}/disruptions.json`);
  if (!data || typeof data !== 'object') return { available: false, alerts: null };
  const record = data as { alerts?: unknown; alerts_count?: unknown; generated_at?: unknown };
  const alerts = Array.isArray(record.alerts) ? record.alerts.length : null;
  // Worker zwraca pustą listę także dla miasta bez pliku w R2, ale prawdziwy
  // feed ma `alerts_count`/`generated_at`. Dzięki temu „brak nowych alertów”
  // nie wygląda jak „brak źródła komunikatów”.
  const feedExists =
    typeof record.alerts_count === 'number' ||
    typeof record.generated_at === 'string' ||
    (alerts ?? 0) > 0;
  return { available: feedExists, alerts };
}

async function fetchStopHints(cityId: string): Promise<number | null> {
  const data = await getJson(`${DATA_BASE}/${cityId}/stop-hints.json`);
  if (!data || typeof data !== 'object') return null;
  const stops = (data as { stops?: unknown }).stops;
  return stops && typeof stops === 'object' ? Object.keys(stops).length : null;
}

async function fetchDbStops(cityId: string): Promise<number | null> {
  const data = await getJson(`${DATA_BASE}/${cityId}/manifest.json`);
  if (!data || typeof data !== 'object') return null;
  const stats = (data as { stats?: unknown }).stats;
  if (!stats || typeof stats !== 'object') return null;
  const stops = (stats as { stops?: unknown }).stops;
  return typeof stops === 'number' && Number.isFinite(stops) ? stops : null;
}

async function collectCity(city: (typeof CITIES)[number]): Promise<CityStats> {
  const [vehicles, news, hints, stops] = await Promise.all([
    fetchLiveVehicles(city),
    fetchNews(city.id),
    fetchStopHints(city.id),
    fetchDbStops(city.id),
  ]);

  return {
    live: { available: vehicles !== null, vehicles },
    news,
    stopHints: { available: (hints ?? 0) > 0, stops: hints },
    stops,
  };
}

function hasData(stats: CityStats): boolean {
  return (
    stats.live.available ||
    stats.news.available ||
    stats.stopHints.available ||
    stats.stops !== null
  );
}

async function main(): Promise<void> {
  const cities: Record<string, CityStats> = {};
  let reachable = 0;

  // Mała paczka równoległych żądań: nie zalewamy zbiorkom.live i Workera.
  for (let i = 0; i < CITIES.length; i += 6) {
    const chunk = CITIES.slice(i, i + 6);
    const results = await Promise.all(chunk.map(async (city) => [city.id, await collectCity(city)] as const));
    for (const [id, stats] of results) {
      cities[id] = stats;
      if (hasData(stats)) reachable++;
      console.log(
        `${id}: live=${stats.live.vehicles ?? 'brak'} news=${stats.news.alerts ?? 'brak'} ` +
          `hints=${stats.stopHints.stops ?? 'brak'} stops=${stats.stops ?? 'brak'}`,
      );
    }
  }

  if (reachable === 0) {
    throw new Error('Żadne źródło nie odpowiedziało, zostawiam poprzedni snapshot.');
  }

  const file: StatsFile = { generatedAt: new Date().toISOString(), cities };
  mkdirSync(dirname(OUTPUT), { recursive: true });
  writeFileSync(OUTPUT, `${JSON.stringify(file, null, 2)}\n`);
  console.log(`\nZapisano ${OUTPUT} (${reachable}/${CITIES.length} miast z danymi).`);
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
