/**
 * Sprawdzenie Łodzi: rejestr miasta, parser komunikatów MPK (RSS w ISO-8859-2),
 * wyciąganie treści komunikatu (tabela div#dWrkspc), tryb linii i podpowiedzi
 * onboardingu.
 *
 * Uruchomienie: `npm run check:lodz`
 *
 * Samego pobrania feedu tu nie ma, bo sieć w teście jednostkowym to niestabilny
 * fundament. Chronimy czystą logikę na zamrożonych próbkach z realnych
 * źródeł (wpisy z mpk.lodz.pl/rozklady/rss/rozklady.jsp z 2026-10-15,
 * struktura wholemessage.jsp z tej samej strony, linie i typy z GTFS ZDiT,
 * numery ŁKA z pkp-lka.zip).
 */

import { getCity } from '../src/cities';
import { inferTransitMode } from '../src/services/lineIdentity';
import { classifyTransitMode } from '../src/services/routing/network';
import {
  extractArticleBlocks,
  parseMpkLodzRss,
  MPK_LODZ_ROZKLADY_RSS,
} from '../src/services/mpkNews';
import { resolveActiveServices } from '../src/services/gtfsDatabase';
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

describe('Rejestr miasta');
{
  const lodz = getCity('lodz');
  expect('id', lodz.id, 'lodz');
  expect('nazwa', lodz.name, 'Łódź');
  expect('slug live to lodz', lodz.zbiorkomSlug, 'lodz');
  expect('bbox live', lodz.zbiorkomBbox, '19.05,51.55,19.85,51.97');
  expect(
    'feed komunikatów',
    MPK_LODZ_ROZKLADY_RSS,
    'https://mpk.lodz.pl/rozklady/rss/rozklady.jsp',
  );
  expect('kolej regionalna (ŁKA)', lodz.features.regionalRail, true);
  expect('bez bezpośredniego bus_position', lodz.features.directBusPosition, false);
}

describe('Komunikaty MPK (RSS)');
{
  // Próbki 1:1 z realnego kanału (wpisy z 2026-10-15, już po dekodowaniu
  // ISO-8859-2; dekoder sprawdzamy osobno testem tablicy w buildzie).
  const xml = `<?xml version="1.0" encoding="ISO-8859-2"?><rss version="2.0"><channel>
<title>MPK Łódź - ROZKŁADY</title>
<item>
<title>Planowane zmiany w rozkładach jazdy</title>
<link>http://www.mpk.lodz.pl/rozklady/wholemessage.jsp?articleId=39348</link>
<description><![CDATA[<p>W dniu 16 października 2026r. (piątek), zmiany w kursowaniu linii 75B</p>]]></description>
</item>
<item>
<title>Aktualne zmiany w rozkładach jazdy</title>
<link>http://www.mpk.lodz.pl/rozklady/wholemessage.jsp?articleId=39317</link>
<description><![CDATA[<p>W dniach 12-16 października 2026r., zmiana rozkładów jazdy linii <a href="http://www.mpk.lodz.pl/rozklady/trasa_frame.jsp?lineId=904">10A</a><a href="http://www.mpk.lodz.pl/rozklady/trasa_frame.jsp?lineId=733">10B</a><a href="http://www.mpk.lodz.pl/rozklady/trasa_frame.jsp?lineId=1102">12</a><a href="http://www.mpk.lodz.pl/rozklady/trasa_frame.jsp?lineId=1364">18</a></p>]]></description>
</item>
<item>
<title>Aktualne zmiany w rozkładach jazdy</title>
<link>http://www.mpk.lodz.pl/rozklady/wholemessage.jsp?articleId=39306</link>
<description><![CDATA[<p>Od dnia 11 października 2026 r. (niedziela), zmiana tras linii <a href="http://www.mpk.lodz.pl/rozklady/trasa_frame.jsp?lineId=55">82A</a><a href="http://www.mpk.lodz.pl/rozklady/trasa_frame.jsp?lineId=764">82B</a><a href="http://www.mpk.lodz.pl/rozklady/trasa_frame.jsp?lineId=784">N5A</a><a href="http://www.mpk.lodz.pl/rozklady/trasa_frame.jsp?lineId=785">N5B</a>- jednocześnie zmiana rozkładu jazdy linii <a href="http://www.mpk.lodz.pl/rozklady/trasa_frame.jsp?lineId=1240">72A</a>- zawieszenie kursowania linii: Z2 i Z11</p>]]></description>
</item>
</channel></rss>`;
  const items = parseMpkLodzRss(xml);
  expect('trzy komunikaty', items.length, 3);
  expect(
    'link po https (Android blokuje cleartext)',
    items[0].link,
    'https://mpk.lodz.pl/rozklady/wholemessage.jsp?articleId=39348',
  );
  expect('tytuł z linią 75B', items[0].title, 'Planowane zmiany w rozkładach jazdy: 75B');
  expect('linie z linków', items[1].lines, ['10A', '10B', '12', '18']);
  expect(
    'tytuł z czterema liniami',
    items[1].title,
    'Aktualne zmiany w rozkładach jazdy: 10A, 10B, 12, 18',
  );
  expect('nocne i zwykłe z opisu', items[2].lines, [
    '82A',
    '82B',
    'N5A',
    'N5B',
    '72A',
    'Z2',
    'Z11',
  ]);
  expect('daty to nie linie', items[2].lines.includes('11'), false);
  expect('rok to nie linia', items[0].lines.includes('2026'), false);
  const d0 = items[0].pubDate ? new Date(items[0].pubDate) : null;
  expect('data z opisu (dzień)', d0?.getDate(), 16);
  expect('data z opisu (miesiąc)', d0?.getMonth(), 9);
  expect('data z opisu (rok)', d0?.getFullYear(), 2026);
  expect(
    'zakres dat od pierwszego dnia',
    items[1].pubDate ? new Date(items[1].pubDate).getDate() : null,
    12,
  );
  expect('opis z feedu w karcie', items[0].description.includes('75B'), true);
  expect('zwykła zmiana to nie pilne', items[0].urgent, false);
}

