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
  expect('GZM dokleja sufiks', cityKey('kilometr.places', 'gzm'), 'kilometr.places.gzm');
  expect(
    'Warszawa dokleja sufiks',
    cityKey('kilometr.places', 'warszawa'),
    'kilometr.places.warszawa',
  );
  expect(
    'Poznań dokleja sufiks',
    cityKey('kilometr.places', 'poznan'),
    'kilometr.places.poznan',
  );
  expect(
    'Łódź dokleja sufiks',
    cityKey('kilometr.places', 'lodz'),
    'kilometr.places.lodz',
  );
  expect(
    'historia tak samo',
    cityKey('kilometr.trip_history', 'krakow'),
    'kilometr.trip_history.krakow',
  );
  expect(
    'trasy tak samo',
    cityKey('kilometr.saved_routes', 'krakow'),
    'kilometr.saved_routes.krakow',
  );
  expect(
    'dwa miasta to dwa klucze',
    cityKey('kilometr.places', 'wroclaw') !== cityKey('kilometr.places', 'krakow'),
    true,
  );
}

describe('Klasyfikacja współrzędnych do miasta (migracja)');
{
  expect('Rynek we Wrocławiu', suggestCityForCoords(51.1079, 17.0385)?.id, 'wroclaw');
  expect('Biskupin we Wrocławiu', suggestCityForCoords(51.115, 17.1)?.id, 'wroclaw');
  expect('Rynek Główny w Krakowie', suggestCityForCoords(50.0614, 19.9366)?.id, 'krakow');
  expect('Balice w Krakowie', suggestCityForCoords(50.0777, 19.7848)?.id, 'krakow');
  expect('Katowice w GZM', suggestCityForCoords(50.2649, 19.0238)?.id, 'gzm');
  expect('Gliwice w GZM', suggestCityForCoords(50.2945, 18.6714)?.id, 'gzm');
  // Najdalsza stacja GZM (Rudziniec Gliwicki, ~46 km) musi łapać się promienia...
  expect('Rudziniec Gliwicki w GZM', suggestCityForCoords(50.3666, 18.4042)?.id, 'gzm');
  // ...ale Bielsko (~49,5 km) już nie: promień ma sufit.
  expect('Bielsko poza GZM', suggestCityForCoords(49.8224, 19.0444)?.id ?? null, null);
  expect('Pałac Kultury w Warszawie', suggestCityForCoords(52.2319, 21.0067)?.id, 'warszawa');
  expect('Metro Młociny w Warszawie', suggestCityForCoords(52.2905, 20.9308)?.id, 'warszawa');
  expect('Stary Rynek w Poznaniu', suggestCityForCoords(52.4084, 16.9336)?.id, 'poznan');
  expect('Swarzędz w Poznaniu', suggestCityForCoords(52.4124, 17.0776)?.id, 'poznan');
  // Środa Wielkopolska (~31 km) to najdalszy punkt aglomeracji...
  expect('Środa Wlkp. w Poznaniu', suggestCityForCoords(52.2277, 17.2787)?.id, 'poznan');
  // ...a Września (~50 km) już poza nią.
  expect('Września poza Poznaniem', suggestCityForCoords(52.326, 17.5866)?.id ?? null, null);
  expect('Długi Targ w Trójmieście', suggestCityForCoords(54.3485, 18.6533)?.id, 'trojmiasto');
  expect('Orłowo w Trójmieście', suggestCityForCoords(54.48, 18.55)?.id, 'trojmiasto');
  // Wejherowo (~28 km od Sopotu) to najdalszy punkt aglomeracji...
  expect('Wejherowo w Trójmieście', suggestCityForCoords(54.6036, 18.2317)?.id, 'trojmiasto');
  // ...a Słupsk (~70 km) już poza nią.
  expect('Słupsk poza Trójmiastem', suggestCityForCoords(54.4647, 17.0286)?.id ?? null, null);
  expect('Piotrkowska w Łodzi', suggestCityForCoords(51.7592, 19.455)?.id, 'lodz');
  expect('Manufaktura w Łodzi', suggestCityForCoords(51.7813, 19.4448)?.id, 'lodz');
  // Zgierz (~25 km) to najdalszy punkt aglomeracji...
  expect('Zgierz w Łodzi', suggestCityForCoords(51.854, 19.125)?.id, 'lodz');
  // ...a Sieradz (~53 km) już poza nią.
  expect('Sieradz poza Łodzią', suggestCityForCoords(51.593, 18.73)?.id ?? null, null);
  expect('ocean do nikogo', suggestCityForCoords(0, 0)?.id ?? null, null);
  expect('NaN do nikogo', suggestCityForCoords(NaN, 17)?.id ?? null, null);
}

