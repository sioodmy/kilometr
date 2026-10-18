// Test logiki cache geometrii: przypięte trasy nie mogą wypadać z LRU.
//
//   npm run check:geometry-cache

import { selectEvictions } from '../src/services/geometryEviction';

let failures = 0;
function check(label: string, cond: boolean, detail = '') {
  console.log(`  ${cond ? 'PASS' : 'FAIL'} ${label}${detail ? `: ${detail}` : ''}`);
  if (!cond) failures++;
}

console.log('=== Cache geometrii: eksmisja LRU z przypiętymi ===');

// 1. Poniżej limitu nic nie wypada.
{
  const keys = ['a', 'b', 'c'];
  check('poniżej limitu brak eksmisji', selectEvictions(keys, new Set(), 5).length === 0);
}

// 2. Powyżej limitu wypadają najstarsze nieprzypięte, w kolejności wstawiania.
{
  const keys = ['a', 'b', 'c', 'd', 'e'];
  const evicted = selectEvictions(keys, new Set(), 3);
  check('wypadają dwa najstarsze', evicted.join(',') === 'a,b', evicted.join(','));
}

// 3. Przypięte nie wypadają nawet gdy są najstarsze.
{
  const keys = ['a', 'b', 'c', 'd', 'e'];
  const pins = new Set(['a', 'b']);
  const evicted = selectEvictions(keys, pins, 3);
  check('przypięte zostają, wypadają c,d', evicted.join(',') === 'c,d', evicted.join(','));
}

// 4. Gdy wszystko przypięte, nie wypada nic (limit miękki dla przypiętych).
{
  const keys = ['a', 'b', 'c', 'd'];
  const evicted = selectEvictions(keys, new Set(keys), 2);
  check('same przypięte, brak eksmisji', evicted.length === 0, `wypadło ${evicted.length}`);
}

// 5. Symulacja: 100 wstawień z 10 przypiętymi na starcie, limit 60.
{
  const max = 60;
  const keys: string[] = [];
  const pins = new Set<string>();
  for (let i = 0; i < 10; i++) { keys.push(`pin${i}`); pins.add(`pin${i}`); }
  for (let i = 0; i < 100; i++) {
    keys.push(`tmp${i}`);
    if (keys.length > max) {
      for (const k of selectEvictions(keys, pins, max)) {
        const idx = keys.indexOf(k);
        if (idx >= 0) keys.splice(idx, 1);
      }
    }
  }
  const pinnedLeft = Array.from(pins).filter((p) => keys.includes(p)).length;
  check('przypięte przetrwały 100 wstawień', pinnedLeft === 10, `${pinnedLeft}/10`);
  check('rozmiar w okolicach limitu', keys.length <= max + 10, `${keys.length}`);
}

// 6. Pusta lista i limit zerowy nie wybuchają.
{
  check('pusta lista', selectEvictions([], new Set(), 10).length === 0);
  check('limit 0 wypuszcza wszystko', selectEvictions(['a', 'b'], new Set(), 0).length === 2);
}

console.log(`\n${failures === 0 ? 'OK: logika cache poprawna' : `BLEDY: ${failures}`}`);
process.exit(failures === 0 ? 0 : 1);