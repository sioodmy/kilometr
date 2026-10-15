/**
 * Sprawdzenie Rzeszowa: rejestr miasta, parser komunikatów ZTM (RSS),
 * wyciąganie treści artykułu (div#blog), tryb linii i podpowiedzi
 * onboardingu.
 *
 * Uruchomienie: `npm run check:rzeszow`
 *
 * Samego pobrania feedu tu nie ma (sieć w teście jednostkowym to niestabilny
 * fundament): chronimy czystą logikę na zamrożonych próbkach z realnych
 * źródeł (tytuły i opisy z ztm.erzeszow.pl/feed z 2026-10-15, struktura
 * podstrony artykułu z tego samego dnia, linie z GTFS ZTM).
 */

import { getCity } from '../src/cities';
import { setActiveCityId } from '../src/services/cityStore';
import { inferTransitMode } from '../src/services/lineIdentity';
import { classifyTransitMode } from '../src/services/routing/network';
import { extractArticleBlocks, parseRzeszowRss, ZTM_RZESZOW_FEED_URL } from '../src/services/mpkNews';
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
  const rze = getCity('rzeszow');
  expect('id', rze.id, 'rzeszow');
  expect('nazwa', rze.name, 'Rzeszów');
  expect('slug live to rzeszow', rze.zbiorkomSlug, 'rzeszow');
  expect('bbox live', rze.zbiorkomBbox, '21.78,49.9,22.26,50.15');
  expect('feed komunikatów', ZTM_RZESZOW_FEED_URL, 'https://ztm.erzeszow.pl/feed/');
  expect('bez kolei regionalnej', rze.features.regionalRail, false);
  expect('bez bezpośredniego bus_position', rze.features.directBusPosition, false);
}

describe('Komunikaty ZTM (RSS)');
{
  // Próbki 1:1 z realnego feeda (tytuły i opisy z 2026-10-15).
  const xml = `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel>
<title>Zarząd Transportu Miejskiego w Rzeszowie</title>
<item>
<title>Prace naprawcze na parkingu podziemnym Rzeszowskiego Centrum Komunikacyjnego</title>
<link>https://ztm.erzeszow.pl/prace-naprawcze-na-parkingu-podziemnym-rzeszowskiego-centrum-komunikacyjnego/</link>
<pubDate>Tue, 13 Oct 2026 11:12:32 +0000</pubDate>
<description><![CDATA[Informujemy, że w październiku i listopadzie 2026 r. na parkingu podziemnym będą prowadzone prace naprawcze. <a href="https://ztm.erzeszow.pl/x">Czytaj dalej Prace naprawcze &#8594;</a>]]></description>
</item>
<item>
<title>Październikowa aktualizacja tras</title>
<link>https://ztm.erzeszow.pl/pazdziernikowa-aktualizacja-tras/</link>
<pubDate>Tue, 29 Sep 2026 06:55:01 +0000</pubDate>
<description><![CDATA[Od 1 października 2026 r. planowane są zmiany: Linia nr 6 Uwzględnienie dodatkowego przystanku. Linia nr 10 Uwzględnienie dodatkowego przystanku.]]></description>
</item>
<item>
<title>27 września – zmiana tras wybranych linii autobusowych</title>
<link>https://ztm.erzeszow.pl/27-wrzesnia-zmiana-tras/</link>
<pubDate>Wed, 23 Sep 2026 07:15:39 +0000</pubDate>
<description><![CDATA[W dniu 27 września autobusy objęte zostaną zmianami tras: 5:30 – 11:00 i 13:30 – 15:00: Linia 2: Baligrodzka – Kilara – Podwisłocze; Linia 19: zmiany.]]></description>
</item>
<item>
<title>Sprzedaż biletów semestralnych studenckich</title>
<link>https://ztm.erzeszow.pl/sprzedaz-biletow-semestralnych-studenckich-3/</link>
<pubDate>Thu, 01 Oct 2026 06:41:42 +0000</pubDate>
<description><![CDATA[Zakup biletu semestralnego: Strefa A w cenie 250,00 zł, Strefa A + B w cenie 310,00 zł. Bilety na okres od 1 października 2026 r.]]></description>
</item>
</channel></rss>`;
  const items = parseRzeszowRss(xml);
  expect('cztery komunikaty', items.length, 4);
  expect('parking bez linii', items[0].lines, []);
  expect('bez ogona „Czytaj dalej”', items[0].description.includes('Czytaj dalej'), false);
  expect('linie z opisu (6 i 10)', items[1].lines, ['6', '10']);
  expect('„1 października” to nie linia', items[1].lines.includes('1'), false);
  expect('tylko linie z opisu (2 i 19)', items[2].lines, ['2', '19']);
  expect('„27 września” to nie linia', items[2].lines.includes('27'), false);
  expect('godziny to nie linie', items[2].lines.includes('30'), false);
  expect('ceny biletów to nie linie', items[3].lines, []);
  expect('link z feedu', items[0].link.startsWith('https://ztm.erzeszow.pl/'), true);
  expect('pubDate sparsowane', items[0].pubDate !== null, true);
}

