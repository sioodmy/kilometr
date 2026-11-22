import {
  classifyVehicleModel,
  selectRailAmenitiesForStrip,
  type VehicleSpecs,
} from '../src/services/vehicleInfo';
import type { LegMode, RailAmenity } from '../src/types/models';

let failures = 0;

function check(label: string, cond: boolean, detail = '') {
  console.log(`  ${cond ? 'PASS' : 'FAIL'} ${label}${detail ? `: ${detail}` : ''}`);
  if (!cond) failures++;
}

function expectSpecs(
  model: string,
  mode: LegMode,
  expected: Partial<VehicleSpecs>,
  label = model,
) {
  const actual = classifyVehicleModel(model, mode);
  if (!actual) {
    check(label, false, 'oczekiwano obiektu VehicleSpecs, otrzymano null');
    return;
  }
  const diffs: string[] = [];
  for (const [k, v] of Object.entries(expected)) {
    const got = actual[k as keyof VehicleSpecs];
    if (got !== v) diffs.push(`${k}: oczekiwano ${String(v)}, jest ${String(got)}`);
  }
  check(label, diffs.length === 0, diffs.join('; '));
}

function expectAmenities(
  label: string,
  keys: RailAmenity[],
  specs: VehicleSpecs | null | undefined,
  expected: RailAmenity[],
) {
  const actual = selectRailAmenitiesForStrip(keys, specs);
  const ok =
    actual.length === expected.length && actual.every((item, idx) => item === expected[idx]);
  check(
    label,
    ok,
    ok ? '' : `oczekiwano [${expected.join(', ')}], jest [${actual.join(', ')}]`,
  );
}

console.log('=== Test klasyfikatora modeli pojazdow (vehicleInfo) ===');

// 1. Puste / brakujace dane
check('null zwraca null', classifyVehicleModel(null, 'tram') === null);
check('undefined zwraca null', classifyVehicleModel(undefined, 'bus') === null);
check('puste spacje zwracaja null', classifyVehicleModel('   ', 'tram') === null);

// 2. Tramwaje wysokopodlogowe i starszy tabor
expectSpecs('Konstal 105NWr', 'tram', { floor: 'high', ac: 'no', vintage: true });
expectSpecs('Konstal 105Na', 'tram', { floor: 'high', ac: 'no', vintage: true });
expectSpecs('Protram 204WrAs', 'tram', { floor: 'high', ac: 'no', vintage: true });
expectSpecs('Moderus Alfa HF04AC', 'tram', { floor: 'high', ac: 'no', vintage: true });
expectSpecs('FPS 123N', 'tram', { floor: 'high', ac: 'no', vintage: true });
expectSpecs('SGP E1', 'tram', { floor: 'high', ac: 'no', vintage: true });
expectSpecs('Tatra KT4DtM', 'tram', { floor: 'high', ac: 'no', vintage: true });
expectSpecs('Wegmann 6ZGTW', 'tram', { floor: 'high', ac: 'no', vintage: true });

// 3. Tramwaje czesciowo niskopodlogowe (w tym rozroznienie klimy Moderus Beta i 205WrAs)
expectSpecs('Moderus Beta MF02AC', 'tram', { floor: 'partial', ac: 'no', vintage: false });
expectSpecs('Moderus Beta MF15AC', 'tram', { floor: 'partial', ac: 'no', vintage: false });
expectSpecs('Moderus Beta MF16AC BD', 'tram', { floor: 'partial', ac: 'no', vintage: false });
expectSpecs('Moderus Beta MF25AC', 'tram', { floor: 'partial', ac: 'no', vintage: false });
expectSpecs('Moderus Beta MF10AC', 'tram', { floor: 'partial', ac: 'yes', vintage: false });
expectSpecs('Moderus Beta MF19AC', 'tram', { floor: 'partial', ac: 'yes', vintage: false });
expectSpecs('Moderus Beta MF24AC', 'tram', { floor: 'partial', ac: 'yes', vintage: false });
expectSpecs('Moderus Beta MF29AC BD', 'tram', { floor: 'partial', ac: 'yes', vintage: false });
expectSpecs('Protram 205WrAs', 'tram', { floor: 'partial', ac: 'no', vintage: false });
expectSpecs('Protram/Modertrans 205WrAs MF17AC', 'tram', {
  floor: 'partial',
  ac: 'yes',
  vintage: false,
});
expectSpecs('Škoda 16T', 'tram', { floor: 'partial', ac: 'yes', vintage: false });
expectSpecs('Škoda 19T', 'tram', { floor: 'partial', ac: 'yes', vintage: false });
expectSpecs('Bombardier NGT6-2', 'tram', { floor: 'partial', ac: 'yes', vintage: false });
expectSpecs('Alstom 116Na/1', 'tram', { floor: 'partial', ac: 'no', vintage: false });
expectSpecs('Alstom/TŚ 116Ndm', 'tram', { floor: 'partial', ac: 'yes', vintage: false });
expectSpecs('Duewag N8C-NF', 'tram', { floor: 'partial', ac: 'unknown', vintage: false });
expectSpecs('Pesa Twist 2012N-10', 'tram', { floor: 'partial', ac: 'yes', vintage: false });

