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
  populationK: number;
  pinRadius: number;
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
  bielskobiala: [{ id: 'bielskobiala-transit', name: "MZK Bielsko-Biała", shortCode: "MZK", kind: 'municipal', modes: ['bus'] }],
  koszalin: [{ id: 'koszalin-transit', name: "MZK Koszalin", shortCode: "MZK", kind: 'municipal', modes: ['bus'] }],
  piotrkow: [{ id: 'piotrkow-transit', name: "MZK Piotrków Trybunalski", shortCode: "MZK", kind: 'municipal', modes: ['bus'] }],
  tomaszow: [{ id: 'tomaszow-transit', name: "MZK Tomaszów Mazowiecki", shortCode: "MZK", kind: 'municipal', modes: ['bus'] }],
  skarzysko: [{ id: 'skarzysko-transit', name: "ZKM Skarżysko-Kamienna", shortCode: "ZKM", kind: 'municipal', modes: ['bus'] }],
  oswiecim: [{ id: 'oswiecim-transit', name: "MZK Oświęcim", shortCode: "MZK", kind: 'municipal', modes: ['bus'] }],
  swinoujscie: [{ id: 'swinoujscie-transit', name: "Komunikacja Autobusowa Świnoujście", shortCode: "KA", kind: 'municipal', modes: ['bus'] }],
  zakopane: [{ id: 'zakopane-transit', name: "Komunikacja Miejska Zakopane", shortCode: "KM", kind: 'municipal', modes: ['bus'] }],
  plock: [{ id: 'plock-transit', name: "KM Płock", shortCode: "KM", kind: 'municipal', modes: ['bus'] }],
  tarnow: [{ id: 'tarnow-transit', name: "ZDiK Tarnów", shortCode: "ZDiK", kind: 'municipal', modes: ['bus'] }],
  legnica: [{ id: 'legnica-transit', name: "MPK Legnica", shortCode: "MPK", kind: 'municipal', modes: ['bus'] }],
  jastrzebie: [{ id: 'jastrzebie-transit', name: "MZK Jastrzębie-Zdrój", shortCode: "MZK", kind: 'municipal', modes: ['bus'] }],
  pila: [{ id: 'pila-transit', name: "MZK Piła", shortCode: "MZK", kind: 'municipal', modes: ['bus'] }],
  konin: [{ id: 'konin-transit', name: "MZK Konin", shortCode: "MZK", kind: 'municipal', modes: ['bus'] }],
  suwalki: [{ id: 'suwalki-transit', name: "PGK Suwałki", shortCode: "PGK", kind: 'municipal', modes: ['bus'] }],
  ostrowiec: [{ id: 'ostrowiec-transit', name: "MZK Ostrowiec Świętokrzyski", shortCode: "MZK", kind: 'municipal', modes: ['bus'] }],
  stalowawola: [{ id: 'stalowawola-transit', name: "MZK Stalowa Wola", shortCode: "MZK", kind: 'municipal', modes: ['bus'] }],
  przemysl: [{ id: 'przemysl-transit', name: "MZK Przemyśl", shortCode: "MZK", kind: 'municipal', modes: ['bus'] }],
  elk: [{ id: 'elk-transit', name: "MZK Ełk", shortCode: "MZK", kind: 'municipal', modes: ['bus'] }],
  leszno: [{ id: 'leszno-transit', name: "MZK Leszno", shortCode: "MZK", kind: 'municipal', modes: ['bus'] }],
  chelm: [{ id: 'chelm-transit', name: "CLA Chełm", shortCode: "CLA", kind: 'municipal', modes: ['bus'] }],
  mielec: [{ id: 'mielec-transit', name: "MKS Mielec", shortCode: "MKS", kind: 'municipal', modes: ['bus'] }],
  tczew: [{ id: 'tczew-transit', name: "ZKM Tczew", shortCode: "ZKM", kind: 'municipal', modes: ['bus'] }],
  ostroleka: [{ id: 'ostroleka-transit', name: "MZK Ostrołęka", shortCode: "MZK", kind: 'municipal', modes: ['bus'] }],
  starachowice: [{ id: 'starachowice-transit', name: "ZEC Starachowice", shortCode: "ZEC", kind: 'municipal', modes: ['bus'] }],
  kutno: [{ id: 'kutno-transit', name: "MZK Kutno", shortCode: "MZK", kind: 'municipal', modes: ['bus'] }],
  kolobrzeg: [{ id: 'kolobrzeg-transit', name: "Komunikacja Miejska Kołobrzeg", shortCode: "KM", kind: 'municipal', modes: ['bus'] }],
  radomsko: [{ id: 'radomsko-transit', name: "MPK Radomsko", shortCode: "MPK", kind: 'municipal', modes: ['bus'] }],
  boleslawiec: [{ id: 'boleslawiec-transit', name: "MZK Bolesławiec", shortCode: "MZK", kind: 'municipal', modes: ['bus'] }],
  cieszyn: [{ id: 'cieszyn-transit', name: "ZGK Cieszyn", shortCode: "ZGK", kind: 'municipal', modes: ['bus'] }],
  zywiec: [{ id: 'zywiec-transit', name: "MZK Żywiec", shortCode: "MZK", kind: 'municipal', modes: ['bus'] }],
  krasnik: [{ id: 'krasnik-transit', name: "MPK Kraśnik", shortCode: "MPK", kind: 'municipal', modes: ['bus'] }],
  grodzisk: [{ id: 'grodzisk-transit', name: "GPA Grodzisk Mazowiecki", shortCode: "GPA", kind: 'municipal', modes: ['bus'] }],
  pruszkow: [{ id: 'pruszkow-transit', name: "Komunikacja Pruszków", shortCode: "KM", kind: 'municipal', modes: ['bus'] }],
  sochaczew: [{ id: 'sochaczew-transit', name: "ZKM Sochaczew", shortCode: "ZKM", kind: 'municipal', modes: ['bus'] }],
  minskmazowiecki: [{ id: 'minskmazowiecki-transit', name: "Komunikacja Mińsk Mazowiecki", shortCode: "KM", kind: 'municipal', modes: ['bus'] }],
  otwock: [{ id: 'otwock-transit', name: "Bezpłatna Komunikacja Otwock", shortCode: "BKO", kind: 'municipal', modes: ['bus'] }],
  nowydwormaz: [{ id: 'nowydwormaz-transit', name: "NDM Komunikacja", shortCode: "NDM", kind: 'municipal', modes: ['bus'] }],
  zabki: [{ id: 'zabki-transit', name: "Komunikacja Ząbki", shortCode: "KM", kind: 'municipal', modes: ['bus'] }],
  pabianice: [{ id: 'pabianice-transit', name: "MZK Pabianice", shortCode: "MZK", kind: 'municipal', modes: ['bus'] }],
  zgierz: [{ id: 'zgierz-transit', name: "MUK Zgierz", shortCode: "MUK", kind: 'municipal', modes: ['bus'] }],
  grudziadz: [{ id: 'grudziadz-transit', name: "MZK Grudziądz", shortCode: "MZK", kind: 'municipal', modes: ['tram', 'bus'] }],
  jaworzno: [{ id: 'jaworzno-transit', name: "PKM Jaworzno", shortCode: "PKM", kind: 'municipal', modes: ['bus'] }],
  stargard: [{ id: 'stargard-transit', name: "MPK Stargard", shortCode: "MPK", kind: 'municipal', modes: ['bus'] }],
  gniezno: [{ id: 'gniezno-transit', name: "MPK Gniezno", shortCode: "MPK", kind: 'municipal', modes: ['bus'] }],
  zamosc: [{ id: 'zamosc-transit', name: "MZK Zamość", shortCode: "MZK", kind: 'municipal', modes: ['bus'] }],
  kedzierzynkozle: [{ id: 'kedzierzynkozle-transit', name: "MZK Kędzierzyn-Koźle", shortCode: "MZK", kind: 'municipal', modes: ['bus'] }],
  belchatow: [{ id: 'belchatow-transit', name: "MZK Bełchatów", shortCode: "MZK", kind: 'municipal', modes: ['bus'] }],
  raciborz: [{ id: 'raciborz-transit', name: "PK Racibórz", shortCode: "PK", kind: 'municipal', modes: ['bus'] }],
  tarnobrzeg: [{ id: 'tarnobrzeg-transit', name: "MKS Tarnobrzeg", shortCode: "MKS", kind: 'municipal', modes: ['bus'] }],
  skierniewice: [{ id: 'skierniewice-transit', name: "MZK Skierniewice", shortCode: "MZK", kind: 'municipal', modes: ['bus'] }],
  starogard: [{ id: 'starogard-transit', name: "MZK Starogard Gdański", shortCode: "MZK", kind: 'municipal', modes: ['bus'] }],
  zawiercie: [{ id: 'zawiercie-transit', name: "ZKM Zawiercie", shortCode: "ZKM", kind: 'municipal', modes: ['bus'] }],
  nysa: [{ id: 'nysa-transit', name: "MZK Nysa", shortCode: "MZK", kind: 'municipal', modes: ['bus'] }],
  zdunskawola: [{ id: 'zdunskawola-transit', name: "MPK Zduńska Wola", shortCode: "MPK", kind: 'municipal', modes: ['bus'] }],
  sieradz: [{ id: 'sieradz-transit', name: "MPK Sieradz", shortCode: "MPK", kind: 'municipal', modes: ['bus'] }],
  malbork: [{ id: 'malbork-transit', name: "MZK Malbork", shortCode: "MZK", kind: 'municipal', modes: ['bus'] }],
  szczecinek: [{ id: 'szczecinek-transit', name: "KM Szczecinek", shortCode: "KM", kind: 'municipal', modes: ['bus'] }],
  nowasol: [{ id: 'nowasol-transit', name: "MZK Nowa Sól", shortCode: "MZK", kind: 'municipal', modes: ['bus'] }],
  olesnica: [{ id: 'olesnica-transit', name: "Oleśnicka Komunikacja", shortCode: "OK", kind: 'municipal', modes: ['bus'] }],
  czechowicedziedzice: [{ id: 'czechowicedziedzice-transit', name: "PKM Czechowice-Dziedzice", shortCode: "PKM", kind: 'municipal', modes: ['bus'] }],
  ostroda: [{ id: 'ostroda-transit', name: "Żegluga Ostródzko-Elbląska", shortCode: "ŻOE", kind: 'municipal', modes: ['bus'] }],
  nowytarg: [{ id: 'nowytarg-transit', name: "MZK Nowy Targ", shortCode: "MZK", kind: 'municipal', modes: ['bus'] }],
  augustow: [{ id: 'augustow-transit', name: "Komunikacja Miejska Augustów", shortCode: "KM", kind: 'municipal', modes: ['bus'] }],
  ketrzyn: [{ id: 'ketrzyn-transit', name: "Komunikacja Miejska Kętrzyn", shortCode: "KM", kind: 'municipal', modes: ['bus'] }],
  gorlice: [{ id: 'gorlice-transit', name: "MZK Gorlice", shortCode: "MZK", kind: 'municipal', modes: ['bus'] }],
  zgorzelec: [{ id: 'zgorzelec-transit', name: "Komunikacja Miejska Zgorzelec", shortCode: "KM", kind: 'municipal', modes: ['bus'] }],
  jarocin: [{ id: 'jarocin-transit', name: "Jarocińskie Linie Autobusowe", shortCode: "JLA", kind: 'municipal', modes: ['bus'] }],
  polkowice: [{ id: 'polkowice-transit', name: "ZKM Polkowice", shortCode: "ZKM", kind: 'municipal', modes: ['bus'] }],
  zagan: [{ id: 'zagan-transit', name: "MZK Żagań", shortCode: "MZK", kind: 'municipal', modes: ['bus'] }],
  wrzesnia: [{ id: 'wrzesnia-transit', name: "Komunikacja Gminy Września", shortCode: "KGW", kind: 'municipal', modes: ['bus'] }],
  walcz: [{ id: 'walcz-transit', name: "ZKM Wałcz", shortCode: "ZKM", kind: 'municipal', modes: ['bus'] }],
  gizycko: [{ id: 'gizycko-transit', name: "Giżycka Komunikacja Miejska", shortCode: "GKM", kind: 'municipal', modes: ['bus'] }],
  krotoszyn: [{ id: 'krotoszyn-transit', name: "MZK Krotoszyn", shortCode: "MZK", kind: 'municipal', modes: ['bus'] }],
  koscierzyna: [{ id: 'koscierzyna-transit', name: "Komunikacja Miejska Kościerzyna", shortCode: "KM", kind: 'municipal', modes: ['bus'] }],
  sandomierz: [{ id: 'sandomierz-transit', name: "ZKM Sandomierz", shortCode: "ZKM", kind: 'municipal', modes: ['bus'] }],
  bartoszyce: [{ id: 'bartoszyce-transit', name: "ZKM Bartoszyce", shortCode: "ZKM", kind: 'municipal', modes: ['bus'] }],
  wielun: [{ id: 'wielun-transit', name: "Komunikacja Miejska Wieluń", shortCode: "KM", kind: 'municipal', modes: ['bus'] }],
  mragowo: [{ id: 'mragowo-transit', name: "Komunikacja Miejska Mrągowo", shortCode: "KM", kind: 'municipal', modes: ['bus'] }],
  wagrowiec: [{ id: 'wagrowiec-transit', name: "ZKM Wągrowiec", shortCode: "ZKM", kind: 'municipal', modes: ['bus'] }],
  swiecie: [{ id: 'swiecie-transit', name: "Komunikacja Miejska Świecie", shortCode: "KM", kind: 'municipal', modes: ['bus'] }],
  dzialdowo: [{ id: 'dzialdowo-transit', name: "Komunikacja Miejska Działdowo", shortCode: "KM", kind: 'municipal', modes: ['bus'] }],
  bielskpodlaski: [{ id: 'bielskpodlaski-transit', name: "Komunikacja Miejska Bielsk Podlaski", shortCode: "KM", kind: 'municipal', modes: ['bus'] }],
  gostyn: [{ id: 'gostyn-transit', name: "Komunikacja Miejska Gostyń", shortCode: "KM", kind: 'municipal', modes: ['bus'] }],
  brzesko: [{ id: 'brzesko-transit', name: "MPK Brzesko", shortCode: "MPK", kind: 'municipal', modes: ['bus'] }],
  lidzbarkwarminski: [{ id: 'lidzbarkwarminski-transit', name: "Komunikacja Miejska Lidzbark Warmiński", shortCode: "KM", kind: 'municipal', modes: ['bus'] }],
  chodziez: [{ id: 'chodziez-transit', name: "MZK Chodzież", shortCode: "MZK", kind: 'municipal', modes: ['bus'] }],
  pszczyna: [{ id: 'pszczyna-transit', name: "Komunikacja Powiatu Pszczyńskiego", shortCode: "KPP", kind: 'municipal', modes: ['bus'] }],
  wodzislaw: [{ id: 'wodzislaw-transit', name: "Wodzisławska Komunikacja Powiatowa", shortCode: "WKP", kind: 'municipal', modes: ['bus'] }],
  zabkowice: [{ id: 'zabkowice-transit', name: "Komunikacja Miejska Ząbkowice Śląskie", shortCode: "KM", kind: 'municipal', modes: ['bus'] }],
  strzelin: [{ id: 'strzelin-transit', name: "Strzelińska Komunikacja Publiczna", shortCode: "SKP", kind: 'municipal', modes: ['bus'] }],
  srodaslaska: [{ id: 'srodaslaska-transit', name: "Średzka Komunikacja Publiczna", shortCode: "ŚKP", kind: 'municipal', modes: ['bus'] }],
  jedrzejow: [{ id: 'jedrzejow-transit', name: "Komunikacja Miejska Jędrzejów", shortCode: "KM", kind: 'municipal', modes: ['bus'] }],
  kozienice: [{ id: 'kozienice-transit', name: "Kozienicka Komunikacja Publiczna", shortCode: "KKP", kind: 'municipal', modes: ['bus'] }],
  oborniki: [{ id: 'oborniki-transit', name: "Komunikacja Miejska Oborniki", shortCode: "KM", kind: 'municipal', modes: ['bus'] }],
  wieliczka: [{ id: 'wieliczka-transit', name: "Wielicka Komunikacja", shortCode: "WKT", kind: 'municipal', modes: ['bus'] }],
  myszkow: [{ id: 'myszkow-transit', name: "ZPG Jedźmy Razem", shortCode: "ZPG", kind: 'municipal', modes: ['bus'] }],
  kartuzy: [{ id: 'kartuzy-transit', name: "Gryf Kartuzy", shortCode: "Gryf", kind: 'municipal', modes: ['bus'] }],
  slubice: [{ id: 'slubice-transit', name: "Transhand Słubice", shortCode: "TH", kind: 'municipal', modes: ['bus'] }],
};

