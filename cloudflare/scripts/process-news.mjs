#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { findUnknownNames, normalizeName, sanitizeAnalysisText } from './news-validate.mjs';

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
];

const CITY_NAMES = {
  wroclaw: 'Wrocław',
  gzm: 'Górnośląsko-Zagłębiowska Metropolia',
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
};

// Podbij przy każdej zmianie promptu: hash cache zależy od tej wersji.
const PROMPT_VERSION = '2026-11-13.2';

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

/**
 * Rozpoznaje aliasy modelu DeepSeek (DeepSeek V4.1 Flash -> deepseek-flash)
 * i ustawia adaptacyjne poziomy reasoning_effort: low dla prostych komunikatów
 * oraz high dla wieloetapowych objazdów i korekty nazw GTFS.
 */
export function resolveLlmPlan(modelRaw, env = process.env, explicitKey = null) {
  const spec = String(modelRaw || env.LLM_MODEL || 'deepseek-flash').trim().toLowerCase();
  const apiKey = explicitKey || env.DEEPSEEK_API_KEY || '';

  let model = 'deepseek-flash';
  if (spec === 'deepseek-chat' || spec === 'deepseek-v4-pro') {
    model = spec;
  } else if (
    spec === '' ||
    spec === 'auto' ||
    spec === 'deepseek' ||
    spec === 'deepseek-flash' ||
    spec === 'deepseek-v4.1-flash' ||
    spec === 'deepseekv4.1flash' ||
    spec === 'deepseek-v41-flash-1017'
  ) {
    model = 'deepseek-flash';
  }

  return {
    model,
    apiKey,
    fastEffort: 'low',
    deepEffort: 'high',
  };
}

const CITY_ARG = getArg('--city=', 'wroclaw').toLowerCase();
const LIMIT = parseInt(getArg('--limit=', '8'), 10) || 8;
const LLM_PLAN = resolveLlmPlan(
  getArg('--model=', null),
  process.env,
  getArg('--key=', null),
);
const PUBLIC_TIMETABLE_URL = (
  getArg('--timetable-url=', process.env.TIMETABLE_PUBLIC_URL || 'https://data.kilometr.app') || ''
).replace(/\/$/, '');
const NO_GTFS = ARGS.includes('--no-gtfs');
const DRY_RUN = ARGS.includes('--dry-run');
const FORCE_REFRESH = ARGS.includes('--force');

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
    default:
      throw new Error(`Nieobsługiwane miasto: ${city}. Dostępne: ${SUPPORTED_CITIES.join(', ')}`);
  }
}

