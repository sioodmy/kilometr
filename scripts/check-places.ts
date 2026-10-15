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
    'Rzeszów dokleja sufiks',
    cityKey('kilometr.places', 'rzeszow'),
    'kilometr.places.rzeszow',
  );
  expect(
    'Łódź dokleja sufiks',
    cityKey('kilometr.places', 'lodz'),
    'kilometr.places.lodz',
  );
  expect(
    'Szczecin dokleja sufiks',
    cityKey('kilometr.places', 'szczecin'),
    'kilometr.places.szczecin',
  );
  expect(
    'Kielce doklejają sufiks',
    cityKey('kilometr.places', 'kielce'),
    'kilometr.places.kielce',
  );
  expect(
    'Olsztyn dokleja sufiks',
    cityKey('kilometr.places', 'olsztyn'),
    'kilometr.places.olsztyn',
  );
  expect(
    'Białystok dokleja sufiks',
    cityKey('kilometr.places', 'bialystok'),
    'kilometr.places.bialystok',
  );
  expect(
    'Opole dokleja sufiks',
    cityKey('kilometr.places', 'opole'),
    'kilometr.places.opole',
  );
  expect(
    'Rzeszów dokleja sufiks',
    cityKey('kilometr.places', 'rzeszow'),
    'kilometr.places.rzeszow',
  );
  expect(
    'Lublin dokleja sufiks',
    cityKey('kilometr.places', 'lublin'),
    'kilometr.places.lublin',
  );
  expect(
    'Radom dokleja sufiks',
    cityKey('kilometr.places', 'radom'),
    'kilometr.places.radom',
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
  expect('Brama Portowa w Szczecinie', suggestCityForCoords(53.4285, 14.5528)?.id, 'szczecin');
  expect('Dąbie w Szczecinie', suggestCityForCoords(53.39, 14.67)?.id, 'szczecin');
  // Police (~13 km) to najdalszy punkt strefy...
  expect('Police w Szczecinie', suggestCityForCoords(53.55, 14.575)?.id, 'szczecin');
  // ...a Stargard (~33 km) już poza nią.
  expect('Stargard poza Szczecinem', suggestCityForCoords(53.34, 15.04)?.id ?? null, null);
  expect('Rynek w Kielcach', suggestCityForCoords(50.8717, 20.6314)?.id, 'kielce');
  expect('Kadzielnia w Kielcach', suggestCityForCoords(50.8556, 20.6176)?.id, 'kielce');
  // Obice Szkoła (~21 km) to najdalszy przystanek strefy ZTM...
  expect('Obice w Kielcach', suggestCityForCoords(50.68369, 20.60016)?.id, 'kielce');
  // ...a Skarżysko-Kamienna (~32 km) już poza nią.
  expect('Skarżysko poza Kielcami', suggestCityForCoords(51.1146, 20.8693)?.id ?? null, null);
  expect('Stare Miasto w Olsztynie', suggestCityForCoords(53.7778, 20.4778)?.id, 'olsztyn');
  expect('Dworzec Główny w Olsztynie', suggestCityForCoords(53.7839, 20.4947)?.id, 'olsztyn');
  expect('Kortowo w Olsztynie', suggestCityForCoords(53.759, 20.457)?.id, 'olsztyn');
  // Barczewo (~16 km) to najdalszy punkt strefy...
  expect('Barczewo w Olsztynie', suggestCityForCoords(53.8489, 20.6911)?.id, 'olsztyn');
  // ...a Ostróda (~35 km) już poza nią.
  expect('Ostróda poza Olsztynem', suggestCityForCoords(53.6965, 19.9651)?.id ?? null, null);
  expect('Rynek Kościuszki w Białymstoku', suggestCityForCoords(53.1325, 23.1688)?.id, 'bialystok');
  expect('Choroszcz w Białymstoku', suggestCityForCoords(53.1428, 22.9186)?.id, 'bialystok');
  // Niewodnica (~24 km) to najdalszy punkt strefy...
  expect('Niewodnica w Białymstoku', suggestCityForCoords(52.9213, 23.0966)?.id, 'bialystok');
  // ...a Sokółka (~38 km) już poza nią.
  expect('Sokółka poza Białymstokiem', suggestCityForCoords(53.4078, 23.5008)?.id ?? null, null);
  expect('Dworzec Główny w Opolu', suggestCityForCoords(50.663364, 17.928717)?.id, 'opole');
  expect('Czarnowąsy w Opolu', suggestCityForCoords(50.740002, 17.911322)?.id, 'opole');
  expect('Wrzoski w Opolu', suggestCityForCoords(50.686375, 17.813322)?.id, 'opole');
  // Prószków (~10 km) to najdalszy punkt strefy MZK na południu...
  expect('Prószków w Opolu', suggestCityForCoords(50.579609, 17.869724)?.id, 'opole');
  // ...a Brzeg (~39 km) już poza nią (i poza Wrocławiem).
  expect('Brzeg poza Opolem', suggestCityForCoords(50.8606, 17.4707)?.id ?? null, null);
  expect('Strzelce Opolskie poza Opolem', suggestCityForCoords(50.5105, 18.3006)?.id ?? null, null);
  expect('Rynek w Rzeszowie', suggestCityForCoords(50.0379, 22.0044)?.id, 'rzeszow');
  // Albigowa (~17 km) to najdalszy przystanek ZTM...
  expect('Albigowa w Rzeszowie', suggestCityForCoords(50.0151, 22.2293)?.id, 'rzeszow');
  // ...a Przemyśl (~60 km) już poza strefą.
  expect('Przemyśl poza Rzeszowem', suggestCityForCoords(49.7835, 22.7846)?.id ?? null, null);
  expect('Zamek w Lublinie', suggestCityForCoords(51.2515, 22.5695)?.id, 'lublin');
  expect('Felicity w Lublinie', suggestCityForCoords(51.23, 22.6135)?.id, 'lublin');
  // Świdnik (~10 km) i Niemce (~13 km) to najdalsze punkty strefy...
  expect('Świdnik w Lublinie', suggestCityForCoords(51.22, 22.71)?.id, 'lublin');
  expect('Niemce w Lublinie', suggestCityForCoords(51.36, 22.52)?.id, 'lublin');
  // ...a Lubartów (~24 km) już poza nią.
  expect('Lubartów poza Lublinem', suggestCityForCoords(51.46, 22.61)?.id ?? null, null);

  expect('ocean do nikogo', suggestCityForCoords(0, 0)?.id ?? null, null);
  expect('NaN do nikogo', suggestCityForCoords(NaN, 17)?.id ?? null, null);
}

