#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { findUnknownNames } from './news-validate.mjs';

const ROOT_DIR = path.resolve(import.meta.dirname, '../..');
const ENV_PATH = path.join(ROOT_DIR, '.env');
const DATA_DIR = path.join(ROOT_DIR, 'cloudflare/data');
const DIST_DIR = path.join(ROOT_DIR, 'cloudflare/dist');
const CACHE_FILE = path.join(DATA_DIR, 'news-cache.json');

const SUPPORTED_CITIES = [
  'wroclaw',
  'warszawa',
  'poznan',
  'trojmiasto',
  'krakow',
  'lodz',
  'olsztyn',
  'opole',
  'rzeszow',
];

const CITY_NAMES = {
  wroclaw: 'Wrocław',
  warszawa: 'Warszawa',
  poznan: 'Poznań',
  trojmiasto: 'Trójmiasto',
  krakow: 'Kraków',
  lodz: 'Łódź',
  olsztyn: 'Olsztyn',
  opole: 'Opole',
  rzeszow: 'Rzeszów',
};

// Podbij przy każdej zmianie promptu: hash cache zależy od tej wersji.
const PROMPT_VERSION = '2026-10-29.1';

function loadLocalEnv() {
  if (!fs.existsSync(ENV_PATH)) return;
  try {
    const content = fs.readFileSync(ENV_PATH, 'utf8');
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const idx = trimmed.indexOf('=');
      if (idx === -1) continue;
      const key = trimmed.slice(0, idx).trim();
      const val = trimmed.slice(idx + 1).trim().replace(/^['"]|['"]$/g, '');
      if (!process.env[key]) {
        process.env[key] = val;
      }
    }
  } catch {
    // błąd odczytu .env nie blokuje wykonania
  }
}

loadLocalEnv();

const ARGS = process.argv.slice(2);
function getArg(prefix, fallback = null) {
  const match = ARGS.find((a) => a.startsWith(prefix));
  return match ? match.slice(prefix.length) : fallback;
}

const CITY_ARG = getArg('--city=', 'wroclaw').toLowerCase();
const LIMIT = parseInt(getArg('--limit=', '5'), 10) || 5;
const PROVIDER = getArg('--provider=', process.env.LLM_PROVIDER || 'deepseek').toLowerCase();
const MODEL = getArg(
  '--model=',
  process.env.LLM_MODEL || (PROVIDER === 'deepseek' ? 'deepseek-chat' : 'gemini-3.8-flash'),
);
const DRY_RUN = ARGS.includes('--dry-run');
const FORCE_REFRESH = ARGS.includes('--force');

const API_KEY =
  getArg('--key=', null) ||
  (PROVIDER === 'deepseek'
    ? process.env.DEEPSEEK_API_KEY
    : process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY) ||
  '';

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function cleanHtml(html) {
  if (!html) return '';
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<nav[\s\S]*?<\/nav>/gi, ' ')
    .replace(/<header[\s\S]*?<\/header>/gi, ' ')
    .replace(/<footer[\s\S]*?<\/footer>/gi, ' ')
    .replace(/<aside[\s\S]*?<\/aside>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(?:p|div|li|tr|h[1-6]|br)[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&oacute;/gi, 'ó')
    .replace(/&Oacute;/gi, 'Ó')
    .replace(/&bdquo;/gi, '„')
    .replace(/&rdquo;/gi, '”')
    .replace(/&ndash;|&mdash;/gi, '–')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/\r\n/g, '\n')
    .replace(/\n\s*\n\s*\n/g, '\n\n')
    .replace(/^[ \t]+|[ \t]+$/gm, '')
    .trim();
}

