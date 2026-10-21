/**
 * Sprawdzenie Białegostoku: rejestr miasta, parser komunikatów BKM (lista
 * HTML), wyciąganie treści komunikatu (div.component-content-wysiwyg),
 * tryb linii i podpowiedzi onboardingu.
 *
 * Uruchomienie: `npm run check:bialystok`
 *
 * Samego pobrania feedu tu nie ma (sieć w teście jednostkowym to niestabilny
 * fundament) - chronimy czystą logikę na zamrożonych próbkach z realnych
 * źródeł (pozycje z komunikacja.bialystok.pl/pl/informacje/wiadomosci/
 * komunikaty z 2026-10-15, struktura podstrony komunikatu z tego samego
 * dnia, linie z GTFS BKM).
 */

import { getCity } from '../src/cities';
import { inferTransitMode } from '../src/services/lineIdentity';
import { classifyTransitMode } from '../src/services/routing/network';
import { BKM_BIALYSTOK_KOMUNIKATY_URL, extractArticleBlocks, parseBialystokNews } from '../src/services/mpkNews';
import { pl } from '../src/i18n/pl';
import { en } from '../src/i18n/en';
import { de } from '../src/i18n/de';
import { uk } from '../src/i18n/uk';

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

describe('Rejestr miasta');
{
  const bial = getCity('bialystok');
  expect('id', bial.id, 'bialystok');
  expect('nazwa', bial.name, 'Białystok');
  expect('slug live to bialystok', bial.zbiorkomSlug, 'bialystok');
  expect('bbox live', bial.zbiorkomBbox, '22.9,52.9,23.35,53.26');
  expect('feed komunikatów', BKM_BIALYSTOK_KOMUNIKATY_URL, 'https://komunikacja.bialystok.pl/pl/informacje/wiadomosci/komunikaty/');
  expect('bez kolei regionalnej', bial.features.regionalRail, false);
  expect('bez bezpośredniego bus_position', bial.features.directBusPosition, false);
}

describe('Komunikaty BKM (lista)');
{
  // Próbki 1:1 z realnej listy (pozycje z 2026-10-15, skrócone do znaczników,
  // które czyta parser: data, link z tytułem w atrybucie title, pusty lead).
  const html = `<ul class="news__list">
<li class="news__item">
<div class="news__date">14.10.2026 09:53</div>
<h2><a class="news__title" href="/pl/informacje/wiadomosci/komunikaty/15-pazdziernika-br-specjalne-linie-autobusowe-w-zwiazku-z-meczem-z-ararat-armenia-erywan.html" title="15 października br. – specjalne linie autobusowe w związku z meczem z Ararat-Armenia Erywań">15 października br. – specjalne linie autobusowe w związku z meczem z Ararat-Armenia Erywań</a></h2>
<div class="news__lead"></div>
</li>
<li class="news__item">
<div class="news__date">07.10.2026 10:02</div>
<h2><a class="news__title" href="/pl/informacje/wiadomosci/komunikaty/od-11-pazdziernika-br-zmiana-rozkladow-jazdy-autobusow-linii-13-16-33-i-105.html" title="Od 11 października br. – zmiana rozkładów jazdy autobusów linii 13, 16, 33 i 105">Od 11 października br. – zmiana rozkładów jazdy autobusów linii 13, 16, 33 i 105</a></h2>
<div class="news__lead"></div>
</li>
</ul>`;
  const items = parseBialystokNews(html);
  expect('dwa komunikaty', items.length, 2);
  expect('link względny staje się absolutny', items[0].link, 'https://komunikacja.bialystok.pl/pl/informacje/wiadomosci/komunikaty/15-pazdziernika-br-specjalne-linie-autobusowe-w-zwiazku-z-meczem-z-ararat-armenia-erywan.html');
  expect('data z meczu to nie linia 15', items[0].lines, []);
  expect('linie z tytułu (13, 16, 33 i 105)', items[1].lines, ['13', '16', '33', '105']);
  const d1 = items[1].pubDate ? new Date(items[1].pubDate) : null;
  expect('data z news__date (dzień)', d1?.getDate(), 7);
  expect('data z news__date (miesiąc)', d1?.getMonth(), 9);
  expect('data z news__date (rok)', d1?.getFullYear(), 2026);
  expect('zwykła zmiana to nie pilne', items[1].urgent, false);
}

