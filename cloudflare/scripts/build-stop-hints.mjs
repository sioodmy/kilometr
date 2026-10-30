import fs from 'node:fs';
import path from 'node:path';

const ROOT_DIR = path.resolve(import.meta.dirname, '../..');

const cityArg = process.argv.find((a) => a.startsWith('--city='));
const CITY = cityArg ? cityArg.split('=')[1] : 'wroclaw';

const DATA_FILE = path.join(ROOT_DIR, `cloudflare/data/stop-hints-${CITY}.json`);
const DIST_DIR = path.join(ROOT_DIR, `cloudflare/dist/${CITY}`);
const OUTPUT_FILE = path.join(DIST_DIR, 'stop-hints.json');

const FORBIDDEN_FLUFF = [
  /ten przystanek/i,
  /znajduje się tutaj/i,
  /można skorzystać/i,
  /warto zauważyć/i,
  /komunikacja miejska/i,
  /obsługuje pasażerów/i,
];

// Wymóg fizycznego punktu odniesienia (eliminacja tautologii ulica+kierunek)
const PHYSICAL_ANCHOR_PATTERNS = [
  /obok/i,
  /po (?:.+ )?stronie/i,
  /od (?:.+ )?strony/i,
  /od strony/i,
  /plant/i,
  /przy/i,
  /przed/i,
  /pod/i,
  /w wykopie/i,
  /w tunelu/i,
  /terminal/i,
  /dworc/i,
  /pkp/i,
  /metro/i,
  /most/i,
  /wiadukt/i,
  /wyspa centralna/i,
  /peron \d/i,
  /stanowisko \d/i,
  /naprzeciwko/i,
  /dojście/i,
];

function validateHint(text, id) {
  if (!text || typeof text !== 'string') {
    throw new Error(`[${id}] Wskazówka jest pusta lub nie jest tekstem.`);
  }
  const trimmed = text.trim();
  if (trimmed.length < 10) {
    throw new Error(`[${id}] Wskazówka jest zbyt krótka: "${trimmed}"`);
  }
  for (const re of FORBIDDEN_FLUFF) {
    if (re.test(trimmed)) {
      throw new Error(`[!] Błąd antislop [${id}]: zawiera watę słowną "${re}" -> "${trimmed}"`);
    }
  }

  // Wymóg uziemienia (grounding): musi zawierać punkt odniesienia
  const hasPhysicalAnchor = PHYSICAL_ANCHOR_PATTERNS.some((pattern) => pattern.test(trimmed));
  if (!hasPhysicalAnchor) {
    throw new Error(
      `[!] Błąd antislop [${id}]: brak fizycznego punktu odniesienia (wymagane POI, park, wiadukt itp.) -> "${trimmed}"`,
    );
  }

  // Ignorujemy kropki w skrótach typu "ul.", "al.", "pl.", "św.", "dr.", "prof.", "hab.", "sp.", "z o.o."
  const sanitizedForSentences = trimmed
    .replace(/\.{2,}/g, '_')
    .replace(/(?<![a-ząćęłńóśźż])([a-ząćęłńóśźż]{1,6})\./gi, '_')
    .replace(/(^|[\s(])([a-ząćęłńóśźż]{1,6})\./gi, '_')
    .replace(/(^|[\s(])(ul|al|pl|św|pw|dr|prof|hab|sp|z o\.o|m\.st|os|gen)\./gi, '$1$2_')
    .replace(/\b([A-Z])\./g, '$1_');

  // Dokładnie 1 zdanie (kończące się kropką, bez wielozdaniowych tyrad)
  const sentences = sanitizedForSentences
    .split(/(?<=[.?!])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);

  if (sentences.length > 1) {
    throw new Error(
      `[!] Błąd antislop [${id}]: przekroczono limit 1 zdania (${sentences.length} zdania) -> "${trimmed}"`,
    );
  }

  const words = trimmed.split(/\s+/).filter(Boolean);
  if (words.length > 25) {
    throw new Error(
      `[!] Błąd antislop [${id}]: za długa wskazówka (${words.length} słów, max 25) -> "${trimmed}"`,
    );
  }
}

function build() {
  console.log(`[i] Kompilacja bazy wskazówek dla: ${CITY}`);

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
    schemaVersion: 1,
    city: CITY,
    generatedAt: data.generatedAt || new Date().toISOString(),
    stops: validatedStops,
    clusters: validatedClusters,
  };

  const minified = JSON.stringify(compiled);
  fs.writeFileSync(OUTPUT_FILE, minified, 'utf8');

  const inKb = (Buffer.byteLength(raw) / 1024).toFixed(1);
  const outKb = (Buffer.byteLength(minified) / 1024).toFixed(1);

  console.log(`[✓] Sukces: zweryfikowano i skompilowano ${CITY.toUpperCase()}`);
  console.log(`    - Słupki (stops): ${Object.keys(validatedStops).length}`);
  console.log(`    - Zespoły (clusters): ${Object.keys(validatedClusters).length}`);
  console.log(`    - Rozmiar: ${inKb} KB -> ${outKb} KB`);
  console.log(`    - Zapisano do: ${OUTPUT_FILE}`);
}

build();
