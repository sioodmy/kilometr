import fs from 'node:fs';
import path from 'node:path';

const ROOT_DIR = path.resolve(import.meta.dirname, '../..');

const cityArg = process.argv.find((a) => a.startsWith('--city='));
const CITY = cityArg ? cityArg.split('=')[1] : 'wroclaw';

const DATA_FILE = path.join(ROOT_DIR, `cloudflare/data/stop-hints-${CITY}.json`);
const DIST_DIR = path.join(ROOT_DIR, `cloudflare/dist/${CITY}`);
const OUTPUT_FILE = path.join(DIST_DIR, 'stop-hints.json');

const FORBIDDEN_PATTERNS = [
  [/ten przystanek/i, 'wata słowna'],
  [/znajduje się tutaj/i, 'wata słowna'],
  [/można skorzystać/i, 'wata słowna'],
  [/warto zauważyć/i, 'wata słowna'],
  [/komunikacja miejska/i, 'wata słowna'],
  [/obsługuje pasażerów/i, 'wata słowna'],
  [/^Słupek\s+\d+\s*[•·-]/i, 'powielony prefiks numeru słupka (UI już go wyświetla)'],
  [/budynku usługowego|punktu usługowego/i, 'slop kategorii (budynek/punkt usługowy)'],
  [/zakładu pogrzebowego|pracowni\s+usg|myjni|pralni|wulkanizac|lombardu/i, 'śmieciowe POI'],
  [/parku\s+„[^”]*(?:skwer|capital|city\s+park|villa\s+park|kieszonkowy|office|business)/i, 'fałszywy park'],
  [/obok\s+(?:Żabka|Biedronka|Lidl|Rossmann|Empik|Kaufland|Poczta\s+Polska)(?:[.,\s]|$)/, 'nieodmieniona nazwa sieci'],
  [/na\s+ul\.\s+(?:parking|pętla|tunel|droga|jezdnia)\b/i, 'śmieciowa nazwa ulicy'],
  [/na\s+ul\.\s+(?:Marszałkowska|Puławska|Krakowska|Belwederska|Dolna|Chełmska|Grójecka|Głogowska|Świdnicka|Pawia|Targowa|Wołoska|Długa|Ślężna|Starowiślna|Rybna)\b/, 'nieodmieniona nazwa ulicy'],
  [/na\s+pl\.\s+(?:Bankowy|Teatralny|Grunwaldzki|Bernardyński|Dominikański|Centralny)\b/, 'nieodmieniony plac'],
  [/przy\s+Al\.\s+(?:Jerozolimskie|Ujazdowskie)\b/, 'nieodmienione Aleje'],
  [/\?”/, 'śmieciowy znak zapytania w nazwie POI'],
  [/„[^”]*„/, 'zagnieżdżone cudzysłowy'],
];

const PHYSICAL_ANCHOR_PATTERNS = [
  /obok/i,
  /po (?:.+ )?stronie/i,
  /od (?:.+ )?strony/i,
  /plant/i,
  /przy/i,
  /przed/i,
  /za (?:rondem|skrzyżowaniem|galerią|mostem)/i,
  /pod/i,
  /w wykopie/i,
  /w tunelu/i,
  /na wysepce/i,
  /na pętli/i,
  /na środku/i,
  /między/i,
  /terminal/i,
  /dworc/i,
  /dworz/i,
  /pkp/i,
  /metro/i,
  /most/i,
  /mo[sś]c/i,
  /wiadukt/i,
  /wyspie centralnej/i,
  /peron \d/i,
  /stanowisko \d/i,
  /naprzeciwko/i,
  /dojście/i,
  /zejście/i,
  /wyjści/i,
  /wejści/i,
];

