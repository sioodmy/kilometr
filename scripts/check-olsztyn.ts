/**
 * Sprawdzenie Olsztyna: rejestr miasta, parser komunikatów ZDZiT (RSS 2.0
 * WordPressa), wyciąganie treści komunikatu (article/entry-content), tryb
 * linii i podpowiedzi onboardingu.
 *
 * Uruchomienie: `npm run check:olsztyn`
 *
 * Samego pobrania feedu tu nie ma (sieć w teście jednostkowym to niestabilny
 * fundament) — chronimy czystą logikę na zamrożonych próbkach z realnych
 * źródeł (itemy z zdzit.olsztyn.eu/feed z 2026-10-15, struktura podstrony
 * artykułu z tego samego dnia, linie i typy z GTFS ZDZiT).
 */

import { getCity } from '../src/cities';
import { inferTransitMode } from '../src/services/lineIdentity';
import { classifyTransitMode } from '../src/services/routing/network';
import { extractArticleBlocks, parseZdzitOlsztynRss, ZDZIT_OLSZTYN_FEED_URL } from '../src/services/mpkNews';
import { pl } from '../src/i18n/pl';
import { en } from '../src/i18n/en';
import { de } from '../src/i18n/de';
import { uk } from '../src/i18n/uk';

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

/** Minimalny item RSS w formacie WordPressa (jak z zdzit.olsztyn.eu/feed). */
function rssItem(title: string, description: string, link = 'https://zdzit.olsztyn.eu/x/', pubDate = 'Wed, 30 Sep 2026 08:31:41 +0000'): string {
  return `<item>
		<title>${title}</title>
		<link>${link}</link>
		<dc:creator><![CDATA[]]></dc:creator>
		<pubDate>${pubDate}</pubDate>
		<category><![CDATA[Bez kategorii]]></category>
		<guid isPermaLink="false">${link}?p=1</guid>
		<description><![CDATA[${description}]]></description>
	</item>`;
}

function rssFeed(...items: string[]): string {
  return `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel>${items.join('\n')}</channel></rss>`;
}

function linesOf(title: string, description: string): string[] {
  return parseZdzitOlsztynRss(rssFeed(rssItem(title, description))).map((i) => i.lines)[0] ?? [];
}

describe('Rejestr miasta');
{
  const olsz = getCity('olsztyn');
  expect('id', olsz.id, 'olsztyn');
  expect('nazwa', olsz.name, 'Olsztyn');
  expect('slug live to olsztyn', olsz.zbiorkomSlug, 'olsztyn');
  expect('bbox live', olsz.zbiorkomBbox, '20.2,53.6,20.75,53.95');
  expect('feed komunikatów', ZDZIT_OLSZTYN_FEED_URL, 'https://zdzit.olsztyn.eu/feed/');
  expect('bez kolei regionalnej', olsz.features.regionalRail, false);
  expect('bez bezpośredniego bus_position', olsz.features.directBusPosition, false);
}