const SYSTEM_INSTRUCTION = `Jesteś silnikiem analizy operacyjnej i topologicznej dla aplikacji transportu publicznego Kilometr.
Przekształcasz komunikaty zarządców dróg i transportu w precyzyjną, maszynową topologię utrudnień (powiązaną z bazą GTFS) oraz zwięzłe, ludzkie mikro-streszczenia (styl antislop: konkret, zero waty słownej, zero em dash).

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
    "solution": string | null, // Dokładnie 1 zwięzłe zdanie jak podróżować w zamian (np. "Na odcinku Galeria Dominikańska - Księże Małe kursuje autobus za-tramwaj 703."), lub null jeśli brak alternatywy lub ruch przywrócony
    "timeframe": string // Czytelny dla oka opis okresu, np. "Od 31.10 do 02.11", "Od godz. 13:30 (ruch przywrócony o 15:50)"
  },
  "corridor": { // Główny zablokowany/remontowany korytarz (ulica, most, węzeł lub odcinek między dwoma przystankami), lub null gdy zmiana dotyczy np. tylko taryfy albo rozproszonych rozkładów
    "label": string, // Zwięzła nazwa miejsca z treści, np. "ul. Krakowska", "Most Grunwaldzki", "Rondo Mogilskie"
    "from_stop": string | null, // Początkowy przystanek zablokowanego odcinka (w mianowniku, z GTFS lub tekstu), lub null
    "to_stop": string | null // Końcowy przystanek zablokowanego odcinka (w mianowniku, z GTFS lub tekstu), lub null
  } | null,
  "ticket_honoring": { // Wzajemne honorowanie biletów lub ważność biletu w komunikacji zastępczej, lub null gdy tekst nic o tym nie mówi
    "active": boolean,
    "summary": string, // 1 konkretne zdanie z zasadą z tekstu (np. "Bilety okresowe na linię 3 zachowują ważność w autobusie 703 na trasie objazdu.")
    "operators": string[] // Wymienieni przewoźnicy (np. ["MPK", "KD"]), lub []
  } | null,
  "phases": [ // Etapy prac/zmian TYLKO gdy komunikat rozpisuje min. 2 odrębne etapy w czasie (np. Etap I weekendowy, Etap II w tygodniu). W zwykłym komunikacie pusta tablica []
    {
      "label": string, // np. "14-15.11 (sobota-niedziela)"
      "from": string | null, // ISO 8601 jeśli znana data z tekstu, lub null
      "to": string | null,
      "lines": string[], // Linie objęte tym etapem
      "summary": string // 1 krótkie zdanie co obowiązuje w tym etapie
    }
  ],
  "valid_from": string, // Data i czas ISO 8601 od kiedy zmiana obowiązuje (np. "2026-10-31T00:00:00Z"). Jeśli brak, użyj daty publikacji
  "valid_to": string | null, // Data i czas ISO 8601 końca utrudnień lub null ("do odwołania", na stałe lub nieznany)
  "all_lines": string[], // Numery/symbole wszystkich linii zbiorkomu, których dotyczy zmiana (np. ["3", "5"]). Pusta tablica [] jeśli irrelevant
  "line_changes": [ // Rozbicie per-linia. JEDEN KOMUNIKAT MOŻE OPISYWAĆ WIELE LINII Z RÓŻNYMI ZMIANAMI: jedna linia zawieszona, inna na objazdach, jeszcze inna skrócona. Każda linia to osobny wpis z własnym "change".
    {
      "line": string, // np. "3", "Z-15", "E-2"
      "direction": string | null, // Docelowy kierunek w mianowniku, np. "Księże Małe", "Oporów", lub "both", lub null gdy nieznany
      "change": "cancelled" | "detour" | "shortened" | "stops_skipped" | "schedule_change" | "frequency_change" | "route_restored" | "other",
      // cancelled: linia w ogóle nie kursuje (w oknie czasowym)
      // detour: trasa czasowo zmieniona, fragment nowej trasy w "via"
      // shortened: trasa skrócona (odpada część trasy, linia kończy na wcześniejszej pętli)
      // stops_skipped: linia jedzie swoją trasą, ale pomija wybrane przystanki
      // schedule_change: zmiany godzin odjazdów bez zmiany trasy
      // frequency_change: zmiana częstotliwości kursowania
      // route_restored: powrót na stałą trasę po utrudnieniu
      // other: zmiana, która nie pasuje do powyższych (opisz w details)
      "from_stop": string | null, // Ostatni stały przystanek PRZED objazdem lub początek skróconej trasy (w mianowniku, z GTFS lub tekstu), lub null
      "to_stop": string | null, // Pierwszy stały przystanek PO objeździe lub kraniec skróconej trasy (w mianowniku, z GTFS lub tekstu), lub null
      "via": string[] | null, // ZMIENIONY FRAGMENT TRASY W KOLEJNOŚCI JAZDY. Tylko gdy tekst wymienia punkty trasy po kolei (np. "pojedzie przez Dietla, Starowiślną do Poczty Głównej" -> ["Dietla", "Starowiślna", "Poczta Główna"]). Wielokropek w tekście ("Nowy Bieżanów ... Krakowska") oznacza niezmieniony środek: podaj TYLKO wymieniony fragment od pierwszego do ostatniego wymienionego punktu. null gdy tekst nie podaje kolejności.
      "omitted_stops": string[], // Przystanki omijane przez tę linię (w mianowniku, np. ["Plac Zgody", "Krakowska"]). Jeśli w zadaniu podano kanoniczną trasę GTFS linii, a komunikat jednoznacznie wycina odcinek między dwoma przystankami GTFS (from_stop i to_stop), wypisz pominięte przystanki z tego odcinka GTFS. Gdy niejednoznaczne, wpisz tylko przystanki wprost z tekstu.
      "temporary_stops": string[], // Przystanki tymczasowe lub dodatkowe na objeździe (w mianowniku)
      "transfer_stops": string[], // Węzły przesiadkowe na komunikację zastępczą wskazane w tekście (w mianowniku, np. ["Galeria Dominikańska"]), lub []
      "replacement_line": string | null, // Symbol lub opis linii zastępczej jeśli uruchomiono (np. "703" lub "Za-tramwaj 703")
      "hours": { "from": string, "to": string }[], // Okna czasowe w ciągu doby, tylko z tekstu (np. "w godz. 11:45-13:00" -> [{"from":"11:45","to":"13:00"}]). Pusta tablica [] gdy zmiana obowiązuje całą dobę.
      "details": string // 1 zdanie o zmianie tej konkretnej linii
    }
  ],
  "temporary_lines": [ // NOWE linie uruchamiane czasowo (mecz, święta, komunikacja zastępcza), których nie ma w stałym rozkładzie. TYLKO gdy tekst opisuje linię z własną trasą.
    {
      "line": string, // np. "C1", "Z-15", "704"
      "via": string[], // PEŁNA trasa linii w kolejności jazdy z tekstu (np. ["Pleszów", "Klasztorna", "Rynek"]). Bez pełnej listy z tekstu nie twórz wpisu.
      "frequency_min": number | null, // Interwał w minutach TYLKO gdy tekst podaje go liczbowo ("co 10 minut"). null gdy brak.
      "days": string[], // Konkretne daty kursowania ISO "YYYY-MM-DD" tylko z tekstu. Pusta tablica [] gdy linia kursuje w całym okresie valid_from..valid_to.
      "hours": { "from": string, "to": string }[], // Okna czasowe w ciągu doby jak wyżej, [] gdy cała doba.
      "serves": string[], // Numery linii, które ta linia wspomaga/zastępuje, gdy tekst to podaje. [] gdy brak.
      "details": string // 1 zdanie o linii (np. "Dodatkowa linia na mecz, kursuje co 10 minut.")
    }
  ],
  "stops": [ // Lista przystanków, których obsługa uległa zmianie
    {
      "name": string, // ZAWSZE W MIANOWNIKU: "Plac Bema" (nie: "Placu Bema"), "Księże Małe" (nie: "Księża Małego")
      "action": "omitted" | "relocated" | "temporary" | "restored" | "board_opposite" | "replaced_by",
      "lines": string[], // Linie, których dotyczy ta zmiana przystankowa
      "replaced_by": string | null, // Gdy action=replaced_by: przystanek obsługiwany zamiast tego (w mianowniku, z tekstu)
      "details": string // Konkretna wskazówka (np. "Słupek przeniesiony 50m za skrzyżowanie", "Przystanek zawieszony")
    }
  ]
}

ZASADY ANTY-SLOP I JAKOŚCI DANYCH:
1. ZERO WATY SŁOWNEJ I ZERO EM DASH: Bezwzględny zakaz znaku em dash (U+2014) oraz fraz urzędowych typu: "przepraszamy za niedogodności", "nie kursują normalnie", "sprawdź rozkład przed wyjazdem", "decyzją zarządu". Pisz surowe fakty: GDZIE, CO i CZYM JECHAĆ W ZAMIAN. Zamiast pauz używaj dwukropka, przecinka lub osobnego zdania.
2. MIANOWNIK I KANONIZACJA GTFS: Polskie nazwy przystanków zawsze sprowadzaj do formy bazowej ("Galeria Dominikańska", "Rondo Reagana", "Dworzec Główny"). Jeśli w zadaniu podano KONTEKST TOPOLOGII GTFS i przystanek z tekstu odpowiada przystankowi GTFS, użyj dokładnej nazwy z GTFS.
3. LINIE TO WYŁĄCZNIE ZBIORKOM: Nigdy nie dodawaj numerów dróg krajowych (np. DK94, AOW, A8), numerów ustaw, numerów peronów ani roczników.
4. JEŚLI SPAM LUB BEZ WPŁYWU NA ZBIORKOM:
   Ustaw is_transit_alert: false, severity: "info", corridor: null, ticket_honoring: null, phases: [], all_lines: [], line_changes: [], temporary_lines: [], stops: [], glance.problem: "Informacja nieoperacyjna: [powód odrzucenia]".
5. KOPIUJ, NIE TWÓRZ: nazwy ulic, placów, dzielnic, osiedli, mostów i przystanków przepisujesz z treści lub z przekazanego kontekstu GTFS tych linii. Zero tłumaczenia i zero zmyślonych form fleksyjnych (nigdy "Krzków", "Włochów").
6. ZERO NOWEJ GEOGRAFII: nie dodawaj miejsc spoza treści i spoza podanego w zadaniu wycinka GTFS. Nie zgaduj dzielnicy z nazwy ulicy.
7. FORMA Z TREŚCI W PROZIE: w polach opisowych (headline, glance, details) używaj naturalnych konstrukcji ("w dzielnicy Krzyki", "w rejonie ul. Krakowskiej", "na trasie do Włoch").
8. MIASTO: komunikat dotyczy wyłącznie miasta podanego w zadaniu. Nie używaj dzielnic ani miejsc z innych miast.
9. SAMOKONTROLA: przed odpowiedzią sprawdź każdą nazwę własną. Musi pochodzić z treści źródłowej lub z podanej sekwencji przystanków GTFS zmienianych linii.
10. JEDEN KOMUNIKAT, WIELE ZMIAN: gdy tekst wymienia linie zawieszone, linie na objazdach i linie bez zmian, zapisz w line_changes wyłącznie linie ze zmianami (cancelled, detour, shortened, stops_skipped, schedule_change, frequency_change, route_restored). Linie "bez zmian" pomijasz.
11. NIGDY NIE DOPISUJ FAKTÓW: nie wymyślaj linii, godzin, dat, honorowania biletów ani częstotliwości spoza tekstu. Gdy tekst nie podaje kolejności objazdu, via = null.
12. GODZINY I DATY TYLKO Z TEKSTU: hours wpisuj wyłącznie z konkretnych godzin w treści. Gdy tekst podaje tylko "wieczorem" albo "w nocy", zostaw hours: [] i wpisz zakres w details lub glance.timeframe.

PRZYKŁADY POPRAWNEJ FORMY NAZW:
- Treść: "utrudnienia w rejonie Krzyki" -> "Utrudnienia w dzielnicy Krzyki" (nie "Krzków").
- Treść: "objazd przez Włochy" -> "Objazd przez Włochy" (nie "Włochów").
PRZYKŁADY ROZBICIA NA LINIE:
- Treść: "linie 2, 4, 6 są zawieszone; linia 13 kursuje po trasie czasowo zmienionej: Nowy Bieżanów P+R - ... - Krakowska - Dietla - Starowiślna - Poczta Główna" ->
  line_changes: [{"line":"2","change":"cancelled",...}, {"line":"4","change":"cancelled",...}, {"line":"6","change":"cancelled",...}, {"line":"13","change":"detour","from_stop":"Krakowska","to_stop":"Poczta Główna","via":["Krakowska","Dietla","Starowiślna","Poczta Główna"],...}]
- Treść: "uruchomiona zostanie dodatkowa linia C1 kursująca co 10 minut na trasie Pleszów - Rynek - Plac Centralny" ->
  temporary_lines: [{"line":"C1","via":["Pleszów","Rynek","Plac Centralny"],"frequency_min":10,...}]`;