// Przybliżona liczba mieszkańców (w tysiącach) dla proporcjonalnej wielkości pinów na mapie.
const CITY_POPULATION_K: Record<CityId, number> = {
  gzm: 2100,
  warszawa: 1860,
  trojmiasto: 1000,
  krakow: 807,
  wroclaw: 674,
  lodz: 652,
  poznan: 540,
  szczecin: 389,
  lublin: 330,
  bydgoszcz: 328,
  bialystok: 292,
  czestochowa: 206,
  rzeszow: 197,
  radom: 196,
  torun: 195,
  kielce: 182,
  olsztyn: 167,
  bielskobiala: 166,
  zielonagora: 139,
  rybnik: 131,
  opole: 126,
  gorzow: 115,
  elblag: 113,
  plock: 111,
  koszalin: 106,
  tarnow: 103,
  walbrzych: 100,
  kalisz: 93,
  legnica: 92,
  grudziadz: 89,
  jaworzno: 87,
  slupsk: 86,
  jastrzebie: 82,
  siedlce: 75,
  pila: 70,
  konin: 68,
  suwalki: 68,
  piotrkow: 67,
  stargard: 67,
  pruszkow: 65,
  gniezno: 64,
  ostrowiec: 63,
  pabianice: 61,
  lomza: 60,
  leszno: 60,
  elk: 60,
  chelm: 58,
  tomaszow: 58,
  zamosc: 58,
  tczew: 57,
  mielec: 57,
  przemysl: 56,
  stalowawola: 56,
  zgierz: 54,
  kedzierzynkozle: 54,
  belchatow: 53,
  raciborz: 49,
  ostroleka: 48,
  zawiercie: 46,
  starogard: 45,
  skierniewice: 45,
  zabki: 45,
  wodzislaw: 45,
  starachowice: 44,
  radomsko: 44,
  tarnobrzeg: 44,
  krosno: 44,
  otwock: 44,
  kolobrzeg: 44,
  skarzysko: 42,
  kutno: 41,
  nysa: 41,
  minskmazowiecki: 40,
  swinoujscie: 39,
  zdunskawola: 39,
  sieradz: 39,
  szczecinek: 38,
  boleslawiec: 37,
  malbork: 37,
  olesnica: 37,
  nowasol: 36,
  oswiecim: 36,
  czechowicedziedzice: 35,
  grodzisk: 35,
  chrzanow: 34,
  sochaczew: 34,
  cieszyn: 33,
  jaslo: 33,
  olkusz: 33,
  nowytarg: 33,
  ilawa: 32,
  krasnik: 32,
  ostroda: 32,
  wrzesnia: 32,
  zywiec: 30,
  myszkow: 30,
  zgorzelec: 29,
  augustow: 29,
  bochnia: 29,
  nowydwormaz: 29,
  krotoszyn: 28,
  gizycko: 27,
  wieliczka: 27,
  ketrzyn: 26,
  jarocin: 26,
  gorlice: 26,
  zakopane: 25,
  pszczyna: 25,
  swiecie: 25,
  wagrowiec: 25,
  walcz: 24,
  zagan: 24,
  bielskpodlaski: 24,
  koscierzyna: 23,
  sandomierz: 22,
  bartoszyce: 22,
  polkowice: 21,
  wielun: 21,
  mragowo: 21,
  dzialdowo: 21,
  gostyn: 20,
  chodziez: 18,
  oborniki: 18,
  brzesko: 16,
  kozienice: 16,
  slubice: 16,
  lidzbarkwarminski: 15,
  jedrzejow: 15,
  zabkowice: 14,
  kartuzy: 14,
  strzelin: 12,
  srodaslaska: 10,
};

