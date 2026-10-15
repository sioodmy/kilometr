/**
 * Sprawdzenie Kielc: rejestr miasta, parser komunikatów ZTM (lista Joomla),
 * wyciąganie treści komunikatu (div.com-content-article__body), tryb linii
 * i podpowiedzi onboardingu.
 *
 * Uruchomienie: `npm run check:kielce`
 *
 * Samego pobrania feedu tu nie ma (sieć w teście jednostkowym to niestabilny
 * fundament) — chronimy czystą logikę na zamrożonych próbkach z realnych
 * źródeł (karty z ztm.kielce.pl/aktualnosci.html z 2026-10-14, struktura
 * podstrony /aktualnosci/2766-czasowa-zmiana-trasy-autobusow-linii-19-i-53
 * z 2026-10-06, linie i typy z GTFS ZTM).
 */

import { getCity } from '../src/cities';
import { setActiveCityId } from '../src/services/cityStore';
import { inferTransitMode } from '../src/services/lineIdentity';
import { classifyTransitMode } from '../src/services/routing/network';
import { extractArticleBlocks, parseKielceNews, ZTM_KIELCE_NEWS_URL } from '../src/services/mpkNews';
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

const ZTM_KIELCE_URL = 'https://ztm.kielce.pl';

void (async () => {
  describe('Rejestr miasta');
{
  const kiel = getCity('kielce');
  expect('id', kiel.id, 'kielce');
  expect('nazwa', kiel.name, 'Kielce');
  expect('slug live to kielce', kiel.zbiorkomSlug, 'kielce');
  expect('bbox live', kiel.zbiorkomBbox, '20.3,50.65,20.95,51.02');
  expect('feed komunikatów', ZTM_KIELCE_NEWS_URL, 'https://ztm.kielce.pl/aktualnosci.html');
  expect('bez kolei regionalnej', kiel.features.regionalRail, false);
  expect('bez bezpośredniego bus_position', kiel.features.directBusPosition, false);
}

describe('Komunikaty ZTM (lista)');
{
  // Próbki 1:1 z realnej listy (2026-10-14, skrócone do znaczników, które
  // czyta parser: link /aktualnosci/*.html, tytuł w h2, time[datetime],
  // lead w p za metadanymi, obrazek z images/).
  const card = (
    href: string,
    title: string,
    datetime: string,
    lead: string,
    image = '',
  ) =>
    `<div class="com-content-category-blog__item blog-item" itemprop="blogPost" itemscope itemtype="https://schema.org/BlogPosting">
<div class="item-content">
<div class="page-header"><h2><a href="${href}">${title}</a></h2></div>
${image ? `<figure class="left item-image"><img src="${image}" width="500" height="500" loading="lazy"></figure>` : ''}
<dl class="article-info text-muted"><dt class="article-info-term">Szczegóły</dt>
<dd class="published"><span class="icon-calendar icon-fw" aria-hidden="true"></span>
<time datetime="${datetime}">Opublikowano: 14 październik 2026</time></dd></dl>
<p>${lead}</p>
</div></div>`;

  // Realna karta 2775 (14 października): linie z leadu, godzina i rok nie
  // udają linii, hero z images/ dostaje absolutny URL.
  const html = card(
    '/aktualnosci/2775-informacja-200.html',
    '                        Informacja                    ',
    '2026-10-14T13:40:58+02:00',
    'Informujemy, że w związku z zakończeniem prac przy sieci wodociągowej, autobusy linii <strong>1, 28 i 31 </strong>od <strong>godziny 12:00 w środę 14 października 2026 r.</strong> ponownie wykonują skręt z ulicy Krakowskiej w ulicę Jagiellońską (przestaje obowiązywać trasa objazdowa przez ulice: Podklasztorną i Kołłątaja)',
    '/images/autobusy%20nowe%20ikony/Informacja.jpg',
  ) + card(
    '/aktualnosci/2773-targi-transportu-zbiorowego-linia-e-do-expo-kielce.html',
    '                        Targi Transportu Zbiorowego – linia „E” do Expo Kielce                    ',
    '2026-10-12T12:17:52+02:00',
    'Informujemy, że w związku z odbywającymi się w Kielcach XVIII Międzynarodowymi Targami Transportu Zbiorowego <strong>TRANSEXPO</strong>, w dniach od 14 do 16 października 2026 roku kursować będą autobusy specjalnej linii „<strong>E</strong>” do Expo Kielce (dawniej Targi Kielce).',
    '/images/EXPO%2014-16.10.26.jpg',
  );
  const items = parseKielceNews(html);
  expect('dwa komunikaty', items.length, 2);
  expect('tytuł przycięty', items[0].title, 'Informacja');
  expect('linie z leadu (1, 28 i 31)', items[0].lines, ['1', '28', '31']);
  expect('opis z leadu w karcie', items[0].description.includes('sieci wodociągowej'), true);
  const d0 = items[0].pubDate ? new Date(items[0].pubDate) : null;
  expect('data z time[datetime] (dzień)', d0?.getDate(), 14);
  expect('data z time[datetime] (miesiąc)', d0?.getMonth(), 9);
  expect('data z time[datetime] (rok)', d0?.getFullYear(), 2026);
  // „objazdowa” łapie URGENT_RE (objazd) — zgodnie z realnym zachowaniem.
  expect('koniec objazdu jest oznaczony jako pilny', items[0].urgent, true);
  expect('link jako absolutny URL', items[0].link, `${ZTM_KIELCE_URL}/aktualnosci/2775-informacja-200.html`);
  expect(
    'względny obrazek staje się absolutny',
    items[0].imageUrl,
    `${ZTM_KIELCE_URL}/images/autobusy%20nowe%20ikony/Informacja.jpg`,
  );
  // Linia literowa w cudzysłowie w tytule: „E” nie może zniknąć.
  expect('linia „E” z cudzysłowu', items[1].lines, ['E']);
  expect('zmiana rozkładowa to nie pilne', items[1].urgent, false);

  // Regresja: realna lista opakowuje karty w kontener __items (Joomla).
  const container =
    `<div class="com-content-category-blog__items blog-items ">` +
    card('/aktualnosci/2775-informacja-200.html', 'Informacja', '2026-10-14T13:40:58+02:00', 'Autobusy linii 8 wracają na trasę') +
    card('/aktualnosci/2776-test.html', 'Test', '2026-10-13T10:00:00+02:00', 'Autobusy linii 16 wracają na trasę') +
    `</div>`;
  expect('kontener __items nie gubi kart', parseKielceNews(container).length, 2);

  // Gdyby ZTM podlinkował grafikę karty przed tytułem, sam obrazek
  // (link bez tekstu) nie może przejąć tytułu i wykluczyć komunikatu.
  const imgLinkCard =
    `<div class="com-content-category-blog__item blog-item">` +
    `<div class="item-image"><a href="/aktualnosci/2775-informacja-200.html"><img src="/images/a.jpg" alt=""></a></div>` +
    `<div class="page-header"><h2><a href="/aktualnosci/2775-informacja-200.html">Informacja</a></h2></div>` +
    `<dl class="article-info"><dd class="published"><time datetime="2026-10-14T13:40:58+02:00">14 październik 2026</time></dd></dl>` +
    `<p>Autobusy linii 8 wracają na trasę</p></div>`;
  const imgLinkItems = parseKielceNews(imgLinkCard);
  expect('link obrazka nie zjada tytułu', imgLinkItems[0]?.title ?? '', 'Informacja');
  expect('linie z leadu mimo linku obrazka', imgLinkItems[0]?.lines ?? [], ['8']);
}

describe('Numery linii ZTM: daty, godziny, numery przystanków');
{
  const card = (title: string, lead: string) =>
    `<div class="com-content-category-blog__item blog-item"><div class="page-header"><h2>` +
    `<a href="/aktualnosci/9999-test.html">${title}</a></h2></div>` +
    `<dl class="article-info"><dd class="published"><time datetime="2026-10-14T13:40:58+02:00">14 październik 2026</time></dd></dl>` +
    `<p>${lead}</p></div>`;
  const lines = (title: string, lead: string) => parseKielceNews(card(title, lead)).map((i) => i.lines);
  expect(
    '„od 24.10 do 2.11” to nie linie',
    lines('Wszystkich Świętych: zmiany od 24.10 do 2.11', 'Dodatkowe kursy linii 5 i 51'),
    [['5', '51']],
  );
  // Kielce mają linię 12, więc czyściciel ułamków musi zadziałać zawczasu.
  expect(
    '„12,5 mln zł” to nie linia 12',
    lines('Inwestycje drogowe', 'Koszt to 12,5 mln zł, a prace potrwają do listopada'),
    [[]],
  );
  expect(
    '„co 10 minut” to nie linia 10',
    lines('Zmiany częstotliwości', 'Autobusy linii 35 co 10 minut'),
    [['35']],
  );
  expect(
    '„od godziny 12:00” to nie linia 12',
    lines('Korekta rozkładu', 'Od godziny 12:00 autobusy linii 46 wracają na stałą trasę'),
    [['46']],
  );
  expect(
    '„KOMUNIKAT 2775/26” to nie linia',
    lines('KOMUNIKAT 2775/26: zmiana trasy', 'Zmiana trasy autobusów linii 46'),
    [['46']],
  );
  expect(
    '„9 października” to nie linia 9',
    lines('Zmiana trasy', 'Od piątku, 9 października 2026 roku autobusy linii 19 zmieniają trasę'),
    [['19']],
  );
  expect(
    '3 nie istnieje w GTFS (jest 54)',
    lines('Zmiany na liniach', 'Zmiany na liniach 3 i 54'),
    [['54']],
  );
  expect(
    '55 nie istnieje w GTFS (jest 54)',
    lines('Zmiany na liniach', 'Zmiany na liniach 54 i 55'),
    [['54']],
  );
  // Regresja: ZTM pisze „Z uwagi na remont…”, a samotne „Z” to przyimek,
  // nie linia Z. Litera liczy się tylko po „linia/linii/…” albo w cudzysłowie.
  expect(
    '„Z uwagi” to nie linia Z',
    lines('Zmiany w ruchu', 'Z uwagi na remont ulicy Zagnańskiej autobusy linii 8 pojadą objazdem'),
    [['8']],
  );
  expect(
    '„Trasy” (wielkie T na początku) to nie linia T',
    lines('Zmiany w ruchu', 'Nowe trasy w mieście, autobusy linii 26 zmieniają rozkład'),
    [['26']],
  );
  expect(
    '„linia T” to linia T',
    lines('Sezonowa komunikacja', 'Autobusy linii T wracają do Tokarni'),
    [['T']],
  );
  expect(
    'nocne N1 i N2',
    lines('Komunikacja nocna', 'Nocne autobusy N1 i N2 wracają na stałe trasy'),
    [['N1', 'N2']],
  );
  expect(
    '„nr 34211” to numer przystanku, nie linia',
    lines('Organizacja przystanków', 'Wyłączony przystanek Jagiellońska (nr 34211), objazd linii 27'),
    [['27']],
  );
  expect(
    'mała litera to nie linia (ZTM pisze linie wielką)',
    lines('Zmiany na liniach', 'Zmiany na linii e w stronę centrum'),
    [[]],
  );
}

describe('Tryb linii: Kielce to same autobusy');
{
  // Regresja: ogólna reguła „1–33 to tramwaj” działa po route_type i po
  // aktywnym mieście, a Kielce mają autobusy 1–54 — bez wykluczenia
  // w numericFallbackApplies linia 19 dostawała badge tramwaju.
  await setActiveCityId('kielce');
  expect('klasyfikacja route_type 3 (linia 19)', classifyTransitMode(3, '19'), 'bus');
  expect('klasyfikacja route_type 3 (linia 2)', classifyTransitMode(3, '2'), 'bus');
  expect('klasyfikacja route_type 3 (ZTM)', classifyTransitMode(3, '53'), 'bus');
  expect('5 to autobus', inferTransitMode(undefined, '5', 'kielce'), 'bus');
  expect('12 to autobus', inferTransitMode(undefined, '12', 'kielce'), 'bus');
  expect('N1 to autobus', inferTransitMode(undefined, 'N1', 'kielce'), 'bus');
  expect('E to autobus', inferTransitMode(undefined, 'E', 'kielce'), 'bus');
  expect('reguła niskich numerów działa poza Kielcami', inferTransitMode(undefined, '5', 'wroclaw'), 'tram');
}

describe('Podpowiedzi onboardingu per-miasto');
{
  // Regresja: bez gałęzi dla kielce hinty spadały na adresy Wrocławia.
  expect('pl dom', pl.onboarding.slotHomeHint('kielce'), 'np. Sienkiewicza 12');
  expect('pl praca', pl.onboarding.slotWorkHint('kielce'), 'np. Galeria Echo');
  expect('pl uczelnia', pl.onboarding.slotUniHint('kielce'), 'np. UJK');
  for (const [lang, dict] of [['pl', pl], ['en', en], ['de', de], ['uk', uk]] as const) {
    expect(
      `${lang}: kielce nie dziedziczy Wrocławia`,
      dict.onboarding.slotHomeHint('kielce') !== dict.onboarding.slotHomeHint('wroclaw'),
      true,
    );
  }
}

describe('Treść komunikatu ZTM (div.com-content-article__body)');
{
  // Struktura 1:1 z realnej podstrony /aktualnosci/2766 (2026-10-06):
  // h1 nad treścią, akapit wstępu, listy zmian, na końcu panel
  // rozkładu (div.rozklad_jazdy_aticle z linkami linii i schematami),
  // a po treści sidebar z modułem „Rozklad jazdy”.
  const html = `<html><body>
<h1> Czasowa zmiana trasy autobusów linii 19 i 53 </h1>
<div class="com-content-article__body">
<p><strong>Od piątku, 9 października 2026 roku</strong> do odwołania częściowo zmianie ulega trasa przejazdu autobusów <strong>linii 19 oraz 53</strong> w Kielcach. Obowiązują następujące zmiany:</p>
<ul><li><strong>autobusy linii 19</strong> od ulicy Domaszowskiej w dwie strony zostają skierowane przez Taylora do pętli przy Żniwnej</li></ul>
<ul><li><strong>autobusy linii 53</strong> od pętli przy ulicy Gustawa Morcinka zostają skierowane przez Sandomierską oraz Poleską i dalej według właściwej trasy</li></ul>
<div class="rozklad_jazdy_aticle">
<ul><li><a href="/rozklady/rozklady/NEW/0019/w.htm">19</a></li><li><a href="/rozklady/rozklady/NEW/0053/w.htm">53</a></li></ul>
<p><img src="/images/MORCINKA%2019.jpg" alt="MORCINKA 19" /></p>
</div></div>
<div class="rp-sidebarright col-md-4"><div class="moduletable _rozklad_jazdy">
<h3 >Rozklad jazdy </h3>
<ul><li><a href="/rozklady/rozklady/0001/w.htm">1</a></li></ul>
</div></div>
</body></html>`;
  const blocks = extractArticleBlocks(
    html,
    `${ZTM_KIELCE_URL}/aktualnosci/2766-czasowa-zmiana-trasy-autobusow-linii-19-i-53.html`,
  );
  expect('trzy bloki (wstęp + dwie listy zmian)', blocks.length, 3);
  expect('wstęp jest pierwszy', blocks[0]?.text.startsWith('Od piątku, 9 października') ?? false, true);
  expect('zmiana linii 19 jest', blocks.some((b) => b.text.includes('do pętli przy Żniwnej')), true);
  expect('zmiana linii 53 jest', blocks.some((b) => b.text.includes('przez Sandomierską')), true);
  expect('bez tytułu z h1', blocks.some((b) => b.text.startsWith('Czasowa zmiana trasy')), false);
  // Panel rozkładu dubluje numery linii jako gołe pozycje listy i niesie
  // schematy objazdów — nie może trafić do treści.
  expect('bez linii z panelu rozkładu', blocks.some((b) => b.text === '19' || b.text === '53'), false);
  expect('bez schematów objazdów', blocks.some((b) => b.text.includes('MORCINKA')), false);
  expect('bez sidebaru', blocks.some((b) => b.text === 'Rozklad jazdy'), false);

  // Krótka informacja bez listy zmian: sam wstęp, żadnego szumu.
  const shortHtml = `<html><body>
<div class="com-content-article__body">
<p>Informujemy, że autobusy linii <strong>1, 28 i 31 </strong>ponownie wykonują skręt z ulicy Krakowskiej w ulicę Jagiellońską</p>
</div>
<div class="rp-sidebarright"><h3>Rozklad jazdy</h3></div>
</body></html>`;
  const shortBlocks = extractArticleBlocks(
    shortHtml,
    `${ZTM_KIELCE_URL}/aktualnosci/2775-informacja-200.html`,
  );
  expect('krótka informacja to jeden blok', shortBlocks.length, 1);
  expect('treść wstępu jest', shortBlocks[0]?.text.includes('Jagiellońską') ?? false, true);
}

console.log(`\n${'='.repeat(52)}`);
if (failures.length === 0) {
  console.log(`WSZYSTKO OK — ${passed} asercji`);
  process.exit(0);
}
console.log(`${failures.length} NIEUDANYCH z ${passed + failures.length}:`);
for (const f of failures) console.log(`  - ${f}`);
process.exit(1);
})();
