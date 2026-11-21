/**
 * Sprawdzenie miejsc per-miasto (kubełki KV + klasyfikacja do migracji).
 *
 * Uruchomienie: `npm run check:places`
 *
 * Samo KV i locki to I/O, którego nie da się zasymulować sensownie - tu
 * chronimy czystą logikę, od której zależy, czy miejsce trafi do dobrego
 * kubełka: `cityKey` (Wrocław trzyma legacy klucz) i `suggestCityForCoords`
 * (decyduje o przenosinach z legacy kubełka przy migracji).
 */

import { CITIES, cityKey, getCity, isCityId, isOutsideCity, resolveSupportedCityId, suggestCityForCoords } from '../src/cities';

let passed = 0;
const failures: string[] = [];
let section = '';

function describe(name: string): void {
  section = name;
  console.log(`\n== ${name}`);
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
  expect('Bielsko-Biała to własne miasto', suggestCityForCoords(49.8224, 19.0444)?.id ?? null, 'bielskobiala');
  expect('Pałac Kultury w Warszawie', suggestCityForCoords(52.2319, 21.0067)?.id, 'warszawa');
  expect('Metro Młociny w Warszawie', suggestCityForCoords(52.2905, 20.9308)?.id, 'warszawa');
  expect('Stary Rynek w Poznaniu', suggestCityForCoords(52.4084, 16.9336)?.id, 'poznan');
  expect('Swarzędz w Poznaniu', suggestCityForCoords(52.4124, 17.0776)?.id, 'poznan');
  // Środa Wielkopolska (~31 km) to najdalszy punkt aglomeracji...
  expect('Środa Wlkp. w Poznaniu', suggestCityForCoords(52.2277, 17.2787)?.id, 'poznan');
  // ...a Września (~50 km) już poza nią.
  expect('Września to własne miasto', suggestCityForCoords(52.326, 17.5866)?.id ?? null, 'wrzesnia');
  expect('Długi Targ w Trójmieście', suggestCityForCoords(54.3485, 18.6533)?.id, 'trojmiasto');
  expect('Orłowo w Trójmieście', suggestCityForCoords(54.48, 18.55)?.id, 'trojmiasto');
  // Wejherowo (~28 km od Sopotu) to najdalszy punkt aglomeracji...
  expect('Wejherowo w Trójmieście', suggestCityForCoords(54.6036, 18.2317)?.id, 'trojmiasto');
  // ...a Słupsk (~70 km) już poza nią.
  expect('Słupsk to własne miasto (od 2026)', suggestCityForCoords(54.4647, 17.0286)?.id ?? null, 'slupsk');
  expect('Piotrkowska w Łodzi', suggestCityForCoords(51.7592, 19.455)?.id, 'lodz');
  expect('Manufaktura w Łodzi', suggestCityForCoords(51.7813, 19.4448)?.id, 'lodz');
  // Zgierz (~25 km) to najdalszy punkt aglomeracji...
  expect('Zgierz w Łodzi', suggestCityForCoords(51.854, 19.125)?.id, 'lodz');
  // ...a Sieradz (~53 km) już poza nią.
  expect('Sieradz to własne miasto', suggestCityForCoords(51.593, 18.73)?.id ?? null, 'sieradz');
  expect('Brama Portowa w Szczecinie', suggestCityForCoords(53.4285, 14.5528)?.id, 'szczecin');
  expect('Dąbie w Szczecinie', suggestCityForCoords(53.39, 14.67)?.id, 'szczecin');
  // Police (~13 km) to najdalszy punkt strefy...
  expect('Police w Szczecinie', suggestCityForCoords(53.55, 14.575)?.id, 'szczecin');
  // ...a Stargard (~33 km) już poza nią.
  expect('Stargard to własne miasto', suggestCityForCoords(53.34, 15.04)?.id ?? null, 'stargard');
  expect('Rynek w Kielcach', suggestCityForCoords(50.8717, 20.6314)?.id, 'kielce');
  expect('Kadzielnia w Kielcach', suggestCityForCoords(50.8556, 20.6176)?.id, 'kielce');
  // Obice Szkoła (~21 km) to najdalszy przystanek strefy ZTM...
  expect('Obice w Kielcach', suggestCityForCoords(50.68369, 20.60016)?.id, 'kielce');
  // ...a Skarżysko-Kamienna (~32 km) już poza nią.
  expect('Skarżysko to własne miasto', suggestCityForCoords(51.1146, 20.8693)?.id ?? null, 'skarzysko');
  expect('Stare Miasto w Olsztynie', suggestCityForCoords(53.7778, 20.4778)?.id, 'olsztyn');
  expect('Dworzec Główny w Olsztynie', suggestCityForCoords(53.7839, 20.4947)?.id, 'olsztyn');
  expect('Kortowo w Olsztynie', suggestCityForCoords(53.759, 20.457)?.id, 'olsztyn');
  // Barczewo (~16 km) to najdalszy punkt strefy...
  expect('Barczewo w Olsztynie', suggestCityForCoords(53.8489, 20.6911)?.id, 'olsztyn');
  // ...a Ostróda (~35 km) już poza nią.
  expect('Ostróda to własne miasto', suggestCityForCoords(53.6965, 19.9651)?.id ?? null, 'ostroda');
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
  expect('Przemyśl to własne miasto', suggestCityForCoords(49.7835, 22.7846)?.id ?? null, 'przemysl');
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
    '132 miasta',
    CITIES.map((c) => c.id).join(','),
    'wroclaw,krakow,gzm,warszawa,poznan,trojmiasto,lodz,szczecin,kielce,olsztyn,bialystok,opole,rzeszow,lublin,radom,bydgoszcz,torun,elblag,gorzow,czestochowa,zielonagora,rybnik,slupsk,walbrzych,kalisz,siedlce,lomza,krosno,jaslo,olkusz,chrzanow,bochnia,ilawa,bielskobiala,koszalin,piotrkow,tomaszow,skarzysko,oswiecim,swinoujscie,zakopane,plock,tarnow,legnica,jastrzebie,pila,konin,suwalki,ostrowiec,stalowawola,przemysl,elk,leszno,chelm,mielec,tczew,ostroleka,starachowice,kutno,kolobrzeg,radomsko,boleslawiec,cieszyn,zywiec,krasnik,grodzisk,pruszkow,sochaczew,minskmazowiecki,otwock,nowydwormaz,zabki,pabianice,zgierz,grudziadz,stargard,gniezno,jaworzno,kedzierzynkozle,zamosc,raciborz,belchatow,tarnobrzeg,skierniewice,zawiercie,starogard,zdunskawola,nysa,malbork,sieradz,szczecinek,nowasol,olesnica,czechowicedziedzice,ostroda,nowytarg,augustow,ketrzyn,zgorzelec,polkowice,gorlice,jarocin,wrzesnia,walcz,gizycko,zagan,koscierzyna,krotoszyn,sandomierz,bartoszyce,wielun,mragowo,swiecie,wagrowiec,bielskpodlaski,dzialdowo,brzesko,gostyn,chodziez,lidzbarkwarminski,pszczyna,wodzislaw,zabkowice,strzelin,srodaslaska,jedrzejow,kozienice,oborniki,wieliczka,myszkow,slubice,kartuzy',
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


describe('Wpisy miast dodanych w 2026');
{
  // live=true: zbiorkom ma endpoint; live=false: polling wyłączony (features.live).
  const expected: Record<string, { db: string; pack: string; live: boolean }> = {
    bydgoszcz: { db: 'kilometr-gtfs-bydgoszcz.db', pack: 'bydgoszcz-tiles.ktp', live: false },
    torun: { db: 'kilometr-gtfs-torun.db', pack: 'torun-tiles.ktp', live: true },
    elblag: { db: 'kilometr-gtfs-elblag.db', pack: 'elblag-tiles.ktp', live: true },
    gorzow: { db: 'kilometr-gtfs-gorzow.db', pack: 'gorzow-tiles.ktp', live: true },
    czestochowa: { db: 'kilometr-gtfs-czestochowa.db', pack: 'czestochowa-tiles.ktp', live: true },
    zielonagora: { db: 'kilometr-gtfs-zielonagora.db', pack: 'zielonagora-tiles.ktp', live: false },
    rybnik: { db: 'kilometr-gtfs-rybnik.db', pack: 'rybnik-tiles.ktp', live: true },
    slupsk: { db: 'kilometr-gtfs-slupsk.db', pack: 'slupsk-tiles.ktp', live: true },
    walbrzych: { db: 'kilometr-gtfs-walbrzych.db', pack: 'walbrzych-tiles.ktp', live: true },
    kalisz: { db: 'kilometr-gtfs-kalisz.db', pack: 'kalisz-tiles.ktp', live: true },
    siedlce: { db: 'kilometr-gtfs-siedlce.db', pack: 'siedlce-tiles.ktp', live: true },
    lomza: { db: 'kilometr-gtfs-lomza.db', pack: 'lomza-tiles.ktp', live: false },
    krosno: { db: 'kilometr-gtfs-krosno.db', pack: 'krosno-tiles.ktp', live: true },
    jaslo: { db: 'kilometr-gtfs-jaslo.db', pack: 'jaslo-tiles.ktp', live: false },
    olkusz: { db: 'kilometr-gtfs-olkusz.db', pack: 'olkusz-tiles.ktp', live: false },
    chrzanow: { db: 'kilometr-gtfs-chrzanow.db', pack: 'chrzanow-tiles.ktp', live: false },
    bochnia: { db: 'kilometr-gtfs-bochnia.db', pack: 'bochnia-tiles.ktp', live: false },
    ilawa: { db: 'kilometr-gtfs-ilawa.db', pack: 'ilawa-tiles.ktp', live: false },
    bielskobiala: { db: 'kilometr-gtfs-bielskobiala.db', pack: 'bielskobiala-tiles.ktp', live: true },
    koszalin: { db: 'kilometr-gtfs-koszalin.db', pack: 'koszalin-tiles.ktp', live: true },
    piotrkow: { db: 'kilometr-gtfs-piotrkow.db', pack: 'piotrkow-tiles.ktp', live: true },
    tomaszow: { db: 'kilometr-gtfs-tomaszow.db', pack: 'tomaszow-tiles.ktp', live: true },
    skarzysko: { db: 'kilometr-gtfs-skarzysko.db', pack: 'skarzysko-tiles.ktp', live: true },
    oswiecim: { db: 'kilometr-gtfs-oswiecim.db', pack: 'oswiecim-tiles.ktp', live: true },
    swinoujscie: { db: 'kilometr-gtfs-swinoujscie.db', pack: 'swinoujscie-tiles.ktp', live: true },
    zakopane: { db: 'kilometr-gtfs-zakopane.db', pack: 'zakopane-tiles.ktp', live: true },
    plock: { db: 'kilometr-gtfs-plock.db', pack: 'plock-tiles.ktp', live: true },
    tarnow: { db: 'kilometr-gtfs-tarnow.db', pack: 'tarnow-tiles.ktp', live: true },
    legnica: { db: 'kilometr-gtfs-legnica.db', pack: 'legnica-tiles.ktp', live: true },
    jastrzebie: { db: 'kilometr-gtfs-jastrzebie.db', pack: 'jastrzebie-tiles.ktp', live: true },
    pila: { db: 'kilometr-gtfs-pila.db', pack: 'pila-tiles.ktp', live: true },
    konin: { db: 'kilometr-gtfs-konin.db', pack: 'konin-tiles.ktp', live: true },
    suwalki: { db: 'kilometr-gtfs-suwalki.db', pack: 'suwalki-tiles.ktp', live: true },
    ostrowiec: { db: 'kilometr-gtfs-ostrowiec.db', pack: 'ostrowiec-tiles.ktp', live: true },
    stalowawola: { db: 'kilometr-gtfs-stalowawola.db', pack: 'stalowawola-tiles.ktp', live: false },
    przemysl: { db: 'kilometr-gtfs-przemysl.db', pack: 'przemysl-tiles.ktp', live: false },
    elk: { db: 'kilometr-gtfs-elk.db', pack: 'elk-tiles.ktp', live: true },
    leszno: { db: 'kilometr-gtfs-leszno.db', pack: 'leszno-tiles.ktp', live: true },
    chelm: { db: 'kilometr-gtfs-chelm.db', pack: 'chelm-tiles.ktp', live: true },
    mielec: { db: 'kilometr-gtfs-mielec.db', pack: 'mielec-tiles.ktp', live: true },
    tczew: { db: 'kilometr-gtfs-tczew.db', pack: 'tczew-tiles.ktp', live: true },
    ostroleka: { db: 'kilometr-gtfs-ostroleka.db', pack: 'ostroleka-tiles.ktp', live: true },
    starachowice: { db: 'kilometr-gtfs-starachowice.db', pack: 'starachowice-tiles.ktp', live: true },
    kutno: { db: 'kilometr-gtfs-kutno.db', pack: 'kutno-tiles.ktp', live: true },
    kolobrzeg: { db: 'kilometr-gtfs-kolobrzeg.db', pack: 'kolobrzeg-tiles.ktp', live: true },
    radomsko: { db: 'kilometr-gtfs-radomsko.db', pack: 'radomsko-tiles.ktp', live: true },
    boleslawiec: { db: 'kilometr-gtfs-boleslawiec.db', pack: 'boleslawiec-tiles.ktp', live: true },
    cieszyn: { db: 'kilometr-gtfs-cieszyn.db', pack: 'cieszyn-tiles.ktp', live: true },
    zywiec: { db: 'kilometr-gtfs-zywiec.db', pack: 'zywiec-tiles.ktp', live: true },
    krasnik: { db: 'kilometr-gtfs-krasnik.db', pack: 'krasnik-tiles.ktp', live: true },
    grodzisk: { db: 'kilometr-gtfs-grodzisk.db', pack: 'grodzisk-tiles.ktp', live: true },
    pruszkow: { db: 'kilometr-gtfs-pruszkow.db', pack: 'pruszkow-tiles.ktp', live: true },
    sochaczew: { db: 'kilometr-gtfs-sochaczew.db', pack: 'sochaczew-tiles.ktp', live: true },
    minskmazowiecki: { db: 'kilometr-gtfs-minskmazowiecki.db', pack: 'minskmazowiecki-tiles.ktp', live: true },
    otwock: { db: 'kilometr-gtfs-otwock.db', pack: 'otwock-tiles.ktp', live: true },
    nowydwormaz: { db: 'kilometr-gtfs-nowydwormaz.db', pack: 'nowydwormaz-tiles.ktp', live: true },
    zabki: { db: 'kilometr-gtfs-zabki.db', pack: 'zabki-tiles.ktp', live: true },
    pabianice: { db: 'kilometr-gtfs-pabianice.db', pack: 'pabianice-tiles.ktp', live: true },
    zgierz: { db: 'kilometr-gtfs-zgierz.db', pack: 'zgierz-tiles.ktp', live: true },
    grudziadz: { db: 'kilometr-gtfs-grudziadz.db', pack: 'grudziadz-tiles.ktp', live: true },
    jaworzno: { db: 'kilometr-gtfs-jaworzno.db', pack: 'jaworzno-tiles.ktp', live: true },
    stargard: { db: 'kilometr-gtfs-stargard.db', pack: 'stargard-tiles.ktp', live: true },
    gniezno: { db: 'kilometr-gtfs-gniezno.db', pack: 'gniezno-tiles.ktp', live: true },
    zamosc: { db: 'kilometr-gtfs-zamosc.db', pack: 'zamosc-tiles.ktp', live: true },
    kedzierzynkozle: { db: 'kilometr-gtfs-kedzierzynkozle.db', pack: 'kedzierzynkozle-tiles.ktp', live: true },
    belchatow: { db: 'kilometr-gtfs-belchatow.db', pack: 'belchatow-tiles.ktp', live: true },
    raciborz: { db: 'kilometr-gtfs-raciborz.db', pack: 'raciborz-tiles.ktp', live: true },
    tarnobrzeg: { db: 'kilometr-gtfs-tarnobrzeg.db', pack: 'tarnobrzeg-tiles.ktp', live: true },
    skierniewice: { db: 'kilometr-gtfs-skierniewice.db', pack: 'skierniewice-tiles.ktp', live: true },
    starogard: { db: 'kilometr-gtfs-starogard.db', pack: 'starogard-tiles.ktp', live: true },
    zawiercie: { db: 'kilometr-gtfs-zawiercie.db', pack: 'zawiercie-tiles.ktp', live: true },
    nysa: { db: 'kilometr-gtfs-nysa.db', pack: 'nysa-tiles.ktp', live: true },
    zdunskawola: { db: 'kilometr-gtfs-zdunskawola.db', pack: 'zdunskawola-tiles.ktp', live: true },
    sieradz: { db: 'kilometr-gtfs-sieradz.db', pack: 'sieradz-tiles.ktp', live: true },
    malbork: { db: 'kilometr-gtfs-malbork.db', pack: 'malbork-tiles.ktp', live: true },
    szczecinek: { db: 'kilometr-gtfs-szczecinek.db', pack: 'szczecinek-tiles.ktp', live: true },
    nowasol: { db: 'kilometr-gtfs-nowasol.db', pack: 'nowasol-tiles.ktp', live: true },
    olesnica: { db: 'kilometr-gtfs-olesnica.db', pack: 'olesnica-tiles.ktp', live: true },
    czechowicedziedzice: { db: 'kilometr-gtfs-czechowicedziedzice.db', pack: 'czechowicedziedzice-tiles.ktp', live: true },
    ostroda: { db: 'kilometr-gtfs-ostroda.db', pack: 'ostroda-tiles.ktp', live: true },
    nowytarg: { db: 'kilometr-gtfs-nowytarg.db', pack: 'nowytarg-tiles.ktp', live: true },
    augustow: { db: 'kilometr-gtfs-augustow.db', pack: 'augustow-tiles.ktp', live: true },
    ketrzyn: { db: 'kilometr-gtfs-ketrzyn.db', pack: 'ketrzyn-tiles.ktp', live: true },
    gorlice: { db: 'kilometr-gtfs-gorlice.db', pack: 'gorlice-tiles.ktp', live: true },
    zgorzelec: { db: 'kilometr-gtfs-zgorzelec.db', pack: 'zgorzelec-tiles.ktp', live: true },
    jarocin: { db: 'kilometr-gtfs-jarocin.db', pack: 'jarocin-tiles.ktp', live: true },
    polkowice: { db: 'kilometr-gtfs-polkowice.db', pack: 'polkowice-tiles.ktp', live: true },
    zagan: { db: 'kilometr-gtfs-zagan.db', pack: 'zagan-tiles.ktp', live: true },
    wrzesnia: { db: 'kilometr-gtfs-wrzesnia.db', pack: 'wrzesnia-tiles.ktp', live: true },
    walcz: { db: 'kilometr-gtfs-walcz.db', pack: 'walcz-tiles.ktp', live: true },
    gizycko: { db: 'kilometr-gtfs-gizycko.db', pack: 'gizycko-tiles.ktp', live: true },
    krotoszyn: { db: 'kilometr-gtfs-krotoszyn.db', pack: 'krotoszyn-tiles.ktp', live: true },
    koscierzyna: { db: 'kilometr-gtfs-koscierzyna.db', pack: 'koscierzyna-tiles.ktp', live: true },
    sandomierz: { db: 'kilometr-gtfs-sandomierz.db', pack: 'sandomierz-tiles.ktp', live: true },
    bartoszyce: { db: 'kilometr-gtfs-bartoszyce.db', pack: 'bartoszyce-tiles.ktp', live: true },
    wielun: { db: 'kilometr-gtfs-wielun.db', pack: 'wielun-tiles.ktp', live: true },
    mragowo: { db: 'kilometr-gtfs-mragowo.db', pack: 'mragowo-tiles.ktp', live: true },
    wagrowiec: { db: 'kilometr-gtfs-wagrowiec.db', pack: 'wagrowiec-tiles.ktp', live: true },
    swiecie: { db: 'kilometr-gtfs-swiecie.db', pack: 'swiecie-tiles.ktp', live: true },
    dzialdowo: { db: 'kilometr-gtfs-dzialdowo.db', pack: 'dzialdowo-tiles.ktp', live: true },
    bielskpodlaski: { db: 'kilometr-gtfs-bielskpodlaski.db', pack: 'bielskpodlaski-tiles.ktp', live: true },
    gostyn: { db: 'kilometr-gtfs-gostyn.db', pack: 'gostyn-tiles.ktp', live: true },
    brzesko: { db: 'kilometr-gtfs-brzesko.db', pack: 'brzesko-tiles.ktp', live: true },
    lidzbarkwarminski: { db: 'kilometr-gtfs-lidzbarkwarminski.db', pack: 'lidzbarkwarminski-tiles.ktp', live: true },
    chodziez: { db: 'kilometr-gtfs-chodziez.db', pack: 'chodziez-tiles.ktp', live: true },
    pszczyna: { db: 'kilometr-gtfs-pszczyna.db', pack: 'pszczyna-tiles.ktp', live: true },
    wodzislaw: { db: 'kilometr-gtfs-wodzislaw.db', pack: 'wodzislaw-tiles.ktp', live: true },
    zabkowice: { db: 'kilometr-gtfs-zabkowice.db', pack: 'zabkowice-tiles.ktp', live: false },
    strzelin: { db: 'kilometr-gtfs-strzelin.db', pack: 'strzelin-tiles.ktp', live: true },
    srodaslaska: { db: 'kilometr-gtfs-srodaslaska.db', pack: 'srodaslaska-tiles.ktp', live: true },
    jedrzejow: { db: 'kilometr-gtfs-jedrzejow.db', pack: 'jedrzejow-tiles.ktp', live: false },
    kozienice: { db: 'kilometr-gtfs-kozienice.db', pack: 'kozienice-tiles.ktp', live: true },
    oborniki: { db: 'kilometr-gtfs-oborniki.db', pack: 'oborniki-tiles.ktp', live: true },
    wieliczka: { db: 'kilometr-gtfs-wieliczka.db', pack: 'wieliczka-tiles.ktp', live: true },
    myszkow: { db: 'kilometr-gtfs-myszkow.db', pack: 'myszkow-tiles.ktp', live: true },
    kartuzy: { db: 'kilometr-gtfs-kartuzy.db', pack: 'kartuzy-tiles.ktp', live: true },
    slubice: { db: 'kilometr-gtfs-slubice.db', pack: 'slubice-tiles.ktp', live: true },
  };
  for (const [id, e] of Object.entries(expected)) {
    const c = getCity(id);
    expect(`${id}: osobna baza`, c.dbFile, e.db);
    expect(`${id}: osobny pakiet kafli`, c.tilePack, e.pack);
    expect(`${id}: kafle w z14`, c.tileMaxZoom, 14);
    expect(`${id}: feed live`, c.features.live, e.live);
    expect(`${id}: bez feedu komunikatów`, c.features.news, false);
    expect(`${id}: bez kolei regionalnej`, c.features.regionalRail, false);
    expect(`${id}: bez bezpośredniego bus_position`, c.features.directBusPosition, false);
  }
}

describe("Strefy obsługi i mniejsze miejscowości (GZM i aglomeracje)");
{
  // Mniejsze miejscowości i wsie GZM w suggestCityForCoords (bounding box + promień)
  expect("Toszek w GZM", suggestCityForCoords(50.4556, 18.5175)?.id, "gzm");
  expect("Wielowieś w GZM", suggestCityForCoords(50.51, 18.6144)?.id, "gzm");
  expect("Tworóg w GZM", suggestCityForCoords(50.5333, 18.7167)?.id, "gzm");
  expect("Krupski Młyn w GZM", suggestCityForCoords(50.575, 18.625)?.id, "gzm");
  expect("Siewierz w GZM", suggestCityForCoords(50.47, 19.23)?.id, "gzm");
  expect("Pyrzowice (lotnisko) w GZM", suggestCityForCoords(50.4683, 19.0792)?.id, "gzm");
  expect("Knurów w GZM", suggestCityForCoords(50.2197, 18.6811)?.id, "gzm");
  expect("Psary w GZM", suggestCityForCoords(50.3833, 19.1167)?.id, "gzm");
  expect("Bojszowy w GZM", suggestCityForCoords(50.0667, 19.1)?.id, "gzm");
  expect("Kobiór w GZM", suggestCityForCoords(50.0667, 18.9333)?.id, "gzm");
  expect("Chełm Śląski w GZM", suggestCityForCoords(50.1167, 19.2)?.id, "gzm");
  expect("Pyskowice w GZM", suggestCityForCoords(50.3986, 18.6272)?.id, "gzm");
  expect("Radzionków w GZM", suggestCityForCoords(50.4025, 18.9056)?.id, "gzm");

  // isOutsideServiceArea dla aktywnego GZM
  expect("isOutsideServiceArea Toszek (GZM)", isOutsideCity(getCity("gzm"), 50.4556, 18.5175), false);
  expect("isOutsideServiceArea Tworóg (GZM)", isOutsideCity(getCity("gzm"), 50.5333, 18.7167), false);
  expect("isOutsideServiceArea Siewierz (GZM)", isOutsideCity(getCity("gzm"), 50.47, 19.23), false);
  expect("isOutsideServiceArea Knurów (GZM)", isOutsideCity(getCity("gzm"), 50.2197, 18.6811), false);
  expect("isOutsideServiceArea Bojszowy (GZM)", isOutsideCity(getCity("gzm"), 50.0667, 19.1), false);
  expect("isOutsideServiceArea Bielsko-Biała (poza GZM)", isOutsideCity(getCity("gzm"), 49.8224, 19.0444), true);
  expect("isOutsideServiceArea Strzelce Opolskie (poza GZM)", isOutsideCity(getCity("gzm"), 50.5105, 18.3006), true);
  expect("isOutsideServiceArea Częstochowa (poza GZM)", isOutsideCity(getCity("gzm"), 50.8118, 19.1203), true);

  // resolveSupportedCityId (tekst z reverse geocodingu)
  expect("resolve Knurów", resolveSupportedCityId("Knurów"), "gzm");
  expect("resolve Psary", resolveSupportedCityId("Psary"), "gzm");
  expect("resolve gmina Tworóg", resolveSupportedCityId("gmina Tworóg"), "gzm");
  expect("resolve Pyrzowice", resolveSupportedCityId("Pyrzowice"), "gzm");
  expect("resolve Bojszowy", resolveSupportedCityId("Bojszowy"), "gzm");
  expect("resolve Wejherowo", resolveSupportedCityId("Wejherowo"), "trojmiasto");
  expect("resolve Pruszków", resolveSupportedCityId("Pruszków"), "pruszkow");
  expect("resolve Zgierz", resolveSupportedCityId("Zgierz"), "zgierz");
  expect("resolve Swarzędz", resolveSupportedCityId("Swarzędz"), "poznan");
  expect("resolve Wieliczka", resolveSupportedCityId("Wieliczka"), "wieliczka");
  expect("resolve Długołęka", resolveSupportedCityId("Długołęka"), "wroclaw");
  expect("resolve Bielsko-Biała", resolveSupportedCityId("Bielsko-Biała"), "bielskobiala");
  expect("resolve Grudziądz", resolveSupportedCityId("Grudziądz"), "grudziadz");
  expect("resolve Strzelce Opolskie (nieobsługiwane)", resolveSupportedCityId("Strzelce Opolskie"), undefined);
  expect("resolve null", resolveSupportedCityId(null), undefined);
}

console.log(`\n${'='.repeat(52)}`);
if (failures.length === 0) {
  console.log(`WSZYSTKO OK - ${passed} asercji`);
  process.exit(0);
}
console.log(`${failures.length} NIEUDANYCH z ${passed + failures.length}:`);
for (const f of failures) console.log(`  - ${f}`);
process.exit(1);
