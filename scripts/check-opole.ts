/**
 * Sprawdzenie Opola: rejestr miasta, parser komunikatów MZK (RSS kategorii
 * Aktualności), wyciąganie treści komunikatu (WordPress article +
 * div.entry-content), tryb linii i podpowiedzi onboardingu.
 *
 * Uruchomienie: `npm run check:opole`
 *
 * Samego pobrania feedu tu nie ma (sieć w teście jednostkowym to niestabilny
 * fundament) - chronimy czystą logikę na zamrożonych próbkach z realnych
 * źródeł (wpisy z mzkopole.pl/category/aktualnosci/feed/ z 2026-10-15,
 * struktura podstrony aktualności z tego samego dnia, linie i typy
 * z GTFS MZK z cdn.zbiorkom.live/gtfs/opole.zip).
 */

import { getCity } from '../src/cities';
import { inferTransitMode } from '../src/services/lineIdentity';
import { classifyTransitMode } from '../src/services/routing/network';
import { extractArticleBlocks, parseOpoleRss, MZK_OPOLE_FEED_URL } from '../src/services/mpkNews';
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
  const opo = getCity('opole');
  expect('id', opo.id, 'opole');
  expect('nazwa', opo.name, 'Opole');
  expect('slug live to opole', opo.zbiorkomSlug, 'opole');
  expect('bbox live', opo.zbiorkomBbox, '17.7,50.55,18.1,50.8');
  expect(
    'feed komunikatów',
    MZK_OPOLE_FEED_URL,
    'https://www.mzkopole.pl/category/aktualnosci/feed/',
  );
  expect('bez kolei regionalnej', opo.features.regionalRail, false);
  expect('bez bezpośredniego bus_position', opo.features.directBusPosition, false);
}

describe('Komunikaty MZK (RSS)');
{
  // Próbki 1:1 z realnego kanału (wpisy z 2026-10-15, encje jak w feedzie).
  const xml = `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel>
<item>
<title>Wydłużone kursy na mecz Odry Opole</title>
<link>https://www.mzkopole.pl/aktualnosci/wydluzone-kursy-na-mecz-odry-opole/</link>
<pubDate>Fri, 09 Oct 2026 10:01:11 +0000</pubDate>
<description><![CDATA[W związku z niedzielnym (11.10) meczem Odry Opole, Miejski Zakład Komunikacyjny wydłuża warianty linii: 5, 12, 18 i 28. <div class="w-100 text-end"><a class="more-link" href="https://www.mzkopole.pl/aktualnosci/wydluzone-kursy-na-mecz-odry-opole/#more-4459">czytaj dalej <span class="visually-hidden">Wydłużone kursy na mecz Odry Opole</span> »</a></div>]]></description>
</item>
<item>
<title>Zawieszenie kursów linii 30</title>
<link>https://www.mzkopole.pl/aktualnosci/zawieszenie-kursow-linii-30/</link>
<pubDate>Wed, 30 Sep 2026 10:24:19 +0000</pubDate>
<description><![CDATA[Miejski Zakład Komunikacyjny Sp. z o.o. w Opolu informuje, że z dniem 3 października zawieszone zostaną weekendowe kursy linii 30. Linia będzie kursowała od poniedziałku do piątku realizując 13 par kursów.]]></description>
</item>
<item>
<title>Przystanek &#8222;Częstochowska-Tysiąclecia&#8221; przesunięty</title>
<link>https://www.mzkopole.pl/aktualnosci/przystanek-czestochowska-tysiaclecia-przesuniety/</link>
<pubDate>Thu, 15 Oct 2026 12:14:57 +0000</pubDate>
<description><![CDATA[W związku z wymianą nawierzchni jezdni przystanek &#8222;Częstochowska-Tysiąclecia&#8221; zostanie przesunięty o około 80 metrów w kierunku centrum miasta. Wyświetl mniej]]></description>
</item>
<item>
<title>Półmaraton Opolski &#8211; objazdy dla linii MZK</title>
<link>https://www.mzkopole.pl/aktualnosci/polmaraton-opolski-objazdy/</link>
<pubDate>Thu, 24 Sep 2026 11:21:21 +0000</pubDate>
<description><![CDATA[W niedzielę (27.09) od godziny 8:00 do około 14:00 wprowadzona zostanie tymczasowa organizacja ruchu. Zmiany tras linii 7, 17 i N1.]]></description>
</item>
</channel></rss>`;
  const items = parseOpoleRss(xml);
  expect('cztery komunikaty', items.length, 4);
  expect('linie z meczu (5, 12, 18, 28)', items[0].lines, ['5', '12', '18', '28']);
  expect('opis z feedu w karcie', items[0].description.includes('warianty linii'), true);
  // Motyw WordPressa dokleja do opisu link „czytaj dalej … »” i tekst
  // „Wyświetl mniej”; parser musi je wyciąć przed htmlToText.
  expect('bez „czytaj dalej” w opisie', items[0].description.includes('czytaj dalej'), false);
  expect('bez „Wyświetl mniej” w opisie', items[2].description.includes('Wyświetl mniej'), false);
  expect('opis kończy się treścią', items[0].description.endsWith('5, 12, 18 i 28.'), true);
  const d0 = items[0].pubDate ? new Date(items[0].pubDate) : null;
  expect('data z pubDate (dzień)', d0?.getDate(), 9);
  expect('data z pubDate (miesiąc)', d0?.getMonth(), 9);
  // „13 par kursów” to liczba kursów, nie linia 13.
  expect('„13 par kursów” to nie linia', items[1].lines, ['30']);
  // „80 metrów” to odległość, nie linia 80.
  expect('„80 metrów” to nie linia', items[2].lines, []);
  expect('objazdy to pilne', items[3].urgent, true);
  expect('mecz to nie pilne', items[0].urgent, false);
  expect('daty i godziny to nie linie', items[3].lines, ['7', '17', 'N1']);
}

