/**
 * Sprawdzenie rankingu „Ostatnich miejsc" (issue #2 i #11).
 *
 * Uruchomienie: `npm run check:smart-rank`
 *
 * To nie jest framework testowy, tylko jeden plik z asercjami — tak samo jak
 * `check:notifications`. Powód jest konkretny: „Ostatnie miejsca" to NIE jest
 * historia wyszukiwania, tylko ranking nawyków, a przez długi czas ranking
 * wyglądał poprawnie, a był chronologiczny. `recordTripSearch` kasował każdy
 * poprzedni wpis o tym samym celu, więc `weeklyCount`/`totalCount` zawsze
 * wynosiły 1, a decydował wyłącznie „kiedy ostatnio" (recencyBoost 0–8 pkt
 * przy 1,5 pkt za każde sprawdzenie).
 *
 * Na realnym przebiegu: pięć wyjazdów do domu z Polbudu w ciągu miesiąca
 * przegrywało z jednym sprawdzeniem „Galeria" z rana, bo ten świeży wpis
 * dostawał 7,5 pkt, a dom — 6,9. Teraz nawyk waży 10 pkt za sprawdzenie.
 *
 * Każdy przypadek poniżej to regression guard na jeden z tych błędów.
 * Uruchamia się przez `tsx`, więc nie potrzebuje konfiguracji testowej.
 */

import {
  CLUSTER_RADIUS_M,
  EXCLUSION_RADIUS_M,
  FALLBACK_TRIP_MIN,
  REPEAT_GAP_MS,
  mergeTripSearch,
  rankSmartDestinations,
  scoreCandidate,
  tripUses,
  typicalDurationMin,
  findTripPair,
  type TripDestinationInput,
  type TripHistoryItem,
} from '../src/services/smartRanking';
import type { SavedPlace } from '../src/types/models';

// ─── Framework asercji ─────────────────────────────────────────────────────

let passed = 0;
const failures: string[] = [];
let section = '';

function describe(name: string): void {
  section = name;
  console.log(`\n— ${name}`);
}

function expect<T>(label: string, got: T, want: T): void {
  if (got === want) {
    passed++;
    console.log(`   ok    ${label} = ${JSON.stringify(got)}`);
    return;
  }
  failures.push(`${section} → ${label}: ${JSON.stringify(got)} ≠ ${JSON.stringify(want)}`);
  console.log(`   FAIL  ${label} = ${JSON.stringify(got)} (oczekiwano ${JSON.stringify(want)})`);
}

/** Tablice po ludzku: `===` porównuje referencje, a tu chodzi o treść. */
function expectList(label: string, got: string[], want: string[]): void {
  expect(label, got.join(' → '), want.join(' → '));
}

function expectTrue(label: string, got: boolean): void {
  expect(label, got, true);
}

// ─── Dane testowe ──────────────────────────────────────────────────────────

const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const NOW = Date.UTC(2026, 8, 28, 8, 0, 0);

// Polibuda, dom (Swojczyce), galeria, Rynek, siłownia.
const PWR = { lat: 51.1079, lon: 17.0617 };
const HOME = { lat: 51.1085, lon: 17.1021 };
const MALL = { lat: 51.1015, lon: 17.0352 };
const MARKET = { lat: 51.1079, lon: 17.0385 };
const GYM = { lat: 51.1181, lon: 16.9946 };
const WORK = { lat: 51.0938, lon: 17.0196 };

function dest(id: string, title: string, at: { lat: number; lon: number }): TripDestinationInput {
  return { id, title, lat: at.lat, lon: at.lon };
}

const home = dest('swojczycka', 'Dom', HOME);
const mall = dest('galeria', 'Galeria', MALL);
const market = dest('rynek', 'Rynek', MARKET);
const gym = dest('magnolia', 'Siłownia', GYM);

