// Czytnik aktualności per-miasto (bez dodatkowych zależności).
// - Wrocław: RSS wroclaw.pl/komunikacja (miasto) + HTML mpk.wroc.pl (zmiany),
// - Kraków: RSS ZTP (komunikaty KMK, ?post_type=komunikat).
// Nowe miasto = wpis w FEEDS + ewentualny parser; UI (news.tsx) bez zmian.
import { withTimeout } from './net';
import { kvGet, kvSet } from './storage';
import { getCity, type CityId } from '../cities';
import { getActiveCityIdSync } from './cityStore';
import { getLocaleSync, type Strings } from '../i18n';
import { pl } from '../i18n/pl';
import { en } from '../i18n/en';
import { de } from '../i18n/de';
import { uk } from '../i18n/uk';

const NEWS_SVC_DICTS: Record<string, Strings> = { pl, en, de, uk };

function newsTitleFallback(): string {
  return (NEWS_SVC_DICTS[getLocaleSync()] ?? pl).newsSvc.untitled;
}

export type NewsSource = 'city' | 'mpk';

export type MpkNewsItem = {
  id: string;
  title: string;
  link: string;
  description: string;
  imageUrl: string | null;
  urgent: boolean;
  pubDate: number | null;
  dateLabel: string;
  source: NewsSource;
  lines: string[];
};

export type ArticleBlock = { kind: 'h' | 'p'; text: string };

export const MPK_NEWS_URL = 'https://www.wroclaw.pl/komunikacja/rss';
export const MPK_CHANGES_URL =
  'https://mpk.wroc.pl/strefa-pasazera/zaplanuj-podroz/zmiany-w-komunikacji';
/**
 * Komunikaty KMK (ZTP Kraków). Lista HTML (tytuł + link + linie + termin
 * wprost na karcie) + awaryjny RSS WordPressa (?post_type=komunikat, same
 * tytuły bez linii).
 */
export const ZTP_KOMUNIKATY_URL = 'https://ztp.krakow.pl/kmk/komunikaty';
export const ZTP_KOMUNIKATY_RSS = 'https://ztp.krakow.pl/feed?post_type=komunikat';

/** RSS bywa wolny; po 12 s uznajemy pobieranie za nieudane, żeby ekran nie wisiał. */
const NEWS_TIMEOUT_MS = 12000;

function tagInner(xml: string, tag: string): string {
  const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i');
  const m = xml.match(re);
  return m ? m[1].trim() : '';
}

function stripCdata(s: string): string {
  return s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').trim();
}

const ENTITIES: Record<string, string> = {
  '&quot;': '"',
  '&#34;': '"',
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&nbsp;': ' ',
  '&apos;': "'",
  '&#39;': "'",
};

const NAMED: Record<string, string> = {
  oacute: 'ó', Oacute: 'Ó', aacute: 'á', Aacute: 'Á',
  eacute: 'é', Eacute: 'É', iacute: 'í', Iacute: 'Í',
  uacute: 'ú', Uacute: 'Ú', yacute: 'ý',
  sacute: 'ś', Sacute: 'Ś', cacute: 'ć', Cacute: 'Ć',
  nacute: 'ń', Nacute: 'Ń', zacute: 'ź', Zacute: 'Ź',
  lstrok: 'ł', Lstrok: 'Ł', zdot: 'ż', Zdot: 'Ż',
  ndash: '\u2013', mdash: '\u2014', hellip: '…',
  laquo: '«', raquo: '»', bdquo: '„', ldquo: '“', rdquo: '”',
  lsquo: '‘', rsquo: '’',
};

function decodeEntities(s: string): string {
  let out = s;
  for (const [k, v] of Object.entries(ENTITIES)) out = out.split(k).join(v);
  out = out.replace(/&#x([0-9a-f]+);/gi, (_, n) => {
    const code = parseInt(n, 16);
    return Number.isFinite(code) ? String.fromCharCode(code) : '';
  });
  out = out.replace(/&#(\d+);/g, (_, n) => {
    const code = parseInt(n, 10);
    return Number.isFinite(code) ? String.fromCharCode(code) : '';
  });
  out = out.replace(/&([a-zA-Z]+);/g, (all, name: string) => NAMED[name] ?? all);
  return out;
}

