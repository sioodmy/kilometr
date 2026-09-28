/**
 * Sprawdzenie logiki podróży dla powiadomień.
 *
 * Uruchomienie: `npm run check:notifications`
 *
 * To nie jest framework testowy, tylko jeden plik z asercjami. Powód jest
 * konkretny: logika powiadomień (faza podróży, ile do celu, następny
 * przystanek, dobór alertu) jest czysta i liczy się na danych z RAPTOR-a,
 * a wszystko, co wokół niej, to natywne moduły i komponenty. Pierwsza
 * wersja powiadomień powstała „na oko" i przy pierwszym uruchomieniu tego
 * pliku wyszło z niej dziewięć błędów — m.in. powiadomienie krzyczące
 * „idź na przystanek", kiedy użytkownik już tam stał, i licznik pokazujący
 * 24 godziny dojazdu o 23:58 oglądanego o 00:03.
 *
 * Każdy przypadek poniżej to regression guard na któryś z tych błędów.
 * Uruchamia się przez `tsx`, więc nie potrzebuje konfiguracji testowej.
 */

import { computeTripProgress } from '../src/services/notifications/tripProgress';
import { buildTripCopy, buildActivityProps, buildNativeState } from '../src/services/notifications/content';
import {
  matchTrackedConnection,
  resolveTrackedConnection,
} from '../src/services/notifications/planMatch';
import { countdownText, toAbsoluteMs, untilText } from '../src/services/notifications/format';
import type { Connection, Leg, LegStop } from '../src/types/models';

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

function expectClose(label: string, got: number, want: number, epsilon = 0.01): void {
  if (Math.abs(got - want) <= epsilon) {
    passed++;
    console.log(`   ok    ${label} ≈ ${got.toFixed(3)}`);
    return;
  }
  failures.push(`${section} → ${label}: ${got} ≠ ${want} (±${epsilon})`);
  console.log(`   FAIL  ${label} = ${got} (oczekiwano ${want})`);
}

function expectWithin(label: string, got: number, min: number, max: number): void {
  if (got >= min && got <= max) {
    passed++;
    console.log(`   ok    ${label} = ${got}`);
    return;
  }
  failures.push(`${section} → ${label}: ${got} poza [${min}, ${max}]`);
  console.log(`   FAIL  ${label} = ${got} (oczekiwano ${min}…${max})`);
}

function dump(label: string, conn: Connection, at: Date): ReturnType<typeof computeTripProgress> {
  const p = computeTripProgress(conn, { now: at });
  const copy = buildTripCopy(p, conn);
  console.log(
    `   ${label.padEnd(22)} ${p.phase.padEnd(9)} postęp=${p.progress.toFixed(2)} ` +
      `eta=${p.etaMin.toFixed(0)}min zostało=${p.stopsLeft} następny=${p.nextStop ?? '-'} ` +
      `przystanek=${p.stopName}\n` +
      `      T: ${copy.title}\n      S: ${copy.subtitle}\n      B: ${copy.body}\n` +
      `      licznik→${hhmm(copy.countdownAtMs)} (${copy.countdownCaption}) ` +
      `pasek=${copy.progressPermille} widoczny=${copy.showProgress}`,
  );
  return p;
}

// ─── Dane testowe ─────────────────────────────────────────────────────────

const STOPS = [
  'HALDENA', 'GÓRNOŚLĄSKA', 'GALERIA DOMINIKAŃSKA', 'ŚCIEGNY', 'KAZIMIERZA',
  'DWORZEC GŁÓWNY', 'OPACKA', 'ZACHEBNIA',
];
const fullStops = (): LegStop[] =>
  STOPS.map((name, i) => ({ stopId: `s${i}`, name, seq: i + 1 }));

const at = (h: number, m: number) => new Date(2026, 0, 15, h, m, 0);
const hhmm = (ms: number) => new Date(ms).toTimeString().slice(0, 5);

const leg = (over: Partial<Leg>): Leg => ({
  id: 'l',
  mode: 'tram',
  line: '4',
  direction: 'BISKUPIN',
  fromStop: 'HALDENA',
  toStop: 'ZACHEBNIA',
  departAt: '14:10',
  arriveAt: '14:25',
  stopsCount: 7,
  live: true,
  ...over,
});

