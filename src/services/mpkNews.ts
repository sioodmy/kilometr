// Czytnik aktualności per-miasto (bez dodatkowych zależności).
// - Wrocław: RSS wroclaw.pl/komunikacja (miasto) + HTML mpk.wroc.pl (zmiany),
// - Kraków: RSS ZTP (komunikaty KMK, ?post_type=komunikat).
// - GZM: HTML rj.transportgzm.pl/v2/news (komunikaty ZTM, serwerowy markup).
// - Warszawa: RSS WTP (www.wtp.waw.pl/feed, zwykły RSS 2.0 z numerami linii
//   w tytułach; podstrony artykułów blokuje CloudFront, więc treść bierzemy
//   z opisu w feedzie).
// - Poznań: RSS ZTM (www.ztm.poznan.pl/feed, zwykły RSS 2.0 WordPressa;
//   numery linii w tytułach jak w WTP, treść z opisu w feedzie).
// - Trójmiasto: JSON ZTM Gdańsk (files.cloudgdansk.pl, znt.json ze zmianami
//   tras z gotową listą linii oraz bsk.json z bieżącymi awariami).
// - Łódź: dwa kanały MPK (rozklady/rss/rozklady.jsp ze zmianami, showrss
//   z utrudnieniami) w ISO-8859-2. Tytuły generyczne, więc tytuł niesie treść
//   opisu, a linie wyciągamy z linków w opisie. Artykuł to podstrona
//   wholemessage.jsp (treść w div#dWrkspc).
// - Kielce: lista Joomla ZTM (aktualnosci.html: karty blog-item z tytułem,
//   linkiem, datą time[datetime], leadem w p i obrazkiem images/). Linie
//   wyciągamy regexem z tytułu i leadu z walidacją po routes.txt feedu
//   (0W/0Z, 1-54 z dziurami, 102-114, E/F, N1/N2, T/Z). Artykuł to podstrona
//   aktualności (treść w div.com-content-article__body).
// - Szczecin: lista HTML ZDiTM (pl/pasazer/informacje: karty z tytułem,
//   datą time[datetime] i leadem p.card-text). Linie wyciągamy regexem
//   z tytułu i leadu (tramwaje 1–12, autobusy 51+, nocne 5xx, pospieszne
//   A–C). Artykuł to podstrona informacji (treść w main#pageContent).
// - Olsztyn: RSS WordPressa ZDZiT (zdzit.olsztyn.eu/feed, zwykły RSS 2.0;
//   kanał miesza drogi z komunikacją, więc filtrujemy po słowach jak
//   miejski RSS Wrocławia). Linie z tytułu i opisu z walidacją po
//   routes.txt feedu (tramwaje 1–5, autobusy 101+, nocne N01/N02).
//   Artykuł to wpis WordPressa (treść w div.entry-content jak w WTP).
// - Białystok: lista HTML BKM (pl/informacje/wiadomosci/komunikaty:
//   li.news__item z datą div.news__date i tytułem a.news__title, leady
//   puste). Linie wyciągamy regexem z tytułu (autobusy 1–30, 100+,
//   J/J1–J6, N1–N6; daty i godziny wycinamy wcześniej). Artykuł to
//   podstrona komunikatu (treść w div.component-content-wysiwyg).
// - Opole: RSS kategorii Aktualności MZK (tytuł + link + pubDate + opis;
//   główny feed miesza przetargi i oferty pracy, więc bierzemy wprost
//   kategorię). Linie wyciągamy regexem z tytułu i opisu (dzienne 1–80,
//   nocne N1–N2, szkolne SZ1–SZ20 i specjalne S1–S2; liczby walidujemy
//   po routes.txt feedu GTFS). Artykuł to WordPress (treść w article
//   + div.entry-content, ten sam układ co WTP).
// - Rzeszów: RSS ZTM (ztm.erzeszow.pl/feed, zwykły RSS 2.0 WordPressa;
//   numery linii w tytułach i opisach jak w Poznaniu, treść z opisu
//   w feedzie). Artykuł to podstrona ZTM (treść w div#blog).
// - Lublin: lista HTML ZDiTM (pl/aktualnosci: karty article.news z datą
//   w h4 raz na grupę dnia i treścią w article.tiny z tytułem h3.inline
//   i leadem p). Linie wyciągamy z tytułu i leadu (autobusy 2–85,
//   trolejbusy 150–162, nocne N1–N3, miejskie 301–303, 912/917/922
//   i 950). Artykuł to podstrona aktualności (treść w
//   section.main-center-panel).
// - Radom: lista HTML MZDiK (mzdik.pl/komunikaty: karty article z tytułem,
//   linkiem względnym i leadem div.article__info; daty nie ma na karcie,
//   więc bierzemy ją z tytułu jak "od dnia 6.10.2026"). Linie wyciągamy
//   regexem z tytułu i leadu (dzienne 1-27 i nocne N1-N3 z GTFS MZDiK).
//   Artykuł to podstrona komunikatu (lead w div.standard-page__intro,
//   treść w div.content).
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
export const GZM_NEWS_URL = 'https://rj.transportgzm.pl/v2/news/';
/**
 * Komunikaty WTP Warszawa: zwykły kanał RSS 2.0 (tytuł + link + pubDate
 * + opis). Numery linii siedzą w tytułach („objazdy dla 138”, „autobusów
 * 108, 130 i 162”), więc wyciągamy je regexem jak w ZTP/GZM.
 */
export const WTP_FEED_URL = 'https://www.wtp.waw.pl/feed/';
/**
 * Komunikaty ZTM Poznań: zwykły kanał RSS 2.0 WordPressa (tytuł + link +
 * pubDate + opis). Numery linii siedzą w tytułach („objazdy dla 138”,
 * „na trasę linii 0”), więc wyciągamy je regexem jak w WTP.
 */
export const ZTM_POZNAN_FEED_URL = 'https://www.ztm.poznan.pl/feed/';
/**
 * Komunikaty ZTM Gdańsk: JSON, nie RSS. znt.json niesie zmiany tras
 * ({ results: [{ lineNumbers: ["117","143","N4"], title, summary, content,
 * url, alarmDateFrom/To, publishFrom/To }] }), bsk.json bieżące awarie
 * ({ komunikaty: [...] }). Numery linii są gotowe, nie trzeba regexów.
 */
export const ZTM_GDANSK_ZNT_URL = 'https://files.cloudgdansk.pl/d/otwarte-dane/ztm/znt.json?v=1';
export const ZTM_GDANSK_BSK_URL = 'https://files.cloudgdansk.pl/d/otwarte-dane/ztm/bsk.json?v=1';
/**
 * Komunikaty MPK Łódź: zmiany w rozkładach (RSS z opisami pełnymi numerów
 * linii w linkach) oraz utrudnienia w ruchu (pusty kanał, gdy nic się nie
 * dzieje; parser zwraca wtedy zero pozycji bez błędu).
 */
export const MPK_LODZ_ROZKLADY_RSS = 'https://mpk.lodz.pl/rozklady/rss/rozklady.jsp';
export const MPK_LODZ_UTRUDNIENIA_RSS = 'https://mpk.lodz.pl/showrss.action?c=1211';
/**
 * Komunikaty ZTM Kielce: lista aktualności Joomla (tytuł + link + data
 * w time[datetime] + lead w pierwszym p + obrazek images/). Serwerowy HTML,
 * paginacja ?start=N na kolejnych ekranach (bierzemy pierwszy).
 */
export const ZTM_KIELCE_NEWS_URL = 'https://ztm.kielce.pl/aktualnosci.html';
/**
 * Komunikaty ZDiTM Szczecin: lista dla pasażera (tytuł + link + data
 * w time[datetime] + lead p.card-text na karcie). Serwerowy HTML,
 * bez JSON-a i paginacji na pierwszym ekranie.
 */
export const ZDITM_SZCZECIN_INFO_URL = 'https://www.zditm.szczecin.pl/pl/pasazer/informacje';
/**
 * Komunikaty MZDiK Radom: lista dla pasażera (tytuł + link względny
 * + lead div.article__info na karcie article.section__article).
 * Serwerowy HTML, bez JSON-a, daty ani obrazka na karcie (img 500x50
 * to dekoracyjny pasek, nie hero). Datę niesie tytuł komunikatu
 * ("od dnia 6.10.2026", "w nocy z 14 na 15.10.2026").
 */
export const MZDIK_RADOM_KOMUNIKATY_URL = 'https://mzdik.pl/komunikaty';
/**
 * Komunikaty ZDiTM Lublin: lista aktualności (tytuł h3.inline + link
 * + lead w pierwszym p na karcie article.tiny). Data siedzi w h4
 * (format "2026-10-15 11:48") tylko na pierwszej karcie grupy dnia,
 * reszta kart dnia jej nie powtarza, więc parser dziedziczy ostatnią.
 * Ikonki kategorii (uploads/Icons) to chrom UI, nie zdjęcia: imageUrl
 * celowo null.
 */
export const ZDITM_LUBLIN_INFO_URL = 'https://www.zdtm.lublin.eu/pl/aktualnosci';
/**
 * Komunikaty ZDZiT Olsztyn: zwykły kanał RSS 2.0 WordPressa (tytuł + link
 * + pubDate + opis). Kanał miesza drogi z komunikacją (remonty dla
 * kierowców, sprzedaż majątku, oświetlenie), więc odsiewamy po słowach
 * jak miejski RSS Wrocławia. Numery linii siedzą w tytułach („linii
 * nr 303, 305”) i opisach, więc wyciągamy je regexem z walidacją.
 */
export const ZDZIT_OLSZTYN_FEED_URL = 'https://zdzit.olsztyn.eu/feed/';
/**
 * Komunikaty BKM Białystok: lista dla pasażera (tytuł w a.news__title
 * z pełną treścią w atrybucie title, data w div.news__date jako
 * "DD.MM.RRRR HH:MM", leady news__lead puste). Serwerowy HTML (CMS BIT),
 * paginacja na podstronach, pierwszy ekran wystarcza.
 */
export const BKM_BIALYSTOK_KOMUNIKATY_URL =
  'https://komunikacja.bialystok.pl/pl/informacje/wiadomosci/komunikaty/';
/**
 * Komunikaty MZK Opole: kanał RSS kategorii Aktualności (WordPress).
 * Główny feed (/feed/) miesza przetargi i oferty pracy z komunikatami,
 * więc bierzemy wprost kategorię z samymi aktualnościami dla pasażera.
 */
export const MZK_OPOLE_FEED_URL = 'https://www.mzkopole.pl/category/aktualnosci/feed/';
/**
 * Komunikaty ZTM Rzeszów: zwykły kanał RSS 2.0 WordPressa (tytuł + link +
 * pubDate + opis). Numery linii siedzą w tytułach („zmiany tras linii
 * 5, 6 i 11”, „Linia nr 6”) i w opisach („Linia 2: Baligrodzka – …”),
 * więc wyciągamy je regexem jak w Poznaniu (z allowlistą linii z GTFS).
 */
export const ZTM_RZESZOW_FEED_URL = 'https://ztm.erzeszow.pl/feed/';

/**
 * Komunikaty ZTM GZM. Lista to serwerowy HTML bez JSON-a i paginacji
 * (jeden ekran, ~35 kart). Karta: div.panel.panel-default > h2 z linkiem
 * /v2/news/i/{id}/, data „Ostatnia aktualizacja: DD.MM.RRRR [HH:MM]”
 * albo „Data obowiązywania od: DD.MM.RRRR”, lead p.list_lead.
 */

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
    // Spacja po znaczniku przed interpunkcją („23:00 .”, „r. ,”) to artefakt
    // zamiany tagów na spacje.
    .replace(/\s+([,.;:!?])/g, '$1')
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

/**
 * Komunikaty ZTM GZM z listy (jeden fetch: tytuł + link + data + lead).
 * Numery linii nie mają własnych znaczników na liście, więc skanujemy
 * tekst (daty wycinamy wcześniej, żeby „18.10.2026” nie udawało linii).
 */
