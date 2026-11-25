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
    bielskobiala: "Bielsku-Białej",
    koszalin: "Koszalinie",
    piotrkow: "Piotrkowie Trybunalskim",
    tomaszow: "Tomaszowie Mazowieckim",
    skarzysko: "Skarżysku-Kamiennej",
    oswiecim: "Oświęcimiu",
    swinoujscie: "Świnoujściu",
    zakopane: "Zakopanem",
    plock: "Płocku",
    tarnow: "Tarnowie",
    legnica: "Legnicy",
    jastrzebie: "Jastrzębiu-Zdroju",
    pila: "Pile",
    konin: "Koninie",
    suwalki: "Suwałkach",
    ostrowiec: "Ostrowcu Świętokrzyskim",
    stalowawola: "Stalowej Woli",
    przemysl: "Przemyślu",
    elk: "Ełku",
    leszno: "Lesznie",
    chelm: "Chełmie",
    mielec: "Mielcu",
    tczew: "Tczewie",
    ostroleka: "Ostrołęce",
    starachowice: "Starachowicach",
    kutno: "Kutnie",
    kolobrzeg: "Kołobrzegu",
    radomsko: "Radomsku",
    boleslawiec: "Bolesławcu",
    cieszyn: "Cieszynie",
    zywiec: "Żywcu",
    krasnik: "Kraśniku",
    grodzisk: "Grodzisku Mazowieckim",
    pruszkow: "Pruszkowie",
    sochaczew: "Sochaczewie",
    minskmazowiecki: "Mińsku Mazowieckim",
    otwock: "Otwocku",
    nowydwormaz: "Nowym Dworze Mazowieckim",
    zabki: "Ząbkach",
    pabianice: "Pabianicach",
    zgierz: "Zgierzu",
    grudziadz: "Grudziądzu",
    jaworzno: "Jaworznie",
    stargard: "Stargardzie",
    gniezno: "Gnieźnie",
    zamosc: "Zamościu",
    kedzierzynkozle: "Kędzierzynie-Koźlu",
    belchatow: "Bełchatowie",
    raciborz: "Raciborzu",
    tarnobrzeg: "Tarnobrzegu",
    skierniewice: "Skierniewicach",
    starogard: "Starogardzie Gdańskim",
    zawiercie: "Zawierciu",
    nysa: "Nysie",
    zdunskawola: "Zduńskiej Woli",
    sieradz: "Sieradzu",
    malbork: "Malborku",
    szczecinek: "Szczecinku",
    nowasol: "Nowej Soli",
    olesnica: "Oleśnicy",
    czechowicedziedzice: "Czechowicach-Dziedzicach",
    ostroda: "Ostródzie",
    nowytarg: "Nowym Targu",
    augustow: "Augustowie",
    ketrzyn: "Kętrzynie",
    gorlice: "Gorlicach",
    zgorzelec: "Zgorzelcu",
    jarocin: "Jarocinie",
    polkowice: "Polkowicach",
    zagan: "Żaganiu",
    wrzesnia: "Wrześni",
    walcz: "Wałczu",
    gizycko: "Giżycku",
    krotoszyn: "Krotoszynie",
    koscierzyna: "Kościerzynie",
    sandomierz: "Sandomierzu",
    bartoszyce: "Bartoszycach",
    wielun: "Wieluniu",
    mragowo: "Mrągowie",
    wagrowiec: "Wągrowcu",
    swiecie: "Świeciu",
    dzialdowo: "Działdowie",
    bielskpodlaski: "Bielsku Podlaskim",
    gostyn: "Gostyniu",
    brzesko: "Brzesku",
    lidzbarkwarminski: "Lidzbarku Warmińskim",
    chodziez: "Chodzieży",
    pszczyna: "Pszczynie",
    wodzislaw: "Wodzisławiu Śląskim",
    zabkowice: "Ząbkowicach Śląskich",
    strzelin: "Strzelinie",
    srodaslaska: "Środzie Śląskiej",
    jedrzejow: "Jędrzejowie",
    kozienice: "Kozienicach",
    oborniki: "Obornikach",
    wieliczka: "Wieliczce",
    myszkow: "Myszkowie",
    kartuzy: "Kartuzach",
    slubice: "Słubicach",
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
    bielskobiala: "Bielska-Białej",
    koszalin: "Koszalina",
    piotrkow: "Piotrkowa Trybunalskiego",
    tomaszow: "Tomaszowa Mazowieckiego",
    skarzysko: "Skarżyska-Kamiennej",
    oswiecim: "Oświęcimia",
    swinoujscie: "Świnoujścia",
    zakopane: "Zakopanego",
    plock: "Płocka",
    tarnow: "Tarnowa",
    legnica: "Legnicy",
    jastrzebie: "Jastrzębia-Zdroju",
    pila: "Piły",
    konin: "Konina",
    suwalki: "Suwałk",
    ostrowiec: "Ostrowca Świętokrzyskiego",
    stalowawola: "Stalowej Woli",
    przemysl: "Przemyśla",
    elk: "Ełku",
    leszno: "Leszna",
    chelm: "Chełma",
    mielec: "Mielca",
    tczew: "Tczewa",
    ostroleka: "Ostrołęki",
    starachowice: "Starachowic",
    kutno: "Kutna",
    kolobrzeg: "Kołobrzegu",
    radomsko: "Radomska",
    boleslawiec: "Bolesławca",
    cieszyn: "Cieszyna",
    zywiec: "Żywca",
    krasnik: "Kraśnika",
    grodzisk: "Grodziska Mazowieckiego",
    pruszkow: "Pruszkowa",
    sochaczew: "Sochaczewa",
    minskmazowiecki: "Mińska Mazowieckiego",
    otwock: "Otwocka",
    nowydwormaz: "Nowego Dworu Mazowieckiego",
    zabki: "Ząbek",
    pabianice: "Pabianic",
    zgierz: "Zgierza",
    grudziadz: "Grudziądza",
    jaworzno: "Jaworzna",
    stargard: "Stargardu",
    gniezno: "Gniezna",
    zamosc: "Zamościa",
    kedzierzynkozle: "Kędzierzyna-Koźla",
    belchatow: "Bełchatowa",
    raciborz: "Raciborza",
    tarnobrzeg: "Tarnobrzega",
    skierniewice: "Skierniewic",
    starogard: "Starogardu Gdańskiego",
    zawiercie: "Zawiercia",
    nysa: "Nysy",
    zdunskawola: "Zduńskiej Woli",
    sieradz: "Sieradza",
    malbork: "Malborka",
    szczecinek: "Szczecinka",
    nowasol: "Nowej Soli",
    olesnica: "Oleśnicy",
    czechowicedziedzice: "Czechowic-Dziedzic",
    ostroda: "Ostródy",
    nowytarg: "Nowego Targu",
    augustow: "Augustowa",
    ketrzyn: "Kętrzyna",
    gorlice: "Gorlic",
    zgorzelec: "Zgorzelca",
    jarocin: "Jarocina",
    polkowice: "Polkowic",
    zagan: "Żagania",
    wrzesnia: "Wrześni",
    walcz: "Wałcza",
    gizycko: "Giżycka",
    krotoszyn: "Krotoszyna",
    koscierzyna: "Kościerzyny",
    sandomierz: "Sandomierza",
    bartoszyce: "Bartoszyc",
    wielun: "Wielunia",
    mragowo: "Mrągowa",
    wagrowiec: "Wągrowca",
    swiecie: "Świecia",
    dzialdowo: "Działdowa",
    bielskpodlaski: "Bielska Podlaskiego",
    gostyn: "Gostynia",
    brzesko: "Brzeska",
    lidzbarkwarminski: "Lidzbarka Warmińskiego",
    chodziez: "Chodzieży",
    pszczyna: "Pszczyny",
    wodzislaw: "Wodzisławia Śląskiego",
    zabkowice: "Ząbkowic Śląskich",
    strzelin: "Strzelina",
    srodaslaska: "Środy Śląskiej",
    jedrzejow: "Jędrzejowa",
    kozienice: "Kozienic",
    oborniki: "Obornik",
    wieliczka: "Wieliczki",
    myszkow: "Myszkowa",
    kartuzy: "Kartuz",
    slubice: "Słubic",
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
    bielskobiala: "Bielsko-Białą",
    koszalin: "Koszalin",
    piotrkow: "Piotrków Trybunalski",
    tomaszow: "Tomaszów Mazowiecki",
    skarzysko: "Skarżysko-Kamienną",
    oswiecim: "Oświęcim",
    swinoujscie: "Świnoujście",
    zakopane: "Zakopane",
    plock: "Płock",
    tarnow: "Tarnów",
    legnica: "Legnicę",
    jastrzebie: "Jastrzębie-Zdrój",
    pila: "Piłę",
    konin: "Konin",
    suwalki: "Suwałki",
    ostrowiec: "Ostrowiec Świętokrzyski",
    stalowawola: "Stalową Wolę",
    przemysl: "Przemyśl",
    elk: "Ełk",
    leszno: "Leszno",
    chelm: "Chełm",
    mielec: "Mielec",
    tczew: "Tczew",
    ostroleka: "Ostrołękę",
    starachowice: "Starachowice",
    kutno: "Kutno",
    kolobrzeg: "Kołobrzeg",
    radomsko: "Radomsko",
    boleslawiec: "Bolesławiec",
    cieszyn: "Cieszyn",
    zywiec: "Żywiec",
    krasnik: "Kraśnik",
    grodzisk: "Grodzisk Mazowiecki",
    pruszkow: "Pruszków",
    sochaczew: "Sochaczew",
    minskmazowiecki: "Mińsk Mazowiecki",
    otwock: "Otwock",
    nowydwormaz: "Nowy Dwór Mazowiecki",
    zabki: "Ząbki",
    pabianice: "Pabianice",
    zgierz: "Zgierz",
    grudziadz: "Grudziądz",
    jaworzno: "Jaworzno",
    stargard: "Stargard",
    gniezno: "Gniezno",
    zamosc: "Zamość",
    kedzierzynkozle: "Kędzierzyn-Koźle",
    belchatow: "Bełchatów",
    raciborz: "Racibórz",
    tarnobrzeg: "Tarnobrzeg",
    skierniewice: "Skierniewice",
    starogard: "Starogard Gdański",
    zawiercie: "Zawiercie",
    nysa: "Nysę",
    zdunskawola: "Zduńską Wolę",
    sieradz: "Sieradz",
    malbork: "Malbork",
    szczecinek: "Szczecinek",
    nowasol: "Nową Sól",
    olesnica: "Oleśnicę",
    czechowicedziedzice: "Czechowice-Dziedzice",
    ostroda: "Ostródę",
    nowytarg: "Nowy Targ",
    augustow: "Augustów",
    ketrzyn: "Kętrzyn",
    gorlice: "Gorlice",
    zgorzelec: "Zgorzelec",
    jarocin: "Jarocin",
    polkowice: "Polkowice",
    zagan: "Żagań",
    wrzesnia: "Wrześnię",
    walcz: "Wałcz",
    gizycko: "Giżycko",
    krotoszyn: "Krotoszyn",
    koscierzyna: "Kościerzynę",
    sandomierz: "Sandomierz",
    bartoszyce: "Bartoszyce",
    wielun: "Wieluń",
    mragowo: "Mrągowo",
    wagrowiec: "Wągrowiec",
    swiecie: "Świecie",
    dzialdowo: "Działdowo",
    bielskpodlaski: "Bielsk Podlaski",
    gostyn: "Gostyń",
    brzesko: "Brzesko",
    lidzbarkwarminski: "Lidzbark Warmiński",
    chodziez: "Chodzież",
    pszczyna: "Pszczynę",
    wodzislaw: "Wodzisław Śląski",
    zabkowice: "Ząbkowice Śląskie",
    strzelin: "Strzelin",
    srodaslaska: "Środę Śląską",
    jedrzejow: "Jędrzejów",
    kozienice: "Kozienice",
    oborniki: "Oborniki",
    wieliczka: "Wieliczkę",
    myszkow: "Myszków",
    kartuzy: "Kartuzy",
    slubice: "Słubice",
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
    'Grudziądz (r. męski)',
    pl.news.emptyBody('Grudziądz'),
    'Grudziądz nie opublikował teraz żadnego utrudnienia. Przeciągnij w dół, żeby sprawdzić ponownie.',
  );
  expect(
    'Piła (r. żeński)',
    pl.news.emptyBody('Piła'),
    'Piła nie opublikowała teraz żadnego utrudnienia. Przeciągnij w dół, żeby sprawdzić ponownie.',
  );
  expect(
    'Bielsko-Biała (r. nijaki)',
    pl.news.emptyBody('Bielsko-Biała'),
    'Bielsko-Biała nie opublikowało teraz żadnego utrudnienia. Przeciągnij w dół, żeby sprawdzić ponownie.',
  );
  expect(
    'Suwałki (niemęskoosobowy l. mnoga)',
    pl.news.emptyBody('Suwałki'),
    'Suwałki nie opublikowały teraz żadnego utrudnienia. Przeciągnij w dół, żeby sprawdzić ponownie.',
  );
  expect(
    'Сувалки po ukraińsku (liczba mnoga)',
    uk.news.emptyBody('Сувалки'),
    'Сувалки зараз не опублікували жодних ускладнень. Потягни вниз, щоб перевірити знову.',
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
