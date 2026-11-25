import { CITIES, type CityDef, type CityId } from '../cities';
import { normalizePolish } from '../gtfs/geo';
import { getLocaleSync, type Strings } from '../i18n';

const CITY_ALIASES: Record<string, string[]> = {
  wroclaw: ['wrocław', 'wroclaw', 'dolny śląsk', 'dolnyslask', 'breslau'],
  krakow: ['kraków', 'krakow', 'małopolska', 'malopolska', 'skawina', 'cracow'],
  gzm: [
    'metropolia',
    'śląsk',
    'slask',
    'zagłębie',
    'zaglebie',
    'katowice',
    'sosnowiec',
    'gliwice',
    'zabrze',
    'bytom',
    'ruda śląska',
    'ruda slaska',
    'tychy',
    'dąbrowa górnicza',
    'dabrowa gornicza',
    'chorzów',
    'chorzow',
    'mysłowice',
    'myslowice',
    'tarnowskie góry',
    'tarnowskie gory',
    'piekary śląskie',
    'piekary slaskie',
    'będzin',
    'bedzin',
    'świętochłowice',
    'swietochlowice',
    'siemianowice śląskie',
    'siemianowice',
    'mikołów',
    'mikolow',
    'czeladź',
    'czeladz',
    'knurów',
    'knurow',
  ],
  warszawa: ['warszawa', 'warsaw', 'stolica', 'piaseczno', 'legionowo', 'wołomin'],
  poznan: ['poznań', 'poznan', 'wielkopolska', 'swarzędz', 'luboń', 'kórnik'],
  trojmiasto: [
    'trójmiasto',
    'trojmiasto',
    'gdańsk',
    'gdansk',
    'gdynia',
    'sopot',
    'pomorze',
    'wejherowo',
    'rumia',
    'reda',
  ],
  lodz: ['łódź', 'lodz', 'aleksandrów łódzki', 'konstantynów łódzki'],
  szczecin: ['szczecin', 'pomorze zachodnie', 'police', 'dobra', 'gryfino', 'stettin'],
  kielce: [
    'kielce',
    'świętokrzyskie',
    'swietokrzyskie',
    'chęciny',
    'checiny',
    'morawica',
    'masłów',
    'maslow',
    'daleszyce',
    'zagnańsk',
    'zagnansk',
  ],
  olsztyn: ['olsztyn', 'warmia', 'mazury', 'allenstein', 'dywity', 'stawiguda', 'barczewo'],
  bialystok: [
    'białystok',
    'bialystok',
    'podlasie',
    'podlaskie',
    'wasilków',
    'wasilkow',
    'choroszcz',
    'supraśl',
    'suprasl',
    'zabłudów',
    'zabludow',
  ],
  opole: [
    'opole',
    'opolskie',
    'opolszczyzna',
    'oppeln',
    'komprachcice',
    'tarnów opolski',
    'tarnow opolski',
    'prószków',
    'proszkow',
  ],
  rzeszow: [
    'rzeszów',
    'rzeszow',
    'podkarpacie',
    'podkarpackie',
    'jasionka',
    'łańcut',
    'lancut',
    'krasne',
    'tyczyn',
    'boguchwała',
    'boguchwala',
    'głogów małopolski',
    'glogow malopolski',
  ],
  lublin: [
    'lublin',
    'lubelskie',
    'lubelszczyzna',
    'świdnik',
    'swidnik',
    'niemce',
    'konopnica',
    'głusk',
    'glusk',
    'jastków',
    'jastkow',
  ],
  radom: [
    'radom',
    'radomskie',
    'ziemia radomska',
    'pionki',
    'jedlnia',
    'iłża',
    'ilza',
    'skaryszew',
    'wolanów',
    'wolanow',
    'zakrzew',
  ],
  bydgoszcz: ['bydgoszcz', 'kujawy', 'kujawsko-pomorskie', 'zławieś wielka', 'zlawies wielka'],
  torun: ['toruń', 'torun', 'kujawy', 'kujawsko-pomorskie', 'thorn'],
  elblag: ['elbląg', 'elblag', 'elbing', 'żuławy', 'zulawy'],
  gorzow: ['gorzów wielkopolski', 'gorzow wielkopolski', 'gorzów', 'gorzow', 'lubuskie'],
  czestochowa: ['częstochowa', 'czestochowa', 'jura', 'województwo śląskie'],
  zielonagora: ['zielona góra', 'zielona gora', 'lubuskie', 'grünberg'],
  rybnik: ['rybnik', 'rybnicki', 'żory', 'zory', 'świerklany', 'swierklany'],
  slupsk: ['słupsk', 'slupsk', 'pomorze', 'słupski', 'slupski', 'stolp'],
  walbrzych: ['wałbrzych', 'walbrzych', 'dolny śląsk', 'dolnyslask', 'szczawno-zdrój', 'szczawno'],
  kalisz: [
    'kalisz',
    'kaliskie',
    'ostrow wielkopolski',
    'ostrowskie',
    'pleszew',
    'skalmierzyce',
    'opatówek',
  ],
  siedlce: ['siedlce', 'siedleckie', 'podlasie', 'podlaskie', 'mordy', 'suchożebry'],
  lomza: ['łomża', 'lomza', 'podlasie', 'podlaskie', 'łomżyńskie', 'lomzynskie'],
  krosno: ['krosno', 'krośnieńskie', 'krosnienskie', 'podkarpacie', 'podkarpackie'],
  jaslo: ['jasło', 'jaslo', 'jasielskie', 'podkarpacie', 'podkarpackie'],
  olkusz: ['olkusz', 'olkuski', 'bukowno', 'klucze'],
  chrzanow: ['chrzanów', 'chrzanow', 'trzebinia', 'libiąż', 'libiaz', 'chełmek', 'chelmek'],
  bochnia: ['bochnia', 'bocheńskie', 'bochenskie', 'małopolska', 'malopolska'],
  ilawa: ['iława', 'ilawa', 'iławskie', 'ilawskie', 'warmia', 'mazury'],
  bielskobiala: ['bielsko-biała', 'bielsko-biala', 'bielsko', 'bielsko biala', 'beskidy', 'podbeskidzie'],
  koszalin: ['koszalin'],
  piotrkow: ['piotrków trybunalski', 'piotrkow trybunalski', 'piotrków', 'piotrkow'],
  tomaszow: ['tomaszów mazowiecki', 'tomaszow mazowiecki', 'tomaszów', 'tomaszow'],
  skarzysko: ['skarżysko-kamienna', 'skarzysko-kamienna', 'skarżysko', 'skarzysko'],
  oswiecim: ['oświęcim', 'oswiecim'],
  swinoujscie: ['świnoujście', 'swinoujscie', 'uznam', 'wolin'],
  zakopane: ['zakopane', 'tatry', 'podhale'],
  plock: ['płock', 'plock'],
  tarnow: ['tarnów', 'tarnow'],
  legnica: ['legnica'],
  jastrzebie: ['jastrzębie-zdrój', 'jastrzebie-zdroj', 'jastrzębie', 'jastrzebie'],
  pila: ['piła', 'pila'],
  konin: ['konin'],
  suwalki: ['suwałki', 'suwalki'],
  ostrowiec: ['ostrowiec świętokrzyski', 'ostrowiec swietokrzyski', 'ostrowiec', 'świętokrzyskie', 'swietokrzyskie'],
  stalowawola: ['stalowa wola', 'podkarpacie'],
  przemysl: ['przemyśl', 'przemysl'],
  elk: ['ełk', 'elk'],
  leszno: ['leszno'],
  chelm: ['chełm', 'chelm'],
  mielec: ['mielec'],
  tczew: ['tczew'],
  ostroleka: ['ostrołęka', 'ostroleka'],
  starachowice: ['starachowice'],
  kutno: ['kutno'],
  kolobrzeg: ['kołobrzeg', 'kolobrzeg'],
  radomsko: ['radomsko'],
  boleslawiec: ['bolesławiec', 'boleslawiec'],
  cieszyn: ['cieszyn'],
  zywiec: ['żywiec', 'zywiec'],
  krasnik: ['kraśnik', 'krasnik'],
  grodzisk: ['grodzisk mazowiecki', 'grodzisk', 'milanówek', 'milanowek', 'brwinów', 'brwinow', 'podkowa leśna', 'podkowa lesna', 'gpa'],
  pruszkow: ['pruszków', 'pruszkow'],
  sochaczew: ['sochaczew'],
  minskmazowiecki: ['mińsk mazowiecki', 'minsk mazowiecki'],
  otwock: ['otwock'],
  nowydwormaz: ['nowy dwór mazowiecki', 'nowy dwor mazowiecki', 'modlin', 'lotnisko modlin', 'nowy dwor'],
  zabki: ['ząbki', 'zabki'],
  pabianice: ['pabianice'],
  zgierz: ['zgierz'],
  grudziadz: ['grudziądz', 'grudziadz'],
  jaworzno: ['jaworzno'],
  stargard: ['stargard'],
  gniezno: ['gniezno'],
  zamosc: ['zamość', 'zamosc'],
  kedzierzynkozle: ['kędzierzyn-koźle', 'kedzierzyn-kozle', 'kędzierzyn', 'kedzierzyn', 'koźle', 'kozle'],
  belchatow: ['bełchatów', 'belchatow'],
  raciborz: ['racibórz', 'raciborz'],
  tarnobrzeg: ['tarnobrzeg', 'podkarpacie'],
  skierniewice: ['skierniewice'],
  starogard: ['starogard gdański', 'starogard gdanski', 'starogard', 'kociewie'],
  zawiercie: ['zawiercie'],
  nysa: ['nysa'],
  zdunskawola: ['zduńska wola', 'zdunska wola'],
  sieradz: ['sieradz'],
  malbork: ['malbork'],
  szczecinek: ['szczecinek'],
  nowasol: ['nowa sól', 'nowa sol', 'lubuskie'],
  olesnica: ['oleśnica', 'olesnica'],
  czechowicedziedzice: ['czechowice-dziedzice', 'czechowice', 'dziedzice'],
  ostroda: ['ostróda', 'ostroda'],
  nowytarg: ['nowy targ', 'podhale'],
  augustow: ['augustów', 'augustow'],
  ketrzyn: ['kętrzyn', 'ketrzyn'],
  gorlice: ['gorlice'],
  zgorzelec: ['zgorzelec'],
  jarocin: ['jarocin'],
  polkowice: ['polkowice'],
  zagan: ['żagań', 'zagan'],
  wrzesnia: ['września', 'wrzesnia'],
  walcz: ['wałcz', 'walcz'],
  gizycko: ['giżycko', 'gizycko'],
  krotoszyn: ['krotoszyn'],
  koscierzyna: ['kościerzyna', 'koscierzyna'],
  sandomierz: ['sandomierz'],
  bartoszyce: ['bartoszyce'],
  wielun: ['wieluń', 'wielun'],
  mragowo: ['mrągowo', 'mragowo'],
  wagrowiec: ['wągrowiec', 'wagrowiec'],
  swiecie: ['świecie', 'swiecie'],
  dzialdowo: ['działdowo', 'dzialdowo'],
  bielskpodlaski: ['bielsk podlaski', 'bielsk', 'podlasie'],
  gostyn: ['gostyń', 'gostyn'],
  brzesko: ['brzesko'],
  lidzbarkwarminski: ['lidzbark warmiński', 'lidzbark warminski', 'lidzbark'],
  chodziez: ['chodzież', 'chodziez'],
  pszczyna: ['pszczyna'],
  wodzislaw: ['wodzisław śląski', 'wodzislaw slaski', 'wodzisław', 'wodzislaw'],
  zabkowice: ['ząbkowice śląskie', 'zabkowice slaskie', 'ząbkowice', 'zabkowice'],
  strzelin: ['strzelin'],
  srodaslaska: ['środa śląska', 'sroda slaska'],
  jedrzejow: ['jędrzejów', 'jedrzejow'],
  kozienice: ['kozienice'],
  oborniki: ['oborniki'],
  wieliczka: ['wieliczka'],
  myszkow: ['myszków', 'myszkow'],
  kartuzy: ['kartuzy'],
  slubice: ['słubice', 'slubice'],
};