export function parseGzmNews(html: string): MpkNewsItem[] {
  const cards = html.split(/<div class="panel panel-default">/i).slice(1);
  const items: MpkNewsItem[] = [];
  for (const card of cards) {
    const linkM = card.match(/href="(\/v2\/news\/i\/\d+\/?)"[^>]*>([\s\S]*?)<\/a>/i);
    if (!linkM) continue;
    const link = `https://rj.transportgzm.pl${decodeEntities(linkM[1]).trim()}`;
    const rawTitle = htmlToText(linkM[2]).replace(/\s+/g, ' ').trim();
    const title = cleanNewsTitle(rawTitle);
    const dateM = card.match(
      /(?:Ostatnia aktualizacja|Data obowiązywania od):\s*(\d{1,2}\.\d{1,2}\.\d{4})(?:\s+(\d{1,2}:\d{2}))?/,
    );
    const dateLabel = dateM ? (dateM[2] ? `${dateM[1]} ${dateM[2]}` : dateM[1]) : '';
    const pubDate = dateM ? parsePlDate(dateM[1]) : null;
    const lead = htmlToText((card.match(/<p class="lead list_lead">([\s\S]*?)<\/p>/i) ?? [])[1] ?? '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 600);
    if (!title) continue;
    items.push({
      id: link,
      title,
      link,
      description: lead,
      imageUrl: null,
      urgent: isUrgentNews(title, lead),
      pubDate,
      dateLabel: dateLabel || formatNewsDate(pubDate),
      source: 'mpk',
      lines: extractGzmLines(title, lead),
    });
  }
  return items;
}

/** Numery linii GZM w tekście: 6, M100, A4, Z-4, AP. */
const GZM_LINE_RE = /\b([A-Z]{0,2}\d{1,3}[A-Z]?|[A-Z]-\d{1,3}|AP)\b/gi;

function extractGzmLines(title: string, description: string): string[] {
  const seen = new Set<string>();
  const text = `${title} ${description}`
    .replace(/\d{1,2}\.\d{1,2}\.\d{4}/g, ' ')
    .replace(/\d{1,2}:\d{2}/g, ' ');
  let m: RegExpExecArray | null;
  GZM_LINE_RE.lastIndex = 0;
  while ((m = GZM_LINE_RE.exec(text))) {
    const tok = m[1].toUpperCase();
    // Numery stanowisk („Gospoda 02”) to nie linie: prawdziwe linie
    // nie zaczynają się od zera.
    if (/^0\d+$/.test(tok)) continue;
    if (!seen.has(tok)) seen.add(tok);
    if (seen.size >= 12) break;
  }
  return [...seen];
}

/**
 * Numery linii WTP w tekście: M1/M2, S1…S40, L-5/L28, N12, Z14 i zwykłe
 * 1–999. Daty i godziny wycinamy wcześniej, żeby „17-25 października”
 * ani „od 19 października” nie udawały linii.
 */
const WTP_LINE_RE = /\b(M[12]|S\d{1,2}|L-?\d{1,3}|N\d{1,3}|Z\d{1,3}|\d{1,3}[A-Z]?)\b/gi;

const WTP_MONTHS =
  'stycznia|lutego|marca|kwietnia|maja|czerwca|lipca|sierpnia|września|października|listopada|grudnia|pazdziernika';

function extractWtpLines(title: string, description: string): string[] {
  const seen = new Set<string>();
  const text = `${title} ${description}`
    // Pełne i skrócone daty liczbowe: „17.10.2026”, „17.10” (zostawiłoby 17 i 10 jako linie).
    .replace(/\d{1,2}\.\d{1,2}\.\d{2,4}/g, ' ')
    .replace(/\d{1,2}\.\d{1,2}(?!\d)/g, ' ')
    .replace(/\d{1,2}:\d{2}/g, ' ')
    // Daty z nazwą miesiąca w każdej formie z feedu: „19 października”,
    // „17-25 października” (też – i —), „od 17 do 25 października”,
    // „1 i 2 listopada”, „do 19 października”.
    .replace(new RegExp(`\\b(?:(?:od|do)\\s+)?\\d{1,2}(?:\\s*(?:,|i|do|[-–—])\\s*\\d{1,2})*\\s+(?:${WTP_MONTHS})\\b`, 'gi'), ' ')
    // Sam zakres dni bez miesiąca („w dniach 17-25”): też data, nie linie.
    .replace(/\b\d{1,2}\s*[-–—]\s*\d{1,2}\b(?=\s|$)/g, ' ');
  let m: RegExpExecArray | null;
  WTP_LINE_RE.lastIndex = 0;
  while ((m = WTP_LINE_RE.exec(text))) {
    const tok = m[1].toUpperCase();
    const before = text[m.index - 1];
    const after = text[m.index + m[1].length];
    if (before === ':' || after === ':') continue;
    if (/^\d+$/.test(tok)) {
      const n = Number(tok);
      if (n < 1 || n > 999) continue;
    }
    if (!seen.has(tok)) seen.add(tok);
    if (seen.size >= 12) break;
  }
  return [...seen];
}

/**
 * Komunikaty WTP Warszawa (RSS 2.0: tytuł + link + pubDate + opis).
 * Cały kanał dotyczy komunikacji, więc nie filtrujemy po słowach jak
 * miejski RSS Wrocławia. Opis z feedu ląduje w karcie, bo podstrony
 * artykułów blokuje CloudFront.
 */
export function parseWtpRss(xml: string): MpkNewsItem[] {
  const items: MpkNewsItem[] = [];
  const blocks = xml.match(/<item[\s\S]*?<\/item>/gi) ?? [];
  for (const b of blocks) {
    const rawTitle = decodeEntities(stripCdata(tagInner(b, 'title'))).replace(/\s+/g, ' ').trim();
    const title = cleanNewsTitle(rawTitle);
    const link = stripCdata(tagInner(b, 'link')).trim();
    const rawDesc = stripCdata(tagInner(b, 'description'));
    const description = htmlToText(rawDesc).slice(0, 600);
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
      lines: extractWtpLines(title, description),
    });
  }
  return items;
}

/**
 * Numery linii ZTM Poznań w tekście: 1–999 oraz turystyczne T6/T7.
 * Daty i godziny wycinamy wcześniej jak w WTP („5 października”,
 * „22 września”, „16.09”), a rocznice typu „45-lecie” nie są liniami.
 */
const POZ_LINE_RE = /\b(T\d{1,2}|\d{1,3}[A-Z]?)\b/gi;

function extractPoznanLines(title: string, description: string): string[] {
  const seen = new Set<string>();
  const text = `${title} ${description}`
    .replace(/\d{1,2}\.\d{1,2}\.\d{2,4}/g, ' ')
    .replace(/\d{1,2}\.\d{1,2}(?!\d)/g, ' ')
    .replace(/\d{1,2}:\d{2}/g, ' ')
    // Rocznice („45-lecie Ikarusów”) to nie linie.
    .replace(/\b\d+\s*[-–—]\s*lecie\b/gi, ' ')
    .replace(new RegExp(`\\b(?:(?:od|do)\\s+)?\\d{1,2}(?:\\s*(?:,|i|do|[-–—])\\s*\\d{1,2})*\\s+(?:${WTP_MONTHS})\\b`, 'gi'), ' ')
    .replace(/\b\d{1,2}\s*[-–—]\s*\d{1,2}\b(?=\s|$)/g, ' ');
  let m: RegExpExecArray | null;
  POZ_LINE_RE.lastIndex = 0;
  while ((m = POZ_LINE_RE.exec(text))) {
    const tok = m[1].toUpperCase();
    const before = text[m.index - 1];
    const after = text[m.index + m[1].length];
    if (before === ':' || after === ':') continue;
    if (/^\d+$/.test(tok)) {
      const n = Number(tok);
      if (n < 1 || n > 999) continue;
    }
    if (!seen.has(tok)) seen.add(tok);
    if (seen.size >= 12) break;
  }
  return [...seen];
}

/**
 * Komunikaty ZTM Poznań (RSS 2.0: tytuł + link + pubDate + opis).
 * Cały kanał dotyczy transportu, więc nie filtrujemy po słowach jak
 * miejski RSS Wrocławia. Opis z feedu ląduje w karcie.
 */
export function parsePoznanRss(xml: string): MpkNewsItem[] {
  const items: MpkNewsItem[] = [];
  const blocks = xml.match(/<item[\s\S]*?<\/item>/gi) ?? [];
  for (const b of blocks) {
    const rawTitle = decodeEntities(stripCdata(tagInner(b, 'title'))).replace(/\s+/g, ' ').trim();
    const title = cleanNewsTitle(rawTitle);
    const link = stripCdata(tagInner(b, 'link')).trim();
    const rawDesc = stripCdata(tagInner(b, 'description'));
    const description = htmlToText(rawDesc).slice(0, 600);
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
      lines: extractPoznanLines(title, description),
    });
  }
  return items;
}

/**
 * Numery linii ZTM Gdańsk w tekście (gdy JSON nie niesie lineNumbers):
 * N1–N89, M32, T8/T9 i zwykłe 100–999. Daty i godziny wycinamy wcześniej
 * jak w WTP („18 października”, „14.10”), a rocznice typu „45-lecie”
 * to nie linie.
 */
const GDANSK_LINE_RE = /\b(M\d{1,3}|N\d{1,3}|T\d{1,2}|\d{1,3})\b/gi;

function extractGdanskLines(title: string, description: string): string[] {
  const seen = new Set<string>();
  const text = `${title} ${description}`
    .replace(/\d{1,2}\.\d{1,2}\.\d{2,4}/g, ' ')
    .replace(/\d{1,2}\.\d{1,2}(?!\d)/g, ' ')
    .replace(/\d{1,2}:\d{2}/g, ' ')
    .replace(/\b\d+\s*[-–—]\s*lecie\b/gi, ' ')
    .replace(new RegExp(`\\b(?:(?:od|do)\\s+)?\\d{1,2}(?:\\s*(?:,|i|do|[-–—])\\s*\\d{1,2})*\\s+(?:${WTP_MONTHS})\\b`, 'gi'), ' ')
    .replace(/\b\d{1,2}\s*[-–—]\s*\d{1,2}\b(?=\s|$)/g, ' ');
  let m: RegExpExecArray | null;
  GDANSK_LINE_RE.lastIndex = 0;
  while ((m = GDANSK_LINE_RE.exec(text))) {
    const tok = m[1].toUpperCase();
    // Dwukropek to czas tylko z cyfrą po obu stronach ("13:30").
    // Samodzielny dwukropek wprowadza opis ("...i 307: zmiany na trasie"),
    // więc linii przed nim nie odrzucamy.
    const before = text[m.index - 1];
    const after = text[m.index + m[1].length];
    if (before === ':' && /\d/.test(text[m.index - 2] ?? '')) continue;
    if (after === ':' && /\d/.test(text[m.index + m[1].length + 1] ?? '')) continue;
    // Sufiksy słupków („przystanek Oliwa PKP 03”) to nie linie.
    if (/^0\d+$/.test(tok)) continue;
    if (/^\d+$/.test(tok)) {
      const n = Number(tok);
      if (n < 1 || n > 999) continue;
    }
    if (!seen.has(tok)) seen.add(tok);
    if (seen.size >= 12) break;
  }
  return [...seen];
}

/** Data z JSON Gdańska ("2026-10-13 12:00:00", czas lokalny). */
function parseGdanskDate(raw: unknown): number | null {
  if (typeof raw !== 'string' || !raw.trim()) return null;
  const ts = Date.parse(raw.trim().replace(' ', 'T'));
  return Number.isFinite(ts) ? ts : null;
}

function gdanskItemLines(item: Record<string, unknown>, title: string, summary: string): string[] {
  const raw = item.lineNumbers ?? item.lines ?? item.linie;
  if (Array.isArray(raw)) {
    const seen = new Set<string>();
    for (const l of raw) {
      const tok = String(l ?? '').trim().toUpperCase();
      if (!tok || seen.has(tok)) continue;
      seen.add(tok);
      if (seen.size >= 12) break;
    }
    if (seen.size > 0) return [...seen];
  }
  return extractGdanskLines(title, summary);
}

/**
 * Zmiany tras ZTM Gdańsk (znt.json: { results: [{ lineNumbers, title,
 * summary, content, url, alarmDateFrom/To, publishFrom/To }] }). Numery
 * linii idą gotowe z API, opis z leadu (content bywa pusty).
 */
export function parseGdanskZnt(json: string): MpkNewsItem[] {
  let data: unknown;
  try {
    data = JSON.parse(json);
  } catch {
    return [];
  }
  const raw = Array.isArray(data) ? data : (data as { results?: unknown })?.results;
  if (!Array.isArray(raw)) return [];
  const items: MpkNewsItem[] = [];
  for (const r of raw) {
    if (!r || typeof r !== 'object') continue;
    const item = r as Record<string, unknown>;
    const title = cleanNewsTitle(String(item.title ?? ''));
    const summary = htmlToText(String(item.summary ?? item.content ?? '')).slice(0, 600);
    const link = String(item.url ?? item.link ?? '').trim();
    const pubDate = parseGdanskDate(item.publishFrom) ?? parseGdanskDate(item.alarmDateFrom);
    if (!title && !link) continue;
    items.push({
      id: link || `${title}-${pubDate ?? ''}`,
      title: title || newsTitleFallback(),
      link,
      description: summary,
      imageUrl: null,
      urgent: isUrgentNews(title, summary),
      pubDate,
      dateLabel: formatNewsDate(pubDate),
      source: 'mpk',
      lines: gdanskItemLines(item, title, summary),
    });
  }
  return items;
}

/**
 * Bieżące awarie ZTM Gdańsk (bsk.json: { komunikaty: [...] }). Kształt
 * pozycji czytamy defensywnie (feed bywa pusty, więc kontraktu nie da się
 * zamrozić na próbce): tytuł, treść, link i datę bierzemy z pierwszego
 * pasującego pola. Wszystko z tego feedu to trwające utrudnienie.
 */
export function parseGdanskBsk(json: string): MpkNewsItem[] {
  let data: unknown;
  try {
    data = JSON.parse(json);
  } catch {
    return [];
  }
  const raw = Array.isArray(data) ? data : (data as { komunikaty?: unknown })?.komunikaty;
  if (!Array.isArray(raw)) return [];
  const first = (item: Record<string, unknown>, keys: string[]): string =>
    String(keys.map((k) => item[k]).find((v) => typeof v === 'string' && v.trim()) ?? '').trim();
  const items: MpkNewsItem[] = [];
  for (const r of raw) {
    if (!r || typeof r !== 'object') continue;
    const item = r as Record<string, unknown>;
    const title = cleanNewsTitle(first(item, ['title', 'tytul', 'naglowek', 'temat']));
    const text = htmlToText(first(item, ['tresc', 'opis', 'komunikat', 'summary', 'content', 'message', 'text'])).slice(0, 600);
    const link = first(item, ['url', 'link']);
    const pubDate =
      parseGdanskDate(item.publishFrom) ??
      parseGdanskDate(item.alarmDateFrom) ??
      parseGdanskDate(item.data) ??
      parseGdanskDate(item.date) ??
      parseGdanskDate(item.created);
    if (!title && !link) continue;
    items.push({
      id: link || `${title}-${pubDate ?? ''}`,
      title: title || newsTitleFallback(),
      link,
      description: text,
      imageUrl: null,
      urgent: true,
      pubDate,
      dateLabel: formatNewsDate(pubDate),
      source: 'mpk',
      lines: gdanskItemLines(item, title, text),
    });
  }
  return items;
}

/**
 * MPK Łódź serwuje RSS w ISO-8859-2, a fetch.text() dekoduje wszystko jako
 * UTF-8 (krzaki zamiast ogonków). Najpierw próbujemy TextDecoder, a gdy silnik
 * go nie zna (RangeError), używamy własnej tablicy Latin-2.
 */
const LATIN2_HIGH =
  ' Ą˘Ł¤ĽŚ§¨ŠŞŤŹ­ŽŻ°ą˛ł´ľśˇ¸šşťź˝žżŔÁÂĂÄĹĆÇČÉĘËĚÍÎĎĐŃŇÓÔŐÖ×ŘŮÚŰÜÝŢßŕáâăäĺćçčéęëěíîďđńňóôőö÷řůúűüýţ˙';

