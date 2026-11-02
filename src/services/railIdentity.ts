import type { Leg } from '../types/models';

const INTERCITY_LINES = new Set(['EC', 'EIC', 'EIP', 'IC', 'ICN', 'MP', 'TLK']);

function rawTrainParts(line?: string): { number?: string; name?: string } {
  const match = /^(?:IC|TLK|EIP|EIC|EC|ICN|MP)\s+(\d+(?:\/\d+)?)(?:\s+(.+))?$/i.exec(
    line?.trim() ?? '',
  );
  return match ? { number: match[1], name: match[2] } : {};
}

export function isIntercityTrain(leg: Pick<Leg, 'line' | 'railAgency' | 'railLine'>): boolean {
  if (leg.railAgency === 'IC') return true;
  if (leg.railLine && INTERCITY_LINES.has(leg.railLine.toUpperCase())) return true;
  return /^(?:IC|TLK|EIP|EIC|EC|ICN|MP)\b/i.test(leg.line?.trim() ?? '');
}

export function inferRailAgency(
  leg: Pick<Leg, 'line' | 'routeId' | 'railAgency'>,
): string | undefined {
  if (leg.railAgency) return leg.railAgency;
  const routePrefix = /^([A-ZŁ]+):/i.exec(leg.routeId ?? '')?.[1];
  if (routePrefix) return routePrefix.toUpperCase();
  const linePrefix =
    /^(KD|KM|KW|KS|KŚ|KML|KMŁ|ŁKA|LKA|PR|POLREGIO|WKD|SKMT|SKM|IC|TLK|EIP|EIC|EC|ICN|MP)\b/i.exec(
      leg.line?.trim() ?? '',
    )?.[1];
  if (!linePrefix) return undefined;
  const upper = linePrefix.toUpperCase();
  if (INTERCITY_LINES.has(upper)) return 'IC';
  if (upper === 'POLREGIO') return 'PR';
  return upper;
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