describe('Numery linii ZTM: nocne, 0A/0B, PT, daty i godziny');
{
  const xml = (title: string, desc = 'info') =>
    `<?xml version="1.0"?><rss version="2.0"><channel><item><title>${title}</title><link>https://ztm.erzeszow.pl/x</link><pubDate>Mon, 12 Oct 2026 06:00:00 +0000</pubDate><description>${desc}</description></item></channel></rss>`;
  expect(
    '0A i 0B z tytułu',
    parseRzeszowRss(xml('Zmiany na liniach 0A i 0B')).map((i) => i.lines),
    [['0A', '0B']],
  );
  expect(
    'nocne N1–N3',
    parseRzeszowRss(xml('Nocne N1, N2 i N3 pojadą objazdem')).map((i) => i.lines),
    [['N1', 'N2', 'N3']],
  );
  expect(
    'PT z tytułu',
    parseRzeszowRss(xml('Linia PT: zmiana przystanku')).map((i) => i.lines),
    [['PT']],
  );
  expect(
    '„7” nie istnieje w GTFS (dziura w numeracji)',
    parseRzeszowRss(xml('Zmiany na liniach 6 i 7')).map((i) => i.lines),
    [['6']],
  );
  expect(
    '„21” nie istnieje w GTFS',
    parseRzeszowRss(xml('Zmiany na liniach 20 i 21')).map((i) => i.lines),
    [['20']],
  );
  expect(
    '„będą” to nie linia (polskie ę łamie \\b)',
    parseRzeszowRss(xml('Utrudnienia', 'Autobusy będą kursować objazdem')).map((i) => i.lines),
    [[]],
  );
  expect(
    '„KOMUNIKAT 201/26” to nie linie',
    parseRzeszowRss(xml('KOMUNIKAT 201/26: zmiana trasy', 'Zmiana trasy linii 32')).map((i) => i.lines),
    [['32']],
  );
  expect(
    '„co 10 minut” to nie linia 10',
    parseRzeszowRss(xml('Zmiany częstotliwości', 'Autobusy będą kursować co 10 minut')).map((i) => i.lines),
    [[]],
  );
  expect(
    '„12,5 mln zł” to nie linia 12',
    parseRzeszowRss(xml('Inwestycje', 'Koszt to 12,5 mln zł')).map((i) => i.lines),
    [[]],
  );
  expect(
    '„22 września” to nie linia',
    parseRzeszowRss(xml('22 września Dzień bez samochodu')).map((i) => i.lines),
    [[]],
  );
  expect(
    '„od 24.10 do 2.11” to nie linie',
    parseRzeszowRss(xml('Zmiany od 24.10 do 2.11 na linii 43')).map((i) => i.lines),
    [['43']],
  );
}

describe('Tryb linii: Rzeszów to same autobusy');
{
  expect('klasyfikacja route_type 3 (N1)', classifyTransitMode(3, 'N1'), 'bus');
  expect('klasyfikacja route_type 3 (0A)', classifyTransitMode(3, '0A'), 'bus');
  expect('1 to autobus (nie tramwaj)', inferTransitMode(undefined, '1', 'rzeszow'), 'bus');
  expect('6 to autobus', inferTransitMode(undefined, '6', 'rzeszow'), 'bus');
  expect('30 to autobus', inferTransitMode(undefined, '30', 'rzeszow'), 'bus');
  expect('0A to autobus', inferTransitMode(undefined, '0A', 'rzeszow'), 'bus');
  expect('N1 to autobus nocny', inferTransitMode(undefined, 'N1', 'rzeszow'), 'bus');
  expect('PT to autobus', inferTransitMode(undefined, 'PT', 'rzeszow'), 'bus');
  expect('reguła niskich numerów działa poza Rzeszowem', inferTransitMode(undefined, '5', 'wroclaw'), 'tram');
}

