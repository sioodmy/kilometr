import { getLineColors, normalizeLineName, inferTransitMode } from '../src/services/lineIdentity';

let failures = 0;
function check(label: string, cond: boolean, detail = '') {
  console.log(`  ${cond ? 'PASS' : 'FAIL'} ${label}${detail ? `: ${detail}` : ''}`);
  if (!cond) failures++;
}

console.log('=== Test normalizacji i rozpoznawania linii ===');

// 1. Normalizacja linii kolejowych
{
  check('KD D10 -> D10', normalizeLineName('KD D10') === 'D10');
  check('KD D1 -> D1', normalizeLineName('KD D1') === 'D1');
  check('KM R1 -> R1', normalizeLineName('KM R1') === 'R1');
  check('KŚ S1 -> S1', normalizeLineName('KŚ S1') === 'S1');
  check('POLREGIO -> PR', normalizeLineName('POLREGIO') === 'PR');
  check('IC 1620 HETMAN -> IC 1620', normalizeLineName('IC 1620 HETMAN') === 'IC 1620');
  check('TLK 38100 GWAREK -> TLK 38100', normalizeLineName('TLK 38100 GWAREK') === 'TLK 38100');
  check('11572/3 -> 11572', normalizeLineName('11572/3') === '11572');
  check('KD 69123 (compact) -> KD', normalizeLineName('KD 69123', 'train', true) === 'KD');
  check(
    'POLREGIO 66201 (compact) -> PR',
    normalizeLineName('POLREGIO 66201', 'train', true) === 'PR',
  );
  check('Zwykły tramwaj 33 bez zmian', normalizeLineName('33') === '33');
  check('Zwykły autobus 115 bez zmian', normalizeLineName('115') === '115');
}

// 2. Rozpoznawanie trybu pociągów
{
  check('KD 69123 to pociąg', inferTransitMode(undefined, 'KD 69123') === 'train');
  check('D10 we Wrocławiu to pociąg', inferTransitMode(undefined, 'D10', 'wroclaw') === 'train');
  check('POLREGIO to pociąg', inferTransitMode(undefined, 'POLREGIO') === 'train');
  check('IC 1620 to pociąg', inferTransitMode(undefined, 'IC 1620') === 'train');
  check('33 to tramwaj', inferTransitMode(undefined, '33') === 'tram');
  check('115 to autobus', inferTransitMode(undefined, '115') === 'bus');
}

{
  const luminance = (hex: string) => {
    const channels = hex.match(/[a-f\d]{2}/gi)!.map((channel) => {
      const value = parseInt(channel, 16) / 255;
      return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
    });
    return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
  };
  const cases: Parameters<typeof getLineColors>[] = [
    [undefined, 'tram'],
    [undefined, 'bus'],
    ['IC 1620', 'train'],
    ['M1', 'subway'],
    ['M2', 'subway'],
    ['M3', 'subway'],
    ['Polinka', 'cable'],
    ['150', 'trolleybus'],
  ];
  for (const mode of ['tram', 'bus'] as const) {
    for (let line = 1; line <= 500; line++) cases.push([String(line), mode]);
  }
  const lowContrast = cases.filter((args) => {
    const { fg, bg } = getLineColors(...args);
    const values = [luminance(fg), luminance(bg)].sort((a, b) => a - b);
    return (values[1] + 0.05) / (values[0] + 0.05) < 4.5;
  });
  check(
    'Małe oznaczenia linii mają kontrast AA (4,5:1)',
    lowContrast.length === 0,
    JSON.stringify(lowContrast),
  );
}

console.log('────────────────────────────────────────────────────────────');
console.log(`Wynik: ${failures === 0 ? 'WSZYSTKO OK' : `${failures} BŁĘDÓW`}`);

if (failures > 0) {
  process.exit(1);
}