function extractImage(html: string): string | null {
  const m = html.match(/<img[^>]+src=["']([^"']+)["']/i);
  if (!m) return null;
  return decodeEntities(m[1]).replace(/&amp;/g, '&').trim() || null;
}

// Pilne = utrudnienia / wypadki / wykolejenia — to user chce sprawdzać najszybciej.
const URGENT_RE =
  /(wykolej|wypadek|kolizj|zderzenie|utrudnien|objazd|awari|przerwa w ruchu|wstrzyman|zablokowan|korek|zamknię)/i;

/** RSS miasta miesza loty i PR z komunikacją — zostawiamy tylko treść dla pasażera. */
const TRANSIT_RE =
  /(mpk|tramwaj|autobus|linia\b|przystank|bilet|komunikacj|utrudnien|objazd|torowisk|kasownik|rozkład|przejazd|kursowan|zajezdn|pantograf|wykolej|agglomeracyj|międzymiast|aglo)/i;

export function isUrgentNews(title: string, description: string): boolean {
  return URGENT_RE.test(`${title} ${description}`);
}

export function isTransitNews(title: string, description: string): boolean {
  return TRANSIT_RE.test(`${title} ${description}`);
}

/** Daty z mpk.wroc.pl i ogonki typu „| ZDJĘCIA, AKTUALIZACJA” z portalu miasta. */
export function cleanNewsTitle(title: string): string {
  const cleaned = title
    .replace(/^\d{1,2}\.\d{1,2}\.\d{4}\s*r\.?\s*[-–—:]\s*/i, '')
    .replace(/^\d{1,2}\.\d{1,2}\.\d{4}\s*[-–—:]\s*/i, '')
    .split('|')[0]
    .trim();
  if (!cleaned) return cleaned;
  return cleaned.charAt(0).toLocaleUpperCase('pl') + cleaned.slice(1);
}

function htmlToText(html: string): string {
  const noImg = html.replace(/<img[^>]*>/gi, ' ');
  const noTags = noImg.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, ' ');
  return decodeEntities(noTags)
    .replace(/\r/g, '')
    .replace(/[ \t]*\n[ \t]*/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

export function formatNewsDate(ts: number | null): string {
  if (!ts) return '';
  const t = NEWS_SVC_DICTS[getLocaleSync()].newsSvc;
  const d = new Date(ts);
  const now = Date.now();
  const diffMin = Math.max(0, Math.round((now - ts) / 60000));
  if (diffMin < 60) return diffMin <= 1 ? t.justNow : t.minsAgo(diffMin);
  const diffH = Math.round(diffMin / 60);
  if (diffH < 24) return t.hoursAgo(diffH);
  const diffD = Math.round(diffH / 24);
  if (diffD === 1) return t.yesterday;
  if (diffD < 7) return t.daysAgo(diffD);
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  return `${dd}.${mm}.${d.getFullYear()}`;
}

export function parseMpkRss(xml: string): MpkNewsItem[] {
  const items: MpkNewsItem[] = [];
  const blocks = xml.match(/<item[\s\S]*?<\/item>/gi) ?? [];
  for (const b of blocks) {
    const rawTitle = decodeEntities(stripCdata(tagInner(b, 'title'))).replace(/\s+/g, ' ').trim();
    const title = cleanNewsTitle(rawTitle);
    const link = stripCdata(tagInner(b, 'link')).trim();
    const rawDesc = stripCdata(tagInner(b, 'description'));
    const description = htmlToText(rawDesc);
    const imageUrl = extractImage(rawDesc);
    const pubRaw = stripCdata(tagInner(b, 'pubDate')).trim();
    const ts = pubRaw ? Date.parse(pubRaw) : NaN;
    const pubDate = Number.isFinite(ts) ? ts : null;
    if (!rawTitle && !link) continue;
    if (!isTransitNews(rawTitle, description)) continue;
    items.push({
      id: link || rawTitle,
      title: title || newsTitleFallback(),
      link,
      description,
      imageUrl,
      urgent: isUrgentNews(rawTitle, description),
      pubDate,
      dateLabel: formatNewsDate(pubDate),
      source: 'city',
      lines: [],
    });
  }
  return items;
}

function parsePlDate(raw: string): number | null {
  const m = raw.trim().match(/(\d{1,2})\.(\d{1,2})\.(\d{4})/);
  if (!m) return null;
  const ts = new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]), 8, 0, 0).getTime();
  return Number.isFinite(ts) ? ts : null;
}

