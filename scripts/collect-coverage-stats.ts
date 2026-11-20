/**
 * Snapshot liczb dla sekcji pokrycia na landingu.
 *
 * Odpytuje zbiorkom.live, KiedyPrzyjedzie.pl (pojazdy live) i publiczny
 * Worker danych (komunikaty, stop-hints) i zapisuje
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
 * Ten sam filtr agencji co `src/services/zbiorkom.ts`: miasta wspóldzielące
 * slug zbiorkom z aglomeracją wymagają dokładnego filtra przewoźnika.
 */
const ZBIORKOM_AGENCIES: Partial<Record<CityId, string>> = {
  warszawa: 'default',
  poznan: 'default,PKSPOZNAN',
  lodz: 'default',
  olsztyn: 'default',
  bialystok: 'default',
  rzeszow: 'default',
  rybnik: 'default',
  jastrzebie: 'JASTRZEBIE',
  grodzisk: 'GPA',
  pruszkow: 'PRUSZKOW',
  sochaczew: 'SOCHACZEW',
  minskmazowiecki: 'MINSK',
  otwock: 'OTWOCK',
  nowydwormaz: 'NDM',
  zabki: 'ZABKI',
  pabianice: 'PABIANICE',
  zgierz: 'ZGIERZ',
};

interface LiveStats {
  available: boolean;
  vehicles: number | null;
}

interface NewsStats {
  available: boolean;
}

interface StopHintsStats {
  available: boolean;
  stops: number | null;
}

interface CityStats {
  live: LiveStats;
  news: NewsStats;
  stopHints: StopHintsStats;
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

async function fetchLiveStatus(city: (typeof CITIES)[number]): Promise<LiveStats> {
  if (!city.features.live) return { available: false, vehicles: null };

  if (city.kpPrefix) {
    const data = await getJson(`https://${city.kpPrefix}.kiedyprzyjedzie.pl/stops`);
    if (!data || typeof data !== 'object') return { available: false, vehicles: null };
    const stops = (data as { stops?: unknown }).stops;
    const ok = Array.isArray(stops) && stops.length > 0;
    return { available: ok, vehicles: null };
  }

  if (!city.zbiorkomSlug) return { available: false, vehicles: null };
  const agencies = ZBIORKOM_AGENCIES[city.id];
  const url =
    `${ZBIORKOM_BASE}/api6-open/${city.zbiorkomSlug}/positions/${city.zbiorkomBbox}` +
    (agencies ? `?agencies=${encodeURIComponent(agencies)}` : '');
  const data = await getJson(url);
  if (!data || typeof data !== 'object') return { available: false, vehicles: null };
  const positions = (data as { positions?: unknown }).positions;
  const count = Array.isArray(positions) ? positions.length : null;
  return { available: count !== null, vehicles: count };
}

async function fetchNews(cityId: string): Promise<NewsStats> {
  const data = await getJson(`${DATA_BASE}/${cityId}/disruptions.json`);
  if (!data || typeof data !== 'object') return { available: false };
  const record = data as { alerts?: unknown; alerts_count?: unknown; generated_at?: unknown };
  const alerts = Array.isArray(record.alerts) ? record.alerts.length : null;
  // Worker zwraca pustą listę także dla miasta bez pliku w R2, ale prawdziwy
  // feed ma `alerts_count`/`generated_at`. Dzięki temu „brak nowych alertów”
  // nie wygląda jak „brak źródła komunikatów”.
  const feedExists =
    typeof record.alerts_count === 'number' ||
    typeof record.generated_at === 'string' ||
    (alerts ?? 0) > 0;
  return { available: feedExists };
}

async function fetchStopHints(cityId: string): Promise<number | null> {
  const data = await getJson(`${DATA_BASE}/${cityId}/stop-hints.json`);
  if (!data || typeof data !== 'object') return null;
  const stops = (data as { stops?: unknown }).stops;
  return stops && typeof stops === 'object' ? Object.keys(stops).length : null;
}

async function collectCity(city: (typeof CITIES)[number]): Promise<CityStats> {
  const [live, news, hints] = await Promise.all([
    fetchLiveStatus(city),
    fetchNews(city.id),
    fetchStopHints(city.id),
  ]);

  return {
    live,
    news,
    stopHints: { available: (hints ?? 0) > 0, stops: hints },
  };
}

function hasData(stats: CityStats): boolean {
  return stats.live.available || stats.news.available || stats.stopHints.available;
}

async function main(): Promise<void> {
  const cities: Record<string, CityStats> = {};
  let reachable = 0;

  // Mała paczka równoległych żądań: nie zalewamy zbiorkom.live, KP i Workera.
  for (let i = 0; i < CITIES.length; i += 6) {
    const chunk = CITIES.slice(i, i + 6);
    const results = await Promise.all(chunk.map(async (city) => [city.id, await collectCity(city)] as const));
    for (const [id, stats] of results) {
      cities[id] = stats;
      if (hasData(stats)) reachable++;
      console.log(
        `${id}: live=${stats.live.available ? (stats.live.vehicles ?? 'kp') : 'brak'} ` +
          `news=${stats.news.available ? 'tak' : 'brak'} ` +
          `hints=${stats.stopHints.stops ?? 'brak'}`,
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