const walk = (from: string, to: string, dep: string, arr: string, m: number): Leg =>
  leg({
    id: `w-${from}`,
    mode: 'walk',
    line: undefined,
    direction: undefined,
    fromStop: from,
    toStop: to,
    departAt: dep,
    arriveAt: arr,
    stopsCount: 0,
    walkM: m,
    live: false,
  });

const simple: Connection = {
  id: 'conn-1-50400',
  fromTitle: 'Dom',
  toTitle: 'Zachebnia',
  departInMin: 10,
  departureSec: 14 * 3600 + 10 * 60,
  departAt: '14:10',
  arriveAt: '14:25',
  durationMin: 15,
  transfers: 0,
  delayMin: 0,
  live: true,
  legs: [walk('Dom', 'HALDENA', '14:03', '14:10', 320), leg({ id: 't1', tripId: 'trip-1', intermediateStops: fullStops() })],
};

const transfer: Connection = {
  ...simple,
  transfers: 1,
  arriveAt: '14:40',
  durationMin: 30,
  interchange: 'Przesiadka: Rondo',
  legs: [
    leg({ id: 't1', tripId: 'trip-1', toStop: 'ZACHEBNIA', intermediateStops: fullStops() }),
    walk('ZACHEBNIA', 'Rondo', '14:25', '14:28', 180),
    leg({ id: 't2', line: '12', direction: 'LEŚNICA', fromStop: 'Rondo', toStop: 'Leśnica', departAt: '14:30', arriveAt: '14:40', stopsCount: 4, tripId: 'trip-2' }),
  ],
};

const night: Connection = {
  ...simple,
  departureSec: 23 * 3600 + 58 * 60,
  departAt: '23:58',
  arriveAt: '00:12',
  durationMin: 14,
  legs: [
    walk('Dom', 'HALDENA', '23:53', '23:58', 320),
    leg({ id: 't1', tripId: 'trip-1', departAt: '23:58', arriveAt: '00:12', intermediateStops: fullStops() }),
  ],
};

// ─── Formatowanie ─────────────────────────────────────────────────────────

describe('Formatowanie po polsku');
expect('1 minuta', countdownText(60), 'za 1 minutę');
expect('2 minuty', countdownText(120), 'za 2 minuty');
expect('5 minut', countdownText(300), 'za 5 minut');
expect('12 minut', countdownText(700), 'za 12 minut');
expect('tu i teraz', countdownText(20), 'odjazd teraz');
expect('bez „za"', untilText(240), '4 minuty');
expect('godziny', countdownText(2 * 3600), 'za 2 godziny');
expect('jedna godzina', countdownText(3600), 'za 1 godzinę');

describe('Północ: wybieramy wystąpienie najbliższe teraz');
// 23:58 od 00:03 to 23:58 WCZORAJ, nie dzisiaj — inaczej ETA wynosiłoby 24 godziny.
expect('od 00:03 do 23:58 wczoraj', hhmm(toAbsoluteMs(23 * 3600 + 58 * 60, at(0, 3))), '23:58');
expect('od 14:00 do 14:10 dziś', hhmm(toAbsoluteMs(14 * 3600 + 10 * 60, at(14, 0))), '14:10');
expect('od 23:57 do 14:10 dziś (9h wstecz)', hhmm(toAbsoluteMs(14 * 3600 + 10 * 60, at(23, 57))), '14:10');
expect('sekundy z daty jutrzejszej', hhmm(toAbsoluteMs(25 * 3600, at(14, 0))), '01:00');

// ─── Podróż: dojście → oczekiwanie → jazda → przyjazd ────────────────────

describe('Podróż z dojściem pieszo');
let p = dump('14:00 jeszcze w domu', simple, at(14, 0));
expect('faza', p.phase, 'walking');
expect('linia to tramwaj, nie „Pieszo"', p.line, '4');
expect('przystanek docelowy', p.stopName, 'HALDENA');
// Przed startem spaceru nie wiemy, kiedy użytkownik ruszy, więc nie udajemy,
// że postęp dojścia coś znaczy — zostaje sam licznik.
expect('postęp dojścia nieznany', p.approachProgress, null);
expect('bez paska postępu dojścia', buildTripCopy(p, simple).showProgress, false);

p = dump('14:06 prawie na miejscu', simple, at(14, 6));
expect('faza', p.phase, 'walking');
expectWithin('dojście w toku', p.approachProgress ?? -1, 0.4, 0.7);
expect('pasek postępu dojścia widoczny', buildTripCopy(p, simple).showProgress, true);

