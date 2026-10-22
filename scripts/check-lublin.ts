/**
 * Sprawdzenie Lublina: rejestr miasta, parser komunikatów ZDiTM (lista
 * HTML), wyciąganie treści komunikatu (section.main-center-panel), tryb
 * linii i podpowiedzi onboardingu.
 *
 * Uruchomienie: `npm run check:lublin`
 *
 * Samego pobrania feedu tu nie ma (sieć w teście jednostkowym to niestabilny
 * fundament) - chronimy czystą logikę na zamrożonych próbkach z realnych
 * źródeł (karty z zdtm.lublin.eu/pl/aktualnosci z 2026-10-15, struktura
 * podstrony aktualności z tego samego dnia, linie i typy z GTFS ZDiTM).
 */

import { getCity } from '../src/cities';
import { setActiveCityId } from '../src/services/cityStore';
import { inferTransitMode } from '../src/services/lineIdentity';
import { classifyTransitMode } from '../src/services/routing/network';
import { extractArticleBlocks, parseLublinInfo, ZDITM_LUBLIN_INFO_URL } from '../src/services/mpkNews';
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
  const lub = getCity('lublin');
  expect('id', lub.id, 'lublin');
  expect('nazwa', lub.name, 'Lublin');
  expect('slug live to lublin', lub.zbiorkomSlug, 'lublin');
  expect('bbox live', lub.zbiorkomBbox, '22.3,51.05,22.8,51.42');
  expect('feed komunikatów', ZDITM_LUBLIN_INFO_URL, 'https://www.zdtm.lublin.eu/pl/aktualnosci');
  expect('bez kolei regionalnej', lub.features.regionalRail, false);
  expect('bez bezpośredniego bus_position', lub.features.directBusPosition, false);
}

describe('Komunikaty ZDiTM Lublin (lista)');
{
  // Próbki 1:1 z realnej listy (karty z 2026-10-15, skrócone do znaczników,
  // które czyta parser: data na pierwszej karcie grupy dnia, tytuł h3,
  // lead w p, link "Zobacz więcej").
  const html = `<article class="news">
    <h3 class="news-header inline"><span>Aktualności</span></h3>
    <div class="data nowosc inline"><div>&nbsp;</div><h4>2026-10-15 11:48</h4></div>
    <article class="tiny ">
        <section class="inline news_icon"><img src="/uploads/Icons/naprawmy.png" alt="icon" /></section>
        <h3 class="inline">Utrudnienia w ruchu w związku z kolejnym etapem prac w ciągu ul. Janowskiej</h3>
        <p style="text-align: justify;"><strong>Z uwagi na kolejny etap prac na ul. Janowskiej,</strong> związany z ułożeniem warstwy ścieralnej na ostatnim odcinku, <strong>od 19 października 2026 r. (poniedziałek) kierowcy muszą liczyć się z utrudnieniami w ruchu.</strong></p>
        <a href="/pl/aktualnosci/utrudnienia-w-ruchu-w-zwiazku-z-kolejnym-etapem-prac-w-ciagu-ul-janowskiej.html" target="_self"><span class="icon-zobacz"></span>Zobacz więcej</a>
    </article>
</article>
<article class="news">
    <h3 class="news-header inline"><span>Aktualności</span></h3>
    <article class="tiny ">
        <section class="inline news_icon"><img src="/uploads/Icons/objazdy_czerwony.png" alt="icon" /></section>
        <h3 class="inline">Zmiany w komunikacji miejskiej od 19 października 2026 r. (poniedziałek)</h3>
        <p><strong>Uruchomienie nowej linii komunikacji miejskiej nr 801</strong>, która obsługiwać będzie okolice ulicy Biskupie w dzielnicy Hajdów-Zadębie, <strong>wydłużenie trasy linii nr 33 do Dworca Lublin</strong> oraz korekty w rozkładach.</p>
        <a href="/pl/aktualnosci/zmiany-w-komunikacji-miejskiej-od-19-pazdziernika-2026-r-poniedzialek.html" target="_self"><span class="icon-zobacz"></span>Zobacz więcej</a>
    </article>
</article>`;
  const items = parseLublinInfo(html);
  expect('dwa komunikaty', items.length, 2);
  expect('tytuł pierwszej karty', items[0].title, 'Utrudnienia w ruchu w związku z kolejnym etapem prac w ciągu ul. Janowskiej');
  expect('link absolutny', items[0].link, 'https://www.zdtm.lublin.eu/pl/aktualnosci/utrudnienia-w-ruchu-w-zwiazku-z-kolejnym-etapem-prac-w-ciagu-ul-janowskiej.html');
  expect('opis z leadu w karcie', items[0].description.includes('warstwy ścieralnej'), true);
  const d0 = items[0].pubDate ? new Date(items[0].pubDate) : null;
  expect('data z h4 (dzień)', d0?.getDate(), 15);
  expect('data z h4 (miesiąc)', d0?.getMonth(), 9);
  expect('data z h4 (rok)', d0?.getFullYear(), 2026);
  expect('utrudnienia to pilne', items[0].urgent, true);
  // Druga karta nie ma daty: dziedziczy grupę dnia z pierwszej.
  expect('dziedziczenie daty grupy dnia', items[1].pubDate, items[0].pubDate);
  // 801 nie ma jeszcze w GTFS (start 19 października), więc jedyną linią jest 33.
  expect('linie z leadu (tylko 33, bez 801)', items[1].lines, ['33']);
  expect('ikonki kategorii to nie zdjęcia', items[0].imageUrl, null);
}