// ────────────────────────────────────────────────────────────────────────────
// Kontekst GTFS miasta z R2 (node:sqlite): kanoniczne przystanki i trasy linii
// ────────────────────────────────────────────────────────────────────────────

const gtfsIndexCache = new Map();

function loadGtfsIndexFromSqlite(dbPath) {
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    const routesRows = db.prepare('SELECT route_id, short, type FROM routes').all();
    const stopsRows = db.prepare('SELECT stop_id, name, lat, lon FROM stops').all();

    const stopsById = new Map();
    const stopsByNorm = new Map();
    for (const st of stopsRows) {
      stopsById.set(st.stop_id, {
        id: st.stop_id,
        name: st.name,
        lat: Number(st.lat),
        lon: Number(st.lon),
      });
      const norm = normalizeName(st.name);
      if (norm && !stopsByNorm.has(norm)) {
        stopsByNorm.set(norm, {
          id: st.stop_id,
          name: st.name,
          lat: Number(st.lat),
          lon: Number(st.lon),
        });
      }
    }

    // Dla każdego route_id bierzemy reprezentatywny kurs o najdłuższej sekwencji przystanków.
    const repTripStmt = db.prepare(`
      SELECT t.trip_id, t.headsign, COUNT(st.seq) AS cnt
      FROM trips t
      JOIN stop_times st ON st.trip_id = t.trip_id
      WHERE t.route_id = ?
      GROUP BY t.trip_id
      ORDER BY cnt DESC
      LIMIT 1
    `);
    const seqStmt = db.prepare(`
      SELECT stop_id FROM stop_times WHERE trip_id = ? ORDER BY seq ASC
    `);

    const byLine = new Map();
    for (const r of routesRows) {
      const short = String(r.short || '').trim().toUpperCase();
      if (!short) continue;
      const rep = repTripStmt.get(r.route_id);
      if (!rep?.trip_id) continue;
      const seqRows = seqStmt.all(rep.trip_id);
      const stopNames = [];
      const seen = new Set();
      for (const row of seqRows) {
        const stop = stopsById.get(row.stop_id);
        if (stop?.name && !seen.has(stop.name)) {
          seen.add(stop.name);
          stopNames.push(stop.name);
        }
      }
      if (stopNames.length === 0) continue;
      const existing = byLine.get(short);
      if (!existing || stopNames.length > existing.stops.length) {
        byLine.set(short, {
          line: short,
          routeId: r.route_id,
          type: Number(r.type),
          headsign: rep.headsign || stopNames[stopNames.length - 1] || '',
          stops: stopNames,
        });
      }
    }

    return { byLine, stopsById, stopsByNorm };
  } finally {
    db.close();
  }
}

