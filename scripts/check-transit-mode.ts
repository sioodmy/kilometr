// Weryfikacja klasyfikacji pojazdu na PRAWDZIWYCH feedach GTFS.
// Uruchom: npm run check:transit-mode
//
// Feedy pobierane są z publicznych źródeł operatorów (jak w aplikacji):
//   Wrocław → Open Data Wrocław (jeden zip, tramwaj route_type = 0)
//   Kraków  → ZTP Kraków (trzy zipy: _T tramwaje, _A/_M autobusy)
//
// Skrypt odpowiada na jedno pytanie: czy każda linia dostaje właściwą
// ikonkę tramwaju lub autobusu. Błędna ikona = zły kolor i filtr „tylko
// tramwaje” gubi linię.
//
// Celowo bez `node:fs`/`node:child_process` (jak pozostałe skrypty check:*):
// tylko fetch + fflate, więc typuje się tym samym tsconfig co reszta repo.

import { strFromU8, unzipSync } from 'fflate';
import { classifyVehicle, modeFromRouteType } from '../src/gtfs/transitMode';

interface Feed {
  label: string;
  url: string;
  /** Tryb narzucony przez definicję miasta — wskazuje go sam operator. */
  mode?: 'tram' | 'bus';
  /** Oczekiwany tryb każdej linii z tego feedu. */
  want: 'tram' | 'bus';
}

const KRAKOW: Feed[] = [
  // Kraków publikuje osobne archiwa: samo pochodzenie linii z `_T` mówi,
  // że to tramwaj. W praktyce pokrywa się to z route_type = 900.
  { label: 'Kraków tramwaje (GTFS_KRK_T)', url: 'https://gtfs.ztp.krakow.pl/GTFS_KRK_T.zip', mode: 'tram', want: 'tram' },
  { label: 'Kraków autobusy MPK (GTFS_KRK_A)', url: 'https://gtfs.ztp.krakow.pl/GTFS_KRK_A.zip', mode: 'bus', want: 'bus' },
  { label: 'Kraków autobusy Mobilis (GTFS_KRK_M)', url: 'https://gtfs.ztp.krakow.pl/GTFS_KRK_M.zip', mode: 'bus', want: 'bus' },
];

const WROCLAW: Feed = {
  label: 'Wrocław (Open Data Wrocław)',
  url: 'https://open-data.cui.wroclaw.pl/hdb/download/136/',
  want: 'bus',
};

/** Dzieli CSV z uwzględnieniem cudzysłowów i BOM-a. */
function parseCsv(content: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < content.length; i++) {
    const c = content[i];
    if (quoted) {
      if (c === '"') {
        if (content[i + 1] === '"') { field += '"'; i++; } else quoted = false;
      } else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else if (c !== '\r') field += c;
  }
  if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row); }
  return rows;
}

/** Ściąga zip i rozpakowuje TYLKO routes.txt (plik jest śmiesznie mały
 *  wobec ~180 MB stop_times, a my i tak nie chcemy go w pamięci). */
async function fetchRoutes(url: string): Promise<string> {
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
  if (!res.ok) throw new Error(`${url} → HTTP ${res.status}`);
  const zip = new Uint8Array(await res.arrayBuffer());
  const entries = unzipSync(zip, {
    filter: (file) => file.name.split('/').pop() === 'routes.txt',
  });
  for (const [, data] of Object.entries(entries)) return strFromU8(data);
  throw new Error(`${url} → brak routes.txt w archiwum`);
}

interface RouteRow {
  routeType: number | null;
  line: string;
}

function readRoutes(content: string): RouteRow[] {
  const rows = parseCsv(content);
  const header = rows[0].map((h) => h.replace(/^\uFEFF/, '').trim());
  const ti = header.indexOf('route_type');
  const si = header.indexOf('route_short_name');
  if (ti === -1) throw new Error('brak kolumny route_type w routes.txt');
  const out: RouteRow[] = [];
  for (let i = 1; i < rows.length; i++) {
    const raw = (rows[i][ti] ?? '').trim();
    const rt = raw === '' ? null : Number(raw);
    out.push({
      routeType: rt !== null && Number.isFinite(rt) ? rt : null,
      line: (rows[i][si] ?? '').trim(),
    });
  }
  return out;
}

async function main(): Promise<void> {
  let checked = 0;
  let failures = 0;

  // ── Kraków: tryb z definicji archiwum, krzyżowo z route_type ─────────────
  for (const feed of KRAKOW) {
    process.stdout.write(`${feed.label} … `);
    const routes = readRoutes(await fetchRoutes(feed.url));
    const wrong: string[] = [];
    const types = new Set<number | null>();
    for (const r of routes) {
      types.add(r.routeType);
      const got = classifyVehicle({ routeType: r.routeType, line: r.line, feedMode: feed.mode, feedLine: r.line });
      checked++;
      if (got !== feed.want) wrong.push(`${r.line} (route_type=${r.routeType}) → ${got}`);
    }
    if (wrong.length > 0) {
      failures += wrong.length;
      console.log(`✗ ${wrong.length}/${routes.length} błędnych: ${wrong.slice(0, 8).join(', ')}`);
    } else {
      console.log(`✓ ${routes.length}/${routes.length} poprawnie (route_type: ${[...types].join(',')})`);
    }
  }

  // ── Wrocław: jeden feed na oba typy, jedyne źródło to route_type ─────────
  process.stdout.write(`${WROCLAW.label} … `);
  const wroclawRoutes = readRoutes(await fetchRoutes(WROCLAW.url));
  const wTrams: string[] = [];
  const wWrong: string[] = [];
  for (const r of wroclawRoutes) {
    // Oczekiwany tryb bierzemy wyłącznie z route_type — tu nie ma podpowiedzi
    // z definicji miasta, więc sprawdzamy czy tabela działa sama.
    const want = modeFromRouteType(r.routeType);
    if (!want) continue;
    const got = classifyVehicle({ routeType: r.routeType, line: r.line });
    checked++;
    if (want === 'tram') wTrams.push(r.line);
    if (got !== want) wWrong.push(`${r.line} (route_type=${r.routeType}) → ${got}, oczekiwano ${want}`);
  }
  if (wWrong.length > 0) {
    failures += wWrong.length;
    console.log(`✗ ${wWrong.length} błędnych: ${wWrong.slice(0, 8).join(', ')}`);
  } else {
    console.log(`✓ ${wroclawRoutes.length} linii zgodnych z route_type`);
  }
  console.log(`  linie tramwajowe: ${wTrams.sort((a, b) => Number(a) - Number(b)).join(' ')}`);

  // ── regresja: co gubiła stara heurystyka „1–33 = tramwaj” ─────────────────
  const legacy = (line: string): boolean => {
    const n = parseInt(line.trim(), 10);
    return !Number.isNaN(n) && n >= 1 && n <= 33;
  };
  const missedKrakow = ['49', '62', '69', '70', '74', '76', '77'].filter((l) => !legacy(l));
  const missedWroclaw = wTrams.filter((l) => !legacy(l));

  console.log('\nRegresja — stara heurystyka „1–33 = tramwaj” myliłaby się dla:');
  console.log(`  Kraków:  ${missedKrakow.join(', ')} (${missedKrakow.length} z 23 linii tramwajowych)`);
  console.log(`  Wrocław: ${missedWroclaw.join(', ') || '(brak)'}`);

  console.log(`\nSprawdzono ${checked} linii, błędów: ${failures}`);
  if (failures > 0) process.exit(1);

}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
