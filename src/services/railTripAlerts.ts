// Alerty konkretnego pociągu ogólnopolskiego pobierane bezpośrednio na urządzeniu
// (PKP PLK updates + komunikaty operacyjne PKP Intercity + strumień SSE zbiorkomu),
// bez analizy AI i bez pośrednictwa R2.
// Współdzielone między kartą połączenia (kompaktowy chip) a ekranem szczegółów trasy.

import type { Connection, Leg } from '../types/models';
import {
  fetchZbVehicleAlerts,
  trainNumberVariants,
  vehicleCandidatesForLeg,
  type ZbVehicleAlert,
} from './nationalRailLive';
import { fetchNationalRailUpdates } from './nationalRailUpdates';
import { withTimeout } from './net';
import { kvGet, kvSet } from './storage';

export interface TrainAlertItem {
  id?: string;
  title: string;
  description: string;
  solution?: string;
  isUrgent?: boolean;
  isResolved?: boolean;
  timeframe?: string;
  source?: string;
  link?: string;
}

export interface TrainAlerts {
  leg: Leg;
  alerts: TrainAlertItem[];
}

interface DirectPkpAnnouncement {
  id: string;
  title: string;
  description: string;
  solution?: string;
  timeframe: string;
  link: string;
  isUrgent: boolean;
  isResolved: boolean;
  trainNumbers: string[];
  honorsAgencies: string[];
}

const INTERCITY_LIST_URL = 'https://www.intercity.pl/pl/site/o-nas/dzial-prasowy/komunikaty/';
const PKP_TIMEOUT_MS = 8_000;

const inFlight = new Map<string, Promise<TrainAlertItem[]>>();
const results = new Map<string, { at: number; alerts: TrainAlertItem[] }>();
const TTL_MS = 5 * 60 * 1000;

const KEY_NATIONAL_DISRUPTIONS = 'kilometr.cache.pkp_direct_alerts.v1';
const NATIONAL_DISRUPTIONS_DISK_TTL_MS = 24 * 3600 * 1000;

let pkpDirectCache: { at: number; items: DirectPkpAnnouncement[] } | null = null;
let pkpDirectInFlight: Promise<DirectPkpAnnouncement[]> | null = null;
const DISRUPTIONS_CACHE_TTL = 5 * 60 * 1000;

export function resetNationalDisruptionsCache(): void {
  pkpDirectCache = null;
  pkpDirectInFlight = null;
  results.clear();
}

function decodeBasicHtml(raw: string): string {
  return raw
    .replace(/<(?:br|\/p|\/li|\/h[1-6])\b[^>]*>/gi, '\n')
    .replace(/<li\b[^>]*>/gi, '• ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&ndash;|&mdash;/gi, '-')
    .replace(/&bdquo;|,,/gi, '„')
    .replace(/&rdquo;/gi, '”')
    .replace(/&oacute;/gi, 'ó')
    .replace(/&Oacute;/gi, 'Ó')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n+/g, '\n')
    .trim();
}

