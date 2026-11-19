import { CITIES, type CityId } from '../../src/cities';
import type { RailAgency } from '../../src/services/railIconPaths';

type TransitModeKind = 'bus' | 'tram' | 'trolley' | 'metro' | 'rail' | 'cable';

export interface OperatorEntry {
  id: string;
  name: string;
  shortCode: string;
  railAgency?: RailAgency;
  kind: 'municipal' | 'rail' | 'cable';
  modes: readonly TransitModeKind[];
}

export interface CoveragePlace {
  key: CityId;
  name: string;
  regionLabel?: string;
  lat: number;
  lon: number;
  aliases: readonly string[];
  operators: readonly OperatorEntry[];
  newsSource?: string;
  railGateways: readonly string[];
}

const GZM_ALIASES: readonly string[] = [
  'GZM',
  'Śląsk',
  'Będzin',
  'Bieruń',
  'Bobrowniki',
  'Bojszowy',
  'Bytom',
  'Chełm Śląski',
  'Chorzów',
  'Czeladź',
  'Dąbrowa Górnicza',
  'Gierałtowice',
  'Gliwice',
  'Imielin',
  'Katowice',
  'Knurów',
  'Kobiór',
  'Lędziny',
  'Łaziska Górne',
  'Mierzęcice',
  'Mikołów',
  'Mysłowice',
  'Ożarowice',
  'Pyrzowice',
  'Lotnisko Katowice',
  'Piekary Śląskie',
  'Pilchowice',
  'Psary',
  'Pyskowice',
  'Radzionków',
  'Ruda Śląska',
  'Rudziniec',
  'Siemianowice Śląskie',
  'Siewierz',
  'Sławków',
  'Sosnowiec',
  'Sośnicowice',
  'Świerklaniec',
  'Świętochłowice',
  'Tarnowskie Góry',
  'Tychy',
  'Wojkowice',
  'Wyry',
  'Zabrze',
  'Zbrosławice',
];