p = dump('14:09 wciąż idę', simple, at(14, 9));
expect('faza', p.phase, 'walking');
expect('podejście prawie skończone', (p.approachProgress ?? 0) > 0.85, true);

p = dump('14:10 wsiadam', simple, at(14, 10));
expect('faza', p.phase, 'waiting');
// Regression: raportowaliśmy następny przystanek, choć użytkownik już stoi na tym.
expect('bez następnego przystanku', p.nextStop, null);
expect('licznik celuje w odjazd', hhmm(buildTripCopy(p, simple).countdownAtMs), '14:10');

p = dump('14:11 jadę', simple, at(14, 11));
expect('faza', p.phase, 'riding');
// Regression: następny przystanek był przesunięty o jeden, więc tu wychodził
// ten, z którego właśnie ruszyliśmy.
expect('następny przystanek', p.nextStop, 'GÓRNOŚLĄSKA');
expect('pozostało przystanków', p.stopsLeft, 7);

p = dump('14:20 prawie koniec', simple, at(14, 20));
expect('następny przystanek', p.nextStop, 'DWORZEC GŁÓWNY');
expect('pozostało przystanków', p.stopsLeft, 2);

p = dump('14:26 po przyjeździe', simple, at(14, 26));
expect('faza', p.phase, 'arrived');
expect('zero przystanków', p.stopsLeft, 0);
expect('postęp domknięty', p.progress, 1);

// ─── Przejście przez północ ───────────────────────────────────────────────

describe('Podróż przez północ');
p = dump('23:55 przed odjazdem', night, at(23, 55));
expect('licznik celuje w 23:58', hhmm(buildTripCopy(p, night).countdownAtMs), '23:58');
p = dump('00:03 w środku nocy', night, at(0, 3));
// Regression: toAbsoluteMs zakładał „dziś", więc ETA wynosiło 1449 minut.
expect('faza', p.phase, 'riding');
expect('licznik celuje w 00:12', hhmm(buildTripCopy(p, night).countdownAtMs), '00:12');
expectWithin('ETA w minutach', p.etaMin, 5, 12);

// ─── Przesiadka ───────────────────────────────────────────────────────────

describe('Przesiadka');
p = dump('14:12 pierwszy pojazd', transfer, at(14, 12));
expect('faza', p.phase, 'riding');
expect('linia', p.line, '4');

p = dump('14:26 przechodzę', transfer, at(14, 26));
// Regression: licznik celował w pierwszy odjazd (14:10), który minął godzinę temu.
expect('faza', p.phase, 'transfer');
expect('licznik celuje w 14:30', hhmm(buildTripCopy(p, transfer).countdownAtMs), '14:30');
expect('przystanek przesiadki', p.stopName, 'Rondo');
expect('następna linia', p.line, '12');

p = dump('14:31 drugi pojazd', transfer, at(14, 31));
expect('faza', p.phase, 'riding');
expect('linia', p.line, '12');

// ─── Brak listy przystanków ───────────────────────────────────────────────

describe('Odcinek bez listy przystanków');
const noStops: Connection = {
  ...simple,
  arriveAt: '14:40',
  durationMin: 30,
  legs: [simple.legs[0], leg({ id: 't9', line: '12', departAt: '14:10', arriveAt: '14:40', stopsCount: 6 })],
};
p = dump('14:31 bez listy', noStops, at(14, 31));
// Regression: brak sekwencji dawał „0 przystanków, ostatni przystanek".
expect('nie zmyślamy nazwy', p.nextStop, null);
expect('liczymy z hops', p.stopsLeft, 2);

// ─── Pojazd na trasie ─────────────────────────────────────────────────────

describe('Pojazd dopasowany do odcinka');
const live = computeTripProgress(simple, {
  now: at(14, 15),
  vehicle: {
    vehicleId: '4-1', line: '4', lat: 51.1, lon: 17.0, delaySec: 120,
    currentStopName: 'GALERIA DOMINIKAŃSKA', nextStopName: 'ŚCIEGNY',
    updatedAt: Date.now(), matchedTripId: 'trip-1',
  },
});
expect('pojazd rozpoznany', live.vehicleTracked, true);
expect('następny przystanek z GPS', live.nextStop, 'ŚCIEGNY');
expect('opis pozycji zawiera „live"', (live.vehicleLabel ?? '').includes('live'), true);

