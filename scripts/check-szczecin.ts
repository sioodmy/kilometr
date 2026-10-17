/**
 * Sprawdzenie Szczecina: rejestr miasta, parser komunikatów ZDiTM (lista
 * HTML), wyciąganie treści komunikatu (main#pageContent), tryb linii
 * i podpowiedzi onboardingu.
 *
 * Uruchomienie: `npm run check:szczecin`
 *
 * Samego pobrania feedu tu nie ma (sieć w teście jednostkowym to niestabilny
 * fundament) - chronimy czystą logikę na zamrożonych próbkach z realnych
 * źródeł (karty z zditm.szczecin.pl/pl/pasazer/informacje z 2026-10-15,
 * struktura podstrony informacji z tego samego dnia, linie i typy
 * z GTFS ZDiTM).
 */

import { getCity } from '../src/cities';
import { inferTransitMode } from '../src/services/lineIdentity';
import { classifyTransitMode } from '../src/services/routing/network';
import {
  extractArticleBlocks,
  parseSzczecinInfo,
  ZDITM_SZCZECIN_INFO_URL,
} from '../src/services/mpkNews';
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
  const szcz = getCity('szczecin');
  expect('id', szcz.id, 'szczecin');
  expect('nazwa', szcz.name, 'Szczecin');
  expect('slug live to szczecin', szcz.zbiorkomSlug, 'szczecin');
  expect('bbox live', szcz.zbiorkomBbox, '14.35,53.3,14.75,53.6');
  expect(
    'feed komunikatów',
    ZDITM_SZCZECIN_INFO_URL,
    'https://www.zditm.szczecin.pl/pl/pasazer/informacje',
  );
  expect('bez kolei regionalnej', szcz.features.regionalRail, false);
  expect('bez bezpośredniego bus_position', szcz.features.directBusPosition, false);
}

describe('Komunikaty ZDiTM (lista)');
{
  // Próbki 1:1 z realnej listy (karty z 2026-10-15, skrócone do znaczników,
  // które czyta parser: link, tytuł, time[datetime], lead, hero obrazek).
  const html = `<div class="row">
<div class="col"><div class="card shadow img-hover h-100 border-2 border-section-passenger">
<img srcset="/storage/media/hero/x-600.png 600w" sizes="100vw" src="/storage/media/hero/x.png?id=abc" width="1799" height="1012" class="card-img-top" alt="">
<div class="card-body">
<h2 class="h5">
<a href="https://www.zditm.szczecin.pl/pl/pasazer/informacje/6ac8c1e79fd85/reduty-ordona-zmiany-w-kursowaniu-komunikacji-od-13-pazdziernika" class="stretched-link">Reduty Ordona: Zmiany w kursowaniu komunikacji od 13 października</a>
</h2>
<p class="text-body-secondary small"><time datetime="2026-10-12T08:55:09+02:00">12 października 2026</time></p>
<p class="card-text">W związku z pracami zleconymi przez ZWiK w ciągu ul. Reduty Ordona dojdzie do zmian w funkcjonowaniu linii autobusowych nr 75 i 521.</p>
</div></div></div>
<div class="col"><div class="card shadow img-hover h-100 border-2 border-section-passenger">
<img srcset="/storage/media/hero/y-600.png 600w" sizes="100vw" src="/storage/media/hero/y.png?id=def" width="1799" height="1012" class="card-img-top" alt="">
<div class="card-body">
<h2 class="h5">
<a href="https://www.zditm.szczecin.pl/pl/pasazer/informacje/6ace2a4d84415/linia-a-peron-na-petli-ludowa-przywrocony-do-uzytkowania" class="stretched-link">Linia A: Peron na pętli ludowa przywrócony do użytkowania</a>
</h2>
<p class="text-body-secondary small"><time datetime="2026-10-10T12:00:00+02:00">10 października 2026</time></p>
<p class="card-text">Od 11 października autobusy linii A wracają na peron przy pętli Ludowa.</p>
</div></div></div>
</div>`;
  const items = parseSzczecinInfo(html);
  expect('dwa komunikaty', items.length, 2);
  expect(
    'tytuł bez daty na początku',
    items[0].title,
    'Reduty Ordona: Zmiany w kursowaniu komunikacji od 13 października',
  );
  expect('linie z leadu (75 i nocne 521)', items[0].lines, ['75', '521']);
  expect('opis z leadu w karcie', items[0].description.includes('Reduty Ordona'), true);
  const d0 = items[0].pubDate ? new Date(items[0].pubDate) : null;
  expect('data z time[datetime] (dzień)', d0?.getDate(), 12);
  expect('data z time[datetime] (miesiąc)', d0?.getMonth(), 9);
  expect('data z time[datetime] (rok)', d0?.getFullYear(), 2026);
  expect('pospieszne A z tytułu', items[1].lines, ['A']);
  expect('zwykła zmiana to nie pilne', items[0].urgent, false);
  // Hero ZDiTM ma ścieżkę względną: aplikacja potrzebuje absolutnego URL.
  expect(
    'względny obrazek staje się absolutny',
    items[0].imageUrl,
    'https://www.zditm.szczecin.pl/storage/media/hero/x.png?id=abc',
  );
}

