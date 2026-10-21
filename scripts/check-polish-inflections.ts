/**
 * Weryfikacja odmiany nazw miast i gramatyki języka polskiego i ukraińskiego.
 *
 * Uruchomienie: `npm run check:polish-inflections`
 *
 * Sprawdza:
 * - Wymianę przyimka „w” na „we” przed „Wrocławiu” i grupami spółgłoskowymi (Issue #319)
 * - Miejscownik (locative) i dopełniacz (genitive) wszystkich 15 obsługiwanych miast
 * - Kartę nieobsługiwanego miasta (UnsupportedCityCard: locative zamiast mianownika)
 * - Zgodność gramatyczną czasownika w pustym stanie aktualności (Warszawa/Łódź - opublikowała, Kielce - opublikowały)
 * - Wymianę przyimka „в” na „у” w języku ukraińskim przed „Вроцлаві” / „Варшаві”
 */

import { CITIES, type CityId } from '../src/cities';
import { pl } from '../src/i18n/pl';
import { uk } from '../src/i18n/uk';

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

describe('Miejscownik i dopełniacz 15 miast (język polski)');
{
  const expectedLoc: Record<CityId, string> = {
    wroclaw: 'Wrocławiu',
    krakow: 'Krakowie',
    gzm: 'GZM',
    warszawa: 'Warszawie',
    poznan: 'Poznaniu',
    trojmiasto: 'Trójmieście',
    lodz: 'Łodzi',
    szczecin: 'Szczecinie',
    kielce: 'Kielcach',
    olsztyn: 'Olsztynie',
    bialystok: 'Białymstoku',
    opole: 'Opolu',
    rzeszow: 'Rzeszowie',
    lublin: 'Lublinie',
    radom: 'Radomiu',
  };

  const expectedGen: Record<CityId, string> = {
    wroclaw: 'Wrocławia',
    krakow: 'Krakowa',
    gzm: 'GZM',
    warszawa: 'Warszawy',
    poznan: 'Poznania',
    trojmiasto: 'Trójmiasta',
    lodz: 'Łodzi',
    szczecin: 'Szczecina',
    kielce: 'Kielc',
    olsztyn: 'Olsztyna',
    bialystok: 'Białegostoku',
    opole: 'Opola',
    rzeszow: 'Rzeszowa',
    lublin: 'Lublina',
    radom: 'Radomia',
  };

  for (const c of CITIES) {
    expect(`locative ${c.id}`, pl.city.loc(c.id), expectedLoc[c.id]);
    expect(`genitive ${c.id}`, pl.city.gen(c.id), expectedGen[c.id]);
  }
}

describe('Przyimki w/we w języku polskim (w Krakowie vs we Wrocławiu)');
{
  expect(
    'onboarding: we Wrocławiu',
    pl.onboarding.citySuggested(pl.city.loc('wroclaw')),
    'Według GPS jesteś we Wrocławiu.',
  );
  expect(
    'onboarding: w Krakowie',
    pl.onboarding.citySuggested(pl.city.loc('krakow')),
    'Według GPS jesteś w Krakowie.',
  );
  expect(
    'search placeholder: we Wrocławiu',
    pl.search.defaultPlaceholder(pl.city.loc('wroclaw')),
    'Szukaj we Wrocławiu…',
  );
  expect(
    'search placeholder: w Krakowie',
    pl.search.defaultPlaceholder(pl.city.loc('krakow')),
    'Szukaj w Krakowie…',
  );
  expect(
    'search searching: we Wrocławiu',
    pl.search.searching(pl.city.loc('wroclaw')),
    'Szukam we Wrocławiu…',
  );
  expect(
    'search searching: w Krakowie',
    pl.search.searching(pl.city.loc('krakow')),
    'Szukam w Krakowie…',
  );
}