describe('Komunikaty ZDZiT (RSS WordPressa)');
{
  // Próbki z realnego kanału (2026-10-15, skrócone do pól, które czyta
  // parser): komunikat o komunikacji miejskiej, sprzedaż majątku (drogi
  // do odsiania) i zmiany akademickie z numerami linii.
  const feed = rssFeed(
    rssItem(
      'KOMUNIKACJA MIEJSKA W CZASIE BIEGÓW 03-04.10.2026',
      'W związku z „Olsztyn Półmaratonem” oraz „Biegiem Nocnym”: zamknięta zostaje część ulic, a tramwaje linii 1 i 2 oraz autobusy 101 i 103 pojadą objazdami.',
      'https://zdzit.olsztyn.eu/komunikacja-miejska-w-czasie-biegow-03-04-10-2026/',
    ),
    rssItem(
      'INFORMACJA O SPRZEDAŻY MAJĄTKU ZDZIT W OLSZTYNIE',
      'Przedmiotem sprzedaży jest samochód osobowy Volkswagen Transporter. Oferty przyjmujemy do wyczerpania zapasów.',
      'https://zdzit.olsztyn.eu/informacja-o-sprzedazy-majatku-zdzit/',
    ),
    rssItem(
      'STUDENCI WRACAJĄ NA UCZELNIE. ZMIANY W ROZKŁADZIE JAZDY',
      'Wznowione zostanie kursowanie linii nr 303, 305, a linie nr 3, 103 i 130 ponownie będą kursować ze zwiększoną częstotliwością.',
      'https://zdzit.olsztyn.eu/studenci-wracaja-na-uczelnie-zmiany-w-rozkladzie-jazdy/',
      'Mon, 28 Sep 2026 07:21:00 +0000',
    ),
  );
  const items = parseZdzitOlsztynRss(feed);
  expect('dwa komunikaty (sprzedaż majątku odsiana)', items.length, 2);
  expect(
    'tytuł bez zmian (RSS pisze wersalikami)',
    items[0].title,
    'KOMUNIKACJA MIEJSKA W CZASIE BIEGÓW 03-04.10.2026',
  );
  expect('linie z opisu (tramwaje i autobusy)', items[0].lines, ['1', '2', '101', '103']);
  expect('opis z CDATA w karcie', items[0].description.includes('Półmaratonem'), true);
  const d0 = items[0].pubDate ? new Date(items[0].pubDate) : null;
  expect('data z pubDate (dzień)', d0?.getUTCDate(), 30);
  expect('data z pubDate (miesiąc)', d0?.getUTCMonth(), 8);
  expect('data z pubDate (rok)', d0?.getUTCFullYear(), 2026);
  expect('zamknięcie ulic to pilne', items[0].urgent, true);
  expect('linie z drugiego komunikatu', items[1].lines, ['303', '305', '3', '103', '130']);
  // RSS ZDZiT nie ma obrazków w description (feed bez wyróżnionych zdjęć).
  expect('bez obrazka w karcie', items[0].imageUrl, null);
  expect('link komunikatu', items[0].link, 'https://zdzit.olsztyn.eu/komunikacja-miejska-w-czasie-biegow-03-04-10-2026/');
}

describe('Numery linii ZDZiT: daty, godziny, numery przystanków');
{
  expect(
    '„03-04.10.2026” to data, nie tramwaj 03 (regresja)',
    linesOf('KOMUNIKACJA MIEJSKA W CZASIE BIEGÓW 03-04.10.2026', 'Autobusy linii 101 pojadą objazdami.'),
    ['101'],
  );
  expect(
    '„04.10.2026” to data',
    linesOf('Zmiany w komunikacji', 'W dniu 04.10.2026 autobusy wracają na stałe trasy.'),
    [],
  );
  expect(
    '„19 października” to data',
    linesOf('Zmiany w komunikacji', 'Od 19 października tramwaje wracają na trasę.'),
    [],
  );
  expect(
    '„co 5 minut” to nie linia 5',
    linesOf('Zmiany częstotliwości', 'Tramwaje będą kursować co 5 minut.'),
    [],
  );
  expect(
    '„godz. 19:30” to nie linia',
    linesOf('Komunikat wieczorny', 'Zmiany potrwają do godz. 19:30, linia 105 bez zmian.'),
    ['105'],
  );
  expect(
    '„nr 34211” to nie linia',
    linesOf('Organizacja przystanków', 'Wyłączony przystanek Partyzantów (nr 34211), kursuje linia 101.'),
    ['101'],
  );
  expect(
    '„1/4” to nie linia 1',
    linesOf('Remont torowiska', 'Prace objęły 1/4 torowiska na trasie tramwaju 2.'),
    ['2'],
  );
  expect(
    '„12,5 mln zł” to nie linia',
    linesOf('Inwestycje drogowe', 'Koszt to 12,5 mln zł, linia 107 bez zmian.'),
    ['107'],
  );
  expect(
    '„2026 roku” to nie linia',
    linesOf('Zmiany w komunikacji', 'W 2026 roku autobusy linii 126 wracają na stałą trasę.'),
    ['126'],
  );
  expect(
    'nocne N1/N2 normalizują się do N01/N02',
    linesOf('Nocne kursy', 'Autobusy nocne N1 i N2 wracają na trasy.'),
    ['N01', 'N02'],
  );
  expect(
    '„102” nie istnieje w GTFS (linie 101, 103, 105-115...)',
    linesOf('Zmiany w komunikacji', 'Nowy rozkład linii 103, a linia 102 zostaje zawieszona.'),
    ['103'],
  );
  expect(
    '„204” nie istnieje w GTFS (jest 205)',
    linesOf('Zmiany w komunikacji', 'Autobusy linii 205, a dawna 204 znika z rozkładu.'),
    ['205'],
  );
  expect(
    '„304A” z sufiksem to nie linia 304',
    linesOf('Zmiany na liniach', 'Linia 304A nie kursuje w weekendy.'),
    [],
  );
  expect(
    'kolejność bez duplikatów',
    linesOf('Zmiany na liniach', 'Linia 101, potem 101 ponownie i 103.'),
    ['101', '103'],
  );
}