describe('Numery linii ZDiTM: daty, godziny, numery przystanków');
{
  const card = (title: string, lead: string) =>
    `<div class="card shadow img-hover h-100"><div class="card-body"><h2 class="h5">` +
    `<a href="https://www.zditm.szczecin.pl/pl/pasazer/informacje/x/t" class="stretched-link">${title}</a></h2>` +
    `<p class="text-body-secondary small"><time datetime="2026-10-12T08:55:09+02:00">12 października 2026</time></p>` +
    `<p class="card-text">${lead}</p></div></div>`;
  expect(
    '„od 24.10 do 2.11” to nie linie',
    parseSzczecinInfo(
      card('Wszystkich Świętych: zmiany od 24.10 do 2.11', 'Dodatkowe linie C i 53'),
    ).map((i) => i.lines),
    [['C', '53']],
  );
  // Regresja: \b w JS nie zna polskich liter, więc „będą” łamało się na
  // „b” + „ę” i pierwsza wersja parsera pokazywała linię B w co drugim
  // komunikacie („będącego”, „będzie”, „będą”).
  expect(
    '„będą” i „będącego” to nie linia B',
    parseSzczecinInfo(
      card(
        'Te ulice obecnie się zmieniają',
        'Roboty prowadzone są i będą w październiku, będącego kontynuacją',
      ),
    ).map((i) => i.lines),
    [[]],
  );
  expect(
    'spójnik „a” to nie linia A',
    parseSzczecinInfo(card('Zmiany na liniach', 'Zmiany linii 75, a także 521 oraz autobusów')).map(
      (i) => i.lines,
    ),
    [['75', '521']],
  );
  expect(
    'mała litera to nie linia (ZDiTM pisze linie wielką)',
    parseSzczecinInfo(card('Zmiany na liniach', 'Zmiany na linii b w Policach')).map(
      (i) => i.lines,
    ),
    [[]],
  );
  expect(
    '„KOMUNIKAT 201/26” to nie linia 201',
    parseSzczecinInfo(
      card('KOMUNIKAT 201/26: zmiana trasy', 'Zmiana trasy autobusów linii 86'),
    ).map((i) => i.lines),
    [['86']],
  );
  expect(
    '„12,5 mln zł” to nie linia 12',
    parseSzczecinInfo(
      card('Inwestycje drogowe', 'Koszt to 12,5 mln zł, a prace potrwają do listopada'),
    ).map((i) => i.lines),
    [[]],
  );
  expect(
    '„13 października” to nie linia 13',
    parseSzczecinInfo(card('Zmiany od 13 października', 'Objazd dla linii 6 i B')).map(
      (i) => i.lines,
    ),
    [['6', 'B']],
  );
  expect(
    '„nr 34211” to numer przystanku, nie linia',
    parseSzczecinInfo(
      card('Organizacja przystanków', 'Wyłączone: Chłopickiego (nr 34211), linia 86'),
    ).map((i) => i.lines),
    [['86']],
  );
  expect(
    '„08:55” i „co 20 minut” to nie linie',
    parseSzczecinInfo(card('Komunikat poranny', 'Od 08:55 linia 107 co 20 minut')).map(
      (i) => i.lines,
    ),
    [['107']],
  );
  expect(
    '„co 10 minut” to nie linia 10',
    parseSzczecinInfo(card('Zmiany częstotliwości', 'Tramwaje będą kursować co 10 minut')).map(
      (i) => i.lines,
    ),
    [[]],
  );
  expect(
    '55 nie istnieje w GTFS (jest 56)',
    parseSzczecinInfo(card('Zmiany na liniach', 'Zmiany na liniach 55 i 56')).map((i) => i.lines),
    [['56']],
  );
  expect(
    '4 nie istnieje w GTFS (tramwaje to 1-12 bez czwórki)',
    parseSzczecinInfo(card('Zmiany na liniach', 'Zmiany na liniach 4 i 6')).map((i) => i.lines),
    [['6']],
  );
  expect(
    'link archiwum to nie komunikat',
    parseSzczecinInfo(
      `<div class="card shadow img-hover h-100"><div class="card-body"><h2 class="h5">` +
        `<a href="https://www.zditm.szczecin.pl/pl/pasazer/informacje/archiwum" class="stretched-link">Archiwalne</a></h2></div></div>`,
    ).length,
    0,
  );
}

