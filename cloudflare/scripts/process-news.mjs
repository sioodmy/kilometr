#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { findUnknownNames } from './news-validate.mjs';

const ROOT_DIR = path.resolve(import.meta.dirname, '../..');
const ENV_PATH = path.join(ROOT_DIR, '.env');
const DATA_DIR = path.join(ROOT_DIR, 'cloudflare/data');
const DIST_DIR = path.join(ROOT_DIR, 'cloudflare/dist');
const CACHE_FILE = path.join(DATA_DIR, 'news-cache.json');

const SUPPORTED_CITIES = [
  'wroclaw',
  'gzm',
  'warszawa',
  'poznan',
  'trojmiasto',
  'krakow',
  'lodz',
  'olsztyn',
  'opole',
  'rzeszow',
  'szczecin',
  'kielce',
  'bialystok',
  'lublin',
  'radom',
  'polska',
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
  szczecin: 'Szczecin',
  kielce: 'Kielce',
  bialystok: 'Białystok',
  lublin: 'Lublin',
  radom: 'Radom',
  polska: 'Polska (Kolej)',
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
      (html.split(/<span id="mtc"><\/span>/i)[1]?.split(/<\/div>\s*<\/div>\s*<\/div>/i)[0]) ||
      (html.match(/id="article-content"[\s\S]*?>([\s\S]*?)<div class="box-container/i)?.[1]) ||
      (html.match(/class="page-main"[\s\S]*?>([\s\S]*?)<\/main>/i)?.[1]) ||
      (html.split(/class="row content mt-4"/i)[1]?.split(/<\/section>/i)[0]) ||
      (html.match(/<article[\s\S]*?>([\s\S]*?)<\/article>/i)?.[1]) ||
      (html.match(/class="entry-content"[\s\S]*?>([\s\S]*?)<\/div>/i)?.[1]) ||
      (html.match(/class="article-content"[\s\S]*?>([\s\S]*?)<\/div>/i)?.[1]) ||
      (html.match(/<main[\s\S]*?>([\s\S]*?)<\/main>/i)?.[1]) ||
      '';

    if (url.includes('intercity.pl')) {
      const main = html.match(/<main[\s\S]*?<\/main>/i)?.[0] || html;
      let text = main.split(/Informujemy,\s*że mają Państwo prawo/i)[0];
      text = text.split(/Prosimy o zwracanie uwagi na komunikaty głosowe/i)[0];
      text = text.split(/Przepraszamy za niedogodności/i)[0];
      const startIdx = text.search(/W dniu|Informujemy|Z powodu|W związku|Dnia\s+\d/i);
      if (startIdx !== -1) {
        text = text.slice(startIdx);
      }
      return cleanHtml(text.replace(/<li[^>]*>/gi, '\n• '));
    }

    // Strony nowych miast mają własne kontenery treści; ogólny chain
    // wyciągałby nawigację albo panel boczny z innymi komunikatami.
    if (/mpk\.lodz\.pl/i.test(url)) {
      // wholemessage.jsp: treść w div#dWrkspc.
      const m = html.split(/id="dWrkspc"/i)[1]?.split(/<\/div>\s*<\/div>\s*<\/div>/i)[0] ?? '';
      const cleaned = cleanHtml(m);
      return cleaned.length > 100 ? cleaned.slice(0, 4500) : null;
    }
    if (/ztm\.kielce\.pl/i.test(url)) {
      const m = (html.split(/com-content-article__body/i)[1] ?? '')
        .split(/rp-sidebarright/i)[0]
        .replace(/<div class="rozklad_jazdy_aticle"[\s\S]*$/i, ' ');
      const cleaned = cleanHtml(m);
      return cleaned.length > 100 ? cleaned.slice(0, 4500) : null;
    }
    if (/zditm\.szczecin\.pl/i.test(url)) {
      const m = (html.split(/id="pageContent"/i)[1]?.split(/<\/main>/i)[0] ?? '')
        .split(/Więcej wiadomości/i)[0]
        .split(/wiadomosci\.szczecin\.eu/i)[0]
        .split(/<div class="offcanvas/i)[0];
      const cleaned = cleanHtml(m);
      return cleaned.length > 100 ? cleaned.slice(0, 4500) : null;
    }
    if (/mzdik\.pl/i.test(url)) {
      // Sekcja komunikatu; aside z listą innych komunikatów leży poza nią.
      const section = (html.split(/<section aria-labelledby="section-heading">/i)[1]?.split(/<\/section>/i)[0] ?? '').replace(
        /<header\b[\s\S]*?<\/header>/i,
        ' ',
      );
      const cleaned = cleanHtml(section);
      return cleaned.length > 100 ? cleaned.slice(0, 4500) : null;
    }
    if (/zdtm\.lublin\.eu/i.test(url)) {
      const m = (html.split(/class="main-center-panel[^>]*>/i)[1]?.split(/main-right-panel/i)[0] ?? '')
        .replace(/<ol class="breadcrumb"[\s\S]*?<\/ol>/gi, ' ')
        .replace(/<h2 class="text-header"[\s\S]*?<\/h2>/i, ' ');
      const cleaned = cleanHtml(m);
      return cleaned.length > 100 ? cleaned.slice(0, 4500) : null;
    }
    if (/komunikacja\.bialystok\.pl/i.test(url)) {
      const m =
        html
          .split(/component-content-wysiwyg/i)[1]
          ?.split(/Cms_Attachment|Cms_Gallery|<footer/i)[0] ?? '';
      const cleaned = cleanHtml(m);
      return cleaned.length > 100 ? cleaned.slice(0, 4500) : null;
    }

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

function cleanIntercityTitle(title) {
  return title
    .replace(/w dniu\s+\d{1,2}\.\d{1,2}\.?\s*\d{0,4}\s*(?:roku|r\.?)?/gi, '')
    .replace(/Aktualizacja:[\s\S]*$/i, '')
    .replace(/,,/g, '„')
    .replace(/"/g, '„')
    .replace(/“/g, '”')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractPkpTimeframe(pubDate, text) {
  const m = text.match(/Aktualizacja:\s*(\d{4}-\d{2}-\d{2})\s*,\s*(\d{2}:\d{2})/i);
  if (m) {
    const [, date, time] = m;
    const [, month, day] = date.split('-');
    return `${day}.${month}, ${time}`;
  }
  if (pubDate) {
    const d = new Date(pubDate);
    if (!isNaN(d.getTime())) {
      const day = String(d.getUTCDate()).padStart(2, '0');
      const month = String(d.getUTCMonth() + 1).padStart(2, '0');
      const time = `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
      return `${day}.${month}, ${time}`;
    }
  }
  return '';
}

function extractTrainNumbers(text) {
  const seen = new Set();
  const yearSet = new Set(['2024', '2025', '2026', '2027', '2028']);
  const re = /\b(IC|TLK|EIC|EIP|PR|KM|KŚ|KW|KD|Polregio)?\s*(?:nr\s*)?(\d{3,5}(?:\/\d{1,2})?)\b/gi;
  let m;
  while ((m = re.exec(text)) !== null) {
    const carrier = m[1] ? m[1].toUpperCase() : null;
    const num = m[2];
    if (yearSet.has(num)) continue;
    seen.add(num);
    if (carrier) seen.add(`${carrier} ${num}`);
    if (num.includes('/')) {
      const [base, slash] = num.split('/');
      seen.add(base);
      if (carrier) seen.add(`${carrier} ${base}`);
      if (slash.length <= 2) {
        const derived = base.slice(0, base.length - slash.length) + slash;
        seen.add(derived);
        if (carrier) seen.add(`${carrier} ${derived}`);
      }
    }
  }
  return [...seen];
}

function cleanProblemText(text) {
  let s = text
    .replace(/^w dniu\s+\d{1,2}\.\d{1,2}\.?\s*\d{0,4}\s*(?:roku|r\.?)?/i, '')
    .replace(/^dnia\s+\d{1,2}\.\d{1,2}\.?\s*\d{0,4}\s*(?:roku|r\.?)?/i, '')
    .replace(/Aktualizacja:[\s\S]*?(?:Opublikowano:[\s\S]*?)?(?=(?:W dniu|Dnia|Z powodu|W związku|Niżej|Informujemy))/i, '')
    .replace(/^(?:W dniu|Dnia)\s+\d{1,2}\.\d{1,2}\.?\s*\d{0,4}\s*(?:roku|r\.?)?\s*,?\s*/i, '')
    .replace(/,,/g, '„')
    .replace(/\s+/g, ' ')
    .trim();
  if (s.length > 0) {
    s = s.charAt(0).toUpperCase() + s.slice(1);
  }
  return s;
}

function buildPkpDirectAlert(item) {
  if (item.pdpData) {
    const pdp = item.pdpData;
    const allLines = pdp.lines;
    const headline = pdp.headline;

    return {
      is_transit_alert: true,
      headline,
      disruption_type: pdp.disruption_type,
      is_emergency: true,
      is_resolved: false,
      severity: pdp.severity,
      glance: {
        problem: (pdp.message || headline).slice(0, 400),
        solution: pdp.section ? `Odcinek: ${pdp.section}` : null,
        timeframe: extractPkpTimeframe(item.pubDate, ""),
      },
      valid_from: item.pubDate || new Date().toISOString(),
      valid_to: null,
      all_lines: allLines,
      impacted_lines: allLines.slice(0, 8).map((line) => ({
        line,
        direction: null,
        impact_type: "schedule_change",
        omitted_stops: [],
        temporary_stops: [],
        replacement_line: null,
        details: headline,
      })),
      stops: pdp.stations || [],
    };
  }

  const content = item.fullContent || item.content || '';
  const headline = cleanIntercityTitle(item.title);
  const timeframe = extractPkpTimeframe(item.pubDate, content);
  const allLines = extractTrainNumbers(`${item.title} ${content}`);

  const lower = content.toLowerCase();
  const titleLower = item.title.toLowerCase();

  const is_emergency =
    lower.includes('opóźnieni') ||
    lower.includes('usterk') ||
    lower.includes('awari') ||
    lower.includes('wypad') ||
    titleLower.includes('opóźnieni');

  const disruption_type =
    lower.includes('usterk') || lower.includes('awari')
      ? 'infrastructure_failure'
      : lower.includes('wypad') || lower.includes('potrąc') || lower.includes('zderzen')
        ? 'accident'
        : lower.includes('prac') || lower.includes('remont')
          ? 'planned_works'
          : lower.includes('pogod') || lower.includes('wichur')
            ? 'weather'
            : 'other';

  const severity =
    lower.includes('odwołan') || lower.includes('zamknięt')
      ? 'blocking'
      : lower.includes('honorowanie biletów') || lower.includes('awari')
        ? 'major'
        : lower.includes('zastępcze składy') || lower.includes('opóźnieni')
          ? 'minor'
          : 'info';

  const is_resolved =
    lower.includes('ruch przywrócon') || lower.includes('awaria usunięt') || lower.includes('zakończon');

  const bulletsIdx = content.indexOf('•');
  let problem = bulletsIdx !== -1 ? content.slice(0, bulletsIdx) : content;
  problem = cleanProblemText(problem);
  if (!problem || problem.length < 10) {
    problem = headline;
  }

  let solution = null;
  if (bulletsIdx !== -1) {
    solution = content.slice(bulletsIdx).trim();
  } else if (lower.includes('honorowanie')) {
    solution = 'Uzgodniono wzajemne honorowanie biletów.';
  }

  return {
    is_transit_alert: true,
    headline,
    disruption_type,
    is_emergency,
    is_resolved,
    severity,
    glance: {
      problem: problem.slice(0, 400),
      solution: solution ? solution.slice(0, 500) : null,
      timeframe,
    },
    valid_from: item.pubDate || new Date().toISOString(),
    valid_to: null,
    all_lines: allLines,
    impacted_lines: allLines.slice(0, 8).map((line) => ({
      line,
      direction: null,
      impact_type: lower.includes('zastępcze składy') ? 'special_service' : 'schedule_change',
      omitted_stops: [],
      temporary_stops: [],
      replacement_line: null,
      details: headline,
    })),
    stops: [],
  };
}

function parsePdpDisruption(d, disruptionTypes = {}, stationsMap = {}) {
  const id = String(d.disruptionId || d.id || crypto.createHash("sha256").update(d.message || "").digest("hex").slice(0, 16));
  const typeName = (d.disruptionTypeCode && disruptionTypes[d.disruptionTypeCode]) || "Utrudnienie w ruchu";
  const startStation = d.startStationId ? stationsMap[String(d.startStationId)] : null;
  const endStation = d.endStationId ? stationsMap[String(d.endStationId)] : null;

  let section = "";
  if (startStation && endStation && startStation !== endStation) {
    section = `${startStation} – ${endStation}`;
  } else if (startStation) {
    section = startStation;
  }

  const message = (d.message || "").trim();
  const headline = section ? `${typeName}: ${section}` : (typeName !== "Utrudnienie w ruchu" ? typeName : (message.split(".")[0] || "Utrudnienie w ruchu"));

  const lines = new Set(extractTrainNumbers(`${headline} ${message}`));

  const lowerType = typeName.toLowerCase();
  const lowerMsg = message.toLowerCase();

  const disruption_type =
    lowerType.includes("sieć") || lowerType.includes("trakc") || lowerType.includes("srk") || lowerType.includes("usterk") || lowerType.includes("awari") || lowerType.includes("tor")
      ? "infrastructure_failure"
      : lowerType.includes("wypad") || lowerType.includes("potrąc") || lowerType.includes("kolizj") || lowerMsg.includes("potrąc")
        ? "accident"
        : lowerType.includes("prac") || lowerType.includes("remont")
          ? "planned_works"
          : lowerType.includes("pogod") || lowerType.includes("wiatr") || lowerType.includes("drzew")
            ? "weather"
            : "other";

  const severity =
    lowerType.includes("wstrzyman") || lowerMsg.includes("wstrzyman") || lowerType.includes("zamknię") || lowerMsg.includes("przerwa w ruchu")
      ? "blocking"
      : lowerType.includes("awari") || lowerType.includes("usterk") || lowerType.includes("wypad") || lowerMsg.includes("honorowanie")
        ? "major"
        : "minor";

  const stations = [startStation, endStation].filter(Boolean);

  return {
    id: `pdp-${id}`,
    title: headline,
    link: "https://portalpasazera.pl/Utrudnienia",
    pubDate: new Date().toISOString(),
    content: message,
    fullContent: message,
    pdpData: {
      headline,
      disruption_type,
      severity,
      message,
      section,
      typeName,
      stations,
      lines: [...lines],
    },
  };
}
// Komunikaty PKP Intercity (opóźnienia, awarie, honorowanie biletów, składy zastępcze).
function parsePkpIntercityList(html, limit) {
  const cardRegex = /<a\s+[^>]*href="([^"]*komunikaty\/[^"]*)"[^>]*>([\s\S]*?)<\/a>/gi;
  const items = [];
  let match;
  while ((match = cardRegex.exec(html)) !== null && items.length < limit) {
    const rawLink = match[1].replace(/^\/?pl\//, '');
    const link = `https://www.intercity.pl/pl/${rawLink}`;
    const block = match[2];
    const titleMatch = block.match(/<h2[^>]*>([\s\S]*?)<\/h2>/i);
    const title = cleanHtml(titleMatch ? (titleMatch[1] || '') : '').replace(/\s+/g, ' ').trim();
    if (!title) continue;

    const dateMatch = block.match(/Aktualizacja:\s*(\d{4}-\d{2}-\d{2})(?:,\s*(\d{2}:\d{2}))?/i) ||
                      title.match(/(\d{4}-\d{2}-\d{2})(?:,\s*(\d{2}:\d{2}))?/);
    const pubDate = dateMatch ? `${dateMatch[1]}T${dateMatch[2] || '00:00'}:00Z` : null;

    items.push({
      id: crypto.createHash('sha256').update(link).digest('hex').slice(0, 16),
      title,
      link,
      pubDate,
      content: title,
    });
  }
  return items;
}

// Lista komunikatów ZTM GZM to serwerowy HTML bez JSON-a i paginacji.
function parseGzmList(html, limit) {
  const cards = html.split(/<div class="panel panel-default">/i).slice(1);
  const items = [];
  for (const card of cards.slice(0, limit)) {
    const linkMatch = card.match(/href="(\/v2\/news\/i\/\d+\/?)"[^>]*>([\s\S]*?)<\/a>/i);
    if (!linkMatch) continue;
    const link = `https://rj.transportgzm.pl${linkMatch[1].trim()}`;
    const title = cleanHtml(linkMatch[2]).replace(/\s+/g, ' ').trim();
    const dateMatch = card.match(
      /(?:Ostatnia aktualizacja|Data obowiązywania od):\s*(\d{1,2})\.(\d{1,2})\.(\d{4})(?:\s+(\d{1,2}:\d{2}))?/,
    );
    const pubDate = dateMatch
      ? `${dateMatch[3]}-${dateMatch[2].padStart(2, '0')}-${dateMatch[1].padStart(2, '0')}T${dateMatch[4] || '00:00'}:00`
      : null;
    const lead = cleanHtml((card.match(/<p class="lead list_lead">([\s\S]*?)<\/p>/i) ?? [])[1] ?? '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 600);
    if (!title) continue;
    items.push({
      id: crypto.createHash('sha256').update(link).digest('hex').slice(0, 16),
      title,
      link,
      pubDate,
      content: lead.slice(0, 3000),
    });
  }
  return items;
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

function isoFromDatetime(raw) {
  if (!raw) return null;
  const d = new Date(raw);
  return isNaN(d.getTime()) ? null : d.toISOString();
}

function isoFromPolishDate(text) {
  const m = String(text ?? '').match(/(\d{1,2})\.(\d{1,2})\.(\d{4})(?:\s+(\d{1,2}):(\d{2}))?/);
  if (!m) return null;
  const d = new Date(
    Date.UTC(Number(m[3]), Number(m[2]) - 1, Number(m[1]), Number(m[4] ?? 8), Number(m[5] ?? 0)),
  );
  return isNaN(d.getTime()) ? null : d.toISOString();
}

// ZTM Kielce: lista Joomla, karty com-content-category-blog__item.
export function parseKielceList(html, limit) {
  const cards = html.split(/com-content-category-blog__item(?!s)/i).slice(1);
  const items = [];
  for (const card of cards.slice(0, limit)) {
    const linkRe = /<a href="(\/aktualnosci\/[^"]+\.html)"[^>]*>([\s\S]*?)<\/a>/gi;
    let href = '';
    let title = '';
    let m;
    while ((m = linkRe.exec(card)) !== null) {
      const text = cleanHtml(m[2]).replace(/\s+/g, ' ').trim();
      if (!text) continue;
      href = m[1].trim();
      title = text;
      break;
    }
    if (!href || !title) continue;
    const datetime = (card.match(/<time datetime="([^"]+)"[^>]*>/i) ?? [])[1] ?? '';
    const afterMeta = card.split(/<\/dl>/i)[1] ?? card;
    const lead = cleanHtml((afterMeta.match(/<p>([\s\S]*?)<\/p>/i) ?? [])[1] ?? '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 600);
    items.push({
      id: crypto.createHash('sha256').update(href).digest('hex').slice(0, 16),
      title,
      link: `https://ztm.kielce.pl${href}`,
      pubDate: isoFromDatetime(datetime),
      content: lead,
    });
  }
  return items;
}

// ZDiTM Szczecin: karty div.card z linkiem stretched-link.
export function parseSzczecinList(html, limit) {
  const cards = html.split(/<div class="card shadow img-hover/i).slice(1);
  const items = [];
  for (const card of cards.slice(0, limit)) {
    const m = card.match(
      /<a href="(https:\/\/www\.zditm\.szczecin\.pl\/pl\/pasazer\/informacje\/[^"]+)"[^>]*class="stretched-link"[^>]*>([\s\S]*?)<\/a>/i,
    );
    if (!m) continue;
    const link = m[1].trim();
    if (/\/archiwum\/?$/.test(link)) continue;
    const title = cleanHtml(m[2]).replace(/\s+/g, ' ').trim();
    if (!title) continue;
    const datetime = (card.match(/<time datetime="([^"]+)"[^>]*>/i) ?? [])[1] ?? '';
    const lead = cleanHtml((card.match(/<p class="card-text[^"]*">([\s\S]*?)<\/p>/i) ?? [])[1] ?? '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 600);
    items.push({
      id: crypto.createHash('sha256').update(link).digest('hex').slice(0, 16),
      title,
      link,
      pubDate: isoFromDatetime(datetime),
      content: lead,
    });
  }
  return items;
}

// MZDiK Radom: karty article.section__article, link względny komunikaty/*.
export function parseRadomList(html, limit) {
  const cards = html.split(/<article class="section__article"/i).slice(1);
  const items = [];
  for (const card of cards.slice(0, limit)) {
    const linkM = card.match(
      /<h3[^>]*class="article__header"[^>]*>[\s\S]*?<a href="(komunikaty\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/i,
    );
    if (!linkM) continue;
    const href = linkM[1].trim();
    const title = cleanHtml(linkM[2]).replace(/\s+/g, ' ').trim();
    if (!title) continue;
    const lead = cleanHtml((card.match(/<div class="article__info">([\s\S]*?)<\/div>/i) ?? [])[1] ?? '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 600);
    items.push({
      id: crypto.createHash('sha256').update(href).digest('hex').slice(0, 16),
      title,
      link: `https://mzdik.pl/${href}`,
      pubDate: isoFromPolishDate(title),
      content: lead,
    });
  }
  return items;
}

// BKM Białystok: li.news__item, pełny tytuł w atrybucie title.
export function parseBialystokList(html, limit) {
  const blocks = html.match(/<li class="news__item">[\s\S]*?<\/li>/gi) ?? [];
  const items = [];
  for (const block of blocks.slice(0, limit)) {
    const linkM = block.match(/<a class="news__title" href="([^"]+)"[^>]*title="([^"]*)"/i);
    if (!linkM) continue;
    const href = linkM[1].trim();
    const link = href.startsWith('http') ? href : `https://komunikacja.bialystok.pl${href}`;
    const title = cleanHtml(linkM[2]).replace(/\s+/g, ' ').trim();
    if (!title) continue;
    const dateRaw = (block.match(/<div class="news__date">([^<]*)/i) ?? [])[1] ?? '';
    const lead = cleanHtml((block.match(/<div class="news__lead">([\s\S]*?)<\/div>/i) ?? [])[1] ?? '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 600);
    items.push({
      id: crypto.createHash('sha256').update(link).digest('hex').slice(0, 16),
      title,
      link,
      pubDate: isoFromPolishDate(dateRaw.trim()),
      content: lead,
    });
  }
  return items;
}

// ZDiTM Lublin: article.news z grupą dnia; karty bez daty dziedziczą poprzednią.
export function parseLublinList(html, limit) {
  const cards = html.split(/<article class="news">/i).slice(1);
  const items = [];
  let lastDate = null;
  for (const card of cards) {
    const dateRaw = (card.match(/<div class="data nowosc[\s\S]*?<h4>([^<]+)<\/h4>/i) ?? [])[1] ?? '';
    const parsedDate = isoFromDatetime(dateRaw.trim());
    if (parsedDate) lastDate = parsedDate;
    const tinies = card.split(/<article class="tiny/i).slice(1);
    const blocks = tinies.length > 0 ? tinies : [card];
    for (const tiny of blocks) {
      if (items.length >= limit) break;
      const linkM = tiny.match(
        /<a href="(\/pl\/aktualnosci\/[^"]+\.html)"[^>]*>(?:(?!<\/a>)[\s\S])*?Zobacz więcej/i,
      );
      if (!linkM) continue;
      const href = linkM[1].trim();
      const title = cleanHtml((tiny.match(/<h3 class="inline">([\s\S]*?)<\/h3>/i) ?? [])[1] ?? '')
        .replace(/\s+/g, ' ')
        .trim();
      if (!title) continue;
      const lead = cleanHtml((tiny.match(/<p[\s>][\s\S]*?<\/p>/i) ?? [])[0] ?? '')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 600);
      items.push({
        id: crypto.createHash('sha256').update(href).digest('hex').slice(0, 16),
        title,
        link: `https://www.zdtm.lublin.eu${href}`,
        pubDate: lastDate,
        content: lead,
      });
    }
  }
  return items.slice(0, limit);
}

const FEED_TIMEOUT_MS = 15000;

// Łódź ma w RSS generyczne tytuły ("Planowane zmiany w rozkładach jazdy").
// Tytuł karty bierzemy wtedy z początku treści, żeby LLM i cache miały
// czym odróżnić komunikaty.
const GENERIC_LODZ_TITLE = /^(planowane|aktualne) zmiany w rozkładach jazdy$/i;

export function lodzReadableTitle(item) {
  if (GENERIC_LODZ_TITLE.test(String(item.title ?? '').trim()) && item.content) {
    const text = String(item.content).replace(/\s+/g, ' ').trim().slice(0, 140);
    return { ...item, title: text || item.title };
  }
  return item;
}

// MPK Łódź serwuje RSS w ISO-8859-2, a fetch.text() dekoduje wszystko jako
// UTF-8 (krzaki zamiast ogonków). TextDecoder, a gdy silnik go nie zna,
// własna tablica Latin-2.
export const LATIN2_HIGH =
  '\u00a0Ą˘Ł¤ĽŚ§¨ŠŞŤŹ\u00adŽŻ°ą˛ł´ľśˇ¸šşťź˝žżŔÁÂĂÄĹĆÇČÉĘËĚÍÎĎĐŃŇÓÔŐÖ×ŘŮÚŰÜÝŢßŕáâăäĺćçčéęëěíîďđńňóôőö÷řůúűüýţ˙';

export function decodeLatin2(buf) {
  try {
    return new TextDecoder('iso-8859-2').decode(buf);
  } catch {
    const bytes = new Uint8Array(buf);
    let out = '';
    for (const byte of bytes) {
      out += byte < 0x80 ? String.fromCharCode(byte) : (LATIN2_HIGH[byte - 0xa0] ?? '');
    }
    return out;
  }
}

// Łódź: XML w Latin-2, więc czytamy ArrayBuffer i dekodujemy sami.
async function fetchFeedLatin2(url, label, headers) {
  const res = await fetch(url, { headers, signal: AbortSignal.timeout(FEED_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${label}`);
  return decodeLatin2(await res.arrayBuffer());
}

// Pobiera feed z limitem czasu. XML/JSON musi wrócić jako dane, nie jako strona
// HTML, bo serwery potrafią oddać 200 z komunikatem błędu zamiast treści.
async function fetchFeed(url, label, headers, expect) {
  const res = await fetch(url, { headers, signal: AbortSignal.timeout(FEED_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${label}`);
  const text = await res.text();
  if (expect !== 'html' && /^\s*(?:<!doctype html|<html)/i.test(text)) {
    throw new Error(`${label}: HTML zamiast ${expect}`);
  }
  if (expect === 'json') {
    try {
      return JSON.parse(text);
    } catch {
      throw new Error(`${label}: niepoprawny JSON`);
    }
  }
  return text;
}

async function fetchCityFeed(city, limit) {
  const browserHeaders = {
    'User-Agent':
      'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
    Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
    'Accept-Language': 'pl-PL,pl;q=0.9,en-US;q=0.8,en;q=0.7',
    'Sec-Ch-Ua': '"Chromium";v="128", "Not;A=Brand";v="24", "Google Chrome";v="128"',
    'Sec-Ch-Ua-Mobile': '?0',
    'Sec-Ch-Ua-Platform': '"Linux"',
    'Sec-Fetch-Dest': 'document',
    'Sec-Fetch-Mode': 'navigate',
    'Sec-Fetch-Site': 'none',
    'Sec-Fetch-User': '?1',
    'Upgrade-Insecure-Requests': '1',
  };

  switch (city) {
    case 'warszawa': {
      const text = await fetchFeed('https://www.wtp.waw.pl/feed/', 'WTP', browserHeaders, 'xml');
      return parseRssItems(text, limit);
    }
    case 'poznan': {
      const text = await fetchFeed('https://www.ztm.poznan.pl/feed/', 'Poznan ZTM', browserHeaders, 'xml');
      return parseRssItems(text, limit);
    }
    case 'trojmiasto':
    case 'gdansk': {
      const data = await fetchFeed('https://files.cloudgdansk.pl/d/otwarte-dane/ztm/znt.json?v=1', 'ZTM Gdansk', undefined, 'json');
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
      const text = await fetchFeed('https://www.wroclaw.pl/komunikacja/rss', 'Wroclaw RSS', browserHeaders, 'xml');
      return parseRssItems(text, limit);
    }
    case 'gzm': {
      const html = await fetchFeed('https://rj.transportgzm.pl/v2/news/', 'ZTM GZM', browserHeaders, 'html');
      return parseGzmList(html, limit);
    }
    case 'krakow': {
      const text = await fetchFeed('https://ztp.krakow.pl/feed?post_type=komunikat', 'Krakow ZTP', browserHeaders, 'xml');
      return parseRssItems(text, limit);
    }
    case 'lodz': {
      // Dwa kanały MPK Łódź (zmiany w rozkładach + utrudnienia), oba
      // w ISO-8859-2. Kanały się dublują: ten sam link = jeden komunikat.
      const [rozklady, utrudnienia] = await Promise.allSettled([
        fetchFeedLatin2('https://mpk.lodz.pl/rozklady/rss/rozklady.jsp', 'Lodz MPK rozklady', browserHeaders),
        fetchFeedLatin2('https://mpk.lodz.pl/showrss.action?c=1211', 'Lodz MPK utrudnienia', browserHeaders),
      ]);
      const all = [
        ...(rozklady.status === 'fulfilled' ? parseRssItems(rozklady.value, limit) : []),
        ...(utrudnienia.status === 'fulfilled' ? parseRssItems(utrudnienia.value, limit) : []),
      ];
      if (all.length === 0) {
        const reason =
          rozklady.status === 'rejected' ? rozklady.reason : utrudnienia.status === 'rejected' ? utrudnienia.reason : null;
        throw reason instanceof Error ? reason : new Error('Lodz MPK: puste kanaly');
      }
      const seen = new Set();
      return all
        .filter((item) => {
          if (seen.has(item.id)) return false;
          seen.add(item.id);
          return true;
        })
        .map(lodzReadableTitle)
        .slice(0, limit);
    }
    case 'szczecin': {
      const html = await fetchFeed(
        'https://www.zditm.szczecin.pl/pl/pasazer/informacje',
        'ZDiTM Szczecin',
        browserHeaders,
        'html',
      );
      return parseSzczecinList(html, limit);
    }
    case 'kielce': {
      const html = await fetchFeed('https://ztm.kielce.pl/aktualnosci.html', 'ZTM Kielce', browserHeaders, 'html');
      return parseKielceList(html, limit);
    }
    case 'bialystok': {
      const html = await fetchFeed(
        'https://komunikacja.bialystok.pl/pl/informacje/wiadomosci/komunikaty/',
        'BKM Bialystok',
        browserHeaders,
        'html',
      );
      return parseBialystokList(html, limit);
    }
    case 'lublin': {
      const html = await fetchFeed('https://www.zdtm.lublin.eu/pl/aktualnosci', 'ZDiTM Lublin', browserHeaders, 'html');
      return parseLublinList(html, limit);
    }
    case 'radom': {
      const html = await fetchFeed('https://mzdik.pl/komunikaty', 'MZDiK Radom', browserHeaders, 'html');
      return parseRadomList(html, limit);
    }
    case 'olsztyn': {
      const text = await fetchFeed('https://zdzit.olsztyn.eu/feed/', 'Olsztyn ZDZiT', browserHeaders, 'xml');
      return parseRssItems(text, limit);
    }
    case 'opole': {
      const text = await fetchFeed('https://www.mzkopole.pl/category/aktualnosci/feed/', 'Opole MZK', browserHeaders, 'xml');
      return parseRssItems(text, limit);
    }
    case 'rzeszow': {
      const text = await fetchFeed('https://ztm.erzeszow.pl/feed/', 'Rzeszow ZTM', browserHeaders, 'xml');
      return parseRssItems(text, limit);
    }
        case 'polska': {
      const items = [];
      const pdpKey = process.env.PDP_API_KEY || "";
      if (pdpKey) {
        try {
          console.log("    [PDP API] Pobieranie oficjalnych utrudnień PKP PLK...");
          const pdpRes = await fetch("https://pdp-api.plk-sa.pl/api/v1/disruptions", {
            headers: {
              "X-API-Key": pdpKey,
              Accept: "application/json",
              "User-Agent": "kilometr-timetable-bot/1.0",
            },
            signal: AbortSignal.timeout(15000),
          });
          if (pdpRes.ok) {
            const data = await pdpRes.json();
            const list = Array.isArray(data.disruptions)
              ? data.disruptions
              : Array.isArray(data.d)
                ? data.d
                : [];
            const types = data.disruptionTypes || {};
            const stations = data.stations || {};
            for (const d of list.slice(0, limit)) {
              items.push(parsePdpDisruption(d, types, stations));
            }
            console.log(`    [PDP API] Pobrano ${items.length} oficjalnych utrudnień.`);
          } else {
            console.warn(`    [!] PDP API zwróciło HTTP ${pdpRes.status}`);
          }
        } catch (err) {
          console.warn("    [!] Błąd pobierania PDP API:", err.message);
        }
      }

      if (items.length < limit) {
        try {
          const html = await fetchFeed(
            "https://www.intercity.pl/pl/site/o-nas/dzial-prasowy/komunikaty/",
            "PKP Intercity Komunikaty",
            browserHeaders,
            "html",
          );
          const icItems = parsePkpIntercityList(html, limit - items.length);
          items.push(...icItems);
        } catch (err) {
          if (items.length === 0) {
            console.warn(`    [!] Intercity 403/błąd (${err.message}) i brak utrudnień z PDP API.`);
            return [];
          } else {
            console.warn(`    [!] Intercity 403/błąd (${err.message}), ale pobrano ${items.length} pozycji z PDP API.`);
          }
        }
      }

      return items;
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
    console.error(`[!] Zostawiam poprzednie ${city}/disruptions.json w R2.`);
    return null;
  }

  if (items.length === 0) {
    console.error(`[!] Pusty feed dla ${city} (0 pozycji).`);
    console.error(`[!] Zostawiam poprzednie ${city}/disruptions.json w R2.`);
    return null;
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

    // Komunikaty PKP nie przechodzą przez model LLM - są dostarczane zwięźle as-is
    if (city === 'polska') {
      const directAnalysis = buildPkpDirectAlert(item);
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
        analysis: directAnalysis,
      };

      const badge = directAnalysis.is_resolved
        ? '[ZAKOŃCZONE]'
        : directAnalysis.is_emergency
          ? '[AWARIA W TOKU]'
          : '[PLANOWANE]';
      console.log(`    [ALERT PKP AS-IS ${badge}] ${directAnalysis.headline}`);
      acceptedAlerts.push({
        id: item.id,
        source_title: item.title,
        link: item.link,
        published_at: item.pubDate,
        ...directAnalysis,
      });
      continue;
    }

    try {
      const sourceText = `${item.title}\n${item.fullContent || item.content || ''}`;
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


  const cache = loadCache();
  const cachedCount = Object.keys(cache.entries).length;
  console.log(`Załadowano cache lokalny: ${cachedCount} wpisów.`);

  const requestedCities =
    CITY_ARG === 'all'
      ? SUPPORTED_CITIES
      : CITY_ARG.split(',').map((city) => city.trim()).filter(Boolean);
  const targetCities = requestedCities.filter((city) => {
    if (SUPPORTED_CITIES.includes(city)) return true;
    console.warn(`[!] Pomijam nieobsługiwane miasto: ${city}`);
    return false;
  });
  if (targetCities.length === 0) {
    console.error('Brak obsługiwanych miast do przetworzenia.');
    process.exit(1);
  }
  console.log(`Miasta: ${targetCities.join(', ')}`);

  const onlyPolska = targetCities.every((c) => c === 'polska');
  if (!API_KEY && !DRY_RUN && !onlyPolska) {
    console.error(`\n[!] Brak klucza API dla providera: ${PROVIDER}.`);
    console.error(`  export DEEPSEEK_API_KEY="sk-..."`);
    process.exit(1);
  }

  let totalAccepted = 0;
  let failedCities = 0;
  for (const city of targetCities) {
    const alerts = await processCity(city, LIMIT, cache);
    if (alerts === null) {
      failedCities++;
      continue;
    }
    totalAccepted += alerts.length;
  }

  if (failedCities > 0) {
    console.warn(`[!] Bez świeżego feedu: ${failedCities}/${targetCities.length} miast, poprzednie pliki zostały w R2.`);
    if (failedCities === targetCities.length) {
      process.exitCode = 1;
    }
  }

  if (!DRY_RUN) {
    saveCache(cache);
    console.log(`\nZaktualizowano stan cache (${Object.keys(cache.entries).length} wpisów).`);
  }

  console.log(`\nZakończono. Łącznie aktywnych/niedawnych alertów: ${totalAccepted}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error('Błąd krytyczny:', err);
    process.exit(1);
  });
}
