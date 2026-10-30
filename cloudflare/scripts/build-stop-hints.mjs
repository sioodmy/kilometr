#!/usr/bin/env node
/**
 * Kompilator i walidator wskazówek lokalizacyjnych przystanków (stop-hints).
 *
 * Sprawdza:
 * 1. Spójność schematu JSON.
 * 2. Zgodność z wytycznymi antislop (brak waty słownej, 1-2 zwięzłe zdania).
 * 3. Poprawność kodów słupków i klastrów (usuwa redundancje).
 *
 * Kompiluje wynik do cloudflare/dist/<city>/stop-hints.json gotowego do uploadu na Cloudflare R2.
 *
 * Użycie:
 *   node cloudflare/scripts/build-stop-hints.mjs [--city=wroclaw]
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT_DIR = path.resolve(import.meta.dirname, '../..');
const DATA_DIR = path.join(ROOT_DIR, 'cloudflare/data');
const DIST_DIR = path.join(ROOT_DIR, 'cloudflare/dist');

const ARGS = process.argv.slice(2);
function getArg(prefix, fallback = null) {
  const match = ARGS.find((a) => a.startsWith(prefix));
  return match ? match.slice(prefix.length) : fallback;
}

const CITY = getArg('--city=', 'wroclaw').toLowerCase();
const INPUT_FILE = path.join(DATA_DIR, `stop-hints-${CITY}.json`);
const OUTPUT_DIR = path.join(DIST_DIR, CITY);
const OUTPUT_FILE = path.join(OUTPUT_DIR, 'stop-hints.json');

const FORBIDDEN_FLUFF = [
  /ten przystanek/i,
  /znajduje się tutaj/i,
  /można skorzystać/i,
  /warto zauważyć/i,
  /komunikacja miejska/i,
  /obsługuje pasażerów/i,
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
      console.warn(`[!] Ostrzeżenie antislop [${id}]: zawiera watę słowną "${re}" -> "${trimmed}"`);
    }
  }
  // Sprawdzenie liczby zdań (ignorujemy kropki po typowych skrótach jak ul., al., pl., św., im., np., liczbach)
  const sanitized = trimmed.replace(/\b(ul|al|pl|św|im|np|m\.in|\d+)\.\s+/gi, '$1 ');
  const sentences = sanitized.split(/(?<=[.!?])\s+/).filter(Boolean);
  if (sentences.length > 2) {
    console.warn(`[!] Ostrzeżenie [${id}]: wskazówka ma więcej niż 2 zdania (${sentences.length}): "${trimmed}"`);
  }
}

async function main() {
  console.log(`[i] Kompilacja bazy wskazówek dla: ${CITY}`);

  if (!fs.existsSync(INPUT_FILE)) {
    throw new Error(`Brak pliku źródłowego: ${INPUT_FILE}`);
  }

  const rawData = fs.readFileSync(INPUT_FILE, 'utf8');
  let data;
  try {
    data = JSON.parse(rawData);
  } catch (err) {
    throw new Error(`Błąd parsowania JSON w ${INPUT_FILE}: ${err.message}`);
  }

  if (data.schemaVersion !== 1) {
    throw new Error(`Nieobsługiwana wersja schematu: ${data.schemaVersion}`);
  }

  const stops = data.stops || {};
  const clusters = data.clusters || {};

  const cleanStops = {};
  let stopCount = 0;
  for (const [code, item] of Object.entries(stops)) {
    const hint = typeof item === 'string' ? item : item?.hint;
    if (!hint) {
      throw new Error(`Przystanek [${code}] nie posiada poprawnej wskazówki.`);
    }
    validateHint(hint, `stop:${code}`);
    cleanStops[code] = hint.trim();
    stopCount++;
  }

  const cleanClusters = {};
  let clusterCount = 0;
  for (const [key, hint] of Object.entries(clusters)) {
    const hintText = typeof hint === 'string' ? hint : hint?.hint;
    if (!hintText) {
      throw new Error(`Klaster [${key}] nie posiada poprawnej wskazówki.`);
    }
    validateHint(hintText, `cluster:${key}`);
    cleanClusters[key] = hintText.trim();
    clusterCount++;
  }

  data.stops = cleanStops;
  data.clusters = cleanClusters;

  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  // Zapis minified JSON lub formatowanego
  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(data, null, 2) + '\n', 'utf8');

  console.log(`[✓] Zwalidowano ${stopCount} słupków i ${clusterCount} zespołów przystankowych.`);
  console.log(`[✓] Wygenerowano: ${OUTPUT_FILE} (${(fs.statSync(OUTPUT_FILE).size / 1024).toFixed(1)} KB)`);
  console.log(`[i] Gotowe do uploadu do R2: kilometr-timetable/${CITY}/stop-hints.json`);
}

main().catch((err) => {
  console.error(`[!] Błąd budowania:`, err.message);
  process.exit(1);
});
