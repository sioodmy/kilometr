// Alerty konkretnego pociągu ogólnopolskiego (PKP PLK / R2 disruptions / strumień SSE zbiorkomu),
// współdzielone między kartą połączenia (kompaktowy chip) a ekranem
// szczegółów (karta w sekcji "Zmiany na Twoich liniach").
// Cache per pojazd (5 min) + deduplikacja w locie.

import type { Connection, Leg } from '../types/models';
import {
  fetchZbVehicleAlerts,
  vehicleCandidatesForLeg,
  type ZbVehicleAlert,
} from '../services/nationalRailLive';
import { fetchNationalRailUpdates } from './nationalRailUpdates';
import { fetchDisruptionsFromWorker, type MpkNewsItem } from './mpkNews';

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

const inFlight = new Map<string, Promise<TrainAlertItem[]>>();
const results = new Map<string, { at: number; alerts: TrainAlertItem[] }>();
const TTL_MS = 5 * 60 * 1000;

// Cache dla ogólnokrajowych utrudnień z R2 (polska/disruptions.json)
let nationalDisruptionsCache: { at: number; items: MpkNewsItem[] } | null = null;
const DISRUPTIONS_CACHE_TTL = 2 * 60 * 1000;

async function getNationalDisruptions(): Promise<MpkNewsItem[]> {
  const now = Date.now();
  if (nationalDisruptionsCache && now - nationalDisruptionsCache.at < DISRUPTIONS_CACHE_TTL) {
    return nationalDisruptionsCache.items;
  }
  try {
    const items = await fetchDisruptionsFromWorker('polska');
    const valid = items ?? [];
    nationalDisruptionsCache = { at: now, items: valid };
    return valid;
  } catch {
    return nationalDisruptionsCache?.items ?? [];
  }
}

function cleanHeaderTimeframe(raw?: string | null): string {
  if (!raw) return '';
  const trimmed = raw.trim();
  const withoutParentheses = trimmed.replace(/\s*\([^)]*\)\s*$/, '').trim();
  return withoutParentheses || trimmed;
}

/**
 * Alerty dla nogi kolejowej:
 * 1. Status odwołania lub objazdu z oficjalnego feedu PKP PLK (/api/rail/delays)
 * 2. Ogólnopolskie komunikaty operacyjne z R2 (/polska/disruptions.json)
 * 3. Zgłoszenia i komunikaty ze zbiorkomu (SSE /api6/pkp/positions/...)
 */
async function alertsForLeg(leg: Leg): Promise<TrainAlertItem[]> {
  const candidates = vehicleCandidatesForLeg(leg);
  const cacheKey = [leg.tripId ?? '', leg.trainNumber ?? '', ...candidates].join('|');
  const hit = results.get(cacheKey);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.alerts;

  const pending = inFlight.get(cacheKey);
  if (pending) return pending;

  const promise = (async () => {
    const alerts: TrainAlertItem[] = [];

    // 1. Sprawdzamy status odwołania / objazdu z PKP PLK updates
    try {
      const updates = await fetchNationalRailUpdates([leg]);
      const update = leg.tripId ? updates.get(leg.tripId) : undefined;
      if (update?.cancelled) {
        alerts.push({
          id: `${leg.tripId ?? leg.id}-cancelled`,
          title: 'Kurs odwołany',
          description: `Pociąg ${leg.trainNumber ?? leg.line ?? ''} został odwołany przez zarządcę/przewoźnika na wybranym odcinku trasy.`,
          solution: 'Zalecany kontakt z obsługą przewoźnika lub wybór innego połączenia.',
          isUrgent: true,
          timeframe: leg.departAt ? `Odjazd: ${leg.departAt}` : undefined,
        });
      }
      if (update?.detour) {
        alerts.push({
          id: `${leg.tripId ?? leg.id}-detour`,
          title: 'Trasa zmieniona (objazd)',
          description: 'Pociąg jedzie trasą okrężną / drogą objazdową.',
          solution: 'Czas przejazdu i lista stacji pośrednich mogą ulec zmianie.',
          isUrgent: true,
          timeframe: leg.departAt ? `Odjazd: ${leg.departAt}` : undefined,
        });
      }
    } catch {
      // Błąd live updates nie blokuje reszty alertów
    }

    // 2. Sprawdzamy komunikaty o utrudnieniach PKP (np. awaria trakcji, honorowanie biletów, opóźnienia)
    try {
      const disruptions = await getNationalDisruptions();
      const trainNum = leg.trainNumber ? leg.trainNumber.replace(/\D/g, '') : null;
      const lineNorm = leg.line ? leg.line.toLowerCase() : '';
      for (const d of disruptions) {
        const titleLower = d.title.toLowerCase();
        const descLower = (d.description || '').toLowerCase();
        const match =
          (trainNum && trainNum.length >= 3 && (titleLower.includes(trainNum) || descLower.includes(trainNum))) ||
          (lineNorm && d.lines?.some((l) => l.toLowerCase() === lineNorm));

        if (match) {
          const headline = d.disruption?.headline || d.title;
          const problem = d.disruption?.glance?.problem || d.description || d.title;
          if (!alerts.some((a) => a.title === headline)) {
            alerts.push({
              id: d.id,
              title: headline,
              description: problem,
              solution: d.disruption?.glance?.solution || undefined,
              isUrgent: Boolean((d.disruption?.is_emergency || d.urgent) && !d.disruption?.is_resolved),
              isResolved: Boolean(d.disruption?.is_resolved),
              timeframe: cleanHeaderTimeframe(d.disruption?.glance?.timeframe || d.dateLabel),
              source: d.source || leg.railAgency || 'PKP',
              link: d.link || undefined,
            });
          }
        }
      }
    } catch {
      // Ignorujemy błąd pobierania ogólnych utrudnień
    }

    // 3. Sprawdzamy kandydatów pojazdu zbiorkomu
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
              });
            }
          }
          if (alerts.length > 0) break;
        } catch {
          // Następny kandydat
        }
      }
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
 * pobrać - alerty są dodatkiem, nie mogą blokować listy wyników.
 */
export async function alertsForConnection(connection: Connection): Promise<TrainAlerts[]> {
  const legs = connection.legs.filter((l) => l.mode === 'train' && (l.tripId?.startsWith('pl:') || l.trainNumber));
  if (legs.length === 0) return [];
  const out: TrainAlerts[] = [];
  for (const leg of legs.slice(0, 3)) {
    const alerts = await alertsForLeg(leg).catch(() => [] as ZbVehicleAlert[]);
    if (alerts.length > 0) out.push({ leg, alerts });
  }
  return out;
}