/** Historia z jednego miejsca: `count` sprawdzeń tego samego celu. */
function historyFrom(
  origin: { lat: number; lon: number },
  target: TripDestinationInput,
  count: number,
  lastSeen: number,
  durationMin = 18,
): TripHistoryItem {
  return {
    id: `t-${target.id}-${origin.lat}`,
    origin_title: 'Polibuda',
    origin_lat: origin.lat,
    origin_lon: origin.lon,
    dest_id: target.id,
    dest_title: target.title,
    dest_address: `${target.title}, Wrocław`,
    dest_lat: target.lat,
    dest_lon: target.lon,
    duration_min: durationMin,
    timestamp: lastSeen,
    uses: count,
  };
}

const titles = (list: { title: string }[]): string[] => list.map((d) => d.title);

// ─── Zapis sprawdzenia trasy ───────────────────────────────────────────────

describe('mergeTripSearch: powtórka tej samej pary');
{
  const once = mergeTripSearch([], PWR.lat, PWR.lon, 'Polibuda', home, 22, NOW);
  expect('nowa para = jeden wpis', once.length, 1);
  expect('uses zaczyna od 1', tripUses(once[0]), 1);
  expect('zmierzony czas dojazdu wchodzi do wpisu', once[0].duration_min, 22);

  // Regression: drugi zapis tej samej trasy w ciągu minuty to to samo
  // sprawdzenie (ekran połączeń odpala zapytanie drugi raz), nie drugie użycie.
  const again = mergeTripSearch(once, PWR.lat, PWR.lon, 'Polibuda', home, 22, NOW + 1000);
  expect('nie przyrośnie drugi wpis', again.length, 1);
  expect('powtórka nie zwiększa uses', tripUses(again[0]), 1);
  expect('powtórka odświeża czas', again[0].timestamp, NOW + 1000);
  expect('powtórka bierze nowy pomiar', again[0].duration_min, 22);

  const later = mergeTripSearch(again, PWR.lat, PWR.lon, 'Polibuda', home, 24, NOW + 2 * HOUR);
  expect('po godzinie to już nowe sprawdzenie', tripUses(later[0]), 2);
  expect('czas dojazdu uśredniony', later[0].duration_min, 23);
}

describe('mergeTripSearch: to samo miejsce z innego startu');
{
  // Regression: stary kod kasował wszystkie wpisy o tym samym celu, więc
  // jedno sprawdzenie „do domu" z Rynku gasiło nawyk „do domu" z Polbudu.
  let history = mergeTripSearch([], PWR.lat, PWR.lon, 'Polibuda', home, 22, NOW - 6 * DAY);
  history = mergeTripSearch(history, PWR.lat, PWR.lon, 'Polibuda', home, 22, NOW - 4 * DAY);
  history = mergeTripSearch(history, MARKET.lat, MARKET.lon, 'Rynek', home, 18, NOW - 2 * HOUR);
  expect('oba nawyki zostają w historii', history.length, 2);
  expect('oba to ten sam cel', history.filter((t) => t.dest_id === 'swojczycka').length, 2);

  const fromPwr = rankSmartDestinations(history, [], PWR.lat, PWR.lon, NOW);
  expectTrue('z Polbudy widać Dom', fromPwr.some((d) => d.id === 'swojczycka'));
  const fromMarket = rankSmartDestinations(history, [], MARKET.lat, MARKET.lon, NOW);
  expect('z Rynku widać swoje (uses = 1)', fromMarket[0].frequency, 1);
}