describe('Numery linii MPK: daty, numery komunikatów, litery');
{
  const xml = (desc: string) =>
    `<?xml version="1.0"?><rss version="2.0"><channel><item><title>Aktualne zmiany w rozkładach jazdy</title><link>https://mpk.lodz.pl/x</link><description><![CDATA[<p>${desc}</p>]]></description></item></channel></rss>`;
  expect(
    '„16 października 2026r.” to nie linie',
    parseMpkLodzRss(xml('W dniu 16 października 2026r. zmiany w kursowaniu linii 75B')).map(
      (i) => i.lines,
    ),
    [['75B']],
  );
  expect(
    '„KOMUNIKAT 201/26” to nie linia 201',
    parseMpkLodzRss(xml('KOMUNIKAT 201/26: zmiana trasy linii 96')).map((i) => i.lines),
    [['96']],
  );
  expect(
    'linie zastępcze Z1 i R8',
    parseMpkLodzRss(xml('Zmiana tras linii Z1, Z3 i R8')).map((i) => i.lines),
    [['Z1', 'Z3', 'R8']],
  );
  expect(
    'samochodowe F1 i oP6',
    parseMpkLodzRss(xml('Zmiany na liniach F1, G1 i oP6')).map((i) => i.lines),
    [['F1', 'G1', 'OP6']],
  );
  expect(
    'przyimek "w" to nie linia W',
    parseMpkLodzRss(xml('W dniu 16 października zmiany w kursowaniu linii 75B')).map(
      (i) => i.lines,
    ),
    [['75B']],
  );
  expect(
    'samotne W po "linii" to linia',
    parseMpkLodzRss(xml('Zawieszenie kursowania linii W')).map((i) => i.lines),
    [['W']],
  );
  expect(
    'pusty kanał utrudnień to zero pozycji',
    parseMpkLodzRss(
      `<?xml version="1.0" encoding="ISO-8859-2"?><rss version="2.0"><channel><title>MPK-Łódź - Utrudnienia w ruchu</title><title>Nie znaleziono informacji.</title> </item></channel></rss>`,
    ).length,
    0,
  );
}

describe('Tryb linii: podmiejskie tramwaje, 6. i typy z feedu');
{
  expect('klasyfikacja route_type 0', classifyTransitMode(0, '41'), 'tram');
  expect('klasyfikacja route_type 2 (ŁKA)', classifyTransitMode(2, 'Ł'), 'train');
  expect('klasyfikacja route_type 3 (ZKA)', classifyTransitMode(3, 'ZKA ŁKA'), 'bus');
  expect('41 to tramwaj (Pabianice)', inferTransitMode(undefined, '41', 'lodz'), 'tram');
  expect('43 to tramwaj (Zgierz)', inferTransitMode(undefined, '43', 'lodz'), 'tram');
  expect('P1 to tramwaj', inferTransitMode(undefined, 'P1', 'lodz'), 'tram');
  expect('R8 to tramwaj', inferTransitMode(undefined, 'R8', 'lodz'), 'tram');
  expect('Z1 to tramwaj', inferTransitMode(undefined, 'Z1', 'lodz'), 'tram');
  expect('3 to tramwaj', inferTransitMode(undefined, '3', 'lodz'), 'tram');
  expect('6. z kropką to autobus', inferTransitMode(undefined, '6.', 'lodz'), 'bus');
  expect('96 to autobus', inferTransitMode(undefined, '96', 'lodz'), 'bus');
  expect('N5A to autobus nocny', inferTransitMode(undefined, 'N5A', 'lodz'), 'bus');
  expect('H to autobus', inferTransitMode(undefined, 'H', 'lodz'), 'bus');
  expect('41 poza Łodzią bez zgadywania', inferTransitMode(undefined, '41', 'wroclaw'), 'bus');
}

