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
import { buildLivePlan, buildPhaseCopy } from '../src/services/notifications/content';
import {
  matchTrackedConnection,
  resolveTrackedConnection,
} from '../src/services/notifications/planMatch';
import { clockFromMs, toAbsoluteMs } from '../src/services/notifications/format';
import { pl } from '../src/i18n/pl';
import type { Connection, Leg, LegStop } from '../src/types/models';
import type { TrackedTrip } from '../src/services/notifications';

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

/** TrackedTrip na potrzeby planu — deep link musi być w każdym teście. */
const tracked = (conn: Connection): TrackedTrip => ({
  id: conn.id,
  fromTitle: conn.fromTitle,
  fromLat: 51.1,
  fromLon: 17.0,
  toId: conn.toTitle,
  toTitle: conn.toTitle,
  toLat: 51.11,
  toLon: 17.02,
  connection: conn,
  startedAt: at(0, 0).getTime(),
});

const planOf = (progress: ReturnType<typeof computeTripProgress>, conn: Connection) =>
  buildLivePlan(progress, conn, tracked(conn), pl);

function dump(label: string, conn: Connection, atTime: Date): ReturnType<typeof computeTripProgress> {
  const p = computeTripProgress(conn, { now: atTime });
  const plan = planOf(p, conn);
  const all = buildPhaseCopy(p, conn, pl);
  console.log(
    `   ${label.padEnd(22)} ${p.phase.padEnd(9)} postęp=${p.progress.toFixed(2)} ` +
      `eta=${p.etaMin.toFixed(0)}min zostało=${p.stopsLeft} następny=${p.nextStop ?? '-'} ` +
      `przystanek=${p.stopName}\n` +
      `      teraz: ${all[p.phase].title} | ${all[p.phase].text}\n` +
      `      chip: ${all[p.phase].criticalText} | licznik→${hhmm(plan.countdownAtMs)} ` +
      `w dół=${plan.countdownDown} segmenty=${plan.segments.length}`,
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

describe('Północ: wybieramy wystąpienie najbliższe teraz');
// 23:58 od 00:03 to 23:58 WCZORAJ, nie dzisiaj — inaczej ETA wynosiłoby 24 godziny.
// Ta sama poprawka naprawiała `toAbsoluteMs` i po niej dziedziczy licznik
// w powiadomieniu, bo i tak liczy się na bezwzględnych znacznikach ms.
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
// Przed startem spaceru `TripProgress.walkMeters` jest zerem, bo szuka tylko
// odcinka, który już trwa. Tymczasem to jest właśnie chwila, w której dystans
// jest najważniejszy — użytkownik stoi w domu i musi zdecydować, czy zdąży.
expect('postęp dojścia nieznany', p.approachProgress, null);
// Tytuł mówi kurs i godzinę odjazdu w jednej linii (etykieta „odjazd” razem
// z czasem), a „Idź na przystanek” zniknęło — nie odpowiadało na pytanie
// „czy zdążę i na który kurs”.
expect('tytuł przy dojściu', planOf(p, simple).copy.walking.title, 'Tramwaj 4 • odjazd 14:10');
// Przy dojściu odpowiadamy, na który przystanek i w jakim kierunku.
expect('tekst przy dojściu', planOf(p, simple).copy.walking.text, 'przystanek HALDENA • Do BISKUPIN');
// Dystans dojścia zostaje, ale w podpisie, nie w tytule.
expect(
  'dystans i czas dojścia w podpisie',
  planOf(p, simple).copy.walking.subText,
  '320 m • dojście ~4 min',
);

p = dump('14:06 prawie na miejscu', simple, at(14, 6));
expect('faza', p.phase, 'walking');
expectWithin('dojście w toku', p.approachProgress ?? -1, 0.4, 0.7);
expect('licznik celuje w odjazd', hhmm(planOf(p, simple).countdownAtMs), '14:10');

p = dump('14:09 wciąż idę', simple, at(14, 9));
expect('faza', p.phase, 'walking');
expect('podejście prawie skończone', (p.approachProgress ?? 0) > 0.85, true);

p = dump('14:10 wsiadam', simple, at(14, 10));
expect('faza', p.phase, 'waiting');
// Regression: raportowaliśmy następny przystanek, choć użytkownik już stoi na tym.
expect('bez następnego przystanku', p.nextStop, null);
expect('licznik celuje w odjazd', hhmm(planOf(p, simple).countdownAtMs), '14:10');

p = dump('14:11 jadę', simple, at(14, 11));
expect('faza', p.phase, 'riding');
// W trakcie jazdy najważniejsze pytanie to „gdzie wysiadam” — bez tego
// użytkownik musiał otwierać aplikację, żeby nie przegapić przystanku.
expect('tekst w trakcie jazdy', planOf(p, simple).copy.riding.text, 'wysiadź: ZACHEBNIA • Do BISKUPIN');
expect('podpis w trakcie jazdy', planOf(p, simple).copy.riding.subText, 'następny GÓRNOŚLĄSKA • 7 przystanków');
// Po przyjeździe podpis wraca do treści tytułu — nie powtarzamy godziny.
expect('bez podpisu po przyjeździe', planOf(computeTripProgress(simple, { now: at(14, 26) }), simple).copy.arrived.subText, '');
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
expect('licznik celuje w 23:58', hhmm(planOf(p, night).countdownAtMs), '23:58');
p = dump('00:03 w środku nocy', night, at(0, 3));
// Regression: toAbsoluteMs zakładał „dziś", więc ETA wynosiło 1449 minut.
expect('faza', p.phase, 'riding');
expect('licznik celuje w 00:12', hhmm(planOf(p, night).countdownAtMs), '00:12');
expectWithin('ETA w minutach', p.etaMin, 5, 12);

// ─── Przesiadka ───────────────────────────────────────────────────────────

describe('Przesiadka');
p = dump('14:12 pierwszy pojazd', transfer, at(14, 12));
expect('faza', p.phase, 'riding');
expect('linia', p.line, '4');

p = dump('14:26 przechodzę', transfer, at(14, 26));
// Regression: licznik celował w pierwszy odjazd (14:10), który minął godzinę temu.
expect('faza', p.phase, 'transfer');
expect('licznik celuje w 14:30', hhmm(planOf(p, transfer).countdownAtMs), '14:30');
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

// ─── Plan przekazywany do natywnego Live Update ────────────────────────────

describe('Plan dla natywnego powiadomienia');
const riding = computeTripProgress(simple, { now: at(14, 11) });
const ridingPlan = planOf(riding, simple);

expect('faza zgłoszona dla wszystkich pięciu', Object.keys(ridingPlan.copy).length, 5);
expect('segment dojścia + przejazd', ridingPlan.segments.length, 2);
expect('dojście pieszo', ridingPlan.segments[0].mode, 'walk');
expect('przejazd tramwajem', ridingPlan.segments[1].mode, 'tram');
// Postęp liczy się na OKRES CAŁEJ podróży (z dojściem), inaczej pasek skacze
// na starcie i na końcu ląduje nie tam, gdzie jest użytkownik.
expect('początek podróży to start dojścia', hhmm(ridingPlan.startAtMs), '14:03');
expect('koniec podróży to przyjazd', hhmm(ridingPlan.endAtMs), '14:25');
expect('licznik odlicza w dół', ridingPlan.countdownDown, true);
expect('licznik celuje w 14:25', hhmm(ridingPlan.countdownAtMs), '14:25');
expect('dwa przyciski', ridingPlan.actions.length, 2);
expect('przycisk stop ma id', ridingPlan.actions[0].id, 'stop');
expect('w trasie przycisk brzmi „Zakończ”', ridingPlan.actions[0].title, 'Zakończ');
expect('deep link do trasy', ridingPlan.deepLink.startsWith('kilometr://routes?'), true);
// Wszystko idzie jako jeden JSON do Intent — mieszanie typów (Date, Color)
// wybuchłoby przy marshallowaniu.
expect('JSON-serializowalne', JSON.parse(JSON.stringify(ridingPlan)).segments.length, 2);

const arrivedProgress = computeTripProgress(simple, { now: at(14, 26) });
const arrivedPlan = planOf(arrivedProgress, simple);
expect('po przyjeździe licznik w górę', arrivedPlan.countdownDown, false);
expect('licznik od godziny przyjazdu', hhmm(arrivedPlan.countdownAtMs), '14:25');
// Po przyjeździe nie ma już czego kończyć — „Zakończ" byłoby kłamstwem.
expect('po przyjeździe przycisk to „OK”', arrivedPlan.actions[0].title, 'OK');
expect('serwis ma się zatrzymać po podanym czasie', arrivedPlan.stopAfterMs, 0);

const walkingProgress = computeTripProgress(simple, { now: at(14, 6) });
const walkingPlan = planOf(walkingProgress, simple);
// Regression: plan liczony dla 14:06, a porównanie szło z Date.now() —
// licznik wychodził „nie pokazuj".
expect('licznik w przyszłości względem computedAt', walkingPlan.countdownAtMs > walkingProgress.computedAt, true);
expect('licznik celuje w odjazd', hhmm(walkingPlan.countdownAtMs), '14:10');

const delayedProgress = computeTripProgress({ ...simple, delayMin: 6 }, { now: at(14, 11) });
const delayedPlan = planOf(delayedProgress, simple);
// Chip w pasku stanu ma jedno miejsce — przy opóźnieniu ważniejsze jest
// opóźnienie niż godzina przyjazdu.
expect('opóźnienie w planie', delayedPlan.delayMin, 6);
expect('chip pokazuje opóźnienie', delayedPlan.copy.riding.criticalText, '+6 min');

const nightPlan = planOf(computeTripProgress(night, { now: at(0, 3) }), night);
expect('przez północ licznik celuje w 00:12', hhmm(nightPlan.countdownAtMs), '00:12');
expect('przez północ koniec po 00:12', hhmm(nightPlan.endAtMs), '00:12');

// ─── Formatowanie absolutnego czasu dla powiadomienia ───────────────────────

describe('Godzina z znacznika ms');
// Powiadomienie nie może pokazywać „za 4 min" — tekst zestarzałby się przy
// pierwszym odświeżeniu. Wszystko, co jest liczone co sekundę, robi zegar
// systemowy, a my podajemy tylko bezwzględną godzinę.
expect('godzina odjazdu', clockFromMs(at(14, 10).getTime()), '14:10');
expect('po północy', clockFromMs(new Date(2026, 0, 16, 0, 12).getTime()), '00:12');
expect('zero to pusty tekst, nie „00:00"', clockFromMs(0), '');

// ─── Podsumowanie ─────────────────────────────────────────────────────────

console.log(`\n${'='.repeat(52)}`);
if (failures.length === 0) {
  console.log(`WSZYSTKO OK — ${passed} asercji`);
  process.exit(0);
}
console.log(`${failures.length} NIEUDANYCH z ${passed + failures.length}:`);
for (const f of failures) console.log(`  - ${f}`);
process.exit(1);
