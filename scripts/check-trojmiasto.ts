/**
 * Sprawdzenie Trójmiasta: rejestr aglomeracji, parsery komunikatów ZTM
 * Gdańsk (znt.json + bsk.json), wyciąganie treści artykułu z ztm.gda.pl,
 * tryb linii (tramwaje/trolejbusy) i podpowiedzi onboardingu.
 *
 * Uruchomienie: `npm run check:trojmiasto`
 *
 * Samego pobrania feedu tu nie ma (sieć w teście jednostkowym to niestabilny
 * fundament) — chronimy czystą logikę na zamrożonych próbkach z realnych
 * źródeł (pozycje z api.zbiorkom.live z 2026-10-15, komunikaty
 * z files.cloudgdansk.pl z 2026-10-15, struktura artykułu z ztm.gda.pl,
 * linie i typy z feedów GTFS Gdańska/Gdyni/SKM).
 */

import { getCity } from '../src/cities';
import { inferTransitMode, getLineColors } from '../src/services/lineIdentity';
import { classifyTransitMode } from '../src/services/routing/network';
import {
  extractArticleBlocks,
  parseGdanskBsk,
  parseGdanskZnt,
  ZTM_GDANSK_BSK_URL,
  ZTM_GDANSK_ZNT_URL,
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

describe('Rejestr aglomeracji');
{
  const tri = getCity('trojmiasto');
  expect('id', tri.id, 'trojmiasto');
  expect('nazwa', tri.name, 'Trójmiasto');
  expect('slug live to tricity', tri.zbiorkomSlug, 'tricity');
  expect('bbox live', tri.zbiorkomBbox, '18.15,54.1,18.98,54.66');
  expect('osobna baza', tri.dbFile, 'kilometr-gtfs-trojmiasto.db');
  expect('osobny pakiet kafli', tri.tilePack, 'trojmiasto-tiles.ktp');
  expect('kolej regionalna (SKM)', tri.features.regionalRail, true);
  expect('bez bezpośredniego bus_position', tri.features.directBusPosition, false);
  expect('feed zmian tras', ZTM_GDANSK_ZNT_URL, 'https://files.cloudgdansk.pl/d/otwarte-dane/ztm/znt.json?v=1');
  expect('feed awarii', ZTM_GDANSK_BSK_URL, 'https://files.cloudgdansk.pl/d/otwarte-dane/ztm/bsk.json?v=1');
}

describe('Zmiany tras ZTM Gdańsk (znt.json)');
{
  // Próbki 1:1 z realnego feedu (2026-10-15), okrojone do pól parsera.
  const json = JSON.stringify({
    metadata: { title: 'Zmiany na trasach' },
    count: '3',
    results: [
      {
        lineNumbers: ['117', '143', 'N4'],
        disableAlarm: false,
        alarmDateFrom: '2026-10-13 12:00:00',
        alarmDateTo: '2026-10-17 12:00:00',
        title: 'Linie 117, 143, N4: tymczasowa lokalizacja przystanku "Oliwa PKP" 03',
        summary:
          'W związku z pracami drogowymi na ul. Bolesława Krzywoustego w Gdańsku, od środy 14.10.2026 r. przystanek "Oliwa PKP" 03 zostanie przeniesiony.',
        content: '',
        url: 'https://ztm.gda.pl/komunikaty/linie-117-143-n4-tymczasowa-lokalizacja-przystanku-oliwa-pkp-03,a,11940',
        publishFrom: '2026-10-13 11:32:00',
        publishTo: '2026-11-10 11:35:00',
      },
      {
        lineNumbers: ['195'],
        title: 'Awaryjna zmiana trasy dla linii 195',
        summary: 'Z powodu awarii sieci tramwajowej linia 195 jedzie objazdem.',
        content: '',
        url: 'https://ztm.gda.pl/komunikaty/awaryjna-zmiana-trasy-dla-linii-195,a,11939',
        publishFrom: '2026-10-14 09:00:00',
        publishTo: '2026-10-20 09:00:00',
      },
      {
        lineNumbers: [],
        title: 'Obsługa komunikacyjna na mecz Lechia Gdańsk - Arka Gdynia 18.10.2026 r.',
        summary: 'W dniu meczu uruchomione zostaną dodatkowe kursy.',
        content: '',
        url: 'https://ztm.gda.pl/komunikaty/obsluga-komunikacyjna-na-mecz,a,11929',
        publishFrom: '2026-10-15 10:00:00',
        publishTo: '2026-10-19 10:00:00',
      },
    ],
  });
  const items = parseGdanskZnt(json);
  expect('trzy komunikaty', items.length, 3);
  expect('linie gotowe z API', items[0].lines, ['117', '143', 'N4']);
  expect('link z API', items[0].link.startsWith('https://ztm.gda.pl/komunikaty/'), true);
  expect('pubDate z publishFrom', items[0].pubDate !== null, true);
  expect('opis z leadu', items[0].description.includes('Krzywoustego'), true);
  expect('awaria = pilne', items[1].urgent, true);
  expect('przeniesienie przystanku nie pilne', items[0].urgent, false);
  expect('mecz bez linii', items[2].lines, []);
  expect('„18.10.2026” z tytułu meczu to nie linia', items[2].lines.includes('18'), false);
  expect('śmieciowy JSON to pusto', parseGdanskZnt('nie json'), []);
  expect('zły kształt to pusto', parseGdanskZnt('{"results":null}'), []);
}

describe('Bieżące awarie ZTM Gdańsk (bsk.json)');
{
  // Feed bywa pusty (stan z 2026-10-15): pusta lista to nie błąd parsera.
  expect('puste komunikaty', parseGdanskBsk('{"data_wygenerowania":"2026-10-15 19:26:04","komunikaty":[]}'), []);
  const json = JSON.stringify({
    data_wygenerowania: '2026-10-15 08:00:00',
    komunikaty: [
      {
        title: 'Zablokowany przejazd na Podwalu Przedmiejskim',
        tresc: 'Tramwaje linii 8, 9 i 11 stoją w obu kierunkach.',
        url: 'https://ztm.gda.pl/komunikaty/blokada,a,11950',
        data: '2026-10-15 08:05:00',
        lineNumbers: ['8', '9', '11'],
      },
    ],
  });
  const items = parseGdanskBsk(json);
  expect('jeden komunikat', items.length, 1);
  expect('awaria zawsze pilna', items[0].urgent, true);
  expect('linie z pozycji', items[0].lines, ['8', '9', '11']);
  expect('treść z pola tresc', items[0].description.includes('stoją'), true);
  expect('śmieciowy JSON to pusto', parseGdanskBsk('nie json'), []);
}

describe('Numery linii Gdańsk bez lineNumbers (fallback)');
{
  const znt = (title: string) =>
    JSON.stringify({ results: [{ title, summary: 'info', url: 'https://ztm.gda.pl/x', publishFrom: '2026-10-15 08:00:00' }] });
  expect(
    'N4 z tytułu',
    parseGdanskZnt(znt('Utrudnienia na linii N4')).map((i) => i.lines),
    [['N4']],
  );
  expect(
    'M32 z tytułu',
    parseGdanskZnt(znt('M32, 132 i 307: zmiany')).map((i) => i.lines),
    [['M32', '132', '307']],
  );
  expect(
    '„18 października” to nie linia',
    parseGdanskZnt(znt('Mecz 18 października, dodatkowe kursy 138')).map((i) => i.lines),
    [['138']],
  );
  expect(
    'data kropkowana to nie linie',
    parseGdanskZnt(znt('Od 14.10 zmiany na linii 149')).map((i) => i.lines),
    [['149']],
  );
  expect(
    'godzina to nie linia',
    parseGdanskZnt(znt('Utrudnienia od 19:30 na linii 138')).map((i) => i.lines),
    [['138']],
  );
  expect(
    'sufiks słupka („03”) to nie linia',
    parseGdanskZnt(znt('Przystanek Oliwa PKP 03 tymczasowo przeniesiony, dotyczy 117')).map((i) => i.lines),
    [['117']],
  );
}

describe('Tryb linii: tramwaje, trolejbusy, nocne i zastępcze');
{
  expect('klasyfikacja route_type 0', classifyTransitMode(0, '8'), 'tram');
  expect('klasyfikacja route_type 11 (trolejbus)', classifyTransitMode(11, '25'), 'trolleybus');
  expect('klasyfikacja route_type 2 (SKM)', classifyTransitMode(2, '59606'), 'train');
  expect('8 to tramwaj', inferTransitMode(undefined, '8', 'trojmiasto'), 'tram');
  expect('12 to tramwaj', inferTransitMode(undefined, '12', 'trojmiasto'), 'tram');
  expect('25 to trolejbus', inferTransitMode(undefined, '25', 'trojmiasto'), 'trolleybus');
  expect('33 to trolejbus', inferTransitMode(undefined, '33', 'trojmiasto'), 'trolleybus');
  expect('710 to trolejbus', inferTransitMode(undefined, '710', 'trojmiasto'), 'trolleybus');
  expect('723 to trolejbus', inferTransitMode(undefined, '723', 'trojmiasto'), 'trolleybus');
  expect('N4 (nocny) to autobus', inferTransitMode(undefined, 'N4', 'trojmiasto'), 'bus');
  expect('T9 (zastępczy) to autobus', inferTransitMode(undefined, 'T9', 'trojmiasto'), 'bus');
  expect('M32 to autobus', inferTransitMode(undefined, 'M32', 'trojmiasto'), 'bus');
  expect('138 to autobus', inferTransitMode(undefined, '138', 'trojmiasto'), 'bus');
  expect('25 we Wrocławiu to tramwaj (heurystyka 1–33)', inferTransitMode(undefined, '25', 'wroclaw'), 'tram');
  expect('trolejbus ma stałą zieleń', getLineColors('25', undefined, 'trojmiasto').bg, '#2E7D32');
  expect('tramwaj 8 nie jest busem', getLineColors('8', undefined, 'trojmiasto').isTram, true);
}

describe('Podpowiedzi onboardingu per-miasto');
{
  // Regresja: bez gałęzi dla trojmiasto hinty spadały na adresy Wrocławia.
  expect('pl dom', pl.onboarding.slotHomeHint('trojmiasto'), 'np. Długa 12');
  expect('pl praca', pl.onboarding.slotWorkHint('trojmiasto'), 'np. Galeria Bałtycka');
  expect('pl uczelnia', pl.onboarding.slotUniHint('trojmiasto'), 'np. UG');
  for (const [lang, dict] of [['pl', pl], ['en', en], ['de', de], ['uk', uk]] as const) {
    expect(
      `${lang}: trojmiasto nie dziedziczy Wrocławia`,
      dict.onboarding.slotHomeHint('trojmiasto') !== dict.onboarding.slotHomeHint('wroclaw'),
      true,
    );
  }
}

describe('Treść artykułu ztm.gda.pl (tytuł + lead + treść)');
{
  // Struktura 1:1 z realnej strony: h2.article-title, div.article-summary,
  // div.article-content i sidebar div.menu-right z innymi komunikatami.
  const html = `<html><body><main class="flex-fill"><div id="main" class="container">
<div class="caption crumbes"><ul><li><a href="https://ztm.gda.pl">Strona Główna</a></li></ul></div>
<div class="article"><div class="row"><div class="col-lg-9">
<div class="row"><div class="col"><h2 class="article-title">Linie 8, 9, 11: zmiany na Podwalu</h2></div></div>
<div class="row"><div class="col-12"><div class="article-summary mt-3">Od poniedziałku tramwaje pojadą objazdem.</div></div></div>
<div class="row"><div class="col"><div class="article-content mt-3"><p>Pierwszy akapit treści.</p><p>Drugi akapit treści.</p></div></div></div>
</div><div class="col-lg-3"><div class="menu-right sticky-top"><ul><li><a href="https://ztm.gda.pl/komunikaty/inny,a,1"><span>Inny komunikat z listy</span></a></li></ul></div></div>
</div></div></div></main></body></html>`;
  const blocks = extractArticleBlocks(html, 'https://ztm.gda.pl/komunikaty/linie-8-9-11-zmiany,a,11920');
  expect('tytuł jako nagłówek', blocks[0], { kind: 'h', text: 'Linie 8, 9, 11: zmiany na Podwalu' });
  expect('lead jako akapit', blocks[1], { kind: 'p', text: 'Od poniedziałku tramwaje pojadą objazdem.' });
  expect('dwa akapity treści', blocks.slice(2).map((b) => b.text), ['Pierwszy akapit treści.', 'Drugi akapit treści.']);
  expect('bez sidebara', blocks.some((b) => b.text.includes('Inny komunikat')), false);
  // Puste article-content (częsty stan: sam lead niesie komunikat).
  const leadOnly = html.replace(/<div class="article-content[^]*$/s, '</div>');
  const leadBlocks = extractArticleBlocks(leadOnly, 'https://ztm.gda.pl/komunikaty/x,a,1');
  expect('sam lead to dwa bloki', leadBlocks.length, 2);
}

console.log(`\n${'='.repeat(52)}`);
if (failures.length === 0) {
  console.log(`WSZYSTKO OK — ${passed} asercji`);
  process.exit(0);
}
console.log(`${failures.length} NIEUDANYCH z ${passed + failures.length}:`);
for (const f of failures) console.log(`  - ${f}`);
process.exit(1);