describe('mergeTripSearch: to samo miejsce z innymi współrzędnymi');
{
  // Geokoder potrafi przesunąć punkt o 200 m między wersjami danych, a
  // użytkownik może też wybrać tę samą nazwę z innego miejsca. Sam promień
  // 150 m wtedy nie wystarczy — liczy się jeszcze id i tytuł.
  const history = [historyFrom(PWR, home, 3, NOW - 2 * DAY, 22)];
  const driftedById = dest('swojczycka', 'Dom (Swojczycka 41)', { lat: HOME.lat + 0.002, lon: HOME.lon });
  const mergedById = mergeTripSearch(history, PWR.lat, PWR.lon, 'Polibuda', driftedById, 22, NOW);
  expect('ten sam id wystarczy', mergedById.length, 1);
  expect('uses policzone', tripUses(mergedById[0]), 4);

  const mallHistory = [historyFrom(PWR, mall, 3, NOW - 2 * DAY, 12)];
  const sameTitle = dest('inny-id', 'Galeria', { lat: MALL.lat + 0.002, lon: MALL.lon });
  expect('ta sama nazwa wystarczy', mergeTripSearch(mallHistory, PWR.lat, PWR.lon, 'Polibuda', sameTitle, 12, NOW).length, 1);

  // A różne id, różna nazwa i 200 m — to już inne miejsce.
  const other = dest('osobny', 'Sklep', { lat: HOME.lat + 0.002, lon: HOME.lon });
  expect('inny cel zostaje osobno', mergeTripSearch(history, PWR.lat, PWR.lon, 'Polibuda', other, 22, NOW).length, 2);
}

describe('Ranking: wykluczenie miejsca kontekstowego');
{
  // Stoimy przy przypiętym „Praca", a w historii jest wpis o tym samym id, ale
  // ze współrzędnymi 2 km dalej. Promień 250 m go nie wyłapie — wyłapuje go
  // dopasowanie do miejsca kontekstowego.
  const work: SavedPlace = {
    id: 'pin-work',
    name: 'Praca',
    icon: 'work',
    placeId: 'sky-tower',
    address: 'Powstańców Śląskich 95',
    lat: WORK.lat,
    lon: WORK.lon,
  };
  const stale = historyFrom(PWR, dest('sky-tower', 'Praca (budynek B)', { lat: WORK.lat + 0.02, lon: WORK.lon }), 6, NOW - HOUR, 20);
  expectList('miejsce kontekstowe wypada mimo oddalonych współrzędnych', titles(rankSmartDestinations([stale], [work], WORK.lat, WORK.lon, NOW)), []);
  // 2 km dalej od tego przypiętego miejsca ten sam wpis jest już normalnym celem.
  expectList('z daleka wraca do listy', titles(rankSmartDestinations([stale], [work], PWR.lat, PWR.lon, NOW)), ['Praca (budynek B)']);
}

describe('Ranking: dwa przypięte miejsca blisko siebie zostają dwoma');
{
  // Świadoma decyzja #45: dwa pin-y 100 m od siebie to dwie różne sprawy.
  const a: SavedPlace = { id: 'pin-a', name: 'Siłownia', icon: 'gym', placeId: 'gym-a', address: 'Legnicka 58', lat: GYM.lat, lon: GYM.lon };
  const b: SavedPlace = { id: 'pin-b', name: 'Basen', icon: 'swimming', placeId: 'gym-b', address: 'Legnicka 60', lat: GYM.lat + 0.0006, lon: GYM.lon + 0.0006 };
  // Przy identycznym wyniku (oba bez historii) kolejność rozstrzyga tytuł —
  // deterministycznie, żeby wiersze nie skakały między renderami.
  expectList('dwa pin-y = dwa wiersze', titles(rankSmartDestinations([], [a, b], PWR.lat, PWR.lon, NOW)), ['Basen', 'Siłownia']);
}

describe('mergeTripSearch: cel dwa metry od celu');
{
  // Ten sam budynek pod dwoma id (wyszukiwarka vs przypięte miejsce) to ten
  // sam nawyk — inaczej limit wyrzuci prawdziwą destynację (#45).
  const near = dest('osm:node/1', 'Dom (Swojczycka 41)', { lat: HOME.lat + 0.00005, lon: HOME.lon });
  const history = mergeTripSearch([], PWR.lat, PWR.lon, 'Polibuda', home, 22, NOW - 3 * DAY);
  const merged = mergeTripSearch(history, PWR.lat, PWR.lon, 'Polibuda', near, 22, NOW - 2 * HOUR);
  expect('to jeden wpis, nie dwa', merged.length, 1);
  expect('uses policzone razem', tripUses(merged[0]), 2);
}

