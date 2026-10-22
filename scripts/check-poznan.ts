/**
 * Sprawdzenie Poznania: rejestr miasta, parser komunikatów ZTM, wyciąganie
 * treści artykułu (motyw inny niż WTP), tryb linii i podpowiedzi onboardingu.
 *
 * Uruchomienie: `npm run check:poznan`
 *
 * Samego pobrania feedu tu nie ma (sieć w teście jednostkowym to niestabilny
 * fundament) - chronimy czystą logikę na zamrożonych próbkach z realnych
 * źródeł (tytuły z www.ztm.poznan.pl/feed z 2026-10-15, struktura artykułu
 * z tej samej strony, linie i typy z GTFS ZTM, numery KW z pkp-kw.zip).
 */

import { getCity } from '../src/cities';
import { inferTransitMode } from '../src/services/lineIdentity';
import { classifyTransitMode } from '../src/services/routing/network';
import { extractArticleBlocks, parsePoznanRss, ZTM_POZNAN_FEED_URL } from '../src/services/mpkNews';
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
  const pozn = getCity('poznan');
  expect('id', pozn.id, 'poznan');
  expect('nazwa', pozn.name, 'Poznań');
  expect('slug live to poznan', pozn.zbiorkomSlug, 'poznan');
  expect('bbox live', pozn.zbiorkomBbox, '16.6,52.15,17.3,52.65');
  expect('feed komunikatów', ZTM_POZNAN_FEED_URL, 'https://www.ztm.poznan.pl/feed/');
  expect('kolej regionalna (KW)', pozn.features.regionalRail, true);
  expect('bez bezpośredniego bus_position', pozn.features.directBusPosition, false);
}

describe('Komunikaty ZTM (RSS)');
{
  // Próbki 1:1 z realnego feeda (tytuły z 2026-10-15), reszta pól minimalna.
  const xml = `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel>
<title>Zarząd Transportu Miejskiego w Poznaniu</title>
<item>
<title>Dworzec autobusowy na Górczynie: plac postojowy zostanie udostępniony 5 października, wcześniej niż planowano</title>
<link>https://www.ztm.poznan.pl/aktualnosci/komunikaty/gorczyn-plac/</link>
<pubDate>Thu, 15 Oct 2026 08:00:27 +0000</pubDate>
<description><![CDATA[<p>Plac postojowy zostanie udostępniony wcześniej niż planowano.</p>]]></description>
</item>
<item>
<title>45-lecie Ikarusów w Poznaniu. Zapraszamy na przejazdy tymi autobusami</title>
<link>https://www.ztm.poznan.pl/aktualnosci/pozostale/ikarusy/</link>
<pubDate>Wed, 14 Oct 2026 08:00:00 +0000</pubDate>
<description><![CDATA[<p>Rocznicowe przejazdy zabytkowymi autobusami.</p>]]></description>
</item>
<item>
<title>Zamknięcie torowiska na Głogowskiej – zmiany w kursowaniu tramwajów 5, 6 i 11</title>
<link>https://www.ztm.poznan.pl/aktualnosci/komunikaty/glogowska/</link>
<pubDate>Tue, 13 Oct 2026 08:00:00 +0000</pubDate>
<description><![CDATA[<p>Tramwaje linii 5, 6 i 11 pojadą objazdem.</p>]]></description>
</item>
</channel></rss>`;
  const items = parsePoznanRss(xml);
  expect('trzy komunikaty', items.length, 3);
  expect('„5 października” to nie linia', items[0].lines, []);
  expect('„45-lecie” to nie linia', items[1].lines, []);
  expect('trzy linie z tytułu', items[2].lines, ['5', '6', '11']);
  expect(
    'link z feedu',
    items[0].link,
    'https://www.ztm.poznan.pl/aktualnosci/komunikaty/gorczyn-plac/',
  );
  expect('pubDate sparsowane', items[0].pubDate !== null, true);
  expect('opis z feedu w karcie', items[0].description.includes('wcześniej'), true);
  expect('zamknięcie torowiska = pilne', items[2].urgent, true);
}

