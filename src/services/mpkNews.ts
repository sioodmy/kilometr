// Czytnik aktualności MPK / wroclaw.pl (RSS) — bez dodatkowych zależności.
// Feed: https://www.wroclaw.pl/komunikacja/rss (RSS 2.0, opis w CDATA z <img> + tekst).
export type MpkNewsItem = {
  id: string;
  title: string;
  link: string;
  description: string;
  imageUrl: string | null;
  urgent: boolean;
  pubDate: number | null;
  dateLabel: string;
};

export const MPK_NEWS_URL = 'https://www.wroclaw.pl/komunikacja/rss';

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

function decodeEntities(s: string): string {
  let out = s;
  for (const [k, v] of Object.entries(ENTITIES)) out = out.split(k).join(v);
  // numeryczne encje typu &#243;
  out = out.replace(/&#(\d+);/g, (_, n) => {
    try {
      return String.fromCharCode(parseInt(n, 10));
    } catch {
      return '';
    }
  });
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

export function isUrgentNews(title: string, description: string): boolean {
  return URGENT_RE.test(`${title} ${description}`);
}

function htmlToText(html: string): string {
  // wytnij <img ...>, potem resztę tagów
  const noImg = html.replace(/<img[^>]*>/gi, ' ');
  const noTags = noImg.replace(/<[^>]+>/g, ' ');
  return decodeEntities(noTags).replace(/\s+/g, ' ').trim();
}

export function formatNewsDate(ts: number | null): string {
  if (!ts) return '';
  const d = new Date(ts);
  const now = Date.now();
  const diffMin = Math.max(0, Math.round((now - ts) / 60000));
  if (diffMin < 60) return diffMin <= 1 ? 'przed chwilą' : `${diffMin} min temu`;
  const diffH = Math.round(diffMin / 60);
  if (diffH < 24) return `${diffH} godz. temu`;
  const diffD = Math.round(diffH / 24);
  if (diffD === 1) return 'wczoraj';
  if (diffD < 7) return `${diffD} dni temu`;
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  return `${dd}.${mm}.${d.getFullYear()}`;
}

export function parseMpkRss(xml: string): MpkNewsItem[] {
  const items: MpkNewsItem[] = [];
  const blocks = xml.match(/<item[\s\S]*?<\/item>/gi) ?? [];
  for (const b of blocks) {
    const title = decodeEntities(stripCdata(tagInner(b, 'title'))).replace(/\s+/g, ' ').trim();
    const link = stripCdata(tagInner(b, 'link')).trim();
    const rawDesc = stripCdata(tagInner(b, 'description'));
    const description = htmlToText(rawDesc);
    const imageUrl = extractImage(rawDesc);
    const pubRaw = stripCdata(tagInner(b, 'pubDate')).trim();
    const ts = pubRaw ? Date.parse(pubRaw) : NaN;
    const pubDate = Number.isFinite(ts) ? ts : null;
    if (!title && !link) continue;
    items.push({
      id: link || title,
      title: title || '(bez tytułu)',
      link,
      description,
      imageUrl,
      urgent: isUrgentNews(title, description),
      pubDate,
      dateLabel: formatNewsDate(pubDate),
    });
  }
  return items;
}

export async function fetchMpkNews(signal?: AbortSignal): Promise<MpkNewsItem[]> {
  const res = await fetch(MPK_NEWS_URL, {
    headers: { Accept: 'application/rss+xml, application/xml, text/xml, */*' },
    signal,
  });
  if (!res.ok) throw new Error(`RSS ${res.status}`);
  const xml = await res.text();
  return parseMpkRss(xml);
}