describe('mergeTripSearch: śmieci z deep linka');
{
  // `Number('abc')` = NaN, a NaN przechodził dawny `typeof === 'number'`.
  // Wpis z NaN nigdy nie przechodził żadnego promienia w rankingu, więc
  // znikal bez śladu — lepiej nie zapisać go wcale.
  const history = mergeTripSearch([], PWR.lat, PWR.lon, 'Polibuda', home, 22, NOW);
  expect(
    'NaN współrzędne celu nie trafia do historii',
    mergeTripSearch(history, PWR.lat, PWR.lon, 'Polibuda', { id: 'x', title: 'X', lat: NaN, lon: 17 }, undefined, NOW + HOUR).length,
    1,
  );
  expect(
    'NaN współrzędne startu nie trafia do historii',
    mergeTripSearch(history, NaN, 17, 'Polibuda', mall, undefined, NOW + HOUR).length,
    1,
  );
  expect('historia bez zmian', history[0].dest_title, 'Dom');
}

describe('mergeTripSearch: klastr startów w promieniu 1,6 km');
{
  // Dwa wpisy o tym samym celu: nowszy ma uses = 1, starszy mocniejszy (uses = 5).
  const older: TripHistoryItem = { ...historyFrom(PWR, home, 5, NOW - 5 * DAY, 22), id: 'strong' };
  const newer: TripHistoryItem = { ...historyFrom(PWR, home, 1, NOW - HOUR, 22), id: 'weak' };
  const history = [newer, older];

  // Regression: `find` brał pierwszy wpis (nowszy, uses = 1), więc licznik +1
  // trafiał do słabego, a mocniejszy nawyk zostawał w tyle.
  const merged = mergeTripSearch(history, PWR.lat, PWR.lon, 'Polibuda', home, 22, NOW + 6 * HOUR);
  const pair = findTripPair(merged, PWR.lat, PWR.lon, home) as TripHistoryItem;
  expect('increment idzie do najmocniejszego', tripUses(pair), 6);
  expect('scalany jest mocniejszy wpis', pair.id, 'strong');
  // Słabszy wpis zostaje w historii (to inna para: inny start), ale ranking
  // widzi jedną destynację: 5 + 1 + 1 (nowe sprawdzenie) = 7 sprawdzeń.
  expect('całość klastra to jedna destynacja', rankSmartDestinations(merged, [], PWR.lat, PWR.lon, NOW + 6 * HOUR)[0].frequency, 7);
  expect('nic nie zniknęło z sumy', 5 + 1 + 1, rankSmartDestinations(merged, [], PWR.lat, PWR.lon, NOW + 6 * HOUR)[0].frequency);

describe('mergeTripSearch: okno powtórki liczy się dla klastra');
{
  // Dwa wpisy o tym samym celu, oba w promieniu 1,6 km: mocniejszy (uses = 6)
  // i ten sprawdzany przed chwilą (uses = 1, minutę temu).
  const history: TripHistoryItem[] = [
    { ...historyFrom(PWR, home, 1, NOW - 60_000, 22), id: 'just-used' },
    {
      ...historyFrom({ lat: PWR.lat + 0.005, lon: PWR.lon + 0.005 }, home, 6, NOW - 2 * HOUR, 22),
      id: 'strong',
    },
  ];
  // Nowe sprawdzenie z klastra minutę po poprzednim to JEDNA akcja użytkownika
  // (dokładnie to, po co jest okno): suma zostaje 7, a nie 8.
  const soon = mergeTripSearch(history, PWR.lat, PWR.lon, 'Polibuda', home, 22, NOW);
  expect('klastr nie dostaje drugiego +1', rankSmartDestinations(soon, [], PWR.lat, PWR.lon, NOW)[0].frequency, 7);
  const later = mergeTripSearch(history, PWR.lat, PWR.lon, 'Polibuda', home, 22, NOW + HOUR);
  expect('po godzinie to nowe sprawdzenie', rankSmartDestinations(later, [], PWR.lat, PWR.lon, NOW + HOUR)[0].frequency, 8);
}

describe('mergeTripSearch: śmieci w historii nie przejmują nawyku');
{
  // Wpis ze śmieciami w starcie: `NaN > 1600` to fałsz, więc bez pilnowania
  // przejąłby każde nowe sprawdzenie jako „najmocniejszy nawyk".
  const garbage: TripHistoryItem = {
    ...historyFrom(PWR, home, 99, NOW - DAY, 22),
    id: 'garbage',
    origin_lat: NaN,
    origin_lon: NaN,
  };
  const history = [garbage, historyFrom(PWR, home, 2, NOW - 3 * DAY, 22)];
  expect('śmieci w promieniu są pomijane', findTripPair(history, PWR.lat, PWR.lon, home)?.id !== 'garbage', true);
  const merged = mergeTripSearch(history, PWR.lat, PWR.lon, 'Polibuda', home, 22, NOW + 6 * HOUR);
  expect('increment idzie do prawdziwego wpisu', tripUses(findTripPair(merged, PWR.lat, PWR.lon, home) as TripHistoryItem), 3);
}
}