function cleanPkpTitle(raw: string): string {
  return raw
    .replace(/\s*Aktualizacja:[\s\S]*$/i, '')
    .replace(/\s*Więcej\s*$/i, '')
    .replace(/\s*w dniu\s+\d{1,2}\.\d{1,2}\.\d{4}\s*(?:roku|r\.?)?/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractTrainNumbersFromText(text: string): string[] {
  const out = new Set<string>();
  const years = new Set(['2024', '2025', '2026', '2027', '2028']);
  const re = /\b(?:IC|TLK|EIC|EIP|EC|EN|PR|KM|KŚ|KW|KD|ŁKA)?\s*(?:nr\s*)?(\d{2,6}(?:\/\d{1,2})?)\b/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const token = m[1];
    const base = token.split('/')[0] ?? '';
    if (years.has(base)) continue;
    // Dwucyfrowe numery akceptujemy wyłącznie z prefiksem międzynarodowym (np. EIC nr 41)
    if (base.length < 3 && !/\b(?:EIC|EC|EN|IC)\s+nr\s+\d{2}\b/i.test(m[0])) continue;
    for (const v of trainNumberVariants(token)) out.add(v);
  }
  return [...out];
}

function extractHonoredAgencies(text: string): string[] {
  const lower = text.toLowerCase();
  if (!lower.includes('honorowan')) return [];
  const agencies: string[] = [];
  if (lower.includes('intercity')) agencies.push('IC');
  if (lower.includes('mazowieck') || /\bkm\b/.test(lower)) agencies.push('KM');
  if (lower.includes('polregio')) agencies.push('PR');
  if (lower.includes('dolnośląsk') || /\bkd\b/.test(lower)) agencies.push('KD');
  if (lower.includes('śląsk') || /\bkś\b/.test(lower)) agencies.push('KS');
  if (lower.includes('wielkopolsk') || /\bkw\b/.test(lower)) agencies.push('KW');
  if (lower.includes('małopolsk') || /\bkmł\b/.test(lower)) agencies.push('KML');
  if (lower.includes('łódzk') || /\błka\b/.test(lower)) agencies.push('LKA');
  if (lower.includes('trójmieście') || /\bskm\b/.test(lower)) agencies.push('SKMT');
  return agencies;
}

function parseIntercityListHtml(html: string): Array<{
  id: string;
  rawTitle: string;
  link: string;
  timeframe: string;
}> {
  const cardRe = /<a\s+[^>]*href="([^"]*komunikaty\/[^"]*)"[^>]*>([\s\S]*?)<\/a>/gi;
  const out: Array<{ id: string; rawTitle: string; link: string; timeframe: string }> = [];
  const seen = new Set<string>();
  let match: RegExpExecArray | null;

  while ((match = cardRe.exec(html)) !== null && out.length < 6) {
    const href = match[1].trim();
    if (/dostepnosc-sprzedazy|regulamin|promocj|cennik|prace-serwisowe/i.test(href)) continue;
    const link = /^https?:\/\//i.test(href)
      ? href
      : `https://www.intercity.pl/pl/${href.replace(/^\/?(?:pl\/)?/, '')}`;
    if (seen.has(link)) continue;
    seen.add(link);

    const cardText = decodeBasicHtml(match[2]).replace(/\n+/g, ' ');
    if (!cardText) continue;

    const upd = /Aktualizacja:\s*(\d{4})-(\d{2})-(\d{2})(?:,\s*(\d{2}:\d{2}))?/i.exec(cardText);
    const timeframe = upd ? `${upd[3]}.${upd[2]}${upd[4] ? `, ${upd[4]}` : ''}` : '';
    const slug = href.split('/').pop()?.replace(/\.html?$/i, '').slice(0, 48) || String(out.length);

    out.push({
      id: `pkp-ic-${slug}`,
      rawTitle: cardText,
      link,
      timeframe,
    });
  }
  return out;
}

function parseIntercityDetailHtml(
  card: { id: string; rawTitle: string; link: string; timeframe: string },
  detailHtml: string | null,
): DirectPkpAnnouncement {
  const title = cleanPkpTitle(card.rawTitle);
  let bodyText = '';
  if (detailHtml) {
    const articleRaw =
      (detailHtml.match(/<article\b[^>]*>([\s\S]*?)<\/article>/i)?.[1] ??
        detailHtml.split(/id="mtc"[^>]*>/i)[1]?.split(/<\/main>/i)[0] ??
        '')
        .replace(/<div class="page-title">[\s\S]*?<\/div>\s*<\/div>\s*<\/div>/i, ' ')
        .replace(/<h1\b[^>]*>[\s\S]*?<\/h1>/i, ' ')
        .split(/Informujemy,\s*że mają Państwo prawo/i)[0]
        ?.split(/Prosimy o zwracanie uwagi na komunikaty głosowe/i)[0] ?? '';
    bodyText = decodeBasicHtml(articleRaw);
  }

  const combined = `${title}\n${bodyText}`;
  const lower = combined.toLowerCase();
  const lines = bodyText
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  const bullets = lines.filter((l) => l.startsWith('•'));
  const prose = lines.filter((l) => !l.startsWith('•') && !/^Aktualizacja:|^Opublikowano:/i.test(l));

  const description = (prose[0] || title).slice(0, 420);
  let solution: string | undefined;
  if (prose.length > 1) {
    solution = prose.slice(1, 3).join(' ').slice(0, 320);
  } else if (bullets.length > 0 && lower.includes('zastępcz')) {
    solution = bullets.slice(0, 2).join(' ').slice(0, 320);
  }

  const isResolved =
    lower.includes('ruch przywrócon') ||
    lower.includes('awaria usunięt') ||
    lower.includes('utrudnienia zakończon');
  const isUrgent =
    !isResolved &&
    (lower.includes('awari') ||
      lower.includes('usterk') ||
      lower.includes('wstrzyman') ||
      lower.includes('wypad') ||
      lower.includes('opóźnieni') ||
      lower.includes('honorowan'));

  return {
    id: card.id,
    title,
    description,
    solution,
    timeframe: card.timeframe,
    link: card.link,
    isUrgent,
    isResolved,
    trainNumbers: extractTrainNumbersFromText(combined),
    honorsAgencies: extractHonoredAgencies(combined),
  };
}

async function fetchTextDirect(url: string): Promise<string> {
  const scope = withTimeout(PKP_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: scope.signal,
      headers: {
        Accept: 'text/html,application/xhtml+xml,*/*',
      },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } finally {
    scope.dispose();
  }
}

async function getDirectPkpAnnouncements(): Promise<DirectPkpAnnouncement[]> {
  const now = Date.now();
  if (pkpDirectCache && now - pkpDirectCache.at < DISRUPTIONS_CACHE_TTL) {
    return pkpDirectCache.items;
  }
  if (pkpDirectInFlight) return pkpDirectInFlight;

  pkpDirectInFlight = (async () => {
    try {
      const listHtml = await fetchTextDirect(INTERCITY_LIST_URL);
      const cards = parseIntercityListHtml(listHtml);
      if (cards.length > 0) {
        const settled = await Promise.all(
          cards.slice(0, 4).map(async (card) => {
            const detailHtml = await fetchTextDirect(card.link).catch(() => null);
            return parseIntercityDetailHtml(card, detailHtml);
          }),
        );
        pkpDirectCache = { at: now, items: settled };
        void kvSet(KEY_NATIONAL_DISRUPTIONS, JSON.stringify({ savedAt: now, items: settled }));
        return settled;
      }
    } catch {
      // Brak sieci w pociągu: przechodzimy do pamięci i KV store
    }

    if (pkpDirectCache?.items && pkpDirectCache.items.length > 0) {
      return pkpDirectCache.items;
    }

    try {
      const raw = await kvGet(KEY_NATIONAL_DISRUPTIONS);
      if (raw) {
        const parsed = JSON.parse(raw) as { savedAt: number; items: DirectPkpAnnouncement[] };
        if (
          now - parsed.savedAt <= NATIONAL_DISRUPTIONS_DISK_TTL_MS &&
          Array.isArray(parsed.items)
        ) {
          pkpDirectCache = { at: parsed.savedAt, items: parsed.items };
          return parsed.items;
        }
      }
    } catch {
      // brak cache
    }

    return pkpDirectCache?.items ?? [];
  })().finally(() => {
    pkpDirectInFlight = null;
  });

  return pkpDirectInFlight;
}

/**
 * Alerty dla nogi kolejowej (bezpośrednio na urządzeniu, bez AI):
 * 1. Status odwołania lub objazdu z oficjalnego feedu PKP PLK (/api/rail/delays)
 * 2. Zwięzłe komunikaty operacyjne PKP Intercity pobierane wprost ze strony przewoźnika
 * 3. Komunikaty konkretnego kursu ze strumienia zbiorkomu (SSE /api6/pkp/positions/...)
 */
export async function alertsForLeg(leg: Leg): Promise<TrainAlertItem[]> {
  const candidates = vehicleCandidatesForLeg(leg);
  const cacheKey = [leg.tripId ?? '', leg.trainNumber ?? '', ...candidates].join('|');
  const hit = results.get(cacheKey);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.alerts;

  const pending = inFlight.get(cacheKey);
  if (pending) return pending;

  const promise = (async () => {
    const alerts: TrainAlertItem[] = [];

    // 1. Status odwołania / objazdu z PKP PLK updates
    try {
      const updates = await fetchNationalRailUpdates([leg]);
      const update = leg.tripId ? updates.get(leg.tripId) : undefined;
      if (update?.cancelled) {
        alerts.push({
          id: `${leg.tripId ?? leg.id}-cancelled`,
          title: 'Kurs odwołany',
          description: `Pociąg ${leg.trainNumber ?? leg.line ?? ''} został odwołany przez zarządcę lub przewoźnika na wybranym odcinku trasy.`,
          solution: 'Wybierz inne połączenie lub sprawdź komunikację zastępczą przewoźnika.',
          isUrgent: true,
          timeframe: leg.departAt ? `Odjazd: ${leg.departAt}` : undefined,
        });
      }
      if (update?.detour) {
        alerts.push({
          id: `${leg.tripId ?? leg.id}-detour`,
          title: 'Trasa zmieniona (objazd)',
          description: 'Pociąg jedzie drogą okrężną.',
          solution: 'Czas przejazdu i lista stacji pośrednich mogą ulec zmianie.',
          isUrgent: true,
          timeframe: leg.departAt ? `Odjazd: ${leg.departAt}` : undefined,
        });
      }
    } catch {
      // Błąd live updates nie blokuje reszty alertów
    }

    // 2. Bezpośrednie komunikaty operacyjne PKP Intercity (cache RAM + KV offline)
    try {
      const announcements = await getDirectPkpAnnouncements();
      const legNums = new Set(trainNumberVariants(leg.trainNumber, leg.line));
      const agencyUpper = (leg.railAgency || leg.line || '').trim().toUpperCase();

      for (const item of announcements) {
        const matchesNumber =
          legNums.size > 0 && item.trainNumbers.some((num) => legNums.has(num));
        const matchesHonoring =
          item.honorsAgencies.length >= 2 &&
          Boolean(agencyUpper) &&
          item.honorsAgencies.includes(agencyUpper) &&
          item.trainNumbers.length === 0;

        if (matchesNumber || matchesHonoring) {
          if (!alerts.some((a) => a.title === item.title)) {
            alerts.push({
              id: item.id,
              title: item.title,
              description: item.description,
              solution: item.solution,
              isUrgent: item.isUrgent,
              isResolved: item.isResolved,
              timeframe: item.timeframe || undefined,
              source: 'PKP Intercity',
              link: item.link,
            });
          }
        }
      }
    } catch {
      // Błąd sieci nie blokuje widoku trasy
    }

    // 3. Komunikaty kursu ze strumienia zbiorkomu
    if (candidates.length > 0) {
      for (const vehicle of candidates) {
        try {
          const zbAlerts = await fetchZbVehicleAlerts(vehicle);
          for (const a of zbAlerts) {
            if (!alerts.some((existing) => existing.title === a.title)) {
              alerts.push({
                id: `${vehicle}-${a.title}`,
                title: a.title,
                description: a.description,
                isUrgent: true,
                timeframe: 'Live',
                link: a.url,
              });
            }
          }
          if (alerts.length > 0) break;
        } catch {
          // Następny kandydat
        }
      }
    }

    if (alerts.length === 0 && hit && hit.alerts.length > 0) {
      return hit.alerts;
    }
    results.set(cacheKey, { at: Date.now(), alerts });
    return alerts;
  })().finally(() => {
    inFlight.delete(cacheKey);
  });

  inFlight.set(cacheKey, promise);
  return promise;
}

/**
 * Alerty per połączenie: jedna noga kolejowa = jedna karta/chip. Zwraca
 * pustą listę, gdy pociąg nie ma utrudnień albo danych nie udało się
 * pobrać: alerty są dodatkiem, nie mogą blokować listy wyników.
 */
export async function alertsForConnection(connection: Connection): Promise<TrainAlerts[]> {
  const legs = connection.legs.filter(
    (l) => l.mode === 'train' && (l.tripId?.startsWith('pl:') || l.trainNumber),
  );
  if (legs.length === 0) return [];
  const out: TrainAlerts[] = [];
  for (const leg of legs.slice(0, 3)) {
    const alerts = await alertsForLeg(leg).catch(() => [] as ZbVehicleAlert[]);
    if (alerts.length > 0) out.push({ leg, alerts });
  }
  return out;
}