const FAMOUS_CHAINS_AND_LANDMARKS = [
  'żabk',
  'biedronk',
  'lidl',
  'kaufland',
  'netto',
  'dino',
  'carrefour',
  'auchan',
  'rossmann',
  'kfc',
  'mcdonald',
  'subway',
  'burger king',
  'max burgers',
  'pizza hut',
  'orlen',
  'bp',
  'shell',
  'circle k',
  'moya',
  'mol',
  'amic',
  'castoram',
  'leroy merlin',
  'ikea',
  'obi',
  'decathlon',
  'media markt',
  'empik',
  'hebe',
  'pepco',
  'action',
  'aldi',
  'bricomarché',
  'intermarché',
  'e.leclerc',
  'leclerc',
  'jysk',
  'media expert',
  'rtv euro agd',
  'stokrotk',
  'lewiatan',
  'polomarket',
  'delikatesów centrum',
  'poczty polskiej',
  'poczty',
  'posnani',
  'avenid',
  'bałtyk',
  'stary browar',
  'sukiennic',
  'wawel',
  'arkadi',
  'złote tarasy',
  'złotych taras',
  'wroclavi',
  'renom',
  'magnoli',
  'spodek',
  'pałac kultury',
  'warsaw spire',
  'warsaw hub',
  'rondo 1',
  'mda',
  'nowy kleparz',
  'nowego kleparza',
  'galerii',
  'dworca',
  'dworcem',
  'oper',
  'teatru',
  'hotelu',
  'biurowc',
  'pętli',
  'zjazdu',
];

const DESCRIPTOR_ROOTS = [
  'restauracj',
  'sklep',
  'lokal',
  'kawiarn',
  'piekarn',
  'cukiern',
  'pizzeri',
  'aptek',
  'stacj',
  'hotel',
  'kościoł',
  'kości',
  'teatr',
  'oper',
  'filharmoni',
  'szpital',
  'galeri',
  'centrum',
  'wieżowc',
  'biurowc',
  'dworc',
  'dworz',
  'pętl',
  'park',
  'budynk',
  'hal',
  'uczeln',
  'uniwersytet',
  'politechnik',
  'szkoł',
  'muzeum',
  'kin',
  'stadion',
  'pałac',
  'zamk',
  'market',
  'supermarket',
  'drogeri',
  'wejści',
  'wyjści',
  'peron',
  'most',
  'wiadukt',
  'rond',
  'bibliotek',
  'urzęd',
  'sąd',
  'skwer',
  'plac',
  'domu',
  'targowisk',
  'bazar',
  'oddział',
  'poczt',
  'ogrod',
  'pasaż',
  'zjazd',
];