describe('tripUses: stare wpisy bez pola');
{
  const legacy: TripHistoryItem = {
    id: 'old',
    origin_title: 'Polibuda',
    origin_lat: PWR.lat,
    origin_lon: PWR.lon,
    dest_id: 'swojczycka',
    dest_title: 'Dom',
    dest_address: 'Swojczycka 41, Wrocław',
    dest_lat: HOME.lat,
    dest_lon: HOME.lon,
    duration_min: 18,
    timestamp: NOW - DAY,
  };
  expect('brak pola = jedno sprawdzenie', tripUses(legacy), 1);
  expect('zero/ujemne nie psują rankingu', tripUses({ ...legacy, uses: 0 }), 1);
  const ranked = rankSmartDestinations([legacy], [], PWR.lat, PWR.lon, NOW);
  expect('stary wpis nadal się pojawia', ranked[0].title, 'Dom');
}

// ─── Ranking ───────────────────────────────────────────────────────────────

describe('Ranking: nawyk bije jednorazową świeżość (#2)');
{
  // Pięć wyjazdów do domu w ciągu miesiąca (ostatni wczoraj) i jedno
  // sprawdzenie galerii dziś rano. Chronologicznie galeria wygrywała.
  const history: TripHistoryItem[] = [
    historyFrom(PWR, home, 5, NOW - DAY, 22),
    historyFrom(PWR, mall, 1, NOW - 2 * HOUR, 12),
  ];
  const ranked = rankSmartDestinations(history, [], PWR.lat, PWR.lon, NOW);
  expectList('kolejność to nawyk, nie data', titles(ranked).slice(0, 2), ['Dom', 'Galeria']);
  expect('częstotliwość z historii', ranked[0].frequency, 5);
  expect('zmierzony czas dojazdu', ranked[0].avgDurationMin, 22);
}

describe('Ranking: świeżość rozstrzyga tylko przy równej liczbie sprawdzeń');
{
  // Wszystkie przypadki trzymają się w oknie 30 dni, żeby wynik zależał od
  // punktacji, a nie od tego, że stary wpis wypadł z filtra. Wcześniejsza
  // wersja tego testu używała 40 dni — przechodziła nawet przy zepsutym gaszeniu.
  const first = (homeUses: number, homeAgeDays: number, mallUses: number, mallAgeHours: number) =>
    rankSmartDestinations(
      [
        historyFrom(PWR, home, homeUses, NOW - homeAgeDays * DAY, 22),
        historyFrom(PWR, mall, mallUses, NOW - mallAgeHours * HOUR, 12),
      ],
      [],
      PWR.lat,
      PWR.lon,
      NOW,
    )[0].title;

  expect('6 starych bije 2 świeże', first(6, 20, 2, 2), 'Dom');
  expect('przy równych liczbach wygrywa świeższy', first(2, 20, 2, 2), 'Galeria');
  expect('trzy świeże biją dwa stare', first(2, 20, 3, 2), 'Galeria');
  // Gaszenie jest skończone, nie liniowe: 25 dni to ~2 pkt, a jeden nawyk to 10.
  expect('gaszenie nie przerasta jednego sprawdzenia', first(3, 25, 2, 2), 'Dom');
}