describe('Tryb linii: tramwaje 1-5, reszta to autobusy');
{
  expect('klasyfikacja route_type 0', classifyTransitMode(0, '3'), 'tram');
  expect('klasyfikacja route_type 3 (ZDZiT)', classifyTransitMode(3, '101'), 'bus');
  expect('5 to tramwaj', inferTransitMode(undefined, '5', 'olsztyn'), 'tram');
  expect('101 to autobus', inferTransitMode(undefined, '101', 'olsztyn'), 'bus');
  expect('303 to autobus akademicki', inferTransitMode(undefined, '303', 'olsztyn'), 'bus');
  expect('N01 to autobus nocny', inferTransitMode(undefined, 'N01', 'olsztyn'), 'bus');
  expect('reguła niskich numerów działa też poza Olsztynem', inferTransitMode(undefined, '3', 'wroclaw'), 'tram');
}

describe('Podpowiedzi onboardingu per-miasto');
{
  // Regresja: bez gałęzi dla olsztyn hinty spadały na adresy Wrocławia.
  expect('pl dom', pl.onboarding.slotHomeHint('olsztyn'), 'np. Partyzantów 12');
  expect('pl praca', pl.onboarding.slotWorkHint('olsztyn'), 'np. Galeria Warmińska');
  expect('pl uczelnia', pl.onboarding.slotUniHint('olsztyn'), 'np. UWM');
  for (const [lang, dict] of [['pl', pl], ['en', en], ['de', de], ['uk', uk]] as const) {
    expect(
      `${lang}: olsztyn nie dziedziczy Wrocławia`,
      dict.onboarding.slotHomeHint('olsztyn') !== dict.onboarding.slotHomeHint('wroclaw'),
      true,
    );
  }
  expect('pl nazwa', pl.city.name('olsztyn'), 'Olsztyn');
  expect('pl dopełniacz', pl.city.gen('olsztyn'), 'Olsztyna');
  expect('pl miejscownik', pl.city.loc('olsztyn'), 'Olsztynie');
  expect('pl przewoźnik', pl.city.operatorShort('olsztyn'), 'ZDZiT');
  expect('pl portal', pl.city.portal('olsztyn'), 'zdzit.olsztyn.eu');
  for (const [lang, dict] of [['pl', pl], ['en', en], ['de', de], ['uk', uk]] as const) {
    expect(
      `${lang}: źródła komunikatów`,
      dict.city.feeds('olsztyn') !== dict.city.feeds('wroclaw'),
      true,
    );
  }
}

