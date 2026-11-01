/**
 * Sprawdzenie linii adresu w wynikach wyszukiwania (GZM, Trójmiasto).
 *
 * Uruchomienie: `npm run check:search`
 *
 * GZM i Trójmiasto to strefy z wieloma miastami naraz. Wiersz podpowiedzi ucina
 * adres do jednej linii, a kafelek zapisanego miejsca pokazuje tylko pierwszy
 * człon adresu, więc bez nazwy miasta na przodzie wyniku nie da się odróżnić
 * „Lipowa” w Bytomiu od „Lipowej” w Katowicach. Poza tymi dwiema strefami
 * adres zostaje bez zmian: wszystkie wyniki są w jednym mieście, a nazwa
 * miasta tylko zaśmiecałaby wiersz.
 *
 * Próbki display_name i addressdetails 1:1 z Nominatim (2026-10-17).
 */

import { isMultiCityArea } from '../src/cities';
import { setActiveCityId } from '../src/services/cityStore';
import { addressCity, cityFirstAddress, toSuggestion } from '../src/services/nominatimDirect';
import { classifyPoi, buildPoiAddress } from '../src/services/poiClassify';
import { fuzzyMatch } from '../src/gtfs/fuzzy';

let passed = 0;
const failures: string[] = [];
let section = '';