async function fetchFullArticleText(url) {
  if (!url || !/^https?:\/\//i.test(url)) return null;

  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'pl,en-US;q=0.7,en;q=0.3',
      },
      signal: AbortSignal.timeout(7000),
    });

    if (!res.ok) return null;
    const html = await res.text();

    let rawFragment =
      (html.match(/id="article-content"[\s\S]*?>([\s\S]*?)<div class="box-container/i)?.[1]) ||
      (html.match(/class="page-main"[\s\S]*?>([\s\S]*?)<\/main>/i)?.[1]) ||
      (html.split(/class="row content mt-4"/i)[1]?.split(/<\/section>/i)[0]) ||
      (html.match(/<article[\s\S]*?>([\s\S]*?)<\/article>/i)?.[1]) ||
      (html.match(/class="entry-content"[\s\S]*?>([\s\S]*?)<\/div>/i)?.[1]) ||
      (html.match(/class="article-content"[\s\S]*?>([\s\S]*?)<\/div>/i)?.[1]) ||
      (html.match(/<main[\s\S]*?>([\s\S]*?)<\/main>/i)?.[1]) ||
      '';

    const cleaned = cleanHtml(rawFragment);
    return cleaned.length > 100 ? cleaned.slice(0, 4500) : null;
  } catch {
    return null;
  }
}

const JUNK_TITLE_RE =
  /\b(przetarg|zamówieni[ae]|rekrutacj|oferta pracy|zatrudnimy|aukcj[ae]|składnik[oó]w majątkowych|rzeczy znalezionych|konkurs plastyczn|życzenia|wesołych świąt|facebook|instagram|tiktok|polub nas)\b/i;

function isObviousJunk(title, content) {
  if (JUNK_TITLE_RE.test(title)) return true;
  if (/facebook\.com|instagram\.com/i.test(content) && content.length < 250 && !/\blini[iaę]\b/i.test(content)) {
    return true;
  }
  return false;
}

function parseRssItems(xml, limit) {
  const items = [];
  const itemMatches = xml.match(/<item[\s\S]*?<\/item>/gi) || [];
  for (const block of itemMatches.slice(0, limit)) {
    const titleMatch = block.match(/<title>(?:<!\[CDATA\[(.*?)\]\]>|(.*?))<\/title>/is);
    const title = cleanHtml(titleMatch ? (titleMatch[1] || titleMatch[2] || '') : '');

    const linkMatch = block.match(/<link>(?:<!\[CDATA\[(.*?)\]\]>|(.*?))<\/link>/is);
    const link = (linkMatch ? (linkMatch[1] || linkMatch[2] || '') : '').trim();

    const descMatch = block.match(/<description>(?:<!\[CDATA\[(.*?)\]\]>|(.*?))<\/description>/is);
    const contentMatch = block.match(/<content:encoded>(?:<!\[CDATA\[(.*?)\]\]>|(.*?))<\/content:encoded>/is);
    const rawContent =
      (contentMatch ? (contentMatch[1] || contentMatch[2]) : null) ||
      (descMatch ? (descMatch[1] || descMatch[2]) : '') ||
      '';
    const content = cleanHtml(rawContent);

    const pubDateMatch = block.match(/<pubDate>(.*?)<\/pubDate>/is);
    const pubDate = pubDateMatch ? pubDateMatch[1].trim() : null;

    if (title || content) {
      items.push({
        id: crypto.createHash('sha256').update(link || title).digest('hex').slice(0, 16),
        title,
        link,
        pubDate,
        content: content.slice(0, 3000),
      });
    }
  }
  return items;
}

