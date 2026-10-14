/**
 * Sprawdzenie miejsc per-miasto (kubełki KV + klasyfikacja do migracji).
 *
 * Uruchomienie: `npm run check:places`
 *
 * Samo KV i locki to I/O, którego nie da się zasymulować sensownie — tu
 * chronimy czystą logikę, od której zależy, czy miejsce trafi do dobrego
 * kubełka: `cityKey` (Wrocław trzyma legacy klucz) i `suggestCityForCoords`
 * (decyduje o przenosinach z legacy kubełka przy migracji).
 */

import { CITIES, cityKey, getCity, isCityId, suggestCityForCoords } from '../src/cities';

let passed = 0;
const failures: string[] = [];
let section = '';

function describe(name: string): void {
  section = name;
  console.log(`\n— ${name}`);
}

function expect<T>(label: string, got: T, want: T): void {
  if (JSON.stringify(got) === JSON.stringify(want)) {
    passed++;
    console.log(`   ok    ${label} = ${JSON.stringify(got)}`);
    return;
  }
  failures.push(`${section} → ${label}: ${JSON.stringify(got)} ≠ ${JSON.stringify(want)}`);
  console.log(`   FAIL  ${label} = ${JSON.stringify(got)} (oczekiwano ${JSON.stringify(want)})`);
}

describe('Klucze kubełków per-miasto');
{
  expect('Wrocław trzyma legacy klucz', cityKey('kilometr.places', 'wroclaw'), 'kilometr.places');
  expect('Kraków dokleja sufiks', cityKey('kilometr.places', 'krakow'), 'kilometr.places.krakow');
  expect('historia tak samo', cityKey('kilometr.trip_history', 'krakow'), 'kilometr.trip_history.krakow');
  expect('trasy tak samo', cityKey('kilometr.saved_routes', 'krakow'), 'kilometr.saved_routes.krakow');
  expect('dwa miasta to dwa klucze', cityKey('kilometr.places', 'wroclaw') !== cityKey('kilometr.places', 'krakow'), true);
}

describe('Klasyfikacja współrzędnych do miasta (migracja)');
{
  expect('Rynek we Wrocławiu', suggestCityForCoords(51.1079, 17.0385)?.id, 'wroclaw');
  expect('Biskupin we Wrocławiu', suggestCityForCoords(51.115, 17.1)?.id, 'wroclaw');
  expect('Rynek Główny w Krakowie', suggestCityForCoords(50.0614, 19.9366)?.id, 'krakow');
  expect('Balice w Krakowie', suggestCityForCoords(50.0777, 19.7848)?.id, 'krakow');
  expect('Warszawa do nikogo', suggestCityForCoords(52.2297, 21.0122)?.id ?? null, null);
  expect('ocean do nikogo', suggestCityForCoords(0, 0)?.id ?? null, null);
  expect('NaN do nikogo', suggestCityForCoords(NaN, 17)?.id ?? null, null);
}

describe('Rejestr miast');
{
  expect('dwa miasta', CITIES.map((c) => c.id).join(','), 'wroclaw,krakow');
  expect('nieznane id to Wrocław', getCity('berlin').id, 'wroclaw');
  expect('isCityId zna oba', [isCityId('wroclaw'), isCityId('krakow'), isCityId('berlin')].join(','), 'true,true,false');
}

console.log(`\n${'='.repeat(52)}`);
if (failures.length === 0) {
  console.log(`WSZYSTKO OK — ${passed} asercji`);
  process.exit(0);
}
console.log(`${failures.length} NIEUDANYCH z ${passed + failures.length}:`);
for (const f of failures) console.log(`  - ${f}`);
process.exit(1);