describe('Ranking: nawyk spoza okna miesiąca wypada');
{
  // Osobno, bo to decyzja projektowa (nawyk porzucony miesiąc temu to nie
  // jest nawyk), a nie gaszenie: wpis w ogóle nie wchodzi do rankingu.
  const history = [
    historyFrom(PWR, home, 6, NOW - 40 * DAY, 22),
    historyFrom(PWR, mall, 1, NOW - 2 * HOUR, 12),
  ];
  const ranked = rankSmartDestinations(history, [], PWR.lat, PWR.lon, NOW);
  expectList('stary nawyk znika', titles(ranked), ['Galeria']);
}

describe('Ranking: te same cele z różnych startów to jeden cel');
{
  const history = [
    historyFrom(PWR, gym, 4, NOW - DAY, 18),
    historyFrom({ lat: PWR.lat + 0.004, lon: PWR.lon + 0.004 }, gym, 3, NOW - 3 * DAY, 18),
    historyFrom(PWR, market, 1, NOW - HOUR, 10),
  ];
  const ranked = rankSmartDestinations(history, [], PWR.lat, PWR.lon, NOW);
  expectList('brak duplikatu celu', titles(ranked), ['Siłownia', 'Rynek']);
  // Regression: `max` gubiło wiedzę — z okolicy to jeden nawyk (promień 1,6 km),
  // więc 4 + 3 sprawdzenia to siedem, a nie cztery.
  expect('sprawdzenia z klastra sumują się', ranked[0].frequency, 7);
}

describe('Ranking: dwa różne cele blisko siebie zostają dwoma wierszami');
{
  // Świadome ograniczenie, nie przypadek: ranking rozpoznaje cele po kluczu
  // (`id` albo tytuł), a nie po współrzędnych. Dwa różne miejsca 140 m od
  // siebie to dwie różne sprawy — tak #45 świadomie nie scala dwóch przypiętych
  // miejsc. Ciche złączenie dwóch wierszy gubiłoby cel, o którym nikt nie prosił.
  const neighbour = dest('plac-wilka', 'Plac Włókien', { lat: GYM.lat + 0.001, lon: GYM.lon + 0.0005 });
  const ranked = rankSmartDestinations(
    [historyFrom(PWR, gym, 4, NOW - DAY, 18), historyFrom(PWR, neighbour, 1, NOW - HOUR, 6)],
    [],
    PWR.lat,
    PWR.lon,
    NOW,
  );
  expectList('oba wiersze zostają', titles(ranked), ['Siłownia', 'Plac Włókien']);
}

describe('Ranking: stare wpisy bez `uses` liczą się po 1');
{
  // Dane sprzed pola `uses`: każdy wpis to jedno sprawdzenie, więc kandydat
  // zbiera z nich licznik, a nie datę.
  const legacy: TripHistoryItem[] = [
    { ...historyFrom(PWR, home, 1, NOW - 3 * DAY, 22), uses: undefined, dest_id: 'dom-1', dest_title: 'Dom' },
    { ...historyFrom(PWR, home, 1, NOW - 5 * DAY, 24), uses: undefined, dest_id: 'dom-1', dest_title: 'Dom' },
  ];
  const ranked = rankSmartDestinations(legacy, [], PWR.lat, PWR.lon, NOW);
  expect('jeden wiersz z dwóch starych wpisów', ranked.length, 1);
  expect('stare wpisy dają po 1', ranked[0].frequency, 2);
  expect('czas dojazdu to średnia ważona', ranked[0].avgDurationMin, 23);
}