function checkObokUnambiguity(trimmed, id) {
  const m = trimmed.match(/obok\s+([^.,;]+)/i);
  if (!m) return;
  const target = m[1].trim();
  const lower = target.toLowerCase();
  const words = lower
    .replace(/[„"”'`]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
  const firstWord = words[0] || '';

  const isValid =
    DESCRIPTOR_ROOTS.some((d) => firstWord.startsWith(d)) ||
    FAMOUS_CHAINS_AND_LANDMARKS.some((f) => lower.startsWith(f));

  if (!isValid) {
    throw new Error(
      `[!] Błąd antislop [${id}]: niejednoznaczny punkt orientacyjny bez kategorii: "obok ${target}" w "${trimmed}".`,
    );
  }
}

function validateStopKey(key) {
  if (/^\d{1,3}$/.test(key.trim())) {
    throw new Error(
      `[!] Błąd integralności kluczy: klucz "${key}" jest zbyt krótki (1-3 cyfry) i powoduje kolizje słupków (np. Dolna 02 / Pl. Na Rozdrożu 06)! Użyj globalnie unikalnego stop_id lub stop_code.`,
    );
  }
}

function validateHint(text, id) {
  if (!text || typeof text !== 'string') {
    throw new Error(`[${id}] Wskazówka jest pusta lub nie jest tekstem.`);
  }
  const trimmed = text.trim();
  if (trimmed.length < 12) {
    throw new Error(`[${id}] Wskazówka jest zbyt krótka: "${trimmed}"`);
  }
  for (const [re, reason] of FORBIDDEN_PATTERNS) {
    if (re.test(trimmed)) {
      throw new Error(`[!] Błąd antislop [${id}]: ${reason} (${re}) -> "${trimmed}"`);
    }
  }

  const hasPhysicalAnchor = PHYSICAL_ANCHOR_PATTERNS.some((pattern) => pattern.test(trimmed));
  if (!hasPhysicalAnchor) {
    throw new Error(
      `[!] Błąd antislop [${id}]: brak fizycznego punktu odniesienia -> "${trimmed}"`,
    );
  }

  checkObokUnambiguity(trimmed, id);

  const sanitizedForSentences = trimmed
    .replace(/\.{2,}/g, '_')
    .replace(
      /(^|[\s(„"])(ul|al|pl|św|pw|dr|prof|hab|sp|z o\.o|m\.st|os|gen|im|nr|ks|kard|bp|abp|bł|płk|ppłk|mjr|kpt|por|rtm|marsz|inż|mgr|doc|red|st|o|s|br|jr|sr|mr|ms|mrs|no|vol|art|pkt)\./gi,
      '$1$2_',
    )
    .replace(/\b(\d{1,2})\.\s/g, '$1_ ')
    .replace(/\b([A-ZŁŚĆŻŹŃÓ])\./g, '$1_');

  const sentences = sanitizedForSentences
    .split(/(?<=[.?!])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);

  if (sentences.length > 1) {
    throw new Error(
      `[!] Błąd antislop [${id}]: przekroczono limit 1 zdania (${sentences.length}) -> "${trimmed}"`,
    );
  }

  const words = trimmed.split(/\s+/).filter(Boolean);
  if (words.length > 22) {
    throw new Error(
      `[!] Błąd antislop [${id}]: za długa wskazówka (${words.length} słów, max 22) -> "${trimmed}"`,
    );
  }
}

function build() {
  console.log(`[i] Kompilacja i walidacja bazy wskazówek dla: ${CITY}`);

  if (!fs.existsSync(DATA_FILE)) {
    console.error(`[!] Brak pliku źródłowego: ${DATA_FILE}`);
    process.exit(1);
  }

  const raw = fs.readFileSync(DATA_FILE, 'utf8');
  let data;
  try {
    data = JSON.parse(raw);
  } catch (err) {
    console.error(`[!] Błąd parsowania JSON w ${DATA_FILE}:`, err);
    process.exit(1);
  }

  if (!data.stops || typeof data.stops !== 'object') {
    console.error('[!] Brak poprawnego obiektu "stops" w pliku JSON.');
    process.exit(1);
  }

  const validatedStops = {};
  for (const [id, hint] of Object.entries(data.stops)) {
    validateStopKey(id);
    validateHint(hint, `stop:${id}`);
    validatedStops[id] = hint.trim();
  }

  const validatedClusters = {};
  if (data.clusters && typeof data.clusters === 'object') {
    for (const [id, hint] of Object.entries(data.clusters)) {
      validateHint(hint, `cluster:${id}`);
      validatedClusters[id] = hint.trim();
    }
  }

  if (!fs.existsSync(DIST_DIR)) {
    fs.mkdirSync(DIST_DIR, { recursive: true });
  }

  const compiled = {
    schemaVersion: typeof data.schemaVersion === 'number' ? data.schemaVersion : 2,
    city: CITY,
    generatedAt: data.generatedAt || new Date().toISOString(),
    stops: validatedStops,
    clusters: validatedClusters,
  };

  const minified = JSON.stringify(compiled);
  fs.writeFileSync(OUTPUT_FILE, minified, 'utf8');

  const inKb = (Buffer.byteLength(raw) / 1024).toFixed(1);
  const outKb = (Buffer.byteLength(minified) / 1024).toFixed(1);

  console.log(`[✓] Sukces: zweryfikowano i skompilowano ${CITY.toUpperCase()} (schemaVersion=${compiled.schemaVersion})`);
  console.log(`    - Słupki (stops): ${Object.keys(validatedStops).length}`);
  console.log(`    - Zespoły (clusters): ${Object.keys(validatedClusters).length}`);
  console.log(`    - Rozmiar: ${inKb} KB -> ${outKb} KB`);
  console.log(`    - Zapisano do: ${OUTPUT_FILE}`);
}

build();