async function getCityGtfsIndex(city) {
  if (NO_GTFS) return null;
  if (gtfsIndexCache.has(city)) return gtfsIndexCache.get(city);

  const localBuilt = path.join(DIST_DIR, city, 'kilometr-gtfs.db');
  if (fs.existsSync(localBuilt)) {
    try {
      const idx = loadGtfsIndexFromSqlite(localBuilt);
      gtfsIndexCache.set(city, idx);
      return idx;
    } catch (err) {
      console.warn(`    [GTFS] Nie udało się otworzyć lokalnej bazy ${localBuilt}: ${err.message}`);
    }
  }

  if (!PUBLIC_TIMETABLE_URL) {
    gtfsIndexCache.set(city, null);
    return null;
  }

  const tmpDbPath = path.join(os.tmpdir(), `kilometr-disruptions-${city}.db`);
  try {
    if (!fs.existsSync(tmpDbPath) || Date.now() - fs.statSync(tmpDbPath).mtimeMs > 6 * 3600 * 1000) {
      const gzUrl = `${PUBLIC_TIMETABLE_URL}/${city}/db/kilometr-gtfs.db.gz`;
      const res = await fetch(gzUrl, { signal: AbortSignal.timeout(25000) });
      if (!res.ok) {
        gtfsIndexCache.set(city, null);
        return null;
      }
      const gzBuf = Buffer.from(await res.arrayBuffer());
      const rawDb = zlib.gunzipSync(gzBuf);
      fs.writeFileSync(tmpDbPath, rawDb);
    }
    const idx = loadGtfsIndexFromSqlite(tmpDbPath);
    console.log(
      `    [GTFS] Załadowano topologię ${city}: ${idx.byLine.size} linii, ${idx.stopsByNorm.size} unikalnych przystanków.`,
    );
    gtfsIndexCache.set(city, idx);
    return idx;
  } catch (err) {
    console.warn(`    [GTFS] Pomijam kontekst GTFS dla ${city}: ${err.message}`);
    gtfsIndexCache.set(city, null);
    return null;
  }
}

