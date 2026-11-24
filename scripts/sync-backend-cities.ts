import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { CITIES } from '../src/cities';

// Mapa filtrów agencji zbiorkom.live spójna z src/services/zbiorkom.ts.
const ZBIORKOM_AGENCIES: Record<string, string> = {
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

// Agencje kolei regionalnej (feed pkp na zbiorkom.live) spójne z liveTracker.ts.
const RAIL_AGENCIES: Record<string, string[]> = {
  wroclaw: ['KD'],
  krakow: ['KML'],
  gzm: ['KS', 'IC', 'PR'],
  warszawa: ['KM', 'WKD'],
  poznan: ['KW', 'PR'],
  trojmiasto: ['SKMT'],
  lodz: ['LKA'],
};

const TIER1_CITIES = new Set([
  'wroclaw',
  'warszawa',
  'krakow',
  'gzm',
  'poznan',
  'trojmiasto',
  'lodz',
  'szczecin',
  'lublin',
  'bialystok',
  'rzeszow',
  'kielce',
  'olsztyn',
  'opole',
  'radom',
]);

const entries = CITIES.map((city) => {
  const tier = TIER1_CITIES.has(city.id) ? 1 : city.kpPrefix ? 3 : 2;
  return {
    id: city.id,
    name: city.name,
    center: city.center,
    bounds: city.bounds,
    zbiorkom_slug: city.zbiorkomSlug,
    zbiorkom_bbox: city.zbiorkomBbox,
    zbiorkom_agencies: ZBIORKOM_AGENCIES[city.id] ?? null,
    kp_prefix: city.kpPrefix ?? null,
    rail_agencies: city.features.regionalRail ? (RAIL_AGENCIES[city.id] ?? []) : [],
    live: city.features.live,
    direct_bus_position: city.features.directBusPosition,
    tier,
  };
});

const outPath = resolve(__dirname, '../backend/config/cities.json');
mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, `${JSON.stringify(entries, null, 2)}\n`, 'utf8');
console.log(
  `Zapisano ${entries.length} miast (${entries.filter((c) => c.live).length} live, ${entries.filter((c) => c.kp_prefix).length} KP) do backend/config/cities.json`,
);