// 4. Tramwaje 100% niskopodlogowe (Pesa 121N vs 121NbT, Gamma, Twist, Swing, Tango)
expectSpecs('Pesa 121N', 'tram', { floor: 'low', ac: 'no', vintage: false });
expectSpecs('Pesa 121NbT', 'tram', { floor: 'low', ac: 'yes', vintage: false });
expectSpecs('Pesa Twist 146N', 'tram', { floor: 'low', ac: 'yes', vintage: false });
expectSpecs('Pesa 120NaG', 'tram', { floor: 'low', ac: 'yes', vintage: false });
expectSpecs('Moderus Gamma LF07AC', 'tram', { floor: 'low', ac: 'yes', vintage: false });
expectSpecs('Hyundai Rotem 140N', 'tram', { floor: 'low', ac: 'yes', vintage: false });
expectSpecs('Stadler Tango', 'tram', { floor: 'low', ac: 'yes', vintage: false });
expectSpecs('Duewag R1.1', 'tram', { floor: 'low', ac: 'no', vintage: false });

// 5. Kolej regionalna i dalekobiezna (zbiorkom.live PKP)
expectSpecs('EN57 Pafawag 5B/6B', 'train', { floor: 'high', ac: 'no', vintage: true });
expectSpecs('EN57AL Pafawag 5B/6B', 'train', { floor: 'high', ac: 'yes', vintage: true });
expectSpecs('EN57ALd Pafawag 5B/6B', 'train', { floor: 'high', ac: 'yes', vintage: true });
expectSpecs('EN57AKM Pafawag 5B/6B', 'train', { floor: 'high', ac: 'yes', vintage: true });
expectSpecs('EN71AKŚ Pafawag 5Bg/6Bg', 'train', { floor: 'high', ac: 'yes', vintage: true });
expectSpecs('ED72Ac Pafawag 5B/6B', 'train', { floor: 'high', ac: 'yes', vintage: true });
expectSpecs('ED72 Pafawag 5B/6B', 'train', { floor: 'high', ac: 'no', vintage: true });
expectSpecs('Düwag VT627', 'train', { floor: 'high', ac: 'no', vintage: true });
expectSpecs('ED250 Alstom Pendolino', 'train', { floor: 'high', ac: 'yes', vintage: false });
expectSpecs('19WE Newag', 'train', { floor: 'high', ac: 'yes', vintage: false });
expectSpecs('48WEc Pesa Elf 2', 'train', { floor: 'low', ac: 'yes', vintage: false });
expectSpecs('22WEd Pesa Elf 2', 'train', { floor: 'low', ac: 'yes', vintage: false });
expectSpecs('31WEbc Newag Impuls 2', 'train', { floor: 'low', ac: 'yes', vintage: false });
expectSpecs('36WEha Newag Impuls 2', 'train', { floor: 'low', ac: 'yes', vintage: false });
expectSpecs('ER160 Stadler Flirt 3', 'train', { floor: 'low', ac: 'yes', vintage: false });
expectSpecs('LM-4268 Stadler Flirt 3', 'train', { floor: 'low', ac: 'yes', vintage: false });
expectSpecs('SA134 Pesa 218M', 'train', { floor: 'low', ac: 'yes', vintage: false });
expectSpecs('SA136 Pesa 219M Atribo', 'train', { floor: 'low', ac: 'yes', vintage: false });
expectSpecs('SA139 Pesa Link', 'train', { floor: 'low', ac: 'yes', vintage: false });
expectSpecs('EN97 Pesa 33WE', 'train', { floor: 'low', ac: 'yes', vintage: false });
expectSpecs('EN100 Newag 39WE', 'train', { floor: 'low', ac: 'yes', vintage: false });
expectSpecs('Siemens Desiro VT642', 'train', { floor: 'low', ac: 'yes', vintage: false });