describe('Podpowiedzi onboardingu per-miasto');
{
  // Regresja: bez gałęzi dla rzeszow hinty spadały na adresy Wrocławia.
  expect('pl dom', pl.onboarding.slotHomeHint('rzeszow'), 'np. 3 Maja 12');
  expect('pl praca', pl.onboarding.slotWorkHint('rzeszow'), 'np. Galeria Rzeszów');
  expect('pl uczelnia', pl.onboarding.slotUniHint('rzeszow'), 'np. PRz');
  for (const [lang, dict] of [['pl', pl], ['en', en], ['de', de], ['uk', uk]] as const) {
    expect(
      `${lang}: rzeszow nie dziedziczy Wrocławia`,
      dict.onboarding.slotHomeHint('rzeszow') !== dict.onboarding.slotHomeHint('wroclaw'),
      true,
    );
  }
}

describe('Treść artykułu ZTM (div#blog)');
{
  // Struktura 1:1 z realnej podstrony (motyw ZTM Rzeszów): nagłówek działu
  // i tytuł w h1, miniaturka, data, przyciski share, treść w akapitach,
  // a pasek boczny (col-sm-3) z innymi wpisami za treścią.
  const html = `<html><body><div class="container main"><div id="blog" class="col-sm-9 blog-main single-post-content">
<h1><span>Aktualności</span></h1>
<div class="entry-thumbnail"><img src="https://ztm.erzeszow.pl/media/uploads/2026/09/x-690x375.jpg" /></div>
<h1 class="entry-title">Październikowa aktualizacja tras</h1>
<div class="entry-date">29 września 2026</div>
<div class="social4i"><div class="social4in"><div class="fb-like"></div></div></div>
<p><span>Od 1 października 2026 r. planowane są zmiany w funkcjonowaniu wybranych linii.</span></p>
<p><span>Linia nr 6: dodatkowy przystanek przy ul. Paderewskiego.</span></p>
</div><div class="col-sm-3"><div class="widget"><h3>Inne aktualności</h3><p>Sprzedaż biletów semestralnych</p></div></div>
</div></body></html>`;
  const blocks = extractArticleBlocks(html, 'https://ztm.erzeszow.pl/pazdziernikowa-aktualizacja-tras/');
  expect('dwa akapity treści', blocks.length, 2);
  expect('bez nagłówka działu', blocks.some((b) => b.text === 'Aktualności'), false);
  expect('bez tytułu wpisu', blocks.some((b) => b.text.startsWith('Październikowa aktualizacja')), false);
  expect('bez daty publikacji', blocks.some((b) => b.text === '29 września 2026'), false);
  expect('bez paska bocznego', blocks.some((b) => b.text.includes('Sprzedaż biletów')), false);
  expect('pierwszy akapit', blocks[0].text.startsWith('Od 1 października'), true);
  expect('drugi akapit', blocks[1].text, 'Linia nr 6: dodatkowy przystanek przy ul. Paderewskiego.');
}

console.log(`\n${'='.repeat(52)}`);
async function checkNumericFallback(): Promise<void> {
  // Numeryczny fallback planera czyta AKTYWNE miasto: pod Wrocławiem niska
  // numeracja to tramwaje, pod Rzeszowem autobusy. Przełączenie miasta
  // ciągnie bazę i powiadomienia (ostrzeżenia w teście), więc je tłumimy;
  // sam wynik klasyfikacji zostaje i chroni przed regresją.
  const origWarn = console.warn;
  console.warn = () => {};
  try {
    await setActiveCityId('rzeszow');
  } finally {
    console.warn = origWarn;
  }
  expect('fallback numeryczny przy Rzeszowie (6 to autobus)', classifyTransitMode(3, '6'), 'bus');
}

void checkNumericFallback().then(() => {
  if (failures.length === 0) {
    console.log(`WSZYSTKO OK: ${passed} asercji`);
    process.exit(0);
  }
  console.log(`${failures.length} NIEUDANYCH z ${passed + failures.length}:`);
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
});