const CANDIDATE_LINE_RE = /\b(?:[A-ZĄĆĘŁŃÓŚŹŻ]{1,3}-?\d{1,3}|\d{1,3}[A-Z]?|[A-Z]\d?)\b/gi;

export function extractCandidateLinesFromText(text, gtfsIndex) {
  if (!text || !gtfsIndex?.byLine) return [];
  const found = new Set();
  for (const m of String(text).matchAll(CANDIDATE_LINE_RE)) {
    const token = m[0].toUpperCase();
    if (gtfsIndex.byLine.has(token)) {
      found.add(token);
    }
  }
  return [...found];
}

export function buildGtfsPromptContext(item, gtfsIndex) {
  if (!gtfsIndex) return { promptBlock: '', allowedStops: null, matchedLines: [] };
  const text = `${item.title || ''}\n${item.fullContent || item.content || ''}`;
  const matchedLines = extractCandidateLinesFromText(text, gtfsIndex).slice(0, 10);
  if (matchedLines.length === 0) {
    return { promptBlock: '', allowedStops: null, matchedLines: [] };
  }

  const allowedStops = new Set();
  const linesDesc = [];
  for (const line of matchedLines) {
    const entry = gtfsIndex.byLine.get(line);
    if (!entry) continue;
    for (const st of entry.stops) {
      allowedStops.add(normalizeName(st));
    }
    const previewStops =
      entry.stops.length > 42
        ? [...entry.stops.slice(0, 20), '...', ...entry.stops.slice(-20)]
        : entry.stops;
    linesDesc.push(`- Linia ${line}: ${previewStops.join(' -> ')}`);
  }

  if (linesDesc.length === 0) {
    return { promptBlock: '', allowedStops: null, matchedLines: [] };
  }

  const promptBlock = `\n\nKONTEKST TOPOLOGII GTFS MIASTA (kanoniczne nazwy przystanków w kolejności jazdy):
${linesDesc.join('\n')}
Używaj tych dokładnych nazw przystanków w polach stops, omitted_stops, via, from_stop i to_stop, jeśli odpowiadają miejscom z komunikatu.`;

  return { promptBlock, allowedStops, matchedLines };
}

/**
 * Heurystyka złożoności komunikatu: decyduje, czy DeepSeek V4.1 Flash
 * powinien analizować komunikat z reasoning_effort: 'high' zamiast 'low'.
 */