describe('Rejestr miast');
{
  expect(
    'siedem miast',
    CITIES.map((c) => c.id).join(','),
    'wroclaw,krakow,gzm,warszawa,poznan,trojmiasto,lodz',
  );
  expect('nieznane id to Wrocław', getCity('berlin').id, 'wroclaw');
  expect(
    'isCityId zna wszystkie',
    [
      isCityId('wroclaw'),
      isCityId('krakow'),
      isCityId('gzm'),
      isCityId('warszawa'),
      isCityId('poznan'),
      isCityId('trojmiasto'),
      isCityId('lodz'),
      isCityId('berlin'),
    ].join(','),
    'true,true,true,true,true,true,true,false',
  );
}

describe('Wpis Wrocławia');
{
  const wro = getCity('wroclaw');
  expect('osobna baza', wro.dbFile, 'kilometr-gtfs-wroclaw.db');
  expect('osobny pakiet kafli', wro.tilePack, 'wroclaw-tiles.ktp');
}

describe('Wpis Krakowa');
{
  const krk = getCity('krakow');
  expect('osobna baza', krk.dbFile, 'kilometr-gtfs-krakow.db');
  expect('osobny pakiet kafli', krk.tilePack, 'krakow-tiles.ktp');
}

describe('Wpis GZM');
{
  const gzm = getCity('gzm');
  expect('osobna baza', gzm.dbFile, 'kilometr-gtfs-gzm.db');
  expect('osobny pakiet kafli', gzm.tilePack, 'gzm-tiles.ktp');
  expect('kafle w z14 z kompresją gzip (limit R2)', gzm.tileMaxZoom, 14);
}

describe('Wpis Warszawy');
{
  const waw = getCity('warszawa');
  expect('slug zbiorkom to warsaw (nie warszawa)', waw.zbiorkomSlug, 'warsaw');
  expect('osobna baza', waw.dbFile, 'kilometr-gtfs-warszawa.db');
  expect('osobny pakiet kafli', waw.tilePack, 'warszawa-tiles.ktp');
  expect('kafle w z14 jak Kraków (limit R2)', waw.tileMaxZoom, 14);
  expect('kolej regionalna (SKA/KM/WKD)', waw.features.regionalRail, true);
  expect('bez bezpośredniego bus_position', waw.features.directBusPosition, false);
}

describe('Wpis Poznania');
{
  const pozn = getCity('poznan');
  expect('slug zbiorkom to poznan', pozn.zbiorkomSlug, 'poznan');
  expect('osobna baza', pozn.dbFile, 'kilometr-gtfs-poznan.db');
  expect('osobny pakiet kafli', pozn.tilePack, 'poznan-tiles.ktp');
  expect('kafle w z14 jak reszta (limit R2)', pozn.tileMaxZoom, 14);
  expect('kolej regionalna (KW)', pozn.features.regionalRail, true);
  expect('bez bezpośredniego bus_position', pozn.features.directBusPosition, false);
}

describe('Wpis Trójmiasta');
{
  const tri = getCity('trojmiasto');
  expect('slug zbiorkom to tricity (nie trojmiasto)', tri.zbiorkomSlug, 'tricity');
  expect('osobna baza', tri.dbFile, 'kilometr-gtfs-trojmiasto.db');
  expect('osobny pakiet kafli', tri.tilePack, 'trojmiasto-tiles.ktp');
  expect('kafle w z14 jak reszta (limit R2)', tri.tileMaxZoom, 14);
  expect('kolej regionalna (SKM)', tri.features.regionalRail, true);
  expect('bez bezpośredniego bus_position', tri.features.directBusPosition, false);
}

describe('Wpis Łodzi');
{
  const lodz = getCity('lodz');
  expect('slug zbiorkom to lodz', lodz.zbiorkomSlug, 'lodz');
  expect('osobna baza', lodz.dbFile, 'kilometr-gtfs-lodz.db');
  expect('osobny pakiet kafli', lodz.tilePack, 'lodz-tiles.ktp');
  expect('kafle w z14 jak reszta (limit R2)', lodz.tileMaxZoom, 14);
  expect('kolej regionalna (ŁKA)', lodz.features.regionalRail, true);
  expect('bez bezpośredniego bus_position', lodz.features.directBusPosition, false);
}

console.log(`\n${'='.repeat(52)}`);
if (failures.length === 0) {
  console.log(`WSZYSTKO OK — ${passed} asercji`);
  process.exit(0);
}
console.log(`${failures.length} NIEUDANYCH z ${passed + failures.length}:`);
for (const f of failures) console.log(`  - ${f}`);
process.exit(1);