describe('Numery linii ZTM: turystyczne, podmiejskie, daty');
{
  const xml = (title: string) =>
    `<?xml version="1.0"?><rss version="2.0"><channel><item><title>${title}</title><link>https://www.ztm.poznan.pl/x</link><pubDate>Mon, 12 Oct 2026 06:00:00 +0000</pubDate><description>info</description></item></channel></rss>`;
  expect(
    'T7 z tytułu',
    parsePoznanRss(xml('Utrudnienia na linii T7')).map((i) => i.lines),
    [['T7']],
  );
  expect(
    'linie podmiejskie 401/405/412',
    parsePoznanRss(xml('Zmiany na liniach 401, 405 i 412')).map((i) => i.lines),
    [['401', '405', '412']],
  );
  expect(
    'rok to nie linia',
    parsePoznanRss(xml('Podsumowanie roku 2026 w komunikacji')).map((i) => i.lines),
    [[]],
  );
  expect(
    '„od 17 do 25 października” to nie linie',
    parsePoznanRss(xml('Prace od 17 do 25 października na Garbarach')).map((i) => i.lines),
    [[]],
  );
  expect(
    'data kropkowana 16.09',
    parsePoznanRss(xml('Od 16.09 zmiany na linii 162')).map((i) => i.lines),
    [['162']],
  );
  expect(
    '22 września to nie linia',
    parsePoznanRss(xml('22 września Dzień bez Samochodu na liniach ZTM')).map((i) => i.lines),
    [[]],
  );
}

describe('Tryb linii: tramwaje 97/201/203, T6/T7, typy z feedu');
{
  expect('klasyfikacja route_type 0', classifyTransitMode(0, '5'), 'tram');
  expect('klasyfikacja route_type 2 (KW)', classifyTransitMode(2, 'PKM1'), 'train');
  expect('97 to tramwaj (Naramowice)', inferTransitMode(undefined, '97', 'poznan'), 'tram');
  expect('201 to tramwaj', inferTransitMode(undefined, '201', 'poznan'), 'tram');
  expect('203 to tramwaj', inferTransitMode(undefined, '203', 'poznan'), 'tram');
  expect('5 to tramwaj', inferTransitMode(undefined, '5', 'poznan'), 'tram');
  expect('213 (nocny) to autobus', inferTransitMode(undefined, '213', 'poznan'), 'bus');
  expect('T7 to autobus turystyczny', inferTransitMode(undefined, 'T7', 'poznan'), 'bus');
  expect('145 to autobus', inferTransitMode(undefined, '145', 'poznan'), 'bus');
  expect('97 poza Poznaniem bez zgadywania', inferTransitMode(undefined, '97', 'wroclaw'), 'bus');
}

describe('Podpowiedzi onboardingu per-miasto');
{
  // Regresja: bez gałęzi dla poznan hinty spadały na adresy Wrocławia.
  expect('pl dom', pl.onboarding.slotHomeHint('poznan'), 'np. Głogowska 12');
  expect('pl praca', pl.onboarding.slotWorkHint('poznan'), 'np. Stary Browar');
  expect('pl uczelnia', pl.onboarding.slotUniHint('poznan'), 'np. UAM');
  for (const [lang, dict] of [['pl', pl], ['en', en], ['de', de], ['uk', uk]] as const) {
    expect(
      `${lang}: poznan nie dziedziczy Wrocławia`,
      dict.onboarding.slotHomeHint('poznan') !== dict.onboarding.slotHomeHint('wroclaw'),
      true,
    );
  }
}

describe('Treść artykułu ZTM (motyw inny niż WTP)');
{
  // Struktura 1:1 z realnej strony (motyw ZTM Poznań): breadcrumbs i sidebar
  // są w <main>, a treść dopiero w <div class="row content mt-4">.
  const html = `<html><body><main id="main-content">
<section class="section">
  <div class="breadcrumbs"><ol><li><a href="/">Start</a></li><li>Aktualności</li></ol></div>
  <div class="container-xxl"><div class="row">
    <aside><div class="sidebar__content"><ul><li>Według kategorii:</li></ul></div></aside>
    <div class="col-lg-8">
      <h1>Tytuł komunikatu</h1>
      <div class="row content mt-4">
        <div class="content__thumb"><img src="https://www.ztm.poznan.pl/foto.png" /></div>
        <div class="col-12">
          <p><strong>Pierwszy akapit.</strong></p>
          <p>Drugi akapit komunikatu.</p>
        </div>
      </div>
    </div>
  </div></div>
</section>
</main></body></html>`;
  const blocks = extractArticleBlocks(html, 'https://www.ztm.poznan.pl/aktualnosci/komunikaty/test/');
  expect('dwa akapity treści', blocks.length, 2);
  expect('bez breadcrumbów', blocks[0].text, 'Pierwszy akapit.');
  expect('bez sidebara („Według kategorii”)', blocks.some((b) => b.text.includes('Według kategorii')), false);
  expect('drugi akapit', blocks[1].text, 'Drugi akapit komunikatu.');
}

console.log(`\n${'='.repeat(52)}`);
if (failures.length === 0) {
  console.log(`WSZYSTKO OK - ${passed} asercji`);
  process.exit(0);
}
console.log(`${failures.length} NIEUDANYCH z ${passed + failures.length}:`);
for (const f of failures) console.log(`  - ${f}`);
process.exit(1);