/** Komunikaty operacyjne z serwisu pasażera MPK (lista „zmiany w komunikacji”). */
export function parseMpkChanges(html: string): MpkNewsItem[] {
  const cards = html.split(/class="message__card"/i).slice(1);
  const items: MpkNewsItem[] = [];
  for (const card of cards) {
    const linkM = card.match(
      /href="(https:\/\/mpk\.wroc\.pl\/komunikat\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/i,
    );
    if (!linkM) continue;
    const link = decodeEntities(linkM[1]).trim();
    const rawTitle = htmlToText(linkM[2]).replace(/\s+/g, ' ').trim();
    const title = cleanNewsTitle(rawTitle);
    const lines = [...card.matchAll(/class="message__number">([^<]+)/gi)].map((m) =>
      decodeEntities(m[1]).trim(),
    );
    const range = decodeEntities((card.match(/class="date__value">([^<]+)/i) ?? [])[1] ?? '').trim();
    const pubDate = range ? parsePlDate(range.split(/\s*-\s*/)[0] ?? '') : null;
    if (!title) continue;
    items.push({
      id: link,
      title,
      link,
      description: '',
      imageUrl: null,
      urgent: isUrgentNews(title, ''),
      pubDate,
      dateLabel: range,
      source: 'mpk',
      lines,
    });
  }
  return items;
}

/**
 * Komunikaty ZTP Kraków ze strony listy (jeden fetch: tytuł + link + linie
 * + termin na karcie). Karta: div.card > .date, .lines, a.message-btn.
 * RSS WordPressa ma same tytuły bez linii, więc służy tylko za fallback.
 */
export function parseZtpKomunikaty(html: string): MpkNewsItem[] {
  const cards = html.split(/<div class="card">/i).slice(1);
  const items: MpkNewsItem[] = [];
  for (const card of cards) {
    const linkM = card.match(
      /href="(https:\/\/ztp\.krakow\.pl\/kmk\/komunikaty\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/i,
    );
    if (!linkM) continue;
    const link = decodeEntities(linkM[1]).trim();
    const rawTitle = htmlToText(linkM[2]).replace(/\s+/g, ' ').trim();
    const title = cleanNewsTitle(rawTitle);
    const linesRaw = htmlToText(
      (card.match(/<div class="lines">([\s\S]*?)<\/div>/i) ?? [])[1] ?? '',
    );
    const lines = linesRaw
      .split(/[,/]/)
      .map((t) => decodeEntities(t).trim().toUpperCase())
      .filter((t) => /^(LR\d{1,2}|\d{1,3})$/.test(t));
    const range = decodeEntities((card.match(/<div class="date">([\s\S]*?)<\/div>/i) ?? [])[1] ?? '')
      .replace(/\s+/g, ' ')
      .trim();
    const pubDate = range ? parsePlDate(range.split(/\s*(do|–|-)\s*/i)[0] ?? '') : null;
    if (!title) continue;
    items.push({
      id: link,
      title,
      link,
      description: '',
      imageUrl: null,
      urgent: isUrgentNews(title, lines.join(' ')),
      pubDate,
      dateLabel: range || formatNewsDate(pubDate),
      source: 'mpk',
      lines,
    });
  }
  return items;
}

/** Numery linii w treści komunikatu (fallback RSS, który nie niesie linii). */
const ZTP_LINE_RE = /\b(LR\d{1,2}|\d{1,3})\b/g;

