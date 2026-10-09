/**
 * Stan feedu live i odporność trackera pojazdów.
 *
 * Uruchomienie: `npm run check:live`
 *
 * Uruchomienie z `--require ./scripts/stub-expo.cjs` (patrz npm skrypt):
 * tracker live importuje natywne moduły Expo, których Node nie umie wczytać.
 *
 * Każdy przypadek poniżej to regression guard na realny błąd, przez który
 * aplikacja pokazywała „brak danych live”, mimo że dane były:
 *
 * - okno świeżości stało równe interwałowi pollingu (30 s = 30 s), więc stan
 *   przeskakiwał w „stale” tuż przed każdym kolejnym sukcesem,
 * - `getTripDelays()` oddawał żywą mapę, którą konsument mógł zepsuć,
 * - pusta odpowiedź MPK była traktowana tak samo jak awaria, przez co noc
 *   wyglądała jak padnięty feed,
 * - brak połączenia z kodem grada za linię, której nie ma w rozkładzie.
 */

import { liveTracker } from '../src/services/liveTracker';

// ─── Framework asercji ─────────────────────────────────────────────────────

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
  failures.push(`${section} → ${label}: ${JSON.stringify(got)} (oczekiwano ${JSON.stringify(want)})`);
  console.log(`   FAIL  ${label} = ${JSON.stringify(got)} (oczekiwano ${JSON.stringify(want)})`);
}

/** Prywatne helpery trackera: sprawdzamy je wprost, bez całego ticka. */
const internals = liveTracker as unknown as {
  parseRows(text: string): unknown;
  lastOk: number;
};

// ─── Stan przed pierwszym odpowiedzią ─────────────────────────────────────

describe('Stan live zanim cokolwiek przyszło');
expect('start = unknown', liveTracker.getLiveState(), 'unknown');

// ─── Okno świeżości nie gryzie się z pollingiem ───────────────────────────

describe('Świeżość danych');
internals.lastOk = Date.now();
expect('zaraz po sukcesie = fresh', liveTracker.getLiveState(), 'fresh');
// Dawniej granica stała na 30 s, czyli dokładnie tyle, ile trwa interwał
// pollingu. Dane starsze o 45 s to wciąż normalna sytuacja, nie awaria.
internals.lastOk = Date.now() - 45_000;
expect('45 s po sukcesie = fresh', liveTracker.getLiveState(), 'fresh');
internals.lastOk = Date.now() - 90_000;
expect('90 s po sukcesie = fresh', liveTracker.getLiveState(), 'fresh');
// Dopiero naprawdę pora przyznać, że feed zniknął.
internals.lastOk = Date.now() - 200_000;
expect('200 s bez odpowiedzi = stale', liveTracker.getLiveState(), 'stale');
internals.lastOk = 0;
expect('z powrotem zero = unknown', liveTracker.getLiveState(), 'unknown');

// ─── getTripDelays nie oddaje żywej mapy ──────────────────────────────────

describe('Opóźnienia dla RAPTOR-a');
const first = liveTracker.getTripDelays();
first.set('trip-hack', 999);
expect('zapis poza trackerem nie przecieka', liveTracker.getTripDelays().has('trip-hack'), false);
expect('każde wywołanie to nowa kopia', liveTracker.getTripDelays() === first, false);
expect('pusty tracker = pusta mapa', liveTracker.getTripDelays().size, 0);

// ─── Pusta odpowiedź to nie awaria ────────────────────────────────────────

describe('Rozróżnienie pustej odpowiedzi od awarii');
expect('pusty body = pusta lista', internals.parseRows(''), []);
expect('sam whitespace = pusta lista', internals.parseRows('   \n '), []);
expect('HTML zamiast JSON = null', internals.parseRows('<html>502</html>'), null);
expect('obiekt zamiast tablicy = null', internals.parseRows('{"error":1}'), null);
expect('poprawna tablica przechodzi', internals.parseRows('[{"name":"1","type":"tram","x":51.1,"y":17.0,"k":7}]'), [
  { name: '1', type: 'tram', x: 51.1, y: 17.0, k: 7 },
]);

// ─── Odpytywanie nieznanych linii nie wywraca się ─────────────────────────

describe('Linie spoza rozkładu');
expect('nieznana linia = pusta lista', liveTracker.snapshot('ZZZ'), []);
expect('snapshot bez argumentu to tablica', Array.isArray(liveTracker.snapshot()), true);
expect('lookup nieznanego id = undefined', liveTracker.lookup('nope'), undefined);
expect('mała litera linii = wielka', liveTracker.snapshot('a'), liveTracker.snapshot('A'));

// ─── Podsumowanie ─────────────────────────────────────────────────────────

console.log(`\n${'='.repeat(52)}`);
if (failures.length === 0) {
  console.log(`WSZYSTKO OK — ${passed} asercji`);
} else {
  console.log(`NIEPOWODZENIA (${failures.length} z ${passed + failures.length}):`);
  for (const f of failures) console.log(`  - ${f}`);
}
process.exit(failures.length === 0 ? 0 : 1);