export interface CityEntry {
  city: CityDef;
  name: string;
  feeds: string;
  nameNorm: string;
  searchText: string;
}

/** Największe sieci do szybkiego wyboru bez pisania w onboardingu. */
export const POPULAR_CITY_IDS: readonly CityId[] = [
  'warszawa',
  'krakow',
  'wroclaw',
  'gzm',
  'trojmiasto',
  'poznan',
  'lodz',
  'szczecin',
];

// Cache po instancji słownika: unikamy ponownej normalizacji 132 miast i tworzenia
// Intl.Collator przy każdym otwarciu arkusza lub kroku onboardingu.
const cachedEntriesByStrings = new WeakMap<Strings, CityEntry[]>();

export function getCityEntries(s: Strings): CityEntry[] {
  const cached = cachedEntriesByStrings.get(s);
  if (cached) return cached;

  const collator = new Intl.Collator(getLocaleSync());
  const entries = CITIES.map((city) => {
    const name = s.city.name(city.id);
    const feeds = s.city.feeds(city.id);
    const aliases = (CITY_ALIASES[city.id] ?? []).join(' ');
    return {
      city,
      name,
      feeds,
      nameNorm: normalizePolish(name),
      searchText: normalizePolish(
        `${name} ${city.id} ${feeds} ${s.city.operator(city.id)} ${aliases}`,
      ),
    };
  }).sort((a, b) => collator.compare(a.name, b.name));

  cachedEntriesByStrings.set(s, entries);
  return entries;
}

