import { getLineColors, normalizeLineName, inferTransitMode } from '../src/services/lineIdentity';
import {
  RAIL_AGENCY_COLORS,
  getRailAgencyColor,
  inferRailAgency,
  inferRailAgencyFromLine,
  isIntercityTrain,
  railBadgeLine,
  railDirectionLabel,
} from '../src/services/railIdentity';

let failures = 0;
function check(label: string, cond: boolean, detail = '') {
  console.log(`  ${cond ? 'PASS' : 'FAIL'} ${label}${detail ? `: ${detail}` : ''}`);
  if (!cond) failures++;
}

console.log('=== Test tożsamości kolejowej (railIdentity) ===');

// 0. Tożsamość przewoźnika i treść badge'a
{
  const leg = (over: object) => ({ line: '', direction: '', ...over });
  check('railAgency z metadanych', inferRailAgency(leg({ railAgency: 'KS' })) === 'KS');
  check('railAgency z routeId', inferRailAgency(leg({ line: '', routeId: 'KD:69312' })) === 'KD');
  check('railAgency z POLREGIO', inferRailAgency(leg({ line: 'POLREGIO 66201' })) === 'PR');
  check('IC na linii z numerem', isIntercityTrain(leg({ line: 'IC 1620 HETMAN' })));
  check('IC po metadanych', isIntercityTrain(leg({ railAgency: 'IC', line: '17100' })));
  check('S1 to nie IC', !(isIntercityTrain(leg({ line: 'S1' })) as boolean));
  check(
    'IC: badge z numerem, kierunek z nazwą kursu',
    railBadgeLine(leg({ railAgency: 'IC', line: 'TLK 38100', trainNumber: '38100' })) === '38100' &&
      railDirectionLabel(
        leg({
          railAgency: 'IC',
          line: 'TLK 38100 GWAREK',
          trainName: 'Gwarek',
          direction: 'Kołobrzeg',
        }),
      ) === 'Gwarek · Kołobrzeg',
  );
  check('regional: badge z linią handlową', railBadgeLine(leg({ railLine: 'S1' })) === 'S1');
  check('regional bez zbiorkom: badge z GTFS', railBadgeLine(leg({ line: 'KD D10' })) === 'KD D10');
}

// 0.1. Kolorystyka brandingu przewoźników kolejowych
console.log('=== Test kolorystyki brandingu przewoźników ===');
{
  check(
    'RAIL_AGENCY_COLORS zawiera zestaw przewoźników',
    Object.keys(RAIL_AGENCY_COLORS).length >= 10,
  );
  check('KŚ ma błękit śląski', getRailAgencyColor('KŚ') === '#1976D2');
  check('KS alias KŚ ma błękit', getRailAgencyColor('KS') === '#1976D2');
  check('PR ma czerwień Polregio', getRailAgencyColor('PR') === '#D32F2F');
  check('IC ma kobalt PKP Intercity', getRailAgencyColor('IC') === '#0D47A1');
  check('KM ma mazowiecką zieleń', getRailAgencyColor('KM') === '#2E7D32');
  check('KD ma dolnośląskie złoto', getRailAgencyColor('KD') === '#FFB957');
  check('ŁKA ma fiolet', getRailAgencyColor('ŁKA') === '#7B1FA2');
  check('KW ma czerwień wielkopolską', getRailAgencyColor('KW') === '#C2185B');
  check('KMŁ ma błękit małopolski', getRailAgencyColor('KMŁ') === '#0288D1');
  check('WKD ma granat', getRailAgencyColor('WKD') === '#1A237E');

  check('inferRailAgencyFromLine KD D10 -> KD', inferRailAgencyFromLine('KD D10') === 'KD');
  check('inferRailAgencyFromLine KŚ S1 -> KŚ', inferRailAgencyFromLine('KŚ S1') === 'KŚ');
  check('inferRailAgencyFromLine PR 66201 -> PR', inferRailAgencyFromLine('PR 66201') === 'PR');
  check('inferRailAgencyFromLine IC 1620 -> IC', inferRailAgencyFromLine('IC 1620') === 'IC');
  check('inferRailAgencyFromLine S1 w GZM -> KŚ', inferRailAgencyFromLine('S1', 'gzm') === 'KŚ');
  check('inferRailAgencyFromLine D1 we Wrocławiu -> KD', inferRailAgencyFromLine('D1', 'wroclaw') === 'KD');
  check('inferRailAgencyFromLine S1 w Warszawie -> SKM', inferRailAgencyFromLine('S1', 'warszawa') === 'SKM');

  check('getLineColors KŚ S1 ma błękit', getLineColors('KŚ S1', 'train').bg === '#1976D2');
  check('getLineColors PR 66201 ma czerwień', getLineColors('PR 66201', 'train').bg === '#D32F2F');
  check('getLineColors IC 1620 ma granat', getLineColors('IC 1620', 'train').bg === '#0D47A1');
  check('getLineColors KM R1 ma zieleń', getLineColors('KM R1', 'train').bg === '#2E7D32');
  check('getLineColors KD D10 ma złoto', getLineColors('KD D10', 'train').bg === '#FFB957');
  check('getLineColors ŁKA ma fiolet', getLineColors('ŁKA 1120', 'train').bg === '#7B1FA2');
  check('getLineColors KW ma czerwień', getLineColors('KW 77201', 'train').bg === '#C2185B');
  check('getLineColors WKD ma granat', getLineColors('WKD', 'train').bg === '#1A237E');
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
    ['KD D10', 'train'],
    ['KŚ S1', 'train'],
    ['PR 66201', 'train'],
    ['KM R1', 'train'],
    ['ŁKA 1120', 'train'],
    ['KW 77201', 'train'],
    ['WKD', 'train'],
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
    'Oznaczenia linii (w tym kolejowych) mają kontrast AA (4,5:1)',
    lowContrast.length === 0,
    JSON.stringify(lowContrast),
  );
}

console.log('────────────────────────────────────────────────────────────');
console.log(`Wynik: ${failures === 0 ? 'WSZYSTKO OK' : `${failures} BŁĘDÓW`}`);

if (failures > 0) {
  process.exit(1);
}