function extractZtpLines(title: string, description: string): string[] {
  const seen = new Set<string>();
  const text = `${title} ${description}`;
  let m: RegExpExecArray | null;
  ZTP_LINE_RE.lastIndex = 0;
  while ((m = ZTP_LINE_RE.exec(text))) {
    const tok = m[1].toUpperCase();
    // Lata i godziny to nie linie ("2026", "13:30" łapie \d{1,3} jako "13"/"30"...).
    // Odrzucamy 4-cyfrowe już regexem; godziny odsiewamy kontekstem dwukropka.
    const before = text[m.index - 1];
    const after = text[m.index + m[1].length];
    if (before === ':' || after === ':') continue;
    const n = Number(tok);
    if (Number.isFinite(n) && (n < 1 || n > 999)) continue;
    if (!seen.has(tok)) seen.add(tok);
    if (seen.size >= 12) break;
  }
  return [...seen];
}

/**
 * Komunikaty ZTP Kraków (RSS WordPressa: title + link + pubDate + opis).
 * Każdy komunikat dotyczy komunikacji, więc nie filtrujemy po słowach
 * jak miejski RSS Wrocławia. Daty "od ... do ..." z listy lądują w opisie.
 */
export function parseZtpRss(xml: string): MpkNewsItem[] {
  const items: MpkNewsItem[] = [];
  const blocks = xml.match(/<item[\s\S]*?<\/item>/gi) ?? [];
  for (const b of blocks) {
    const rawTitle = decodeEntities(stripCdata(tagInner(b, 'title'))).replace(/\s+/g, ' ').trim();
    const link = stripCdata(tagInner(b, 'link')).trim();
    const rawDesc = stripCdata(tagInner(b, 'description') || tagInner(b, 'content:encoded'));
    const description = htmlToText(rawDesc).slice(0, 600);
    // RSS niesie zwykle sam tytuł (opisy puste): bierzemy go wprost.
    // Gdy opis istnieje, pierwsze zdanie bywa treściwsze od sygnatury.
    const firstSentence = description.split(/(?<=[.!?])\s/)[0]?.trim() ?? '';
    const title =
      firstSentence && firstSentence !== rawTitle
        ? `${cleanNewsTitle(firstSentence.slice(0, 120))} (${rawTitle})`
        : cleanNewsTitle(rawTitle);
    const pubRaw = stripCdata(tagInner(b, 'pubDate')).trim();
    const ts = pubRaw ? Date.parse(pubRaw) : NaN;
    const pubDate = Number.isFinite(ts) ? ts : null;
    if (!title && !link) continue;
    items.push({
      id: link || `${rawTitle}-${pubDate ?? ''}`,
      title: title || newsTitleFallback(),
      link,
      description,
      imageUrl: extractImage(rawDesc),
      urgent: isUrgentNews(title, description),
      pubDate,
      dateLabel: formatNewsDate(pubDate),
      source: 'mpk',
      lines: extractZtpLines(title, description),
    });
  }
  return items;
}

const ARTICLE_JUNK_RE =
  /^(galeria zdjęć|zobacz galerię|zobacz galerię zdjęć tego artykułu|rozwiń|czytaj także|polecane|udostępnij)$/i;

function removeTaggedBlocks(html: string, openRe: RegExp): string {
  let out = html;
  for (let n = 0; n < 20; n++) {
    const m = openRe.exec(out);
    if (!m || m.index == null) break;
    const start = m.index;
    let i = start + m[0].length;
    let depth = 1;
    while (i < out.length && depth > 0) {
      const nextOpen = out.toLowerCase().indexOf('<div', i);
      const nextClose = out.toLowerCase().indexOf('</div>', i);
      if (nextClose < 0) break;
      if (nextOpen >= 0 && nextOpen < nextClose) {
        depth += 1;
        i = nextOpen + 4;
      } else {
        depth -= 1;
        i = nextClose + 6;
      }
    }
    out = `${out.slice(0, start)} ${out.slice(i)}`;
    openRe.lastIndex = 0;
  }
  return out;
}

function scrubArticleHtml(raw: string): string {
  let out = raw;
  out = removeTaggedBlocks(out, /<div\b[^>]*(?:bbGallery|data-bbgallery-box|expandedSocial|socialEmbed)[^>]*>/gi);
  out = out
    .replace(/<iframe\b[\s\S]*?<\/iframe>/gi, ' ')
    .replace(/<script\b[\s\S]*?<\/script>/gi, ' ')
    .replace(/<button\b[\s\S]*?<\/button>/gi, ' ')
    .replace(/<figure\b[\s\S]*?<\/figure>/gi, ' ');
  return out;
}