/**
 * Zwraca miasta posortowane z przypiętymi priorytetami na górze (np. GPS + aktywne)
 * albo przefiltrowane według znormalizowanego zapytania.
 */
export function filterCityEntries(
  entries: readonly CityEntry[],
  query: string,
  priorityIds: readonly (CityId | null | undefined)[] = [],
): CityEntry[] {
  const normQuery = normalizePolish(query);
  if (!normQuery) {
    const pinned: CityEntry[] = [];
    const seen = new Set<CityId>();
    for (const id of priorityIds) {
      if (!id || seen.has(id)) continue;
      const found = entries.find((e) => e.city.id === id);
      if (found) {
        pinned.push(found);
        seen.add(id);
      }
    }
    if (pinned.length === 0) return entries as CityEntry[];
    return [...pinned, ...entries.filter((e) => !seen.has(e.city.id))];
  }

  const prefixed: CityEntry[] = [];
  const rest: CityEntry[] = [];
  for (const entry of entries) {
    if (!entry.searchText.includes(normQuery)) continue;
    if (entry.nameNorm.startsWith(normQuery)) prefixed.push(entry);
    else rest.push(entry);
  }
  if (prefixed.length === 0) return rest;
  if (rest.length === 0) return prefixed;
  return [...prefixed, ...rest];
}