describe('Numery linii ZDiTM Lublin: daty, liczebniki, stanowiska');
{
  const card = (title: string, lead: string, date = true) =>
    `<article class="news">` +
    (date ? `<div class="data nowosc inline"><div>&nbsp;</div><h4>2026-10-15 11:48</h4></div>` : ``) +
    `<article class="tiny "><h3 class="inline">${title}</h3><p>${lead}</p>` +
    `<a href="/pl/aktualnosci/x.html" target="_self"><span class="icon-zobacz"></span>Zobacz więcej</a>` +
    `</article></article>`;
  expect(
    '„19-30 października” to nie linie',
    parseLublinInfo(card('Utrudnienia w ruchu: 19-30 października', 'Zdjęcia filmowe, objazdy linii 17')).map((i) => i.lines),
    [['17']],
  );
  expect(
    '„7. Marsz Równości” i „10. Półmaraton” to liczebniki, nie linie',
    parseLublinInfo(card('Utrudnienia w ruchu: 7. Marsz Równości oraz Stokrotka 10. Półmaraton', 'Objazdy w centrum')).map((i) => i.lines),
    [[]],
  );
  expect(
    '„linii nr 33.” z kropką na końcu zdania to linia',
    parseLublinInfo(card('Zmiany na liniach', 'Wydłużenie trasy linii nr 33. Dodatkowe kursy.')).map((i) => i.lines),
    [['33']],
  );
  expect(
    '„od 2026 r.” to nie linia',
    parseLublinInfo(card('Zmiany od 19 października 2026 r.', 'Korekty rozkładów linii 6')).map((i) => i.lines),
    [['6']],
  );
  expect(
    '„7.lubelski” (liczebnik z kropką przy słowie) to nie linia',
    parseLublinInfo(
      card('Utrudnienia w ruchu', 'Zgromadzenie p.n. "7.lubelski Marsz Równości", autobusy linii 3 i 55 jadą objazdem'),
    ).map((i) => i.lines),
    [['3', '55']],
  );
  expect(
    'godziny i stanowiska to nie linie („6:38”, „WSEI 01”)',
    parseLublinInfo(card('Rozkład linii 801', 'Odjazdy z przystanku Mełgiewska WSEI 01: 6:38, 7:18')).map((i) => i.lines),
    [[]],
  );
  expect(
    'nocne N1–N3 i trolejbusy 150–162',
    parseLublinInfo(card('Komunikacja nocna', 'Linie N1, N2 i trolejbusy 150, 155 oraz 162')).map((i) => i.lines),
    [['N1', 'N2', '150', '155', '162']],
  );
  expect(
    '950 to trolejbus, a 152 nie istnieje w GTFS',
    parseLublinInfo(card('Zmiany na liniach', 'Linie 950 i 152 pojadą objazdem')).map((i) => i.lines),
    [['950']],
  );
  expect(
    '9 i 10 nie istnieją w GTFS (jest 8)',
    parseLublinInfo(card('Zmiany na liniach', 'Linie 8, 9 i 10')).map((i) => i.lines),
    [['8']],
  );
  expect(
    '„linii Gaj” to linia imienna, a sam „Stary Gaj” to dzielnica',
    parseLublinInfo(card('Zmiany na liniach', 'Objazd linii Gaj przez Stary Gaj')).map((i) => i.lines),
    [['GAJ']],
  );
  expect(
    'karta bez linku „Zobacz więcej” to nie komunikat',
    parseLublinInfo(
      `<article class="news"><article class="tiny "><h3 class="inline">Tytuł</h3></article></article>`,
    ).length,
    0,
  );
}

