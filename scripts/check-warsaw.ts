/**
 * Sprawdzenie Warszawy: rejestr miasta, parser komunikatów WTP i tryb metra.
 *
 * Uruchomienie: `npm run check:warsaw`
 *
 * Samego pobrania feedu tu nie ma (sieć w teście jednostkowym to niestabilny
 * fundament) — chronimy czystą logikę na zamrożonych próbkach z realnych
 * źródeł (tytuły z www.wtp.waw.pl/feed z 2026-10-14, kolory linii M1/M2
 * z routes.txt feedu WTP, numery KM/WKD z feedów mkuran.pl).
 */

import { getCity } from '../src/cities';
import { getLineColors, inferTransitMode } from '../src/services/lineIdentity';
import { classifyTransitMode } from '../src/services/routing/network';
import { parseWtpRss, WTP_FEED_URL } from '../src/services/mpkNews';

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
  const waw = getCity('warszawa');
  expect('id', waw.id, 'warszawa');
  expect('nazwa', waw.name, 'Warszawa');
  expect('slug live to warsaw', waw.zbiorkomSlug, 'warsaw');
  expect('bbox live', waw.zbiorkomBbox, '20.8,52.0,21.3,52.4');
  expect('feed komunikatów', WTP_FEED_URL, 'https://www.wtp.waw.pl/feed/');
}

describe('Komunikaty WTP (RSS)');
{
  // Próbki 1:1 z realnego feeda (tytuły), reszta pól doklejona minimalnie.
  const xml = `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel>
<title>Warszawski Transport Publiczny</title>
<item>
<title>Remont ulicy A.J. Madalińskiego – objazdy dla 138 od 19 października</title>
<link>https://www.wtp.waw.pl/newsy/2026/10/10/madalinskiego-138/</link>
<pubDate>Fri, 10 Oct 2026 08:00:00 +0000</pubDate>
<description><![CDATA[Od 19 października autobusy linii 138 pojadą objazdem.]]></description>
</item>
<item>
<title>Frezowanie ulicy Gołkowskiej – zmiany w kursowaniu autobusów 108, 130 i 162</title>
<link>https://www.wtp.waw.pl/newsy/2026/10/09/golkowska/</link>
<pubDate>Thu, 09 Oct 2026 08:00:00 +0000</pubDate>
<description><![CDATA[Zmiany w kursowaniu autobusów 108, 130 i 162.]]></description>
</item>
<item>
<title>Nieczynne stacje metra Ulrychów i Bemowo 17-25 października</title>
<link>https://www.wtp.waw.pl/newsy/2026/10/12/metro-laczy-sie-2/</link>
<pubDate>Mon, 12 Oct 2026 06:00:00 +0000</pubDate>
<description><![CDATA[Stacje Ulrychów i Bemowo będą nieczynne. Zamknięcie torowiska.]]></description>
</item>
</channel></rss>`;
  const items = parseWtpRss(xml);
  expect('trzy komunikaty', items.length, 3);
  expect('tytuł bez daty z przodu', items[0].title.startsWith('Remont ulicy'), true);
  expect('linia 138 z tytułu', items[0].lines, ['138']);
  expect('„19 października” to nie linia', items[0].lines.includes('19'), false);
  expect('trzy linie z tytułu', items[1].lines, ['108', '130', '162']);
  expect(
    'link z feedu',
    items[0].link,
    'https://www.wtp.waw.pl/newsy/2026/10/10/madalinskiego-138/',
  );
  expect('pubDate sparsowane', items[0].pubDate !== null, true);
  expect('opis z feedu w karcie', items[0].description.includes('objazdem'), true);
  // „17-25 października” to zakres dat, nie linie 17 i 25.
  expect('zakres dat to nie linie', items[2].lines, []);
  expect('zamknięcie stacji = pilne', items[2].urgent, true);
}

describe('Numery linii WTP: metro, SKA, nocne, lokalne');
{
  const xml = (title: string) =>
    `<?xml version="1.0"?><rss version="2.0"><channel><item><title>${title}</title><link>https://www.wtp.waw.pl/x</link><pubDate>Mon, 12 Oct 2026 06:00:00 +0000</pubDate><description>info</description></item></channel></rss>`;
  expect(
    'M2 z tytułu',
    parseWtpRss(xml('Utrudnienia na linii M2')).map((i) => i.lines),
    [['M2']],
  );
  expect(
    'S1 i S2',
    parseWtpRss(xml('Zmiany na liniach S1, S2')).map((i) => i.lines),
    [['S1', 'S2']],
  );
  expect(
    'N12 nocny',
    parseWtpRss(xml('Nocny N12 objazdem')).map((i) => i.lines),
    [['N12']],
  );
  expect(
    'L-5 lokalny',
    parseWtpRss(xml('L-5 nową trasą')).map((i) => i.lines),
    [['L-5']],
  );
  expect(
    'rok to nie linia',
    parseWtpRss(xml('Podsumowanie roku 2026 w komunikacji')).map((i) => i.lines),
    [[]],
  );
}

describe('Metro M1/M2: tryb i kolory');
{
  expect('klasyfikacja route_type 1', classifyTransitMode(1, 'M1'), 'subway');
  expect('klasyfikacja route_type 2', classifyTransitMode(2, 'S1'), 'train');
  expect('M1 po nazwie (badge newsów)', inferTransitMode(undefined, 'M1', 'warszawa'), 'subway');
  expect('M2 po nazwie', inferTransitMode(undefined, 'm2', 'warszawa'), 'subway');
  expect('S1 to pociąg, nie autobus', inferTransitMode(undefined, 'S1', 'warszawa'), 'train');
  expect('138 to dalej autobus', inferTransitMode(undefined, '138', 'warszawa'), 'bus');
  expect('M1 poza Warszawą bez zgadywania', inferTransitMode(undefined, 'M1', 'wroclaw'), 'bus');
  const m1 = getLineColors('M1', 'subway', 'warszawa');
  expect('M1 niebieskie jak w feedzie', m1.bg, '#0000BB');
  expect('M1 biały tekst (kontrast)', m1.fg, '#FFFFFF');
  expect('M2 czerwone jak w feedzie', getLineColors('M2', 'subway', 'warszawa').bg, '#BB0000');
}

console.log(`\n${'='.repeat(52)}`);
if (failures.length === 0) {
  console.log(`WSZYSTKO OK — ${passed} asercji`);
  process.exit(0);
}
console.log(`${failures.length} NIEUDANYCH z ${passed + failures.length}:`);
for (const f of failures) console.log(`  - ${f}`);
process.exit(1);