describe('Ranking: przypięte miejsce i wykluczenia');
{
  const places: SavedPlace[] = [
    {
      id: 'pin-1',
      name: 'Dom',
      icon: 'home',
      placeId: 'swojczycka',
      address: 'Swojczycka 41, Wrocław',
      lat: HOME.lat,
      lon: HOME.lon,
    },
    {
      id: 'pin-2',
      name: 'Siłownia',
      icon: 'gym',
      placeId: 'magnolia',
      address: 'Magnolia Park, Legnicka 58',
      lat: GYM.lat,
      lon: GYM.lon,
    },
  ];
  // Stoimy na Polbududzie i mamy tam nawyk do domu (5) i do galerii (1).
  const history = [
    historyFrom(PWR, home, 5, NOW - DAY, 22),
    historyFrom(PWR, mall, 1, NOW - HOUR, 12),
  ];
  const ranked = rankSmartDestinations(history, places, PWR.lat, PWR.lon, NOW);
  expectList('przypięte miejsce wchodzi do rankingu', titles(ranked), ['Dom', 'Siłownia', 'Galeria']);
  expect('przypięte miejsce bez historii ma fallback', ranked[1].avgDurationMin, FALLBACK_TRIP_MIN);
  expect('przypięty cel dostaje częstotliwość 1', ranked[1].frequency, 1);

  // Stoimy W domu: dom jest tu miejscem kontekstowym, więc nie proponujemy
  // powrotu do domu.
  const atHome = rankSmartDestinations(history, places, HOME.lat, HOME.lon, NOW);
  expectTrue('nie proponujemy miejsca, w którym stoimy', !atHome.some((d) => d.id === 'swojczycka'));

  // To samo bez przypiętych miejsc: wyklucza to promień 250 m wokół użytkownika,
  // a nie „miejsce kontekstowe" (to drugie pilnuje tylko przypiętych pinów).
  const bystander = dest('dinozaur', 'Kino Dinozaur', { lat: HOME.lat + 0.0004, lon: HOME.lon + 0.0004 });
  const withBystander = [
    historyFrom(PWR, home, 5, NOW - DAY, 22),
    historyFrom(PWR, mall, 1, NOW - HOUR, 12),
    historyFrom(PWR, bystander, 4, NOW - HOUR, 5),
  ];
  expectList(
    'cel 100 m od nas wypada (promień 250 m)',
    titles(rankSmartDestinations(withBystander, [], HOME.lat, HOME.lon, NOW)),
    ['Galeria'],
  );

  // Ten sam budynek z historii i z przypięcia = jeden wiersz (#45). Tu klucze są
  // RÓŻNE — historia trzyma id z wyszukiwarki, przypięcie ma własny token — więc
  // scalanie musi zadziałać po współrzędnych, a nie po kluczu.
  const searchId = dest('osm:node/99887766', 'Magnolia Park', { lat: GYM.lat, lon: GYM.lon });
  const withPin = [...history, historyFrom(PWR, searchId, 3, NOW - HOUR, 18)];
  const merged = rankSmartDestinations(withPin, places, PWR.lat, PWR.lon, NOW, 4);
  expectList('bez duplikatu po współrzędnych', titles(merged), ['Dom', 'Siłownia', 'Galeria']);
  expect('scalony wiersz bierze nazwę i id z przypięcia', merged[1].id, 'magnolia');
}

describe('Ranking: pusto znaczy pusto');
{
  expect('bez historii i bez przypiętych miejsc lista pusta', rankSmartDestinations([], [], PWR.lat, PWR.lon, NOW).length, 0);
  // Użytkownik dopiero zaczął: bierzemy globalną historię, żeby sekcja
  // „Ostatnie miejsca" nie była pusta.
  const history = [historyFrom(MARKET, home, 2, NOW - DAY, 22)];
  expectTrue('bez przejazdów z okolicy bierzemy globalne', rankSmartDestinations(history, [], PWR.lat, PWR.lon, NOW).length > 0);
  // Historia sprzed dwóch miesięcy i tak ma sens, dopóki nie ma bliższych.
  const stale = [historyFrom(MARKET, home, 2, NOW - 60 * DAY, 22)];
  expect('stara historia wciąż pokazuje cel', rankSmartDestinations(stale, [], PWR.lat, PWR.lon, NOW)[0].title, 'Dom');
}