describe('UnsupportedCityCard komunikat o innym mieście (odmiana)');
{
  expect(
    'unsupportedBodyOther: we Wrocławiu',
    pl.home.unsupportedBodyOther(pl.city.loc('wroclaw'), pl.city.name('krakow')),
    'Jesteś we Wrocławiu, a aplikacja jest ustawiona na Kraków. Zmień miasto w Ustawieniach.',
  );
  expect(
    'unsupportedBodyOther: w Krakowie',
    pl.home.unsupportedBodyOther(pl.city.loc('krakow'), pl.city.name('wroclaw')),
    'Jesteś w Krakowie, a aplikacja jest ustawiona na Wrocław. Zmień miasto w Ustawieniach.',
  );
  expect(
    'unsupportedBodyOther: w Warszawie',
    pl.home.unsupportedBodyOther(pl.city.loc('warszawa'), pl.city.name('wroclaw')),
    'Jesteś w Warszawie, a aplikacja jest ustawiona na Wrocław. Zmień miasto w Ustawieniach.',
  );
  expect(
    'unsupportedBodyOther: w GZM',
    pl.home.unsupportedBodyOther(pl.city.loc('gzm'), pl.city.name('wroclaw')),
    'Jesteś w GZM, a aplikacja jest ustawiona na Wrocław. Zmień miasto w Ustawieniach.',
  );
  expect(
    'unsupportedBodyOther: w Trójmieście',
    pl.home.unsupportedBodyOther(pl.city.loc('trojmiasto'), pl.city.name('wroclaw')),
    'Jesteś w Trójmieście, a aplikacja jest ustawiona na Wrocław. Zmień miasto w Ustawieniach.',
  );
}

describe('Zgodność rodzaju gramatycznego w aktualnościach (emptyBody)');
{
  expect(
    'Wrocław (r. męski)',
    pl.news.emptyBody('Wrocław'),
    'Wrocław nie opublikował teraz żadnego utrudnienia. Przeciągnij w dół, żeby sprawdzić ponownie.',
  );
  expect(
    'Kraków (r. męski)',
    pl.news.emptyBody('Kraków'),
    'Kraków nie opublikował teraz żadnego utrudnienia. Przeciągnij w dół, żeby sprawdzić ponownie.',
  );
  expect(
    'Warszawa (r. żeński)',
    pl.news.emptyBody('Warszawa'),
    'Warszawa nie opublikowała teraz żadnego utrudnienia. Przeciągnij w dół, żeby sprawdzić ponownie.',
  );
  expect(
    'Łódź (r. żeński)',
    pl.news.emptyBody('Łódź'),
    'Łódź nie opublikowała teraz żadnego utrudnienia. Przeciągnij w dół, żeby sprawdzić ponownie.',
  );
  expect(
    'Trójmiasto (r. nijaki)',
    pl.news.emptyBody('Trójmiasto'),
    'Trójmiasto nie opublikowało teraz żadnego utrudnienia. Przeciągnij w dół, żeby sprawdzić ponownie.',
  );
  expect(
    'Kielce (niemęskoosobowy l. mnoga)',
    pl.news.emptyBody('Kielce'),
    'Kielce nie opublikowały teraz żadnego utrudnienia. Przeciągnij w dół, żeby sprawdzić ponownie.',
  );
}

describe('Przyimki у/в w języku ukraińskim');
{
  expect(
    'onboarding: у Вроцлаві',
    uk.onboarding.citySuggested(uk.city.loc('wroclaw')),
    'За GPS ти у Вроцлаві.',
  );
  expect(
    'onboarding: в Кракові',
    uk.onboarding.citySuggested(uk.city.loc('krakow')),
    'За GPS ти в Кракові.',
  );
  expect(
    'search placeholder: у Вроцлаві',
    uk.search.defaultPlaceholder(uk.city.loc('wroclaw')),
    'Шукай у Вроцлаві…',
  );
  expect(
    'search placeholder: в Кракові',
    uk.search.defaultPlaceholder(uk.city.loc('krakow')),
    'Шукай в Кракові…',
  );
  expect(
    'search searching: у Вроцлаві',
    uk.search.searching(uk.city.loc('wroclaw')),
    'Шукаю у Вроцлаві…',
  );
  expect(
    'search searching: в Кракові',
    uk.search.searching(uk.city.loc('krakow')),
    'Шукаю в Кракові…',
  );
  expect(
    'unsupportedBodyOther: у Вроцлаві',
    uk.home.unsupportedBodyOther(uk.city.loc('wroclaw'), uk.city.name('krakow')),
    'Ти у Вроцлаві, а застосунок налаштовано на Краків. Зміни місто в налаштуваннях.',
  );
  expect(
    'unsupportedBodyOther: в Кракові',
    uk.home.unsupportedBodyOther(uk.city.loc('krakow'), uk.city.name('wroclaw')),
    'Ти в Кракові, а застосунок налаштовано на Вроцлав. Зміни місто в налаштуваннях.',
  );
}

console.log('\n====================================================');
if (failures.length > 0) {
  console.log(`BŁĘDY: ${failures.length} asercji nie przeszło!`);
  for (const f of failures) console.log(` - ${f}`);
  process.exit(1);
}
console.log(`WSZYSTKO OK: ${passed} asercji`);