describe('Rejestr miast');
{
  expect(
    'piętnaście miast',
    CITIES.map((c) => c.id).join(','),
    'wroclaw,krakow,gzm,warszawa,poznan,trojmiasto,lodz,szczecin,kielce,olsztyn,bialystok,opole,rzeszow,lublin,radom',
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
      isCityId('szczecin'),
      isCityId('kielce'),
      isCityId('olsztyn'),
      isCityId('bialystok'),
      isCityId('opole'),
      isCityId('rzeszow'),
      isCityId('lublin'),
      isCityId('radom'),
      isCityId('berlin'),
    ].join(','),
    'true,true,true,true,true,true,true,true,true,true,true,true,true,true,true,false',
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

describe('Wpis Szczecina');
{
  const szcz = getCity('szczecin');
  expect('slug zbiorkom to szczecin', szcz.zbiorkomSlug, 'szczecin');
  expect('osobna baza', szcz.dbFile, 'kilometr-gtfs-szczecin.db');
  expect('osobny pakiet kafli', szcz.tilePack, 'szczecin-tiles.ktp');
  expect('kafle w z14 jak reszta (limit R2)', szcz.tileMaxZoom, 14);
  expect('bez kolei regionalnej (brak GTFS SKM)', szcz.features.regionalRail, false);
  expect('bez bezpośredniego bus_position', szcz.features.directBusPosition, false);
}

describe('Wpis Kielc');
{
  const kiel = getCity('kielce');
  expect('slug zbiorkom to kielce', kiel.zbiorkomSlug, 'kielce');
  expect('osobna baza', kiel.dbFile, 'kilometr-gtfs-kielce.db');
  expect('osobny pakiet kafli', kiel.tilePack, 'kielce-tiles.ktp');
  expect('kafle w z14 jak reszta (limit R2)', kiel.tileMaxZoom, 14);
  expect('bez kolei regionalnej (brak GTFS kolei)', kiel.features.regionalRail, false);
  expect('bez bezpośredniego bus_position', kiel.features.directBusPosition, false);
}

describe('Wpis Olsztyna');
{
  const olsz = getCity('olsztyn');
  expect('slug zbiorkom to olsztyn', olsz.zbiorkomSlug, 'olsztyn');
  expect('osobna baza', olsz.dbFile, 'kilometr-gtfs-olsztyn.db');
  expect('osobny pakiet kafli', olsz.tilePack, 'olsztyn-tiles.ktp');
  expect('kafle w z14 jak reszta (limit R2)', olsz.tileMaxZoom, 14);
  expect('bez kolei regionalnej (brak GTFS)', olsz.features.regionalRail, false);
  expect('bez bezpośredniego bus_position', olsz.features.directBusPosition, false);
}

describe('Wpis Białegostoku');
{
  const bial = getCity('bialystok');
  expect('slug zbiorkom to bialystok', bial.zbiorkomSlug, 'bialystok');
  expect('osobna baza', bial.dbFile, 'kilometr-gtfs-bialystok.db');
  expect('osobny pakiet kafli', bial.tilePack, 'bialystok-tiles.ktp');
  expect('kafle w z14 jak reszta (limit R2)', bial.tileMaxZoom, 14);
  expect('bez kolei regionalnej (brak GTFS POLREGIO)', bial.features.regionalRail, false);
  expect('bez bezpośredniego bus_position', bial.features.directBusPosition, false);
}

describe('Wpis Opola');
{
  const opo = getCity('opole');
  expect('slug zbiorkom to opole', opo.zbiorkomSlug, 'opole');
  expect('osobna baza', opo.dbFile, 'kilometr-gtfs-opole.db');
  expect('osobny pakiet kafli', opo.tilePack, 'opole-tiles.ktp');
  expect('kafle w z14 jak reszta (limit R2)', opo.tileMaxZoom, 14);
  expect('bez kolei regionalnej (brak GTFS kolei)', opo.features.regionalRail, false);
  expect('bez bezpośredniego bus_position', opo.features.directBusPosition, false);
}

describe('Wpis Rzeszowa');
{
  const rze = getCity('rzeszow');
  expect('slug zbiorkom to rzeszow', rze.zbiorkomSlug, 'rzeszow');
  expect('osobna baza', rze.dbFile, 'kilometr-gtfs-rzeszow.db');
  expect('osobny pakiet kafli', rze.tilePack, 'rzeszow-tiles.ktp');
  expect('kafle w z14 jak reszta (limit R2)', rze.tileMaxZoom, 14);
  expect('bez kolei regionalnej (brak GTFS kolei)', rze.features.regionalRail, false);
  expect('bez bezpośredniego bus_position', rze.features.directBusPosition, false);
}

describe('Wpis Lublina');
{
  const lub = getCity('lublin');
  expect('slug zbiorkom to lublin', lub.zbiorkomSlug, 'lublin');
  expect('osobna baza', lub.dbFile, 'kilometr-gtfs-lublin.db');
  expect('osobny pakiet kafli', lub.tilePack, 'lublin-tiles.ktp');
  expect('kafle w z14 jak reszta (limit R2)', lub.tileMaxZoom, 14);
  expect('bez kolei regionalnej (brak GTFS w zakresie budowy)', lub.features.regionalRail, false);
  expect('bez bezpośredniego bus_position', lub.features.directBusPosition, false);
}

console.log(`\n${'='.repeat(52)}`);
if (failures.length === 0) {
  console.log(`WSZYSTKO OK — ${passed} asercji`);
  process.exit(0);
}
console.log(`${failures.length} NIEUDANYCH z ${passed + failures.length}:`);
for (const f of failures) console.log(`  - ${f}`);
process.exit(1);
