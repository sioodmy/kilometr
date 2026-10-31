#!/usr/bin/env node
/**
 * Canary: weryfikacja pokrycia bazy wskazówek lokalizacyjnych przystanków (stop-hints).
 *
 * Sprawdza kody słupków (stop_code) i nazwy przystanków z aktualnego feedu GTFS
 * względem bazy cloudflare/data/stop-hints-<city>.json.
 *
 * DOMYŚLNIE POMIJA zwykłe przystanki przelotowe (<= 2 słupki), skupiając się na
 * węzłach przesiadkowych, skrzyżowaniach i złożonych zespołach (> 2 słupki).
 *
 * Użycie:
 *   node cloudflare/scripts/check-stop-hints.mjs [--city=wroclaw] [--create-issue] [--all] [--max-missing=15]
 */
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

const ROOT_DIR = path.resolve(import.meta.dirname, '../..');
const DATA_DIR = path.join(ROOT_DIR, 'cloudflare/data');

const ARGS = process.argv.slice(2);
function getArg(prefix, fallback = null) {
  const match = ARGS.find((a) => a.startsWith(prefix));
  return match ? match.slice(prefix.length) : fallback;
}

const CITY = getArg('--city=', 'wroclaw').toLowerCase();
const CREATE_ISSUE = ARGS.includes('--create-issue');
const INCLUDE_ALL = ARGS.includes('--all');
const MAX_MISSING_REPORT = parseInt(getArg('--max-missing=', '15'), 10) || 15;

const HINTS_FILE = path.join(DATA_DIR, `stop-hints-${CITY}.json`);

