import type { LegMode } from '../types/models';
import { classifyVehicle } from '../gtfs/transitMode';

// Tożsamość linii komunikacyjnej: typ pojazdu, stabilny kolor i kontrast.
// Wydzielone z komponentu LineBadge, bo zależy ich silnik powiadomień
// (kolor linii jako akcent powiadomienia i segmentu na pasku postępu).

export const TRANSIT_PALETTE = [
  '#00897B', // Teal
  '#1976D2', // Blue
  '#D32F2F', // Red
  '#7B1FA2', // Purple
  '#F57C00', // Amber/Orange
  '#303F9F', // Indigo
  '#2E7D32', // Green
  '#C2185B', // Pink
  '#0097A7', // Cyan
  '#E64A19', // Deep Orange
  '#512DA8', // Deep Purple
  '#0288D1', // Light Blue
  '#558B2F', // Olive/Lime
  '#AD1457', // Berry
  '#00838F', // Dark Cyan
  '#455A64', // Blue Grey
  '#5D4037', // Brown
  '#388E3C', // Emerald
  '#0D47A1', // Cobalt
  '#880E4F', // Wine
  '#00695C', // Pine
  '#BF360C', // Rust
  '#311B92', // Violet
  '#1A237E', // Midnight Blue
];

/**
 * Rozpoznaje typ pojazdu.
 *
 * Kolejność: jawny tryb z planera (`LegMode`) → `route_type` z feedu.
 * Świadomie NIE zgadujemy po numerze linii — numeracja tramwajów różni się
 * między miastami (Wrocław 0–24, Kraków 1–22 plus 49/62/69/70/74/76/77), a
 * heurystyka „1–33 = tramwaj” myliła się w obu. Szczegóły i tabela
 * `route_type` (0 = tram, 900 = tram w extended GTFS) w `gtfs/transitMode`.
 *
 * Bez żadnego sygnału zwracamy `bus`, jak przed refaktorem.
 */
export function inferTransitMode(mode?: LegMode, line?: string): 'tram' | 'bus' | 'walk' {
  if (mode === 'walk') return 'walk';
  if (mode === 'tram') return 'tram';
  if (mode === 'bus') return 'bus';
  return classifyVehicle({ line });
}

/** Oblicza stabilny, zharmonizowany kolor linii z gwarantowanym kontrastem tekstu. */
export function getLineColors(
  line?: string,
  mode?: LegMode,
): { bg: string; fg: string; isTram: boolean } {
  const resolved = inferTransitMode(mode, line);
  const isTram = resolved === 'tram';
  const clean = (line || '').trim().toUpperCase();

  if (!clean) {
    return { bg: isTram ? '#00897B' : '#1976D2', fg: '#FFFFFF', isTram };
  }

  let hash = 0;
  const key = `${isTram ? 'tram' : 'bus'}:${clean}`;
  for (let i = 0; i < key.length; i++) {
    hash = ((hash << 5) - hash + key.charCodeAt(i)) | 0;
  }
  const idx = Math.abs(hash * 7) % TRANSIT_PALETTE.length;
  const bg = TRANSIT_PALETTE[idx];

  // WCAG AA kontrast: oblicz luminancję tła
  const hex = bg.replace('#', '');
  const r = parseInt(hex.substring(0, 2), 16);
  const g = parseInt(hex.substring(2, 4), 16);
  const b = parseInt(hex.substring(4, 6), 16);
  const lum = 0.299 * r + 0.587 * g + 0.114 * b;
  const fg = lum > 145 ? '#0A1210' : '#FFFFFF';

  return { bg, fg, isTram };
}
