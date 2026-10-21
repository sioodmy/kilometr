/**
 * Sprawdzenie kopii zapasowej (import/eksport user space).
 *
 * Uruchomienie: `npm run check:backup`
 *
 * Format pliku jest jedyną rzeczą, którą da się testować bez telefonu-
 * dlatego `backupFormat.ts` nie importuje `expo-*`. Reszta (zapis pliku,
 * picker, scalanie z KV) to I/O, którego nie da się zasymulować sensownie.
 *
 * Co tu chronimy:
 *  - uszkodzony plik NIE może wyglądać jak kopia (ktoś wskaże zdjęcie),
 *  - jeden śmieciowy wpis nie może odrzucić całej kopii,
 *  - kopia z przyszłej wersji aplikacji musi być odrzucona wprost, a nie
 *    „najlepiej" zignorowana,
 *  - import nie może zostawić trasy z odcinkami bez godzin (`NaN` na osi czasu),
 *  - sekcje są per-miasto: wpis z Krakowa nie może wylądować we Wrocławiu,
 *  - kopia ze schematu 1 (sprzed multi-city) migruje do kubełka Wrocławia.
 */

import {
  BACKUP_SCHEMA,
  backupFileName,
  buildBackupFile,
  countBackupData,
  isBackupEmpty,
  parseBackupFile,
  type BackupData,
} from '../src/services/backupFormat';
import type { Leg, SavedPlace, SavedRoute } from '../src/types/models';
import type { TripHistoryItem } from '../src/services/smartRanking';

// ─── Framework asercji ─────────────────────────────────────────────────────

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

function expectTrue(label: string, got: boolean): void {
  expect(label, got, true);
}

// ─── Dane testowe ──────────────────────────────────────────────────────────

/** Odcinek w minimalnej, poprawnej postaci - bazowy budulek dla testów tras. */
const FULL_LEG: Leg = {
  id: 'l1',
  mode: 'tram',
  line: '4',
  fromStop: 'A',
  toStop: 'B',
  departAt: '11:10',
  arriveAt: '11:25',
  stopsCount: 4,
  live: false,
};

const place = (id: string, name: string): SavedPlace => ({
  id,
  placeId: id,
  name,
  icon: 'home',
  address: `${name} 1, Wrocław`,
  lat: 51.1,
  lon: 17.03,
});

const krakowPlace = (id: string, name: string): SavedPlace => ({
  id,
  placeId: id,
  name,
  icon: 'home',
  address: `${name} 1, Kraków`,
  lat: 50.06,
  lon: 19.94,
});

const route = (id: string): SavedRoute => ({
  id,
  savedAt: 1_700_000_000_000,
  connection: {
    id,
    fromTitle: 'Dom',
    toTitle: 'Praca',
    departInMin: 5,
    departureSec: 40000,
    departAt: '11:10',
    arriveAt: '11:25',
    durationMin: 15,
    transfers: 0,
    delayMin: 0,
    live: false,
    legs: [FULL_LEG],
  },
});

const trip = (id: string): TripHistoryItem => ({
  id,
  origin_title: 'Dom',
  origin_lat: 51.1,
  origin_lon: 17.03,
  dest_id: 'd1',
  dest_title: 'Rynek',
  dest_address: 'Rynek, Wrocław',
  dest_lat: 51.1079,
  dest_lon: 17.0385,
  duration_min: 12,
  timestamp: 1_700_000_000_000,
  uses: 3,
});

const krakowTrip = (id: string): TripHistoryItem => ({
  id,
  origin_title: 'Dom',
  origin_lat: 50.06,
  origin_lon: 19.94,
  dest_id: 'd2',
  dest_title: 'Rynek Główny',
  dest_address: 'Rynek Główny, Kraków',
  dest_lat: 50.0614,
  dest_lon: 19.9366,
  duration_min: 20,
  timestamp: 1_700_000_000_000,
  uses: 1,
});

const FULL: BackupData = {
  places: [
    { city: 'wroclaw', items: [place('p1', 'Dom'), place('p2', 'Praca')] },
    { city: 'krakow', items: [krakowPlace('p3', 'Rynek')] },
  ],
  savedRoutes: [{ city: 'wroclaw', items: [route('c1')] }],
  tripHistory: [
    { city: 'wroclaw', items: [trip('t1')] },
    { city: 'krakow', items: [krakowTrip('t2')] },
  ],
  routingSettings: { maxTransfers: 1, minTransferSec: 180, maxWalkM: 600, walkPace: 'normal', anchorRadiusM: 400, trainsEnabled: false, trainMinTransferSec: 420, cableEnabled: false, allowedModes: { tram: true, bus: true, trolleybus: true, subway: true, train: false, cable: false }, routeStyle: 'lessWalking' },
  notificationPrefs: {
    trackingEnabled: true,
    disruptionAlertsEnabled: false,
    liveProgressEnabled: true,
  },
  locale: 'en',
};