describe('Podpowiedzi onboardingu per-miasto');
{
  // Regresja: bez gałęzi dla lodz hinty spadały na adresy Wrocławia.
  expect('pl dom', pl.onboarding.slotHomeHint('lodz'), 'np. Piotrkowska 12');
  expect('pl praca', pl.onboarding.slotWorkHint('lodz'), 'np. Manufaktura');
  expect('pl uczelnia', pl.onboarding.slotUniHint('lodz'), 'np. UŁ');
  for (const [lang, dict] of [
    ['pl', pl],
    ['en', en],
    ['de', de],
    ['uk', uk],
  ] as const) {
    expect(
      `${lang}: lodz nie dziedziczy Wrocławia`,
      dict.onboarding.slotHomeHint('lodz') !== dict.onboarding.slotHomeHint('wroclaw'),
      true,
    );
  }
}

describe('Treść komunikatu MPK (tabela div#dWrkspc)');
{
  // Struktura 1:1 z realnej podstrony wholemessage.jsp: nagłówek KOMUNIKAT,
  // tytuł w <th>, treść w <td> z <p> jako separatorami BEZ zamknięć (tak
  // wygląda całe MPK Łódź: potwierdzone na 39348, 39266 i 39306).
  const html = `<html><body>
<div id="dWrkspc"><h1>KOMUNIKAT</h1>
<br>
<table><tr><th>
    W dniu 16 października 2026r. (piątek), zmiany w kursowaniu linii 75B</th></tr>
<tr><td><BR><p></b>KOMUNIKAT  201/26
<p><p>W związku z organizacją meczu Widzew Łódź - Wisła Kraków, <b>w dniu 16 października 2026r.</b> zmiany:
<p>- zawieszone zostanie kursowanie linii 75B.
</td></tr></table>
</div>
</body></html>`;
  const blocks = extractArticleBlocks(
    html,
    'https://mpk.lodz.pl/rozklady/wholemessage.jsp?articleId=39348',
  );
  expect('trzy akapity (nie jeden sklejony)', blocks.length, 3);
  expect('pierwszy bez śmieci z nagłówka', blocks[0].text, 'KOMUNIKAT 201/26');
  expect('drugi akapit', blocks[1].text.startsWith('W związku z organizacją meczu'), true);
  expect('trzeci akapit', blocks[2].text, '- zawieszone zostanie kursowanie linii 75B.');
  expect(
    'bez nagłówka KOMUNIKAT',
    blocks.some((b) => b.text === 'KOMUNIKAT'),
    false,
  );
  expect(
    'bez wiersza tytułu z tabeli',
    blocks.some((b) => b.text.includes('zmiany w kursowaniu linii 75B')),
    false,
  );
}

describe('Kalendarz date-scoped (eksport dzienny ZDiT)');
{
  // Regresja z realnego feedu: piątek aktywował wszystkie 6 serwisów ZDiT
  // (48 874 kursy zamiast 10 494), bo puste flagi tygodniowe wpadały
  // w fallback „wszystko” i obok kursów roboczych szły weekendowe widma.
  const friday = resolveActiveServices([], 63, true, [], [{ service_id: '11529_11', exc: 1 }]);
  expect('piątek: tylko serwisy z datą', [...friday], ['11529_11']);
  const sunday = resolveActiveServices(
    [],
    63,
    true,
    ['11529_14'],
    [{ service_id: '11529_14', exc: 1 }],
  );
  expect('niedziela: bez widm z fallbacku', [...sunday], ['11529_14']);
  const legacy = resolveActiveServices([], 0, true, ['a', 'b'], [{ service_id: 'a', exc: 2 }]);
  expect('pusty kalendarz (stara baza): wszystko minus wyjątek', [...legacy], ['b']);
  const flagged = resolveActiveServices(['w1'], 10, true, ['x'], [{ service_id: 'w2', exc: 1 }]);
  expect('flagi tygodniowe + wyjątki', [...flagged], ['w1', 'w2']);
  const noDate = resolveActiveServices([], 10, false, ['x'], []);
  expect('brak daty przy niepustym kalendarzu: bezpieczny fallback', [...noDate], ['x']);
}

console.log(`\n${'='.repeat(52)}`);
if (failures.length === 0) {
  console.log(`WSZYSTKO OK - ${passed} asercji`);
  process.exit(0);
}
console.log(`${failures.length} NIEUDANYCH z ${passed + failures.length}:`);
for (const f of failures) console.log(`  - ${f}`);
process.exit(1);