function decodeLatin2(buf: ArrayBuffer): string {
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

async function fetchLodzText(url: string, signal: AbortSignal): Promise<string> {
  const res = await fetch(url, {
    headers: { Accept: 'application/rss+xml, application/xml, text/xml, text/html, */*' },
    signal,
  });
  if (!res.ok) throw new Error(`${res.status}`);
  return decodeLatin2(await res.arrayBuffer());
}

/** Miesiące z komunikatów MPK (feed myli "październik" z "października"). */
const LODZ_MONTHS: Record<string, number> = {
  stycznia: 0, lutego: 1, marca: 2, kwietnia: 3, maja: 4, czerwca: 5,
  lipca: 6, sierpnia: 7, 'września': 8, wrzesnia: 8, 'października': 9,
  pazdziernika: 9, 'październik': 9, pazdziernik: 9, listopada: 10, grudnia: 11,
};

/** Pierwsza data słowna z tekstu ("16 października 2026", też zakres "12-16 ..."). */
function parseLodzDate(text: string): number | null {
  const m = text.match(
    /(\d{1,2})(?:\s*[-–—]\s*\d{1,2})?\s+([a-ząćęłńóśźż]+)\s+(\d{4})/i,
  );
  if (!m) return null;
  const month = LODZ_MONTHS[m[2].toLowerCase()];
  if (month == null) return null;
  const ts = new Date(Number(m[3]), month, Number(m[1]), 8, 0, 0).getTime();
  return Number.isFinite(ts) ? ts : null;
}

/** Linie MPK Łódź z GTFS ZDiT: 1–202 z sufiksami, nocne N, zastępcze Z/R/P, F1/G1/G2/oP6. */
const LODZ_LINE_RE = /\b([A-Z]{0,2}\d{1,3}[A-Z]?|OP6)\b/gi;
/** Samotne H i W to linie tylko po słowie "linii": przyimek "w" jest wszędzie. */
const LODZ_SINGLE_RE = /(?:linii|linia|linie)\s+([HW])\b/gi;

function extractLodzLines(title: string, description: string): string[] {
  const seen = new Set<string>();
  const text = `${title} ${description}`
    .replace(/\d{4}\s*r\.?/gi, ' ')
    .replace(/\d{1,2}\.\d{1,2}\.\d{2,4}/g, ' ')
    .replace(/\d{1,2}\.\d{1,2}(?!\d)/g, ' ')
    .replace(/\d{1,2}:\d{2}/g, ' ')
    .replace(/\b\d+\s*\/\s*\d+\b/g, ' ')
    .replace(
      new RegExp(
        `\\b\\d{1,2}(?:\\s*[-–—]\\s*\\d{1,2})?\\s+(?:${Object.keys(LODZ_MONTHS).join('|')})(?:\\s+\\d{4})?\\b`,
        'gi',
      ),
      ' ',
    );
  let m: RegExpExecArray | null;
  LODZ_LINE_RE.lastIndex = 0;
  while ((m = LODZ_LINE_RE.exec(text))) {
    const tok = m[1].toUpperCase();
    const before = text[m.index - 1];
    const after = text[m.index + m[1].length];
    if (before === ':' || after === ':') continue;
    if (/^\d+$/.test(tok)) {
      const n = Number(tok);
      if (n < 1 || n > 999) continue;
    }
    if (!seen.has(tok)) seen.add(tok);
    if (seen.size >= 12) break;
  }
  LODZ_SINGLE_RE.lastIndex = 0;
  while ((m = LODZ_SINGLE_RE.exec(text))) {
    const tok = m[1].toUpperCase();
    if (!seen.has(tok)) seen.add(tok);
    if (seen.size >= 12) break;
  }
  return [...seen];
}

/** RSS MPK Łódź linkuje po http://; Android blokuje cleartext w release. */
function httpsLodzUrl(url: string): string {
  return url.replace(/^http:\/\/(?:www\.)?mpk\.lodz\.pl\//i, 'https://mpk.lodz.pl/');
}

/**
 * Komunikaty MPK Łódź (RSS 2.0 bez pubDate: datę niesie treść opisu).
 * Tytuły w kanale są generyczne ("Aktualne zmiany..."), więc tytuł karty
 * budujemy z nich plus numery linii; sam opis ląduje w karcie w całości.
 */
export function parseMpkLodzRss(xml: string): MpkNewsItem[] {
  const items: MpkNewsItem[] = [];
  const blocks = xml.match(/<item[\s\S]*?<\/item>/gi) ?? [];
  for (const b of blocks) {
    const rawTitle = decodeEntities(stripCdata(tagInner(b, 'title'))).replace(/\s+/g, ' ').trim();
    const link = httpsLodzUrl(stripCdata(tagInner(b, 'link') || tagInner(b, 'guid')).trim());
    const rawDesc = stripCdata(tagInner(b, 'description'));
    const text = htmlToText(rawDesc).replace(/\s+/g, ' ').trim().slice(0, 600);
    if (!rawTitle && !link && !text) continue;
    // Zwykły tekst, nie HTML: w hrefach siedzą numery lineId (np. 904),
    // które nie są liniami.
    const lines = extractLodzLines(rawTitle, text);
    const title =
      lines.length > 0
        ? `${cleanNewsTitle(rawTitle)}: ${lines.slice(0, 10).join(', ')}`
        : cleanNewsTitle(text.slice(0, 140) || rawTitle);
    const pubDate = parseLodzDate(text);
    if (!title && !link) continue;
    items.push({
      id: link || `${title}-${pubDate ?? ''}`,
      title: title || newsTitleFallback(),
      link,
      description: text,
      imageUrl: extractImage(rawDesc),
      urgent: isUrgentNews(title, text),
      pubDate,
      dateLabel: formatNewsDate(pubDate),
      source: 'mpk',
      lines,
    });
  }
  return items;
}

/**
 * Linie ZTM Kielce z routes.txt feedu GTFS: 0W/0Z, dzienne 1-54 (bez 3, 6,
 * 15, 17, 20, 22, 37, 39, 40, 42, 48, 49, 52), podmiejskie 102-114 (tylko
 * 102, 103, 104, 107, 108, 112, 114), nocne N1/N2 oraz literowe E/F/T/Z.
 * Gdy ZTM doda linię, dopisz ją tutaj (ta sama konserwacja co regexy
 * linii w innych miastach).
 */
const KIELCE_LINES = new Set([
  '0W', '0Z',
  '1', '2', '4', '5', '7', '8', '9', '10', '11', '12', '13', '14', '16',
  '18', '19', '21', '23', '24', '25', '26', '27', '28', '29', '30', '31',
  '32', '33', '34', '35', '36', '38', '41', '43', '44', '45', '46', '47',
  '50', '51', '53', '54',
  '102', '103', '104', '107', '108', '112', '114',
  'E', 'F', 'N1', 'N2', 'T', 'Z',
]);

const KIELCE_LINE_RE = /(0[WZ]|N[12]|\d{1,3}|[EFTZ])/g;

// Polskie litery to też znaki słowa (ten sam problem co w Szczecinie:
// \b łamie się na „będą”, więc spójnik nie może udawać linii).
const KIELCE_EDGE_RE = /[0-9A-Za-zÀ-ž]/;

// Linie literowe ZTM to E, F, T i Z. Samotne „Z” to jednak częsty przyimek
// na początku zdania („Z uwagi na remont”, „Z dniem 1 listopada”), więc
// literę liczymy tylko w kontekście: po „linia/linii/…” albo w cudzysłowie
// (ZTM pisze „linia „E””).
const KIELCE_LETTER_CTX_RE = /(?:linia|linii|linię|linią|linie|liniami)\s*[„"'(]?$/i;

function extractKielceLines(title: string, description: string): string[] {
  const seen = new Set<string>();
  const text = `${title} ${description}`
    .replace(/\d{1,2}\.\d{1,2}\.\d{2,4}/g, ' ')
    .replace(/\d{1,2}\.\d{1,2}(?!\d)/g, ' ')
    .replace(/\d{1,2}:\d{2}/g, ' ')
    .replace(/\b\d{1,3},\d+\b/g, ' ')
    .replace(/\b\d+\s*\/\s*\d+\b/g, ' ')
    .replace(/\b\d{1,3}\s*(?:min\.|min(?:ut[aeyę]?)?|godz\.|godz(?:in[aeyę]?)?)\b/gi, ' ')
    .replace(/\b\d+\s*[-–—]\s*lecie\b/gi, ' ')
    .replace(new RegExp(`\\b(?:(?:od|do)\\s+)?\\d{1,2}(?:\\s*(?:,|i|do|[-–—])\\s*\\d{1,2})*\\s+(?:${WTP_MONTHS})\\b`, 'gi'), ' ')
    .replace(/\b\d{1,2}\s*[-–—]\s*\d{1,2}\b(?=\s|$)/g, ' ');
  let m: RegExpExecArray | null;
  KIELCE_LINE_RE.lastIndex = 0;
  while ((m = KIELCE_LINE_RE.exec(text))) {
    const tok = m[1].toUpperCase();
    const before = text[m.index - 1] ?? '';
    const after = text[m.index + m[1].length] ?? '';
    if (KIELCE_EDGE_RE.test(before) || KIELCE_EDGE_RE.test(after)) continue;
    // Litery linii ZTM pisze wielką literą („linia E”), mała to zwykłe słowo.
    if (/^[EFTZ]$/.test(tok) && m[1] !== m[1].toUpperCase()) continue;
    if (/^\d+$/.test(tok)) {
      if (before === ':' || after === ':') continue;
      if (!KIELCE_LINES.has(tok)) continue;
    } else if (!KIELCE_LINES.has(tok)) {
      continue;
    } else if (/^[EFTZ]$/.test(tok)) {
      const ctx = text.slice(Math.max(0, m.index - 14), m.index);
      if (!KIELCE_LETTER_CTX_RE.test(ctx) && !/[„"'(]$/.test(ctx)) continue;
    }
    if (!seen.has(tok)) seen.add(tok);
    if (seen.size >= 12) break;
  }
  return [...seen];
}

/** Data z karty Joomla (time[datetime]: "2026-10-14T13:40:58+02:00"). */
function parseKielceDate(raw: string): number | null {
  if (!raw.trim()) return null;
  const ts = Date.parse(raw.trim());
  return Number.isFinite(ts) ? ts : null;
}

/**
 * Komunikaty ZTM Kielce z listy (jeden fetch: tytuł + link + data + lead).
 * Karta: div.com-content-category-blog__item > h2 z linkiem /aktualnosci/*,
 * time[datetime], lead w pierwszym p za metadanymi, obrazek images/.
 */
export function parseKielceNews(html: string): MpkNewsItem[] {
  // (?!s) omija kontener __items (Joomla), żeby fragmenty były ciałem kart.
  const cards = html.split(/com-content-category-blog__item(?!s)/i).slice(1);
  const items: MpkNewsItem[] = [];
  for (const card of cards) {
    // Tytuł to pierwszy link /aktualnosci/*.html z tekstem. Gdyby ZTM
    // podlinkował grafikę karty, sam obrazek nie może przejąć tytułu.
    const linkRe = /<a href="(\/aktualnosci\/[^"]+\.html)"[^>]*>([\s\S]*?)<\/a>/gi;
    let href = '';
    let title = '';
    let linkM: RegExpExecArray | null;
    while ((linkM = linkRe.exec(card))) {
      const text = cleanNewsTitle(htmlToText(linkM[2]).replace(/\s+/g, ' ').trim());
      if (!text) continue;
      href = decodeEntities(linkM[1]).trim();
      title = text;
      break;
    }
    if (!href) continue;
    const link = `https://ztm.kielce.pl${href}`;
    const datetime = (card.match(/<time datetime="([^"]+)"[^>]*>/i) ?? [])[1] ?? '';
    const pubDate = parseKielceDate(datetime);
    const afterMeta = card.split(/<\/dl>/i)[1] ?? card;
    const lead = htmlToText((afterMeta.match(/<p>([\s\S]*?)<\/p>/i) ?? [])[1] ?? '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 600);
    const rawImage = extractImage(card);
    const imageUrl = rawImage && rawImage.startsWith('/') ? `https://ztm.kielce.pl${rawImage}` : rawImage;
    items.push({
      id: link,
      title,
      link,
      description: lead,
      imageUrl,
      urgent: isUrgentNews(title, lead),
      pubDate,
      dateLabel: formatNewsDate(pubDate),
      source: 'mpk',
      lines: extractKielceLines(title, lead),
    });
  }
  return items;
}

/**
 * Treść artykułu ZTM: akapity i listy z div.com-content-article__body.
 * Tytuł (h1) pomijamy, bo ekran pokazuje go sam. Panel rozkładu
 * (div.rozklad_jazdy_aticle z linkami linii i schematami objazdów) wycinamy:
 * numery linii siedzą już w tekście, a alty schematów to szum.
 */
function extractKielceArticle(html: string): ArticleBlock[] {
  const blocks: ArticleBlock[] = [];
  const body = (html.split(/com-content-article__body/i)[1] ?? '')
    .split(/rp-sidebarright/i)[0];
  if (!body.trim()) return blocks;
  const frag = body
    .replace(/<div class="rozklad_jazdy_aticle"[\s\S]*$/i, ' ')
    .replace(/<h1\b[^>]*>[\s\S]*?<\/h1>/i, ' ');
  const clean = scrubArticleHtml(frag);
  if (!clean.trim()) return blocks;
  const re = /<(h[1-6]|p|li)\b[^>]*>([\s\S]*?)<\/\1>/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(clean))) {
    const text = htmlToText(match[2]).replace(/\s+/g, ' ').trim();
    if (!text || ARTICLE_JUNK_RE.test(text)) continue;
    const tag = match[1].toLowerCase();
    blocks.push({ kind: tag.startsWith('h') ? 'h' : 'p', text });
  }
  return blocks;
}

/**
 * Numery linii ZDiTM Szczecin w tekście: pospieszne A–C, tramwaje 1–12,
 * autobusy dzienne, podmiejskie 221–244, nocne 521–536 oraz 904/908
 * (dokładnie te z routes.txt feedu GTFS, z dziurami jak 4 czy 55).
 * Bez flagi `i` w klasie liter: spójnik „a” nie może udawać linii A,
 * a ZDiTM pisze litery linii wielką literą („linia A”).
 * Daty, godziny („24.10”, „13 października”, „08:55”), numery komunikatów
 * („201/26”) i czasy przejazdu („co 10 minut”) wycinamy wcześniej, a resztę
 * liczb z tekstu odsiewa walidacja numerów.
 */
const SZCZECIN_LINE_RE = /([ABC]|\d{1,3})/g;

/**
 * Granice tokenu po polsku: `\b` w JS zna tylko ASCII, więc „będą” łamie
 * się na „b” i „ę” (ę nie jest znakiem słowa) i „b” udawałoby linię B
 * (tak samo „aż” przy linii A). Ta klasa traktuje polskie litery jak
 * znaki słowa po obu stronach dopasowania.
 */
const SZCZECIN_EDGE_RE = /[0-9A-Za-zÀ-ž]/;

function isSzczecinLineNumber(n: number): boolean {
  // Dziury w numeracji z routes.txt: brak 4 wśród tramwajów oraz 55, 71,
  // 81, 83, 100, 104, 105 i 108 wśród autobusów. Gdy ZDiTM doda linię,
  // dopisz ją tutaj (ta sama konserwacja co regexy linii w innych miastach).
  if (n >= 1 && n <= 12) return n !== 4;
  if (n >= 51 && n <= 99) return n !== 55 && n !== 71 && n !== 81 && n !== 83;
  if (n === 101 || n === 102 || n === 103 || n === 106 || n === 107 || n === 109) return true;
  if (n >= 221 && n <= 227) return true;
  if (n >= 241 && n <= 244) return true;
  if (n >= 521 && n <= 536) return true;
  return n === 904 || n === 908;
}

function extractSzczecinLines(title: string, description: string): string[] {
  const seen = new Set<string>();
  const text = `${title} ${description}`
    .replace(/\d{1,2}\.\d{1,2}\.\d{2,4}/g, ' ')
    .replace(/\d{1,2}\.\d{1,2}(?!\d)/g, ' ')
    .replace(/\d{1,2}:\d{2}/g, ' ')
    // Ułamki dziesiętne z przecinkiem („12,5 mln zł”) to nie linia 12.
    .replace(/\b\d{1,3},\d+\b/g, ' ')
    // Numery komunikatów („KOMUNIKAT 201/26”) to nie pary linii.
    .replace(/\b\d+\s*\/\s*\d+\b/g, ' ')
    // Czasy przejazdu („co 10 minut”, „co 20 min”, „2 godziny”) to nie linie.
    .replace(/\b\d{1,3}\s*(?:min\.|min(?:ut[aeyę]?)?|godz\.|godz(?:in[aeyę]?)?)\b/gi, ' ')
    .replace(/\b\d+\s*[-–—]\s*lecie\b/gi, ' ')
    .replace(new RegExp(`\\b(?:(?:od|do)\\s+)?\\d{1,2}(?:\\s*(?:,|i|do|[-–—])\\s*\\d{1,2})*\\s+(?:${WTP_MONTHS})\\b`, 'gi'), ' ')
    .replace(/\b\d{1,2}\s*[-–—]\s*\d{1,2}\b(?=\s|$)/g, ' ');
  let m: RegExpExecArray | null;
  SZCZECIN_LINE_RE.lastIndex = 0;
  while ((m = SZCZECIN_LINE_RE.exec(text))) {
    const tok = m[1].toUpperCase();
    const before = text[m.index - 1] ?? '';
    const after = text[m.index + m[1].length] ?? '';
    if (SZCZECIN_EDGE_RE.test(before) || SZCZECIN_EDGE_RE.test(after)) continue;
    if (/^\d+$/.test(tok)) {
      if (before === ':' || after === ':') continue;
      if (!isSzczecinLineNumber(Number(tok))) continue;
    }
    if (!seen.has(tok)) seen.add(tok);
    if (seen.size >= 12) break;
  }
  return [...seen];
}

/** Data z karty ZDiTM (time[datetime]: "2026-10-15T14:16:00+02:00"). */
function parseSzczecinDate(raw: string): number | null {
  if (!raw.trim()) return null;
  const ts = Date.parse(raw.trim());
  return Number.isFinite(ts) ? ts : null;
}

/**
 * Komunikaty ZDiTM Szczecin z listy (jeden fetch: tytuł + link + data
 * + lead). Karta: div.card > h2.h5 z a.stretched-link, time[datetime],
 * p.card-text. Linki archiwum (bez stretched-link) pomijamy.
 */
/**
 * Numery linii MZDiK Radom w tekście: dzienne 1-27 i nocne N1-N3
 * (dokładnie te z routes.txt feedu GTFS). Daty liczbowe ("15.10.2026",
 * "14 na 15.10"), godziny ("23:20-4:20", "23:03"), daty słowne
 * ("14 na 15 października"), nazwy ulic z liczebnikami ("25 Czerwca",
 * "11 Listopada", "1 Maja" łapie wzorzec daty z miesiącem) i numery
 * słupków z wiodącym zerem ("Limanowskiego / Wałowa 01") wycinamy
 * wcześniej albo odsiewamy walidacją, a resztę liczb z tekstu odsiewa
 * zakres 1-27.
 */
const RADOM_LINE_RE = /\b(N[1-3]|\d{1,2})\b/gi;

function isRadomLineNumber(n: number): boolean {
  return n >= 1 && n <= 27;
}

function extractRadomLines(title: string, description: string): string[] {
  const seen = new Set<string>();
  const text = `${title} ${description}`
    .replace(/\d{1,2}\.\d{1,2}\.\d{2,4}/g, ' ')
    .replace(/\d{1,2}\.\d{1,2}(?!\d)/g, ' ')
    .replace(/\d{1,2}:\d{2}/g, ' ')
    // Ułamki („12,5 mln zł”, „1,5 godziny”) to nie linie; przecinek musi
    // sklejać cyfry, spacja po przecinku znaczy listę linii.
    .replace(/\b\d{1,2},\d+\b/g, ' ')
    .replace(/\b\d+\s*[-–—]\s*lecie\b/gi, ' ')
    .replace(new RegExp(`\\b(?:(?:od|do|z|na)\\s+)?\\d{1,2}(?:\\s*(?:,|i|do|na|[-–—])\\s*\\d{1,2})*\\s+(?:${WTP_MONTHS})(?:\\s+\\d{4}(?:\\s*r(?:oku|\\.)?)?)?\\b`, 'gi'), ' ')
    // Dni przy „od/do dnia” bez miesiąca („od dnia 24 i 25.09.2026” po
    // wycięciu daty zostawia gołe 24) i „w nocy z 14 na 15” (zostawia 14).
    .replace(/\b(?:od|do)\s+(?:dnia\s+)?\d{1,2}\b/gi, ' ')
    .replace(/\bz\s+\d{1,2}\s+na\b/gi, ' ')
    .replace(/\b\d{1,2}\s*[-–—]\s*\d{1,2}\b(?=\s|$)/g, ' ');
  let m: RegExpExecArray | null;
  RADOM_LINE_RE.lastIndex = 0;
  while ((m = RADOM_LINE_RE.exec(text))) {
    const tok = m[1].toUpperCase();
    const before = text[m.index - 1] ?? '';
    const after = text[m.index + m[1].length] ?? '';
    if (/^\d+$/.test(tok)) {
      if (before === ':' || after === ':') continue;
      // Numery słupków ("przystanek 01", "Wałowa 01 i 02") to nie linie:
      // prawdziwe linie nie zaczynają się od zera.
      if (/^0\d+$/.test(tok)) continue;
      if (!isRadomLineNumber(Number(tok))) continue;
    }
    if (!seen.has(tok)) seen.add(tok);
    if (seen.size >= 12) break;
  }
  return [...seen];
}

/** Data z tytułu komunikatu MZDiK ("od dnia 6.10.2026", "z 14 na 15.10.2026"). */
function parseRadomDate(title: string): number | null {
  const m = title.match(/(\d{1,2})\.(\d{1,2})\.(\d{4})/);
  if (!m) return null;
  const ts = new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]), 8, 0, 0).getTime();
  return Number.isFinite(ts) ? ts : null;
}

