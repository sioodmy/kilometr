import type { LegMode } from '../types/models';

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
 * Rozpoznaje typ pojazdu (wrocławskie i poznańskie tramwaje to niskie numery,
 * reszta to autobusy). Moduł musi się dać importować w Node (skrypty check:*),
 * więc `cityId` jest opcjonalnym parametrem, a nie odczytem aktywnego miasta:
 * heurystyka niskich numerów dotyczy Wrocławia, Krakowa, Poznania i Łodzi,
 * a w GZM niskie numery mają też autobusy, więc komponent przekazuje `'gzm'`
 * i fallback gaśnie. Poznań dokłada tramwaje 97, 201 i 203 (route_type 0
 * w feedzie ZTM), Łódź dokłada podmiejskie 41/43/45 oraz P1, R8 i Z1
 * (route_type 0 w feedzie ZDiT; "6." z kropką to autobus), Warszawa dokłada
 * metro M1/M2 (route_type 1) i SKA S1…S40 (route_type 2): badge newsów nie
 * zna trybu z planera, więc linie rozpoznaje po nazwie.
 */
export function inferTransitMode(
  mode?: LegMode,
  line?: string,
  cityId?: string,
): 'tram' | 'bus' | 'train' | 'cable' | 'trolleybus' | 'subway' | 'walk' {
  if (mode === 'walk') return 'walk';
  if (mode === 'tram') return 'tram';
  if (mode === 'train') return 'train';
  if (mode === 'cable') return 'cable';
  if (mode === 'trolleybus') return 'trolleybus';
  if (mode === 'subway') return 'subway';
  if (mode === 'bus') return 'bus';
  if (!line) return 'bus';
  const clean = line.trim();
  if (cityId === 'warszawa') {
    if (/^M[12]$/i.test(clean)) return 'subway';
    if (/^S\d{1,2}$/i.test(clean)) return 'train';
  }
  const num = parseInt(clean, 10);
  // Poznań: tramwaje to 1–19 plus 97, 201 i 203 (wszystkie z route_type 0
  // w feedzie ZTM), a T6/T7 to autobusy turystyczne. Numery > 33 poza
  // wymienionymi to autobusy (nocne 2xx też, oprócz 201/203).
  if (cityId === 'poznan') {
    if (/^T\d{1,2}$/i.test(clean)) return 'bus';
    if (num === 97 || num === 201 || num === 203) return 'tram';
  }
  // Łódź: tramwaje to 1–19 plus podmiejskie 41/43/45 i jednoliterowe P1, R8,
  // Z1 (wszystkie z route_type 0 w feedzie ZDiT). "6." z kropką to autobus.
  if (cityId === 'lodz') {
    if (/^6\.$/.test(clean)) return 'bus';
    if (num === 41 || num === 43 || num === 45) return 'tram';
    if (/^(P1|R8|Z1)$/i.test(clean)) return 'tram';
  }
  if (!isNaN(num) && num >= 1 && num <= 33 && cityId !== 'gzm') {
    return 'tram';
  }
  return 'bus';
}

/**
 * Pociągi KD mają STAŁY kolor zamiast losowanego z palety: bursztyn z motywu
 * (#FFB957, rodzina warning). Stała leży tutaj, a nie w theme/tokens, bo
 * lineIdentity musi się dać importować w Node (skrypty check:*), a tokens
 * ciągnie react-native. Tekst na badgu liczy reguła kontrastu niżej.
 */
export const TRAIN_BADGE_BG = '#FFB957';

/**
 * Polinka dostaje drugą stałą, niebieską z motywu (tertiary #A5CCE8): gondola
 * nad rzeką nie może wyglądać jak tramwaj z palety, a odcień musi być odrębny
 * od bursztynu pociągów. Jasne tło → ciemny tekst, kontrast ~11:1.
 */
export const CABLE_BADGE_BG = '#A5CCE8';

/**
 * Trolejbus (GZM/Tychy) dostaje stałą zieleń: sygnalizuje napęd elektryczny,
 * a odcień jest odrębny od bursztynu pociągów i błękitu kolejki. Ciemne
 * tło → biały tekst, kontrast ~5:1.
 */
export const TROLLEY_BADGE_BG = '#2E7D32';

/**
 * Metro Warszawy jedzie kolorami z feedu WTP (M1 niebieskie #0000BB,
 * M2 czerwone #BB0000, zweryfikowane w routes.txt): pasażer poznaje linię
 * po barwie ze schematu, nie po losie z palety. Oba ciemne → biały tekst.
 */
export const SUBWAY_BADGE_BG: Record<string, string> = { M1: '#0000BB', M2: '#BB0000' };
export const SUBWAY_BADGE_FALLBACK_BG = '#1A237E';

/** WCAG AA: ciemny albo biały tekst w zależności od luminancji tła. */
function contrastFg(bg: string): string {
  const hex = bg.replace('#', '');
  const r = parseInt(hex.substring(0, 2), 16);
  const g = parseInt(hex.substring(2, 4), 16);
  const b = parseInt(hex.substring(4, 6), 16);
  const lum = 0.299 * r + 0.587 * g + 0.114 * b;
  return lum > 145 ? '#0A1210' : '#FFFFFF';
}

/** Oblicza stabilny, zharmonizowany kolor linii z gwarantowanym kontrastem tekstu. */
export function getLineColors(
  line?: string,
  mode?: LegMode,
  cityId?: string,
): { bg: string; fg: string; isTram: boolean; isTrain: boolean; isCable: boolean } {
  const resolved = inferTransitMode(mode, line, cityId);
  if (resolved === 'train') {
    return { bg: TRAIN_BADGE_BG, fg: contrastFg(TRAIN_BADGE_BG), isTram: false, isTrain: true, isCable: false };
  }
  if (resolved === 'subway') {
    const bg = SUBWAY_BADGE_BG[(line || '').trim().toUpperCase()] ?? SUBWAY_BADGE_FALLBACK_BG;
    return { bg, fg: contrastFg(bg), isTram: false, isTrain: false, isCable: false };
  }
  if (resolved === 'cable') {
    return { bg: CABLE_BADGE_BG, fg: contrastFg(CABLE_BADGE_BG), isTram: false, isTrain: false, isCable: true };
  }
  if (resolved === 'trolleybus') {
    return { bg: TROLLEY_BADGE_BG, fg: contrastFg(TROLLEY_BADGE_BG), isTram: false, isTrain: false, isCable: false };
  }
  const isTram = resolved === 'tram';
  const clean = (line || '').trim().toUpperCase();

  if (!clean) {
    return { bg: isTram ? '#00897B' : '#1976D2', fg: '#FFFFFF', isTram, isTrain: false, isCable: false };
  }

  let hash = 0;
  const key = `${isTram ? 'tram' : 'bus'}:${clean}`;
  for (let i = 0; i < key.length; i++) {
    hash = ((hash << 5) - hash + key.charCodeAt(i)) | 0;
  }
  const idx = Math.abs(hash * 7) % TRANSIT_PALETTE.length;
  const bg = TRANSIT_PALETTE[idx];
  const fg = contrastFg(bg);

  return { bg, fg, isTram, isTrain: false, isCable: false };
}