export function isComplexDisruptionText(title, content, matchedLinesCount = 0) {
  const full = `${title || ''}\n${content || ''}`;
  if (full.length > 2200) return true;
  if (matchedLinesCount >= 5) return true;
  const lower = full.toLowerCase();
  if (/\betap\s+(i|ii|iii|1|2|3)\b/i.test(full)) return true;
  const detourMentions = (lower.match(/objazd|tras[aąę]\s+zmienion|skrócon|zawieszon/g) || []).length;
  return detourMentions >= 4;
}

export function needsEscalationAfterPrimary(analysis, sourceText) {
  if (!analysis || analysis.is_transit_alert === false) return false;
  const allLinesCount = Array.isArray(analysis.all_lines) ? analysis.all_lines.length : 0;
  const lineChangesCount = Array.isArray(analysis.line_changes) ? analysis.line_changes.length : 0;
  const lower = String(sourceText || '').toLowerCase();
  const mentionsChanges = /objazd|zawieszon|skrócon|zmienia\s+tras|zastępcz/.test(lower);
  if (allLinesCount >= 3 && lineChangesCount === 0 && mentionsChanges) {
    return true;
  }
  return false;
}

/**
 * Wzbogaca przeanalizowany alert o kanoniczne stop_id i współrzędne z GTFS
 * oraz uzupełnia brakujące pomijane przystanki z wyciętego odcinka linii,
 * jeśli model podał jednoznaczne granice from_stop i to_stop na trasie GTFS.
 */
export function enrichAlertWithGtfs(analysis, gtfsIndex) {
  if (!analysis || analysis.is_transit_alert === false || !gtfsIndex) return analysis;

  const resolveStop = (rawName) => {
    if (!rawName || rawName === 'both') return null;
    const norm = normalizeName(rawName);
    return gtfsIndex.stopsByNorm.get(norm) || null;
  };

  const coordMap = {};
  const rememberCoord = (stopObj) => {
    if (!stopObj || !Number.isFinite(stopObj.lat) || !Number.isFinite(stopObj.lon)) return;
    coordMap[stopObj.name] = {
      stop_id: stopObj.id,
      lat: Math.round(stopObj.lat * 1e5) / 1e5,
      lon: Math.round(stopObj.lon * 1e5) / 1e5,
    };
  };

  if (analysis.corridor) {
    const f = resolveStop(analysis.corridor.from_stop);
    const t = resolveStop(analysis.corridor.to_stop);
    if (f) {
      analysis.corridor.from_stop = f.name;
      rememberCoord(f);
    }
    if (t) {
      analysis.corridor.to_stop = t.name;
      rememberCoord(t);
    }
  }

  for (const lc of analysis.line_changes || []) {
    const f = resolveStop(lc.from_stop);
    const t = resolveStop(lc.to_stop);
    if (f) {
      lc.from_stop = f.name;
      rememberCoord(f);
    }
    if (t) {
      lc.to_stop = t.name;
      rememberCoord(t);
    }

    if (Array.isArray(lc.via)) {
      lc.via = lc.via.map((v) => {
        const hit = resolveStop(v);
        if (hit) rememberCoord(hit);
        return hit ? hit.name : v;
      });
    }
    if (Array.isArray(lc.omitted_stops)) {
      lc.omitted_stops = lc.omitted_stops.map((v) => {
        const hit = resolveStop(v);
        if (hit) rememberCoord(hit);
        return hit ? hit.name : v;
      });
    }
    if (Array.isArray(lc.temporary_stops)) {
      lc.temporary_stops = lc.temporary_stops.map((v) => {
        const hit = resolveStop(v);
        if (hit) rememberCoord(hit);
        return hit ? hit.name : v;
      });
    }
    if (Array.isArray(lc.transfer_stops)) {
      lc.transfer_stops = lc.transfer_stops.map((v) => {
        const hit = resolveStop(v);
        if (hit) rememberCoord(hit);
        return hit ? hit.name : v;
      });
    }

    // Jeśli to objazd między dwoma przystankami GTFS tej linii, a omitted_stops jest puste,
    // wyliczamy pominięte przystanki z kanonicznej sekwencji GTFS (maks. 12 przystanków).
    if (
      lc.change === 'detour' &&
      (!lc.omitted_stops || lc.omitted_stops.length === 0) &&
      lc.from_stop &&
      lc.to_stop
    ) {
      const lineEntry = gtfsIndex.byLine.get(String(lc.line || '').trim().toUpperCase());
      if (lineEntry) {
        const idxA = lineEntry.stops.indexOf(lc.from_stop);
        const idxB = lineEntry.stops.indexOf(lc.to_stop);
        if (idxA !== -1 && idxB !== -1 && Math.abs(idxB - idxA) > 1 && Math.abs(idxB - idxA) <= 13) {
          const lo = Math.min(idxA, idxB);
          const hi = Math.max(idxA, idxB);
          const viaSet = new Set((lc.via || []).map((x) => normalizeName(x)));
          const between = lineEntry.stops
            .slice(lo + 1, hi)
            .filter((stName) => !viaSet.has(normalizeName(stName)));
          if (between.length > 0) {
            lc.omitted_stops = between;
            for (const stName of between) {
              const hit = resolveStop(stName);
              if (hit) rememberCoord(hit);
            }
          }
        }
      }
    }
  }

  for (const tl of analysis.temporary_lines || []) {
    if (Array.isArray(tl.via)) {
      tl.via = tl.via.map((v) => {
        const hit = resolveStop(v);
        if (hit) rememberCoord(hit);
        return hit ? hit.name : v;
      });
    }
  }

  for (const st of analysis.stops || []) {
    const hit = resolveStop(st.name);
    if (hit) {
      st.name = hit.name;
      rememberCoord(hit);
    }
    const rep = resolveStop(st.replaced_by);
    if (rep) {
      st.replaced_by = rep.name;
      rememberCoord(rep);
    }
  }

  if (Object.keys(coordMap).length > 0) {
    analysis.stop_coords = coordMap;
  }

  return analysis;
}