describe('Ranking: limity i promienie');
{
  const many = ['a', 'b', 'c', 'd', 'e'].map((id, i) =>
    historyFrom(PWR, dest(id, `Cel ${id}`, { lat: 51.11 + i * 0.01, lon: 17.07 }), i + 1, NOW - HOUR, 15),
  );
  expect('limit domyślny to 4', rankSmartDestinations(many, [], PWR.lat, PWR.lon, NOW).length, 4);
  expect('limit jest przekazywany', rankSmartDestinations(many, [], PWR.lat, PWR.lon, NOW, 2).length, 2);

  // Wpis sprzed miesiąca, ale start 5 km od użytkownika — wypada, bo w okolicy
  // jest coś innego.
  const near = [historyFrom(PWR, market, 1, NOW - HOUR, 10)];
  const far = [historyFrom({ lat: 51.15, lon: 17.2 }, home, 9, NOW - HOUR, 22)];
  expectList('daleki start wypada z rankingu', titles(rankSmartDestinations([...far, ...near], [], PWR.lat, PWR.lon, NOW)), ['Rynek']);
  expect('promień klastera to 1600 m', CLUSTER_RADIUS_M, 1600);
  expect('promień wykluczenia to 250 m', EXCLUSION_RADIUS_M, 250);
}

describe('Typowy czas dojazdu (mediana)');
{
  const conns = (...minutes: number[]) => minutes.map((durationMin) => ({ durationMin }));
  expect('brak kursów = brak pomiaru', typicalDurationMin(conns()), undefined);
  expect('nieparzysta to środkowy', typicalDurationMin(conns(30, 10, 20)), 20);
  // Regression: dla dwóch kursów „mediana" brała ten dłuższy (20 zamiast 15).
  expect('parzysta to średnia z dwóch środkowych', typicalDurationMin(conns(10, 20)), 15);
  expect('jeden kurs', typicalDurationMin(conns(7)), 7);
  expect('najdłuższy nie ciągnie', typicalDurationMin(conns(12, 12, 12, 180)), 12);
}

describe('Punktacja: monotoniczność');
{
  const fresh = NOW - HOUR;
  expect('więcej sprawdzeń = więcej punktów', scoreCandidate(3, fresh, false, NOW) > scoreCandidate(2, fresh, false, NOW), true);
  expect('przypięte miejsce punktuje', scoreCandidate(1, fresh, true, NOW) > scoreCandidate(1, fresh, false, NOW), true);
  expect('wiek gasi, ale nie odwraca', scoreCandidate(4, NOW - 30 * DAY, false, NOW) > scoreCandidate(2, fresh, false, NOW), true);
  // Samo gaszenie trzeba sprawdzić wprost na punktacji: przy równej liczbie
  // sprawdzeń o wyniku decyduje gaszenie, ale wypadałoby wtedy to samo, co
  // tie-break „nowszy wyżej", więc test kolejności tego nie wyłapie.
  expect('starszy kandydat ma niżej', scoreCandidate(2, NOW - 20 * DAY, false, NOW) < scoreCandidate(2, fresh, false, NOW), true);
  expect('nawet bardzo stary ma niżej niż świeży', scoreCandidate(1, NOW - 90 * DAY, false, NOW) < scoreCandidate(1, fresh, false, NOW), true);
  expect('gaszone, ale nie zerowe', scoreCandidate(1, NOW - 90 * DAY, false, NOW) > 1 * 10, true);
  expect('okno powtórki to 5 minut', REPEAT_GAP_MS, 5 * MIN);
}

// ─── Podsumowanie ─────────────────────────────────────────────────────────

console.log(`\n${'='.repeat(52)}`);
if (failures.length === 0) {
  console.log(`WSZYSTKO OK — ${passed} asercji`);
  process.exit(0);
}
console.log(`${failures.length} NIEUDANYCH z ${passed + failures.length}:`);
for (const f of failures) console.log(`  - ${f}`);
process.exit(1);