async function main(): Promise<void> {
  // Klasyfikacja silnikowa (classifyTransitMode) czyta aktywne miasto:
  // lubelskie autobusy 2–33 nie mogą wpadać we wrocławski fallback
  // tramwajowy 1–33, więc test przełącza miasto jak aplikacja.
  await setActiveCityId('lublin');

describe('Tryb linii: autobusy 2–85, trolejbusy 150–162 i 950');
{
  expect('klasyfikacja route_type 11', classifyTransitMode(11, '155'), 'trolleybus');
  expect('klasyfikacja route_type 3 (ZDiTM)', classifyTransitMode(3, '33'), 'bus');
  expect('6 to autobus (Lublin nie ma tramwajów)', inferTransitMode(undefined, '6', 'lublin'), 'bus');
  expect('33 to autobus', inferTransitMode(undefined, '33', 'lublin'), 'bus');
  expect('150 to trolejbus', inferTransitMode(undefined, '150', 'lublin'), 'trolleybus');
  expect('162 to trolejbus', inferTransitMode(undefined, '162', 'lublin'), 'trolleybus');
  expect('950 to trolejbus', inferTransitMode(undefined, '950', 'lublin'), 'trolleybus');
  expect('N1 to autobus nocny', inferTransitMode(undefined, 'N1', 'lublin'), 'bus');
  expect('801 to autobus', inferTransitMode(undefined, '801', 'lublin'), 'bus');
  expect('reguła niskich numerów działa poza Lublinem', inferTransitMode(undefined, '5', 'wroclaw'), 'tram');
}

describe('Podpowiedzi onboardingu per-miasto');
{
  // Regresja: bez gałęzi dla lublin hinty spadały na adresy Wrocławia.
  expect('pl dom', pl.onboarding.slotHomeHint('lublin'), 'np. Krakowskie Przedmieście 12');
  expect('pl praca', pl.onboarding.slotWorkHint('lublin'), 'np. Felicity');
  expect('pl uczelnia', pl.onboarding.slotUniHint('lublin'), 'np. UMCS');
  for (const [lang, dict] of [['pl', pl], ['en', en], ['de', de], ['uk', uk]] as const) {
    expect(
      `${lang}: lublin nie dziedziczy Wrocławia`,
      dict.onboarding.slotHomeHint('lublin') !== dict.onboarding.slotHomeHint('wroclaw'),
      true,
    );
  }
}

describe('Treść komunikatu ZDiTM Lublin (section.main-center-panel)');
{
  // Struktura 1:1 z realnej podstrony aktualności: okruszki w ol.breadcrumb,
  // tytuł w h2.text-header, treść w article.tiny, prawy panel z logotypami.
  const html = `<html><body><section class="container textowa"><section class="row news-main main">
<ol class="breadcrumb"><li><a href="/">Strona główna</a></li><li><a href="/pl/aktualnosci">Aktualności</a></li></ol>
<section class="main-left-panel hidden-xs hidden-sm col-md-3 col-lg-3"><article><h3>Przewoźnicy</h3></article></section>
<section class="main-center-panel col-xs-12 col-md-6 col-lg-6">
<h2 class="text-header">Zmiany w komunikacji miejskiej od 19 października 2026 r. (poniedziałek)</h2>
<article class="tiny">
<p><div style="text-align: justify;"><strong>Uruchomienie nowej linii komunikacji miejskiej nr 801</strong>, która obsługiwać będzie okolice ulicy Biskupie.</div>
<div style="text-align: justify;"><p><strong>1. Uruchomienie linii nr 801 po trasie:</strong></p>
<p>Mełgiewska WSEI – Mełgiewska – Metalurgiczna – Biskupie</p></div>
<div style="text-align: justify;">Linia na Biskupie otrzymała nr 801. Będzie kursować w dni powszednie.
<ul><li>odjazdy z przystanku Mełgiewska WSEI 01: 6:38, 7:18</li>
<li>odjazdy z przystanku Biskupie - obwodnica 02: 6:50, 7:30</li></ul></div>
<div style="text-align: justify;">Linia obsługiwana taborem niskopodłogowym od pierwszego dnia kursowania.</div>
<a href="javascript:window.history.back()" class="btn btn-default">Wstecz</a>
</article>
</section>
<section class="main-right-panel col-xs-12 col-md-3 col-lg-3"><article><h4>Logotypy</h4></article></section>
</section></section></body></html>`;
  const blocks = extractArticleBlocks(html, 'https://www.zdtm.lublin.eu/pl/aktualnosci/zmiany-w-komunikacji-miejskiej-od-19-pazdziernika-2026-r-poniedzialek.html');
  expect('bez tytułu z h2', blocks.some((b) => b.text.startsWith('Zmiany w komunikacji miejskiej od 19')), false);
  expect('lead o linii 801 jest', blocks.some((b) => b.text.includes('Uruchomienie nowej linii')), true);
  expect('trasa po myślnikach jest', blocks.some((b) => b.text.includes('Metalurgiczna')), true);
  // Akapit wprost w divie (bez p) musi dojść, a „Wstecz” z nawigacji nie.
  expect('luźny akapit z diva jest', blocks.some((b) => b.text.includes('taborem niskopodłogowym')), true);
  expect('luźny akapit w kolejności dokumentu', blocks.findIndex((b) => b.text.includes('taborem niskopodłogowym')) > blocks.findIndex((b) => b.text.includes('Uruchomienie nowej linii')), true);
  expect('bez przycisku Wstecz', blocks.some((b) => b.text.includes('Wstecz')), false);
  expect('bez okruszków', blocks.some((b) => b.text.includes('Strona główna')), false);
  expect('bez lewego panelu', blocks.some((b) => b.text.includes('Przewoźnicy')), false);
  expect('bez prawego panelu', blocks.some((b) => b.text.includes('Logotypy')), false);
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