describe('Numery linii BKM: daty, godziny, nazwy własne');
{
  const item = (title: string) =>
    `<ul class="news__list"><li class="news__item">` +
    `<div class="news__date">07.10.2026 10:02</div>` +
    `<h2><a class="news__title" href="/pl/informacje/wiadomosci/komunikaty/x.html" title="${title}">${title}</a></h2>` +
    `<div class="news__lead"></div></li></ul>`;
  expect(
    '„15 października” to nie linia 15',
    parseBialystokNews(item('15 października br. – specjalne linie autobusowe')).map((i) => i.lines),
    [[]],
  );
  expect(
    '„Jagiellonii” to nie linia J',
    parseBialystokNews(item('Specjalne linie autobusowe w dniach meczowych Jagiellonii')).map((i) => i.lines),
    [[]],
  );
  expect(
    '„2026 r.” to nie linia',
    parseBialystokNews(item('Od 1 października 2026 r. – nowa linia komunikacyjna nr 33')).map((i) => i.lines),
    [['33']],
  );
  expect(
    'trzycyfrowe spoza siatki (200, 201, 202) też łapiemy',
    parseBialystokNews(item('Z dniem 01.07.2026 r. linie 200, 201 i 202 zostaną zlikwidowane')).map((i) => i.lines),
    [['200', '201', '202']],
  );
  expect(
    'nocne N1 i N2',
    parseBialystokNews(item('Nocne N1 i N2: korekta rozkładu')).map((i) => i.lines),
    [['N1', 'N2']],
  );
  expect(
    'meczowe J5 i J6',
    parseBialystokNews(item('W dniu meczu linie J5 i J6 dowiozą kibiców')).map((i) => i.lines),
    [['J5', 'J6']],
  );
  expect(
    '„09:53” to nie linia',
    parseBialystokNews(item('Od 09:53 zmiana rozkładu linii 10')).map((i) => i.lines),
    [['10']],
  );
  expect(
    '„14.10.2026” to nie linie',
    parseBialystokNews(item('Rozkład od 14.10.2026, linia 21 bez zmian')).map((i) => i.lines),
    [['21']],
  );
  expect(
    '„12,5 mln zł” to nie linie 12 i 5',
    parseBialystokNews(item('Nowe autobusy za 12,5 mln zł wyjadą na linie 10 i 21')).map((i) => i.lines),
    [['10', '21']],
  );
  expect(
    '„co 10 minut” to nie linia 10',
    parseBialystokNews(item('Autobusy linii 2 będą kursować co 10 minut')).map((i) => i.lines),
    [['2']],
  );
  expect(
    '„S19” to nie linia 19',
    parseBialystokNews(item('Utrudnienia w rejonie drogi S19')).map((i) => i.lines),
    [[]],
  );
  expect(
    '„1000-lecia” to nie linia',
    parseBialystokNews(item('Od 1 listopada zmiany na al. 1000-lecia, objazd linii 8')).map((i) => i.lines),
    [['8']],
  );
  expect(
    'utrudnienia to pilne',
    parseBialystokNews(item('Od 17 czerwca br. – utrudnienia związane z wymianą wiat przystankowych')).map((i) => i.urgent),
    [true],
  );
}