function describe(name: string): void {
  section = name;
  console.log(`\n- ${name}`);
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

describe('Strefy z wieloma miastami');
{
  expect('GZM to metropolia', isMultiCityArea('gzm'), true);
  expect('Trójmiasto to metropolia', isMultiCityArea('trojmiasto'), true);
  expect('Wrocław nie', isMultiCityArea('wroclaw'), false);
  expect('Kraków nie', isMultiCityArea('krakow'), false);
}

describe('Miasto z addressdetails');
{
  expect('miasto', addressCity({ city: 'Katowice', state: 'śląskie' }), 'Katowice');
  expect('miasteczko', addressCity({ town: 'Rumia' }), 'Rumia');
  expect('wieś', addressCity({ village: 'Żukowo' }), 'Żukowo');
  expect('gmina', addressCity({ municipality: 'gmina Wejherowo' }), 'gmina Wejherowo');
  expect('bez miasta', addressCity({ suburb: 'Koszutka' }), null);
}

describe('Miasto na przodzie adresu');
{
  expect('bez miasta bez zmian', cityFirstAddress('Koszutka', null, 'GZM'), 'Koszutka');
  expect(
    'miasto przed dzielnicą',
    cityFirstAddress('Koszutka', 'Katowice', 'GZM'),
    'Katowice, Koszutka',
  );
  expect(
    'miasto już na przodzie bez duplikatu',
    cityFirstAddress('Katowice, Koszutka', 'Katowice', 'GZM'),
    'Katowice, Koszutka',
  );
  expect(
    'miasto w środku przenosi się na przód',
    cityFirstAddress('Koszutka, Katowice', 'Katowice', 'GZM'),
    'Katowice, Koszutka',
  );
  expect(
    'wielkość liter i diakrytyki bez duplikatu',
    cityFirstAddress('śródmieście, GDYNIA', 'Gdynia', 'Trójmiasto'),
    'Gdynia, śródmieście',
  );
  expect('nazwa strefy ustępuje miastu', cityFirstAddress('GZM', 'Zabrze', 'GZM'), 'Zabrze');
}

async function main(): Promise<void> {
  describe('GZM: miasto w adresie wyniku');
  await setActiveCityId('gzm');
  {
    // Realny wynik Nominatim: „Korfantego 42, Katowice”.
    const s = toSuggestion({
      place_id: 1,
      display_name:
        '42, Aleja Wojciecha Korfantego, Koszutka, Katowice, Górnośląsko-Zagłębiowska Metropolia, województwo śląskie, 40-125, Polska',
      lat: '50.2649',
      lon: '19.0238',
      class: 'place',
      type: 'house',
      address: {
        road: 'Aleja Wojciecha Korfantego',
        house_number: '42',
        suburb: 'Koszutka',
        city: 'Katowice',
        state: 'województwo śląskie',
      },
    });
    expect('tytuł jak dotąd', s?.title, 'Aleja Wojciecha Korfantego 42');
    expect('miasto przed dzielnicą', s?.address, 'Katowice, Koszutka');
  }
  {
    // Miasto tylko w display_name (addressdetails bez city): nie zgadujemy, zostaje kolejność z display_name.
    const s = toSuggestion({
      place_id: 2,
      display_name: '15, Rynek, Śródmieście, Chorzów, województwo śląskie, Polska',
      lat: '50.2974',
      lon: '18.9545',
      class: 'place',
      type: 'house',
      address: { road: 'Rynek', house_number: '15', suburb: 'Śródmieście' },
    });
    expect(
      'bez city w addressdetails zostaje kolejność z display_name',
      s?.address,
      'Śródmieście, Chorzów',
    );
  }

  describe('Trójmiasto: miasto w adresie wyniku');
  await setActiveCityId('trojmiasto');
  {
    // Realny wynik Nominatim: „Długa 1, Gdańsk”. Bez zmiany wiersz pokazywał
    // „Główne Miasto, Śródmieście” i nie było widać, że to Gdańsk.
    const s = toSuggestion({
      place_id: 3,
      display_name:
        '1, Długa, Główne Miasto, Śródmieście, Gdańsk, województwo pomorskie, 80-827, Polska',
      lat: '54.3520',
      lon: '18.6466',
      class: 'place',
      type: 'house',
      address: {
        road: 'Długa',
        house_number: '1',
        suburb: 'Śródmieście',
        city_district: 'Gdańsk',
        city: 'Gdańsk',
        state: 'województwo pomorskie',
      },
    });
    expect('tytuł jak dotąd', s?.title, 'Długa 1');
    expect('miasto przed dzielnicami', s?.address, 'Gdańsk, Główne Miasto, Śródmieście');
  }


  describe("Klasyfikacja POI i budowanie adresu");
  {
    expect("komercyjny kompleks (Sky Tower)", classifyPoi({ landuse: "commercial" }), {
      category: "place",
      label: "Centrum komercyjne",
    });
    expect("galeria handlowa", classifyPoi({ shop: "mall" }), {
      category: "shop",
      label: "Galeria handlowa",
    });
    expect(
      "adres POI ze street i suburb",
      buildPoiAddress("Centrum komercyjne", {
        "addr:street": "Powstańców Śląskich",
        "addr:housenumber": "95",
        "addr:suburb": "Krzyki",
      }).address,
      "Centrum komercyjne • Krzyki, Powstańców Śląskich 95",
    );
  }

  describe("Fuzzy match POI (spacje i formy łączone)");
  {
    expect("sky tower vs Sky Tower", fuzzyMatch("sky tower", "Sky Tower").matches, true);
    expect("skytower bez spacji vs Sky Tower", fuzzyMatch("skytower", "Sky Tower").matches, true);
    expect(
      "galeriadominikanska vs Galeria Dominikańska",
      fuzzyMatch("galeriadominikanska", "Galeria Dominikańska").matches,
      true,
    );
  }

  describe("Sky Tower z Nominatim jako miejsce / landmark");
  await setActiveCityId("wroclaw");
  {
    const s = toSuggestion({
      place_id: 54510846,
      display_name: "Sky Tower, Powstańców Śląskich, Krzyki, Wrocław, województwo dolnośląskie, Polska",
      lat: "51.0945",
      lon: "17.0195",
      class: "landuse",
      type: "commercial",
      name: "Sky Tower",
      address: {
        commercial: "Sky Tower",
        suburb: "Krzyki",
        city: "Wrocław",
        state: "województwo dolnośląskie",
      },
    });
    expect("tytuł to nazwa obiektu", s?.title, "Sky Tower");
    expect("rodzaj to place", s?.kind, "place");
    expect("kategoria to place", s?.category, "place");
  }

  describe('Poza metropoliami adres bez zmian');
  await setActiveCityId('wroclaw');
  {
    const s = toSuggestion({
      place_id: 4,
      display_name: '1, Różana, Krzyki, Wrocław, województwo dolnośląskie, 50-001, Polska',
      lat: '51.1079',
      lon: '17.0385',
      class: 'place',
      type: 'house',
      address: {
        road: 'Różana',
        house_number: '1',
        suburb: 'Krzyki',
        city: 'Wrocław',
        state: 'województwo dolnośląskie',
      },
    });
    expect('Wrocław: kolejność jak dotąd', s?.address, 'Krzyki, Wrocław');
  }

  console.log(`\n${'='.repeat(52)}`);
  if (failures.length === 0) {
    console.log(`WSZYSTKO OK, ${passed} asercji`);
    process.exit(0);
  }
  console.log(`${failures.length} NIEUDANYCH z ${passed + failures.length}:`);
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}

void main();
