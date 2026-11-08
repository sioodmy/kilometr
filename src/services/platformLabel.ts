import type { Strings } from '../i18n';
import type { Leg } from '../types/models';

/**
 * Etykieta odjazdu: peron / tor / słupek / stanowisko w języku użytkownika.
 */
export function formatPlatformLabel(
  t: Strings,
  code?: string | null,
  mode?: Leg['mode'],
  stopName?: string | null,
  trackCode?: string | null,
): string | null {
  let trimmed = (code || '').trim();
  const trimmedTrack = (trackCode || '').trim();
  if (!trimmed && stopName) {
    const m = stopName.trim().match(/\s(\d{2})$/);
    if (m) {
      trimmed = m[1];
    }
  }
  if (!trimmed && !trimmedTrack) return null;

  if (/^(peron|słupek|słup|stanowisko)\b/i.test(trimmed)) {
    if (trimmedTrack && !trimmed.toLowerCase().includes('tor')) {
      return `${trimmed}, ${t.leg.platformTrack(trimmedTrack).toLowerCase()}`;
    }
    return trimmed;
  }

  // Węzły GZM: np. 2469011-00103 -> Stanowisko 3
  const gzmMatch = trimmed.match(/-(\d{3})(\d{2})([a-z]?)$/i);
  if (gzmMatch) {
    return t.leg.platformBay(`${parseInt(gzmMatch[2], 10)}`);
  }

  // Zespoły / Kraków: np. 103-05 -> Słupek 05 (lub Peron 1/2 dla tramwaju)
  const krkMatch = trimmed.match(/^\d{1,4}-(\d{2})$/);
  if (krkMatch) {
    const poleNum = krkMatch[1];
    const n = parseInt(poleNum, 10);
    if (mode === 'tram' && (n === 1 || n === 2)) {
      return t.leg.platformPeron(poleNum);
    }
    return t.leg.platformPole(poleNum);
  }

  // Pociąg / metro
  if (mode === 'train' || mode === 'subway') {
    if (trimmed && trimmedTrack) {
      return t.leg.platformPeronTrack(trimmed, trimmedTrack);
    }
    if (trimmed) {
      return t.leg.platformPeron(trimmed);
    }
    return t.leg.platformTrack(trimmedTrack);
  }

  if (!trimmed && trimmedTrack) {
    return t.leg.platformTrack(trimmedTrack);
  }

  // 1-2 cyfry (np. Warszawa '01', Poznań '71', '42')
  if (/^\d{1,2}$/.test(trimmed)) {
    const n = parseInt(trimmed, 10);
    if (n >= 41 && n <= 49) {
      return t.leg.platformPst(trimmed);
    }
    if (trimmed.startsWith('0') || n >= 10) {
      return t.leg.platformPole(trimmed);
    }
    return t.leg.platformPeron(trimmed);
  }

  // 5-cyfrowy kod słupka (np. Wrocław 20820)
  if (/^\d{5}$/.test(trimmed)) {
    return t.leg.platformPole(trimmed);
  }

  return t.leg.platformPeron(trimmed);
}