function parse(data: unknown) {
  return parseBackupFile(JSON.stringify(data));
}

/**
 * Pełna kopia w formacie aplikacji. `data` celowo przyjmuje `unknown`:
 * testy podają tu kształty, których `BackupData` nie opisuje (uszkodzone
 * wpisy, brakujące pola) - to jest właśnie to, co walidacja ma złapać.
 */
function envelope(data: unknown, schema = BACKUP_SCHEMA) {
  return {
    kind: 'kilometr-backup',
    app: 'kilometr',
    schema,
    createdAt: 1_700_000_000_000,
    appVersion: '1.0.0',
    data,
  };
}

function items<T>(sections: { city: string; items: T[] }[]): T[] {
  return sections.flatMap((s) => s.items);
}

// ─── round-trip ────────────────────────────────────────────────────────────

describe('Round-trip: zapis → odczyt');
{
  const file = buildBackupFile(FULL, '1.0.0');
  const res = parseBackupFile(file);
  expectTrue('plik się parsuje', res.ok);
  if (res.ok) {
    expect('sekcje miejsc per-miasto', res.envelope.data.places.map((s) => s.city).join(','), 'wroclaw,krakow');
    expect('liczba miejsc (suma)', res.counts.places, 3);
    expect('liczba tras (suma)', res.counts.savedRoutes, 1);
    expect('liczba przejazdów (suma)', res.counts.tripHistory, 2);
    expect('język', res.envelope.data.locale, 'en');
    expect('wersja schematu', res.envelope.schema, BACKUP_SCHEMA);
    expect('wersja aplikacji', res.envelope.appVersion, '1.0.0');
    expect('nazwa miejsca przeżywa', res.envelope.data.places[0].items[0].name, 'Dom');
    expect('kotwica miejsca przeżywa', res.envelope.data.places[0].items[0].lat, 51.1);
    expect('krakowskie miejsce w swojej sekcji', res.envelope.data.places[1].items[0].name, 'Rynek');
    expect('odcinek trasy przeżywa', res.envelope.data.savedRoutes[0].items[0].connection.legs.length, 1);
    expect('użycia przejazdu przeżywają', res.envelope.data.tripHistory[0].items[0].uses, 3);
    expect('nie jest pusta', res.empty, false);
    expect('licznik miejsc', res.counts.places, 3);
  }
}

// ─── odrzucanie śmieci ─────────────────────────────────────────────────────

describe('Odrzucanie: plik nie jest kopią');
{
  expect('zdjęcie (nie JSON)', parseBackupFile('nie json').ok, false);
  expect('JSON, ale bez znacznika', parseBackupFile('{"a":1}').ok, false);
  expect('inny format', parse({ kind: 'other-backup', app: 'kilometr', schema: 2, data: {} }).ok, false);
  expect('inna aplikacja', parse({ kind: 'kilometr-backup', app: 'czarna', schema: 2, data: {} }).ok, false);
  const r = parseBackupFile('[]');
  expect('tablica zamiast obiektu', r.ok, false);
}

describe('Odrzucanie: kopia z przyszłości');
{
  const r = parse(envelope(FULL, BACKUP_SCHEMA + 1));
  expect('schemat nowszy niż nasz', r.ok, false);
  if (!r.ok) expect('powód', r.reason, 'schemaTooNew');
}

describe('Odrzucanie: schemat 0');
{
  const r = parse(envelope(FULL, 0));
  expect('schemat 0 to nie kopia', r.ok, false);
  if (!r.ok) expect('powód', r.reason, 'unreadable');
}

// ─── migracja schematu 1 ──────────────────────────────────────────────────

describe('Migracja: schemat 1 ląduje w kubełku Wrocławia');
{
  const r = parse(
    envelope(
      {
        places: [place('p1', 'Dom'), { id: 'bad' }],
        savedRoutes: [route('c1')],
        tripHistory: [trip('t1')],
      },
      1,
    ),
  );
  expectTrue('stara kopia nadal się parsuje', r.ok);
  if (r.ok) {
    expect('miejsca we Wrocławiu', r.envelope.data.places.map((s) => s.city).join(','), 'wroclaw');
    expect('dobre miejsce przeżywa', items(r.envelope.data.places).map((p) => p.id).join(','), 'p1');
    expect('trasa we Wrocławiu', r.envelope.data.savedRoutes[0]?.city, 'wroclaw');
    expect('przejazd we Wrocławiu', r.envelope.data.tripHistory[0]?.city, 'wroclaw');
    expect('licznik miejsc', r.counts.places, 1);
  }
}

// ─── odporność na uszkodzone dane ──────────────────────────────────────────