describe('Tryb linii: Białystok to samo autobusy');
{
  // classifyTransitMode czyta aktywne miasto ze store (w teście: Wrocław),
  // więc niskie numery weryfikujemy przez inferTransitMode (czysta funkcja
  // z cityId); gałąź bialystok w numericFallback (network.ts) działa runtime.
  expect('klasyfikacja route_type 3 (BKM)', classifyTransitMode(3, '105'), 'bus');
  expect('klasyfikacja nocnych N (parseInt daje NaN)', classifyTransitMode(3, 'N3'), 'bus');
  expect('21 to autobus, nie tramwaj', inferTransitMode(undefined, '21', 'bialystok'), 'bus');
  expect('5 to autobus, nie tramwaj', inferTransitMode(undefined, '5', 'bialystok'), 'bus');
  expect('12 to autobus, nie tramwaj', inferTransitMode(undefined, '12', 'bialystok'), 'bus');
  expect('100 to autobus', inferTransitMode(undefined, '100', 'bialystok'), 'bus');
  expect('J to autobus', inferTransitMode(undefined, 'J', 'bialystok'), 'bus');
  expect('N3 to autobus', inferTransitMode(undefined, 'N3', 'bialystok'), 'bus');
  expect('reguła niskich numerów działa poza Białymstokiem', inferTransitMode(undefined, '5', 'wroclaw'), 'tram');
}

describe('Podpowiedzi onboardingu per-miasto');
{
  // Regresja: bez gałęzi dla bialystok hinty spadały na adresy Wrocławia.
  expect('pl dom', pl.onboarding.slotHomeHint('bialystok'), 'np. Lipowa 12');
  expect('pl praca', pl.onboarding.slotWorkHint('bialystok'), 'np. Galeria Jurowiecka');
  expect('pl uczelnia', pl.onboarding.slotUniHint('bialystok'), 'np. UwB');
  for (const [lang, dict] of [['pl', pl], ['en', en], ['de', de], ['uk', uk]] as const) {
    expect(
      `${lang}: bialystok nie dziedziczy Wrocławia`,
      dict.onboarding.slotHomeHint('bialystok') !== dict.onboarding.slotHomeHint('wroclaw'),
      true,
    );
  }
}

describe('Treść komunikatu BKM (component-content-wysiwyg)');
{
  // Struktura 1:1 z realnej podstrony komunikatu: tytuł w h1 poza wysiwyg,
  // treść redakcyjna w div.component-item, stopka z danymi urzędu w footer.
  const html = `<html><body><h1>Od 11 października br. – zmiana rozkładów jazdy autobusów linii 13, 16, 33 i 105</h1>
<div class="component-content-wysiwyg item"><div class="component-wrapper"><div class="component-content">
<div class="component-item clearfix"><p>Informujemy, że <strong>od 11 października br.</strong>, zmianie ulegną rozkłady jazdy autobusów linii <strong>13, 16, 33 i 105</strong></p>
<p>Zmiany w rozkładach jazdy są widoczne przed datą ich obowiązywania w sekcji przyszłego rozkładu jazdy.</p></div>
</div></div></div>
<footer id="footer"><h2>Zarząd Białostockiej Komunikacji Miejskiej</h2><p>ul. Składowa 11, 15-399 Białystok</p></footer>
</body></html>`;
  const blocks = extractArticleBlocks(html, 'https://komunikacja.bialystok.pl/pl/informacje/wiadomosci/komunikaty/od-11-pazdziernika-br-zmiana-rozkladow-jazdy-autobusow-linii-13-16-33-i-105.html');
  expect('dwa akapity treści', blocks.length, 2);
  expect('bez tytułu z h1', blocks.some((b) => b.text.startsWith('Od 11 października br. – zmiana rozkładów')), false);
  expect('pierwszy akapit o liniach', blocks[0]?.text.includes('13, 16, 33 i 105') ?? false, true);
  expect(
    'bez spacji przed interpunkcją („br.</strong>,”)',
    /\s+[,.;:!?]/.test(blocks.map((b) => b.text).join(' ')),
    false,
  );
  expect('bez stopki z danymi urzędu', blocks.some((b) => b.text.includes('Składowa 11')), false);
}

console.log(`\n${'='.repeat(52)}`);
if (failures.length === 0) {
  console.log(`WSZYSTKO OK - ${passed} asercji`);
  process.exit(0);
}
console.log(`${failures.length} NIEUDANYCH z ${passed + failures.length}:`);
for (const f of failures) console.log(`  - ${f}`);
process.exit(1);