const CITY_OPERATORS: Record<CityId, readonly OperatorEntry[]> = {
  wroclaw: [
    { id: 'mpk-wroclaw', name: 'MPK Wrocław', shortCode: 'MPK', kind: 'municipal', modes: ['tram', 'bus'] },
    { id: 'kd', name: 'Koleje Dolnośląskie', shortCode: 'KD', railAgency: 'KD', kind: 'rail', modes: ['rail'] },
    { id: 'polinka', name: 'Kolej linowa Polinka', shortCode: 'P', kind: 'cable', modes: ['cable'] },
  ],
  krakow: [
    { id: 'ztp-krakow', name: 'ZTP Kraków (KMK)', shortCode: 'ZTP', kind: 'municipal', modes: ['tram', 'bus'] },
    { id: 'kml', name: 'Koleje Małopolskie', shortCode: 'KMŁ', railAgency: 'KMŁ', kind: 'rail', modes: ['rail'] },
  ],
  gzm: [
    { id: 'ztm-gzm', name: 'ZTM (Metropolia GZM)', shortCode: 'ZTM', kind: 'municipal', modes: ['bus', 'tram', 'trolley'] },
    { id: 'ks', name: 'Koleje Śląskie', shortCode: 'KŚ', railAgency: 'KŚ', kind: 'rail', modes: ['rail'] },
    { id: 'pr-gzm', name: 'POLREGIO', shortCode: 'PR', railAgency: 'PR', kind: 'rail', modes: ['rail'] },
    { id: 'ic-gzm', name: 'PKP Intercity', shortCode: 'IC', railAgency: 'IC', kind: 'rail', modes: ['rail'] },
  ],
  warszawa: [
    { id: 'wtp', name: 'WTP Warszawa (ZTM)', shortCode: 'WTP', kind: 'municipal', modes: ['metro', 'tram', 'bus'] },
    { id: 'skm-waw', name: 'SKM Warszawa', shortCode: 'SKM', railAgency: 'SKM', kind: 'rail', modes: ['rail'] },
    { id: 'km', name: 'Koleje Mazowieckie', shortCode: 'KM', railAgency: 'KM', kind: 'rail', modes: ['rail'] },
    { id: 'wkd', name: 'WKD', shortCode: 'WKD', railAgency: 'WKD', kind: 'rail', modes: ['rail'] },
  ],
  poznan: [
    { id: 'ztm-poznan', name: 'ZTM Poznań', shortCode: 'ZTM', kind: 'municipal', modes: ['tram', 'bus'] },
    { id: 'kw', name: 'Koleje Wielkopolskie', shortCode: 'KW', railAgency: 'KW', kind: 'rail', modes: ['rail'] },
  ],
  trojmiasto: [
    { id: 'ztm-gdansk', name: 'ZTM Gdańsk', shortCode: 'ZTM', kind: 'municipal', modes: ['tram', 'bus'] },
    { id: 'zkm-gdynia', name: 'ZKM Gdynia', shortCode: 'ZKM', kind: 'municipal', modes: ['trolley', 'bus'] },
    { id: 'skmt', name: 'PKP SKM w Trójmieście', shortCode: 'SKM', railAgency: 'SKMT', kind: 'rail', modes: ['rail'] },
  ],
  lodz: [
    { id: 'mpk-lodz', name: 'MPK Łódź', shortCode: 'MPK', kind: 'municipal', modes: ['tram', 'bus'] },
    { id: 'lka', name: 'Łódzka Kolej Aglomeracyjna', shortCode: 'ŁKA', railAgency: 'ŁKA', kind: 'rail', modes: ['rail'] },
  ],
  szczecin: [{ id: 'zditm-szczecin', name: 'ZDiTM Szczecin', shortCode: 'ZDiTM', kind: 'municipal', modes: ['tram', 'bus'] }],
  kielce: [{ id: 'ztm-kielce', name: 'ZTM Kielce', shortCode: 'ZTM', kind: 'municipal', modes: ['bus'] }],
  olsztyn: [{ id: 'zdzit-olsztyn', name: 'ZDZiT Olsztyn', shortCode: 'ZDZiT', kind: 'municipal', modes: ['tram', 'bus'] }],
  bialystok: [{ id: 'bkm-bialystok', name: 'BKM Białystok', shortCode: 'BKM', kind: 'municipal', modes: ['bus'] }],
  opole: [{ id: 'mzk-opole', name: 'MZK Opole', shortCode: 'MZK', kind: 'municipal', modes: ['bus'] }],
  rzeszow: [{ id: 'ztm-rzeszow', name: 'ZTM Rzeszów', shortCode: 'ZTM', kind: 'municipal', modes: ['bus'] }],
  lublin: [{ id: 'zditm-lublin', name: 'ZDiTM Lublin', shortCode: 'ZDiTM', kind: 'municipal', modes: ['trolley', 'bus'] }],
  radom: [{ id: 'mzdik-radom', name: 'MZDiK Radom', shortCode: 'MZDiK', kind: 'municipal', modes: ['bus'] }],
  bydgoszcz: [{ id: 'zdmikp-bydgoszcz', name: 'ZDMiKP Bydgoszcz', shortCode: 'ZDMiKP', kind: 'municipal', modes: ['tram', 'bus'] }],
  torun: [{ id: 'mzk-torun', name: 'MZK Toruń', shortCode: 'MZK', kind: 'municipal', modes: ['tram', 'bus'] }],
  elblag: [{ id: 'zkm-elblag', name: 'ZKM Elbląg', shortCode: 'ZKM', kind: 'municipal', modes: ['tram', 'bus'] }],
  gorzow: [{ id: 'mzk-gorzow', name: 'MZK Gorzów Wlkp.', shortCode: 'MZK', kind: 'municipal', modes: ['tram', 'bus'] }],
  czestochowa: [{ id: 'mpk-czestochowa', name: 'MPK Częstochowa', shortCode: 'MPK', kind: 'municipal', modes: ['tram', 'bus'] }],
  zielonagora: [{ id: 'mzk-zielonagora', name: 'MZK Zielona Góra', shortCode: 'MZK', kind: 'municipal', modes: ['bus'] }],
  rybnik: [{ id: 'km-rybnik', name: 'KM Rybnik', shortCode: 'KM', kind: 'municipal', modes: ['bus'] }],
  slupsk: [{ id: 'zim-slupsk', name: 'ZIM Słupsk', shortCode: 'ZIM', kind: 'municipal', modes: ['bus'] }],
  walbrzych: [{ id: 'mzuk-walbrzych', name: 'MZUK Wałbrzych', shortCode: 'MZUK', kind: 'municipal', modes: ['bus'] }],
  kalisz: [
    { id: 'kla-kalisz', name: 'KLA Kalisz', shortCode: 'KLA', kind: 'municipal', modes: ['bus'] },
    { id: 'pks-kalisz', name: 'PKS Kalisz', shortCode: 'PKS', kind: 'municipal', modes: ['bus'] },
  ],
  siedlce: [{ id: 'mpk-siedlce', name: 'MPK Siedlce', shortCode: 'MPK', kind: 'municipal', modes: ['bus'] }],
  lomza: [{ id: 'mpk-lomza', name: 'MPK Łomża', shortCode: 'MPK', kind: 'municipal', modes: ['bus'] }],
  krosno: [{ id: 'mks-krosno', name: 'MKS Krosno', shortCode: 'MKS', kind: 'municipal', modes: ['bus'] }],
  jaslo: [{ id: 'mks-jaslo', name: 'MKS Jasło', shortCode: 'MKS', kind: 'municipal', modes: ['bus'] }],
  olkusz: [{ id: 'zkgkm-olkusz', name: 'ZKGKM Olkusz', shortCode: 'ZKGKM', kind: 'municipal', modes: ['bus'] }],
  chrzanow: [{ id: 'zkkm-chrzanow', name: 'ZKKM Chrzanów', shortCode: 'ZKKM', kind: 'municipal', modes: ['bus'] }],
  bochnia: [{ id: 'rpk-bochnia', name: 'RPK Bochnia', shortCode: 'RPK', kind: 'municipal', modes: ['bus'] }],
  ilawa: [{ id: 'zkm-ilawa', name: 'ZKM Iława', shortCode: 'ZKM', kind: 'municipal', modes: ['bus'] }],
};