describe('Tryb linii: tramwaje 1-12, reszta to autobusy');
{
  expect('klasyfikacja route_type 0', classifyTransitMode(0, '5'), 'tram');
  expect('klasyfikacja route_type 3 (ZDiTM)', classifyTransitMode(3, '53'), 'bus');
  expect('5 to tramwaj', inferTransitMode(undefined, '5', 'szczecin'), 'tram');
  expect('12 to tramwaj', inferTransitMode(undefined, '12', 'szczecin'), 'tram');
  expect('53 to autobus', inferTransitMode(undefined, '53', 'szczecin'), 'bus');
  expect('A to autobus pospieszny', inferTransitMode(undefined, 'A', 'szczecin'), 'bus');
  expect('521 to autobus nocny', inferTransitMode(undefined, '521', 'szczecin'), 'bus');
  expect(
    'reguła niskich numerów działa też poza Szczecinem',
    inferTransitMode(undefined, '5', 'wroclaw'),
    'tram',
  );
}

describe('Podpowiedzi onboardingu per-miasto');
{
  // Regresja: bez gałęzi dla szczecin hinty spadały na adresy Wrocławia.
  expect('pl dom', pl.onboarding.slotHomeHint('szczecin'), 'np. Wojska Polskiego 12');
  expect('pl praca', pl.onboarding.slotWorkHint('szczecin'), 'np. Galeria Kaskada');
  expect('pl uczelnia', pl.onboarding.slotUniHint('szczecin'), 'np. US');
  for (const [lang, dict] of [
    ['pl', pl],
    ['en', en],
    ['de', de],
    ['uk', uk],
  ] as const) {
    expect(
      `${lang}: szczecin nie dziedziczy Wrocławia`,
      dict.onboarding.slotHomeHint('szczecin') !== dict.onboarding.slotHomeHint('wroclaw'),
      true,
    );
  }
}