/**
 * Komunikaty MZDiK Radom z listy (jeden fetch: tytuł + link + lead).
 * Karta: article.section__article > h3.article__header z a[href^=komunikaty/]
 * (link względny!) i div.article__info z leadem. Daty na karcie nie ma,
 * więc bierzemy ją z tytułu; obrazek pomijamy (pasek 500x50, nie hero).
 */
export function parseMzdikRadomKomunikaty(html: string): MpkNewsItem[] {
  const cards = html.split(/<article class="section__article"/i).slice(1);
  const items: MpkNewsItem[] = [];
  for (const card of cards) {
    const linkM = card.match(
      /<h3[^>]*class="article__header"[^>]*>[\s\S]*?<a href="(komunikaty\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/i,
    );
    if (!linkM) continue;
    const link = `https://mzdik.pl/${decodeEntities(linkM[1]).trim()}`;
    const rawTitle = htmlToText(linkM[2]).replace(/\s+/g, ' ').trim();
    const title = cleanNewsTitle(rawTitle);
    const pubDate = parseRadomDate(rawTitle);
    const lead = htmlToText((card.match(/<div class="article__info">([\s\S]*?)<\/div>/i) ?? [])[1] ?? '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 600);
    if (!title) continue;
    items.push({
      id: link,
      title,
      link,
      description: lead,
      imageUrl: null,
      urgent: isUrgentNews(title, lead),
      pubDate,
      dateLabel: formatNewsDate(pubDate),
      source: 'mpk',
      lines: extractRadomLines(title, lead),
    });
  }
  return items;
}

/**
 * Treść komunikatu MZDiK: lead z div.standard-page__intro plus akapity
 * z div.content. Tytuł (h1) pomijamy, bo ekran pokazuje go sam. Panel
 * boczny z listą innych komunikatów (aside.page-content__aside) leży poza
 * section, więc odpada sam; okruszki wycinamy z nagłówkiem.
 */
function extractMzdikRadomArticle(html: string): ArticleBlock[] {
  const blocks: ArticleBlock[] = [];
  const section = (html.split(/<section aria-labelledby="section-heading">/i)[1]?.split(/<\/section>/i)[0] ?? '')
    .replace(/<header\b[\s\S]*?<\/header>/i, ' ');
  if (!section.trim()) return blocks;
  const lead = htmlToText((section.match(/<div class="standard-page__intro">([\s\S]*?)<\/div>/i) ?? [])[1] ?? '')
    .replace(/\s+/g, ' ')
    .trim();
  if (lead) blocks.push({ kind: 'p', text: lead });
  const content = (section.match(/<div class="content">([\s\S]*?)<\/div>/i) ?? [])[1] ?? section;
  const re = /<(h[1-6]|p|li)\b[^>]*>([\s\S]*?)<\/\1>/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(content))) {
    const text = htmlToText(match[2]).replace(/\s+/g, ' ').trim();
    if (!text || ARTICLE_JUNK_RE.test(text) || text === lead) continue;
    const tag = match[1].toLowerCase();
    blocks.push({ kind: tag.startsWith('h') ? 'h' : 'p', text });
  }
  return blocks;
}