export function extractArticleBlocks(html: string, url: string): ArticleBlock[] {
  const mpk = /mpk\.wroc\.pl/i.test(url);
  const ztp = /ztp\.krakow\.pl/i.test(url);
  let fragment = mpk
    ? (html.match(/class="main__inner"[^>]*>([\s\S]*?)<\/div>/i)?.[1] ?? '')
    : ztp
      ? (html.match(/<article\b[^>]*>([\s\S]*?)<\/article>/i)?.[1] ??
        html.match(/class="content"[^>]*>([\s\S]*?)<\/div>\s*<\/div>/i)?.[1] ??
        html.match(/<main\b[^>]*>([\s\S]*?)<\/main>/i)?.[1] ??
        '')
      : (html.match(/id="article-content"[\s\S]*?>([\s\S]*?)<div class="box-container c-tags/i)?.[1] ??
        '');
  fragment = scrubArticleHtml(fragment);
  if (!fragment.trim()) return [];
  const blocks: ArticleBlock[] = [];
  const re = /<(h[1-6]|p|li)\b[^>]*>([\s\S]*?)<\/\1>/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(fragment))) {
    const text = htmlToText(match[2]);
    if (!text || ARTICLE_JUNK_RE.test(text)) continue;
    const tag = match[1].toLowerCase();
    const capsHead =
      text.length <= 48 &&
      text === text.toLocaleUpperCase('pl') &&
      /[A-ZĄĆĘŁŃÓŚŹŻ]/.test(text);
    blocks.push({
      kind: tag.startsWith('h') || capsHead ? 'h' : 'p',
      text,
    });
  }
  if (blocks.length === 0) {
    const plain = htmlToText(fragment);
    if (plain) blocks.push({ kind: 'p', text: plain });
  }
  return blocks;
}

const KEY_NEWS_LAST_SEEN_DATE = 'mpk_news_last_seen_date';
const KEY_NEWS_LAST_SEEN_TS = 'mpk_news_last_seen_ts';
const KEY_NEWS_SEEN_URGENT_IDS = 'mpk_news_seen_urgent_ids';
const KEY_NEWS_CACHE = 'mpk_news_cache_v3';

function cityKey(base: string, cityId: string): string {
  return cityId === 'wroclaw' ? base : `${base}.${cityId}`;
}

function activeCityId(): CityId {
  try {
    return getActiveCityIdSync();
  } catch {
    return 'wroclaw';
  }
}

let cachedNewsItems: MpkNewsItem[] | null = null;
let cachedNewsCity: string | null = null;
let inMemoryLastSeenDate: string | null = null;
let inMemoryLastSeenTs: number | null = null;
let inMemorySeenCity: string | null = null;
let inMemorySeenUrgentIds: Set<string> | null = null;