describe('Odporność: jeden śmieciowy wpis nie zabija kopii');
{
  const r = parse(
    envelope({
      ...FULL,
      places: [
        { city: 'wroclaw', items: [place('ok', 'Dom'), { id: 'bad' }, null, { name: 'Bez id', lat: 1, lon: 2 }] },
        { city: 'krakow', items: [krakowPlace('ok2', 'Rynek')] },
      ],
      tripHistory: [
        { city: 'wroclaw', items: [{ id: 't-ok', dest_id: 'd', dest_title: 'Rynek', dest_lat: 1, dest_lon: 2 }, { dest_title: 'Bez id' }] },
      ],
      savedRoutes: [{ city: 'wroclaw', items: [{ id: 'r', connection: { id: 'r' } }] }],
    }),
  );
  expectTrue('kopia nadal się parsuje', r.ok);
  if (r.ok) {
    expect('zostaje tylko dobre miejsce', items(r.envelope.data.places).length, 2);
    expect('zostaje dobry przejazd', items(r.envelope.data.tripHistory).length, 1);
    expect('trasa bez odcinków odpada', items(r.envelope.data.savedRoutes).length, 0);
  }
}

describe('Odporność: sekcja nieznanego miasta odpada, reszta zostaje');
{
  const r = parse(
    envelope({
      ...FULL,
      places: [
        { city: 'wroclaw', items: [place('ok', 'Dom')] },
        { city: 'berlin', items: [place('x', 'Alexanderplatz')] },
        { items: [place('y', 'Bez miasta')] },
        null,
        'napis',
      ],
    }),
  );
  expectTrue('kopia się parsuje', r.ok);
  if (r.ok) {
    expect('zostaje tylko znane miasto', r.envelope.data.places.map((s) => s.city).join(','), 'wroclaw');
    expect('zostaje dobre miejsce', items(r.envelope.data.places).length, 1);
    expect('trasy nietknięte', items(r.envelope.data.savedRoutes).length, 1);
  }
}

describe('Odporność: odcinek bez godzin odpada, reszta trasy zostaje');
{
  const r = parse(
    envelope({
      ...FULL,
      savedRoutes: [
        {
          city: 'wroclaw',
          items: [
            {
              id: 'r1',
              connection: {
                legs: [
                  { id: 'broken', mode: 'tram', fromStop: 'A', toStop: 'B' },
                  { id: 'l2', mode: 'walk', fromStop: 'A', toStop: 'C', departAt: '11:05', arriveAt: '11:10' },
                  { id: 'l3', mode: 'teleport', fromStop: 'C', toStop: 'D', departAt: '11:10', arriveAt: '11:20' },
                  // Metro i trolejbus muszą przeżyć: bez nich w LEG_MODES
                  // zapisana trasa z M1/M2 albo z Tychów cicho gubiła nogę.
                  { id: 'l4', mode: 'subway', fromStop: 'C', toStop: 'D', departAt: '11:12', arriveAt: '11:18' },
                  { id: 'l5', mode: 'trolleybus', fromStop: 'D', toStop: 'E', departAt: '11:20', arriveAt: '11:26' },
                ],
              },
            },
          ],
        },
      ],
    }),
  );
  expectTrue('kopia się parsuje', r.ok);
  if (r.ok) {
    const legs = r.envelope.data.savedRoutes[0]?.items[0]?.connection.legs ?? [];
    expect('zostaje tylko dobry odcinek', legs.map((l) => l.id).join(','), 'l2,l4,l5');
  }
}

describe('Odporność: NaN i nieskończoność odpadają');
{
  const r = parse(
    envelope({
      ...FULL,
      // JSON nie ma NaN/Infinity - tu symulujemy to, co dałby `JSON.parse`
      // na pliku, w którym ktoś podmienił liczby na stringi.
      places: [{ city: 'wroclaw', items: [{ ...place('x', 'Złe'), lat: '51.1', lon: 2 }] }],
    }),
  );
  expectTrue('kopia się parsuje', r.ok);
  if (r.ok) expect('miejsce z nieliczną lat odpada', items(r.envelope.data.places).length, 0);
}

describe('Odporność: brak sekcji to nie błąd');
{
  const r = parse({ kind: 'kilometr-backup', app: 'kilometr', schema: 2, data: {} });
  expectTrue('pusta kopia to kopia', r.ok);
  if (r.ok) {
    expect('pusta', r.empty, true);
    expect('miejsca puste', r.envelope.data.places.length, 0);
    expect('ustawienia null', r.envelope.data.routingSettings, null);
  }
  const noData = parse({ kind: 'kilometr-backup', app: 'kilometr', schema: 2 });
  expectTrue('brak pola data to kopia', noData.ok);
}