function normalizeName(value) {
  return String(value ?? '')
    .toLowerCase()
    .replace(/[ąćęłńóśźż]/g, (c) => ({ ą: 'a', ć: 'c', ę: 'e', ł: 'l', ń: 'n', ó: 'o', ś: 's', ź: 'z', ż: 'z' })[c] || c)
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

async function fetchWroclawStops() {
  const res = await fetch('https://open-data.cui.wroclaw.pl/hdb/download/136/', {
    headers: { 'User-Agent': 'KilometrTimetableBot/1.0' },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} pobierania GTFS Wrocławia`);
  const buf = Buffer.from(await res.arrayBuffer());
  const tmpPath = path.join(ROOT_DIR, `.tmp-gtfs-${Date.now()}.zip`);
  fs.writeFileSync(tmpPath, buf);

  try {
    const csv = execSync(`unzip -p "${tmpPath}" stops.txt`, { maxBuffer: 30 * 1024 * 1024 }).toString('utf8');
    const lines = csv.split('\n').slice(1).filter((l) => l.trim().length > 0);
    const stops = [];

    for (const line of lines) {
      const parts = line.split(',');
      if (parts.length < 5) continue;
      const stopId = parts[0].trim();
      const stopCode = parts[1].replace(/\"/g, '').trim();
      const stopName = parts[2].replace(/\"/g, '').trim();
      const lat = parseFloat(parts[3]);
      const lon = parseFloat(parts[4]);

      stops.push({ stopId, stopCode, stopName, lat, lon });
    }
    return stops;
  } finally {
    try {
      if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
    } catch {}
  }
}

async function main() {
  console.log(`[Canary] Sprawdzanie pokrycia wskazówek przystanków dla: ${CITY}`);

  if (!fs.existsSync(HINTS_FILE)) {
    console.error(`[!] Brak pliku bazy wskazówek: ${HINTS_FILE}`);
    process.exit(1);
  }

  const rawHints = JSON.parse(fs.readFileSync(HINTS_FILE, 'utf8'));
  const hintsStops = rawHints.stops || {};
  const hintsClusters = rawHints.clusters || {};

  console.log(`[i] Baza zawiera ${Object.keys(hintsStops).length} opisów słupków oraz ${Object.keys(hintsClusters).length} opisów zespołów.`);

  let gtfsStops = [];
  try {
    if (CITY === 'wroclaw') {
      console.log(`[i] Pobieranie aktualnej listy przystanków GTFS Wrocławia...`);
      gtfsStops = await fetchWroclawStops();
    } else {
      console.error(`[!] Miasto ${CITY} nie jest jeszcze wspierane w pobieraniu na żywo.`);
      process.exit(1);
    }
  } catch (err) {
    console.error(`[!] Błąd pobierania GTFS:`, err.message);
    process.exit(1);
  }

  console.log(`[i] Pobrano ${gtfsStops.length} pozycji przystankowych z GTFS.`);

  // Zgrupowanie według zespołu przystankowego
  const clusterMap = new Map();
  for (const s of gtfsStops) {
    const list = clusterMap.get(s.stopName) || [];
    list.push(s);
    clusterMap.set(s.stopName, list);
  }

  let evaluatedStops = gtfsStops;
  if (!INCLUDE_ALL) {
    // Pomiń zwykłe przystanki przelotowe (zespoły z <= 2 słupkami)
    let skippedClusters = 0;
    let skippedPoles = 0;
    evaluatedStops = [];

    for (const [, poles] of clusterMap.entries()) {
      if (poles.length <= 2) {
        skippedClusters++;
        skippedPoles += poles.length;
      } else {
        evaluatedStops.push(...poles);
      }
    }
    console.log(`[i] Pominięto ${skippedClusters} zwykłych zespołów przelotowych (${skippedPoles} słupków z <= 2 peronami).`);
    console.log(`[i] Ocenie podlegają wyłącznie węzły i złożone zespoły (> 2 słupki): ${evaluatedStops.length} słupków w ${clusterMap.size - skippedClusters} zespołach.`);
  }

  const covered = [];
  const missing = [];

  for (const s of evaluatedStops) {
    const hasDirectCode = s.stopCode && hintsStops[s.stopCode];
    const hasDirectId = s.stopId && hintsStops[s.stopId];
    const clusterKey = normalizeName(s.stopName);
    const hasCluster = hintsClusters[clusterKey];

    if (hasDirectCode || hasDirectId || hasCluster) {
      covered.push(s);
    } else {
      missing.push(s);
    }
  }

  const pct = ((covered.length / evaluatedStops.length) * 100).toFixed(1);
  console.log(`\n=== RAPORT POKRYCIA WSKAZÓWEK DLA WĘZŁÓW (${CITY}) ===`);
  console.log(`Pokryte przystanki węzłowe: ${covered.length} / ${evaluatedStops.length} (${pct}%)`);
  console.log(`Brakujące przystanki węzłowe: ${missing.length}`);

  if (missing.length === 0) {
    console.log(`[✓] Wszystkie kluczowe węzły i złożone przystanki posiadają opisy.`);
    return;
  }

  // Grupowanie brakujących po nazwie zespołu
  const missingClusters = new Map();
  for (const m of missing) {
    const arr = missingClusters.get(m.stopName) || [];
    arr.push(m);
    missingClusters.set(m.stopName, arr);
  }

  // Sortuj według liczby słupków (największe węzły na górze)
  const sortedMissing = Array.from(missingClusters.entries()).sort(
    (a, b) => b[1].length - a[1].length,
  );

  console.log(`\n[!] Najważniejsze brakujące węzły przesiadkowe (łącznie ${missingClusters.size}):`);
  let reported = 0;
  const sampleList = [];
  for (const [name, items] of sortedMissing) {
    if (reported >= MAX_MISSING_REPORT) break;
    const codes = items.map((i) => i.stopCode || i.stopId).join(', ');
    const coords = `${items[0].lat.toFixed(4)}, ${items[0].lon.toFixed(4)}`;
    console.log(`  - ${name} (${items.length} słupków: ${codes}, współrzędne: ${coords})`);
    sampleList.push(`- **${name}** (${items.length} słupków: \`${codes}\`) – [OSM/Mapa](https://www.openstreetmap.org/?mlat=${items[0].lat}&mlon=${items[0].lon}#map=18/${items[0].lat}/${items[0].lon})`);
    reported++;
  }

  // Jeśli zażądano utworzenia zgłoszenia GitHub Issue:
  if (CREATE_ISSUE) {
    const issueTitle = `[stop-hints] Brakujące wskazówki dla węzłów przesiadkowych (${CITY}): ${missingClusters.size} zespołów`;
    console.log(`\n[i] Sprawdzanie istniejących issues na GitHubie...`);
    try {
      const existing = execSync(`gh issue list --search "${issueTitle}" --json title,number --state open`, {
        encoding: 'utf8',
      });
      const parsed = JSON.parse(existing);
      if (parsed.length > 0) {
        console.log(`[i] Issue już istnieje (#${parsed[0].number}: "${parsed[0].title}"). Pomijam tworzenie duplikatu.`);
        return;
      }

      console.log(`[i] Tworzenie nowego issue...`);
      const body = `Automatyczny czujnik Canary (stop-hints) wykrył brakujące wskazówki lokalizacyjne dla węzłów przesiadkowych w mieście **${CITY}**.\n\n` +
        `### Statystyki:\n` +
        `- Pokrycie węzłów: **${pct}%** (${covered.length} / ${evaluatedStops.length} słupków)\n` +
        `- Brakujące węzły: **${missingClusters.size} zespołów**\n\n` +
        `### Najważniejsze brakujące węzły (posortowane wielkością):\n` +
        sampleList.join('\n') +
        `\n\n*Aby dodać wskazówki, wygeneruj kontekst za pomocą \`npm run stop-hints:context -- --city=${CITY}\` i uzupełnij bazę \`cloudflare/data/stop-hints-${CITY}.json\`.*`;

      const tmpBodyFile = path.join(ROOT_DIR, `.tmp-issue-body-${Date.now()}.md`);
      fs.writeFileSync(tmpBodyFile, body, 'utf8');
      const createRes = execSync(`gh issue create --title "${issueTitle}" --body-file "${tmpBodyFile}" --label "data,stop-hints"`, {
        encoding: 'utf8',
      });
      console.log(`[✓] Utworzono issue: ${createRes.trim()}`);
      fs.unlinkSync(tmpBodyFile);
    } catch (e) {
      console.warn(`[!] Nie udało się utworzyć issue przez gh CLI:`, e.message);
    }
  }
}

main().catch(console.error);
