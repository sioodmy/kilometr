/**
 * Weryfikacja odmiany nazw miast i gramatyki języka polskiego i ukraińskiego.
 *
 * Uruchomienie: `npm run check:polish-inflections`
 *
 * Sprawdza:
 * - Wymianę przyimka „w” na „we” przed „Wrocławiu” i grupami spółgłoskowymi (Issue #319)
 * - Miejscownik (locative) i dopełniacz (genitive) wszystkich 15 obsługiwanych miast
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

describe('Miejscownik, dopełniacz i biernik 15 miast (język polski)');
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
    bydgoszcz: 'Bydgoszczy',
    torun: 'Toruniu',
    elblag: 'Elblągu',
    gorzow: 'Gorzowie Wielkopolskim',
    czestochowa: 'Częstochowie',
    zielonagora: 'Zielonej Górze',
    rybnik: 'Rybniku',
    slupsk: 'Słupsku',
    walbrzych: 'Wałbrzychu',
    kalisz: 'Kaliszu',
    siedlce: 'Siedlcach',
    lomza: 'Łomży',
    krosno: 'Krośnie',
    jaslo: 'Jaśle',
    olkusz: 'Olkuszu',
    chrzanow: 'Chrzanowie',
    bochnia: 'Bochni',
    ilawa: 'Iławie',
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
    bydgoszcz: 'Bydgoszczy',
    torun: 'Torunia',
    elblag: 'Elbląga',
    gorzow: 'Gorzowa Wielkopolskiego',
    czestochowa: 'Częstochowy',
    zielonagora: 'Zielonej Góry',
    rybnik: 'Rybnika',
    slupsk: 'Słupska',
    walbrzych: 'Wałbrzycha',
    kalisz: 'Kalisza',
    siedlce: 'Siedlec',
    lomza: 'Łomży',
    krosno: 'Krosna',
    jaslo: 'Jasła',
    olkusz: 'Olkusza',
    chrzanow: 'Chrzanowa',
    bochnia: 'Bochni',
    ilawa: 'Iławy',
  };

  const expectedAcc: Record<CityId, string> = {
    wroclaw: 'Wrocław',
    krakow: 'Kraków',
    gzm: 'GZM',
    warszawa: 'Warszawę',
    poznan: 'Poznań',
    trojmiasto: 'Trójmiasto',
    lodz: 'Łódź',
    szczecin: 'Szczecin',
    kielce: 'Kielce',
    olsztyn: 'Olsztyn',
    bialystok: 'Białystok',
    opole: 'Opole',
    rzeszow: 'Rzeszów',
    lublin: 'Lublin',
    radom: 'Radom',
    bydgoszcz: 'Bydgoszcz',
    torun: 'Toruń',
    elblag: 'Elbląg',
    gorzow: 'Gorzów Wielkopolski',
    czestochowa: 'Częstochowę',
    zielonagora: 'Zieloną Górę',
    rybnik: 'Rybnik',
    slupsk: 'Słupsk',
    walbrzych: 'Wałbrzych',
    kalisz: 'Kalisz',
    siedlce: 'Siedlce',
    lomza: 'Łomżę',
    krosno: 'Krosno',
    jaslo: 'Jasło',
    olkusz: 'Olkusz',
    chrzanow: 'Chrzanów',
    bochnia: 'Bochnię',
    ilawa: 'Iławę',
  };

  for (const c of CITIES) {
    expect(`locative ${c.id}`, pl.city.loc(c.id), expectedLoc[c.id]);
    expect(`genitive ${c.id}`, pl.city.gen(c.id), expectedGen[c.id]);
    expect(`accusative ${c.id}`, pl.city.acc(c.id), expectedAcc[c.id]);
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
  expect(
    'Bydgoszcz (r. żeński)',
    pl.news.emptyBody('Bydgoszcz'),
    'Bydgoszcz nie opublikowała teraz żadnego utrudnienia. Przeciągnij w dół, żeby sprawdzić ponownie.',
  );
  expect(
    'Częstochowa (r. żeński)',
    pl.news.emptyBody('Częstochowa'),
    'Częstochowa nie opublikowała teraz żadnego utrudnienia. Przeciągnij w dół, żeby sprawdzić ponownie.',
  );
  expect(
    'Siedlce (niemęskoosobowy l. mnoga)',
    pl.news.emptyBody('Siedlce'),
    'Siedlce nie opublikowały teraz żadnego utrudnienia. Przeciągnij w dół, żeby sprawdzić ponownie.',
  );
  expect(
    'Krosno (r. nijaki)',
    pl.news.emptyBody('Krosno'),
    'Krosno nie opublikowało teraz żadnego utrudnienia. Przeciągnij w dół, żeby sprawdzić ponownie.',
  );
  expect(
    'Bydgoszcz po ukraińsku (r. męski)',
    uk.news.emptyBody('Бидгощ'),
    'Бидгощ зараз не опублікував жодних ускладнень. Потягни вниз, щоб перевірити знову.',
  );
  expect(
    'Ченстохова po ukraińsku (r. żeński)',
    uk.news.emptyBody('Ченстохова'),
    'Ченстохова зараз не опублікувала жодних ускладнень. Потягни вниз, щоб перевірити знову.',
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
}

console.log('\n====================================================');
if (failures.length > 0) {
  console.log(`BŁĘDY: ${failures.length} asercji nie przeszło!`);
  for (const f of failures) console.log(` - ${f}`);
  process.exit(1);
}
console.log(`WSZYSTKO OK: ${passed} asercji`);