describe('Numery linii MZK: daty, ulice, liczby z tekstu');
{
  const xml = (title: string, desc: string) =>
    `<?xml version="1.0"?><rss version="2.0"><channel><item><title>${title}</title><link>https://www.mzkopole.pl/x</link><description><![CDATA[${desc}]]></description></item></channel></rss>`;
  expect(
    '„11.10” i „27.09” to nie linie',
    parseOpoleRss(
      xml('Mecz Odry', 'Mecz w niedzielę (11.10), kursy linii 5 i 28, powrót (27.09)'),
    ).map((i) => i.lines),
    [['5', '28']],
  );
  expect(
    '„106 przystanków” to nie linia',
    parseOpoleRss(
      xml('Przystanki na życzenie', 'Od 1 października 106 przystanków zyska status na życzenie'),
    ).map((i) => i.lines),
    [[]],
  );
  expect(
    'ulica „1 Maja” to nie linia 1',
    parseOpoleRss(xml('Zmiana postoju', 'Przystanek 1 Maja - Dworzec Główny dla linii 21')).map(
      (i) => i.lines,
    ),
    [['21']],
  );
  expect(
    '„18:56” i „8:00” to nie linie',
    parseOpoleRss(xml('Mecz', 'Odjazd o 18:56, organizacja od 8:00, linie 12 i 18')).map(
      (i) => i.lines,
    ),
    [['12', '18']],
  );
  // Regresja: feed MZK ma literówkę „16;36” (średnik zamiast dwukropka),
  // a gołe „16” wyglądało jak linia 16 w komunikacie o meczu.
  expect(
    '„16;36” (literówka z feedu) to nie linia 16',
    parseOpoleRss(xml('Mecz', 'Odjazd z al. Pużaka o 16;36 oraz 16:58, linia 12')).map(
      (i) => i.lines,
    ),
    [['12']],
  );
  expect(
    'specjalne S1 i S2',
    parseOpoleRss(
      xml('Dzień Otwarty', 'Liniami specjalnymi S1 i S2 dojedziesz na Dzień Otwarty Zajezdni'),
    ).map((i) => i.lines),
    [['S1', 'S2']],
  );
  expect(
    'szkolne SZ1 i SZ10',
    parseOpoleRss(xml('Rozkład szkolny', 'Zmiany na liniach SZ1, SZ10 i 15')).map((i) => i.lines),
    [['SZ1', 'SZ10', '15']],
  );
  expect(
    'nocne N1 i N2',
    parseOpoleRss(xml('Nocne', 'Zmiany na liniach N1, N2 i 80')).map((i) => i.lines),
    [['N1', 'N2', '80']],
  );
  expect(
    '6 nie istnieje w GTFS (jest 5 i 7)',
    parseOpoleRss(xml('Zmiany', 'Zmiany na liniach 5, 6 i 7')).map((i) => i.lines),
    [['5', '7']],
  );
  expect(
    '„co 10 minut” to nie linia 10',
    parseOpoleRss(xml('Częstotliwość', 'Autobusy będą kursować co 10 minut')).map((i) => i.lines),
    [[]],
  );
}