export function parseSzczecinInfo(html: string): MpkNewsItem[] {
  const cards = html.split(/<div class="card shadow img-hover/i).slice(1);
  const items: MpkNewsItem[] = [];
  for (const card of cards) {
    const linkM = card.match(
      /<a href="(https:\/\/www\.zditm\.szczecin\.pl\/pl\/pasazer\/informacje\/[^"]+)"[^>]*class="stretched-link"[^>]*>([\s\S]*?)<\/a>/i,
    );
    if (!linkM) continue;
    const link = decodeEntities(linkM[1]).trim();
    // Link „Archiwalne” z menu (gdyby wpadł w kartę) to nie komunikat.
    if (/\/archiwum\/?$/.test(link)) continue;
    const rawTitle = htmlToText(linkM[2]).replace(/\s+/g, ' ').trim();
    const title = cleanNewsTitle(rawTitle);
    const datetime = (card.match(/<time datetime="([^"]+)"[^>]*>/i) ?? [])[1] ?? '';
    const pubDate = parseSzczecinDate(datetime);
    const lead = htmlToText((card.match(/<p class="card-text[^"]*">([\s\S]*?)<\/p>/i) ?? [])[1] ?? '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 600);
    // Hero obrazki ZDiTM są serwowane ścieżką względną (/storage/media/...),
    // a aplikacja potrzebuje absolutnego URL, inaczej obrazek się nie wczyta.
    const rawImage = extractImage(card);
    const imageUrl = rawImage && rawImage.startsWith('/') ? `https://www.zditm.szczecin.pl${rawImage}` : rawImage;
    if (!title) continue;
    items.push({
      id: link,
      title,
      link,
      description: lead,
      imageUrl,
      urgent: isUrgentNews(title, lead),
      pubDate,
      dateLabel: formatNewsDate(pubDate),
      source: 'mpk',
      lines: extractSzczecinLines(title, lead),
    });
  }
  return items;
}

/**
 * Numery linii ZDZiT Olsztyn w tekście: tramwaje 1–5, autobusy dzienne
 * 101–145 (z dziurami jak 102 czy 104), 205, akademickie 303–305 oraz
 * nocne N01/N02 (dokładnie te z routes.txt feedu GTFS, stan na 2026-10).
 * Gdy ZDZiT doda linię, dopisz ją tutaj (ta sama konserwacja co regexy
 * linii w innych miastach). Daty („19 października”, „03-04.10.2026”),
 * godziny („9 – 19”), lata („2026 roku”) i numery pętli wycinamy
 * wcześniej, a resztę liczb z tekstu odsiewa walidacja numerów.
 */
const OLSZTYN_LINE_RE = /\b(N0?[12]|\d{1,3}[A-Z]?)\b/gi;

function isOlsztynLineNumber(n: number): boolean {
  // Dokładnie te z routes.txt feedu (stan na 2026-10): tramwaje 1–5,
  // autobusy 101, 103, 105–115, 117, 119, 121, 124–128, 130–132, 135,
  // 136, 141, 145, 205 i akademickie 303–305. Brak m.in. 102, 104, 116,
  // 118, 120, 122 i 129.
  if (n >= 1 && n <= 5) return true;
  if (n === 101 || n === 103) return true;
  if (n >= 105 && n <= 115) return true;
  if (n === 117 || n === 119 || n === 121) return true;
  if (n >= 124 && n <= 128) return true;
  if (n >= 130 && n <= 132) return true;
  if (n === 135 || n === 136 || n === 141 || n === 145) return true;
  if (n === 205) return true;
  if (n >= 303 && n <= 305) return true;
  return false;
}

function extractOlsztynLines(title: string, description: string): string[] {
  const seen = new Set<string>();
  const text = `${title} ${description}`
    // Zakresy dat („03-04.10.2026”, „28.09-02.10”) przed pojedynczymi datami,
    // inaczej po odcięciu pełnej daty zostaje goły „03” i wchodzi jak tramwaj.
    .replace(/\d{1,2}\s*[-–—]\s*\d{1,2}\.\d{1,2}\.\d{2,4}/g, ' ')
    .replace(/\d{1,2}\.\d{1,2}\s*[-–—]\s*\d{1,2}\.\d{1,2}(?!\d)/g, ' ')
    .replace(/\d{1,2}\.\d{1,2}\.\d{2,4}/g, ' ')
    .replace(/\d{1,2}\.\d{1,2}(?!\d)/g, ' ')
    .replace(/\d{1,2}:\d{2}/g, ' ')
    .replace(/\b\d{1,3},\d+\b/g, ' ')
    .replace(/\b\d+\s*\/\s*\d+\b/g, ' ')
    .replace(/\b\d{1,3}\s*(?:min\.|min(?:ut[aeyę]?)?|godz\.|godz(?:in[aeyę]?)?)\b/gi, ' ')
    .replace(/\b\d+\s*[-–—]\s*lecie\b/gi, ' ')
    .replace(new RegExp(`\\b(?:(?:od|do|dnia)\\s+)?\\d{1,2}(?:\\s*(?:,|i|do|[-–—])\\s*\\d{1,2})*\\s+(?:${WTP_MONTHS})\\b`, 'gi'), ' ')
    .replace(/\b\d{1,2}\s*[-–—]\s*\d{1,2}\b(?=\s|$)/g, ' ')
    .replace(/\b\d{4}\s*r(?:oku)?\.?/gi, ' ');
  let m: RegExpExecArray | null;
  OLSZTYN_LINE_RE.lastIndex = 0;
  while ((m = OLSZTYN_LINE_RE.exec(text))) {
    const tok = m[1].toUpperCase();
    const before = text[m.index - 1];
    const after = text[m.index + m[1].length];
    if (before === ':' || after === ':') continue;
    if (/^N/i.test(tok)) {
      // Nocne N01/N02 (feed pisze też N1/N2): normalizujemy do N01/N02.
      const digits = tok.replace(/\D/g, '');
      const num = Number(digits);
      if (num !== 1 && num !== 2) continue;
      const norm = `N0${num}`;
      if (!seen.has(norm)) seen.add(norm);
      if (seen.size >= 12) break;
      continue;
    }
    // Sufiks literowy („304A”) to nie linia Olsztyna: bierzemy same liczby.
    if (!/^\d+$/.test(tok)) continue;
    if (!isOlsztynLineNumber(Number(tok))) continue;
    if (!seen.has(tok)) seen.add(tok);
    if (seen.size >= 12) break;
  }
  return [...seen];
}

/**
 * Numery linii BKM Białystok w tekście: J/J1–J6 (meczowe), N1–N6 (nocne)
 * i zwykłe 1–999 (BKM ma linie 1–30, 33, 50 i 100–142). Miasto jest w pełni
 * autobusowe, więc każda liczba to kandydat na linię. Daty, godziny, ułamki
 * („12,5 mln”), czasy przejazdu („co 10 minut”), lata i numery komunikatów
 * wycinamy wcześniej. Litery linii tylko wielką literą (jak w Szczecinie:
 * „spójnik j” to nie linia J), a token musi stać na granicy słowa.
 */
const BIALYSTOK_LINE_RE = /(J[1-6]?|N[1-6]|\d{1,3})/g;

/**
 * Granice tokenu jak w Szczecinie: polskie litery to znaki słowa.
 * Sprawdzane dla każdego dopasowania, też liczb: „S19” to nie linia 19.
 */
const BIALYSTOK_EDGE_RE = /[0-9A-Za-zÀ-ž]/;

function extractBialystokLines(title: string, description: string): string[] {
  const seen = new Set<string>();
  const text = `${title} ${description}`
    .replace(/\d{1,2}\.\d{1,2}\.\d{2,4}/g, ' ')
    .replace(/\d{1,2}\.\d{1,2}(?!\d)/g, ' ')
    .replace(/\d{1,2}:\d{2}/g, ' ')
    // Ułamki dziesiętne z przecinkiem („12,5 mln zł”) to nie linie 12 i 5.
    .replace(/\b\d{1,3},\d+\b/g, ' ')
    // Czasy przejazdu („co 10 minut”, „co 20 min”) to nie linie.
    .replace(/\b\d{1,3}\s*(?:min\.|min(?:ut[aeyę]?)?|godz\.|godz(?:in[aeyę]?)?)\b/gi, ' ')
    // Lata („2026 r.”, „2026”): Białystok nie ma linii 4-cyfrowych
    // (maks. 999), więc wycinamy je wprost, inaczej „2026” dałoby
    // linie 202 i 6.
    .replace(/\b\d{4}\b/g, ' ')
    .replace(/\b\d+\s*\/\s*\d+\b/g, ' ')
    .replace(/\b\d+\s*[-–—]\s*lecie\b/gi, ' ')
    .replace(new RegExp(`\\b(?:(?:od|do)\\s+)?\\d{1,2}(?:\\s*(?:,|i|do|[-–—])\\s*\\d{1,2})*\\s+(?:${WTP_MONTHS})\\b`, 'gi'), ' ')
    .replace(/\b\d{1,2}\s*[-–—]\s*\d{1,2}\b(?=\s|$)/g, ' ');
  let m: RegExpExecArray | null;
  BIALYSTOK_LINE_RE.lastIndex = 0;
  while ((m = BIALYSTOK_LINE_RE.exec(text))) {
    const tok = m[1].toUpperCase();
    const before = text[m.index - 1] ?? '';
    const after = text[m.index + m[1].length] ?? '';
    // „Jagiellonii” to nie linia J, „S19” to nie linia 19.
    if (BIALYSTOK_EDGE_RE.test(before) || BIALYSTOK_EDGE_RE.test(after)) continue;
    if (/^\d+$/.test(tok)) {
      if (before === ':' || after === ':') continue;
      const n = Number(tok);
      if (n < 1 || n > 999) continue;
    }
    if (!seen.has(tok)) seen.add(tok);
    if (seen.size >= 12) break;
  }
  return [...seen];
}

/**
 * Komunikaty ZDZiT Olsztyn (RSS 2.0 WordPressa: tytuł + link + pubDate
 * + opis). Kanał miesza drogi z komunikacją, więc odsiewamy po słowach
 * jak miejski RSS Wrocławia (sprzedaż VW Transportera i LED-y na Jarotach
 * to nie komunikaty dla pasażera). Opis z feedu ląduje w karcie.
 */
export function parseZdzitOlsztynRss(xml: string): MpkNewsItem[] {
  const items: MpkNewsItem[] = [];
  const blocks = xml.match(/<item[\s\S]*?<\/item>/gi) ?? [];
  for (const b of blocks) {
    const rawTitle = decodeEntities(stripCdata(tagInner(b, 'title'))).replace(/\s+/g, ' ').trim();
    const title = cleanNewsTitle(rawTitle);
    const link = stripCdata(tagInner(b, 'link')).trim();
    const rawDesc = stripCdata(tagInner(b, 'description') || tagInner(b, 'content:encoded'));
    const description = htmlToText(rawDesc).slice(0, 600);
    const pubRaw = stripCdata(tagInner(b, 'pubDate')).trim();
    const ts = pubRaw ? Date.parse(pubRaw) : NaN;
    const pubDate = Number.isFinite(ts) ? ts : null;
    if (!title && !link) continue;
    if (!isTransitNews(rawTitle, description)) continue;
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
      lines: extractOlsztynLines(title, description),
    });
  }
  return items;
}

/** Data z listy BKM (div.news__date: "14.10.2026 09:53", czas lokalny). */
function parseBialystokDate(raw: string): number | null {
  const m = raw.trim().match(/(\d{1,2})\.(\d{1,2})\.(\d{4})(?:\s+(\d{1,2}):(\d{2}))?/);
  if (!m) return null;
  const ts = new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]), Number(m[4] ?? 8), Number(m[5] ?? 0), 0).getTime();
  return Number.isFinite(ts) ? ts : null;
}

/**
 * Komunikaty BKM Białystok z listy (jeden fetch: tytuł + link + data).
 * Pozycja: li.news__item > div.news__date + h2 > a.news__title (href
 * względny, pełny tytuł w atrybucie title). Leady news__lead są puste,
 * więc opis karty zostaje pusty, a linie idą z tytułu.
 */
export function parseBialystokNews(html: string): MpkNewsItem[] {
  const items: MpkNewsItem[] = [];
  const blocks = html.match(/<li class="news__item">[\s\S]*?<\/li>/gi) ?? [];
  for (const b of blocks) {
    const linkM = b.match(/<a class="news__title" href="([^"]+)"[^>]*title="([^"]*)"/i);
    if (!linkM) continue;
    const rawHref = decodeEntities(linkM[1]).trim();
    const link = rawHref.startsWith('http') ? rawHref : `https://komunikacja.bialystok.pl${rawHref}`;
    const rawTitle = decodeEntities(linkM[2]).replace(/\s+/g, ' ').trim();
    const title = cleanNewsTitle(rawTitle);
    const dateRaw = decodeEntities((b.match(/<div class="news__date">([^<]*)/i) ?? [])[1] ?? '').trim();
    const pubDate = parseBialystokDate(dateRaw);
    const lead = htmlToText((b.match(/<div class="news__lead">([\s\S]*?)<\/div>/i) ?? [])[1] ?? '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 600);
    if (!title) continue;
    items.push({
      id: link,
      title,
      link,
      description: lead,
      imageUrl: null,
      urgent: isUrgentNews(title, lead),
      pubDate,
      dateLabel: formatNewsDate(pubDate),
      source: 'mpk',
      lines: extractBialystokLines(title, lead),
    });
  }
  return items;
}

/**
 * Treść artykułu BKM: akapity i nagłówki z div.component-content-wysiwyg
 * (treść redakcyjna w div.component-item). Tytuł (h1) pomijamy, bo ekran
 * pokazuje go sam. Stopka (footer z danymi urzędu) leży poza wysiwyg,
 * więc odpada samym zakresem.
 */
function extractBialystokArticle(html: string): ArticleBlock[] {
  const blocks: ArticleBlock[] = [];
  const wysiwyg = html.split(/component-content-wysiwyg/i)[1]?.split(/Cms_Attachment|Cms_Gallery|<footer/i)[0] ?? '';
  if (!wysiwyg.trim()) return blocks;
  const frag = wysiwyg.replace(/<h1\b[^>]*>[\s\S]*?<\/h1>/i, ' ');
  const re = /<(h[1-6]|p|li)\b[^>]*>([\s\S]*?)<\/\1>/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(frag))) {
    const text = htmlToText(match[2]).replace(/\s+/g, ' ').trim();
    if (!text || ARTICLE_JUNK_RE.test(text)) continue;
    const tag = match[1].toLowerCase();
    blocks.push({ kind: tag.startsWith('h') ? 'h' : 'p', text });
  }
  return blocks;
}

/**
 * Numery linii MZK Opole w tekście: nocne N1–N2, specjalne S1–S2, szkolne
 * SZ1–SZ20 oraz dzienne 1–80. Te ostatnie walidujemy po routes.txt feedu
 * GTFS (dokładnie te, bez dziur do dopisywania: brak m.in. 2, 4, 6, 19,
 * 20 i 22–29), bo gołe liczby w komunikatach to często coś innego niż
 * linie. Linie literowe przyjmujemy wzorcem (MZK dowozi nimi okazjonalne
 * kursy specjalne spoza statycznego GTFS).
 * Daty („11.10”, „3 października”, „1 Maja”), godziny („18:56”, a także
 * literówka „16;36” z feedu), liczby kursów („13 par kursów”), odległości
 * („80 metrów”) i liczby przystanków („106 przystanków”) wycinamy
 * wcześniej, a resztę liczb z tekstu odsiewa walidacja numerów.
 */
const OPOLE_LINE_RE = /\b(SZ\d{1,2}|S\d{1,2}|N\d{1,2}|\d{1,3})\b/gi;

/** Dzienne linie MZK Opole z routes.txt feedu GTFS (wszystkie route_type 3). */
const OPOLE_DAY_LINES = new Set([
  1, 3, 5, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 21, 25, 28, 30, 80,
]);

function extractOpoleLines(title: string, description: string): string[] {
  const seen = new Set<string>();
  const text = `${title} ${description}`
    .replace(/\d{1,2}\.\d{1,2}\.\d{2,4}/g, ' ')
    .replace(/\d{1,2}\.\d{1,2}(?!\d)/g, ' ')
    // Średnik obok dwukropka: feed MZK pisze czasem „16;36” zamiast „16:36”,
    // a gołe „16” wygląda wtedy jak linia 16.
    .replace(/\d{1,2}[;:]\d{2}/g, ' ')
    .replace(/\b\d{1,3},\d+\b/g, ' ')
    .replace(/\b\d+\s*\/\s*\d+\b/g, ' ')
    .replace(/\b\d{1,3}\s*(?:min\.|min(?:ut[aeyę]?)?|godz\.|godz(?:in[aeyę]?)?)\b/gi, ' ')
    .replace(/\b\d{1,3}\s*par(y|a)?\b/gi, ' ')
    .replace(/\b\d{1,3}\s*metr\w*\b/gi, ' ')
    .replace(/\b\d{1,3}\s*przystan\w*\b/gi, ' ')
    .replace(/\b\d+\s*[-–—]\s*lecie\b/gi, ' ')
    .replace(new RegExp(`\\b(?:(?:od|do)\\s+)?\\d{1,2}(?:\\s*(?:,|i|do|[-–—])\\s*\\d{1,2})*\\s+(?:${WTP_MONTHS})\\b`, 'gi'), ' ')
    .replace(/\b\d{1,2}\s*[-–—]\s*\d{1,2}\b(?=\s|$)/g, ' ');
  let m: RegExpExecArray | null;
  OPOLE_LINE_RE.lastIndex = 0;
  while ((m = OPOLE_LINE_RE.exec(text))) {
    const tok = m[1].toUpperCase();
    const before = text[m.index - 1];
    const after = text[m.index + m[1].length];
    if (before === ':' || after === ':') continue;
    if (/^\d+$/.test(tok)) {
      if (!OPOLE_DAY_LINES.has(Number(tok))) continue;
    }
    if (!seen.has(tok)) seen.add(tok);
    if (seen.size >= 12) break;
  }
  return [...seen];
}