const wrongVehicle = computeTripProgress(simple, {
  now: at(14, 15),
  vehicle: {
    vehicleId: '9-9', line: '9', lat: 51.1, lon: 17.0, delaySec: 0,
    updatedAt: Date.now(), matchedTripId: 'trip-inny',
  },
});
expect('pojazd innej linii nie pasuje', wrongVehicle.vehicleTracked, false);

// ─── Dopasowanie świeżego planu do śledzonego kursu ───────────────────────

describe('Dopasowanie planu do śledzonego kursu');
const delayed = { ...simple, delayMin: 6, departAt: '14:16', departureSec: 14 * 3600 + 16 * 60 };
// Opóźnienie przesuwa departureSec o 6 minut, więc samo dopasowanie po godzinie
// by nie zadziałało — ratuje trip_id.
expect('ten sam trip_id mimo opóźnienia', matchTrackedConnection([delayed], simple)?.departAt, '14:16');

const noIds = { ...simple, legs: simple.legs.map((l) => ({ ...l, tripId: undefined })) };
const noIdsDelayed = { ...noIds, departAt: '14:16', departureSec: 14 * 3600 + 16 * 60 };
expect('bez trip_id, ale ten sam kurs', matchTrackedConnection([noIdsDelayed], noIds)?.departAt, '14:16');

const other = {
  ...noIds,
  departureSec: 14 * 3600 + 20 * 60,
  legs: [noIds.legs[0], { ...noIds.legs[1], line: '12', fromStop: 'Rondo', departAt: '14:20' }],
};
// Regression: dopasowanie po samym odjeździe potrafiło podmienić kurs.
expect('inny kurs → brak dopasowania', matchTrackedConnection([other], noIds), null);

// ─── Wybór kursu po odświeżeniu planu ─────────────────────────────────────

describe('Wybór kursu po odświeżeniu planu');

const tracked10 = {
  ...simple,
  departAt: '04:01',
  departureSec: 4 * 3600 + 1 * 60,
  legs: [simple.legs[0], { ...simple.legs[1], line: '10', tripId: 'trip-10-0401' }],
};
// To, co planer odpowiadał na urządzeniu: ten sam odcinek, ale najbliższy
// kurs wychodził cztery minuty wcześniej i w innym wariancie trasy.
const otherLine = {
  ...simple,
  id: 'other-line',
  departAt: '03:57',
  departureSec: 4 * 3600 - 3 * 60,
  durationMin: 12,
  legs: [simple.legs[0], { ...simple.legs[1], line: '3', tripId: 'trip-3-0357' }],
};
const GRACE = 240;
const at0401 = 4 * 3600 + 1 * 60 - 90; // 1,5 min przed odjazdem

// Regression z urządzenia: śledzony 04:01 (linia 10) potrafił przeskoczyć na
// 03:57 (linia 3) i z powrotem, co zmieniało fazę, liczbę przystanków i
// godzinę odjazdu w karcie.
expect(
  'odjazd jeszcze nie minął → zostajemy przy swoim kursie',
  resolveTrackedConnection([otherLine], tracked10, at0401, GRACE)?.departAt,
  '04:01',
);
expect(
  'linia się nie zmienia',
  resolveTrackedConnection([otherLine], tracked10, at0401, GRACE)?.legs[1].line,
  '10',
);

// Po odjeździe (z grzecznością) śledzenie ma się zgodzić na nowy kurs —
// inaczej użytkownik zostałby z nieistniejącym połączeniem do końca dnia.
const laterSameLine = {
  ...tracked10,
  id: 'later-10',
  departAt: '04:05',
  departureSec: 4 * 3600 + 5 * 60,
  durationMin: 10,
  legs: [tracked10.legs[0], { ...tracked10.legs[1], tripId: 'trip-10-0405' }],
};
const afterDeparture = resolveTrackedConnection(
  [laterSameLine],
  tracked10,
  4 * 3600 + 6 * 60,
  GRACE,
);
expect('odjazd minął → bierzemy kurs, którym jedziemy', afterDeparture?.departAt, '04:05');
// Przy przejęciu kursu zmienia się godzina, ale nie linia — inaczej po
// przeliczeniu planu użytkownik nagle jechałby inną trasą.
expect('przejęty kurs zostaje na tej samej linii', afterDeparture?.legs[1].line, '10');