describe('Tryb linii: w Opolu wszystko to autobusy');
{
  // W check-skrypcie nie ma aktywnego miasta, więc fallback numeryczny
  // (1-33 → tramwaj) jest włączony i złapałby "5"; sprawdzamy numer > 33,
  // a wykluczenie Opola z fallbacku pokrywają asercje z jawnym cityId.
  expect('klasyfikacja route_type 3 (MZK)', classifyTransitMode(3, '80'), 'bus');
  expect('klasyfikacja route_type 3 (nocne)', classifyTransitMode(3, 'N1'), 'bus');
  expect('1 to autobus (nie tramwaj)', inferTransitMode(undefined, '1', 'opole'), 'bus');
  expect('5 to autobus (nie tramwaj)', inferTransitMode(undefined, '5', 'opole'), 'bus');
  expect('30 to autobus', inferTransitMode(undefined, '30', 'opole'), 'bus');
  expect('N1 to autobus nocny', inferTransitMode(undefined, 'N1', 'opole'), 'bus');
  expect('SZ1 to autobus szkolny', inferTransitMode(undefined, 'SZ1', 'opole'), 'bus');
  expect('S1 to autobus specjalny', inferTransitMode(undefined, 'S1', 'opole'), 'bus');
  expect(
    'reguła niskich numerów działa poza Opolem',
    inferTransitMode(undefined, '5', 'wroclaw'),
    'tram',
  );
}

describe('Podpowiedzi onboardingu per-miasto');
{
  // Regresja: bez gałęzi dla opole hinty spadały na adresy Wrocławia.
  expect('pl dom', pl.onboarding.slotHomeHint('opole'), 'np. Ozimska 12');
  expect('pl praca', pl.onboarding.slotWorkHint('opole'), 'np. Solaris Center');
  expect('pl uczelnia', pl.onboarding.slotUniHint('opole'), 'np. UO');
  for (const [lang, dict] of [
    ['pl', pl],
    ['en', en],
    ['de', de],
    ['uk', uk],
  ] as const) {
    expect(
      `${lang}: opole nie dziedziczy Wrocławia`,
      dict.onboarding.slotHomeHint('opole') !== dict.onboarding.slotHomeHint('wroclaw'),
      true,
    );
  }
}

describe('Treść komunikatu MZK (WordPress article + entry-content)');
{
  // Struktura 1:1 z realnej podstrony aktualności: article z entry-content
  // (akapity wp-block-paragraph), za nim sidebar z kategoriami.
  const html = `<html><body><div class="content"><article id="post-4442" class="post entry">
<div class="entry-content">
<p class="wp-block-paragraph">Miejski Zakład Komunikacyjny Sp. z o.o. w Opolu informuje, że z dniem 3 października zawieszone zostaną weekendowe kursy linii 30. </p>
<span id="more-4442"></span>
<p class="wp-block-paragraph">Linia będzie kursowała od poniedziałku do piątku realizując 13 par kursów.</p>
</div></article>
<div id="sidebar-container"><section class="widget"><h2 class="wp-block-heading">Kategorie</h2>
<ul><li><a href="https://www.mzkopole.pl/category/aktualnosci/">Aktualności</a></li></ul>
</section></div></div></body></html>`;
  const blocks = extractArticleBlocks(
    html,
    'https://www.mzkopole.pl/aktualnosci/zawieszenie-kursow-linii-30/',
  );
  expect('dwa akapity', blocks.length, 2);
  expect(
    'pierwszy o zawieszeniu',
    blocks[0]?.text.includes('zawieszone zostaną weekendowe kursy linii 30') ?? false,
    true,
  );
  expect('drugi o kursowaniu', blocks[1]?.text.includes('13 par kursów') ?? false, true);
  expect(
    'bez sidebara z kategoriami',
    blocks.some((b) => b.text === 'Kategorie'),
    false,
  );
}

console.log(`\n${'='.repeat(52)}`);
if (failures.length === 0) {
  console.log(`WSZYSTKO OK - ${passed} asercji`);
  process.exit(0);
}
console.log(`${failures.length} NIEUDANYCH z ${passed + failures.length}:`);
for (const f of failures) console.log(`  - ${f}`);
process.exit(1);