// 6. Autobusy i trolejbusy
expectSpecs('Jelcz 120M', 'bus', { floor: 'high', ac: 'no', vintage: true });
expectSpecs('Jelcz M121I4', 'bus', { floor: 'partial', ac: 'no', vintage: true });
expectSpecs('Mercedes-Benz O530G C2', 'bus', { floor: 'low', ac: 'yes', vintage: false });
expectSpecs('Mercedes-Benz eCitaro G', 'bus', {
  floor: 'low',
  ac: 'yes',
  vintage: false,
  drive: 'electric',
});
expectSpecs('Solaris Urbino 12 electric', 'bus', {
  floor: 'low',
  ac: 'yes',
  vintage: false,
  drive: 'electric',
});
expectSpecs('Solaris Urbino 12 hydrogen', 'bus', {
  floor: 'low',
  ac: 'yes',
  vintage: false,
  drive: 'hydrogen',
});
expectSpecs('Yutong ZK6128BEVG E12', 'bus', {
  floor: 'low',
  ac: 'yes',
  vintage: false,
  drive: 'electric',
});
expectSpecs('Solaris Urbino 12', 'bus', {
  floor: 'low',
  ac: 'unknown',
  vintage: false,
  drive: undefined,
});
expectSpecs('Solaris Urbino 8,9 LE', 'bus', { floor: 'partial', ac: 'unknown', vintage: false });
expectSpecs('Iveco Crossway 12 Line NP', 'bus', { floor: 'high', ac: 'yes', vintage: false });
expectSpecs('Mercedes-Benz 519 CDI / Aveuro', 'bus', {
  floor: 'partial',
  ac: 'yes',
  vintage: false,
});
expectSpecs('Solaris Trollino 18', 'trolleybus', {
  floor: 'low',
  ac: 'yes',
  vintage: false,
  drive: undefined,
});
expectSpecs('MAN Lion`s City 18', 'bus', {
  model: "MAN Lion's City 18",
  floor: 'low',
  ac: 'yes',
  vintage: false,
});

// 7. Nieznany model (bez zgadywania)
expectSpecs('Prototyp XYZ 9000', 'bus', {
  model: 'Prototyp XYZ 9000',
  floor: 'unknown',
  ac: 'unknown',
  vintage: false,
  drive: undefined,
});
expectSpecs('Prototyp 12LF', 'bus', {
  floor: 'low',
  ac: 'unknown',
  vintage: false,
});

// 8. Laczenie udogodnien vagonweb z live specs zbiorkom.live
expectAmenities(
  'Intercity bez specs porzadkuje dostepnosc i klime na poczatek',
  ['klimatyzacja', 'gniazdka_230V', 'wifi', 'wagon_restauracyjny', 'dostepny_wozkarze'],
  null,
  ['dostepny_wozkarze', 'klimatyzacja', 'gniazdka_230V', 'wifi', 'wagon_restauracyjny'],
);
expectAmenities(
  'Regionalny Elf 2 deduplikuje klime i dostepnosc wozkow z vagonweb',
  ['klimatyzacja', 'gniazdka_230V', 'wifi', 'przewoz_rowerow', 'dostepny_wozkarze'],
  classifyVehicleModel('48WEc Pesa Elf 2', 'train'),
  ['gniazdka_230V', 'wifi', 'przewoz_rowerow'],
);
expectAmenities(
  'Klasyczny EN57 bez klimy nie pokazuje sprzecznej klimy z vagonweb',
  ['klimatyzacja', 'przewoz_rowerow', 'dostepny_wozkarze'],
  classifyVehicleModel('EN57 Pafawag 5B/6B', 'train'),
  ['dostepny_wozkarze', 'przewoz_rowerow'],
);
expectAmenities(
  'Wysokopodlogowy ED250 zachowuje dostepnosc wozkow, ale deduplikuje klime',
  ['klimatyzacja', 'gniazdka_230V', 'wifi', 'bar', 'dostepny_wozkarze', 'strefa_ciszy'],
  classifyVehicleModel('ED250 Pendolino', 'train'),
  ['dostepny_wozkarze', 'gniazdka_230V', 'wifi', 'bar', 'strefa_ciszy'],
);

if (failures > 0) {
  console.error(`\nFAIL: ${failures} testow nie przeszlo.`);
  process.exit(1);
}
console.log('\nPASS: wszystkie testy klasyfikatora pojazdow przeszly.');