export function getTodayDateString(d: Date = new Date()): string {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

export function getCachedNews(): MpkNewsItem[] | null {
  if (cachedNewsCity !== null && cachedNewsCity !== activeCityId()) return null;
  return cachedNewsItems;
}

async function fetchText(url: string, signal: AbortSignal, accept: string): Promise<string> {
  const res = await fetch(url, { headers: { Accept: accept }, signal });
  if (!res.ok) throw new Error(`${res.status}`);
  return res.text();
}

export async function loadNewsCache(cityId?: CityId | string): Promise<MpkNewsItem[] | null> {
  const city = getCity(typeof cityId === 'string' ? cityId : activeCityId());
  if (cachedNewsItems && cachedNewsCity === city.id) return cachedNewsItems;
  const raw = await kvGet(cityKey(KEY_NEWS_CACHE, city.id));
  if (!raw) return null;
  try {
    const items = JSON.parse(raw) as MpkNewsItem[];
    if (!Array.isArray(items) || items.length === 0) return null;
    cachedNewsItems = items;
    cachedNewsCity = city.id;
    return items;
  } catch {
    return null;
  }
}

function rememberNews(items: MpkNewsItem[], cityId: string): MpkNewsItem[] {
  cachedNewsItems = items;
  cachedNewsCity = cityId;
  void kvSet(cityKey(KEY_NEWS_CACHE, cityId), JSON.stringify(items));
  return items;
}

/** Aktualności aktywnego miasta. Wrocław = legacy fetchMpkNews. */
export async function fetchCityNews(signal?: AbortSignal): Promise<MpkNewsItem[]> {
  const city = getCity(activeCityId());
  if (city.id === 'krakow') return fetchZtpNews(signal, city.id);
  return fetchMpkNews(signal);
}

async function fetchZtpNews(signal?: AbortSignal, cityId = 'krakow'): Promise<MpkNewsItem[]> {
  const scope = withTimeout(NEWS_TIMEOUT_MS, signal);
  try {
    const [list, rss] = await Promise.allSettled([
      fetchText(ZTP_KOMUNIKATY_URL, scope.signal, 'text/html, */*').then(parseZtpKomunikaty),
      fetchText(ZTP_KOMUNIKATY_RSS, scope.signal, 'application/rss+xml, application/xml, text/xml, */*').then(
        parseZtpRss,
      ),
    ]);
    const fromList = list.status === 'fulfilled' ? list.value : [];
    if (fromList.length > 0) {
      return rememberNews(sortNews(fromList), cityId);
    }
    const fromRss = rss.status === 'fulfilled' ? rss.value : [];
    if (fromRss.length === 0) {
      if (list.status === 'rejected' && rss.status === 'rejected') {
        throw list.reason instanceof Error ? list.reason : new Error('news');
      }
    }
    return rememberNews(sortNews(fromRss), cityId);
  } finally {
    scope.dispose();
  }
}

function sortNews(items: MpkNewsItem[]): MpkNewsItem[] {
  return [...items].sort((a, b) => {
    if (a.urgent !== b.urgent) return a.urgent ? -1 : 1;
    return (b.pubDate ?? 0) - (a.pubDate ?? 0);
  });
}

export async function fetchMpkNews(signal?: AbortSignal): Promise<MpkNewsItem[]> {
  // Bez limitu czasu wiszące połączenie z wroclaw.pl zostawiało ekran
  // „Pobieranie komunikatów…” na zawsze i blokowało odświeżenie plakietki.
  const scope = withTimeout(NEWS_TIMEOUT_MS, signal);
  try {
    const [city, mpk] = await Promise.allSettled([
      fetchText(MPK_NEWS_URL, scope.signal, 'application/rss+xml, application/xml, text/xml, */*').then(
        parseMpkRss,
      ),
      fetchText(MPK_CHANGES_URL, scope.signal, 'text/html, */*').then(parseMpkChanges),
    ]);
    const changes = mpk.status === 'fulfilled' ? mpk.value : [];
    const stories = city.status === 'fulfilled' ? city.value : [];
    if (changes.length === 0 && stories.length === 0) {
      if (city.status === 'rejected' && mpk.status === 'rejected') {
        throw city.reason instanceof Error ? city.reason : new Error('news');
      }
    }
    const byFreshness = (a: MpkNewsItem, b: MpkNewsItem) => {
      if (a.urgent !== b.urgent) return a.urgent ? -1 : 1;
      return (b.pubDate ?? 0) - (a.pubDate ?? 0);
    };
    return rememberNews([...changes.sort(byFreshness), ...stories.sort(byFreshness)], 'wroclaw');
  } finally {
    scope.dispose();
  }
}

export async function fetchArticle(url: string, signal?: AbortSignal): Promise<ArticleBlock[]> {
  const scope = withTimeout(NEWS_TIMEOUT_MS, signal);
  try {
    const html = await fetchText(url, scope.signal, 'text/html, */*');
    return extractArticleBlocks(html, url);
  } finally {
    scope.dispose();
  }
}

// Czy dziś pojawiło się pilne utrudnienie? → czerwony badge na dzwonku.
export function isToday(ts: number | null): boolean {
  if (!ts) return false;
  const d = new Date(ts);
  const now = new Date();
  return (
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()
  );
}

export function hasUrgentNewsToday(items: MpkNewsItem[]): boolean {
  return items.some((i) => i.urgent && isToday(i.pubDate));
}

/**
 * Oznacza aktualności jako przeczytane (użytkownik wszedł do sekcji aktualności).
 * Zapisuje datę dzisiejszą, timestamp oraz identyfikatory dzisiejszych pilnych komunikatów.
 */
export async function markNewsSeen(items?: MpkNewsItem[]): Promise<void> {
  const cityId = activeCityId();
  const today = getTodayDateString();
  const now = Date.now();
  inMemoryLastSeenDate = today;
  inMemoryLastSeenTs = now;
  inMemorySeenCity = cityId;

  const currentItems = items || (cachedNewsCity === cityId ? cachedNewsItems : null) || [];
  const urgentIds = currentItems
    .filter((i) => i.urgent && isToday(i.pubDate))
    .map((i) => i.id);

  inMemorySeenUrgentIds = new Set(urgentIds);

  await Promise.all([
    kvSet(cityKey(KEY_NEWS_LAST_SEEN_DATE, cityId), today),
    kvSet(cityKey(KEY_NEWS_LAST_SEEN_TS, cityId), String(now)),
    kvSet(cityKey(KEY_NEWS_SEEN_URGENT_IDS, cityId), JSON.stringify(urgentIds)),
  ]);
}

/**
 * Sprawdza czy należy pokazać wykrzyknik przy dzwonku powiadomień.
 * Jeśli użytkownik wszedł już dzisiaj do sekcji aktualności i widział bieżące utrudnienia,
 * wykrzyknik nie jest pokazywany (znika).
 * Pojawia się ponownie tylko w nowym dniu lub gdy pojawi się nowy pilny komunikat
 * opublikowany po wizycie użytkownika.
 */
export async function shouldShowNewsAlert(items: MpkNewsItem[]): Promise<boolean> {
  const todayUrgent = items.filter((i) => i.urgent && isToday(i.pubDate));
  if (todayUrgent.length === 0) return false;

  const today = getTodayDateString();
  const cityId = activeCityId();

  // Sprawdź pamięć podręczną lub KV store
  let lastSeenDate = inMemorySeenCity === cityId ? inMemoryLastSeenDate : null;
  if (!lastSeenDate) {
    lastSeenDate = await kvGet(cityKey(KEY_NEWS_LAST_SEEN_DATE, cityId));
    if (inMemorySeenCity === cityId) inMemoryLastSeenDate = lastSeenDate;
  }

  // Jeśli użytkownik w ogóle nie wchodził dzisiaj w sekcję aktualności -> pokaż wykrzyknik
  if (lastSeenDate !== today) {
    return true;
  }

  // Użytkownik wszedł dzisiaj w tę sekcję. Sprawdź, czy są jakieś NOWE utrudnienia,
  // których wcześniej nie widział.
  let seenIds = inMemorySeenCity === cityId ? inMemorySeenUrgentIds : null;
  if (!seenIds) {
    const rawSeen = await kvGet(cityKey(KEY_NEWS_SEEN_URGENT_IDS, cityId));
    if (rawSeen) {
      try {
        seenIds = new Set<string>(JSON.parse(rawSeen));
      } catch {
        seenIds = new Set<string>();
      }
    } else {
      seenIds = new Set<string>();
    }
    if (inMemorySeenCity === cityId) inMemorySeenUrgentIds = seenIds;
  }

  let lastSeenTs = inMemorySeenCity === cityId ? inMemoryLastSeenTs : null;
  if (lastSeenTs == null) {
    const rawTs = await kvGet(cityKey(KEY_NEWS_LAST_SEEN_TS, cityId));
    lastSeenTs = rawTs ? Number(rawTs) : 0;
    if (inMemorySeenCity === cityId) inMemoryLastSeenTs = lastSeenTs;
  }

  // Czy pojawił się nowy komunikat, którego nie było na liście i ma pubDate po wizycie?
  const hasUnseenNewUrgent = todayUrgent.some((item) => {
    if (seenIds.has(item.id)) return false;
    // Jeśli nie ma w seenIds, ale pubDate jest starszy niż wizyta (np. zmiana linku/ID lub brak pubDate),
    // nie spamujemy wykrzyknikiem jeśli użytkownik był już dzisiaj.
    if (item.pubDate != null && lastSeenTs > 0 && item.pubDate <= lastSeenTs + 60000) {
      return false;
    }
    return true;
  });

  return hasUnseenNewUrgent;
}