describe('Treść komunikatu ZDZiT (article/entry-content)');
{
  // Struktura 1:1 z realnej podstrony (motyw WordPressa): nagłówek wpisu
  // w <header> (h1 + entry-meta), treść w div.entry-content z blokiem
  // <style>, tag kategorii w div.category-and-tags, nawigacja wpisu w <nav>.
  const html = `<html><body>
<nav id="primary-site-navigation" class="primary-menu"><a href="/">Menu</a></nav>
<article id="post-6912" class="posts-entry fbox post-6912">
<header class="entry-header">
<h1 class="entry-title">KOMUNIKACJA MIEJSKA W CZASIE BIEGÓW 03-04.10.2026</h1>
<div class="entry-meta"><span class="posted-on"><a href="/x/" rel="bookmark"><time class="entry-date published" datetime="2026-09-30T10:31:41+02:00">2026-09-30</time></a></span></div>
</header>
<div class="entry-content">
<style>.entry-content p { color: #333; } .baner { width: 100vw; }</style>
<h4>W związku z „Olsztyn Półmaratonem” oraz „Biegiem Nocnym” zamknięta zostaje część ulic.</h4>
<p>Linie autobusowe będą kierowane na trasy objazdowe zgodnie z poniższym wykazem.</p>
<h4>3.10.2026 (Sobota)</h4>
<p>101 w kierunku Tracka: … – Bałtycka – Partyzantów – …</p>
<ul><li>103 – objazd przez Pstrowskiego</li><li>105 – objazd przez Sikorskiego</li></ul>
<p>Czasowo wyłączone z obsługi będą: Kortowo, Osiedle Generałów.</p>
<div class="category-and-tags"><a href="https://zdzit.olsztyn.eu/category/bez-kategorii/" rel="category tag">Bez kategorii</a></div>
</div>
<nav class="navigation post-navigation" aria-label="Wpisy"><div class="nav-links"><div class="nav-previous"><a href="/p/">POPRZEDNI WPIS</a></div><div class="nav-next"><a href="/n/">NASTĘPNY WPIS</a></div></div></nav>
</article>
<footer>Stopka serwisu</footer>
</body></html>`;
  const blocks = extractArticleBlocks(html, 'https://zdzit.olsztyn.eu/komunikacja-miejska-w-czasie-biegow-03-04-10-2026/');
  expect('bez tytułu z h1', blocks.some((b) => b.text.startsWith('KOMUNIKACJA MIEJSKA')), false);
  expect('bez tagu kategorii', blocks.some((b) => b.text.includes('Bez kategorii')), false);
  expect('bez nawigacji wpisu', blocks.some((b) => b.text.includes('POPRZEDNI WPIS') || b.text.includes('NASTĘPNY WPIS')), false);
  expect('bez CSS ze style', blocks.some((b) => b.text.includes('font-family') || b.text.includes('color: #333')), false);
  expect('lead jest pierwszym akapitem', blocks[0]?.text.startsWith('W związku z „Olsztyn Półmaratonem”') ?? false, true);
  expect('kind nagłówka', blocks.find((b) => b.text === '3.10.2026 (Sobota)')?.kind, 'h');
  expect('pozycja listy w treści', blocks.some((b) => b.text.includes('103 – objazd przez Pstrowskiego')), true);
  expect('sekcja o wyłączonych przystankach jest', blocks.some((b) => b.text.includes('Kortowo')), true);
  expect('stopka serwisu poza artykułem', blocks.some((b) => b.text.includes('Stopka serwisu')), false);
}

console.log(`\n${'='.repeat(52)}`);
if (failures.length === 0) {
  console.log(`WSZYSTKO OK — ${passed} asercji`);
  process.exit(0);
}
console.log(`${failures.length} NIEUDANYCH z ${passed + failures.length}:`);
for (const f of failures) console.log(`  - ${f}`);
process.exit(1);