async function fetchCityFeed(city, limit) {
  const browserHeaders = {
    'User-Agent': 'Mozilla/5.0 (compatible; kilometr/1.0)',
    Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  };

  switch (city) {
    case 'warszawa': {
      const res = await fetch('https://www.wtp.waw.pl/feed/', { headers: browserHeaders });
      if (!res.ok) throw new Error(`HTTP ${res.status} from WTP`);
      return parseRssItems(await res.text(), limit);
    }
    case 'poznan': {
      const res = await fetch('https://www.ztm.poznan.pl/feed/', { headers: browserHeaders });
      if (!res.ok) throw new Error(`HTTP ${res.status} from Poznan ZTM`);
      return parseRssItems(await res.text(), limit);
    }
    case 'trojmiasto':
    case 'gdansk': {
      const res = await fetch('https://files.cloudgdansk.pl/d/otwarte-dane/ztm/znt.json?v=1');
      if (!res.ok) throw new Error(`HTTP ${res.status} from ZTM Gdansk`);
      const data = await res.json();
      const results = (data.results || []).slice(0, limit);
      return results.map((r) => ({
        id: String(r.id || crypto.createHash('sha256').update(r.title || '').digest('hex').slice(0, 16)),
        title: r.title || '',
        link: r.url || '',
        pubDate: r.publishFrom || null,
        content: cleanHtml(`${r.summary || ''}\n${r.content || ''}`).slice(0, 3000),
      }));
    }
    case 'wroclaw': {
      const res = await fetch('https://www.wroclaw.pl/komunikacja/rss', { headers: browserHeaders });
      if (!res.ok) throw new Error(`HTTP ${res.status} from Wroclaw RSS`);
      return parseRssItems(await res.text(), limit);
    }
    case 'krakow': {
      const res = await fetch('https://ztp.krakow.pl/feed?post_type=komunikat', { headers: browserHeaders });
      if (!res.ok) throw new Error(`HTTP ${res.status} from Krakow ZTP`);
      return parseRssItems(await res.text(), limit);
    }
    case 'lodz': {
      const res = await fetch('https://mpk.lodz.pl/rozklady/rss/rozklady.jsp', { headers: browserHeaders });
      if (!res.ok) throw new Error(`HTTP ${res.status} from Lodz MPK`);
      return parseRssItems(await res.text(), limit);
    }
    case 'olsztyn': {
      const res = await fetch('https://zdzit.olsztyn.eu/feed/', { headers: browserHeaders });
      if (!res.ok) throw new Error(`HTTP ${res.status} from Olsztyn ZDZiT`);
      return parseRssItems(await res.text(), limit);
    }
    case 'opole': {
      const res = await fetch('https://www.mzkopole.pl/category/aktualnosci/feed/', { headers: browserHeaders });
      if (!res.ok) throw new Error(`HTTP ${res.status} from Opole MZK`);
      return parseRssItems(await res.text(), limit);
    }
    case 'rzeszow': {
      const res = await fetch('https://ztm.erzeszow.pl/feed/', { headers: browserHeaders });
      if (!res.ok) throw new Error(`HTTP ${res.status} from Rzeszow ZTM`);
      return parseRssItems(await res.text(), limit);
    }
    default:
      throw new Error(`Nieobsługiwane miasto: ${city}. Dostępne: ${SUPPORTED_CITIES.join(', ')}`);
  }
}

