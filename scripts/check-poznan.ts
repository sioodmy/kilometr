/**
 * Sprawdzenie Poznania: rejestr miasta, parser komunikatów ZTM i tryb linii.
 *
 * Uruchomienie: `npm run check:poznan`
 *
 * Samego pobrania feedu tu nie ma (sieć w teście jednostkowym to niestabilny
 * fundament) — chronimy czystą logikę na zamrożonych próbkach z realnych
 * źródeł (tytuły z www.ztm.poznan.pl/feed z 2026-10-15, linie i typy
 * z GTFS ZTM, numery KW z pkp-kw.zip).
 */

import { getCity } from '../src/cities';
import { inferTransitMode } from '../src/services/lineIdentity';
import { classifyTransitMode } from '../src/services/routing/network';
import { parsePoznanRss, ZTM_POZNAN_FEED_URL } from '../src/services/mpkNews';

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
    'podmiejskie 400',
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

describe('Tryb linii: tramwaj 97, T6/T7, typy z feedu');
{
  expect('klasyfikacja route_type 0', classifyTransitMode(0, '5'), 'tram');
  expect('klasyfikacja route_type 2 (KW)', classifyTransitMode(2, 'PKM1'), 'train');
  expect('97 to tramwaj (Naramowice)', inferTransitMode(undefined, '97', 'poznan'), 'tram');
  expect('5 to tramwaj', inferTransitMode(undefined, '5', 'poznan'), 'tram');
  expect('T7 to autobus turystyczny', inferTransitMode(undefined, 'T7', 'poznan'), 'bus');
  expect('145 to autobus', inferTransitMode(undefined, '145', 'poznan'), 'bus');
  expect('97 poza Poznaniem bez zgadywania', inferTransitMode(undefined, '97', 'wroclaw'), 'bus');
}

console.log(`\n${'='.repeat(52)}`);
if (failures.length === 0) {
  console.log(`WSZYSTKO OK — ${passed} asercji`);
  process.exit(0);
}
console.log(`${failures.length} NIEUDANYCH z ${passed + failures.length}:`);
for (const f of failures) console.log(`  - ${f}`);
process.exit(1);
