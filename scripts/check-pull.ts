/**
 * Sprawdzenie maszyny stanów pulla "ostatnia trasa / droga powrotna".
 *
 * Uruchomienie: `npm run check:pull`
 *
 * Chronimy progowe zachowanie gestu, bo błędna histereza to albo przypadkowe
 * wyszukiwanie przy lekkim pociągnięciu, albo migotanie między szukaj/powrót
 * w okolicy progu 36% ekranu.
 */

import { nextPullOption, type LastTripOption } from '../src/services/lastTripPull';

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

// Progi przykładowe (ekran 800 px): arm1=70, arm2=288, disarm2=268.
const A1 = 70;
const A2 = 288;
const D2 = 268;

describe('Progi z pozycji spoczynku (cur=0)');
{
  expect('powyżej progu lupki', nextPullOption(0, 71, A1, A2, D2), 1);
  expect('dokładnie próg lupki', nextPullOption(0, 70, A1, A2, D2), 1);
  expect('poniżej progu lupki', nextPullOption(0, 69, A1, A2, D2), 0);
  expect('pełne pociągnięcie to powrót', nextPullOption(0, 289, A1, A2, D2), 2);
  expect('w połowie to tylko szukaj', nextPullOption(0, 200, A1, A2, D2), 1);
}

describe('Histereza przy powrocie (cur=2)');
{
  expect('dokładnie próg reverse', nextPullOption(2, 288, A1, A2, D2), 2);
  expect('w strefie histerezy zostaje reverse', nextPullOption(2, 270, A1, A2, D2), 2);
  expect('poniżej histerezy, ale nad lupką: szukaj', nextPullOption(2, 267, A1, A2, D2), 1);
  expect('głęboki powrót do spoczynku', nextPullOption(2, 10, A1, A2, D2), 0);
}

describe('Bez migotania w okolicy progu');
{
  // Sekwencja w górę i w dół nie skacze 1↔2 na tej samej wysokości.
  let cur: LastTripOption = 0;
  const up = [100, 200, 289, 300];
  const down = [289, 270, 267, 50, 0];
  const seen: LastTripOption[] = [];
  for (const h of up) {
    cur = nextPullOption(cur, h, A1, A2, D2);
    seen.push(cur);
  }
  for (const h of down) {
    cur = nextPullOption(cur, h, A1, A2, D2);
    seen.push(cur);
  }
  expect('przejścia bez histerezy wstecznej', seen.join(''), '112222100');
}

describe('Wejście powyżej arm2 z dowolnego stanu');
{
  expect('z 0 wprost do 2', nextPullOption(0, 400, A1, A2, D2), 2);
  expect('z 1 wprost do 2', nextPullOption(1, 400, A1, A2, D2), 2);
}

console.log(`\n${'='.repeat(52)}`);
if (failures.length === 0) {
  console.log(`WSZYSTKO OK - ${passed} asercji`);
  process.exit(0);
}
console.log(`${failures.length} NIEUDANYCH z ${passed + failures.length}:`);
for (const f of failures) console.log(`  - ${f}`);
process.exit(1);