const SYSTEM_INSTRUCTION = `Jesteś silnikiem analizy operacyjnej dla aplikacji transportu publicznego Kilometr.
Przekształcasz komunikaty zarządców dróg i transportu w precyzyjną, maszynową topologię utrudnień oraz zwięzłe, ludzkie mikro-streszczenia (styl antislop: konkret, brak waty słownej).

ODPOWIADAJ WYŁĄCZNIE CZYSTYM OBIEKTEM JSON O PONIŻSZEJ STRUKTURZE:
{
  "is_transit_alert": boolean, // true TYLKO gdy dotyczy realnego funkcjonowania zbiorkomu (zmian tras, objazdów, awarii, zawieszeń, dodatkowych linii, remontów, taryf). false jeśli to informacja czysto samochodowa bez wpływu na zbiorkom, autopromocja, social media, życzenia, oferty pracy, przetargi itp.
  "headline": string, // Krótki, czytelny nagłówek (maks. 8-10 słów) z sednem sprawy, np. "Krakowska: linie 3 i 5 skrócone do Galerii Dominikańskiej", "Wszystkich Świętych: dodatkowe linie tramwajowe C1-C7"
  "disruption_type": "accident" | "infrastructure_failure" | "planned_works" | "event" | "weather" | "fare" | "other",
  "is_emergency": boolean, // true dla zdarzeń nagłych (kolizja, zerwana sieć, awaria torowiska); false dla zaplanowanych prac, świąt, meczów, stałych korekt
  "is_resolved": boolean, // true jeśli w treści jest informacja o zakończeniu utrudnienia (np. "Aktualizacja: ruch przywrócony", "awaria usunięta", "tramwaje wróciły na stałe trasy"). false gdy utrudnienie nadal trwa lub wejdzie w życie w przyszłości
  "severity": "info" | "minor" | "major" | "blocking", // blocking: paraliż korytarza transportowego; major: zmiana tras wielu linii lub kluczowych węzłów; minor: przeniesiony słupek/niewielka korekta; info: taryfy, odrzucone, utrudnienia zakończone
  "glance": {
    "problem": string, // Dokładnie 1 zwięzłe zdanie: co i gdzie się stało (np. "Kolizja na ul. Krakowskiej blokuje ruch tramwajowy w stronę Księża Małego.")
    "solution": string | null, // Dokładnie 1 zwięzłe zdanie jak podróżować w zamian (np. "Na odcinku Galeria Dominikańska – Księże Małe kursuje autobus za-tramwaj."), lub null jeśli brak alternatywy lub ruch przywrócony
    "timeframe": string // Czytelny dla oka opis okresu, np. "Od 31.10 do 02.11", "Od godz. 13:30 (ruch przywrócony o 15:50)"
  },
  "valid_from": string, // Data i czas ISO 8601 od kiedy zmiana obowiązuje (np. "2026-10-31T00:00:00Z"). Jeśli brak, użyj daty publikacji
  "valid_to": string | null, // Data i czas ISO 8601 końca utrudnień lub null ("do odwołania", na stałe lub nieznany)
  "all_lines": string[], // Numery/symbole wszystkich linii zbiorkomu, których dotyczy zmiana (np. ["3", "5"]). Pusta tablica [] jeśli irrelevant
  "impacted_lines": [ // Rozbicie per-linia z topologią zmian
    {
      "line": string, // np. "3"
      "direction": string | null, // Docelowy kierunek problemu w mianowniku, np. "Księże Małe", "Oporów", lub "both"
      "impact_type": "detour" | "shortened" | "cancelled" | "route_restored" | "shuttle_bus" | "schedule_change" | "special_service",
      "omitted_stops": string[], // Przystanki omijane przez tę linię (w mianowniku, np. ["Plac Zgody", "Krakowska"])
      "temporary_stops": string[], // Przystanki tymczasowe lub dodatkowe (w mianowniku)
      "replacement_line": string | null, // Linia zastępcza jeśli uruchomiono (np. "Za-tramwaj 703" lub "autobus 705")
      "details": string // 1 zdanie o zmianie trasy tej konkretnej linii
    }
  ],
  "stops": [ // Lista przystanków, których obsługa uległa zmianie
    {
      "name": string, // ZAWSZE W MIANOWNIKU: "Plac Bema" (nie: "Placu Bema"), "Księże Małe" (nie: "Księża Małego")
      "action": "omitted" | "relocated" | "temporary" | "restored" | "board_opposite",
      "lines": string[], // Linie, których dotyczy ta zmiana przystankowa
      "details": string // Konkretna wskazówka (np. "Słupek przeniesiony 50m za skrzyżowanie", "Przystanek zawieszony")
    }
  ]
}

ZASADY ANTY-SLOP I JAKOŚCI DANYCH:
1. ZERO WATY SŁOWNEJ: Bezwzględny zakaz fraz urzędowych typu: "przepraszamy za niedogodności", "nie kursują normalnie", "sprawdź rozkład przed wyjazdem", "decyzją zarządu". Pisz surowe fakty: GDZIE, CO i CZYM JECHAĆ W ZAMIAN.
2. MIANOWNIK DLA PRZYSTANKÓW: Polskie nazwy przystanków zawsze sprowadzaj do formy bazowej: "Galeria Dominikańska", "Rondo Reagana", "Dworzec Główny", "Piecowice - pętla".
3. LINIE TO WYŁĄCZNIE ZBIORKOM: Nigdy nie dodawaj numerów dróg krajowych (np. DK94, AOW, A8), numerów ustaw, numerów peronów ani roczników.
4. JEŚLI SPAM LUB BEZ WPŁYWU NA ZBIORKOM:
   Ustaw is_transit_alert: false, severity: "info", all_lines: [], impacted_lines: [], stops: [], glance.problem: "Informacja nieoperacyjna: [powód odrzucenia]".
5. KOPIUJ, NIE TWÓRZ: nazwy ulic, placów, dzielnic, osiedli, mostów i przystanków przepisujesz znak w znak z treści. Zero odmiany, zero "poprawiania", zero tłumaczenia. Jeśli treść ma "Krzyki", pisz "Krzyki". Jeśli "Włochy", pisz "Włochy". Nigdy "Krzków", "Włochów".
6. ZERO NOWEJ GEOGRAFII: nie dodawaj miejsc, których nie ma w treści. Nie zgaduj dzielnicy z nazwy ulicy. Brak nazwy w treści oznacza brak nazwy w odpowiedzi.
7. FORMA Z TREŚCI: używaj dokładnie tej formy nazwy, która występuje w komunikacie. Jeśli treść ma "Krzykach", pisz "Krzykach". Nie twórz własnych form fleksyjnych. Żeby zdanie brzmiało naturalnie, użyj konstrukcji "w dzielnicy Krzyki", "w rejonie ul. Krakowskiej", "na trasie do Włoch".
8. MIASTO: komunikat dotyczy wyłącznie miasta podanego w zadaniu. Nie używaj dzielnic ani miejsc z innych miast.
9. SAMOKONTROLA: przed odpowiedzią sprawdź każdą nazwę własną w headline, glance.problem, glance.solution i stops. Musi występować w treści źródłowej. Jeśli nie występuje, usuń ją albo przepisz dokładnie z treści.

PRZYKŁADY POPRAWNEJ FORMY NAZW:
- Treść: "utrudnienia w rejonie Krzyki" -> "Utrudnienia w dzielnicy Krzyki" (nie "Krzków").
- Treść: "objazd przez Włochy" -> "Objazd przez Włochy" (nie "Włochów").`;