/**
 * Opisy RSS MZK kończą się śmieciami motywu WordPressa: linkiem
 * „czytaj dalej … »” (div.w-100.text-end z a.more-link) i tekstem
 * „Wyświetl mniej” z rozwijanego wpisu. Obcinamy je przed htmlToText,
 * bo inaczej lądują na końcu karty komunikatu.
 */
function scrubOpoleDescription(html: string): string {
  return html
    .replace(/<div class="w-100 text-end[^"]*">[\s\S]*?<\/div>/gi, ' ')
    .replace(/Wyświetl mniej/gi, ' ');
}

/**
 * Komunikaty MZK Opole (RSS 2.0 kategorii Aktualności: tytuł + link +
 * pubDate + opis). Cała kategoria dotyczy pasażera, więc nie filtrujemy
 * po słowach jak miejski RSS Wrocławia. Opis z feedu ląduje w karcie.
 */
export function parseOpoleRss(xml: string): MpkNewsItem[] {
  const items: MpkNewsItem[] = [];
  const blocks = xml.match(/<item[\s\S]*?<\/item>/gi) ?? [];
  for (const b of blocks) {
    const rawTitle = decodeEntities(stripCdata(tagInner(b, 'title'))).replace(/\s+/g, ' ').trim();
    const title = cleanNewsTitle(rawTitle);
    const link = stripCdata(tagInner(b, 'link')).trim();
    const rawDesc = stripCdata(tagInner(b, 'description'));
    const description = htmlToText(scrubOpoleDescription(rawDesc)).slice(0, 600);
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
      lines: extractOpoleLines(title, description),
    });
  }
  return items;
}

/**
 * Numery linii ZDiTM Lublin wprost z routes.txt feedu GTFS (bez 0Bia/0GAJ/
 * 0Zie i imiennych Biała/Gaj/Zielona, te idą osobnym kontekstem niżej).
 * Dziury w numeracji: brak 9–11, 19, 27, 41, 46, 48–49, 51, 53, 56, 58–69,
 * 71–72, 75–77, 80–84 oraz 152 wśród trolejbusów. Gdy ZDiTM doda linię
 * (np. zapowiedziane 801 na Biskupie), dopisz ją tutaj (ta sama
 * konserwacja co regexy linii w innych miastach).
 */
const LUBLIN_BUS_NUMBERS = new Set([
  2, 3, 4, 5, 6, 7, 8, 12, 13, 14, 15, 16, 17, 18, 20, 21, 22, 23, 24, 25,
  26, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40, 42, 43, 44, 45,
  47, 50, 52, 54, 55, 57, 70, 73, 74, 78, 79, 85, 301, 302, 303, 912, 917, 922,
]);

/** Trolejbusy ZDiTM Lublin z routes.txt (route_type 11, brak 152). */
const LUBLIN_TROLLEY_NUMBERS = new Set([
  150, 151, 153, 154, 155, 156, 157, 158, 159, 160, 161, 162, 950,
]);

const LUBLIN_LINE_RE = /\b(N[1-3]|\d{1,3})\b/gi;

/**
 * Imienne linie specjalne ZDiTM (Biała, Gaj, Zielona) łapiemy wyłącznie
 * po słowach "linii/linia/linie/nr": sam "Gaj" to też dzielnica i słowo
 * ("Stary Gaj"), więc bez kontekstu byłby fałszywym trafieniem w co
 * drugim komunikacie.
 */
const LUBLIN_NAMED_RE = /(?:linii|linia|linie|linię|nr\.?)\s+(biał\w*|gaj\w*|zielon\w*)/gi;

function lublinNamedCanonical(prefix: string): string {
  const p = prefix.toLowerCase();
  if (p.startsWith('biał')) return 'BIAŁA';
  if (p.startsWith('zielon')) return 'ZIELONA';
  return 'GAJ';
}

function extractLublinLines(title: string, description: string): string[] {
  const seen = new Set<string>();
  const text = `${title} ${description}`
    .replace(/\d{1,2}\.\d{1,2}\.\d{2,4}/g, ' ')
    .replace(/\d{1,2}\.\d{1,2}(?!\d)/g, ' ')
    .replace(/\d{1,2}:\d{2}/g, ' ')
    .replace(/\b\d+\s*\/\s*\d+\b/g, ' ')
    // Odjazdy z treści artykułów ("6:38", "Mełgiewska WSEI 01:") padły
    // wyżej z godzinami; numery stanowisk bez dwukropka ("WSEI 01")
    // odsiewa guard zera wiodącego niżej.
    .replace(/\b\d+\s*[-–—]\s*lecie\b/gi, ' ')
    .replace(new RegExp(`\\b(?:(?:od|do)\\s+)?\\d{1,2}(?:\\s*(?:,|i|do|[-–—])\\s*\\d{1,2})*\\s+(?:${WTP_MONTHS})\\b`, 'gi'), ' ')
    .replace(/\b\d{1,2}\s*[-–—]\s*\d{1,2}\b(?=\s|$)/g, ' ');
  // Odwołania do linii z kropką ("linii nr 33.") najpierw tracą kropkę,
  // żeby reguła liczebników niżej ich nie zjadła.
  const dotted = text.replace(
    /((?:linii|linia|linie|linię|nr\.?)\s+)(N[1-3]|\d{1,3}[A-Z]?)\./gi,
    '$1$2 ',
  );
  // Liczebniki porządkowe ("7. Marsz Równości", "7.lubelski Marsz") to nie
  // linie (choć 7 istnieje w GTFS, tu jest siódmą edycją marszu).
  const clean = dotted.replace(/\b\d{1,3}\.(?=[a-ząćęłńóśźż]|\s|$)/gi, ' ');
  let m: RegExpExecArray | null;
  LUBLIN_LINE_RE.lastIndex = 0;
  while ((m = LUBLIN_LINE_RE.exec(clean))) {
    const tok = m[1].toUpperCase();
    const before = clean[m.index - 1] ?? '';
    const after = clean[m.index + m[1].length] ?? '';
    if (before === ':' || after === ':') continue;
    if (/^N[1-3]$/.test(tok)) {
      if (!seen.has(tok)) seen.add(tok);
    } else {
      // Numery stanowisk ("WSEI 01") mają zero wiodące, linie nigdy.
      if (/^0\d+$/.test(tok)) continue;
      const n = Number(tok);
      if (!LUBLIN_BUS_NUMBERS.has(n) && !LUBLIN_TROLLEY_NUMBERS.has(n)) continue;
      if (!seen.has(tok)) seen.add(tok);
    }
    if (seen.size >= 12) break;
  }
  LUBLIN_NAMED_RE.lastIndex = 0;
  while ((m = LUBLIN_NAMED_RE.exec(`${title} ${description}`))) {
    const tok = lublinNamedCanonical(m[1]);
    if (!seen.has(tok)) seen.add(tok);
    if (seen.size >= 12) break;
  }
  return [...seen];
}

/** Data z karty ZDiTM Lublin (h4: "2026-10-15 11:48", czas lokalny). */
function parseLublinDate(raw: string): number | null {
  if (!raw.trim()) return null;
  const ts = Date.parse(raw.trim().replace(' ', 'T'));
  return Number.isFinite(ts) ? ts : null;
}

/**
 * Komunikaty ZDiTM Lublin z listy (jeden fetch: tytuł + link + lead).
 * Karta: article.news > (div.data.nowosc h4 z datą, tylko na pierwszej
 * karcie grupy dnia) + article.tiny > h3.inline, pierwsze p, link
 * "Zobacz więcej" do /pl/aktualnosci/xxx.html. Karty bez daty dziedziczą
 * ostatnią (ta sama grupa dnia na stronie).
 */
export function parseLublinInfo(html: string): MpkNewsItem[] {
  const cards = html.split(/<article class="news">/i).slice(1);
  const items: MpkNewsItem[] = [];
  let lastDate: number | null = null;
  for (const card of cards) {
    const dateRaw = (card.match(/<div class="data nowosc[\s\S]*?<h4>([^<]+)<\/h4>/i) ?? [])[1] ?? '';
    const parsed = parseLublinDate(dateRaw);
    if (parsed != null) lastDate = parsed;
    const tinies = card.split(/<article class="tiny/i).slice(1);
    // Gdyby markup się zmienił i tiny zniknęło, czytamy całą kartę jak jeden item.
    const blocks = tinies.length > 0 ? tinies : [card];
    for (const tiny of blocks) {
      // Ograniczenie (?!<\/a>) pilnuje, żeby „Zobacz więcej” skleiło się
      // z własnym linkiem, a nie z wcześniejszym odnośnikiem z leadu.
      const linkM = tiny.match(
        /<a href="(\/pl\/aktualnosci\/[^"]+\.html)"[^>]*>(?:(?!<\/a>)[\s\S])*?Zobacz więcej/i,
      );
      if (!linkM) continue;
      const link = `https://www.zdtm.lublin.eu${decodeEntities(linkM[1]).trim()}`;
      const rawTitle = htmlToText((tiny.match(/<h3 class="inline">([\s\S]*?)<\/h3>/i) ?? [])[1] ?? '')
        .replace(/\s+/g, ' ')
        .trim();
      const title = cleanNewsTitle(rawTitle);
      const lead = htmlToText((tiny.match(/<p[\s>][\s\S]*?<\/p>/i) ?? [])[0] ?? '')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 600);
      if (!title) continue;
      items.push({
        id: link,
        title,
        link,
        description: lead,
        imageUrl: null,
        urgent: isUrgentNews(title, lead),
        pubDate: lastDate,
        dateLabel: formatNewsDate(lastDate),
        source: 'mpk',
        lines: extractLublinLines(title, lead),
      });
    }
  }
  return items;
}

/**
 * Treść artykułu ZDiTM Lublin: tytuł niesie h2.text-header (ekran pokazuje
 * go sam, więc w treści go pomijamy), akapity i punkty w article.tiny
 * wewnątrz section.main-center-panel. Okruszki (breadcrumb) i prawy panel
 * z logotypami wypadają przez zakres sekcji.
 */
