/**
 * Sprawdzenie Radomia: rejestr miasta, parser komunikatów MZDiK (lista
 * HTML), wyciąganie treści komunikatu (section + intro + content), tryb
 * linii i podpowiedzi onboardingu.
 *
 * Uruchomienie: `npm run check:radom`
 *
 * Samego pobrania feedu tu nie ma (sieć w teście jednostkowym to niestabilny
 * fundament), więc chronimy czystą logikę na zamrożonych próbkach z realnych
 * źródeł (karty z mzdik.pl/komunikaty z 2026-10-15, struktura podstrony
 * komunikatu z tego samego dnia, linie z GTFS mkuran.pl/gtfs/radom.zip).
 */

import { getCity } from '../src/cities';
import { setActiveCityId, getActiveCityIdSync } from '../src/services/cityStore';
import { inferTransitMode } from '../src/services/lineIdentity';
import { classifyTransitMode } from '../src/services/routing/network';
import { extractArticleBlocks, parseMzdikRadomKomunikaty, MZDIK_RADOM_KOMUNIKATY_URL } from '../src/services/mpkNews';
import { pl } from '../src/i18n/pl';
import { en } from '../src/i18n/en';
import { de } from '../src/i18n/de';
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

async function main(): Promise<void> {
describe('Rejestr miasta');
{
  const rad = getCity('radom');
  expect('id', rad.id, 'radom');
  expect('nazwa', rad.name, 'Radom');
  expect('slug live to radom', rad.zbiorkomSlug, 'radom');
  expect('bbox live', rad.zbiorkomBbox, '21.0,51.28,21.36,51.5');
  expect('feed komunikatów', MZDIK_RADOM_KOMUNIKATY_URL, 'https://mzdik.pl/komunikaty');
  expect('bez kolei regionalnej', rad.features.regionalRail, false);
  expect('bez bezpośredniego bus_position', rad.features.directBusPosition, false);
}

describe('Komunikaty MZDiK (lista)');
{
  // Próbki 1:1 z realnej listy (karty z 2026-10-15, skrócone do znaczników,
  // które czyta parser: article.section__article, h3.article__header z
  // linkiem względnym, div.article__info z leadem).
  const html = `<div class="content"><div class="aktualnosci__articles-container">
<article class="section__article" aria-labelledby="news-title-570">
<header>
<h3 id="news-title-570" class="article__header">
<a href="komunikaty/objazdy-ronda-kisielewskiego-w-nocy-z-14-na-15102026-570" class="clear">
Objazdy Ronda Kisielewskiego w nocy z 14 na 15.10.2026                    </a>
</h3>
<div class="article__img"><picture><img src="/uploads/aktualnosci/x-500-50.png" alt=""></picture></div>
</header>

<div class="article__info">
<p><p>W związku z zaplanowanym remontem nawierzchni Ronda Kisielewskiego, w nocy z <strong>14 na 15 października 2026 roku</strong> (ze środy na czwartek) w godzinach około <strong>23:20-4:20 </strong>zostanie ono całkowicie zamknięte dla ruchu. Zostanie wprowadzony objazd dla autobusów linii nocnej <strong>N3</strong>.</p>\r\n</p>
</div>
<a href="komunikaty/objazdy-ronda-kisielewskiego-w-nocy-z-14-na-15102026-570" class="clear article__read-more-button">Czytaj dalej</a>
</article>
<article class="section__article" aria-labelledby="news-title-565">
<header>
<h3 id="news-title-565" class="article__header">
<a href="komunikaty/przywrocenie-stalego-przystanku-przy-ulicy-25-czerwca-od-dnia-30092026-565" class="clear">
Przywrócenie stałego przystanku przy ulicy 25 Czerwca od dnia 30.09.2026                    </a>
</h3>
</header>

<div class="article__info">
<p><p>MZDiK Radom informuje o przywróceniu stałego przystanku przy ulicy 25 Czerwca.</p>\r\n</p>
</div>
</article>
</div></div>`;
  const items = parseMzdikRadomKomunikaty(html);
  expect('dwa komunikaty', items.length, 2);
  expect('tytuł 1:1 z karty', items[0].title, 'Objazdy Ronda Kisielewskiego w nocy z 14 na 15.10.2026');
  // Link na karcie jest względny: aplikacja potrzebuje absolutnego URL.
  expect(
    'względny link staje się absolutny',
    items[0].link,
    'https://mzdik.pl/komunikaty/objazdy-ronda-kisielewskiego-w-nocy-z-14-na-15102026-570',
  );
  expect('id to link', items[0].id, items[0].link);
  expect('linia N3 z leadu (bez 14 i 15 z daty)', items[0].lines, ['N3']);
  expect('opis z leadu w karcie', items[0].description.includes('Ronda Kisielewskiego'), true);
  const d0 = items[0].pubDate ? new Date(items[0].pubDate) : null;
  expect('data z tytułu (dzień)', d0?.getDate(), 15);
  expect('data z tytułu (miesiąc)', d0?.getMonth(), 9);
  expect('data z tytułu (rok)', d0?.getFullYear(), 2026);
  expect('objazd to pilne', items[0].urgent, true);
  expect('bez obrazka hero (pasek 500x50)', items[0].imageUrl, null);
  expect('ulica „25 Czerwca” to nie linia 25', items[1].lines, []);
  expect('zwykłe przywrócenie to nie pilne', items[1].urgent, false);
}

describe('Numery linii MZDiK: daty, godziny, ułamki, linie spoza siatki');
{
  const card = (title: string, lead: string) =>
    `<article class="section__article" aria-labelledby="news-title-1">` +
    `<h3 id="news-title-1" class="article__header">` +
    `<a href="komunikaty/x-1" class="clear">${title}</a></h3>` +
    `<div class="article__info"><p><p>${lead}</p></p></div></article>`;
  expect(
    '„z 14 na 15.10.2026” to nie linie 14 i 15',
    parseMzdikRadomKomunikaty(
      card('Objazdy Ronda Kisielewskiego w nocy z 14 na 15.10.2026', 'Objazd dla autobusów linii nocnej N3.'),
    ).map((i) => i.lines),
    [['N3']],
  );
  expect(
    '„od dnia 24 i 25.09.2026” to nie linie 24 i 25',
    parseMzdikRadomKomunikaty(
      card('Czasowa zmiana przystanków od dnia 24 i 25.09.2026', 'MZDiK informuje o zmianie lokalizacji przystanków.'),
    ).map((i) => i.lines),
    [[]],
  );
  expect(
    '„godz. 23:20-4:20” to nie linie',
    parseMzdikRadomKomunikaty(
      card('Nocne zamknięcie ronda', 'Zamknięte w godzinach 23:20-4:20 dla ruchu.'),
    ).map((i) => i.lines),
    [[]],
  );
  expect(
    '„od 31.08.2026 i 20 od 1.09.2026” to linie 22 i 20, nie daty',
    parseMzdikRadomKomunikaty(
      card('Przywrócenie kursowania linii 22', 'Przywrócenie kursowania linii 22 od dnia 31.08.2026 i 20 od 1.09.2026.'),
    ).map((i) => i.lines),
    [['22', '20']],
  );
  expect(
    'wyliczenie linii nocnych i dziennych',
    parseMzdikRadomKomunikaty(
      card('Objazd nocny', 'Objazd obowiązuje dla linii 7, 9, 23, N1 i N3.'),
    ).map((i) => i.lines),
    [['7', '9', '23', 'N1', 'N3']],
  );
  // N4 nie istnieje w GTFS Radomia (nocne to N1-N3), tak jak linie od 28 w górę.
  expect(
    'N4 i linia 28 nie istnieją',
    parseMzdikRadomKomunikaty(
      card('Zmiany na liniach', 'Zmiany dla N4 oraz linii 28.'),
    ).map((i) => i.lines),
    [[]],
  );
  expect(
    '„12,5 mln zł” to nie linia 12',
    parseMzdikRadomKomunikaty(
      card('Inwestycje drogowe', 'Koszt przebudowy to 12,5 mln zł, prace potrwają rok.'),
    ).map((i) => i.lines),
    [[]],
  );
  expect(
    '„11 Listopada” to ulica, nie linia 11',
    parseMzdikRadomKomunikaty(
      card('Utrudnienia na trasie', 'Zamknięcie ulicy 11 Listopada w dniu 5.10.2026.'),
    ).map((i) => i.lines),
    [[]],
  );
  // Przystanki MZDiK mają numery z wiodącym zerem ("Wałowa 01"): to nie linie.
  expect(
    '„Wałowa 01” to słupek, nie linia 1',
    parseMzdikRadomKomunikaty(
      card('Organizacja przystanków', 'Wyłączone: Limanowskiego / Wałowa 01 i 02, autobusy linii 7.'),
    ).map((i) => i.lines),
    [['7']],
  );
  expect(
    '„23:03” i „o godzinie 16” bez słowa „linia” nie dają linii',
    parseMzdikRadomKomunikaty(
      card('Odjazdy zjazdowe', 'Odjazdy o 23:03 z pętli Os. Gołębiów II.'),
    ).map((i) => i.lines),
    [[]],
  );
}

describe('Tryb linii: Radom to same autobusy');
{
  // classifyTransitMode bez argumentu miasta czyta aktywne miasto ze store,
  // więc przełączamy je na Radom. swapStores w Node nie doczyta modułów
  // natywnych (notifications), stąd wyciszony console.warn na czas zmiany.
  const realWarn = console.warn;
  console.warn = () => {};
  try {
    await setActiveCityId('radom');
  } finally {
    console.warn = realWarn;
  }
  expect('aktywne miasto przestawione', getActiveCityIdSync(), 'radom');
  expect('klasyfikacja route_type 3, linia 14 (MZDiK)', classifyTransitMode(3, '14'), 'bus');
  expect('linia 5 bez tramwajowego fallbacku', classifyTransitMode(3, '5'), 'bus');
  expect('linia 1 to autobus (nie tramwaj jak we Wrocławiu)', inferTransitMode(undefined, '1', 'radom'), 'bus');
  expect('linia 14 to autobus', inferTransitMode(undefined, '14', 'radom'), 'bus');
  expect('linia nocna N3 to autobus', inferTransitMode(undefined, 'N3', 'radom'), 'bus');
}

describe('Podpowiedzi onboardingu per-miasto');
{
  // Regresja: bez gałęzi dla radom hinty spadały na adresy Wrocławia.
  expect('pl dom', pl.onboarding.slotHomeHint('radom'), 'np. Żeromskiego 12');
  expect('pl praca', pl.onboarding.slotWorkHint('radom'), 'np. Galeria Słoneczna');
  expect('pl uczelnia', pl.onboarding.slotUniHint('radom'), 'np. UTH');
  for (const [lang, dict] of [['pl', pl], ['en', en], ['de', de], ['uk', uk]] as const) {
    expect(
      `${lang}: radom nie dziedziczy Wrocławia`,
      dict.onboarding.slotHomeHint('radom') !== dict.onboarding.slotHomeHint('wroclaw'),
      true,
    );
  }
}

describe('Treść komunikatu MZDiK (section + intro + content)');
{
  // Struktura 1:1 z realnej podstrony komunikatu: okruszki i h1 w header,
  // lead w div.standard-page__intro, akapity w div.content, panel boczny
  // z innymi komunikatami w aside poza section.
  const html = `<html><body><main class="main-content" id="main-content">
<div class="page-content-container page-content-container--aside">
<section aria-labelledby="section-heading">
<header class="page-header-container ">
<div class="page-header">
<div class="page-header__breadcrumb"><nav class="breadcrumb-container"><ul class="breadcrumb-list">
<li class="breadcrumb-list__item breadcrumb-list__item--home"><a href="/">Home</a></li>
<li class="breadcrumb-list__item"><a href="/komunikaty">Komunikaty</a></li>
<li class="breadcrumb-list__item breadcrumb-list__item--current"><span aria-current="page">Objazdy Ronda Kisielewskiego w nocy z 14 na 15.10.2026</span></li>
</ul></nav></div>
<h1 class="page-header__header" id="section-heading"><span class="title">Objazdy Ronda Kisielewskiego w nocy z 14 na 15.10.2026</span></h1>
</div>
</header><div class="standard-page__intro"><p>W związku z zaplanowanym remontem nawierzchni Ronda Kisielewskiego, w nocy z <strong>14 na 15 października 2026 roku</strong> zostanie ono całkowicie zamknięte dla ruchu. Objazd dla autobusów linii nocnej <strong>N3</strong>.</p>\r
</div>                <div class="content"><p><strong>Autobusy linii N3 będą kursowały poniższym objazdem:</strong><br />
- w kierunku pętli Os. Zamłynie:<br />
Kościuszki, Narutowicza, <strong>Podwalna, Wałowa</strong>, Limanowskiego;</p>\r

<p>Powyższy objazd będzie obowiązywał również dla kursów zjazdowych linii <strong>7, 9, 23, N1 i N3</strong>.</p>\r
</div>    </section>
<aside class="page-content__aside"><h2>Zobacz inne komunikaty</h2><ul><li><a href="/komunikaty/zmiany-dla-autobusow-569">Zmiany dla autobusów w rejonie ulicy Fołtyn</a></li></ul></aside>
</div></main></body></html>`;
  const blocks = extractArticleBlocks(html, 'https://mzdik.pl/komunikaty/objazdy-ronda-kisielewskiego-570');
  expect('lead jest pierwszym akapitem', blocks[0]?.text.startsWith('W związku z zaplanowanym remontem') ?? false, true);
  expect('bez tytułu z h1', blocks.some((b) => b.text.startsWith('Objazdy Ronda')), false);
  expect('bez okruszków', blocks.some((b) => b.text === 'Komunikaty'), false);
  expect('akapit o objazdzie zjazdowym jest', blocks.some((b) => b.text.includes('kursów zjazdowych')), true);
  expect(
    'wyliczanka z <br> zostaje w akapicie',
    blocks.some((b) => b.text.includes('- w kierunku pętli Os. Zamłynie:') && b.text.includes('Wałowa')),
    true,
  );
  expect('bez panelu bocznego', blocks.some((b) => b.text.includes('Zobacz inne komunikaty') || b.text.includes('Fołtyn')), false);

  // Gdyby lead zniknął, sam content i tak musi się wyciąć.
  const fallbackHtml = html.replace(/<div class="standard-page__intro">[\s\S]*?<\/div>/, '');
  const fallbackBlocks = extractArticleBlocks(fallbackHtml, 'https://mzdik.pl/komunikaty/objazdy-ronda-kisielewskiego-570');
  expect('fallback: akapit o objazdzie jest', fallbackBlocks.some((b) => b.text.includes('kursów zjazdowych')), true);
  expect('fallback: bez panelu bocznego', fallbackBlocks.some((b) => b.text.includes('Fołtyn')), false);
}

console.log(`\n${'='.repeat(52)}`);
if (failures.length === 0) {
  console.log(`WSZYSTKO OK - ${passed} asercji`);
  process.exit(0);
}
console.log(`${failures.length} NIEUDANYCH z ${passed + failures.length}:`);
for (const f of failures) console.log(`  - ${f}`);
process.exit(1);
}

void main();