function buildPrompt(item, city, correction = []) {
  const cityName = CITY_NAMES[city] || city;
  const base = `Przeanalizuj komunikat miejski (${cityName}):
Tytuł: ${item.title}
Data publikacji: ${item.pubDate || 'brak'}
Link: ${item.link}

Treść komunikatu:
${item.fullContent || item.content || item.title}`;
  if (correction.length === 0) return base;
  return `${base}

POPRAWA NAZW WŁASNYCH:
Te nazwy nie występują w treści źródłowej: ${correction.map((name) => `"${name}"`).join(', ')}.
Przepisz cały JSON. Każdą nazwę własną (ulica, plac, dzielnica, osiedle, most, przystanek) skopiuj dokładnie w formie z treści albo usuń zdanie z tą nazwą. Nie twórz nowych form.`;
}

async function callDeepSeek(item, city, apiKey, model, correction = [], maxRetries = 3) {
  const prompt = buildPrompt(item, city, correction);

  const url = 'https://api.deepseek.com/chat/completions';

  const body = {
    model: model || 'deepseek-chat',
    messages: [
      { role: 'system', content: SYSTEM_INSTRUCTION },
      { role: 'user', content: prompt },
    ],
    response_format: { type: 'json_object' },
    temperature: 0.1,
  };

  let attempt = 0;
  while (attempt <= maxRetries) {
    attempt++;
    const start = Date.now();
    let res;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(body),
      });
    } catch (netErr) {
      if (attempt <= maxRetries) {
        const delay = attempt * 2000;
        console.warn(`[!] Błąd sieci: ${netErr.message}. Ponawiam próbę (${attempt}/${maxRetries}) za ${delay}ms...`);
        await sleep(delay);
        continue;
      }
      throw netErr;
    }

    const durationMs = Date.now() - start;

    if (res.status === 429 || res.status >= 500) {
      if (attempt <= maxRetries) {
        const delay = attempt * 2500;
        console.warn(`[!] DeepSeek API przeciążone (HTTP ${res.status}). Ponawiam (${attempt}/${maxRetries}) za ${delay}ms...`);
        await sleep(delay);
        continue;
      }
    }

    if (!res.ok) {
      const errorText = await res.text();
      throw new Error(`DeepSeek API error (${res.status}): ${errorText}`);
    }

    const json = await res.json();
    const rawContent = json.choices?.[0]?.message?.content;
    if (!rawContent) throw new Error('Brak treści w odpowiedzi DeepSeek');

    const parsed = JSON.parse(rawContent);
    return {
      parsed,
      usage: json.usage || null,
      durationMs,
    };
  }
}