const MIN_POP_LOG = Math.log10(10);
const MAX_POP_LOG = Math.log10(2100);

function computePinRadius(populationK: number): number {
  const t = Math.max(
    0,
    Math.min(1, (Math.log10(Math.max(10, populationK)) - MIN_POP_LOG) / (MAX_POP_LOG - MIN_POP_LOG)),
  );
  return Number((2.2 + 5.0 * Math.pow(t, 1.35)).toFixed(2));
}

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
  warszawa: ['Legionowo', 'Piaseczno', 'Wołomin', 'Marki', 'Łomianki'],
  krakow: ['Skawina', 'Niepołomice', 'Zabierzów'],
  wroclaw: ['Kąty Wrocławskie', 'Siechnice', 'Długołęka', 'Kobierzyce'],
  poznan: ['Luboń', 'Swarzędz', 'Komorniki', 'Tarnowo Podgórne'],
  lodz: ['Konstantynów Łódzki', 'Aleksandrów Łódzki'],
  bielskobiala: ['Bielsko', 'Beskidy'],
  grodzisk: ['Milanówek', 'Brwinów', 'Podkowa Leśna'],
  nowydwormaz: ['Modlin', 'Lotnisko Modlin'],
  zakopane: ['Tatry', 'Podhale'],
  swinoujscie: ['Uznam', 'Wolin'],
  kedzierzynkozle: ['Kędzierzyn', 'Koźle'],
  czechowicedziedzice: ['Czechowice', 'Dziedzice'],
  kalisz: ['Ostrów Wielkopolski', 'Pleszew', 'Nowe Skalmierzyce'],
};

