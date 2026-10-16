/**
 * Canary żywych źródeł: odpytuje realne MPK (bus_position) i zbiorkom.live
 * (Wrocław) i kończy się błędem, gdy któreś nie odpowiada albo zmieniło
 * schemat. Pusty wynik (noc) jest w porządku, brak odpowiedzi i śmieci już nie.
 *
 * Uruchomienie: npx tsx --require ./scripts/stub-expo.cjs scripts/check-live-canary.ts
 */

import { liveTracker } from '../src/services/liveTracker';
import { fetchZbWroclawRows } from '../src/services/zbiorkom';

interface Probe {
  name: string;
  status: 'ok' | 'empty' | 'down';
  detail: string;
}

async function probe(name: string, fetchRows: () => Promise<unknown[] | null>): Promise<Probe> {
  try {
    const rows = await fetchRows();
    if (rows === null) return { name, status: 'down', detail: 'brak odpowiedzi albo zmiana schematu' };
    if (rows.length === 0) return { name, status: 'empty', detail: 'pusto (możliwa noc)' };
    return { name, status: 'ok', detail: `${rows.length} pojazdów` };
  } catch (err) {
    return { name, status: 'down', detail: err instanceof Error ? err.message : String(err) };
  }
}

async function main(): Promise<void> {
  const results = await Promise.all([
    probe('mpk-wroclaw', () => liveTracker.probeMpkDirect()),
    probe('zbiorkom-wroclaw', () => fetchZbWroclawRows()),
  ]);

  for (const r of results) {
    console.log(`   ${r.status === 'down' ? 'FAIL' : 'ok  '}  ${r.name}: ${r.status} (${r.detail})`);
  }
  console.log(`\nzdrowie źródeł: ${JSON.stringify(liveTracker.getSourceHealth())}`);

  const down = results.filter((r) => r.status === 'down');
  if (down.length > 0) {
    console.error(`\n${down.length} źródeł nie odpowiada: ${down.map((r) => r.name).join(', ')}`);
    process.exit(1);
  }
  console.log('\nŹródła live odpowiadają.');
}

void main();