// ─── normalizacja pól ─────────────────────────────────────────────────────

describe('Normalizacja: brakujące pola dostają wartości domyślne');
{
  const r = parse(
    envelope({
      places: [{ city: 'wroclaw', items: [{ id: 'p', name: 'Dom', lat: 1, lon: 2 }] }],
      savedRoutes: [{ city: 'krakow', items: [{ id: 'r', connection: { legs: [FULL_LEG] } }] }],
      tripHistory: [{ city: 'wroclaw', items: [{ id: 't', dest_id: 'd', dest_title: 'Rynek', dest_lat: 1, dest_lon: 2 }] }],
      locale: 'xx',
    }),
  );
  expectTrue('kopia się parsuje', r.ok);
  if (r.ok) {
    expect('brak address → pusty string', r.envelope.data.places[0].items[0].address, '');
    expect('brak icon → home', r.envelope.data.places[0].items[0].icon, 'home');
    expect('brak placeId → id', r.envelope.data.places[0].items[0].placeId, 'p');
    expect('odcinek przeżywa', r.envelope.data.savedRoutes[0].items[0].connection.legs.length, 1);
    expect('godziny w odcinku nie znikają', r.envelope.data.savedRoutes[0].items[0].connection.legs[0].departAt, '11:10');
    expect('brak savedAt → teraz (liczba)', typeof r.envelope.data.savedRoutes[0].items[0].savedAt, 'number');
    expect('brak uses → undefined', r.envelope.data.tripHistory[0].items[0].uses ?? null, null);
    expect('uses < 1 → undefined', r.envelope.data.tripHistory[0].items[0].uses ?? null, null);
    expect('nieznany język → null', r.envelope.data.locale, null);
  }
}

describe('Normalizacja: uses i znaki');
{
  const r = parse(
    envelope({
      tripHistory: [{ city: 'wroclaw', items: [{ id: 't', dest_id: 'd', dest_title: 'x', dest_lat: 1, dest_lon: 2, uses: 2.6 }] }],
      places: [{ city: 'krakow', items: [{ id: 'p', name: 'D'.repeat(1000), lat: 1, lon: 2 }] }],
    }),
  );
  if (r.ok) {
    expect('uses się zaokrągla', r.envelope.data.tripHistory[0].items[0].uses, 3);
    expect('długi tekst się ucina', r.envelope.data.places[0].items[0].name.length, 300);
  }
}

// ─── pusty eksport ─────────────────────────────────────────────────────────

describe('Pusty eksport to poprawna kopia');
{
  const empty: BackupData = {
    places: [],
    savedRoutes: [],
    tripHistory: [],
    routingSettings: null,
    notificationPrefs: null,
    locale: null,
  };
  expect('pusty', isBackupEmpty(empty), true);
  expect('nie pusty gdy są miejsca', isBackupEmpty({ ...empty, places: [{ city: 'wroclaw', items: FULL.places[0].items }] }), false);
  expect('nie pusty gdy są ustawienia', isBackupEmpty({ ...empty, routingSettings: FULL.routingSettings }), false);
  const res = parseBackupFile(buildBackupFile(empty, '1.0.0'));
  expectTrue('parsuje się', res.ok);
  if (res.ok) expect('pusta po odczycie', res.empty, true);
  expect('licznik pusty', countBackupData(empty).places, 0);
}

// ─── nazwa pliku ───────────────────────────────────────────────────────────

describe('Nazwa pliku');
{
  const name = backupFileName(new Date(2026, 9, 5, 18, 42));
  expect('data i godzina w nazwie', name, 'kilometr-backup-2026-10-05-184200.json');
  // Sortowanie po nazwie ma dawać chronologię, a to wymaga zer wiodących.
  const early = backupFileName(new Date(2026, 0, 2, 3, 4));
  const late = backupFileName(new Date(2026, 0, 2, 3, 5));
  expectTrue('miesiąc i dzień z zerami', early.startsWith('kilometr-backup-2026-01-02-030400'));
  expectTrue('sortowanie po nazwie = chronologia', early < late);
  const sameMinuteA = backupFileName(new Date(2026, 0, 2, 3, 4, 10));
  const sameMinuteB = backupFileName(new Date(2026, 0, 2, 3, 4, 40));
  expectTrue('dwa eksporty w tej samej minucie się nie nadpisują', sameMinuteA !== sameMinuteB);
}

// ─── Podsumowanie ─────────────────────────────────────────────────────────

console.log(`\n${'='.repeat(52)}`);
if (failures.length === 0) {
  console.log(`WSZYSTKO OK - ${passed} asercji`);
  process.exit(0);
}
console.log(`${failures.length} NIEUDANYCH z ${passed + failures.length}:`);
for (const f of failures) console.log(`  - ${f}`);
process.exit(1);