function buildPrompt(item, city, gtfsPromptBlock = '', correction = []) {
  const cityName = CITY_NAMES[city] || city;
  const base = `Przeanalizuj komunikat miejski (${cityName}):
Tytuł: ${item.title}
Data publikacji: ${item.pubDate || 'brak'}
Link: ${item.link}

Treść komunikatu:
${item.fullContent || item.content || item.title}${gtfsPromptBlock}`;
  if (correction.length === 0) return base;
  return `${base}

POPRAWA NAZW WŁASNYCH:
Te nazwy nie występują w treści źródłowej ani w trasie GTFS zmienianych linii: ${correction.map((name) => `"${name}"`).join(', ')}.
Przepisz cały JSON. Każdą nazwę własną skopiuj dokładnie z treści komunikatu lub z podanej wyżej listy przystanków GTFS albo usuń zdanie z tą nazwą. Nie twórz nowych form.`;
}

async function callDeepSeek(
  item,
  city,
  apiKey,
  model,
  gtfsPromptBlock = '',
  correction = [],
  effort = 'low',
  maxRetries = 3,
) {
  const prompt = buildPrompt(item, city, gtfsPromptBlock, correction);
  const resolvedModel = model || 'deepseek-flash';
  const url = 'https://api.deepseek.com/chat/completions';

  const body = {
    model: resolvedModel,
    messages: [
      { role: 'system', content: SYSTEM_INSTRUCTION },
      { role: 'user', content: prompt },
    ],
    response_format: { type: 'json_object' },
  };

  if (resolvedModel === 'deepseek-flash' || resolvedModel.startsWith('deepseek-v4')) {
    if (effort === 'none') {
      body.thinking = { type: 'disabled' };
      body.temperature = 0.1;
    } else {
      body.reasoning_effort = effort === 'medium' ? 'high' : effort;
    }
  } else {
    body.temperature = 0.1;
  }

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
        console.warn(`[!] Błąd sieci DeepSeek: ${netErr.message}. Ponawiam (${attempt}/${maxRetries}) za ${delay}ms...`);
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
    if (!rawContent || !rawContent.trim()) throw new Error('Brak treści JSON w odpowiedzi DeepSeek');

    const parsed = JSON.parse(rawContent);
    return {
      parsed,
      modelUsed: `${resolvedModel}(${effort})`,
      usage: json.usage || null,
      durationMs,
    };
  }
}