// Drugi mechanizm tego samego buga: planer nie zwraca już śledzonego kursu, ale
// zwraca inny egzemplarz TEJ SAMEJ linii. Przed odjazdem nie wolno na to
// wziąć (na telefonie śledzone 11:30 skoczyło na 11:50), po odjeździe — już
// tak, bo wtedy i tak musimy wybrać kurs, którym jedziemy.
const noIdsTracked = { ...tracked10, legs: tracked10.legs.map((l) => ({ ...l, tripId: undefined })) };
const noIdsLater = {
  ...laterSameLine,
  departAt: '04:50',
  departureSec: 4 * 3600 + 50 * 60,
  legs: noIdsTracked.legs.map((l) => ({ ...l })),
};
expect(
  'inny egzemplarz linii przed odjazdem → zostajemy przy swoim',
  resolveTrackedConnection([noIdsLater], noIdsTracked, at0401, GRACE)?.departAt,
  '04:01',
);
expect(
  'po odjeździe ten sam podpis już wystarczy',
  resolveTrackedConnection([noIdsLater], noIdsTracked, 4 * 3600 + 55 * 60, GRACE)?.departAt,
  '04:50',
);

// Opóźnienie wciąż ma się przepisywać: trip_id jest stabilny przy opóźnieniu.
const delayedRun = {
  ...tracked10,
  departAt: '04:06',
  departureSec: 4 * 3600 + 6 * 60,
  delayMin: 5,
  legs: [tracked10.legs[0], { ...tracked10.legs[1], tripId: 'trip-10-0401' }],
};
expect(
  'opóźnienie tego samego kursu przed odjazdem',
  resolveTrackedConnection([delayedRun], tracked10, at0401, GRACE)?.departAt,
  '04:06',
);

// Ten sam odjazd zawsze wygrywa, nawet gdy planer oddał świeżą wersję.
const sameTripRenumbered = {
  ...tracked10,
  departAt: '04:03',
  departureSec: 4 * 3600 + 3 * 60,
  delayMin: 2,
};
expect(
  'ten sam trip_id wygrywa z opóźnieniem',
  resolveTrackedConnection([sameTripRenumbered], tracked10, at0401, GRACE)?.departAt,
  '04:03',
);
expect('pusty plan → null', resolveTrackedConnection([], tracked10, at0401, GRACE), null);

// ─── Dane przekazywane do nośników ─────────────────────────────────────────

describe('Propsy do Live Activity');
const props = buildActivityProps(computeTripProgress(simple, { now: at(14, 11) }));
expect('faza', props.phase, 'riding');
expect('linia', props.line, '4');
expect('następny przystanek', props.nextStop, 'GÓRNOŚLĄSKA');
expect('kolor linii to hex', /^#[0-9A-F]{6}$/i.test(props.lineColor), true);
expect('liczby, nie Date (musi iść przez JSON do widgetu)', typeof props.departAtMs, 'number');
expect('JSON-serializowalne', JSON.parse(JSON.stringify(props)).phase, 'riding');

describe('Stan dla natywnej powiadomienia');
const native = buildNativeState(
  computeTripProgress(simple, { now: at(14, 11) }),
  simple,
  'kilometr://routes?fromTitle=Dom&action=stop',
  true,
);
expect('pasek widoczny', native.showProgress, true);
// Regression: porównanie szło z Date.now(), a stan był liczony dla 14:11
// w przeszłości → licznik znikał.
expect('licznik w przyszłości względem computedAt', native.showCountdown, true);
expect('licznik odlicza w dół', native.countdownDown, true);
expect('computedAt to moment przeliczenia', native.countdownAtMs > 0, true);

const arrivedNative = buildNativeState(
  computeTripProgress(simple, { now: at(14, 26) }),
  simple,
  'kilometr://routes?fromTitle=Dom',
  true,
);
expect('po przyjeździe bez licznika', arrivedNative.showCountdown, false);
expect('postęp w skali 0..1000', native.progress >= 0 && native.progress <= 1000, true);
expect('dwa przyciski', native.actions.length, 2);
expect('deep link zawiera akcję', native.deepLink.includes('action=stop'), true);
expect('kolor linii to hex', /^#[0-9A-F]{6}$/i.test(native.lineColor), true);

// ─── Podsumowanie ─────────────────────────────────────────────────────────

console.log(`\n${'='.repeat(52)}`);
if (failures.length === 0) {
  console.log(`WSZYSTKO OK — ${passed} asercji`);
  process.exit(0);
}
console.log(`${failures.length} NIEUDANYCH z ${passed + failures.length}:`);
for (const f of failures) console.log(`  - ${f}`);
process.exit(1);