async function callGemini(item, city, apiKey, model, correction = [], maxRetries = 3) {
  const prompt = buildPrompt(item, city, correction);

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

  const body = {
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    systemInstruction: { parts: [{ text: SYSTEM_INSTRUCTION }] },
    generationConfig: {
      temperature: 0.1,
      responseMimeType: 'application/json',
    },
  };

  let attempt = 0;
  while (attempt <= maxRetries) {
    attempt++;
    const start = Date.now();
    let res;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
    } catch (netErr) {
      if (attempt <= maxRetries) {
        const delay = attempt * 2000;
        await sleep(delay);
        continue;
      }
      throw netErr;
    }

    const durationMs = Date.now() - start;
    if (res.status === 503 || res.status === 429) {
      if (attempt <= maxRetries) {
        const delay = attempt * 2500;
        await sleep(delay);
        continue;
      }
    }

    if (!res.ok) {
      const errorText = await res.text();
      throw new Error(`Gemini API error (${res.status}): ${errorText}`);
    }

    const json = await res.json();
    const rawText = json.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!rawText) throw new Error('Brak odpowiedzi od Gemini');

    return {
      parsed: JSON.parse(rawText),
      usage: json.usageMetadata || null,
      durationMs,
    };
  }
}

function loadCache() {
  if (!fs.existsSync(CACHE_FILE)) {
    return { version: 1, entries: {} };
  }
  try {
    const raw = fs.readFileSync(CACHE_FILE, 'utf8');
    return JSON.parse(raw);
  } catch {
    return { version: 1, entries: {} };
  }
}

function saveCache(cache) {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  // Czyszczenie wpisów starszych niż 21 dni
  const cutoffMs = Date.now() - 21 * 24 * 3600 * 1000;
  for (const [key, entry] of Object.entries(cache.entries)) {
    const entryTime = new Date(entry.lastUpdated || entry.firstSeen || 0).getTime();
    if (entryTime < cutoffMs) {
      delete cache.entries[key];
    }
  }
  fs.writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2), 'utf8');
}

function computeContentHash(item) {
  const content = `${PROMPT_VERSION}\n${item.title}\n${item.fullContent || item.content || ''}`;
  return crypto.createHash('sha256').update(content).digest('hex').slice(0, 16);
}