async function analyzeWithDeepSeek(item, city, gtfsCtx) {
  const sourceText = `${item.title}\n${item.fullContent || item.content || ''}`;
  const complex = isComplexDisruptionText(
    item.title,
    item.fullContent || item.content || '',
    gtfsCtx.matchedLines.length,
  );

  const initialEffort = complex ? LLM_PLAN.deepEffort : LLM_PLAN.fastEffort;
  let result = await callDeepSeek(
    item,
    city,
    LLM_PLAN.apiKey,
    LLM_PLAN.model,
    gtfsCtx.promptBlock,
    [],
    initialEffort,
  );

  // Jeśli szybki przebieg (low) zgubił rozbicie line_changes na wielu liniach,
  // ponawiamy z głębokim rozumowaniem (high).
  if (initialEffort !== LLM_PLAN.deepEffort && needsEscalationAfterPrimary(result.parsed, sourceText)) {
    console.log(`    [~] Eskalacja złożonej topologii do ${LLM_PLAN.model} (effort: ${LLM_PLAN.deepEffort})...`);
    try {
      result = await callDeepSeek(
        item,
        city,
        LLM_PLAN.apiKey,
        LLM_PLAN.model,
        gtfsCtx.promptBlock,
        [],
        LLM_PLAN.deepEffort,
      );
    } catch (escErr) {
      console.warn(`    [!] Eskalacja nieudana (${escErr.message}), zostaję przy pierwszym wyniku.`);
    }
  }

  let analysis = sanitizeAnalysisText(result.parsed);

  if (analysis.is_transit_alert !== false) {
    const unknown = findUnknownNames(analysis, sourceText, gtfsCtx.allowedStops);
    if (unknown.length > 0) {
      console.log(`    [!] Nazwy poza treścią/GTFS: ${unknown.join(', ')}. Korekta (${LLM_PLAN.model} high)...`);
      result = await callDeepSeek(
        item,
        city,
        LLM_PLAN.apiKey,
        LLM_PLAN.model,
        gtfsCtx.promptBlock,
        unknown,
        LLM_PLAN.deepEffort,
      );
      analysis = sanitizeAnalysisText(result.parsed);
      const still = findUnknownNames(analysis, sourceText, gtfsCtx.allowedStops);
      if (still.length > 0) {
        return { rejectedReason: `nazwy nadal poza treścią: ${still.join(', ')}` };
      }
    }
    analysis = enrichAlertWithGtfs(analysis, gtfsCtx.gtfsIndex);
  }

  return {
    analysis,
    modelUsed: result.modelUsed,
    durationMs: result.durationMs,
  };
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

function isExpiredResolvedAlert(analysis, nowMs = Date.now()) {
  if (!analysis) return false;
  if (analysis.valid_to) {
    const endMs = new Date(analysis.valid_to).getTime();
    if (!Number.isNaN(endMs) && nowMs - endMs > 12 * 3600 * 1000) {
      return true;
    }
  }
  return false;
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

  const gtfsIndex = !DRY_RUN ? await getCityGtfsIndex(city) : null;
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
      console.log(`    [CACHE HIT] (hash: ${contentHash}): pomijam wywołanie LLM`);
      if (cached.analysis?.is_transit_alert && !isExpiredResolvedAlert(cached.analysis)) {
        const enrichedCached = gtfsIndex
          ? enrichAlertWithGtfs(sanitizeAnalysisText({ ...cached.analysis }), gtfsIndex)
          : sanitizeAnalysisText({ ...cached.analysis });
        acceptedAlerts.push({
          id: item.id,
          source_title: item.title,
          link: item.link,
          published_at: item.pubDate,
          ...enrichedCached,
        });
      }
      continue;
    }

    if (DRY_RUN) {
      console.log(`    [DRY-RUN] Nowy komunikat (hash: ${contentHash}). Gotowy do analizy.`);
      const preview = (item.fullContent || item.content || '').replace(/\s+/g, ' ').trim().slice(0, 600);
      console.log(`      TREŚĆ: ${preview}`);
      continue;
    }

    try {
      const gtfsCtx = {
        ...buildGtfsPromptContext(item, gtfsIndex),
        gtfsIndex,
      };
      const outcome = await analyzeWithDeepSeek(item, city, gtfsCtx);
      if (outcome.rejectedReason) {
        console.log(`    [ODRZUCONY]: ${outcome.rejectedReason}`);
        continue;
      }

      const { analysis, modelUsed, durationMs } = outcome;

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
        console.log(`    [ODRZUCONY PRZEZ MODEL ${modelUsed}]: ${analysis.glance?.problem || 'Nie dotyczy zbiorkomu'}`);
      } else if (isExpiredResolvedAlert(analysis)) {
        console.log(`    [POMINIĘTY WYGASŁY]: ${analysis.headline}`);
      } else {
        const badge = analysis.is_resolved
          ? '[ZAKOŃCZONE]'
          : analysis.is_emergency
            ? '[AWARIA W TOKU]'
            : '[PLANOWANE]';
        console.log(`    [NOWY ALERT ${badge}] ${analysis.headline} (${modelUsed}, ${durationMs}ms)`);
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
    schema_version: 2,
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
  console.log(`=== Kilometr: Agregator i Silnik Topologii Utrudnień ===`);
  console.log(
    `Model: ${LLM_PLAN.model} (adaptacyjny effort: ${LLM_PLAN.fastEffort}/${LLM_PLAN.deepEffort}) | Limit: ${LIMIT}`,
  );

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

  if (!LLM_PLAN.apiKey && !DRY_RUN) {
    console.error(`\n[!] Brak klucza DEEPSEEK_API_KEY.`);
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
