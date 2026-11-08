import type { Leg } from '../types/models';

const INTERCITY_LINES = new Set(['EC', 'EIC', 'EIP', 'IC', 'ICN', 'MP', 'TLK']);

function rawTrainParts(line?: string): { number?: string; name?: string } {
  const match = /^(?:IC|TLK|EIP|EIC|EC|ICN|MP)\s+(\d+(?:\/\d+)?)(?:\s+(.+))?$/i.exec(
    line?.trim() ?? '',
  );
  return match ? { number: match[1], name: match[2] } : {};
}

/**
 * Kolory tożsamości wizualnej polskich przewoźników kolejowych.
 * Odcienie dobrane z palety tranzytowej motywu, zharmonizowane z M3 Dark
 * i gwarantujące kontrast WCAG AA (>= 4.5:1) dla tekstu i ikony.
 */
export const RAIL_AGENCY_COLORS: Record<string, string> = {
  KD: '#FFB957', // Koleje Dolnośląskie – dolnośląskie złoto / bursztyn (czarny tekst, kontrast 12.3:1)
  'KŚ': '#1976D2', // Koleje Śląskie – błękit śląski (biały tekst, kontrast 4.6:1)
  KS: '#1976D2',
  PR: '#D32F2F', // Polregio – firmowa czerwień / karmin (biały tekst, kontrast 5.0:1)
  IC: '#0D47A1', // PKP Intercity – firmowy kobalt / granat (biały tekst, kontrast 8.6:1)
  KM: '#2E7D32', // Koleje Mazowieckie – zieleń mazowiecka (biały tekst, kontrast 5.1:1)
  'ŁKA': '#7B1FA2', // Łódzka Kolej Aglomeracyjna – fiolet / magenta (biały tekst, kontrast 8.2:1)
  LKA: '#7B1FA2',
  KW: '#C2185B', // Koleje Wielkopolskie – malinowa czerwień (biały tekst, kontrast 5.9:1)
  'KMŁ': '#0288D1', // Koleje Małopolskie – błękit małopolski (czarny tekst, kontrast 5.4:1)
  KML: '#0288D1',
  SKM: '#D32F2F', // SKM Warszawa – warszawska czerwień (biały tekst, kontrast 5.0:1)
  SKMT: '#0D47A1', // PKP SKM Trójmiasto – granat morski (biały tekst, kontrast 8.6:1)
  WKD: '#1A237E', // Warszawska Kolej Dojazdowa – ciemny granat (biały tekst, kontrast 13.2:1)
};

export function getRailAgencyColor(agency?: string): string | undefined {
  if (!agency) return undefined;
  const upper = agency.toUpperCase();
  return RAIL_AGENCY_COLORS[upper] ?? RAIL_AGENCY_COLORS[agency];
}

/**
 * Sprawdza czy dany odcinek jest odcinkiem kolejowym (pociąg).
 */
export function isTrainLeg(
  leg: Pick<Leg, 'mode'> & Partial<Pick<Leg, 'tripId' | 'fromStopId' | 'trainNumber' | 'railAgency'>>,
): boolean {
  return (
    leg.mode === 'train' ||
    Boolean(leg.tripId?.startsWith('pl:')) ||
    Boolean(leg.fromStopId?.startsWith('pl:') || leg.fromStopId?.startsWith('stop-pl:')) ||
    Boolean(leg.trainNumber && leg.railAgency)
  );
}

/** Rozpoznaje przewoźnika kolejowego po nazwie/kodzie linii i opcjonalnym mieście. */
export function inferRailAgencyFromLine(line?: string, cityId?: string): string | undefined {
  if (!line) return undefined;
  const clean = line.trim();
  const linePrefix =
    /^(KD|KM|KW|KS|KŚ|KML|KMŁ|ŁKA|LKA|PR|POLREGIO|REG|WKD|SKMT|SKM|IC|TLK|EIP|EIC|EC|ICN|MP)(?:[\s:_-]|$)/i.exec(
      clean,
    )?.[1];
  if (linePrefix) {
    const upper = linePrefix.toUpperCase();
    if (INTERCITY_LINES.has(upper)) return 'IC';
    if (upper === 'POLREGIO' || upper === 'REG') return 'PR';
    return upper;
  }
  if (/^D\d{1,2}$/i.test(clean) && (cityId === 'wroclaw' || !cityId)) {
    return 'KD';
  }
  if (cityId === 'warszawa') {
    if (/^S\d{1,2}$/i.test(clean)) return 'SKM';
    if (/^R\d{1,2}$/i.test(clean) || /^RL$/i.test(clean)) return 'KM';
  }
  if (cityId === 'gzm' && /^S\d{1,2}$/i.test(clean)) {
    return 'KŚ';
  }
  if (/^SKA\d$/i.test(clean)) {
    return 'KMŁ';
  }
  return undefined;
}

export function isIntercityTrain(leg: Pick<Leg, 'line' | 'railAgency' | 'railLine'>): boolean {
  if (leg.railAgency === 'IC') return true;
  if (leg.railLine && INTERCITY_LINES.has(leg.railLine.toUpperCase())) return true;
  return /^(?:IC|TLK|EIP|EIC|EC|ICN|MP)\b/i.test(leg.line?.trim() ?? '');
}

export function inferRailAgency(
  leg: Pick<Leg, 'line' | 'routeId' | 'railAgency'>,
  cityId?: string,
): string | undefined {
  if (leg.railAgency) return leg.railAgency;
  const routePrefix = /^([A-ZŁ]+):/i.exec(leg.routeId ?? '')?.[1];
  if (routePrefix) {
    const upper = routePrefix.toUpperCase();
    if (INTERCITY_LINES.has(upper)) return 'IC';
    if (upper === 'POLREGIO') return 'PR';
    return upper;
  }
  return inferRailAgencyFromLine(leg.line, cityId);
}

export function railBadgeLine(
  leg: Pick<Leg, 'line' | 'railAgency' | 'railLine' | 'trainNumber'>,
): string | undefined {
  if (isIntercityTrain(leg)) {
    return leg.trainNumber ?? rawTrainParts(leg.line).number ?? leg.line;
  }
  return leg.railLine ?? leg.line;
}

export function railDirectionLabel(
  leg: Pick<Leg, 'line' | 'railAgency' | 'railLine' | 'trainNumber' | 'trainName' | 'direction'>,
): string {
  const parts = rawTrainParts(leg.line);
  if (isIntercityTrain(leg)) {
    return [leg.trainName ?? parts.name, leg.direction].filter(Boolean).join(' · ');
  }
  return [leg.trainNumber, leg.direction].filter(Boolean).join(' · ');
}