const CITY_NEWS_SOURCES: Partial<Record<CityId, string>> = {
  wroclaw: 'MPK Wrocław · wroclaw.pl',
  krakow: 'ZTP Kraków',
  gzm: 'ZTM GZM',
  warszawa: 'WTP Warszawa',
  poznan: 'ZTM Poznań',
  trojmiasto: 'ZTM Gdańsk',
  lodz: 'MPK Łódź',
  szczecin: 'ZDiTM Szczecin',
  kielce: 'ZTM Kielce',
  olsztyn: 'ZDZiT Olsztyn',
  bialystok: 'BKM Białystok',
  opole: 'MZK Opole',
  rzeszow: 'ZTM Rzeszów',
  lublin: 'ZDiTM Lublin',
  radom: 'MZDiK Radom',
};

const CITY_ALIASES: Partial<Record<CityId, readonly string[]>> = {
  gzm: GZM_ALIASES,
  trojmiasto: ['Gdańsk', 'Gdynia', 'Sopot', 'Wejherowo', 'Rumia', 'Reda', 'Pruszcz Gdański'],
  warszawa: ['Pruszków', 'Legionowo', 'Piaseczno', 'Otwock', 'Wołomin', 'Ząbki', 'Marki', 'Łomianki'],
  krakow: ['Wieliczka', 'Skawina', 'Niepołomice', 'Zabierzów'],
  wroclaw: ['Kąty Wrocławskie', 'Siechnice', 'Długołęka', 'Kobierzyce'],
  poznan: ['Luboń', 'Swarzędz', 'Komorniki', 'Tarnowo Podgórne'],
  lodz: ['Zgierz', 'Pabianice', 'Konstantynów Łódzki', 'Aleksandrów Łódzki'],
  kalisz: ['Ostrów Wielkopolski', 'Pleszew', 'Nowe Skalmierzyce'],
};

const DISPLAY_NAMES: Partial<Record<CityId, string>> = {
  gzm: 'Metropolia GZM',
};

const REGION_SUBTITLES: Partial<Record<CityId, string>> = {
  gzm: 'Katowice · Gliwice · Sosnowiec',
  trojmiasto: 'Gdańsk · Gdynia · Sopot',
};

export const COVERAGE_CITIES: readonly CoveragePlace[] = CITIES.map((city) => ({
  key: city.id,
  name: DISPLAY_NAMES[city.id] ?? city.name,
  regionLabel: REGION_SUBTITLES[city.id],
  lat: city.center.lat,
  lon: city.center.lon,
  aliases: CITY_ALIASES[city.id] ?? [],
  operators: CITY_OPERATORS[city.id],
  newsSource: CITY_NEWS_SOURCES[city.id],
  railGateways: city.railGateways ?? [],
}));

export function normalizeCoverageQuery(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/ł/g, 'l')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

export function filterCoveragePlaces(query: string): readonly CoveragePlace[] {
  const q = normalizeCoverageQuery(query);
  if (!q) return COVERAGE_CITIES;
  return COVERAGE_CITIES.filter((place) => {
    if (normalizeCoverageQuery(place.name).includes(q)) return true;
    if (place.regionLabel && normalizeCoverageQuery(place.regionLabel).includes(q)) return true;
    if (place.aliases.some((a) => normalizeCoverageQuery(a).includes(q))) return true;
    return place.operators.some(
      (op) =>
        normalizeCoverageQuery(op.name).includes(q) ||
        normalizeCoverageQuery(op.shortCode).includes(q),
    );
  });
}

export function findMatchedAlias(place: CoveragePlace, query: string): string | null {
  const q = normalizeCoverageQuery(query);
  if (!q) return null;
  if (normalizeCoverageQuery(place.name).includes(q)) return null;
  const hit = place.aliases.find((alias) => normalizeCoverageQuery(alias).includes(q));
  return hit ?? null;
}