function extractLublinArticle(html: string): ArticleBlock[] {
  const blocks: ArticleBlock[] = [];
  const center =
    html.split(/class="main-center-panel[^>]*>/i)[1]?.split(/main-right-panel/i)[0] ?? '';
  if (!center.trim()) return blocks;
  const frag = center
    .replace(/<ol class="breadcrumb"[\s\S]*?<\/ol>/gi, ' ')
    .replace(/<h2 class="text-header"[\s\S]*?<\/h2>/i, ' ')
    // Cięcie na main-right-panel zostawia niedomknięty tag na końcu.
    .replace(/<[^>]*$/, ' ');
  // Bloki h/p/li zastępujemy znacznikami miejsca (kolejność dokumentu
  // zostaje), a z reszty zbieramy luźny tekst: redakcja ZDiTM czasem
  // wstawia akapit wprost do div, bez p, i regex bloków go nie widzi.
  // Znacznik to \uE000 (private use area, w HTML ZDiTM nie występuje).
  const found: ArticleBlock[] = [];
  const blockRe = /<(h[1-6]|p|li)\b[^>]*>([\s\S]*?)<\/\1>/gi;
  const marked = frag.replace(blockRe, (_full, rawTag: string, inner: string) => {
    const text = htmlToText(inner).replace(/\s+/g, ' ').trim();
    if (!text || ARTICLE_JUNK_RE.test(text)) return ' ';
    found.push({ kind: rawTag.toLowerCase().startsWith('h') ? 'h' : 'p', text });
    return ` \uE000${found.length - 1}\uE000 `;
  });
  const inlineRe = /^<\/?(a|span|strong|em|b|i|u|small|sup|sub)\b/i;
  const tokenRe = /<[^>]+>|\uE000\d+\uE000|[^<\uE000]+/g;
  let loose = '';
  const flushLoose = (): void => {
    const text = htmlToText(loose).replace(/\s+/g, ' ').trim();
    loose = '';
    // Krótkie strzępy to nawigacja i przyciski („Wstecz”, „tutaj”), nie treść.
    if (text.length >= 15 && !ARTICLE_JUNK_RE.test(text)) blocks.push({ kind: 'p', text });
  };
  let match: RegExpExecArray | null;
  while ((match = tokenRe.exec(marked))) {
    const tok = match[0];
    const marker = /^\uE000(\d+)\uE000$/.exec(tok);
    if (marker) {
      flushLoose();
      blocks.push(found[Number(marker[1])]);
      continue;
    }
    if (tok.startsWith('<')) {
      if (!inlineRe.test(tok)) flushLoose();
      continue;
    }
    loose += tok;
  }
  flushLoose();
  return blocks;
}

/**
 * Treść artykułu ZDiTM: lead z div.lead plus sekcje (h2) i akapity treści.
 * Tytuł (h1) pomijamy, bo ekran pokazuje go sam. Odcinamy stopkę
 * „Więcej wiadomości” (powiązane z wiadomosci.szczecin.eu) i nawigację
 * (okruszki, spis treści).
 */
function extractSzczecinArticle(html: string): ArticleBlock[] {
  const blocks: ArticleBlock[] = [];
  // Stopkę powiązanych (wiadomosci.szczecin.eu) odcinamy po nagłówku
  // „Więcej wiadomości ze Szczecina”, a gdyby jego treść się zmieniła,
  // po pierwszym linku do tego portalu. Mobilny spis treści siedzi
  // w offcanvasie na końcu treści (lista bez nagłówka), więc też wypada.
  const main = (html.split(/id="pageContent"/i)[1]?.split(/<\/main>/i)[0] ?? '')
    .split(/Więcej wiadomości/i)[0]
    .split(/wiadomosci\.szczecin\.eu/i)[0]
    .split(/<div class="offcanvas/i)[0];
  if (!main.trim()) return blocks;
  const frag = main
    .replace(/<nav\b[\s\S]*?<\/nav>/gi, ' ')
    .replace(/<h1\b[^>]*>[\s\S]*?<\/h1>/i, ' ');
  const lead = htmlToText((frag.match(/<div class="lead[^"]*">([\s\S]*?)<\/div>/i) ?? [])[1] ?? '')
    .replace(/\s+/g, ' ')
    .trim();
  if (lead) blocks.push({ kind: 'p', text: lead });
  const re = /<(h[1-6]|p|li)\b[^>]*>([\s\S]*?)<\/\1>/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(frag))) {
    const text = htmlToText(match[2]).replace(/\s+/g, ' ').trim();
    if (!text || ARTICLE_JUNK_RE.test(text) || text === lead) continue;
    // Nagłówek hero z datą publikacji („opublikowano: 12 października
    // 2026 08:55”) dubluje etykietę daty, którą ekran pokazuje sam.
    if (/^(spis treści|ta informacja dotyczy linii:?|opublikowano:)/i.test(text)) continue;
    const tag = match[1].toLowerCase();
    blocks.push({ kind: tag.startsWith('h') ? 'h' : 'p', text });
  }
  return blocks;
}

/**
 * Linie ZTM Rzeszów w tekście: dokładnie te z routes.txt feedu GTFS
 * (0A/0B, dzienne 1–62 z dziurami, nocne N1–N3, pracownicze PT).
 * Allowlista zamiast zakresów: „7” czy „21” nie istnieją w GTFS, więc
 * zakres 1–62 puszczałby widma. Gdy ZTM doda linię, dopisz ją tutaj
 * (ta sama konserwacja co numery w innych miastach).
 */
const RZESZOW_LINES = new Set(
  '0A,0B,1,2,3,4,5,6,8,9,10,11,12,13,14,15,16,17,18,19,20,22,23,24,26,27,28,29,30,31,32,33,34,35,36,37,39,40,41,42,43,44,45,46,47,49,51,52,54,57,58,59,60,61,62,N1,N2,N3,PT'.split(','),
);

const RZESZOW_LINE_RE = /(0[AB]|N[123]|PT|\d{1,2})/g;

/**
 * Granice tokenu po polsku (ta sama klasa co Szczecin): `\b` w JS zna
 * tylko ASCII, więc „będą” łamie się na „b” i „ę”. Allowlista i tak
 * odrzuciłaby literę, ale strażnik chroni też cyfry sklejone z tekstem.
 */
const RZESZOW_EDGE_RE = /[0-9A-Za-zÀ-ž]/;

function extractRzeszowLines(title: string, description: string): string[] {
  const seen = new Set<string>();
  const text = `${title} ${description}`
    .replace(/\d{1,2}\.\d{1,2}\.\d{2,4}/g, ' ')
    .replace(/\d{1,2}\.\d{1,2}(?!\d)/g, ' ')
    .replace(/\d{1,2}:\d{2}/g, ' ')
    // Ceny biletów („250,00 zł”) to nie linie.
    .replace(/\b\d{1,3},\d+\b/g, ' ')
    // Numery komunikatów („KOMUNIKAT 201/26”) to nie pary linii.
    .replace(/\b\d+\s*\/\s*\d+\b/g, ' ')
    // Telefony ZTM („17 748 13 45”, komórki „500 100 200”) to nie linie.
    .replace(/\b\d{3}[\s-]?\d{3}[\s-]?\d{3}\b/g, ' ')
    .replace(/\b\d{2}[\s-]?\d{3}[\s-]?\d{2}[\s-]?\d{2}\b/g, ' ')
    // Czasy przejazdu („co 10 minut”) to nie linie.
    .replace(/\b\d{1,3}\s*(?:min\.|min(?:ut[aeyę]?)?|godz\.|godz(?:in[aeyę]?)?)\b/gi, ' ')
    .replace(/\b\d+\s*[-–—]\s*lecie\b/gi, ' ')
    // Daty z nazwą miesiąca („27 września”, „od 1 do 15 października”);
    // WTP_MONTHS to wspólna lista polskich miesięcy w dopełniaczu.
    .replace(new RegExp(`\\b(?:(?:od|do)\\s+)?\\d{1,2}(?:\\s*(?:,|i|do|[-–—])\\s*\\d{1,2})*\\s+(?:${WTP_MONTHS})\\b`, 'gi'), ' ')
    .replace(/\b\d{1,2}\s*[-–—]\s*\d{1,2}\b(?=\s|$)/g, ' ')
    // Ucięty zakres daty z karty WordPressa („… od 1 października 2026 r.
    // do 15 …”): samotne „do 15” zostaje po wycięciu miesiąca i udawałoby linię.
    .replace(/\b(?:od|do)\s+\d{1,2}(?:\s+do\s+\d{1,2})?(?=\s*(?:[.…]|$))/gi, ' ');
  let m: RegExpExecArray | null;
  RZESZOW_LINE_RE.lastIndex = 0;
  while ((m = RZESZOW_LINE_RE.exec(text))) {
    const tok = m[1].toUpperCase();
    const before = text[m.index - 1] ?? '';
    const after = text[m.index + m[1].length] ?? '';
    if (RZESZOW_EDGE_RE.test(before) || RZESZOW_EDGE_RE.test(after)) continue;
    if (/^\d+$/.test(tok)) {
      // Godziny („5:30”) wycinamy wcześniej regexem, więc dwukropek przed
      // tokenem to minuty. Dwukropka PO tokenie nie odrzucamy: ZTM pisze
      // „Linia 2: Baligrodzka – …”, a to etykieta linii, nie godzina.
      if (before === ':') continue;
      if (!RZESZOW_LINES.has(String(Number(tok)))) continue;
    } else if (!RZESZOW_LINES.has(tok)) {
      continue;
    }
    if (!seen.has(tok)) seen.add(tok);
    if (seen.size >= 12) break;
  }
  return [...seen];
}

/**
 * Komunikaty ZTM Rzeszów (RSS 2.0: tytuł + link + pubDate + opis).
 * Cały kanał dotyczy transportu, więc nie filtrujemy po słowach jak
 * miejski RSS Wrocławia. Opis z feedu ląduje w karcie; ogon
 * „Czytaj dalej … →” (streszczenie WordPressa) ucinamy.
 */
export function parseRzeszowRss(xml: string): MpkNewsItem[] {
  const items: MpkNewsItem[] = [];
  const blocks = xml.match(/<item[\s\S]*?<\/item>/gi) ?? [];
  for (const b of blocks) {
    const rawTitle = decodeEntities(stripCdata(tagInner(b, 'title'))).replace(/\s+/g, ' ').trim();
    const title = cleanNewsTitle(rawTitle);
    const link = stripCdata(tagInner(b, 'link')).trim();
    const rawDesc = stripCdata(tagInner(b, 'description'));
    let description = htmlToText(rawDesc)
      .replace(/\s*Czytaj dalej[\s\S]*?→\s*$/, '')
      .replace(/\s+/g, ' ')
      .trim();
    // Karta WordPressa ZTM startuje treścią z nagłówkiem, więc opis
    // zaczyna się od tytułu („Sprzedaż biletów... Sprzedaż biletów...”).
    if (description.toLowerCase().startsWith(title.toLowerCase())) {
      const rest = description.slice(title.length);
      if (rest === '' || /^[\s.,:;–—-]/.test(rest)) {
        description = rest.replace(/^[\s.,:;–—-]+/, '').trim();
      }
    }
    description = description.slice(0, 600);
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
      lines: extractRzeszowLines(title, description),
    });
  }
  return items;
}

/**
 * Treść artykułu ZTM Rzeszów: akapity po dacie publikacji w div#blog
 * (blog-main single-post-content). Nagłówki (dział „Aktualności” i tytuł
 * wpisu), miniaturkę, datę i przyciski share pomijamy, bo ekran pokazuje
 * je sam. Boczny pasek (col-sm-3) z innymi wpisami odcinamy na końcu.
 */
function extractRzeszowArticle(html: string): ArticleBlock[] {
  const main = (html.split(/id="blog"/i)[1]?.split(/col-sm-3|<footer/i)[0] ?? '')
    .replace(/<h1\b[^>]*>[\s\S]*?<\/h1>/gi, ' ')
    .replace(/<div class="entry-thumbnail"[\s\S]*?<\/div>/i, ' ')
    .replace(/<div class="entry-date"[\s\S]*?<\/div>/i, ' ')
    .replace(/<div class="social4i"[\s\S]*?(<div class="social4in"[\s\S]*?<\/div>\s*)?<\/div>/i, ' ');
  if (!main.trim()) return [];
  const blocks: ArticleBlock[] = [];
  const re = /<(h[1-6]|p|li)\b[^>]*>([\s\S]*?)<\/\1>/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(main))) {
    const text = htmlToText(match[2]).replace(/\s+/g, ' ').trim();
    if (!text || ARTICLE_JUNK_RE.test(text)) continue;
    const tag = match[1].toLowerCase();
    blocks.push({ kind: tag.startsWith('h') ? 'h' : 'p', text });
  }
  if (blocks.length === 0) {
    const plain = htmlToText(main).replace(/\s+/g, ' ').trim();
    if (plain) blocks.push({ kind: 'p', text: plain });
  }
  return blocks;
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

/**
 * Treść artykułu ztm.gda.pl: nagłówek, lead i akapity treści jako bloki.
 * Puste article-content (sam lead) daje dwa bloki, nie pustkę.
 */