async function processCity(city, limit, cache) {
  console.log(`\n============================================================`);
  console.log(`Miasto: ${city.toUpperCase()} | Pobieranie feedu...`);

  let items = [];
  try {
    items = await fetchCityFeed(city, limit);
  } catch (err) {
    console.error(`[!] Błąd pobierania feedu dla ${city}:`, err.message);
    return [];
  }

  console.log(`Pobrano ${items.length} pozycji.`);

  const acceptedAlerts = [];

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    console.log(`--- [${i + 1}/${items.length}] ${item.title}`);

    if (isObviousJunk(item.title, item.content)) {
      console.log(`    [ODRZUCONY LOKALNIE]: słowa kluczowe spamu/ogłoszenia`);
      continue;
    }

    const fullArticle = await fetchFullArticleText(item.link);
    if (fullArticle && fullArticle.length >= (item.content || '').length) {
      item.fullContent = fullArticle;
    } else {
      item.fullContent = item.content;
    }

    const contentHash = computeContentHash(item);
    const cached = cache.entries[item.id];

    if (!FORCE_REFRESH && cached && cached.contentHash === contentHash) {
      console.log(`    [CACHE HIT] (hash: ${contentHash}) - pomijam wywołanie LLM`);
      if (cached.analysis?.is_transit_alert) {
        acceptedAlerts.push({
          id: item.id,
          source_title: item.title,
          link: item.link,
          published_at: item.pubDate,
          ...cached.analysis,
        });
      }
      continue;
    }

    if (DRY_RUN) {
      console.log(`    [DRY-RUN] Nowy komunikat (hash: ${contentHash}). Gotowy do analizy.`);
      continue;
    }

    try {
      const sourceText = item.fullContent || item.content || item.title;
      let result =
        PROVIDER === 'deepseek'
          ? await callDeepSeek(item, city, API_KEY, MODEL)
          : await callGemini(item, city, API_KEY, MODEL);

      let analysis = result.parsed;

      if (analysis.is_transit_alert !== false) {
        const unknown = findUnknownNames(analysis, sourceText);
        if (unknown.length > 0) {
          console.log(`    [!] Nazwy poza treścią: ${unknown.join(', ')}. Poprawiam...`);
          result =
            PROVIDER === 'deepseek'
              ? await callDeepSeek(item, city, API_KEY, MODEL, unknown)
              : await callGemini(item, city, API_KEY, MODEL, unknown);
          analysis = result.parsed;
          const still = findUnknownNames(analysis, sourceText);
          if (still.length > 0) {
            console.log(`    [ODRZUCONY]: nazwy nadal poza treścią: ${still.join(', ')}`);
            continue;
          }
        }
      }

      cache.entries[item.id] = {
        city,
        contentHash,
        firstSeen: cached?.firstSeen || new Date().toISOString(),
        lastUpdated: new Date().toISOString(),
        item: {
          id: item.id,
          title: item.title,
          link: item.link,
          pubDate: item.pubDate,
        },
        analysis,
      };

      if (!analysis.is_transit_alert) {
        console.log(`    [ODRZUCONY PRZEZ MODEL]: ${analysis.glance?.problem || 'Nie dotyczy zbiorkomu'}`);
      } else {
        const badge = analysis.is_resolved
          ? '[ZAKOŃCZONE]'
          : analysis.is_emergency
            ? '[AWARIA W TOKU]'
            : '[PLANOWANE]';
        console.log(`    [NOWY ALERT ${badge}] ${analysis.headline} (${result.durationMs}ms)`);
        acceptedAlerts.push({
          id: item.id,
          source_title: item.title,
          link: item.link,
          published_at: item.pubDate,
          ...analysis,
        });
      }
    } catch (err) {
      console.error(`    [!] Błąd analizy:`, err.message);
    }
  }

  // Zapis pliku wynikowego {city}/disruptions.json
  const cityDistDir = path.join(DIST_DIR, city);
  if (!fs.existsSync(cityDistDir)) {
    fs.mkdirSync(cityDistDir, { recursive: true });
  }

  const disruptionsFile = path.join(cityDistDir, 'disruptions.json');
  const payload = {
    city,
    generated_at: new Date().toISOString(),
    alerts_count: acceptedAlerts.length,
    alerts: acceptedAlerts,
  };

  fs.writeFileSync(disruptionsFile, JSON.stringify(payload, null, 2), 'utf8');
  console.log(`Zapisano ${acceptedAlerts.length} alertów do: ${disruptionsFile}`);

  return acceptedAlerts;
}

async function main() {
  console.log(`=== Kilometr: Agregator i Generator Zakłóceń Transportowych ===`);
  console.log(`Provider: ${PROVIDER} | Model: ${MODEL} | Limit: ${LIMIT}`);

  if (!API_KEY && !DRY_RUN) {
    console.error(`\n[!] Brak klucza API dla providera: ${PROVIDER}.`);
    console.error(`  export DEEPSEEK_API_KEY="sk-..."`);
    process.exit(1);
  }

  const cache = loadCache();
  const cachedCount = Object.keys(cache.entries).length;
  console.log(`Załadowano cache lokalny: ${cachedCount} wpisów.`);

  const targetCities =
    CITY_ARG === 'all'
      ? SUPPORTED_CITIES
      : [CITY_ARG];

  let totalAccepted = 0;
  for (const city of targetCities) {
    const alerts = await processCity(city, LIMIT, cache);
    totalAccepted += alerts.length;
  }

  if (!DRY_RUN) {
    saveCache(cache);
    console.log(`\nZaktualizowano stan cache (${Object.keys(cache.entries).length} wpisów).`);
  }

  console.log(`\nZakończono. Łącznie aktywnych/niedawnych alertów: ${totalAccepted}`);
}

main().catch((err) => {
  console.error('Błąd krytyczny:', err);
  process.exit(1);
});