const DISPLAY_NAMES: Partial<Record<CityId, string>> = {
  gzm: 'Metropolia GZM',
};

const REGION_SUBTITLES: Partial<Record<CityId, string>> = {
  gzm: 'Wszystkie 41 miast i gmin Górnośląsko-Zagłębiowskiej Metropolii',
  trojmiasto: 'Gdańsk · Gdynia · Sopot',
};

export const COVERAGE_CITIES: readonly CoveragePlace[] = CITIES.map((city) => {
  const populationK = CITY_POPULATION_K[city.id];
  return {
    key: city.id,
    name: DISPLAY_NAMES[city.id] ?? city.name,
    regionLabel: REGION_SUBTITLES[city.id],
    lat: city.center.lat,
    lon: city.center.lon,
    populationK,
    pinRadius: computePinRadius(populationK),
    aliases: CITY_ALIASES[city.id] ?? [],
    operators: CITY_OPERATORS[city.id],
    newsSource: CITY_NEWS_SOURCES[city.id],
    railGateways: city.railGateways ?? [],
  };
});

export function normalizeCoverageQuery(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/ł/g, 'l')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

function getPlaceMatchRank(place: CoveragePlace, q: string): number {
  const normName = normalizeCoverageQuery(place.name);
  if (normName.startsWith(q)) return 0;

  const secondary = place.regionLabel ? [place.regionLabel, ...place.aliases] : place.aliases;
  const normSecondary = secondary.map(normalizeCoverageQuery);
  if (normSecondary.some((s) => s.startsWith(q))) return 1;
  if (normName.includes(q)) return 2;
  if (normSecondary.some((s) => s.includes(q))) return 3;

  if (
    place.operators.some(
      (op) =>
        normalizeCoverageQuery(op.name).includes(q) ||
        normalizeCoverageQuery(op.shortCode).includes(q),
    )
  ) {
    return 4;
  }
  return -1;
}

export function filterCoveragePlaces(query: string): readonly CoveragePlace[] {
  const q = normalizeCoverageQuery(query);
  if (!q) return COVERAGE_CITIES;
  return COVERAGE_CITIES.map((place) => ({ place, rank: getPlaceMatchRank(place, q) }))
    .filter((item) => item.rank >= 0)
    .sort((a, b) => a.rank - b.rank || b.place.populationK - a.place.populationK)
    .map((item) => item.place);
}

export function findMatchedAlias(place: CoveragePlace, query: string): string | null {
  const q = normalizeCoverageQuery(query);
  if (!q) return null;
  if (normalizeCoverageQuery(place.name).includes(q)) return null;
  const hit = place.aliases.find((alias) => normalizeCoverageQuery(alias).includes(q));
  return hit ?? null;
}