function extractGdanskArticle(html: string): ArticleBlock[] {
  const blocks: ArticleBlock[] = [];
  const title = htmlToText((html.match(/<h2 class="article-title">([\s\S]*?)<\/h2>/i) ?? [])[1] ?? '')
    .replace(/\s+/g, ' ')
    .trim();
  if (title) blocks.push({ kind: 'h', text: title });
  const summary = htmlToText((html.match(/<div class="article-summary[^"]*">([\s\S]*?)<\/div>/i) ?? [])[1] ?? '')
    .replace(/\s+/g, ' ')
    .trim();
  if (summary && summary !== title) blocks.push({ kind: 'p', text: summary });
  const content = (html.match(/<div class="article-content[^"]*">([\s\S]*?)<\/div>/i) ?? [])[1] ?? '';
  if (content.trim()) {
    const re = /<(h[1-6]|p|li)\b[^>]*>([\s\S]*?)<\/\1>/gi;
    let m: RegExpExecArray | null;
    while ((m = re.exec(content))) {
      const text = htmlToText(m[2]).replace(/\s+/g, ' ').trim();
      if (!text || ARTICLE_JUNK_RE.test(text) || text === summary) continue;
      blocks.push({ kind: m[1].toLowerCase().startsWith('h') ? 'h' : 'p', text });
    }
  }
  return blocks;
}

function scrubArticleHtml(raw: string): string {  let out = raw;
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
  const mpkLodz = /mpk\.lodz\.pl/i.test(url);
  const ztp = /ztp\.krakow\.pl/i.test(url);
  const gzm = /rj\.transportgzm\.pl/i.test(url);
  const wtp = /wtp\.waw\.pl/i.test(url);
  // MZK Opole to WordPress z tym samym układem co WTP (article
  // + div.entry-content), więc wpada do gałęzi wtp niżej.
  const mzkOpole = /mzkopole\.pl/i.test(url);
  // ZTM Poznań to WordPress, ale inny motyw niż WTP: treść artykułu siedzi
  // w <div class="row content mt-4"> wewnątrz sekcji (bez <article>).
  const ztmPoznan = /ztm\.poznan\.pl/i.test(url);
  // ZTM Gdańsk: tytuł w h2.article-title, lead w div.article-summary, treść
  // w div.article-content (często pusta, sam lead niesie komunikat). Sidebar
  // z innymi komunikatami omijamy celowanymi klasami, nie całym <main>.
  const ztmGdansk = /ztm\.gda\.pl/i.test(url);
  if (ztmGdansk) return extractGdanskArticle(html);
  // ZDiTM Szczecin: lead w div.lead, treść w main#pageContent (okruszki
  // i spis treści wycinamy w extractorze, stopkę powiązanych też).
  const zditm = /zditm\.szczecin\.pl/i.test(url);
  if (zditm) return extractSzczecinArticle(html);
  // MZDiK Radom: lead w div.standard-page__intro, treść w div.content
  // (panel boczny z innymi komunikatami leży poza section, więc odpada
  // sam; nagłówek z okruszkami wycinamy w extractorze).
  const mzdik = /mzdik\.pl/i.test(url);
  if (mzdik) return extractMzdikRadomArticle(html);
  // ZDiTM Lublin: tytuł w h2.text-header, treść w article.tiny wewnątrz
  // section.main-center-panel (okruszki i tytuł wycinamy w extractorze).
  const zditmLublin = /zdtm\.lublin\.eu/i.test(url);
  if (zditmLublin) return extractLublinArticle(html);
  // ZTM Kielce: treść w div.com-content-article__body (panel rozkładu
  // z linkami linii wycinamy w extractorze).
  const ztmKielce = /ztm\.kielce\.pl/i.test(url);
  if (ztmKielce) return extractKielceArticle(html);
  // ZDZiT Olsztyn to WordPress jak WTP (artykuł w <article>, treść
  // w div.entry-content): ta sama ścieżka co Warszawa.
  const zdzitOlsztyn = /zdzit\.olsztyn\.eu/i.test(url);
  // BKM Białystok: treść redakcyjna w div.component-content-wysiwyg
  // (stopka z danymi urzędu leży poza nim, więc odpada zakresem).
  const bkm = /komunikacja\.bialystok\.pl/i.test(url);
  if (bkm) return extractBialystokArticle(html);
  // ZTM Rzeszów: treść w div#blog (nagłówki, miniaturkę, datę i pasek
  // boczny wycinamy w extractorze).
  const ztmRzeszow = /ztm\.erzeszow\.pl/i.test(url);
  if (ztmRzeszow) return extractRzeszowArticle(html);
  let fragment = mpk
    ? (html.match(/class="main__inner"[^>]*>([\s\S]*?)<\/div>/i)?.[1] ?? '')
    : mpkLodz
      ? (html.match(/<div id="dWrkspc">([\s\S]*?)<\/td>/i)?.[1] ?? '')
      : ztp
      ? (html.match(/<article\b[^>]*>([\s\S]*?)<\/article>/i)?.[1] ??
        html.match(/class="content"[^>]*>([\s\S]*?)<\/div>\s*<\/div>/i)?.[1] ??
        html.match(/<main\b[^>]*>([\s\S]*?)<\/main>/i)?.[1] ??
        '')
      : gzm
        ? (html.split(/id="mcontent"/i)[1]?.split(/<div class="modal"|<footer/i)[0] ?? '')
        : wtp || zdzitOlsztyn || mzkOpole
          ? (html.match(/<article\b[^>]*>([\s\S]*?)<\/article>/i)?.[1] ??
            html.match(/class="entry-content"[^>]*>([\s\S]*?)<\/div>/i)?.[1] ??
            html.match(/<main\b[^>]*>([\s\S]*?)<\/main>/i)?.[1] ??
            '')
          : ztmPoznan
            ? (html.split(/class="row content mt-4"/i)[1]?.split(/<\/section>/i)[0] ?? '')
            : (html.match(/id="article-content"[\s\S]*?>([\s\S]*?)<div class="box-container c-tags/i)?.[1] ??
            '');
  if (gzm) {
    // Tytuł niesie nagłówek ekranu (params.title), więc w treści go pomijamy.
    fragment = fragment.replace(/<h2\b[^>]*>[\s\S]*?<\/h2>/i, ' ');
  }
  if (mpkLodz) {
    // Nagłówek "KOMUNIKAT" i wiersz tytułu z tabeli: ekran pokazuje je sam.
    fragment = fragment
      .replace(/<h1\b[^>]*>[\s\S]*?<\/h1>/i, ' ')
      .replace(/<th\b[^>]*>[\s\S]*?<\/th>/i, ' ');
  }
  if (zdzitOlsztyn) {
    // Tytuł (h1 w headerze) pokazuje ekran sam, tag kategorii
    // („Bez kategorii”) to nie treść, a nawigacja Poprzedni/Następny
    // post to nie komunikat.
    fragment = fragment
      .replace(/<header\b[\s\S]*?<\/header>/i, ' ')
      .replace(/<div class="category-and-tags"[\s\S]*?<\/div>/i, ' ')
      .replace(/<nav\b[\s\S]*?<\/nav>/gi, ' ');
  }
  fragment = scrubArticleHtml(fragment);
  if (!fragment.trim()) return [];
  const blocks: ArticleBlock[] = [];
  if (mpkLodz) {
    // Markup MPK używa <p> jako separatora akapitów bez zamknięć, więc
    // dzielimy po otwarciach; generyczne dopasowanie par nic nie łapie
    // i skleiłoby cały komunikat w jeden blok.
    for (const chunk of fragment.split(/<p\b[^>]*>/i).slice(1)) {
      const text = htmlToText(chunk);
      if (!text || ARTICLE_JUNK_RE.test(text)) continue;
      blocks.push({ kind: 'p', text });
    }
    if (blocks.length > 0) return blocks;
  }
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
  if (city.id === 'gzm') return fetchGzmNews(signal, city.id);
  if (city.id === 'warszawa') return fetchWtpNews(signal, city.id);
  if (city.id === 'poznan') return fetchPoznanNews(signal, city.id);
  if (city.id === 'trojmiasto') return fetchGdanskNews(signal, city.id);
  if (city.id === 'lodz') return fetchLodzNews(signal, city.id);
  if (city.id === 'szczecin') return fetchSzczecinNews(signal, city.id);
  if (city.id === 'kielce') return fetchKielceNews(signal, city.id);
  if (city.id === 'olsztyn') return fetchOlsztynNews(signal, city.id);
  if (city.id === 'bialystok') return fetchBialystokNews(signal, city.id);
  if (city.id === 'opole') return fetchOpoleNews(signal, city.id);
  if (city.id === 'rzeszow') return fetchRzeszowNews(signal, city.id);
  if (city.id === 'lublin') return fetchLublinNews(signal, city.id);
  if (city.id === 'radom') return fetchRadomNews(signal, city.id);
  return fetchMpkNews(signal);
}

/**
 * Komunikaty MPK Łódź: zmiany w rozkładach plus utrudnienia w ruchu.
 * Kanał utrudnień bywa pusty (wtedy bierzemy same zmiany); oba martwe to błąd.
 */
async function fetchLodzNews(signal?: AbortSignal, cityId = 'lodz'): Promise<MpkNewsItem[]> {
  const scope = withTimeout(NEWS_TIMEOUT_MS, signal);
  try {
    const [rozklady, utrudnienia] = await Promise.allSettled([
      fetchLodzText(MPK_LODZ_ROZKLADY_RSS, scope.signal).then(parseMpkLodzRss),
      fetchLodzText(MPK_LODZ_UTRUDNIENIA_RSS, scope.signal).then(parseMpkLodzRss),
    ]);
    const seen = new Set<string>();
    const items = [
      ...(rozklady.status === 'fulfilled' ? rozklady.value : []),
      ...(utrudnienia.status === 'fulfilled' ? utrudnienia.value : []),
    ].filter((i) => {
      if (seen.has(i.id)) return false;
      seen.add(i.id);
      return true;
    });
    if (items.length === 0) {
      if (rozklady.status === 'rejected' && utrudnienia.status === 'rejected') {
        throw rozklady.reason instanceof Error ? rozklady.reason : new Error('news');
      }
      console.warn('[News] Łódź: oba kanały MPK puste (zmiana formatu?)');
    }
    return rememberNews(sortNews(items), cityId);
  } finally {
    scope.dispose();
  }
}

/** Komunikaty ZDZiT Olsztyn: jedno źródło (RSS), brak fallbacku. */
async function fetchOlsztynNews(signal?: AbortSignal, cityId = 'olsztyn'): Promise<MpkNewsItem[]> {
  const scope = withTimeout(NEWS_TIMEOUT_MS, signal);
  try {
    const xml = await fetchText(ZDZIT_OLSZTYN_FEED_URL, scope.signal, 'application/rss+xml, application/xml, text/xml, */*');
    const items = parseZdzitOlsztynRss(xml);
    if (items.length === 0) console.warn('[News] Olsztyn: pusty feed (zmiana formatu?)');
    return rememberNews(sortNews(items), cityId);
  } finally {
    scope.dispose();
  }
}

/** Komunikaty ZDiTM Szczecin: jedno źródło (lista HTML), brak fallbacku. */

/** Komunikaty ZDiTM Lublin: jedno źródło (lista HTML), brak fallbacku. */
async function fetchLublinNews(signal?: AbortSignal, cityId = 'lublin'): Promise<MpkNewsItem[]> {
  const scope = withTimeout(NEWS_TIMEOUT_MS, signal);
  try {
    const html = await fetchText(ZDITM_LUBLIN_INFO_URL, scope.signal, 'text/html, */*');
    const items = parseLublinInfo(html);
    if (items.length === 0) console.warn('[News] Lublin: pusta lista (zmiana markupu?)');
    return rememberNews(sortNews(items), cityId);
  } finally {
    scope.dispose();
  }
}

/** Komunikaty MZDiK Radom: jedno źródło (lista HTML), brak fallbacku. */
async function fetchRadomNews(signal?: AbortSignal, cityId = 'radom'): Promise<MpkNewsItem[]> {
  const scope = withTimeout(NEWS_TIMEOUT_MS, signal);
  try {
    const html = await fetchText(MZDIK_RADOM_KOMUNIKATY_URL, scope.signal, 'text/html, */*');
    const items = parseMzdikRadomKomunikaty(html);
    if (items.length === 0) console.warn('[News] Radom: pusta lista (zmiana markupu?)');
    return rememberNews(sortNews(items), cityId);
  } finally {
    scope.dispose();
  }
}

async function fetchSzczecinNews(signal?: AbortSignal, cityId = 'szczecin'): Promise<MpkNewsItem[]> {
  const scope = withTimeout(NEWS_TIMEOUT_MS, signal);
  try {
    const html = await fetchText(ZDITM_SZCZECIN_INFO_URL, scope.signal, 'text/html, */*');
    const items = parseSzczecinInfo(html);
    if (items.length === 0) console.warn('[News] Szczecin: pusta lista (zmiana markupu?)');
    return rememberNews(sortNews(items), cityId);
  } finally {
    scope.dispose();
  }
}

/** Komunikaty ZTM Kielce: jedno źródło (lista Joomla), brak fallbacku. */
async function fetchKielceNews(signal?: AbortSignal, cityId = 'kielce'): Promise<MpkNewsItem[]> {
  const scope = withTimeout(NEWS_TIMEOUT_MS, signal);
  try {
    const html = await fetchText(ZTM_KIELCE_NEWS_URL, scope.signal, 'text/html, */*');
    const items = parseKielceNews(html);
    if (items.length === 0) console.warn('[News] Kielce: pusta lista (zmiana markupu?)');
    return rememberNews(sortNews(items), cityId);
  } finally {
    scope.dispose();
  }
}

/** Komunikaty BKM Białystok: jedno źródło (lista HTML), brak fallbacku. */
async function fetchBialystokNews(signal?: AbortSignal, cityId = 'bialystok'): Promise<MpkNewsItem[]> {
  const scope = withTimeout(NEWS_TIMEOUT_MS, signal);
  try {
    const html = await fetchText(BKM_BIALYSTOK_KOMUNIKATY_URL, scope.signal, 'text/html, */*');
    const items = parseBialystokNews(html);
    if (items.length === 0) console.warn('[News] Białystok: pusta lista (zmiana markupu?)');
    return rememberNews(sortNews(items), cityId);
  } finally {
    scope.dispose();
  }
}

/** Komunikaty MZK Opole: jedno źródło (RSS kategorii Aktualności), brak fallbacku. */
async function fetchOpoleNews(signal?: AbortSignal, cityId = 'opole'): Promise<MpkNewsItem[]> {
  const scope = withTimeout(NEWS_TIMEOUT_MS, signal);
  try {
    const xml = await fetchText(MZK_OPOLE_FEED_URL, scope.signal, 'application/rss+xml, application/xml, text/xml, */*');
    const items = parseOpoleRss(xml);
    if (items.length === 0) console.warn('[News] Opole: pusty feed (zmiana formatu?)');
    return rememberNews(sortNews(items), cityId);
  } finally {
    scope.dispose();
  }
}

/** Komunikaty ZTM Rzeszów: jedno źródło (RSS), brak fallbacku. */
async function fetchRzeszowNews(signal?: AbortSignal, cityId = 'rzeszow'): Promise<MpkNewsItem[]> {
  const scope = withTimeout(NEWS_TIMEOUT_MS, signal);
  try {
    const xml = await fetchText(ZTM_RZESZOW_FEED_URL, scope.signal, 'application/rss+xml, application/xml, text/xml, */*');
    const items = parseRzeszowRss(xml);
    if (items.length === 0) console.warn('[News] Rzeszów: pusty feed (zmiana formatu?)');

    return rememberNews(sortNews(items), cityId);
  } finally {
    scope.dispose();
  }
}

/** Komunikaty ZTM Poznań: jedno źródło (RSS), brak fallbacku. */
async function fetchPoznanNews(signal?: AbortSignal, cityId = 'poznan'): Promise<MpkNewsItem[]> {
  const scope = withTimeout(NEWS_TIMEOUT_MS, signal);
  try {
    const xml = await fetchText(ZTM_POZNAN_FEED_URL, scope.signal, 'application/rss+xml, application/xml, text/xml, */*');
    const items = parsePoznanRss(xml);
    if (items.length === 0) console.warn('[News] Poznań: pusty feed (zmiana formatu?)');
    return rememberNews(sortNews(items), cityId);
  } finally {
    scope.dispose();
  }
}

/** Komunikaty ZTM Gdańsk: zmiany tras (znt) plus bieżące awarie (bsk). */
async function fetchGdanskNews(signal?: AbortSignal, cityId = 'trojmiasto'): Promise<MpkNewsItem[]> {
  const scope = withTimeout(NEWS_TIMEOUT_MS, signal);
  try {
    const [znt, bsk] = await Promise.allSettled([
      fetchText(ZTM_GDANSK_ZNT_URL, scope.signal, 'application/json, */*').then(parseGdanskZnt),
      fetchText(ZTM_GDANSK_BSK_URL, scope.signal, 'application/json, */*').then(parseGdanskBsk),
    ]);
    const changes = znt.status === 'fulfilled' ? znt.value : [];
    const breakdowns = bsk.status === 'fulfilled' ? bsk.value : [];
    if (changes.length === 0 && breakdowns.length === 0) {
      if (znt.status === 'rejected' && bsk.status === 'rejected') {
        throw znt.reason instanceof Error ? znt.reason : new Error('news');
      }
      console.warn('[News] Gdańsk: puste feedy (zmiana formatu?)');
    }
    return rememberNews(sortNews([...breakdowns, ...changes]), cityId);
  } finally {
    scope.dispose();
  }
}

/** Komunikaty WTP Warszawa: jedno źródło (RSS), brak fallbacku. */
async function fetchWtpNews(signal?: AbortSignal, cityId = 'warszawa'): Promise<MpkNewsItem[]> {
  const scope = withTimeout(NEWS_TIMEOUT_MS, signal);
  try {
    const xml = await fetchText(WTP_FEED_URL, scope.signal, 'application/rss+xml, application/xml, text/xml, */*');
    const items = parseWtpRss(xml);
    if (items.length === 0) console.warn('[News] WTP: pusty feed (zmiana formatu?)');
    return rememberNews(sortNews(items), cityId);
  } finally {
    scope.dispose();
  }
}

/** Komunikaty ZTM GZM: jedno źródło (lista HTML), brak fallbacku. */
async function fetchGzmNews(signal?: AbortSignal, cityId = 'gzm'): Promise<MpkNewsItem[]> {
  const scope = withTimeout(NEWS_TIMEOUT_MS, signal);
  try {
    const html = await fetchText(GZM_NEWS_URL, scope.signal, 'text/html, */*');
    const items = parseGzmNews(html);
    if (items.length === 0) console.warn('[News] GZM: pusta lista (zmiana markupu?)');
    return rememberNews(sortNews(items), cityId);
  } finally {
    scope.dispose();
  }
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
    // mpk.lodz.pl serwuje ISO-8859-2: zwykły fetch.text() dałby krzaki.
    const html = /mpk\.lodz\.pl/i.test(url)
      ? await fetchLodzText(url, scope.signal)
      : await fetchText(url, scope.signal, 'text/html, */*');
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