describe('Treść komunikatu ZDiTM (main#pageContent)');
{
  // Struktura 1:1 z realnej podstrony informacji: okruszki w nav, tytuł
  // w h1 w hero, linie w karcie, lead w div.lead, sekcje w h2, na końcu
  // stopka powiązanych z wiadomosci.szczecin.eu.
  const html = `<html><body><main class="col-md-8" id="pageContent">
<nav aria-label="breadcrumb"><ol class="breadcrumb"><li><a href="/pl">Strona główna</a></li></ol></nav>
<div class="hero"><div class="hero-title text-light p-3 p-xl-5"><h1>Reduty Ordona: Zmiany w kursowaniu komunikacji od 13 października</h1>
<p class="small mb-0 fw-semibold"><span class="visually-hidden">opublikowano:</span> <time datetime="2026-10-12T08:55:09+02:00">12 października 2026</time></p></div></div>
<div class="clearfix"><div class="card"><div class="card-body">
<p class="fw-bold">Ta informacja dotyczy linii:</p>
<a href="https://www.zditm.szczecin.pl/pl/pasazer/rozklady-jazdy/linia/37/75"> 75 </a>
<a href="https://www.zditm.szczecin.pl/pl/pasazer/rozklady-jazdy/linia/62/521"> 521 </a>
</div></div>
<div class="lead text-break "><p>W związku z pracami w ciągu ul. Reduty Ordona dojdzie do zmian w funkcjonowaniu linii autobusowych nr 75 i 521.</p></div></div>
<nav class="toc" id="toc"><h2 class="h4">Spis treści</h2><ul><li>Autobusy linii 75 i 521</li></ul></nav>
<h2>Autobusy linii 75 i 521</h2>
<p>Autobusy linii 75, 521 jadące w kierunku centrum pojadą ulicami Łukasińskiego i Witkiewicza.</p>
<h2>Organizacja przystanków</h2>
<p>Na czas objazdu wyłączone będą przystanki Chłopickiego i Wita Stwosza.</p>
<div class="offcanvas offcanvas-start" id="tocOffcanvas"><div class="offcanvas-body small"><div class="text-break toc" id="tocOffcanvasBody"><ul><li class="first"><a href="#autobusy-linii-75-i-521">Autobusy linii 75 i 521</a></li><li class="last"><a href="#organizacja-przystankow">Organizacja przystanków</a></li></ul></div></div></div>
<h2><a>Więcej wiadomości ze Szczecina</a></h2>
<div class="row"><div class="col"><div class="card"><h3><a href="https://wiadomosci.szczecin.eu/artykul/x">Darmowe kursy online</a></h3></div></div></div>
</main></body></html>`;
  const blocks = extractArticleBlocks(
    html,
    'https://www.zditm.szczecin.pl/pl/pasazer/informacje/6ac8c1e79fd85/reduty-ordona',
  );
  expect(
    'bez tytułu z h1',
    blocks.some((b) => b.text.startsWith('Reduty Ordona:')),
    false,
  );
  expect(
    'lead jest pierwszym akapitem',
    blocks[0]?.text.includes('W związku z pracami') ?? false,
    true,
  );
  expect(
    'sekcja o autobusach jest',
    blocks.some((b) => b.text.includes('Łukasińskiego')),
    true,
  );
  expect(
    'bez spisu treści z nav',
    blocks.some((b) => b.text === 'Spis treści'),
    false,
  );
  expect(
    'bez nagłówka z publikacją',
    blocks.some((b) => b.text.startsWith('opublikowano:')),
    false,
  );
  expect(
    'bez stopki powiązanych',
    blocks.some((b) => b.text.includes('Darmowe kursy online')),
    false,
  );
  expect(
    'nagłówek sekcji istnieje dokładnie raz (spis z offcanvasu odcięty)',
    blocks.filter((b) => b.text === 'Autobusy linii 75 i 521').length,
    1,
  );

  // Gdyby nagłówek „Więcej wiadomości” zniknął, stopkę i tak odcina link.
  const fallbackHtml = html.replace('Więcej wiadomości ze Szczecina', 'Zobacz również');
  const fallbackBlocks = extractArticleBlocks(
    fallbackHtml,
    'https://www.zditm.szczecin.pl/pl/pasazer/informacje/6ac8c1e79fd85/reduty-ordona',
  );
  expect(
    'fallback: bez stopki powiązanych',
    fallbackBlocks.some((b) => b.text.includes('Darmowe kursy online')),
    false,
  );
  expect(
    'fallback: sekcja o autobusach jest',
    fallbackBlocks.some((b) => b.text.includes('Łukasińskiego')),
    true,
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
